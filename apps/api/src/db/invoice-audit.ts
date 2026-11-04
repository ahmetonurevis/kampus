import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { eq, inArray } from 'drizzle-orm'

import { loadDatabaseUrl } from '../config.ts'
import { connectPostgres, type Database } from './client.ts'
import { loadRecords, type StoredRecord } from './records.ts'
import { institutions } from './schema/auth.ts'
import { PAYMENT_METHOD_KEYS, paymentAllocations } from './schema/payments.ts'
import { studentWithdrawals } from './schema/withdrawals.ts'

/**
 * Taksit ve sözleşme tablolarına taşımadan önceki ön denetim (ADR 0010 "Geçiş" adım 1, ON-046a).
 * `records`'taki `invoices` ve `contracts` kayıtlarını yalnız okur ve sayar; hiçbir şeyi düzeltmez
 * ve karar vermez. Sözleşmeye bağlanamayan taksitlerin ne olacağı ayrı karardır (ADR 0010 açık
 * soru 3, #41). Arşivli satırlar da sayılır, çünkü kopyalama onları da taşır.
 *
 * Betik: `node --env-file-if-exists=.env src/db/invoice-audit.ts` (`apps/api` içinde); çıktı kurum
 * başına JSON'dur. Yalnız okuyan sorgular çalışır.
 */

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const NINE_O_CLOCK = /T09:00:00\.000Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Tarifeli kopyanın alanları (core `ContractTerms`); ya hepsi ya hiçbiri bulunmalı. */
const TERMS_FIELDS = [
  'tariffId',
  'tariffVersion',
  'grossCents',
  'netCents',
  'discounts',
  'extras',
  'approvedByUserId',
  'payer',
] as const
const KNOWN_METHODS: ReadonlySet<string> = new Set(Object.keys(PAYMENT_METHOD_KEYS))

export interface CollectionCount {
  total: number
  archived: number
}

export interface FinanceRecordAudit {
  institutionId: string
  contracts: CollectionCount
  invoices: CollectionCount
  /** `contractId` alanı olmayan taksit. */
  invoicesWithoutContractId: number
  /** `contractId`'siz ve hiçbir sözleşmenin `invoiceIds`'inde olmayan taksit (açık soru 3, #41). */
  unlinkedInvoices: CollectionCount
  /**
   * Bunlardan öğrencinin tek sözleşmesi olan taksit: ADR 0010 kopyalama sırasının ikinci adımı
   * ("öğrencinin tek sözleşmesi") bunları bağlayabilir; kalanı hiçbir sözleşmeye bağlanamaz.
   */
  unlinkedWithSingleContract: number
  /** `invoiceIds` alanı olmayan sözleşme (eski kayıt). */
  contractsWithoutInvoiceIds: number
  /** Birden çok sözleşme sürümünün `invoiceIds`'inde geçen taksit (ek protokolde beklenir). */
  multiLinkedInvoices: number
  /** Saat bölümü `T09:00:00.000Z` olmayan ya da an biçiminde olmayan `dueDate`. */
  dueDateNotNineOClock: number
  /** `uuid` olmayan `tariffId`. */
  nonUuidTariffIds: number
  /** `amount ≤ 0` ya da tam sayı olmayan tutar. */
  nonPositiveAmounts: number
  /** `PAYMENT_METHOD_KEYS` dışında `method` (eski demo değerleri dahil). */
  unknownMethods: number
  /** Ödenmiş görünüp yöntemi boş olan ya da tersi (`paidAt` ↔ `method`). */
  paidMethodMismatch: number
  /** Aynı zincirde (kök sözleşme) arşivlenmemiş aynı taksit numarası: fazladan satır sayısı. */
  duplicateInstallments: number
  /** Kaydı olmayan sözleşmeye işaret eden taksit `contractId`'si. */
  danglingInvoiceContracts: number
  /** Kaydı olmayan taksite işaret eden `invoiceIds` öğesi. */
  danglingContractInvoiceIds: number
  /** Kaydı olmayan önceki sürüme işaret eden `amendsContractId`. */
  danglingAmendments: number
  /** Sözleşmesinin öğrencisi taksitinkinden farklı olan bağ (`contractId` ya da `invoiceIds`). */
  studentMismatches: number
  /** Kaydı olmayan taksite dağıtılmış tahsilat satırı (`payment_allocations.invoice_id`). */
  danglingAllocations: number
  /** Kaydı olmayan sözleşmeye bağlı ayrılış (`student_withdrawals.contract_id`). */
  danglingWithdrawals: number
  /** Zorunlu alanı eksik ya da yanlış tipte taksit (`studentId`, `installment`, `amount`, tarihler). */
  invalidInvoiceFields: number
  /** Zorunlu alanı eksik ya da yanlış tipte sözleşme, eksik tarife grubu ya da sürüm tutarsızlığı. */
  invalidContractFields: number
  /** Saklanmaması gereken `paidCents` alanını taşıyan taksit. */
  storedPaidCents: number
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isInstant = (value: unknown) => typeof value === 'string' && ISO_INSTANT.test(value)
const isNullableInstant = (value: unknown) => value === null || isInstant(value)
const isPositiveInt = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0
const isFilled = (value: unknown) => value !== undefined && value !== null

function count(rows: readonly StoredRecord[], test: (row: StoredRecord) => boolean) {
  return rows.reduce((total, row) => total + (test(row) ? 1 : 0), 0)
}

function collectionCount(rows: readonly StoredRecord[]): CollectionCount {
  return { total: rows.length, archived: count(rows, (row) => row.archivedAt !== null) }
}

function invoiceFieldsValid(data: Record<string, unknown>): boolean {
  return (
    isText(data.studentId) &&
    isPositiveInt(data.installment) &&
    Number.isSafeInteger(data.amount) &&
    isInstant(data.dueDate) &&
    isNullableInstant(data.paidAt) &&
    (data.method === null || isText(data.method)) &&
    isNullableInstant(data.reminderAt) &&
    (data.contractId === undefined || isText(data.contractId)) &&
    (data.feeKind === undefined || isText(data.feeKind)) &&
    (data.academicYear === undefined || Number.isSafeInteger(data.academicYear))
  )
}

function contractFieldsValid(data: Record<string, unknown>): boolean {
  const terms = TERMS_FIELDS.filter((field) => isFilled(data[field])).length
  const amends = data.amendsContractId
  const revision = data.revision
  const revisionConsistent =
    amends === undefined
      ? revision === undefined || revision === 1
      : isText(amends) && Number.isSafeInteger(revision) && (revision as number) >= 2
  return (
    isText(data.studentId) &&
    isInstant(data.date) &&
    Number.isSafeInteger(data.amount) &&
    (data.amount as number) >= 0 &&
    isText(data.title) &&
    (data.invoiceIds === undefined ||
      (Array.isArray(data.invoiceIds) && data.invoiceIds.every(isText))) &&
    (terms === 0 || terms === TERMS_FIELDS.length) &&
    revisionConsistent
  )
}

/** Sözleşme zincirinin kökü (`amendsContractId` ile geriye); döngü ya da kopuk bağda `null`. */
function rootOf(
  id: string,
  contracts: ReadonlyMap<string, Record<string, unknown>>,
): string | null {
  const seen = new Set<string>()
  let current = id
  for (;;) {
    if (seen.has(current)) return null
    seen.add(current)
    const contract = contracts.get(current)
    if (!contract) return null
    const previous = contract.amendsContractId
    if (typeof previous !== 'string') return current
    current = previous
  }
}

/** Bir kurumun taksit ve sözleşme kayıtlarının ön denetimi; yalnız okur. */
export async function auditFinanceRecords(
  db: Database,
  institutionId: string,
): Promise<FinanceRecordAudit> {
  const rows = await loadRecords(db, institutionId, ['invoices', 'contracts'], {
    includeArchived: true,
  })
  const invoices = rows.filter((row) => row.collection === 'invoices')
  const contracts = rows.filter((row) => row.collection === 'contracts')
  const invoiceById = new Map(invoices.map((row) => [row.id, row.data]))
  const contractById = new Map(contracts.map((row) => [row.id, row.data]))

  // Taksit → onu `invoiceIds`'inde taşıyan sürümler.
  const linkedBy = new Map<string, string[]>()
  let danglingContractInvoiceIds = 0
  let studentMismatches = 0
  for (const contract of contracts) {
    const ids = contract.data.invoiceIds
    if (!Array.isArray(ids)) continue
    for (const id of new Set(ids.filter(isText))) {
      linkedBy.set(id, [...(linkedBy.get(id) ?? []), contract.id])
      const invoice = invoiceById.get(id)
      if (!invoice) danglingContractInvoiceIds += 1
      else if (invoice.studentId !== contract.data.studentId) studentMismatches += 1
    }
  }

  let danglingInvoiceContracts = 0
  const chains = new Map<string, number>()
  for (const invoice of invoices) {
    const contractId = invoice.data.contractId
    if (!isText(contractId)) continue
    const contract = contractById.get(contractId)
    if (!contract) {
      danglingInvoiceContracts += 1
      continue
    }
    if (contract.studentId !== invoice.data.studentId) studentMismatches += 1
    const root = rootOf(contractId, contractById)
    if (invoice.archivedAt !== null || root === null) continue
    const key = `${root}\u0000${String(invoice.data.installment)}`
    chains.set(key, (chains.get(key) ?? 0) + 1)
  }

  const contractsPerStudent = new Map<string, number>()
  for (const contract of contracts) {
    const studentId = String(contract.data.studentId)
    contractsPerStudent.set(studentId, (contractsPerStudent.get(studentId) ?? 0) + 1)
  }
  const unlinked = invoices.filter((row) => !isText(row.data.contractId) && !linkedBy.has(row.id))

  return {
    institutionId,
    contracts: collectionCount(contracts),
    invoices: collectionCount(invoices),
    invoicesWithoutContractId: count(invoices, (row) => !isText(row.data.contractId)),
    unlinkedInvoices: collectionCount(unlinked),
    unlinkedWithSingleContract: count(
      unlinked,
      (row) => contractsPerStudent.get(String(row.data.studentId)) === 1,
    ),
    contractsWithoutInvoiceIds: count(contracts, (row) => row.data.invoiceIds === undefined),
    multiLinkedInvoices: [...linkedBy.values()].filter((owners) => owners.length > 1).length,
    dueDateNotNineOClock: count(
      invoices,
      (row) => !isInstant(row.data.dueDate) || !NINE_O_CLOCK.test(String(row.data.dueDate)),
    ),
    nonUuidTariffIds: count(
      contracts,
      (row) => isFilled(row.data.tariffId) && !UUID.test(String(row.data.tariffId)),
    ),
    nonPositiveAmounts: count(invoices, (row) => !isPositiveInt(row.data.amount)),
    unknownMethods: count(
      invoices,
      (row) => isFilled(row.data.method) && !KNOWN_METHODS.has(String(row.data.method)),
    ),
    paidMethodMismatch: count(
      invoices,
      (row) => isFilled(row.data.paidAt) !== isFilled(row.data.method),
    ),
    duplicateInstallments: [...chains.values()].reduce((total, n) => total + n - 1, 0),
    danglingInvoiceContracts,
    danglingContractInvoiceIds,
    danglingAmendments: count(contracts, (row) => {
      const previous = row.data.amendsContractId
      return previous !== undefined && !contractById.has(String(previous))
    }),
    studentMismatches,
    ...(await danglingTableLinks(db, institutionId, invoiceById, contractById)),
    invalidInvoiceFields: count(invoices, (row) => !invoiceFieldsValid(row.data)),
    invalidContractFields: count(contracts, (row) => !contractFieldsValid(row.data)),
    storedPaidCents: count(invoices, (row) => row.data.paidCents !== undefined),
  }
}

/** İlişkisel tablolardan `records` kimliğine işaret eden, karşılığı olmayan bağlar. */
async function danglingTableLinks(
  db: Database,
  institutionId: string,
  invoiceById: ReadonlyMap<string, unknown>,
  contractById: ReadonlyMap<string, unknown>,
): Promise<Pick<FinanceRecordAudit, 'danglingAllocations' | 'danglingWithdrawals'>> {
  const allocations = await db
    .select({ invoiceId: paymentAllocations.invoiceId })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.institutionId, institutionId))
  const withdrawals = await db
    .select({ contractId: studentWithdrawals.contractId })
    .from(studentWithdrawals)
    .where(eq(studentWithdrawals.institutionId, institutionId))
  return {
    danglingAllocations: allocations.filter((row) => !invoiceById.has(row.invoiceId)).length,
    danglingWithdrawals: withdrawals.filter((row) => !contractById.has(row.contractId)).length,
  }
}

/** Verilen kurumların (boşsa bütün kurumların) denetimi, kurum kimliği sırasıyla. */
export async function auditAllFinanceRecords(
  db: Database,
  institutionIds: readonly string[] = [],
): Promise<FinanceRecordAudit[]> {
  const rows = await db
    .select({ id: institutions.id })
    .from(institutions)
    .where(institutionIds.length === 0 ? undefined : inArray(institutions.id, [...institutionIds]))
    .orderBy(institutions.id)
  const reports: FinanceRecordAudit[] = []
  for (const { id } of rows) reports.push(await auditFinanceRecords(db, id))
  return reports
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const { db, close } = connectPostgres(loadDatabaseUrl())
  try {
    const reports = await auditAllFinanceRecords(db, process.argv.slice(2))
    console.log(JSON.stringify(reports, null, 2))
  } finally {
    await close()
  }
}
