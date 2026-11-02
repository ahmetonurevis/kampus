// İzin formu ekranlarının saf mantığı (IST-067; DOM-ILT-030, -031, -036…039): kim ne yapabilir,
// form şeması ve varsayılanları, düzenlemede yalnız değişen alanlar, liste satırı ve hata
// yönlendirme. Kural sunucudadır (core `lib/permission-forms.ts`); burası kullanıcıya yapamayacağı
// işi göstermemek, girdiyi core şemasıyla erkenden doğrulamak ve hatayı doğru alana bağlamaktır.
import { z } from 'zod'
import type { ApiError } from '@kampus/api-client/errors.ts'
import {
  isPermissionVersionConflict,
  PERMISSION_STATUS_LABELS,
  PERMISSION_TOPIC_LABELS,
  permissionErrorField,
  type PermissionFormKind,
  type PermissionFormListItem,
  type PermissionStatus,
  type UpdatePermissionFormBody,
} from '@kampus/react-shared/permission-forms.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  createPermissionFormSchema,
  type CreatePermissionFormInput,
  PERMISSION_FORM_DESCRIPTION_MAX_LENGTH,
  PERMISSION_FORM_TITLE_MAX_LENGTH,
  PERMISSION_FORM_TOPIC_KEYS,
  PERMISSION_NOTE_MAX_LENGTH,
} from '@kampus/school-core/lib/permission-forms.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

export {
  PERMISSION_FORM_DESCRIPTION_MAX_LENGTH,
  PERMISSION_FORM_TITLE_MAX_LENGTH,
  PERMISSION_FORM_TOPIC_KEYS,
  PERMISSION_NOTE_MAX_LENGTH,
}

export type PermissionActor = {
  role: string
  /** Öğretmen hesabının bağlı öğretmen kaydı; diğer rollerde `null`. */
  teacherId: string | null
}

/**
 * Ekranda gösterilecek işlemler (DOM-ILT-036, -038). Form açmak yönetici ve rehber öğretmende;
 * düzenleme, kapatma ve arşiv yönetici ile formu açan öğretmendedir (formu gören başka öğretmen
 * değiştiremez, sunucu 403 `permission_form_not_owner` verir).
 */
export function permissionActions(
  actor: PermissionActor,
  form?: Pick<PermissionFormListItem, 'teacherId'>,
) {
  const owner =
    actor.role === 'ogretmen' &&
    actor.teacherId !== null &&
    form?.teacherId != null &&
    form.teacherId === actor.teacherId
  return {
    create: actor.role === 'yonetici' || actor.role === 'ogretmen',
    manage: form !== undefined && (actor.role === 'yonetici' || owner),
  }
}

// --- Form ----------------------------------------------------------------------

/**
 * Form şeması core `createPermissionForm` ile aynıdır (konu, başlık, açıklama, son gün, hedef);
 * düzenlemede konu sabit kalır. Son günün geçmişte olup olmadığını sunucu karara bağlar: istemci
 * saati girdiyi silmez ve reddetmez.
 */
export const permissionFormSchema = z
  .object({
    topic: z.string(),
    title: z.string(),
    description: z.string(),
    deadline: z.string(),
    classIds: z.array(z.string()),
    studentIds: z.array(z.string()),
  })
  // Core şemanın hedef kuralı alanlar geçerli olmadan çalışmaz ve pipe ilk aşama hatalıyken
  // durur; boş gönderimde tüm alan hataları (hedef dahil) birlikte görünsün diye core sonucu
  // burada toplanır.
  .superRefine((values, ctx) => {
    const result = createPermissionFormSchema.safeParse(values)
    const issues = result.success ? [] : result.error.issues
    for (const issue of issues) ctx.addIssue({ ...issue })
    const noTarget = values.classIds.length === 0 && values.studentIds.length === 0
    if (noTarget && !issues.some((issue) => issue.path[0] === 'classIds'))
      ctx.addIssue({
        code: 'custom',
        message: 'En az bir sınıf ya da öğrenci seçin.',
        path: ['classIds'],
      })
  })
  // Boş konu seçimi de buradan geçer; geçersiz konuyu core şemasındaki `enum` Türkçe mesajla reddeder.
  .transform((values): CreatePermissionFormInput => ({
    ...values,
    topic: values.topic as CreatePermissionFormInput['topic'],
  }))
  .pipe(createPermissionFormSchema)
export type PermissionFormValues = z.input<typeof permissionFormSchema>
export type PermissionFormOutput = z.output<typeof permissionFormSchema>

type EditableForm = Pick<
  PermissionFormListItem,
  'topic' | 'title' | 'description' | 'deadline' | 'classIds'
>

/**
 * Düzenleme varsayılanı: hedef sınıflar yanıttaki `classIds`'tir. Sınıf dışında tek tek seçilen
 * öğrenciler yanıtta ayrı gelmez; çözülmüş öğrencilerden hedef sınıfların üyesi olmayan, etkin
 * olanlar tek tek seçilmiş sayılır (`extraStudentIds`).
 */
export function permissionFormDefaults(
  form?: EditableForm,
  extraStudentIds: readonly string[] = [],
): PermissionFormValues {
  return {
    topic: form?.topic ?? '',
    title: form?.title ?? '',
    description: form?.description ?? '',
    deadline: form?.deadline ?? '',
    classIds: [...(form?.classIds ?? [])],
    studentIds: [...extraStudentIds],
  }
}

/**
 * Çözülmüş hedef öğrencilerden hedef sınıfların üyesi olmayanlar: tek tek seçilmiş sayılır. Pasif
 * öğrenci listede yoktur ve atlanır (sunucu pasif öğrenciyi hedefe almaz).
 */
export function extraTargetStudentIds(
  resolvedStudentIds: readonly string[],
  classIds: readonly string[],
  students: readonly { id: string; classId?: string | undefined; isActive?: boolean | undefined }[],
): string[] {
  const inClass = new Set(classIds)
  const byId = new Map(students.map((student) => [student.id, student]))
  return resolvedStudentIds.filter((id) => {
    const student = byId.get(id)
    return (
      student !== undefined && student.isActive !== false && !inClass.has(student.classId ?? '')
    )
  })
}

const sameSet = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((item) => right.includes(item))

/** Hedef iki listeden biri değiştiyse "hedef değişti" sayılır (sunucu ikisini birlikte ister). */
export const targetChanged = (
  opened: { classIds: readonly string[]; studentIds: readonly string[] },
  values: { classIds: readonly string[]; studentIds: readonly string[] },
) => !sameSet(opened.classIds, values.classIds) || !sameSet(opened.studentIds, values.studentIds)

/**
 * Düzenlemede değişen alanlar (`PATCH` kısmidir; konu değişmez). `opened` karşılaştırılan
 * kayıttır: formun açıldığı andaki kayıt kullanıcının dokunduğu alanları, gönderim anındaki taze
 * kayıt gerçekten yazılacak alanları verir. Hedef değiştiyse iki liste birlikte gider.
 */
export function changedPermissionFormFields(
  opened: EditableForm,
  values: PermissionFormOutput,
  openedExtraStudentIds: readonly string[],
): UpdatePermissionFormBody {
  const changed: UpdatePermissionFormBody = {}
  if (values.title !== opened.title) changed.title = values.title
  if (values.description !== opened.description) changed.description = values.description
  if (values.deadline !== opened.deadline) changed.deadline = values.deadline
  if (
    targetChanged(
      { classIds: opened.classIds ?? [], studentIds: openedExtraStudentIds },
      { classIds: values.classIds ?? [], studentIds: values.studentIds ?? [] },
    )
  ) {
    changed.classIds = [...(values.classIds ?? [])]
    changed.studentIds = [...(values.studentIds ?? [])]
  }
  return changed
}

export type PermissionField = 'title' | 'description' | 'deadline' | 'target'

export const PERMISSION_FIELD_LABELS = {
  title: 'Başlık',
  description: 'Açıklama',
  deadline: 'Son gün',
  target: 'Hedef',
} as const satisfies Record<PermissionField, string>

/** Kullanıcının değiştirdiği bir alanı başkası da farklı bir değere çevirmiş. */
export type PermissionOverlap = {
  field: PermissionField
  label: string
  /** Başkasının kaydettiği değer. */
  theirs: string
  /** Kullanıcının formda girdiği değer. */
  mine: string
}

const TEXT_PREVIEW = 80

const preview = (value: string) => {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > TEXT_PREVIEW ? `${text.slice(0, TEXT_PREVIEW)}…` : text
}
const targetText = (classIds: readonly string[], studentIds: readonly string[]) =>
  `${classIds.length} sınıf, ${studentIds.length} tek öğrenci`

/**
 * Gönderim anındaki taze kayda göre düzenleme planı (ödev düzenlemesindeki `planHomeworkUpdate`
 * kalıbı): kullanıcının değiştirdiği alanlar formun açıldığı andaki kayıtla karşılaştırılır; yalnız
 * onlar gider, böylece dokunmadığı ve başkasının değiştirdiği alanlar eski değere geri yazılmaz.
 * `overlaps`: kullanıcının değiştirdiği bir alanı başkası da değiştirmişse iki değer gösterilir.
 * Hedefte tek tek öğrenci karşılaştırması taze kaydın çözülmüş öğrencilerinden hesaplanamadığı
 * için sınıf kümesi karşılaştırılır; ek öğrenci kümesi açılıştaki ile aynı kabul edilir.
 */
export function planPermissionFormUpdate(
  opened: EditableForm,
  fresh: EditableForm,
  values: PermissionFormOutput,
  openedExtraStudentIds: readonly string[],
): { body: UpdatePermissionFormBody; overlaps: PermissionOverlap[] } {
  const mine = changedPermissionFormFields(opened, values, openedExtraStudentIds)
  const differsFromFresh = changedPermissionFormFields(fresh, values, openedExtraStudentIds)
  const body: UpdatePermissionFormBody = {}
  const overlaps: PermissionOverlap[] = []
  const text = {
    title: [opened.title, fresh.title, values.title],
    description: [opened.description, fresh.description, values.description],
    deadline: [opened.deadline, fresh.deadline, values.deadline],
  } as const
  for (const field of ['title', 'description', 'deadline'] as const) {
    if (!(field in mine) || !(field in differsFromFresh)) continue
    Object.assign(body, { [field]: values[field] })
    const [before, theirs, yours] = text[field]
    if (theirs !== before)
      overlaps.push({
        field,
        label: PERMISSION_FIELD_LABELS[field],
        theirs: field === 'deadline' ? dateLabel(theirs, { year: 'numeric' }) : preview(theirs),
        mine: field === 'deadline' ? dateLabel(yours, { year: 'numeric' }) : preview(yours),
      })
  }
  if ('classIds' in mine && 'classIds' in differsFromFresh) {
    body.classIds = mine.classIds
    body.studentIds = mine.studentIds
    if (!sameSet(opened.classIds ?? [], fresh.classIds ?? []))
      overlaps.push({
        field: 'target',
        label: PERMISSION_FIELD_LABELS.target,
        theirs: targetText(fresh.classIds ?? [], openedExtraStudentIds),
        mine: targetText(values.classIds ?? [], values.studentIds ?? []),
      })
  }
  return { body, overlaps }
}

/** Kararı olan formda hedeften çıkarılan sınıf ve öğrenciler (sunucu 422 `scope_locked` verir). */
export function removedFromTarget(
  opened: { classIds: readonly string[]; studentIds: readonly string[] },
  values: { classIds: readonly string[]; studentIds: readonly string[] },
): { classIds: string[]; studentIds: string[] } {
  return {
    classIds: opened.classIds.filter((id) => !values.classIds.includes(id)),
    studentIds: opened.studentIds.filter((id) => !values.studentIds.includes(id)),
  }
}

// --- Liste ---------------------------------------------------------------------

export type PermissionFormRow = {
  id: string
  title: string
  topic: string
  deadline: string
  /** Sıralama ve gösterim: son gün `YYYY-MM-DD`. */
  deadlineLabel: string
  status: 'Açık' | 'Kapalı' | 'Süresi doldu'
  summary: string
  item: PermissionFormListItem
}

/** Durum: kapatılmış `Kapalı`, yalnız son günü geçmiş `Süresi doldu` (DOM-ILT-038). */
export function permissionFormState(
  form: Pick<PermissionFormListItem, 'status' | 'closedAt'>,
): PermissionFormRow['status'] {
  if (form.status === 'open') return 'Açık'
  return form.closedAt !== null ? 'Kapalı' : 'Süresi doldu'
}

export const permissionFormTone = (status: PermissionFormRow['status']): BadgeTone =>
  status === 'Açık' ? 'green' : 'gray'

/** "2 onay · 1 ret · 3 bekliyor"; okuyanın gördüğü öğrencilerdendir. */
export function countsSummary(counts: PermissionFormListItem['counts']): string {
  if (counts.total === 0) return '—'
  return `${counts.approved} onay · ${counts.rejected} ret · ${counts.pending} bekliyor`
}

export function permissionFormRow(item: PermissionFormListItem): PermissionFormRow {
  return {
    id: item.id,
    title: item.title,
    topic: PERMISSION_TOPIC_LABELS[item.topic],
    deadline: item.deadline,
    deadlineLabel: dateLabel(item.deadline, { year: 'numeric' }),
    status: permissionFormState(item),
    summary: countsSummary(item.counts),
    item,
  }
}

export const permissionStatusText = (status: PermissionStatus) => PERMISSION_STATUS_LABELS[status]

export const permissionStatusTone = (status: PermissionStatus): BadgeTone =>
  status === 'approved' ? 'green' : status === 'rejected' ? 'red' : 'amber'

// --- Hata yönlendirme ------------------------------------------------------------

/** Hata tek yerde görünür: alana bağlanan alanda, sürüm çakışması form uyarısında, gerisi toast. */
export function permissionErrorRoutes(kind: PermissionFormKind) {
  return {
    fieldFor: (error: ApiError) => permissionErrorField(error, kind),
    silent: isPermissionVersionConflict,
  }
}
