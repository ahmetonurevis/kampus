import { z } from 'zod'

import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'

/**
 * Gezi planı ve onay dosyası (docs/domain/finans.md DOM-FIN-111; ON-155). Plan gezinin adını,
 * amacını ve kazanımını, çıkış ve dönüş anını, güzergâhını (durak listesi), görevli öğretmenlerini
 * (en az bir sorumlu), beklenen öğrenci sayısını, ulaşımını (araç türü, firma, plaka, sürücü ve
 * isteğe bağlı belge dosyası), risk değerlendirmesini (risk ve önlem) ve acil iletişim kişilerini
 * taşır; isteğe bağlı olarak bir ücretli etkinliğe (DOM-FIN-098) bağlanır (K-366). Taslağı ön büro
 * ya da yönetici yazar ve onaya gönderir; onay ve ret (gerekçeyle) yalnız yöneticidedir. Onaya
 * gönderilmiş, onaylanmış ya da reddedilmiş plan düzeltilince taslağa döner ve yeniden onay ister
 * (K-367). İl/ilçe millî eğitim bildirimi otomatik değildir; onaylanmış planda "bildirim yapıldı"
 * işareti ve günü tutulur (K-368). Öğrenci başına görevli oranı yalnız uyarıdır. Fonksiyonlar
 * saftır; an `now` ile gelir, gün Europe/Istanbul'dur. Mevzuat karşılığı **doğrulanmalı** (H-72,
 * H-73).
 */

/** Okuma, taslak, düzeltme, onaya gönderme ve bildirim işareti (K-367). */
export const TRIP_PLAN_ROLES = ['yonetici', 'onburo'] as const
/** Onay, ret ve tamamlama yalnız yöneticidedir (K-367). */
export const TRIP_PLAN_APPROVER_ROLES = ['yonetici'] as const

export const TRIP_PLAN_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'completed',
  'cancelled',
] as const
export type TripPlanStatus = (typeof TRIP_PLAN_STATUSES)[number]
export const TRIP_PLAN_STATUS_LABELS = {
  draft: 'Taslak',
  submitted: 'Onay bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  completed: 'Tamamlandı',
  cancelled: 'İptal edildi',
} as const satisfies Record<TripPlanStatus, string>
/** Liste süzgeci: `active` sürenler, `done` tamamlanan ya da iptal edilenler. */
export const TRIP_PLAN_STATES = ['active', 'done'] as const
export type TripPlanState = (typeof TRIP_PLAN_STATES)[number]
export const TRIP_PLAN_DONE_STATUSES = ['completed', 'cancelled'] as const

export const TRIP_PLAN_EVENTS = [
  'created',
  'submitted',
  'approved',
  'rejected',
  'reopened',
  'authority_notified',
  'completed',
  'cancelled',
] as const
export type TripPlanEvent = (typeof TRIP_PLAN_EVENTS)[number]
export const TRIP_PLAN_EVENT_LABELS = {
  created: 'Taslak açıldı',
  submitted: 'Onaya gönderildi',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  reopened: 'Düzeltildi, yeniden onay gerekiyor',
  authority_notified: 'Millî eğitim bildirimi işaretlendi',
  completed: 'Tamamlandı',
  cancelled: 'İptal edildi',
} as const satisfies Record<TripPlanEvent, string>

export const TRIP_STAFF_ROLES = ['lead', 'assistant'] as const
export type TripStaffRole = (typeof TRIP_STAFF_ROLES)[number]
export const TRIP_STAFF_ROLE_LABELS = {
  lead: 'Sorumlu öğretmen',
  assistant: 'Görevli öğretmen',
} as const satisfies Record<TripStaffRole, string>
/** Görevli olabilen kurum rolleri: öğretmen ve yönetici (müdür, müdür yardımcısı; K-366). */
export const TRIP_STAFF_MEMBER_ROLES = ['ogretmen', 'yonetici'] as const

export const TRIP_TRANSPORT_TYPES = [
  'bus',
  'minibus',
  'train',
  'plane',
  'ship',
  'walking',
  'other',
] as const
export type TripTransportType = (typeof TRIP_TRANSPORT_TYPES)[number]
export const TRIP_TRANSPORT_TYPE_LABELS = {
  bus: 'Otobüs',
  minibus: 'Minibüs',
  train: 'Tren',
  plane: 'Uçak',
  ship: 'Gemi ya da feribot',
  walking: 'Yürüyerek',
  other: 'Diğer',
} as const satisfies Record<TripTransportType, string>
/** Kara yolu aracı: onaya gönderirken firma, plaka ve sürücü zorunludur (K-366). */
export const TRIP_ROAD_TRANSPORT_TYPES = ['bus', 'minibus'] as const

export const TRIP_NAME_MIN = 3
export const TRIP_NAME_MAX = 120
export const TRIP_PURPOSE_MIN = 10
export const TRIP_PURPOSE_MAX = 2000
export const TRIP_STOPS_MAX = 30
export const TRIP_STOP_PLACE_MAX = 120
export const TRIP_STOP_NOTE_MAX = 300
export const TRIP_STAFF_MAX = 30
export const TRIP_RISKS_MAX = 30
export const TRIP_RISK_MAX = 300
export const TRIP_MEASURE_MAX = 500
export const TRIP_CONTACTS_MAX = 5
export const TRIP_PERSON_NAME_MAX = 120
export const TRIP_RELATION_MAX = 80
export const TRIP_COMPANY_MAX = 120
export const TRIP_STUDENTS_MAX = 2000
/** Çıkış ile dönüş arası en çok 30 gün. */
export const TRIP_MAX_DAYS = 30
export const TRIP_REASON_MIN = 5
export const TRIP_REASON_MAX = 500
export const TRIP_NOTE_MAX = 500
export const TRIP_AUTHORITY_REFERENCE_MAX = 60
/**
 * Görevli başına öğrenci sayısı uyarı eşiği (K-366): beklenen öğrenci sayısı görevli sayısının
 * 15 katını aşarsa plan uyarı taşır, kayıt engellenmez. Mevzuattaki oran **doğrulanmalı** (H-72).
 */
export const TRIP_STUDENTS_PER_STAFF = 15

const PHONE_PATTERN = /^0\d{10}$/
/** Plaka: il kodu (01–81), 1–3 harf, 2–5 rakam; boşluksuz büyük harfle saklanır. */
const PLATE_PATTERN = /^(0[1-9]|[1-7]\d|8[01])[A-Z]{1,3}\d{2,5}$/

/** Plan numarası kurum sırasından türetilir (`GZ-0007`); saklanan yalnız sıradır. */
export function tripPlanNumber(sequence: number): string {
  return `GZ-${String(sequence).padStart(4, '0')}`
}

/** Plakayı boşluksuz, Türkçe büyük harfle yazar (`34 abc 123` → `34ABC123`). */
export function normalizeTripPlate(value: string): string {
  return value.replace(/[\s-]+/g, '').toLocaleUpperCase('tr-TR')
}

/** Saklanan plakayı okunur yazar: `34ABC123` → `34 ABC 123`; kalıba uymazsa olduğu gibi. */
export function tripPlateLabel(plate: string): string {
  const match = /^(\d{2})([A-Z]{1,3})(\d{2,5})$/.exec(plate)
  return match ? `${match[1]} ${match[2]} ${match[3]}` : plate
}

// --- Şemalar -------------------------------------------------------------------------------------

const maxMessage = (max: number) => `En fazla ${String(max)} karakter girebilirsiniz.`
const requiredText = (missing: string, min: number, max: number, short: string) =>
  z.string(missing).trim().min(min, short).max(max, maxMessage(max))
const optionalText = (max: number, min = 1, short = 'Bu alan çok kısa.') =>
  z
    .string()
    .trim()
    .max(max, maxMessage(max))
    .transform((value) => (value === '' ? null : value))
    .pipe(z.string().min(min, short).nullable())
    .nullable()
    .default(null)
const phoneSchema = z
  .string('Telefonu girin.')
  .transform((value) => value.replace(/[\s()-]+/g, ''))
  .pipe(z.string().regex(PHONE_PATTERN, 'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.'))
const instantSchema = (label: string) =>
  z.iso
    .datetime({ offset: true, error: `${label} için geçerli bir gün ve saat girin.` })
    .transform((value) => new Date(value).toISOString())

const stopSchema = z.strictObject({
  place: requiredText(
    'Durağın yerini yazın.',
    2,
    TRIP_STOP_PLACE_MAX,
    'Yeri en az 2 karakterle yazın (ör. Anıtkabir).',
  ),
  note: optionalText(TRIP_STOP_NOTE_MAX).describe('Durakta yapılacak etkinlik ya da saat notu'),
})

const staffMemberSchema = z.strictObject({
  membershipId: z
    .string('Öğretmen seçin.')
    .trim()
    .min(1, 'Öğretmen seçin.')
    .max(100, 'Öğretmen geçersiz.')
    .describe('Görevlinin kurum üyeliği (öğretmen ya da yönetici)'),
  role: z.enum(TRIP_STAFF_ROLES, 'Görevi seçin.').describe('`lead` sorumlu, `assistant` görevli'),
})

/** Görevli listesi (K-366): 1–30 kişi, aynı kişi iki kez yazılmaz, en az bir sorumlu öğretmen. */
const staffListSchema = z
  .array(staffMemberSchema, 'Görevli öğretmenleri ekleyin.')
  .min(1, 'En az bir görevli öğretmen ekleyin.')
  .max(TRIP_STAFF_MAX, `En fazla ${String(TRIP_STAFF_MAX)} görevli eklenebilir.`)
  .superRefine((staff, context) => {
    const seen = new Set<string>()
    staff.forEach((member, index) => {
      if (seen.has(member.membershipId))
        context.addIssue({
          code: 'custom',
          path: [index, 'membershipId'],
          message: 'Aynı öğretmen iki kez eklenemez.',
        })
      seen.add(member.membershipId)
    })
    if (staff.length > 0 && !staff.some((member) => member.role === 'lead'))
      context.addIssue({
        code: 'custom',
        path: [0, 'role'],
        message: 'En az bir sorumlu öğretmen seçin.',
      })
  })

const transportSchema = z.strictObject({
  type: z
    .enum(TRIP_TRANSPORT_TYPES, 'Ulaşım türünü seçin.')
    .describe('Araç türü; otobüs ve minibüste onaya gönderirken firma, plaka ve sürücü zorunlu'),
  company: optionalText(TRIP_COMPANY_MAX, 2, 'Firma adını en az 2 karakterle yazın.').describe(
    'Taşıma firması',
  ),
  plate: z
    .string()
    .transform(normalizeTripPlate)
    .transform((value) => (value === '' ? null : value))
    .pipe(z.string().regex(PLATE_PATTERN, 'Plakayı 34 ABC 123 biçiminde girin.').nullable())
    .nullable()
    .default(null)
    .describe('Araç plakası; boşluksuz büyük harfle saklanır'),
  driverName: optionalText(
    TRIP_PERSON_NAME_MAX,
    2,
    'Sürücünün adını en az 2 karakterle yazın.',
  ).describe('Sürücü adı soyadı'),
  driverPhone: phoneSchema.nullable().default(null).describe('Sürücü telefonu (0XXXXXXXXXX)'),
  documentFileId: z
    .uuid('Belge dosyası geçersiz.')
    .nullable()
    .default(null)
    .describe(
      'Ulaşım belgesi (araç ruhsatı, sözleşme, sigorta; `POST /files`, `purpose: document`)',
    ),
})

const riskSchema = z.strictObject({
  risk: requiredText('Riski yazın.', 3, TRIP_RISK_MAX, 'Riski en az 3 karakterle yazın.'),
  measure: requiredText(
    'Alınacak önlemi yazın.',
    3,
    TRIP_MEASURE_MAX,
    'Önlemi en az 3 karakterle yazın.',
  ),
})

const contactSchema = z.strictObject({
  name: requiredText(
    'Acil durumda aranacak kişinin adını yazın.',
    2,
    TRIP_PERSON_NAME_MAX,
    'Adı en az 2 karakterle yazın.',
  ),
  phone: phoneSchema,
  relation: optionalText(TRIP_RELATION_MAX).describe('Görevi ya da yakınlığı (ör. okul müdürü)'),
})

const tripFields = {
  name: requiredText(
    'Gezinin adını yazın.',
    TRIP_NAME_MIN,
    TRIP_NAME_MAX,
    'Adı en az 3 karakterle yazın (ör. Anıtkabir gezisi).',
  ),
  purpose: requiredText(
    'Gezinin amacını ve kazanımını yazın.',
    TRIP_PURPOSE_MIN,
    TRIP_PURPOSE_MAX,
    'Amacı ve kazanımı en az 10 karakterle yazın.',
  ).describe('Amaç ve kazanım (ders, kazanım ya da etkinlik ilişkisi)'),
  departureAt: instantSchema('Çıkış').describe('Çıkış anı (ISO 8601); gösterim Europe/Istanbul'),
  returnAt: instantSchema('Dönüş').describe('Dönüş anı (ISO 8601); çıkıştan sonra, en çok 30 gün'),
  expectedStudentCount: z
    .int('Öğrenci sayısını tam sayı girin.')
    .min(1, 'Beklenen öğrenci sayısı en az 1 olmalıdır.')
    .max(TRIP_STUDENTS_MAX, `En fazla ${String(TRIP_STUDENTS_MAX)} öğrenci girilebilir.`)
    .describe('Beklenen öğrenci sayısı; görevli oranı uyarısı buna göre hesaplanır'),
  stops: z
    .array(stopSchema, 'Güzergâhı ekleyin.')
    .min(1, 'Güzergâha en az bir durak ekleyin.')
    .max(TRIP_STOPS_MAX, `En fazla ${String(TRIP_STOPS_MAX)} durak eklenebilir.`)
    .describe('Güzergâh, sırayla'),
  staff: staffListSchema.describe('Görevli öğretmenler; en az bir sorumlu'),
  transport: transportSchema,
  risks: z
    .array(riskSchema)
    .max(TRIP_RISKS_MAX, `En fazla ${String(TRIP_RISKS_MAX)} risk maddesi eklenebilir.`)
    .describe('Risk değerlendirmesi; onaya gönderirken en az bir madde'),
  emergencyContacts: z
    .array(contactSchema)
    .max(
      TRIP_CONTACTS_MAX,
      `En fazla ${String(TRIP_CONTACTS_MAX)} acil iletişim kişisi eklenebilir.`,
    )
    .describe('Acil iletişim; onaya gönderirken en az bir kişi'),
  paidActivityId: z
    .uuid('Ücretli etkinlik geçersiz.')
    .nullable()
    .describe('İsteğe bağlı ücretli etkinlik (DOM-FIN-098); ücretsiz gezide boş'),
}

/** Yeni plan (K-366): bütün alanlar; risk ve acil iletişim taslakta boş kalabilir. */
export const tripPlanSchema = z.strictObject({
  ...tripFields,
  risks: tripFields.risks.default([]),
  emergencyContacts: tripFields.emergencyContacts.default([]),
  paidActivityId: tripFields.paidActivityId.default(null),
})
export type TripPlanInput = z.input<typeof tripPlanSchema>
export type TripPlanFields = z.output<typeof tripPlanSchema>
export type TripStop = z.output<typeof stopSchema>
export type TripStaffMember = z.output<typeof staffMemberSchema>
export type TripTransport = z.output<typeof transportSchema>
export type TripRisk = z.output<typeof riskSchema>
export type TripContact = z.output<typeof contactSchema>

/** Düzeltme (K-367): verilen alanlar değişir; listeler ve ulaşım bütün olarak yazılır. */
export const updateTripPlanSchema = z.strictObject({
  name: tripFields.name.optional(),
  purpose: tripFields.purpose.optional(),
  departureAt: tripFields.departureAt.optional(),
  returnAt: tripFields.returnAt.optional(),
  expectedStudentCount: tripFields.expectedStudentCount.optional(),
  stops: tripFields.stops.optional(),
  staff: tripFields.staff.optional(),
  transport: transportSchema.optional(),
  risks: tripFields.risks.optional(),
  emergencyContacts: tripFields.emergencyContacts.optional(),
  paidActivityId: tripFields.paidActivityId.optional(),
})
export type UpdateTripPlanInput = z.input<typeof updateTripPlanSchema>
export type TripPlanChanges = z.output<typeof updateTripPlanSchema>

const noteSchema = optionalText(TRIP_NOTE_MAX).describe('İsteğe bağlı not, en çok 500 karakter')

/** Onaya gönderme, onay ve tamamlama: yalnız isteğe bağlı not. */
export const tripPlanNoteSchema = z.strictObject({ note: noteSchema })
export type TripPlanNoteInput = z.input<typeof tripPlanNoteSchema>

/** Ret ve iptal: gerekçe zorunlu. */
export const tripPlanReasonSchema = z.strictObject({
  reason: requiredText(
    'Gerekçeyi yazın.',
    TRIP_REASON_MIN,
    TRIP_REASON_MAX,
    'Gerekçeyi en az 5 karakterle yazın.',
  ),
})
export type TripPlanReasonInput = z.input<typeof tripPlanReasonSchema>

/** Millî eğitim bildirimi işareti (K-368): gün ve isteğe bağlı evrak sayısı. */
export const tripPlanNoticeSchema = z.strictObject({
  notifiedOn: z
    .string('Bildirim gününü seçin.')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçerli bir tarih seçin.')
    .refine(
      (value) => Number.isFinite(Date.parse(`${value}T09:00:00Z`)),
      'Geçerli bir tarih seçin.',
    )
    .describe('Bildirimin yapıldığı gün (YYYY-MM-DD); bugünden sonra, onay gününden önce olamaz'),
  reference: optionalText(TRIP_AUTHORITY_REFERENCE_MAX).describe(
    'İsteğe bağlı evrak sayısı ya da DYS numarası',
  ),
})
export type TripPlanNoticeInput = z.input<typeof tripPlanNoticeSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: (string | number)[]) =>
  new DomainError(code, message, {
    kind: 'rule',
    ...(path === undefined ? {} : { path: path.map(String) }),
  })

export type TripPlanAction =
  'edit' | 'submit' | 'approve' | 'reject' | 'complete' | 'cancel' | 'notify'

/** Geçiş tablosu: her işlemin izinli başlangıç durumları (K-367). */
const ALLOWED_FROM = {
  edit: ['draft', 'submitted', 'approved', 'rejected'],
  submit: ['draft'],
  approve: ['submitted'],
  reject: ['submitted'],
  complete: ['approved'],
  cancel: ['draft', 'submitted', 'approved', 'rejected'],
  notify: ['approved'],
} as const satisfies Record<TripPlanAction, readonly TripPlanStatus[]>

const NOT_ALLOWED = {
  edit: 'Tamamlanmış ya da iptal edilmiş plan düzeltilemez.',
  submit: 'Yalnız taslak plan onaya gönderilir.',
  approve: 'Yalnız onay bekleyen plan onaylanır.',
  reject: 'Yalnız onay bekleyen plan reddedilir.',
  complete: 'Yalnız onaylanmış plan tamamlanır.',
  cancel: 'Tamamlanmış ya da iptal edilmiş plan iptal edilemez.',
  notify: 'Millî eğitim bildirimi yalnız onaylanmış planda işaretlenir.',
} as const satisfies Record<TripPlanAction, string>

export function canTripPlanTransition(status: TripPlanStatus, action: TripPlanAction): boolean {
  return (ALLOWED_FROM[action] as readonly TripPlanStatus[]).includes(status)
}

/** Geçersiz geçiş 422 `trip_plan_status_invalid`. */
export function assertTripPlanTransition(status: TripPlanStatus, action: TripPlanAction): void {
  if (!canTripPlanTransition(status, action))
    throw ruleError('trip_plan_status_invalid', NOT_ALLOWED[action])
}

/** Görevli üyeliğin servis tarafından yüklenen durumu; kurumda yoksa `null`. */
export type TripStaffCheck = { role: string; active: boolean } | null

/** Bağlanan ücretli etkinlik; kurumda yoksa `null`. */
export interface TripActivityCheck {
  status: 'open' | 'cancelled'
  activityDate: string
  /** Etkinlik iptal edilmemiş başka bir plana bağlıysa `true` (409). */
  linkedToOtherPlan: boolean
}

export interface TripPlanChecks {
  now: Date
  /** Gidiş anı geçmişte olabilir mi (yalnız çıkış değişmediyse ve düzeltmedeyse `true`). */
  allowPastDeparture?: boolean
  /** Görevli üyelikler, kimliğe göre. */
  staff: ReadonlyMap<string, TripStaffCheck>
  /** Etkinlik verildiyse yüklenen durumu; verilmediyse `undefined`. */
  activity?: TripActivityCheck | null
}

/** Planın bütün olarak denetlenen alanları (yeni plan ya da düzeltme sonrası birleşik plan). */
export type TripPlanShape = Pick<
  TripPlanFields,
  'departureAt' | 'returnAt' | 'staff' | 'paidActivityId'
>

const DAY_MS = 86_400_000

/**
 * Planın bütünlük kuralları (K-366): dönüş çıkıştan sonra ve en çok 30 gün sonra; çıkış gelecekte
 * (düzeltmede çıkış değişmediyse denetlenmez); görevli kurumun etkin öğretmen ya da yönetici
 * üyeliği; bağlanan ücretli etkinlik kurumda, iptal edilmemiş, başka plana bağlı değil ve günü
 * gezinin çıkış–dönüş günleri arasında.
 */
export function checkTripPlan(plan: TripPlanShape, checks: TripPlanChecks): void {
  const departure = Date.parse(plan.departureAt)
  const back = Date.parse(plan.returnAt)
  if (back <= departure)
    throw ruleError('trip_plan_return_before_departure', 'Dönüş anı çıkıştan sonra olmalıdır.', [
      'returnAt',
    ])
  if (back - departure > TRIP_MAX_DAYS * DAY_MS)
    throw ruleError('trip_plan_too_long', `Gezi en çok ${String(TRIP_MAX_DAYS)} gün sürebilir.`, [
      'returnAt',
    ])
  if (checks.allowPastDeparture !== true && departure <= checks.now.getTime())
    throw ruleError('trip_plan_departure_past', 'Çıkış anı geçmişte olamaz.', ['departureAt'])
  plan.staff.forEach((member, index) => {
    const found = checks.staff.get(member.membershipId)
    const path = ['staff', index, 'membershipId']
    if (found === undefined || found === null)
      throw ruleError('trip_plan_staff_not_found', 'Görevli öğretmen bulunamadı.', path)
    if (!(TRIP_STAFF_MEMBER_ROLES as readonly string[]).includes(found.role))
      throw ruleError(
        'trip_plan_staff_not_teacher',
        'Görevli yalnız öğretmen ya da yönetici olabilir.',
        path,
      )
    if (!found.active)
      throw ruleError('trip_plan_staff_inactive', 'Pasif personel görevlendirilemez.', path)
  })
  if (plan.paidActivityId === null) return
  const activity = checks.activity
  const path = ['paidActivityId']
  if (activity === undefined || activity === null)
    throw ruleError('trip_plan_activity_not_found', 'Ücretli etkinlik bulunamadı.', path)
  if (activity.status === 'cancelled')
    throw ruleError(
      'trip_plan_activity_cancelled',
      'İptal edilmiş etkinliğe gezi planı bağlanamaz.',
      path,
    )
  if (activity.linkedToOtherPlan)
    throw new DomainError(
      'trip_plan_activity_linked',
      'Bu ücretli etkinlik başka bir gezi planına bağlı.',
      { kind: 'conflict', path },
    )
  if (
    activity.activityDate < dayKey(plan.departureAt) ||
    activity.activityDate > dayKey(plan.returnAt)
  )
    throw ruleError(
      'trip_plan_activity_date_mismatch',
      'Ücretli etkinliğin günü gezinin çıkış ve dönüş günleri arasında olmalıdır.',
      path,
    )
}

/** Planın düzeltilebilir saklanan alanları (düzeltmede değişen alanlar bunlarla karşılaştırılır). */
export interface StoredTripPlanFields {
  name: string
  purpose: string
  departureAt: string
  returnAt: string
  expectedStudentCount: number
  stops: TripStop[]
  staff: TripStaffMember[]
  transport: TripTransport
  risks: TripRisk[]
  emergencyContacts: TripContact[]
  paidActivityId: string | null
}

export interface TripPlanUpdatePlan {
  /** Değişen alan adları (denetim kaydına yazılır). */
  changed: (keyof TripPlanChanges)[]
  /** Düzeltme sonrası birleşik plan. */
  next: StoredTripPlanFields
  /** Taslak dışındaki plan düzeltilince taslağa döner (yeniden onay; K-367). */
  reopens: boolean
}

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

/**
 * Düzeltme (K-367): tamamlanmış ve iptal edilmiş plan değişmez; değişiklik yoksa 422
 * `trip_plan_unchanged`. Onaya gönderilmiş, onaylanmış ya da reddedilmiş plan düzeltilince taslağa
 * döner: onay, ret ve bildirim işareti düşer, plan yeniden onaya gönderilmelidir. Birleşik plan
 * `checkTripPlan` ile bütün olarak denetlenir (servis çağırır).
 */
export function planTripPlanUpdate(
  current: StoredTripPlanFields & { status: TripPlanStatus },
  changes: TripPlanChanges,
): TripPlanUpdatePlan {
  assertTripPlanTransition(current.status, 'edit')
  const changed: (keyof TripPlanChanges)[] = []
  const next: StoredTripPlanFields = {
    name: current.name,
    purpose: current.purpose,
    departureAt: current.departureAt,
    returnAt: current.returnAt,
    expectedStudentCount: current.expectedStudentCount,
    stops: current.stops,
    staff: current.staff,
    transport: current.transport,
    risks: current.risks,
    emergencyContacts: current.emergencyContacts,
    paidActivityId: current.paidActivityId,
  }
  for (const key of Object.keys(changes) as (keyof TripPlanChanges)[]) {
    const value = changes[key]
    if (value === undefined || sameValue(value, current[key])) continue
    changed.push(key)
    Object.assign(next, { [key]: value })
  }
  if (changed.length === 0) throw ruleError('trip_plan_unchanged', 'Planda değişiklik yok.')
  return { changed, next, reopens: current.status !== 'draft' }
}

/**
 * Onaya gönderme (K-366, K-367): yalnız taslak; çıkış gelecekte; en az bir risk maddesi ve bir acil
 * iletişim kişisi; otobüs ve minibüste firma, plaka ve sürücü adı yazılmış olmalı.
 */
export function planTripPlanSubmit(
  plan: Pick<StoredTripPlanFields, 'departureAt' | 'risks' | 'emergencyContacts' | 'transport'> & {
    status: TripPlanStatus
  },
  now: Date,
): void {
  assertTripPlanTransition(plan.status, 'submit')
  if (Date.parse(plan.departureAt) <= now.getTime())
    throw ruleError('trip_plan_departure_past', 'Çıkış anı geçmiş plan onaya gönderilemez.', [
      'departureAt',
    ])
  if (plan.risks.length === 0)
    throw ruleError(
      'trip_plan_risks_required',
      'Onaya göndermeden önce risk değerlendirmesine en az bir madde ekleyin.',
      ['risks'],
    )
  if (plan.emergencyContacts.length === 0)
    throw ruleError(
      'trip_plan_emergency_contact_required',
      'Onaya göndermeden önce en az bir acil iletişim kişisi ekleyin.',
      ['emergencyContacts'],
    )
  const transport = plan.transport
  if (
    (TRIP_ROAD_TRANSPORT_TYPES as readonly string[]).includes(transport.type) &&
    (transport.company === null || transport.plate === null || transport.driverName === null)
  )
    throw ruleError(
      'trip_plan_transport_incomplete',
      'Otobüs ve minibüste onaya göndermeden önce firma, plaka ve sürücü adını yazın.',
      ['transport'],
    )
}

/** Onay (K-367): yalnız onay bekleyen plan; çıkış anı geçmişse onaylanmaz. */
export function planTripPlanApprove(
  plan: { status: TripPlanStatus; departureAt: string },
  now: Date,
): void {
  assertTripPlanTransition(plan.status, 'approve')
  if (Date.parse(plan.departureAt) <= now.getTime())
    throw ruleError('trip_plan_departure_past', 'Çıkış anı geçmiş plan onaylanamaz.', [
      'departureAt',
    ])
}

/** Tamamlama (K-367): onaylanmış plan dönüş anından sonra tamamlanır. */
export function planTripPlanComplete(
  plan: { status: TripPlanStatus; returnAt: string },
  now: Date,
): void {
  assertTripPlanTransition(plan.status, 'complete')
  if (now.getTime() < Date.parse(plan.returnAt))
    throw ruleError('trip_plan_not_returned', 'Gezi dönüş anından önce tamamlanamaz.')
}

/**
 * İptal (K-367): yönetici sürmekte olan her planı iptal eder; ön büro yalnız taslak ve reddedilmiş
 * planı (onaya gönderilmiş ve onaylanmış plan 403 `trip_plan_cancel_forbidden`).
 */
export function planTripPlanCancel(status: TripPlanStatus, role: string): void {
  assertTripPlanTransition(status, 'cancel')
  if (role !== 'yonetici' && status !== 'draft' && status !== 'rejected')
    throw new DomainError(
      'trip_plan_cancel_forbidden',
      'Onaya gönderilmiş ya da onaylanmış planı yalnız yönetici iptal edebilir.',
      { kind: 'forbidden' },
    )
}

/**
 * Millî eğitim bildirimi işareti (K-368): yalnız onaylanmış planda; gün bugünden sonra ve onay
 * gününden önce olamaz. Yeniden işaretleme günü ve evrak sayısını değiştirir.
 */
export function planTripPlanNotice(
  plan: { status: TripPlanStatus; approvedAt: string | null },
  notifiedOn: string,
  now: Date,
): void {
  assertTripPlanTransition(plan.status, 'notify')
  if (notifiedOn > dayKey(now))
    throw ruleError('trip_plan_notice_date_future', 'Bildirim günü bugünden sonra olamaz.', [
      'notifiedOn',
    ])
  if (plan.approvedAt !== null && notifiedOn < dayKey(plan.approvedAt))
    throw ruleError(
      'trip_plan_notice_before_approval',
      'Bildirim günü onay gününden önce olamaz.',
      ['notifiedOn'],
    )
}

export interface TripStaffRatio {
  /** Görevli başına düşen öğrenci (yukarı yuvarlanmış). */
  studentsPerStaff: number
  /** Eşiğe göre gereken en az görevli sayısı. */
  recommendedStaff: number
  /** Görevli sayısı önerinin altında: uyarı (K-366). */
  warning: boolean
}

/** Öğrenci başına görevli oranı (K-366): uyarıdır, kaydı engellemez. */
export function tripStaffRatio(expectedStudentCount: number, staffCount: number): TripStaffRatio {
  const recommendedStaff = Math.max(1, Math.ceil(expectedStudentCount / TRIP_STUDENTS_PER_STAFF))
  return {
    studentsPerStaff:
      staffCount === 0 ? expectedStudentCount : Math.ceil(expectedStudentCount / staffCount),
    recommendedStaff,
    warning: staffCount < recommendedStaff,
  }
}

/** Oran uyarısının kullanıcı metni; uyarı yoksa `null`. */
export function tripStaffRatioMessage(expectedStudentCount: number, staffCount: number) {
  const ratio = tripStaffRatio(expectedStudentCount, staffCount)
  if (!ratio.warning) return null
  return `${String(expectedStudentCount)} öğrenci için en az ${String(ratio.recommendedStaff)} görevli önerilir (her ${String(TRIP_STUDENTS_PER_STAFF)} öğrenciye bir); planda ${String(staffCount)} görevli var.`
}

/** Rolün planda yapabileceği işlemler (ekran düğmeleri; sunucu aynı kuralları yeniden denetler). */
export function tripPlanActions(
  status: TripPlanStatus,
  role: string,
): Record<TripPlanAction, boolean> {
  const manager = role === 'yonetici'
  const staff = manager || role === 'onburo'
  return {
    edit: staff && canTripPlanTransition(status, 'edit'),
    submit: staff && canTripPlanTransition(status, 'submit'),
    approve: manager && canTripPlanTransition(status, 'approve'),
    reject: manager && canTripPlanTransition(status, 'reject'),
    complete: manager && canTripPlanTransition(status, 'complete'),
    cancel:
      canTripPlanTransition(status, 'cancel') &&
      (manager || (staff && (status === 'draft' || status === 'rejected'))),
    notify: staff && canTripPlanTransition(status, 'notify'),
  }
}

/** Görevli satırı: sorumlu önce, sonra yazıldığı sıra. */
export function sortTripStaff<T extends { role: TripStaffRole }>(staff: readonly T[]): T[] {
  return [...staff].sort((left, right) =>
    left.role === right.role ? 0 : left.role === 'lead' ? -1 : 1,
  )
}
