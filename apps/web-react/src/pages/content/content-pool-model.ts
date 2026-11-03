// İçerik havuzu ekranının saf modeli: satır, etiket, süzgeç seçenekleri ve taslak formu. Kural
// core `content/` içindedir (taksonomi, `resourceVersionInputSchema`); burada yalnız sunum vardır.
import { toNestErrors } from '@hookform/resolvers'
import type { FieldError, FieldPath, Resolver } from 'react-hook-form'
import { z } from 'zod'
import {
  isAuthorableType,
  resourceFileName,
  type AuthorableType,
  type StaffResourceListItem,
  type StaffResourceVersion,
} from '@kampus/react-shared/resource-model.ts'
import { resourceFileCountIssue } from '@kampus/school-core/content/resource-files.ts'
import {
  RESOURCE_STATUSES,
  resourceVersionInputSchema,
  transitionReasonSchema,
  type GlossaryEntry,
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
  RESOURCE_FILE_RULES,
  SHARE_SCOPES,
  SKILLS,
  SUBSKILLS,
  type ContentType,
  type LicenseKind,
} from '@kampus/school-core/content/taxonomy.ts'
import type { FileUploadItem } from '@/components/file-upload-model.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import {
  coreQuestionFromForm,
  defaultQuestion,
  formIssuePath,
  questionFormFromCore,
  questionSummary,
  type AnswerFormValues,
  type QuestionFormValues,
  type QuestionSummary,
} from './question-form-model.ts'

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
/** Okuma-anlama sorusunun alt becerisi (DOM-BEC-006); yalnız soru türünde seçilir. */
export const SUBSKILL_OPTIONS = options(SUBSKILLS)
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

export const MATERIAL_TYPE_LABEL = `${CONTENT_TYPES.file.label} (materyal)`
/** Materyal dosyası türünün kuralı (DOM-KYN-006): amaç `material`, sürüm başına en çok 10 dosya. */
export const MATERIAL_FILE_RULE = RESOURCE_FILE_RULES.file
export const MATERIAL_FILE_REQUIRED = 'En az bir dosya ekleyin.'

/** Bu dilimde oluşturulabilen türler (diğerleri TODO(F3c2) ile sonraki dilimde). */
export const AUTHORABLE_OPTIONS: { value: AuthorableType; label: string }[] = [
  { value: 'reading_passage', label: CONTENT_TYPES.reading_passage.label },
  // Altı soru türü (IST-033): tür formun soru bölümünde seçilir.
  { value: 'question', label: CONTENT_TYPES.question.label },
  { value: 'file', label: MATERIAL_TYPE_LABEL },
  // Okuma-anlama etkinliği (IST-042, DOM-BEC-006): okuma parçasına bağlanabilen soru setleri.
  { value: 'quiz', label: CONTENT_TYPES.quiz.label },
  { value: 'exercise_set', label: CONTENT_TYPES.exercise_set.label },
]

/** Soru listesi taşıyan türler (quiz ve alıştırma seti; okuma etkinliği formu, OG-984). */
export type ItemSetType = Extract<AuthorableType, 'quiz' | 'exercise_set'>
export const isItemSetType = (type: AuthorableType): type is ItemSetType =>
  type === 'quiz' || type === 'exercise_set'

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
    'Alıntı içeriğin ayırt edilebilir bölümüdür; eser adı, eser sahibi ve alındığı yer kaynak gösteriminde yazılır.',
  open_license:
    'Ticari kullanıma izin veren açık lisans (NC ve ND lisansları kabul edilmez); kaynak gösterimi zorunludur.',
  public_domain: 'Eserin koruma süresi dolmuştur; dayanağı yazın ve kaynak gösterin.',
}

export const requiresAttribution = (kind: LicenseKind | undefined) =>
  kind !== undefined && LICENSE_KINDS[kind].requiresAttribution

/**
 * Birincil beceri seçenekleri: aracılık bu dilimde yok; dil kullanımı yalnız soru, quiz ve alıştırma
 * setinde birincil olur (DOM-KYN-012), okuma parçası ve materyalde olmaz.
 */
export function skillOptionsFor(type: AuthorableType) {
  const languageUse = type === 'question' || isItemSetType(type)
  return SKILL_OPTIONS.filter(
    (option) => option.value !== 'mediation' && (languageUse || option.value !== 'language_use'),
  )
}

/**
 * Form değerinden core girdisi: dosya alanındaki liste (`files`, adlarıyla) sıralı `fileIds` olur;
 * materyal dosyasında içeriğin ana dosyası (`content.fileId`) listenin ilkidir, böylece içerikteki
 * dosya her zaman listededir (DOM-KYN-006). Soru formu (altı tür, IST-033) core soru gövdesine ve
 * cevap anahtarına çevrilir (`coreQuestionFromForm`). Diğer değerler olduğu gibi geçer.
 */
export function coreInputFromForm(values: unknown): unknown {
  if (!isRecord(values)) return values
  let result = values
  if (isFileItems(result.files)) {
    const { files, ...rest } = result
    const fileIds = files.map((file) => file.id)
    const content = isRecord(rest.content) ? rest.content : undefined
    result = {
      ...rest,
      fileIds,
      ...(content?.type === 'file' ? { content: { type: 'file', fileId: fileIds[0] ?? '' } } : {}),
    }
  }
  const content = isRecord(result.content) ? result.content : undefined
  if (content?.type === 'question' && isRecord(content.question)) {
    // Alan değerleri burada `unknown` gelir (çözümleyici girdisi). Tür yalnız alan adlarını verir;
    // değerlerin biçimini core şeması doğrular, bozuksa Türkçe iletiyle reddeder.
    const core = coreQuestionFromForm(
      content.question as Partial<QuestionFormValues>,
      isRecord(result.answerKey) ? (result.answerKey as Partial<AnswerFormValues>) : null,
    )
    result = {
      ...result,
      content: { type: 'question', question: core.question },
      answerKey: core.answerKey,
    }
  }
  return result
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Dosya alanı değeri çalışma anında doğrulanır: her öğe kimlikli bir dosya satırıdır. */
const isFileItems = (value: unknown): value is FileUploadItem[] =>
  Array.isArray(value) && value.every((file) => isRecord(file) && typeof file.id === 'string')

/**
 * `formIssuePath` çıktısının formun bir alanı olup olmadığı: ilk parça form değerinin üst düzey
 * anahtarlarından biri olmalıdır. Değilse çağıran hatayı `root` altına yazar; böylece yanlış yol
 * react-hook-form'a tipsiz geçmez.
 */
export function isDraftFieldPath(
  path: string,
  values: DraftFormValues,
): path is FieldPath<DraftFormValues> {
  const head = path.split('.')[0] ?? ''
  return Object.hasOwn(values, head)
}

/**
 * Form şeması: core sürüm girdisi + formun kuralları. Taslak eksik kaydedilebilir (API bunu
 * kabul eder) ama lisans bu ekranda zorunludur; yalnız bu dilimde oluşturulabilen türler kabul
 * edilir. Soru altı türün hepsinde cevap anahtarıyla kaydedilir (IST-033, DOM-KYN-002). Materyal
 * dosyası en az bir dosya ister; sayı sınırı core `resourceFileCountIssue` ile sunucuyla aynı
 * iletiyi verir (DOM-KYN-006).
 */
const draftCoreSchema = resourceVersionInputSchema.superRefine((value, ctx) => {
  if (value.content.type === 'file') {
    const issue = resourceFileCountIssue('file', value.fileIds)
    if (value.fileIds.length === 0)
      ctx.addIssue({ code: 'custom', message: MATERIAL_FILE_REQUIRED, path: ['files'] })
    else if (issue) ctx.addIssue({ code: 'custom', message: issue.message, path: ['files'] })
  }
  if (value.license === null) {
    ctx.addIssue({ code: 'custom', message: 'Menşe ve lisans türünü seçin.', path: ['license'] })
  }
  if (!isAuthorableType(value.content.type)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Bu içerik türü henüz oluşturulamaz.',
      path: ['content', 'type'],
    })
  } else if (value.content.type === 'question' && value.answerKey === null) {
    ctx.addIssue({ code: 'custom', message: 'Doğru cevabı belirleyin.', path: ['answerKey'] })
  }
})
export const draftFormSchema = z.preprocess(coreInputFromForm, draftCoreSchema)
export type DraftFormInput = z.input<typeof draftCoreSchema>
export type DraftFormOutput = z.output<typeof draftCoreSchema>

/**
 * Formun çözümleyicisi: `draftFormSchema` ile doğrular, core hata yolunu form alanına çevirir
 * (`formIssuePath`; soru formunda türetilen alanlar). Alan başına ilk hata kalır.
 */
export const draftResolver: Resolver<DraftFormValues, unknown, DraftFormOutput> = async (
  values,
  _context,
  options,
) => {
  const parsed = await draftFormSchema.safeParseAsync(values)
  if (parsed.success) return { values: parsed.data, errors: {} }
  const flat: Record<string, FieldError> = {}
  for (const issue of parsed.error.issues) {
    const path = formIssuePath(issue.path, values)
    flat[path] ??= { type: issue.code, message: issue.message }
  }
  return { values: {}, errors: toNestErrors(flat, options) }
}

/**
 * Form değerleri: core girdisinin düz (birleşimsiz) hâli. `register` yolları tipli kalsın diye
 * soru altı türün alanlarını bir arada taşır (`QuestionFormValues`); doğrulayan yine core
 * şemasıdır (`draftFormSchema`, çözümleyicide tek çevrim).
 */
export type DraftFormValues = Omit<DraftFormInput, 'content' | 'answerKey'> & {
  content: {
    type: AuthorableType
    body?: string
    /**
     * Okuma parçasının sözlükçesi (DOM-BEC-006): formda satır satır düzenlenir, yamaya bütün olarak
     * gider. Örnek cümle boş bırakılırsa core `null` yapar.
     */
    glossary?: GlossaryEntry[]
    /** Materyal dosyasının ana dosyası; çözümleyici listenin ilkiyle doldurur. */
    fileId?: string | null
    /**
     * Quiz/alıştırma setinin soruları, sırasıyla (DOM-KYN-013): yayındaki soru sürümleri. Seçici
     * ekler, form sıralar ve çıkarır; puan madde başınadır.
     */
    items?: { questionVersionId: string; points: number }[]
    /** Okuma-anlama etkinliğinin parçası (IST-042, DOM-BEC-006): yayındaki parça sürümü. */
    passageVersionId?: string | null
    /**
     * Dinleme etkinliğinin kaydı (IST-045, DOM-BEC-005): yayındaki, dinleme becerili, dökümlü ses
     * sürümü. Parçayla birlikte de bağlanabilir (core ikisini dışlamaz).
     */
    listeningVersionId?: string | null
    timeLimitMinutes?: number | null
    shuffleItems?: boolean
    /** Soru (IST-033): altı türün alanları; core gövdesine `coreQuestionFromForm` çevirir. */
    question?: QuestionFormValues
  }
  /** Soru dışı türlerde `null`; soruda formun cevap alanları (anahtar türden kurulur). */
  answerKey: AnswerFormValues | null
  /** Sürümün dosyaları, sırasıyla (adı gösterim içindir; gövdeye yalnız kimlik gider). */
  files: FileUploadItem[]
}

/** Sözlükçeye eklenen boş satır; alanlar doldurulunca core `glossaryEntrySchema` doğrular. */
export const emptyGlossaryEntry = (): GlossaryEntry => ({ term: '', meaning: '', example: null })

/** Sözlükçe satırının kelime alanının kimliği; etiket, hata ve odak aynı kimliği kullanır. */
export const glossaryTermId = (index: number) => `icerik-sozluk-kelime-${index}`

/**
 * Satır silinince odağın gideceği yer (WCAG 2.4.3): silinen düğme DOM'dan kalktığı için odak
 * `body`'ye düşer. Önceki satırın kelime alanı; ilk satır silindiyse yeni ilk satırın kelime alanı;
 * satır kalmadıysa "Kelime ekle" düğmesi. `count` silmeden önceki satır sayısıdır.
 */
export const glossaryFocusAfterRemove = (
  index: number,
  count: number,
): { kind: 'term'; index: number } | { kind: 'add' } =>
  count <= 1 ? { kind: 'add' } : { kind: 'term', index: index > 0 ? index - 1 : 0 }

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
  if (isItemSetType(type)) {
    // Set varsayılanı: birincil beceri okuma; parça ve dinleme kaydı isteğe bağlıdır (dil kullanımı
    // seti). Dinleme kaydı bağlanınca etkinlik birincil beceriden bağımsız dinleme görevidir.
    return {
      title: '',
      content: {
        type,
        items: [],
        passageVersionId: null,
        listeningVersionId: null,
        timeLimitMinutes: null,
        shuffleItems: false,
      },
      answerKey: null,
      tags: { ...emptyTags, primarySkill: 'reading' },
      license: null,
      attributions: [],
      files: [],
    }
  }
  if (type === 'reading_passage') {
    return {
      title: '',
      content: { type: 'reading_passage', body: '' },
      answerKey: null,
      tags: { ...emptyTags, primarySkill: 'reading' },
      license: null,
      attributions: [],
      files: [],
    }
  }
  if (type === 'file') {
    return {
      title: '',
      content: { type: 'file', fileId: null },
      answerKey: null,
      tags: { ...emptyTags },
      license: null,
      attributions: [],
      files: [],
    }
  }
  const blank = defaultQuestion('multiple_choice')
  return {
    title: '',
    content: { type: 'question', question: blank.question },
    answerKey: blank.answerKey,
    tags: { ...emptyTags },
    license: null,
    attributions: [],
    files: [],
  }
}

/**
 * Sürümün dosyaları form listesine: silinmiş (imha edilmiş) dosya yeni listeye taşınamaz (422
 * `file_unavailable`), bu yüzden başlangıç değerine girmez. Yeni sürümde liste temel sürümünkidir.
 */
export function draftFiles(head: Pick<StaffResourceVersion, 'files'>): FileUploadItem[] {
  return head.files.flatMap((file, index) =>
    file.status === 'deleted' ? [] : [{ id: file.id, name: resourceFileName(file, index) }],
  )
}

/**
 * Sunucudaki baş sürümden form değerleri; desteklenmeyen tür veya kaldırılmış (içeriksiz) sürüm
 * için `null`. Altı soru türü de düzenlenir (IST-033). Eksik taslak (ör. lisans henüz yok)
 * düzenlenebilir.
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
  const { content, answerKey, title, tags, license, attributions } = parsed.data
  // Liste sürüm yanıtının `files` alanından gelir (adlarıyla); `fileIds` ön işlemde yeniden kurulur.
  const rest = { title, tags, license, attributions, files: draftFiles(head) }
  if (content.type === 'reading_passage')
    return {
      ...rest,
      content: { type: 'reading_passage', body: content.body, glossary: content.glossary },
      answerKey: null,
    }
  if (content.type === 'file')
    return { ...rest, content: { type: 'file', fileId: content.fileId }, answerKey: null }
  // Quiz/alıştırma seti içeriği bütün olarak taşınır: formun yazmadığı alan (ör. ileride eklenen
  // bağlı kayıtlar) yamada aynen geri gider, kaybolmaz.
  if (content.type === 'quiz' || content.type === 'exercise_set')
    return {
      ...rest,
      content: { ...content, items: content.items.map((item) => ({ ...item })) },
      answerKey: null,
    }
  if (content.type === 'question') {
    const form = questionFormFromCore(content.question, answerKey)
    return {
      ...rest,
      content: { type: 'question', question: form.question },
      answerKey: form.answerKey,
    }
  }
  return null
}

/**
 * Gövde (yeni içerik ve taslak PATCH): taslağın bütün alanları (tür değişmez). Dosya listesi yalnız
 * materyal dosyasında gider ve bütün olarak değişir; listeden çıkan dosyanın bağını sunucu kaldırır.
 * Diğer türlerde liste gönderilmez, sürümdeki liste aynen kalır (DOM-KYN-006).
 */
export function patchFromDraft(values: DraftFormOutput) {
  return {
    title: values.title,
    content: values.content,
    answerKey: values.answerKey,
    tags: values.tags,
    license: values.license,
    attributions: values.attributions,
    ...(values.content.type === 'file' ? { fileIds: values.fileIds } : {}),
  }
}

export const rejectSchema = z.object({ reason: transitionReasonSchema })
export type RejectInput = z.input<typeof rejectSchema>

export const isEnglishContent = (tags: Tags) =>
  tags.subjectId === 'english' || tags.cefrLevel !== null || tags.primarySkill === 'language_use'

export type ContentPreview =
  | { kind: 'reading'; body: string }
  | { kind: 'question'; summary: QuestionSummary }
  | { kind: 'file' }
  | {
      kind: 'set'
      itemCount: number
      /** Okuma-anlama etkinliği mi (bağlı okuma parçası var). */
      reading: boolean
      /** Dinleme etkinliği mi (bağlı dinleme kaydı var; IST-045). */
      listening: boolean
      timeLimitMinutes: number | null
    }
  | { kind: 'other' }
  | { kind: 'removed' }

/**
 * Panel önizlemesi: okuma metni ya da soru (altı tür: kök, doğru cevap ve çözüm); diğer türler
 * yalnız künye.
 */
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
  // Materyal dosyasının içeriği dosyalarıdır; panel onları ayrı listeler.
  if (content.type === 'file') return { kind: 'file' }
  if (content.type === 'quiz' || content.type === 'exercise_set')
    return {
      kind: 'set',
      itemCount: content.items.length,
      reading: content.passageVersionId !== null,
      listening: content.listeningVersionId !== null,
      timeLimitMinutes: content.timeLimitMinutes,
    }
  if (content.type === 'question')
    return { kind: 'question', summary: questionSummary(content.question, answerKey) }
  return { kind: 'other' }
}
