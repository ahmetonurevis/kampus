import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { PROSPECT_SOURCES, PROSPECT_STAGES, type ProspectStage } from './prospects.ts'

/**
 * Kayıt hunisi raporu (docs/domain/kayit-ve-crm.md DOM-KAY-040; IST-117). Saf hesap: girdi, servisin
 * tarih aralığına (adayın açılış günü) göre yüklediği adaylardır; çıktı kişi adı, iletişim bilgisi
 * ve aday kimliği taşımaz, yalnız sayı ve oran.
 *
 * - Adımlar: aday → görüşme → deneme dersi (yalnız dil okulu) → kesin kayıt. Huni birikimlidir:
 *   aşama atlanabildiği için (DOM-KAY-030) ileri adıma ulaşan aday önceki adımları geçmiş sayılır.
 * - Aşama sayıları adayın güncel aşamasıdır; tanınmayan eski aşama hiçbir aşamaya yazılmaz ama
 *   aday sayısına girer.
 * - Kırılımlar: kaynak (DOM-KAY-007) ve danışman. Aday atama alanı olmadığı için danışman adayı
 *   açan personeldir (`createdBy.userId`); açanı kayıtlı olmayan eski aday `null` grubundadır.
 *   TODO(crm-counselor): adaya sorumlu danışman atanabilince kırılım o alandan okunur.
 */

/** Raporu okuyabilen roller (yetki matrisi "Aday, tanışma görüşmesi"; modül `crm`). */
export const ENROLLMENT_FUNNEL_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]

/** Huni adımları sırasıyla; `trial` yalnız dil okulunda vardır (DOM-DIL-030). */
export const FUNNEL_STEPS = ['prospect', 'meeting', 'trial', 'enrolled'] as const
export type FunnelStep = (typeof FUNNEL_STEPS)[number]

/** Kurum türünde huniye giren adımlar. */
export function funnelSteps(institutionType: InstitutionType): FunnelStep[] {
  return FUNNEL_STEPS.filter((step) => step !== 'trial' || institutionType === 'language_school')
}

/** Adımın gösterilen adı; dil okulunda tanışma görüşmesi seviye tespiti görüşmesidir. */
export function funnelStepLabel(step: FunnelStep, institutionType: InstitutionType): string {
  switch (step) {
    case 'prospect':
      return 'Aday'
    case 'meeting':
      return institutionType === 'language_school'
        ? 'Seviye tespiti görüşmesi'
        : 'Tanışma görüşmesi'
    case 'trial':
      return 'Deneme dersi'
    case 'enrolled':
      return 'Kesin kayıt'
    default:
      return step satisfies never
  }
}

/**
 * Hunide okunan aday alanları. Depodan gelen eski kayıtlar alanları eksik ya da farklı biçimde
 * taşıyabilir; hesap yalnız varlığa ve bilinen değerlere bakar.
 */
export type FunnelProspect = {
  source?: string | null | undefined
  stage?: string | null | undefined
  studentId?: string | null | undefined
  /** Eski kayıtlarda görüşme anı (`meeting` öncesi). */
  trialAt?: string | null | undefined
  meeting?: object | null | undefined
  trialLesson?: object | null | undefined
  createdBy?: { userId?: string | null | undefined } | null | undefined
}

export type FunnelStepCount = {
  step: FunnelStep
  count: number
  /** Önceki adıma göre yüzde (bir ondalık); ilk adımda ve önceki adım 0 iken `null`. */
  rate: number | null
}

export type FunnelRow = {
  prospects: number
  steps: FunnelStepCount[]
  stages: { stage: ProspectStage; count: number }[]
  /** Kesin kaydın aday sayısına oranı, yüzde (bir ondalık); aday yoksa `null`. */
  conversionRate: number | null
}

export type EnrollmentFunnel = {
  total: FunnelRow
  /** Bilinen kaynaklar (sıfır olsa da) liste sırasıyla, sonra tanınmayan eski kaynaklar, en son kaynaksız. */
  bySource: (FunnelRow & { source: string | null })[]
  /** Adayı olan danışmanlar aday sayısına göre çoktan aza; açanı bilinmeyen adaylar en sonda. */
  byCounselor: (FunnelRow & { counselorId: string | null })[]
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

const present = (value: unknown) => value !== null && value !== undefined

/** Adayın ulaştığı en ileri adımın sırası (`FUNNEL_STEPS` dizini). */
function reach(prospect: FunnelProspect, language: boolean): number {
  if (prospect.stage === 'Kayıt oldu' || text(prospect.studentId) !== null)
    return FUNNEL_STEPS.indexOf('enrolled')
  if (language && present(prospect.trialLesson)) return FUNNEL_STEPS.indexOf('trial')
  // Vazgeçen ya da geri alınan adayın ileri tarihli görüşmesi kaydından kalkar (DOM-KAY-030);
  // kalan görüşme gerçekleşmiş ya da hâlâ planlıdır.
  if (
    present(prospect.meeting) ||
    text(prospect.trialAt) !== null ||
    prospect.stage === 'Görüşme planlandı'
  )
    return FUNNEL_STEPS.indexOf('meeting')
  return FUNNEL_STEPS.indexOf('prospect')
}

/** Yüzde, bir ondalığa yuvarlanmış; payda 0 ise `null`. */
export function funnelRate(count: number, base: number): number | null {
  if (base <= 0) return null
  return Math.round((count * 1000) / base) / 10
}

type Tally = { reached: number[]; stages: Map<string, number> }

const emptyTally = (): Tally => ({
  reached: FUNNEL_STEPS.map(() => 0),
  stages: new Map(),
})

function add(tally: Tally, level: number, stage: string | null) {
  for (let index = 0; index <= level; index += 1)
    tally.reached[index] = (tally.reached[index] ?? 0) + 1
  if (stage !== null) tally.stages.set(stage, (tally.stages.get(stage) ?? 0) + 1)
}

function row(tally: Tally, institutionType: InstitutionType): FunnelRow {
  const countOf = (step: FunnelStep) => tally.reached[FUNNEL_STEPS.indexOf(step)] ?? 0
  const prospects = countOf('prospect')
  let previous: number | null = null
  const steps = funnelSteps(institutionType).map((step) => {
    const count = countOf(step)
    const rate = previous === null ? null : funnelRate(count, previous)
    previous = count
    return { step, count, rate }
  })
  return {
    prospects,
    steps,
    stages: PROSPECT_STAGES.map((stage) => ({ stage, count: tally.stages.get(stage) ?? 0 })),
    conversionRate: funnelRate(countOf('enrolled'), prospects),
  }
}

const KNOWN_SOURCES: readonly string[] = PROSPECT_SOURCES
const collator = new Intl.Collator('tr')

function sourceOrder(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  const ai = KNOWN_SOURCES.indexOf(a)
  const bi = KNOWN_SOURCES.indexOf(b)
  if (ai !== -1 || bi !== -1) return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi)
  return collator.compare(a, b)
}

/**
 * Kayıt hunisi (DOM-KAY-040): toplam, kaynak ve danışman kırılımı. Aynı aday her kırılımda bir kez
 * sayılır; kırılım toplamları genel toplama eşittir.
 */
export function enrollmentFunnel(
  prospects: readonly FunnelProspect[],
  institutionType: InstitutionType,
): EnrollmentFunnel {
  const language = institutionType === 'language_school'
  const total = emptyTally()
  const sources = new Map<string | null, Tally>(
    KNOWN_SOURCES.map((source) => [source, emptyTally()]),
  )
  const counselors = new Map<string | null, Tally>()
  const tallyIn = <K>(map: Map<K, Tally>, key: K) => {
    let tally = map.get(key)
    if (tally === undefined) {
      tally = emptyTally()
      map.set(key, tally)
    }
    return tally
  }
  for (const prospect of prospects) {
    const level = reach(prospect, language)
    const stage = text(prospect.stage)
    add(total, level, stage)
    add(tallyIn(sources, text(prospect.source)), level, stage)
    add(tallyIn(counselors, text(prospect.createdBy?.userId)), level, stage)
  }
  const bySource = [...sources.entries()]
    .sort(([a], [b]) => sourceOrder(a, b))
    .map(([source, tally]) => ({ source, ...row(tally, institutionType) }))
  const byCounselor = [...counselors.entries()]
    .map(([counselorId, tally]) => ({ counselorId, ...row(tally, institutionType) }))
    .sort((a, b) => {
      if (a.counselorId === null || b.counselorId === null)
        return a.counselorId === null ? (b.counselorId === null ? 0 : 1) : -1
      return b.prospects - a.prospects || (a.counselorId < b.counselorId ? -1 : 1)
    })
  return { total: row(total, institutionType), bySource, byCounselor }
}
