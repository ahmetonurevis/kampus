import { randomUUID } from 'node:crypto'

import {
  createFeeTariffSchema,
  planTariffCreate,
  planTariffPublish,
  planTariffUpdate,
} from '@kampus/school-core/lib/fee-tariffs.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  applyFeeTariffPublish,
  findFeeTariff,
  insertFeeTariff,
  listFeeTariffs,
  tariffVersionsOfYear,
  updateFeeTariffItems,
  type StoredFeeTariff,
} from '../db/fee-tariffs.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'

/**
 * Ücret tarifesi servisi (ADR 0006 karar 8; docs/domain/finans.md DOM-FIN-002, -006; IST-104).
 * Kural core `lib/fee-tariffs.ts`'tedir; burada yükleme, sürüm denetimi ve tek transaction'da
 * yazım vardır. Denetim kaydına yalnız alan adları düşer (DOM-FIN-053).
 */

export interface FeeTariffView extends Omit<StoredFeeTariff, 'publishedAt'> {
  publishedAt: string | null
}

const view = (row: StoredFeeTariff): FeeTariffView => ({
  ...row,
  publishedAt: row.publishedAt?.toISOString() ?? null,
})

async function audit(
  tx: Database,
  ctx: ServiceContext,
  action: string,
  id: string,
  fields: readonly string[],
) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action,
    entityType: 'fee_tariffs',
    entityId: id,
    changes: { fields: [...fields] },
    createdAt: ctx.now,
  })
}

export async function listFeeTariffsFor(
  ctx: ServiceContext,
  query: { academicYear?: number | undefined; page: number; pageSize: number },
): Promise<{ items: FeeTariffView[]; total: number }> {
  const { items, total } = await listFeeTariffs(ctx.db, ctx.institutionId, query)
  return { items: items.map(view), total }
}

export async function getFeeTariffFor(ctx: ServiceContext, id: string): Promise<FeeTariffView> {
  const row = await findFeeTariff(ctx.db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return view(row)
}

/** Yazılan tarifeyi aynı transaction'da okur; yanıt satırla aynıdır. */
async function reload(tx: Database, ctx: ServiceContext, id: string): Promise<FeeTariffView> {
  const row = await findFeeTariff(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return view(row)
}

function responseOf(statusCode: number, read: () => FeeTariffView | undefined) {
  return () => {
    const data = read()
    if (data === undefined) throw new Error('fee tariff was not written')
    return { statusCode, body: { data } }
  }
}

/** Yeni taslak açar; yılda tek açık taslak olur (DOM-FIN-002). 201. */
export function createFeeTariffCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const { academicYear } = createFeeTariffSchema.parse(input)
  let result: FeeTariffView | undefined
  return runCommand(
    ctx,
    {
      action: 'tariff.create',
      collections: [],
      entity: { type: 'fee_tariffs', id },
      load: async (tx) => {
        const existing = await tariffVersionsOfYear(tx, ctx.institutionId, academicYear)
        return { run: () => planTariffCreate(input, existing) }
      },
      after: async (tx, plan) => {
        await insertFeeTariff(tx, ctx.institutionId, { id, ...plan, now: ctx.now })
        await audit(tx, ctx, 'tariff.create', id, ['academicYear', 'items'])
        result = await reload(tx, ctx, id)
      },
    },
    responseOf(201, () => result),
    idempotency,
  )
}

/** Taslağın kalemlerini değiştirir; yayımlanmış sürüm 409 (IST-104). */
export function updateFeeTariffCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let result: FeeTariffView | undefined
  return runCommand(
    ctx,
    {
      action: 'tariff.update',
      collections: [],
      entity: { type: 'fee_tariffs', id },
      load: async (tx) => {
        const row = await findFeeTariff(tx, ctx.institutionId, id)
        if (row === null) throw new NotFoundError()
        if (row.version !== expectedVersion) throw new ConflictError()
        return { run: () => planTariffUpdate(row, input) }
      },
      after: async (tx, plan) => {
        const saved = await updateFeeTariffItems(tx, ctx.institutionId, {
          id,
          expectedVersion,
          items: plan.items,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await audit(tx, ctx, 'tariff.update', id, ['items'])
        result = await reload(tx, ctx, id)
      },
    },
    responseOf(200, () => result),
    idempotency,
  )
}

/** Taslağı yayımlar; önceki yayındaki sürüm aynı işlemde kalkar (DOM-FIN-002, -006). */
export function publishFeeTariffCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let result: FeeTariffView | undefined
  let academicYear = 0
  return runCommand(
    ctx,
    {
      action: 'tariff.publish',
      collections: [],
      entity: { type: 'fee_tariffs', id },
      load: async (tx) => {
        const row = await findFeeTariff(tx, ctx.institutionId, id)
        if (row === null) throw new NotFoundError()
        if (row.version !== expectedVersion) throw new ConflictError()
        const institution = await getInstitutionModules(tx, ctx.institutionId)
        if (!institution) throw new NotFoundError()
        academicYear = row.academicYear
        return {
          run: () =>
            planTariffPublish(row, input, {
              institutionType: institution.type,
              today: dayKey(ctx.now),
            }),
        }
      },
      after: async (tx, plan) => {
        const saved = await applyFeeTariffPublish(tx, ctx.institutionId, {
          id,
          academicYear,
          expectedVersion,
          announcedDate: plan.announcedDate,
          mebbisRecordedDate: plan.mebbisRecordedDate,
          publishedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await audit(tx, ctx, 'tariff.publish', id, [
          'status',
          'announcedDate',
          'mebbisRecordedDate',
        ])
        result = await reload(tx, ctx, id)
      },
    },
    responseOf(200, () => result),
    idempotency,
  )
}
