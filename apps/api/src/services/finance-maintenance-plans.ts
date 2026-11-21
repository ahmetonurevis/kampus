import { randomUUID } from 'node:crypto'

import {
  maintenanceInspectionCancelSchema,
  maintenanceInspectionSchema,
  maintenancePlanSchedule,
  maintenancePlanSchema,
  maintenancePlansCsv,
  maintenanceRequestFromInspection,
  planMaintenanceInspection,
  planMaintenanceInspectionCancel,
  planMaintenancePlan,
  planMaintenancePlanUpdate,
  updateMaintenancePlanSchema,
  type MaintenancePlanChecks,
  type MaintenancePlanResponsibleInput,
} from '@kampus/school-core/lib/finance-maintenance-plans.ts'
import { maintenanceRequestNumber } from '@kampus/school-core/lib/finance-maintenance-requests.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { findAssigneeMembership } from '../db/finance-fixed-asset-assignments.ts'
import { findAssetByTag } from '../db/finance-fixed-asset-counts.ts'
import {
  findMaintenanceInspection,
  findMaintenancePlan,
  insertMaintenanceInspection,
  insertMaintenancePlan,
  inspectionOnDayExists,
  listMaintenanceInspections,
  listMaintenancePlans,
  updateMaintenanceInspection,
  updateMaintenancePlan,
  type MaintenancePlanQuery,
  type MaintenancePlanWrite,
  type StoredMaintenanceInspection,
  type StoredMaintenancePlan,
} from '../db/finance-maintenance-plans.ts'
import {
  insertMaintenanceEvent,
  insertMaintenanceRequest,
  loadMembershipNames,
  loadSupplierNames,
  loadUserNames,
  nextMaintenanceSequence,
} from '../db/finance-maintenance-requests.ts'
import { findSupplier } from '../db/finance-suppliers.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { campusNames } from './finance-fixed-assets.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Periyodik bakım planı ve denetim kaydı (DOM-FIN-092; ON-240). Kural core
 * `lib/finance-maintenance-plans.ts`'tedir; servis kurum kilidi altında planı, demirbaşı (etiketle),
 * sorumluyu ve kampüsü yükler, yazmaları tek transaction'da yapar. Takvim (son ve sonraki denetim,
 * durum) her okumada core `maintenancePlanSchedule` ile `ctx.now`'dan üretilir (K-253). Uygunsuz
 * denetimden arıza talebi DOM-FIN-089 deposuyla aynı transaction'da açılır (K-254). Denetim kaydına
 * alan adları yazılır; metinler yazılmaz. Rol ve modül denetimi rotadadır.
 */

const PLAN_ENTITY = 'maintenance_plans'
const INSPECTION_ENTITY = 'maintenance_inspections'
const CSV_BATCH = 100

interface Names {
  users: ReadonlyMap<string, string>
  members: ReadonlyMap<string, string>
  suppliers: ReadonlyMap<string, string>
  campuses: ReadonlyMap<string, string>
}

const present = (ids: readonly (string | null)[]) => ids.filter((id): id is string => id !== null)

async function namesFor(
  db: Database,
  institutionId: string,
  plans: readonly StoredMaintenancePlan[],
  inspections: readonly StoredMaintenanceInspection[] = [],
): Promise<Names> {
  const [users, members, suppliers, campuses] = await Promise.all([
    loadUserNames(
      db,
      institutionId,
      inspections.flatMap((item) => present([item.recordedByUserId, item.cancelledByUserId])),
    ),
    loadMembershipNames(
      db,
      institutionId,
      present(plans.map((plan) => plan.responsibleMembershipId)),
    ),
    loadSupplierNames(db, institutionId, present(plans.map((plan) => plan.responsibleSupplierId))),
    campusNames(
      db,
      institutionId,
      plans.map((plan) => plan.campusId),
    ),
  ])
  return { users, members, suppliers, campuses }
}

function responsibleView(plan: StoredMaintenancePlan, names: Names) {
  if (plan.responsibleType === null) return null
  const id =
    plan.responsibleType === 'staff' ? plan.responsibleMembershipId : plan.responsibleSupplierId
  if (id === null) return null
  const name =
    (plan.responsibleType === 'staff' ? names.members.get(id) : names.suppliers.get(id)) ?? null
  return { type: plan.responsibleType, id, name }
}

/** Planın yanıt görünümü: takvim `ctx.now`'dan hesaplanır, saklanmaz (K-253). */
function planView(ctx: ServiceContext, plan: StoredMaintenancePlan, names: Names) {
  const schedule = maintenancePlanSchedule(
    { periodMonths: plan.periodMonths, previousDoneDate: plan.lastDoneDate },
    ctx.now,
  )
  return {
    id: plan.id,
    name: plan.name,
    type: plan.type,
    campusId: plan.campusId,
    campusName: plan.campusId === null ? null : (names.campuses.get(plan.campusId) ?? null),
    location: plan.location,
    asset:
      plan.assetId === null
        ? null
        : { id: plan.assetId, tagNumber: plan.assetTagNumber ?? '', name: plan.assetName ?? '' },
    periodMonths: plan.periodMonths,
    isLegal: plan.isLegal,
    previousDoneDate: plan.previousDoneDate,
    lastDoneDate: schedule.lastDoneDate,
    nextDueDate: schedule.nextDueDate,
    dueStatus: schedule.status,
    daysLeft: schedule.daysLeft,
    responsible: responsibleView(plan, names),
    version: plan.version,
  }
}

function inspectionView(item: StoredMaintenanceInspection, names: Names) {
  return {
    id: item.id,
    doneDate: item.doneDate,
    performedBy: item.performedBy,
    result: item.result,
    documentNumber: item.documentNumber,
    note: item.note,
    recordedByName: names.users.get(item.recordedByUserId) ?? null,
    recordedAt: item.recordedAt,
    maintenanceRequest:
      item.maintenanceRequestId === null
        ? null
        : {
            id: item.maintenanceRequestId,
            number:
              item.requestSequence === null ? '' : maintenanceRequestNumber(item.requestSequence),
            status: item.requestStatus,
          },
    cancelledAt: item.cancelledAt,
    cancelReason: item.cancelReason,
    cancelledByName:
      item.cancelledByUserId === null ? null : (names.users.get(item.cancelledByUserId) ?? null),
    version: item.version,
  }
}

async function planOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findMaintenancePlan(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

async function detailOf(db: Database, ctx: ServiceContext, id: string) {
  const plan = await planOf(db, ctx, id)
  const inspections = await listMaintenanceInspections(db, ctx.institutionId, id)
  const names = await namesFor(db, ctx.institutionId, [plan], inspections)
  return {
    ...planView(ctx, plan, names),
    inspections: inspections.map((item) => inspectionView(item, names)),
  }
}

type ListQuery = Omit<MaintenancePlanQuery, 'today'>

export async function listMaintenancePlansFor(ctx: ServiceContext, query: ListQuery) {
  const { items, total } = await listMaintenancePlans(ctx.db, ctx.institutionId, {
    ...query,
    today: dayKey(ctx.now),
  })
  const names = await namesFor(ctx.db, ctx.institutionId, items)
  return { items: items.map((item) => planView(ctx, item, names)), total }
}

export function getMaintenancePlanFor(ctx: ServiceContext, id: string) {
  return detailOf(ctx.db, ctx, id)
}

/**
 * Plan listesinin CSV'si (K-255): süzgeçle eşleşen bütün planlar, listedeki sırayla. Sorumlu
 * personel adı taşıdığı için rota taze oturum ister; dosya denetime düşer
 * (`finance.maintenance_plan_export`).
 */
export async function maintenancePlansCsvFor(
  ctx: ServiceContext,
  query: Omit<ListQuery, 'page' | 'pageSize'>,
): Promise<{ csv: string; filename: string }> {
  const plans: ReturnType<typeof planView>[] = []
  for (let page = 1; ; page += 1) {
    const batch = await listMaintenancePlansFor(ctx, { ...query, page, pageSize: CSV_BATCH })
    plans.push(...batch.items)
    if (batch.items.length < CSV_BATCH) break
  }
  const csv = maintenancePlansCsv(
    plans.map((plan) => ({
      name: plan.name,
      type: plan.type,
      isLegal: plan.isLegal,
      campusName: plan.campusName,
      location: plan.location,
      assetTagNumber: plan.asset?.tagNumber ?? null,
      periodMonths: plan.periodMonths,
      responsibleName: plan.responsible?.name ?? null,
      lastDoneDate: plan.lastDoneDate,
      nextDueDate: plan.nextDueDate,
      status: plan.dueStatus,
      daysLeft: plan.daysLeft,
    })),
  )
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.maintenance_plan_export',
    entityType: PLAN_ENTITY,
    entityId: ctx.institutionId,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return { csv, filename: `bakim-plani-${dayKey(ctx.now)}.csv` }
}

/** Sorumlu, demirbaş ve kampüs denetimi için verilen alanları kurum kilidi altında yükler. */
async function loadChecks(
  tx: Database,
  ctx: ServiceContext,
  refs: {
    assetTagNumber?: string | null | undefined
    campusId?: string | null | undefined
    responsible?: MaintenancePlanResponsibleInput | undefined
  },
): Promise<{ checks: MaintenancePlanChecks; assetId: string | null | undefined }> {
  const checks: MaintenancePlanChecks = { today: dayKey(ctx.now) }
  let assetId: string | null | undefined
  if (refs.assetTagNumber === null) assetId = null
  else if (refs.assetTagNumber !== undefined) {
    const asset = await findAssetByTag(tx, ctx.institutionId, refs.assetTagNumber)
    checks.asset = asset
    assetId = asset?.id ?? null
  }
  if (refs.campusId !== undefined && refs.campusId !== null)
    checks.campusFound = (await campusNames(tx, ctx.institutionId, [refs.campusId])).size === 1
  const responsible = refs.responsible
  if (responsible?.type === 'staff')
    checks.staff = await findAssigneeMembership(tx, ctx.institutionId, responsible.membershipId)
  if (responsible?.type === 'supplier')
    checks.supplier = await findSupplier(tx, ctx.institutionId, responsible.supplierId)
  return { checks, assetId }
}

function responsibleColumns(responsible: MaintenancePlanResponsibleInput) {
  return {
    responsibleType: responsible?.type ?? null,
    responsibleMembershipId: responsible?.type === 'staff' ? responsible.membershipId : null,
    responsibleSupplierId: responsible?.type === 'supplier' ? responsible.supplierId : null,
  }
}

const currentResponsible = (plan: StoredMaintenancePlan): MaintenancePlanResponsibleInput => {
  if (plan.responsibleType === 'staff' && plan.responsibleMembershipId !== null)
    return { type: 'staff', membershipId: plan.responsibleMembershipId }
  if (plan.responsibleType === 'supplier' && plan.responsibleSupplierId !== null)
    return { type: 'supplier', supplierId: plan.responsibleSupplierId }
  return null
}

/** Plan açılışı (K-252): periyot ve yasal işaret boşsa türün önerisi. 201. */
export function createMaintenancePlanCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: PLAN_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'maintenance_plan.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = maintenancePlanSchema.parse(input)
        const { checks, assetId } = await loadChecks(tx, ctx, parsed)
        return { run: () => ({ draft: planMaintenancePlan(parsed, checks), assetId }) }
      },
      after: async (tx, { draft, assetId }) => {
        await insertMaintenancePlan(tx, ctx.institutionId, {
          id,
          name: draft.name,
          type: draft.type,
          campusId: draft.campusId,
          location: draft.location,
          assetId: assetId ?? null,
          periodMonths: draft.periodMonths,
          isLegal: draft.isLegal,
          previousDoneDate: draft.lastDoneDate,
          ...responsibleColumns(draft.responsible),
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'maintenance_plan.create', entity, [
          'name',
          'type',
          'location',
          'periodMonths',
          'isLegal',
          ...(draft.campusId === null ? [] : ['campusId']),
          ...(assetId == null ? [] : ['assetId']),
          ...(draft.lastDoneDate === null ? [] : ['previousDoneDate']),
          ...(draft.responsible === null ? [] : ['responsible']),
        ])
        body = { data: await detailOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Düzeltme (K-252): verilen alanlar değişir; sürüm `If-Match` ile karşılaştırılır. */
export function updateMaintenancePlanCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PLAN_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'maintenance_plan.update',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await planOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const parsed = updateMaintenancePlanSchema.parse(input)
        const { checks, assetId } = await loadChecks(tx, ctx, parsed)
        return {
          run: () => {
            const changed = planMaintenancePlanUpdate(
              {
                name: current.name,
                type: current.type,
                campusId: current.campusId,
                location: current.location,
                assetTagNumber: current.assetTagNumber,
                periodMonths: current.periodMonths,
                isLegal: current.isLegal,
                lastDoneDate: current.previousDoneDate,
                responsible: currentResponsible(current),
              },
              parsed,
              checks,
            )
            const changes: Partial<MaintenancePlanWrite> = {}
            for (const key of changed)
              switch (key) {
                case 'name':
                case 'type':
                case 'location':
                case 'periodMonths':
                case 'isLegal':
                case 'campusId': {
                  const value = parsed[key]
                  if (value !== undefined) Object.assign(changes, { [key]: value })
                  break
                }
                case 'assetTagNumber':
                  changes.assetId = assetId ?? null
                  break
                case 'lastDoneDate':
                  changes.previousDoneDate = parsed.lastDoneDate ?? null
                  break
                case 'responsible':
                  Object.assign(changes, responsibleColumns(parsed.responsible ?? null))
                  break
                default:
                  key satisfies never
              }
            return { changes, changed }
          },
        }
      },
      after: async (tx, { changes, changed }) => {
        const saved = await updateMaintenancePlan(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'maintenance_plan.update', entity, changed)
        body = { data: await detailOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Arşiv: plan listeden ve uyarıdan çıkar, denetim kayıtları kalır. */
export function archiveMaintenancePlanCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PLAN_ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'maintenance_plan.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await planOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => null }
      },
      after: async (tx) => {
        const saved = await updateMaintenancePlan(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: { archivedAt: ctx.now },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'maintenance_plan.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id, archivedAt: ctx.now.toISOString() } } }),
    idempotency,
  )
}

/** Denetim kaydı (K-254): gün bugünden sonra olamaz, aynı güne ikinci kayıt 409. 201. */
export function recordMaintenanceInspectionCommand(
  ctx: ServiceContext,
  planId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: INSPECTION_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'maintenance_inspection.record',
      collections: [],
      entity,
      load: async (tx) => {
        await planOf(tx, ctx, planId)
        const parsed = maintenanceInspectionSchema.parse(input)
        const sameDayExists = await inspectionOnDayExists(
          tx,
          ctx.institutionId,
          planId,
          parsed.doneDate,
        )
        return {
          run: () => planMaintenanceInspection(parsed, { today: dayKey(ctx.now), sameDayExists }),
        }
      },
      after: async (tx, parsed) => {
        await insertMaintenanceInspection(tx, ctx.institutionId, {
          id,
          planId,
          ...parsed,
          recordedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'maintenance_inspection.record', entity, [
          'planId',
          'doneDate',
          'performedBy',
          'result',
          ...(parsed.documentNumber === null ? [] : ['documentNumber']),
          ...(parsed.note === null ? [] : ['note']),
        ])
        body = { data: await detailOf(tx, ctx, planId) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

async function inspectionOf(tx: Database, ctx: ServiceContext, planId: string, id: string) {
  await planOf(tx, ctx, planId)
  const found = await findMaintenanceInspection(tx, ctx.institutionId, planId, id)
  if (found === null) throw new NotFoundError()
  return found
}

/** Denetim iptali (yanlış giriş): gerekçe zorunlu; iptal edilen denetim takvime sayılmaz. */
export function cancelMaintenanceInspectionCommand(
  ctx: ServiceContext,
  planId: string,
  inspectionId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: INSPECTION_ENTITY, id: inspectionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'maintenance_inspection.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await inspectionOf(tx, ctx, planId, inspectionId)
        if (current.version !== expectedVersion) throw new ConflictError()
        const parsed = maintenanceInspectionCancelSchema.parse(input)
        return {
          run: () => {
            planMaintenanceInspectionCancel(current)
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const saved = await updateMaintenanceInspection(tx, ctx.institutionId, {
          id: inspectionId,
          expectedVersion,
          changes: {
            cancelledAt: ctx.now,
            cancelReason: parsed.reason,
            cancelledByUserId: ctx.actor.userId,
          },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'maintenance_inspection.cancel', entity, ['cancelReason'])
        body = { data: await detailOf(tx, ctx, planId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Uygunsuz denetimden arıza talebi (K-254, DOM-FIN-089): talep planın yeri, etkin kampüsü ve
 * hurdaya ayrılmamış demirbaşıyla, denetimden üretilen başlık, açıklama ve öncelikle `open`
 * açılır; denetime bağlanır. Bir denetimden tek talep (409). 201; yanıt planın ayrıntısıdır.
 */
export function openRequestFromInspectionCommand(
  ctx: ServiceContext,
  planId: string,
  inspectionId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const requestId = randomUUID()
  const entity = { type: INSPECTION_ENTITY, id: inspectionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'maintenance_inspection.open_request',
      collections: [],
      entity,
      load: async (tx) => {
        const plan = await planOf(tx, ctx, planId)
        const current = await inspectionOf(tx, ctx, planId, inspectionId)
        if (current.version !== expectedVersion) throw new ConflictError()
        const asset =
          plan.assetTagNumber === null
            ? null
            : await findAssetByTag(tx, ctx.institutionId, plan.assetTagNumber)
        const campusFound =
          plan.campusId !== null &&
          (await campusNames(tx, ctx.institutionId, [plan.campusId])).size === 1
        return {
          run: () => ({
            draft: maintenanceRequestFromInspection(plan, current),
            plan,
            // Hurdaya ayrılmış demirbaşa arıza bildirilmez (K-236); bağ o zaman düşer.
            assetId: asset !== null && asset.status !== 'scrapped' ? asset.id : null,
            campusId: campusFound ? plan.campusId : null,
          }),
        }
      },
      after: async (tx, { draft, plan, assetId, campusId }) => {
        await insertMaintenanceRequest(tx, ctx.institutionId, {
          id: requestId,
          sequence: await nextMaintenanceSequence(tx, ctx.institutionId),
          title: draft.title,
          description: draft.description,
          campusId,
          location: plan.location,
          assetId,
          priority: draft.priority,
          reportedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await insertMaintenanceEvent(tx, ctx.institutionId, {
          id: randomUUID(),
          requestId,
          event: 'reported',
          fromStatus: null,
          toStatus: 'open',
          note: 'Periyodik bakım denetiminden açıldı.',
          actorUserId: ctx.actor.userId,
          now: ctx.now,
        })
        const saved = await updateMaintenanceInspection(tx, ctx.institutionId, {
          id: inspectionId,
          expectedVersion,
          changes: { maintenanceRequestId: requestId },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'maintenance.report',
          { type: 'maintenance_requests', id: requestId },
          [
            'title',
            'description',
            'location',
            'priority',
            'inspectionId',
            ...(campusId === null ? [] : ['campusId']),
            ...(assetId === null ? [] : ['assetId']),
          ],
        )
        await auditWork(tx, ctx, 'maintenance_inspection.open_request', entity, [
          'maintenanceRequestId',
        ])
        body = { data: await detailOf(tx, ctx, planId) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}
