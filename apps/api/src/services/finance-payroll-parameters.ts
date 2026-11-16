import { randomUUID } from 'node:crypto'

import {
  assertPayrollEffectiveFromFree,
  mergePayrollParameterUpdate,
  PAYROLL_PARAMETER_FIELDS,
  payrollDerivedValues,
  payrollParameterSetSchema,
  payrollParameterYear,
  requireEffectivePayrollParameters,
  updatePayrollParameterSetSchema,
  type PayrollInstitutionSet,
  type PayrollResolvedSet,
} from '@kampus/school-core/lib/finance-payroll-parameters.ts'

import type { Database } from '../db/client.ts'
import {
  findPayrollParameterSet,
  insertPayrollParameterSet,
  isPayrollEffectiveFromTaken,
  listPayrollParameterSets,
  updatePayrollParameterSet,
} from '../db/finance-payroll-parameters.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Bordro parametreleri (DOM-FIN-100; ON-197). Platform varsayılanı core'dadır (K-308); servis
 * kurumun kopyalarını yükler, core'la yıllık tabloyu ve geçerli seti çözer, kopyayı kurum kilidi
 * altında tek transaction'da yazar. Yürürlük başlangıcı kurumda tekildir (409). Denetim kaydına
 * alan adları yazılır, değerler yazılmaz. Rol ve modül denetimi rotadadır.
 */

const ENTITY = 'payroll_parameter_sets'

/** Yanıt biçimi: set alanları düz, kaynağı ve hesaplanan değerler yanında. */
function setView(set: PayrollResolvedSet) {
  return {
    id: set.id,
    origin: set.origin,
    overridesPlatform: set.overridesPlatform,
    version: set.version,
    ...set.values,
    unverifiedFields: [...set.unverifiedFields],
    derived: payrollDerivedValues(set.values),
  }
}

const storedView = (set: PayrollInstitutionSet) => ({ ...set })

/** Yılın dönemleri; yıl seçimi için tablodaki yıllar. */
export async function payrollParameterYearFor(ctx: ServiceContext, year: number) {
  const sets = await listPayrollParameterSets(ctx.db, ctx.institutionId)
  const table = payrollParameterYear(year, sets)
  return {
    year: table.year,
    availableYears: table.availableYears,
    periods: table.periods.map((period) => ({
      ...setView(period),
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      carriedOver: period.carriedOver,
    })),
  }
}

/** Günde geçerli set; tablonun ilk setinden önceki gün 422 `payroll_parameters_missing`. */
export async function effectivePayrollParametersFor(ctx: ServiceContext, date: string) {
  const sets = await listPayrollParameterSets(ctx.db, ctx.institutionId)
  let found: ReturnType<typeof requireEffectivePayrollParameters>
  try {
    found = requireEffectivePayrollParameters(date, sets)
  } catch (error) {
    throw mapOperationError(error)
  }
  return { date, stale: found.stale, ...setView(found) }
}

async function setOf(db: Database, ctx: ServiceContext, id: string) {
  const found = await findPayrollParameterSet(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

const setBody = async (tx: Database, ctx: ServiceContext, id: string) => ({
  data: storedView(await setOf(tx, ctx, id)),
})

/** Kurum kopyası (K-309): bütün alanlar; aynı yürürlük başlangıcı 409. 201. */
export function createPayrollParameterSetCommand(
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
      action: 'payroll_parameters.create',
      collections: [],
      entity,
      load: async (tx) => {
        const values = payrollParameterSetSchema.parse(input)
        const taken = await isPayrollEffectiveFromTaken(tx, ctx.institutionId, values.effectiveFrom)
        return {
          run: () => {
            assertPayrollEffectiveFromFree(taken)
            return values
          },
        }
      },
      after: async (tx, values) => {
        await insertPayrollParameterSet(tx, ctx.institutionId, {
          ...values,
          id,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'payroll_parameters.create', entity, PAYROLL_PARAMETER_FIELDS)
        body = await setBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kısmi düzeltme: birleşik set yeniden doğrulanır; başka setin başlangıcı 409. */
export function updatePayrollParameterSetCommand(
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
      action: 'payroll_parameters.update',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await setOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const changes = updatePayrollParameterSetSchema.parse(input)
        const taken =
          changes.effectiveFrom !== undefined &&
          changes.effectiveFrom !== current.effectiveFrom &&
          (await isPayrollEffectiveFromTaken(tx, ctx.institutionId, changes.effectiveFrom, id))
        return {
          // Birleşik setin doğrulaması `run` içindedir: hatası 400 `validation_failed` olur.
          run: () => {
            const merged = mergePayrollParameterUpdate(current, changes)
            assertPayrollEffectiveFromFree(taken)
            return merged
          },
        }
      },
      after: async (tx, { values, changed }) => {
        const saved = await updatePayrollParameterSet(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: Object.fromEntries(changed.map((field) => [field, values[field]])),
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'payroll_parameters.update', entity, changed)
        body = await setBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Arşiv: set çözüme girmez, aynı başlangıçlı platform seti yeniden geçerli olur (K-309). */
export function archivePayrollParameterSetCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'payroll_parameters.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await setOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => null }
      },
      after: async (tx) => {
        const saved = await updatePayrollParameterSet(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes: { archivedAt: ctx.now },
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'payroll_parameters.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id, archivedAt: ctx.now.toISOString() } } }),
    idempotency,
  )
}
