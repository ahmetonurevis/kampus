import { and, asc, eq, isNull, max } from 'drizzle-orm'

import {
  lessonHoursForPayroll,
  lessonSheetStatus,
  type LessonConfirmationChannel,
  type LessonConfirmationOutcome,
  type LessonSheetStatus,
} from '@kampus/school-core/lib/finance-lesson-hour-approvals.ts'

import type { Database } from './client.ts'
import { loadMonthLessonHours, type StoredLessonHours } from './finance-payroll-exports.ts'
import {
  lessonHourApprovals,
  lessonHourConfirmations,
} from './schema/finance-lesson-hour-approvals.ts'

/**
 * Ek ders çizelgesi onayı deposu (DOM-FIN-120; ON-196). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-lesson-hour-approvals.ts`'tedir; depo yalnız okur ve
 * yazar. Öğretmen yanıtı satırı değişmez; çizelge sürüm koşuluyla güncellenir.
 */

export interface StoredLessonSheet {
  id: string
  month: string
  status: LessonSheetStatus
  submittedAt: Date
  submittedByUserId: string
  approvedAt: Date | null
  approvedByUserId: string | null
  approvalCount: number
  reopenedAt: Date | null
  reopenedByUserId: string | null
  reopenReason: string | null
  version: number
}

const SHEET_COLUMNS = {
  id: lessonHourApprovals.id,
  month: lessonHourApprovals.month,
  status: lessonHourApprovals.status,
  submittedAt: lessonHourApprovals.submittedAt,
  submittedByUserId: lessonHourApprovals.submittedByUserId,
  approvedAt: lessonHourApprovals.approvedAt,
  approvedByUserId: lessonHourApprovals.approvedByUserId,
  approvalCount: lessonHourApprovals.approvalCount,
  reopenedAt: lessonHourApprovals.reopenedAt,
  reopenedByUserId: lessonHourApprovals.reopenedByUserId,
  reopenReason: lessonHourApprovals.reopenReason,
  version: lessonHourApprovals.version,
}

const sheetsOf = (institutionId: string) =>
  and(eq(lessonHourApprovals.institutionId, institutionId), isNull(lessonHourApprovals.archivedAt))

/** Ayın çizelgesi; kaydı yoksa `null` (taslak). */
export async function findLessonSheet(
  db: Database,
  institutionId: string,
  month: string,
): Promise<StoredLessonSheet | null> {
  const [row] = await db
    .select(SHEET_COLUMNS)
    .from(lessonHourApprovals)
    .where(and(sheetsOf(institutionId), eq(lessonHourApprovals.month, month)))
    .limit(1)
  return row ?? null
}

/** İlk gönderim: çizelge satırı `teacher_review` olarak açılır. */
export async function insertLessonSheet(
  tx: Database,
  institutionId: string,
  input: { id: string; month: string; userId: string; now: Date },
): Promise<void> {
  await tx.insert(lessonHourApprovals).values({
    institutionId,
    id: input.id,
    month: input.month,
    status: 'teacher_review',
    submittedAt: input.now,
    submittedByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Durum geçişi ve geçişin alanları; sürüm tutmazsa `false` (409). */
export async function updateLessonSheet(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    set: Partial<
      Pick<
        typeof lessonHourApprovals.$inferInsert,
        | 'status'
        | 'submittedAt'
        | 'submittedByUserId'
        | 'approvedAt'
        | 'approvedByUserId'
        | 'approvalCount'
        | 'reopenedAt'
        | 'reopenedByUserId'
        | 'reopenReason'
      >
    >
  },
): Promise<boolean> {
  const rows = await tx
    .update(lessonHourApprovals)
    .set({ ...input.set, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        sheetsOf(institutionId),
        eq(lessonHourApprovals.id, input.id),
        eq(lessonHourApprovals.version, input.expectedVersion),
      ),
    )
    .returning({ id: lessonHourApprovals.id })
  return rows.length === 1
}

export interface StoredLessonConfirmation {
  id: string
  membershipId: string
  sequence: number
  outcome: LessonConfirmationOutcome
  channel: LessonConfirmationChannel
  reason: string | null
  entriesHash: string
  recordedByUserId: string
  createdAt: Date
}

/** Çizelgenin bütün yanıtları, sıraya göre. */
export async function listLessonConfirmations(
  db: Database,
  institutionId: string,
  approvalId: string,
): Promise<StoredLessonConfirmation[]> {
  return db
    .select({
      id: lessonHourConfirmations.id,
      membershipId: lessonHourConfirmations.membershipId,
      sequence: lessonHourConfirmations.sequence,
      outcome: lessonHourConfirmations.outcome,
      channel: lessonHourConfirmations.channel,
      reason: lessonHourConfirmations.reason,
      entriesHash: lessonHourConfirmations.entriesHash,
      recordedByUserId: lessonHourConfirmations.recordedByUserId,
      createdAt: lessonHourConfirmations.createdAt,
    })
    .from(lessonHourConfirmations)
    .where(
      and(
        eq(lessonHourConfirmations.institutionId, institutionId),
        eq(lessonHourConfirmations.approvalId, approvalId),
      ),
    )
    .orderBy(asc(lessonHourConfirmations.sequence))
}

/** Yeni yanıt; sıra kurum kilidi altında çizelgenin en büyük sırasından devam eder. */
export async function insertLessonConfirmation(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    approvalId: string
    membershipId: string
    outcome: LessonConfirmationOutcome
    channel: LessonConfirmationChannel
    reason: string | null
    entriesHash: string
    userId: string
    now: Date
  },
): Promise<void> {
  const [last] = await tx
    .select({ sequence: max(lessonHourConfirmations.sequence) })
    .from(lessonHourConfirmations)
    .where(
      and(
        eq(lessonHourConfirmations.institutionId, institutionId),
        eq(lessonHourConfirmations.approvalId, input.approvalId),
      ),
    )
  const { userId, now, ...fields } = input
  await tx.insert(lessonHourConfirmations).values({
    ...fields,
    institutionId,
    sequence: Number(last?.sequence ?? 0) + 1,
    recordedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * Bordroya giren ek ders saatleri (DOM-FIN-120, K-411): ayın çizelgesi müdür onaylıysa ayın etkin
 * saat kayıtları, değilse boş liste. Bordro hesabı (ON-198) ek dersi buradan okur; durum
 * ekranda "onay bekliyor" göstermek için döner.
 */
export async function approvedLessonHoursFor(
  db: Database,
  institutionId: string,
  month: string,
): Promise<{ status: LessonSheetStatus; entries: StoredLessonHours[] }> {
  const sheet = await findLessonSheet(db, institutionId, month)
  const entries = await loadMonthLessonHours(db, institutionId, `${month}-01`)
  return { status: lessonSheetStatus(sheet), entries: lessonHoursForPayroll(sheet, entries) }
}
