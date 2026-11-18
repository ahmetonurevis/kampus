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
  sql,
  type SQL,
} from 'drizzle-orm'

import type {
  MedicalReportIssuer,
  MedicalReportType,
} from '@kampus/school-core/lib/finance-medical-reports.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { staffMedicalReports } from './schema/finance-medical-reports.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Personel sağlık raporu deposu (DOM-FIN-110; ON-185). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-medical-reports.ts`'tedir; depo yalnız okur ve yazar.
 * İptal edilmiş (arşivli) rapor gün hesabına ve çakışma denetimine girmez; listede istenirse görünür.
 */

export interface StoredMedicalReport {
  id: string
  membershipId: string
  staffName: string
  reportType: MedicalReportType
  startDate: string
  endDate: string
  dayCount: number
  issuerType: MedicalReportIssuer | null
  fileId: string | null
  employerNotifiedAt: string | null
  sgkApprovedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
  version: number
}

const t = staffMedicalReports
const COLUMNS = {
  id: t.id,
  membershipId: t.membershipId,
  staffName: users.name,
  reportType: t.reportType,
  startDate: t.startDate,
  endDate: t.endDate,
  dayCount: t.dayCount,
  issuerType: t.issuerType,
  fileId: t.fileId,
  employerNotifiedAt: t.employerNotifiedAt,
  sgkApprovedAt: t.sgkApprovedAt,
  cancelledAt: t.archivedAt,
  cancelReason: t.cancelReason,
  createdAt: t.createdAt,
  version: t.version,
}

type Row = Omit<
  StoredMedicalReport,
  'employerNotifiedAt' | 'sgkApprovedAt' | 'cancelledAt' | 'createdAt'
> & {
  employerNotifiedAt: Date | null
  sgkApprovedAt: Date | null
  cancelledAt: Date | null
  createdAt: Date
}
const iso = (value: Date | null) => (value === null ? null : value.toISOString())
const toReport = (row: Row): StoredMedicalReport => ({
  ...row,
  employerNotifiedAt: iso(row.employerNotifiedAt),
  sgkApprovedAt: iso(row.sgkApprovedAt),
  cancelledAt: iso(row.cancelledAt),
  createdAt: row.createdAt.toISOString(),
})

function selectReports(db: Database) {
  return db
    .select(COLUMNS)
    .from(t)
    .innerJoin(
      memberships,
      and(eq(memberships.institutionId, t.institutionId), eq(memberships.id, t.membershipId)),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
}

/** Rapor (iptal edilmiş de); başka kurumun ya da olmayan rapor `null`. */
export async function findMedicalReport(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredMedicalReport | null> {
  const [row] = await selectReports(db)
    .where(and(eq(t.institutionId, institutionId), eq(t.id, id)))
    .limit(1)
  return row === undefined ? null : toReport(row)
}

/** Raporun dosyası iptal edilmemiş bir rapora bağlı mı (dosya okuma kuralı). */
export async function medicalReportHasFile(
  db: Database,
  institutionId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.institutionId, institutionId),
        eq(t.id, id),
        isNull(t.archivedAt),
        isNotNull(t.fileId),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** `from`–`to` dönemiyle kesişen iptal edilmemiş raporlar (personellere göre; boşsa hepsi). */
export async function loadMedicalReportsInPeriod(
  db: Database,
  institutionId: string,
  input: { membershipIds?: readonly string[] | undefined; from: string; to: string },
): Promise<StoredMedicalReport[]> {
  if (input.membershipIds !== undefined && input.membershipIds.length === 0) return []
  const rows = await selectReports(db)
    .where(
      and(
        eq(t.institutionId, institutionId),
        isNull(t.archivedAt),
        lte(t.startDate, input.to),
        gte(t.endDate, input.from),
        input.membershipIds === undefined
          ? undefined
          : inArray(t.membershipId, [...new Set(input.membershipIds)]),
      ),
    )
    .orderBy(asc(t.membershipId), asc(t.startDate))
  return rows.map(toReport)
}

/** Personelin iptal edilmemiş raporlarının aralıkları (kurum kilidi altında çakışma denetimi). */
export async function loadStaffReportPeriods(
  tx: Database,
  institutionId: string,
  membershipId: string,
): Promise<{ id: string; startDate: string; endDate: string }[]> {
  return tx
    .select({ id: t.id, startDate: t.startDate, endDate: t.endDate })
    .from(t)
    .where(
      and(
        eq(t.institutionId, institutionId),
        eq(t.membershipId, membershipId),
        isNull(t.archivedAt),
      ),
    )
    .orderBy(asc(t.startDate))
}

export interface MedicalReportListQuery {
  page: number
  pageSize: number
  membershipId?: string | undefined
  from?: string | undefined
  to?: string | undefined
  reportType?: MedicalReportType | undefined
  state: 'active' | 'cancelled'
}

/** Rapor listesi: dönemle kesişen, en yeni başlangıç önce. */
export async function listMedicalReports(
  db: Database,
  institutionId: string,
  query: MedicalReportListQuery,
): Promise<{ items: StoredMedicalReport[]; total: number }> {
  const where = and(
    eq(t.institutionId, institutionId),
    query.state === 'active' ? isNull(t.archivedAt) : isNotNull(t.archivedAt),
    query.membershipId === undefined ? undefined : eq(t.membershipId, query.membershipId),
    query.to === undefined ? undefined : lte(t.startDate, query.to),
    query.from === undefined ? undefined : gte(t.endDate, query.from),
    query.reportType === undefined ? undefined : eq(t.reportType, query.reportType),
  )
  const [totalRow] = await db.select({ total: count() }).from(t).where(where)
  const rows = await selectReports(db)
    .where(where)
    .orderBy(desc(t.startDate), asc(foldSql(users.name)), asc(t.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toReport), total: totalRow?.total ?? 0 }
}

export interface ReportStaffMember {
  membershipId: string
  name: string
  role: string
  /** Pasifleştirildiği gün (Europe/Istanbul); etkinse `null`. */
  leftOn: string | null
}

/** Kurumdaki üyelik (ad, rol, ayrıldığı gün); yoksa `null`. */
export async function findReportStaffMember(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<ReportStaffMember | null> {
  const [row] = await db
    .select({
      membershipId: memberships.id,
      name: users.name,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.institutionId, institutionId), eq(memberships.id, membershipId)))
    .limit(1)
  if (row === undefined) return null
  const { deactivatedAt, ...member } = row
  return { ...member, leftOn: deactivatedAt === null ? null : dayKey(deactivatedAt) }
}

export interface ReportStaffQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: 'active' | 'passive' | undefined
  /** Yalnız dönemde iptal edilmemiş raporu olan personel. */
  withReportsIn?: { from: string; to: string } | undefined
}

/** Kurumun personeli (yönetici, öğretmen, ön büro), ada göre; pasif personel de listelenir. */
export async function listReportStaff(
  db: Database,
  institutionId: string,
  query: ReportStaffQuery,
): Promise<{ items: (ReportStaffMember & { active: boolean })[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const period = query.withReportsIn
  const filters: (SQL | undefined)[] = [
    eq(memberships.institutionId, institutionId),
    inArray(memberships.role, [...STAFF_ROLES]),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
    query.status === undefined
      ? undefined
      : query.status === 'active'
        ? isNull(memberships.deactivatedAt)
        : isNotNull(memberships.deactivatedAt),
    period === undefined
      ? undefined
      : sql`exists (select 1 from ${t} where ${t.institutionId} = ${memberships.institutionId}
          and ${t.membershipId} = ${memberships.id} and ${t.archivedAt} is null
          and ${t.startDate} <= ${period.to} and ${t.endDate} >= ${period.from})`,
  ]
  const where = and(...filters)
  const [totalRow] = await db
    .select({ total: count() })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
  const rows = await db
    .select({
      membershipId: memberships.id,
      name: users.name,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .orderBy(asc(foldSql(users.name)), asc(memberships.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map(({ deactivatedAt, ...row }) => ({
      ...row,
      active: deactivatedAt === null,
      leftOn: deactivatedAt === null ? null : dayKey(deactivatedAt),
    })),
    total: totalRow?.total ?? 0,
  }
}

export interface MedicalReportInsert {
  id: string
  membershipId: string
  reportType: MedicalReportType
  startDate: string
  endDate: string
  dayCount: number
  issuerType: MedicalReportIssuer | null
  fileId: string | null
  createdByUserId: string
  now: Date
}

export async function insertMedicalReport(
  tx: Database,
  institutionId: string,
  input: MedicalReportInsert,
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(t).values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** İşaret ve dosya; sürüm tutmazsa ya da rapor iptal edildiyse `false` (409). */
export async function updateMedicalReport(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    userId: string
    now: Date
    employerNotified?: boolean | undefined
    sgkApproved?: boolean | undefined
    fileId?: string | null | undefined
  },
): Promise<boolean> {
  const flag = (value: boolean) =>
    value ? { at: input.now, by: input.userId } : { at: null, by: null }
  const employer = input.employerNotified === undefined ? undefined : flag(input.employerNotified)
  const sgk = input.sgkApproved === undefined ? undefined : flag(input.sgkApproved)
  const rows = await tx
    .update(t)
    .set({
      ...(employer === undefined
        ? {}
        : { employerNotifiedAt: employer.at, employerNotifiedByUserId: employer.by }),
      ...(sgk === undefined ? {} : { sgkApprovedAt: sgk.at, sgkApprovedByUserId: sgk.by }),
      ...(input.fileId === undefined ? {} : { fileId: input.fileId }),
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(t.institutionId, institutionId),
        eq(t.id, input.id),
        isNull(t.archivedAt),
        eq(t.version, input.expectedVersion),
      ),
    )
    .returning({ id: t.id })
  return rows.length === 1
}

/** İptal (arşiv) gerekçeyle, dosya bağı boşalır; sürüm tutmazsa `false` (409). */
export async function cancelMedicalReport(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reason: string; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(t)
    .set({
      archivedAt: input.now,
      cancelReason: input.reason,
      cancelledByUserId: input.userId,
      fileId: null,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(t.institutionId, institutionId),
        eq(t.id, input.id),
        isNull(t.archivedAt),
        eq(t.version, input.expectedVersion),
      ),
    )
    .returning({ id: t.id })
  return rows.length === 1
}
