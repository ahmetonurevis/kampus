import { randomUUID } from 'node:crypto'

import { subjectById } from '@kampus/school-core/data/curriculum.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  planStaffingPlan,
  planStaffingPositionUpdate,
  scheduleHoursBySubject,
  staffingPlanInputSchema,
  staffingPositionInputSchema,
  staffingPositionUpdateSchema,
  staffingRows,
  staffingTotals,
  staffingWeek,
  type StaffingPayBasis,
  type StaffingTeacher,
} from '@kampus/school-core/lib/finance-staffing-plans.ts'

import type { Database } from '../db/client.ts'
import { loadBranchData } from '../db/finance-leave-calendar.ts'
import { loadScheduleLessons } from '../db/finance-leave-requests.ts'
import { loadStaffPayRates } from '../db/finance-pay-rates.ts'
import {
  findStaffingPosition,
  insertStaffingPosition,
  jobOfferExists,
  listStaffingPositions,
  loadStaffingPlan,
  saveStaffingPlan,
  updateStaffingPosition,
} from '../db/finance-staffing-plans.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { dayRange } from './list-filters.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Kadro planı ve açık pozisyon (DOM-FIN-126; ON-188; K-433…K-435). Kural core
 * `lib/finance-staffing-plans.ts`'tedir. Yalnız yönetici okur ve yazar. Branş öğretmen kaydının
 * dersidir (K-421; izin takvimiyle aynı kaynak); ders programı ve ücret tanımı yalnız okunur, ücret
 * tutarı yanıta girmez (yalnız tam zamanlı/saatlik ayrımı).
 */

const PLAN_ENTITY = 'staffing_plan'
const POSITION_ENTITY = 'staffing_position'

/** Yürürlükteki ana ücret tanımının türü: aylık → tam zamanlı, saatlik ya da ders saati → saatlik. */
async function payBases(
  db: Database,
  institutionId: string,
  membershipIds: readonly string[],
  today: string,
): Promise<Map<string, StaffingPayBasis>> {
  const rates = await loadStaffPayRates(db, institutionId, membershipIds)
  const bases = new Map<string, StaffingPayBasis>()
  for (const rate of rates)
    if (
      rate.component === 'wage' &&
      rate.startDate <= today &&
      (rate.endDate === null || rate.endDate >= today)
    )
      bases.set(
        rate.membershipId,
        rate.rateType === 'hourly' || rate.rateType === 'lesson_hour' ? 'hourly' : 'full_time',
      )
  return bases
}

const subjectName = (names: ReadonlyMap<string, string>, id: string) =>
  names.get(id) ?? subjectById(id)?.name ?? id

/**
 * Plan ve hesap (K-433…K-435): `weekOf` gününün haftası (varsayılan bugün) ders programı önerisinin
 * kaynağıdır.
 */
export async function staffingPlanFor(
  ctx: ServiceContext,
  academicYear: number,
  weekOf: string | undefined,
) {
  const today = dayKey(ctx.now)
  const week = staffingWeek(weekOf ?? today)
  const range = dayRange('date', week.startDate, week.endDate)
  const [plan, positions, branch, lessons] = await Promise.all([
    loadStaffingPlan(ctx.db, ctx.institutionId, academicYear),
    listStaffingPositions(ctx.db, ctx.institutionId, academicYear),
    loadBranchData(ctx.db, ctx.institutionId),
    range === null ? Promise.resolve([]) : loadScheduleLessons(ctx.db, ctx.institutionId, range),
  ])
  const bases = await payBases(ctx.db, ctx.institutionId, [...branch.branches.keys()], today)
  const teachers: StaffingTeacher[] = [...branch.branches.entries()].map(
    ([membershipId, subjectIds]) => ({
      membershipId,
      subjectIds: [...subjectIds].sort(),
      payBasis: bases.get(membershipId) ?? 'unknown',
    }),
  )
  const rows = staffingRows({
    normHours: plan.normHours,
    lines: plan.lines,
    scheduleHours: scheduleHoursBySubject(
      lessons.map((lesson) => ({
        subjectId: lesson.subjectId,
        cancelled: lesson.cancelledAt !== null,
      })),
    ),
    teachers,
    positions,
  })
  const names = branch.subjectNames
  return {
    ...plan,
    week,
    rows: rows
      .map((row) => ({ ...row, subjectName: subjectName(names, row.subjectId) }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'tr')),
    totals: staffingTotals(rows, plan.normHours),
    teachersWithoutPayRate: teachers.filter((teacher) => teacher.payBasis === 'unknown').length,
    positions: positions.map((position) => ({
      ...position,
      subjectName: subjectName(names, position.subjectId),
    })),
    subjects: [...new Set([...names.keys(), ...rows.map((row) => row.subjectId)])]
      .map((id) => ({ id, name: subjectName(names, id) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.id.localeCompare(b.id)),
  }
}

/** Plan yazımı (K-433): norm ve satırlar bütün; `If-Match` plan sürümü (hiç yoksa 1). */
export function saveStaffingPlanCommand(
  ctx: ServiceContext,
  academicYear: number,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PLAN_ENTITY, id: String(academicYear) }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staffing_plan.save',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = staffingPlanInputSchema.parse(input)
        const current = await loadStaffingPlan(tx, ctx.institutionId, academicYear)
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planStaffingPlan(current, parsed) }
      },
      after: async (tx, plan) => {
        const saved = await saveStaffingPlan(tx, ctx.institutionId, {
          academicYear,
          ...plan.next,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (saved === null) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staffing_plan.save', entity, plan.changed)
        body = { data: await loadStaffingPlan(tx, ctx.institutionId, academicYear) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Teklif bağı kurumun teklifi olmalı; ret kural çalışırken (`run`) fırlatılır ki 422 olsun. */
async function offerCheck(tx: Database, institutionId: string, id: string | null | undefined) {
  const missing = id !== null && id !== undefined && !(await jobOfferExists(tx, institutionId, id))
  return () => {
    if (missing)
      throw new DomainError('staffing_position_offer_not_found', 'İş teklifi bulunamadı.', {
        kind: 'rule',
        path: ['jobOfferId'],
      })
  }
}

async function positionBody(tx: Database, institutionId: string, id: string) {
  const position = await findStaffingPosition(tx, institutionId, id)
  if (position === null) throw new NotFoundError()
  return { data: position }
}

/** Yeni pozisyon (K-435): açık durumda. 201. */
export function createStaffingPositionCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: POSITION_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staffing_position.create',
      collections: [],
      entity,
      load: async (tx) => {
        const data = staffingPositionInputSchema.parse(input)
        const checkOffer = await offerCheck(tx, ctx.institutionId, data.jobOfferId)
        return {
          run: () => {
            checkOffer()
            return data
          },
        }
      },
      after: async (tx, data) => {
        await insertStaffingPosition(tx, ctx.institutionId, {
          ...data,
          id,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        const fields = Object.entries(data)
          .filter(([, value]) => value !== null)
          .map(([key]) => key)
        await auditWork(tx, ctx, 'finance.staffing_position.create', entity, fields)
        body = await positionBody(tx, ctx.institutionId, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Pozisyon durumu ve alanları (K-435); `If-Match` pozisyon sürümü. */
export function updateStaffingPositionCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: POSITION_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.staffing_position.update',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await findStaffingPosition(tx, ctx.institutionId, id)
        if (current === null) throw new NotFoundError()
        const update = staffingPositionUpdateSchema.parse(input)
        if (current.version !== expectedVersion) throw new ConflictError()
        const checkOffer = await offerCheck(
          tx,
          ctx.institutionId,
          update.jobOfferId === current.jobOfferId ? undefined : update.jobOfferId,
        )
        return {
          run: () => {
            checkOffer()
            return planStaffingPositionUpdate(current, update)
          },
        }
      },
      after: async (tx, plan) => {
        const saved = await updateStaffingPosition(tx, ctx.institutionId, id, {
          ...plan.next,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.staffing_position.update', entity, plan.changed)
        body = await positionBody(tx, ctx.institutionId, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
