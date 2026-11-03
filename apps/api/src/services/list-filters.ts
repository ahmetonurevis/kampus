import {
  ANNOUNCEMENT_STATUS,
  announcementStatusOf,
  type AnnouncementStatus,
} from '@kampus/school-core/lib/communication.ts'
import { dayKey, invoiceStatus } from '@kampus/school-core/lib/format.ts'

import type { RecordData } from '../db/collections.ts'
import {
  DAY_PATTERN,
  INSTANT_PATTERN,
  type ActiveMatch,
  type AnnouncementStatusMatch,
  type DayRangeMatch,
  type EqualsMatch,
  type FieldMatch,
  type InvoiceStatusLabel,
  type InvoiceStatusMatch,
  type RecordFilter,
  type SetMatch,
  type SettledMatch,
} from '../db/records.ts'

/**
 * Liste süzgeçlerinin bellekteki karşılığı. Her süzgecin SQL koşulu `db/records.ts`
 * `recordFilter`'dadır; burada aynı kural ayıklanmış kayıt üzerinde uygulanır. `in` SQL'de aday
 * (dizi alanı geçer), bellekte kesindir; `active` ve `dayRange` iki tarafta da kesindir;
 * `invoiceStatus` gün ve an biçimli vadede kesin, başka biçimde SQL'de adaydır. Testler iki
 * tarafın aynı sonucu verdiğini doğrular.
 */

const TIME_ZONE = 'Europe/Istanbul'
const zoneParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Anın Europe/Istanbul saat farkı (ms). */
function zoneOffset(instant: number): number {
  const parts = zoneParts.formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0)
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  )
  return wall - Math.floor(instant / 1000) * 1000
}

function utcDay(day: string): number {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return Date.UTC(year, month - 1, date)
}

/** `YYYY-MM-DD` Europe/Istanbul gününün başladığı an (UTC ISO). */
export function istanbulDayStart(day: string): string {
  const midnight = utcDay(day)
  // Fark gece yarısının kendisinde ölçülür (yaz saati geçişinde ilk tahmin bir saat kayabilir).
  const start = midnight - zoneOffset(midnight - zoneOffset(midnight))
  return new Date(start).toISOString()
}

function nextDay(day: string): string {
  return new Date(utcDay(day) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** `dateFrom`/`dateTo` sorgusundan gün aralığı süzgeci; ikisi de yoksa `null`. */
export function dayRange(
  field: string,
  fromDay: string | undefined,
  toDay: string | undefined,
): DayRangeMatch | null {
  if (fromDay === undefined && toDay === undefined) return null
  return {
    kind: 'dayRange',
    field,
    fromDay: fromDay ?? null,
    toDay: toDay ?? null,
    fromInstant: fromDay === undefined ? null : istanbulDayStart(fromDay),
    toInstant: toDay === undefined ? null : istanbulDayStart(nextDay(toDay)),
  }
}

const DAY = new RegExp(DAY_PATTERN)
const INSTANT = new RegExp(INSTANT_PATTERN)

/** Bayt sırası (SQL `collate "C"`); gün ve an metinleri ASCII'dir, kod birimi sırası aynıdır. */
const atLeast = (value: string, bound: string | null) => bound === null || value >= bound
const atMost = (value: string, bound: string | null) => bound === null || value <= bound
const below = (value: string, bound: string | null) => bound === null || value < bound

/**
 * Alan değeri; iç içe alan `a.b` (nokta ayracı) kayıtta `a` nesnesinin `b` alanıdır. Yol yalnız
 * nesne (dizi ve metin değil) içinde yürür, düz alan adı noktalı bir anahtar gibi okunmaz: SQL
 * `data #>> '{a,b}'` ile aynı sonuç (`dayRangeMatch`).
 */
export function valueAtPath(record: RecordData, field: string): unknown {
  let value: unknown = record
  for (const key of field.split('.')) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    if (!Object.hasOwn(value, key)) return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

/** Alanın kayıttaki en üst düzey adı (`trialLesson.date` → `trialLesson`); rol gizlemesi buna bakar. */
export function rootField(field: string): string {
  return field.split('.')[0] ?? field
}

export function matchesDayRange(record: RecordData, match: DayRangeMatch): boolean {
  const value = valueAtPath(record, match.field)
  if (typeof value !== 'string') return false
  if (DAY.test(value)) return atLeast(value, match.fromDay) && atMost(value, match.toDay)
  if (INSTANT.test(value)) return atLeast(value, match.fromInstant) && below(value, match.toInstant)
  return false
}

/**
 * Tarih alanının Europe/Istanbul ayı (`YYYY-MM`): gün biçimli değer kendi ayıdır, an (ISO UTC)
 * Istanbul gününe çevrilir. Başka biçim ve metin olmayan değer `null` grubudur (`matchesDayRange`
 * ile aynı biçim kuralı).
 */
export function monthOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (DAY.test(value)) return value.slice(0, 7)
  if (INSTANT.test(value)) return dayKey(value).slice(0, 7)
  return null
}

export function matchesActive(record: RecordData, { field, active }: ActiveMatch): boolean {
  return (record[field] === false) !== active
}

export function matchesSet(record: RecordData, { field, set, rule }: SetMatch): boolean {
  const value = record[field]
  const filled = rule === 'truthy' ? Boolean(value) : value !== null && value !== undefined
  return filled === set
}

/**
 * Taksitin core durumu (`invoiceStatus`); `today` Europe/Istanbul günüdür (`dayKey(ctx.now)`).
 * Ödenmemiş taksitin vadesi okunamıyorsa durum yoktur (`null`): core böyle bir vadede hata
 * fırlatır, kayıt hiçbir duruma sayılmaz.
 */
export function invoiceStatusOf(record: RecordData, today: string): InvoiceStatusLabel | null {
  const paidAt = record.paidAt
  const dueDate = record.dueDate
  // Core ödemeyi doğruluk değeriyle değerlendirir (`invoiceStatusKey`); SQL de `FALSY_JSON`
  // dışındaki her değeri ödenmiş sayar. `String([])` gibi boş metne düşen doğru değerler
  // ödenmemiş sayılmasın diye metin olmayan değer JSON biçimiyle verilir.
  const paid = !paidAt ? null : typeof paidAt === 'string' ? paidAt : JSON.stringify(paidAt)
  if (!paid) {
    if (typeof dueDate !== 'string' && typeof dueDate !== 'number') return null
    if (Number.isNaN(new Date(dueDate).getTime())) return null
  }
  return invoiceStatus(
    { paidAt: paid, dueDate: typeof dueDate === 'number' ? dueDate : String(dueDate) },
    today,
  )
}

/** Durum süzgeci; gün ve başlangıç anı isteğin saatinden (`ctx.now`). */
export function invoiceStatusFilter(
  statuses: readonly InvoiceStatusLabel[],
  now: Date,
): InvoiceStatusMatch {
  const today = dayKey(now)
  return { kind: 'invoiceStatus', statuses, today, todayStart: istanbulDayStart(today) }
}

export function matchesInvoiceStatus(record: RecordData, match: InvoiceStatusMatch): boolean {
  const status = invoiceStatusOf(record, match.today)
  return status !== null && match.statuses.includes(status)
}

/** Duyuru süzgeci; gün ve okuyucu ayıklanmış kayıttandır (`myReadAt`). */
export function announcementStatusFilter(
  statuses: readonly AnnouncementStatus[],
): AnnouncementStatusMatch {
  return { kind: 'announcementStatus', statuses }
}

/** Kesin karar: okuyucuya göre daraltılmış kaydın durumu (`myReadAt` içerir). */
export function matchesAnnouncementStatus(
  record: RecordData,
  match: AnnouncementStatusMatch,
): boolean {
  return match.statuses.includes(announcementStatusOf(record))
}

/**
 * Ham kayıtta aday kararı (SQL koşuluyla aynı): `myReadAt` ham kayıtta yoktur, bu yüzden okunmadı
 * ve yayında geri çekilmemiş her kaydı, güncellendi düzeltilmiş olanı da kapsar.
 */
export function announcementStatusCandidate(
  record: RecordData,
  { statuses }: AnnouncementStatusMatch,
): boolean {
  const withdrawn = Boolean(record.withdrawnAt)
  return statuses.some((status) => {
    switch (status) {
      case ANNOUNCEMENT_STATUS.withdrawn:
        return withdrawn
      case ANNOUNCEMENT_STATUS.unread:
      case ANNOUNCEMENT_STATUS.published:
        return !withdrawn
      case ANNOUNCEMENT_STATUS.updated:
        return !withdrawn && Boolean(record.revisedAt)
      default:
        return status satisfies never
    }
  })
}

/** Ham (ayıklanmamış) kayıtta aday kararı; okuyucuya özgü süzgeçler dışında `matchesRecordFilter`. */
export function candidateMatchesRecordFilter(record: RecordData, filter: RecordFilter): boolean {
  return filter.kind === 'announcementStatus'
    ? announcementStatusCandidate(record, filter)
    : matchesRecordFilter(record, filter)
}

function primitiveText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/** Eşitlik: alanın metin değeri (dizide üyelerden biri) değerlerden biri. */
export function matchesField(record: RecordData, { field, values }: FieldMatch): boolean {
  const value = record[field]
  const candidates = Array.isArray(value) ? value.map(primitiveText) : [primitiveText(value)]
  return candidates.some((text) => text !== null && values.includes(text))
}

/** Kesin metin eşitliği (`EqualsMatch`): dizi ve metin olmayan değer eşleşmez. */
export function matchesEquals(record: RecordData, { field, values }: EqualsMatch): boolean {
  const value = record[field]
  return typeof value === 'string' && values.includes(value)
}

/** Sonuçlanmış deneme (`SettledMatch`): SQL koşulunun bellekteki karşılığı. */
export function matchesSettled(record: RecordData, { expiredBefore }: SettledMatch): boolean {
  const expiresAt = record.expiresAt
  return (
    record.status !== 'started' ||
    (typeof expiresAt === 'string' && INSTANT.test(expiresAt) && expiresAt < expiredBefore)
  )
}

export function matchesRecordFilter(record: RecordData, filter: RecordFilter): boolean {
  switch (filter.kind) {
    case undefined:
    case 'in':
      return matchesField(record, filter)
    case 'equals':
      return matchesEquals(record, filter)
    case 'any':
      return filter.matches.some((match) => matchesField(record, match))
    case 'active':
      return matchesActive(record, filter)
    case 'set':
      return matchesSet(record, filter)
    case 'dayRange':
      return matchesDayRange(record, filter)
    case 'invoiceStatus':
      return matchesInvoiceStatus(record, filter)
    case 'announcementStatus':
      return matchesAnnouncementStatus(record, filter)
    case 'ownOrVia':
      return record[filter.field] !== null && record[filter.field] !== undefined
        ? matchesField(record, { field: filter.field, values: filter.values })
        : matchesField(record, { field: filter.viaField, values: filter.viaValues })
    case 'settled':
      return matchesSettled(record, filter)
    default:
      return filter satisfies never
  }
}
