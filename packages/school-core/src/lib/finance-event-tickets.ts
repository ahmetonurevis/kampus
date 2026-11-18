import { z } from 'zod'

import { csvAmount, csvCell, CSV_SEPARATOR } from './csv.ts'
import { DomainError } from './errors.ts'

/**
 * Etkinlik bileti ve oturma düzeni (docs/domain/finans.md DOM-FIN-103; ON-159, ON-345;
 * K-324…K-327, K-378…K-380). Gösteri ve tören gibi etkinlikler için salon düzeni (sıra harfi ×
 * koltuk, kapalı koltuklar) ya da numarasız kontenjan, bilet türleri (ücretsiz davetiye, ücretli) ve
 * öğrenci ya da aile (kardeşler birlikte) başına üst sınır tanımlanır. Bilet öğrencinin ailesine
 * (veli ya da misafir adıyla) ayrılır; numaralı salonda koltuk seçilir, aynı koltuk iki etkin bilete
 * verilemez (veritabanında kısmi tekil indeks de vardır). Ücretli biletin ödemesi elle (nakit ya da
 * havale) işaretlenir; çevrim içi ödeme yoktur. İptalde iade tutarı etkinliğe kalan güne göre
 * hesaplanır, iadenin ödendiği ayrıca işaretlenir. Bilet kodu tahmin edilemez rastgele baytlardan
 * üretilir; girişte kodla bir kez "kullanıldı" işaretlenir, yanlış okutma gerekçeyle geri alınır.
 *
 * Fonksiyonlar saftır: zaman `now`, rastgelelik `bytes` ve yeni anahtar `newKey` dışarıdan gelir.
 */

/** Etkinliği açan, düzelten ve arşivleyen roller (K-324). */
export const EVENT_MANAGE_ROLES = ['yonetici'] as const
/** Etkinlik ve biletleri okuyan; bilet ayıran, ödeme işaretleyen, iptal eden ve giriş yapan roller. */
export const EVENT_TICKET_ROLES = ['yonetici', 'onburo'] as const

export const canManageEvents = (role: string) => EVENT_MANAGE_ROLES.some((item) => item === role)
export const canSellEventTickets = (role: string) =>
  EVENT_TICKET_ROLES.some((item) => item === role)

// --- Sabit kümeler -------------------------------------------------------------------------------

export const EVENT_SEATING_MODES = ['seated', 'general'] as const
export type EventSeatingMode = (typeof EVENT_SEATING_MODES)[number]
export const EVENT_SEATING_MODE_LABELS = {
  seated: 'Numaralı koltuk',
  general: 'Numarasız kontenjan',
} as const satisfies Record<EventSeatingMode, string>

export const EVENT_TICKET_KINDS = ['invitation', 'paid'] as const
export type EventTicketKind = (typeof EVENT_TICKET_KINDS)[number]
export const EVENT_TICKET_KIND_LABELS = {
  invitation: 'Ücretsiz davetiye',
  paid: 'Ücretli',
} as const satisfies Record<EventTicketKind, string>

/** Üst sınırın kapsamı (K-379): öğrenci başına ya da aile (aynı veliye bağlı kardeşler) başına. */
export const EVENT_LIMIT_SCOPES = ['student', 'family'] as const
export type EventLimitScope = (typeof EVENT_LIMIT_SCOPES)[number]
export const EVENT_LIMIT_SCOPE_LABELS = {
  student: 'Öğrenci başına',
  family: 'Aile başına (kardeşler birlikte)',
} as const satisfies Record<EventLimitScope, string>

export const EVENT_TICKET_STATUSES = ['active', 'cancelled'] as const
export type EventTicketStatus = (typeof EVENT_TICKET_STATUSES)[number]

export const EVENT_TICKET_PAYMENT_STATUSES = ['not_required', 'unpaid', 'paid'] as const
export type EventTicketPaymentStatus = (typeof EVENT_TICKET_PAYMENT_STATUSES)[number]
export const EVENT_TICKET_PAYMENT_STATUS_LABELS = {
  not_required: 'Ücretsiz',
  unpaid: 'Ödenmedi',
  paid: 'Ödendi',
} as const satisfies Record<EventTicketPaymentStatus, string>

export const EVENT_TICKET_PAYMENT_METHODS = ['cash', 'transfer'] as const
export type EventTicketPaymentMethod = (typeof EVENT_TICKET_PAYMENT_METHODS)[number]
export const EVENT_TICKET_PAYMENT_METHOD_LABELS = {
  cash: 'Nakit',
  transfer: 'Havale/EFT',
} as const satisfies Record<EventTicketPaymentMethod, string>

/**
 * Biletin okunan durumu (saklanmaz): iptal, girişte kullanıldı, ödemesi beklenen ücretli bilet ya
 * da girişe hazır (davetiye ya da ödenmiş).
 */
export const EVENT_TICKET_STATES = ['valid', 'unpaid', 'used', 'cancelled'] as const
export type EventTicketState = (typeof EVENT_TICKET_STATES)[number]
export const EVENT_TICKET_STATE_LABELS = {
  valid: 'Geçerli',
  unpaid: 'Ödeme bekliyor',
  used: 'Kullanıldı',
  cancelled: 'İptal',
} as const satisfies Record<EventTicketState, string>

/**
 * İptal edilen ödenmiş biletin iadesi (saklanmaz, K-380): iade yok (ücretsiz, ödenmemiş ya da
 * kesintiyle sıfır), iade bekliyor (tutar yazıldı, ödendiği işaretlenmedi) ya da iade ödendi.
 */
export const EVENT_TICKET_REFUND_STATUSES = ['none', 'pending', 'paid'] as const
export type EventTicketRefundStatus = (typeof EVENT_TICKET_REFUND_STATUSES)[number]
export const EVENT_TICKET_REFUND_STATUS_LABELS = {
  none: 'İade yok',
  pending: 'İade bekliyor',
  paid: 'İade ödendi',
} as const satisfies Record<EventTicketRefundStatus, string>

export const EVENT_NAME_MAX = 120
export const EVENT_VENUE_MAX = 120
/** Sıra harfi A–Z (K-325). */
export const EVENT_ROWS_MAX = 26
export const EVENT_SEATS_PER_ROW_MAX = 60
export const EVENT_CAPACITY_MAX = 5000
export const EVENT_TICKET_TYPES_MAX = 5
export const EVENT_TICKET_TYPE_NAME_MAX = 60
/** Bilet fiyatı en çok 100.000 TL (kuruş). */
export const EVENT_TICKET_PRICE_MAX = 10_000_000
export const EVENT_PER_STUDENT_LIMIT_MAX = 20
/** Tek ayırmada en çok bu kadar bilet (K-325). */
export const EVENT_TICKETS_PER_REQUEST_MAX = 10
export const EVENT_HOLDER_NAME_MAX = 120
export const EVENT_CANCEL_REASON_MAX = 200
export const EVENT_SCHOOL_EVENT_ID_MAX = 64
/** Etkinliğe en az bu kadar gün kala iptalde bedelin tamamı iade edilir (K-380). */
export const EVENT_FULL_REFUND_DAYS = 7
/** Etkinlikten 1–6 gün önceki iptalde iade edilen yüzde (K-380); etkinlik günü ve sonrasında iade yok. */
export const EVENT_LATE_REFUND_PERCENT = 50
export const EVENT_UNDO_REASON_MIN = 5
export const EVENT_UNDO_REASON_MAX = 200

// --- Koltuk --------------------------------------------------------------------------------------

const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SEAT_PATTERN = /^([A-Z])([1-9]\d?)$/

/** Koltuk etiketi: sıra harfi + koltuk numarası (`A1`, `C12`). `row` 0'dan başlar. */
export function seatLabel(row: number, seat: number): string {
  return `${ROW_LETTERS[row] ?? '?'}${String(seat)}`
}

/** Etiketin sırası (0'dan) ve numarası; biçim tutmuyorsa `null`. */
export function parseSeat(label: string): { row: number; seat: number } | null {
  const match = SEAT_PATTERN.exec(label)
  if (match === null) return null
  return { row: ROW_LETTERS.indexOf(match[1] ?? ''), seat: Number(match[2]) }
}

export const isSeatInLayout = (label: string, rowCount: number, seatsPerRow: number) => {
  const parsed = parseSeat(label)
  return parsed !== null && parsed.row < rowCount && parsed.seat <= seatsPerRow
}

/** Salonun bütün koltukları, sıra sıra soldan sağa. */
export function layoutSeats(rowCount: number, seatsPerRow: number): string[] {
  const seats: string[] = []
  for (let row = 0; row < rowCount; row++)
    for (let seat = 1; seat <= seatsPerRow; seat++) seats.push(seatLabel(row, seat))
  return seats
}

/** Etiketi büyük harfe çevirip boşlukları atar (`a 3` → `A3`). */
export const normalizeSeat = (value: string) => value.replaceAll(/\s+/g, '').toUpperCase()

const seatSchema = z
  .string('Koltuğu seçin.')
  .transform(normalizeSeat)
  .refine((value) => SEAT_PATTERN.test(value), 'Koltuğu A12 biçiminde yazın.')

// --- Bilet kodu ----------------------------------------------------------------------------------

/** Crockford base32: karışan harfler (I, L, O, U) yok; okunurken `O`→`0`, `I`/`L`→`1`. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const EVENT_TICKET_CODE_LENGTH = 12
/** Kodun ürettiği rastgele bayt sayısı; her bayttan 5 bit (256, 32'nin katı: dağılım düzgün). */
export const EVENT_TICKET_CODE_BYTES = EVENT_TICKET_CODE_LENGTH

const groupCode = (raw: string) => `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`

/**
 * Bilet kodu (K-326): 12 karakter, 60 bit rastgelelik, `XXXX-XXXX-XXXX`. Baytlar kriptografik
 * kaynaktan gelmelidir (API `randomBytes`); sıra numarası ya da kimlikten türetilmez.
 */
export function ticketCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < EVENT_TICKET_CODE_BYTES) throw new Error('ticket code needs 12 random bytes')
  let raw = ''
  for (let index = 0; index < EVENT_TICKET_CODE_LENGTH; index++)
    raw += CODE_ALPHABET[(bytes[index] ?? 0) & 31]
  return groupCode(raw)
}

/**
 * Girişte okunan ya da elle yazılan kodu saklanan biçime çevirir: boşluk ve tire düşer, küçük harf
 * büyür, `O`→`0`, `I`/`L`→`1`. 12 karakter değilse ya da alfabe dışı karakter varsa `null`.
 */
export function normalizeTicketCode(value: string): string | null {
  const raw = value
    .toUpperCase()
    .replaceAll(/[\s-]+/g, '')
    .replaceAll('O', '0')
    .replaceAll(/[IL]/g, '1')
  if (raw.length !== EVENT_TICKET_CODE_LENGTH) return null
  for (const char of raw) if (!CODE_ALPHABET.includes(char)) return null
  return groupCode(raw)
}

// --- Şemalar -------------------------------------------------------------------------------------

const textField = (label: string, min: number, max: number) =>
  z
    .string(`${label} yazın.`)
    .trim()
    .min(min, `${label} en az ${String(min)} karakter olmalıdır.`)
    .max(max, `En fazla ${String(max)} karakter girebilirsiniz.`)

const ticketTypeSchema = z.strictObject({
  key: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,40}$/, 'Bilet türü anahtarı geçersiz.')
    .optional()
    .describe('Var olan türün anahtarı; yeni türde verilmez, sunucu üretir'),
  name: textField('Bilet türünün adı', 2, EVENT_TICKET_TYPE_NAME_MAX),
  kind: z.enum(EVENT_TICKET_KINDS, 'Bilet türünü seçin.'),
  priceCents: z
    .int('Fiyat kuruş cinsinden tam sayı olmalıdır.')
    .min(0, 'Fiyat eksi olamaz.')
    .max(EVENT_TICKET_PRICE_MAX, 'Fiyat en çok 100.000 TL olabilir.')
    .describe('Kuruş; davetiyede 0, ücretlide 0’dan büyük'),
})
export type EventTicketTypeInput = z.infer<typeof ticketTypeSchema>
export type EventTicketType = {
  key: string
  name: string
  kind: EventTicketKind
  priceCents: number
}

const startsAtSchema = z.iso
  .datetime({ offset: true, error: 'Geçerli bir tarih ve saat girin.' })
  .describe('Başlangıç anı (ISO 8601); gösterim Europe/Istanbul')

const eventFields = {
  name: textField('Etkinlik adı', 2, EVENT_NAME_MAX),
  startsAt: startsAtSchema,
  venue: textField('Salon', 2, EVENT_VENUE_MAX),
  schoolEventId: z
    .string()
    .trim()
    .min(1, 'Takvim etkinliğini seçin.')
    .max(EVENT_SCHOOL_EVENT_ID_MAX, 'Takvim etkinliği geçersiz.')
    .nullable()
    .describe('İsteğe bağlı okul takvimi etkinliği (`schoolEvents` kaydı)'),
  seatingMode: z.enum(EVENT_SEATING_MODES, 'Oturma düzenini seçin.'),
  rowCount: z
    .int('Sıra sayısı tam sayı olmalıdır.')
    .min(1, 'En az bir sıra olmalıdır.')
    .max(EVENT_ROWS_MAX, 'Sıra en çok 26 olabilir (A–Z).')
    .nullable()
    .describe('Numaralı salonda sıra sayısı (A’dan başlar)'),
  seatsPerRow: z
    .int('Koltuk sayısı tam sayı olmalıdır.')
    .min(1, 'Sırada en az bir koltuk olmalıdır.')
    .max(EVENT_SEATS_PER_ROW_MAX, 'Sırada en çok 60 koltuk olabilir.')
    .nullable()
    .describe('Numaralı salonda sıra başına koltuk'),
  blockedSeats: z
    .array(seatSchema)
    .max(EVENT_ROWS_MAX * EVENT_SEATS_PER_ROW_MAX)
    .describe('Satışa kapalı koltuklar (ör. teknik masa, protokol)'),
  capacity: z
    .int('Kontenjan tam sayı olmalıdır.')
    .min(1, 'Kontenjan en az 1 olmalıdır.')
    .max(EVENT_CAPACITY_MAX, 'Kontenjan en çok 5.000 olabilir.')
    .nullable()
    .describe('Numarasız etkinlikte kişi kontenjanı'),
  ticketTypes: z
    .array(ticketTypeSchema)
    .min(1, 'En az bir bilet türü ekleyin.')
    .max(EVENT_TICKET_TYPES_MAX, 'En çok 5 bilet türü olabilir.'),
  perStudentLimit: z
    .int('Üst sınır tam sayı olmalıdır.')
    .min(1, 'Üst sınır en az 1 olmalıdır.')
    .max(EVENT_PER_STUDENT_LIMIT_MAX, 'Üst sınır en çok 20 olabilir.')
    .nullable()
    .describe('Öğrenci ya da aile başına etkin bilet üst sınırı; boşsa sınırsız'),
  limitScope: z
    .enum(EVENT_LIMIT_SCOPES, 'Sınır kapsamını seçin.')
    .describe(
      '`student` öğrenci başına, `family` aile başına (aynı veliye bağlı kardeşlerin biletleri birlikte sayılır); sınır boşsa etkisiz',
    ),
}

type EventShape = {
  seatingMode: EventSeatingMode
  rowCount: number | null
  seatsPerRow: number | null
  blockedSeats: readonly string[]
  capacity: number | null
  ticketTypes: readonly EventTicketTypeInput[]
}

/** Oturma düzeni ve bilet türlerinin birbirine bağlı kuralları (alan yolu `issues`'a düşer). */
function checkShape(value: EventShape, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message })
  if (value.seatingMode === 'seated') {
    if (value.rowCount === null) issue(['rowCount'], 'Sıra sayısını yazın.')
    if (value.seatsPerRow === null) issue(['seatsPerRow'], 'Sıra başına koltuk sayısını yazın.')
    if (value.capacity !== null)
      issue(['capacity'], 'Numaralı salonda kontenjan koltuklardan hesaplanır.')
    if (value.rowCount !== null && value.seatsPerRow !== null) {
      const rows = value.rowCount
      const perRow = value.seatsPerRow
      const seen = new Set<string>()
      value.blockedSeats.forEach((seat, index) => {
        if (!isSeatInLayout(seat, rows, perRow))
          issue(['blockedSeats', index], `${seat} koltuğu salon düzeninde yok.`)
        else if (seen.has(seat)) issue(['blockedSeats', index], `${seat} iki kez yazılmış.`)
        seen.add(seat)
      })
      if (seen.size >= rows * perRow)
        issue(['blockedSeats'], 'Bütün koltuklar kapalı olamaz; en az bir koltuk açık kalmalıdır.')
    }
  } else {
    if (value.capacity === null) issue(['capacity'], 'Kontenjanı yazın.')
    if (value.rowCount !== null || value.seatsPerRow !== null)
      issue(['rowCount'], 'Numarasız etkinlikte salon düzeni girilmez.')
    if (value.blockedSeats.length > 0)
      issue(['blockedSeats'], 'Numarasız etkinlikte kapalı koltuk girilmez.')
  }
  const names = new Set<string>()
  value.ticketTypes.forEach((type, index) => {
    if (type.kind === 'invitation' && type.priceCents !== 0)
      issue(['ticketTypes', index, 'priceCents'], 'Davetiyenin fiyatı 0 olmalıdır.')
    if (type.kind === 'paid' && type.priceCents === 0)
      issue(['ticketTypes', index, 'priceCents'], 'Ücretli biletin fiyatını yazın.')
    const name = type.name.toLocaleLowerCase('tr')
    if (names.has(name)) issue(['ticketTypes', index, 'name'], 'Bu adla bir bilet türü var.')
    names.add(name)
  })
}

/** Etkinlik açma gövdesi (DOM-FIN-103, K-325). */
export const createEventSchema = z
  .strictObject({
    ...eventFields,
    schoolEventId: eventFields.schoolEventId.default(null),
    rowCount: eventFields.rowCount.default(null),
    seatsPerRow: eventFields.seatsPerRow.default(null),
    blockedSeats: eventFields.blockedSeats.default([]),
    capacity: eventFields.capacity.default(null),
    perStudentLimit: eventFields.perStudentLimit.default(null),
    limitScope: eventFields.limitScope.default('student'),
  })
  .superRefine(checkShape)
export type CreateEventInput = z.input<typeof createEventSchema>

/** Etkinlik düzeltme gövdesi: yalnız verilen alanlar; satış açık/kapalı da buradan. */
export const updateEventSchema = z.strictObject({
  name: eventFields.name.optional(),
  startsAt: eventFields.startsAt.optional(),
  venue: eventFields.venue.optional(),
  schoolEventId: eventFields.schoolEventId.optional(),
  seatingMode: eventFields.seatingMode.optional(),
  rowCount: eventFields.rowCount.optional(),
  seatsPerRow: eventFields.seatsPerRow.optional(),
  blockedSeats: eventFields.blockedSeats.optional(),
  capacity: eventFields.capacity.optional(),
  ticketTypes: eventFields.ticketTypes.optional(),
  perStudentLimit: eventFields.perStudentLimit.optional(),
  limitScope: eventFields.limitScope.optional(),
  salesOpen: z.boolean('Satış durumunu seçin.').optional().describe('Bilet ayırma açık mı'),
})
export type UpdateEventInput = z.input<typeof updateEventSchema>

/** Saklanan etkinlik alanları (kimlik ve sürüm dışında). */
export type EventDraft = {
  name: string
  startsAt: string
  venue: string
  schoolEventId: string | null
  seatingMode: EventSeatingMode
  rowCount: number | null
  seatsPerRow: number | null
  blockedSeats: string[]
  capacity: number | null
  ticketTypes: EventTicketType[]
  perStudentLimit: number | null
  limitScope: EventLimitScope
  salesOpen: boolean
}
export type EventField = keyof EventDraft

/** Bilet ayırma gövdesi (K-325): bir öğrencinin ailesine 1–10 bilet. */
export const allocateEventTicketsSchema = z.strictObject({
  studentId: z
    .string('Öğrenciyi seçin.')
    .trim()
    .min(1, 'Öğrenciyi seçin.')
    .max(64, 'Öğrenci geçersiz.')
    .describe('Biletin ayrıldığı öğrenci (ailesi); üst sınır öğrenci ya da aile başınadır'),
  items: z
    .array(
      z.strictObject({
        ticketTypeKey: z.string('Bilet türünü seçin.').min(1, 'Bilet türünü seçin.').max(40),
        seat: seatSchema
          .nullable()
          .default(null)
          .describe('Numaralı salonda koltuk; numarasızda boş'),
        // kvkk: K
        holderName: textField('Bilet sahibinin adı', 2, EVENT_HOLDER_NAME_MAX).describe(
          'Bileti kullanacak veli ya da misafirin adı',
        ),
      }),
    )
    .min(1, 'En az bir bilet ekleyin.')
    .max(EVENT_TICKETS_PER_REQUEST_MAX, 'Tek seferde en çok 10 bilet ayrılabilir.'),
})
export type AllocateEventTicketsInput = z.input<typeof allocateEventTicketsSchema>

export const payEventTicketSchema = z.strictObject({
  method: z.enum(EVENT_TICKET_PAYMENT_METHODS, 'Ödeme yöntemini seçin.'),
})
export type PayEventTicketInput = z.input<typeof payEventTicketSchema>

export const cancelEventTicketSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .max(EVENT_CANCEL_REASON_MAX, 'En fazla 200 karakter girebilirsiniz.')
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value))
    .describe('İsteğe bağlı iptal notu; iade tutarı kuraldan farklıysa zorunlu'),
  refundCents: z
    .int('İade tutarı kuruş cinsinden tam sayı olmalıdır.')
    .min(0, 'İade tutarı eksi olamaz.')
    .max(EVENT_TICKET_PRICE_MAX, 'İade tutarı en çok 100.000 TL olabilir.')
    .nullable()
    .default(null)
    .describe(
      'Ödenmiş bilette iade tutarı, kuruş; boşsa kural (K-380). Kuraldan farklı tutarı yalnız yönetici yazar',
    ),
})
export type CancelEventTicketInput = z.input<typeof cancelEventTicketSchema>

export const checkInEventTicketSchema = z.strictObject({
  code: z
    .string('Bilet kodunu yazın.')
    .trim()
    .min(1, 'Bilet kodunu yazın.')
    .max(40, 'Bilet kodu geçersiz.')
    .describe('Biletteki kod (`XXXX-XXXX-XXXX`); boşluk, tire ve küçük harf fark etmez'),
})
export type CheckInEventTicketInput = z.input<typeof checkInEventTicketSchema>

/** İadenin ödendiği işareti (K-380): iade nakit ya da havaleyle elle yapılır. */
export const refundEventTicketSchema = z.strictObject({
  method: z.enum(EVENT_TICKET_PAYMENT_METHODS, 'İade yöntemini seçin.'),
})
export type RefundEventTicketInput = z.input<typeof refundEventTicketSchema>

/** Girişi geri alma gövdesi (K-378): gerekçe zorunlu. */
export const undoEventTicketCheckInSchema = z.strictObject({
  reason: textField('Gerekçe', EVENT_UNDO_REASON_MIN, EVENT_UNDO_REASON_MAX).describe(
    'Girişin neden geri alındığı (ör. yanlış bilet okutuldu); denetim kaydına yazılmaz',
  ),
})
export type UndoEventTicketCheckInInput = z.input<typeof undoEventTicketCheckInSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string[]) =>
  new DomainError(code, message, { kind: 'rule', ...(path ? { path } : {}) })
const conflictError = (code: string, message: string, path?: string[]) =>
  new DomainError(code, message, { kind: 'conflict', ...(path ? { path } : {}) })

/** Satışa açık koltuk ya da numarasız kontenjan (K-325). */
export function eventCapacity(event: {
  seatingMode: EventSeatingMode
  rowCount: number | null
  seatsPerRow: number | null
  blockedSeats: readonly string[]
  capacity: number | null
}): number {
  return event.seatingMode === 'seated'
    ? (event.rowCount ?? 0) * (event.seatsPerRow ?? 0) - event.blockedSeats.length
    : (event.capacity ?? 0)
}

function withKeys(
  types: readonly EventTicketTypeInput[],
  existing: readonly EventTicketType[],
  newKey: () => string,
): EventTicketType[] {
  const known = new Set(existing.map((type) => type.key))
  return types.map((type, index) => {
    if (type.key !== undefined && !known.has(type.key))
      throw ruleError('event_ticket_type_unknown', 'Bilet türü bu etkinlikte yok.', [
        'ticketTypes',
        String(index),
        'key',
      ])
    return {
      key: type.key ?? newKey(),
      name: type.name,
      kind: type.kind,
      priceCents: type.priceCents,
    }
  })
}

function assertFuture(startsAt: string, now: Date) {
  if (Date.parse(startsAt) <= now.getTime())
    throw ruleError('event_starts_in_past', 'Etkinliğin başlangıcı gelecekte olmalıdır.', [
      'startsAt',
    ])
}

/** Etkinlik açma (K-325): başlangıç gelecekte olmalı; bilet türlerine anahtar verilir. */
export function planEvent(input: unknown, tools: { now: Date; newKey: () => string }): EventDraft {
  const parsed = createEventSchema.parse(input)
  assertFuture(parsed.startsAt, tools.now)
  return {
    name: parsed.name,
    startsAt: new Date(parsed.startsAt).toISOString(),
    venue: parsed.venue,
    schoolEventId: parsed.schoolEventId,
    seatingMode: parsed.seatingMode,
    rowCount: parsed.rowCount,
    seatsPerRow: parsed.seatsPerRow,
    blockedSeats: [...parsed.blockedSeats].sort(compareSeats),
    capacity: parsed.capacity,
    ticketTypes: withKeys(
      // Açılışta anahtar verilmez; gelen anahtar yok sayılır, her tür yeni anahtar alır.
      parsed.ticketTypes.map((type) => ({
        name: type.name,
        kind: type.kind,
        priceCents: type.priceCents,
      })),
      [],
      tools.newKey,
    ),
    perStudentLimit: parsed.perStudentLimit,
    limitScope: parsed.limitScope,
    salesOpen: true,
  }
}

/** Koltuk sırası: sıra harfi, sonra numara. */
export function compareSeats(a: string, b: string): number {
  const left = parseSeat(a)
  const right = parseSeat(b)
  if (left === null || right === null) return a < b ? -1 : a > b ? 1 : 0
  return left.row - right.row || left.seat - right.seat
}

/** Etkinliğin etkin (iptal edilmemiş) bileti; düzeltme ve ayırma denetimi için. */
export type ActiveEventTicket = { seat: string | null; ticketTypeKey: string; studentId: string }

/**
 * Etkinlik düzeltmesi (K-325): verilen alanlar mevcut kayıtla birleşip bütün olarak denetlenir.
 * Etkin bilet varken oturma düzeni türü değişmez; satılmış koltuk kapatılamaz ya da salondan
 * çıkarılamaz; kontenjan etkin bilet sayısının altına inmez; bileti olan tür kaldırılamaz (fiyatı ve
 * adı değişebilir, satılmış bilet ayırma anındaki ad ve fiyatı taşır). Başlangıç değişirse gelecekte
 * olmalıdır. Üst sınır düşürülebilir; yalnız sonraki ayırmalara uygulanır.
 */
export function planEventUpdate(
  current: EventDraft,
  input: unknown,
  tools: { now: Date; newKey: () => string; active: readonly ActiveEventTicket[] },
): { next: EventDraft; changed: EventField[] } {
  const parsed = updateEventSchema.parse(input)
  const merged = {
    name: parsed.name ?? current.name,
    startsAt: parsed.startsAt ?? current.startsAt,
    venue: parsed.venue ?? current.venue,
    schoolEventId:
      parsed.schoolEventId === undefined ? current.schoolEventId : parsed.schoolEventId,
    seatingMode: parsed.seatingMode ?? current.seatingMode,
    rowCount: parsed.rowCount === undefined ? current.rowCount : parsed.rowCount,
    seatsPerRow: parsed.seatsPerRow === undefined ? current.seatsPerRow : parsed.seatsPerRow,
    blockedSeats: parsed.blockedSeats ?? current.blockedSeats,
    capacity: parsed.capacity === undefined ? current.capacity : parsed.capacity,
    ticketTypes: parsed.ticketTypes ?? current.ticketTypes,
    perStudentLimit:
      parsed.perStudentLimit === undefined ? current.perStudentLimit : parsed.perStudentLimit,
    limitScope: parsed.limitScope ?? current.limitScope,
  }
  // Birleşik kayıt açılış şemasıyla yeniden denetlenir: alan hataları aynı yol ve iletiyle döner.
  const checked = createEventSchema.parse(merged)
  const next: EventDraft = {
    ...checked,
    startsAt: new Date(checked.startsAt).toISOString(),
    blockedSeats: [...checked.blockedSeats].sort(compareSeats),
    ticketTypes:
      parsed.ticketTypes === undefined
        ? current.ticketTypes
        : withKeys(parsed.ticketTypes, current.ticketTypes, tools.newKey),
    salesOpen: parsed.salesOpen ?? current.salesOpen,
  }
  const changed = (Object.keys(next) as EventField[]).filter(
    (field) => JSON.stringify(next[field]) !== JSON.stringify(current[field]),
  )
  if (changed.length === 0) throw ruleError('event_unchanged', 'Etkinlikte değişen bir alan yok.')
  if (changed.includes('startsAt')) assertFuture(next.startsAt, tools.now)
  const { active } = tools
  if (active.length > 0 && next.seatingMode !== current.seatingMode)
    throw ruleError(
      'event_seating_locked',
      'Bilet ayrılmış etkinliğin oturma düzeni türü değiştirilemez.',
      ['seatingMode'],
    )
  if (next.seatingMode === 'seated') {
    const blocked = new Set(next.blockedSeats)
    const lost = active.find(
      (ticket) =>
        ticket.seat !== null &&
        (blocked.has(ticket.seat) ||
          !isSeatInLayout(ticket.seat, next.rowCount ?? 0, next.seatsPerRow ?? 0)),
    )
    if (lost?.seat)
      throw ruleError(
        'event_seat_in_use',
        `${lost.seat} koltuğunda etkin bilet var; önce bileti iptal edin.`,
        ['blockedSeats'],
      )
  } else if ((next.capacity ?? 0) < active.length)
    throw ruleError(
      'event_capacity_below_sold',
      `Kontenjan ayrılmış bilet sayısının (${String(active.length)}) altına inemez.`,
      ['capacity'],
    )
  const keys = new Set(next.ticketTypes.map((type) => type.key))
  if (active.some((ticket) => !keys.has(ticket.ticketTypeKey)))
    throw ruleError(
      'event_ticket_type_in_use',
      'Bileti ayrılmış bilet türü kaldırılamaz; adını ya da fiyatını değiştirebilirsiniz.',
      ['ticketTypes'],
    )
  return { next, changed }
}

/** Etkinlik arşivi: etkin bileti olan etkinlik arşivlenmez (K-325). */
export function assertEventArchivable(active: readonly ActiveEventTicket[]) {
  if (active.length > 0)
    throw ruleError(
      'event_has_tickets',
      'Etkin bileti olan etkinlik silinemez; önce biletleri iptal edin.',
    )
}

/** Ayırmanın yazacağı bilet (kod ve kimlik API'de verilir). */
export type PlannedEventTicket = {
  ticketTypeKey: string
  ticketTypeName: string
  ticketKind: EventTicketKind
  priceCents: number
  seat: string | null
  holderName: string
  paymentStatus: EventTicketPaymentStatus
}

/**
 * Bilet ayırma (K-325, K-379): satış açık olmalı; öğrenci kurumda etkin olmalı. Numaralı salonda her
 * bilet salon düzeninde var olan, kapalı olmayan, bu istekte ve etkin biletlerde tekrar etmeyen bir
 * koltuk ister (alınmış koltuk 409 `event_seat_taken`); numarasızda koltuk girilmez ve kontenjan
 * aşılamaz. Üst sınır etkin biletleri sayar (iptal edilen sayılmaz): öğrenci kapsamında yalnız bu
 * öğrencininkileri, aile kapsamında `family` kümesindeki (aynı veliye bağlı kardeşler, öğrencinin
 * kendisi dahil) bütün öğrencilerinkileri. Küme verilmezse aile öğrencinin kendisidir. Ücretli bilet
 * ödenmemiş başlar.
 */
export function planEventTicketAllocation(
  input: unknown,
  context: {
    event: EventDraft
    active: readonly ActiveEventTicket[]
    student: { isActive: boolean } | null
    /** Aile kapsamında öğrencinin kardeş kümesi (kendisi dahil); API kurum kilidi altında okur. */
    family?: readonly string[]
  },
): { studentId: string; tickets: PlannedEventTicket[] } {
  const parsed = allocateEventTicketsSchema.parse(input)
  const { event, active } = context
  if (!event.salesOpen) throw ruleError('event_sales_closed', 'Bu etkinliğin bilet satışı kapalı.')
  if (context.student === null)
    throw ruleError('event_ticket_student_not_found', 'Öğrenci bulunamadı.', ['studentId'])
  if (!context.student.isActive)
    throw ruleError('event_ticket_student_inactive', 'Öğrenci etkin değil.', ['studentId'])
  const types = new Map(event.ticketTypes.map((type) => [type.key, type]))
  const taken = new Set(active.flatMap((ticket) => (ticket.seat === null ? [] : [ticket.seat])))
  const blocked = new Set(event.blockedSeats)
  const requested = new Set<string>()
  const tickets = parsed.items.map((item, index): PlannedEventTicket => {
    const path = (field: string) => ['items', String(index), field]
    const type = types.get(item.ticketTypeKey)
    if (type === undefined)
      throw ruleError(
        'event_ticket_type_unknown',
        'Bilet türü bu etkinlikte yok.',
        path('ticketTypeKey'),
      )
    if (event.seatingMode === 'seated') {
      const seat = item.seat
      if (seat === null)
        throw ruleError('event_seat_required', 'Numaralı salonda koltuk seçin.', path('seat'))
      if (!isSeatInLayout(seat, event.rowCount ?? 0, event.seatsPerRow ?? 0))
        throw ruleError('event_seat_unknown', `${seat} koltuğu salonda yok.`, path('seat'))
      if (blocked.has(seat))
        throw ruleError('event_seat_blocked', `${seat} koltuğu satışa kapalı.`, path('seat'))
      if (requested.has(seat))
        throw ruleError('event_seat_duplicate', `${seat} koltuğu iki kez seçilmiş.`, path('seat'))
      if (taken.has(seat))
        throw conflictError(
          'event_seat_taken',
          `${seat} koltuğu başka bir bilete ayrılmış. Koltuk haritasını yenileyip başka koltuk seçin.`,
          path('seat'),
        )
      requested.add(seat)
    } else if (item.seat !== null)
      throw ruleError(
        'event_seat_not_allowed',
        'Numarasız etkinlikte koltuk seçilmez.',
        path('seat'),
      )
    return {
      ticketTypeKey: type.key,
      ticketTypeName: type.name,
      ticketKind: type.kind,
      priceCents: type.priceCents,
      seat: item.seat,
      holderName: item.holderName,
      paymentStatus: type.kind === 'paid' ? 'unpaid' : 'not_required',
    }
  })
  if (event.seatingMode === 'general' && active.length + tickets.length > (event.capacity ?? 0))
    throw ruleError(
      'event_sold_out',
      `Kontenjan dolu: en çok ${String(Math.max(0, (event.capacity ?? 0) - active.length))} bilet ayrılabilir.`,
      ['items'],
    )
  if (event.perStudentLimit !== null) {
    const limit = String(event.perStudentLimit)
    const family = new Set([parsed.studentId, ...(context.family ?? [])])
    const byFamily = event.limitScope === 'family'
    const owned = active.filter((ticket) =>
      byFamily ? family.has(ticket.studentId) : ticket.studentId === parsed.studentId,
    ).length
    if (owned + tickets.length > event.perStudentLimit)
      throw ruleError(
        'event_ticket_limit_exceeded',
        byFamily
          ? `Aile başına en çok ${limit} bilet ayrılabilir; bu ailenin kardeşlerle birlikte ${String(owned)} bileti var.`
          : `Öğrenci başına en çok ${limit} bilet ayrılabilir; bu öğrencinin ${String(owned)} bileti var.`,
        ['items'],
      )
  }
  return { studentId: parsed.studentId, tickets }
}

/** Komutların gördüğü bilet durumu. */
export type EventTicketFacts = {
  eventId: string
  status: EventTicketStatus
  ticketKind: EventTicketKind
  priceCents: number
  paymentStatus: EventTicketPaymentStatus
  usedAt: string | null
  usedByUserId: string | null
  refundCents: number | null
  refundedAt: string | null
}

export function eventTicketState(ticket: {
  status: EventTicketStatus
  paymentStatus: EventTicketPaymentStatus
  usedAt: string | null
}): EventTicketState {
  if (ticket.status === 'cancelled') return 'cancelled'
  if (ticket.usedAt !== null) return 'used'
  return ticket.paymentStatus === 'unpaid' ? 'unpaid' : 'valid'
}

/** İadenin durumu (K-380): tutar yazılmış ve sıfırdan büyükse ödenene dek bekler. */
export function eventTicketRefundStatus(ticket: {
  refundCents: number | null
  refundedAt: string | null
}): EventTicketRefundStatus {
  if (ticket.refundedAt !== null) return 'paid'
  return (ticket.refundCents ?? 0) > 0 ? 'pending' : 'none'
}

const assertActive = (ticket: Pick<EventTicketFacts, 'status'>) => {
  if (ticket.status === 'cancelled')
    throw ruleError('event_ticket_cancelled', 'Bilet iptal edilmiş.')
}

/** Ödeme işareti (K-326): yalnız etkin, ödenmemiş ücretli bilette; yöntem nakit ya da havale. */
export function planEventTicketPayment(input: unknown, ticket: EventTicketFacts) {
  const parsed = payEventTicketSchema.parse(input)
  assertActive(ticket)
  if (ticket.ticketKind !== 'paid')
    throw ruleError('event_ticket_free', 'Davetiye için ödeme alınmaz.')
  if (ticket.paymentStatus === 'paid')
    throw conflictError('event_ticket_already_paid', 'Biletin ödemesi zaten alınmış.')
  return { method: parsed.method }
}

const DAY_MS = 86_400_000
const istanbulDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
/** Europe/Istanbul günü `YYYY-MM-DD`. */
export const eventDayOf = (value: Date | string) => istanbulDay.format(new Date(value))
/** İstanbul günleri arasındaki gün farkı (`to - from`); saatten bağımsız. */
const dayGap = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)

export type EventRefundRule = 'full' | 'partial' | 'none'

/**
 * İade kuralı (K-380), İstanbul günleriyle: etkinliğe en az 7 gün kala tam iade; 1–6 gün kala
 * bedelin %50'si (kuruşa yuvarlanır); etkinlik günü ve sonrasında iade yok. `daysBefore` iptal
 * gününden etkinlik gününe kalan gündür.
 */
export function eventRefundQuote(
  priceCents: number,
  startsAt: string,
  now: Date,
): { rule: EventRefundRule; refundCents: number; daysBefore: number } {
  const daysBefore = dayGap(eventDayOf(now), eventDayOf(startsAt))
  if (daysBefore >= EVENT_FULL_REFUND_DAYS)
    return { rule: 'full', refundCents: priceCents, daysBefore }
  if (daysBefore >= 1)
    return {
      rule: 'partial',
      refundCents: Math.round((priceCents * EVENT_LATE_REFUND_PERCENT) / 100),
      daysBefore,
    }
  return { rule: 'none', refundCents: 0, daysBefore }
}

/** İptalin kural dışı tutar yazabilen rolü (K-380). */
export const canOverrideEventRefund = (role: string) => canManageEvents(role)

/**
 * Bilet iptali (K-326, K-380): kullanılmış bilet iptal edilmez; koltuk boşa çıkar. Ödenmiş bilette
 * iade tutarı yazılır: verilmezse kural (`eventRefundQuote`); kuraldan farklı tutarı (ör. kurum
 * etkinliği iptal etti) yalnız yönetici yazar (403 `event_ticket_refund_override_forbidden`) ve not
 * zorunludur; tutar bilet bedelini aşamaz. Ödenmemiş ya da ücretsiz bilette iade tutarı girilmez.
 * İadenin ödendiği ayrıca işaretlenir (`planEventTicketRefund`).
 */
export function planEventTicketCancel(
  input: unknown,
  ticket: EventTicketFacts,
  context: { startsAt: string; now: Date; role: string },
): { reason: string | null; refundCents: number | null } {
  const parsed = cancelEventTicketSchema.parse(input)
  if (ticket.status === 'cancelled')
    throw conflictError('event_ticket_already_cancelled', 'Bilet zaten iptal edilmiş.')
  if (ticket.usedAt !== null)
    throw ruleError('event_ticket_used', 'Girişte kullanılmış bilet iptal edilemez.')
  if (ticket.paymentStatus !== 'paid') {
    if (parsed.refundCents !== null)
      throw ruleError(
        'event_ticket_refund_not_applicable',
        'Ödemesi alınmamış bilette iade tutarı girilmez.',
        ['refundCents'],
      )
    return { reason: parsed.reason, refundCents: null }
  }
  const quote = eventRefundQuote(ticket.priceCents, context.startsAt, context.now)
  if (parsed.refundCents === null || parsed.refundCents === quote.refundCents)
    return { reason: parsed.reason, refundCents: quote.refundCents }
  if (parsed.refundCents > ticket.priceCents)
    throw ruleError('event_ticket_refund_exceeds_price', 'İade tutarı bilet bedelini aşamaz.', [
      'refundCents',
    ])
  if (!canOverrideEventRefund(context.role))
    throw new DomainError(
      'event_ticket_refund_override_forbidden',
      'Kuraldan farklı iade tutarını yalnız yönetici yazabilir.',
      { kind: 'forbidden', path: ['refundCents'] },
    )
  if (parsed.reason === null)
    throw ruleError(
      'event_ticket_refund_reason_required',
      'İade tutarı kuraldan farklıysa iptal notu yazın.',
      ['reason'],
    )
  return { reason: parsed.reason, refundCents: parsed.refundCents }
}

/**
 * İadenin ödendiği işareti (K-380): iptal edilmiş, iade tutarı sıfırdan büyük bilette bir kez;
 * yöntem nakit ya da havale. Gün sonuna ve muhasebeye bağlanmaz (M-49, M-72).
 */
export function planEventTicketRefund(input: unknown, ticket: EventTicketFacts) {
  const parsed = refundEventTicketSchema.parse(input)
  if (ticket.status !== 'cancelled')
    throw ruleError('event_ticket_not_cancelled', 'İade yalnız iptal edilmiş bilette ödenir.')
  if ((ticket.refundCents ?? 0) === 0)
    throw ruleError('event_ticket_no_refund', 'Bu bilet için ödenecek iade yok.')
  if (ticket.refundedAt !== null)
    throw conflictError('event_ticket_already_refunded', 'Biletin iadesi zaten ödenmiş.')
  return { method: parsed.method }
}

/**
 * Giriş (K-326): kod bu etkinliğin bileti olmalı (başka etkinliğin bileti 422
 * `event_ticket_wrong_event`); iptal ve ödenmemiş bilet girmez; bilet bir kez kullanılır (409).
 */
export function planEventTicketCheckIn(ticket: EventTicketFacts, eventId: string) {
  if (ticket.eventId !== eventId)
    throw ruleError('event_ticket_wrong_event', 'Bu bilet başka bir etkinliğe ait.', ['code'])
  assertActive(ticket)
  if (ticket.paymentStatus === 'unpaid')
    throw ruleError('event_ticket_unpaid', 'Biletin ödemesi alınmamış; girişten önce ödeme alın.', [
      'code',
    ])
  if (ticket.usedAt !== null)
    throw conflictError('event_ticket_already_used', 'Bu bilet girişte zaten kullanılmış.', [
      'code',
    ])
}

type CheckInUndoContext = {
  startsAt: string
  now: Date
  actor: { role: string; userId: string }
}

/**
 * Girişi geri almanın engeli (K-378); engel yoksa `null`. Bilet etkin ve kullanılmış olmalı (değilse
 * 409 `event_ticket_not_used`); ön büro yalnız kendi okuttuğu girişi geri alır (403
 * `event_ticket_check_in_not_owner`), yönetici her girişi; etkinlik günü (Europe/Istanbul) bitince
 * geri alınmaz (422 `event_ticket_check_in_undo_expired`).
 */
export function eventTicketCheckInUndoBlocker(
  ticket: Pick<EventTicketFacts, 'status' | 'usedAt' | 'usedByUserId'>,
  context: CheckInUndoContext,
): DomainError | null {
  if (ticket.status === 'cancelled')
    return ruleError('event_ticket_cancelled', 'Bilet iptal edilmiş.')
  if (ticket.usedAt === null)
    return conflictError('event_ticket_not_used', 'Bilet girişte kullanılmamış.')
  if (!canManageEvents(context.actor.role) && ticket.usedByUserId !== context.actor.userId)
    return new DomainError(
      'event_ticket_check_in_not_owner',
      'Girişi yalnız okutan görevli ya da yönetici geri alabilir.',
      { kind: 'forbidden' },
    )
  if (eventDayOf(context.now) > eventDayOf(context.startsAt))
    return ruleError(
      'event_ticket_check_in_undo_expired',
      'Giriş yalnız etkinlik günü bitene kadar geri alınabilir.',
    )
  return null
}

/**
 * Girişi geri alma (K-378): gerekçe 5–200 karakter. Bilet yeniden "geçerli" olur ve yeniden
 * okutulabilir; geri alınan kullanımın izi (an, okutan, gerekçe) ayrı satırda saklanır.
 */
export function planEventTicketCheckInUndo(
  input: unknown,
  ticket: EventTicketFacts,
  context: CheckInUndoContext,
): { reason: string; usedAt: string; usedByUserId: string } {
  const parsed = undoEventTicketCheckInSchema.parse(input)
  const blocker = eventTicketCheckInUndoBlocker(ticket, context)
  if (blocker !== null) throw blocker
  return {
    reason: parsed.reason,
    usedAt: ticket.usedAt ?? '',
    usedByUserId: ticket.usedByUserId ?? '',
  }
}

// --- Özet ve CSV ---------------------------------------------------------------------------------

export type EventTicketSummaryRow = {
  status: EventTicketStatus
  ticketKind: EventTicketKind
  priceCents: number
  paymentStatus: EventTicketPaymentStatus
  usedAt: string | null
  refundCents: number | null
  refundedAt: string | null
}

/**
 * Etkinlik özeti: etkin, kullanılan, ödeme bekleyen bilet; tahsil edilen net tutar (ödenmiş
 * biletlerin bedelinden iptalde yazılan iade düşer, kesinti kalır; K-380) ve ödenmesi bekleyen iade.
 */
export function eventTicketSummary(
  event: Parameters<typeof eventCapacity>[0],
  tickets: readonly EventTicketSummaryRow[],
) {
  const active = tickets.filter((ticket) => ticket.status === 'active')
  const capacity = eventCapacity(event)
  const pending = tickets.filter((ticket) => eventTicketRefundStatus(ticket) === 'pending')
  return {
    capacity,
    activeCount: active.length,
    availableCount: Math.max(0, capacity - active.length),
    invitationCount: active.filter((ticket) => ticket.ticketKind === 'invitation').length,
    usedCount: active.filter((ticket) => ticket.usedAt !== null).length,
    unpaidCount: active.filter((ticket) => ticket.paymentStatus === 'unpaid').length,
    collectedCents: tickets
      .filter((ticket) => ticket.paymentStatus === 'paid')
      .reduce(
        (total, ticket) =>
          total +
          ticket.priceCents -
          (ticket.status === 'cancelled' ? (ticket.refundCents ?? 0) : 0),
        0,
      ),
    pendingRefundCount: pending.length,
    pendingRefundCents: pending.reduce((total, ticket) => total + (ticket.refundCents ?? 0), 0),
  }
}

const istanbulTime = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
const timeText = (value: string | null) =>
  value === null ? '' : istanbulTime.format(new Date(value))

export type EventTicketCsvRow = {
  ticketTypeName: string
  ticketKind: EventTicketKind
  seat: string | null
  studentName: string | null
  holderName: string
  priceCents: number
  paymentStatus: EventTicketPaymentStatus
  paymentMethod: EventTicketPaymentMethod | null
  paidAt: string | null
  status: EventTicketStatus
  usedAt: string | null
  cancelledAt: string | null
  refundCents: number | null
  refundedAt: string | null
}

/**
 * Satış listesi CSV'si (K-327, K-380): bilet başına bir satır, zamanlar Europe/Istanbul; iptal edilen
 * ödenmiş bilette iade tutarı, durumu ve ödendiği an. Bilet kodu yazılmaz
 * (kod girişte bilet yerine geçer; dosya dolaşırsa bilet kopyalanmış olur).
 */
export function eventTicketsCsv(rows: readonly EventTicketCsvRow[]): string {
  const header = [
    'Bilet türü',
    'Tür',
    'Koltuk',
    'Öğrenci',
    'Bilet sahibi',
    'Tutar',
    'Ödeme',
    'Ödeme yöntemi',
    'Ödeme zamanı',
    'Durum',
    'Giriş zamanı',
    'İptal zamanı',
    'İade tutarı',
    'İade',
    'İade zamanı',
  ]
  const lines = [header.map(csvCell).join(CSV_SEPARATOR)]
  for (const row of rows)
    lines.push(
      [
        csvCell(row.ticketTypeName),
        csvCell(EVENT_TICKET_KIND_LABELS[row.ticketKind]),
        csvCell(row.seat ?? ''),
        csvCell(row.studentName ?? ''),
        csvCell(row.holderName),
        csvAmount(row.priceCents),
        csvCell(EVENT_TICKET_PAYMENT_STATUS_LABELS[row.paymentStatus]),
        csvCell(
          row.paymentMethod === null ? '' : EVENT_TICKET_PAYMENT_METHOD_LABELS[row.paymentMethod],
        ),
        csvCell(timeText(row.paidAt)),
        csvCell(EVENT_TICKET_STATE_LABELS[eventTicketState(row)]),
        csvCell(timeText(row.usedAt)),
        csvCell(timeText(row.cancelledAt)),
        row.refundCents === null ? csvCell('') : csvAmount(row.refundCents),
        csvCell(
          row.refundCents === null
            ? ''
            : EVENT_TICKET_REFUND_STATUS_LABELS[eventTicketRefundStatus(row)],
        ),
        csvCell(timeText(row.refundedAt)),
      ].join(CSV_SEPARATOR),
    )
  return lines.join('\r\n')
}
