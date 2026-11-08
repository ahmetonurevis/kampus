import { randomUUID } from 'node:crypto'

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  or,
  sql,
} from 'drizzle-orm'

import type { FeeItemKind } from '@kampus/school-core/lib/fee-tariffs.ts'
import type {
  BilledInvoiceKey,
  BillableLine,
  CorporateCustomerFields,
  CorporateInvoiceCandidate,
  CorporateLink,
} from '@kampus/school-core/lib/finance-corporate.ts'
import type { FinancePeriod } from '@kampus/school-core/lib/finance-export.ts'
import type { GroupMemberStatus } from '@kampus/school-core/lib/language-groups.ts'

import type { Database } from './client.ts'
import { courses } from './schema/courses.ts'
import {
  corporateCustomerEmployees,
  corporateCustomers,
  corporateInvoiceLines,
  corporateInvoices,
} from './schema/finance-corporate.ts'
import { invoices } from './schema/invoices.ts'
import { languageGroupMembers, languageGroups } from './schema/language-groups.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Kurumsal müşteri deposu (DOM-FIN-060; IST-089). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-corporate.ts`'tedir; depo yalnız okur ve yazar. Taksitler
 * `invoices` tablosundan okunur (ADR 0010, ON-046f).
 */

// --- Müşteri -------------------------------------------------------------------------------------

export type StoredCorporateCustomer = CorporateCustomerFields & {
  id: string
  version: number
  createdAt: string
}

const CUSTOMER_COLUMNS = {
  id: corporateCustomers.id,
  name: corporateCustomers.name,
  taxNumber: corporateCustomers.taxNumber,
  taxOffice: corporateCustomers.taxOffice,
  billingAddress: corporateCustomers.billingAddress,
  contactName: corporateCustomers.contactName,
  contactEmail: corporateCustomers.contactEmail,
  contactPhone: corporateCustomers.contactPhone,
  version: corporateCustomers.version,
  createdAt: corporateCustomers.createdAt,
}

type CustomerRow = Omit<StoredCorporateCustomer, 'createdAt'> & { createdAt: Date }
const toCustomer = (row: CustomerRow): StoredCorporateCustomer => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})

const activeCustomer = (institutionId: string) =>
  and(eq(corporateCustomers.institutionId, institutionId), isNull(corporateCustomers.archivedAt))

export async function findCorporateCustomer(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredCorporateCustomer | null> {
  const [row] = await db
    .select(CUSTOMER_COLUMNS)
    .from(corporateCustomers)
    .where(and(activeCustomer(institutionId), eq(corporateCustomers.id, id)))
    .limit(1)
  return row === undefined ? null : toCustomer(row)
}

/** Vergi numarası başka bir etkin şirkette kullanılıyor mu; düzeltmede şirketin kendisi dışlanır. */
export async function isTaxNumberTaken(
  db: Database,
  institutionId: string,
  taxNumber: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: corporateCustomers.id })
    .from(corporateCustomers)
    .where(
      and(
        activeCustomer(institutionId),
        eq(corporateCustomers.taxNumber, taxNumber),
        exceptId === undefined ? undefined : sql`${corporateCustomers.id} <> ${exceptId}`,
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Etkin müşteriler, unvana göre; etkin çalışan sayısıyla. `q` unvanda ya da vergi numarasında. */
export async function listCorporateCustomers(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; q?: string | undefined },
): Promise<{
  items: (StoredCorporateCustomer & { activeEmployeeCount: number })[]
  total: number
}> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    activeCustomer(institutionId),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(corporateCustomers.name)}, ${search}) > 0`,
          sql`strpos(${corporateCustomers.taxNumber}, ${search}) > 0`,
        ),
  )
  const [totalRow] = await db.select({ total: count() }).from(corporateCustomers).where(where)
  const employees = db
    .select({
      customerId: corporateCustomerEmployees.customerId,
      activeCount: count().as('active_count'),
    })
    .from(corporateCustomerEmployees)
    .where(
      and(
        eq(corporateCustomerEmployees.institutionId, institutionId),
        isNull(corporateCustomerEmployees.endsOn),
        isNull(corporateCustomerEmployees.archivedAt),
      ),
    )
    .groupBy(corporateCustomerEmployees.customerId)
    .as('employees')
  const rows = await db
    .select({ ...CUSTOMER_COLUMNS, activeCount: employees.activeCount })
    .from(corporateCustomers)
    .leftJoin(employees, eq(employees.customerId, corporateCustomers.id))
    .where(where)
    .orderBy(asc(foldSql(corporateCustomers.name)), asc(corporateCustomers.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map(({ activeCount, ...row }) => ({
      ...toCustomer(row),
      activeEmployeeCount: Number(activeCount ?? 0),
    })),
    total: totalRow?.total ?? 0,
  }
}

export async function insertCorporateCustomer(
  tx: Database,
  institutionId: string,
  input: CorporateCustomerFields & { id: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(corporateCustomers)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Sürüm tutmazsa `false` (409). */
export async function updateCorporateCustomer(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<CorporateCustomerFields>
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(corporateCustomers)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        activeCustomer(institutionId),
        eq(corporateCustomers.id, input.id),
        eq(corporateCustomers.version, input.expectedVersion),
      ),
    )
    .returning({ id: corporateCustomers.id })
  return rows.length === 1
}

export async function archiveCorporateCustomer(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(corporateCustomers)
    .set({ archivedAt: input.now, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        activeCustomer(institutionId),
        eq(corporateCustomers.id, input.id),
        eq(corporateCustomers.version, input.expectedVersion),
      ),
    )
    .returning({ id: corporateCustomers.id })
  return rows.length === 1
}

// --- Çalışan bağı --------------------------------------------------------------------------------

export type StoredCorporateLink = CorporateLink & { version: number }

const LINK_COLUMNS = {
  id: corporateCustomerEmployees.id,
  customerId: corporateCustomerEmployees.customerId,
  studentId: corporateCustomerEmployees.studentId,
  startsOn: corporateCustomerEmployees.startsOn,
  endsOn: corporateCustomerEmployees.endsOn,
  version: corporateCustomerEmployees.version,
}

const linkScope = (institutionId: string) =>
  and(
    eq(corporateCustomerEmployees.institutionId, institutionId),
    isNull(corporateCustomerEmployees.archivedAt),
  )

/** Şirketin bütün bağları (etkin ve biten), başlangıca göre. */
export async function loadCustomerLinks(
  db: Database,
  institutionId: string,
  customerId: string,
): Promise<StoredCorporateLink[]> {
  return db
    .select(LINK_COLUMNS)
    .from(corporateCustomerEmployees)
    .where(and(linkScope(institutionId), eq(corporateCustomerEmployees.customerId, customerId)))
    .orderBy(asc(corporateCustomerEmployees.startsOn), asc(corporateCustomerEmployees.id))
}

/** Kursiyerin bütün şirket bağları (bütün şirketler). */
export async function loadStudentLinks(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<StoredCorporateLink[]> {
  return db
    .select(LINK_COLUMNS)
    .from(corporateCustomerEmployees)
    .where(and(linkScope(institutionId), eq(corporateCustomerEmployees.studentId, studentId)))
}

export async function findCustomerLink(
  db: Database,
  institutionId: string,
  customerId: string,
  linkId: string,
): Promise<StoredCorporateLink | null> {
  const [row] = await db
    .select(LINK_COLUMNS)
    .from(corporateCustomerEmployees)
    .where(
      and(
        linkScope(institutionId),
        eq(corporateCustomerEmployees.customerId, customerId),
        eq(corporateCustomerEmployees.id, linkId),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function countActiveEmployees(
  db: Database,
  institutionId: string,
  customerId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(corporateCustomerEmployees)
    .where(
      and(
        linkScope(institutionId),
        eq(corporateCustomerEmployees.customerId, customerId),
        isNull(corporateCustomerEmployees.endsOn),
      ),
    )
  return row?.total ?? 0
}

/** Şirketin bağları sayfalı: etkin önce, sonra yeni başlayan önce. */
export async function listCustomerLinks(
  db: Database,
  institutionId: string,
  customerId: string,
  query: { page: number; pageSize: number; status?: 'active' | 'ended' | undefined },
): Promise<{ items: StoredCorporateLink[]; total: number }> {
  const where = and(
    linkScope(institutionId),
    eq(corporateCustomerEmployees.customerId, customerId),
    query.status === 'active'
      ? isNull(corporateCustomerEmployees.endsOn)
      : query.status === 'ended'
        ? isNotNull(corporateCustomerEmployees.endsOn)
        : undefined,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(corporateCustomerEmployees)
    .where(where)
  const items = await db
    .select(LINK_COLUMNS)
    .from(corporateCustomerEmployees)
    .where(where)
    .orderBy(
      sql`${corporateCustomerEmployees.endsOn} is null desc`,
      desc(corporateCustomerEmployees.startsOn),
      asc(corporateCustomerEmployees.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

export async function insertCustomerLink(
  tx: Database,
  institutionId: string,
  input: { id: string; customerId: string; studentId: string; startsOn: string },
  actor: { userId: string; now: Date },
): Promise<void> {
  await tx.insert(corporateCustomerEmployees).values({
    ...input,
    institutionId,
    noticeConfirmedAt: actor.now,
    noticeConfirmedByUserId: actor.userId,
    createdAt: actor.now,
    updatedAt: actor.now,
  })
}

/** Etkin bağı bitirir; sürüm tutmazsa ya da bağ bitmişse `false` (409). */
export async function endCustomerLink(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; endsOn: string; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(corporateCustomerEmployees)
    .set({
      endsOn: input.endsOn,
      endedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        linkScope(institutionId),
        eq(corporateCustomerEmployees.id, input.id),
        isNull(corporateCustomerEmployees.endsOn),
        eq(corporateCustomerEmployees.version, input.expectedVersion),
      ),
    )
    .returning({ id: corporateCustomerEmployees.id })
  return rows.length === 1
}

// --- Taksit adayları -----------------------------------------------------------------------------

/** Öğrencilerin dönemde vadesi gelen, iptal edilmemiş taksitleri. */
export async function loadInvoiceCandidates(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
  period: FinancePeriod,
): Promise<CorporateInvoiceCandidate[]> {
  if (studentIds.length === 0) return []
  const rows = await db
    .select({
      id: invoices.id,
      studentId: invoices.studentId,
      rootContractId: invoices.rootContractId,
      installment: invoices.installment,
      feeKind: invoices.feeKind,
      dueDate: invoices.dueDate,
      amountCents: invoices.amountCents,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.institutionId, institutionId),
        inArray(invoices.studentId, [...studentIds]),
        isNull(invoices.archivedAt),
        gte(invoices.dueDate, period.from),
        lte(invoices.dueDate, period.to),
      ),
    )
  return rows.map((row) => ({ ...row, feeKind: row.feeKind as FeeItemKind | null }))
}

/** Öğrencilerin geçerli (iptal edilmemiş) toplu faturalardaki satır anahtarları. */
export async function loadBilledKeys(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<BilledInvoiceKey[]> {
  if (studentIds.length === 0) return []
  return db
    .select({
      invoiceId: corporateInvoiceLines.invoiceId,
      rootContractId: corporateInvoiceLines.rootContractId,
      installment: corporateInvoiceLines.installment,
    })
    .from(corporateInvoiceLines)
    .where(
      and(
        eq(corporateInvoiceLines.institutionId, institutionId),
        inArray(corporateInvoiceLines.studentId, [...studentIds]),
        isNull(corporateInvoiceLines.archivedAt),
      ),
    )
}

/** Taksitlerin bugünkü durumu (arşiv ve ödeme işareti); satır durumunu core hesaplar. */
export async function loadInvoiceStates(
  db: Database,
  institutionId: string,
  invoiceIds: readonly string[],
): Promise<Map<string, { archived: boolean; paid: boolean }>> {
  if (invoiceIds.length === 0) return new Map()
  const rows = await db
    .select({ id: invoices.id, archivedAt: invoices.archivedAt, paidAt: invoices.paidAt })
    .from(invoices)
    .where(and(eq(invoices.institutionId, institutionId), inArray(invoices.id, [...invoiceIds])))
  return new Map(
    rows.map((row) => [row.id, { archived: row.archivedAt !== null, paid: row.paidAt !== null }]),
  )
}

// --- Toplu fatura --------------------------------------------------------------------------------

const INVOICE_COLUMNS = {
  id: corporateInvoices.id,
  customerId: corporateInvoices.customerId,
  number: corporateInvoices.number,
  periodFrom: corporateInvoices.periodFrom,
  periodTo: corporateInvoices.periodTo,
  customerName: corporateInvoices.customerName,
  taxNumber: corporateInvoices.taxNumber,
  taxOffice: corporateInvoices.taxOffice,
  billingAddress: corporateInvoices.billingAddress,
  totalCents: corporateInvoices.totalCents,
  lineCount: corporateInvoices.lineCount,
  issuedAt: corporateInvoices.issuedAt,
  cancelledAt: corporateInvoices.cancelledAt,
  cancelReason: corporateInvoices.cancelReason,
  version: corporateInvoices.version,
}
type InvoiceRow = Pick<typeof corporateInvoices.$inferSelect, keyof typeof INVOICE_COLUMNS>

export type StoredCorporateInvoice = Omit<InvoiceRow, 'issuedAt' | 'cancelledAt'> & {
  issuedAt: string
  cancelledAt: string | null
}

const toInvoice = (row: InvoiceRow): StoredCorporateInvoice => ({
  ...row,
  issuedAt: row.issuedAt.toISOString(),
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
})

/** Yıl içindeki sıradaki numara; kurum kilidi altında okunur. İptal edilen numara da sayılır. */
export async function nextInvoiceSequence(
  db: Database,
  institutionId: string,
  year: number,
): Promise<number> {
  const [row] = await db
    .select({ last: max(corporateInvoices.numberSequence) })
    .from(corporateInvoices)
    .where(
      and(
        eq(corporateInvoices.institutionId, institutionId),
        eq(corporateInvoices.numberYear, year),
      ),
    )
  return (row?.last ?? 0) + 1
}

export async function insertCorporateInvoice(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    customer: StoredCorporateCustomer
    number: string
    year: number
    sequence: number
    period: FinancePeriod
    totalCents: number
    lines: readonly BillableLine[]
    userId: string
    now: Date
  },
): Promise<void> {
  const { customer, now } = input
  await tx.insert(corporateInvoices).values({
    institutionId,
    id: input.id,
    customerId: customer.id,
    number: input.number,
    numberYear: input.year,
    numberSequence: input.sequence,
    periodFrom: input.period.from,
    periodTo: input.period.to,
    customerName: customer.name,
    taxNumber: customer.taxNumber,
    taxOffice: customer.taxOffice,
    billingAddress: customer.billingAddress,
    totalCents: input.totalCents,
    lineCount: input.lines.length,
    issuedAt: now,
    issuedByUserId: input.userId,
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(corporateInvoiceLines).values(
    input.lines.map((line) => ({
      institutionId,
      id: randomUUID(),
      corporateInvoiceId: input.id,
      invoiceId: line.id,
      studentId: line.studentId,
      rootContractId: line.rootContractId,
      installment: line.installment,
      feeKind: line.feeKind,
      dueDate: line.dueDate,
      amountCents: line.amountCents,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

export async function findCorporateInvoice(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredCorporateInvoice | null> {
  const [row] = await db
    .select(INVOICE_COLUMNS)
    .from(corporateInvoices)
    .where(
      and(
        eq(corporateInvoices.institutionId, institutionId),
        eq(corporateInvoices.id, id),
        isNull(corporateInvoices.archivedAt),
      ),
    )
    .limit(1)
  return row === undefined ? null : toInvoice(row)
}

/** Toplu faturalar, yeni kesilen önce. */
export async function listCorporateInvoices(
  db: Database,
  institutionId: string,
  query: {
    page: number
    pageSize: number
    customerId?: string | undefined
    status?: 'issued' | 'cancelled' | undefined
  },
): Promise<{ items: StoredCorporateInvoice[]; total: number }> {
  const where = and(
    eq(corporateInvoices.institutionId, institutionId),
    isNull(corporateInvoices.archivedAt),
    query.customerId === undefined ? undefined : eq(corporateInvoices.customerId, query.customerId),
    query.status === 'issued'
      ? isNull(corporateInvoices.cancelledAt)
      : query.status === 'cancelled'
        ? isNotNull(corporateInvoices.cancelledAt)
        : undefined,
  )
  const [totalRow] = await db.select({ total: count() }).from(corporateInvoices).where(where)
  const rows = await db
    .select(INVOICE_COLUMNS)
    .from(corporateInvoices)
    .where(where)
    .orderBy(desc(corporateInvoices.issuedAt), desc(corporateInvoices.number))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toInvoice), total: totalRow?.total ?? 0 }
}

export type StoredCorporateInvoiceLine = {
  invoiceId: string
  studentId: string
  installment: number
  feeKind: FeeItemKind | null
  dueDate: string
  amountCents: number
}

/** Faturanın satırları (iptal edilmişse arşivli satırlar da), vade sırasıyla. */
export async function loadCorporateInvoiceLines(
  db: Database,
  institutionId: string,
  corporateInvoiceId: string,
): Promise<StoredCorporateInvoiceLine[]> {
  const rows = await db
    .select({
      invoiceId: corporateInvoiceLines.invoiceId,
      studentId: corporateInvoiceLines.studentId,
      installment: corporateInvoiceLines.installment,
      feeKind: corporateInvoiceLines.feeKind,
      dueDate: corporateInvoiceLines.dueDate,
      amountCents: corporateInvoiceLines.amountCents,
    })
    .from(corporateInvoiceLines)
    .where(
      and(
        eq(corporateInvoiceLines.institutionId, institutionId),
        eq(corporateInvoiceLines.corporateInvoiceId, corporateInvoiceId),
      ),
    )
    .orderBy(
      asc(corporateInvoiceLines.dueDate),
      asc(corporateInvoiceLines.studentId),
      asc(corporateInvoiceLines.installment),
    )
  return rows.map((row) => ({ ...row, feeKind: row.feeKind as FeeItemKind | null }))
}

/** İptal: fatura gerekçeyle işaretlenir, satırlar arşivlenir. Sürüm tutmazsa `false` (409). */
export async function cancelCorporateInvoice(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reason: string; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(corporateInvoices)
    .set({
      cancelledAt: input.now,
      cancelledByUserId: input.userId,
      cancelReason: input.reason,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(corporateInvoices.institutionId, institutionId),
        eq(corporateInvoices.id, input.id),
        isNull(corporateInvoices.cancelledAt),
        isNull(corporateInvoices.archivedAt),
        eq(corporateInvoices.version, input.expectedVersion),
      ),
    )
    .returning({ id: corporateInvoices.id })
  if (rows.length !== 1) return false
  await tx
    .update(corporateInvoiceLines)
    .set({
      archivedAt: input.now,
      updatedAt: input.now,
      version: sql`${corporateInvoiceLines.version} + 1`,
    })
    .where(
      and(
        eq(corporateInvoiceLines.institutionId, institutionId),
        eq(corporateInvoiceLines.corporateInvoiceId, input.id),
        isNull(corporateInvoiceLines.archivedAt),
      ),
    )
  return true
}

// --- Katılım özeti -------------------------------------------------------------------------------

export type CorporateEnrollmentRow = {
  enrollmentId: string
  studentId: string
  memberStatus: GroupMemberStatus
  groupName: string
  courseName: string
  level: string
  totalHours: number
}

/** Kursiyerlerin arşivlenmemiş kur kayıtları; grup ve kur adıyla, katılım sırasıyla. */
export async function loadEnrollmentsOfStudents(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<CorporateEnrollmentRow[]> {
  if (studentIds.length === 0) return []
  return db
    .select({
      enrollmentId: languageGroupMembers.id,
      studentId: languageGroupMembers.studentId,
      memberStatus: languageGroupMembers.status,
      groupName: languageGroups.name,
      courseName: courses.name,
      level: courses.level,
      totalHours: courses.totalHours,
    })
    .from(languageGroupMembers)
    .innerJoin(
      languageGroups,
      and(
        eq(languageGroups.institutionId, languageGroupMembers.institutionId),
        eq(languageGroups.id, languageGroupMembers.groupId),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.institutionId, languageGroups.institutionId),
        eq(courses.id, languageGroups.courseId),
      ),
    )
    .where(
      and(
        eq(languageGroupMembers.institutionId, institutionId),
        inArray(languageGroupMembers.studentId, [...studentIds]),
        isNull(languageGroupMembers.archivedAt),
      ),
    )
    .orderBy(asc(languageGroupMembers.joinedAt), asc(languageGroupMembers.id))
}
