import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm'

import type {
  ConsentChannel,
  ConsentStatus,
  JoinedStatus,
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
const studentClassId = sql<string | null>`${records.data} ->> 'classId'`
const studentParentId = sql<string | null>`${records.data} ->> 'parentId'`
/** Yer tutan katılım: asil ve izin bekleyen (K-369). */
const SEAT_SQL = sql`${paidActivityParticipants.status} in ('active', 'awaiting_consent')`
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
  requiresConsent: boolean
  permissionFormId: string | null
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
  requiresConsent: paidActivities.requiresConsent,
  permissionFormId: paidActivities.permissionFormId,
  status: sql<PaidActivityStatus>`${paidActivities.status}`,
  cancelledAt: paidActivities.cancelledAt,
  cancelReason: paidActivities.cancelReason,
  version: paidActivities.version,
}

export interface ActivityCounts {
  /** Yer tutan katılım (asil ve izin bekleyen). */
  participantCount: number
  awaitingConsentCount: number
  waitlistCount: number
  pendingRefundCount: number
}

/** Etkinlik başına yer tutan, izin bekleyen, yedek katılım ve ödenmemiş iade sayısı. */
export async function activityCounts(
  db: Database,
  institutionId: string,
  activityIds: readonly string[],
): Promise<Map<string, ActivityCounts>> {
  if (activityIds.length === 0) return new Map()
  const rows = await db
    .select({
      activityId: paidActivityParticipants.activityId,
      participantCount: sql<number>`count(*) filter (where ${SEAT_SQL})::int`,
      awaitingConsentCount: sql<number>`count(*) filter (where ${paidActivityParticipants.status} = 'awaiting_consent')::int`,
      waitlistCount: sql<number>`count(*) filter (where ${paidActivityParticipants.status} = 'waitlisted')::int`,
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
  return new Map(rows.map(({ activityId, ...counts }) => [activityId, counts]))
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
    requiresConsent: boolean
    permissionFormId: string | null
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
    permissionFormId: string | null
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
      permissionFormId: input.permissionFormId,
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
  /** Öğrencinin sınıfı (`records` `students.classId`). */
  classId: string | null
  invoiceId: string | null
  feeCents: number
  joinedDate: string
  status: ParticipationStatus
  waitlistPosition: number | null
  promotedAt: Date | null
  consentStatus: ConsentStatus
  consentChannel: ConsentChannel | null
  consentGrantorName: string | null
  consentAt: Date | null
  consentWithdrawnAt: Date | null
  consentWithdrawalChannel: ConsentChannel | null
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
  classId: studentClassId,
  invoiceId: paidActivityParticipants.invoiceId,
  feeCents: paidActivityParticipants.feeCents,
  joinedDate: paidActivityParticipants.joinedDate,
  status: sql<ParticipationStatus>`${paidActivityParticipants.status}`,
  waitlistPosition: paidActivityParticipants.waitlistPosition,
  promotedAt: paidActivityParticipants.promotedAt,
  consentStatus: sql<ConsentStatus>`${paidActivityParticipants.consentStatus}`,
  consentChannel: sql<ConsentChannel | null>`${paidActivityParticipants.consentChannel}`,
  consentGrantorName: paidActivityParticipants.consentGrantorName,
  consentAt: paidActivityParticipants.consentAt,
  consentWithdrawnAt: paidActivityParticipants.consentWithdrawnAt,
  consentWithdrawalChannel: sql<ConsentChannel | null>`${paidActivityParticipants.consentWithdrawalChannel}`,
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
  consentStatus?: ConsentStatus | undefined
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
    query.consentStatus === undefined
      ? undefined
      : eq(paidActivityParticipants.consentStatus, query.consentStatus),
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
    // Asiller (izin bekleyenler dahil) ada göre, sonra yedekler sıralarına göre, en son iptaller.
    .orderBy(
      sql`case ${paidActivityParticipants.status} when 'waitlisted' then 1 when 'cancelled' then 2 else 0 end`,
      sql`case when ${paidActivityParticipants.status} = 'waitlisted' then ${paidActivityParticipants.waitlistPosition} end nulls first`,
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

/** Etkinliğin asil (taksiti açık) katılımları; taksit kimliği her zaman doludur. */
export async function activeParticipants(
  db: Database,
  institutionId: string,
  activityId: string,
): Promise<{ id: string; studentId: string; invoiceId: string; feeCents: number }[]> {
  const rows = await db
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
        isNotNull(paidActivityParticipants.invoiceId),
      ),
    )
    .orderBy(asc(paidActivityParticipants.id))
  return rows.flatMap(({ invoiceId, ...row }) =>
    invoiceId === null ? [] : [{ ...row, invoiceId }],
  )
}

export interface OpenParticipant {
  id: string
  studentId: string
  invoiceId: string | null
  feeCents: number
  status: JoinedStatus
  waitlistPosition: number | null
  consentStatus: ConsentStatus
  consentChannel: ConsentChannel | null
  version: number
}

/**
 * Etkinliğin iptal edilmemiş (asil, izin bekleyen, yedek) katılımları: kontenjan, mükerrer
 * katılım, yedekten geçiş, izin eşitlemesi ve kurum iptali (K-369, K-370).
 */
export async function openParticipants(
  db: Database,
  institutionId: string,
  activityId: string,
): Promise<OpenParticipant[]> {
  return db
    .select({
      id: paidActivityParticipants.id,
      studentId: paidActivityParticipants.studentId,
      invoiceId: paidActivityParticipants.invoiceId,
      feeCents: paidActivityParticipants.feeCents,
      status: sql<JoinedStatus>`${paidActivityParticipants.status}`,
      waitlistPosition: paidActivityParticipants.waitlistPosition,
      consentStatus: sql<ConsentStatus>`${paidActivityParticipants.consentStatus}`,
      consentChannel: sql<ConsentChannel | null>`${paidActivityParticipants.consentChannel}`,
      version: paidActivityParticipants.version,
    })
    .from(paidActivityParticipants)
    .where(
      and(
        liveParticipant(institutionId),
        eq(paidActivityParticipants.activityId, activityId),
        ne(paidActivityParticipants.status, 'cancelled'),
      ),
    )
    .orderBy(asc(paidActivityParticipants.id))
}

/** Etkinlikte verilmiş en büyük yedek numarası (iptal ve geçiş dahil; numara yeniden kullanılmaz). */
export async function maxWaitlistPosition(
  db: Database,
  institutionId: string,
  activityId: string,
): Promise<number> {
  const [row] = await db
    .select({
      max: sql<number>`coalesce(max(${paidActivityParticipants.waitlistPosition}), 0)::int`,
    })
    .from(paidActivityParticipants)
    .where(and(liveParticipant(institutionId), eq(paidActivityParticipants.activityId, activityId)))
  return row?.max ?? 0
}

/** Katılım listesinin (PDF ve CSV) satırları: iptal edilmemiş katılımlar, sınıf ve veli kimliğiyle. */
export async function rosterParticipants(
  db: Database,
  institutionId: string,
  activityId: string,
): Promise<(StoredParticipant & { parentId: string | null })[]> {
  const rows = await db
    .select({ ...PARTICIPANT_COLUMNS, parentId: studentParentId })
    .from(paidActivityParticipants)
    .leftJoin(records, STUDENT_JOIN)
    .leftJoin(bankAccounts, BANK_JOIN)
    .where(
      and(
        liveParticipant(institutionId),
        eq(paidActivityParticipants.activityId, activityId),
        ne(paidActivityParticipants.status, 'cancelled'),
      ),
    )
  return rows.map(({ parentId, ...row }) => ({ ...toParticipant(row), parentId }))
}

export async function insertParticipant(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    activityId: string
    studentId: string
    invoiceId: string | null
    feeCents: number
    joinedDate: string
    status: JoinedStatus
    waitlistPosition: number | null
    consentStatus: ConsentStatus
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...row } = input
  await tx
    .insert(paidActivityParticipants)
    .values({ institutionId, ...row, createdAt: now, updatedAt: now })
}

/**
 * Yalnız iptal edilmemiş katılım (ve verilirse beklenen sürüm) iptal edilir; tutmazsa `false`.
 * İznin geri çekilmesinde (`withdrawal`) izin durumu da aynı satırda `withdrawn` olur (K-370).
 */
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
    withdrawal?: { channel: ConsentChannel }
  },
): Promise<boolean> {
  const rows = await tx
    .update(paidActivityParticipants)
    .set({
      ...(input.withdrawal === undefined
        ? {}
        : {
            consentStatus: 'withdrawn',
            consentWithdrawnAt: input.now,
            consentWithdrawalChannel: input.withdrawal.channel,
          }),
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
        ne(paidActivityParticipants.status, 'cancelled'),
        input.expectedVersion === null
          ? undefined
          : eq(paidActivityParticipants.version, input.expectedVersion),
      ),
    )
    .returning({ id: paidActivityParticipants.id })
  return rows.length === 1
}

/** Yedeği asile geçirir (K-369); yalnız yedek satır güncellenir, tutmazsa `false`. */
export async function markParticipantPromoted(
  tx: Database,
  institutionId: string,
  input: { id: string; status: 'active' | 'awaiting_consent'; invoiceId: string | null; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(paidActivityParticipants)
    .set({
      status: input.status,
      invoiceId: input.invoiceId,
      promotedAt: input.now,
      version: sql`${paidActivityParticipants.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        liveParticipant(institutionId),
        eq(paidActivityParticipants.id, input.id),
        eq(paidActivityParticipants.status, 'waitlisted'),
      ),
    )
    .returning({ id: paidActivityParticipants.id })
  return rows.length === 1
}

/**
 * Veli iznini kaydeder (K-370); izin bekleyen asil asil olur ve taksiti yazılır. Yalnız izni bekleyen
 * iptal edilmemiş satır (ve verilirse beklenen sürüm) güncellenir; tutmazsa `false`.
 */
export async function markParticipantConsentGranted(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number | null
    status: JoinedStatus
    invoiceId: string | null
    channel: ConsentChannel
    grantorName: string | null
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(paidActivityParticipants)
    .set({
      status: input.status,
      ...(input.invoiceId === null ? {} : { invoiceId: input.invoiceId }),
      consentStatus: 'granted',
      consentChannel: input.channel,
      consentGrantorName: input.grantorName,
      consentAt: input.now,
      consentRecordedByUserId: input.userId,
      version: sql`${paidActivityParticipants.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        liveParticipant(institutionId),
        eq(paidActivityParticipants.id, input.id),
        ne(paidActivityParticipants.status, 'cancelled'),
        eq(paidActivityParticipants.consentStatus, 'pending'),
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
        isNotNull(paidActivityParticipants.invoiceId),
      ),
    )
  return new Set(rows.flatMap((row) => (row.invoiceId === null ? [] : [row.invoiceId])))
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
      // Asil ya da borçlu katılımın taksiti vardır; yedek ve izin bekleyen sorguya girmez.
      invoiceId: sql<string>`${paidActivityParticipants.invoiceId}`,
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
        isNotNull(paidActivityParticipants.invoiceId),
      ),
    )
    .orderBy(asc(paidActivities.activityDate), asc(paidActivityParticipants.id))
}
