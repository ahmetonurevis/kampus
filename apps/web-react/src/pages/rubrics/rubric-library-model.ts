import type {
  RubricBody,
  RubricDetail,
  RubricListItem,
  RubricListQuery,
  RubricVersion,
} from '@kampus/react-shared/use-rubrics.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import {
  CEFR_LEVELS,
  OUTCOME_SOURCES,
  SKILLS,
  type CefrLevel,
  type OutcomeSource,
} from '@kampus/school-core/content/taxonomy.ts'
import {
  assertRubricFitsInstitution,
  BAND_MEANINGS,
  BAND_SCALE,
  bandMeaning,
  HOLISTIC_ASPECT,
  RUBRIC_ASPECTS,
  RUBRIC_KINDS,
  RUBRIC_SKILLS,
  RUBRIC_VERSION_STATUSES,
  rubricVersionInputSchema,
  WEIGHT_LIMITS,
  type BandAlignment,
  type RubricKind,
  type RubricSkill,
  type RubricVersionStatus,
} from '@kampus/school-core/skills/rubric.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { aspectLabel } from '../tasks/task-model.ts'

/**
 * Rubrik kütüphanesi ekranının saf modeli (OG-083; IST-048, DOM-BEC-020, DOM-BEC-021,
 * DOM-BEC-022): liste satırı ve sorgusu, ayrıntının sürüm/eylem türetmesi, form değerleri ile core
 * gövdesi arasındaki dönüşüm. Doğrulama core `rubricVersionInputSchema` ve
 * `assertRubricFitsInstitution` ile yapılır; hata yolları form alanına çevrilir.
 */

export { aspectLabel }

const option = <T extends string>(value: T, label: string) => ({ value, label })

export const KIND_OPTIONS = (Object.keys(RUBRIC_KINDS) as RubricKind[]).map((kind) =>
  option(kind, RUBRIC_KINDS[kind].label),
)
export const SKILL_OPTIONS = RUBRIC_SKILLS.map((skill) => option(skill, SKILLS[skill].label))
export const STATUS_OPTIONS = (Object.keys(RUBRIC_VERSION_STATUSES) as RubricVersionStatus[]).map(
  (status) => option(status, RUBRIC_VERSION_STATUSES[status].label),
)
export const CEFR_LEVEL_OPTIONS = (Object.keys(CEFR_LEVELS) as CefrLevel[]).map((level) =>
  option(level, CEFR_LEVELS[level].label),
)
export const OUTCOME_SOURCE_OPTIONS = (Object.keys(OUTCOME_SOURCES) as OutcomeSource[]).map(
  (source) => option(source, OUTCOME_SOURCES[source].label),
)

export const STATUS_TONES: Record<RubricVersionStatus, BadgeTone> = {
  draft: 'amber',
  published: 'green',
  archived: 'gray',
}

export const kindLabel = (kind: RubricKind) => RUBRIC_KINDS[kind].label
export const skillLabel = (skill: RubricSkill) => SKILLS[skill].label
export const statusLabel = (status: RubricVersionStatus) => RUBRIC_VERSION_STATUSES[status].label

/** Bantlar küçükten büyüğe (0–5); anlamı DOM-BEC-020 bant ölçeğinden. */
export const BANDS = Array.from(
  { length: BAND_SCALE.max - BAND_SCALE.min + 1 },
  (_, index) => BAND_SCALE.min + index,
)
export const bandTitle = (band: number) =>
  `Bant ${band} · ${BAND_MEANINGS[bandMeaning(band)].label}`

// --- Liste ---------------------------------------------------------------------------------

export type RubricRow = {
  id: string
  title: string
  skill: string
  kind: string
  version: string
  status: string
  statusKey: RubricVersionStatus
  /** Yayındaki sürüm baş sürüm değilse (yeni taslak açıkken) ayrıca belirtilir. */
  published: string
  updatedAt: string
  canManage: boolean
}

export function rubricRow(item: RubricListItem): RubricRow {
  const { head } = item
  const published =
    item.publishedVersionId === null
      ? 'Yok'
      : item.publishedVersionId === head.id
        ? 'Bu sürüm'
        : 'Önceki sürüm'
  return {
    id: item.rubric.id,
    title: head.title,
    skill: skillLabel(head.skill),
    kind: kindLabel(head.kind),
    version: `v${head.versionNumber}`,
    status: statusLabel(head.status),
    statusKey: head.status,
    published,
    updatedAt: head.updatedAt,
    canManage: item.rubric.canManage,
  }
}

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value)

/** API başlık araması üst sınırı (`rubricListQuerySchema`). */
const SEARCH_MAX = 100

/** Liste durumundan sunucu sorgusu: süzgeçler beyaz listede, arama 2–100 karakter. */

export function rubricListQuery(input: {
  page: number
  pageSize: number
  q: string
  filters: Readonly<Record<string, unknown>>
  userId: string
}): RubricListQuery {
  const { filters } = input
  const q = input.q.trim().slice(0, SEARCH_MAX).trimEnd()
  const skill = filters.skill
  const kind = filters.kind
  const status = filters.status
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(q.length >= 2 ? { q } : {}),
    ...(isOneOf(RUBRIC_SKILLS, skill) ? { skill } : {}),
    ...(isOneOf(Object.keys(RUBRIC_KINDS) as RubricKind[], kind) ? { kind } : {}),
    ...(isOneOf(Object.keys(RUBRIC_VERSION_STATUSES) as RubricVersionStatus[], status)
      ? { status }
      : {}),
    ...(filters.mine === 'yes' && input.userId !== '' ? { ownerUserId: input.userId } : {}),
  }
}

// --- Ayrıntı -------------------------------------------------------------------------------

/** Ağırlıkların yüzde payı (gösterim; puan sunucuda `rubricScore` ile hesaplanır, DOM-BEC-021). */
export function weightShares(weights: readonly number[]): number[] {
  const valid = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0))
  const total = valid.reduce((sum, weight) => sum + weight, 0)
  return valid.map((weight) => (total === 0 ? 0 : Math.round((weight / total) * 100)))
}

export function alignmentLabel(alignment: BandAlignment): string {
  switch (alignment.kind) {
    case 'cefr':
      return `CEFR ${alignment.level} · ${alignment.scale} · ${alignment.index}. tanımlayıcı`
    case 'outcome':
      return `Kazanım ${alignment.outcomeId} · ${OUTCOME_SOURCES[alignment.outcomeSource].label}`
    default:
      return alignment satisfies never
  }
}

const sameAlignment = (a: BandAlignment, b: BandAlignment) =>
  JSON.stringify(a) === JSON.stringify(b)

/** Kriterin bütün bantları aynı tanımlayıcıya bağlıysa onun etiketi, değilse `null`. */
export function sharedAlignment(
  criterion: RubricVersion['criteria'][number],
): BandAlignment | null {
  const [first, ...rest] = criterion.bands
  if (!first) return null
  return rest.every((band) => sameAlignment(band.alignment, first.alignment))
    ? first.alignment
    : null
}

/** Sürümün kullanımı: sabitlendiği görev ve verilmiş puan (değişmezlik nedeni, DOM-BEC-022). */
export function usageLabel(usage: RubricVersion['usage']): string {
  if (usage.assignmentCount === 0 && usage.scoreCount === 0) return 'Henüz görevde kullanılmadı'
  return `${usage.assignmentCount} görevde kullanılıyor · ${usage.scoreCount} puan`
}

/** Bütün sürümlerin sabitlendiği görev sayısı (aynı rubrik birçok görevde, IST-048). */
export const totalAssignments = (versions: readonly RubricVersion[]) =>
  versions.reduce((sum, version) => sum + version.usage.assignmentCount, 0)

export type RubricActions = {
  head: RubricVersion | null
  draft: RubricVersion | null
  published: RubricVersion | null
  /** Taslak kullanılmamışsa düzenlenir (DOM-BEC-022). */
  canEditDraft: boolean
  canPublish: boolean
  canArchive: boolean
  /** Açık taslak yoksa yeni sürüm açılır (tek açık taslak, DOM-BEC-022). */
  canOpenVersion: boolean
}

/**
 * Eylemler: yalnız sahip ve yönetici (`canManage`, sunucu `canManageRubric`). Taslak düzenleme
 * ve yayım tek açık taslağa, arşiv yayındaki sürüme yöneliktir. Sunucu aynı kuralları yeniden
 * uygular; burada yalnız düğmelerin görünürlüğü vardır.
 */
export function rubricActions(detail: RubricDetail): RubricActions {
  const versions = detail.versions
  const head = versions.reduce<RubricVersion | null>(
    (latest, version) =>
      latest === null || version.versionNumber > latest.versionNumber ? version : latest,
    null,
  )
  const draft = versions.find((version) => version.status === 'draft') ?? null
  const published = versions.find((version) => version.status === 'published') ?? null
  const manage = detail.rubric.canManage
  const unused = (version: RubricVersion) =>
    version.usage.assignmentCount === 0 && version.usage.scoreCount === 0
  return {
    head,
    draft,
    published,
    canEditDraft: manage && draft !== null && unused(draft),
    canPublish: manage && draft !== null,
    canArchive: manage && published !== null,
    canOpenVersion: manage && draft === null && head !== null,
  }
}

/** Sürüm geçmişi: yeniden eskiye. */
export const versionHistory = (versions: readonly RubricVersion[]) =>
  [...versions].sort((a, b) => b.versionNumber - a.versionNumber)

// --- Form ----------------------------------------------------------------------------------

export type AlignmentForm = {
  kind: BandAlignment['kind']
  scale: string
  level: CefrLevel
  index: number
  outcomeId: string
  outcomeSource: OutcomeSource
}

export type CriterionForm = {
  aspect: string
  weight: number
  /** Kriterin eşlemesi; altı banda yazılır. */
  alignment: AlignmentForm
  /**
   * Yüklenen sürümde bantlar farklı tanımlayıcılara bağlıysa bant başına eşlemeler korunur;
   * kriterin eşlemesi değişince `null` olur ve altı bant kriterinkini alır.
   */
  bandAlignments: BandAlignment[] | null
  bands: { description: string }[]
}

export type RubricFormValues = {
  title: string
  kind: RubricKind
  skill: RubricSkill
  criteria: CriterionForm[]
}

export const MAX_CRITERIA = 10

export const defaultAlignment = (): AlignmentForm => ({
  kind: 'cefr',
  scale: '',
  level: 'B1',
  index: 1,
  outcomeId: '',
  outcomeSource: 'platform',
})

const emptyBands = () => BANDS.map(() => ({ description: '' }))

const blankCriterion = (aspect: string): CriterionForm => ({
  aspect,
  weight: WEIGHT_LIMITS.default,
  alignment: defaultAlignment(),
  bandAlignments: null,
  bands: emptyBands(),
})

/** Becerinin niteliksel yönleri (DOM-BEC-020); bütüncül rubrikte yalnız genel kriter. */
export function aspectOptions(skill: RubricSkill, kind: RubricKind) {
  if (kind === 'holistic') return [option(HOLISTIC_ASPECT, aspectLabel(HOLISTIC_ASPECT))]
  return Object.keys(RUBRIC_ASPECTS[skill]).map((aspect) => option(aspect, aspectLabel(aspect)))
}

/** Henüz kullanılmayan ilk niteliksel yön; kalmadıysa `null`. */
export function nextAspect(skill: RubricSkill, used: readonly string[]): string | null {
  return Object.keys(RUBRIC_ASPECTS[skill]).find((aspect) => !used.includes(aspect)) ?? null
}

/** Yeni rubrik: analitik yazma rubriği, ilk iki niteliksel yönle. */
export function defaultRubricForm(): RubricFormValues {
  const skill: RubricSkill = 'writing'
  const [first = '', second = ''] = Object.keys(RUBRIC_ASPECTS[skill])
  return {
    title: '',
    kind: 'analytic',
    skill,
    criteria: [blankCriterion(first), blankCriterion(second)],
  }
}

/** Kriter ekler (analitik, en çok 10, kullanılmayan ilk yönle); ekleyemezse aynı değerler. */
export function withAddedCriterion(values: RubricFormValues): RubricFormValues {
  if (values.kind === 'holistic' || values.criteria.length >= MAX_CRITERIA) return values
  const aspect = nextAspect(
    values.skill,
    values.criteria.map((criterion) => criterion.aspect),
  )
  if (aspect === null) return values
  return { ...values, criteria: [...values.criteria, blankCriterion(aspect)] }
}

/** Tür değişince kriterler türün kuralına uyarlanır; yazılmış bant tanımları korunur. */
export function withKind(values: RubricFormValues, kind: RubricKind): RubricFormValues {
  if (kind === values.kind) return values
  const [first = blankCriterion(HOLISTIC_ASPECT)] = values.criteria
  if (kind === 'holistic') {
    return {
      ...values,
      kind,
      criteria: [{ ...first, aspect: HOLISTIC_ASPECT, weight: WEIGHT_LIMITS.default }],
    }
  }
  const [aspect = '', second = ''] = Object.keys(RUBRIC_ASPECTS[values.skill])
  return {
    ...values,
    kind,
    criteria: [{ ...first, aspect }, blankCriterion(second)],
  }
}

/** Beceri değişince bu beceride olmayan yönler kullanılmayan yönlerle değiştirilir. */
export function withSkill(values: RubricFormValues, skill: RubricSkill): RubricFormValues {
  if (values.kind === 'holistic') return { ...values, skill }
  const allowed = Object.keys(RUBRIC_ASPECTS[skill])
  const kept = values.criteria
    .map((criterion) => criterion.aspect)
    .filter((aspect) => allowed.includes(aspect))
  const criteria = values.criteria
    .map((criterion) => {
      if (allowed.includes(criterion.aspect)) return criterion
      const aspect = nextAspect(skill, kept)
      if (aspect === null) return null
      kept.push(aspect)
      return { ...criterion, aspect }
    })
    .filter((criterion): criterion is CriterionForm => criterion !== null)
  return { ...values, skill, criteria }
}

const alignmentForm = (alignment: BandAlignment): AlignmentForm => ({
  ...defaultAlignment(),
  ...alignment,
})

/** Var olan sürümden form (taslak düzenleme ve yeni sürüm aynı içerikle başlar). */
export function formFromVersion(version: RubricVersion): RubricFormValues {
  return {
    title: version.title,
    kind: version.kind,
    skill: version.skill,
    criteria: version.criteria.map((criterion) => {
      const bands = [...criterion.bands].sort((a, b) => a.band - b.band)
      const shared = sharedAlignment(criterion)
      const first = bands[0]?.alignment
      return {
        aspect: criterion.aspect,
        weight: criterion.weight,
        alignment: first ? alignmentForm(first) : defaultAlignment(),
        bandAlignments: shared === null ? bands.map((band) => band.alignment) : null,
        bands: BANDS.map((band) => ({
          description: bands.find((entry) => entry.band === band)?.description ?? '',
        })),
      }
    }),
  }
}

function toAlignment(form: AlignmentForm): BandAlignment {
  return form.kind === 'outcome'
    ? { kind: 'outcome', outcomeId: form.outcomeId, outcomeSource: form.outcomeSource }
    : { kind: 'cefr', scale: form.scale, level: form.level, index: form.index }
}

/**
 * Formdan gövde: kriter kimliği niteliksel yöndür (sürümde her yön bir kez geçer, DOM-BEC-020);
 * bant numarası sıradan, eşleme kriterinkinden (korunmuş bant eşlemesi varsa ondan).
 */
export function rubricBodyFromForm(values: RubricFormValues) {
  return {
    title: values.title,
    kind: values.kind,
    skill: values.skill,
    criteria: values.criteria.map((criterion) => ({
      id: criterion.aspect,
      aspect: criterion.aspect,
      weight: criterion.weight,
      bands: criterion.bands.map((band, index) => ({
        band: BANDS[index] ?? index,
        description: band.description,
        alignment: criterion.bandAlignments?.[index] ?? toAlignment(criterion.alignment),
      })),
    })),
  }
}

const ALIGNMENT_FIELDS = new Set(['scale', 'level', 'index', 'outcomeId', 'outcomeSource'])

/**
 * Core (ve sunucu) hata yolunu form alanına çevirir: bant eşlemesi kriterin eşleme alanına,
 * kriter kimliği niteliksel yöne, liste düzeyi hata `criteria.root`'a düşer.
 */
export function formFieldFor(path: readonly (string | number)[]): string {
  const [head, index, field, band, sub, leaf] = path.map(String)
  if (head === 'title' || head === 'kind' || head === 'skill') return head
  if (head !== 'criteria') return 'root.server'
  if (index === undefined || !/^\d+$/.test(index)) return 'criteria.root'
  const at = `criteria.${index}`
  if (field === 'aspect' || field === 'id') return `${at}.aspect`
  if (field === 'weight') return `${at}.weight`
  if (field === 'bands' && band !== undefined && /^\d+$/.test(band)) {
    if (sub === 'description') return `${at}.bands.${band}.description`
    if (sub === 'alignment')
      return leaf !== undefined && ALIGNMENT_FIELDS.has(leaf)
        ? `${at}.alignment.${leaf}`
        : `${at}.alignment.kind`
  }
  if (field === 'bands') return `${at}.bands.0.description`
  return `${at}.aspect`
}

export type RubricFormIssue = { field: string; message: string }

export type RubricFormResult =
  { ok: true; body: RubricBody } | { ok: false; issues: RubricFormIssue[] }

type RubricAspect = RubricBody['criteria'][number]['aspect']

function narrowAspect(aspect: string): RubricAspect {
  const known =
    aspect === HOLISTIC_ASPECT || Object.values(RUBRIC_ASPECTS).some((aspects) => aspect in aspects)
  if (!known) throw new Error(`Bilinmeyen niteliksel yön: ${aspect}`)
  return aspect as RubricAspect
}

/**
 * Formu core kurallarıyla doğrular (şema + kurum türü). Aynı alana düşen ilk hata kalır; alan
 * yolları `formFieldFor` ile formdadır. Gövde core çıktısıdır (bantlar sıralı, ağırlık tamsayı).
 */
export function validateRubricForm(
  values: RubricFormValues,
  institutionType: InstitutionType,
): RubricFormResult {
  const parsed = rubricVersionInputSchema.safeParse(rubricBodyFromForm(values))
  if (!parsed.success) {
    const issues: RubricFormIssue[] = []
    for (const issue of parsed.error.issues) {
      const field = formFieldFor(issue.path.filter((key) => typeof key !== 'symbol'))
      if (!issues.some((existing) => existing.field === field))
        issues.push({ field, message: issue.message })
    }
    return { ok: false, issues }
  }
  try {
    assertRubricFitsInstitution(parsed.data, institutionType)
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    return {
      ok: false,
      issues: [{ field: formFieldFor(error.path ?? []), message: error.message }],
    }
  }
  // Core çıktısında niteliksel yön `string`'dir; şema yönü zaten sözlükten doğruladı. Tek yerde
  // daraltılır; sözlükte olmayan yön gelirse derleme değil çalışma hatası verir.
  const body = {
    ...parsed.data,
    criteria: parsed.data.criteria.map((criterion) => ({
      ...criterion,
      aspect: narrowAspect(criterion.aspect),
    })),
  } satisfies RubricBody
  return { ok: true, body }
}

// --- Form penceresi adresi -----------------------------------------------------------------

/** `?rubrik-form=` değerleri: yeni rubrik, var olan rubriğe yeni sürüm ya da taslak düzenleme. */
export const NEW_RUBRIC = 'yeni'
const VERSION_PREFIX = 'surum-'
const EDIT_PREFIX = 'duzenle-'
export const versionTarget = (rubricId: string) => `${VERSION_PREFIX}${rubricId}`
export const editTarget = (rubricId: string) => `${EDIT_PREFIX}${rubricId}`

export type RubricFormTarget =
  { mode: 'create' } | { mode: 'version' | 'edit'; rubricId: string } | null

export function parseFormTarget(target: string): RubricFormTarget {
  if (target === NEW_RUBRIC) return { mode: 'create' }
  if (target.startsWith(VERSION_PREFIX) && target.length > VERSION_PREFIX.length)
    return { mode: 'version', rubricId: target.slice(VERSION_PREFIX.length) }
  if (target.startsWith(EDIT_PREFIX) && target.length > EDIT_PREFIX.length)
    return { mode: 'edit', rubricId: target.slice(EDIT_PREFIX.length) }
  return null
}
