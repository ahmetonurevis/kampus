import { randomUUID } from 'node:crypto'

import { requireAuthorized } from '@kampus/school-core/lib/authorize.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  payerNameOf,
  planRefundPayment,
  quoteWithdrawal,
  withdrawStudent,
  type WithdrawalContext,
} from '@kampus/school-core/lib/withdrawals.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import { allocatedByInvoice, paymentTotal } from '../db/payments.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import {
  archiveStudentIdentity,
  findWithdrawal,
  insertWithdrawal,
  listWithdrawals,
  markRefundPaid,
  type RefundStatus,
  type StoredWithdrawal,
} from '../db/withdrawals.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { environment, type CommandOptions } from './commands.ts'
import { notify } from './notify.ts'
import {
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'

/**
 * Ayrılış ve iade servisi (ADR 0006 karar 10; docs/domain/finans.md DOM-FIN-040, -041; IST-110).
 * Kural core `lib/withdrawals.ts`'tedir. Öğrenci, taksit, bağlı kayıt, iade kaydı ve kimlik arşivi
 * tek transaction'dadır. Döküm, IBAN ve gerekçe loglanmaz; denetime yalnız alan adları düşer. İade
 * ödendi bildirimi (`refund_paid`) ödemeyle aynı transaction'dadır, yalnız ayrılış kimliğini taşır.
 */

const SPEC = OPERATION_COMMANDS['student.withdraw']

export type WithdrawalView = Omit<StoredWithdrawal, 'refundIban'> & {
  /** IBAN yalnız son dört hanesiyle döner (guvenlik-kvkk.md Ç sınıfı). */
  maskedIban: string | null
  refundStatus: RefundStatus
}

function view(row: StoredWithdrawal): WithdrawalView {
  const { refundIban, ...rest } = row
  return {
    ...rest,
    maskedIban: refundIban === null ? null : `TR** **** ${refundIban.slice(-4)}`,
    refundStatus: row.refundPaidDate !== null ? 'paid' : row.refundCents === 0 ? 'none' : 'pending',
  }
}

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
    entityType: 'student_withdrawals',
    entityId: id,
    changes: { fields: [...fields] },
    createdAt: ctx.now,
  })
}

/** Dağılım ve dağıtılmamış tahsilat; kurum kilidi altında veya tek görüntüden okunur. */
async function paymentContext(
  tx: Database,
  ctx: ServiceContext,
  studentId: string,
): Promise<Pick<WithdrawalContext, 'allocated' | 'creditCents'>> {
  const allocated = await allocatedByInvoice(tx, ctx.institutionId, studentId)
  const total = await paymentTotal(tx, ctx.institutionId, studentId)
  const distributed = [...allocated.values()].reduce((sum, value) => sum + value, 0)
  return { allocated, creditCents: Math.max(total - distributed, 0) }
}

/** Hesabı yazmadan gösterir (DOM-FIN-040, IST-110). */
export function quoteWithdrawalFor(ctx: ServiceContext, studentId: string, input: unknown) {
  return runReadOnly(ctx, {
    action: 'student.withdraw.quote',
    collections: SPEC.collections,
    load: async (tx) => {
      const { institutionType, scalars } = await environment(tx, ctx, SPEC)
      const payments = await paymentContext(tx, ctx, studentId)
      return {
        scalars,
        run: (state, { now }) =>
          quoteWithdrawal(state, studentId, input, { institutionType, ...payments, now }),
      }
    },
  })
}

/** Ayrılışı onaylar ve uygular; iade kaydı aynı işlemde oluşur (DOM-FIN-041, DOM-KAY-024). 201. */
export function withdrawStudentCommand(
  ctx: ServiceContext,
  studentId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const id = randomUUID()
  let result: WithdrawalView | undefined
  return runCommand(
    ctx,
    {
      action: 'student.withdraw.records',
      collections: SPEC.collections,
      entity: { type: 'student_withdrawals', id },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
        const payments = await paymentContext(tx, ctx, studentId)
        return {
          scalars,
          run: (state, { now, makeId }) => {
            requireAuthorized(actor, 'student.withdraw', {}, state, { now, institutionType })
            return withdrawStudent(state, studentId, input, makeId, {
              institutionType,
              ...payments,
              now,
            })
          },
        }
      },
      after: async (tx, plan) => {
        await insertWithdrawal(tx, ctx.institutionId, {
          id,
          studentId: plan.studentId,
          contractId: plan.contractId,
          withdrawalDate: plan.withdrawalDate,
          reason: plan.reason,
          targetSchool: plan.targetSchool,
          breakdown: plan.breakdown,
          refundDueDate: plan.refundDueDate,
          approvedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await archiveStudentIdentity(tx, ctx.institutionId, plan.studentId, ctx.now)
        await audit(tx, ctx, 'student.withdraw', id, [
          'withdrawalDate',
          'reason',
          'targetSchool',
          'breakdown',
        ])
        const row = await findWithdrawal(tx, ctx.institutionId, id)
        if (row === null) throw new NotFoundError()
        result = view(row)
      },
    },
    () => {
      if (result === undefined) throw new Error('withdrawal was not written')
      return { statusCode: 201, body: { data: result } }
    },
    options.idempotency,
  )
}

/** İadeyi ödenmiş işaretler; ödenen iade değişmez, hesap sahibi ödeyicidir (DOM-FIN-041). */
export function payRefundCommand(
  ctx: ServiceContext,
  withdrawalId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let result: WithdrawalView | undefined
  return runCommand(
    ctx,
    {
      action: 'student.withdraw.refund',
      collections: SPEC.collections,
      entity: { type: 'student_withdrawals', id: withdrawalId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
        const row = await findWithdrawal(tx, ctx.institutionId, withdrawalId)
        if (row === null) throw new NotFoundError()
        if (row.version !== expectedVersion) throw new ConflictError()
        return {
          scalars,
          run: (state, { now }) => {
            requireAuthorized(actor, 'student.withdraw', {}, state, { now, institutionType })
            return planRefundPayment(
              {
                refundCents: row.refundCents,
                refundPaidDate: row.refundPaidDate,
                payerName: payerNameOf(state, row.contractId),
              },
              input,
              dayKey(ctx.now),
            )
          },
        }
      },
      after: async (tx, plan) => {
        const saved = await markRefundPaid(tx, ctx.institutionId, {
          id: withdrawalId,
          expectedVersion,
          paidDate: plan.paidDate,
          iban: plan.iban,
          accountHolder: plan.accountHolder,
          paidByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await audit(tx, ctx, 'student.withdraw.refund_paid', withdrawalId, [
          'refundPaidDate',
          'refundIban',
          'refundAccountHolder',
        ])
        const row = await findWithdrawal(tx, ctx.institutionId, withdrawalId)
        if (row === null) throw new NotFoundError()
        result = view(row)
        await notify(tx, ctx, {
          type: 'refund_paid',
          recipients: { studentIds: [row.studentId] },
          data: { withdrawalId },
          dedupeKey: withdrawalId,
        })
      },
    },
    () => {
      if (result === undefined) throw new Error('refund was not written')
      return { statusCode: 200, body: { data: result } }
    },
    idempotency,
  )
}

export async function listWithdrawalsFor(
  ctx: ServiceContext,
  query: { refundStatus?: RefundStatus | undefined; page: number; pageSize: number },
): Promise<{ items: WithdrawalView[]; total: number }> {
  const { items, total } = await listWithdrawals(ctx.db, ctx.institutionId, query)
  return { items: items.map(view), total }
}

export async function getWithdrawalFor(ctx: ServiceContext, id: string): Promise<WithdrawalView> {
  const row = await findWithdrawal(ctx.db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return view(row)
}
