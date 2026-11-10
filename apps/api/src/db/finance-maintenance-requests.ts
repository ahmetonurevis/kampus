import { and, asc, count, desc, eq, inArray, isNull, max, notInArray, or, sql } from 'drizzle-orm'

import type { FixedAssetCategory } from '@kampus/school-core/lib/finance-fixed-assets.ts'
import {
  MAINTENANCE_DONE_STATUSES,
  MAINTENANCE_UNRESOLVED_STATUSES,
  type MaintenanceAssigneeType,
  type MaintenanceEvent,
  type MaintenancePriority,
  type MaintenanceState,
  type MaintenanceStatus,
} from '@kampus/school-core/lib/finance-maintenance-requests.ts'

import type { Database } from './client.ts'
import { memberships, users } from './schema/auth.ts'
import { fixedAssets } from './schema/finance-fixed-assets.ts'
import {
  maintenanceRequestEvents,
  maintenanceRequests,
} from './schema/finance-maintenance-requests.ts'
import { suppliers } from './schema/finance-suppliers.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Arıza ve bakım talebi deposu (DOM-FIN-089; ON-239). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-maintenance-requests.ts`'tedir; depo yalnız okur ve
 * yazar. `reportedByUserId` verilirse okuma bildirenin kendi talepleriyle daraltılır (öğretmen,
 * K-238). Geçmiş satırı yalnız eklenir.
 */

export interface StoredMaintenanceRequest {
  id: string
  sequence: number
  title: string
  description: string
  campusId: string | null
  location: string
  assetId: string | null
  assetTagNumber: string | null
  assetName: string | null
  assetCategory: FixedAssetCategory | null
  priority: MaintenancePriority
  status: MaintenanceStatus
  reportedByUserId: string
  reportedAt: string
  assigneeType: MaintenanceAssigneeType | null
  assigneeMembershipId: string | null
  assigneeSupplierId: string | null
  assignedAt: string | null
  startedAt: string | null
  resolvedAt: string | null
  resolvedDate: string | null
  resolution: string | null
  resolutionCostCents: number | null
  resolutionSupplierId: string | null
  closedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  version: number
}

type TimeKey = 'reportedAt' | 'assignedAt' | 'startedAt' | 'resolvedAt' | 'closedAt' | 'cancelledAt'

const COLUMNS = {
  id: maintenanceRequests.id,
  sequence: maintenanceRequests.sequence,
  title: maintenanceRequests.title,
  description: maintenanceRequests.description,
  campusId: maintenanceRequests.campusId,
  location: maintenanceRequests.location,
  assetId: maintenanceRequests.assetId,
  assetTagNumber: fixedAssets.tagNumber,
  assetName: fixedAssets.name,
  assetCategory: fixedAssets.category,
  priority: maintenanceRequests.priority,
  status: maintenanceRequests.status,
  reportedByUserId: maintenanceRequests.reportedByUserId,
  reportedAt: maintenanceRequests.reportedAt,
  assigneeType: maintenanceRequests.assigneeType,
  assigneeMembershipId: maintenanceRequests.assigneeMembershipId,
  assigneeSupplierId: maintenanceRequests.assigneeSupplierId,
  assignedAt: maintenanceRequests.assignedAt,
  startedAt: maintenanceRequests.startedAt,
  resolvedAt: maintenanceRequests.resolvedAt,
  resolvedDate: maintenanceRequests.resolvedDate,
  resolution: maintenanceRequests.resolution,
  resolutionCostCents: maintenanceRequests.resolutionCostCents,
  resolutionSupplierId: maintenanceRequests.resolutionSupplierId,
  closedAt: maintenanceRequests.closedAt,
  cancelledAt: maintenanceRequests.cancelledAt,
  cancelReason: maintenanceRequests.cancelReason,
  version: maintenanceRequests.version,
}

type Row = Omit<StoredMaintenanceRequest, TimeKey> & { reportedAt: Date } & Record<
    Exclude<TimeKey, 'reportedAt'>,
    Date | null
  >
const iso = (value: Date | null) => (value === null ? null : value.toISOString())
const toRequest = (row: Row): StoredMaintenanceRequest => ({
  ...row,
  reportedAt: row.reportedAt.toISOString(),
  assignedAt: iso(row.assignedAt),
  startedAt: iso(row.startedAt),
  resolvedAt: iso(row.resolvedAt),
  closedAt: iso(row.closedAt),
  cancelledAt: iso(row.cancelledAt),
})

/** Görme kapsamı: `reportedByUserId` verilirse yalnız o kullanıcının bildirimleri (K-238). */
export interface MaintenanceScope {
  reportedByUserId?: string | undefined
}

const ofInstitution = (institutionId: string, scope: MaintenanceScope = {}) =>
  and(
    eq(maintenanceRequests.institutionId, institutionId),
    isNull(maintenanceRequests.archivedAt),
    scope.reportedByUserId === undefined
      ? undefined
      : eq(maintenanceRequests.reportedByUserId, scope.reportedByUserId),
  )

const withAsset = (db: Database) =>
  db
    .select(COLUMNS)
    .from(maintenanceRequests)
    .leftJoin(
      fixedAssets,
      and(
        eq(fixedAssets.institutionId, maintenanceRequests.institutionId),
        eq(fixedAssets.id, maintenanceRequests.assetId),
      ),
    )

/**
 * Sıra: kapatılmamış ve iptal edilmemiş talepler önce; içlerinde acil önce, sonra yeni bildirim
 * önce; eşitlikte sıra numarası (deterministik).
 */
const ORDER = [
  sql`${maintenanceRequests.status} in ('closed', 'cancelled')`,
  sql`case ${maintenanceRequests.priority} when 'urgent' then 0 when 'normal' then 1 else 2 end`,
  desc(maintenanceRequests.reportedAt),
  desc(maintenanceRequests.sequence),
]

export async function findMaintenanceRequest(
  db: Database,
  institutionId: string,
  id: string,
  scope: MaintenanceScope = {},
): Promise<StoredMaintenanceRequest | null> {
  const [row] = await withAsset(db)
    .where(and(ofInstitution(institutionId, scope), eq(maintenanceRequests.id, id)))
    .limit(1)
  return row === undefined ? null : toRequest(row)
}

export interface MaintenanceQuery extends MaintenanceScope {
  page: number
  pageSize: number
  status?: MaintenanceStatus | undefined
  state?: MaintenanceState | undefined
  priority?: MaintenancePriority | undefined
  assetId?: string | undefined
  q?: string | undefined
}

/** `AT-0007` ya da `7` biçiminde aranan sıra numarası; başka metinde `null`. */
function searchedSequence(q: string): number | null {
  const match = /^(?:at-?)?0*(\d{1,9})$/i.exec(q.trim())
  return match ? Number(match[1]) : null
}

/** Talepler (K-237 sırası). `q` başlık, yer, demirbaş etiketi ve adında ya da talep numarasında. */
export async function listMaintenanceRequests(
  db: Database,
  institutionId: string,
  query: MaintenanceQuery,
): Promise<{ items: StoredMaintenanceRequest[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const sequence = query.q === undefined ? null : searchedSequence(query.q)
  const where = and(
    ofInstitution(institutionId, query),
    query.status === undefined ? undefined : eq(maintenanceRequests.status, query.status),
    query.state === undefined
      ? undefined
      : query.state === 'done'
        ? inArray(maintenanceRequests.status, [...MAINTENANCE_DONE_STATUSES])
        : notInArray(maintenanceRequests.status, [...MAINTENANCE_DONE_STATUSES]),
    query.priority === undefined ? undefined : eq(maintenanceRequests.priority, query.priority),
    query.assetId === undefined ? undefined : eq(maintenanceRequests.assetId, query.assetId),
    search === undefined
      ? undefined
      : or(
          sql`strpos(${foldSql(maintenanceRequests.title)}, ${search}) > 0`,
          sql`strpos(${foldSql(maintenanceRequests.location)}, ${search}) > 0`,
          sql`strpos(${foldSql(sql`coalesce(${fixedAssets.tagNumber}, '')`)}, ${search}) > 0`,
          sql`strpos(${foldSql(sql`coalesce(${fixedAssets.name}, '')`)}, ${search}) > 0`,
          sequence === null ? undefined : eq(maintenanceRequests.sequence, sequence),
        ),
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(maintenanceRequests)
    .leftJoin(
      fixedAssets,
      and(
        eq(fixedAssets.institutionId, maintenanceRequests.institutionId),
        eq(fixedAssets.id, maintenanceRequests.assetId),
      ),
    )
    .where(where)
  const rows = await withAsset(db)
    .where(where)
    .orderBy(...ORDER)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows.map(toRequest), total: totalRow?.total ?? 0 }
}

/** Demirbaşların çözülmemiş (açık, atanmış, çalışılan) arıza sayısı (K-239). */
export async function loadUnresolvedCounts(
  db: Database,
  institutionId: string,
  assetIds: readonly string[],
): Promise<Map<string, number>> {
  if (assetIds.length === 0) return new Map()
  const rows = await db
    .select({ assetId: maintenanceRequests.assetId, total: count() })
    .from(maintenanceRequests)
    .where(
      and(
        ofInstitution(institutionId),
        inArray(maintenanceRequests.assetId, [...new Set(assetIds)]),
        inArray(maintenanceRequests.status, [...MAINTENANCE_UNRESOLVED_STATUSES]),
      ),
    )
    .groupBy(maintenanceRequests.assetId)
  const found = new Map<string, number>()
  for (const row of rows) if (row.assetId !== null) found.set(row.assetId, row.total)
  return found
}

/** Kurumun sıradaki talep sırası; kurum kilidi altında çağrılır. */
export async function nextMaintenanceSequence(tx: Database, institutionId: string) {
  const [row] = await tx
    .select({ last: max(maintenanceRequests.sequence) })
    .from(maintenanceRequests)
    .where(eq(maintenanceRequests.institutionId, institutionId))
  return (row?.last ?? 0) + 1
}

export interface MaintenanceRequestWrite {
  id: string
  sequence: number
  title: string
  description: string
  campusId: string | null
  location: string
  assetId: string | null
  priority: MaintenancePriority
  reportedByUserId: string
  now: Date
}

export async function insertMaintenanceRequest(
  tx: Database,
  institutionId: string,
  input: MaintenanceRequestWrite,
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(maintenanceRequests).values({
    ...fields,
    institutionId,
    status: 'open',
    reportedAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

/** Geçişin yazdığı alanlar; verilmeyen alan değişmez. */
export type MaintenanceChanges = Partial<{
  status: MaintenanceStatus
  assigneeType: MaintenanceAssigneeType
  assigneeMembershipId: string | null
  assigneeSupplierId: string | null
  assignedAt: Date
  startedAt: Date
  resolvedAt: Date
  resolvedDate: string
  resolution: string
  resolutionCostCents: number | null
  resolutionSupplierId: string | null
  closedAt: Date
  cancelledAt: Date
  cancelReason: string
}>

/** Geçiş `where version = beklenen` ile yazılır; sürüm tutmazsa `false` (409). */
export async function updateMaintenanceRequest(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; changes: MaintenanceChanges; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(maintenanceRequests)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(maintenanceRequests.id, input.id),
        eq(maintenanceRequests.version, input.expectedVersion),
      ),
    )
    .returning({ id: maintenanceRequests.id })
  return rows.length === 1
}

export interface MaintenanceEventWrite {
  id: string
  requestId: string
  event: MaintenanceEvent
  fromStatus: MaintenanceStatus | null
  toStatus: MaintenanceStatus
  note: string | null
  assigneeType?: MaintenanceAssigneeType | null
  assigneeMembershipId?: string | null
  assigneeSupplierId?: string | null
  actorUserId: string
  now: Date
}

export async function insertMaintenanceEvent(
  tx: Database,
  institutionId: string,
  input: MaintenanceEventWrite,
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(maintenanceRequestEvents).values({
    ...fields,
    institutionId,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

export interface StoredMaintenanceEvent {
  id: string
  event: MaintenanceEvent
  fromStatus: MaintenanceStatus | null
  toStatus: MaintenanceStatus
  note: string | null
  assigneeType: MaintenanceAssigneeType | null
  assigneeMembershipId: string | null
  assigneeSupplierId: string | null
  actorUserId: string
  occurredAt: string
}

/** Talebin geçmişi, eskiden yeniye. */
export async function listMaintenanceEvents(
  db: Database,
  institutionId: string,
  requestId: string,
): Promise<StoredMaintenanceEvent[]> {
  const rows = await db
    .select({
      id: maintenanceRequestEvents.id,
      event: maintenanceRequestEvents.event,
      fromStatus: maintenanceRequestEvents.fromStatus,
      toStatus: maintenanceRequestEvents.toStatus,
      note: maintenanceRequestEvents.note,
      assigneeType: maintenanceRequestEvents.assigneeType,
      assigneeMembershipId: maintenanceRequestEvents.assigneeMembershipId,
      assigneeSupplierId: maintenanceRequestEvents.assigneeSupplierId,
      actorUserId: maintenanceRequestEvents.actorUserId,
      occurredAt: maintenanceRequestEvents.occurredAt,
    })
    .from(maintenanceRequestEvents)
    .where(
      and(
        eq(maintenanceRequestEvents.institutionId, institutionId),
        isNull(maintenanceRequestEvents.archivedAt),
        eq(maintenanceRequestEvents.requestId, requestId),
      ),
    )
    .orderBy(asc(maintenanceRequestEvents.occurredAt), asc(maintenanceRequestEvents.createdAt))
  return rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() }))
}

/** Kişi adları: kullanıcı kimliğiyle (bildiren, adımı yapan); kurum üyesi olmayan görünmez. */
export async function loadUserNames(
  db: Database,
  institutionId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.institutionId, institutionId),
        inArray(memberships.userId, [...new Set(userIds)]),
      ),
    )
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** Kişi adları: üyelik kimliğiyle (personel sorumlu). */
export async function loadMembershipNames(
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

/** Tedarikçi unvanları (pasif ve arşivlenmiş dahil: geçmiş kayıt adını korur). */
export async function loadSupplierNames(
  db: Database,
  institutionId: string,
  supplierIds: readonly string[],
): Promise<Map<string, string>> {
  if (supplierIds.length === 0) return new Map()
  const rows = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.institutionId, institutionId),
        inArray(suppliers.id, [...new Set(supplierIds)]),
      ),
    )
  return new Map(rows.map((row) => [row.id, row.name]))
}
