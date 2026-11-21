import { randomUUID } from 'node:crypto'

import {
  assertAssignmentRange,
  assertAssignmentStaff,
  assertHeadcount,
  assertPositionArchivable,
  assertPositionUnit,
  assertReportingLine,
  assertUniqueName,
  assertUnitDeactivation,
  assertUnitPlacement,
  assignmentState,
  ORG_POSITIONS_MAX,
  ORG_UNITS_MAX,
  orgAssignmentInputSchema,
  orgAssignmentUpdateSchema,
  orgPositionInputSchema,
  orgPositionUpdateSchema,
  orgUnitInputSchema,
  orgUnitUpdateSchema,
  positionFill,
  type OrgAssignmentState,
} from '@kampus/school-core/lib/finance-org-chart.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  assignmentsOn,
  findAssignment,
  findAssignmentStaff,
  findPosition,
  findUnit,
  insertAssignment,
  insertPosition,
  insertUnit,
  listAssignments,
  listPositions,
  listUnits,
  listVacancies,
  openAssignmentsOfPosition,
  openAssignmentsOfUnit,
  positionRanges,
  updateAssignment,
  updatePosition,
  updateUnit,
  type StoredAssignment,
  type StoredPosition,
  type StoredUnit,
} from '../db/finance-org-chart.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Organizasyon şeması (DOM-FIN-129; ON-187; K-442…K-444). Kural core `lib/finance-org-chart.ts`'
 * tedir; servis kurum kilidi altında ilgili birim, pozisyon ve atamaları yükler, tek
 * transaction'da yazar ve denetime alan adlarını düşer. Bugün Europe/Istanbul günüdür. Rol ve
 * modül denetimi rotadadır.
 */

const UNIT = 'org_units'
const POSITION = 'org_positions'
const ASSIGNMENT = 'org_assignments'

const todayOf = (ctx: ServiceContext) => dayKey(ctx.now)

export const unitView = (unit: StoredUnit) => ({
  id: unit.id,
  name: unit.name,
  parentId: unit.parentId,
  kind: unit.kind,
  isActive: unit.isActive,
  version: unit.version,
})

export const assignmentView = (assignment: StoredAssignment, day: string) => ({
  id: assignment.id,
  positionId: assignment.positionId,
  positionTitle: assignment.positionTitle,
  unitId: assignment.unitId,
  membershipId: assignment.membershipId,
  staffName: assignment.staffName,
  staffRole: assignment.staffRole,
  startDate: assignment.startDate,
  endDate: assignment.endDate,
  state: assignmentState(assignment, day),
  version: assignment.version,
})

const positionView = (
  position: StoredPosition,
  holders: readonly StoredAssignment[],
  day: string,
) => ({
  id: position.id,
  unitId: position.unitId,
  title: position.title,
  headcount: position.headcount,
  reportsToPositionId: position.reportsToPositionId,
  ...positionFill(position.headcount, holders, day),
  holders: holders.map((holder) => ({
    assignmentId: holder.id,
    membershipId: holder.membershipId,
    staffName: holder.staffName,
    startDate: holder.startDate,
    endDate: holder.endDate,
    version: holder.version,
  })),
  version: position.version,
})

/**
 * Görsel şema verisi: bütün birimler, arşivsiz pozisyonlar ve verilen gün süren atamalar
 * (görevliler), toplamlarla. Kurum başına sınırlı (birim ≤ 300, pozisyon ≤ 1000) olduğu için
 * sayfasızdır.
 */
export async function orgChartFor(ctx: ServiceContext, date: string | undefined) {
  const day = date ?? todayOf(ctx)
  const [units, positions, holders] = await Promise.all([
    listUnits(ctx.db, ctx.institutionId),
    listPositions(ctx.db, ctx.institutionId),
    assignmentsOn(ctx.db, ctx.institutionId, day),
  ])
  const byPosition = new Map<string, StoredAssignment[]>()
  for (const holder of holders)
    byPosition.set(holder.positionId, [...(byPosition.get(holder.positionId) ?? []), holder])
  const positionViews = positions.map((position) =>
    positionView(position, byPosition.get(position.id) ?? [], day),
  )
  const sum = (pick: (view: (typeof positionViews)[number]) => number) =>
    positionViews.reduce((total, view) => total + pick(view), 0)
  return {
    date: day,
    units: units.map(unitView),
    positions: positionViews,
    totals: {
      units: units.length,
      activeUnits: units.filter((unit) => unit.isActive).length,
      positions: positionViews.length,
      headcount: sum((view) => view.headcount),
      filled: sum((view) => view.filled),
      vacant: sum((view) => view.vacant),
    },
  }
}

export async function vacanciesFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; date?: string; unitId?: string; q?: string },
) {
  const day = query.date ?? todayOf(ctx)
  const { items, total } = await listVacancies(ctx.db, ctx.institutionId, { ...query, day })
  return { items, total, day }
}

export async function assignmentsFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    date?: string
    positionId?: string
    membershipId?: string
    state?: OrgAssignmentState
  },
) {
  const day = query.date ?? todayOf(ctx)
  const { items, total } = await listAssignments(ctx.db, ctx.institutionId, { ...query, day })
  return { items: items.map((item) => assignmentView(item, day)), total }
}

// --- Birim komutları --------------------------------------------------------------------------------

const limitError = (code: string, message: string) => new DomainError(code, message)

const siblingNames = (
  units: readonly StoredUnit[],
  parentId: string | null,
  except: string | null,
) =>
  units.filter((unit) => unit.parentId === parentId && unit.id !== except).map((unit) => unit.name)

async function unitBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findUnit(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('org unit was not written')
  return { data: unitView(saved) }
}

/** Yeni birim etkin açılır (K-442). `Idempotency-Key` rotada zorunlu. 201. */
export function createUnitCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: UNIT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.org_unit.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = orgUnitInputSchema.parse(input)
        const units = await listUnits(tx, ctx.institutionId)
        return {
          run: () => {
            if (units.length >= ORG_UNITS_MAX)
              throw limitError(
                'org_unit_limit',
                `Kurumda en fazla ${String(ORG_UNITS_MAX)} birim tanımlanabilir.`,
              )
            assertUnitPlacement({ unitId: null, parentId: parsed.parentId, active: true, units })
            assertUniqueName({
              name: parsed.name,
              siblings: siblingNames(units, parsed.parentId, null),
              kind: 'unit',
            })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertUnit(tx, ctx.institutionId, {
          id,
          ...parsed,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.org_unit.create', entity, [
          'name',
          'kind',
          ...(parsed.parentId === null ? [] : ['parentId']),
          'isActive',
        ])
        body = await unitBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Birim düzeltme, taşıma ve etkin/pasif (K-442). `If-Match` zorunlu. */
export function updateUnitCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: UNIT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.org_unit.update',
      collections: [],
      entity,
      load: async (tx) => {
        const units = await listUnits(tx, ctx.institutionId)
        const unit = units.find((item) => item.id === id)
        if (unit === undefined) throw new NotFoundError()
        if (unit.version !== expectedVersion) throw new ConflictError()
        const parsed = orgUnitUpdateSchema.parse(input)
        const next = {
          name: parsed.name ?? unit.name,
          parentId: parsed.parentId === undefined ? unit.parentId : parsed.parentId,
          kind: parsed.kind ?? unit.kind,
          isActive: parsed.isActive ?? unit.isActive,
        }
        const deactivating = unit.isActive && !next.isActive
        const openAssignments = deactivating
          ? await openAssignmentsOfUnit(tx, ctx.institutionId, id, todayOf(ctx))
          : 0
        return {
          run: () => {
            const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
              (key) => next[key] !== unit[key],
            )
            if (changed.length === 0) throw new DomainError('org_unit_unchanged', 'Değişiklik yok.')
            if (changed.includes('parentId') || (next.isActive && !unit.isActive))
              assertUnitPlacement({
                unitId: id,
                parentId: next.parentId,
                active: next.isActive,
                units,
              })
            if (deactivating)
              assertUnitDeactivation({
                activeChildren: units.filter((item) => item.parentId === id && item.isActive)
                  .length,
                openAssignments,
              })
            if (changed.includes('name') || changed.includes('parentId'))
              assertUniqueName({
                name: next.name,
                siblings: siblingNames(units, next.parentId, id),
                kind: 'unit',
              })
            return { next, changed }
          },
        }
      },
      after: async (tx, { next, changed }) => {
        const saved = await updateUnit(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: next,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.org_unit.update', entity, changed)
        body = await unitBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Pozisyon komutları -----------------------------------------------------------------------------

async function positionBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findPosition(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('org position was not written')
  const day = todayOf(ctx)
  const holders = (await assignmentsOn(tx, ctx.institutionId, day)).filter(
    (holder) => holder.positionId === id,
  )
  return { data: positionView(saved, holders, day) }
}

const titlesOf = (positions: readonly StoredPosition[], unitId: string, except: string | null) =>
  positions
    .filter((position) => position.unitId === unitId && position.id !== except)
    .map((position) => position.title)

/** Yeni pozisyon (K-443). `Idempotency-Key` rotada zorunlu. 201. */
export function createPositionCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: POSITION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.org_position.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = orgPositionInputSchema.parse(input)
        const [unit, positions] = await Promise.all([
          findUnit(tx, ctx.institutionId, parsed.unitId),
          listPositions(tx, ctx.institutionId),
        ])
        return {
          run: () => {
            if (positions.length >= ORG_POSITIONS_MAX)
              throw limitError(
                'org_position_limit',
                `Kurumda en fazla ${String(ORG_POSITIONS_MAX)} pozisyon tanımlanabilir.`,
              )
            assertPositionUnit(unit)
            assertReportingLine({
              positionId: null,
              reportsToPositionId: parsed.reportsToPositionId,
              positions,
            })
            assertUniqueName({
              name: parsed.title,
              siblings: titlesOf(positions, parsed.unitId, null),
              kind: 'position',
            })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertPosition(tx, ctx.institutionId, {
          id,
          ...parsed,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.org_position.create', entity, [
          'unitId',
          'title',
          'headcount',
          ...(parsed.reportsToPositionId === null ? [] : ['reportsToPositionId']),
        ])
        body = await positionBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Pozisyon düzeltme, taşıma, kadro sayısı ve raporlama hattı (K-443, K-444). */
export function updatePositionCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: POSITION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.org_position.update',
      collections: [],
      entity,
      load: async (tx) => {
        const positions = await listPositions(tx, ctx.institutionId)
        const position = positions.find((item) => item.id === id)
        if (position === undefined) throw new NotFoundError()
        if (position.version !== expectedVersion) throw new ConflictError()
        const parsed = orgPositionUpdateSchema.parse(input)
        const next = {
          unitId: parsed.unitId ?? position.unitId,
          title: parsed.title ?? position.title,
          headcount: parsed.headcount ?? position.headcount,
          reportsToPositionId:
            parsed.reportsToPositionId === undefined
              ? position.reportsToPositionId
              : parsed.reportsToPositionId,
        }
        const [unit, ranges] = await Promise.all([
          next.unitId === position.unitId ? null : findUnit(tx, ctx.institutionId, next.unitId),
          next.headcount < position.headcount
            ? positionRanges(tx, ctx.institutionId, id)
            : Promise.resolve([]),
        ])
        return {
          run: () => {
            const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
              (key) => next[key] !== position[key],
            )
            if (changed.length === 0)
              throw new DomainError('org_position_unchanged', 'Değişiklik yok.')
            if (changed.includes('unitId')) assertPositionUnit(unit)
            if (changed.includes('reportsToPositionId'))
              assertReportingLine({
                positionId: id,
                reportsToPositionId: next.reportsToPositionId,
                positions,
              })
            if (changed.includes('headcount'))
              assertHeadcount({
                headcount: next.headcount,
                assignments: ranges,
                today: todayOf(ctx),
              })
            if (changed.includes('title') || changed.includes('unitId'))
              assertUniqueName({
                name: next.title,
                siblings: titlesOf(positions, next.unitId, id),
                kind: 'position',
              })
            return { next, changed }
          },
        }
      },
      after: async (tx, { next, changed }) => {
        const saved = await updatePosition(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: next,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.org_position.update', entity, changed)
        body = await positionBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Pozisyonu kaldır (arşiv; K-443). Raporlayan pozisyon ya da bitmemiş atama varken 422. */
export function archivePositionCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: POSITION, id }
  return runCommand(
    ctx,
    {
      action: 'finance.org_position.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const positions = await listPositions(tx, ctx.institutionId)
        const position = positions.find((item) => item.id === id)
        if (position === undefined) throw new NotFoundError()
        if (position.version !== expectedVersion) throw new ConflictError()
        const openAssignments = await openAssignmentsOfPosition(
          tx,
          ctx.institutionId,
          id,
          todayOf(ctx),
        )
        return {
          run: () =>
            assertPositionArchivable({
              reports: positions.filter((item) => item.reportsToPositionId === id).length,
              openAssignments,
            }),
        }
      },
      after: async (tx) => {
        const saved = await updatePosition(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { archivedAt: ctx.now },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.org_position.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id, archivedAt: ctx.now.toISOString() } } }),
    idempotency,
  )
}

// --- Atama komutları --------------------------------------------------------------------------------

async function assignmentBody(tx: Database, ctx: ServiceContext, id: string) {
  const saved = await findAssignment(tx, ctx.institutionId, id)
  if (saved === null) throw new Error('org assignment was not written')
  return { data: assignmentView(saved, todayOf(ctx)) }
}

/** Personeli pozisyona ata (K-444). `Idempotency-Key` rotada zorunlu. 201. */
export function createAssignmentCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ASSIGNMENT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.org_assignment.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = orgAssignmentInputSchema.parse(input)
        const position = await findPosition(tx, ctx.institutionId, parsed.positionId)
        // Kural hatası (422) yalnız `run` içinde HTTP'ye çevrilir; yükleme yalnız okur.
        const [unit, staff, others] = await Promise.all([
          position === null ? null : findUnit(tx, ctx.institutionId, position.unitId),
          findAssignmentStaff(tx, ctx.institutionId, parsed.membershipId),
          position === null ? [] : positionRanges(tx, ctx.institutionId, position.id),
        ])
        return {
          run: () => {
            if (position === null)
              throw new DomainError('org_assignment_position_not_found', 'Pozisyon bulunamadı.', {
                path: ['positionId'],
              })
            assertAssignmentStaff(staff)
            if (unit?.isActive !== true)
              throw new DomainError(
                'org_unit_inactive',
                'Pasif birimin pozisyonuna atama yapılamaz.',
                {
                  path: ['positionId'],
                },
              )
            assertAssignmentRange({
              range: parsed,
              membershipId: parsed.membershipId,
              headcount: position.headcount,
              others,
            })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        await insertAssignment(tx, ctx.institutionId, {
          id,
          ...parsed,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.org_assignment.create', entity, [
          'positionId',
          'membershipId',
          'startDate',
          ...(parsed.endDate === null ? [] : ['endDate']),
        ])
        body = await assignmentBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Atamanın bitiş gününü yaz ya da kaldır (K-444): aralık yine çakışma ve kadro denetiminden geçer. */
export function updateAssignmentCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ASSIGNMENT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.org_assignment.update',
      collections: [],
      entity,
      load: async (tx) => {
        const assignment = await findAssignment(tx, ctx.institutionId, id)
        if (assignment === null) throw new NotFoundError()
        if (assignment.version !== expectedVersion) throw new ConflictError()
        const { endDate } = orgAssignmentUpdateSchema.parse(input)
        const [position, ranges] = await Promise.all([
          findPosition(tx, ctx.institutionId, assignment.positionId),
          positionRanges(tx, ctx.institutionId, assignment.positionId),
        ])
        return {
          run: () => {
            if (endDate === assignment.endDate)
              throw new DomainError('org_assignment_unchanged', 'Değişiklik yok.', {
                path: ['endDate'],
              })
            if (position === null)
              throw new DomainError(
                'org_position_archived',
                'Kaldırılmış pozisyonun ataması değiştirilemez.',
              )
            assertAssignmentRange({
              range: { startDate: assignment.startDate, endDate },
              membershipId: assignment.membershipId,
              headcount: position.headcount,
              others: ranges.filter((range) => range.id !== id),
            })
            return endDate
          },
        }
      },
      after: async (tx, endDate) => {
        const saved = await updateAssignment(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { endDate },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.org_assignment.update', entity, ['endDate'])
        body = await assignmentBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Yanlış girilen atamayı kaldır (arşiv; K-444). Biten atama için bitiş günü yazılır. */
export function archiveAssignmentCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ASSIGNMENT, id }
  return runCommand(
    ctx,
    {
      action: 'finance.org_assignment.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const assignment = await findAssignment(tx, ctx.institutionId, id)
        if (assignment === null) throw new NotFoundError()
        if (assignment.version !== expectedVersion) throw new ConflictError()
        return { run: () => undefined }
      },
      after: async (tx) => {
        const saved = await updateAssignment(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: { archivedAt: ctx.now },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.org_assignment.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id, archivedAt: ctx.now.toISOString() } } }),
    idempotency,
  )
}
