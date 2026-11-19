import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type {
  DepartmentDecisionStatus,
  DepartmentMeetingAttendance,
  DepartmentMeetingKind,
  DepartmentMeetingStatus,
  StoredAgendaItem,
} from '@kampus/school-core/lib/finance-department-meetings.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import {
  departmentMeetingAttendees as attendees,
  departmentMeetingDecisions as decisions,
  departmentMeetings as meetings,
} from './schema/finance-department-meetings.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Zümre toplantısı tutanağı deposu (DOM-FIN-132; ON-217). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-department-meetings.ts`'tedir; depo yalnız okur ve
 * yazar. Arşivli katılım ve karar satırları okunmaz. Personel üyelikten yalnız okunur.
 */

const chairMembers = alias(memberships, 'chair_members')
const chairUsers = alias(users, 'chair_users')

export interface StoredMeeting {
  id: string
  subjectId: string
  subjectName: string
  kind: DepartmentMeetingKind
  meetingDate: string
  location: string
  chairMembershipId: string
  chairName: string
  agenda: StoredAgendaItem[]
  status: DepartmentMeetingStatus
  signedDate: string | null
  finalizedAt: string | null
  attendeeCount: number
  attendedCount: number
  decisionCount: number
  openDecisionCount: number
  createdAt: string
  updatedAt: string
  version: number
}

export interface MeetingWrite {
  subjectId: string
  subjectName: string
  kind: DepartmentMeetingKind
  meetingDate: string
  location: string
  chairMembershipId: string
  agenda: StoredAgendaItem[]
}

/** Alt sorgular dış tabloya açık adla bağlanır (Drizzle tek tablolu seçimde kolonu nitelemez). */
const childCount = (table: string, extra = '') =>
  sql<number>`(select count(*)::int from ${sql.identifier(table)} c
    where c.institution_id = "department_meetings"."institution_id"
      and c.meeting_id = "department_meetings"."id"
      and c.archived_at is null ${sql.raw(extra)})`

const MEETING_COLUMNS = {
  id: meetings.id,
  subjectId: meetings.subjectId,
  subjectName: meetings.subjectName,
  kind: meetings.kind,
  meetingDate: meetings.meetingDate,
  location: meetings.location,
  chairMembershipId: meetings.chairMembershipId,
  chairName: chairUsers.name,
  agenda: meetings.agenda,
  status: meetings.status,
  signedDate: meetings.signedDate,
  finalizedAt: meetings.finalizedAt,
  attendeeCount: childCount('department_meeting_attendees'),
  attendedCount: childCount('department_meeting_attendees', "and c.status = 'attended'"),
  decisionCount: childCount('department_meeting_decisions'),
  openDecisionCount: childCount('department_meeting_decisions', "and c.status = 'open'"),
  createdAt: meetings.createdAt,
  updatedAt: meetings.updatedAt,
  version: meetings.version,
}

type MeetingRow = Omit<StoredMeeting, 'createdAt' | 'updatedAt' | 'finalizedAt'> & {
  createdAt: Date
  updatedAt: Date
  finalizedAt: Date | null
}
const toMeeting = (row: MeetingRow): StoredMeeting => ({
  ...row,
  attendeeCount: Number(row.attendeeCount),
  attendedCount: Number(row.attendedCount),
  decisionCount: Number(row.decisionCount),
  openDecisionCount: Number(row.openDecisionCount),
  finalizedAt: row.finalizedAt === null ? null : row.finalizedAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

function meetingSelect(db: Database) {
  return db
    .select(MEETING_COLUMNS)
    .from(meetings)
    .innerJoin(
      chairMembers,
      and(
        eq(chairMembers.institutionId, meetings.institutionId),
        eq(chairMembers.id, meetings.chairMembershipId),
      ),
    )
    .innerJoin(chairUsers, eq(chairUsers.id, chairMembers.userId))
}

const meetingOf = (institutionId: string) => eq(meetings.institutionId, institutionId)

export async function findMeeting(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredMeeting | null> {
  const [row] = await meetingSelect(db)
    .where(and(meetingOf(institutionId), eq(meetings.id, id)))
    .limit(1)
  return row === undefined ? null : toMeeting(row)
}

export interface MeetingQuery {
  page: number
  pageSize: number
  q?: string | undefined
  subjectId?: string | undefined
  kind?: DepartmentMeetingKind | undefined
  status?: DepartmentMeetingStatus | undefined
  from?: string | undefined
  to?: string | undefined
}

/** Toplantılar, yeniden eskiye; ders adında ya da yerde aranır. */
export async function listMeetings(
  db: Database,
  institutionId: string,
  query: MeetingQuery,
): Promise<{ items: StoredMeeting[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filters: (SQL | undefined)[] = [
    meetingOf(institutionId),
    search === undefined
      ? undefined
      : sql`(strpos(${foldSql(meetings.subjectName)}, ${search}) > 0 or strpos(${foldSql(meetings.location)}, ${search}) > 0)`,
    query.subjectId === undefined ? undefined : eq(meetings.subjectId, query.subjectId),
    query.kind === undefined ? undefined : eq(meetings.kind, query.kind),
    query.status === undefined ? undefined : eq(meetings.status, query.status),
    query.from === undefined ? undefined : gte(meetings.meetingDate, query.from),
    query.to === undefined ? undefined : lte(meetings.meetingDate, query.to),
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(meetings).where(where)
  const rows = await meetingSelect(db)
    .where(where)
    .orderBy(desc(meetings.meetingDate), desc(meetings.createdAt), asc(meetings.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toMeeting), total: totalRow?.total ?? 0 }
}

export async function insertMeeting(
  tx: Database,
  institutionId: string,
  input: MeetingWrite & { id: string; createdByUserId: string; now: Date },
): Promise<void> {
  const { now, ...rest } = input
  await tx.insert(meetings).values({
    institutionId,
    ...rest,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  })
}

/** Taslak düzeltmesi ya da kesinleştirme; sürüm tutmazsa `false` (409). */
export async function updateMeeting(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<MeetingWrite> & {
      status?: DepartmentMeetingStatus
      signedDate?: string
      finalizedAt?: Date
      finalizedByUserId?: string
    }
  },
): Promise<boolean> {
  const rows = await tx
    .update(meetings)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        meetingOf(institutionId),
        eq(meetings.id, input.id),
        eq(meetings.version, input.expectedVersion),
      ),
    )
    .returning({ id: meetings.id })
  return rows.length === 1
}

// --- Katılım ------------------------------------------------------------------------------------

export interface StoredAttendee {
  id: string
  membershipId: string
  name: string
  role: string
  active: boolean
  status: DepartmentMeetingAttendance
  version: number
}

export async function listAttendees(
  db: Database,
  institutionId: string,
  meetingId: string,
): Promise<StoredAttendee[]> {
  const rows = await db
    .select({
      id: attendees.id,
      membershipId: attendees.membershipId,
      name: users.name,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
      status: attendees.status,
      version: attendees.version,
    })
    .from(attendees)
    .innerJoin(
      memberships,
      and(
        eq(memberships.institutionId, attendees.institutionId),
        eq(memberships.id, attendees.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(attendees.institutionId, institutionId),
        eq(attendees.meetingId, meetingId),
        isNull(attendees.archivedAt),
      ),
    )
    .orderBy(asc(foldSql(users.name)), asc(attendees.id))
  return rows.map(({ deactivatedAt, ...row }) => ({ ...row, active: deactivatedAt === null }))
}

/**
 * Katılım listesini gövdedeki listeye eşitler: yeni kişi eklenir, durumu değişen güncellenir,
 * listeden çıkan arşivlenir.
 */
export async function syncAttendees(
  tx: Database,
  institutionId: string,
  input: {
    meetingId: string
    previous: readonly StoredAttendee[]
    next: readonly { membershipId: string; status: DepartmentMeetingAttendance }[]
    newId: () => string
    now: Date
  },
): Promise<void> {
  const previous = new Map(input.previous.map((row) => [row.membershipId, row]))
  const nextIds = new Set(input.next.map((row) => row.membershipId))
  const removed = input.previous.filter((row) => !nextIds.has(row.membershipId))
  if (removed.length > 0)
    await tx
      .update(attendees)
      .set({ archivedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(attendees.institutionId, institutionId),
          inArray(
            attendees.id,
            removed.map((row) => row.id),
          ),
        ),
      )
  const added = input.next.filter((row) => !previous.has(row.membershipId))
  if (added.length > 0)
    await tx.insert(attendees).values(
      added.map((row) => ({
        institutionId,
        id: input.newId(),
        meetingId: input.meetingId,
        membershipId: row.membershipId,
        status: row.status,
        createdAt: input.now,
        updatedAt: input.now,
      })),
    )
  for (const row of input.next) {
    const old = previous.get(row.membershipId)
    if (old === undefined || old.status === row.status) continue
    await tx
      .update(attendees)
      .set({ status: row.status, updatedAt: input.now, version: old.version + 1 })
      .where(and(eq(attendees.institutionId, institutionId), eq(attendees.id, old.id)))
  }
}

// --- Kararlar -----------------------------------------------------------------------------------

export interface StoredDecision {
  id: string
  meetingId: string
  agendaItemId: string
  text: string
  responsibleMembershipId: string
  responsibleName: string
  dueDate: string | null
  status: DepartmentDecisionStatus
  followUpNote: string | null
  statusChangedAt: string
  createdAt: string
  version: number
}

const DECISION_COLUMNS = {
  id: decisions.id,
  meetingId: decisions.meetingId,
  agendaItemId: decisions.agendaItemId,
  text: decisions.text,
  responsibleMembershipId: decisions.responsibleMembershipId,
  responsibleName: users.name,
  dueDate: decisions.dueDate,
  status: decisions.status,
  followUpNote: decisions.followUpNote,
  statusChangedAt: decisions.statusChangedAt,
  createdAt: decisions.createdAt,
  version: decisions.version,
}
type DecisionRow = Omit<StoredDecision, 'statusChangedAt' | 'createdAt'> & {
  statusChangedAt: Date
  createdAt: Date
}
const toDecision = (row: DecisionRow): StoredDecision => ({
  ...row,
  statusChangedAt: row.statusChangedAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
})

const decisionJoin = and(
  eq(memberships.institutionId, decisions.institutionId),
  eq(memberships.id, decisions.responsibleMembershipId),
)

export async function findDecision(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredDecision | null> {
  const [row] = await db
    .select(DECISION_COLUMNS)
    .from(decisions)
    .innerJoin(memberships, decisionJoin)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(decisions.institutionId, institutionId),
        eq(decisions.id, id),
        isNull(decisions.archivedAt),
      ),
    )
    .limit(1)
  return row === undefined ? null : toDecision(row)
}

/** Toplantının kararları (sıra core `numberDecisions` ile verilir). */
export async function listMeetingDecisions(
  db: Database,
  institutionId: string,
  meetingId: string,
): Promise<StoredDecision[]> {
  const rows = await db
    .select(DECISION_COLUMNS)
    .from(decisions)
    .innerJoin(memberships, decisionJoin)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(decisions.institutionId, institutionId),
        eq(decisions.meetingId, meetingId),
        isNull(decisions.archivedAt),
      ),
    )
    .orderBy(asc(decisions.createdAt), asc(decisions.id))
  return rows.map(toDecision)
}

export interface DecisionQuery {
  page: number
  pageSize: number
  status?: DepartmentDecisionStatus | undefined
  /** Yalnız termini `today`'den önce olan açık kararlar. */
  overdue?: boolean | undefined
  today: string
  responsibleMembershipId?: string | undefined
  subjectId?: string | undefined
}

export interface StoredDecisionWithMeeting extends StoredDecision {
  subjectName: string
  meetingDate: string
  meetingKind: DepartmentMeetingKind
  /** Bağlı gündem maddesinin başlığı (toplantının gündeminden). */
  agendaTitle: string
}

/**
 * Kesinleşmiş tutanakların kararları (takip listesi, K-453); termine göre (terminsiz sonda), sonra
 * toplantı günü.
 */
export async function listDecisions(
  db: Database,
  institutionId: string,
  query: DecisionQuery,
): Promise<{ items: StoredDecisionWithMeeting[]; total: number }> {
  const where = and(
    eq(decisions.institutionId, institutionId),
    isNull(decisions.archivedAt),
    eq(meetings.status, 'finalized'),
    query.overdue === true
      ? and(eq(decisions.status, 'open'), lt(decisions.dueDate, query.today))
      : undefined,
    query.status === undefined ? undefined : eq(decisions.status, query.status),
    query.responsibleMembershipId === undefined
      ? undefined
      : eq(decisions.responsibleMembershipId, query.responsibleMembershipId),
    query.subjectId === undefined ? undefined : eq(meetings.subjectId, query.subjectId),
  )
  const meetingJoin = and(
    eq(meetings.institutionId, decisions.institutionId),
    eq(meetings.id, decisions.meetingId),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(decisions)
    .innerJoin(meetings, meetingJoin)
    .where(where)
  const rows = await db
    .select({
      ...DECISION_COLUMNS,
      subjectName: meetings.subjectName,
      meetingDate: meetings.meetingDate,
      meetingKind: meetings.kind,
      agenda: meetings.agenda,
    })
    .from(decisions)
    .innerJoin(meetings, meetingJoin)
    .innerJoin(memberships, decisionJoin)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .orderBy(
      sql`${decisions.dueDate} asc nulls last`,
      desc(meetings.meetingDate),
      asc(decisions.createdAt),
      asc(decisions.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map(({ subjectName, meetingDate, meetingKind, agenda, ...row }) => ({
      ...toDecision(row),
      subjectName,
      meetingDate,
      meetingKind,
      agendaTitle: agenda.find((item) => item.id === row.agendaItemId)?.title ?? '',
    })),
    total: totalRow?.total ?? 0,
  }
}

export async function insertDecision(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    meetingId: string
    agendaItemId: string
    text: string
    responsibleMembershipId: string
    dueDate: string | null
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...rest } = input
  await tx.insert(decisions).values({
    institutionId,
    ...rest,
    status: 'open',
    followUpNote: null,
    statusChangedAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

/** Karar düzeltmesi, takip ya da arşiv; sürüm tutmazsa `false` (409). */
export async function updateDecision(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: {
      agendaItemId?: string
      text?: string
      responsibleMembershipId?: string
      dueDate?: string | null
      status?: DepartmentDecisionStatus
      followUpNote?: string | null
      statusChangedAt?: Date
      archivedAt?: Date
    }
  },
): Promise<boolean> {
  const rows = await tx
    .update(decisions)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(decisions.institutionId, institutionId),
        eq(decisions.id, input.id),
        eq(decisions.version, input.expectedVersion),
        isNull(decisions.archivedAt),
      ),
    )
    .returning({ id: decisions.id })
  return rows.length === 1
}

/** Toplantı kişileri: üyelik kimliği → rol ve etkinlik; kurumda olmayan kimlik haritada yok. */
export async function findMeetingStaff(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
): Promise<Map<string, { role: string; active: boolean }>> {
  if (membershipIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: memberships.id,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.id, [...new Set(membershipIds)]),
      ),
    )
  return new Map(
    rows.map((row) => [row.id, { role: row.role, active: row.deactivatedAt === null }]),
  )
}
