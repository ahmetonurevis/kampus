import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import { PAYMENT_METHODS, type PaymentMethod } from '@kampus/school-core/lib/payments.ts'

import { AppError, MESSAGES } from '../errors.ts'
import type { Database } from './client.ts'
import type { RecordData } from './collections.ts'
import type {
  DayRangeMatch,
  FieldMatch,
  InvoiceStatusMatch,
  RecordFilter,
  StoredRecord,
} from './records.ts'
import { invoices } from './schema/invoices.ts'
import { PAYMENT_METHOD_KEYS } from './schema/payments.ts'

/**
 * Taksit deposu (ADR 0010 karar 3, 8; ON-046d): `invoices` satırı ↔ core taksit kaydı
 * (`State['invoices'][number]`) dönüşümü, `loadScope` süzgeçlerinin kolon koşuluna çevrilmesi ve
 * yükleme. Yazma, sözleşme ve bağ satırlarıyla birlikte bağımlılık sırasıyla
 * `contract-store.ts` `writeContractsAndInvoices`'tadır. Çift yazma süresince (ON-046e) kaynak
 * `records`'tır ve ayna SQL'de eşitlenir (`finance-mirror-store.ts`); bu depo okuma geçişinde
 * (046f) çalıştırıcıya bağlanır.
 *
 * Dönüşüm birebirdir: core kaydı → satır → core kaydı aynı kayıttır (alanların varlığı dahil).
 * Şemaya uymayan kayıt programlama hatasıdır (500, işlem geri alınır); `paidCents` gibi okumada
 * eklenen alanlar saklanmaz ve reddedilir.
 */

export function programmingError(what: string, cause?: unknown): AppError {
  return new AppError(500, 'internal_error', MESSAGES.internal_error, {
    cause: new Error(what, { cause }),
  })
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const NINE_OCLOCK = /^(\d{4}-\d{2}-\d{2})T09:00:00\.000Z$/
/** Vadenin saat bölümü: core vadeyi günün 09:00Z anı olarak yazar (`enrollment.ts`, `withdrawals.ts`). */
export const DUE_TIME = 'T09:00:00.000Z'

/** `toISOString` biçiminde geçerli an; `timestamptz` gidiş-dönüşü aynı metni verir. */
export const instantSchema = z
  .string()
  .regex(ISO_INSTANT)
  .refine((value) => {
    const parsed = new Date(value)
    return !Number.isNaN(+parsed) && parsed.toISOString() === value
  })

const dueDateSchema = z
  .string()
  .regex(NINE_OCLOCK)
  .refine((value) => instantSchema.safeParse(value).success)

const idSchema = z.string().min(1).max(200)

/** Saklanan core taksit kaydı; alan listesi kapalıdır. */
export const invoiceRecordSchema = z
  .strictObject({
    id: idSchema,
    studentId: idSchema,
    installment: z.number().int().positive(),
    amount: z.number().int().positive(),
    dueDate: dueDateSchema,
    paidAt: instantSchema.nullable(),
    method: z.enum(PAYMENT_METHODS).nullable(),
    reminderAt: instantSchema.nullable(),
    feeKind: z.string().min(1).optional(),
    contractId: idSchema.optional(),
    academicYear: z.number().int().optional(),
    createdAt: instantSchema.optional(),
    updatedAt: instantSchema.optional(),
  })
  .refine((invoice) => (invoice.paidAt === null) === (invoice.method === null), {
    message: 'paidAt and method must be set together',
  })
export type InvoiceRecord = z.infer<typeof invoiceRecordSchema>

export type InvoiceRow = typeof invoices.$inferSelect
/** Satırın core kaydından gelen kolonları (sistem kolonları ve sıra hariç). */
export type InvoiceColumns = Omit<
  typeof invoices.$inferInsert,
  'institutionId' | 'position' | 'createdAt' | 'updatedAt' | 'archivedAt' | 'version' | 'currency'
>

const METHOD_LABELS = new Map<string, PaymentMethod>(
  Object.entries(PAYMENT_METHOD_KEYS).map(([label, key]) => [key, label as PaymentMethod]),
)

/** Core kaydını doğrular; uymayan kayıt programlama hatasıdır. */
export function parseInvoiceRecord(data: RecordData): InvoiceRecord {
  const parsed = invoiceRecordSchema.safeParse(data)
  if (!parsed.success) throw programmingError('invoice record does not match table', parsed.error)
  return parsed.data
}

/**
 * Core kaydı → satır kolonları. Kök (`rootContractId`) `contractId` sürümünün zincir köküdür;
 * çağıran sözleşme deposundan verir, sözleşmesiz taksitte `null`.
 */
export function invoiceToColumns(data: RecordData, rootContractId: string | null): InvoiceColumns {
  const invoice = parseInvoiceRecord(data)
  if ((invoice.contractId === undefined) !== (rootContractId === null))
    throw programmingError('invoice root contract does not match contractId')
  return {
    id: invoice.id,
    studentId: invoice.studentId,
    contractId: invoice.contractId ?? null,
    rootContractId,
    academicYear: invoice.academicYear ?? null,
    installment: invoice.installment,
    feeKind: invoice.feeKind ?? null,
    amountCents: invoice.amount,
    dueDate: invoice.dueDate.slice(0, 10),
    paidAt: invoice.paidAt === null ? null : new Date(invoice.paidAt),
    paymentMethod: invoice.method === null ? null : PAYMENT_METHOD_KEYS[invoice.method],
    reminderAt: invoice.reminderAt === null ? null : new Date(invoice.reminderAt),
    coreCreatedAt: invoice.createdAt === undefined ? null : new Date(invoice.createdAt),
    coreUpdatedAt: invoice.updatedAt === undefined ? null : new Date(invoice.updatedAt),
  }
}

const iso = (value: Date | null) => (value === null ? null : value.toISOString())

/** Satır → core kaydı; boş isteğe bağlı kolon alanı hiç yazmaz (eski kayıt şekli korunur). */
export function rowToInvoice(row: InvoiceRow): InvoiceRecord {
  const method = row.paymentMethod === null ? null : METHOD_LABELS.get(row.paymentMethod)
  if (method === undefined) throw programmingError(`unknown payment method ${row.paymentMethod}`)
  return {
    id: row.id,
    studentId: row.studentId,
    installment: row.installment,
    amount: row.amountCents,
    dueDate: `${row.dueDate}${DUE_TIME}`,
    paidAt: iso(row.paidAt),
    method,
    reminderAt: iso(row.reminderAt),
    ...(row.feeKind === null ? {} : { feeKind: row.feeKind }),
    ...(row.contractId === null ? {} : { contractId: row.contractId }),
    ...(row.academicYear === null ? {} : { academicYear: row.academicYear }),
    ...(row.coreCreatedAt === null ? {} : { createdAt: row.coreCreatedAt.toISOString() }),
    ...(row.coreUpdatedAt === null ? {} : { updatedAt: row.coreUpdatedAt.toISOString() }),
  }
}

export function invoiceToStored(row: InvoiceRow): StoredRecord {
  return {
    collection: 'invoices',
    id: row.id,
    data: rowToInvoice(row),
    position: row.position,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  }
}

/**
 * Alan ↔ kolon eşlemesi ve eşitlik süzgeci. `records`'taki `FieldMatch` dizi alanı da aday sayar;
 * tablo kolonları dizi olmadığından bu kısım her zaman yanlıştır: boş değer listesi hiçbir satırı,
 * dolu liste kolonu değerlerden biri olanları eşler (`EqualsMatch` ile aynı).
 */
export function columnMatch(
  table: string,
  fields: Readonly<Record<string, AnyPgColumn>>,
  match: Pick<FieldMatch, 'field' | 'values'>,
): SQL {
  const column = Object.hasOwn(fields, match.field) ? fields[match.field] : undefined
  if (column === undefined)
    throw programmingError(`untranslatable ${table} filter field: ${match.field}`)
  return match.values.length === 0 ? sql`false` : inArray(column, [...match.values])
}

/** `loadScope` ve okuma süzgecinde kullanılan taksit alanları. */
const INVOICE_FIELDS: Readonly<Record<string, AnyPgColumn>> = {
  id: invoices.id,
  studentId: invoices.studentId,
  contractId: invoices.contractId,
}

/**
 * Taksit durumu: `records`'taki koşulun vade kolonu karşılığı. Vade her zaman günün 09:00Z anı
 * olduğundan (`dueDateSchema`) an biçimli karşılaştırma (`dueDate < bugünün başladığı an`, İstanbul)
 * gün karşılaştırmasına (`due_date < bugün`) eşittir.
 */
function invoiceStatusCondition(match: InvoiceStatusMatch): SQL {
  const paid = sql`${invoices.paidAt} is not null`
  const parts = match.statuses.map((status) => {
    switch (status) {
      case 'Ödendi':
        return paid
      case 'Gecikmiş':
        return sql`(not (${paid}) and ${invoices.dueDate} < ${match.today}::date)`
      case 'Yaklaşan':
        return sql`(not (${paid}) and ${invoices.dueDate} >= ${match.today}::date)`
      default:
        return status satisfies never
    }
  })
  return parts.length === 0 ? sql`false` : sql`(${sql.join(parts, sql` or `)})`
}

/**
 * Gün aralığı: vade günle (09:00Z'nin İstanbul günü vade günüdür), ödeme anı UTC sınırlarıyla
 * karşılaştırılır; `records`'taki `dayRangeMatch` ile aynı sonuç.
 */
function invoiceDayRange(match: DayRangeMatch): SQL {
  const bounds: SQL[] = []
  if (match.field === 'dueDate') {
    if (match.fromDay !== null) bounds.push(sql`${invoices.dueDate} >= ${match.fromDay}::date`)
    if (match.toDay !== null) bounds.push(sql`${invoices.dueDate} <= ${match.toDay}::date`)
    return bounds.length === 0 ? sql`true` : sql`(${sql.join(bounds, sql` and `)})`
  }
  if (match.field === 'paidAt') {
    bounds.push(sql`${invoices.paidAt} is not null`)
    if (match.fromInstant !== null)
      bounds.push(sql`${invoices.paidAt} >= ${match.fromInstant}::timestamptz`)
    if (match.toInstant !== null)
      bounds.push(sql`${invoices.paidAt} < ${match.toInstant}::timestamptz`)
    return sql`(${sql.join(bounds, sql` and `)})`
  }
  throw programmingError(`untranslatable invoices day range field: ${match.field}`)
}

/**
 * `loadRecords` süzgecinin kolon koşulu. Çevrilemeyen süzgeç (arama, etkinlik, duyuru durumu …)
 * programlama hatasıdır (ADR 0010 karar 8); sessizce bütün satırlar yüklenmez.
 */
export function invoiceFilter(filter: RecordFilter): SQL {
  switch (filter.kind) {
    case undefined:
    case 'in':
    case 'equals':
      return columnMatch('invoices', INVOICE_FIELDS, filter)
    case 'any':
      return filter.matches.length === 0
        ? sql`false`
        : sql`(${sql.join(
            filter.matches.map((match) => columnMatch('invoices', INVOICE_FIELDS, match)),
            sql` or `,
          )})`
    case 'invoiceStatus':
      return invoiceStatusCondition(filter)
    case 'dayRange':
      return invoiceDayRange(filter)
    case 'active':
    case 'set':
    case 'announcementStatus':
    case 'ownOrVia':
    case 'settled':
      throw programmingError(`untranslatable invoices filter: ${filter.kind}`)
    default:
      return filter satisfies never
  }
}

/** Yükleme kapsamı: `operation-runner.ts` `LoadScope` ile aynı şekil. */
export interface StoreLoadOptions {
  ids?: readonly string[]
  match?: readonly RecordFilter[]
  includeArchived?: boolean
}

/** Kurumun taksitleri, core dizisinin sırasıyla (`position`, kimlik). */
export async function loadInvoices(
  db: Database,
  institutionId: string,
  options: StoreLoadOptions = {},
): Promise<StoredRecord[]> {
  if (options.ids?.length === 0) return []
  const filters: SQL[] = [eq(invoices.institutionId, institutionId)]
  if (!options.includeArchived) filters.push(isNull(invoices.archivedAt))
  if (options.ids) filters.push(inArray(invoices.id, [...options.ids]))
  for (const match of options.match ?? []) filters.push(invoiceFilter(match))
  const rows = await db
    .select()
    .from(invoices)
    .where(and(...filters))
    .orderBy(asc(invoices.position), asc(invoices.id))
  return rows.map(invoiceToStored)
}
