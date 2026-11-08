import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  planAwardMebbis,
  planProgramCreate,
  planProgramNotify,
  createScholarshipProgramSchema,
} from '@kampus/school-core/lib/finance-scholarships.ts'

import type { Database } from '../db/client.ts'
import {
  archiveStudentScholarshipAwards,
  findScholarshipAward,
  findScholarshipProgram,
  insertScholarshipProgram,
  listScholarshipAwards,
  listScholarshipPrograms,
  scholarshipProgramNames,
  setScholarshipAwardMebbis,
  setScholarshipProgramNotified,
} from '../db/finance-scholarships.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { releaseAwardFundAllocations } from './finance-scholarship-funds.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Burs programı servisi (DOM-FIN-025; IST-105). Kural core `lib/finance-scholarships.ts`'tedir.
 * Atama kesin kayıtla aynı işlemde yazılır (`services/prospects.ts`). Denetime alan adları düşer.
 */

const PROGRAM = 'scholarship_programs'
const AWARD = 'scholarship_awards'

export const listScholarshipProgramsFor = (
  ctx: ServiceContext,
  query: { academicYear?: number | undefined; page: number; pageSize: number },
) => listScholarshipPrograms(ctx.db, ctx.institutionId, query)

export const listScholarshipAwardsFor = (
  ctx: ServiceContext,
  query: { programId?: string | undefined; page: number; pageSize: number },
) => listScholarshipAwards(ctx.db, ctx.institutionId, query)

async function reloadProgram(tx: Database, ctx: ServiceContext, id: string) {
  const row = await findScholarshipProgram(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return row
}

/** Yeni burs programı açar; bildirim günü sonradan işlenir. 201. */
export function createScholarshipProgramCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const { academicYear } = createScholarshipProgramSchema.parse(input)
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'scholarship.create',
      collections: [],
      entity: { type: PROGRAM, id },
      load: async (tx) => {
        const names = await scholarshipProgramNames(tx, ctx.institutionId, academicYear)
        return { run: () => planProgramCreate(input, names) }
      },
      after: async (tx, plan) => {
        await insertScholarshipProgram(tx, ctx.institutionId, {
          id,
          academicYear: plan.academicYear,
          name: plan.name,
          conditions: plan.conditions,
          terminationConditions: plan.terminationConditions,
          durationNote: plan.durationNote,
          percentBasisPoints: plan.percentBasisPoints ?? null,
          amountCents: plan.amountCents ?? null,
          capacity: plan.capacity,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'scholarship.create', { type: PROGRAM, id }, Object.keys(plan))
        body = { data: { ...(await reloadProgram(tx, ctx, id)), awardedCount: 0 } }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** İl millî eğitim müdürlüğüne bildirim gününü işler; ancak bundan sonra atama yapılır. */
export function notifyScholarshipProgramCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'scholarship.notify',
      collections: [],
      entity: { type: PROGRAM, id },
      load: async (tx) => {
        const row = await reloadProgram(tx, ctx, id)
        if (row.version !== expectedVersion) throw new ConflictError()
        return { run: () => planProgramNotify(row, input, dayKey(ctx.now)) }
      },
      after: async (tx, plan) => {
        const saved = await setScholarshipProgramNotified(tx, ctx.institutionId, {
          id,
          expectedVersion,
          notifiedDate: plan.notifiedDate,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'scholarship.notify', { type: PROGRAM, id }, ['notifiedDate'])
        body = { data: await reloadProgram(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Atamanın MEBBİS'e işlendiği günü kaydeder (DOM-FIN-025). */
export function recordScholarshipMebbisCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'scholarship.mebbis',
      collections: [],
      entity: { type: AWARD, id },
      load: async (tx) => {
        const row = await findScholarshipAward(tx, ctx.institutionId, id)
        if (row === null) throw new NotFoundError()
        if (row.version !== expectedVersion) throw new ConflictError()
        return { run: () => planAwardMebbis(row, input, dayKey(ctx.now)) }
      },
      after: async (tx, plan) => {
        const saved = await setScholarshipAwardMebbis(tx, ctx.institutionId, {
          id,
          expectedVersion,
          recordedDate: plan.recordedDate,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'scholarship.mebbis', { type: AWARD, id }, ['mebbisRecordedDate'])
        const row = await findScholarshipAward(tx, ctx.institutionId, id)
        if (row === null) throw new NotFoundError()
        body = { data: row }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Ayrılışla iptal edilen burslu yenilemelerin atamalarını arşivler ve fondan karşılanan paylarını
 * bırakır (K-117; DOM-FIN-025, DOM-FIN-068). Ayrılış komutunun transaction'ında, kurum kilidi
 * altında çalışır; süren yılın bursu ve fon payı kalır.
 */
export async function archiveCancelledRenewalAwards(
  tx: Database,
  ctx: ServiceContext,
  studentId: string,
  academicYears: readonly number[],
): Promise<void> {
  const archived = await archiveStudentScholarshipAwards(tx, ctx.institutionId, {
    studentId,
    academicYears,
    now: ctx.now,
  })
  for (const id of archived)
    await auditWork(tx, ctx, 'scholarship.award_archive', { type: AWARD, id }, ['archivedAt'])
  await releaseAwardFundAllocations(
    tx,
    ctx,
    archived.map((awardId) => ({ awardId, keepCents: 0 })),
    'renewal_cancelled',
  )
}
