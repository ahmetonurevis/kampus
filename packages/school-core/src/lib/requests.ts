import { z } from 'zod'
import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { requireAuthorized } from './authorize.ts'
import {
  DEFAULT_WORKING_CALENDAR,
  responseDueAt,
  type Participant,
  type WorkingCalendar,
} from './communication.ts'
import type { MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'

/**
 * Veli talep/şikayet/öneri ve izin/mazeret bildirimi (docs/domain/iletisim-ve-veli.md). Saf
 * işlemler; önce bütün kurallar denetlenir, sonra State değişir. Yetki `lib/authorize.ts`
 * tablosundadır (`request.open`, `request.update`, `absence.notify`).
 *
 * - Talep (`requests`, modül `communication`): veli bağlı çocuğu için açar; ön büro ve yönetici
 *   durumu ve ilgili birimi değiştirir, yanıt yazar. Yanıtlar `replies` listesine eklenir,
 *   düzenlenmez ve silinmez; veli yanıtı kendi çocuğunun talebinde görür. Yanıt süresi
 *   (DOM-ILT-013) saklanmaz, `requestResponse` ile talep anından ve ilk yanıttan hesaplanır.
 * - İzin/mazeret (`absences`, modül `academic`): veli bağlı çocuğu için ileri tarihli izin veya
 *   geçmiş tarihli mazeret bildirir (DOM-ILT-053). Bildirim yoklama kaydını değiştirmez
 *   (IST-072); yoklamaya bağlantı öğrenci ve gün eşleşmesinden hesaplanır (`absenceNotices`):
 *   yoklamada "Mazeret bildirildi" görünür, özürlü sayılması belge ve idare onayıyla kesinleşir.
 *   Mazeret metni sağlık bilgisi içerebileceği için ayrıca talep kaydı açılmaz; ön büro
 *   `absences`'ı okuyamaz (DOM-ILT-053, DOM-YTK-021).
 *
 * Şemalar API gövde şeması ve web/mobil form şemasıdır (`zodResolver`).
 */

z.config(z.locales.tr())

export type RequestOptions = { institutionType?: InstitutionType }

const identifier = z.string().trim().min(1, 'Bir öğrenci seçin.').max(200)
const day = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(`${v}T09:00:00Z`)) &&
      new Date(`${v}T09:00:00Z`).toISOString().slice(0, 10) === v,
    'Geçerli bir tarih seçin.',
  )

// --- Talep ---------------------------------------------------------------------------------

/** Bildirim türleri (Vue `requestForm.category`). */
export const REQUEST_CATEGORIES = ['Talep', 'Şikayet', 'Öneri'] as const
/** Talep durumları; `Yeni` henüz ele alınmamış talebi gösterir. */
export const REQUEST_STATUSES = ['Yeni', 'İnceleniyor', 'Çözüldü'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]
/** Talebin yönlendirilebildiği birimler (Vue `requestEdit.assignedTo`); yeni talep ön büroya düşer. */
export const REQUEST_UNITS = [
  'Ön büro',
  'Akademik koordinatör',
  'Finans birimi',
  'Şube müdürü',
] as const
export const REQUEST_TITLE_MAX_LENGTH = 120
export const REQUEST_TEXT_MAX_LENGTH = 2000

// kvkk: Ç — velinin serbest metni; loglanmaz, denetim kaydına yalnız alan adı yazılır.
const requestText = z
  .string()
  .trim()
  .min(2, 'En az iki karakter girin.')
  .max(REQUEST_TEXT_MAX_LENGTH, `En fazla ${REQUEST_TEXT_MAX_LENGTH} karakter yazabilirsiniz.`)

export const openRequestSchema = z.object({
  studentId: identifier,
  category: z.enum(REQUEST_CATEGORIES, 'Bildirim türünü seçin.'),
  title: z
    .string()
    .trim()
    .min(2, 'Konuyu yazın.')
    .max(REQUEST_TITLE_MAX_LENGTH, `Konu en fazla ${REQUEST_TITLE_MAX_LENGTH} karakter olabilir.`),
  text: requestText,
})
export type OpenRequestInput = z.input<typeof openRequestSchema>

/** Ön büro ve yönetici: durum, ilgili birim ve yanıt; en az biri verilir. */
export const updateRequestSchema = z
  .object({
    status: z.enum(REQUEST_STATUSES, 'Durumu seçin.').optional(),
    assignedTo: z.enum(REQUEST_UNITS, 'İlgili birimi seçin.').optional(),
    reply: requestText.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Durum, ilgili birim veya yanıt girin.',
    path: ['status'],
  })
export type UpdateRequestInput = z.input<typeof updateRequestSchema>

/** İşlemi yapan kişi; API'de kullanıcı kimliği. */
export type RequestActor = {
  role: Role
  // kvkk: K
  userId: string
}
export type RequestReply = {
  id: string
  // kvkk: Ç — kurumun veliye yanıtı; loglanmaz.
  text: string
  at: string
  by: RequestActor
}
/** Talep işlemlerinin eklediği alanlar; örnek veri ve eski kayıtlar taşımaz. */
export type RequestFields = {
  openedBy?: RequestActor
  replies?: RequestReply[]
  updatedAt?: string
}

type RequestRecord = State['requests'][number]
type StudentRecord = State['students'][number]

const actorOf = (by: Participant): RequestActor => ({ role: by.role, userId: by.userId })

/**
 * Pasif (ayrılmış, mezun) öğrenci için veli yalnız geçmiş kayıtları okur; yeni talep veya
 * bildirim açamaz (DOM-YTK-025). Kapsam önce denetlendiği için öğrenci burada vardır.
 */
function requireActiveStudent(state: State, studentId: string): StudentRecord {
  const student = state.students.find((s) => s.id === studentId)
  if (!student)
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  if (student.isActive === false)
    throw new DomainError(
      'student_inactive',
      'Kaydı pasif olan öğrenci için yeni bildirim yapılamaz.',
      { path: ['studentId'] },
    )
  return student
}

/**
 * Veli bağlı çocuğu için talep, şikayet veya öneri açar. Talep `Yeni` durumunda ön büroya düşer.
 * Mükerrer gönderim istek anahtarıyla önlenir (API `Idempotency-Key` zorunlu).
 */
export function openRequest(
  state: State,
  by: Participant,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: RequestOptions = {},
): RequestRecord {
  const data = openRequestSchema.parse(input)
  requireAuthorized(by, 'request.open', { studentId: data.studentId }, state, options)
  requireActiveStudent(state, data.studentId)
  // TODO(separate-parents): her velinin talebi ayrı görünmeli (DOM-ILT-073); öğrenci başına
  // tek veli olduğu sürece okuma kapsamı öğrenciye göredir, açan kişi `openedBy`'da saklanır.
  const request: RequestRecord = {
    id: makeId('req'),
    studentId: data.studentId,
    title: data.title,
    text: data.text,
    category: data.category,
    status: 'Yeni',
    assignedTo: 'Ön büro',
    date: now,
    openedBy: actorOf(by),
    replies: [],
  }
  // TODO(notifications): ön büroya uygulama içi bildirim (DOM-ILT-020).
  state.requests.unshift(request)
  return request
}

/**
 * Ön büro veya yönetici talebin durumunu ve ilgili birimini değiştirir, yanıt yazar. Yanıt
 * eklenir, önceki yanıtlar değişmez. Çözülen talep yeniden incelemeye alınmadan değişmez;
 * ele alınmış talep `Yeni` durumuna dönmez.
 */
export function updateRequest(
  state: State,
  by: Participant,
  requestId: string,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: RequestOptions = {},
): RequestRecord {
  const data = updateRequestSchema.parse(input)
  requireAuthorized(by, 'request.update', {}, state, options)
  const request = state.requests.find((r) => r.id === requestId)
  if (!request)
    throw new DomainError('request_not_found', 'Talep bulunamadı.', { kind: 'not_found' })
  const status = data.status ?? request.status
  const assignedTo = data.assignedTo ?? request.assignedTo
  if (status === request.status && assignedTo === request.assignedTo && data.reply === undefined)
    throw new DomainError('request_unchanged', 'Talepte değişiklik yok.', { kind: 'conflict' })
  if (request.status === 'Çözüldü' && status === 'Çözüldü')
    throw new DomainError(
      'request_resolved',
      'Çözülen talep değiştirilemez; önce durumu "İnceleniyor" yapın.',
      { kind: 'conflict', path: ['status'] },
    )
  if (status === 'Yeni' && request.status !== 'Yeni')
    throw new DomainError('request_status_invalid', 'Ele alınmış talep "Yeni" durumuna dönemez.', {
      path: ['status'],
    })
  const replies = [...(request.replies ?? [])]
  if (data.reply !== undefined)
    replies.push({ id: makeId('reply'), text: data.reply, at: now, by: actorOf(by) })
  Object.assign(request, { status, assignedTo, replies, updatedAt: now })
  // TODO(notifications): yanıt ve çözümde veliye bildirim (DOM-ILT-020).
  return request
}

export type RequestResponse = {
  /** Hedef yanıt anı (ISO UTC); kurum takvimine göre bir iş günü (DOM-ILT-013). */
  dueAt: string
  /** İlk yanıtın anı; yanıt yoksa `null`. */
  answeredAt: string | null
  /** Yanıtsız, çözülmemiş ve hedef süre geçmiş. */
  overdue: boolean
}

/**
 * Talebin yanıt süresi (DOM-ILT-013): hedef, talep anından itibaren iş saatiyle bir iş günüdür;
 * ilk yanıt veya çözüm saati durdurur. Değer saklanmaz, her okumada hesaplanır.
 */
export function requestResponse(
  request: Pick<RequestRecord, 'date' | 'status'> & RequestFields,
  now: string,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): RequestResponse {
  const dueAt = responseDueAt(request.date, calendar)
  const answeredAt = request.replies?.[0]?.at ?? null
  return {
    dueAt,
    answeredAt,
    overdue:
      answeredAt === null && request.status !== 'Çözüldü' && Date.parse(now) > Date.parse(dueAt),
  }
}

// --- İzin ve mazeret -------------------------------------------------------------------------

/** Mazeret türleri (Vue `absenceForm.category`). */
export const ABSENCE_CATEGORIES = ['Sağlık', 'Ailevi nedenler', 'Seyahat', 'Diğer'] as const
/** Bildirimin ilk durumu: kuruma iletildi, idare onayı ayrıdır. */
export const ABSENCE_NOTICE_STATUS = 'İletildi'
/** Yoklamada bildirimi olan günün etiketi (DOM-ILT-053). */
export const ABSENCE_NOTICED_LABEL = 'Mazeret bildirildi'
export const ABSENCE_REASON_MAX_LENGTH = 1000

/**
 * Özür belgesi süresi (iş günü, devamsızlığın bitiminden itibaren; DOM-ILT-053): ortaokulda 3
 * (OİKY md. 18), lisede 5 (OKY md. 36).
 */
// TODO(regulation-profile): süre mevzuat profilinden okunmalı (DOM-AKD-001); profil yokken
// kademe sınıf düzeyinden çıkarılır. Dil okulunda kurum kuralı tanımlı değildir (DOM-DIL);
// en kısa süre (3 iş günü) uygulanır.
export const ABSENCE_EXCUSE_BUSINESS_DAYS = { middle: 3, high: 5 } as const

export const notifyAbsenceSchema = z
  .object({
    studentId: identifier,
    startDate: day,
    endDate: day,
    category: z.enum(ABSENCE_CATEGORIES, 'Mazeret türünü seçin.'),
    // kvkk: Ö — mazeret metni sağlık bilgisi içerebilir (DOM-ILT-053, KVKK md. 6); loglanmaz.
    reason: z
      .string()
      .trim()
      .min(2, 'Açıklama yazın.')
      .max(
        ABSENCE_REASON_MAX_LENGTH,
        `Açıklama en fazla ${ABSENCE_REASON_MAX_LENGTH} karakter olabilir.`,
      ),
    /** Özür belgesi; dosya deposu gelene kadar kabul edilmez (422 `absence_files_unsupported`). */
    files: z.array(z.string().trim().min(1).max(200)).max(5).optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'Bitiş tarihi başlangıçtan önce olamaz.',
    path: ['endDate'],
  })
export type NotifyAbsenceInput = z.input<typeof notifyAbsenceSchema>

type AbsenceRecord = State['absences'][number]

const DAY_MS = 24 * 60 * 60 * 1000
const isoWeekday = (key: string) => {
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay()
  return weekday === 0 ? 7 : weekday
}
const nextDay = (key: string) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)

/** `from` gününden sonraki `count`. iş günü (takvimin hafta günleri ve tatilleri). */
export function addBusinessDays(
  from: string,
  count: number,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): string {
  if (calendar.weekdays.length === 0)
    throw new DomainError('working_calendar_invalid', 'Çalışma takvimi geçersiz.')
  let key = from
  let remaining = Math.max(0, count)
  // Tatil listesi sonlu olduğu için döngü biter; yine de üst sınır konur.
  for (let guard = 0; remaining > 0 && guard < 3700; guard += 1) {
    key = nextDay(key)
    if (calendar.weekdays.includes(isoWeekday(key)) && !calendar.holidays.includes(key))
      remaining -= 1
  }
  return key
}

/** Öğrencinin kademesine göre özür belgesi süresi (iş günü). */
export function excuseBusinessDays(
  state: Pick<State, 'classes'>,
  student: Pick<StudentRecord, 'classId'>,
  institutionType: InstitutionType = 'school',
): number {
  if (institutionType !== 'school') return ABSENCE_EXCUSE_BUSINESS_DAYS.middle
  const grade = state.classes.find((c) => c.id === student.classId)?.grade
  return grade !== undefined && grade >= 9
    ? ABSENCE_EXCUSE_BUSINESS_DAYS.high
    : ABSENCE_EXCUSE_BUSINESS_DAYS.middle
}

/**
 * Veli bağlı çocuğu için izin veya mazeret bildirir (DOM-ILT-053). İleri tarihli izin her zaman,
 * geçmiş tarihli mazeret devamsızlığın bitiminden itibaren özür belgesi süresi içinde kabul
 * edilir. Aynı öğrencinin örtüşen bildirimi varsa reddedilir. Bildirim yoklamayı değiştirmez
 * (IST-072) ve talep kaydı açmaz.
 */
export function notifyAbsence(
  state: State,
  by: Participant,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: RequestOptions = {},
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): AbsenceRecord {
  const data = notifyAbsenceSchema.parse(input)
  requireAuthorized(by, 'absence.notify', { studentId: data.studentId }, state, options)
  // TODO(absence-files): özür belgesi dosya deposu (`files`) gelince eklenir; o zamana kadar
  // belge istenirse kayıt açılmaz.
  if (data.files !== undefined && data.files.length > 0)
    throw new DomainError(
      'absence_files_unsupported',
      'Belge ekleme henüz kullanılamıyor; belgeyi okula ayrıca iletin.',
      { path: ['files'] },
    )
  const student = requireActiveStudent(state, data.studentId)
  const today = dayKey(now)
  if (data.endDate < today) {
    const days = excuseBusinessDays(state, student, options.institutionType)
    if (addBusinessDays(data.endDate, days, calendar) < today)
      throw new DomainError(
        'absence_notice_late',
        `Geçmiş tarihli mazeret devamsızlığın bitiminden itibaren ${days} iş günü içinde bildirilebilir.`,
        { path: ['endDate'] },
      )
  }
  const overlap = state.absences.some(
    (a) =>
      a.studentId === data.studentId && a.startDate <= data.endDate && a.endDate >= data.startDate,
  )
  if (overlap)
    throw new DomainError('absence_overlap', 'Bu tarih aralığında zaten bir bildirim var.', {
      kind: 'conflict',
      path: ['startDate'],
    })
  // TODO(health-data-storage): mazeret metni özel nitelikli olabilir (KVKK md. 6); şifreli ayrı
  // tabloya taşınana kadar `records`'ta durur, okuma kapsamı yönetici, sınıf rehber öğretmeni ve
  // veliyle sınırlıdır (DOM-ILT-053, guvenlik-kvkk.md §8).
  const notice: AbsenceRecord = {
    id: makeId('absence'),
    studentId: data.studentId,
    startDate: data.startDate,
    endDate: data.endDate,
    category: data.category,
    reason: data.reason,
    status: ABSENCE_NOTICE_STATUS,
    date: now,
    createdAt: now,
    notifiedBy: actorOf(by),
  }
  // TODO(absence-approval): özürlü sayılma belge ve idare onayıyla kesinleşir (DOM-ILT-053);
  // onay işlemi ayrıdır.
  state.absences.unshift(notice)
  return notice
}

/**
 * Yoklama ile bildirimin bağlantısı (DOM-ILT-053): öğrenci ve gün (Europe/Istanbul) bildirim
 * aralığına düşüyorsa bildirim döner. İndeks bir kez kurulur; yoklama kaydı değişmez.
 */
export function absenceNotices(
  absences: readonly Pick<AbsenceRecord, 'id' | 'studentId' | 'startDate' | 'endDate'>[],
) {
  const byStudent = new Map<string, (typeof absences)[number][]>()
  for (const notice of absences) {
    const list = byStudent.get(notice.studentId)
    if (list) list.push(notice)
    else byStudent.set(notice.studentId, [notice])
  }
  return (studentId: string, date: string) => {
    const key = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dayKey(date)
    return byStudent.get(studentId)?.find((n) => n.startDate <= key && n.endDate >= key) ?? null
  }
}
