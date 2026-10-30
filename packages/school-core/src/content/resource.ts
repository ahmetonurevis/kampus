import { z } from 'zod'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { DomainError } from '../lib/errors.ts'
import {
  ACTIVITY_MODES,
  CEFR_LEVELS,
  CONTENT_TYPES,
  DIFFICULTIES,
  GRADE_LEVEL_RANGE,
  INTERACTION_CHANNELS,
  LICENSE_KINDS,
  MEDIATION_SKILLS,
  OPEN_LICENSES,
  OUTCOME_SOURCES,
  PRIMARY_SKILLS,
  SHARE_SCOPES,
  SKILLS,
  SUBMISSION_KINDS,
  enumKeys,
  licenseExpired,
  type CefrLevel,
  type ContentType,
  type FilePurpose,
  type ShareScope,
} from './taxonomy.ts'

/**
 * İçerik havuzu kaynağı ve sürümü (docs/domain/kaynak-platformu.md; ADR 0004 karar 3).
 *
 * Kaynak (`resources`) kimliği, sahibi, türü ve paylaşım kapsamını; sürüm (`resource_versions`)
 * içeriği, cevap anahtarını, etiketleri ve lisansı taşır. Bu modül State'e koleksiyon eklemez
 * (ADR 0004 karar 2): girdi servisin yüklediği tipli satırlardır, fonksiyonlar `now` alır ve
 * yazılacak değişikliği döndürür; yazma, sürüm kontrolü ve denetim kaydı API servisindedir.
 *
 * - Şemalar API gövde şeması ve web/mobil form şemasıdır (`zodResolver`).
 * - Cevap anahtarı içerikten ayrı alandır (`answerKey`); öğrenci ve veli `learnerView` görür.
 * - Yayımlanmış sürüm değişmez; düzenleme yeni taslak sürüm açar (DOM-KYN-032).
 */

z.config(z.locales.tr())

const identifier = z.string().trim().min(1, 'Bir kayıt seçin.').max(200)
const distinct = <T>(list: readonly T[]): T[] => [...new Set(list)]
const uniqueIds = (list: readonly { id: string }[]) =>
  new Set(list.map((item) => item.id)).size === list.length
const text = (max: number, required: string) =>
  z
    .string()
    .trim()
    .min(1, required)
    .max(max, `En fazla ${max.toLocaleString('tr-TR')} karakter girebilirsiniz.`)
const day = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(`${v}T09:00Z`)) &&
      new Date(`${v}T09:00Z`).toISOString().slice(0, 10) === v,
    'Geçerli bir tarih seçin.',
  )
/** Seçenek, öncül ve boşluk kimlikleri yazar tarafından verilir; işaretleme ve eşleme için. */
const itemId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, 'Kimlik yalnız harf, rakam, - ve _ içerebilir.')
const item = z.object({ id: itemId, text: text(500, 'Metni yazın.') })
const fileRef = identifier

// --- Durum ve aktör -----------------------------------------------------------------------

/** Sürüm durumları (DOM-KYN-030, DOM-KYN-051; ADR 0004 karar 3). */
export const RESOURCE_STATUSES = {
  draft: { label: 'Taslak' },
  in_review: { label: 'İncelemede' },
  published: { label: 'Yayında' },
  rejected: { label: 'Reddedildi' },
  archived: { label: 'Arşiv' },
  removed: { label: 'Kaldırıldı' },
} as const
export type ResourceStatus = keyof typeof RESOURCE_STATUSES

/** Yazarın üzerinde çalışabildiği durumlar; yalnız bunlarda içerik değişir. */
export const EDITABLE_STATUSES = ['draft', 'rejected'] as const satisfies readonly ResourceStatus[]
/** Kaynağın açık (henüz yayımlanmamış) sürümü; kaynak başına en fazla bir tane olur. */
export const OPEN_STATUSES = [
  'draft',
  'in_review',
  'rejected',
] as const satisfies readonly ResourceStatus[]

/** İçerik havuzunda kaynak oluşturan ve yöneten roller (yetki-ve-kapsam.md matrisi). */
export const CONTENT_STAFF_ROLES = ['yonetici', 'ogretmen'] as const satisfies readonly Role[]

/**
 * İçerik işlemi yapan kişi. `userId` kalıcı kullanıcı kimliğidir (sahiplik ve yazar). Zümre
 * başkanı (`school`) ve akademik koordinatör (`language_school`) öğretmene verilen ek yetkidir
 * (DOM-YTK-027): kapsamı ders kimlikleri veya CEFR seviyeleridir.
 */
export type ContentActor = {
  role: Role
  // kvkk: K
  userId: string
  /** Öğretmenin branşları; zümre kapsamı bunlarla eşleşir (DOM-KYN-040). */
  subjectIds?: readonly string[] | undefined
  reviewer?: { subjectIds: readonly string[]; cefrLevels: readonly CefrLevel[] } | undefined
}

export const isContentStaff = (role: Role) =>
  (CONTENT_STAFF_ROLES as readonly Role[]).includes(role)

// --- İçerik şemaları ----------------------------------------------------------------------

const stem = text(5000, 'Soru kökünü yazın.')
const bodyText = text(50_000, 'Metni yazın.')
const transcript = text(50_000, 'Dökümü yazın.')
const webVtt = text(200_000, 'Altyazıyı ekleyin.').refine(
  (value) => value.startsWith('WEBVTT'),
  'Altyazı WebVTT biçiminde olmalıdır.',
)
/** Boşluk işareti soru kökünde `{{kimlik}}` biçimindedir. */
const GAP_MARKER = /\{\{([A-Za-z0-9_-]{1,40})\}\}/g

const multipleChoice = z
  .object({
    questionType: z.literal('multiple_choice'),
    stem,
    // DOM-KYN-002: doğru cevap + en az üç çeldirici.
    options: z.array(item).min(4, 'En az dört seçenek girin.').max(8),
    imageFileId: fileRef.nullable().default(null),
  })
  .refine((q) => uniqueIds(q.options), {
    message: 'Seçenek kimlikleri tekil olmalıdır.',
    path: ['options'],
  })
const trueFalse = z.object({
  questionType: z.literal('true_false'),
  stem,
  /** "Belirtilmemiş" seçeneği (DOM-BEC-002: doğru/yanlış/belirtilmemiş). */
  allowNotGiven: z.boolean().default(false),
  imageFileId: fileRef.nullable().default(null),
})
const matching = z
  .object({
    questionType: z.literal('matching'),
    stem,
    prompts: z.array(item).min(2, 'En az iki öncül girin.').max(20),
    choices: z.array(item).min(2, 'En az iki eşleşme girin.').max(26),
  })
  .refine((q) => uniqueIds([...q.prompts, ...q.choices]), {
    message: 'Öncül ve eşleşme kimlikleri tekil olmalıdır.',
    path: ['choices'],
  })
const gapFill = z
  .object({
    questionType: z.literal('gap_fill'),
    stem,
    gaps: z
      .array(
        z.object({
          id: itemId,
          /** Kapalı liste (DOM-BEC-002); boşsa öğrenci yazar. */
          options: z.array(text(200, 'Seçeneği yazın.')).max(10).default([]).transform(distinct),
        }),
      )
      .min(1, 'En az bir boşluk ekleyin.')
      .max(20),
  })
  .superRefine((q, ctx) => {
    const markers = [...q.stem.matchAll(GAP_MARKER)].map((match) => match[1])
    const ids = q.gaps.map((gap) => gap.id)
    if (!uniqueIds(q.gaps) || new Set(markers).size !== markers.length) {
      ctx.addIssue({ code: 'custom', message: 'Her boşluk bir kez kullanılır.', path: ['gaps'] })
    } else if (markers.length !== ids.length || ids.some((id) => !markers.includes(id))) {
      ctx.addIssue({
        code: 'custom',
        message: 'Soru kökündeki {{boşluk}} işaretleri boşluk listesiyle eşleşmelidir.',
        path: ['stem'],
      })
    }
  })
const ordering = z
  .object({
    questionType: z.literal('ordering'),
    stem,
    items: z.array(item).min(2, 'En az iki öğe girin.').max(20),
  })
  .refine((q) => uniqueIds(q.items), {
    message: 'Öğe kimlikleri tekil olmalıdır.',
    path: ['items'],
  })
const shortAnswer = z.object({
  questionType: z.literal('short_answer'),
  stem,
  maxLength: z.number().int().min(1).max(500).default(100),
  imageFileId: fileRef.nullable().default(null),
})

/** Soru gövdesi (IST-033). Doğru cevap ve çözüm açıklaması burada değil, `answerKey`'dedir. */
export const questionBodySchema = z.discriminatedUnion('questionType', [
  multipleChoice,
  trueFalse,
  matching,
  gapFill,
  ordering,
  shortAnswer,
])
export type QuestionBody = z.output<typeof questionBodySchema>

const explanation = text(5000, 'Çözüm açıklamasını yazın.')
const accepted = z
  .array(text(200, 'Kabul edilen cevabı yazın.'))
  .min(1, 'En az bir kabul edilen cevap girin.')
  .max(20)
  .transform(distinct)

/**
 * Soru cevap anahtarı (ADR 0004 karar 3: ayrı `answer_key` kolonu). Çözüm açıklaması da cevabı
 * açığa çıkardığı için anahtardadır; açılma kuralı (DOM-BEC-045) bu alanın tamamına uygulanır.
 */
export const answerKeySchema = z.discriminatedUnion('questionType', [
  z.object({ questionType: z.literal('multiple_choice'), correctOptionId: itemId, explanation }),
  z.object({
    questionType: z.literal('true_false'),
    answer: z.enum(['true', 'false', 'not_given']),
    explanation,
  }),
  z.object({
    questionType: z.literal('matching'),
    pairs: z
      .array(z.object({ promptId: itemId, choiceId: itemId }))
      .min(1)
      .max(20),
    explanation,
  }),
  z.object({
    questionType: z.literal('gap_fill'),
    gaps: z
      .array(z.object({ gapId: itemId, accepted }))
      .min(1)
      .max(20),
    explanation,
  }),
  z.object({
    questionType: z.literal('ordering'),
    order: z.array(itemId).min(2).max(20),
    explanation,
  }),
  z.object({ questionType: z.literal('short_answer'), accepted, explanation }),
])
export type AnswerKey = z.output<typeof answerKeySchema>

const textLike = <T extends 'text' | 'worksheet'>(type: T) =>
  z
    .object({
      type: z.literal(type),
      body: bodyText.nullable().default(null),
      fileId: fileRef.nullable().default(null),
    })
    .refine((c) => c.body !== null || c.fileId !== null, {
      message: 'Metni yazın veya dosya ekleyin.',
      path: ['body'],
    })
const media = <T extends 'audio' | 'video'>(type: T) =>
  z.object({
    type: z.literal(type),
    fileId: fileRef,
    // DOM-KYN-003: döküm veya altyazı yayımın ön koşuludur; taslakta boş kalabilir.
    transcript: transcript.nullable().default(null),
    captionsVtt: webVtt.nullable().default(null),
  })
const itemList = <T extends 'quiz' | 'exercise_set'>(type: T) =>
  z
    .object({
      type: z.literal(type),
      /** Sorular sürüm kimliğiyle listelenir; sorunun yeni sürümü quiz'i değiştirmez (karar 3). */
      items: z
        .array(
          z.object({
            questionVersionId: identifier,
            points: z.number().int().min(1).max(100).default(1),
          }),
        )
        .min(1, 'En az bir soru ekleyin.')
        .max(200, 'En fazla 200 soru eklenebilir.'),
      timeLimitMinutes: z.number().int().min(1).max(300).nullable().default(null),
      shuffleItems: z.boolean().default(false),
    })
    .refine((c) => new Set(c.items.map((i) => i.questionVersionId)).size === c.items.length, {
      message: 'Aynı soru iki kez eklenemez.',
      path: ['items'],
    })

/** Tür başına içerik (DOM-KYN-002, DOM-KYN-027, IST-030, IST-033, IST-036). */
export const resourceContentSchema = z.discriminatedUnion('type', [
  textLike('text'),
  textLike('worksheet'),
  z.object({ type: z.literal('reading_passage'), body: bodyText }),
  media('audio'),
  media('video'),
  z.object({ type: z.literal('file'), fileId: fileRef }),
  z.object({
    type: z.literal('link'),
    url: z.url({ protocol: /^https$/, error: 'Bağlantı https:// ile başlamalıdır.' }).max(2000),
    provider: z.string().trim().max(100).nullable().default(null),
  }),
  z.object({
    type: z.literal('book_reference'),
    publisher: text(200, 'Yayınevini yazın.'),
    bookTitle: text(300, 'Kitap adını yazın.'),
    edition: z.string().trim().max(100).nullable().default(null),
    isbn: z
      .string()
      .trim()
      .regex(/^[0-9Xx-]{10,17}$/, 'Geçerli bir ISBN girin.')
      .nullable()
      .default(null),
    pages: text(100, 'Sayfa veya sayfa aralığını yazın.'),
    note: z.string().trim().max(2000).nullable().default(null),
  }),
  z.object({ type: z.literal('question'), question: questionBodySchema }),
  itemList('quiz'),
  itemList('exercise_set'),
  z
    .object({
      type: z.literal('homework_template'),
      instructions: text(10_000, 'Yönergeyi yazın.'),
      submissionKinds: z
        .array(z.enum(enumKeys(SUBMISSION_KINDS)))
        .min(1, 'En az bir teslim türü seçin.')
        .transform(distinct),
      criteria: z.string().trim().max(5000).nullable().default(null),
      rubricId: identifier.nullable().default(null),
    })
    .refine((c) => (c.criteria ?? '') !== '' || c.rubricId !== null, {
      message: 'Değerlendirme ölçütü yazın veya rubrik seçin.',
      path: ['criteria'],
    }),
])
export type ResourceContent = z.output<typeof resourceContentSchema>

// --- Etiketler ----------------------------------------------------------------------------

/**
 * Etiketler (IST-031; ADR 0004 karar 3'teki süzülen kolonlar). Birincil beceri beceri listesinde
 * de bulunur. Kazanım bağlantısı katalog kaynağını (`outcomeSource`) taşır: platform kataloğu
 * (MEB programı) veya kurum kataloğu.
 */
export const resourceTagsSchema = z
  .object({
    subjectId: identifier.nullable().default(null),
    gradeLevels: z
      .array(z.number().int().min(GRADE_LEVEL_RANGE.min).max(GRADE_LEVEL_RANGE.max))
      .max(8)
      .default([])
      .transform((list) => distinct(list).sort((a, b) => a - b)),
    cefrLevel: z.enum(enumKeys(CEFR_LEVELS)).nullable().default(null),
    primarySkill: z.enum(PRIMARY_SKILLS).nullable().default(null),
    skills: z
      .array(z.enum(enumKeys(SKILLS)))
      .max(9)
      .default([])
      .transform(distinct),
    activityMode: z.enum(enumKeys(ACTIVITY_MODES)).nullable().default(null),
    interactionChannel: z.enum(enumKeys(INTERACTION_CHANNELS)).nullable().default(null),
    /** Aracılık görevi kaynak ve hedef beceriyi birlikte taşır (DOM-BEC-001). */
    mediation: z
      .object({ sourceSkill: z.enum(MEDIATION_SKILLS), targetSkill: z.enum(MEDIATION_SKILLS) })
      .nullable()
      .default(null),
    durationMinutes: z.number().int().min(1).max(600).nullable().default(null),
    difficulty: z.enum(enumKeys(DIFFICULTIES)).nullable().default(null),
    outcomes: z
      .array(z.object({ outcomeId: identifier, outcomeSource: z.enum(enumKeys(OUTCOME_SOURCES)) }))
      .max(20, 'En fazla 20 kazanım bağlanabilir.')
      .default([])
      .transform((list) => [
        ...new Map(list.map((o) => [`${o.outcomeSource}:${o.outcomeId}`, o])).values(),
      ]),
  })
  .superRefine((tags, ctx) => {
    if ((tags.primarySkill === 'mediation') !== (tags.mediation !== null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Aracılık görevinde kaynak ve hedef beceriyi seçin.',
        path: ['mediation'],
      })
    }
    if (tags.interactionChannel !== null && tags.activityMode !== 'interaction') {
      ctx.addIssue({
        code: 'custom',
        message: 'Etkileşim kanalı yalnız etkileşim kipinde seçilir.',
        path: ['interactionChannel'],
      })
    }
  })
  .transform((tags) => ({
    ...tags,
    skills:
      tags.primarySkill === null ? tags.skills : distinct([tags.primarySkill, ...tags.skills]),
  }))
export type ResourceTags = z.output<typeof resourceTagsSchema>

// --- Lisans ve kaynak gösterimi -----------------------------------------------------------

/** Menşe/lisans (DOM-KYN-020, 021, 044; IST-036). Ayrıntı `license` jsonb'dir (karar 3). */
export const resourceLicenseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('institution_original') }),
  z.object({ kind: z.literal('contains_quotation') }),
  z.object({ kind: z.literal('platform_derived'), platformVersionId: identifier }),
  z.object({
    kind: z.literal('open_license'),
    license: z.enum(enumKeys(OPEN_LICENSES), 'Ticari kullanıma izin veren bir açık lisans seçin.'),
  }),
  z.object({
    kind: z.literal('public_domain'),
    basisNote: text(1000, 'Kamu malı olduğunun dayanağını yazın.'),
  }),
  z.object({
    kind: z.literal('licensed_publication'),
    publisher: text(200, 'Yayınevi veya sağlayıcıyı yazın.'),
    contractNumber: text(100, 'Sözleşme numarasını yazın.'),
    coverage: text(1000, 'Lisans kapsamını yazın.'),
    expiryDate: day,
    allowsAdaptation: z.boolean().default(false),
    /** Lisans yalnız basılı kitap sahibi öğrencileri kapsıyorsa paylaşım da onlarla sınırlıdır. */
    restrictedToBookOwners: z.boolean().default(false),
  }),
  z.object({ kind: z.literal('external_reference') }),
])
export type ResourceLicense = z.output<typeof resourceLicenseSchema>

/**
 * Kaynak gösterimi (DOM-KYN-022, 024): eser, eser sahibi, alındığı yer (yayın, sayfa veya URL).
 * İçeriğin görünür parçasıdır; öğrenci ekranında ve kopyalarda korunur.
 */
export const attributionSchema = z.object({
  work: text(300, 'Eser adını yazın.'),
  author: text(200, 'Eser sahibini yazın.'),
  source: text(500, 'Alındığı yeri (yayın, sayfa veya URL) yazın.'),
  year: z.number().int().min(1000).max(2100).nullable().default(null),
})
export type Attribution = z.output<typeof attributionSchema>

// --- Sürüm girdisi ------------------------------------------------------------------------

function answerKeyIssue(question: QuestionBody, key: AnswerKey): string | null {
  if (question.questionType !== key.questionType) return 'Cevap anahtarı soru türüyle uyuşmuyor.'
  switch (key.questionType) {
    case 'multiple_choice':
      return question.questionType === 'multiple_choice' &&
        question.options.some((option) => option.id === key.correctOptionId)
        ? null
        : 'Doğru seçenek soruda bulunmuyor.'
    case 'true_false':
      return question.questionType === 'true_false' &&
        key.answer === 'not_given' &&
        !question.allowNotGiven
        ? '"Belirtilmemiş" cevabı için bu seçeneği açın.'
        : null
    case 'matching': {
      if (question.questionType !== 'matching') return null
      const prompts = new Set(question.prompts.map((p) => p.id))
      const choices = new Set(question.choices.map((c) => c.id))
      const paired = new Set(key.pairs.map((pair) => pair.promptId))
      const valid =
        paired.size === key.pairs.length &&
        paired.size === prompts.size &&
        key.pairs.every((pair) => prompts.has(pair.promptId) && choices.has(pair.choiceId))
      return valid ? null : 'Her öncül tek bir eşleşmeyle eşlenmelidir.'
    }
    case 'gap_fill': {
      if (question.questionType !== 'gap_fill') return null
      const gaps = new Map(question.gaps.map((gap) => [gap.id, gap]))
      const keyed = new Set(key.gaps.map((gap) => gap.gapId))
      if (keyed.size !== key.gaps.length || keyed.size !== gaps.size) {
        return 'Her boşluk için kabul edilen cevap girin.'
      }
      for (const entry of key.gaps) {
        const gap = gaps.get(entry.gapId)
        if (!gap) return 'Her boşluk için kabul edilen cevap girin.'
        if (gap.options.length > 0 && entry.accepted.some((a) => !gap.options.includes(a))) {
          return 'Kapalı listeli boşluğun cevabı listeden olmalıdır.'
        }
      }
      return null
    }
    case 'ordering': {
      if (question.questionType !== 'ordering') return null
      const items = new Set(question.items.map((i) => i.id))
      const valid =
        key.order.length === items.size &&
        new Set(key.order).size === key.order.length &&
        key.order.every((id) => items.has(id))
      return valid ? null : 'Doğru sıra bütün öğeleri birer kez içermelidir.'
    }
    case 'short_answer':
      return question.questionType === 'short_answer' &&
        key.accepted.some((answer) => answer.length > question.maxLength)
        ? 'Kabul edilen cevap azami uzunluğu aşıyor.'
        : null
    default:
      return key satisfies never
  }
}

/**
 * Sürüm içeriği: başlık, tür başına içerik, cevap anahtarı, etiketler, lisans ve kaynak gösterimi.
 * Taslak eksik kaydedilebilir (lisans ve anahtar boş); yayım koşulları `publicationIssues`'tadır.
 */
export const resourceVersionInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, 'Başlık en az 3 karakter olmalıdır.')
      .max(200, 'Başlık en fazla 200 karakter olabilir.'),
    content: resourceContentSchema,
    answerKey: answerKeySchema.nullable().default(null),
    tags: resourceTagsSchema.prefault({}),
    license: resourceLicenseSchema.nullable().default(null),
    attributions: z.array(attributionSchema).max(30).default([]),
  })
  .superRefine((version, ctx) => {
    if (version.answerKey === null) return
    if (version.content.type !== 'question') {
      ctx.addIssue({
        code: 'custom',
        message: 'Bu içerik türü cevap anahtarı taşımaz.',
        path: ['answerKey'],
      })
      return
    }
    const issue = answerKeyIssue(version.content.question, version.answerKey)
    if (issue) ctx.addIssue({ code: 'custom', message: issue, path: ['answerKey'] })
  })
export type ResourceVersionInput = z.input<typeof resourceVersionInputSchema>
export type ResourceVersionData = z.output<typeof resourceVersionInputSchema>

/** Ret, geri çekme, telif bildirimi ve kaldırma gerekçesi. Serbest metin; loglanmaz. */
export const transitionReasonSchema = z
  .string()
  .trim()
  .min(5, 'Gerekçeyi yazın.')
  .max(1000, 'En fazla 1000 karakter girebilirsiniz.')

// --- Satır tipleri ------------------------------------------------------------------------

/** `resources` satırı (karar 3); servis Drizzle satırını bu şekle çevirir. */
export type ResourceRecord = {
  id: string
  contentType: ContentType
  // kvkk: K
  ownerUserId: string
  /** Sahip etkin değilse (kadro arşivi) taslakları yöneticiye görünür (DOM-KYN-052). */
  ownerActive: boolean
  shareScope: ShareScope
  sharedStudentIds: readonly string[]
  sharedClassIds: readonly string[]
  /** Güncel yayındaki sürüm; hiç yayımlanmadıysa `null`. */
  currentVersionId: string | null
  derivedFromVersionId: string | null
  derivedFromPlatformVersionId: string | null
}

/** `resource_versions` satırının durum kolonları. */
export type ResourceVersionMeta = {
  id: string
  resourceId: string
  versionNumber: number
  status: ResourceStatus
  // kvkk: K
  authorUserId: string
  createdAt: string
  submittedAt: string | null
  reviewedByUserId: string | null
  reviewedAt: string | null
  rejectionReason: string | null
  publishedAt: string | null
  archivedAt: string | null
  removedAt: string | null
  removalReason: string | null
}
export type ResourceVersion = ResourceVersionMeta & ResourceVersionData

// --- Yayım denetimi -----------------------------------------------------------------------

export type PublicationIssue = { code: string; message: string; path: readonly string[] }

/** Quiz ve alıştırma setindeki sorunun denetim için gereken alanları (DOM-KYN-013). */
export type ItemVersionRef = Pick<ResourceVersion, 'id' | 'status' | 'tags'> & {
  contentType: ContentType
}

export type PublicationContext = {
  institutionType: InstitutionType
  version: ResourceVersionData
  now: Date | string
  /** Quiz/alıştırma setinin soru sürümleri, kimliğe göre; bulunmayan soru yayımı engeller. */
  itemVersions?: ReadonlyMap<string, ItemVersionRef> | undefined
}

const ENGLISH_SUBJECT_ID = 'english'
/** Birincil becerisi dil kullanımı olabilen türler (ürün kararı; DOM-KYN-012 istisnası). */
const LANGUAGE_USE_PRIMARY_TYPES: readonly ContentType[] = ['question', 'quiz', 'exercise_set']
/** Birincil becerisi dört temel beceriden biri olmak zorunda olan türler. */
const CORE_SKILL_TYPES: readonly ContentType[] = ['reading_passage', 'audio', 'video']

/**
 * Yayım koşulları (DOM-KYN-003, 010, 013, 020, 021, 024; IST-031, IST-036). Bütün eksikleri
 * listeler: form hepsini birden gösterir. Onaya gönderme ve yayım `assertPublishable` ile reddeder.
 */
export function publicationIssues(context: PublicationContext): PublicationIssue[] {
  const { institutionType, version, now } = context
  const { content, tags, license } = version
  const issues: PublicationIssue[] = []
  const add = (code: string, message: string, ...path: string[]) =>
    issues.push({ code, message, path })

  // Lisans ve menşe (DOM-KYN-020, 021; IST-036).
  if (license === null) {
    add('license_required', 'Menşe ve lisans türünü seçin.', 'license')
  } else {
    const hosted = CONTENT_TYPES[content.type].hosted
    if (!hosted && license.kind !== 'external_reference') {
      add(
        'external_reference_required',
        'Bağlantı ve kitap referansı yalnız harici kaynak olarak eklenir.',
        'license',
      )
    }
    if (hosted && license.kind === 'external_reference') {
      add(
        'external_content_not_hosted',
        'Yayınevi veya harici kaynak içeriği yüklenmez; kitap/sayfa referansı veya bağlantı ekleyin.',
        'license',
      )
    }
    if (licenseExpired(license, now)) {
      add('license_expired', 'Lisans süresi dolmuş içerik yayımlanamaz.', 'license', 'expiryDate')
    }
    // DOM-KYN-024: kaynak gösterimi eksik içerik onaya gönderilemez.
    if (LICENSE_KINDS[license.kind].requiresAttribution && version.attributions.length === 0) {
      add(
        'attribution_required',
        'Kaynak gösterimini (eser, eser sahibi, yer) ekleyin.',
        'attributions',
      )
    }
  }

  // Kurum türüne göre zorunlu etiketler (DOM-KYN-010).
  if (institutionType === 'school') {
    if (tags.subjectId === null) add('subject_required', 'Dersi seçin.', 'tags', 'subjectId')
    if (tags.gradeLevels.length === 0) {
      add('grade_required', 'En az bir sınıf düzeyi seçin.', 'tags', 'gradeLevels')
    }
    if (tags.outcomes.length === 0) {
      add('outcome_required', 'En az bir kazanım seçin.', 'tags', 'outcomes')
    }
    const skillTagged = tags.cefrLevel !== null || tags.primarySkill !== null
    if (skillTagged && tags.subjectId !== null && tags.subjectId !== ENGLISH_SUBJECT_ID) {
      add(
        'cefr_requires_english',
        'CEFR seviyesi ve beceri yalnız İngilizce dersinde etiketlenir.',
        'tags',
        'subjectId',
      )
    }
    if (skillTagged && tags.cefrLevel === null) {
      add('cefr_required', 'CEFR seviyesini seçin.', 'tags', 'cefrLevel')
    }
    if (skillTagged && tags.primarySkill === null) {
      add('skill_required', 'Birincil beceriyi seçin.', 'tags', 'primarySkill')
    }
  } else {
    if (tags.cefrLevel === null) add('cefr_required', 'CEFR seviyesini seçin.', 'tags', 'cefrLevel')
    if (tags.primarySkill === null) {
      add('skill_required', 'Birincil beceriyi seçin.', 'tags', 'primarySkill')
    }
  }

  // DOM-KYN-012, DOM-BEC-001: dil kullanımı yalnız otomatik puanlı soru, quiz ve alıştırma setinde
  // birincil beceridir; okuma parçası, ses ve video dört temel beceriden birini ister.
  const primary = tags.primarySkill
  if (primary === 'language_use' && !LANGUAGE_USE_PRIMARY_TYPES.includes(content.type)) {
    add(
      'language_use_primary_not_allowed',
      'Dil kullanımı yalnız soru, quiz ve alıştırma setinde birincil beceri olur; okuma, dinleme, yazma veya konuşmayı seçin.',
      'tags',
      'primarySkill',
    )
  } else if (
    primary !== null &&
    CORE_SKILL_TYPES.includes(content.type) &&
    SKILLS[primary].group !== 'core'
  ) {
    add(
      'core_skill_required',
      'Okuma parçası, ses ve videonun birincil becerisi okuma, dinleme, yazma veya konuşmadır.',
      'tags',
      'primarySkill',
    )
  }

  // Okuma ve dinleme parçası tek düzeye bağlanır (DOM-KYN-002, DOM-KYN-012).
  const passage =
    content.type === 'reading_passage' ||
    (content.type === 'audio' && tags.primarySkill === 'listening')
  if (passage && tags.gradeLevels.length > 1) {
    add(
      'single_level_required',
      'Okuma ve dinleme parçası tek düzeye bağlanır.',
      'tags',
      'gradeLevels',
    )
  }

  switch (content.type) {
    case 'audio':
    case 'video':
      // DOM-KYN-003: döküm veya zaman kodlu altyazı olmadan yayın yok.
      if (content.transcript === null && content.captionsVtt === null) {
        add(
          'transcript_required',
          'Döküm veya altyazı eklemeden yayımlanamaz.',
          'content',
          'transcript',
        )
      }
      break
    case 'question':
      if (version.answerKey === null) {
        add('answer_key_required', 'Cevap anahtarını girin.', 'answerKey')
      }
      // DOM-KYN-013: etiketsiz soru değerlendirmeye girmez.
      if (tags.outcomes.length === 0 && tags.primarySkill === null) {
        add('question_untagged', 'Soruya kazanım veya beceri etiketi ekleyin.', 'tags')
      }
      break
    case 'quiz':
    case 'exercise_set':
      content.items.forEach((entry, index) => {
        const issue = itemIssue(context.itemVersions?.get(entry.questionVersionId))
        if (issue) add(issue.code, issue.message, 'content', 'items', String(index))
      })
      break
    case 'text':
    case 'worksheet':
    case 'reading_passage':
    case 'file':
    case 'link':
    case 'book_reference':
    case 'homework_template':
      break
    default:
      content satisfies never
  }
  return issues
}

function itemIssue(ref: ItemVersionRef | undefined): Omit<PublicationIssue, 'path'> | null {
  if (!ref) return { code: 'quiz_item_missing', message: 'Eklenen soru bulunamadı.' }
  if (ref.contentType !== 'question') {
    return { code: 'quiz_item_not_question', message: 'Quiz yalnız soru içerir.' }
  }
  if (ref.status !== 'published') {
    return { code: 'quiz_item_not_published', message: 'Quiz yalnız yayındaki soruları içerir.' }
  }
  if (ref.tags.outcomes.length === 0 && ref.tags.primarySkill === null) {
    return {
      code: 'quiz_item_untagged',
      message: 'Kazanım veya beceri etiketi olmayan soru eklenemez.',
    }
  }
  return null
}

/** İlk yayım eksiğini `DomainError` olarak fırlatır; eksik yoksa döner. */
export function assertPublishable(context: PublicationContext): void {
  const [issue] = publicationIssues(context)
  if (issue) throw new DomainError(issue.code, issue.message, { path: [...issue.path] })
}

// --- Onay kuralı --------------------------------------------------------------------------

/**
 * Onay gerekiyor mu (DOM-KYN-031). Yalnız `Kurum özgün` ve kapsamı öğretmenin kendi
 * öğrencileri/sınıfları olan kaynak onaysız yayımlanır; zümre veya kurum kapsamı, alıntı ve
 * lisanslı yayın her zaman onaya girer. Lisans seçilmemişse onay gerekir (kapalı başarısız).
 */
export function requiresReview(license: ResourceLicense | null, shareScope: ShareScope): boolean {
  return !(license?.kind === 'institution_original' && SHARE_SCOPES[shareScope].ownAudience)
}

/**
 * Aktör bu sürümü onaylayabilir mi (DOM-KYN-031, DOM-YTK-027). Yazar ve kaynak sahibi kendi
 * kaynağını onaylayamaz. Yönetici her kaynağı; zümre başkanı (`school`) kendi dersini, akademik
 * koordinatör (`language_school`) kendi seviyesini onaylar.
 */
export function canReview(
  actor: ContentActor,
  resource: Pick<ResourceRecord, 'ownerUserId'>,
  version: Pick<ResourceVersion, 'authorUserId' | 'tags'>,
  institutionType: InstitutionType,
): boolean {
  if (actor.userId === version.authorUserId || actor.userId === resource.ownerUserId) return false
  if (actor.role === 'yonetici') return true
  if (actor.role !== 'ogretmen' || !actor.reviewer) return false
  return institutionType === 'school'
    ? version.tags.subjectId !== null && actor.reviewer.subjectIds.includes(version.tags.subjectId)
    : version.tags.cefrLevel !== null && actor.reviewer.cefrLevels.includes(version.tags.cefrLevel)
}

/**
 * Kaynağı yönetebilir mi: yeni sürüm açma ve arşivleme (DOM-KYN-042). Sahip, yönetici ve
 * kaynağın dersi/seviyesindeki zümre başkanı veya koordinatör.
 */
export function canManage(
  actor: ContentActor,
  resource: Pick<ResourceRecord, 'ownerUserId'>,
  version: Pick<ResourceVersion, 'tags'>,
  institutionType: InstitutionType,
): boolean {
  if (!isContentStaff(actor.role)) return false
  if (actor.userId === resource.ownerUserId || actor.role === 'yonetici') return true
  return canReview(actor, resource, { authorUserId: '', tags: version.tags }, institutionType)
}

/** Personel okuma kararının girdisi; `visibility.ts` `VisibilityContext`'in alt kümesidir. */
export type StaffReadContext = {
  institutionType: InstitutionType
  resource: ResourceRecord
  version: ResourceVersion
}

/**
 * Personel bu sürümü okuyabilir mi (DOM-KYN-030, 040, 042, 051, 052). `visibility.ts`
 * `canReadVersion` personel için bunu çağırır; telif bildirimi de aynı kararla sınırlanır
 * (DOM-KYN-025). Kural bu dosyadadır: `visibility.ts` `resource.ts`'e bağlıdır, tersi döngü doğururdu.
 */
export function staffCanReadVersion(actor: ContentActor, context: StaffReadContext): boolean {
  const { institutionType, resource, version } = context
  if (!isContentStaff(actor.role) || version.resourceId !== resource.id) return false
  const owner = actor.userId === resource.ownerUserId
  const admin = actor.role === 'yonetici'
  switch (version.status) {
    case 'removed':
      // Başlık, menşe ve gerekçe kalır; yalnız sahibi ve yönetici görür (DOM-KYN-051).
      return owner || admin
    case 'draft':
    case 'rejected':
      // Taslak sahibine (ve yazarına) aittir; sahip ayrılınca yöneticiye açılır (DOM-KYN-052).
      return owner || actor.userId === version.authorUserId || (admin && !resource.ownerActive)
    case 'in_review':
      return (
        owner ||
        actor.userId === version.authorUserId ||
        canReview(actor, resource, version, institutionType)
      )
    case 'published':
    case 'archived':
      return owner || admin || sharedWithStaff(actor, resource, version, institutionType)
    default:
      return version.status satisfies never
  }
}

function sharedWithStaff(
  actor: ContentActor,
  resource: ResourceRecord,
  version: ResourceVersion,
  institutionType: InstitutionType,
): boolean {
  const scope: ShareScope = resource.shareScope
  // Zümre başkanı ve koordinatör kendi branşının kaynaklarını okur (DOM-YTK-027).
  if (scope !== 'private' && canReview(actor, resource, version, institutionType)) return true
  switch (scope) {
    case 'institution':
      return true
    case 'department': {
      // Dersi olmayan (dil okulu) içerikte zümre kurumun öğretmenleridir.
      const subjectId = version.tags.subjectId
      return subjectId === null || (actor.subjectIds ?? []).includes(subjectId)
    }
    case 'private':
    case 'students':
    case 'classes':
      return false
    default:
      return scope satisfies never
  }
}

// --- Durum geçişleri ----------------------------------------------------------------------

export const RESOURCE_ACTIONS = {
  submit: { label: 'Onaya gönder' },
  publish: { label: 'Yayımla' },
  withdraw: { label: 'Onaydan geri çek' },
  approve: { label: 'Onayla' },
  reject: { label: 'Reddet' },
  reopen: { label: 'Taslağa döndür' },
  archive: { label: 'Arşivle' },
  report: { label: 'Telif bildirimi' },
} as const
export type ResourceAction = keyof typeof RESOURCE_ACTIONS

/**
 * İzinli sürüm geçişleri (DOM-KYN-025, 030, 031, 051). `publish` onaysız yayın istisnasıdır;
 * `report` telif bildirimiyle yayındaki sürümü incelemeye alır. Kaldırma sürüm değil kaynak
 * düzeyindedir ve `planResourceRemoval` ile yapılır.
 */
const TRANSITIONS = {
  submit: { from: ['draft'], to: 'in_review' },
  publish: { from: ['draft'], to: 'published' },
  withdraw: { from: ['in_review'], to: 'draft' },
  approve: { from: ['in_review'], to: 'published' },
  reject: { from: ['in_review'], to: 'rejected' },
  reopen: { from: ['rejected'], to: 'draft' },
  archive: { from: ['draft', 'rejected', 'published'], to: 'archived' },
  report: { from: ['published'], to: 'in_review' },
} as const satisfies Record<ResourceAction, { from: readonly ResourceStatus[]; to: ResourceStatus }>

export type TransitionInput = {
  action: ResourceAction
  actor: ContentActor
  institutionType: InstitutionType
  resource: ResourceRecord
  version: ResourceVersion
  now: Date | string
  /** Ret ve telif bildiriminde zorunlu. */
  reason?: string | undefined
  itemVersions?: PublicationContext['itemVersions']
}

export type VersionTransition = {
  status: ResourceStatus
  /** Sürüm satırına yazılacak durum kolonları; içerik kolonları hiçbir geçişte değişmez. */
  versionChanges: Partial<ResourceVersionMeta>
  /** Kaynak satırına yazılacak değişiklik (yalnız yayımda güncel sürüm). */
  resourceChanges: Partial<Pick<ResourceRecord, 'currentVersionId'>>
  /**
   * Yayımla birlikte arşive alınacak önceki yayın sürümü (DOM-KYN-032).
   * TODO(F3b): bu sürümün arşiv kolonlarını (`status: 'archived'`, `archivedAt`) servis hesaplar
   * ve aynı transaction'da yazar; core yalnız kimliği döndürür.
   */
  supersededVersionId: string | null
}

const REASON_ACTIONS: readonly ResourceAction[] = ['reject', 'report']

/**
 * Sürüm durum geçişini planlar (DOM-KYN-030…032). Sırayla: geçiş izinli mi, aktör yetkili
 * mi, gerekçe, yayım koşulları. Başarısızlıkta hiçbir şey döndürmez, `DomainError` fırlatır.
 */
export function planVersionTransition(input: TransitionInput): VersionTransition {
  const { action, actor, institutionType, resource, version } = input
  const at = new Date(input.now).toISOString()
  const rule = TRANSITIONS[action]
  if (version.resourceId !== resource.id) {
    throw new DomainError('resource_version_not_found', 'Sürüm bulunamadı.', { kind: 'not_found' })
  }
  // DOM-KYN-025: bildirim yalnız görülen kaynağa yapılır. Görülemeyen kaynak (durumu dahil) var
  // olmamış gibi davranır; yetkisiz rol aşağıda olağan "yetkiniz yok" iletisini alır.
  if (
    action === 'report' &&
    isContentStaff(actor.role) &&
    !staffCanReadVersion(actor, { institutionType, resource, version })
  ) {
    throw new DomainError('resource_not_found', 'İçerik bulunamadı.', { kind: 'not_found' })
  }
  if (!(rule.from as readonly ResourceStatus[]).includes(version.status)) {
    throw new DomainError(
      'resource_transition_invalid',
      `${RESOURCE_STATUSES[version.status].label} durumundaki sürüme "${RESOURCE_ACTIONS[action].label}" uygulanamaz.`,
      { kind: 'conflict' },
    )
  }
  // Bir kez yayımlanmış sürüm (telif bildirimiyle incelemede olsa da) taslağa dönemez: atanmış
  // görevler bu sürüme bağlıdır. İncelemedeki sürüm arşivlenmez (DOM-KYN-030); bildirilen içeriğin
  // sonucu yönetici kararıyla yeniden yayın veya kaynağın kaldırılmasıdır (DOM-KYN-025, 032, 051).
  if (version.publishedAt !== null && (action === 'withdraw' || action === 'reject')) {
    throw new DomainError(
      'version_immutable',
      'Yayımlanmış sürüm taslağa döndürülemez; yeniden yayımlayın, arşivleyin veya kaldırın.',
      { kind: 'conflict' },
    )
  }
  assertActionAllowed(input)

  let reason: string | null = null
  if (REASON_ACTIONS.includes(action)) {
    const parsed = transitionReasonSchema.safeParse(input.reason ?? '')
    if (!parsed.success) {
      throw new DomainError('reason_required', 'Gerekçeyi yazın.', { path: ['reason'] })
    }
    reason = parsed.data
  }
  if (action === 'submit' || action === 'publish' || action === 'approve') {
    assertPublishable({
      institutionType,
      version,
      now: input.now,
      itemVersions: input.itemVersions,
    })
  }
  if (action === 'publish' && requiresReview(version.license, resource.shareScope)) {
    throw new DomainError(
      'review_required',
      'Bu içerik onaydan geçmeden yayımlanamaz; onaya gönderin.',
      { kind: 'forbidden' },
    )
  }

  const toPublished = rule.to === 'published'
  const versionChanges: Partial<ResourceVersionMeta> = { status: rule.to }
  switch (action) {
    case 'submit':
      versionChanges.submittedAt = at
      versionChanges.rejectionReason = null
      break
    case 'publish':
      versionChanges.publishedAt = at
      break
    case 'withdraw':
      versionChanges.submittedAt = null
      break
    case 'approve':
      versionChanges.reviewedByUserId = actor.userId
      versionChanges.reviewedAt = at
      // Telif bildirimi sonrası yeniden onayda ilk yayın anı korunur.
      versionChanges.publishedAt = version.publishedAt ?? at
      break
    case 'reject':
      versionChanges.reviewedByUserId = actor.userId
      versionChanges.reviewedAt = at
      versionChanges.rejectionReason = reason
      break
    case 'reopen':
      break
    case 'archive':
      versionChanges.archivedAt = at
      break
    case 'report':
      versionChanges.submittedAt = at
      break
    default:
      action satisfies never
  }
  const supersededVersionId =
    toPublished && resource.currentVersionId !== null && resource.currentVersionId !== version.id
      ? resource.currentVersionId
      : null
  return {
    status: rule.to,
    versionChanges,
    resourceChanges: toPublished ? { currentVersionId: version.id } : {},
    supersededVersionId,
  }
}

function assertActionAllowed(input: TransitionInput): void {
  const { action, actor, institutionType, resource, version } = input
  const forbidden = (message: string): never => {
    throw new DomainError('resource_action_forbidden', message, { kind: 'forbidden' })
  }
  if (!isContentStaff(actor.role)) forbidden('Bu işlem için yetkiniz yok.')
  switch (action) {
    case 'submit':
    case 'publish':
    case 'withdraw':
    case 'reopen':
      if (actor.userId !== version.authorUserId) forbidden('Bu işlemi yalnız sürümün yazarı yapar.')
      return
    case 'approve':
    case 'reject':
      if (!canReview(actor, resource, version, institutionType)) {
        forbidden(
          actor.userId === version.authorUserId || actor.userId === resource.ownerUserId
            ? 'Kendi içeriğinizi onaylayamazsınız.'
            : 'Bu içeriği onaylama yetkiniz yok.',
        )
      }
      // DOM-KYN-025: telif bildirimiyle incelemeye alınan (önceden yayımlanmış) içeriği yeniden
      // yayına yalnız yönetici alır; zümre başkanı ve koordinatör yalnız ilk yayını onaylar.
      if (action === 'approve' && version.publishedAt !== null && actor.role !== 'yonetici') {
        forbidden('Telif bildirimi incelenen içeriği yalnız yönetici yeniden yayına alır.')
      }
      return
    case 'archive':
      if (!canManage(actor, resource, version, institutionType)) {
        forbidden('Bu içeriği yalnız sahibi, zümre başkanı veya yönetici arşivler.')
      }
      return
    case 'report':
      return
    default:
      action satisfies never
  }
}

// --- Kaldırma -----------------------------------------------------------------------------

export type ResourceRemovalInput = {
  actor: ContentActor
  resource: ResourceRecord
  /** Kaynağın bütün sürümleri (arşivliler dahil); başka kaynağın sürümü yok sayılır. */
  versions: readonly ResourceVersion[]
  /** Servisin bildiği kopyalar (`derived_from_version_id` dolu kaynaklar); süzme burada yapılır. */
  copies?: readonly Pick<ResourceRecord, 'id' | 'derivedFromVersionId'>[] | undefined
  /** Bu kaynağın soru sürümlerini içerebilecek quiz ve alıştırma seti sürümleri. */
  containers?: readonly Pick<ResourceVersion, 'id' | 'content'>[] | undefined
  reason: string
  now: Date | string
}

export type ResourceRemovalPlan = {
  /** `removed` yapılacak bütün sürümler; içerik ve cevap anahtarı kolonları temizlenir. */
  versionIds: string[]
  versionChanges: Pick<ResourceVersionMeta, 'status' | 'removedAt' | 'removalReason'>
  /** Silinecek dosyalar (ADR 0003 karar 13: kaynak kaldırılınca materyal dosyası silinir). */
  fileIds: string[]
  /** Kaldırılan sürümlerden türetilmiş kopyalar; yönetici bunları ayrıca inceler (DOM-KYN-050). */
  affectedCopyIds: string[]
  /** Kaldırılan soruyu içeren quiz/alıştırma seti sürümleri; geçmiş görevde "kaldırıldı" görünür. */
  affectedContainerVersionIds: string[]
  /** Başlık, menşe, gerekçe ve tarih kalır; içerik ve dosyalar silinir (DOM-KYN-051). */
  clearContent: true
}

/**
 * Kaynağı kaldırmayı planlar (DOM-KYN-025, 051; ADR 0003 karar 13). Kaldırma sürüm değil kaynak
 * düzeyindedir: arşivdeki eski sürüm de ihlali taşıdığından bütün sürümler birlikte kaldırılır.
 * Yalnız yönetici, gerekçeyle. Saf fonksiyondur; yazma, dosya silme ve denetim kaydı servistedir.
 */
export function planResourceRemoval(input: ResourceRemovalInput): ResourceRemovalPlan {
  const { actor, resource } = input
  if (actor.role !== 'yonetici') {
    throw new DomainError('resource_action_forbidden', 'İçeriği yalnız yönetici kaldırır.', {
      kind: 'forbidden',
    })
  }
  const own = input.versions.filter((v) => v.resourceId === resource.id)
  if (own.length === 0) {
    throw new DomainError('resource_version_not_found', 'Sürüm bulunamadı.', { kind: 'not_found' })
  }
  if (own.some((v) => v.status === 'removed')) {
    throw new DomainError('resource_removed', 'Bu içerik zaten kaldırıldı.', { kind: 'conflict' })
  }
  const parsed = transitionReasonSchema.safeParse(input.reason)
  if (!parsed.success) {
    throw new DomainError('reason_required', 'Gerekçeyi yazın.', { path: ['reason'] })
  }
  const versionIds = [...own].sort((a, b) => a.versionNumber - b.versionNumber).map((v) => v.id)
  const removedIds = new Set(versionIds)
  const fileIds = distinct(own.flatMap((v) => contentFileRefs(v.content).map((ref) => ref.fileId)))
  const affectedCopyIds = (input.copies ?? [])
    .filter(
      (copy) => copy.derivedFromVersionId !== null && removedIds.has(copy.derivedFromVersionId),
    )
    .map((copy) => copy.id)
  const affectedContainerVersionIds = (input.containers ?? [])
    .filter(
      ({ content }) =>
        (content.type === 'quiz' || content.type === 'exercise_set') &&
        content.items.some((item) => removedIds.has(item.questionVersionId)),
    )
    .map((container) => container.id)
  return {
    versionIds,
    versionChanges: {
      status: 'removed',
      removedAt: new Date(input.now).toISOString(),
      removalReason: parsed.data,
    },
    fileIds,
    affectedCopyIds,
    affectedContainerVersionIds,
    clearContent: true,
  }
}

// --- Taslak düzenleme ve yeni sürüm -------------------------------------------------------

/** Kopya ve uyarlamada miras alınan menşe; yazar silemez ve değiştiremez (DOM-KYN-024, 050). */
export type Lineage = Pick<ResourceVersionData, 'license' | 'attributions'>

const sameAttribution = (a: Attribution, b: Attribution) =>
  a.work === b.work && a.author === b.author && a.source === b.source && a.year === b.year

/** İki lisans bütün alanlarıyla aynı mı; lisans nesneleri düzdür (yalnız ilkel değerler). */
function sameLicense(a: ResourceLicense, b: ResourceLicense | null): boolean {
  if (b === null) return false
  const left = Object.entries(a)
  const right: Record<string, unknown> = { ...b }
  return (
    left.length === Object.keys(right).length &&
    left.every(([key, value]) => Object.hasOwn(right, key) && right[key] === value)
  )
}

/**
 * Miras kaynak gösterimleri ve lisans korunmuş mu; değilse reddeder (DOM-KYN-024, 050). Lisans
 * yalnız türüyle değil bütün alanlarıyla (bitiş tarihi, kitap sahibi sınırı, uyarlama izni, açık
 * lisans adı …) kaynağınkiyle aynı kalır: kopyalayan sözleşmeyi genişletemez.
 */
export function assertLineagePreserved(lineage: Lineage, next: ResourceVersionData): void {
  if (lineage.license !== null && !sameLicense(lineage.license, next.license)) {
    throw new DomainError(
      'license_inherited',
      'Kopyalanan içeriğin menşe ve lisans bilgisi değiştirilemez.',
      { path: ['license'] },
    )
  }
  for (const attribution of lineage.attributions) {
    if (!next.attributions.some((candidate) => sameAttribution(candidate, attribution))) {
      throw new DomainError(
        'attribution_inherited',
        'Kopyalanan içeriğin kaynak gösterimi silinemez.',
        { path: ['attributions'] },
      )
    }
  }
}

export type DraftUpdateInput = {
  actor: ContentActor
  resource: Pick<ResourceRecord, 'id' | 'contentType'>
  version: ResourceVersion
  input: ResourceVersionInput
  /** Türetilmiş kaynakta kaynak sürümün menşesi (`derived_from_*`). */
  lineage?: Lineage | undefined
}

/**
 * Taslağın içeriğini değiştirir. Yalnız yazar ve yalnız `Taslak`/`Reddedildi` sürümde; yayımlanmış,
 * incelemedeki ve arşivdeki sürüm değişmez (DOM-KYN-032). Reddedilen sürüm düzenlenince taslağa
 * döner (DOM-KYN-030). Döndürülen değer sürüm satırına yazılacak içerik ve durumdur.
 */
export function planDraftUpdate({ actor, resource, version, input, lineage }: DraftUpdateInput): {
  data: ResourceVersionData
  status: 'draft'
} {
  if (
    !(EDITABLE_STATUSES as readonly ResourceStatus[]).includes(version.status) ||
    version.publishedAt !== null
  ) {
    throw new DomainError(
      'version_immutable',
      'Yayımlanmış veya incelemedeki sürüm değiştirilemez; yeni sürüm açın.',
      { kind: 'conflict' },
    )
  }
  if (actor.userId !== version.authorUserId) {
    throw new DomainError('resource_action_forbidden', 'Taslağı yalnız yazarı düzenler.', {
      kind: 'forbidden',
    })
  }
  const data = resourceVersionInputSchema.parse(input)
  if (data.content.type !== resource.contentType) {
    throw new DomainError('content_type_immutable', 'İçerik türü değiştirilemez.', {
      path: ['content', 'type'],
    })
  }
  if (lineage) assertLineagePreserved(lineage, data)
  return { data, status: 'draft' }
}

export type NewVersionInput = {
  actor: ContentActor
  institutionType: InstitutionType
  resource: ResourceRecord
  /** Kaynağın bütün sürümleri (yalnız durum ve numara okunur). */
  versions: readonly ResourceVersion[]
  versionId: string
  now: Date | string
}

/**
 * Düzenleme için yeni taslak sürüm açar (DOM-KYN-032): güncel yayındaki sürümün (yoksa son
 * sürümün) içeriği kopyalanır, numara bir artar. Kaynakta açık sürüm varken ikincisi açılmaz;
 * kaldırılmış kaynak yeniden açılmaz.
 */
export function planNewVersion(input: NewVersionInput): ResourceVersion {
  const { actor, institutionType, resource, versions } = input
  const own = versions.filter((v) => v.resourceId === resource.id)
  const base =
    own.find((v) => v.id === resource.currentVersionId) ??
    [...own].sort((a, b) => b.versionNumber - a.versionNumber)[0]
  if (!base) {
    throw new DomainError('resource_version_not_found', 'Sürüm bulunamadı.', { kind: 'not_found' })
  }
  if (!canManage(actor, resource, base, institutionType)) {
    throw new DomainError(
      'resource_action_forbidden',
      'Bu içeriği yalnız sahibi, zümre başkanı veya yönetici düzenler.',
      { kind: 'forbidden' },
    )
  }
  if (own.some((v) => v.status === 'removed')) {
    throw new DomainError('resource_removed', 'Kaldırılan içerik düzenlenemez.', {
      kind: 'conflict',
    })
  }
  if (own.some((v) => (OPEN_STATUSES as readonly ResourceStatus[]).includes(v.status))) {
    throw new DomainError(
      'open_version_exists',
      'Bu içeriğin üzerinde çalışılan bir sürümü zaten var.',
      { kind: 'conflict' },
    )
  }
  const versionNumber = Math.max(...own.map((v) => v.versionNumber)) + 1
  return {
    ...versionData(base),
    ...emptyMeta(input.versionId, resource.id, versionNumber, actor.userId, input.now),
  }
}

export type NewResourceInput = {
  actor: ContentActor
  input: ResourceVersionInput
  shareScope?: ShareScope | undefined
  ids: { resourceId: string; versionId: string }
  now: Date | string
}

/**
 * Yeni kaynak ve ilk taslak sürümü (DOM-KYN-001): sahip ve yazar işlemi yapan kişidir,
 * kapsam varsayılan olarak `Yalnız ben`dir. Paylaşım hedefleri `content/visibility.ts`'te denetlenir.
 */
export function planNewResource({
  actor,
  input,
  shareScope = 'private',
  ids,
  now,
}: NewResourceInput): { resource: ResourceRecord; version: ResourceVersion } {
  if (!isContentStaff(actor.role)) {
    throw new DomainError('resource_action_forbidden', 'İçerik oluşturma yetkiniz yok.', {
      kind: 'forbidden',
    })
  }
  const data = resourceVersionInputSchema.parse(input)
  return {
    resource: {
      id: ids.resourceId,
      contentType: data.content.type,
      ownerUserId: actor.userId,
      ownerActive: true,
      shareScope,
      sharedStudentIds: [],
      sharedClassIds: [],
      currentVersionId: null,
      derivedFromVersionId: null,
      derivedFromPlatformVersionId: null,
    },
    version: { ...data, ...emptyMeta(ids.versionId, ids.resourceId, 1, actor.userId, now) },
  }
}

export function versionData(version: ResourceVersionData): ResourceVersionData {
  return {
    title: version.title,
    content: version.content,
    answerKey: version.answerKey,
    tags: version.tags,
    license: version.license,
    attributions: version.attributions,
  }
}

function emptyMeta(
  id: string,
  resourceId: string,
  versionNumber: number,
  authorUserId: string,
  now: Date | string,
): ResourceVersionMeta {
  return {
    id,
    resourceId,
    versionNumber,
    status: 'draft',
    authorUserId,
    createdAt: new Date(now).toISOString(),
    submittedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    publishedAt: null,
    archivedAt: null,
    removedAt: null,
    removalReason: null,
  }
}

// --- Dosya bağlantıları -------------------------------------------------------------------

/**
 * İçeriğin bağladığı dosyalar ve kabul edilen amaçları (ADR 0003 karar 3, 5). Servis her
 * dosyanın aynı kurumda, `ready` ve bu amaçlardan biriyle yüklenmiş olduğunu denetler.
 */
export function contentFileRefs(
  content: ResourceContent,
): { fileId: string; purposes: readonly FilePurpose[] }[] {
  switch (content.type) {
    case 'text':
    case 'worksheet':
      return content.fileId === null ? [] : [{ fileId: content.fileId, purposes: ['material'] }]
    case 'file':
    case 'video':
      return [{ fileId: content.fileId, purposes: ['material'] }]
    case 'audio':
      return [{ fileId: content.fileId, purposes: ['listening_audio', 'material'] }]
    case 'question': {
      const image = 'imageFileId' in content.question ? content.question.imageFileId : null
      return image === null ? [] : [{ fileId: image, purposes: ['question_image'] }]
    }
    case 'reading_passage':
    case 'link':
    case 'book_reference':
    case 'quiz':
    case 'exercise_set':
    case 'homework_template':
      return []
    default:
      return content satisfies never
  }
}

// --- Öğrenci ve veli görünümü -------------------------------------------------------------

/** Öğrenci ve velinin gördüğü sürüm: cevap anahtarı ve lisans sözleşme ayrıntısı yoktur. */
export type LearnerResourceView = Pick<
  ResourceVersion,
  'id' | 'resourceId' | 'title' | 'tags' | 'attributions'
> & {
  content: ResourceContent
  licenseKind: ResourceLicense['kind'] | null
}

/** `[0, 1)` aralığında sayı üreten kaynak (`Math.random` imzası). Core rastgelelik üretmez. */
export type RandomSource = () => number

/** FNV-1a; tohum metnini 32 bit başlangıç durumuna çevirir. */
function hash(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * Tohumlu deterministik üreteç (mulberry32). Servis tohumu deneme veya atama kimliğinden verir;
 * böylece sayfa yenilenince aynı öğrenci aynı sırayı görür, testler sabit sonuç alır.
 */
export function seededRandom(seed: string): RandomSource {
  let state = hash(seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * Listeyi karıştırır. Önce anahtara göre dizilir: yazarın girdiği sıra sonuca hiç sızmaz. Ardından
 * Fisher–Yates. `reveal` verilirse (doğru cevabı ele veren sıra) ve karışım ona eşit çıkarsa bir
 * adım döndürülür; ayrık öğelerde döndürülmüş dizi hiçbir konumda eskisiyle eşleşmez, iki öğeli
 * sıralama da böylece hiçbir zaman doğru sırada görünmez.
 */
function shuffled<T>(
  list: readonly T[],
  key: (item: T) => string,
  random: RandomSource,
  reveal?: readonly string[],
): T[] {
  // Anahtarlar tekildir (şema kimlikleri ve boşluk seçeneklerini tekilleştirir); eşitlik yoktur.
  const result = [...list].sort((a, b) => (key(a) < key(b) ? -1 : 1))
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(random() * (i + 1)))
    const a = result[i]
    const b = result[j]
    if (a !== undefined && b !== undefined) {
      result[i] = b
      result[j] = a
    }
  }
  if (
    reveal !== undefined &&
    result.length > 1 &&
    reveal.every((value, index) => result[index] !== undefined && key(result[index]) === value)
  ) {
    const first = result.shift()
    if (first !== undefined) result.push(first)
  }
  return result
}

const byId = (item: { id: string }) => item.id
const byText = (value: string) => value

/**
 * Soru gövdesini öğrenciye göstermek için karıştırır. Sıralama öğeleri doğru sırada, eşleştirme
 * seçenekleri öncül sırasıyla hizalı görünmez; bu iki türde eşitlik cevabı ele verir. Çoktan
 * seçmeli seçenekler ve kapalı boşluk listesi tekdüze karışır: özgün sırayı yasaklamak doğru
 * seçeneğin özgün konumunda görünme olasılığını düşürür, bu da ayrı bir ipucudur.
 */
function shuffleQuestion(
  question: QuestionBody,
  key: AnswerKey | null,
  random: RandomSource,
): QuestionBody {
  switch (question.questionType) {
    case 'multiple_choice':
      return { ...question, options: shuffled(question.options, byId, random) }
    case 'gap_fill':
      return {
        ...question,
        gaps: question.gaps.map((gap) => ({
          ...gap,
          options: shuffled(gap.options, byText, random),
        })),
      }
    case 'ordering': {
      const order = key?.questionType === 'ordering' ? key.order : question.items.map(byId)
      return { ...question, items: shuffled(question.items, byId, random, order) }
    }
    case 'matching': {
      const pairs = key?.questionType === 'matching' ? key.pairs : []
      const aligned = question.prompts.map(
        (prompt) => pairs.find((pair) => pair.promptId === prompt.id)?.choiceId ?? '',
      )
      return { ...question, choices: shuffled(question.choices, byId, random, aligned) }
    }
    case 'true_false':
    case 'short_answer':
      return question
    default:
      return question satisfies never
  }
}

export type LearnerViewOptions = {
  /**
   * Seçenek ve öğe karıştırmasının rastgelelik kaynağı (zorunlu: core saf kalır). Servis
   * `seededRandom(denemeKimliği)` verir.
   */
  random: RandomSource
  /**
   * Dinleme görevinin dökümü ve altyazısı varsayılan olarak gizlidir (DOM-KYN-003, DOM-BEC-005).
   * Servis görev kapanınca veya öğretmenin erişilebilirlik uyarlamasında `true` verir.
   */
  showTranscript?: boolean | undefined
}

/**
 * Dinleme becerisini ölçen içerik mi. Ses ve videonun birincil becerisi dört temel beceriden
 * biridir (`publicationIssues`); aracılık birincil beceri olamadığı için yalnız dinleme bakılır.
 */
const isListeningTask = (tags: ResourceTags) => tags.primarySkill === 'listening'

/**
 * Öğrenci/veli görünümü: `answerKey` (doğru cevap ve çözüm açıklaması) ve lisans ayrıntısı
 * ayıklanır, kaynak gösterimi korunur (DOM-KYN-024). Soru seçenekleri ve öğeleri `random` ile
 * karıştırılır (`shuffleQuestion`). Dinleme görevinde döküm ve altyazı `showTranscript`
 * verilmedikçe gizlenir; dinleme dışındaki ses ve videoda döküm erişilebilirlik içindir, hep
 * görünür (DOM-KYN-003).
 */
export function learnerView(
  version: ResourceVersion,
  options: LearnerViewOptions,
): LearnerResourceView {
  let content: ResourceContent = version.content
  if (
    (content.type === 'audio' || content.type === 'video') &&
    isListeningTask(version.tags) &&
    options.showTranscript !== true
  ) {
    content = { ...content, transcript: null, captionsVtt: null }
  }
  if (content.type === 'question') {
    content = {
      ...content,
      question: shuffleQuestion(content.question, version.answerKey, options.random),
    }
  }
  return {
    id: version.id,
    resourceId: version.resourceId,
    title: version.title,
    content,
    tags: version.tags,
    attributions: version.attributions,
    licenseKind: version.license?.kind ?? null,
  }
}

// --- Arama ve sözcük sayısı ---------------------------------------------------------------

/**
 * Arama metni normalleştirmesi (ADR 0004 açık soru 5a: `simple` yapılandırma + normalleştirme).
 * NFKD ile uyumluluk biçimleri açılır, Türkçe kurala göre küçültülür (`I` → `ı`, `İ` → `i`),
 * aksanlar atılır ve `ı` `i`'ye katlanır;
 * böylece "IŞIK", "ışık" ve "isik", İngilizce "Island" ve "island" aynı terime iner. Harf ve
 * rakam dışındaki her şey tek boşluk olur; çıktı `to_tsvector('simple', …)` girdisidir.
 */
export function normalizeSearchText(value: string): string {
  // NFKD önce: uyumluluk biçimleri (ﬁ, Ａ, ℌ) sade harfe iner, büyük harf çıkarsa küçültülür.
  // `İ` → `I` + nokta; Türkçe küçültme bunu `i` yapar, kalan işaretler atılır.
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('tr')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replaceAll('ı', 'i')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Arama kutusu metninden sorgu terimleri: normalleştirilmiş, tekil, en fazla 8 terim. Terimler
 * yalnız harf ve rakam içerir; API bunları `to_tsquery('simple', 'terim:* & …')` önek sorgusuna
 * parametre olarak verir, kullanıcı metni sorgu sözdizimine karışmaz.
 */
export function searchQueryTerms(query: string): string[] {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean)
  return distinct(terms).slice(0, 8)
}

/**
 * Sürümün aranabilir metni (karar 3: başlık ve metin). Cevap anahtarı, çözüm açıklaması ve
 * dinleme dökümü girmez: arama sonucu cevabı veya dinlenecek metni açığa çıkarmamalı.
 */
export function searchDocument(version: ResourceVersionData): string {
  const parts: string[] = [version.title]
  const { content } = version
  switch (content.type) {
    case 'text':
    case 'worksheet':
      if (content.body !== null) parts.push(content.body)
      break
    case 'reading_passage':
      parts.push(content.body)
      break
    case 'link':
      if (content.provider !== null) parts.push(content.provider)
      break
    case 'book_reference':
      parts.push(content.publisher, content.bookTitle, content.pages)
      if (content.isbn !== null) parts.push(content.isbn)
      break
    case 'question': {
      const question = content.question
      parts.push(question.stem.replace(GAP_MARKER, ' '))
      if (question.questionType === 'multiple_choice') {
        parts.push(...question.options.map((o) => o.text))
      }
      break
    }
    case 'homework_template':
      parts.push(content.instructions)
      break
    case 'audio':
    case 'video':
    case 'file':
    case 'quiz':
    case 'exercise_set':
      break
    default:
      content satisfies never
  }
  for (const attribution of version.attributions) parts.push(attribution.work, attribution.author)
  return normalizeSearchText(parts.join(' '))
}

/**
 * Sözcük sayısı (DOM-KYN-002 okuma parçası, DOM-BEC-046 yazma teslimi: sistem hesaplar,
 * saklanmaz). Kesme ve tireyle bağlı parçalar ("Ankara'da", "don't", "well-known") tek sözcüktür.
 * Metin önce NFC'ye getirilir; birleşmeyen işaretler (`\p{M}`) harfin parçası sayılır, böylece
 * ayrışık yazılmış "İ" sözcüğü bölmez. Unicode tire (U+2010, U+2011) ASCII tire gibidir.
 * Hermes `Intl.Segmenter` desteklemediği için düzenli ifade kullanılır; web, mobil ve API aynı sayar.
 */
export function wordCount(value: string): number {
  return (
    value.normalize('NFC').match(/[\p{L}\p{M}\p{N}]+(?:['’‐‑-][\p{L}\p{M}\p{N}]+)*/gu)?.length ?? 0
  )
}
