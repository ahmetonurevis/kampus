import { randomUUID } from 'node:crypto'

import { requireAuthorized } from '@kampus/school-core/lib/authorize.ts'
import {
  applyFreeTuitionBoard,
  freeTuitionMinimumQuota,
  freeTuitionRefundStatus,
  planFreeTuitionApplication,
  planFreeTuitionDocuments,
  planFreeTuitionMebbis,
  planFreeTuitionQuota,
  planFreeTuitionRefund,
  planFreeTuitionRound,
  recordFreeTuitionBoardSchema,
  type FreeTuitionRefundStatus,
  type FreeTuitionStatus,
} from '@kampus/school-core/lib/finance-free-tuition.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { refundPayerName } from '@kampus/school-core/lib/withdrawals.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import { isFinanceDayClosed } from '../db/finance-day-closings.ts'
import {
  countActiveStudents,
  findFreeTuitionApplication,
  findFreeTuitionAward,
  findFreeTuitionMeeting,
  findFreeTuitionRound,
  freeTuitionApplicationsById,
  freeTuitionRoundYears,
  insertFreeTuitionApplication,
  insertFreeTuitionAward,
  insertFreeTuitionMeeting,
  insertFreeTuitionRound,
  listFreeTuitionApplications,
  listFreeTuitionAwards,
  listFreeTuitionMeetings,
  listFreeTuitionRounds,
  markFreeTuitionRefundPaid,
  roundFreeTuitionApplications,
  setFreeTuitionDecision,
  setFreeTuitionDocuments,
  setFreeTuitionMebbis,
  setFreeTuitionQuota,
  type FreeTuitionAwardQuery,
  type StoredFreeTuitionAward,
} from '../db/finance-free-tuition.ts'
import {
  hasStudentScholarshipAward,
  studentsWithScholarshipAward,
} from '../db/finance-scholarships.ts'
import { allocatedByInvoice, listBankAccounts } from '../db/payments.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { environment } from './commands.ts'
import {
  FINANCE_TABLE_STORES,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
  type LoadScope,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Ücretsiz okutma servisi (docs/domain/finans.md DOM-FIN-026; IST-105; K-268…K-271). Kural core
 * `lib/finance-free-tuition.ts`'tedir. Kurul kararı, adayların kararı, hakların yazımı, kabul edilen
 * öğrencilerin açık öğrenim taksitlerinin kapanması ve denetim kaydı tek transaction'dadır, kurum
 * kilidi altındadır. Yetki yöneticidedir (`scholarship.manage`, DOM-FIN-052). Gerekçe, belge, IBAN
 * ve tutar loglanmaz; denetime yalnız alan adları düşer.
 */

const SPEC = OPERATION_COMMANDS['scholarship.manage']
const ROUND = 'free_tuition_rounds'
const APPLICATION = 'free_tuition_applications'
const MEETING = 'free_tuition_board_meetings'
const AWARD = 'free_tuition_awards'

const studentScope = (studentIds: readonly string[]): LoadScope => ({
  match: [{ kind: 'equals', field: 'studentId', values: [...studentIds] }],
})

export interface FreeTuitionRoundView {
  id: string
  academicYear: number
  teachingStartDate: string
  /** Bugünkü etkin öğrenci sayısı ve buna göre en az kontenjan (canlı, saklanmaz). */
  currentStudentCount: number
  currentMinimumQuota: number
  studentCount: number | null
  computedQuota: number | null
  confirmedQuota: number | null
  quotaConfirmedAt: string | null
  applicationCount: number
  acceptedCount: number
  version: number
}

export async function listFreeTuitionRoundsFor(
  ctx: ServiceContext,
): Promise<FreeTuitionRoundView[]> {
  const [rounds, studentCount] = await Promise.all([
    listFreeTuitionRounds(ctx.db, ctx.institutionId),
    countActiveStudents(ctx.db, ctx.institutionId),
  ])
  return rounds.map((round) => ({
    ...round,
    quotaConfirmedAt: round.quotaConfirmedAt?.toISOString() ?? null,
    currentStudentCount: studentCount,
    currentMinimumQuota: freeTuitionMinimumQuota(studentCount),
  }))
}

async function roundView(tx: Database, ctx: ServiceContext, id: string) {
  const rounds = await listFreeTuitionRounds(tx, ctx.institutionId)
  const round = rounds.find((item) => item.id === id)
  if (!round) throw new NotFoundError()
  const studentCount = await countActiveStudents(tx, ctx.institutionId)
  return {
    ...round,
    quotaConfirmedAt: round.quotaConfirmedAt?.toISOString() ?? null,
    currentStudentCount: studentCount,
    currentMinimumQuota: freeTuitionMinimumQuota(studentCount),
  }
}

/** Eğitim yılı için ücretsiz okutma dönemini açar (K-268). 201. */
export function createFreeTuitionRoundCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'free_tuition.round_create',
      collections: [],
      entity: { type: ROUND, id },
      load: async (tx) => {
        const years = await freeTuitionRoundYears(tx, ctx.institutionId)
        return { run: () => planFreeTuitionRound(input, years) }
      },
      after: async (tx, plan) => {
        await insertFreeTuitionRound(tx, ctx.institutionId, {
          id,
          ...plan,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'free_tuition.round_create', { type: ROUND, id }, [
          'academicYear',
          'teachingStartDate',
        ])
        body = { data: await roundView(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kontenjanı kesinleştirir; öğrenci sayısı kilit altında yeniden sayılır (K-268). */
export function confirmFreeTuitionQuotaCommand(
  ctx: ServiceContext,
  roundId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'free_tuition.quota',
      collections: [],
      entity: { type: ROUND, id: roundId },
      load: async (tx) => {
        const round = await findFreeTuitionRound(tx, ctx.institutionId, roundId)
        if (round === null) throw new NotFoundError()
        if (round.version !== expectedVersion) throw new ConflictError()
        const studentCount = await countActiveStudents(tx, ctx.institutionId)
        const applications = await roundFreeTuitionApplications(tx, ctx.institutionId, roundId)
        const acceptedCount = applications.filter((item) => item.status === 'accepted').length
        return { run: () => planFreeTuitionQuota(input, { studentCount, acceptedCount }) }
      },
      after: async (tx, plan) => {
        const saved = await setFreeTuitionQuota(tx, ctx.institutionId, {
          id: roundId,
          expectedVersion,
          ...plan,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'free_tuition.quota', { type: ROUND, id: roundId }, [
          'studentCount',
          'computedQuota',
          'confirmedQuota',
        ])
        body = { data: await roundView(tx, ctx, roundId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

export type FreeTuitionApplicationView = Awaited<
  ReturnType<typeof listFreeTuitionApplications>
>['items'][number]

export async function listFreeTuitionApplicationsFor(
  ctx: ServiceContext,
  roundId: string,
  query: { status?: FreeTuitionStatus | undefined; page: number; pageSize: number },
) {
  if ((await findFreeTuitionRound(ctx.db, ctx.institutionId, roundId)) === null)
    throw new NotFoundError()
  return listFreeTuitionApplications(ctx.db, ctx.institutionId, { roundId, ...query })
}

async function reloadApplication(tx: Database, ctx: ServiceContext, id: string) {
  const row = await findFreeTuitionApplication(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return row
}

/** Aday kaydeder (K-269): gerekçe kodu ve teslim edilen belge işaretleri. 201. */
export function createFreeTuitionApplicationCommand(
  ctx: ServiceContext,
  roundId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const rawStudentId: unknown =
    typeof input === 'object' && input !== null ? Reflect.get(input, 'studentId') : undefined
  const studentId = typeof rawStudentId === 'string' ? rawStudentId.trim() : ''
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'free_tuition.application_create',
      collections: ['students'],
      loadScope: { students: { ids: studentId === '' ? [] : [studentId] } },
      entity: { type: APPLICATION, id },
      load: async (tx) => {
        const { institutionType, scalars } = await environment(tx, ctx, SPEC)
        const round = await findFreeTuitionRound(tx, ctx.institutionId, roundId)
        if (round === null) throw new NotFoundError()
        const applications = await roundFreeTuitionApplications(tx, ctx.institutionId, roundId)
        const hasScholarship =
          studentId !== '' &&
          (await hasStudentScholarshipAward(tx, ctx.institutionId, studentId, round.academicYear))
        return {
          scalars,
          run: (state) =>
            planFreeTuitionApplication(state, input, {
              applicantStudentIds: new Set(applications.map((item) => item.studentId)),
              scholarshipStudentIds: new Set(hasScholarship ? [studentId] : []),
              institutionType,
            }),
        }
      },
      after: async (tx, plan) => {
        await insertFreeTuitionApplication(tx, ctx.institutionId, {
          id,
          roundId,
          ...plan,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'free_tuition.application_create', { type: APPLICATION, id }, [
          'studentId',
          'reason',
          'documents',
        ])
        body = { data: await reloadApplication(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Teslim edilen belge işaretlerini günceller; karar verilmiş adayda 409. */
export function updateFreeTuitionDocumentsCommand(
  ctx: ServiceContext,
  applicationId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'free_tuition.documents',
      collections: [],
      entity: { type: APPLICATION, id: applicationId },
      load: async (tx) => {
        const row = await reloadApplication(tx, ctx, applicationId)
        if (row.version !== expectedVersion) throw new ConflictError()
        return { run: () => planFreeTuitionDocuments(row, input) }
      },
      after: async (tx, plan) => {
        const saved = await setFreeTuitionDocuments(tx, ctx.institutionId, {
          id: applicationId,
          expectedVersion,
          documents: plan.documents,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'free_tuition.documents',
          { type: APPLICATION, id: applicationId },
          ['documents'],
        )
        body = { data: await reloadApplication(tx, ctx, applicationId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Toplantının kararları, tutanak için adların ve gerekçelerin eklenmiş hâli. */
export async function freeTuitionMeetingView(db: Database, ctx: ServiceContext, id: string) {
  const meeting = await findFreeTuitionMeeting(db, ctx.institutionId, id)
  if (meeting === null) throw new NotFoundError()
  const round = await findFreeTuitionRound(db, ctx.institutionId, meeting.roundId)
  if (round === null) throw new NotFoundError()
  const applications = await freeTuitionApplicationsById(
    db,
    ctx.institutionId,
    meeting.decisions.map((item) => item.applicationId),
  )
  return {
    id: meeting.id,
    roundId: meeting.roundId,
    academicYear: round.academicYear,
    meetingDate: meeting.meetingDate,
    members: meeting.members,
    decisions: meeting.decisions.map((item) => {
      const application = applications.get(item.applicationId)
      return {
        applicationId: item.applicationId,
        studentId: item.studentId,
        studentName: application?.studentName ?? null,
        reason: application?.reason ?? 'other',
        documents: application?.documents ?? [],
        decision: item.decision,
      }
    }),
  }
}

export async function listFreeTuitionMeetingsFor(ctx: ServiceContext, roundId: string) {
  if ((await findFreeTuitionRound(ctx.db, ctx.institutionId, roundId)) === null)
    throw new NotFoundError()
  const meetings = await listFreeTuitionMeetings(ctx.db, ctx.institutionId, roundId)
  return meetings.map((meeting) => ({
    id: meeting.id,
    meetingDate: meeting.meetingDate,
    memberCount: meeting.members.length,
    acceptedCount: meeting.decisions.filter((item) => item.decision === 'accepted').length,
    reserveCount: meeting.decisions.filter((item) => item.decision === 'reserve').length,
    rejectedCount: meeting.decisions.filter((item) => item.decision === 'rejected').length,
  }))
}

/**
 * Değerlendirme kurulu kararını kaydeder (K-270): toplantı, adayların kararı, kabul edilenlerin
 * hakkı, o yılki açık öğrenim taksitlerinin kapanması ve iade kaydı tek işlemdedir. Kararın
 * adayları kilitten önce okunur ki yalnız kabul edilen öğrencilerin taksit ve sözleşmeleri
 * yüklensin; adayın öğrencisi değişmez, durum kilit altında yeniden denetlenir. 201.
 */
export async function recordFreeTuitionBoardCommand(
  ctx: ServiceContext,
  roundId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const parsed = recordFreeTuitionBoardSchema.safeParse(input)
  const decided = parsed.success ? parsed.data.decisions : []
  const preview = await freeTuitionApplicationsById(
    ctx.db,
    ctx.institutionId,
    decided.map((item) => item.applicationId),
  )
  const acceptedStudentIds = decided.flatMap((item) => {
    const application = preview.get(item.applicationId)
    return item.decision === 'accepted' && application ? [application.studentId] : []
  })
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'free_tuition.board',
      // Yetki denetimi kapsam koleksiyonlarını okur (`scholarship.manage`).
      collections: [
        ...new Set([...SPEC.collections, 'students', 'contracts', 'invoices'] as const),
      ],
      stores: FINANCE_TABLE_STORES,
      loadScope: {
        contracts: studentScope(acceptedStudentIds),
        invoices: studentScope(acceptedStudentIds),
      },
      entity: { type: MEETING, id },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
        const round = await findFreeTuitionRound(tx, ctx.institutionId, roundId)
        if (round === null) throw new NotFoundError()
        const applications = await roundFreeTuitionApplications(tx, ctx.institutionId, roundId)
        const allocated = new Map<string, number>()
        for (const studentId of acceptedStudentIds)
          for (const [invoiceId, cents] of await allocatedByInvoice(
            tx,
            ctx.institutionId,
            studentId,
          ))
            allocated.set(invoiceId, cents)
        const scholarshipStudentIds = await studentsWithScholarshipAward(
          tx,
          ctx.institutionId,
          acceptedStudentIds,
          round.academicYear,
        )
        return {
          scalars,
          run: (state, { now }) => {
            requireAuthorized(actor, 'scholarship.manage', {}, state, { now, institutionType })
            return applyFreeTuitionBoard(state, round, input, {
              today: dayKey(ctx.now),
              applications: new Map(applications.map((item) => [item.id, item])),
              acceptedCount: applications.filter((item) => item.status === 'accepted').length,
              allocated,
              scholarshipStudentIds,
              institutionType,
            })
          },
        }
      },
      after: async (tx, plan) => {
        const studentOf = new Map(
          (await roundFreeTuitionApplications(tx, ctx.institutionId, roundId)).map((item) => [
            item.id,
            item.studentId,
          ]),
        )
        await insertFreeTuitionMeeting(tx, ctx.institutionId, {
          id,
          roundId,
          meetingDate: plan.meetingDate,
          members: plan.members,
          decisions: plan.decisions.map((item) => ({
            ...item,
            studentId: studentOf.get(item.applicationId) ?? '',
          })),
          recordedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'free_tuition.board', { type: MEETING, id }, [
          'meetingDate',
          'members',
          'decisions',
        ])
        for (const item of plan.decisions) {
          const saved = await setFreeTuitionDecision(tx, ctx.institutionId, {
            id: item.applicationId,
            status: item.decision,
            boardMeetingId: id,
            now: ctx.now,
          })
          if (!saved) throw new ConflictError()
          await auditWork(
            tx,
            ctx,
            'free_tuition.decision',
            { type: APPLICATION, id: item.applicationId },
            ['status', 'boardMeetingId'],
          )
        }
        const round = await findFreeTuitionRound(tx, ctx.institutionId, roundId)
        if (round === null) throw new NotFoundError()
        for (const award of plan.awards) {
          const awardId = randomUUID()
          await insertFreeTuitionAward(tx, ctx.institutionId, {
            id: awardId,
            roundId,
            applicationId: award.applicationId,
            boardMeetingId: id,
            studentId: award.studentId,
            academicYear: round.academicYear,
            acceptedDate: plan.meetingDate,
            contractId: award.contractId,
            contractIds: award.contractIds,
            cancelledInvoiceIds: award.cancelledInvoiceIds,
            refundedInvoiceIds: award.refundedInvoiceIds,
            waivedCents: award.waivedCents,
            refundCents: award.refundCents,
            refundDueDate: award.refundDueDate,
            awardedByUserId: ctx.actor.userId,
            now: ctx.now,
          })
          await auditWork(tx, ctx, 'free_tuition.award', { type: AWARD, id: awardId }, [
            'studentId',
            'academicYear',
            'acceptedDate',
            'contractIds',
            'cancelledInvoiceIds',
            'refundedInvoiceIds',
            'waivedCents',
            'refundCents',
            'refundDueDate',
          ])
        }
        body = { data: await freeTuitionMeetingView(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

export async function getFreeTuitionMeetingFor(ctx: ServiceContext, id: string) {
  return freeTuitionMeetingView(ctx.db, ctx, id)
}

export type FreeTuitionAwardView = Omit<StoredFreeTuitionAward, 'refundIban'> & {
  /** IBAN yalnız son dört hanesiyle döner (guvenlik-kvkk.md Ç sınıfı). */
  maskedIban: string | null
  refundStatus: FreeTuitionRefundStatus
}

function awardView(row: StoredFreeTuitionAward): FreeTuitionAwardView {
  const { refundIban, ...rest } = row
  return {
    ...rest,
    maskedIban: refundIban === null ? null : `TR** **** ${refundIban.slice(-4)}`,
    refundStatus: freeTuitionRefundStatus(row),
  }
}

export async function listFreeTuitionAwardsFor(ctx: ServiceContext, query: FreeTuitionAwardQuery) {
  const { items, total } = await listFreeTuitionAwards(ctx.db, ctx.institutionId, query)
  return { items: items.map(awardView), total }
}

async function reloadAward(tx: Database, ctx: ServiceContext, id: string) {
  const row = await findFreeTuitionAward(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return row
}

/** Hakkın MEBBİS'e işlendiği günü kaydeder; MEBBİS'e bağlantı yoktur (IST-143, K-271). */
export function recordFreeTuitionMebbisCommand(
  ctx: ServiceContext,
  awardId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'free_tuition.mebbis',
      collections: [],
      entity: { type: AWARD, id: awardId },
      load: async (tx) => {
        const row = await reloadAward(tx, ctx, awardId)
        if (row.version !== expectedVersion) throw new ConflictError()
        return { run: () => planFreeTuitionMebbis(row, input, dayKey(ctx.now)) }
      },
      after: async (tx, plan) => {
        const saved = await setFreeTuitionMebbis(tx, ctx.institutionId, {
          id: awardId,
          expectedVersion,
          recordedDate: plan.recordedDate,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'free_tuition.mebbis', { type: AWARD, id: awardId }, [
          'mebbisRecordedDate',
        ])
        body = { data: awardView(await reloadAward(tx, ctx, awardId)) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Gövdedeki ödeme günü; `YYYY-MM-DD` değilse boş (şema ayrıca reddeder). */
function rawDay(input: unknown): string | null {
  const value: unknown =
    typeof input === 'object' && input !== null ? Reflect.get(input, 'paidDate') : undefined
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

const ACCOUNT_FIELDS: ReadonlySet<string> = new Set(['maskedIban', 'refundAccountHolder'])

/**
 * Ücretsiz okutma iadesini ödenmiş işaretler (K-270): ayrılış iadesiyle aynı kurallar ve aynı gün
 * sonu (M-13). Ödeyici adı sözleşmeden kilit altında okunur. `Idempotency-Key` kaydına maskeli
 * IBAN ve hesap sahibi yazılmaz; tekrar yanıtı bunları kayıttan ekler (guvenlik-kvkk.md §10).
 */
export async function payFreeTuitionRefundCommand(
  ctx: ServiceContext,
  awardId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const owner = await findFreeTuitionAward(ctx.db, ctx.institutionId, awardId)
  let result: FreeTuitionAwardView | undefined
  const response = await runCommand(
    ctx,
    {
      action: 'free_tuition.refund',
      collections: [...new Set([...SPEC.collections, 'students', 'parents', 'contracts'] as const)],
      stores: FINANCE_TABLE_STORES,
      loadScope: { contracts: { ids: owner === null ? [] : [owner.contractId] } },
      entity: { type: AWARD, id: awardId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
        const row = await reloadAward(tx, ctx, awardId)
        if (row.version !== expectedVersion) throw new ConflictError()
        const accounts = await listBankAccounts(tx, ctx.institutionId)
        const paidDay = rawDay(input)
        const dayClosed =
          paidDay !== null && (await isFinanceDayClosed(tx, ctx.institutionId, paidDay))
        return {
          scalars,
          run: (state, { now }) => {
            requireAuthorized(actor, 'scholarship.manage', {}, state, { now, institutionType })
            return planFreeTuitionRefund(
              {
                ...row,
                payerName: refundPayerName(
                  state,
                  { contractId: row.contractId, breakdown: {} },
                  institutionType,
                ),
              },
              input,
              {
                today: dayKey(ctx.now),
                bankAccountIds: accounts.map((account) => account.id),
                dayClosed,
              },
            )
          },
        }
      },
      after: async (tx, plan) => {
        const saved = await markFreeTuitionRefundPaid(tx, ctx.institutionId, {
          id: awardId,
          expectedVersion,
          paidDate: plan.paidDate,
          iban: plan.iban,
          accountHolder: plan.accountHolder,
          bankAccountId: plan.bankAccountId,
          paidByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'free_tuition.refund_paid', { type: AWARD, id: awardId }, [
          'refundPaidDate',
          'refundIban',
          'refundAccountHolder',
          'refundBankAccountId',
        ])
        result = awardView(await reloadAward(tx, ctx, awardId))
      },
    },
    () => {
      if (result === undefined) throw new Error('free tuition refund was not written')
      return {
        statusCode: 200,
        body: {
          data: Object.fromEntries(
            Object.entries(result).filter(([field]) => !ACCOUNT_FIELDS.has(field)),
          ),
        },
      }
    },
    idempotency,
  )
  const stored =
    !response.replayed && result !== undefined
      ? result
      : awardView(await reloadAward(ctx.db, ctx, awardId))
  const data: unknown =
    typeof response.body === 'object' && response.body !== null
      ? Reflect.get(response.body, 'data')
      : undefined
  return {
    ...response,
    body: {
      data: {
        ...(typeof data === 'object' && data !== null ? data : {}),
        maskedIban: stored.maskedIban,
        refundAccountHolder: stored.refundAccountHolder,
      },
    },
  }
}
