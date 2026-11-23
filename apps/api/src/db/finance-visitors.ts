import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'

import {
  ANONYMIZED_VISITOR_NAME,
  DEFAULT_VISITOR_SETTINGS,
  type VisitorAnonymizationReason,
  type VisitorBadgeRelease,
  type VisitorIdDocumentType,
  type VisitorPurpose,
  type VisitorSettings,
} from '@kampus/school-core/lib/finance-visitors.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { visitorLogs, visitorSettings } from './schema/finance-visitors.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Ziyaretçi kaydı deposu (DOM-FIN-141; ON-166). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Kural core `lib/finance-visitors.ts`'tedir; depo yalnız okur ve yazar. Kayıt silinmez,
 * anonimleştirilir.
 */

export interface StoredVisitor {
  id: string
  visitorName: string
  identityVerified: boolean
  identityDocumentType: VisitorIdDocumentType | null
  phone: string | null
  purpose: VisitorPurpose
  purposeNote: string | null
  hostMembershipId: string | null
  studentId: string | null
  visitOn: string
  checkedInAt: string
  checkedOutAt: string | null
  badgeNumber: string | null
  badgeReleasedAt: string | null
  badgeRelease: VisitorBadgeRelease | null
  privacyNoticeVersion: string
  anonymizedAt: string | null
  anonymizationReason: VisitorAnonymizationReason | null
  checkedInByUserId: string
  checkedOutByUserId: string | null
  createdAt: string
  updatedAt: string
  version: number
}

const COLUMNS = {
  id: visitorLogs.id,
  visitorName: visitorLogs.visitorName,
  identityVerified: visitorLogs.identityVerified,
  identityDocumentType: visitorLogs.identityDocumentType,
  phone: visitorLogs.phone,
  purpose: visitorLogs.purpose,
  purposeNote: visitorLogs.purposeNote,
  hostMembershipId: visitorLogs.hostMembershipId,
  studentId: visitorLogs.studentId,
  visitOn: visitorLogs.visitOn,
  checkedInAt: visitorLogs.checkedInAt,
  checkedOutAt: visitorLogs.checkedOutAt,
  badgeNumber: visitorLogs.badgeNumber,
  badgeReleasedAt: visitorLogs.badgeReleasedAt,
  badgeRelease: visitorLogs.badgeRelease,
  privacyNoticeVersion: visitorLogs.privacyNoticeVersion,
  anonymizedAt: visitorLogs.anonymizedAt,
  anonymizationReason: visitorLogs.anonymizationReason,
  checkedInByUserId: visitorLogs.checkedInByUserId,
  checkedOutByUserId: visitorLogs.checkedOutByUserId,
  createdAt: visitorLogs.createdAt,
  updatedAt: visitorLogs.updatedAt,
  version: visitorLogs.version,
}
type Instant = 'checkedInAt' | 'checkedOutAt' | 'badgeReleasedAt' | 'anonymizedAt'
type Row = Omit<StoredVisitor, Instant | 'createdAt' | 'updatedAt'> & {
  checkedInAt: Date
  checkedOutAt: Date | null
  badgeReleasedAt: Date | null
  anonymizedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
const toVisitor = (row: Row): StoredVisitor => ({
  ...row,
  checkedInAt: row.checkedInAt.toISOString(),
  checkedOutAt: row.checkedOutAt?.toISOString() ?? null,
  badgeReleasedAt: row.badgeReleasedAt?.toISOString() ?? null,
  anonymizedAt: row.anonymizedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})
const ofInstitution = (institutionId: string) => eq(visitorLogs.institutionId, institutionId)
/** Kart ziyaretçide: verilmiş, iade ya da kayıp işaretlenmemiş. */
const badgeOpen = and(isNotNull(visitorLogs.badgeNumber), isNull(visitorLogs.badgeReleasedAt))

export async function findVisitor(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredVisitor | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(visitorLogs)
    .where(and(ofInstitution(institutionId), eq(visitorLogs.id, id)))
    .limit(1)
  return row === undefined ? null : toVisitor(row)
}

export async function loadVisitorsByIds(
  db: Database,
  institutionId: string,
  ids: readonly string[],
): Promise<StoredVisitor[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select(COLUMNS)
    .from(visitorLogs)
    .where(and(ofInstitution(institutionId), inArray(visitorLogs.id, [...ids])))
  return rows.map(toVisitor)
}

export interface VisitorQuery {
  page: number
  pageSize: number
  q?: string | undefined
  /** Ziyaret günü (Europe/Istanbul). */
  date?: string | undefined
  status?: 'inside' | 'left' | undefined
  purpose?: VisitorPurpose | undefined
  /** `true`: kartı ziyaretçide kalanlar (iade edilmemiş). */
  badgeOutstanding?: boolean | undefined
}

/**
 * Ziyaretler: içeridekiler önce (en eski giriş önce, gün sonu uyarısı üstte), sonra çıkanlar en
 * yeni giriş önce. Arama ziyaretçi adında ve kart numarasında.
 */
export async function listVisitors(
  db: Database,
  institutionId: string,
  query: VisitorQuery,
): Promise<{ items: StoredVisitor[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const filters: (SQL | undefined)[] = [
    ofInstitution(institutionId),
    query.date === undefined ? undefined : eq(visitorLogs.visitOn, query.date),
    query.status === 'inside'
      ? isNull(visitorLogs.checkedOutAt)
      : query.status === 'left'
        ? isNotNull(visitorLogs.checkedOutAt)
        : undefined,
    query.purpose === undefined ? undefined : eq(visitorLogs.purpose, query.purpose),
    query.badgeOutstanding === true ? badgeOpen : undefined,
    search === undefined
      ? undefined
      : sql`(strpos(${foldSql(visitorLogs.visitorName)}, ${search}) > 0 or strpos(lower(coalesce(${visitorLogs.badgeNumber}, '')), ${search}) > 0)`,
  ]
  const where = and(...filters)
  const [totalRow] = await db.select({ total: count() }).from(visitorLogs).where(where)
  const rows = await db
    .select(COLUMNS)
    .from(visitorLogs)
    .where(where)
    .orderBy(
      sql`case when ${visitorLogs.checkedOutAt} is null then 0 else 1 end`,
      sql`case when ${visitorLogs.checkedOutAt} is null then ${visitorLogs.checkedInAt} end asc`,
      desc(visitorLogs.checkedInAt),
      asc(visitorLogs.id),
    )
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toVisitor), total: totalRow?.total ?? 0 }
}

/** Günün özeti: ziyaret, içeride, önceki günden içeride kalan ve ziyaretçide kalan kart sayısı. */
export async function visitorCounts(
  db: Database,
  institutionId: string,
  today: string,
): Promise<{ visitsToday: number; inside: number; insideFromEarlier: number; badgesOut: number }> {
  const [row] = await db
    .select({
      visitsToday: sql<number>`count(*) filter (where ${visitorLogs.visitOn} = ${today})::int`,
      inside: sql<number>`count(*) filter (where ${visitorLogs.checkedOutAt} is null)::int`,
      insideFromEarlier: sql<number>`count(*) filter (where ${visitorLogs.checkedOutAt} is null and ${visitorLogs.visitOn} < ${today})::int`,
      badgesOut: sql<number>`count(*) filter (where ${visitorLogs.badgeNumber} is not null and ${visitorLogs.badgeReleasedAt} is null)::int`,
    })
    .from(visitorLogs)
    .where(ofInstitution(institutionId))
  return {
    visitsToday: row?.visitsToday ?? 0,
    inside: row?.inside ?? 0,
    insideFromEarlier: row?.insideFromEarlier ?? 0,
    badgesOut: row?.badgesOut ?? 0,
  }
}

/** Ziyaretçide kalan kartlar → kaydın kimliği. */
export async function outstandingBadges(
  db: Database,
  institutionId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ badgeNumber: visitorLogs.badgeNumber, id: visitorLogs.id })
    .from(visitorLogs)
    .where(and(ofInstitution(institutionId), badgeOpen))
  return new Map(
    rows.flatMap((row) => (row.badgeNumber === null ? [] : [[row.badgeNumber, row.id]])),
  )
}

export async function insertVisitor(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    visitorName: string
    identityVerified: boolean
    identityDocumentType: VisitorIdDocumentType | null
    phone: string | null
    purpose: VisitorPurpose
    purposeNote: string | null
    hostMembershipId: string | null
    studentId: string | null
    visitOn: string
    checkedInAt: string
    badgeNumber: string | null
    privacyNoticeVersion: string
    checkedInByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, checkedInAt, ...fields } = input
  await tx.insert(visitorLogs).values({
    ...fields,
    institutionId,
    checkedInAt: new Date(checkedInAt),
    createdAt: now,
    updatedAt: now,
  })
}

/** Çıkış, kart ya da anonimleştirme yazması; sürüm tutmazsa `false` (409). */
export async function updateVisitor(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<{
      visitorName: string
      phone: null
      purposeNote: null
      studentId: null
      checkedOutAt: Date
      checkedOutByUserId: string
      badgeReleasedAt: Date
      badgeRelease: VisitorBadgeRelease
      anonymizedAt: Date
      anonymizationReason: VisitorAnonymizationReason
    }>
  },
): Promise<boolean> {
  const rows = await tx
    .update(visitorLogs)
    .set({ ...input.values, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(visitorLogs.id, input.id),
        eq(visitorLogs.version, input.expectedVersion),
      ),
    )
    .returning({ id: visitorLogs.id })
  return rows.length === 1
}

/** Anonimleştirme yazması (K-480): ad sabit metne; telefon, açıklama ve öğrenci bağı boşa. */
export function anonymizeVisitor(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; reason: VisitorAnonymizationReason; now: Date },
) {
  return updateVisitor(tx, institutionId, {
    id: input.id,
    expectedVersion: input.expectedVersion,
    now: input.now,
    values: {
      visitorName: ANONYMIZED_VISITOR_NAME,
      phone: null,
      purposeNote: null,
      studentId: null,
      anonymizedAt: input.now,
      anonymizationReason: input.reason,
    },
  })
}

/** Ziyaret edilen üyeliklerin adları (kurum içi). */
export async function memberNames(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
): Promise<Map<string, string>> {
  if (membershipIds.length === 0) return new Map()
  const rows = await db
    .select({ id: memberships.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.id, [...new Set(membershipIds)]),
      ),
    )
  return new Map(rows.map((row) => [row.id, row.name]))
}

// --- Saklama -------------------------------------------------------------------------------------

/**
 * Süresi dolan kayıtlar (K-480): anonimleştirilmemiş, çıkışı yapılmış, ziyaret günü + süre bugün
 * ya da önce; en eski süre sonu önce (sayfalı).
 */
export async function listRetentionDueVisitors(
  db: Database,
  institutionId: string,
  query: { retentionDays: number; today: string; page: number; pageSize: number },
): Promise<{ items: StoredVisitor[]; total: number }> {
  const where = and(
    ofInstitution(institutionId),
    isNull(visitorLogs.anonymizedAt),
    isNotNull(visitorLogs.checkedOutAt),
    sql`${visitorLogs.visitOn} + ${query.retentionDays}::int <= ${query.today}::date`,
  )
  const [totalRow] = await db.select({ total: count() }).from(visitorLogs).where(where)
  const rows = await db
    .select(COLUMNS)
    .from(visitorLogs)
    .where(where)
    .orderBy(asc(visitorLogs.visitOn), asc(visitorLogs.checkedInAt), asc(visitorLogs.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toVisitor), total: totalRow?.total ?? 0 }
}

// --- Ayar ----------------------------------------------------------------------------------------

export interface StoredVisitorSettings extends VisitorSettings {
  /** `If-Match` sürümü; ayar hiç kaydedilmediyse 1. */
  version: number
}

export async function loadVisitorSettings(
  db: Database,
  institutionId: string,
): Promise<StoredVisitorSettings> {
  const [row] = await db
    .select({
      retentionDays: visitorSettings.retentionDays,
      privacyNoticeVersion: visitorSettings.privacyNoticeVersion,
      badgeNumbers: visitorSettings.badgeNumbers,
      version: visitorSettings.version,
    })
    .from(visitorSettings)
    .where(eq(visitorSettings.institutionId, institutionId))
    .limit(1)
  return row ?? { ...DEFAULT_VISITOR_SETTINGS, version: 1 }
}

/** Ayarı sürüm koşuluyla yazar; tutmazsa `null` (409). İlk kayıt satırı sürüm 2 ile açar. */
export async function saveVisitorSettings(
  tx: Database,
  institutionId: string,
  input: VisitorSettings & { expectedVersion: number; now: Date },
): Promise<number | null> {
  const values = {
    retentionDays: input.retentionDays,
    privacyNoticeVersion: input.privacyNoticeVersion,
    badgeNumbers: input.badgeNumbers,
    updatedAt: input.now,
  }
  const [updated] = await tx
    .update(visitorSettings)
    .set({ ...values, version: sql`${visitorSettings.version} + 1` })
    .where(
      and(
        eq(visitorSettings.institutionId, institutionId),
        eq(visitorSettings.version, input.expectedVersion),
      ),
    )
    .returning({ version: visitorSettings.version })
  if (updated !== undefined) return updated.version
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(visitorSettings)
    .values({ ...values, institutionId, version: 2, createdAt: input.now })
    .onConflictDoNothing()
    .returning({ version: visitorSettings.version })
  return created?.version ?? null
}
