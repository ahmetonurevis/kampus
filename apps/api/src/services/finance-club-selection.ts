import { randomUUID } from 'node:crypto'

import {
  allocateClubSeats,
  allocationDigest,
  CLUB_SELECTION_FAMILY_ROLES,
  clubSelectionConfirmSchema,
  clubSelectionPeriodCreateSchema,
  clubSelectionPeriodUpdateSchema,
  clubSelectionPhase,
  clubSelectionPreferenceSchema,
  gradeEligible,
  isClubSelectionEntryRole,
  planClubSelectionConfirm,
  planClubSelectionDraw,
  planClubSelectionPeriod,
  planClubSelectionPeriodUpdate,
  planClubSelectionPreference,
  waitlistView,
} from '@kampus/school-core/lib/finance-club-selection.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  archivePreference,
  findPeriod,
  insertPeriod,
  insertPreference,
  insertResults,
  listPeriods,
  loadPreferences,
  loadResults,
  loadStudentPreferences,
  preferenceCounts,
  recentPeriods,
  replacePeriodClubs,
  updatePeriod,
  type StoredPeriod,
  type StoredResult,
} from '../db/finance-club-selection.ts'
import {
  insertClubMember,
  loadClubMembers,
  loadClubs,
  type StoredClub,
  type StoredClubMember,
} from '../db/finance-clubs.ts'
import { memberNames } from '../db/finance-visitors.ts'
import { loadRecords, loadRecordsByIds, type StoredRecord } from '../db/records.ts'
import { AppError, ConflictError, NotFoundError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { studentNames } from './finance-transport.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { assertReadable, readScope } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Kulüp tercihi ve kontenjanlı dağıtım (DOM-FIN-150; ON-169; IST-099; K-505…K-507). Kural ve
 * dağıtım algoritması core `lib/finance-club-selection.ts`'tedir; servis kurum kilidi altında
 * yükler ve aynı transaction'da yazar. Onay üyelikleri mevcut kulüp üyeliği tablosuna
 * (`school_club_members`, DOM-FIN-142) yazar; ikinci üyelik modeli yoktur. Veli yalnız kendi
 * çocuğu, öğrenci yalnız kendisi için tercih girer (kapsam dışı öğrenci 404); kapsam core
 * `clubMemberships` kuralıyla daralır. Denetime alan adları yazılır, öğrenci kimliği ve tercih
 * içeriği yazılmaz. Rol ve modül (`finance`, `clubs`) rotadadır.
 */

const PERIOD = 'club_selection_periods'
const PREFERENCE = 'club_selection_preferences'
const MEMBER = 'school_club_members'
const FAMILY_PERIOD_LIMIT = 20

const today = (ctx: ServiceContext) => dayKey(ctx.now)
const stateOf = (period: StoredPeriod) => ({
  openDate: period.openDate,
  closeDate: period.closeDate,
  drawn: period.seed !== null,
  confirmed: period.confirmedAt !== null,
})
const isFamily = (ctx: ServiceContext) =>
  (CLUB_SELECTION_FAMILY_ROLES as readonly string[]).includes(ctx.actor.role)

// --- Öğrenci dizini ------------------------------------------------------------------------------

interface StudentFacts {
  active: boolean
  grade: number | undefined
}

/**
 * Öğrencilerin etkinliği ve sınıf düzeyi (records `students.classId` → `classes.grade`). Kimlik
 * verilmezse kurumun bütün arşivlenmemiş öğrencileri; arşivli öğrenci dizinde yoktur.
 */
async function studentFacts(
  db: Database,
  ctx: ServiceContext,
  studentIds?: readonly string[],
): Promise<Map<string, StudentFacts>> {
  const [students, classes] = await Promise.all([
    studentIds === undefined
      ? loadRecords(db, ctx.institutionId, ['students'])
      : loadRecordsByIds(db, ctx.institutionId, 'students', [...new Set(studentIds)]),
    loadRecords(db, ctx.institutionId, ['classes']),
  ])
  const grades = new Map(
    classes.map((row: StoredRecord) => [
      row.id,
      typeof row.data.grade === 'number' ? row.data.grade : undefined,
    ]),
  )
  return new Map(
    students.map((row) => [
      row.id,
      {
        active: row.data.isActive !== false,
        grade: typeof row.data.classId === 'string' ? grades.get(row.data.classId) : undefined,
      },
    ]),
  )
}

const eligible = (period: StoredPeriod, facts: StudentFacts | undefined) =>
  facts !== undefined && facts.active && gradeEligible(period.gradeLevels, facts.grade)

// --- Dağıtım girdisi -----------------------------------------------------------------------------

interface AllocationContext {
  clubs: StoredClub[]
  members: StoredClubMember[]
  allocation: ReturnType<typeof allocateClubSeats>
  digest: string
}

/** Dönemin arşivlenmemiş kulüpleri, dönemdeki sırasıyla. */
async function periodClubs(db: Database, ctx: ServiceContext, period: StoredPeriod) {
  const clubs = await loadClubs(db, ctx.institutionId, period.clubIds)
  const byId = new Map(clubs.map((club) => [club.id, club]))
  return period.clubIds.flatMap((id) => {
    const club = byId.get(id)
    return club === undefined ? [] : [club]
  })
}

/**
 * Kurayla dağıtım (K-506): kulüplerin güncel üyeleri kontenjandan düşer; kaydı etkin olmayan ya
 * da artık hedef düzeyde olmayan öğrencinin tercihi dağıtıma girmez. Aynı tohum ve aynı veriyle
 * sonuç aynıdır.
 */
async function computeAllocation(
  db: Database,
  ctx: ServiceContext,
  period: StoredPeriod & { seed: string },
): Promise<AllocationContext> {
  const clubs = await periodClubs(db, ctx, period)
  const [members, preferences] = await Promise.all([
    loadClubMembers(
      db,
      ctx.institutionId,
      clubs.map((club) => club.id),
    ),
    loadPreferences(db, ctx.institutionId, period.id),
  ])
  const facts = await studentFacts(
    db,
    ctx,
    preferences.map((row) => row.studentId),
  )
  const allocation = allocateClubSeats({
    seed: period.seed,
    seatsPerStudent: period.seatsPerStudent,
    clubs: clubs.map((club) => ({
      id: club.id,
      capacity: club.capacity,
      memberStudentIds: members
        .filter((member) => member.clubId === club.id)
        .map((member) => member.studentId),
    })),
    preferences: preferences
      .filter((row) => eligible(period, facts.get(row.studentId)))
      .map((row) => ({ studentId: row.studentId, choices: row.choices })),
  })
  return { clubs, members, allocation, digest: allocationDigest(allocation) }
}

function drawnPeriod(period: StoredPeriod): StoredPeriod & { seed: string } {
  if (period.seed === null)
    throw new RuleViolationError('club_selection_not_drawn', 'Önce kura çekin.')
  return { ...period, seed: period.seed }
}

// --- Görünüm -------------------------------------------------------------------------------------

async function periodRows(db: Database, ctx: ServiceContext, periods: readonly StoredPeriod[]) {
  const counts = await preferenceCounts(
    db,
    ctx.institutionId,
    periods.map((period) => period.id),
  )
  return periods.map((period) => ({
    id: period.id,
    name: period.name,
    academicYear: period.academicYear,
    term: period.term,
    openDate: period.openDate,
    closeDate: period.closeDate,
    maxChoices: period.maxChoices,
    seatsPerStudent: period.seatsPerStudent,
    gradeLevels: [...period.gradeLevels],
    phase: clubSelectionPhase(stateOf(period), today(ctx)),
    clubCount: period.clubIds.length,
    preferenceCount: counts.get(period.id) ?? 0,
    drawnAt: period.drawnAt?.toISOString() ?? null,
    confirmedAt: period.confirmedAt?.toISOString() ?? null,
    version: period.version,
  }))
}

async function clubCards(db: Database, ctx: ServiceContext, clubs: readonly StoredClub[]) {
  const [teachers, members] = await Promise.all([
    memberNames(
      db,
      ctx.institutionId,
      clubs.map((club) => club.teacherMembershipId),
    ),
    loadClubMembers(
      db,
      ctx.institutionId,
      clubs.map((club) => club.id),
    ),
  ])
  return {
    members,
    cards: clubs.map((club) => {
      const memberCount = members.filter((member) => member.clubId === club.id).length
      return {
        id: club.id,
        name: club.name,
        teacherName: teachers.get(club.teacherMembershipId) ?? null,
        capacity: club.capacity,
        memberCount,
        freeSeats: Math.max(0, club.capacity - memberCount),
        meetingDay: club.meetingDay,
        startTime: club.startTime,
        endTime: club.endTime,
      }
    }),
  }
}

async function periodDetail(db: Database, ctx: ServiceContext, period: StoredPeriod) {
  const clubs = await periodClubs(db, ctx, period)
  const [[row], { cards, members }, preferences, facts, results] = await Promise.all([
    periodRows(db, ctx, [period]),
    clubCards(db, ctx, clubs),
    loadPreferences(db, ctx.institutionId, period.id),
    studentFacts(db, ctx),
    period.confirmedAt === null
      ? Promise.resolve([])
      : loadResults(db, ctx.institutionId, [period.id]),
  ])
  if (row === undefined) throw new NotFoundError()
  const names = await studentNames(db, ctx, [
    ...preferences.map((preference) => preference.studentId),
    ...results.map((result) => result.studentId),
  ])
  const nameOf = (studentId: string) => names.get(studentId) ?? '—'
  const activeIds = new Set(
    [...facts.entries()].filter(([, fact]) => fact.active).map(([studentId]) => studentId),
  )
  const result =
    period.confirmedAt === null
      ? null
      : {
          clubs: cards.map((card) => {
            const own = results.filter((entry) => entry.clubId === card.id)
            const view = waitlistView(
              own.flatMap((entry) =>
                entry.waitlistPosition === null
                  ? []
                  : [
                      {
                        studentId: entry.studentId,
                        position: entry.waitlistPosition,
                        rank: entry.rank,
                      },
                    ],
              ),
              {
                memberStudentIds: new Set(
                  members
                    .filter((member) => member.clubId === card.id)
                    .map((member) => member.studentId),
                ),
                activeStudentIds: activeIds,
                freeSeats: card.freeSeats,
              },
            )
            const ranks = new Map(own.map((entry) => [entry.studentId, entry.rank]))
            return {
              clubId: card.id,
              clubName: card.name,
              freeSeats: card.freeSeats,
              assigned: own
                .filter((entry) => entry.outcome === 'assigned')
                .map((entry) => ({
                  studentId: entry.studentId,
                  studentName: nameOf(entry.studentId),
                  rank: entry.rank,
                }))
                .sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr')),
              waitlist: view.rows.map((entry) => ({
                studentId: entry.studentId,
                studentName: nameOf(entry.studentId),
                rank: ranks.get(entry.studentId) ?? 1,
                position: entry.position,
                status: entry.status,
              })),
              suggestedStudentId: view.suggestedStudentId,
              suggestedStudentName:
                view.suggestedStudentId === null ? null : nameOf(view.suggestedStudentId),
            }
          }),
          assignedCount: results.filter((entry) => entry.outcome === 'assigned').length,
          waitlistedStudentCount: new Set(
            results
              .filter((entry) => entry.outcome === 'waitlisted')
              .map((entry) => entry.studentId),
          ).size,
        }
  return {
    ...row,
    seed: period.seed,
    clubs: cards,
    eligibleStudentCount: [...facts.values()].filter((fact) => eligible(period, fact)).length,
    preferences: preferences
      .map((preference) => ({
        studentId: preference.studentId,
        studentName: nameOf(preference.studentId),
        choices: preference.choices,
        enteredByRole: preference.enteredByRole,
        enteredAt: preference.createdAt.toISOString(),
        eligible: eligible(period, facts.get(preference.studentId)),
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr')),
    result,
  }
}

async function previewBody(
  db: Database,
  ctx: ServiceContext,
  period: StoredPeriod & { seed: string },
) {
  const { clubs, allocation, digest } = await computeAllocation(db, ctx, period)
  const names = await studentNames(db, ctx, allocation.order)
  const nameOf = (studentId: string) => names.get(studentId) ?? '—'
  const clubName = new Map(clubs.map((club) => [club.id, club.name]))
  return {
    periodId: period.id,
    seed: period.seed,
    digest,
    clubs: allocation.clubs.map((club) => ({
      ...club,
      clubName: clubName.get(club.clubId) ?? '—',
    })),
    assignments: allocation.assignments.map((row) => ({
      ...row,
      studentName: nameOf(row.studentId),
      clubName: clubName.get(row.clubId) ?? '—',
    })),
    waitlist: allocation.waitlist.map((row) => ({
      ...row,
      studentName: nameOf(row.studentId),
      clubName: clubName.get(row.clubId) ?? '—',
    })),
    students: allocation.students.map((row) => ({ ...row, studentName: nameOf(row.studentId) })),
  }
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listClubSelectionPeriodsFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number },
) {
  const { items, total } = await listPeriods(ctx.db, ctx.institutionId, query)
  return { items: await periodRows(ctx.db, ctx, items), total }
}

async function livePeriod(db: Database, ctx: ServiceContext, id: string) {
  const period = await findPeriod(db, ctx.institutionId, id)
  if (period === null) throw new NotFoundError()
  return period
}

export async function getClubSelectionPeriodFor(ctx: ServiceContext, id: string) {
  return periodDetail(ctx.db, ctx, await livePeriod(ctx.db, ctx, id))
}

/** Dağıtım önizlemesi (K-506): saklanan tohum ve güncel üyeliklerle yeniden hesaplanır. */
export async function getClubSelectionPreviewFor(ctx: ServiceContext, id: string) {
  const period = await livePeriod(ctx.db, ctx, id)
  if (period.confirmedAt !== null)
    throw new AppError(
      409,
      'club_selection_already_confirmed',
      'Dağıtım onaylandı; sonuç dönem ayrıntısındadır.',
    )
  return previewBody(ctx.db, ctx, drawnPeriod(period))
}

/**
 * Veli ve öğrenci görünümü (K-505, K-507): son dönemlerde kapsamdaki öğrencinin (hedef düzeyde,
 * kaydı etkin ya da tercihi olan) kulüpleri, tercihi ve onaylandıysa sonucu (atandığı kulüpler,
 * yedek sırası). Diğer öğrencilerin tercihi ve kura sırası görünmez.
 */
export async function listMyClubSelectionsFor(ctx: ServiceContext) {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'clubMemberships')
  const studentIds = [...scope.studentIds]
  if (studentIds.length === 0) return []
  const periods = await recentPeriods(ctx.db, ctx.institutionId, FAMILY_PERIOD_LIMIT)
  if (periods.length === 0) return []
  const periodIds = periods.map((period) => period.id)
  const [facts, preferences, results, names, clubs] = await Promise.all([
    studentFacts(ctx.db, ctx, studentIds),
    loadStudentPreferences(ctx.db, ctx.institutionId, periodIds, studentIds),
    loadResults(
      ctx.db,
      ctx.institutionId,
      periods.filter((period) => period.confirmedAt !== null).map((period) => period.id),
      studentIds,
    ),
    studentNames(ctx.db, ctx, studentIds),
    loadClubs(
      ctx.db,
      ctx.institutionId,
      periods.flatMap((period) => period.clubIds),
    ),
  ])
  const teachers = await memberNames(
    ctx.db,
    ctx.institutionId,
    clubs.map((club) => club.teacherMembershipId),
  )
  const clubById = new Map(clubs.map((club) => [club.id, club]))
  return periods.flatMap((period) => {
    const students = studentIds.flatMap((studentId) => {
      const preference = preferences.find(
        (row) => row.periodId === period.id && row.studentId === studentId,
      )
      const own = results.filter((row) => row.periodId === period.id && row.studentId === studentId)
      if (!eligible(period, facts.get(studentId)) && preference === undefined && own.length === 0)
        return []
      return [
        {
          studentId,
          studentName: names.get(studentId) ?? '—',
          choices: preference?.choices ?? [],
          enteredAt: preference?.createdAt.toISOString() ?? null,
          assignedClubIds: own.filter((row) => row.outcome === 'assigned').map((row) => row.clubId),
          waitlist: own.flatMap((row) =>
            row.waitlistPosition === null
              ? []
              : [{ clubId: row.clubId, position: row.waitlistPosition }],
          ),
        },
      ]
    })
    if (students.length === 0) return []
    return [
      {
        periodId: period.id,
        name: period.name,
        academicYear: period.academicYear,
        term: period.term,
        openDate: period.openDate,
        closeDate: period.closeDate,
        phase: clubSelectionPhase(stateOf(period), today(ctx)),
        maxChoices: period.maxChoices,
        seatsPerStudent: period.seatsPerStudent,
        clubs: period.clubIds.flatMap((clubId) => {
          const club = clubById.get(clubId)
          if (club === undefined) return []
          return [
            {
              id: club.id,
              name: club.name,
              teacherName: teachers.get(club.teacherMembershipId) ?? null,
              meetingDay: club.meetingDay,
              startTime: club.startTime,
              endTime: club.endTime,
            },
          ]
        }),
        students,
      },
    ]
  })
}

// --- Dönem yazma ---------------------------------------------------------------------------------

async function missingClubs(tx: Database, ctx: ServiceContext, clubIds: readonly string[]) {
  const found = new Set((await loadClubs(tx, ctx.institutionId, clubIds)).map((club) => club.id))
  return clubIds.filter((id) => !found.has(id))
}

/** Yeni tercih dönemi (K-505). `Idempotency-Key` rotada zorunlu. 201. */
export function createClubSelectionPeriodCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: PERIOD, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.club_selection.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = clubSelectionPeriodCreateSchema.parse(input)
        const missing = await missingClubs(tx, ctx, parsed.clubIds)
        return {
          run: () => (
            planClubSelectionPeriod(parsed, { today: today(ctx), missingClubIds: missing }),
            parsed
          ),
        }
      },
      after: async (tx, parsed) => {
        await insertPeriod(tx, ctx.institutionId, {
          id,
          ...parsed,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.club_selection.create', entity, Object.keys(parsed))
        body = { data: await periodDetail(tx, ctx, await livePeriod(tx, ctx, id)) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function versionedPeriod(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const period = await livePeriod(tx, ctx, id)
  if (period.version !== version) throw new ConflictError()
  return period
}

/**
 * Dönem düzenleme (K-505): kura sonrası 422; tercih girilmişse yalnız ad ve tarihler. Kulüp
 * listesi değişirse çıkan kulüp bağı arşivlenir. `If-Match`.
 */
export function updateClubSelectionPeriodCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PERIOD, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.club_selection.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = clubSelectionPeriodUpdateSchema.parse(input)
        const period = await versionedPeriod(tx, ctx, id, expectedVersion)
        const [counts, missing] = await Promise.all([
          preferenceCounts(tx, ctx.institutionId, [id]),
          parsed.clubIds === undefined ? [] : missingClubs(tx, ctx, parsed.clubIds),
        ])
        return {
          run: () =>
            planClubSelectionPeriodUpdate({ ...period, ...stateOf(period) }, parsed, {
              today: today(ctx),
              hasPreferences: (counts.get(id) ?? 0) > 0,
              missingClubIds: missing,
            }),
        }
      },
      after: async (tx, plan) => {
        const { clubIds, gradeLevels, ...rest } = plan.next
        const saved = await updatePeriod(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { ...rest, gradeLevels: [...gradeLevels] },
        })
        if (!saved) throw new ConflictError()
        if (plan.changed.includes('clubIds'))
          await replacePeriodClubs(tx, ctx.institutionId, id, clubIds, ctx.now)
        await auditWork(tx, ctx, 'finance.club_selection.update', entity, plan.changed)
        body = { data: await periodDetail(tx, ctx, await livePeriod(tx, ctx, id)) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Dönem arşivi (K-505): onaylı dönemde yazılan üyelikler kalır. `If-Match`. */
export function archiveClubSelectionPeriodCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PERIOD, id }
  return runCommand(
    ctx,
    {
      action: 'finance.club_selection.archive',
      collections: [],
      entity,
      load: async (tx) => {
        await versionedPeriod(tx, ctx, id, expectedVersion)
        return { run: () => undefined }
      },
      after: async (tx) => {
        const saved = await updatePeriod(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { archivedAt: ctx.now },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.club_selection.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

// --- Tercih --------------------------------------------------------------------------------------

/**
 * Tercih girişi (K-505): dönem açıkken öğrenci kendisi, veli kendi çocuğu, yönetici ve ön büro
 * herkes adına sıralı tercih girer. Kapsam dışı öğrenci 404. Önceki tercih arşivlenip yenisi
 * yazılır; boş liste geri çeker. `Idempotency-Key` zorunlu. 200.
 */
export async function setClubSelectionPreferenceCommand(
  ctx: ServiceContext,
  periodId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let ownStudents: ReadonlySet<string> | null = null
  if (isFamily(ctx)) {
    const scope = await readScope(ctx)
    assertReadable(ctx, scope, 'clubMemberships')
    ownStudents = scope.studentIds
  }
  const newId = randomUUID()
  const entity = { type: PREFERENCE, id: newId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.club_selection.preference',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = clubSelectionPreferenceSchema.parse(input)
        if (ownStudents !== null && !ownStudents.has(parsed.studentId)) throw new NotFoundError()
        const period = await livePeriod(tx, ctx, periodId)
        const [[existing], facts] = await Promise.all([
          loadPreferences(tx, ctx.institutionId, periodId, [parsed.studentId]),
          studentFacts(tx, ctx, [parsed.studentId]),
        ])
        const fact = facts.get(parsed.studentId)
        return {
          run: () => ({
            parsed,
            existing,
            kind: planClubSelectionPreference({ ...period, ...stateOf(period) }, parsed, {
              today: today(ctx),
              student: fact === undefined ? null : { active: fact.active },
              grade: fact?.grade,
              hasPreference: existing !== undefined,
            }),
          }),
        }
      },
      after: async (tx, { parsed, existing, kind }) => {
        if (existing !== undefined) {
          const saved = await archivePreference(tx, ctx.institutionId, {
            id: existing.id,
            expectedVersion: existing.version,
            userId: ctx.actor.userId,
            now: ctx.now,
          })
          if (!saved) throw new ConflictError()
        }
        const role = ctx.actor.role
        // Rota rolü daraltır; tip için yeniden denetlenir.
        if (!isClubSelectionEntryRole(role)) throw new NotFoundError()
        if (kind === 'replace')
          await insertPreference(tx, ctx.institutionId, {
            id: newId,
            periodId,
            studentId: parsed.studentId,
            enteredByUserId: ctx.actor.userId,
            enteredByRole: role,
            choices: parsed.choices,
            now: ctx.now,
          })
        const target =
          kind === 'withdraw' && existing !== undefined
            ? { type: PREFERENCE, id: existing.id }
            : entity
        await auditWork(
          tx,
          ctx,
          kind === 'replace'
            ? 'finance.club_selection.preference_set'
            : 'finance.club_selection.preference_withdraw',
          target,
          ['choices'],
        )
        body = {
          data: {
            periodId,
            studentId: parsed.studentId,
            choices: kind === 'replace' ? parsed.choices : [],
            enteredAt: kind === 'replace' ? ctx.now.toISOString() : null,
          },
        }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Kura ve onay --------------------------------------------------------------------------------

/**
 * Kura (K-506): kapanmış dönemde bir kez çekilir; tohum dönemde saklanır, ikinci kura 409.
 * Yanıt önizlemedir. `Idempotency-Key` zorunlu.
 */
export function drawClubSelectionCommand(
  ctx: ServiceContext,
  periodId: string,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PERIOD, id: periodId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.club_selection.draw',
      collections: [],
      entity,
      load: async (tx) => {
        const period = await livePeriod(tx, ctx, periodId)
        const counts = await preferenceCounts(tx, ctx.institutionId, [periodId])
        return {
          run: () => {
            planClubSelectionDraw(stateOf(period), {
              today: today(ctx),
              preferenceCount: counts.get(periodId) ?? 0,
            })
            return period
          },
        }
      },
      after: async (tx, period) => {
        const seed = randomUUID()
        const saved = await updatePeriod(tx, ctx.institutionId, {
          id: periodId,
          expectedVersion: period.version,
          now: ctx.now,
          values: { seed, drawnAt: ctx.now, drawnByUserId: ctx.actor.userId },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.club_selection.draw', entity, ['seed', 'drawnAt'])
        body = { data: await previewBody(tx, ctx, { ...period, seed }) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Onay (K-507): saklanan tohumla dağıtım kurum kilidi altında yeniden hesaplanır; özet önizlemeyle
 * tutmazsa 409. Atananların kulüp üyelikleri, sonuç ve yedek listesi tek işlemde yazılır; ikinci
 * onay 409. `Idempotency-Key` zorunlu.
 */
export function confirmClubSelectionCommand(
  ctx: ServiceContext,
  periodId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PERIOD, id: periodId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.club_selection.confirm',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = clubSelectionConfirmSchema.parse(input)
        const period = await livePeriod(tx, ctx, periodId)
        const computed =
          period.seed === null || period.confirmedAt !== null
            ? null
            : await computeAllocation(tx, ctx, { ...period, seed: period.seed })
        return {
          run: () => {
            planClubSelectionConfirm(stateOf(period), {
              today: today(ctx),
              digest: parsed.digest,
              currentDigest: computed?.digest ?? '',
            })
            if (computed === null) throw new ConflictError()
            return { period, allocation: computed.allocation }
          },
        }
      },
      after: async (tx, { period, allocation }) => {
        const lottery = new Map(
          allocation.students.map((row) => [row.studentId, row.lotteryPosition]),
        )
        const rows: StoredResult[] = []
        for (const assignment of allocation.assignments) {
          const memberId = randomUUID()
          await insertClubMember(tx, ctx.institutionId, {
            id: memberId,
            clubId: assignment.clubId,
            studentId: assignment.studentId,
            joinedByUserId: ctx.actor.userId,
            now: ctx.now,
          })
          await auditWork(tx, ctx, 'finance.club.member_add', { type: MEMBER, id: memberId }, [
            'clubId',
            'studentId',
          ])
          rows.push({
            studentId: assignment.studentId,
            clubId: assignment.clubId,
            outcome: 'assigned',
            rank: assignment.rank,
            round: assignment.round,
            waitlistPosition: null,
            lotteryPosition: lottery.get(assignment.studentId) ?? 1,
            memberId,
          })
        }
        for (const entry of allocation.waitlist)
          rows.push({
            studentId: entry.studentId,
            clubId: entry.clubId,
            outcome: 'waitlisted',
            rank: entry.rank,
            round: null,
            waitlistPosition: entry.position,
            lotteryPosition: lottery.get(entry.studentId) ?? 1,
            memberId: null,
          })
        await insertResults(tx, ctx.institutionId, periodId, rows, ctx.now)
        const saved = await updatePeriod(tx, ctx.institutionId, {
          id: periodId,
          expectedVersion: period.version,
          now: ctx.now,
          values: { confirmedAt: ctx.now, confirmedByUserId: ctx.actor.userId },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.club_selection.confirm', entity, [
          'confirmedAt',
          'assignments',
          'waitlist',
        ])
        body = { data: await periodDetail(tx, ctx, await livePeriod(tx, ctx, periodId)) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
