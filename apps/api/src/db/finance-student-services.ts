import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { FeeUnit } from '@kampus/school-core/lib/fee-tariffs.ts'
import type {
  StudentServiceEndReason,
  StudentServiceInvoiceLine,
  StudentServiceKind,
  StudentServiceRow,
  StudentServiceStatus,
} from '@kampus/school-core/lib/finance-student-services.ts'

import type { Database } from './client.ts'
import { studentServiceInvoices, studentServices } from './schema/finance-student-services.ts'
import { invoices } from './schema/invoices.ts'

/**
 * Ek hizmet aboneliği deposu (DOM-FIN-003; ON-087); her sorgu kurum kapsamlıdır. Taksit satırları
 * çalıştırıcının deposunda yazılır; burada yalnız abonelik ve bağ satırı yazılır, taksit okunur.
 */

const COLUMNS = {
  id: studentServices.id,
  studentId: studentServices.studentId,
  kind: studentServices.kind,
  academicYear: studentServices.academicYear,
  tariffId: studentServices.tariffId,
  tariffVersion: studentServices.tariffVersion,
  feeLevel: studentServices.feeLevel,
  unit: studentServices.unit,
  amountCents: studentServices.amountCents,
  contractId: studentServices.contractId,
  startDate: studentServices.startDate,
  endDate: studentServices.endDate,
  status: studentServices.status,
  endedDate: studentServices.endedDate,
  endReason: studentServices.endReason,
  version: studentServices.version,
}

export interface StoredStudentService extends Omit<StudentServiceRow, 'invoiceIds'> {
  tariffId: string
  tariffVersion: number
  feeLevel: string | null
  unit: FeeUnit
  amountCents: number
  contractId: string | null
  endedDate: string | null
  endReason: StudentServiceEndReason | null
  version: number
}

// Değerler tablonun `check` kısıtlarıyla sınırlıdır.
const stored = (
  row: {
    kind: string
    unit: string
    status: string
    endReason: string | null
  } & Omit<StoredStudentService, 'kind' | 'unit' | 'status' | 'endReason'>,
): StoredStudentService => ({
  ...row,
  kind: row.kind as StudentServiceKind,
  unit: row.unit as FeeUnit,
  status: row.status as StudentServiceStatus,
  endReason: row.endReason as StudentServiceEndReason | null,
})

const active = (institutionId: string) =>
  and(eq(studentServices.institutionId, institutionId), isNull(studentServices.archivedAt))

export async function findStudentService(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredStudentService | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(studentServices)
    .where(and(active(institutionId), eq(studentServices.id, id)))
    .limit(1)
  return row ? stored(row) : null
}

export interface StudentServiceQuery {
  /** Kapsam: verilirse yalnız bu öğrenciler; görevlide verilmez. */
  studentIds?: readonly string[] | undefined
  studentId?: string | undefined
  kind?: StudentServiceKind | undefined
  academicYear?: number | undefined
  status?: StudentServiceStatus | undefined
  page: number
  pageSize: number
}

/** Yeni yıl ve yazılma önce gelir; açık ve kapalı abonelikler aynı listededir. */
export async function listStudentServices(
  db: Database,
  institutionId: string,
  query: StudentServiceQuery,
): Promise<{ items: StoredStudentService[]; total: number }> {
  if (query.studentIds?.length === 0) return { items: [], total: 0 }
  const where = and(
    active(institutionId),
    query.studentIds === undefined
      ? undefined
      : inArray(studentServices.studentId, [...query.studentIds]),
    query.studentId === undefined ? undefined : eq(studentServices.studentId, query.studentId),
    query.kind === undefined ? undefined : eq(studentServices.kind, query.kind),
    query.academicYear === undefined
      ? undefined
      : eq(studentServices.academicYear, query.academicYear),
    query.status === undefined ? undefined : eq(studentServices.status, query.status),
  )
  const [totalRow] = await db.select({ total: count() }).from(studentServices).where(where)
  const rows = await db
    .select(COLUMNS)
    .from(studentServices)
    .where(where)
    .orderBy(
      desc(studentServices.academicYear),
      desc(studentServices.startDate),
      asc(studentServices.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(stored), total: totalRow?.total ?? 0 }
}

/** Öğrencinin açık abonelikleri; kurum kilidi altında çağrılır. Başka modül de bunu okuyabilir. */
export async function openStudentServicesOf(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<StudentServiceRow[]> {
  const rows = await db
    .select(COLUMNS)
    .from(studentServices)
    .where(
      and(
        active(institutionId),
        eq(studentServices.studentId, studentId),
        eq(studentServices.status, 'active'),
      ),
    )
    .orderBy(asc(studentServices.startDate), asc(studentServices.id))
  const links = await invoiceIdsOf(
    db,
    institutionId,
    rows.map((row) => row.id),
  )
  return rows.map((row) => ({ ...stored(row), invoiceIds: links.get(row.id) ?? [] }))
}

/** Aboneliklerin taksit kimlikleri; iptal edilenler de dönür, kural State'te bulamaz. */
export async function invoiceIdsOf(
  db: Database,
  institutionId: string,
  serviceIds: readonly string[],
): Promise<Map<string, string[]>> {
  const links = new Map<string, string[]>()
  if (serviceIds.length === 0) return links
  const rows = await db
    .select({
      serviceId: studentServiceInvoices.studentServiceId,
      invoiceId: studentServiceInvoices.invoiceId,
    })
    .from(studentServiceInvoices)
    .where(
      and(
        eq(studentServiceInvoices.institutionId, institutionId),
        inArray(studentServiceInvoices.studentServiceId, [...serviceIds]),
      ),
    )
    .orderBy(asc(studentServiceInvoices.invoiceId))
  for (const row of rows)
    links.set(row.serviceId, [...(links.get(row.serviceId) ?? []), row.invoiceId])
  return links
}

export type StudentServiceStoredLine = StudentServiceInvoiceLine & { installment: number }

/** Aboneliklerin taksitleri, sırayla; iptal edilen taksit arşivde olduğu için işaretli döner. */
export async function invoiceLinesOf(
  db: Database,
  institutionId: string,
  serviceIds: readonly string[],
): Promise<Map<string, StudentServiceStoredLine[]>> {
  const lines = new Map<string, StudentServiceStoredLine[]>()
  if (serviceIds.length === 0) return lines
  const rows = await db
    .select({
      serviceId: studentServiceInvoices.studentServiceId,
      id: invoices.id,
      installment: invoices.installment,
      amount: invoices.amountCents,
      dueDate: invoices.dueDate,
      paidAt: invoices.paidAt,
      archivedAt: invoices.archivedAt,
    })
    .from(studentServiceInvoices)
    .innerJoin(
      invoices,
      and(
        eq(invoices.institutionId, studentServiceInvoices.institutionId),
        eq(invoices.id, studentServiceInvoices.invoiceId),
      ),
    )
    .where(
      and(
        eq(studentServiceInvoices.institutionId, institutionId),
        inArray(studentServiceInvoices.studentServiceId, [...serviceIds]),
      ),
    )
    .orderBy(asc(invoices.installment))
  for (const row of rows)
    lines.set(row.serviceId, [
      ...(lines.get(row.serviceId) ?? []),
      {
        id: row.id,
        installment: row.installment,
        amount: row.amount,
        dueDate: row.dueDate,
        paidAt: row.paidAt?.toISOString() ?? null,
        cancelled: row.archivedAt !== null,
      },
    ])
  return lines
}

export async function insertStudentService(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    studentId: string
    kind: StudentServiceKind
    academicYear: number
    tariffId: string
    tariffVersion: number
    feeLevel: string | null
    unit: FeeUnit
    amountCents: number
    contractId: string | null
    startDate: string
    endDate: string | null
    invoiceIds: readonly string[]
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { invoiceIds, now, ...columns } = input
  await tx
    .insert(studentServices)
    .values({ institutionId, ...columns, createdAt: now, updatedAt: now })
  if (invoiceIds.length > 0)
    await tx.insert(studentServiceInvoices).values(
      invoiceIds.map((invoiceId) => ({
        institutionId,
        studentServiceId: input.id,
        invoiceId,
        createdAt: now,
        updatedAt: now,
      })),
    )
}

/** Yalnız açık abonelik kapanır; beklenen sürüm verilip tutmazsa `false`. */
export async function endStudentServiceRow(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion?: number
    endedDate: string
    endReason: StudentServiceEndReason
    endedByUserId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(studentServices)
    .set({
      status: 'ended',
      endedDate: input.endedDate,
      endReason: input.endReason,
      endedByUserId: input.endedByUserId,
      version: sql`${studentServices.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        active(institutionId),
        eq(studentServices.id, input.id),
        eq(studentServices.status, 'active'),
        input.expectedVersion === undefined
          ? undefined
          : eq(studentServices.version, input.expectedVersion),
      ),
    )
    .returning({ id: studentServices.id })
  return rows.length === 1
}
