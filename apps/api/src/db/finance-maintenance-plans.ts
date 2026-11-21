import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'

import { addDays } from '@kampus/school-core/lib/finance-opening-watch.ts'
import {
  MAINTENANCE_PLAN_WARNING_DAYS,
  type MaintenanceInspectionResult,
  type MaintenancePlanDueFilter,
  type MaintenancePlanResponsibleType,
  type MaintenancePlanType,
} from '@kampus/school-core/lib/finance-maintenance-plans.ts'
import type { MaintenanceStatus } from '@kampus/school-core/lib/finance-maintenance-requests.ts'

import type { Database } from './client.ts'
import { fixedAssets } from './schema/finance-fixed-assets.ts'
import { maintenanceInspections, maintenancePlans } from './schema/finance-maintenance-plans.ts'
import { maintenanceRequests } from './schema/finance-maintenance-requests.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Periyodik bakım planı deposu (DOM-FIN-092; ON-240). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Kural core `lib/finance-maintenance-plans.ts`'tedir. Sonraki denetim günü
 * saklanmaz: liste süzgeci ve sırası için SQL'de son denetimden (`previous_done_date` ile iptal
 * edilmemiş denetimlerin en geç günü) `make_interval(months => period_months)` ile hesaplanır;
 * core `addMonthsToDay` aynı ay sonu kuralını uygular (K-253).
 */

export interface StoredMaintenancePlan {
  id: string
  name: string
  type: MaintenancePlanType
  campusId: string | null
  location: string
  assetId: string | null
  assetTagNumber: string | null
  assetName: string | null
  periodMonths: number
  isLegal: boolean
  previousDoneDate: string | null
  /** Etkin son denetim günü (SQL'de hesaplanır; core takvimiyle aynıdır). */
  lastDoneDate: string | null
  responsibleType: MaintenancePlanResponsibleType | null
  responsibleMembershipId: string | null
  responsibleSupplierId: string | null
  version: number
}

const ofInstitution = (institutionId: string) =>
  and(eq(maintenancePlans.institutionId, institutionId), isNull(maintenancePlans.archivedAt))

/** İptal edilmemiş denetimlerin en geç günü ile sistemden önceki son günün büyüğü. */
const LAST_DONE = sql<string | null>`greatest(${maintenancePlans.previousDoneDate}, (
  select max(${maintenanceInspections.doneDate}) from ${maintenanceInspections}
  where ${maintenanceInspections.institutionId} = ${maintenancePlans.institutionId}
    and ${maintenanceInspections.planId} = ${maintenancePlans.id}
    and ${maintenanceInspections.cancelledAt} is null
))`
const NEXT_DUE = sql<
  string | null
>`(${LAST_DONE} + make_interval(months => ${maintenancePlans.periodMonths}))::date`

const COLUMNS = {
  id: maintenancePlans.id,
  name: maintenancePlans.name,
  type: maintenancePlans.type,
  campusId: maintenancePlans.campusId,
  location: maintenancePlans.location,
  assetId: maintenancePlans.assetId,
  assetTagNumber: fixedAssets.tagNumber,
  assetName: fixedAssets.name,
  periodMonths: maintenancePlans.periodMonths,
  isLegal: maintenancePlans.isLegal,
  previousDoneDate: maintenancePlans.previousDoneDate,
  lastDoneDate: sql<string | null>`${LAST_DONE}::text`,
  responsibleType: maintenancePlans.responsibleType,
  responsibleMembershipId: maintenancePlans.responsibleMembershipId,
  responsibleSupplierId: maintenancePlans.responsibleSupplierId,
  version: maintenancePlans.version,
}

const withAsset = (db: Database) =>
  db
    .select(COLUMNS)
    .from(maintenancePlans)
    .leftJoin(
      fixedAssets,
      and(
        eq(fixedAssets.institutionId, maintenancePlans.institutionId),
        eq(fixedAssets.id, maintenancePlans.assetId),
      ),
    )

export async function findMaintenancePlan(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredMaintenancePlan | null> {
  const [row] = await withAsset(db)
    .where(and(ofInstitution(institutionId), eq(maintenancePlans.id, id)))
    .limit(1)
  return row ?? null
}

export interface MaintenancePlanQuery {
  page: number
  pageSize: number
  /** Bugün (Europe/Istanbul); durum süzgeci buna göre çalışır. */
  today: string
  q?: string | undefined
  type?: MaintenancePlanType | undefined
  due?: MaintenancePlanDueFilter | undefined
  assetId?: string | undefined
}

/** Durum süzgeci (K-253): core `maintenancePlanSchedule` ile aynı sınırlar. */
function dueCondition(due: MaintenancePlanDueFilter, today: string): SQL {
  const warnUntil = addDays(today, MAINTENANCE_PLAN_WARNING_DAYS)
  switch (due) {
    case 'never':
      return sql`${LAST_DONE} is null`
    case 'overdue':
      return sql`${NEXT_DUE} < ${today}::date`
    case 'due_soon':
      return sql`${NEXT_DUE} between ${today}::date and ${warnUntil}::date`
    case 'ok':
      return sql`${NEXT_DUE} > ${warnUntil}::date`
    case 'attention':
      return sql`(${LAST_DONE} is null or ${NEXT_DUE} <= ${warnUntil}::date)`
    default:
      return due satisfies never
  }
}

/**
 * Planlar: hiç denetlenmemiş önce, sonra sonraki denetim günü en yakın (geciken önce); eşitlikte ad
 * ve kimlik (deterministik). `q` ad, yer, demirbaş etiketi ve adında arar.
 */
export async function listMaintenancePlans(
  db: Database,
  institutionId: string,
  query: MaintenancePlanQuery,
): Promise<{ items: StoredMaintenancePlan[]; total: number }> {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const where = and(
    ofInstitution(institutionId),
    query.type === undefined ? undefined : eq(maintenancePlans.type, query.type),
    query.assetId === undefined ? undefined : eq(maintenancePlans.assetId, query.assetId),
    query.due === undefined ? undefined : dueCondition(query.due, query.today),
    search === undefined
      ? undefined
      : sql`(strpos(${foldSql(maintenancePlans.name)}, ${search}) > 0
          or strpos(${foldSql(maintenancePlans.location)}, ${search}) > 0
          or strpos(${foldSql(sql`coalesce(${fixedAssets.tagNumber}, '')`)}, ${search}) > 0
          or strpos(${foldSql(sql`coalesce(${fixedAssets.name}, '')`)}, ${search}) > 0)`,
  )
  const [totalRow] = await db
    .select({ total: count() })
    .from(maintenancePlans)
    .leftJoin(
      fixedAssets,
      and(
        eq(fixedAssets.institutionId, maintenancePlans.institutionId),
        eq(fixedAssets.id, maintenancePlans.assetId),
      ),
    )
    .where(where)
  const rows = await withAsset(db)
    .where(where)
    .orderBy(sql`${NEXT_DUE} asc nulls first`, asc(maintenancePlans.name), asc(maintenancePlans.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items: rows, total: totalRow?.total ?? 0 }
}

export interface MaintenancePlanWrite {
  name: string
  type: MaintenancePlanType
  campusId: string | null
  location: string
  assetId: string | null
  periodMonths: number
  isLegal: boolean
  previousDoneDate: string | null
  responsibleType: MaintenancePlanResponsibleType | null
  responsibleMembershipId: string | null
  responsibleSupplierId: string | null
}

export async function insertMaintenancePlan(
  tx: Database,
  institutionId: string,
  input: MaintenancePlanWrite & { id: string; createdByUserId: string; now: Date },
): Promise<void> {
  const { now, ...fields } = input
  await tx
    .insert(maintenancePlans)
    .values({ ...fields, institutionId, createdAt: now, updatedAt: now })
}

/** Düzeltme ve arşiv `where version = beklenen` ile yazılır; sürüm tutmazsa `false` (409). */
export async function updateMaintenancePlan(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<MaintenancePlanWrite> & { archivedAt?: Date }
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(maintenancePlans)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        ofInstitution(institutionId),
        eq(maintenancePlans.id, input.id),
        eq(maintenancePlans.version, input.expectedVersion),
      ),
    )
    .returning({ id: maintenancePlans.id })
  return rows.length === 1
}

export interface StoredMaintenanceInspection {
  id: string
  doneDate: string
  performedBy: string
  result: MaintenanceInspectionResult
  documentNumber: string | null
  note: string | null
  recordedByUserId: string
  recordedAt: string
  maintenanceRequestId: string | null
  requestSequence: number | null
  requestStatus: MaintenanceStatus | null
  cancelledAt: string | null
  cancelReason: string | null
  cancelledByUserId: string | null
  version: number
}

const INSPECTION_COLUMNS = {
  id: maintenanceInspections.id,
  doneDate: maintenanceInspections.doneDate,
  performedBy: maintenanceInspections.performedBy,
  result: maintenanceInspections.result,
  documentNumber: maintenanceInspections.documentNumber,
  note: maintenanceInspections.note,
  recordedByUserId: maintenanceInspections.recordedByUserId,
  recordedAt: maintenanceInspections.recordedAt,
  maintenanceRequestId: maintenanceInspections.maintenanceRequestId,
  requestSequence: maintenanceRequests.sequence,
  requestStatus: maintenanceRequests.status,
  cancelledAt: maintenanceInspections.cancelledAt,
  cancelReason: maintenanceInspections.cancelReason,
  cancelledByUserId: maintenanceInspections.cancelledByUserId,
  version: maintenanceInspections.version,
}

const inspectionsOf = (db: Database, institutionId: string, planId: string, extra?: SQL) =>
  db
    .select(INSPECTION_COLUMNS)
    .from(maintenanceInspections)
    .leftJoin(
      maintenanceRequests,
      and(
        eq(maintenanceRequests.institutionId, maintenanceInspections.institutionId),
        eq(maintenanceRequests.id, maintenanceInspections.maintenanceRequestId),
      ),
    )
    .where(
      and(
        eq(maintenanceInspections.institutionId, institutionId),
        isNull(maintenanceInspections.archivedAt),
        eq(maintenanceInspections.planId, planId),
        extra,
      ),
    )

type InspectionRow = Omit<StoredMaintenanceInspection, 'recordedAt' | 'cancelledAt'> & {
  recordedAt: Date
  cancelledAt: Date | null
}
const toInspection = (row: InspectionRow): StoredMaintenanceInspection => ({
  ...row,
  recordedAt: row.recordedAt.toISOString(),
  cancelledAt: row.cancelledAt === null ? null : row.cancelledAt.toISOString(),
})

/** Planın denetimleri, yeniden eskiye (iptal edilenler dahil). */
export async function listMaintenanceInspections(
  db: Database,
  institutionId: string,
  planId: string,
): Promise<StoredMaintenanceInspection[]> {
  const rows = await inspectionsOf(db, institutionId, planId).orderBy(
    desc(maintenanceInspections.doneDate),
    desc(maintenanceInspections.recordedAt),
  )
  return rows.map(toInspection)
}

export async function findMaintenanceInspection(
  db: Database,
  institutionId: string,
  planId: string,
  inspectionId: string,
): Promise<StoredMaintenanceInspection | null> {
  const [row] = await inspectionsOf(
    db,
    institutionId,
    planId,
    eq(maintenanceInspections.id, inspectionId),
  ).limit(1)
  return row === undefined ? null : toInspection(row)
}

/** Planda aynı güne iptal edilmemiş denetim var mı (mükerrer kayıt). */
export async function inspectionOnDayExists(
  tx: Database,
  institutionId: string,
  planId: string,
  doneDate: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: maintenanceInspections.id })
    .from(maintenanceInspections)
    .where(
      and(
        eq(maintenanceInspections.institutionId, institutionId),
        eq(maintenanceInspections.planId, planId),
        eq(maintenanceInspections.doneDate, doneDate),
        isNull(maintenanceInspections.cancelledAt),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function insertMaintenanceInspection(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    planId: string
    doneDate: string
    performedBy: string
    result: MaintenanceInspectionResult
    documentNumber: string | null
    note: string | null
    recordedByUserId: string
    now: Date
  },
): Promise<void> {
  const { now, ...fields } = input
  await tx.insert(maintenanceInspections).values({
    ...fields,
    institutionId,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

/** Talep bağı ya da iptal; `where version = beklenen`, tutmazsa `false` (409). */
export async function updateMaintenanceInspection(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    changes: Partial<{
      maintenanceRequestId: string
      cancelledAt: Date
      cancelReason: string
      cancelledByUserId: string
    }>
    now: Date
  },
): Promise<boolean> {
  const rows = await tx
    .update(maintenanceInspections)
    .set({ ...input.changes, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eq(maintenanceInspections.institutionId, institutionId),
        eq(maintenanceInspections.id, input.id),
        eq(maintenanceInspections.version, input.expectedVersion),
      ),
    )
    .returning({ id: maintenanceInspections.id })
  return rows.length === 1
}
