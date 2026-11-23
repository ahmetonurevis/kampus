import { z } from 'zod'
import {
  assertFileAllowed,
  FILE_PURPOSES,
  type FileCandidate,
  type FilePurpose,
} from '../content/taxonomy.ts'
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
 * tablosundadır (`request.open`, `request.update`, `absence.notify`, `absence.attach`,
 * `absence.approve`, `absence.reject`).
 *
 * - Talep (`requests`, modül `communication`): veli bağlı çocuğu için açar; ön büro ve yönetici
 *   durumu ve ilgili birimi değiştirir, yanıt yazar. Yanıtlar `replies` listesine eklenir,
 *   düzenlenmez ve silinmez; veli yanıtı kendi çocuğunun talebinde görür. Yanıt süresi
 *   (DOM-ILT-013) saklanmaz, `requestResponse` ile talep anından ve ilk yanıttan hesaplanır.
 * - İzin/mazeret (`absences`, modül `academic`): veli bağlı çocuğu için ileri tarihli izin veya
 *   geçmiş tarihli mazeret bildirir (DOM-ILT-053). Bildirim yoklama kaydını değiştirmez
 *   (IST-072); yoklamaya bağlantı öğrenci ve gün eşleşmesinden hesaplanır (`absenceNotices`):
 *   yoklamada "Mazeret bildirildi" görünür, özürlü sayılması belge ve idare onayıyla kesinleşir.
 *   Özür belgesi (`absence_document`, en çok 3) bildirimle ya da sonradan, karar verilmeden ve
 *   belge süresi içinde eklenir; kayda yalnız dosya kimlikleri girer. Yönetici bildirimi onaylar
 *   (`approved`; yoklamada özürlü gösterimi `attendanceExcuse` ile hesaplanır, henüz bağlı değil) ya da gerekçeyle reddeder (`rejected`, özürsüz kalır); karar
 *   bir kez verilir. Durumu olmayan eski kayıt `pending` okunur, yeniden yazılmaz.
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

/** Bildirimin ilk durumu: kuruma iletildi, idare onayı ayrıdır. */
export const ABSENCE_NOTICE_STATUS = 'İletildi'
/** Yoklamada bildirimi olan günün etiketi (DOM-ILT-053). */
export const ABSENCE_NOTICED_LABEL = 'Mazeret bildirildi'

/**
 * İzin/mazeret gerekçesinin genel kategorisi (DOM-ILT-053). Gerekçe yalnız kategori olarak
 * alınır; tanı, ilaç gibi sağlık ayrıntısı alınmaz (KVKK md. 6, en az veri).
 */
export const ABSENCE_REASON_CATEGORIES = ['health', 'family', 'official', 'other'] as const
export type AbsenceReasonCategory = (typeof ABSENCE_REASON_CATEGORIES)[number]
export const ABSENCE_REASON_LABELS: Record<AbsenceReasonCategory, string> = {
  health: 'Sağlık nedeniyle',
  family: 'Ailevi neden',
  official: 'Resmi işlem',
  other: 'Diğer',
}
/** Bildirimin gerekçe etiketi; eski kayıtta kategori yoksa kayıttaki tür metni döner. */
export function absenceReasonLabel(notice: {
  reasonCategory?: string | undefined
  category?: string | undefined
}): string {
  const code = notice.reasonCategory
  return code !== undefined && code in ABSENCE_REASON_LABELS
    ? ABSENCE_REASON_LABELS[code as AbsenceReasonCategory]
    : (notice.category ?? '')
}

/**
 * Özür belgesi süresi (iş günü, devamsızlığın bitiminden itibaren; DOM-ILT-053): ortaokulda 3
 * (OİKY md. 18), lisede 5 (OKY md. 36).
 */
// TODO(regulation-profile): süre mevzuat profilinden okunmalı (DOM-AKD-001); profil yokken
// kademe sınıf düzeyinden çıkarılır. Dil okulunda kurum kuralı tanımlı değildir (DOM-DIL);
// en kısa süre (3 iş günü) uygulanır.
export const ABSENCE_EXCUSE_BUSINESS_DAYS = { middle: 3, high: 5 } as const

/** Bildirim onay durumu (DOM-ILT-053); durumu olmayan eski kayıt `pending` okunur. */
export const ABSENCE_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const
export type AbsenceApprovalStatus = (typeof ABSENCE_APPROVAL_STATUSES)[number]
export const ABSENCE_APPROVAL_LABELS: Record<AbsenceApprovalStatus, string> = {
  pending: 'Onay bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
}
/** Onaylanan bildirimin yoklamadaki etiketi; reddedilen bildirim özürsüz kalır. */
export const ABSENCE_EXCUSED_LABEL = 'Özürlü'
export const ABSENCE_REJECTED_LABEL = 'Mazeret reddedildi'

/** Özür belgesinin dosya amacı (DOM-ILT-053). */
export const ABSENCE_DOCUMENT_PURPOSE = 'absence_document' satisfies FilePurpose
/** Bildirim başına en çok belge (`FILE_PURPOSES.absence_document.maxFiles`). */
export const ABSENCE_DOCUMENT_LIMIT: number = FILE_PURPOSES[ABSENCE_DOCUMENT_PURPOSE].maxFiles
/**
 * Gövdenin kabul ettiği en çok dosya kimliği: kötüye kullanım sınırıdır (400). İş sınırı
 * `ABSENCE_DOCUMENT_LIMIT`'tir ve 422 `absence_document_limit` ile denetlenir.
 */
const ABSENCE_FILE_IDS_MAX = 20
export const ABSENCE_REJECT_REASON_MAX_LENGTH = 500

/**
 * Bildirime eklenebilecek dosya: servis yalnız aktörün kendi yüklediği, silinmemiş ve
 * reddedilmemiş dosyaları verir. Listede olmayan kimlik (başkasının, başka kurumun ya da olmayan
 * dosya) ayırt edilmez.
 */
export type AbsenceFile = FileCandidate & { id: string; purpose: FilePurpose }
export type AbsenceFileOptions = RequestOptions & { files?: readonly AbsenceFile[] }

// kvkk: Ö — belgenin kendisi sağlık verisi olabilir; kayda yalnız kimliği girer.
const absenceFileIds = z
  .array(z.string().trim().min(1, 'Dosya kimliği geçersiz.').max(200))
  .max(ABSENCE_FILE_IDS_MAX, `En fazla ${ABSENCE_DOCUMENT_LIMIT} belge ekleyebilirsiniz.`)
  .refine((ids) => new Set(ids).size === ids.length, 'Aynı belgeyi bir kez ekleyin.')

// Gövde katıdır: serbest açıklama (`reason`) ve bilinmeyen alan reddedilir (API 400).
// `fileIds`: dosya ucundan (`POST /files`, amaç `absence_document`) yüklenen, velinin kendi
// belgeleri; sayı, amaç, tür ve boyut core'da denetlenir (422).
export const notifyAbsenceSchema = z
  .strictObject({
    studentId: identifier,
    startDate: day,
    endDate: day,
    // kvkk: Ç — genel gerekçe kategorisi; sağlık ayrıntısı taşımaz (DOM-ILT-053, KVKK md. 6).
    reasonCategory: z.enum(ABSENCE_REASON_CATEGORIES, 'Gerekçe kategorisini seçin.'),
    fileIds: absenceFileIds.optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'Bitiş tarihi başlangıçtan önce olamaz.',
    path: ['endDate'],
  })
export type NotifyAbsenceInput = z.input<typeof notifyAbsenceSchema>

/** Bildirime sonradan belge ekleme (DOM-ILT-053). */
export const attachAbsenceDocumentsSchema = z.strictObject({
  fileIds: absenceFileIds.min(1, 'En az bir belge seçin.'),
})
export type AttachAbsenceDocumentsInput = z.input<typeof attachAbsenceDocumentsSchema>

/** Onayın gövdesi boştur; bilinmeyen alan 400. */
export const approveAbsenceSchema = z.strictObject({})
export type ApproveAbsenceInput = z.input<typeof approveAbsenceSchema>

// kvkk: Ç — red gerekçesi; kayda yazılmaz, yalnız denetim kaydının gerekçesine (`audit_log.reason`)
// girer ve loglanmaz.
export const rejectAbsenceSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(2, 'Ret gerekçesini yazın.')
    .max(
      ABSENCE_REJECT_REASON_MAX_LENGTH,
      `Gerekçe en fazla ${ABSENCE_REJECT_REASON_MAX_LENGTH} karakter olabilir.`,
    ),
})
export type RejectAbsenceInput = z.input<typeof rejectAbsenceSchema>

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
  state: Pick<AbsenceWindowLookup, 'classes'>,
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
  options: AbsenceFileOptions = {},
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): AbsenceRecord {
  const data = notifyAbsenceSchema.parse(input)
  requireAuthorized(by, 'absence.notify', { studentId: data.studentId }, state, options)
  const student = requireActiveStudent(state, data.studentId)
  const days = excuseBusinessDays(state, student, options.institutionType)
  if (excuseWindowClosed(data.endDate, days, now, calendar))
    throw new DomainError(
      'absence_notice_late',
      `Geçmiş tarihli mazeret devamsızlığın bitiminden itibaren ${days} iş günü içinde bildirilebilir.`,
      { path: ['endDate'] },
    )
  const fileIds = data.fileIds ?? []
  assertAbsenceDocuments(fileIds, 0, options.files ?? [])
  const overlap = state.absences.some(
    (a) =>
      a.studentId === data.studentId && a.startDate <= data.endDate && a.endDate >= data.startDate,
  )
  if (overlap)
    throw new DomainError('absence_overlap', 'Bu tarih aralığında zaten bir bildirim var.', {
      kind: 'conflict',
      path: ['startDate'],
    })
  // TODO(kvkk-mazeret-notu): Serbest açıklama OG-090'ın şifreli özel nitelikli veri tablosu ve
  // `FIELD_ENCRYPTION_KEY` altyapısıyla gelir. O zamana kadar gerekçe yalnız kategoridir; okuma
  // kapsamı yönetici, sınıf rehber öğretmeni ve velidir (DOM-ILT-053, guvenlik-kvkk.md §8).
  const notice: AbsenceRecord = {
    id: makeId('absence'),
    studentId: data.studentId,
    startDate: data.startDate,
    endDate: data.endDate,
    reasonCategory: data.reasonCategory,
    // Eski okuyucular (liste filtresi, Vue/telefon görünümü) türü `category`'den okur.
    category: ABSENCE_REASON_LABELS[data.reasonCategory],
    status: ABSENCE_NOTICE_STATUS,
    approvalStatus: 'pending',
    fileIds,
    date: now,
    createdAt: now,
    notifiedBy: actorOf(by),
  }
  // Yeni kayıt sona eklenir: API öğrencinin bildirimlerini kısmi yükler (yalnız sona ekleme
  // serbesttir); başa eklemek aynı öğrencinin ikinci bildiriminde sırayı bozar.
  state.absences.push(notice)
  return notice
}

/**
 * Belge süresi geçti mi (DOM-ILT-053): bitişi bugünden önce olan bildirim, devamsızlığın
 * bitiminden itibaren `days` iş günü içinde kabul edilir. İleri tarihli izin her zaman açıktır.
 */
function excuseWindowClosed(
  endDate: string,
  days: number,
  now: string,
  calendar: WorkingCalendar,
): boolean {
  const today = dayKey(now)
  return endDate < today && addBusinessDays(endDate, days, calendar) < today
}

/** Özür belgelerinin sayı, varlık, amaç, tür ve boyut denetimi (DOM-ILT-053). */
function assertAbsenceDocuments(
  fileIds: readonly string[],
  attached: number,
  files: readonly AbsenceFile[],
): void {
  const path = ['fileIds']
  if (attached + fileIds.length > ABSENCE_DOCUMENT_LIMIT)
    throw new DomainError(
      'absence_document_limit',
      `Bir bildirime en fazla ${ABSENCE_DOCUMENT_LIMIT} belge eklenebilir.`,
      { path },
    )
  const byId = new Map(files.map((file) => [file.id, file]))
  for (const fileId of fileIds) {
    const file = byId.get(fileId)
    if (!file)
      throw new DomainError(
        'absence_document_unavailable',
        'Belge bulunamadı. Belgeyi yeniden yükleyin.',
        { path },
      )
    if (file.purpose !== ABSENCE_DOCUMENT_PURPOSE)
      throw new DomainError('absence_document_purpose', 'Bu dosya bildirime eklenemez.', { path })
    try {
      assertFileAllowed(ABSENCE_DOCUMENT_PURPOSE, file)
    } catch (error) {
      if (error instanceof DomainError)
        throw new DomainError(error.code, error.message, { path, cause: error })
      throw error
    }
  }
}

/** Bildirimin onay durumu; alanı olmayan eski kayıt `pending` okunur, yeniden yazılmaz. */
export function absenceApprovalStatus(notice: {
  approvalStatus?: string | undefined
}): AbsenceApprovalStatus {
  const status = notice.approvalStatus
  return status === 'approved' || status === 'rejected' ? status : 'pending'
}

const absenceNotFound = () =>
  new DomainError('absence_not_found', 'Bildirim bulunamadı.', { kind: 'not_found' })
const alreadyDecided = () =>
  new DomainError('absence_already_decided', 'Bu bildirim için karar zaten verildi.', {
    kind: 'conflict',
  })

/** Belge süresi hesabının okuduğu kademe verisi: öğrenci sınıfı ve sınıf düzeyi. */
export type AbsenceWindowLookup = {
  students: readonly Pick<StudentRecord, 'id' | 'classId'>[]
  classes: readonly Pick<State['classes'][number], 'id' | 'grade'>[]
}

function absenceDocumentDays(
  state: AbsenceWindowLookup,
  notice: Pick<AbsenceRecord, 'studentId'>,
  institutionType?: InstitutionType,
): number {
  const student = state.students.find((s) => s.id === notice.studentId)
  return student
    ? excuseBusinessDays(state, student, institutionType)
    : ABSENCE_EXCUSE_BUSINESS_DAYS.middle
}

/**
 * Bildirime belge ekleme süresi doldu mu (DOM-ILT-053): `attachAbsenceDocuments` ile aynı hesap
 * (kademeye göre iş günü, tatil takvimi); arayüz süresi dolmuş bildirimde formu göstermez.
 * Karar yine sunucudadır (422 `absence_document_late`).
 */
export function absenceDocumentWindowClosed(
  state: AbsenceWindowLookup,
  notice: Pick<AbsenceRecord, 'studentId' | 'endDate'>,
  now: string,
  institutionType?: InstitutionType,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): boolean {
  const days = absenceDocumentDays(state, notice, institutionType)
  return excuseWindowClosed(notice.endDate, days, now, calendar)
}

/**
 * Veli, bildirimine sonradan özür belgesi ekler (DOM-ILT-053): yalnız karar verilmeden ve belge
 * süresi içinde (bildirimdeki süre); toplam en çok `ABSENCE_DOCUMENT_LIMIT`. Kararlı bildirim
 * 409 `absence_already_decided`, süresi geçen 422 `absence_document_late`. Başka velinin
 * çocuğunun bildirimi olmayan kayıtla aynı 404'tür.
 */
export function attachAbsenceDocuments(
  state: State,
  by: Participant,
  absenceId: string,
  input: unknown,
  now: string,
  options: AbsenceFileOptions = {},
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): AbsenceRecord {
  const data = attachAbsenceDocumentsSchema.parse(input)
  const notice = state.absences.find((a) => a.id === absenceId)
  requireAuthorized(by, 'absence.attach', { studentId: notice?.studentId }, state, options)
  if (!notice) throw absenceNotFound()
  if (absenceApprovalStatus(notice) !== 'pending') throw alreadyDecided()
  const days = absenceDocumentDays(state, notice, options.institutionType)
  if (excuseWindowClosed(notice.endDate, days, now, calendar))
    throw new DomainError(
      'absence_document_late',
      `Özür belgesi devamsızlığın bitiminden itibaren ${days} iş günü içinde eklenebilir.`,
      { path: ['fileIds'] },
    )
  const current = notice.fileIds ?? []
  if (data.fileIds.some((id) => current.includes(id)))
    throw new DomainError('absence_document_duplicate', 'Bu belge bildirime zaten eklendi.', {
      kind: 'conflict',
      path: ['fileIds'],
    })
  assertAbsenceDocuments(data.fileIds, current.length, options.files ?? [])
  notice.fileIds = [...current, ...data.fileIds]
  notice.updatedAt = now
  return notice
}

function decideAbsence(
  state: State,
  by: Participant,
  absenceId: string,
  action: 'absence.approve' | 'absence.reject',
  now: string,
  options: RequestOptions,
): AbsenceRecord {
  const notice = state.absences.find((a) => a.id === absenceId)
  requireAuthorized(by, action, { studentId: notice?.studentId }, state, options)
  if (!notice) throw absenceNotFound()
  if (absenceApprovalStatus(notice) !== 'pending') throw alreadyDecided()
  const approvalStatus = action === 'absence.approve' ? 'approved' : 'rejected'
  notice.approvalStatus = approvalStatus
  // Eski okuyucular (Vue/telefon görünümü, liste süzgeci) durumu `status` metninden okur.
  notice.status = ABSENCE_APPROVAL_LABELS[approvalStatus]
  notice.decidedAt = now
  notice.decidedBy = actorOf(by)
  notice.updatedAt = now
  return notice
}

/**
 * Yönetici bildirimi onaylar (DOM-ILT-053): karar kaydedilir; günlerin yoklamada özürlü
 * gösterimi `attendanceExcuse` ile hesaplanır ama yoklama ekranına ve risk listesine henüz bağlı
 * değildir (`TODO(absence-excuse-display)`). Yoklama kaydı değişmez. Karar bir kez verilir: ikinci karar 409
 * `absence_already_decided`. Belge zorunlu değildir; belgeyi kâğıtta alan idare de onaylar.
 */
export function approveAbsence(
  state: State,
  by: Participant,
  absenceId: string,
  input: unknown,
  now: string,
  options: RequestOptions = {},
): AbsenceRecord {
  approveAbsenceSchema.parse(input)
  return decideAbsence(state, by, absenceId, 'absence.approve', now, options)
}

/**
 * Yönetici bildirimi gerekçeyle reddeder (DOM-ILT-053): günler özürsüz kalır. Gerekçe kayda
 * yazılmaz; API onu denetim kaydının gerekçesine (`audit_log.reason`) yazar.
 */
export function rejectAbsence(
  state: State,
  by: Participant,
  absenceId: string,
  input: unknown,
  now: string,
  options: RequestOptions = {},
): AbsenceRecord {
  rejectAbsenceSchema.parse(input)
  return decideAbsence(state, by, absenceId, 'absence.reject', now, options)
}

/**
 * Yoklama ile bildirimin bağlantısı (DOM-ILT-053): öğrenci ve gün (Europe/Istanbul) bildirim
 * aralığına düşüyorsa bildirim döner. İndeks bir kez kurulur; yoklama kaydı değişmez.
 */
export function absenceNotices<
  T extends Pick<AbsenceRecord, 'id' | 'studentId' | 'startDate' | 'endDate'>,
>(absences: readonly T[]) {
  const byStudent = new Map<string, T[]>()
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

/**
 * Yoklama gününün mazeret durumu (DOM-ILT-053): bildirimi olmayan gün `null`; bekleyen bildirim
 * "Mazeret bildirildi", onaylanan "Özürlü" (`excused`), reddedilen "Mazeret reddedildi" ve
 * özürsüz. Hesap `absenceNotices` bağlantısıyladır; yoklama kaydı değişmez.
 */
// TODO(absence-excuse-display): yoklama ve risk listesine bağlanacak
export function attendanceExcuse(
  absences: readonly Pick<
    AbsenceRecord,
    'id' | 'studentId' | 'startDate' | 'endDate' | 'approvalStatus'
  >[],
) {
  const lookup = absenceNotices(absences)
  return (studentId: string, date: string) => {
    const notice = lookup(studentId, date)
    if (!notice) return null
    const status = absenceApprovalStatus(notice)
    const label =
      status === 'approved'
        ? ABSENCE_EXCUSED_LABEL
        : status === 'rejected'
          ? ABSENCE_REJECTED_LABEL
          : ABSENCE_NOTICED_LABEL
    return { absenceId: notice.id, status, excused: status === 'approved', label }
  }
}
