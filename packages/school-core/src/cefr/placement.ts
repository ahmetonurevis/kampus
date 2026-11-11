import { z } from 'zod'
import { DomainError } from '../lib/errors.ts'
import type { Role } from '../modules/navigation.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import {
  CEFR_LEVELS,
  SKILLS,
  enumKeys,
  type CefrLevel,
  type PrimarySkill,
} from '../content/taxonomy.ts'
import {
  answersSchema,
  assertResponsesFit,
  scoreAttempt,
  type ScoringItem,
} from '../skills/scoring.ts'
import { rubricScore, rubricScoreInputSchema, type RubricVersionData } from '../skills/rubric.ts'
import {
  EVIDENCE_WINDOW_DAYS,
  evidenceSnapshotOf,
  suggestCefrLevels,
  type CefrSuggestion,
  type EvidenceCandidate,
  type EvidenceResult,
  type EvidenceSnapshot,
  type LevelDecisionRow,
} from './suggestion.ts'

/**
 * Seviye tespiti: oturum, bölüm sonuçları, öneri, yerleştirme kararı ve geçerlilik
 * (docs/domain/dil-okulu.md DOM-DIL-010…012; ADR 0004 karar 8, 11; IST-058).
 *
 * Satırlar: `placement_sessions` (aday veya öğrenci, form sürümü, yer, başlangıç/bitiş) ve
 * bölüm sonuçları (dil kullanımı, okuma, dinleme otomatik; yazma, konuşma rubrikli). Bölüm puanı
 * F4a'dan gelir: otomatik bölümde `scoreAttempt`, rubrikli bölümde kesinleşmiş `rubricScore`.
 * Öneri ve geçerlilik saklanmaz; yerleştirme kararı `level_decisions` satırıdır ve karar anının
 * önerisini `evidence_snapshot` olarak taşır (karar 5).
 *
 * Seviye tespiti yalnız `language_school`'dadır (DOM-YTK-012); okulda uç bulunmaz gibi davranır.
 */

z.config(z.locales.tr())

type Instant = Date | string
const toMs = (value: Instant) => (typeof value === 'string' ? Date.parse(value) : value.getTime())
const toIso = (ms: number) => new Date(ms).toISOString()
const DAY = 24 * 60 * 60_000

const identifier = z.string().trim().min(1, 'Bir kayıt seçin.').max(200)
const cefrLevel = z.enum(enumKeys(CEFR_LEVELS), { error: 'Bir CEFR seviyesi seçin.' })

// --- Sözlük -------------------------------------------------------------------------------

/** Tespite giren kişi (ADR 0004 karar 8, açık soru 3a): kayıtlı öğrenci veya aday. */
export const LEARNER_KINDS = {
  student: { label: 'Öğrenci' },
  prospect: { label: 'Aday' },
} as const
export type LearnerKind = keyof typeof LEARNER_KINDS

/** Tespitin yeri (DOM-DIL-011): uzaktan çözülen test ön tespittir. */
export const PLACEMENT_MODES = {
  in_person: { label: 'Kurumda', preliminary: false },
  remote: { label: 'Uzaktan (ön tespit)', preliminary: true },
} as const
export type PlacementMode = keyof typeof PLACEMENT_MODES

/**
 * Tespit bölümleri (DOM-DIL-010, IST-058): dil kullanımı, okuma ve dinleme otomatik; yazma ve
 * konuşma rubrikle puanlanır. Sıra ekrandaki sıradır.
 */
export const PLACEMENT_SECTIONS = {
  language_use: { scoring: 'auto' },
  reading: { scoring: 'auto' },
  listening: { scoring: 'auto' },
  writing: { scoring: 'rubric' },
  speaking: { scoring: 'rubric' },
} as const satisfies Partial<Record<PrimarySkill, { scoring: EvidenceResult['mode'] }>>
export type PlacementSection = keyof typeof PLACEMENT_SECTIONS
const SECTION_KEYS = enumKeys(PLACEMENT_SECTIONS)

/** Seviye tespiti sonucunun geçerliliği, gün (DOM-DIL-012); kanıt penceresiyle aynı değerdir. */
export const PLACEMENT_VALIDITY_DAYS = EVIDENCE_WINDOW_DAYS.placement

/** Bir dönemde aynı kişinin girebileceği tespit sayısı (DOM-DIL-012). */
export const PLACEMENT_ATTEMPTS_PER_TERM = 2

/** Yerleştirme kararını veren roller (DOM-DIL-010: öğretmen veya akademik koordinatör). */
export const PLACEMENT_DECIDER_ROLES = ['yonetici', 'ogretmen'] as const satisfies readonly Role[]

function assertLanguageSchool(institutionType: InstitutionType): void {
  if (institutionType !== 'language_school') {
    throw new DomainError(
      'module_unavailable_for_type',
      'Seviye tespiti yalnız dil okulunda kullanılır.',
      { kind: 'not_found' },
    )
  }
}

// --- Oturum -------------------------------------------------------------------------------

/** Oturum açma gövdesi. Form, bölümlü quiz kaynağının sabit sürümüdür (ADR 0004 karar 8). */
export const placementSessionInputSchema = z.object({
  learnerKind: z.enum(enumKeys(LEARNER_KINDS)),
  learnerId: identifier,
  formId: identifier,
  formVersionId: identifier,
  mode: z.enum(enumKeys(PLACEMENT_MODES)),
})
export type PlacementSessionInput = z.input<typeof placementSessionInputSchema>
export type PlacementSessionData = z.output<typeof placementSessionInputSchema>

/** `placement_sessions` satırı. Bitiş anı sunucu saatidir; geçerlilik ondan hesaplanır. */
export type PlacementSessionRow = PlacementSessionData & {
  id: string
  startedAt: string
  completedAt: string | null
}
export type PlacementSessionDraft = Omit<PlacementSessionRow, 'id'>

const sameLearner = (a: PlacementSessionData, b: PlacementSessionData) =>
  a.learnerKind === b.learnerKind && a.learnerId === b.learnerId

/**
 * Tespit oturumu açar (DOM-DIL-010, 012). Aynı kişinin süren oturumu varken yenisi açılmaz; bir
 * dönemde en fazla iki oturum açılır ve ikincisi farklı formla yapılır. Uzaktan oturumlar da
 * sayılır.
 */
// TODO(cefr-donem): "Dönem" sınırı domain'de tanımlı değil; servis aynı dönemin oturumlarını
// (`termSessions`) verir.
// TODO(cefr-farkli-form): "Farklı soru formu" en muhafazakâr yorumla farklı kaynaktır (`formId`);
// aynı formun yeni sürümü aynı sorulara yakın olabileceği için sayılmaz.
// TODO(cefr-ruhsat-turu): Özel öğretim kursu ruhsatlı kurumda tespitin yalnız binada yapılması
// (DOM-DIL-011, doğrulanmalı) için kurum ruhsat türü verisi yok; uzaktan oturum açılabilir.
export function planPlacementSession(input: {
  institutionType: InstitutionType
  /** Aynı dönemin oturumları (her kişi); yalnız bu kişininkiler dikkate alınır. */
  termSessions: readonly PlacementSessionRow[]
  input: unknown
  now: Instant
}): PlacementSessionDraft {
  assertLanguageSchool(input.institutionType)
  const data = placementSessionInputSchema.parse(input.input)
  const own = input.termSessions.filter((session) => sameLearner(session, data))
  if (own.some((session) => session.completedAt === null)) {
    throw new DomainError('placement_in_progress', 'Bu kişinin süren bir seviye tespiti var.', {
      kind: 'conflict',
    })
  }
  if (own.length >= PLACEMENT_ATTEMPTS_PER_TERM) {
    throw new DomainError(
      'placement_limit_reached',
      'Bir dönemde en fazla iki kez seviye tespitine girilebilir.',
      { kind: 'conflict' },
    )
  }
  if (own.some((session) => session.formId === data.formId)) {
    throw new DomainError(
      'placement_form_repeated',
      'İkinci seviye tespiti farklı bir soru formuyla yapılmalıdır.',
      { path: ['formId'] },
    )
  }
  return { ...data, startedAt: toIso(toMs(input.now)), completedAt: null }
}

export type PlacementValidity =
  | { status: 'in_progress'; preliminary: boolean }
  | {
      status: 'valid' | 'expired'
      preliminary: boolean
      completedAt: string
      /** Geçerliliğin bittiği an (hariç): bitiş anı + 90 gün. */
      validUntil: string
    }

/**
 * Tespit sonucunun geçerliliği (DOM-DIL-012): oturumun bitiş anından 90 × 24 saat. Son an
 * hariçtir; tam `validUntil` anında sonuç geçersizdir. Bitmemiş oturumun sonucu yoktur.
 */
// TODO(cefr-gecerlilik-siniri): Domain sınırın dahil olup olmadığını söylemiyor; en muhafazakâr
// yorumla bitiş zamanından tam 90 gün sonra sonuç geçersizdir (`now < validUntil`).
export function placementValidity(
  session: Pick<PlacementSessionRow, 'mode' | 'completedAt'>,
  now: Instant,
): PlacementValidity {
  const preliminary = PLACEMENT_MODES[session.mode].preliminary
  if (session.completedAt === null) return { status: 'in_progress', preliminary }
  const completed = toMs(session.completedAt)
  const until = completed + PLACEMENT_VALIDITY_DAYS * DAY
  return {
    status: toMs(now) < until ? 'valid' : 'expired',
    preliminary,
    completedAt: toIso(completed),
    validUntil: toIso(until),
  }
}

/**
 * Kayıt için yeniden tespit gerekir mi (DOM-DIL-012, 011): kişinin geçerli, kurumda yapılmış bir
 * tespiti yoksa evet. Ön tespit kesin yerleştirme yerine geçmez.
 */
// TODO(cefr-dondurma): 90 günden uzun dondurulan kaydın yeniden tespiti (DOM-DIL-052) dondurma
// verisi gelince eklenir.
export function placementRequired(
  sessions: readonly Pick<PlacementSessionRow, 'mode' | 'completedAt'>[],
  now: Instant,
): boolean {
  return !sessions.some((session) => {
    const validity = placementValidity(session, now)
    return validity.status === 'valid' && !validity.preliminary
  })
}

// --- Bölüm sonuçları ----------------------------------------------------------------------

/** Bölüm sonucu satırı. `targetLevel` formun bölüm etiketidir; yoksa bölüm kanıt olamaz. */
export type PlacementSectionRow = {
  section: PlacementSection
  /** Sonuç kimliği (deneme veya teslim sürümü); bölüm başlamadıysa `null`. */
  resultId: string | null
  targetLevel: CefrLevel | null
  /** Sayılan deneme veya kesinleşmiş rubrik puanı; puanlanmamışsa `null`. */
  result: EvidenceResult | null
  appealPending?: boolean
}

export type PlacementSectionResult = {
  section: PlacementSection
  label: string
  scoring: EvidenceResult['mode']
  /** `missing`: formda bölüm yok; `pending`: puanlanmadı; `scored`: puan var. */
  status: 'missing' | 'pending' | 'scored'
  percent: number | null
}

function indexSections(sections: readonly PlacementSectionRow[]) {
  const bySection = new Map<PlacementSection, PlacementSectionRow>()
  sections.forEach((row, index) => {
    if (bySection.has(row.section)) {
      throw new DomainError('placement_section_duplicate', 'Bölüm sonucu tekrar ediyor.', {
        kind: 'conflict',
        path: ['sections', String(index)],
      })
    }
    if (row.result !== null && row.result.mode !== PLACEMENT_SECTIONS[row.section].scoring) {
      throw new DomainError(
        'placement_section_mismatch',
        'Bölümün puanlama türü sonuçla uyuşmuyor.',
        { path: ['sections', String(index)] },
      )
    }
    bySection.set(row.section, row)
  })
  return bySection
}

/** Bölüm sonuçları (DOM-DIL-010, IST-058): beş bölüm sabit sırayla; puan saklanmaz. */
export function placementSectionResults(
  sections: readonly PlacementSectionRow[],
): PlacementSectionResult[] {
  const bySection = indexSections(sections)
  return SECTION_KEYS.map((section) => {
    const row = bySection.get(section)
    const status = row === undefined ? 'missing' : row.result === null ? 'pending' : 'scored'
    return {
      section,
      label: SKILLS[section].label,
      scoring: PLACEMENT_SECTIONS[section].scoring,
      status,
      percent: row?.result?.score.percent ?? null,
    }
  })
}

/**
 * Oturumun bölümlerini kanıt adayına çevirir. Sonucun anı oturumun bitişidir; bitmemiş oturum
 * aday üretmez. Uzaktan oturumun adayları `suggestion.ts` seçiminde ön tespit diye ayrılır.
 */
export function placementEvidence(
  session: PlacementSessionRow,
  sections: readonly PlacementSectionRow[],
): EvidenceCandidate[] {
  if (session.completedAt === null) return []
  const bySection = indexSections(sections)
  return SECTION_KEYS.flatMap((section) => {
    const row = bySection.get(section)
    if (row === undefined) return []
    return [
      {
        id: row.resultId ?? `${session.id}:${section}`,
        taskId: `${session.id}:${section}`,
        title: `Seviye tespiti · ${SKILLS[section].label}`,
        source: 'placement' as const,
        kind: 'evaluation' as const,
        preliminary: PLACEMENT_MODES[session.mode].preliminary,
        skill: section,
        targetLevel: row.targetLevel,
        performedAt: session.completedAt ?? '',
        appealPending: row.appealPending ?? false,
        result: row.result,
      },
    ]
  })
}

export type PlacementSummary = {
  sections: PlacementSectionResult[]
  validity: PlacementValidity
  /** Uzaktan tespit ön tespittir (DOM-DIL-011); kesin yerleştirmeye dayanak olmaz. */
  preliminary: boolean
  suggestion: CefrSuggestion
}

/** Tamamlanmadan tespitin genel önerisi çıkmayan otomatik bölümler (DOM-DIL-010). */
export const PLACEMENT_AUTO_SECTIONS = SECTION_KEYS.filter(
  (section) => PLACEMENT_SECTIONS[section].scoring === 'auto',
)

/**
 * Tespit sonucu ve öneri (DOM-DIL-010): bölüm sonuçları ve oturumun kanıtları ile kişinin diğer
 * geçerli kanıtlarından DOM-BEC-030 önerisi, tespit bağlamında (`suggestion.ts`
 * `PLACEMENT_DEMONSTRATION_RULES`). Oturumun her puanlanmış bölümü bir kanıttır ve farklı gün
 * aranmaz; otomatik bölümlerden biri tamamlanmamışsa genel öneri çıkmaz; yazma veya konuşma
 * puanlanmamışsa yalnız o becerinin önerisi çıkmaz. Uzaktan oturumun bölümleri ön tespittir ve
 * kanıt değildir (DOM-DIL-011). Öğrencinin görev kanıtları eskisi gibi genel eşikle birlikte
 * sayılır; yalnız destekler, aynı seviyede başarı payını 2/3'ün altına düşürürse tespit yolunu
 * kapatır. Sonuç ve karar ayrıdır; bu fonksiyon karar vermez.
 */
export function placementSummary(input: {
  session: PlacementSessionRow
  sections: readonly PlacementSectionRow[]
  /** Öğrencinin görev kanıtları; adayda boş. */
  otherEvidence?: readonly EvidenceCandidate[]
  now: Instant
}): PlacementSummary {
  const validity = placementValidity(input.session, input.now)
  const session = placementEvidence(input.session, input.sections)
  return {
    sections: placementSectionResults(input.sections),
    validity,
    preliminary: validity.preliminary,
    suggestion: suggestCefrLevels({
      candidates: [...session, ...(input.otherEvidence ?? [])],
      now: input.now,
      context: {
        kind: 'placement',
        sessionTaskIds: session.map((candidate) => candidate.taskId),
        requiredSkills: PLACEMENT_AUTO_SECTIONS,
      },
    }),
  }
}

// --- Yerleştirme kararı -------------------------------------------------------------------

const rationale = z
  .string()
  .trim()
  .min(1, 'Yerleştirme gerekçesini yazın.')
  .max(2000, 'En fazla 2.000 karakter girebilirsiniz.')

/**
 * Yerleştirme kararı gövdesi (DOM-DIL-010): genel seviye zorunlu, beceri seviyeleri isteğe bağlı,
 * gerekçe her zaman zorunlu (öneriyle aynı seviye seçilse bile).
 */
export const placementDecisionInputSchema = z.object({
  sessionId: identifier,
  level: cefrLevel,
  skillLevels: z
    .array(z.object({ skill: z.enum(SECTION_KEYS), level: cefrLevel }))
    .max(SECTION_KEYS.length)
    .refine((list) => new Set(list.map((s) => s.skill)).size === list.length, {
      error: 'Her beceri bir kez seçilir.',
    })
    .default([]),
  // kvkk: K
  rationale,
})
export type PlacementDecisionInput = z.input<typeof placementDecisionInputSchema>

/** Yerleştirme kararının satırı (kimlik serviste). */
export type PlacementDecisionDraft = Omit<LevelDecisionRow, 'id'> & {
  kind: 'placement'
  learnerKind: LearnerKind
  learnerId: string
  placementSessionId: string
}

/** Kararı veren kişi. */
export type PlacementDecider = {
  // kvkk: K
  userId: string
  role: Role
}

/**
 * Yerleştirme kararı (DOM-DIL-010, 011, 012): öğretmen veya akademik koordinatör gerekçeyle
 * seviyeyi seçer; öneriden farklı olabilir. Kesin yerleştirme yalnız kurumda yapılmış, bitmiş,
 * geçerli ve yazma ile konuşma bölümleri puanlanmış oturuma dayanır; uzaktan tespit ön tespittir.
 * Oturum başına bir yerleştirme kararı verilir; yanlış yerleştirme düzeltmesi ayrı karar türüdür
 * (`correction`, DOM-DIL-072). Her satır karar anının önerisini kopya olarak taşır (karar 5).
 */
export function planPlacementDecision(input: {
  institutionType: InstitutionType
  session: PlacementSessionRow
  sections: readonly PlacementSectionRow[]
  otherEvidence?: readonly EvidenceCandidate[]
  /** Bu oturuma bağlı mevcut yerleştirme kararları. */
  existingDecisions: readonly Pick<PlacementDecisionDraft, 'placementSessionId'>[]
  decider: PlacementDecider
  input: unknown
  now: Instant
}): {
  decisions: PlacementDecisionDraft[]
  snapshot: EvidenceSnapshot
  differsFromSuggestion: boolean
} {
  assertLanguageSchool(input.institutionType)
  if (!(PLACEMENT_DECIDER_ROLES as readonly Role[]).includes(input.decider.role)) {
    throw new DomainError(
      'permission_denied',
      'Yerleştirme kararını öğretmen veya akademik koordinatör verir.',
      { kind: 'forbidden' },
    )
  }
  const data = placementDecisionInputSchema.parse(input.input)
  const { session } = input
  if (data.sessionId !== session.id) {
    throw new DomainError('placement_not_found', 'Seviye tespiti bulunamadı.', {
      kind: 'not_found',
      path: ['sessionId'],
    })
  }
  const validity = placementValidity(session, input.now)
  if (validity.status === 'in_progress') {
    throw new DomainError('placement_incomplete', 'Seviye tespiti henüz bitmedi.', {
      kind: 'conflict',
    })
  }
  if (validity.preliminary) {
    throw new DomainError(
      'placement_preliminary',
      'Uzaktan yapılan tespit ön tespittir; kesin yerleştirme için kurumda konuşma görüşmesi ve gözetimli yazma görevi gerekir.',
    )
  }
  if (validity.status === 'expired') {
    throw new DomainError(
      'placement_expired',
      'Seviye tespiti sonucunun 90 günlük geçerliliği doldu; yeniden tespit gerekir.',
    )
  }
  const sections = placementSectionResults(input.sections)
  const unscored = sections.find(
    (s) => PLACEMENT_SECTIONS[s.section].scoring === 'rubric' && s.status !== 'scored',
  )
  if (unscored !== undefined) {
    throw new DomainError(
      'placement_production_missing',
      'Yerleştirme için yazma ve konuşma bölümleri puanlanmış olmalıdır.',
      { path: ['sections', unscored.section] },
    )
  }
  if (input.existingDecisions.some((d) => d.placementSessionId === session.id)) {
    throw new DomainError(
      'placement_already_decided',
      'Bu tespit için yerleştirme kararı verildi; değişiklik düzeltme kararıyla yapılır.',
      { kind: 'conflict' },
    )
  }
  const summary = placementSummary({
    session,
    sections: input.sections,
    ...(input.otherEvidence === undefined ? {} : { otherEvidence: input.otherEvidence }),
    now: input.now,
  })
  const snapshot = evidenceSnapshotOf(summary.suggestion)
  const decidedAt = toIso(toMs(input.now))
  const draft = (skill: PrimarySkill | null, level: CefrLevel): PlacementDecisionDraft => ({
    kind: 'placement',
    learnerKind: session.learnerKind,
    learnerId: session.learnerId,
    placementSessionId: session.id,
    skill,
    level,
    rationale: data.rationale,
    decidedByUserId: input.decider.userId,
    decidedAt,
    evidenceSnapshot: snapshot,
  })
  const { overall } = summary.suggestion
  return {
    decisions: [
      draft(null, data.level),
      ...data.skillLevels.map((entry) => draft(entry.skill, entry.level)),
    ],
    snapshot,
    differsFromSuggestion: overall.status !== 'suggested' || overall.level !== data.level,
  }
}

// --- Bölüm girişi ve bitiş ----------------------------------------------------------------

/** Otomatik puanlanan bölümler: cevaplar formun o bölümdeki sorularıyla puanlanır. */
export const PLACEMENT_ANSWER_SECTIONS = [
  'language_use',
  'reading',
  'listening',
] as const satisfies readonly PlacementSection[]
/** Rubrikle puanlanan bölümler: koordinatör ya da öğretmen kriter bantlarını girer. */
export const PLACEMENT_RUBRIC_SECTIONS = [
  'writing',
  'speaking',
] as const satisfies readonly PlacementSection[]

const rowVersion = z.number().int().min(1).max(2_147_483_647)
const instant = z.iso.datetime({ error: 'Geçerli bir tarih ve saat girin.' })
const rubricCriteria = rubricScoreInputSchema.shape.criteria

/**
 * Bölüm girişi gövdesi (DOM-DIL-010, IST-058). `version` oturumun satır sürümüdür (iyimser kilit).
 * Otomatik bölüm cevapları taşır; puan sunucuda formun anahtarıyla hesaplanır, istemcinin puanı
 * alınmaz. Rubrikli bölüm rubrik sürümünü, üretim görevinin hedef seviyesini ve kriter bantlarını
 * taşır; toplam sunucuda hesaplanır.
 */
export const placementScoreInputSchema = z.discriminatedUnion('section', [
  z.strictObject({
    version: rowVersion,
    section: z.enum(PLACEMENT_ANSWER_SECTIONS),
    // kvkk: Ç (kursiyerin ölçme cevapları; loglanmaz)
    answers: answersSchema,
  }),
  z.strictObject({
    version: rowVersion,
    section: z.enum(PLACEMENT_RUBRIC_SECTIONS),
    rubricVersionId: identifier,
    targetLevel: cefrLevel,
    // kvkk: Ç (kursiyerin üretim değerlendirmesi; loglanmaz)
    criteria: rubricCriteria,
  }),
])
export type PlacementScoreInput = z.input<typeof placementScoreInputSchema>

/**
 * Oturumda saklanan bölüm girişi (`placement_sessions.section_entries`). Puan saklanmaz (ADR 0004
 * karar 5): otomatik bölümde cevaplar, rubrikli bölümde bantlar durur; sonuç her okumada formun
 * anahtarı ve rubrik sürümüyle hesaplanır (`placementSectionRow`).
 */
export const placementSectionEntrySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('auto'),
    section: z.enum(PLACEMENT_ANSWER_SECTIONS),
    // kvkk: Ç
    answers: answersSchema,
    // kvkk: K
    enteredByUserId: identifier,
    enteredAt: instant,
  }),
  z.object({
    mode: z.literal('rubric'),
    section: z.enum(PLACEMENT_RUBRIC_SECTIONS),
    rubricVersionId: identifier,
    targetLevel: cefrLevel,
    // kvkk: Ç
    criteria: rubricCriteria,
    // kvkk: K
    enteredByUserId: identifier,
    enteredAt: instant,
  }),
])
export type PlacementSectionEntry = z.output<typeof placementSectionEntrySchema>

/**
 * Bölümün puanlama bağlamı (servis yükler): otomatik bölümde formun o bölümdeki maddeleri ve
 * bölümün hedef seviyesi, rubrikli bölümde girişin rubrik sürümü.
 */
export type PlacementSectionScoring =
  | { mode: 'auto'; items: readonly ScoringItem[]; targetLevel: CefrLevel | null }
  | { mode: 'rubric'; rubric: Pick<RubricVersionData, 'criteria'> }

/**
 * Otomatik bölümün hedef seviyesi: bölüm sorularının ortak CEFR seviyesi. Sorular farklı
 * seviyelerdeyse ya da seviyesizse bölüm kanıt olamaz (`no_target_level`).
 */
// TODO(cefr-tespit-bolum-seviyesi): Çok seviyeli tespit formunda bölümün hangi seviyeyi
// gösterdiği (soru seviyesine göre ayrı tally) domain'de tanımlı değil; en muhafazakâr yorumla
// karışık seviyeli bölüm seviye kanıtı sayılmaz.
export function placementSectionLevel(levels: readonly (CefrLevel | null)[]): CefrLevel | null {
  const distinct = new Set(levels)
  const [only] = distinct
  return distinct.size === 1 && only !== undefined ? only : null
}

function assertDecider(decider: PlacementDecider, message: string): void {
  if (!(PLACEMENT_DECIDER_ROLES as readonly Role[]).includes(decider.role)) {
    throw new DomainError('permission_denied', message, { kind: 'forbidden' })
  }
}

function assertCriteriaFit(
  rubric: Pick<RubricVersionData, 'criteria'>,
  criteria: readonly { criterionId: string }[],
): void {
  const known = new Set(rubric.criteria.map((c) => c.id))
  const seen = new Set<string>()
  criteria.forEach((entry, index) => {
    if (!known.has(entry.criterionId) || seen.has(entry.criterionId)) {
      throw new DomainError(
        'rubric_criterion_invalid',
        'Kriter bu rubrikte yok veya tekrar ediyor.',
        {
          path: ['criteria', String(index), 'criterionId'],
        },
      )
    }
    seen.add(entry.criterionId)
  })
}

/**
 * Bölüm girişi (DOM-DIL-010, IST-058): dil kullanımı, okuma ve dinleme cevaplarla, yazma ve
 * konuşma rubrikle; girişi öğretmen ya da akademik koordinatör yapar. Her bölüm bir kez girilir;
 * otomatik bölüm yalnız süren oturuma, rubrikli bölüm yerleştirme kararına kadar girilir (yazma ve
 * konuşma oturum bittikten sonra puanlanabilir). Cevaplar formun o bölümdeki sorularına uymalıdır.
 */
export function planPlacementSectionEntry(input: {
  institutionType: InstitutionType
  session: PlacementSessionRow
  entries: readonly PlacementSectionEntry[]
  /** Oturuma yerleştirme kararı verildi mi. */
  decided: boolean
  scorer: PlacementDecider
  scoring: PlacementSectionScoring
  input: unknown
  now: Instant
}): PlacementSectionEntry {
  assertLanguageSchool(input.institutionType)
  assertDecider(input.scorer, 'Tespit bölümünü öğretmen veya akademik koordinatör puanlar.')
  const data = placementScoreInputSchema.parse(input.input)
  if (input.decided) {
    throw new DomainError(
      'placement_already_decided',
      'Bu tespit için yerleştirme kararı verildi; bölüm puanı değişmez.',
      { kind: 'conflict' },
    )
  }
  if (input.entries.some((entry) => entry.section === data.section)) {
    throw new DomainError('placement_section_scored', 'Bu bölüm daha önce puanlandı.', {
      kind: 'conflict',
      path: ['section'],
    })
  }
  const enteredAt = toIso(toMs(input.now))
  const enteredByUserId = input.scorer.userId
  if ('answers' in data) {
    if (input.session.completedAt !== null) {
      throw new DomainError(
        'placement_completed',
        'Seviye tespiti bitti; otomatik bölüm cevapları eklenemez.',
        { kind: 'conflict' },
      )
    }
    if (input.scoring.mode !== 'auto' || input.scoring.items.length === 0) {
      throw new DomainError('placement_section_empty', 'Tespit formunda bu bölüm yok.', {
        path: ['section'],
      })
    }
    assertResponsesFit(input.scoring.items, data.answers)
    return {
      mode: 'auto',
      section: data.section,
      answers: data.answers,
      enteredByUserId,
      enteredAt,
    }
  }
  if (input.scoring.mode !== 'rubric') {
    throw new DomainError(
      'placement_section_mismatch',
      'Bölümün puanlama türü sonuçla uyuşmuyor.',
      {
        path: ['section'],
      },
    )
  }
  assertCriteriaFit(input.scoring.rubric, data.criteria)
  rubricScore(input.scoring.rubric, data.criteria)
  return {
    mode: 'rubric',
    section: data.section,
    rubricVersionId: data.rubricVersionId,
    targetLevel: data.targetLevel,
    criteria: data.criteria,
    enteredByUserId,
    enteredAt,
  }
}

/**
 * Girişin bölüm sonucu satırı (`PlacementSectionRow`): otomatik bölümde `scoreAttempt`, rubrikli
 * bölümde `rubricScore`; her okumada hesaplanır. Sonuç kimliği oturum ve bölümdür.
 */
export function placementSectionRow(
  sessionId: string,
  entry: PlacementSectionEntry,
  scoring: PlacementSectionScoring,
): PlacementSectionRow {
  const resultId = `${sessionId}:${entry.section}`
  if (entry.mode === 'auto') {
    if (scoring.mode !== 'auto') throw new Error('placement section scoring mismatch')
    const score = scoreAttempt(scoring.items, entry.answers)
    return {
      section: entry.section,
      resultId,
      targetLevel: scoring.targetLevel,
      result: {
        mode: 'auto',
        score: { ratio: score.ratio, percent: score.percent, items: score.items },
      },
    }
  }
  if (scoring.mode !== 'rubric') throw new Error('placement section scoring mismatch')
  const score = rubricScore(scoring.rubric, entry.criteria)
  return {
    section: entry.section,
    resultId,
    targetLevel: entry.targetLevel,
    result: { mode: 'rubric', score: { percent: score.percent, criteria: score.criteria } },
  }
}

/**
 * Oturumu bitirir (DOM-DIL-010, 012): bitiş anı sunucu saatidir ve 90 günlük geçerlilik ondan
 * sayılır. Yalnız süren oturum biter; bitiren öğretmen ya da akademik koordinatördür.
 */
export function planPlacementCompletion(input: {
  institutionType: InstitutionType
  session: PlacementSessionRow
  decider: PlacementDecider
  now: Instant
}): { completedAt: string } {
  assertLanguageSchool(input.institutionType)
  assertDecider(input.decider, 'Seviye tespitini öğretmen veya akademik koordinatör bitirir.')
  if (input.session.completedAt !== null) {
    throw new DomainError('placement_completed', 'Seviye tespiti zaten bitti.', {
      kind: 'conflict',
    })
  }
  return { completedAt: toIso(toMs(input.now)) }
}
