// Ödev ekranlarının form ve işlem hesapları (IST-095; DOM-AKD-070…074). Kural sunucudadır
// (core `lib/homework.ts`); burası kullanıcıya geçersiz seçenek ve işlem göstermemek, girdiyi
// core şemasıyla erkenden doğrulamak ve sunucu hatasını doğru alana bağlamak içindir.
import { z } from 'zod'
import {
  assignHomeworkSchema,
  gradeSubmissionSchema,
  HOMEWORK_FEEDBACK_MAX_LENGTH,
  SUBMISSION_FILE_LIMIT,
  SUBMISSION_NOTE_MAX_LENGTH,
} from '@kampus/school-core/lib/homework.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import {
  homeworkErrorField,
  isHomeworkVersionConflict,
  type Homework,
  type HomeworkFormKind,
  type HomeworkSubmission,
  type UpdateHomeworkBody,
} from '@kampus/react-shared/homework.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { istanbulToIso, isoToIstanbul } from '../../lib/istanbul-time.ts'

export { HOMEWORK_FEEDBACK_MAX_LENGTH, SUBMISSION_FILE_LIMIT, SUBMISSION_NOTE_MAX_LENGTH }

export type Option = { value: string; label: string }

// --- Kim ne yapabilir --------------------------------------------------------

export type HomeworkRole = 'yonetici' | 'ogretmen' | 'ogrenci' | 'veli' | 'onburo'

export type HomeworkActor = {
  role: HomeworkRole | string
  /** Öğretmen hesabının bağlı öğretmen kaydı; diğer rollerde `null`. */
  teacherId: string | null
}

/**
 * Ekranda gösterilecek işlemler (DOM-AKD-070, 071, 073). Ödev verme yönetici ve öğretmende;
 * düzenleme ve arşiv yönetici ile ödevin öğretmeninde; değerlendirme yalnız ödevin öğretmeninde
 * (yönetici değerlendirmez). Aynı sınıfa başka dersle giren öğretmen ödevi görür, değiştiremez.
 */
export function homeworkActions(actor: HomeworkActor, homework?: Pick<Homework, 'teacherId'>) {
  const owner =
    actor.role === 'ogretmen' && actor.teacherId !== null && homework?.teacherId === actor.teacherId
  return {
    create: actor.role === 'yonetici' || actor.role === 'ogretmen',
    manage: homework !== undefined && (actor.role === 'yonetici' || owner),
    grade: homework !== undefined && owner,
  }
}

// --- Ödev ver / düzenle ------------------------------------------------------

/**
 * Ödev formu: core `assignHomework` alanları. Son teslim formda Türkiye saatiyle girilir, ISO'ya
 * çevrilip core kuralıyla doğrulanır; ders her zaman seçilir (tek dersli öğretmende kendiliğinden).
 */
export const homeworkFormSchema = z.object({
  classId: assignHomeworkSchema.shape.classId,
  subjectId: z.string().trim().min(1, 'Ders seçin.'),
  title: assignHomeworkSchema.shape.title,
  description: assignHomeworkSchema.shape.description,
  dueDate: z
    .string()
    .trim()
    .min(1, 'Son teslim tarihini ve saatini seçin.')
    .transform(istanbulToIso)
    .pipe(z.iso.datetime({ offset: true, error: 'Son teslim tarihini ve saatini seçin.' })),
  allowLate: z.boolean(),
})
export type HomeworkFormValues = z.input<typeof homeworkFormSchema>
export type HomeworkFormOutput = z.output<typeof homeworkFormSchema>

export function homeworkFormDefaults(
  homework?: Pick<
    Homework,
    'classId' | 'subjectId' | 'title' | 'description' | 'dueDate' | 'allowLate'
  >,
): HomeworkFormValues {
  return {
    classId: homework?.classId ?? '',
    subjectId: homework?.subjectId ?? '',
    title: homework?.title ?? '',
    description: homework?.description ?? '',
    dueDate: homework ? isoToIstanbul(homework.dueDate) : '',
    allowLate: homework?.allowLate ?? true,
  }
}

/**
 * Düzenlemede kullanıcının formda değiştirdiği alanlar (`PATCH` kısmidir; sınıf ve ders
 * değişmez). `homework` karşılaştırılan kayıttır: formun açıldığı andaki kayıt kullanıcının
 * dokunduğu alanları, gönderim anındaki taze kayıt ise gerçekten yazılacak alanları verir.
 */
export function changedHomeworkFields(
  homework: Pick<Homework, 'title' | 'description' | 'dueDate' | 'allowLate'>,
  values: HomeworkFormOutput,
): UpdateHomeworkBody {
  const changed: UpdateHomeworkBody = {}
  if (values.title !== homework.title) changed.title = values.title
  if (values.description !== homework.description) changed.description = values.description
  if (Date.parse(values.dueDate) !== Date.parse(homework.dueDate)) changed.dueDate = values.dueDate
  if (values.allowLate !== homework.allowLate) changed.allowLate = values.allowLate
  return changed
}

type EditableHomework = Pick<Homework, 'title' | 'description' | 'dueDate' | 'allowLate'>
export type HomeworkField = 'title' | 'description' | 'dueDate' | 'allowLate'

export const HOMEWORK_FIELD_LABELS = {
  title: 'Başlık',
  description: 'Açıklama',
  dueDate: 'Son teslim',
  allowLate: 'Geç teslim',
} as const satisfies Record<HomeworkField, string>

/** Kullanıcının değiştirdiği bir alanı başkası da farklı bir değere çevirmiş. */
export type HomeworkOverlap = {
  field: HomeworkField
  label: string
  /** Başkasının kaydettiği değer. */
  theirs: string
  /** Kullanıcının formda girdiği değer. */
  mine: string
}

const TEXT_PREVIEW = 80

/** Alanın ekranda gösterilen değeri (uzun metin kısaltılır, tarih Türkiye saatiyle). */
export function homeworkFieldText(field: HomeworkField, value: EditableHomework): string {
  switch (field) {
    case 'title':
      return value.title
    case 'description': {
      const text = value.description.replace(/\s+/g, ' ').trim()
      return text.length > TEXT_PREVIEW ? `${text.slice(0, TEXT_PREVIEW)}…` : text
    }
    case 'dueDate':
      return dateLabel(value.dueDate, { year: 'numeric', hour: '2-digit', minute: '2-digit' })
    case 'allowLate':
      return value.allowLate ? 'Kabul edilir' : 'Kabul edilmez'
  }
}

/**
 * Gönderim anındaki taze kayda göre düzenleme planı (OG-047; ders formundaki `planLessonUpdate`
 * kalıbı). Kullanıcının değiştirdiği alanlar formun açıldığı andaki ödevle (`opened`)
 * karşılaştırılır; yalnız onlar gider, böylece dokunmadığı ve başkasının değiştirdiği alanlar eski
 * değere geri yazılmaz (sessiz ezme yok). `overlaps`: kullanıcının değiştirdiği bir alanı başkası
 * da farklı bir değere çevirmişse; kayıt gönderilmeden önce iki değer gösterilir.
 */
export function planHomeworkUpdate(
  opened: EditableHomework,
  fresh: EditableHomework,
  values: HomeworkFormOutput,
): { body: UpdateHomeworkBody; overlaps: HomeworkOverlap[] } {
  const mine = changedHomeworkFields(opened, values)
  const differsFromFresh = changedHomeworkFields(fresh, values)
  const theirs = changedHomeworkFields(opened, {
    ...values,
    title: fresh.title,
    description: fresh.description,
    dueDate: fresh.dueDate,
    allowLate: fresh.allowLate,
  })
  const body: UpdateHomeworkBody = {}
  const overlaps: HomeworkOverlap[] = []
  for (const field of Object.keys(HOMEWORK_FIELD_LABELS) as HomeworkField[]) {
    if (!(field in mine) || !(field in differsFromFresh)) continue
    Object.assign(body, { [field]: values[field] })
    if (field in theirs)
      overlaps.push({
        field,
        label: HOMEWORK_FIELD_LABELS[field],
        theirs: homeworkFieldText(field, fresh),
        mine: homeworkFieldText(field, values),
      })
  }
  return { body, overlaps }
}

type AssignmentLike = { classId: string; subjectId: string; teacherId: string }
type ClassLike = { id: string; name: string; isActive?: boolean; deletedAt?: string | null }
type SubjectLike = { id: string; name: string }

const byLabel = (left: Option, right: Option) =>
  left.label.localeCompare(right.label, 'tr', { numeric: true })

/** Ödevin verilebileceği ders atamaları: öğretmende yalnız kendi atamaları (DOM-AKD-070). */
function ownAssignments(assignments: readonly AssignmentLike[], actor: HomeworkActor) {
  return actor.role === 'ogretmen'
    ? assignments.filter((item) => item.teacherId === actor.teacherId)
    : assignments
}

/** Etkin ve ders ataması olan sınıflar; öğretmende derse girdiği sınıflar. */
export function homeworkClassOptions(
  classes: readonly ClassLike[],
  assignments: readonly AssignmentLike[],
  actor: HomeworkActor,
): Option[] {
  const assigned = new Set(ownAssignments(assignments, actor).map((item) => item.classId))
  return classes
    .filter((item) => item.isActive !== false && !item.deletedAt && assigned.has(item.id))
    .map((item) => ({ value: item.id, label: item.name }))
    .sort(byLabel)
}

/** Sınıfın ödev verilebilecek dersleri; sınıf seçilmeden boştur. */
export function homeworkSubjectOptions(
  classId: string,
  assignments: readonly AssignmentLike[],
  subjects: readonly SubjectLike[],
  actor: HomeworkActor,
): Option[] {
  if (!classId) return []
  const ids = new Set(
    ownAssignments(assignments, actor)
      .filter((item) => item.classId === classId)
      .map((item) => item.subjectId),
  )
  return [...ids]
    .map((id) => ({ value: id, label: subjects.find((item) => item.id === id)?.name ?? id }))
    .sort(byLabel)
}

/** Sınıf değişince ders artık geçersizse temizlenir; tek seçenek varsa o seçilir. */
export function pickSubject(current: string, options: readonly Option[]): string {
  if (options.some((option) => option.value === current)) return current
  return options.length === 1 ? (options[0]?.value ?? '') : ''
}

// --- Teslim ------------------------------------------------------------------

/**
 * Formdaki dosya: yüklenmiş (`id`) ya da önceki teslimden gelen. `key` yüklenirken seçilen
 * dosyanın yerel kimliğidir (ad, boyut, değişiklik zamanı); aynı dosyanın yeniden seçilmesini
 * yüklemeden önce yakalar (her yükleme farklı `id` üretir).
 */
export type SubmissionFile = { id: string; name: string; key?: string }

export const submissionFormSchema = z
  .object({
    note: z
      .string()
      .trim()
      .max(
        SUBMISSION_NOTE_MAX_LENGTH,
        `En fazla ${SUBMISSION_NOTE_MAX_LENGTH} karakter yazabilirsiniz.`,
      ),
    files: z
      .array(z.object({ id: z.string().min(1), name: z.string(), key: z.string().optional() }))
      .max(SUBMISSION_FILE_LIMIT, `En fazla ${SUBMISSION_FILE_LIMIT} dosya ekleyebilirsiniz.`),
  })
  .refine((value) => value.note.length > 0 || value.files.length > 0, {
    message: 'Teslim için açıklama yazın ya da dosya ekleyin.',
    path: ['note'],
  })
export type SubmissionFormValues = z.input<typeof submissionFormSchema>

/**
 * Teslim durumu (DOM-AKD-072): son teslimden önce açık; sonra ödev geç teslime açıksa geç
 * olarak kabul edilir, değilse kapalı. Puanlanmış teslim kilitlidir.
 */
export type SubmissionWindow = 'open' | 'late' | 'closed' | 'graded'

export function submissionWindow(
  homework: Pick<Homework, 'dueDate' | 'allowLate'>,
  submission: Pick<HomeworkSubmission, 'score'> | undefined,
  now: string,
): SubmissionWindow {
  if (submission && submission.score !== null) return 'graded'
  if (Date.parse(now) <= Date.parse(homework.dueDate)) return 'open'
  return homework.allowLate ? 'late' : 'closed'
}

/**
 * Yüklenen dosyayı listeye ekler; `id` zaten listedeyse (aynı dosya yeniden seçildi, sunucu aynı
 * kaydı döndürdü) liste değişmez, böylece teslimde aynı dosya iki kez bağlanmaz.
 */
export function addUploadedFile(
  current: readonly SubmissionFile[],
  file: SubmissionFile,
): SubmissionFile[] {
  if (current.some((item) => item.id === file.id)) return [...current]
  return [...current, file].slice(0, SUBMISSION_FILE_LIMIT)
}

// --- Değerlendirme -----------------------------------------------------------

/** Puan alanı sayı girişidir (`valueAsNumber`); boş alan `NaN` olur ve core mesajını alır. */
export const gradeFormSchema = gradeSubmissionSchema
export type GradeFormValues = z.input<typeof gradeFormSchema>

export function gradeFormDefaults(
  submission: Pick<HomeworkSubmission, 'score' | 'feedback'>,
): GradeFormValues {
  return { score: submission.score ?? Number.NaN, feedback: submission.feedback }
}

// --- Hata yönlendirme --------------------------------------------------------

/** Sunucunun alan adı → formdaki alan (teslim formunda dosya listesi `files`'tır). */
const FORM_FIELD_NAMES: Readonly<Record<string, string>> = { fileIds: 'files' }

/** Hata tek yerde görünür: alana bağlanan alanda, sürüm çakışması form uyarısında, gerisi toast. */
export function homeworkErrorRoutes(kind: HomeworkFormKind) {
  return {
    fieldFor: (error: ApiError) => {
      const field = homeworkErrorField(error, kind)
      return field === undefined ? undefined : (FORM_FIELD_NAMES[field] ?? field)
    },
    silent: isHomeworkVersionConflict,
  }
}
