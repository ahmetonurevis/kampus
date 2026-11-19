import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'

import type {
  StaffAdvanceCloseFields,
  StaffAdvanceFields,
  StaffAdvancePaymentMethod,
  StaffAdvanceStatus,
  StaffGarnishmentCloseFields,
  StaffGarnishmentCloseReason,
  StaffGarnishmentFields,
  StaffGarnishmentStatus,
  StaffPensionFields,
  StaffPensionPause,
} from '@kampus/school-core/lib/finance-staff-deductions.ts'
import { STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import {
  staffAdvances,
  staffGarnishments,
  staffPensionEnrollments,
} from './schema/finance-staff-deductions.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Avans ve kesinti deposu (DOM-FIN-101; ON-199). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-staff-deductions.ts`'tedir; depo yalnız okur ve yazar. Personel kaydı
 * Oğuzhan'ın alanındadır: kişi üyelik ve kullanıcı tablosundan okunur, yeni personel tablosu yok.
 */

// --- Personel ------------------------------------------------------------------------------------

export interface StoredDeductionStaff {
  membershipId: string
  name: string
  role: string
  active: boolean
}

/** Kurumun üyeliği (rol ve pasiflik); kurumda yoksa `null`. Öğrenci ve veli de döner, core eler. */
export async function findDeductionStaff(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<StoredDeductionStaff | null> {
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
  const { deactivatedAt, ...rest } = row
  return { ...rest, active: deactivatedAt === null }
}

export interface DeductionStaffQuery {
  page: number
  pageSize: number
  q?: string | undefined
  status?: 'active' | 'passive' | undefined
  holding?: boolean | undefined
}

export interface StoredDeductionStaffRow extends StoredDeductionStaff {
  activeAdvanceCount: number
  activeGarnishmentCount: number
  openPensionCount: number
}

/**
 * Kurumun personeli (yönetici, öğretmen, ön büro) ve açık avans, icra ve BES sayıları; ada göre.
 * Pasif personel de listelenir (ayrılan personelin açık avansı ve icrası ilişik kesmede görünür).
 * `holding` yalnız açık kaydı olanları süzer.
 */
export async function listDeductionStaff(
  db: Database,
  institutionId: string,
  query: DeductionStaffQuery,
): Promise<{ items: StoredDeductionStaffRow[]; total: number }> {
  const owned = (
    table: typeof staffAdvances | typeof staffGarnishments | typeof staffPensionEnrollments,
  ) => sql`${table.institutionId} = ${memberships.institutionId}
      and ${table.membershipId} = ${memberships.id} and ${table.archivedAt} is null`
  const advances = sql<number>`(select count(*)::int from ${staffAdvances}
    where ${owned(staffAdvances)} and ${staffAdvances.status} = 'active')`
  const garnishments = sql<number>`(select count(*)::int from ${staffGarnishments}
    where ${owned(staffGarnishments)} and ${staffGarnishments.status} = 'active')`
  const pensions = sql<number>`(select count(*)::int from ${staffPensionEnrollments}
    where ${owned(staffPensionEnrollments)} and ${staffPensionEnrollments.optOutDate} is null)`
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filters: (SQL | undefined)[] = [
    eq(memberships.institutionId, institutionId),
    inArray(memberships.role, [...STAFF_ROLES]),
    search === undefined ? undefined : sql`strpos(${foldSql(users.name)}, ${search}) > 0`,
    query.status === undefined
      ? undefined
      : query.status === 'active'
        ? isNull(memberships.deactivatedAt)
        : isNotNull(memberships.deactivatedAt),
    query.holding === true ? sql`(${advances} + ${garnishments} + ${pensions}) > 0` : undefined,
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
      activeAdvanceCount: advances,
      activeGarnishmentCount: garnishments,
      openPensionCount: pensions,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .orderBy(asc(foldSql(users.name)), asc(memberships.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map(({ deactivatedAt, ...row }) => ({ ...row, active: deactivatedAt === null })),
    total: totalRow?.total ?? 0,
  }
}

// --- Avans ---------------------------------------------------------------------------------------

export interface StoredAdvance {
  id: string
  membershipId: string
  amountCents: number
  givenDate: string
  paymentMethod: StaffAdvancePaymentMethod
  installmentCount: number
  firstMonth: string
  status: StaffAdvanceStatus
  closedDate: string | null
  closedFromMonth: string | null
  closeMethod: StaffAdvancePaymentMethod | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
  version: number
}

const ADVANCE_COLUMNS = {
  id: staffAdvances.id,
  membershipId: staffAdvances.membershipId,
  amountCents: staffAdvances.amountCents,
  givenDate: staffAdvances.givenDate,
  paymentMethod: staffAdvances.paymentMethod,
  installmentCount: staffAdvances.installmentCount,
  firstMonth: staffAdvances.firstMonth,
  status: staffAdvances.status,
  closedDate: staffAdvances.closedDate,
  closedFromMonth: staffAdvances.closedFromMonth,
  closeMethod: staffAdvances.closeMethod,
  cancelledAt: staffAdvances.cancelledAt,
  cancelReason: staffAdvances.cancelReason,
  createdAt: staffAdvances.createdAt,
  version: staffAdvances.version,
}
type AdvanceRow = Omit<StoredAdvance, 'cancelledAt' | 'createdAt'> & {
  cancelledAt: Date | null
  createdAt: Date
}
const toAdvance = (row: AdvanceRow): StoredAdvance => ({
  ...row,
  cancelledAt: row.cancelledAt === null ? null : row.cancelledAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
})
const advanceOf = (institutionId: string) =>
  and(eq(staffAdvances.institutionId, institutionId), isNull(staffAdvances.archivedAt))

export async function findAdvance(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredAdvance | null> {
  const [row] = await db
    .select(ADVANCE_COLUMNS)
    .from(staffAdvances)
    .where(and(advanceOf(institutionId), eq(staffAdvances.id, id)))
    .limit(1)
  return row === undefined ? null : toAdvance(row)
}

/** Personelin avansları: yeni veriliş önce. */
export async function listAdvances(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<StoredAdvance[]> {
  const rows = await db
    .select(ADVANCE_COLUMNS)
    .from(staffAdvances)
    .where(and(advanceOf(institutionId), eq(staffAdvances.membershipId, membershipId)))
    .orderBy(sql`${staffAdvances.givenDate} desc`, sql`${staffAdvances.createdAt} desc`)
  return rows.map(toAdvance)
}

export async function insertAdvance(
  tx: Database,
  institutionId: string,
  input: StaffAdvanceFields & { id: string; createdByUserId: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(staffAdvances)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Erken kapama; sürüm tutmazsa ya da avans artık açık değilse `false` (409). */
export async function closeAdvance(
  tx: Database,
  institutionId: string,
  input: StaffAdvanceCloseFields & {
    id: string
    expectedVersion: number
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(staffAdvances)
    .set({
      status: 'closed',
      closedDate: input.closedDate,
      closedFromMonth: input.fromMonth,
      closeMethod: input.method,
      closedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        advanceOf(institutionId),
        eq(staffAdvances.id, input.id),
        eq(staffAdvances.version, input.expectedVersion),
        eq(staffAdvances.status, 'active'),
      ),
    )
    .returning({ id: staffAdvances.id })
  return rows.length === 1
}

/** İptal; sürüm tutmazsa ya da avans artık açık değilse `false` (409). */
export async function cancelAdvance(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reason: string; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(staffAdvances)
    .set({
      status: 'cancelled',
      cancelledAt: input.now,
      cancelReason: input.reason,
      cancelledByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        advanceOf(institutionId),
        eq(staffAdvances.id, input.id),
        eq(staffAdvances.version, input.expectedVersion),
        eq(staffAdvances.status, 'active'),
      ),
    )
    .returning({ id: staffAdvances.id })
  return rows.length === 1
}

// --- İcra ----------------------------------------------------------------------------------------

export interface StoredGarnishment {
  id: string
  membershipId: string
  office: string
  fileNumber: string
  claimCents: number
  remainingCents: number
  rateBasisPoints: number
  isAlimony: boolean
  receivedDate: string
  sequence: number
  status: StaffGarnishmentStatus
  closedDate: string | null
  closeReason: StaffGarnishmentCloseReason | null
  createdAt: string
  version: number
}

const GARNISHMENT_COLUMNS = {
  id: staffGarnishments.id,
  membershipId: staffGarnishments.membershipId,
  office: staffGarnishments.office,
  fileNumber: staffGarnishments.fileNumber,
  claimCents: staffGarnishments.claimCents,
  remainingCents: staffGarnishments.remainingCents,
  rateBasisPoints: staffGarnishments.rateBasisPoints,
  isAlimony: staffGarnishments.isAlimony,
  receivedDate: staffGarnishments.receivedDate,
  sequence: staffGarnishments.sequence,
  status: staffGarnishments.status,
  closedDate: staffGarnishments.closedDate,
  closeReason: staffGarnishments.closeReason,
  createdAt: staffGarnishments.createdAt,
  version: staffGarnishments.version,
}
type GarnishmentRow = Omit<StoredGarnishment, 'createdAt'> & { createdAt: Date }
const toGarnishment = (row: GarnishmentRow): StoredGarnishment => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})
const garnishmentOf = (institutionId: string) =>
  and(eq(staffGarnishments.institutionId, institutionId), isNull(staffGarnishments.archivedAt))

export async function findGarnishment(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredGarnishment | null> {
  const [row] = await db
    .select(GARNISHMENT_COLUMNS)
    .from(staffGarnishments)
    .where(and(garnishmentOf(institutionId), eq(staffGarnishments.id, id)))
    .limit(1)
  return row === undefined ? null : toGarnishment(row)
}

/** Personelin icraları: kayıt sırasıyla. */
export async function listGarnishments(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<StoredGarnishment[]> {
  const rows = await db
    .select(GARNISHMENT_COLUMNS)
    .from(staffGarnishments)
    .where(and(garnishmentOf(institutionId), eq(staffGarnishments.membershipId, membershipId)))
    .orderBy(asc(staffGarnishments.sequence))
  return rows.map(toGarnishment)
}

/** Yeni icranın kayıt sırası ve aynı daire-dosya kaydı var mı (kurum kilidi altında). */
export async function loadGarnishmentState(
  tx: Database,
  institutionId: string,
  input: { membershipId: string; office: string; fileNumber: string },
): Promise<{ nextSequence: number; duplicate: boolean }> {
  const [row] = await tx
    .select({
      last: max(staffGarnishments.sequence),
      duplicate: sql<number>`count(*) filter (where ${staffGarnishments.archivedAt} is null
        and ${staffGarnishments.office} = ${input.office}
        and ${staffGarnishments.fileNumber} = ${input.fileNumber})::int`,
    })
    .from(staffGarnishments)
    .where(
      and(
        eq(staffGarnishments.institutionId, institutionId),
        eq(staffGarnishments.membershipId, input.membershipId),
      ),
    )
  return { nextSequence: (row?.last ?? 0) + 1, duplicate: (row?.duplicate ?? 0) > 0 }
}

export async function insertGarnishment(
  tx: Database,
  institutionId: string,
  input: StaffGarnishmentFields & {
    id: string
    sequence: number
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(staffGarnishments).values({
    ...fields,
    remainingCents: fields.claimCents,
    institutionId,
    createdAt: now,
    updatedAt: now,
  })
}

const updateOpenGarnishment = async (
  tx: Database,
  institutionId: string,
  id: string,
  expectedVersion: number,
  values: Partial<typeof staffGarnishments.$inferInsert> & { updatedAt: Date },
) => {
  const rows = await tx
    .update(staffGarnishments)
    .set({ ...values, version: expectedVersion + 1 })
    .where(
      and(
        garnishmentOf(institutionId),
        eq(staffGarnishments.id, id),
        eq(staffGarnishments.version, expectedVersion),
        eq(staffGarnishments.status, 'active'),
      ),
    )
    .returning({ id: staffGarnishments.id })
  return rows.length === 1
}

/** Kalan alacak; sürüm tutmazsa ya da icra kapandıysa `false` (409). */
export function updateGarnishmentRemaining(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; remainingCents: number; now: Date },
): Promise<boolean> {
  return updateOpenGarnishment(tx, institutionId, input.id, input.expectedVersion, {
    remainingCents: input.remainingCents,
    updatedAt: input.now,
  })
}

/** Kapanış; sürüm tutmazsa ya da icra zaten kapandıysa `false` (409). */
export function closeGarnishment(
  tx: Database,
  institutionId: string,
  input: StaffGarnishmentCloseFields & {
    id: string
    expectedVersion: number
    userId: string
    now: Date
  },
): Promise<boolean> {
  return updateOpenGarnishment(tx, institutionId, input.id, input.expectedVersion, {
    status: 'closed',
    closedDate: input.closedDate,
    closeReason: input.reason,
    closedByUserId: input.userId,
    updatedAt: input.now,
  })
}

// --- BES -----------------------------------------------------------------------------------------

export interface StoredPension {
  id: string
  membershipId: string
  rateBasisPoints: number
  startDate: string
  pauses: StaffPensionPause[]
  optOutDate: string | null
  createdAt: string
  version: number
}

const PENSION_COLUMNS = {
  id: staffPensionEnrollments.id,
  membershipId: staffPensionEnrollments.membershipId,
  rateBasisPoints: staffPensionEnrollments.rateBasisPoints,
  startDate: staffPensionEnrollments.startDate,
  pauses: staffPensionEnrollments.pauses,
  optOutDate: staffPensionEnrollments.optOutDate,
  createdAt: staffPensionEnrollments.createdAt,
  version: staffPensionEnrollments.version,
}
type PensionRow = Omit<StoredPension, 'createdAt'> & { createdAt: Date }
const toPension = (row: PensionRow): StoredPension => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})
const pensionOf = (institutionId: string) =>
  and(
    eq(staffPensionEnrollments.institutionId, institutionId),
    isNull(staffPensionEnrollments.archivedAt),
  )

export async function findPension(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPension | null> {
  const [row] = await db
    .select(PENSION_COLUMNS)
    .from(staffPensionEnrollments)
    .where(and(pensionOf(institutionId), eq(staffPensionEnrollments.id, id)))
    .limit(1)
  return row === undefined ? null : toPension(row)
}

/** Personelin katılımları: açık katılım önce, sonra yeni başlangıç önce. */
export async function listPensions(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<StoredPension[]> {
  const rows = await db
    .select(PENSION_COLUMNS)
    .from(staffPensionEnrollments)
    .where(and(pensionOf(institutionId), eq(staffPensionEnrollments.membershipId, membershipId)))
    .orderBy(
      sql`${staffPensionEnrollments.optOutDate} is not null`,
      sql`${staffPensionEnrollments.startDate} desc`,
    )
  return rows.map(toPension)
}

/** Personelin açık (ayrılmamış) katılımı var mı (kurum kilidi altında). */
export async function hasOpenPension(
  tx: Database,
  institutionId: string,
  membershipId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ total: count() })
    .from(staffPensionEnrollments)
    .where(
      and(
        pensionOf(institutionId),
        eq(staffPensionEnrollments.membershipId, membershipId),
        isNull(staffPensionEnrollments.optOutDate),
      ),
    )
  return (row?.total ?? 0) > 0
}

export async function insertPension(
  tx: Database,
  institutionId: string,
  input: StaffPensionFields & { id: string; createdByUserId: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(staffPensionEnrollments)
    .values({ ...fields, pauses: [], institutionId, createdAt: now, updatedAt: now })
}

/** Ara verme ya da ayrılma; sürüm tutmazsa ya da katılımdan ayrılındıysa `false` (409). */
export async function updateOpenPension(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    pauses?: StaffPensionPause[]
    optOut?: { date: string; userId: string }
  },
): Promise<boolean> {
  const rows = await tx
    .update(staffPensionEnrollments)
    .set({
      ...(input.pauses === undefined ? {} : { pauses: input.pauses }),
      ...(input.optOut === undefined
        ? {}
        : { optOutDate: input.optOut.date, optedOutByUserId: input.optOut.userId }),
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        pensionOf(institutionId),
        eq(staffPensionEnrollments.id, input.id),
        eq(staffPensionEnrollments.version, input.expectedVersion),
        isNull(staffPensionEnrollments.optOutDate),
      ),
    )
    .returning({ id: staffPensionEnrollments.id })
  return rows.length === 1
}

// --- Bordro aktarımı ------------------------------------------------------------------------------

/** Ayın kesinti kaynakları (bordro aktarımı, DOM-FIN-105; K-392): her kayıt üyeliğini taşır. */
export interface MonthDeductionRows {
  advances: StoredAdvance[]
  garnishments: StoredGarnishment[]
  pensions: StoredPension[]
}

/**
 * Kurumun ayla kesişebilecek kesinti kayıtları; kesin süzme core `monthlyDeductions`'tadır.
 * Avans: iptal edilmemiş, ilk ayı aydan önce ya da ayda ve en çok 24 ay önce (taksit sınırı).
 * İcra: tebliğ ayın son gününe kadar, kapanmamış ya da kapanışı ay sonundan sonra. BES: başlangıç
 * ay sonuna kadar, ayrılmamış ya da ayrılma ay sonundan sonra.
 */
export async function loadMonthDeductionRows(
  db: Database,
  institutionId: string,
  window: { month: string; earliestFirstMonth: string; monthEnd: string },
): Promise<MonthDeductionRows> {
  const [advances, garnishments, pensions] = await Promise.all([
    db
      .select(ADVANCE_COLUMNS)
      .from(staffAdvances)
      .where(
        and(
          advanceOf(institutionId),
          ne(staffAdvances.status, 'cancelled'),
          lte(staffAdvances.firstMonth, window.month),
          gte(staffAdvances.firstMonth, window.earliestFirstMonth),
        ),
      )
      .orderBy(asc(staffAdvances.givenDate), asc(staffAdvances.id)),
    db
      .select(GARNISHMENT_COLUMNS)
      .from(staffGarnishments)
      .where(
        and(
          garnishmentOf(institutionId),
          lte(staffGarnishments.receivedDate, window.monthEnd),
          or(
            isNull(staffGarnishments.closedDate),
            gt(staffGarnishments.closedDate, window.monthEnd),
          ),
        ),
      )
      .orderBy(asc(staffGarnishments.membershipId), asc(staffGarnishments.sequence)),
    db
      .select(PENSION_COLUMNS)
      .from(staffPensionEnrollments)
      .where(
        and(
          pensionOf(institutionId),
          lte(staffPensionEnrollments.startDate, window.monthEnd),
          or(
            isNull(staffPensionEnrollments.optOutDate),
            gt(staffPensionEnrollments.optOutDate, window.monthEnd),
          ),
        ),
      )
      .orderBy(asc(staffPensionEnrollments.membershipId), asc(staffPensionEnrollments.startDate)),
  ])
  return {
    advances: advances.map(toAdvance),
    garnishments: garnishments.map(toGarnishment),
    pensions: pensions.map(toPension),
  }
}
