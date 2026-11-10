import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  canSeeMaintenanceCost,
  maintenanceAssignSchema,
  maintenanceCancelSchema,
  maintenanceNoteSchema,
  maintenanceRequestActions,
  maintenanceRequestNumber,
  maintenanceRequestSchema,
  maintenanceResolveSchema,
  maintenanceTransition,
  maintenanceVisibility,
  planMaintenanceAssign,
  planMaintenanceCancel,
  planMaintenanceRequest,
  planMaintenanceResolve,
  type MaintenanceAction,
  type MaintenanceEvent,
  type MaintenanceStatus,
} from '@kampus/school-core/lib/finance-maintenance-requests.ts'

import type { Database } from '../db/client.ts'
import { findAssigneeMembership } from '../db/finance-fixed-asset-assignments.ts'
import { findAssetByTag } from '../db/finance-fixed-asset-counts.ts'
import {
  findMaintenanceRequest,
  insertMaintenanceEvent,
  insertMaintenanceRequest,
  listMaintenanceEvents,
  listMaintenanceRequests,
  loadMembershipNames,
  loadSupplierNames,
  loadUserNames,
  nextMaintenanceSequence,
  updateMaintenanceRequest,
  type MaintenanceChanges,
  type MaintenanceQuery,
  type MaintenanceScope,
  type StoredMaintenanceEvent,
  type StoredMaintenanceRequest,
} from '../db/finance-maintenance-requests.ts'
import { findSupplier } from '../db/finance-suppliers.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { campusNames } from './finance-fixed-assets.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Arıza ve bakım talebi, iş emri (DOM-FIN-089; ON-239). Kural core
 * `lib/finance-maintenance-requests.ts`'tedir; servis kurum kilidi altında talebi, demirbaşı
 * (etiketle), personel üyeliğini ve tedarikçiyi yükler, talebi ve geçmiş satırını aynı
 * transaction'da yazar. Öğretmen yalnız kendi bildirimini görür, maliyet yalnız yöneticiye döner
 * (K-238). Denetim kaydına alan adları yazılır; metinler ve tutar yazılmaz. Rol ve modül denetimi
 * rotadadır.
 */

const ENTITY = 'maintenance_requests'

/** Rolün görme kapsamı: öğretmen yalnız kendi bildirimleri (K-238). */
const scopeOf = (ctx: ServiceContext): MaintenanceScope =>
  maintenanceVisibility(ctx.actor.role) === 'own' ? { reportedByUserId: ctx.actor.userId } : {}

interface Names {
  users: ReadonlyMap<string, string>
  members: ReadonlyMap<string, string>
  suppliers: ReadonlyMap<string, string>
  campuses: ReadonlyMap<string, string>
}

async function namesFor(
  db: Database,
  institutionId: string,
  items: readonly StoredMaintenanceRequest[],
  events: readonly StoredMaintenanceEvent[] = [],
): Promise<Names> {
  const [users, members, suppliers, campuses] = await Promise.all([
    loadUserNames(db, institutionId, [
      ...items.map((item) => item.reportedByUserId),
      ...events.map((event) => event.actorUserId),
    ]),
    loadMembershipNames(
      db,
      institutionId,
      [
        ...items.map((item) => item.assigneeMembershipId),
        ...events.map((event) => event.assigneeMembershipId),
      ].filter((id): id is string => id !== null),
    ),
    loadSupplierNames(
      db,
      institutionId,
      [
        ...items.flatMap((item) => [item.assigneeSupplierId, item.resolutionSupplierId]),
        ...events.map((event) => event.assigneeSupplierId),
      ].filter((id): id is string => id !== null),
    ),
    campusNames(
      db,
      institutionId,
      items.map((item) => item.campusId),
    ),
  ])
  return { users, members, suppliers, campuses }
}

function assigneeView(
  type: StoredMaintenanceRequest['assigneeType'],
  membershipId: string | null,
  supplierId: string | null,
  names: Names,
) {
  if (type === null) return null
  const id = type === 'staff' ? membershipId : supplierId
  const name =
    id === null
      ? null
      : ((type === 'staff' ? names.members.get(id) : names.suppliers.get(id)) ?? null)
  return { type, id: id ?? '', name }
}

/** Talebin yanıt görünümü; maliyet anahtarı yalnız yöneticide bulunur (K-238). */
function requestView(ctx: ServiceContext, item: StoredMaintenanceRequest, names: Names) {
  const view = {
    id: item.id,
    number: maintenanceRequestNumber(item.sequence),
    title: item.title,
    description: item.description,
    campusId: item.campusId,
    campusName: item.campusId === null ? null : (names.campuses.get(item.campusId) ?? null),
    location: item.location,
    asset:
      item.assetId === null
        ? null
        : {
            id: item.assetId,
            tagNumber: item.assetTagNumber ?? '',
            name: item.assetName ?? '',
            category: item.assetCategory,
          },
    priority: item.priority,
    status: item.status,
    reportedByName: names.users.get(item.reportedByUserId) ?? null,
    reportedByMe: item.reportedByUserId === ctx.actor.userId,
    reportedAt: item.reportedAt,
    assignee: assigneeView(
      item.assigneeType,
      item.assigneeMembershipId,
      item.assigneeSupplierId,
      names,
    ),
    assignedAt: item.assignedAt,
    startedAt: item.startedAt,
    resolvedAt: item.resolvedAt,
    resolvedDate: item.resolvedDate,
    resolution: item.resolution,
    resolutionSupplier:
      item.resolutionSupplierId === null
        ? null
        : {
            id: item.resolutionSupplierId,
            name: names.suppliers.get(item.resolutionSupplierId) ?? '',
          },
    closedAt: item.closedAt,
    cancelledAt: item.cancelledAt,
    cancelReason: item.cancelReason,
    actions: maintenanceRequestActions(item, ctx.actor),
    version: item.version,
  }
  return canSeeMaintenanceCost(ctx.actor.role)
    ? { ...view, resolutionCostCents: item.resolutionCostCents }
    : view
}

function eventView(event: StoredMaintenanceEvent, names: Names) {
  return {
    id: event.id,
    event: event.event,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    note: event.note,
    actorName: names.users.get(event.actorUserId) ?? null,
    assignee: assigneeView(
      event.assigneeType,
      event.assigneeMembershipId,
      event.assigneeSupplierId,
      names,
    ),
    occurredAt: event.occurredAt,
  }
}

async function requestOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findMaintenanceRequest(db, ctx.institutionId, id, scopeOf(ctx))
  if (found === null) throw new NotFoundError()
  return found
}

async function detailOf(db: Database, ctx: ServiceContext, id: string) {
  const item = await requestOf(db, ctx, id)
  const events = await listMaintenanceEvents(db, ctx.institutionId, id)
  const names = await namesFor(db, ctx.institutionId, [item], events)
  return {
    ...requestView(ctx, item, names),
    events: events.map((event) => eventView(event, names)),
  }
}

export async function listMaintenanceRequestsFor(
  ctx: ServiceContext,
  query: Omit<MaintenanceQuery, keyof MaintenanceScope>,
) {
  const { items, total } = await listMaintenanceRequests(ctx.db, ctx.institutionId, {
    ...query,
    ...scopeOf(ctx),
  })
  const names = await namesFor(ctx.db, ctx.institutionId, items)
  return { items: items.map((item) => requestView(ctx, item, names)), total }
}

export function getMaintenanceRequestFor(ctx: ServiceContext, id: string) {
  return detailOf(ctx.db, ctx, id)
}

/** Bildirim (K-236): etiket kurumun hurdaya ayrılmamış demirbaşı olmalıdır; numara kurum sırası. 201. */
export function reportMaintenanceCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'maintenance.report',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = maintenanceRequestSchema.parse(input)
        const asset =
          parsed.assetTagNumber === null
            ? undefined
            : await findAssetByTag(tx, ctx.institutionId, parsed.assetTagNumber)
        const campusFound =
          parsed.campusId === null
            ? undefined
            : (await campusNames(tx, ctx.institutionId, [parsed.campusId])).size === 1
        return {
          run: () => {
            planMaintenanceRequest(parsed, {
              ...(asset === undefined ? {} : { asset }),
              ...(campusFound === undefined ? {} : { campusFound }),
            })
            return { parsed, assetId: asset?.id ?? null }
          },
        }
      },
      after: async (tx, { parsed, assetId }) => {
        await insertMaintenanceRequest(tx, ctx.institutionId, {
          id,
          sequence: await nextMaintenanceSequence(tx, ctx.institutionId),
          title: parsed.title,
          description: parsed.description,
          campusId: parsed.campusId,
          location: parsed.location,
          assetId,
          priority: parsed.priority,
          reportedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await insertMaintenanceEvent(tx, ctx.institutionId, {
          id: randomUUID(),
          requestId: id,
          event: 'reported',
          fromStatus: null,
          toStatus: 'open',
          note: null,
          actorUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'maintenance.report', entity, [
          'title',
          'description',
          'location',
          'priority',
          ...(parsed.campusId === null ? [] : ['campusId']),
          ...(assetId === null ? [] : ['assetId']),
        ])
        body = { data: await detailOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Geçişin planı: talebe yazılacak alanlar ve geçmiş satırı. */
interface TransitionPlan {
  changes: MaintenanceChanges & { status: MaintenanceStatus }
  event: MaintenanceEvent
  note: string | null
  assignee?: { type: 'staff' | 'supplier'; membershipId: string | null; supplierId: string | null }
  fields: string[]
}

type Planner = (tx: Database, current: StoredMaintenanceRequest) => Promise<() => TransitionPlan>

/**
 * Durum geçişi (K-237): talep görme kapsamıyla yüklenir (öğretmen başkasının talebinde 404), sürüm
 * `If-Match` ile karşılaştırılır, core kuralı çalışır; talep ve geçmiş satırı aynı transaction'da
 * yazılır.
 */
function transitionCommand(
  ctx: ServiceContext,
  id: string,
  action: MaintenanceAction,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
  planner: Planner,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const auditAction = `maintenance.${action}`
  let body: unknown
  return runCommand(
    ctx,
    {
      action: auditAction,
      collections: [],
      entity,
      load: async (tx) => {
        const current = await requestOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const plan = await planner(tx, current)
        return { run: () => ({ current, planned: plan() }) }
      },
      after: async (tx, { current, planned }) => {
        const saved = await updateMaintenanceRequest(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: planned.changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await insertMaintenanceEvent(tx, ctx.institutionId, {
          id: randomUUID(),
          requestId: id,
          event: planned.event,
          fromStatus: current.status,
          toStatus: planned.changes.status,
          note: planned.note,
          ...(planned.assignee === undefined
            ? {}
            : {
                assigneeType: planned.assignee.type,
                assigneeMembershipId: planned.assignee.membershipId,
                assigneeSupplierId: planned.assignee.supplierId,
              }),
          actorUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, auditAction, entity, planned.fields)
        body = { data: await detailOf(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

const withNote = (fields: string[], note: string | null) =>
  note === null ? fields : [...fields, 'note']

/** Atama (K-237): etkin personel ya da etkin tedarikçi; yeniden atama sorumluyu değiştirir. */
export function assignMaintenanceCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) {
  return transitionCommand(ctx, id, 'assign', expectedVersion, idempotency, async (tx, current) => {
    const parsed = maintenanceAssignSchema.parse(input)
    const staff =
      parsed.assigneeType === 'staff'
        ? await findAssigneeMembership(tx, ctx.institutionId, parsed.membershipId)
        : undefined
    const supplier =
      parsed.assigneeType === 'supplier'
        ? await findSupplier(tx, ctx.institutionId, parsed.supplierId)
        : undefined
    return () => {
      const plan = planMaintenanceAssign(current.status, parsed, {
        current:
          current.assigneeType === null
            ? null
            : {
                assigneeType: current.assigneeType,
                membershipId: current.assigneeMembershipId,
                supplierId: current.assigneeSupplierId,
              },
        ...(staff === undefined ? {} : { staff }),
        ...(supplier === undefined ? {} : { supplier }),
      })
      return {
        changes: {
          status: plan.status,
          assigneeType: plan.assigneeType,
          assigneeMembershipId: plan.membershipId,
          assigneeSupplierId: plan.supplierId,
          assignedAt: ctx.now,
        },
        event: 'assigned',
        note: plan.note,
        assignee: {
          type: plan.assigneeType,
          membershipId: plan.membershipId,
          supplierId: plan.supplierId,
        },
        fields: withNote(
          ['status', plan.assigneeType === 'staff' ? 'assigneeMembershipId' : 'assigneeSupplierId'],
          plan.note,
        ),
      }
    }
  })
}

/** İşe başlama (K-237): atanmış talep `in_progress` olur. */
export function startMaintenanceCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) {
  return transitionCommand(ctx, id, 'start', expectedVersion, idempotency, async (_tx, current) => {
    const parsed = maintenanceNoteSchema.parse(input ?? {})
    return () => ({
      changes: { status: maintenanceTransition(current.status, 'start'), startedAt: ctx.now },
      event: 'started',
      note: parsed.note,
      fields: withNote(['status', 'startedAt'], parsed.note),
    })
  })
}

/** Çözüm (K-237): gün, yapılan iş, isteğe bağlı maliyet ve tedarikçi. */
export function resolveMaintenanceCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) {
  return transitionCommand(
    ctx,
    id,
    'resolve',
    expectedVersion,
    idempotency,
    async (tx, current) => {
      const parsed = maintenanceResolveSchema.parse(input)
      const supplier =
        parsed.supplierId === null
          ? undefined
          : await findSupplier(tx, ctx.institutionId, parsed.supplierId)
      return () => {
        const status = planMaintenanceResolve(current.status, parsed, {
          today: dayKey(ctx.now),
          reportedDate: dayKey(current.reportedAt),
          ...(supplier === undefined ? {} : { supplier }),
        })
        return {
          changes: {
            status,
            resolvedAt: ctx.now,
            resolvedDate: parsed.resolvedDate,
            resolution: parsed.resolution,
            resolutionCostCents: parsed.costCents,
            resolutionSupplierId: parsed.supplierId,
          },
          event: 'resolved',
          note: parsed.resolution,
          fields: [
            'status',
            'resolvedDate',
            'resolution',
            ...(parsed.costCents === null ? [] : ['resolutionCostCents']),
            ...(parsed.supplierId === null ? [] : ['resolutionSupplierId']),
          ],
        }
      }
    },
  )
}

/** Kapatma (K-237): yalnız çözülmüş talep; kapatılan talep yeniden açılmaz. */
export function closeMaintenanceCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) {
  return transitionCommand(ctx, id, 'close', expectedVersion, idempotency, async (_tx, current) => {
    const parsed = maintenanceNoteSchema.parse(input ?? {})
    return () => ({
      changes: { status: maintenanceTransition(current.status, 'close'), closedAt: ctx.now },
      event: 'closed',
      note: parsed.note,
      fields: withNote(['status', 'closedAt'], parsed.note),
    })
  })
}

/** İptal (K-237): gerekçe zorunlu; bildiren yalnız kendi atanmamış bildirimini iptal eder. */
export function cancelMaintenanceCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) {
  return transitionCommand(
    ctx,
    id,
    'cancel',
    expectedVersion,
    idempotency,
    async (_tx, current) => {
      const parsed = maintenanceCancelSchema.parse(input)
      return () => ({
        changes: {
          status: planMaintenanceCancel(current, ctx.actor),
          cancelledAt: ctx.now,
          cancelReason: parsed.reason,
        },
        event: 'cancelled',
        note: parsed.reason,
        fields: ['status', 'cancelReason'],
      })
    },
  )
}
