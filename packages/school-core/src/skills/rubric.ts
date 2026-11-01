import { z } from 'zod'
import { DomainError } from '../lib/errors.ts'
import type { Actor } from '../lib/scope.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { ContentActor, RandomSource } from '../content/resource.ts'
import { CEFR_LEVELS, OUTCOME_SOURCES, enumKeys } from '../content/taxonomy.ts'
import { istanbulLocalToUtc, type Deadline, type TaskKind } from './scoring.ts'
import { assertGradableVersion, type VersionRow } from './submission.ts'

/**
 * Rubrik ve öğretmen puanlaması: rubrik şeması, puan hesabı, sürüm, ikinci puanlayıcı ve
 * uyuşmazlık, puanlama süresi ve itiraz (docs/domain/beceri-gelisimi.md DOM-BEC-020…025;
 * ADR 0004 karar 5, 6, 7).
 *
 * Satırlar: `rubrics` + `rubric_versions` (sürümlü, kullanılmış sürüm yalnız arşivlenir),
 * `rubric_scores` (teslim sürümü × puanlayıcı rolü: `first`/`second`/`final`) ve itiraz satırı.
 * Fonksiyonlar saftır, `now` alır ve yazılacak satırı döndürür; kimlik ve yazma servistedir.
 * Rubrik toplamı, 100'lük puan ve son puan seçimi saklanmaz, her okumada buradan hesaplanır.
 */

z.config(z.locales.tr())

const identifier = z.string().trim().min(1, 'Bir kayıt seçin.').max(200)
const itemId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, 'Kimlik yalnız harf, rakam, - ve _ içerebilir.')
const text = (max: number, required: string, min = 1) =>
  z
    .string()
    .trim()
    .min(min, required)
    .max(max, `En fazla ${max.toLocaleString('tr-TR')} karakter girebilirsiniz.`)

type Instant = Date | string
const toMs = (value: Instant) => (typeof value === 'string' ? Date.parse(value) : value.getTime())
const toIso = (ms: number) => new Date(ms).toISOString()
const DAY = 24 * 60 * 60_000

// --- Sözlük -------------------------------------------------------------------------------

/** Rubrik türü (IST-048): analitik kriter başına, bütüncül tek genel ölçekle puanlar. */
export const RUBRIC_KINDS = {
  analytic: { label: 'Analitik' },
  holistic: { label: 'Bütüncül' },
} as const
export type RubricKind = keyof typeof RUBRIC_KINDS

/**
 * Kriterler CEFR-CV niteliksel yönlerinden seçilir (DOM-BEC-020). Bütüncül rubrik tek `overall`
 * kriteri taşır.
 */
export const RUBRIC_ASPECTS = {
  writing: {
    task_fulfilment: { label: 'Görevin yerine getirilmesi' },
    coherence_cohesion: { label: 'Tutarlılık ve bağdaşıklık' },
    vocabulary: { label: 'Sözcük dağarcığı' },
    grammatical_accuracy: { label: 'Dilbilgisel doğruluk' },
  },
  speaking: {
    range: { label: 'Kapsam' },
    accuracy: { label: 'Doğruluk' },
    fluency: { label: 'Akıcılık' },
    interaction: { label: 'Etkileşim' },
    coherence: { label: 'Tutarlılık' },
    phonological_control: { label: 'Sesbilgisel denetim' },
  },
  mediation: {
    meaning_transfer: { label: 'Kaynak anlamın aktarımı' },
    audience_fit: { label: 'Hedef kitleye uygunluk' },
    language: { label: 'Dil' },
  },
} as const
/** Rubrikle puanlanan beceriler (DOM-BEC-020, 023). */
export type RubricSkill = keyof typeof RUBRIC_ASPECTS
export const RUBRIC_SKILLS = enumKeys(RUBRIC_ASPECTS) as [RubricSkill, ...RubricSkill[]]
// TODO(beceri-butuncul-rubrik): Domain yalnız analitik kriterleri sayıyor; bütüncül rubrik tek
// genel kriterle (CEFR-CV genel ölçekleri) yorumlandı.
export const HOLISTIC_ASPECT = 'overall'
const ASPECT_KEYS = [
  HOLISTIC_ASPECT,
  ...new Set(RUBRIC_SKILLS.flatMap((skill) => Object.keys(RUBRIC_ASPECTS[skill]))),
] as [string, ...string[]]

/** Bant ölçeği (DOM-BEC-020): 0–5; 3 hedef seviyede, 4–5 hedefin üstünde, 0–2 hedefin altında. */
export const BAND_SCALE = { min: 0, max: 5, target: 3 } as const
export const BAND_MEANINGS = {
  below: { label: 'Hedefin altında' },
  target: { label: 'Hedef seviyede' },
  above: { label: 'Hedefin üstünde' },
} as const
export type BandMeaning = keyof typeof BAND_MEANINGS
const BAND_COUNT = BAND_SCALE.max - BAND_SCALE.min + 1

export function bandMeaning(band: number): BandMeaning {
  if (band < BAND_SCALE.target) return 'below'
  return band === BAND_SCALE.target ? 'target' : 'above'
}

/**
 * Kriter ağırlığı (ADR 0004 karar 7). Göreli tamsayıdır: hepsi 1 iken puan DOM-BEC-021'deki
 * "bant toplamı / azami bant toplamı" formülüne eşittir.
 */
export const WEIGHT_LIMITS = { default: 1, min: 1, max: 10 } as const

const band = z
  .number()
  .int()
  .min(BAND_SCALE.min, 'Bant 0–5 arasında olmalıdır.')
  .max(BAND_SCALE.max, 'Bant 0–5 arasında olmalıdır.')

// --- Rubrik şeması ------------------------------------------------------------------------

/**
 * Bant tanımının bağlandığı tanımlayıcı (DOM-BEC-004): CEFR tanımlayıcısı kimliğiyle (ölçek,
 * seviye, sıra) anılır, metni çoğaltılmaz; ya da kazanım (`school`, IST-048).
 */
export const bandAlignmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cefr'),
    scale: text(200, 'CEFR ölçeğini seçin.'),
    level: z.enum(enumKeys(CEFR_LEVELS)),
    index: z.number().int().min(1).max(200),
  }),
  z.object({
    kind: z.literal('outcome'),
    outcomeId: identifier,
    outcomeSource: z.enum(enumKeys(OUTCOME_SOURCES)),
  }),
])
export type BandAlignment = z.output<typeof bandAlignmentSchema>

const bandSchema = z.object({
  band,
  /** Kurumun kendi cümlesi (DOM-BEC-004); tanımlayıcı metni buraya kopyalanmaz. */
  description: text(1000, 'Bant tanımını yazın.', 3),
  alignment: bandAlignmentSchema,
})

const criterionSchema = z.object({
  id: itemId,
  aspect: z.enum(ASPECT_KEYS),
  weight: z
    .number()
    .int()
    .min(WEIGHT_LIMITS.min, 'Ağırlık en az 1 olmalıdır.')
    .max(WEIGHT_LIMITS.max, 'Ağırlık en fazla 10 olabilir.')
    .default(WEIGHT_LIMITS.default),
  bands: z
    .array(bandSchema)
    .length(BAND_COUNT, 'Her kriter için 0–5 arası altı bandın tanımını yazın.')
    .refine((bands) => new Set(bands.map((b) => b.band)).size === BAND_COUNT, {
      message: 'Her bant bir kez tanımlanır.',
    })
    .transform((bands) => [...bands].sort((a, b) => a.band - b.band)),
})

/**
 * Rubrik sürümünün içeriği (DOM-BEC-020; ADR 0004 karar 7): tür, beceri, kriter × bant, ağırlık
 * ve tanımlayıcı eşlemesi. Analitik rubrik en az iki farklı niteliksel yön taşır; bütüncül rubrik
 * tek genel kriterdir.
 */
export const rubricVersionInputSchema = z
  .object({
    title: text(200, 'Başlık en az 3 karakter olmalıdır.', 3),
    kind: z.enum(enumKeys(RUBRIC_KINDS)),
    skill: z.enum(RUBRIC_SKILLS),
    criteria: z
      .array(criterionSchema)
      .min(1, 'En az bir kriter ekleyin.')
      .max(10, 'En fazla 10 kriter eklenebilir.'),
  })
  .superRefine((rubric, ctx) => {
    const ids = rubric.criteria.map((c) => c.id)
    const aspects = rubric.criteria.map((c) => c.aspect)
    if (new Set(ids).size !== ids.length || new Set(aspects).size !== aspects.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Her kriter ve niteliksel yön bir kez kullanılır.',
        path: ['criteria'],
      })
    }
    if (rubric.kind === 'holistic') {
      const only = rubric.criteria[0]
      if (rubric.criteria.length !== 1 || only?.aspect !== HOLISTIC_ASPECT || only.weight !== 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'Bütüncül rubrik ağırlığı 1 olan tek genel kriter taşır.',
          path: ['criteria'],
        })
      }
      return
    }
    if (rubric.criteria.length < 2) {
      ctx.addIssue({
        code: 'custom',
        message: 'Analitik rubrikte en az iki kriter olmalıdır.',
        path: ['criteria'],
      })
    }
    const allowed: Record<string, unknown> = RUBRIC_ASPECTS[rubric.skill]
    rubric.criteria.forEach((criterion, index) => {
      if (!Object.hasOwn(allowed, criterion.aspect)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Bu niteliksel yön bu beceride kullanılmaz.',
          path: ['criteria', index, 'aspect'],
        })
      }
    })
  })
export type RubricVersionInput = z.input<typeof rubricVersionInputSchema>
export type RubricVersionData = z.output<typeof rubricVersionInputSchema>

/**
 * Dil okulunda kazanım kataloğu yoktur (DOM-KYN-010); bantlar CEFR tanımlayıcısına bağlanır.
 * Okulda CEFR (İngilizce becerisi) ve kazanım eşlemesi birlikte kullanılabilir.
 */
export function assertRubricFitsInstitution(
  rubric: RubricVersionData,
  institutionType: InstitutionType,
): void {
  if (institutionType !== 'language_school') return
  rubric.criteria.forEach((criterion, c) =>
    criterion.bands.forEach((entry, b) => {
      if (entry.alignment.kind === 'outcome') {
        throw new DomainError(
          'rubric_alignment_invalid',
          'Dil okulunda bantlar CEFR tanımlayıcısına bağlanır.',
          { path: ['criteria', String(c), 'bands', String(b), 'alignment'] },
        )
      }
    }),
  )
}

// --- Rubrik sürümü ------------------------------------------------------------------------

/** Rubrik sürümü durumları (DOM-BEC-022). Yayındaki sürüm atanır; arşivli sürüm yeni atamaya girmez. */
export const RUBRIC_VERSION_STATUSES = {
  draft: { label: 'Taslak' },
  published: { label: 'Yayında' },
  archived: { label: 'Arşiv' },
} as const
export type RubricVersionStatus = keyof typeof RUBRIC_VERSION_STATUSES

/** `rubrics` satırı. Rubrik kurumundur; ortak rubrik birçok görevde kullanılır (IST-048). */
export type RubricRecord = {
  id: string
  // kvkk: K
  ownerUserId: string
}

/** `rubric_versions` satırı. */
export type RubricVersionRow = RubricVersionData & {
  id: string
  rubricId: string
  versionNumber: number
  status: RubricVersionStatus
  createdAt: string
  publishedAt: string | null
  archivedAt: string | null
}

/** Sürümün kullanımı: sabitlendiği atama ve verilmiş puan sayısı (servis sayar). */
export type RubricUsage = { assignmentCount: number; scoreCount: number }
const isUsed = (usage: RubricUsage) => usage.assignmentCount > 0 || usage.scoreCount > 0

/** Rubriği sahibi ve yönetici düzenler (IST-048: rubrik kurumundur, kütüphanede ortaktır). */
export function canManageRubric(actor: ContentActor, rubric: RubricRecord): boolean {
  return (
    actor.role === 'yonetici' || (actor.role === 'ogretmen' && actor.userId === rubric.ownerUserId)
  )
}

const immutable = () =>
  new DomainError(
    'rubric_version_immutable',
    'Kullanılmış veya yayımlanmış rubrik sürümü değiştirilemez; yeni sürüm açın.',
    { kind: 'conflict' },
  )

/** Taslak sürümün içeriği (DOM-BEC-022). Yayımlanmış veya kullanılmış sürüm değişmez. */
export function planRubricDraftUpdate(input: {
  version: RubricVersionRow
  usage: RubricUsage
  input: unknown
  institutionType: InstitutionType
}): RubricVersionData {
  if (input.version.status !== 'draft' || isUsed(input.usage)) throw immutable()
  const data = rubricVersionInputSchema.parse(input.input)
  assertRubricFitsInstitution(data, input.institutionType)
  return data
}

/** Yeni taslak sürüm (DOM-BEC-022). Rubrik başına tek açık taslak olur. */
export function planNewRubricVersion(input: {
  rubricId: string
  versions: readonly RubricVersionRow[]
  input: unknown
  institutionType: InstitutionType
  now: Instant
}): RubricVersionData & {
  rubricId: string
  versionNumber: number
  status: 'draft'
  createdAt: string
} {
  if (input.versions.some((v) => v.status === 'draft')) {
    throw new DomainError(
      'open_rubric_version_exists',
      'Bu rubriğin açık bir taslağı var; önce onu tamamlayın.',
      { kind: 'conflict' },
    )
  }
  const data = rubricVersionInputSchema.parse(input.input)
  assertRubricFitsInstitution(data, input.institutionType)
  const last = input.versions.reduce((max, v) => Math.max(max, v.versionNumber), 0)
  return {
    ...data,
    rubricId: input.rubricId,
    versionNumber: last + 1,
    status: 'draft',
    createdAt: toIso(toMs(input.now)),
  }
}

/**
 * Taslağı yayımlar; aynı rubriğin önceki yayındaki sürümü aynı işlemde arşivlenir (yeni
 * atamalarda kullanılmaz, eski puanlar onunla hesaplanmaya devam eder; DOM-BEC-022).
 */
export function planRubricPublish(input: {
  version: RubricVersionRow
  versions: readonly RubricVersionRow[]
  now: Instant
}): { publishedAt: string; archiveVersionIds: string[] } {
  if (input.version.status !== 'draft') throw immutable()
  return {
    publishedAt: toIso(toMs(input.now)),
    archiveVersionIds: input.versions
      .filter(
        (v) =>
          v.rubricId === input.version.rubricId &&
          v.status === 'published' &&
          v.id !== input.version.id,
      )
      .map((v) => v.id),
  }
}

/** Yayındaki sürümü arşivler (DOM-BEC-022). Arşiv geri alınmaz; yeni sürüm açılır. */
export function planRubricArchive(input: { version: RubricVersionRow; now: Instant }): {
  archivedAt: string
} {
  if (input.version.status !== 'published') {
    throw new DomainError(
      'rubric_version_not_published',
      'Yalnız yayındaki rubrik sürümü arşivlenir.',
      { kind: 'conflict' },
    )
  }
  return { archivedAt: toIso(toMs(input.now)) }
}

/** Yalnız kullanılmamış taslak silinir; kullanılmış sürüm yalnız arşivlenir (DOM-BEC-022). */
export function assertRubricVersionDeletable(version: RubricVersionRow, usage: RubricUsage): void {
  if (version.status === 'draft' && !isUsed(usage)) return
  throw new DomainError(
    'rubric_version_in_use',
    'Kullanılmış veya yayımlanmış rubrik sürümü silinemez, yalnız arşivlenir.',
    { kind: 'conflict' },
  )
}

/** Atamaya sabitlenebilir mi: yalnız yayındaki sürüm (DOM-BEC-022, ADR 0004 karar 4). */
export function assertRubricAssignable(version: RubricVersionRow): void {
  if (version.status === 'published') return
  throw new DomainError(
    'rubric_version_not_assignable',
    version.status === 'archived'
      ? 'Arşivlenmiş rubrik sürümü yeni görevlerde kullanılamaz.'
      : 'Rubrik sürümü yayımlanmadan görevde kullanılamaz.',
    { kind: 'conflict', path: ['rubricVersionId'] },
  )
}

// --- Puan ---------------------------------------------------------------------------------

/** Puanlayıcı rolü (ADR 0004 karar 6). `final`: koordinatörün veya itiraz değerlendiricisinin puanı. */
export const RATER_ROLES = {
  first: { label: 'İlk puanlayıcı' },
  second: { label: 'İkinci puanlayıcı' },
  final: { label: 'Son puan' },
} as const
export type RaterRole = keyof typeof RATER_ROLES

/**
 * Puan gövdesi (DOM-BEC-021): kriter başına bant ve yorum, genel yorum. Genel yorum zorunludur;
 * "hedefin altında" bant verilen kritere yorum zorunluluğu rubrikle birlikte denetlenir. Kriter
 * satırı katıdır: istemcinin ağırlıklı puanı gibi fazladan alan reddedilir, toplam sunucuda
 * hesaplanır.
 */
export const rubricScoreInputSchema = z.object({
  criteria: z
    .array(
      z.strictObject({
        criterionId: itemId,
        band,
        comment: z.string().trim().max(2000).nullable().default(null),
      }),
    )
    .min(1, 'Her kritere bant verin.')
    .max(10),
  overallComment: text(5000, 'Genel yorumu yazın.', 3),
})
export type RubricScoreInput = z.input<typeof rubricScoreInputSchema>
export type RubricScoreData = z.output<typeof rubricScoreInputSchema>

/** `rubric_scores` satırı. Puanlanan teslim sürümüne ve rubrik sürümüne sabitlenir. */
export type RubricScoreRow = {
  id: string
  submissionVersionId: string
  rubricVersionId: string
  // kvkk: K
  raterUserId: string
  raterRole: RaterRole
  // kvkk: K
  criteria: RubricScoreData['criteria']
  // kvkk: K
  overallComment: string
  scoredAt: string
}
/** Yazılacak puan satırı (kimlik serviste). */
export type RubricScoreDraft = Omit<RubricScoreRow, 'id'>

export type CriterionResult = {
  criterionId: string
  band: number
  weight: number
  /** `band × weight`. */
  weighted: number
  meaning: BandMeaning
}
export type RubricResult = {
  /** Ağırlıklı bant toplamı. */
  total: number
  /** Azami ağırlıklı bant toplamı (`5 × Σ ağırlık`). */
  max: number
  /** 100'lük puan: `total / max × 100`, en yakın tamsayıya (yarım yukarı) yuvarlanır. */
  percent: number
  criteria: CriterionResult[]
}

/**
 * Rubrik puanı (DOM-BEC-021): kriter bantlarından her okumada hesaplanır, saklanmaz. Puan,
 * puanın verildiği rubrik sürümüyle hesaplanır (DOM-BEC-022). Tamsayı aritmetiğiyle yuvarlanır;
 * böylece tam yarım değer kayan nokta hatasına düşmez.
 */
export function rubricScore(
  rubric: Pick<RubricVersionData, 'criteria'>,
  criteria: readonly { criterionId: string; band: number }[],
): RubricResult {
  const bands = new Map(criteria.map((c) => [c.criterionId, c.band]))
  const results = rubric.criteria.map((criterion): CriterionResult => {
    const value = bands.get(criterion.id)
    if (value === undefined) {
      throw new DomainError('rubric_criterion_missing', 'Her kritere bant verin.', {
        path: ['criteria', criterion.id],
      })
    }
    return {
      criterionId: criterion.id,
      band: value,
      weight: criterion.weight,
      weighted: value * criterion.weight,
      meaning: bandMeaning(value),
    }
  })
  const total = results.reduce((sum, c) => sum + c.weighted, 0)
  const max = rubric.criteria.reduce((sum, c) => sum + c.weight * BAND_SCALE.max, 0)
  return { total, max, percent: Math.floor((200 * total + max) / (2 * max)), criteria: results }
}

/**
 * Puan gövdesi rubriğe uyuyor mu (DOM-BEC-021): her kriter bir kez, bilinmeyen kriter yok,
 * hedefin altındaki (0–2) bantta kriter yorumu zorunlu.
 */
export function assertRubricScoreFits(rubric: RubricVersionData, data: RubricScoreData): void {
  const known = new Set(rubric.criteria.map((c) => c.id))
  const seen = new Set<string>()
  data.criteria.forEach((entry, index) => {
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
    if (bandMeaning(entry.band) === 'below' && (entry.comment ?? '') === '') {
      throw new DomainError(
        'criterion_comment_required',
        'Hedefin altında bant verilen kritere kısa yorum yazın.',
        { path: ['criteria', String(index), 'comment'] },
      )
    }
  })
  if (seen.size !== known.size) {
    throw new DomainError('rubric_criterion_missing', 'Her kritere bant verin.', {
      path: ['criteria'],
    })
  }
}

// --- İkinci puanlayıcı ve son puan --------------------------------------------------------

/** Yüksek sonuçlu görevde ikinci puanlanan teslim oranının alt sınırı (DOM-BEC-024). */
export const SECOND_RATING_MIN_PERCENT = 10
/** İki puan arasındaki izinli bant farkı; bundan büyük fark uyuşmazlıktır (DOM-BEC-024). */
export const DISAGREEMENT_BAND_GAP = 1

/**
 * İkinci puanlanacak teslim sayısı (DOM-BEC-024): oranın yukarı yuvarlanmışı, teslim varsa en
 * az bir. Oran 0 ise ikinci puanlama yoktur.
 */
export function secondRatingQuota(submissionCount: number, percent: number): number {
  if (submissionCount <= 0 || percent <= 0) return 0
  return Math.min(submissionCount, Math.max(1, Math.ceil((submissionCount * percent) / 100)))
}

/**
 * İkinci puanlanacak teslimleri seçer. Rastgelelik dışarıdan verilir (servis `seededRandom`
 * ile atama kimliğini tohum yapar); sonuç kimliğe göre sıralıdır.
 */
// TODO(beceri-ikinci-puan-orneklem): Örneklemin ne zaman çekildiği domain'de yok; en muhafazakâr
// yorumla teslim kapanınca bütün teslimler üzerinden bir kez çekilir ve karar olarak saklanır.
export function pickSecondRatingSample(
  submissionIds: readonly string[],
  percent: number,
  random: RandomSource,
): string[] {
  const pool = [...new Set(submissionIds)].sort()
  const quota = secondRatingQuota(pool.length, percent)
  for (let i = 0; i < quota; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i))
    const swap = pool[i] as string
    pool[i] = pool[j] as string
    pool[j] = swap
  }
  return pool.slice(0, quota).sort()
}

/** İki puan arasında izinli farkı aşan kriterler (DOM-BEC-024). Tam eşikteki fark uyuşmazlık değildir. */
export function bandDisagreements(
  first: Pick<RubricScoreRow, 'criteria'>,
  second: Pick<RubricScoreRow, 'criteria'>,
): string[] {
  const other = new Map(second.criteria.map((c) => [c.criterionId, c.band]))
  return first.criteria
    .filter((c) => {
      const band2 = other.get(c.criterionId)
      return band2 === undefined || Math.abs(c.band - band2) > DISAGREEMENT_BAND_GAP
    })
    .map((c) => c.criterionId)
}

export type ScoreResolution =
  | { status: 'unscored' }
  | { status: 'pending'; missing: 'first' | 'second' }
  | {
      status: 'disagreement'
      first: RubricScoreRow
      second: RubricScoreRow
      criterionIds: string[]
    }
  | {
      status: 'settled'
      score: RubricScoreRow
      source: RaterRole
      /** Puanlamanın tamamlandığı an; geri bildirim bu anda açılır (DOM-BEC-045). */
      settledAt: string
    }

const latestScore = (scores: readonly RubricScoreRow[]) =>
  scores.reduce<RubricScoreRow | null>((latest, score) => {
    if (latest === null) return score
    const diff = toMs(score.scoredAt) - toMs(latest.scoredAt)
    return diff > 0 || (diff === 0 && score.id > latest.id) ? score : latest
  }, null)

/**
 * Teslim sürümünün son puanı (DOM-BEC-024, 025): en yeni `final` puan (koordinatör veya itiraz)
 * her şeyin önündedir. İkinci puanlama istenmişse (veya ikinci puan varsa) iki puan gelene kadar
 * puanlama sürer; herhangi bir kriterde birden fazla bant fark varsa koordinatör puanı beklenir.
 * Uyuşmazlık yoksa ilk puan geçerlidir. Saklanmaz, her okumada hesaplanır (ADR 0004 karar 5).
 */
// TODO(beceri-ikinci-puan-sonucu): Uyuşmazlık yokken hangi puanın geçerli olduğu domain'de yok;
// ikinci puan tutarlılık denetimi sayıldı, ilk puan geçerli (ortalama bant kesirli olurdu).
export function scoreResolution(input: {
  /** Yalnız bu teslim sürümünün puanları. */
  scores: readonly RubricScoreRow[]
  secondRatingRequested: boolean
}): ScoreResolution {
  const of = (role: RaterRole) => input.scores.filter((s) => s.raterRole === role)
  const final = latestScore(of('final'))
  if (final) return { status: 'settled', score: final, source: 'final', settledAt: final.scoredAt }
  const first = latestScore(of('first'))
  const second = latestScore(of('second'))
  if (!first && !second) return { status: 'unscored' }
  if (!first) return { status: 'pending', missing: 'first' }
  if (!second) {
    return input.secondRatingRequested
      ? { status: 'pending', missing: 'second' }
      : { status: 'settled', score: first, source: 'first', settledAt: first.scoredAt }
  }
  const criterionIds = bandDisagreements(first, second)
  if (criterionIds.length > 0) return { status: 'disagreement', first, second, criterionIds }
  const settledAt = toMs(second.scoredAt) > toMs(first.scoredAt) ? second.scoredAt : first.scoredAt
  return { status: 'settled', score: first, source: 'first', settledAt }
}

/**
 * Yeni puan sürümün öğretmen geri bildirimini açar mı (DOM-BEC-045): puan bu yazmadan önce
 * kesinleşmemiş, sonra kesinleşmiştir. Kesinleşme anı yeni puanın anıdır, geri bildirim o anda
 * kursiyere açılır (`teacherFeedbackReleased`); bildirim (`lib/notifications.ts`
 * `feedback_released`) bu anda üretilir. `scores` yalnız bu sürümün önceki puanlarıdır.
 */
export function releasesFeedback(input: {
  scores: readonly RubricScoreRow[]
  added: RubricScoreRow
  secondRatingRequested: boolean
}): boolean {
  const { secondRatingRequested } = input
  const before = scoreResolution({ scores: input.scores, secondRatingRequested })
  const after = scoreResolution({ scores: [...input.scores, input.added], secondRatingRequested })
  return before.status !== 'settled' && after.status === 'settled'
}

/** Puanlayan kişi. `coordinator`: akademik koordinatör/zümre başkanı yetkisi (DOM-YTK-027). */
export type RubricRater = {
  // kvkk: K
  userId: string
  coordinator: boolean
}

const notIndependent = () =>
  new DomainError(
    'rater_not_independent',
    'Bu teslimi daha önce puanladınız; bağımsız bir öğretmen puanlamalı.',
    { kind: 'conflict' },
  )

export type RubricScorePlanInput = {
  rubricVersion: RubricVersionRow
  /** Atamanın sabitlediği rubrik sürümü (ADR 0004 karar 4). */
  assignmentRubricVersionId: string | null
  versions: readonly VersionRow[]
  submissionVersionId: string
  /** Teslimin bütün puanları; yalnız puanlanan sürümünküler dikkate alınır. */
  scores: readonly RubricScoreRow[]
  rater: RubricRater
  raterRole: RaterRole
  secondRatingRequested: boolean
  input: unknown
  now: Instant
}

/**
 * Öğretmen puanı (DOM-BEC-021…024). Yalnız son teslim sürümü ve atamanın rubrik sürümüyle
 * puanlanır. İlk ve ikinci puanlayıcı farklı kişidir ve sürüm başına birer tanedir; ikinci puan
 * yalnız istenmişse verilir. Son puan yalnız uyuşmazlıkta, iki puanlayıcıdan bağımsız
 * koordinatörce verilir. İtirazın son puanı `planAppealDecision` iledir.
 */
// TODO(beceri-koordinator-bagimsiz): Domain koordinatörün puanlayıcılardan biri olup olamayacağını
// söylemiyor; en muhafazakâr yorumla olamaz.
export function planRubricScore(input: RubricScorePlanInput): RubricScoreDraft {
  const data = rubricScoreInputSchema.parse(input.input)
  if (input.rubricVersion.id !== input.assignmentRubricVersionId) {
    throw new DomainError(
      'rubric_version_mismatch',
      'Teslim yalnız görevin rubrik sürümüyle puanlanır.',
      { kind: 'conflict', path: ['rubricVersionId'] },
    )
  }
  assertGradableVersion(input.versions, input.submissionVersionId)
  assertRubricScoreFits(input.rubricVersion, data)
  const scores = input.scores.filter((s) => s.submissionVersionId === input.submissionVersionId)
  const byRole = (role: RaterRole) => scores.find((s) => s.raterRole === role)
  const exists = () =>
    new DomainError('rubric_score_exists', 'Bu teslim sürümü bu rolde zaten puanlandı.', {
      kind: 'conflict',
    })
  const { rater } = input
  switch (input.raterRole) {
    case 'first':
      if (byRole('first')) throw exists()
      if (byRole('second')?.raterUserId === rater.userId) throw notIndependent()
      break
    case 'second':
      if (!input.secondRatingRequested) {
        throw new DomainError(
          'second_rating_not_requested',
          'Bu teslim için ikinci puanlama istenmedi.',
          { kind: 'conflict' },
        )
      }
      if (byRole('second')) throw exists()
      if (byRole('first')?.raterUserId === rater.userId) throw notIndependent()
      break
    case 'final': {
      const resolution = scoreResolution({
        scores,
        secondRatingRequested: input.secondRatingRequested,
      })
      if (resolution.status !== 'disagreement') {
        throw new DomainError(
          'final_score_not_needed',
          'Son puan yalnız iki puanlayıcı arasında uyuşmazlık varsa verilir.',
          { kind: 'conflict' },
        )
      }
      if (!rater.coordinator) {
        throw new DomainError(
          'coordinator_required',
          'Uyuşmazlıkta son puanı akademik koordinatör verir.',
          { kind: 'forbidden' },
        )
      }
      if ([resolution.first, resolution.second].some((s) => s.raterUserId === rater.userId)) {
        throw notIndependent()
      }
      break
    }
    default:
      return input.raterRole satisfies never
  }
  return {
    submissionVersionId: input.submissionVersionId,
    rubricVersionId: input.rubricVersion.id,
    raterUserId: rater.userId,
    raterRole: input.raterRole,
    criteria: data.criteria,
    overallComment: data.overallComment,
    scoredAt: toIso(toMs(input.now)),
  }
}

/**
 * Puanlayıcının görebildiği puanlar (DOM-BEC-024: ikinci puanlayıcı ilk puanı görmeden puanlar).
 * Koordinatör hepsini görür; diğer öğretmen kendi puanlarını ve kesinleşmiş son puanı görür.
 */
export function scoresVisibleToRater(input: {
  scores: readonly RubricScoreRow[]
  viewer: RubricRater
  secondRatingRequested: boolean
}): RubricScoreRow[] {
  if (input.viewer.coordinator) return [...input.scores]
  const settled = new Set<string>()
  for (const versionId of new Set(input.scores.map((s) => s.submissionVersionId))) {
    const resolution = scoreResolution({
      scores: input.scores.filter((s) => s.submissionVersionId === versionId),
      secondRatingRequested: input.secondRatingRequested,
    })
    if (resolution.status === 'settled') settled.add(resolution.score.id)
  }
  return input.scores.filter((s) => s.raterUserId === input.viewer.userId || settled.has(s.id))
}

/**
 * Puanlanmış sürüm numaraları; F4a1 `versionAllowance` ve `planSubmissionVersion` bunu bekler.
 * İlk puan verilen sürüm puanlanmış sayılır: ikinci puan veya koordinatör beklenirken yeni sürüm
 * açılırsa puanlanan metin değişirdi (DOM-BEC-040). Yeni sürüm yalnız yeniden teslim isteğiyle açılır.
 */
export function gradedVersionNumbers(
  versions: readonly Pick<VersionRow, 'id' | 'number'>[],
  scores: readonly Pick<RubricScoreRow, 'submissionVersionId'>[],
): number[] {
  const scored = new Set(scores.map((s) => s.submissionVersionId))
  return versions
    .filter((v) => scored.has(v.id))
    .map((v) => v.number)
    .sort((a, b) => a - b)
}

// --- Puanlama süresi ----------------------------------------------------------------------

/** Öğretmen teslimi son teslim tarihinden sonra 7 gün içinde puanlar (DOM-BEC-025). */
export const GRADING_DAYS = 7

/**
 * Puanlamanın son anı (DOM-BEC-025): son teslim + 7 gün. Son teslimden sonra gelen (geç veya
 * yeniden teslim) sürümde ve son tarihsiz görevde süre gönderimden başlar. `school`'daki sınav
 * sonucu duyuru süresi (OİKY md. 25, 10 iş günü) bu süreden uzundur; 7 gün onu da karşılar.
 */
// TODO(beceri-puanlama-suresi-gec): Domain geç teslimin puanlama süresini söylemiyor; süre
// gönderimden başlatıldı, aksi hâlde geç kabulün son günündeki teslime süre kalmazdı.
export function gradingDueAt(
  deadline: Pick<Deadline, 'dueAt'>,
  version: Pick<VersionRow, 'submittedAt'>,
): string {
  const submitted = toMs(version.submittedAt)
  const start = deadline.dueAt === null ? submitted : Math.max(toMs(deadline.dueAt), submitted)
  return toIso(start + GRADING_DAYS * DAY)
}

/** Puanlama süresi aştı mı (öğretmen ve koordinatör listesi; DOM-BEC-025). Son an dahil zamanındadır. */
export function gradingOverdue(input: {
  deadline: Pick<Deadline, 'dueAt'>
  version: Pick<VersionRow, 'submittedAt'>
  resolution: ScoreResolution
  now: Instant
}): boolean {
  if (input.resolution.status === 'settled') return false
  return toMs(input.now) > toMs(gradingDueAt(input.deadline, input.version))
}

// --- İtiraz -------------------------------------------------------------------------------

/** İtiraz süresi: sonuç duyurusundan sonra 5 iş günü (DOM-BEC-025; OİKY md. 23). */
export const APPEAL_BUSINESS_DAYS = 5

const istanbulDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Duyurudan sonra `days` iş günü sonrasının Europe/Istanbul tarihi (`YYYY-MM-DD`). Süre ertesi
 * gün başlar; cumartesi, pazar ve `holidays` (resmî tatil, kurum takviminden) sayılmaz.
 */
export function addBusinessDays(
  from: Instant,
  days: number,
  holidays: readonly string[] = [],
): string {
  const closed = new Set(holidays)
  const [y, m, d] = istanbulDay
    .format(new Date(toMs(from)))
    .split('-')
    .map(Number) as [number, number, number]
  let cursor = Date.UTC(y, m - 1, d)
  let left = days
  while (left > 0) {
    cursor += DAY
    const weekday = new Date(cursor).getUTCDay()
    if (weekday !== 0 && weekday !== 6 && !closed.has(toIso(cursor).slice(0, 10))) left -= 1
  }
  return toIso(cursor).slice(0, 10)
}

/** İtirazın son anı: beşinci iş gününün sonu, Europe/Istanbul (DOM-BEC-025). */
export function appealDeadline(announcedAt: Instant, holidays: readonly string[] = []): string {
  const lastDay = addBusinessDays(announcedAt, APPEAL_BUSINESS_DAYS, holidays)
  // Tarih `addBusinessDays`'ten geldiği için geçerlidir; 23.59'un son saniyesi dahil açıktır.
  return toIso(toMs(istanbulLocalToUtc(`${lastDay}T23:59`) as string) + 59_999)
}

export const APPEAL_OUTCOMES = {
  upheld: { label: 'Kabul edildi' },
  rejected: { label: 'Reddedildi' },
} as const
export type AppealOutcome = keyof typeof APPEAL_OUTCOMES

/** İtiraz gövdesi: gerekçe zorunlu (DOM-BEC-025). Serbest metin; loglanmaz. */
export const appealInputSchema = z.object({
  reason: text(2000, 'İtiraz gerekçesini yazın.', 10),
})

/** İtiraz satırı. İlk puan silinmez; kabul edilen itiraz yeni `final` puan ekler. */
export type AppealRow = {
  id: string
  submissionVersionId: string
  // kvkk: K
  learnerId: string
  // kvkk: K
  filedByUserId: string
  // kvkk: K
  reason: string
  filedAt: string
  // kvkk: K
  decidedByUserId: string | null
  decidedAt: string | null
  outcome: AppealOutcome | null
  // kvkk: K
  decisionReason: string | null
}
export type AppealDraft = Pick<
  AppealRow,
  'submissionVersionId' | 'learnerId' | 'filedByUserId' | 'reason' | 'filedAt'
>

/**
 * Kursiyer/öğrenci veya velisi sonuç duyurusundan sonra 5 iş günü içinde gerekçeli itiraz eder
 * (DOM-BEC-025). Duyuru, son puanın kesinleştiği andır (`teacherFeedbackReleased`). Teslim sürümü
 * başına tek itiraz olur.
 */
// TODO(beceri-itiraz-alistirma): Domain alıştırmayı ayırmıyor; alıştırma sayılan sonuç üretmediği
// için (DOM-BEC-041) en muhafazakâr yorumla itiraz yalnız değerlendirme türündedir.
export function planAppeal(input: {
  actor: Actor
  learnerId: string
  kind: TaskKind
  submissionVersionId: string
  resolution: ScoreResolution
  /** Bu teslimin itirazları. */
  appeals: readonly Pick<AppealRow, 'submissionVersionId'>[]
  holidays?: readonly string[]
  input: unknown
  now: Instant
}): AppealDraft {
  const { actor } = input
  const linkKind = actor.role === 'ogrenci' ? 'student' : actor.role === 'veli' ? 'child' : null
  const linked =
    linkKind !== null &&
    actor.links.some((link) => link.kind === linkKind && link.recordId === input.learnerId)
  if (!linked || !actor.userId) {
    throw new DomainError(
      'appeal_forbidden',
      'Yalnız kursiyer veya velisi kendi sonucuna itiraz eder.',
      { kind: 'forbidden' },
    )
  }
  if (input.kind !== 'evaluation') {
    throw new DomainError('appeal_not_available', 'Alıştırma sonucuna itiraz edilmez.')
  }
  const { resolution } = input
  if (resolution.status !== 'settled' || toMs(input.now) < toMs(resolution.settledAt)) {
    throw new DomainError('appeal_not_open', 'Sonuç duyurulmadan itiraz edilemez.', {
      kind: 'conflict',
    })
  }
  if (resolution.score.submissionVersionId !== input.submissionVersionId) {
    throw new DomainError('appeal_not_open', 'Yalnız duyurulan son sonuca itiraz edilir.', {
      kind: 'conflict',
    })
  }
  if (toMs(input.now) > toMs(appealDeadline(resolution.settledAt, input.holidays))) {
    throw new DomainError(
      'appeal_window_closed',
      'İtiraz süresi doldu; itiraz sonuç duyurusundan sonra 5 iş günü içinde yapılır.',
    )
  }
  if (input.appeals.some((a) => a.submissionVersionId === input.submissionVersionId)) {
    throw new DomainError('appeal_exists', 'Bu sonuca zaten itiraz edildi.', { kind: 'conflict' })
  }
  const data = appealInputSchema.parse(input.input)
  return {
    submissionVersionId: input.submissionVersionId,
    learnerId: input.learnerId,
    filedByUserId: actor.userId,
    reason: data.reason,
    filedAt: toIso(toMs(input.now)),
  }
}

/** İtiraz kararı: sonuç gerekçesiyle bildirilir; kabulde yeni rubrik puanı verilir (DOM-BEC-025). */
export const appealDecisionSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('upheld'),
    reason: text(2000, 'Karar gerekçesini yazın.', 5),
    score: rubricScoreInputSchema,
  }),
  z.object({ outcome: z.literal('rejected'), reason: text(2000, 'Karar gerekçesini yazın.', 5) }),
])
export type AppealDecisionInput = z.input<typeof appealDecisionSchema>

/**
 * İtirazı ilk puanlayıcı dışında bir öğretmen değerlendirir (DOM-BEC-025). Kabulde yeni `final`
 * puan eklenir; ilk puan ve önceki puanlar kayıt geçmişinde kalır.
 */
// TODO(beceri-itiraz-bagimsiz): Domain yalnız ilk puanlayıcıyı dışarıda bırakıyor; en muhafazakâr
// yorumla bu sürümü puanlamış hiç kimse (ikinci puanlayıcı, koordinatör) itirazı değerlendiremez.
export function planAppealDecision(input: {
  appeal: AppealRow
  reviewer: RubricRater
  rubricVersion: RubricVersionRow
  /** Teslimin puanları. */
  scores: readonly RubricScoreRow[]
  input: unknown
  now: Instant
}): {
  appeal: Pick<AppealRow, 'decidedByUserId' | 'decidedAt' | 'outcome' | 'decisionReason'>
  score: RubricScoreDraft | null
} {
  const { appeal, reviewer } = input
  if (appeal.outcome !== null) {
    throw new DomainError('appeal_decided', 'Bu itiraz zaten sonuçlandı.', { kind: 'conflict' })
  }
  const scores = input.scores.filter((s) => s.submissionVersionId === appeal.submissionVersionId)
  if (scores.some((s) => s.raterUserId === reviewer.userId)) throw notIndependent()
  const data = appealDecisionSchema.parse(input.input)
  const decidedAt = toIso(toMs(input.now))
  let score: RubricScoreDraft | null = null
  if (data.outcome === 'upheld') {
    assertRubricScoreFits(input.rubricVersion, data.score)
    score = {
      submissionVersionId: appeal.submissionVersionId,
      rubricVersionId: input.rubricVersion.id,
      raterUserId: reviewer.userId,
      raterRole: 'final',
      criteria: data.score.criteria,
      overallComment: data.score.overallComment,
      scoredAt: decidedAt,
    }
  }
  return {
    appeal: {
      decidedByUserId: reviewer.userId,
      decidedAt,
      outcome: data.outcome,
      decisionReason: data.reason,
    },
    score,
  }
}
