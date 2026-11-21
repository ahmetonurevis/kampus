import { and, asc, count, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'

import type {
  ClubSelectionEntryRole,
  ClubSelectionOutcome,
  StoredPeriodFields,
} from '@kampus/school-core/lib/finance-club-selection.ts'

import type { Database } from './client.ts'
import {
  clubSelectionChoices,
  clubSelectionPeriodClubs,
  clubSelectionPeriods,
  clubSelectionPreferences,
  clubSelectionResults,
} from './schema/finance-club-selection.ts'

/**
 * Kulüp tercih dönemi, tercih ve dağıtım sonucu deposu (DOM-FIN-150; ON-169). Kurum kapsamlıdır:
 * ilk parametre `institutionId`; arşivli satırlar okunmaz. Kural core
 * `lib/finance-club-selection.ts`'tedir; üyelik `db/finance-clubs.ts`'tedir.
 */

export interface StoredPeriod extends StoredPeriodFields {
  id: string
  seed: string | null
  drawnAt: Date | null
  confirmedAt: Date | null
  createdAt: Date
  version: number
}

export interface StoredPreference {
  id: string
  studentId: string
  enteredByRole: ClubSelectionEntryRole
  createdAt: Date
  version: number
  choices: string[]
}

export interface StoredResult {
  studentId: string
  clubId: string
  outcome: ClubSelectionOutcome
  rank: number
  round: number | null
  waitlistPosition: number | null
  lotteryPosition: number
  memberId: string | null
}

const PERIOD = {
  id: clubSelectionPeriods.id,
  name: clubSelectionPeriods.name,
  academicYear: clubSelectionPeriods.academicYear,
  term: clubSelectionPeriods.term,
  openDate: clubSelectionPeriods.openDate,
  closeDate: clubSelectionPeriods.closeDate,
  maxChoices: clubSelectionPeriods.maxChoices,
  seatsPerStudent: clubSelectionPeriods.seatsPerStudent,
  gradeLevels: clubSelectionPeriods.gradeLevels,
  seed: clubSelectionPeriods.seed,
  drawnAt: clubSelectionPeriods.drawnAt,
  confirmedAt: clubSelectionPeriods.confirmedAt,
  createdAt: clubSelectionPeriods.createdAt,
  version: clubSelectionPeriods.version,
}

const livePeriods = (institutionId: string) =>
  and(
    eq(clubSelectionPeriods.institutionId, institutionId),
    isNull(clubSelectionPeriods.archivedAt),
  )
const livePeriodClubs = (institutionId: string) =>
  and(
    eq(clubSelectionPeriodClubs.institutionId, institutionId),
    isNull(clubSelectionPeriodClubs.archivedAt),
  )
const livePreferences = (institutionId: string) =>
  and(
    eq(clubSelectionPreferences.institutionId, institutionId),
    isNull(clubSelectionPreferences.archivedAt),
  )

type PeriodRow = Omit<StoredPeriod, 'clubIds' | 'term'> & { term: number | null }

async function withClubs(
  db: Database,
  institutionId: string,
  rows: readonly PeriodRow[],
): Promise<StoredPeriod[]> {
  if (rows.length === 0) return []
  const links = await db
    .select({
      periodId: clubSelectionPeriodClubs.periodId,
      clubId: clubSelectionPeriodClubs.clubId,
    })
    .from(clubSelectionPeriodClubs)
    .where(
      and(
        livePeriodClubs(institutionId),
        inArray(
          clubSelectionPeriodClubs.periodId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(clubSelectionPeriodClubs.position), asc(clubSelectionPeriodClubs.clubId))
  return rows.map((row) => ({
    ...row,
    term: row.term === 1 || row.term === 2 ? row.term : null,
    clubIds: links.filter((link) => link.periodId === row.id).map((link) => link.clubId),
  }))
}

// --- Dönem ---------------------------------------------------------------------------------------

export async function findPeriod(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredPeriod | null> {
  const rows = await db
    .select(PERIOD)
    .from(clubSelectionPeriods)
    .where(and(livePeriods(institutionId), eq(clubSelectionPeriods.id, id)))
    .limit(1)
  const [period] = await withClubs(db, institutionId, rows)
  return period ?? null
}

export async function listPeriods(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number },
): Promise<{ items: StoredPeriod[]; total: number }> {
  const where = livePeriods(institutionId)
  const [totalRow] = await db.select({ total: count() }).from(clubSelectionPeriods).where(where)
  const rows = await db
    .select(PERIOD)
    .from(clubSelectionPeriods)
    .where(where)
    .orderBy(desc(clubSelectionPeriods.openDate), asc(clubSelectionPeriods.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: await withClubs(db, institutionId, rows), total: totalRow?.total ?? 0 }
}

/** Ailenin göreceği son dönemler (veli ve öğrenci görünümü), yeni açılış önce. */
export async function recentPeriods(
  db: Database,
  institutionId: string,
  limit: number,
): Promise<StoredPeriod[]> {
  const rows = await db
    .select(PERIOD)
    .from(clubSelectionPeriods)
    .where(livePeriods(institutionId))
    .orderBy(desc(clubSelectionPeriods.openDate), asc(clubSelectionPeriods.id))
    .limit(limit)
  return withClubs(db, institutionId, rows)
}

export async function insertPeriod(
  tx: Database,
  institutionId: string,
  input: StoredPeriodFields & { id: string; createdByUserId: string; now: Date },
) {
  const { now, clubIds, gradeLevels, ...values } = input
  await tx.insert(clubSelectionPeriods).values({
    ...values,
    gradeLevels: [...gradeLevels],
    institutionId,
    createdAt: now,
    updatedAt: now,
  })
  await replacePeriodClubs(tx, institutionId, input.id, clubIds, now)
}

/**
 * Dönemin kulüp listesini yeni sırasıyla yazar: listeden çıkan kulüp arşivlenir, gelen kulüp
 * eklenir ya da arşivden döner (kalıcı silme yok).
 */
export async function replacePeriodClubs(
  tx: Database,
  institutionId: string,
  periodId: string,
  clubIds: readonly string[],
  now: Date,
) {
  await tx
    .update(clubSelectionPeriodClubs)
    .set({ archivedAt: now, updatedAt: now })
    .where(
      and(
        livePeriodClubs(institutionId),
        eq(clubSelectionPeriodClubs.periodId, periodId),
        clubIds.length === 0
          ? undefined
          : notInArray(clubSelectionPeriodClubs.clubId, [...clubIds]),
      ),
    )
  if (clubIds.length === 0) return
  await tx
    .insert(clubSelectionPeriodClubs)
    .values(
      clubIds.map((clubId, index) => ({
        institutionId,
        periodId,
        clubId,
        position: index + 1,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [
        clubSelectionPeriodClubs.institutionId,
        clubSelectionPeriodClubs.periodId,
        clubSelectionPeriodClubs.clubId,
      ],
      set: {
        // Çakışan satırın yeni sırası.
        position: sql`excluded.position`,
        archivedAt: null,
        updatedAt: now,
      },
    })
}

export async function updatePeriod(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<
      Omit<StoredPeriodFields, 'clubIds' | 'gradeLevels'> & {
        gradeLevels: number[]
        seed: string
        drawnAt: Date
        drawnByUserId: string
        confirmedAt: Date
        confirmedByUserId: string
        archivedAt: Date
      }
    >
  },
): Promise<boolean> {
  const rows = await tx
    .update(clubSelectionPeriods)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        livePeriods(institutionId),
        eq(clubSelectionPeriods.id, input.id),
        eq(clubSelectionPeriods.version, input.expectedVersion),
      ),
    )
    .returning({ id: clubSelectionPeriods.id })
  return rows.length === 1
}

/** Dönem başına etkin tercih sayısı. */
export async function preferenceCounts(
  db: Database,
  institutionId: string,
  periodIds: readonly string[],
): Promise<Map<string, number>> {
  if (periodIds.length === 0) return new Map()
  const rows = await db
    .select({ periodId: clubSelectionPreferences.periodId, total: count() })
    .from(clubSelectionPreferences)
    .where(
      and(
        livePreferences(institutionId),
        inArray(clubSelectionPreferences.periodId, [...new Set(periodIds)]),
      ),
    )
    .groupBy(clubSelectionPreferences.periodId)
  return new Map(rows.map((row) => [row.periodId, row.total]))
}

// --- Tercih --------------------------------------------------------------------------------------

async function attachChoices(
  db: Database,
  institutionId: string,
  rows: readonly Omit<StoredPreference, 'choices'>[],
): Promise<StoredPreference[]> {
  if (rows.length === 0) return []
  const choices = await db
    .select({
      preferenceId: clubSelectionChoices.preferenceId,
      clubId: clubSelectionChoices.clubId,
      rank: clubSelectionChoices.rank,
    })
    .from(clubSelectionChoices)
    .where(
      and(
        eq(clubSelectionChoices.institutionId, institutionId),
        inArray(
          clubSelectionChoices.preferenceId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(clubSelectionChoices.rank))
  const byPreference = new Map<string, string[]>()
  for (const choice of choices) {
    const own = byPreference.get(choice.preferenceId) ?? []
    own.push(choice.clubId)
    byPreference.set(choice.preferenceId, own)
  }
  return rows.map((row) => ({ ...row, choices: byPreference.get(row.id) ?? [] }))
}

const PREFERENCE = {
  id: clubSelectionPreferences.id,
  studentId: clubSelectionPreferences.studentId,
  enteredByRole: clubSelectionPreferences.enteredByRole,
  createdAt: clubSelectionPreferences.createdAt,
  version: clubSelectionPreferences.version,
}

/** Dönemin etkin tercihleri, öğrenci kimliğine göre. */
export async function loadPreferences(
  db: Database,
  institutionId: string,
  periodId: string,
  studentIds?: readonly string[],
): Promise<StoredPreference[]> {
  if (studentIds?.length === 0) return []
  const rows = await db
    .select(PREFERENCE)
    .from(clubSelectionPreferences)
    .where(
      and(
        livePreferences(institutionId),
        eq(clubSelectionPreferences.periodId, periodId),
        studentIds === undefined
          ? undefined
          : inArray(clubSelectionPreferences.studentId, [...new Set(studentIds)]),
      ),
    )
    .orderBy(asc(clubSelectionPreferences.studentId))
  return attachChoices(db, institutionId, rows)
}

/** Öğrencilerin bütün dönemlerdeki etkin tercihleri (veli ve öğrenci görünümü). */
export async function loadStudentPreferences(
  db: Database,
  institutionId: string,
  periodIds: readonly string[],
  studentIds: readonly string[],
): Promise<(StoredPreference & { periodId: string })[]> {
  if (periodIds.length === 0 || studentIds.length === 0) return []
  const rows = await db
    .select({ ...PREFERENCE, periodId: clubSelectionPreferences.periodId })
    .from(clubSelectionPreferences)
    .where(
      and(
        livePreferences(institutionId),
        inArray(clubSelectionPreferences.periodId, [...new Set(periodIds)]),
        inArray(clubSelectionPreferences.studentId, [...new Set(studentIds)]),
      ),
    )
  const withChoices = await attachChoices(db, institutionId, rows)
  return withChoices.map((row, index) => ({ ...row, periodId: rows[index]?.periodId ?? '' }))
}

export async function insertPreference(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    periodId: string
    studentId: string
    enteredByUserId: string
    enteredByRole: ClubSelectionEntryRole
    choices: readonly string[]
    now: Date
  },
) {
  const { now, choices, ...values } = input
  await tx
    .insert(clubSelectionPreferences)
    .values({ ...values, institutionId, createdAt: now, updatedAt: now })
  await tx.insert(clubSelectionChoices).values(
    choices.map((clubId, index) => ({
      institutionId,
      preferenceId: input.id,
      periodId: input.periodId,
      rank: index + 1,
      clubId,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/** Tercihi arşivler (değiştirme ya da geri çekme). */
export async function archivePreference(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(clubSelectionPreferences)
    .set({
      archivedAt: input.now,
      replacedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        livePreferences(institutionId),
        eq(clubSelectionPreferences.id, input.id),
        eq(clubSelectionPreferences.version, input.expectedVersion),
      ),
    )
    .returning({ id: clubSelectionPreferences.id })
  return rows.length === 1
}

// --- Sonuç ---------------------------------------------------------------------------------------

const RESULT = {
  studentId: clubSelectionResults.studentId,
  clubId: clubSelectionResults.clubId,
  outcome: clubSelectionResults.outcome,
  rank: clubSelectionResults.rank,
  round: clubSelectionResults.round,
  waitlistPosition: clubSelectionResults.waitlistPosition,
  lotteryPosition: clubSelectionResults.lotteryPosition,
  memberId: clubSelectionResults.memberId,
}

export async function insertResults(
  tx: Database,
  institutionId: string,
  periodId: string,
  rows: readonly StoredResult[],
  now: Date,
) {
  if (rows.length === 0) return
  await tx
    .insert(clubSelectionResults)
    .values(
      rows.map((row) => ({ ...row, institutionId, periodId, createdAt: now, updatedAt: now })),
    )
}

/** Dönemin sonuçları; kulüp, sonra yedek sırası. */
export async function loadResults(
  db: Database,
  institutionId: string,
  periodIds: readonly string[],
  studentIds?: readonly string[],
): Promise<(StoredResult & { periodId: string })[]> {
  if (periodIds.length === 0 || studentIds?.length === 0) return []
  return db
    .select({ ...RESULT, periodId: clubSelectionResults.periodId })
    .from(clubSelectionResults)
    .where(
      and(
        eq(clubSelectionResults.institutionId, institutionId),
        isNull(clubSelectionResults.archivedAt),
        inArray(clubSelectionResults.periodId, [...new Set(periodIds)]),
        studentIds === undefined
          ? undefined
          : inArray(clubSelectionResults.studentId, [...new Set(studentIds)]),
      ),
    )
    .orderBy(
      asc(clubSelectionResults.clubId),
      asc(clubSelectionResults.waitlistPosition),
      asc(clubSelectionResults.lotteryPosition),
    )
}
