import { and, asc, count, desc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm'

import type {
  IncidentKind,
  IncidentNotificationChannel,
  IncidentStatus,
  InjuredKind,
} from '@kampus/school-core/lib/finance-incidents.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import {
  incidentReportAddenda,
  incidentReportNotifications,
  incidentReports,
  incidentReportWitnesses,
} from './schema/finance-incidents.ts'

/**
 * Kaza ve yaralanma tutanağı deposu (DOM-FIN-146; ON-162). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-incidents.ts`'tedir; şifreleme ve çözme servistedir, depo
 * şifreli değeri olduğu gibi okur ve yazar. Kesinleşen satırı tetikleyici korur.
 */

const t = incidentReports

export interface StoredIncidentReport {
  id: string
  status: IncidentStatus
  injuredKind: InjuredKind
  studentId: string | null
  injuredMembershipId: string | null
  occurredAt: string
  location: string
  kind: IncidentKind
  descriptionCiphertext: string
  descriptionKeyVersion: number
  healthCiphertext: string
  healthKeyVersion: number
  firstAidByMembershipId: string | null
  responsibleMembershipId: string
  createdByUserId: string
  finalizedAt: string | null
  finalizedByUserId: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const COLUMNS = {
  id: t.id,
  status: t.status,
  injuredKind: t.injuredKind,
  studentId: t.studentId,
  injuredMembershipId: t.injuredMembershipId,
  occurredAt: t.occurredAt,
  location: t.location,
  kind: t.kind,
  descriptionCiphertext: t.descriptionCiphertext,
  descriptionKeyVersion: t.descriptionKeyVersion,
  healthCiphertext: t.healthCiphertext,
  healthKeyVersion: t.healthKeyVersion,
  firstAidByMembershipId: t.firstAidByMembershipId,
  responsibleMembershipId: t.responsibleMembershipId,
  createdByUserId: t.createdByUserId,
  finalizedAt: t.finalizedAt,
  finalizedByUserId: t.finalizedByUserId,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  version: t.version,
}

type Row = Omit<StoredIncidentReport, 'occurredAt' | 'finalizedAt' | 'createdAt' | 'updatedAt'> & {
  occurredAt: Date
  finalizedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toReport = (row: Row): StoredIncidentReport => ({
  ...row,
  occurredAt: row.occurredAt.toISOString(),
  finalizedAt: row.finalizedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

/** Tutanak; başka kurumun ya da olmayan tutanak `null`. */
export async function findIncidentReport(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredIncidentReport | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(t)
    .where(and(eq(t.institutionId, institutionId), eq(t.id, id)))
    .limit(1)
  return row === undefined ? null : toReport(row)
}

export interface IncidentListQuery {
  page: number
  pageSize: number
  status?: IncidentStatus | undefined
  injuredKind?: InjuredKind | undefined
  studentId?: string | undefined
  /** Europe/Istanbul gün sınırlarının UTC anları (`from` dahil, `to` hariç). */
  fromAt?: Date | undefined
  toAt?: Date | undefined
  /** Yalnız bu kullanıcının açtıkları (yönetici dışı roller, K-494). */
  createdByUserId?: string | undefined
}

/** Tutanak listesi: en yeni olay önce. */
export async function listIncidentReports(
  db: Database,
  institutionId: string,
  query: IncidentListQuery,
): Promise<{ items: StoredIncidentReport[]; total: number }> {
  const filters: (SQL | undefined)[] = [
    eq(t.institutionId, institutionId),
    query.status === undefined ? undefined : eq(t.status, query.status),
    query.injuredKind === undefined ? undefined : eq(t.injuredKind, query.injuredKind),
    query.studentId === undefined ? undefined : eq(t.studentId, query.studentId),
    query.fromAt === undefined ? undefined : gte(t.occurredAt, query.fromAt),
    query.toAt === undefined ? undefined : lt(t.occurredAt, query.toAt),
    query.createdByUserId === undefined ? undefined : eq(t.createdByUserId, query.createdByUserId),
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(t).where(where)
  const rows = await db
    .select(COLUMNS)
    .from(t)
    .where(where)
    .orderBy(desc(t.occurredAt), asc(t.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toReport), total: totalRow?.total ?? 0 }
}

/** Velinin çocuklarının kesinleşmiş tutanakları (K-495); çocuk yoksa boş. */
export async function listFinalizedStudentReports(
  db: Database,
  institutionId: string,
  query: { page: number; pageSize: number; studentIds: readonly string[] },
): Promise<{ items: StoredIncidentReport[]; total: number }> {
  if (query.studentIds.length === 0) return { items: [], total: 0 }
  const where = and(
    eq(t.institutionId, institutionId),
    eq(t.status, 'finalized'),
    eq(t.injuredKind, 'student'),
    inArray(t.studentId, [...new Set(query.studentIds)]),
  )
  const [totalRow] = await db.select({ total: count() }).from(t).where(where)
  const rows = await db
    .select(COLUMNS)
    .from(t)
    .where(where)
    .orderBy(desc(t.occurredAt), asc(t.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toReport), total: totalRow?.total ?? 0 }
}

export interface IncidentReportColumns {
  occurredAt: string
  location: string
  kind: IncidentKind
  descriptionCiphertext: string
  descriptionKeyVersion: number
  healthCiphertext: string
  healthKeyVersion: number
  firstAidByMembershipId: string | null
  responsibleMembershipId: string
}

export async function insertIncidentReport(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    injuredKind: InjuredKind
    studentId: string | null
    injuredMembershipId: string | null
    columns: IncidentReportColumns
    witnessMembershipIds: readonly string[]
    userId: string
    now: Date
  },
): Promise<void> {
  const { columns, now } = input
  await tx.insert(t).values({
    institutionId,
    id: input.id,
    injuredKind: input.injuredKind,
    studentId: input.studentId,
    injuredMembershipId: input.injuredMembershipId,
    ...columns,
    occurredAt: new Date(columns.occurredAt),
    createdByUserId: input.userId,
    createdAt: now,
    updatedAt: now,
  })
  await writeWitnesses(tx, institutionId, input.id, input.witnessMembershipIds, now)
}

async function writeWitnesses(
  tx: Database,
  institutionId: string,
  reportId: string,
  membershipIds: readonly string[],
  now: Date,
) {
  if (membershipIds.length === 0) return
  await tx.insert(incidentReportWitnesses).values(
    membershipIds.map((membershipId, position) => ({
      institutionId,
      reportId,
      membershipId,
      position,
      createdAt: now,
      updatedAt: now,
    })),
  )
}

/** Taslak düzeltmesi; sürüm tutmazsa ya da tutanak kesinleştiyse `false` (409). */
export async function updateIncidentReport(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    columns: IncidentReportColumns
    witnessMembershipIds?: readonly string[] | undefined
    now: Date
  },
): Promise<boolean> {
  const { columns, now } = input
  const rows = await tx
    .update(t)
    .set({
      ...columns,
      occurredAt: new Date(columns.occurredAt),
      updatedAt: now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(t.institutionId, institutionId),
        eq(t.id, input.id),
        eq(t.status, 'draft'),
        eq(t.version, input.expectedVersion),
      ),
    )
    .returning({ id: t.id })
  if (rows.length !== 1) return false
  if (input.witnessMembershipIds !== undefined) {
    await tx
      .delete(incidentReportWitnesses)
      .where(
        and(
          eq(incidentReportWitnesses.institutionId, institutionId),
          eq(incidentReportWitnesses.reportId, input.id),
        ),
      )
    await writeWitnesses(tx, institutionId, input.id, input.witnessMembershipIds, now)
  }
  return true
}

/** Kesinleştirme; sürüm tutmazsa `false` (409). */
export async function finalizeIncidentReport(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(t)
    .set({
      status: 'finalized',
      finalizedAt: input.now,
      finalizedByUserId: input.userId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(t.institutionId, institutionId),
        eq(t.id, input.id),
        eq(t.status, 'draft'),
        eq(t.version, input.expectedVersion),
      ),
    )
    .returning({ id: t.id })
  return rows.length === 1
}

/** Tutanakların tanıkları (sırayla). */
export async function loadIncidentWitnesses(
  db: Database,
  institutionId: string,
  reportIds: readonly string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (reportIds.length === 0) return map
  const rows = await db
    .select({
      reportId: incidentReportWitnesses.reportId,
      membershipId: incidentReportWitnesses.membershipId,
    })
    .from(incidentReportWitnesses)
    .where(
      and(
        eq(incidentReportWitnesses.institutionId, institutionId),
        inArray(incidentReportWitnesses.reportId, [...new Set(reportIds)]),
      ),
    )
    .orderBy(asc(incidentReportWitnesses.reportId), asc(incidentReportWitnesses.position))
  for (const row of rows)
    map.set(row.reportId, [...(map.get(row.reportId) ?? []), row.membershipId])
  return map
}

export interface StoredIncidentNotification {
  id: string
  reportId: string
  notifiedAt: string
  channel: IncidentNotificationChannel
  notifiedByMembershipId: string
  recordedByUserId: string
  createdAt: string
}

/** Tutanakların veli bildirimleri (en eski önce). */
export async function loadIncidentNotifications(
  db: Database,
  institutionId: string,
  reportIds: readonly string[],
): Promise<Map<string, StoredIncidentNotification[]>> {
  const n = incidentReportNotifications
  const map = new Map<string, StoredIncidentNotification[]>()
  if (reportIds.length === 0) return map
  const rows = await db
    .select({
      id: n.id,
      reportId: n.reportId,
      notifiedAt: n.notifiedAt,
      channel: n.channel,
      notifiedByMembershipId: n.notifiedByMembershipId,
      recordedByUserId: n.recordedByUserId,
      createdAt: n.createdAt,
    })
    .from(n)
    .where(and(eq(n.institutionId, institutionId), inArray(n.reportId, [...new Set(reportIds)])))
    .orderBy(asc(n.reportId), asc(n.notifiedAt), asc(n.id))
  for (const row of rows)
    map.set(row.reportId, [
      ...(map.get(row.reportId) ?? []),
      { ...row, notifiedAt: row.notifiedAt.toISOString(), createdAt: row.createdAt.toISOString() },
    ])
  return map
}

export async function insertIncidentNotification(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    reportId: string
    notifiedAt: string
    channel: IncidentNotificationChannel
    notifiedByMembershipId: string
    userId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(incidentReportNotifications).values({
    institutionId,
    id: input.id,
    reportId: input.reportId,
    notifiedAt: new Date(input.notifiedAt),
    channel: input.channel,
    notifiedByMembershipId: input.notifiedByMembershipId,
    recordedByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

export interface StoredIncidentAddendum {
  id: string
  noteCiphertext: string
  noteKeyVersion: number
  createdByUserId: string
  createdByName: string | null
  createdAt: string
}

/** Tutanağın ek notları (en eski önce); yazanın adıyla. */
export async function loadIncidentAddenda(
  db: Database,
  institutionId: string,
  reportId: string,
): Promise<StoredIncidentAddendum[]> {
  const a = incidentReportAddenda
  const rows = await db
    .select({
      id: a.id,
      noteCiphertext: a.noteCiphertext,
      noteKeyVersion: a.noteKeyVersion,
      createdByUserId: a.createdByUserId,
      createdByName: users.name,
      createdAt: a.createdAt,
    })
    .from(a)
    .leftJoin(users, eq(users.id, a.createdByUserId))
    .where(and(eq(a.institutionId, institutionId), eq(a.reportId, reportId)))
    .orderBy(asc(a.createdAt), asc(a.id))
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export async function countIncidentAddenda(
  db: Database,
  institutionId: string,
  reportId: string,
): Promise<number> {
  const a = incidentReportAddenda
  const [row] = await db
    .select({ total: count() })
    .from(a)
    .where(and(eq(a.institutionId, institutionId), eq(a.reportId, reportId)))
  return row?.total ?? 0
}

export async function insertIncidentAddendum(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    reportId: string
    noteCiphertext: string
    noteKeyVersion: number
    userId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(incidentReportAddenda).values({
    institutionId,
    id: input.id,
    reportId: input.reportId,
    noteCiphertext: input.noteCiphertext,
    noteKeyVersion: input.noteKeyVersion,
    createdByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

export interface IncidentMember {
  role: string
  active: boolean
  name: string
}

/** Üyelikler (kurumda olmayan anahtar dönmez): rol, etkinlik ve ad. */
export async function loadIncidentMembers(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
): Promise<Map<string, IncidentMember>> {
  const ids = [...new Set(membershipIds)]
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({
      id: memberships.id,
      role: memberships.role,
      deactivatedAt: memberships.deactivatedAt,
      name: users.name,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.institutionId, institutionId), inArray(memberships.id, ids)))
  return new Map(
    rows.map((row) => [
      row.id,
      { role: row.role, active: row.deactivatedAt === null, name: row.name },
    ]),
  )
}
