import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'

import type {
  FreeTuitionDocument,
  FreeTuitionReason,
  FreeTuitionStatus,
} from '@kampus/school-core/lib/finance-free-tuition.ts'
import { bankAccountLabel } from '@kampus/school-core/lib/payments.ts'

import type { Database } from './client.ts'
import {
  freeTuitionApplications,
  freeTuitionAwards,
  freeTuitionBoardMeetings,
  freeTuitionRounds,
  type FreeTuitionBoardDecision,
  type FreeTuitionBoardMember,
} from './schema/finance-free-tuition.ts'
import { bankAccounts } from './schema/payments.ts'
import { records } from './schema/records.ts'
import type { StoredDayRefund } from './withdrawals.ts'

/**
 * Ücretsiz okutma deposu (DOM-FIN-026): dönem, aday, kurul toplantısı ve hak. Her sorgu kurum
 * kapsamlıdır; öğrenci adı `records`'tan kurum eşleşmesiyle okunur. IBAN ve gerekçe loglanmaz.
 */

/** Öğrencinin `records` kaydı: yalnız ad içindir; kurum eşleşmesi zorunludur. */
const APPLICATION_STUDENT_JOIN = and(
  eq(records.institutionId, freeTuitionApplications.institutionId),
  eq(records.collection, 'students'),
  eq(records.id, freeTuitionApplications.studentId),
)
const AWARD_STUDENT_JOIN = and(
  eq(records.institutionId, freeTuitionAwards.institutionId),
  eq(records.collection, 'students'),
  eq(records.id, freeTuitionAwards.studentId),
)
const studentName = sql<string | null>`${records.data} ->> 'name'`

export interface StoredFreeTuitionRound {
  id: string
  academicYear: number
  teachingStartDate: string
  studentCount: number | null
  computedQuota: number | null
  confirmedQuota: number | null
  quotaConfirmedAt: Date | null
  version: number
}

const ROUND_COLUMNS = {
  id: freeTuitionRounds.id,
  academicYear: freeTuitionRounds.academicYear,
  teachingStartDate: freeTuitionRounds.teachingStartDate,
  studentCount: freeTuitionRounds.studentCount,
  computedQuota: freeTuitionRounds.computedQuota,
  confirmedQuota: freeTuitionRounds.confirmedQuota,
  quotaConfirmedAt: freeTuitionRounds.quotaConfirmedAt,
  version: freeTuitionRounds.version,
}

const activeRound = (institutionId: string) =>
  and(eq(freeTuitionRounds.institutionId, institutionId), isNull(freeTuitionRounds.archivedAt))
const activeApplication = (institutionId: string) =>
  and(
    eq(freeTuitionApplications.institutionId, institutionId),
    isNull(freeTuitionApplications.archivedAt),
  )
const activeAward = (institutionId: string) =>
  and(eq(freeTuitionAwards.institutionId, institutionId), isNull(freeTuitionAwards.archivedAt))

/** Kurumda etkin öğrenci sayısı: kontenjanın tabanı (DOM-FIN-026). */
export async function countActiveStudents(db: Database, institutionId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'students'),
        isNull(records.archivedAt),
        sql`coalesce(${records.data} ->> 'isActive', 'true') <> 'false'`,
      ),
    )
  return row?.total ?? 0
}

export async function listFreeTuitionRounds(
  db: Database,
  institutionId: string,
): Promise<(StoredFreeTuitionRound & { applicationCount: number; acceptedCount: number })[]> {
  const rows = await db
    .select(ROUND_COLUMNS)
    .from(freeTuitionRounds)
    .where(activeRound(institutionId))
    .orderBy(desc(freeTuitionRounds.academicYear))
  const counts = await db
    .select({
      roundId: freeTuitionApplications.roundId,
      total: count(),
      accepted: sql<number>`count(*) filter (where ${freeTuitionApplications.status} = 'accepted')::int`,
    })
    .from(freeTuitionApplications)
    .where(activeApplication(institutionId))
    .groupBy(freeTuitionApplications.roundId)
  const byRound = new Map(counts.map((row) => [row.roundId, row]))
  return rows.map((row) => ({
    ...row,
    applicationCount: byRound.get(row.id)?.total ?? 0,
    acceptedCount: byRound.get(row.id)?.accepted ?? 0,
  }))
}

export async function findFreeTuitionRound(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredFreeTuitionRound | null> {
  const [row] = await db
    .select(ROUND_COLUMNS)
    .from(freeTuitionRounds)
    .where(and(activeRound(institutionId), eq(freeTuitionRounds.id, id)))
    .limit(1)
  return row ?? null
}

export async function freeTuitionRoundYears(db: Database, institutionId: string) {
  const rows = await db
    .select({ academicYear: freeTuitionRounds.academicYear })
    .from(freeTuitionRounds)
    .where(activeRound(institutionId))
  return rows.map((row) => row.academicYear)
}

export async function insertFreeTuitionRound(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    academicYear: number
    teachingStartDate: string
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...round } = input
  await tx
    .insert(freeTuitionRounds)
    .values({ institutionId, ...round, createdAt: now, updatedAt: now })
}

/** Kontenjanı kesinleştirir; sürüm tutmazsa `false` (409). */
export async function setFreeTuitionQuota(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    studentCount: number
    computedQuota: number
    confirmedQuota: number
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(freeTuitionRounds)
    .set({
      studentCount: input.studentCount,
      computedQuota: input.computedQuota,
      confirmedQuota: input.confirmedQuota,
      quotaConfirmedByUserId: input.userId,
      quotaConfirmedAt: input.now,
      version: sql`${freeTuitionRounds.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        activeRound(institutionId),
        eq(freeTuitionRounds.id, input.id),
        eq(freeTuitionRounds.version, input.expectedVersion),
      ),
    )
    .returning({ id: freeTuitionRounds.id })
  return rows.length === 1
}

export interface StoredFreeTuitionApplication {
  id: string
  roundId: string
  studentId: string
  studentName: string | null
  reason: FreeTuitionReason
  documents: FreeTuitionDocument[]
  status: FreeTuitionStatus
  boardMeetingId: string | null
  version: number
}

const APPLICATION_COLUMNS = {
  id: freeTuitionApplications.id,
  roundId: freeTuitionApplications.roundId,
  studentId: freeTuitionApplications.studentId,
  studentName,
  reason: freeTuitionApplications.reason,
  documents: freeTuitionApplications.documents,
  status: freeTuitionApplications.status,
  boardMeetingId: freeTuitionApplications.boardMeetingId,
  version: freeTuitionApplications.version,
}

// Kolonların değerleri veritabanı `check` kısıtıyla sabit listededir.
const asApplication = (row: {
  reason: string
  documents: string[]
  status: string
}): Pick<StoredFreeTuitionApplication, 'reason' | 'documents' | 'status'> => ({
  reason: row.reason as FreeTuitionReason,
  documents: row.documents as FreeTuitionDocument[],
  status: row.status as FreeTuitionStatus,
})

export async function listFreeTuitionApplications(
  db: Database,
  institutionId: string,
  query: {
    roundId: string
    status?: FreeTuitionStatus | undefined
    page: number
    pageSize: number
  },
): Promise<{ items: StoredFreeTuitionApplication[]; total: number }> {
  const where = and(
    activeApplication(institutionId),
    eq(freeTuitionApplications.roundId, query.roundId),
    query.status === undefined ? undefined : eq(freeTuitionApplications.status, query.status),
  )
  const [totalRow] = await db.select({ total: count() }).from(freeTuitionApplications).where(where)
  const rows = await db
    .select(APPLICATION_COLUMNS)
    .from(freeTuitionApplications)
    .leftJoin(records, APPLICATION_STUDENT_JOIN)
    .where(where)
    .orderBy(asc(freeTuitionApplications.createdAt), asc(freeTuitionApplications.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map((row) => ({ ...row, ...asApplication(row) })),
    total: totalRow?.total ?? 0,
  }
}

export async function findFreeTuitionApplication(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredFreeTuitionApplication | null> {
  const [row] = await db
    .select(APPLICATION_COLUMNS)
    .from(freeTuitionApplications)
    .leftJoin(records, APPLICATION_STUDENT_JOIN)
    .where(and(activeApplication(institutionId), eq(freeTuitionApplications.id, id)))
    .limit(1)
  return row ? { ...row, ...asApplication(row) } : null
}

/** Dönemin bütün adayları, kurul kararı denetimi için (kurum kilidi altında). */
export async function roundFreeTuitionApplications(
  db: Database,
  institutionId: string,
  roundId: string,
): Promise<{ id: string; studentId: string; status: FreeTuitionStatus }[]> {
  const rows = await db
    .select({
      id: freeTuitionApplications.id,
      studentId: freeTuitionApplications.studentId,
      status: freeTuitionApplications.status,
    })
    .from(freeTuitionApplications)
    .where(and(activeApplication(institutionId), eq(freeTuitionApplications.roundId, roundId)))
  return rows.map((row) => ({ ...row, status: row.status as FreeTuitionStatus }))
}

export async function insertFreeTuitionApplication(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    roundId: string
    studentId: string
    reason: FreeTuitionReason
    documents: FreeTuitionDocument[]
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...application } = input
  await tx
    .insert(freeTuitionApplications)
    .values({ institutionId, ...application, createdAt: now, updatedAt: now })
}

export async function setFreeTuitionDocuments(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; documents: FreeTuitionDocument[]; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(freeTuitionApplications)
    .set({
      documents: input.documents,
      version: sql`${freeTuitionApplications.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        activeApplication(institutionId),
        eq(freeTuitionApplications.id, input.id),
        eq(freeTuitionApplications.version, input.expectedVersion),
      ),
    )
    .returning({ id: freeTuitionApplications.id })
  return rows.length === 1
}

/** Kurul kararını adaya yazar; yalnız değerlendirilmemiş ya da yedek adayda (kilit altında). */
export async function setFreeTuitionDecision(
  tx: Database,
  institutionId: string,
  input: { id: string; status: FreeTuitionStatus; boardMeetingId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(freeTuitionApplications)
    .set({
      status: input.status,
      boardMeetingId: input.boardMeetingId,
      version: sql`${freeTuitionApplications.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        activeApplication(institutionId),
        eq(freeTuitionApplications.id, input.id),
        inArray(freeTuitionApplications.status, ['pending', 'reserve']),
      ),
    )
    .returning({ id: freeTuitionApplications.id })
  return rows.length === 1
}

export interface StoredFreeTuitionMeeting {
  id: string
  roundId: string
  meetingDate: string
  members: FreeTuitionBoardMember[]
  decisions: FreeTuitionBoardDecision[]
}

const MEETING_COLUMNS = {
  id: freeTuitionBoardMeetings.id,
  roundId: freeTuitionBoardMeetings.roundId,
  meetingDate: freeTuitionBoardMeetings.meetingDate,
  members: freeTuitionBoardMeetings.members,
  decisions: freeTuitionBoardMeetings.decisions,
}

export async function insertFreeTuitionMeeting(
  tx: Database,
  institutionId: string,
  input: Omit<StoredFreeTuitionMeeting, never> & { recordedByUserId: string; now: Date },
): Promise<void> {
  const { now, ...meeting } = input
  await tx
    .insert(freeTuitionBoardMeetings)
    .values({ institutionId, ...meeting, createdAt: now, updatedAt: now })
}

export async function listFreeTuitionMeetings(
  db: Database,
  institutionId: string,
  roundId: string,
): Promise<StoredFreeTuitionMeeting[]> {
  return db
    .select(MEETING_COLUMNS)
    .from(freeTuitionBoardMeetings)
    .where(
      and(
        eq(freeTuitionBoardMeetings.institutionId, institutionId),
        isNull(freeTuitionBoardMeetings.archivedAt),
        eq(freeTuitionBoardMeetings.roundId, roundId),
      ),
    )
    .orderBy(desc(freeTuitionBoardMeetings.meetingDate), desc(freeTuitionBoardMeetings.createdAt))
}

export async function findFreeTuitionMeeting(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredFreeTuitionMeeting | null> {
  const [row] = await db
    .select(MEETING_COLUMNS)
    .from(freeTuitionBoardMeetings)
    .where(
      and(
        eq(freeTuitionBoardMeetings.institutionId, institutionId),
        isNull(freeTuitionBoardMeetings.archivedAt),
        eq(freeTuitionBoardMeetings.id, id),
      ),
    )
    .limit(1)
  return row ?? null
}

/** Tutanak satırları için adayların adı ve gerekçesi (kurum kapsamlı). */
export async function freeTuitionApplicationsById(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<Map<string, StoredFreeTuitionApplication>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select(APPLICATION_COLUMNS)
    .from(freeTuitionApplications)
    .leftJoin(records, APPLICATION_STUDENT_JOIN)
    .where(and(activeApplication(institutionId), inArray(freeTuitionApplications.id, [...ids])))
  return new Map(rows.map((row) => [row.id, { ...row, ...asApplication(row) }]))
}

export interface StoredFreeTuitionAward {
  id: string
  roundId: string
  applicationId: string
  boardMeetingId: string
  studentId: string
  studentName: string | null
  academicYear: number
  acceptedDate: string
  contractId: string
  contractIds: string[]
  cancelledInvoiceIds: string[]
  refundedInvoiceIds: string[]
  waivedCents: number
  refundCents: number
  refundDueDate: string
  refundPaidDate: string | null
  refundIban: string | null
  refundAccountHolder: string | null
  refundBankAccountId: string | null
  refundBankAccountLabel: string | null
  mebbisRecordedDate: string | null
  version: number
}

const AWARD_BANK_JOIN = and(
  eq(bankAccounts.institutionId, freeTuitionAwards.institutionId),
  eq(bankAccounts.id, freeTuitionAwards.refundBankAccountId),
)

const AWARD_COLUMNS = {
  id: freeTuitionAwards.id,
  roundId: freeTuitionAwards.roundId,
  applicationId: freeTuitionAwards.applicationId,
  boardMeetingId: freeTuitionAwards.boardMeetingId,
  studentId: freeTuitionAwards.studentId,
  studentName,
  academicYear: freeTuitionAwards.academicYear,
  acceptedDate: freeTuitionAwards.acceptedDate,
  contractId: freeTuitionAwards.contractId,
  contractIds: freeTuitionAwards.contractIds,
  cancelledInvoiceIds: freeTuitionAwards.cancelledInvoiceIds,
  refundedInvoiceIds: freeTuitionAwards.refundedInvoiceIds,
  waivedCents: freeTuitionAwards.waivedCents,
  refundCents: freeTuitionAwards.refundCents,
  refundDueDate: freeTuitionAwards.refundDueDate,
  refundPaidDate: freeTuitionAwards.refundPaidDate,
  refundIban: freeTuitionAwards.refundIban,
  refundAccountHolder: freeTuitionAwards.refundAccountHolder,
  refundBankAccountId: freeTuitionAwards.refundBankAccountId,
  bankName: bankAccounts.bankName,
  bankIban: bankAccounts.iban,
  mebbisRecordedDate: freeTuitionAwards.mebbisRecordedDate,
  version: freeTuitionAwards.version,
}

type AwardRow = Omit<StoredFreeTuitionAward, 'refundBankAccountLabel'> & {
  bankName: string | null
  bankIban: string | null
}

const toAward = ({ bankName, bankIban, ...row }: AwardRow): StoredFreeTuitionAward => ({
  ...row,
  refundBankAccountLabel:
    bankName === null || bankIban === null ? null : bankAccountLabel({ bankName, iban: bankIban }),
})

export type FreeTuitionAwardQuery = {
  roundId?: string | undefined
  mebbis?: 'recorded' | 'unrecorded' | undefined
  refundStatus?: 'none' | 'pending' | 'paid' | undefined
  page: number
  pageSize: number
}

function awardFilter(institutionId: string, query: FreeTuitionAwardQuery): SQL | undefined {
  const refund =
    query.refundStatus === 'paid'
      ? isNotNull(freeTuitionAwards.refundPaidDate)
      : query.refundStatus === 'pending'
        ? and(isNull(freeTuitionAwards.refundPaidDate), sql`${freeTuitionAwards.refundCents} > 0`)
        : query.refundStatus === 'none'
          ? eq(freeTuitionAwards.refundCents, 0)
          : undefined
  return and(
    activeAward(institutionId),
    query.roundId === undefined ? undefined : eq(freeTuitionAwards.roundId, query.roundId),
    query.mebbis === 'recorded'
      ? isNotNull(freeTuitionAwards.mebbisRecordedDate)
      : query.mebbis === 'unrecorded'
        ? isNull(freeTuitionAwards.mebbisRecordedDate)
        : undefined,
    refund,
  )
}

export async function listFreeTuitionAwards(
  db: Database,
  institutionId: string,
  query: FreeTuitionAwardQuery,
): Promise<{ items: StoredFreeTuitionAward[]; total: number }> {
  const where = awardFilter(institutionId, query)
  const [totalRow] = await db.select({ total: count() }).from(freeTuitionAwards).where(where)
  const rows = await db
    .select(AWARD_COLUMNS)
    .from(freeTuitionAwards)
    .leftJoin(records, AWARD_STUDENT_JOIN)
    .leftJoin(bankAccounts, AWARD_BANK_JOIN)
    .where(where)
    .orderBy(asc(freeTuitionAwards.refundDueDate), asc(freeTuitionAwards.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toAward), total: totalRow?.total ?? 0 }
}

export async function findFreeTuitionAward(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredFreeTuitionAward | null> {
  const [row] = await db
    .select(AWARD_COLUMNS)
    .from(freeTuitionAwards)
    .leftJoin(records, AWARD_STUDENT_JOIN)
    .leftJoin(bankAccounts, AWARD_BANK_JOIN)
    .where(and(activeAward(institutionId), eq(freeTuitionAwards.id, id)))
    .limit(1)
  return row ? toAward(row) : null
}

export async function insertFreeTuitionAward(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    roundId: string
    applicationId: string
    boardMeetingId: string
    studentId: string
    academicYear: number
    acceptedDate: string
    contractId: string
    contractIds: string[]
    cancelledInvoiceIds: string[]
    refundedInvoiceIds: string[]
    waivedCents: number
    refundCents: number
    refundDueDate: string
    awardedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...award } = input
  await tx
    .insert(freeTuitionAwards)
    .values({ institutionId, ...award, createdAt: now, updatedAt: now })
}

export async function setFreeTuitionMebbis(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; recordedDate: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(freeTuitionAwards)
    .set({
      mebbisRecordedDate: input.recordedDate,
      version: sql`${freeTuitionAwards.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        activeAward(institutionId),
        eq(freeTuitionAwards.id, input.id),
        eq(freeTuitionAwards.version, input.expectedVersion),
        isNull(freeTuitionAwards.mebbisRecordedDate),
      ),
    )
    .returning({ id: freeTuitionAwards.id })
  return rows.length === 1
}

/** Yalnız ödenmemiş iade ve beklenen sürüm güncellenir; tutmazsa `false`. */
export async function markFreeTuitionRefundPaid(
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
    .update(freeTuitionAwards)
    .set({
      refundPaidDate: input.paidDate,
      refundIban: input.iban,
      refundAccountHolder: input.accountHolder,
      refundBankAccountId: input.bankAccountId,
      refundPaidByUserId: input.paidByUserId,
      version: sql`${freeTuitionAwards.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        activeAward(institutionId),
        eq(freeTuitionAwards.id, input.id),
        eq(freeTuitionAwards.version, input.expectedVersion),
        isNull(freeTuitionAwards.refundPaidDate),
      ),
    )
    .returning({ id: freeTuitionAwards.id })
  return rows.length === 1
}

/** Öğrencinin hakları: kapsanan sözleşmeler ve iadeye giren taksitler (ek protokol, ayrılış, iptal). */
export async function studentFreeTuitionCoverage(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<{ contractIds: Set<string>; refundedInvoiceIds: Set<string> }> {
  const rows = await db
    .select({
      contractIds: freeTuitionAwards.contractIds,
      refundedInvoiceIds: freeTuitionAwards.refundedInvoiceIds,
    })
    .from(freeTuitionAwards)
    .where(and(activeAward(institutionId), eq(freeTuitionAwards.studentId, studentId)))
  return {
    contractIds: new Set(rows.flatMap((row) => row.contractIds)),
    refundedInvoiceIds: new Set(rows.flatMap((row) => row.refundedInvoiceIds)),
  }
}

/** O gün ödenen ücretsiz okutma iadeleri (gün sonu, M-13); IBAN ve hesap sahibi seçilmez. */
export async function freeTuitionRefundsPaidOnDay(
  db: Database,
  institutionId: string,
  day: string,
): Promise<StoredDayRefund[]> {
  const rows = await db
    .select({
      id: freeTuitionAwards.id,
      studentName,
      amountCents: freeTuitionAwards.refundCents,
      bankName: bankAccounts.bankName,
      bankIban: bankAccounts.iban,
    })
    .from(freeTuitionAwards)
    .leftJoin(records, AWARD_STUDENT_JOIN)
    .leftJoin(bankAccounts, AWARD_BANK_JOIN)
    .where(and(activeAward(institutionId), eq(freeTuitionAwards.refundPaidDate, day)))
    .orderBy(asc(freeTuitionAwards.updatedAt), asc(freeTuitionAwards.id))
  return rows.map(({ id, bankName, bankIban, ...row }) => ({
    ...row,
    withdrawalId: null,
    freeTuitionAwardId: id,
    paidActivityParticipantId: null,
    paidDate: day,
    bankAccountLabel:
      bankName === null || bankIban === null
        ? null
        : bankAccountLabel({ bankName, iban: bankIban }),
  }))
}
