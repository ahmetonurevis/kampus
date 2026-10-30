import { dayKey, invoiceStatus } from '@kampus/school-core/lib/format.ts'

import type { RecordData } from '../db/collections.ts'
import {
  DAY_PATTERN,
  INSTANT_PATTERN,
  type ActiveMatch,
  type DayRangeMatch,
  type EqualsMatch,
  type FieldMatch,
  type InvoiceStatusLabel,
  type InvoiceStatusMatch,
  type RecordFilter,
  type SetMatch,
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

export function matchesDayRange(record: RecordData, match: DayRangeMatch): boolean {
  const value = record[match.field]
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
    case 'ownOrVia':
      return record[filter.field] !== null && record[filter.field] !== undefined
        ? matchesField(record, { field: filter.field, values: filter.values })
        : matchesField(record, { field: filter.viaField, values: filter.viaValues })
    default:
      return filter satisfies never
  }
}
