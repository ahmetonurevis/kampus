import { randomUUID } from 'node:crypto'

import type { FastifyBaseLogger } from 'fastify'
import { z } from 'zod'

import { requireAuthorized } from '@kampus/school-core/lib/authorize.ts'
import {
  applyFreezeStart,
  assertFreezeRequester,
  clearFreezeFlag,
  freezePhase,
  freezesAvailableFor,
  groupsToFreeze,
  openInstallmentsDuring,
  placementRenewalRequired,
  planFreezeApproval,
  planFreezeRejection,
  planFreezeRequest,
  planFreezeReturn,
  type FreezeStatus,
} from '@kampus/school-core/lib/enrollment-freezes.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import type { LanguageGroup } from '@kampus/school-core/lib/language-groups.ts'
import { isMinorLearner } from '@kampus/school-core/lib/notifications.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import {
  dueFreezes,
  findFreeze,
  insertFreeze,
  listFreezes,
  listStudentFreezes,
  loadLearnerGroups,
  releaseLearnerGroups,
  setLearnerGroupStatus,
  updateFreeze,
  type LearnerGroup,
  type StoredFreeze,
} from '../db/enrollment-freezes.ts'
import { loadFinanceRecords } from '../db/finance-mirror-store.ts'
import { loadGroupMembers, loadGroups, loadWaitlist } from '../db/language-groups.ts'
import { allocatedForInvoices } from '../db/payments.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { environment } from './commands.ts'
import { getInstitutionModules } from './modules.ts'
import { learnerFactsOf } from './learner-age.ts'
import {
  runCommand,
  runOperation,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { readScope } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Kayıt dondurma servisi (docs/domain/dil-okulu.md DOM-DIL-052; kayit-ve-crm.md DOM-KAY-024, -026;
 * IST-084). Kural core `lib/enrollment-freezes.ts`'tedir. Karar, öğrencinin bayrağı ve grup üyeliği
 * kurum kilidi altında tek transaction'dadır. Serbest metin loglanmaz, denetime yalnız alan adları
 * düşer. Taksit planına ve MEBBİS kaydına bu servis yazmaz: açık taksit sayısı yalnız bilgidir
 * (erteleme ek protokolle; DOM-DIL-052), MEBBİS etkisi doğrulanmalı (H-24).
 */

const REQUEST = OPERATION_COMMANDS['enrollment.freezeRequest']
const DECIDE = OPERATION_COMMANDS['enrollment.freezeDecide']
const RETURN = OPERATION_COMMANDS['enrollment.freezeReturn']
const ENTITY = 'enrollment_freezes'

const toFacts = (row: StoredFreeze) => ({
  id: row.id,
  status: row.status,
  startDate: row.startDate,
  returnDate: row.returnDate,
  endedDate: row.endedDate,
  startedAt: row.startedAt,
})

export type FreezeView = StoredFreeze & {
  phase: ReturnType<typeof freezePhase>
  placementRenewalRequired: boolean
  /** Aralıkta vadesi gelen açık taksit; plan değişmez, erteleme ek protokolledir. */
  openInstallmentsDuring: number
  groups: { id: string; name: string; memberStatus: LearnerGroup['memberStatus'] }[]
}

const invoiceRow = z.object({
  id: z.string(),
  studentId: z.string(),
  amount: z.number().int(),
  dueDate: z.string(),
  paidAt: z.string().nullable().optional(),
})

/** Yanıt görünümleri: üyelikler ve taksitler sayfa başına bir kez okunur. */
async function viewsOf(
  db: Database,
  ctx: ServiceContext,
  rows: readonly StoredFreeze[],
): Promise<FreezeView[]> {
  const today = dayKey(ctx.now)
  const studentIds = [...new Set(rows.map((row) => row.studentId))]
  const learnerGroups = await loadLearnerGroups(db, ctx.institutionId, studentIds)
  const invoiceRows =
    studentIds.length === 0
      ? []
      : await loadFinanceRecords(db, ctx.institutionId, 'invoices', {
          match: [{ kind: 'equals', field: 'studentId', values: studentIds }],
        })
  const invoices = invoiceRows.map((row) => invoiceRow.parse({ ...row.data, id: row.id }))
  const allocated = await allocatedForInvoices(
    db,
    ctx.institutionId,
    invoices.map((invoice) => invoice.id),
  )
  return rows.map((row) => ({
    ...row,
    phase: freezePhase(row, today),
    placementRenewalRequired: placementRenewalRequired(row),
    openInstallmentsDuring: openInstallmentsDuring(
      invoices.filter((invoice) => invoice.studentId === row.studentId),
      allocated,
      row,
    ),
    groups: learnerGroups
      .filter((group) => group.studentId === row.studentId)
      .map((group) => ({
        id: group.groupId,
        name: group.name,
        memberStatus: group.memberStatus,
      })),
  }))
}

async function viewOf(db: Database, ctx: ServiceContext, id: string): Promise<FreezeView> {
  const row = await findFreeze(db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  const [view] = await viewsOf(db, ctx, [row])
  if (view === undefined) throw new NotFoundError()
  return view
}

/** Kursiyer ve velinin okuma kapsamı; personel bütün kurumu görür (`null`). */
async function visibleStudents(ctx: ServiceContext): Promise<readonly string[] | null> {
  if (ctx.actor.role !== 'ogrenci' && ctx.actor.role !== 'veli') return null
  return [...(await readScope(ctx)).studentIds]
}

export async function listFreezesFor(
  ctx: ServiceContext,
  query: {
    status?: FreezeStatus | undefined
    q?: string | undefined
    page: number
    pageSize: number
  },
): Promise<{ items: FreezeView[]; total: number }> {
  const studentIds = await visibleStudents(ctx)
  const { items, total } = await listFreezes(ctx.db, ctx.institutionId, { ...query, studentIds })
  return { items: await viewsOf(ctx.db, ctx, items), total }
}

export async function getFreezeFor(ctx: ServiceContext, id: string): Promise<FreezeView> {
  const view = await viewOf(ctx.db, ctx, id)
  const studentIds = await visibleStudents(ctx)
  if (studentIds !== null && !studentIds.includes(view.studentId)) throw new NotFoundError()
  return view
}

const toCourseDates = (group: LearnerGroup) => ({
  state: group.state,
  startDate: group.startDate,
  endDate: group.endDate,
})

/**
 * Etkiyi doğurur (DOM-DIL-052): kapanmamış gruptaki üyelikler `frozen` olur, kapasitede yer tutmaz.
 * Öğrencinin bayrağı aynı transaction'da işlemin `run` adımındadır.
 */
async function freezeLearnerGroups(tx: Database, ctx: ServiceContext, studentId: string) {
  const learnerGroups = await loadLearnerGroups(tx, ctx.institutionId, [studentId])
  const groupIds = groupsToFreeze(
    learnerGroups.map((item) => ({ groupId: item.groupId, status: item.memberStatus })),
    learnerGroups.map((item) => ({ id: item.groupId, ...toCourseDates(item) })),
    ctx.now.toISOString(),
  )
  await setLearnerGroupStatus(tx, ctx.institutionId, studentId, groupIds, 'frozen', ctx.now)
}

/** Dondurma talebi: kursiyer (18 yaş altında veli) ya da personel açar. 201. */
export function requestFreezeCommand(
  ctx: ServiceContext,
  studentId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  let result: FreezeView | undefined
  return runCommand(
    ctx,
    {
      action: 'enrollment.freeze.request',
      collections: REQUEST.collections,
      entity: { type: ENTITY, id },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, REQUEST)
        const freezes = await listStudentFreezes(tx, ctx.institutionId, studentId)
        const learnerGroups = await loadLearnerGroups(tx, ctx.institutionId, [studentId])
        const facts = await learnerFactsOf(tx, ctx.institutionId, [studentId])
        return {
          scalars,
          run: (state, { now }) => {
            requireAuthorized(actor, 'enrollment.freezeRequest', { studentId }, state, {
              now,
              institutionType,
            })
            assertFreezeRequester(
              actor.role,
              isMinorLearner(facts.get(studentId) ?? {}, { institutionType, now }),
            )
            return planFreezeRequest({
              input,
              student: state.students.find((item) => item.id === studentId),
              freezes: freezes.map(toFacts),
              groups: learnerGroups.map(toCourseDates),
              today: dayKey(now),
            })
          },
        }
      },
      after: async (tx, plan) => {
        await insertFreeze(tx, ctx.institutionId, {
          id,
          studentId,
          reason: plan.reason,
          reasonNote: plan.reasonNote,
          startDate: plan.startDate,
          returnDate: plan.returnDate,
          midCourse: plan.midCourse,
          documentReceived: plan.documentReceived,
          documentNote: plan.documentNote,
          requestedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'enrollment.freeze.request', { type: ENTITY, id }, [
          'reason',
          'reasonNote',
          'startDate',
          'returnDate',
          'midCourse',
          'documentReceived',
          'documentNote',
        ])
        result = await viewOf(tx, ctx, id)
      },
    },
    () => {
      if (result === undefined) throw new Error('freeze was not written')
      return { statusCode: 201, body: { data: result } }
    },
    idempotency,
  )
}

/** Kararın ortak yüklemesi: yok ya da başka kurum 404, sürüm tutmazsa 409. */
async function lockedFreeze(
  tx: Database,
  ctx: ServiceContext,
  freezeId: string,
  expectedVersion: number,
): Promise<StoredFreeze> {
  const row = await findFreeze(tx, ctx.institutionId, freezeId)
  if (row === null) throw new NotFoundError()
  if (row.version !== expectedVersion) throw new ConflictError()
  return row
}

/** Yönetici onayı (DOM-DIL-052): koşullar güncel veriyle yeniden denetlenir; başlangıç geldiyse etki doğar. */
export function approveFreezeCommand(
  ctx: ServiceContext,
  freezeId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let result: FreezeView | undefined
  return runCommand(
    ctx,
    {
      action: 'enrollment.freeze.approve',
      collections: DECIDE.collections,
      entity: { type: ENTITY, id: freezeId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, DECIDE)
        const row = await lockedFreeze(tx, ctx, freezeId, expectedVersion)
        const freezes = await listStudentFreezes(tx, ctx.institutionId, row.studentId)
        const learnerGroups = await loadLearnerGroups(tx, ctx.institutionId, [row.studentId])
        return {
          scalars,
          run: (state, { now }) => {
            requireAuthorized(actor, 'enrollment.freezeDecide', {}, state, { now, institutionType })
            const plan = planFreezeApproval({
              freeze: { ...toFacts(row), documentReceived: row.documentReceived },
              input,
              student: state.students.find((item) => item.id === row.studentId),
              freezes: freezes.map(toFacts),
              groups: learnerGroups.map(toCourseDates),
              today: dayKey(now),
            })
            if (plan.startsNow) applyFreezeStart(state, row.studentId, now)
            return { ...plan, studentId: row.studentId }
          },
        }
      },
      after: async (tx, plan) => {
        const saved = await updateFreeze(
          tx,
          ctx.institutionId,
          freezeId,
          expectedVersion,
          {
            status: 'approved',
            midCourse: plan.midCourse,
            decidedByUserId: ctx.actor.userId,
            decidedAt: ctx.now,
            decisionNote: plan.note,
            ...(plan.startsNow ? { startedAt: ctx.now } : {}),
          },
          ctx.now,
        )
        if (!saved) throw new ConflictError()
        if (plan.startsNow) await freezeLearnerGroups(tx, ctx, plan.studentId)
        await auditWork(tx, ctx, 'enrollment.freeze.approve', { type: ENTITY, id: freezeId }, [
          'status',
          'midCourse',
          'decisionNote',
          ...(plan.startsNow ? ['startedAt'] : []),
        ])
        result = await viewOf(tx, ctx, freezeId)
      },
    },
    () => {
      if (result === undefined) throw new Error('freeze was not approved')
      return { statusCode: 200, body: { data: result } }
    },
    idempotency,
  )
}

export function rejectFreezeCommand(
  ctx: ServiceContext,
  freezeId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let result: FreezeView | undefined
  return runCommand(
    ctx,
    {
      action: 'enrollment.freeze.reject',
      collections: DECIDE.collections,
      entity: { type: ENTITY, id: freezeId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, DECIDE)
        const row = await lockedFreeze(tx, ctx, freezeId, expectedVersion)
        return {
          scalars,
          run: (state, { now }) => {
            requireAuthorized(actor, 'enrollment.freezeDecide', {}, state, { now, institutionType })
            return planFreezeRejection({ freeze: toFacts(row), input })
          },
        }
      },
      after: async (tx, plan) => {
        const saved = await updateFreeze(
          tx,
          ctx.institutionId,
          freezeId,
          expectedVersion,
          {
            status: 'rejected',
            decidedByUserId: ctx.actor.userId,
            decidedAt: ctx.now,
            decisionNote: plan.note,
          },
          ctx.now,
        )
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'enrollment.freeze.reject', { type: ENTITY, id: freezeId }, [
          'status',
          'decisionNote',
        ])
        result = await viewOf(tx, ctx, freezeId)
      },
    },
    () => {
      if (result === undefined) throw new Error('freeze was not rejected')
      return { statusCode: 200, body: { data: result } }
    },
    idempotency,
  )
}

/**
 * Dönüş (DOM-DIL-052): bayrak kalkar, uygun gruptaki üyelik geri açılır, kalanı kapanır ve kursiyer
 * yeniden yerleştirilir. Başlamadan biten dondurmada üyelik zaten değişmemiştir.
 */
export function returnFreezeCommand(
  ctx: ServiceContext,
  freezeId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let result: FreezeView | undefined
  return runCommand(
    ctx,
    {
      action: 'enrollment.freeze.return',
      collections: RETURN.collections,
      entity: { type: ENTITY, id: freezeId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, RETURN)
        const row = await lockedFreeze(tx, ctx, freezeId, expectedVersion)
        const learnerGroups = await loadLearnerGroups(tx, ctx.institutionId, [row.studentId])
        const frozen = learnerGroups.filter((item) => item.memberStatus === 'frozen')
        const frozenIds = new Set(frozen.map((item) => item.groupId))
        const groups: LanguageGroup[] = (await loadGroups(tx, ctx.institutionId)).filter((group) =>
          frozenIds.has(group.id),
        )
        const members = await loadGroupMembers(tx, ctx.institutionId, [...frozenIds])
        const waitlist = await loadWaitlist(tx, ctx.institutionId, [
          ...new Set(frozen.map((item) => item.courseId)),
        ])
        return {
          scalars,
          run: (state, { now }) => {
            requireAuthorized(actor, 'enrollment.freezeReturn', {}, state, { now, institutionType })
            const plan = planFreezeReturn({
              freeze: toFacts(row),
              learnerGroupIds: [...frozenIds],
              groups,
              members,
              waitlist,
              now,
            })
            if (plan.started) clearFreezeFlag(state, row.studentId)
            return { ...plan, studentId: row.studentId }
          },
        }
      },
      after: async (tx, plan) => {
        const saved = await updateFreeze(
          tx,
          ctx.institutionId,
          freezeId,
          expectedVersion,
          { status: 'ended', endedDate: plan.endedDate, needsPlacement: plan.needsPlacement },
          ctx.now,
        )
        if (!saved) throw new ConflictError()
        await setLearnerGroupStatus(
          tx,
          ctx.institutionId,
          plan.studentId,
          plan.restoreGroupIds,
          'active',
          ctx.now,
        )
        await releaseLearnerGroups(
          tx,
          ctx.institutionId,
          plan.studentId,
          plan.releaseGroupIds,
          ctx.now,
        )
        await auditWork(tx, ctx, 'enrollment.freeze.return', { type: ENTITY, id: freezeId }, [
          'status',
          'endedDate',
          'needsPlacement',
        ])
        result = await viewOf(tx, ctx, freezeId)
      },
    },
    () => {
      if (result === undefined) throw new Error('freeze was not ended')
      return { statusCode: 200, body: { data: result } }
    },
    idempotency,
  )
}

export type FreezeStartResult = { due: number; started: number; skipped: string | null }

/**
 * Başlangıç günü gelen onaylı dondurmaların etkisini doğurur (`jobs/enrollment-freezes.ts`). İş
 * idempotenttir: etkisi doğan kayıt taramaya girmez, satır sürümü değiştiyse o kayıt sonraki koşuya
 * kalır. Denetim satırının aktörü kararı veren yöneticidir: etki onun ileri tarihli kararıdır.
 */
export async function startDueFreezes(input: {
  db: Database
  institutionId: string
  now: Date
  log: FastifyBaseLogger
}): Promise<FreezeStartResult> {
  const { db, institutionId, now, log } = input
  const institution = await getInstitutionModules(db, institutionId)
  if (institution === null) return { due: 0, started: 0, skipped: 'institution_missing' }
  if (!freezesAvailableFor(institution.type)) return { due: 0, started: 0, skipped: 'unavailable' }
  if (institution.modules.crm !== true) return { due: 0, started: 0, skipped: 'module_disabled' }
  const due = await dueFreezes(db, institutionId, dayKey(now))
  let started = 0
  for (const row of due) {
    if (row.decidedByUserId === null) continue
    const ctx: ServiceContext = {
      db,
      institutionId,
      now,
      log,
      actor: { userId: row.decidedByUserId, role: 'yonetici', membershipId: '' },
    }
    await runOperation(ctx, {
      action: 'enrollment.freeze.start',
      collections: ['students'],
      loadScope: { students: { ids: [row.studentId] } },
      entity: { type: ENTITY, id: row.id },
      run: (state, tools) => {
        applyFreezeStart(state, row.studentId, tools.now)
      },
      after: async (tx) => {
        const saved = await updateFreeze(
          tx,
          institutionId,
          row.id,
          row.version,
          { startedAt: now },
          now,
        )
        if (!saved) throw new ConflictError()
        await freezeLearnerGroups(tx, ctx, row.studentId)
        await auditWork(tx, ctx, 'enrollment.freeze.start', { type: ENTITY, id: row.id }, [
          'startedAt',
        ])
      },
    })
    started += 1
  }
  return { due: due.length, started, skipped: null }
}
