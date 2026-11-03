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
  type PermissionFormDecision,
  type PermissionFormKind,
  type PermissionFormListItem,
  type PermissionFormStudent,
  type PermissionStatus,
  type UpdatePermissionFormBody,
} from '@kampus/react-shared/permission-forms.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'
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

/** Ücret metni → kuruş: boş "belirtilmemiş" (`null`), geçersiz metin `undefined`. */
export function fee(text: string): number | null | undefined {
  const value = text.trim()
  if (value === '') return null
  return /^0+(?:[.,]0{1,2})?$/.test(value) ? 0 : (parseAmountInput(value) ?? undefined)
}

const blank = (text: string) => (text.trim() === '' ? undefined : text.trim())

/** Form metinlerini core girdisine çevirir: boş ayrıntı gönderilmez (core `optional`). */
type EventTexts = Record<'eventDate' | 'eventTime' | 'location' | 'transport' | 'fee', string>

function coreInput<T extends EventTexts>(values: T) {
  const kurus = fee(values.fee)
  return {
    ...values,
    eventDate: blank(values.eventDate),
    eventTime: blank(values.eventTime),
    location: blank(values.location),
    transport: blank(values.transport),
    fee: kurus ?? undefined,
  }
}

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
    // Etkinlik ayrıntısı (DOM-ILT-032): boş bırakılan "belirtilmemiş"tir; ücret ₺ olarak yazılır.
    eventDate: z.string(),
    eventTime: z.string(),
    location: z.string(),
    transport: z.string(),
    fee: z.string(),
    classIds: z.array(z.string()),
    studentIds: z.array(z.string()),
  })
  // Core şemanın hedef kuralı alanlar geçerli olmadan çalışmaz ve pipe ilk aşama hatalıyken
  // durur; boş gönderimde tüm alan hataları (hedef dahil) birlikte görünsün diye core sonucu
  // burada toplanır.
  .superRefine((values, ctx) => {
    if (fee(values.fee) === undefined)
      ctx.addIssue({
        code: 'custom',
        message: 'Ücreti 250 ya da 250,50 biçiminde girin; ücretsizse 0 yazın.',
        path: ['fee'],
      })
    const result = createPermissionFormSchema.safeParse(coreInput(values))
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
    ...coreInput(values),
    topic: values.topic as CreatePermissionFormInput['topic'],
  }))
  .pipe(createPermissionFormSchema)
export type PermissionFormValues = z.input<typeof permissionFormSchema>
export type PermissionFormOutput = z.output<typeof permissionFormSchema>

type EditableForm = Pick<
  PermissionFormListItem,
  | 'topic'
  | 'title'
  | 'description'
  | 'deadline'
  | 'classIds'
  | 'targetStudentIds'
  | 'eventDate'
  | 'eventTime'
  | 'location'
  | 'transport'
  | 'fee'
>

export type PermissionTarget = { classIds: readonly string[]; studentIds: readonly string[] }

/**
 * Kayıtlı hedef: sınıflar (`classIds`) ve tek tek hedeflenen öğrenciler (`targetStudentIds`).
 * İkisini de sunucu formu yönetene (yönetici, formun öğretmeni) döndürür; çözülmüş öğrenci
 * listesinden tahmin edilmez (sınıf değiştiren ya da hem sınıfta hem tek seçili öğrenci ayırt
 * edilemez). Alanı olmayan eski kayıt yalnız sınıf hedeflidir.
 */
export const permissionTarget = (form: EditableForm): PermissionTarget => ({
  classIds: form.classIds ?? [],
  studentIds: form.targetStudentIds ?? [],
})

/** Düzenleme varsayılanı kayıtlı hedeftir; yeni formda alanlar boştur. */
export function permissionFormDefaults(form?: EditableForm): PermissionFormValues {
  return {
    topic: form?.topic ?? '',
    title: form?.title ?? '',
    description: form?.description ?? '',
    deadline: form?.deadline ?? '',
    eventDate: form?.eventDate ?? '',
    eventTime: form?.eventTime ?? '',
    location: form?.location ?? '',
    transport: form?.transport ?? '',
    fee: form?.fee == null ? '' : amountInputValue(form.fee),
    classIds: [...(form?.classIds ?? [])],
    studentIds: [...(form?.targetStudentIds ?? [])],
  }
}

const sameSet = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((item) => right.includes(item))

/** Hedef iki listeden biri değiştiyse "hedef değişti" sayılır (sunucu ikisini birlikte ister). */
export const targetChanged = (opened: PermissionTarget, values: PermissionTarget) =>
  !sameSet(opened.classIds, values.classIds) || !sameSet(opened.studentIds, values.studentIds)

/**
 * Düzenlemede değişen alanlar (`PATCH` kısmidir; konu değişmez). `opened` karşılaştırılan
 * kayıttır: formun açıldığı andaki kayıt kullanıcının dokunduğu alanları, gönderim anındaki taze
 * kayıt gerçekten yazılacak alanları verir. Hedef değiştiyse iki liste birlikte gider.
 */
export function changedPermissionFormFields(
  opened: EditableForm,
  values: PermissionFormOutput,
): UpdatePermissionFormBody {
  const changed: UpdatePermissionFormBody = {}
  if (values.title !== opened.title) changed.title = values.title
  if (values.description !== opened.description) changed.description = values.description
  if (values.deadline !== opened.deadline) changed.deadline = values.deadline
  // Kaldırılan ayrıntı `null` gider (belirtilmemiş); değişiklik izni düşürür (DOM-ILT-032).
  if ((values.eventDate ?? null) !== (opened.eventDate ?? null))
    changed.eventDate = values.eventDate ?? null
  if ((values.eventTime ?? null) !== (opened.eventTime ?? null))
    changed.eventTime = values.eventTime ?? null
  if ((values.location ?? null) !== (opened.location ?? null))
    changed.location = values.location ?? null
  if ((values.transport ?? null) !== (opened.transport ?? null))
    changed.transport = values.transport ?? null
  if ((values.fee ?? null) !== (opened.fee ?? null)) changed.fee = values.fee ?? null
  if (
    targetChanged(permissionTarget(opened), {
      classIds: values.classIds ?? [],
      studentIds: values.studentIds ?? [],
    })
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
const targetText = (target: PermissionTarget) =>
  `${target.classIds.length} sınıf, ${target.studentIds.length} tek öğrenci`

/**
 * Gönderim anındaki taze kayda göre düzenleme planı (ödev düzenlemesindeki `planHomeworkUpdate`
 * kalıbı): kullanıcının değiştirdiği alanlar formun açıldığı andaki kayıtla karşılaştırılır; yalnız
 * onlar gider, böylece dokunmadığı ve başkasının değiştirdiği alanlar eski değere geri yazılmaz.
 * `overlaps`: kullanıcının değiştirdiği bir alanı başkası da değiştirmişse iki değer gösterilir.
 * Hedef tek alandır (sınıflar ve tek tek öğrenciler birlikte gider): başkası sınıf ya da öğrenci
 * listesinden birini değiştirdiyse ve kullanıcı da hedefe dokunduysa uyarı çıkar; böylece
 * başkasının eklediği öğrenci uyarısız düşmez. Kullanıcı hedefe dokunmadıysa hedef gönderilmez.
 */
export function planPermissionFormUpdate(
  opened: EditableForm,
  fresh: EditableForm,
  values: PermissionFormOutput,
): { body: UpdatePermissionFormBody; overlaps: PermissionOverlap[] } {
  const mine = changedPermissionFormFields(opened, values)
  const differsFromFresh = changedPermissionFormFields(fresh, values)
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
  // Etkinlik ayrıntısı: kullanıcının değiştirdiği ve kayıtlıdan farklı olan alan gider.
  for (const field of ['eventDate', 'eventTime', 'location', 'transport', 'fee'] as const)
    if (field in mine && field in differsFromFresh) Object.assign(body, { [field]: mine[field] })
  if ('classIds' in mine && 'classIds' in differsFromFresh) {
    body.classIds = mine.classIds
    body.studentIds = mine.studentIds
    if (targetChanged(permissionTarget(opened), permissionTarget(fresh)))
      overlaps.push({
        field: 'target',
        label: PERMISSION_FIELD_LABELS.target,
        theirs: targetText(permissionTarget(fresh)),
        mine: targetText({ classIds: values.classIds ?? [], studentIds: values.studentIds ?? [] }),
      })
  }
  return { body, overlaps }
}

/** Kararı olan formda hedeften çıkarılan sınıf ve öğrenciler (sunucu 422 `scope_locked` verir). */
export function removedFromTarget(
  opened: PermissionTarget,
  values: PermissionTarget,
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
  status: 'Açık' | 'Kapalı' | 'Süresi doldu' | 'İptal edildi'
  summary: string
  item: PermissionFormListItem
}

/**
 * Durum: iptal edilmiş `İptal edildi` (DOM-ILT-032), kapatılmış `Kapalı`, yalnız son günü geçmiş
 * `Süresi doldu` (DOM-ILT-038).
 */
export function permissionFormState(
  form: Pick<PermissionFormListItem, 'status' | 'closedAt' | 'cancelledAt'>,
): PermissionFormRow['status'] {
  if (form.cancelledAt !== null) return 'İptal edildi'
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

// --- Veli ve öğrenci kararı ------------------------------------------------------

/** Karar formu: yalnız isteğe bağlı not; onay/ret düğmeyle seçilir (DOM-ILT-037). */
export const decisionFormSchema = z.object({
  note: z
    .string()
    .trim()
    .max(
      PERMISSION_NOTE_MAX_LENGTH,
      `Not en fazla ${PERMISSION_NOTE_MAX_LENGTH} karakter olabilir.`,
    ),
})
export type DecisionFormValues = z.input<typeof decisionFormSchema>

/** Kararı kim veriyor: `guardian` 18 yaş altı çocuk için veli, `student` öğrencinin kendisi. */
export type DecisionAudience = 'guardian' | 'student'

/**
 * Seçili çocuğun (öğrencinin) bu formdaki hedef satırı; hedef değilse ya da satır gelmediyse
 * `undefined`. Veli ve öğrenci liste satırı da öğrenci satırlarını taşır.
 */
export const studentEntry = (
  form: { students?: readonly PermissionFormStudent[] | undefined },
  studentId: string,
): PermissionFormStudent | undefined =>
  form.students?.find((entry) => entry.studentId === studentId)

/**
 * Okuyanın verdiği son karar: sunucu kararları karar anına göre sıralar ve veliye yalnız kendi
 * kararını, öğrenciye kendisininkini döner; `mine` işaretlisinin sonuncusu geçerli kararıdır.
 */
export function myDecision(
  entry: Pick<PermissionFormStudent, 'decisions'> | undefined,
): PermissionFormDecision | undefined {
  return entry?.decisions.findLast((decision) => decision.mine && decision.current)
}

/**
 * Okuyanın kararı etkinlik değişince düştü mü (DOM-ILT-032): kendi kararı var ama hiçbiri geçerli
 * değil. Yeniden izin istenir; eski karar satır olarak kalır.
 */
export const decisionDropped = (entry: Pick<PermissionFormStudent, 'decisions'> | undefined) =>
  entry !== undefined &&
  myDecision(entry) === undefined &&
  entry.decisions.some((decision) => decision.mine && !decision.current)

/** Etkinlik ayrıntısı satırları (belirtilenler): gün, saat, yer, ulaşım, ücret. */
export function eventFacts(
  form: Pick<PermissionFormListItem, 'eventDate' | 'eventTime' | 'location' | 'transport' | 'fee'>,
): [string, string][] {
  const facts: [string, string][] = []
  if (form.eventDate) facts.push(['Etkinlik günü', dateLabel(form.eventDate, { year: 'numeric' })])
  if (form.eventTime) facts.push(['Saat', form.eventTime])
  if (form.location) facts.push(['Yer', form.location])
  if (form.transport) facts.push(['Ulaşım', form.transport])
  if (form.fee !== null) facts.push(['Ücret', form.fee === 0 ? 'Ücretsiz' : money(form.fee)])
  return facts
}

/**
 * Çocuğun formları: listede çocuğun hedef olduğu formlar; karar alanlar önce, sonra son günü yakın
 * olan. Veli listesi tüm çocuklarını taşır, çocuk bazında süzme istemcide yapılır.
 */
export function formsForStudent(
  items: readonly PermissionFormListItem[],
  studentId: string,
): PermissionFormListItem[] {
  return items
    .filter((item) => item.studentIds.includes(studentId))
    .sort(
      (a, b) =>
        Number(b.acceptingDecisions) - Number(a.acceptingDecisions) ||
        a.deadline.localeCompare(b.deadline) ||
        a.id.localeCompare(b.id),
    )
}

/** Karar özeti: "Onayladınız" ya da "Henüz karar vermediniz". */
export function myDecisionText(decision: PermissionFormDecision | undefined): string {
  if (!decision) return 'Henüz karar vermediniz.'
  return decision.decision === 'approved' ? 'Onayladınız.' : 'Reddettiniz.'
}

// --- Hata yönlendirme ------------------------------------------------------------

/** Hata tek yerde görünür: alana bağlanan alanda, sürüm çakışması form uyarısında, gerisi toast. */
export function permissionErrorRoutes(kind: PermissionFormKind) {
  return {
    fieldFor: (error: ApiError) => permissionErrorField(error, kind),
    silent: isPermissionVersionConflict,
  }
}
