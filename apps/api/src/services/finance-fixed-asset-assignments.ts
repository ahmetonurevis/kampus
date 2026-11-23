import { randomUUID } from 'node:crypto'

import {
  fixedAssetAssignmentSchema,
  fixedAssetReturnSchema,
  planFixedAssetAssignment,
  planFixedAssetReturn,
  type FixedAssetAssignmentChecks,
} from '@kampus/school-core/lib/finance-fixed-asset-assignments.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  findAssigneeMembership,
  findAssignment,
  insertAssignment,
  listAssignees,
  listAssignments,
  loadAssignmentState,
  returnAssignment,
  type AssigneeQuery,
  type AssignmentQuery,
  type StoredAssignment,
} from '../db/finance-fixed-asset-assignments.ts'
import { findFixedAsset } from '../db/finance-fixed-assets.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { campusNames } from './finance-fixed-assets.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Demirbaş zimmeti (DOM-FIN-086; ON-236). Kural core `lib/finance-fixed-asset-assignments.ts`'tedir;
 * servis kurum kilidi altında demirbaşı, açık zimmeti, son iade gününü, personel üyeliğini ve
 * kampüsü yükler, aynı transaction'da yazar. Denetim kaydına alan adları yazılır; personel adı,
 * konum ve notlar yazılmaz. Rol ve modül denetimi rotadadır (yalnız yönetici, K-189).
 */

const ENTITY = 'fixed_asset_assignments'

/** Zimmetin yanıt görünümü; kampüs adı `branches` kaydından (arşivlendiyse boş). */
export function assignmentView(
  assignment: StoredAssignment,
  campuses: ReadonlyMap<string, string>,
) {
  return {
    ...assignment,
    campusName: assignment.campusId === null ? null : (campuses.get(assignment.campusId) ?? null),
  }
}

export async function assignmentViews(
  db: Database,
  institutionId: string,
  items: readonly StoredAssignment[],
) {
  const campuses = await campusNames(
    db,
    institutionId,
    items.map((item) => item.campusId),
  )
  return items.map((item) => assignmentView(item, campuses))
}

async function assignmentOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findAssignment(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return assignmentView(found, await campusNames(db, ctx.institutionId, [found.campusId]))
}

const assignmentBody = async (tx: Database, ctx: ServiceContext, id: string) => ({
  data: await assignmentOf(tx, ctx, id),
})

export async function listFixedAssetAssignmentsFor(ctx: ServiceContext, query: AssignmentQuery) {
  const { items, total } = await listAssignments(ctx.db, ctx.institutionId, query)
  return { items: await assignmentViews(ctx.db, ctx.institutionId, items), total }
}

export function getFixedAssetAssignmentFor(ctx: ServiceContext, id: string) {
  return assignmentOf(ctx.db, ctx, id)
}

export async function listFixedAssetAssigneesFor(ctx: ServiceContext, query: AssigneeQuery) {
  return listAssignees(ctx.db, ctx.institutionId, query)
}

/** Zimmet ver (K-210, K-211): demirbaş başka kurumdaysa 404; tek açık zimmet. 201. */
export function assignFixedAssetCommand(
  ctx: ServiceContext,
  assetId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'fixed_asset.assign',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = fixedAssetAssignmentSchema.parse(input)
        const asset = await findFixedAsset(tx, ctx.institutionId, assetId)
        if (asset === null) throw new NotFoundError()
        const checks: FixedAssetAssignmentChecks = {
          today: dayKey(ctx.now),
          asset,
          ...(await loadAssignmentState(tx, ctx.institutionId, assetId)),
        }
        if (parsed.assigneeType === 'staff')
          checks.staff = await findAssigneeMembership(tx, ctx.institutionId, parsed.membershipId)
        else if (parsed.campusId !== null)
          checks.campusFound =
            (await campusNames(tx, ctx.institutionId, [parsed.campusId])).size === 1
        return { run: () => planFixedAssetAssignment(parsed, checks) }
      },
      after: async (tx, planned) => {
        await insertAssignment(tx, ctx.institutionId, {
          ...planned,
          id,
          assetId,
          assignedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'fixed_asset.assign',
          entity,
          Object.keys(planned).filter((key) => planned[key as keyof typeof planned] !== null),
        )
        body = await assignmentBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** İade (K-212): gün, durum ve not; zimmet kaydı silinmez, iade bir kez yazılır. */
export function returnFixedAssetAssignmentCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'fixed_asset.return',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = fixedAssetReturnSchema.parse(input)
        const current = await assignmentOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        return {
          run: () => {
            planFixedAssetReturn(current, parsed, dayKey(ctx.now))
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const saved = await returnAssignment(tx, ctx.institutionId, {
          id,
          expectedVersion,
          returnDate: parsed.returnDate,
          condition: parsed.condition,
          note: parsed.note,
          returnedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'fixed_asset.return', entity, [
          'returnDate',
          'condition',
          ...(parsed.note === null ? [] : ['note']),
        ])
        body = await assignmentBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
