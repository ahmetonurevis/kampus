import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'

import type {
  LateRefundRule,
  PaidActivityKind,
  PaidActivityStatus,
  ParticipationCancelKind,
  ParticipationStatus,
} from '@kampus/school-core/lib/finance-paid-activities.ts'
import { bankAccountLabel } from '@kampus/school-core/lib/payments.ts'

import type { Database } from './client.ts'
import { paidActivities, paidActivityParticipants } from './schema/finance-paid-activities.ts'
import { invoices } from './schema/invoices.ts'
import { bankAccounts, paymentAllocations, payments } from './schema/payments.ts'
import { records } from './schema/records.ts'
import type { StoredDayRefund } from './withdrawals.ts'

/**
 * Gezi ve etkinlik ücreti deposu (DOM-FIN-098; ON-142). Her sorgu kurum kapsamlıdır; öğrenci adı
 * `records`'tan kurum eşleşmesiyle okunur, katılımın ödemesi taksit tablosu ve iptal edilmemiş
 * tahsilat dağılımlarından türetilir (saklanmaz, DOM-FIN-030). IBAN ve gerekçe loglanmaz.
 */

const activeActivity = (institutionId: string) =>
  and(eq(paidActivities.institutionId, institutionId), isNull(paidActivities.archivedAt))
const liveParticipant = (institutionId: string) =>
  and(
    eq(paidActivityParticipants.institutionId, institutionId),
    isNull(paidActivityParticipants.archivedAt),
  )

const STUDENT_JOIN = and(
  eq(records.institutionId, paidActivityParticipants.institutionId),
  eq(records.collection, 'students'),
  eq(records.id, paidActivityParticipants.studentId),
)
const BANK_JOIN = and(
  eq(bankAccounts.institutionId, paidActivityParticipants.institutionId),
  eq(bankAccounts.id, paidActivityParticipants.refundBankAccountId),
)
const studentName = sql<string | null>`${records.data} ->> 'name'`
const labelOf = (bankName: string | null, iban: string | null) =>
  bankName === null || iban === null ? null : bankAccountLabel({ bankName, iban })

// --- Etkinlik ------------------------------------------------------------------------------------

export interface StoredPaidActivity {
  id: string
  kind: PaidActivityKind
  name: string
  activityDate: string
  feeCents: number
  joinDeadline: string
  cancelDeadline: string
  capacity: number
  lateRefundRule: LateRefundRule
  lateRefundPercent: number | null
  lateCostCents: number | null
  externalRef: string | null
  status: PaidActivityStatus
  cancelledAt: Date | null
  cancelReason: string | null
  version: number
}

const ACTIVITY_COLUMNS = {
  id: paidActivities.id,
  kind: sql<PaidActivityKind>`${paidActivities.kind}`,
  name: paidActivities.name,
  activityDate: paidActivities.activityDate,
  feeCents: paidActivities.feeCents,
  joinDeadline: paidActivities.joinDeadline,
  cancelDeadline: paidActivities.cancelDeadline,
  capacity: paidActivities.capacity,
  lateRefundRule: sql<LateRefundRule>`${paidActivities.lateRefundRule}`,
  lateRefundPercent: paidActivities.lateRefundPercent,
  lateCostCents: paidActivities.lateCostCents,
  externalRef: paidActivities.externalRef,
  status: sql<PaidActivityStatus>`${paidActivities.status}`,
  cancelledAt: paidActivities.cancelledAt,
  cancelReason: paidActivities.cancelReason,
  version: paidActivities.version,
}

export interface ActivityCounts {
  participantCount: number
  pendingRefundCount: number
}

/** Etkinlik başına iptal edilmemiş katılımcı ve ödenmemiş iade sayısı. */
export async function activityCounts(
  db: Database,
  institutionId: string,
  activityIds: readonly string[],
): Promise<Map<string, ActivityCounts>> {
  if (activityIds.length === 0) return new Map()
  const rows = await db
    .select({
      activityId: paidActivityParticipants.activityId,
      participantCount: sql<number>`count(*) filter (where ${paidActivityParticipants.status} = 'active')::int`,
      pendingRefundCount: sql<number>`count(*) filter (where ${paidActivityParticipants.refundCents} > 0 and ${paidActivityParticipants.refundPaidDate} is null)::int`,
    })
    .from(paidActivityParticipants)
    .where(
      and(
        liveParticipant(institutionId),
        inArray(paidActivityParticipants.activityId, [...activityIds]),
      ),
    )
    .groupBy(paidActivityParticipants.activityId)
  return new Map(
    rows.map((row) => [
      row.activityId,
      { participantCount: row.participantCount, pendingRefundCount: row.pendingRefundCount },
    ]),
  )
}

export async function listPaidActivities(
  db: Database,
  institutionId: string,
  query: { status?: PaidActivityStatus | undefined; page: number; pageSize: number },
): Promise<{ items: StoredPaidActivity[]; total: number }> {
  const where = and(
    activeActivity(institutionId),
    query.status === undefined ? undefined : eq(paidActivities.status, query.status),
  )
  const [totalRow] = await db.select({ total: count() }).from(paidActivities).where(where)
  const items = await db
    .select(ACTIVITY_COLUMNS)
    .from(paidActivities)
    .where(where)
    .orderBy(desc(paidActivities.activityDate), asc(paidActivities.name), asc(paidActivities.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

export async function findPaidActivity(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPaidActivity | null> {
  const [row] = await db
    .select(ACTIVITY_COLUMNS)
    .from(paidActivities)
    .where(and(activeActivity(institutionId), eq(paidActivities.id, id)))
    .limit(1)
  return row ?? null
}

export async function insertPaidActivity(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    kind: PaidActivityKind
    name: string
    activityDate: string
    feeCents: number
    joinDeadline: string
    cancelDeadline: string
    capacity: number
    lateRefundRule: LateRefundRule
    lateRefundPercent: number | null
    lateCostCents: number | null
    externalRef: string | null
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...activity } = input
  await tx
    .insert(paidActivities)
    .values({ institutionId, ...activity, createdAt: now, updatedAt: now })
}

/** Beklenen sürümde düzeltir; tutmazsa `false`. */
export async function updatePaidActivity(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    name: string
    capacity: number
    joinDeadline: string
    externalRef: string | null
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(paidActivities)
    .set({
      name: input.name,
      capacity: input.capacity,
      joinDeadline: input.joinDeadline,
      externalRef: input.externalRef,
      version: sql`${paidActivities.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        activeActivity(institutionId),
        eq(paidActivities.id, input.id),
        eq(paidActivities.version, input.expectedVersion),
        eq(paidActivities.status, 'open'),
      ),
    )
    .returning({ id: paidActivities.id })
  return rows.length === 1
}

export async function markPaidActivityCancelled(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reason: string; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(paidActivities)
    .set({
      status: 'cancelled',
      cancelledAt: input.now,
      cancelReason: input.reason,
      cancelledByUserId: input.userId,
      version: sql`${paidActivities.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        activeActivity(institutionId),
        eq(paidActivities.id, input.id),
        eq(paidActivities.version, input.expectedVersion),
        eq(paidActivities.status, 'open'),
      ),
    )
    .returning({ id: paidActivities.id })
  return rows.length === 1
}

// --- Katılım -------------------------------------------------------------------------------------

export interface StoredParticipant {
  id: string
  activityId: string
  studentId: string
  studentName: string | null
  invoiceId: string
  feeCents: number
  joinedDate: string
  status: ParticipationStatus
  cancelKind: ParticipationCancelKind | null
  cancelledDate: string | null
  paidCents: number | null
  retainedCents: number | null
  refundCents: number
  closedInvoiceId: string | null
  debtInvoiceId: string | null
  refundPaidDate: string | null
  refundIban: string | null
  refundAccountHolder: string | null
  refundBankAccountId: string | null
  refundBankAccountLabel: string | null
  version: number
}

const PARTICIPANT_COLUMNS = {
  id: paidActivityParticipants.id,
  activityId: paidActivityParticipants.activityId,
  studentId: paidActivityParticipants.studentId,
  studentName,
  invoiceId: paidActivityParticipants.invoiceId,
  feeCents: paidActivityParticipants.feeCents,
  joinedDate: paidActivityParticipants.joinedDate,
  status: sql<ParticipationStatus>`${paidActivityParticipants.status}`,
  cancelKind: sql<ParticipationCancelKind | null>`${paidActivityParticipants.cancelKind}`,
  cancelledDate: paidActivityParticipants.cancelledDate,
  paidCents: paidActivityParticipants.paidCents,
  retainedCents: paidActivityParticipants.retainedCents,
  refundCents: paidActivityParticipants.refundCents,
  closedInvoiceId: paidActivityParticipants.closedInvoiceId,
  debtInvoiceId: paidActivityParticipants.debtInvoiceId,
  refundPaidDate: paidActivityParticipants.refundPaidDate,
  refundIban: paidActivityParticipants.refundIban,
  refundAccountHolder: paidActivityParticipants.refundAccountHolder,
  refundBankAccountId: paidActivityParticipants.refundBankAccountId,
  bankName: bankAccounts.bankName,
  bankIban: bankAccounts.iban,
  version: paidActivityParticipants.version,
}

type ParticipantRow = Omit<StoredParticipant, 'refundBankAccountLabel'> & {
  bankName: string | null
  bankIban: string | null
}
const toParticipant = ({ bankName, bankIban, ...row }: ParticipantRow): StoredParticipant => ({
  ...row,
  refundBankAccountLabel: labelOf(bankName, bankIban),
})

export type ParticipantQuery = {
  status?: ParticipationStatus | undefined
  refundStatus?: 'none' | 'pending' | 'paid' | undefined
  page: number
  pageSize: number
}

function participantFilter(
  institutionId: string,
  activityId: string,
  query: ParticipantQuery,
): SQL | undefined {
  const refund =
    query.refundStatus === 'paid'
      ? sql`${paidActivityParticipants.refundPaidDate} is not null`
      : query.refundStatus === 'pending'
        ? sql`${paidActivityParticipants.refundPaidDate} is null and ${paidActivityParticipants.refundCents} > 0`
        : query.refundStatus === 'none'
          ? eq(paidActivityParticipants.refundCents, 0)
          : undefined
  return and(
    liveParticipant(institutionId),
    eq(paidActivityParticipants.activityId, activityId),
    query.status === undefined ? undefined : eq(paidActivityParticipants.status, query.status),
    refund,
  )
}

export async function listParticipants(
  db: Database,
  institutionId: string,
  activityId: string,
  query: ParticipantQuery,
): Promise<{ items: StoredParticipant[]; total: number }> {
  const where = participantFilter(institutionId, activityId, query)
  const [totalRow] = await db.select({ total: count() }).from(paidActivityParticipants).where(where)
  const rows = await db
    .select(PARTICIPANT_COLUMNS)
    .from(paidActivityParticipants)
    .leftJoin(records, STUDENT_JOIN)
    .leftJoin(bankAccounts, BANK_JOIN)
    .where(where)
    .orderBy(
      asc(paidActivityParticipants.status),
      asc(studentName),
      asc(paidActivityParticipants.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toParticipant), total: totalRow?.total ?? 0 }
}

export async function findParticipant(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredParticipant | null> {
  const [row] = await db
    .select(PARTICIPANT_COLUMNS)
    .from(paidActivityParticipants)
    .leftJoin(records, STUDENT_JOIN)
    .leftJoin(bankAccounts, BANK_JOIN)
    .where(and(liveParticipant(institutionId), eq(paidActivityParticipants.id, id)))
    .limit(1)
  return row ? toParticipant(row) : null
}

/** Etkinliğin iptal edilmemiş katılımları (kontenjan, mükerrer katılım ve kurum iptali). */
export async function activeParticipants(
  db: Database,
  institutionId: string,
  activityId: string,
): Promise<{ id: string; studentId: string; invoiceId: string; feeCents: number }[]> {
  return db
    .select({
      id: paidActivityParticipants.id,
      studentId: paidActivityParticipants.studentId,
      invoiceId: paidActivityParticipants.invoiceId,
      feeCents: paidActivityParticipants.feeCents,
    })
    .from(paidActivityParticipants)
    .where(
      and(
        liveParticipant(institutionId),
        eq(paidActivityParticipants.activityId, activityId),
        eq(paidActivityParticipants.status, 'active'),
      ),
    )
    .orderBy(asc(paidActivityParticipants.id))
}

export async function insertParticipant(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    activityId: string
    studentId: string
    invoiceId: string
    feeCents: number
    joinedDate: string
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...row } = input
  await tx
    .insert(paidActivityParticipants)
    .values({ institutionId, ...row, createdAt: now, updatedAt: now })
}

/** Yalnız iptal edilmemiş katılım (ve verilirse beklenen sürüm) iptal edilir; tutmazsa `false`. */
export async function markParticipantCancelled(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number | null
    cancelKind: ParticipationCancelKind
    cancelledDate: string
    paidCents: number
    retainedCents: number
    refundCents: number
    closedInvoiceId: string | null
    debtInvoiceId: string | null
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(paidActivityParticipants)
    .set({
      status: 'cancelled',
      cancelKind: input.cancelKind,
      cancelledDate: input.cancelledDate,
      paidCents: input.paidCents,
      retainedCents: input.retainedCents,
      refundCents: input.refundCents,
      closedInvoiceId: input.closedInvoiceId,
      debtInvoiceId: input.debtInvoiceId,
      cancelledByUserId: input.userId,
      version: sql`${paidActivityParticipants.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        liveParticipant(institutionId),
        eq(paidActivityParticipants.id, input.id),
        eq(paidActivityParticipants.status, 'active'),
        input.expectedVersion === null
          ? undefined
          : eq(paidActivityParticipants.version, input.expectedVersion),
      ),
    )
    .returning({ id: paidActivityParticipants.id })
  return rows.length === 1
}

/** Yalnız ödenmemiş iade ve beklenen sürüm güncellenir; tutmazsa `false`. */
export async function markParticipantRefundPaid(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    paidDate: string
    iban: string
    accountHolder: string
    bankAccountId: string
    paidByUserId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(paidActivityParticipants)
    .set({
      refundPaidDate: input.paidDate,
      refundIban: input.iban,
      refundAccountHolder: input.accountHolder,
      refundBankAccountId: input.bankAccountId,
      refundPaidByUserId: input.paidByUserId,
      version: sql`${paidActivityParticipants.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        liveParticipant(institutionId),
        eq(paidActivityParticipants.id, input.id),
        eq(paidActivityParticipants.version, input.expectedVersion),
        isNull(paidActivityParticipants.refundPaidDate),
        sql`${paidActivityParticipants.refundCents} > 0`,
      ),
    )
    .returning({ id: paidActivityParticipants.id })
  return rows.length === 1
}

// --- Ödeme durumu --------------------------------------------------------------------------------

export interface InvoicePayment {
  amountCents: number
  paidCents: number
  /** Taksit kapanmış (iptalle listeden düşmüş) mı. */
  closed: boolean
}

/**
 * Taksitlerin tutarı ve alınan kısmı: tam ödenmişte tutar, değilse iptal edilmemiş tahsilatların
 * dağılım toplamı (en çok tutar). Arşivlenmiş (kapanmış) taksit de okunur.
 */
export async function invoicePayments(
  db: Database,
  institutionId: string,
  invoiceIds: readonly string[],
): Promise<Map<string, InvoicePayment>> {
  if (invoiceIds.length === 0) return new Map()
  const ids = [...new Set(invoiceIds)]
  const [rows, allocations] = await Promise.all([
    db
      .select({
        id: invoices.id,
        amountCents: invoices.amountCents,
        paidAt: invoices.paidAt,
        archivedAt: invoices.archivedAt,
      })
      .from(invoices)
      .where(and(eq(invoices.institutionId, institutionId), inArray(invoices.id, ids))),
    db
      .select({
        invoiceId: paymentAllocations.invoiceId,
        total: sql<string>`sum(${paymentAllocations.amountCents})`,
      })
      .from(paymentAllocations)
      .innerJoin(
        payments,
        and(
          eq(payments.institutionId, paymentAllocations.institutionId),
          eq(payments.id, paymentAllocations.paymentId),
        ),
      )
      .where(
        and(
          eq(paymentAllocations.institutionId, institutionId),
          inArray(paymentAllocations.invoiceId, ids),
          isNull(payments.reversedAt),
        ),
      )
      .groupBy(paymentAllocations.invoiceId),
  ])
  const allocated = new Map(allocations.map((row) => [row.invoiceId, Number(row.total)]))
  return new Map(
    rows.map((row) => [
      row.id,
      {
        amountCents: row.amountCents,
        paidCents:
          row.paidAt !== null
            ? row.amountCents
            : Math.min(row.amountCents, allocated.get(row.id) ?? 0),
        closed: row.archivedAt !== null,
      },
    ]),
  )
}

/**
 * Öğrencinin iptal edilmiş katılımlarının taksitleri: iade ya da kesinti bu taksite alınmış
 * tahsilata dayanır, tahsilat iptali reddedilir (K-302).
 */
export async function cancelledActivityInvoiceIds(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ invoiceId: paidActivityParticipants.invoiceId })
    .from(paidActivityParticipants)
    .where(
      and(
        liveParticipant(institutionId),
        eq(paidActivityParticipants.studentId, studentId),
        eq(paidActivityParticipants.status, 'cancelled'),
      ),
    )
  return new Set(rows.map((row) => row.invoiceId))
}

/** O gün ödenen katılım iadeleri (gün sonu, M-13); IBAN ve hesap sahibi seçilmez. */
export async function paidActivityRefundsPaidOnDay(
  db: Database,
  institutionId: string,
  day: string,
): Promise<StoredDayRefund[]> {
  const rows = await db
    .select({
      id: paidActivityParticipants.id,
      studentName,
      amountCents: paidActivityParticipants.refundCents,
      bankName: bankAccounts.bankName,
      bankIban: bankAccounts.iban,
    })
    .from(paidActivityParticipants)
    .leftJoin(records, STUDENT_JOIN)
    .leftJoin(bankAccounts, BANK_JOIN)
    .where(and(liveParticipant(institutionId), eq(paidActivityParticipants.refundPaidDate, day)))
    .orderBy(asc(paidActivityParticipants.updatedAt), asc(paidActivityParticipants.id))
  return rows.map(({ id, bankName, bankIban, ...row }) => ({
    ...row,
    withdrawalId: null,
    freeTuitionAwardId: null,
    paidActivityParticipantId: id,
    paidDate: day,
    bankAccountLabel: labelOf(bankName, bankIban),
  }))
}

/** Ayrılış hesabına giren katılım (ON-342, K-348): etkinlik koşullarıyla birlikte. */
export interface WithdrawalParticipationRow {
  id: string
  activityId: string
  studentId: string
  name: string
  status: ParticipationStatus
  invoiceId: string
  feeCents: number
  debtInvoiceId: string | null
  activityDate: string
  cancelDeadline: string
  lateRefundRule: LateRefundRule
  lateRefundPercent: number | null
  lateCostCents: number | null
  activityFeeCents: number
}

/**
 * Öğrencinin ayrılışta değerlendirilen katılımları: iptal edilmemişler ve kesinti taksiti olan
 * iptal edilmişler (K-348). Etkinlik günü ve iade koşulları etkinlikten okunur.
 */
export async function withdrawalParticipations(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<WithdrawalParticipationRow[]> {
  return db
    .select({
      id: paidActivityParticipants.id,
      activityId: paidActivityParticipants.activityId,
      studentId: paidActivityParticipants.studentId,
      name: paidActivities.name,
      status: sql<ParticipationStatus>`${paidActivityParticipants.status}`,
      invoiceId: paidActivityParticipants.invoiceId,
      feeCents: paidActivityParticipants.feeCents,
      debtInvoiceId: paidActivityParticipants.debtInvoiceId,
      activityDate: paidActivities.activityDate,
      cancelDeadline: paidActivities.cancelDeadline,
      lateRefundRule: sql<LateRefundRule>`${paidActivities.lateRefundRule}`,
      lateRefundPercent: paidActivities.lateRefundPercent,
      lateCostCents: paidActivities.lateCostCents,
      activityFeeCents: paidActivities.feeCents,
    })
    .from(paidActivityParticipants)
    .innerJoin(
      paidActivities,
      and(
        eq(paidActivities.institutionId, paidActivityParticipants.institutionId),
        eq(paidActivities.id, paidActivityParticipants.activityId),
      ),
    )
    .where(
      and(
        liveParticipant(institutionId),
        eq(paidActivityParticipants.studentId, studentId),
        sql`(${paidActivityParticipants.status} = 'active' or ${paidActivityParticipants.debtInvoiceId} is not null)`,
      ),
    )
    .orderBy(asc(paidActivities.activityDate), asc(paidActivityParticipants.id))
}
