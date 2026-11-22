import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  max,
  min,
  ne,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm'

import type {
  SocialActivityKind,
  SocialActivityScope,
  SocialHourKind,
  SocialHourSource,
  SocialHourStatus,
  SocialTargets,
} from '@kampus/school-core/lib/finance-social-activities.ts'

import type { Database } from './client.ts'
import {
  socialActivities,
  socialActivityHours,
  socialActivitySettings,
} from './schema/finance-social-activities.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Sosyal etkinlik, saat ve hedef deposu (DOM-FIN-160; ON-170). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Arşivli etkinlik varsayılan okunmaz; saat kaydı arşivlenmez (ters kayıtla
 * düzeltilir). Kural core `lib/finance-social-activities.ts`'tedir.
 */

export interface StoredSocialActivity {
  id: string
  name: string
  kind: SocialActivityKind
  startDate: string
  endDate: string | null
  location: string
  responsibleMembershipId: string
  organizationScope: SocialActivityScope
  organizationName: string | null
  clubId: string | null
  archivedAt: Date | null
  version: number
}

export interface StoredSocialHourRow {
  id: string
  activityId: string
  studentId: string
  activityDate: string
  kind: SocialHourKind
  minutes: number
  status: SocialHourStatus
  source: SocialHourSource
  note: string | null
  enteredByUserId: string
  decidedByUserId: string | null
  decidedAt: Date | null
  rejectionReason: string | null
  reversesEntryId: string | null
  reversedByEntryId: string | null
  createdAt: Date
  version: number
}

const ACTIVITY = {
  id: socialActivities.id,
  name: socialActivities.name,
  kind: socialActivities.kind,
  startDate: socialActivities.startDate,
  endDate: socialActivities.endDate,
  location: socialActivities.location,
  responsibleMembershipId: socialActivities.responsibleMembershipId,
  organizationScope: socialActivities.organizationScope,
  organizationName: socialActivities.organizationName,
  clubId: socialActivities.clubId,
  archivedAt: socialActivities.archivedAt,
  version: socialActivities.version,
}
const HOUR = {
  id: socialActivityHours.id,
  activityId: socialActivityHours.activityId,
  studentId: socialActivityHours.studentId,
  activityDate: socialActivityHours.activityDate,
  kind: socialActivityHours.kind,
  minutes: socialActivityHours.minutes,
  status: socialActivityHours.status,
  source: socialActivityHours.source,
  note: socialActivityHours.note,
  enteredByUserId: socialActivityHours.enteredByUserId,
  decidedByUserId: socialActivityHours.decidedByUserId,
  decidedAt: socialActivityHours.decidedAt,
  rejectionReason: socialActivityHours.rejectionReason,
  reversesEntryId: socialActivityHours.reversesEntryId,
  reversedByEntryId: socialActivityHours.reversedByEntryId,
  createdAt: socialActivityHours.createdAt,
  version: socialActivityHours.version,
}

const ofInstitution = (institutionId: string) => eq(socialActivities.institutionId, institutionId)
const liveActivities = (institutionId: string) =>
  and(ofInstitution(institutionId), isNull(socialActivities.archivedAt))
const hoursOf = (institutionId: string) => eq(socialActivityHours.institutionId, institutionId)
/** Aynı gün kuralına sayılan etkin kayıt: bekleyen ya da onaylı, ters kaydı olmayan. */
const liveEntry = and(
  eq(socialActivityHours.kind, 'entry'),
  ne(socialActivityHours.status, 'rejected'),
  isNull(socialActivityHours.reversedByEntryId),
  isNull(socialActivityHours.archivedAt),
)

// --- Etkinlik ------------------------------------------------------------------------------------

export async function findSocialActivity(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredSocialActivity | null> {
  const [row] = await db
    .select(ACTIVITY)
    .from(socialActivities)
    .where(and(liveActivities(institutionId), eq(socialActivities.id, id)))
    .limit(1)
  return row ?? null
}

/** Etkinlikler kimliğe göre; arşivliler de (geçmiş saatlerin ve belgenin adları için). */
export async function loadSocialActivities(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<StoredSocialActivity[]> {
  if (ids.length === 0) return []
  return db
    .select(ACTIVITY)
    .from(socialActivities)
    .where(and(ofInstitution(institutionId), inArray(socialActivities.id, [...new Set(ids)])))
}

export async function listSocialActivities(
  db: Database,
  institutionId: string,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    kind?: SocialActivityKind | undefined
    responsibleMembershipId?: string | undefined
    startedBy?: string | undefined
  },
): Promise<{ items: StoredSocialActivity[]; total: number }> {
  const filters: (SQL | undefined)[] = [
    liveActivities(institutionId),
    query.q === undefined
      ? undefined
      : sql`strpos(${foldSql(sql`${socialActivities.name} || ' ' || coalesce(${socialActivities.organizationName}, '')`)}, ${foldSearch(query.q)}) > 0`,
    query.kind === undefined ? undefined : eq(socialActivities.kind, query.kind),
    query.responsibleMembershipId === undefined
      ? undefined
      : eq(socialActivities.responsibleMembershipId, query.responsibleMembershipId),
    query.startedBy === undefined
      ? undefined
      : sql`${socialActivities.startDate} <= ${query.startedBy}`,
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(socialActivities).where(where)
  const items = await db
    .select(ACTIVITY)
    .from(socialActivities)
    .where(where)
    .orderBy(desc(socialActivities.startDate), asc(socialActivities.name), asc(socialActivities.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

export async function insertSocialActivity(
  tx: Database,
  institutionId: string,
  input: Omit<StoredSocialActivity, 'version' | 'archivedAt'> & {
    createdByUserId: string
    now: Date
  },
) {
  const { now, ...values } = input
  await tx
    .insert(socialActivities)
    .values({ ...values, institutionId, createdAt: now, updatedAt: now })
}

export async function updateSocialActivity(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<Omit<StoredSocialActivity, 'id' | 'version'>>
  },
): Promise<boolean> {
  const rows = await tx
    .update(socialActivities)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        liveActivities(institutionId),
        eq(socialActivities.id, input.id),
        eq(socialActivities.version, input.expectedVersion),
      ),
    )
    .returning({ id: socialActivities.id })
  return rows.length === 1
}

/** Etkinliğin etkin kayıtlarının ilk ve son günü; kayıt yoksa `null`. */
export async function socialActivityEntryDays(
  db: Database,
  institutionId: string,
  activityId: string,
): Promise<{ first: string; last: string } | null> {
  const [row] = await db
    .select({
      first: min(socialActivityHours.activityDate),
      last: max(socialActivityHours.activityDate),
    })
    .from(socialActivityHours)
    .where(and(hoursOf(institutionId), eq(socialActivityHours.activityId, activityId), liveEntry))
  return row?.first == null || row.last == null ? null : { first: row.first, last: row.last }
}

/** Etkinlik başına onaylı net dakika ve bekleyen beyan sayısı. */
export async function socialActivityTotals(
  db: Database,
  institutionId: string,
  activityIds: readonly string[],
): Promise<Map<string, { approvedMinutes: number; pendingCount: number }>> {
  if (activityIds.length === 0) return new Map()
  const rows = await db
    .select({
      activityId: socialActivityHours.activityId,
      approved: sum(
        sql`case when ${socialActivityHours.status} = 'approved' then ${socialActivityHours.minutes} else 0 end`,
      ),
      pending: sum(sql`case when ${socialActivityHours.status} = 'pending' then 1 else 0 end`),
    })
    .from(socialActivityHours)
    .where(
      and(
        hoursOf(institutionId),
        inArray(socialActivityHours.activityId, [...new Set(activityIds)]),
      ),
    )
    .groupBy(socialActivityHours.activityId)
  return new Map(
    rows.map((row) => [
      row.activityId,
      { approvedMinutes: Number(row.approved ?? 0), pendingCount: Number(row.pending ?? 0) },
    ]),
  )
}

// --- Saat ----------------------------------------------------------------------------------------

/** Etkinlikte o gün etkin kaydı olan öğrenciler. */
export async function studentsWithEntryOn(
  db: Database,
  institutionId: string,
  input: { activityId: string; activityDate: string; studentIds: readonly string[] },
): Promise<Set<string>> {
  if (input.studentIds.length === 0) return new Set()
  const rows = await db
    .select({ studentId: socialActivityHours.studentId })
    .from(socialActivityHours)
    .where(
      and(
        hoursOf(institutionId),
        eq(socialActivityHours.activityId, input.activityId),
        eq(socialActivityHours.activityDate, input.activityDate),
        inArray(socialActivityHours.studentId, [...new Set(input.studentIds)]),
        liveEntry,
      ),
    )
  return new Set(rows.map((row) => row.studentId))
}

export interface NewSocialHour {
  id: string
  activityId: string
  studentId: string
  activityDate: string
  kind: SocialHourKind
  minutes: number
  status: SocialHourStatus
  source: SocialHourSource
  note: string | null
  enteredByUserId: string
  decidedByUserId: string | null
  decidedAt: Date | null
  reversesEntryId: string | null
}

export async function insertSocialHours(
  tx: Database,
  institutionId: string,
  rows: readonly NewSocialHour[],
  now: Date,
) {
  if (rows.length === 0) return
  await tx
    .insert(socialActivityHours)
    .values(rows.map((row) => ({ ...row, institutionId, createdAt: now, updatedAt: now })))
}

export async function findSocialHour(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredSocialHourRow | null> {
  const [row] = await db
    .select(HOUR)
    .from(socialActivityHours)
    .where(and(hoursOf(institutionId), eq(socialActivityHours.id, id)))
    .limit(1)
  return row ?? null
}

export async function loadSocialHoursByIds(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<StoredSocialHourRow[]> {
  if (ids.length === 0) return []
  return db
    .select(HOUR)
    .from(socialActivityHours)
    .where(and(hoursOf(institutionId), inArray(socialActivityHours.id, [...new Set(ids)])))
}

/** Bekleyen beyana karar (onay ya da gerekçeli ret); sürüm tutmazsa `false`. */
export async function decideSocialHour(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    status: 'approved' | 'rejected'
    rejectionReason: string | null
    userId: string
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(socialActivityHours)
    .set({
      status: input.status,
      rejectionReason: input.rejectionReason,
      decidedByUserId: input.userId,
      decidedAt: input.now,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        hoursOf(institutionId),
        eq(socialActivityHours.id, input.id),
        eq(socialActivityHours.status, 'pending'),
        eq(socialActivityHours.version, input.expectedVersion),
      ),
    )
    .returning({ id: socialActivityHours.id })
  return rows.length === 1
}

/** Onaylı kayda ters kayıt bağını bir kez yazar. */
export async function markSocialHourReversed(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reversalId: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(socialActivityHours)
    .set({
      reversedByEntryId: input.reversalId,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        hoursOf(institutionId),
        eq(socialActivityHours.id, input.id),
        eq(socialActivityHours.status, 'approved'),
        isNull(socialActivityHours.reversedByEntryId),
        eq(socialActivityHours.version, input.expectedVersion),
      ),
    )
    .returning({ id: socialActivityHours.id })
  return rows.length === 1
}

/** Saat kayıtları, yeni gün önce; durum, etkinlik ve öğrenci süzgeçli. */
export async function listSocialHours(
  db: Database,
  institutionId: string,
  query: {
    page: number
    pageSize: number
    status?: SocialHourStatus | undefined
    activityIds?: readonly string[] | undefined
    studentId?: string | undefined
  },
): Promise<{ items: StoredSocialHourRow[]; total: number }> {
  if (query.activityIds !== undefined && query.activityIds.length === 0)
    return { items: [], total: 0 }
  const where = and(
    hoursOf(institutionId),
    query.status === undefined ? undefined : eq(socialActivityHours.status, query.status),
    query.activityIds === undefined
      ? undefined
      : inArray(socialActivityHours.activityId, [...new Set(query.activityIds)]),
    query.studentId === undefined ? undefined : eq(socialActivityHours.studentId, query.studentId),
  )
  const [totalRow] = await db.select({ total: count() }).from(socialActivityHours).where(where)
  const items = await db
    .select(HOUR)
    .from(socialActivityHours)
    .where(where)
    .orderBy(
      desc(socialActivityHours.activityDate),
      desc(socialActivityHours.createdAt),
      asc(socialActivityHours.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

/** Öğrencilerin bütün saat kayıtları, gün sırasıyla (özet ve belge için). */
export async function loadStudentSocialHours(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<StoredSocialHourRow[]> {
  if (studentIds.length === 0) return []
  return db
    .select(HOUR)
    .from(socialActivityHours)
    .where(
      and(hoursOf(institutionId), inArray(socialActivityHours.studentId, [...new Set(studentIds)])),
    )
    .orderBy(asc(socialActivityHours.activityDate), asc(socialActivityHours.createdAt))
}

// --- Hedef ---------------------------------------------------------------------------------------

export async function findSocialActivitySettings(
  db: Database,
  institutionId: string,
): Promise<(SocialTargets & { version: number }) | null> {
  const [row] = await db
    .select({
      totalTargetHours: socialActivitySettings.totalTargetHours,
      yearlyTargetHours: socialActivitySettings.yearlyTargetHours,
      version: socialActivitySettings.version,
    })
    .from(socialActivitySettings)
    .where(eq(socialActivitySettings.institutionId, institutionId))
    .limit(1)
  return row ?? null
}

/** Hedefi yazar: sürüm 0 ilk satırı açar, aksi sürümlü günceller. Tutmazsa `false`. */
export async function saveSocialActivitySettings(
  tx: Database,
  institutionId: string,
  input: SocialTargets & { expectedVersion: number; userId: string; now: Date },
): Promise<boolean> {
  const values = {
    totalTargetHours: input.totalTargetHours,
    yearlyTargetHours: input.yearlyTargetHours,
    updatedByUserId: input.userId,
    updatedAt: input.now,
  }
  if (input.expectedVersion === 0) {
    const rows = await tx
      .insert(socialActivitySettings)
      .values({ ...values, institutionId, createdAt: input.now, version: 1 })
      .onConflictDoNothing()
      .returning({ version: socialActivitySettings.version })
    return rows.length === 1
  }
  const rows = await tx
    .update(socialActivitySettings)
    .set({ ...values, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(socialActivitySettings.institutionId, institutionId),
        eq(socialActivitySettings.version, input.expectedVersion),
      ),
    )
    .returning({ version: socialActivitySettings.version })
  return rows.length === 1
}

/** Sorumlunun bütün etkinlikleri (arşivliler dahil; geçmiş kayıtların kuyruğu için). */
export async function responsibleActivityIds(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: socialActivities.id })
    .from(socialActivities)
    .where(
      and(ofInstitution(institutionId), eq(socialActivities.responsibleMembershipId, membershipId)),
    )
  return rows.map((row) => row.id)
}
