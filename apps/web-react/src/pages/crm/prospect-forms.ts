// Aday/CRM formlarının saf mantığı: form şemaları, API gövdesi kurma, görüşme anı hesabı ve
// deneme dersi seçenekleri. Kuralların kendisi core'dadır (`lib/prospects.ts`, DOM-KAY-003…009,
// DOM-KAY-030…034); burada yalnız kullanıcıya geçersiz seçeneği göstermemek ve sunucuya gereksiz
// istek atmamak için aynı alan şemaları kullanılır. Karar yine sunucudadır.
import { z } from 'zod'
import type {
  AddProspectNoteBody,
  CreateProspectBody,
  RevertProspectStageBody,
  UpdateProspectDetailsBody,
  ScheduleProspectMeetingBody,
  ScheduleTrialLessonBody,
} from '@kampus/react-shared/use-prospect-commands.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  addProspectNoteSchema,
  createProspectSchema,
  MEETING_DURATION,
  OPEN_PROSPECT_STAGES,
  PROSPECT_LOST_INSTITUTION_MAX,
  PROSPECT_LOST_REASONS,
  prospectAgeGroupRequired,
  revertProspectStageSchema,
  PROSPECT_SOURCES,
  scheduleMeetingSchema,
} from '@kampus/school-core/lib/prospects.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'
import { slotLabel } from './prospect-rows.ts'

/** Gösterilen aydınlatma metninin sürümü (DOM-KAY-003); metin deposu yoktur, sürüm sabittir. */
export const PRIVACY_NOTICE_VERSION = 'aydinlatma-2026-1'
export const PRIVACY_NOTICE_TEXT =
  'Kişisel verileriniz yalnızca kayıt ve iletişim sürecini yürütmek için işlenir; ticari ileti yalnızca onay verirseniz gönderilir.'
export const REFERRAL_SOURCE = 'Veli referansı'

// --- Aday ekleme -------------------------------------------------------------------------

const text = (value: string | undefined) => value?.trim() ?? ''
const optional = (value: string | undefined) => text(value) || undefined

const phoneField = z
  .string()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .pipe(createProspectSchema.shape.phone)

/**
 * Aday formu: çekirdek alan şemalarına ek olarak kurum türüne göre kurallar (dil okulu ve kursta
 * yaş seçimi, 18 yaş altında veli adı, veli referansında referans öğrenci) form düzeyinde sorulur.
 */
export function createFormSchema(type: InstitutionType) {
  return z
    .object({
      name: createProspectSchema.shape.name,
      phone: phoneField,
      email: createProspectSchema.shape.email,
      branchId: createProspectSchema.shape.branchId,
      interest: createProspectSchema.shape.interest,
      source: z.enum(PROSPECT_SOURCES, 'Aday kaynağını seçin.'),
      referrerStudentId: z.string().optional(),
      minor: z.enum(['', 'yes', 'no']).optional(),
      guardianName: z.string().optional(),
      siblingOfId: z.string().optional(),
      sms: z.boolean(),
      emailConsent: z.boolean(),
      call: z.boolean(),
      noticeShown: z.boolean().refine((value) => value, {
        message: 'Aydınlatma metninin adaya gösterildiğini onaylayın.',
      }),
    })
    .superRefine((value, context) => {
      const fail = (path: string, message: string) =>
        context.addIssue({ code: 'custom', path: [path], message })
      if (prospectAgeGroupRequired(type) && !value.minor)
        fail('minor', '18 yaş altı olup olmadığını seçin.')
      if (isMinor(value.minor, type)) {
        const guardian = text(value.guardianName)
        if (guardian.length < 2) fail('guardianName', 'Velinin adını yazın.')
      }
      if (value.source === REFERRAL_SOURCE && !text(value.referrerStudentId))
        fail('referrerStudentId', 'Referans veren öğrenciyi seçin.')
      if (value.emailConsent && !text(value.email))
        fail('emailConsent', 'E-posta onayı için e-posta adresi girin.')
    })
}
export type CreateFormValues = z.input<ReturnType<typeof createFormSchema>>

/** Okul adayı her zaman 18 yaş altıdır; dil okulu ve kursta seçim belirler (DOM-KAY-009). */
export const isMinor = (minor: string | undefined, type: InstitutionType) =>
  !prospectAgeGroupRequired(type) || minor === 'yes'

export function createDefaults(branchId = ''): CreateFormValues {
  return {
    name: '',
    phone: '',
    email: '',
    branchId,
    interest: '',
    source: 'Web sitesi',
    referrerStudentId: '',
    minor: '',
    guardianName: '',
    siblingOfId: '',
    sms: false,
    emailConsent: false,
    call: false,
    noticeShown: false,
  }
}

/** Form → API gövdesi. Boş isteğe bağlı alanlar gönderilmez; veli adı yalnız 18 yaş altında gider. */
export function createBody(
  values: z.output<ReturnType<typeof createFormSchema>>,
  type: InstitutionType,
): CreateProspectBody {
  const minor = isMinor(values.minor, type)
  const consent = { sms: values.sms, email: values.emailConsent, call: values.call }
  const email = optional(values.email)
  const referrerStudentId = optional(values.referrerStudentId)
  const guardianName = optional(values.guardianName)
  const siblingOfId = optional(values.siblingOfId)
  return {
    name: values.name,
    phone: values.phone,
    ...(email ? { email } : {}),
    branchId: values.branchId,
    interest: values.interest,
    source: values.source,
    ...(values.source === REFERRAL_SOURCE && referrerStudentId ? { referrerStudentId } : {}),
    ...(prospectAgeGroupRequired(type) ? { minor } : {}),
    ...(minor && guardianName ? { guardianName } : {}),
    ...(siblingOfId ? { siblingOfId } : {}),
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    marketingConsent: consent,
  }
}

/** Mükerrer ret kodları: eşleşen aday gösterilmez, yalnız sunucunun genel iletisi okunur. */
export const DUPLICATE_CODES = ['prospect_duplicate', 'prospect_contact_shared'] as const
export const isDuplicateCode = (code: string) =>
  (DUPLICATE_CODES as readonly string[]).includes(code)

// --- Aşama değiştirme --------------------------------------------------------------------

export const stageFormSchema = z.object({
  stage: z.string().min(1, 'Aşamayı seçin.'),
  lostReason: z.enum([...PROSPECT_LOST_REASONS, '']).optional(),
  lostToInstitution: z
    .string()
    .trim()
    .max(
      PROSPECT_LOST_INSTITUTION_MAX,
      `En fazla ${PROSPECT_LOST_INSTITUTION_MAX} karakter girebilirsiniz.`,
    )
    .optional(),
  siblingOfId: z.string().optional(),
})
export type StageFormValues = z.input<typeof stageFormSchema>

export const stageDefaults = (): StageFormValues => ({
  stage: '',
  lostReason: '',
  lostToInstitution: '',
  siblingOfId: '',
})

/** Aşama gövdesi (DOM-KAY-005) web ile mobilde ortaktır. */
export { stageBody } from '@kampus/react-shared/prospect-model.ts'

// --- Aday bilgisi düzeltme ---------------------------------------------------------------

/** Aday bilgisi düzeltme formu (DOM-KAY-003): çekirdek alan şemaları; veli adı yalnız 18 yaş altında sorulur. */
export const editFormSchema = z.object({
  name: createProspectSchema.shape.name,
  phone: phoneField,
  email: createProspectSchema.shape.email,
  interest: createProspectSchema.shape.interest,
  guardianName: z.string().optional(),
})
export type EditFormValues = z.input<typeof editFormSchema>

type EditableProspect = {
  name: string
  phone: string
  email?: string | undefined
  interest: string
  guardianName?: string | undefined
  minor?: boolean | undefined
}

export const editDefaults = (prospect: EditableProspect): EditFormValues => ({
  name: prospect.name,
  phone: prospect.phone,
  email: prospect.email ?? '',
  interest: prospect.interest,
  guardianName: prospect.guardianName ?? '',
})

/**
 * Düzeltme gövdesi: yalnız farklı alanlar gönderilir. Değişiklik yoksa `{ ok: false }` döner ve
 * istek atılmaz; dolu veli adı silinemez ve 1 karakterlik girilemez, yetişkin adayda sorulmaz.
 */
export function editBody(
  values: z.output<typeof editFormSchema>,
  prospect: EditableProspect,
):
  | { ok: true; body: UpdateProspectDetailsBody }
  | { ok: false; field: 'root'; message: string }
  | { ok: false; field: 'guardianName'; message: string } {
  const body: UpdateProspectDetailsBody = {}
  if (values.name !== prospect.name) body.name = values.name
  if (values.phone !== prospect.phone) body.phone = values.phone
  if ((values.email ?? '') !== (prospect.email ?? '')) body.email = values.email ?? ''
  if (values.interest !== prospect.interest) body.interest = values.interest
  if (prospect.minor !== false) {
    // Veli adı yalnız dolu bir ad silinirken ya da çok kısa girilirken engellenir; adı hiç
    // yazılmamış eski kayıtta boş bırakmak diğer alanların düzeltilmesini engellemez.
    const guardian = text(values.guardianName)
    const had = text(prospect.guardianName) !== ''
    if (guardian.length > 0 ? guardian.length < 2 : had)
      return { ok: false, field: 'guardianName', message: 'Velinin adını yazın.' }
    if (guardian !== '' && guardian !== text(prospect.guardianName)) body.guardianName = guardian
  }
  return Object.keys(body).length > 0
    ? { ok: true, body }
    : { ok: false, field: 'root', message: 'Değişiklik yapılmadı.' }
}

// --- Aşama geri alma ---------------------------------------------------------------------

/** Yöneticinin aşama geri alma formu (DOM-KAY-030): hedef açık aşama ve zorunlu gerekçe. */
export const revertFormSchema = z.object({
  stage: z.string().min(1, 'Geri alınacak aşamayı seçin.'),
  reason: revertProspectStageSchema.shape.reason,
})
export type RevertFormValues = z.input<typeof revertFormSchema>
export const revertDefaults = (): RevertFormValues => ({ stage: '', reason: '' })

export function revertBody(
  values: z.output<typeof revertFormSchema>,
): { ok: true; body: RevertProspectStageBody } | { ok: false; message: string } {
  const stage = OPEN_PROSPECT_STAGES.find((item) => item === values.stage)
  return stage
    ? { ok: true, body: { stage, reason: values.reason } }
    : { ok: false, message: 'Geri alınacak aşamayı seçin.' }
}

// --- Not ---------------------------------------------------------------------------------

export const noteFormSchema = z.object({ text: addProspectNoteSchema.shape.text })
export type NoteFormValues = z.input<typeof noteFormSchema>
export const noteBody = (values: z.output<typeof noteFormSchema>): AddProspectNoteBody => ({
  text: values.text,
})

// --- Tanışma görüşmesi ------------------------------------------------------------------

/** Türkiye sabit UTC+3'tür (yaz saati yok); görüşme anı Europe/Istanbul duvar saatiyle girilir. */
export function meetingInstant(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const instant = new Date(`${date}T${time}:00+03:00`)
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString()
}

export const meetingFormSchema = z.object({
  date: z.string().min(1, 'Görüşme gününü seçin.'),
  time: z.string().min(1, 'Görüşme saatini seçin.'),
  duration: z.coerce
    .number<string | number>('Süreyi dakika olarak girin.')
    .int('Süre tam sayı olmalıdır.')
    .min(MEETING_DURATION.min, `Süre en az ${MEETING_DURATION.min} dakika olmalıdır.`)
    .max(MEETING_DURATION.max, `Süre en fazla ${MEETING_DURATION.max} dakika olabilir.`),
  room: scheduleMeetingSchema.shape.room,
  teacherId: z.string().optional(),
})
export type MeetingFormValues = z.input<typeof meetingFormSchema>

export const meetingDefaults = (): MeetingFormValues => ({
  date: '',
  time: '10:00',
  duration: MEETING_DURATION.default,
  room: '',
  teacherId: '',
})

/** Geçerli an (ms); bileşenlerde doğrudan `Date.now()` çağrısından kaçınmak için tek giriş. */
export function clockNow(): number {
  return Date.now()
}

/** Gün ve saat birleşir; geçmiş an burada reddedilir (sunucu da `meeting_in_past` der). */
export function meetingBody(
  values: z.output<typeof meetingFormSchema>,
  now: number,
): { ok: true; body: ScheduleProspectMeetingBody } | { ok: false; field: 'date'; message: string } {
  const date = meetingInstant(values.date, values.time)
  if (!date) return { ok: false, field: 'date', message: 'Geçerli bir tarih ve saat seçin.' }
  if (Date.parse(date) <= now)
    return { ok: false, field: 'date', message: 'Gelecek bir tarih ve saat seçin.' }
  const teacher = optional(values.teacherId)
  return {
    ok: true,
    body: {
      date,
      duration: values.duration,
      room: values.room,
      ...(teacher ? { teacherId: teacher } : {}),
    },
  }
}

// --- Deneme dersi -----------------------------------------------------------------------

export const trialFormSchema = z.object({
  lessonId: z.string().min(1, 'Deneme dersini seçin.'),
  guardianConsent: z.boolean().optional(),
})
export type TrialFormValues = z.input<typeof trialFormSchema>
export const trialDefaults = (): TrialFormValues => ({ lessonId: '', guardianConsent: false })

export type TrialLessonOption = { id: string; label: string }

type LessonRecord = Pick<
  CoreRecord<'schedule'>,
  'id' | 'classId' | 'date' | 'duration' | 'title' | 'cancelledAt'
>

/**
 * Seçilebilir dersler: gelecekteki, iptal edilmemiş ve adayın kampüsündeki açık grupların dersleri
 * (DOM-KAY-034). Kapasite ve katılımcı sayısı sunucudadır; dolu ders seçilirse alan hatası gelir.
 */
export function trialLessonOptions(
  lessons: readonly LessonRecord[],
  classes: ReadonlyMap<string, string>,
  now: number,
): TrialLessonOption[] {
  return lessons
    .filter(
      (lesson) =>
        !lesson.cancelledAt && classes.has(lesson.classId) && Date.parse(lesson.date) > now,
    )
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .map((lesson) => ({
      id: lesson.id,
      label: `${dateLabel(lesson.date, { weekday: 'long', year: 'numeric' })} ${slotLabel(lesson.date, lesson.duration)} · ${classes.get(lesson.classId) ?? ''}${lesson.title ? ` · ${lesson.title}` : ''}`,
    }))
}

export const trialBody = (
  values: z.output<typeof trialFormSchema>,
  minor: boolean,
): ScheduleTrialLessonBody => ({
  lessonId: values.lessonId,
  ...(minor ? { guardianConsent: values.guardianConsent === true } : {}),
})

// --- Hata alanları ----------------------------------------------------------------------

type FieldSetter<TName extends string> = (
  name: TName | `root.${string}`,
  error: { type: string; message: string },
) => void

/**
 * Sunucu hata yolu → form alanı. Formda karşılığı olmayan yol (ör. deneme dersinde veli adı)
 * form düzeyi hata olur; ilk alan hatası odak alır, böylece hata her zaman bir yerde görünür.
 */
export function fieldErrors<TName extends string>(
  known: readonly TName[],
  setError: FieldSetter<TName>,
  focus: (name: TName) => void,
) {
  const isKnown = (name: string): name is TName => (known as readonly string[]).includes(name)
  let focused = false
  return (name: string, error: { type: string; message: string }) => {
    if (!isKnown(name)) return setError('root.server', error)
    setError(name, error)
    // Gönderim sürerken alan kilitlidir; odağı `useFocusAfterSubmit` alan açılınca verir.
    if (!focused) focus(name)
    focused = true
  }
}
