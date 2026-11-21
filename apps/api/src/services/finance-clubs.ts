import { randomUUID } from 'node:crypto'

import {
  assertClubArchivable,
  clubAttendanceCounts,
  clubAttendanceSchema,
  clubCreateSchema,
  clubMemberAddSchema,
  clubUpdateSchema,
  planClub,
  planClubAttendance,
  planClubMember,
  planClubUpdate,
} from '@kampus/school-core/lib/finance-clubs.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  archiveSession,
  clubMemberCounts,
  clubNameTaken,
  findClub,
  findClubMember,
  findClubSession,
  insertClub,
  insertClubMember,
  insertSession,
  listClubs,
  loadClubMembers,
  loadClubMembersByIds,
  loadClubs,
  loadClubSessions,
  loadMarks,
  loadMemberMarks,
  loadStudentMemberships,
  removeClubMember,
  sessionOnDate,
  updateClub,
  type StoredClub,
} from '../db/finance-clubs.ts'
import { memberNames } from '../db/finance-visitors.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { memberCheck, studentCheck, studentNames } from './finance-transport.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { assertReadable, readScope } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Kulüp, üyelik ve kulüp yoklaması (DOM-FIN-142; ON-098; IST-099; K-483). Kural core
 * `lib/finance-clubs.ts`'tedir; servis kurum kilidi altında yükler ve aynı transaction'da yazar;
 * denetime alan adları yazılır (öğrenci kimliği ve yoklama durumları yazılmaz). Öğretmen yalnız
 * sorumlu olduğu kulübü okur ve yoklamasını alır; başka kulüp 404. Veli ve öğrenci görünümü core
 * kapsamıyla (`clubMemberships`, `scope.studentIds`) daralır. Rol ve modül (`clubs`) rotadadır.
 */

const CLUB = 'school_clubs'
const MEMBER = 'school_club_members'
const SESSION = 'school_club_sessions'

/** Öğretmen yalnız sorumlu olduğu kulübü görür; diğer kulüp yokmuş gibi 404. */
function assertVisible(ctx: ServiceContext, club: StoredClub | null): asserts club is StoredClub {
  if (club === null) throw new NotFoundError()
  if (ctx.actor.role === 'ogretmen' && club.teacherMembershipId !== ctx.actor.membershipId)
    throw new NotFoundError()
}

async function visibleClub(db: Database, ctx: ServiceContext, id: string) {
  const club = await findClub(db, ctx.institutionId, id)
  assertVisible(ctx, club)
  return club
}

// --- Görünüm -------------------------------------------------------------------------------------

async function clubRows(db: Database, ctx: ServiceContext, clubs: readonly StoredClub[]) {
  const [teachers, counts] = await Promise.all([
    memberNames(
      db,
      ctx.institutionId,
      clubs.map((club) => club.teacherMembershipId),
    ),
    clubMemberCounts(
      db,
      ctx.institutionId,
      clubs.map((club) => club.id),
    ),
  ])
  return clubs.map((club) => ({
    id: club.id,
    name: club.name,
    teacherMembershipId: club.teacherMembershipId,
    teacherName: teachers.get(club.teacherMembershipId) ?? null,
    capacity: club.capacity,
    memberCount: counts.get(club.id) ?? 0,
    meetingDay: club.meetingDay,
    startTime: club.startTime,
    endTime: club.endTime,
    version: club.version,
  }))
}

async function clubDetail(db: Database, ctx: ServiceContext, club: StoredClub) {
  const [[row], members, sessions] = await Promise.all([
    clubRows(db, ctx, [club]),
    loadClubMembers(db, ctx.institutionId, [club.id]),
    loadClubSessions(db, ctx.institutionId, club.id),
  ])
  if (row === undefined) throw new NotFoundError()
  const [names, marks, memberMarks] = await Promise.all([
    studentNames(
      db,
      ctx,
      members.map((member) => member.studentId),
    ),
    loadMarks(
      db,
      ctx.institutionId,
      sessions.map((session) => session.id),
    ),
    loadMemberMarks(
      db,
      ctx.institutionId,
      members.map((member) => member.id),
    ),
  ])
  return {
    ...row,
    members: members
      .map((member) => {
        const own = memberMarks.filter((mark) => mark.memberId === member.id)
        return {
          id: member.id,
          studentId: member.studentId,
          studentName: names.get(member.studentId) ?? '—',
          joinedAt: member.createdAt.toISOString(),
          sessionCount: own.length,
          presentCount: own.filter((mark) => mark.status === 'present').length,
          version: member.version,
        }
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr')),
    sessions: sessions.map((session) => ({
      id: session.id,
      sessionDate: session.sessionDate,
      counts: clubAttendanceCounts(marks.filter((mark) => mark.sessionId === session.id)),
      version: session.version,
    })),
  }
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listClubsFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  const { items, total } = await listClubs(ctx.db, ctx.institutionId, {
    ...query,
    ...(ctx.actor.role === 'ogretmen' ? { teacherMembershipId: ctx.actor.membershipId } : {}),
  })
  return { items: await clubRows(ctx.db, ctx, items), total }
}

export async function getClubFor(ctx: ServiceContext, id: string) {
  return clubDetail(ctx.db, ctx, await visibleClub(ctx.db, ctx, id))
}

/** Oturumun işaretleri; üye adlarıyla, ada göre. */
export async function getClubSessionFor(ctx: ServiceContext, clubId: string, sessionId: string) {
  const club = await visibleClub(ctx.db, ctx, clubId)
  const session = await findClubSession(ctx.db, ctx.institutionId, sessionId)
  if (session === null || session.clubId !== club.id) throw new NotFoundError()
  const marks = await loadMarks(ctx.db, ctx.institutionId, [session.id])
  // Ayrılmış üyenin işareti de kalır; üyelik arşivli de okunur.
  const members = await loadClubMembersByIds(
    ctx.db,
    ctx.institutionId,
    marks.map((mark) => mark.memberId),
  )
  const memberIds = new Map(members.map((member) => [member.id, member.studentId]))
  const names = await studentNames(ctx.db, ctx, [...memberIds.values()])
  return {
    id: session.id,
    clubId: club.id,
    sessionDate: session.sessionDate,
    counts: clubAttendanceCounts(marks),
    marks: marks
      .map((mark) => {
        const studentId = memberIds.get(mark.memberId) ?? null
        return {
          memberId: mark.memberId,
          studentId,
          studentName: studentId === null ? '—' : (names.get(studentId) ?? '—'),
          status: mark.status,
        }
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr')),
    version: session.version,
  }
}

/**
 * Veli ve öğrenci görünümü (K-483): kapsamdaki öğrencilerin etkin üyelikleri; kulüp adı, gün ve
 * saat, sorumlu öğretmen, katıldığı ve geldiği oturum sayısı.
 */
export async function listMyClubsFor(ctx: ServiceContext) {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'clubMemberships')
  const memberships = await loadStudentMemberships(ctx.db, ctx.institutionId, [...scope.studentIds])
  if (memberships.length === 0) return []
  const [clubs, names, marks] = await Promise.all([
    loadClubs(
      ctx.db,
      ctx.institutionId,
      memberships.map((member) => member.clubId),
    ),
    studentNames(
      ctx.db,
      ctx,
      memberships.map((member) => member.studentId),
    ),
    loadMemberMarks(
      ctx.db,
      ctx.institutionId,
      memberships.map((member) => member.id),
    ),
  ])
  const teachers = await memberNames(
    ctx.db,
    ctx.institutionId,
    clubs.map((club) => club.teacherMembershipId),
  )
  const clubById = new Map(clubs.map((club) => [club.id, club]))
  return memberships.flatMap((member) => {
    const club = clubById.get(member.clubId)
    if (club === undefined) return []
    const own = marks.filter((mark) => mark.memberId === member.id)
    return [
      {
        studentId: member.studentId,
        studentName: names.get(member.studentId) ?? '—',
        clubId: club.id,
        clubName: club.name,
        teacherName: teachers.get(club.teacherMembershipId) ?? null,
        meetingDay: club.meetingDay,
        startTime: club.startTime,
        endTime: club.endTime,
        joinedAt: member.createdAt.toISOString(),
        sessionCount: own.length,
        presentCount: own.filter((mark) => mark.status === 'present').length,
      },
    ]
  })
}

// --- Kulüp yazma ---------------------------------------------------------------------------------

/** Yeni kulüp (K-483). `Idempotency-Key` rotada zorunlu. 201. */
export function createClubCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: CLUB, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.club.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = clubCreateSchema.parse(input)
        const [taken, teacher] = await Promise.all([
          clubNameTaken(tx, ctx.institutionId, parsed.name),
          memberCheck(tx, ctx, parsed.teacherMembershipId),
        ])
        return { run: () => (planClub({ teacher, nameTaken: taken }), parsed) }
      },
      after: async (tx, parsed) => {
        await insertClub(tx, ctx.institutionId, {
          id,
          ...parsed,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.club.create', entity, Object.keys(parsed))
        const club = await findClub(tx, ctx.institutionId, id)
        if (club === null) throw new NotFoundError()
        body = { data: await clubDetail(tx, ctx, club) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function versionedClub(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const club = await visibleClub(tx, ctx, id)
  if (club.version !== version) throw new ConflictError()
  return club
}

/** Kulüp düzenleme (K-483): kontenjan üye sayısının altına inemez. `If-Match`. */
export function updateClubCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: CLUB, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.club.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = clubUpdateSchema.parse(input)
        const club = await versionedClub(tx, ctx, id, expectedVersion)
        const [taken, teacher, counts] = await Promise.all([
          parsed.name === undefined ? false : clubNameTaken(tx, ctx.institutionId, parsed.name, id),
          memberCheck(tx, ctx, parsed.teacherMembershipId),
          clubMemberCounts(tx, ctx.institutionId, [id]),
        ])
        return {
          run: () =>
            planClubUpdate(club, parsed, {
              teacher,
              nameTaken: taken,
              activeMembers: counts.get(id) ?? 0,
            }),
        }
      },
      after: async (tx, plan) => {
        const saved = await updateClub(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: plan.next,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.club.update', entity, plan.changed)
        const club = await findClub(tx, ctx.institutionId, id)
        if (club === null) throw new NotFoundError()
        body = { data: await clubDetail(tx, ctx, club) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Kulüp arşivi (K-483): etkin üyesi olan kulüp arşivlenmez. `If-Match`. */
export function archiveClubCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: CLUB, id }
  return runCommand(
    ctx,
    {
      action: 'finance.club.archive',
      collections: [],
      entity,
      load: async (tx) => {
        await versionedClub(tx, ctx, id, expectedVersion)
        const counts = await clubMemberCounts(tx, ctx.institutionId, [id])
        return { run: () => assertClubArchivable(counts.get(id) ?? 0) }
      },
      after: async (tx) => {
        const saved = await updateClub(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { archivedAt: ctx.now },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.club.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

// --- Üyelik yazma --------------------------------------------------------------------------------

/**
 * Üye ekleme (K-483): aynı öğrenci iki kez üye olamaz, kontenjan dolu 409; kurum kilidi altında
 * sayılır, kısmi tekil indeks son güvencedir. `Idempotency-Key` zorunlu. 201.
 */
export function addClubMemberCommand(
  ctx: ServiceContext,
  clubId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: MEMBER, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.club.member_add',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = clubMemberAddSchema.parse(input)
        const club = await visibleClub(tx, ctx, clubId)
        const [members, student] = await Promise.all([
          loadClubMembers(tx, ctx.institutionId, [clubId]),
          studentCheck(tx, ctx, parsed.studentId),
        ])
        return {
          run: () => {
            planClubMember({
              student,
              alreadyMember: members.some((member) => member.studentId === parsed.studentId),
              activeMembers: members.length,
              capacity: club.capacity,
            })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertClubMember(tx, ctx.institutionId, {
          id,
          clubId,
          studentId: parsed.studentId,
          joinedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.club.member_add', entity, ['clubId', 'studentId'])
        const club = await findClub(tx, ctx.institutionId, clubId)
        if (club === null) throw new NotFoundError()
        const detail = await clubDetail(tx, ctx, club)
        const member = detail.members.find((row) => row.id === id)
        if (member === undefined) throw new NotFoundError()
        body = { data: member }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Üyeliği sonlandırır (arşiv; geçmiş yoklama kalır). `If-Match` üyeliğin sürümüdür. */
export function removeClubMemberCommand(
  ctx: ServiceContext,
  clubId: string,
  memberId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: MEMBER, id: memberId }
  return runCommand(
    ctx,
    {
      action: 'finance.club.member_remove',
      collections: [],
      entity,
      load: async (tx) => {
        await visibleClub(tx, ctx, clubId)
        const member = await findClubMember(tx, ctx.institutionId, memberId)
        if (member === null || member.clubId !== clubId) throw new NotFoundError()
        if (member.version !== expectedVersion) throw new ConflictError()
        return { run: () => member }
      },
      after: async (tx) => {
        const saved = await removeClubMember(tx, ctx.institutionId, {
          id: memberId,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.club.member_remove', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id: memberId } } }),
    idempotency,
  )
}

// --- Yoklama -------------------------------------------------------------------------------------

/**
 * Oturum yoklaması (K-483): bugün ya da geçmiş bir gün, bütün etkin üyeler; aynı günün oturumu
 * 409. Yönetici ya da kulübün sorumlu öğretmeni (rotada rol, burada kulüp). `Idempotency-Key`
 * zorunlu. 201.
 */
export function recordClubAttendanceCommand(
  ctx: ServiceContext,
  clubId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: SESSION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.club.attendance',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = clubAttendanceSchema.parse(input)
        await visibleClub(tx, ctx, clubId)
        const [members, exists] = await Promise.all([
          loadClubMembers(tx, ctx.institutionId, [clubId]),
          sessionOnDate(tx, ctx.institutionId, clubId, parsed.sessionDate),
        ])
        return {
          run: () => {
            planClubAttendance(parsed, {
              today: dayKey(ctx.now),
              activeMemberIds: new Set(members.map((member) => member.id)),
              sessionExists: exists,
            })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertSession(tx, ctx.institutionId, {
          id,
          clubId,
          sessionDate: parsed.sessionDate,
          recordedByUserId: ctx.actor.userId,
          marks: parsed.marks,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.club.attendance', entity, ['sessionDate', 'marks'])
        body = { data: await sessionBody(tx, ctx, clubId, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function sessionBody(tx: Database, ctx: ServiceContext, clubId: string, id: string) {
  return getClubSessionFor({ ...ctx, db: tx }, clubId, id)
}

/** Yanlış oturumu arşivler; aynı gün yeniden alınabilir (K-483). `If-Match` oturum sürümü. */
export function archiveClubSessionCommand(
  ctx: ServiceContext,
  clubId: string,
  sessionId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: SESSION, id: sessionId }
  return runCommand(
    ctx,
    {
      action: 'finance.club.session_archive',
      collections: [],
      entity,
      load: async (tx) => {
        await visibleClub(tx, ctx, clubId)
        const session = await findClubSession(tx, ctx.institutionId, sessionId)
        if (session === null || session.clubId !== clubId) throw new NotFoundError()
        if (session.version !== expectedVersion) throw new ConflictError()
        return { run: () => session }
      },
      after: async (tx) => {
        const saved = await archiveSession(tx, ctx.institutionId, {
          id: sessionId,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.club.session_archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id: sessionId } } }),
    idempotency,
  )
}
