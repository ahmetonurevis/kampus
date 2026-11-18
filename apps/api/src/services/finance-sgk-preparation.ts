import { randomUUID } from 'node:crypto'

import { requireEffectivePayrollParameters } from '@kampus/school-core/lib/finance-payroll-parameters.ts'
import {
  planSgkEmploymentDates,
  planSgkMissingDays,
  sgkEmploymentDatesInputSchema,
  sgkMissingDayInputSchema,
  sgkMonthRange,
  sgkParametersFrom,
  sgkPreparationCsv,
  sgkPreparationFilename,
  sgkPreparationList,
  type SgkPreparationList,
} from '@kampus/school-core/lib/finance-sgk-preparation.ts'

import type { Database } from '../db/client.ts'
import { findStaffMember, loadStaffPayRates } from '../db/finance-pay-rates.ts'
import { listPayrollParameterSets } from '../db/finance-payroll-parameters.ts'
import {
  archiveSgkEmploymentDates,
  archiveSgkMissingDay,
  findSgkEmploymentDates,
  findSgkMissingDay,
  insertSgkEmploymentDates,
  insertSgkMissingDay,
  loadSgkEmploymentDates,
  loadSgkMembers,
  loadSgkMissingDays,
  sumSgkMissingDays,
} from '../db/finance-sgk-preparation.ts'
import { auditLog } from '../db/schema/audit-log.ts'
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
 * SGK bildirge hazırlık listesi (DOM-FIN-107; ON-203). Kural core
 * `lib/finance-sgk-preparation.ts`'tedir; servis ayın personelini, ücret tanımlarını, elle satırları
 * ve bordro parametrelerini tek transaction'da okur. Liste ücret taşıdığı için her üretim (ekran,
 * CSV, PDF) okumayla aynı transaction'da denetime düşer; denetim yazılamazsa liste dönmez (K-355).
 * Denetim kaydına alan adları yazılır, tutar, gün, neden ve not yazılmaz. Resmî sisteme gönderim
 * yoktur (IST-143). Rol ve modül denetimi rotadadır (yalnız yönetici).
 */

const LIST_ENTITY = 'finance_export'
const MISSING_ENTITY = 'sgk_missing_days'
const DATES_ENTITY = 'sgk_employment_dates'
/** Denetime yazılan alan adları: listenin taşıdığı kişisel veriler. */
const LIST_FIELDS = ['name', 'wage', 'sgkBaseCents', 'primDays', 'missingDays', 'reasonCode']

export type SgkPreparationPurpose = 'view' | 'pdf' | 'csv'

async function buildList(tx: Database, ctx: ServiceContext, month: string) {
  const range = sgkMonthRange(month)
  let parameters: ReturnType<typeof sgkParametersFrom>
  try {
    parameters = sgkParametersFrom(
      requireEffectivePayrollParameters(
        range.firstDay,
        await listPayrollParameterSets(tx, ctx.institutionId),
      ),
    )
  } catch (error) {
    throw mapOperationError(error)
  }
  const members = await loadSgkMembers(tx, ctx.institutionId, range)
  const ids = members.map((member) => member.membershipId)
  return sgkPreparationList({
    month,
    parameters,
    members,
    rates: await loadStaffPayRates(tx, ctx.institutionId, ids),
    missing: await loadSgkMissingDays(tx, ctx.institutionId, range.firstDay),
    dates: await loadSgkEmploymentDates(tx, ctx.institutionId, range.firstDay),
  })
}

/**
 * Ayın listesi. `purpose`: ekran `finance.sgk_preparation.read`, PDF ve CSV
 * `finance.sgk_preparation_export` denetimi yazar (varlık kimliği ay ve biçim).
 */
export function sgkPreparationFor(
  ctx: ServiceContext,
  month: string,
  purpose: SgkPreparationPurpose,
): Promise<SgkPreparationList> {
  return ctx.db.transaction(async (tx) => {
    const list = await buildList(tx, ctx, month)
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action:
        purpose === 'view' ? 'finance.sgk_preparation.read' : 'finance.sgk_preparation_export',
      entityType: LIST_ENTITY,
      entityId: `sgk-preparation:${month}${purpose === 'view' ? '' : `:${purpose}`}`,
      changes: { fields: LIST_FIELDS },
      createdAt: ctx.now,
    })
    return list
  })
}

/** CSV dosyası (K-355); BOM'u rota ekler. */
export async function sgkPreparationCsvFor(
  ctx: ServiceContext,
  month: string,
): Promise<{ csv: string; filename: string }> {
  const list = await sgkPreparationFor(ctx, month, 'csv')
  return { csv: sgkPreparationCsv(list), filename: sgkPreparationFilename(month, 'csv') }
}

const missingView = (entry: Awaited<ReturnType<typeof findSgkMissingDay>>) => {
  if (entry === null) throw new NotFoundError()
  const { month, ...rest } = entry
  return { ...rest, month: month.slice(0, 7) }
}
const datesView = (entry: Awaited<ReturnType<typeof findSgkEmploymentDates>>) => {
  if (entry === null) throw new NotFoundError()
  const { month, ...rest } = entry
  return { ...rest, month: month.slice(0, 7) }
}

/** Eksik gün satırı (K-353): personel kurumda olmalı, ayın toplamı 30'u aşamaz. 201. */
export function createSgkMissingDayCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: MISSING_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.sgk_missing_day.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = sgkMissingDayInputSchema.parse(input)
        const month = sgkMonthRange(parsed.month).firstDay
        const staff = await findStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const enteredDays = await sumSgkMissingDays(
          tx,
          ctx.institutionId,
          parsed.membershipId,
          month,
        )
        return {
          run: () => {
            planSgkMissingDays(parsed, { staff, enteredDays })
            return { parsed, month }
          },
        }
      },
      after: async (tx, { parsed, month }) => {
        await insertSgkMissingDay(tx, ctx.institutionId, {
          id,
          membershipId: parsed.membershipId,
          month,
          days: parsed.days,
          reasonCode: parsed.reasonCode,
          note: parsed.note,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.sgk_missing_day.create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        body = { data: missingView(await findSgkMissingDay(tx, ctx.institutionId, id)) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Eksik gün satırını kaldır (arşiv); olmayan ya da kaldırılmış 404, sürüm tutmazsa 409. */
export function archiveSgkMissingDayCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: MISSING_ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'finance.sgk_missing_day.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await findSgkMissingDay(tx, ctx.institutionId, id)
        if (current === null) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => null }
      },
      after: async (tx) => {
        const saved = await archiveSgkMissingDay(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.sgk_missing_day.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id, archivedAt: ctx.now.toISOString() } } }),
    idempotency,
  )
}

/** Elle giriş/çıkış günü (K-352): ayda tek etkin satır (409). 201. */
export function createSgkEmploymentDatesCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: DATES_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.sgk_employment_dates.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = sgkEmploymentDatesInputSchema.parse(input)
        const month = sgkMonthRange(parsed.month).firstDay
        const staff = await findStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const existing = await loadSgkEmploymentDates(
          tx,
          ctx.institutionId,
          month,
          parsed.membershipId,
        )
        return {
          run: () => {
            planSgkEmploymentDates({ staff, exists: existing.length > 0 })
            return { parsed, month }
          },
        }
      },
      after: async (tx, { parsed, month }) => {
        await insertSgkEmploymentDates(tx, ctx.institutionId, {
          id,
          membershipId: parsed.membershipId,
          month,
          entryDate: parsed.entryDate,
          exitDate: parsed.exitDate,
          note: parsed.note,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.sgk_employment_dates.create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        body = { data: datesView(await findSgkEmploymentDates(tx, ctx.institutionId, id)) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Giriş/çıkış satırını kaldır (arşiv); olmayan ya da kaldırılmış 404, sürüm tutmazsa 409. */
export function archiveSgkEmploymentDatesCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: DATES_ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'finance.sgk_employment_dates.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await findSgkEmploymentDates(tx, ctx.institutionId, id)
        if (current === null) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => null }
      },
      after: async (tx) => {
        const saved = await archiveSgkEmploymentDates(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.sgk_employment_dates.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id, archivedAt: ctx.now.toISOString() } } }),
    idempotency,
  )
}
