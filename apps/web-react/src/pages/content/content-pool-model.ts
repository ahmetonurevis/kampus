// İçerik havuzu ekranının saf modeli: satır, etiket, süzgeç seçenekleri ve taslak formu. Kural
// core `content/` içindedir (taksonomi, `resourceVersionInputSchema`); burada yalnız sunum vardır.
import { z } from 'zod'
import {
  isAuthorableType,
  type AuthorableType,
  type StaffResourceListItem,
  type StaffResourceVersion,
} from '@kampus/react-shared/resource-model.ts'
import {
  RESOURCE_STATUSES,
  resourceVersionInputSchema,
  transitionReasonSchema,
  type ResourceStatus,
} from '@kampus/school-core/content/resource.ts'
import {
  CEFR_LEVELS,
  CONTENT_TYPES,
  GRADE_LEVEL_RANGE,
  LICENSE_KINDS,
  OPEN_LICENSES,
  OUTCOME_SOURCES,
  PRIMARY_SKILLS,
  SHARE_SCOPES,
  SKILLS,
  type ContentType,
  type LicenseKind,
} from '@kampus/school-core/content/taxonomy.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

export const STATUS_TONES = {
  draft: 'gray',
  in_review: 'amber',
  published: 'green',
  rejected: 'red',
  archived: 'gray',
  removed: 'gray',
} as const satisfies Record<ResourceStatus, BadgeTone>

export const statusLabel = (status: ResourceStatus) => RESOURCE_STATUSES[status].label
export const typeLabel = (type: ContentType) => CONTENT_TYPES[type].label
export const licenseLabel = (kind: LicenseKind | null) =>
  kind === null ? 'Seçilmedi' : LICENSE_KINDS[kind].label
export const shareScopeLabel = (scope: keyof typeof SHARE_SCOPES) => SHARE_SCOPES[scope].label
export const skillLabel = (skill: keyof typeof SKILLS) => SKILLS[skill].label

type Tags = StaffResourceListItem['version']['tags']

/** "B1 · Okuma" ya da "7. sınıf · İngilizce": süzgeçte kullanılan etiketlerin kısa özeti. */
export function tagSummary(tags: Tags, subjectNames: ReadonlyMap<string, string>): string {
  const parts: string[] = []
  if (tags.subjectId) parts.push(subjectNames.get(tags.subjectId) ?? tags.subjectId)
  if (tags.gradeLevels.length > 0) parts.push(`${tags.gradeLevels.join(', ')}. sınıf`)
  if (tags.cefrLevel) parts.push(tags.cefrLevel)
  if (tags.primarySkill) parts.push(skillLabel(tags.primarySkill))
  return parts.length > 0 ? parts.join(' · ') : '—'
}

export type ResourceRow = {
  id: string
  title: string
  type: string
  tags: string
  status: string
  statusKey: ResourceStatus
  license: string
  updatedAt: string
}

export function resourceRow(
  item: StaffResourceListItem,
  subjectNames: ReadonlyMap<string, string>,
): ResourceRow {
  return {
    id: item.id,
    title: item.version.title,
    type: typeLabel(item.contentType),
    tags: tagSummary(item.version.tags, subjectNames),
    status: statusLabel(item.version.status),
    statusKey: item.version.status,
    license: licenseLabel(item.version.licenseKind),
    updatedAt: item.updatedAt,
  }
}

const options = <T extends string>(record: Record<T, { label: string }>) =>
  (Object.keys(record) as T[]).map((value) => ({ value, label: record[value].label }))

export const TYPE_OPTIONS = options(CONTENT_TYPES)
export const CEFR_OPTIONS = options(CEFR_LEVELS)
export const SKILL_OPTIONS = PRIMARY_SKILLS.map((value) => ({ value, label: SKILLS[value].label }))
export const STATUS_OPTIONS = (
  ['draft', 'in_review', 'published', 'rejected', 'archived'] as const
).map((value) => ({ value, label: RESOURCE_STATUSES[value].label }))
export const GRADE_OPTIONS = Array.from(
  { length: GRADE_LEVEL_RANGE.max - GRADE_LEVEL_RANGE.min + 1 },
  (_, index) => {
    const value = GRADE_LEVEL_RANGE.min + index
    return { value, label: `${value}. sınıf` }
  },
)

// --- Taslak formu -------------------------------------------------------------------------

/** Bu dilimde oluşturulabilen türler (diğerleri TODO(F3c2) ile sonraki dilimde). */
export const AUTHORABLE_OPTIONS: { value: AuthorableType; label: string }[] = [
  { value: 'reading_passage', label: CONTENT_TYPES.reading_passage.label },
  { value: 'question', label: `${CONTENT_TYPES.question.label} (çoktan seçmeli)` },
]

// TODO(F3c2): lisanslı yayın (sözleşme, kapsam, bitiş günü) ve Kampüs örnek içeriğinden
// türetilen menşe, kütüphane ve kopya akışıyla birlikte eklenir.
export const FORM_LICENSE_KINDS = [
  'institution_original',
  'contains_quotation',
  'open_license',
  'public_domain',
] as const satisfies readonly LicenseKind[]
export const LICENSE_OPTIONS = FORM_LICENSE_KINDS.map((value) => ({
  value,
  label: LICENSE_KINDS[value].label,
}))
export const OPEN_LICENSE_OPTIONS = options(OPEN_LICENSES)
export const OUTCOME_SOURCE_OPTIONS = options(OUTCOME_SOURCES)

/** Telif notu: lisans türünün ne istediği (DOM-KYN-020, 022, 024). */
export const LICENSE_NOTES: Record<(typeof FORM_LICENSE_KINDS)[number], string> = {
  institution_original: 'Kurumda üretildi, başka eserden alıntı yok.',
  contains_quotation:
    'Alıntı içeriğin ayırt edilebilir bölümüdür; eser adı, eser sahibi ve alındığı yer kaynak gösteriminde yazılır (DOM-KYN-022).',
  open_license:
    'Ticari kullanıma izin veren açık lisans (NC ve ND lisansları kabul edilmez); kaynak gösterimi zorunludur.',
  public_domain: 'Eserin koruma süresi dolmuştur; dayanağı yazın ve kaynak gösterin.',
}

export const requiresAttribution = (kind: LicenseKind | undefined) =>
  kind !== undefined && LICENSE_KINDS[kind].requiresAttribution

/** Primary beceri seçenekleri: aracılık bu dilimde yok; okuma parçasında dil kullanımı birincil olamaz. */
export function skillOptionsFor(type: AuthorableType) {
  return SKILL_OPTIONS.filter(
    (option) =>
      option.value !== 'mediation' && (type === 'question' || option.value !== 'language_use'),
  )
}

/**
 * Form şeması: core sürüm girdisi + formun kuralları. Taslak eksik kaydedilebilir (API bunu
 * kabul eder) ama lisans bu ekranda zorunludur; yalnız bu dilimde oluşturulabilen türler ve
 * çoktan seçmeli soru kabul edilir.
 */
export const draftFormSchema = resourceVersionInputSchema.superRefine((value, ctx) => {
  if (value.license === null) {
    ctx.addIssue({ code: 'custom', message: 'Menşe ve lisans türünü seçin.', path: ['license'] })
  }
  if (!isAuthorableType(value.content.type)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Bu içerik türü henüz oluşturulamaz.',
      path: ['content', 'type'],
    })
  } else if (value.content.type === 'question') {
    if (value.content.question.questionType !== 'multiple_choice') {
      ctx.addIssue({
        code: 'custom',
        message: 'Bu soru türü henüz oluşturulamaz.',
        path: ['content', 'question', 'questionType'],
      })
    }
    if (value.answerKey === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Doğru seçeneği işaretleyin.',
        path: ['answerKey', 'correctOptionId'],
      })
    }
  }
})
export type DraftFormInput = z.input<typeof draftFormSchema>
export type DraftFormOutput = z.output<typeof draftFormSchema>

/**
 * Form değerleri: core girdisinin düz (birleşimsiz) hâli. `register` yolları tipli kalsın diye
 * içerik ve cevap anahtarı yalnız bu dilimde yazılabilen iki türü taşır; doğrulayan yine core
 * şemasıdır (`draftFormSchema`, çözümleyicide tek çevrim).
 */
export type DraftFormValues = Omit<DraftFormInput, 'content' | 'answerKey'> & {
  content: {
    type: AuthorableType
    body?: string
    question?: {
      questionType: 'multiple_choice'
      stem: string
      options: { id: string; text: string }[]
      imageFileId: null
    }
  }
  answerKey: {
    questionType: 'multiple_choice'
    correctOptionId: string
    explanation: string
  } | null
}

/** Seçenek kimlikleri `a`, `b`, … biçiminde üretilir (core kimlik kuralına uyar). */
export const OPTION_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
export const MIN_OPTIONS = 4
export const MAX_OPTIONS = OPTION_IDS.length

/** Kullanılmayan ilk kimlik (`a`..`h`); seçenek eklerken yeni seçeneğe verilir. */
export const nextOptionId = (used: readonly string[]) =>
  OPTION_IDS.find((id) => !used.includes(id)) ?? null

const emptyTags = {
  subjectId: null,
  gradeLevels: [],
  cefrLevel: null,
  primarySkill: null,
  outcomes: [],
} satisfies NonNullable<DraftFormInput['tags']>

export function defaultDraft(type: AuthorableType): DraftFormValues {
  if (type === 'reading_passage') {
    return {
      title: '',
      content: { type: 'reading_passage', body: '' },
      answerKey: null,
      tags: { ...emptyTags, primarySkill: 'reading' },
      license: null,
      attributions: [],
    }
  }
  return {
    title: '',
    content: {
      type: 'question',
      question: {
        questionType: 'multiple_choice',
        stem: '',
        options: OPTION_IDS.slice(0, MIN_OPTIONS).map((id) => ({ id, text: '' })),
        imageFileId: null,
      },
    },
    answerKey: { questionType: 'multiple_choice', correctOptionId: 'a', explanation: '' },
    tags: { ...emptyTags },
    license: null,
    attributions: [],
  }
}

/**
 * Sunucudaki baş sürümden form değerleri; desteklenmeyen tür/soru biçimi veya kaldırılmış
 * (içeriksiz) sürüm için `null`. Eksik taslak (ör. lisans henüz yok) düzenlenebilir.
 */
export function draftFromHead(head: StaffResourceVersion): DraftFormValues | null {
  const parsed = resourceVersionInputSchema.safeParse({
    title: head.title,
    content: head.content,
    answerKey: head.answerKey,
    tags: head.tags,
    license: head.license,
    attributions: head.attributions,
  })
  if (!parsed.success) return null
  const { content, answerKey, ...rest } = parsed.data
  if (content.type === 'reading_passage')
    return { ...rest, content: { type: 'reading_passage', body: content.body }, answerKey: null }
  if (content.type === 'question' && content.question.questionType === 'multiple_choice') {
    const key = answerKey?.questionType === 'multiple_choice' ? answerKey : null
    return {
      ...rest,
      content: {
        type: 'question',
        question: {
          questionType: 'multiple_choice',
          stem: content.question.stem,
          options: content.question.options.map(({ id, text }) => ({ id, text })),
          imageFileId: null,
        },
      },
      answerKey: {
        questionType: 'multiple_choice',
        correctOptionId: key?.correctOptionId ?? content.question.options[0]?.id ?? 'a',
        explanation: key?.explanation ?? '',
      },
    }
  }
  return null
}

/** PATCH gövdesi: taslağın bütün alanları (tür değişmez). */
export function patchFromDraft(values: DraftFormOutput) {
  return {
    title: values.title,
    content: values.content,
    answerKey: values.answerKey,
    tags: values.tags,
    license: values.license,
    attributions: values.attributions,
  }
}

export const rejectSchema = z.object({ reason: transitionReasonSchema })
export type RejectInput = z.input<typeof rejectSchema>

export const isEnglishContent = (tags: Tags) =>
  tags.subjectId === 'english' || tags.cefrLevel !== null || tags.primarySkill === 'language_use'

export type ContentPreview =
  | { kind: 'reading'; body: string }
  | {
      kind: 'question'
      stem: string
      options: { id: string; text: string; correct: boolean }[]
      explanation: string
    }
  | { kind: 'other' }
  | { kind: 'removed' }

/** Panel önizlemesi: okuma metni ya da soru (kök, seçenekler, doğru işaretli); diğer türler yalnız künye. */
export function previewFromHead(head: StaffResourceVersion): ContentPreview {
  if (head.status === 'removed' || head.content === null) return { kind: 'removed' }
  const parsed = resourceVersionInputSchema.safeParse({
    title: head.title,
    content: head.content,
    answerKey: head.answerKey,
    tags: head.tags,
    license: head.license,
    attributions: head.attributions,
  })
  if (!parsed.success) return { kind: 'other' }
  const { content, answerKey } = parsed.data
  if (content.type === 'reading_passage') return { kind: 'reading', body: content.body }
  if (content.type === 'question' && content.question.questionType === 'multiple_choice') {
    const correct = answerKey?.questionType === 'multiple_choice' ? answerKey.correctOptionId : null
    return {
      kind: 'question',
      stem: content.question.stem,
      options: content.question.options.map((option) => ({
        id: option.id,
        text: option.text,
        correct: option.id === correct,
      })),
      explanation:
        answerKey?.questionType === 'multiple_choice' ? (answerKey.explanation ?? '') : '',
    }
  }
  return { kind: 'other' }
}
