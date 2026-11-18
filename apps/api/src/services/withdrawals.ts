import { randomUUID } from 'node:crypto'

import { requireAuthorized } from '@kampus/school-core/lib/authorize.ts'
import { cancelledRenewalContractIds } from '@kampus/school-core/lib/finance-referrals.ts'
import { scholarshipEndClawbackInvoiceIds } from '@kampus/school-core/lib/finance-scholarship-revocation.ts'
import { cancelledRenewalScholarshipYears } from '@kampus/school-core/lib/finance-scholarships.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  quoteWithdrawalWithFollowups,
  withdrawStudentWithFollowups,
  type WithdrawalActivityCancel,
  type WithdrawalFollowupContext,
} from '@kampus/school-core/lib/withdrawal-followups.ts'
import {
  planRefundPayment,
  refundPayerName,
  type WithdrawalBreakdown,
} from '@kampus/school-core/lib/withdrawals.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import { isFinanceDayClosed } from '../db/finance-day-closings.ts'
import { studentFreeTuitionCoverage } from '../db/finance-free-tuition.ts'
import { insertPackageHourEntry, loadWithdrawalPackageSales } from '../db/finance-packages.ts'
import {
  markParticipantCancelled,
  withdrawalParticipations,
} from '../db/finance-paid-activities.ts'
import { listStudentScholarshipEnds } from '../db/finance-scholarships.ts'
import { allocatedByInvoice, listBankAccounts, paymentTotal } from '../db/payments.ts'
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
import { applyWithdrawalToReferralRewards } from './finance-referrals.ts'
import { archiveCancelledRenewalAwards } from './finance-scholarships.ts'
import { notify } from './notify.ts'
import {
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
  FINANCE_TABLE_STORES,
} from './operation-runner.ts'
import { studentFinanceScope } from './payments.ts'
import { auditWork } from './task-work.ts'

/**
 * Ayrılış ve iade servisi (ADR 0006 karar 10; docs/domain/finans.md DOM-FIN-040, -041; IST-110).
 * Kural core `lib/withdrawals.ts` ve `lib/withdrawal-followups.ts`'tedir. Öğrenci, taksit, bağlı
 * kayıt, kalan paket saatinin iade hareketi, iade kaydı, kimlik arşivi, iptal edilen burslu
 * yenilemenin burs ve fon payı (K-117) ve ayrılışla iptal edilen etkinlik katılımları (K-348)
 * tek transaction'dadır. Döküm, IBAN ve gerekçe loglanmaz;
 * denetime yalnız alan adları düşer. İade ödendi bildirimi (`refund_paid`) ödemeyle aynı
 * transaction'dadır, yalnız ayrılış kimliğini taşır.
 */

const SPEC = OPERATION_COMMANDS['student.withdraw']

export type WithdrawalView = Omit<StoredWithdrawal, 'refundIban'> & {
  /** IBAN yalnız son dört hanesiyle döner (guvenlik-kvkk.md Ç sınıfı). */
  maskedIban: string | null
  refundStatus: RefundStatus
}

/** Hedef hesabı tanıtan alanlar: idempotency kaydına girmez (guvenlik-kvkk.md §10, DOM-FIN-041). */
type RefundAccount = Pick<WithdrawalView, 'maskedIban' | 'refundAccountHolder'>

const ACCOUNT_FIELDS: ReadonlySet<string> = new Set<keyof RefundAccount>([
  'maskedIban',
  'refundAccountHolder',
])

/**
 * Komut yanıtı idempotency kaydında saklanır: karar gerekçesi (K-12, serbest metin) ona girmez,
 * yalnız ayrılış kaydında durur ve yalnız yöneticinin kayıt okumalarında döner (K-13).
 */
function withoutDecisionReason(row: WithdrawalView): WithdrawalView {
  const decision = row.breakdown.payerDecision
  if (!decision) return row
  return { ...row, breakdown: { ...row.breakdown, payerDecision: { payer: decision.payer } } }
}

function withoutAccount(row: WithdrawalView): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(withoutDecisionReason(row)).filter(([field]) => !ACCOUNT_FIELDS.has(field)),
  )
}

/**
 * Saklanan yanıta hesap alanlarını kayıttan geri koyar. Ödenen iadenin hesabı değişmediği için
 * (DOM-FIN-041) tekrar yanıtı ilk yanıtla aynıdır.
 */
function withAccount(body: unknown, account: RefundAccount): unknown {
  const data: unknown =
    typeof body === 'object' && body !== null ? Reflect.get(body, 'data') : undefined
  if (typeof data !== 'object' || data === null) throw new Error('refund response has no data')
  return {
    data: {
      ...data,
      maskedIban: account.maskedIban,
      refundAccountHolder: account.refundAccountHolder,
    },
  }
}

function view(row: StoredWithdrawal): WithdrawalView {
  const { refundIban, ...rest } = row
  return {
    ...rest,
    maskedIban: refundIban === null ? null : `TR** **** ${refundIban.slice(-4)}`,
    refundStatus: row.refundPaidDate !== null ? 'paid' : row.refundCents === 0 ? 'none' : 'pending',
  }
}

/** Kayıt okuması: yönetici dışındaki rol kararın ödeyici türünü görür, gerekçeyi görmez (K-13). */
function readView(ctx: ServiceContext, row: StoredWithdrawal): WithdrawalView {
  const withdrawal = view(row)
  return ctx.actor.role === 'yonetici' ? withdrawal : withoutDecisionReason(withdrawal)
}

/** Gövdedeki ödeme günü; `YYYY-MM-DD` değilse boş (şema ayrıca reddeder). */
function rawDay(input: unknown): string | null {
  const value: unknown =
    typeof input === 'object' && input !== null ? Reflect.get(input, 'paidDate') : undefined
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
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

/**
 * Dağılım, dağıtılmamış tahsilat, paket satışları, burs kesme ve iptal kayıtları ve etkinlik
 * katılımları; kurum kilidi altında veya tek görüntüden okunur.
 */
async function accountContext(
  tx: Database,
  ctx: ServiceContext,
  studentId: string,
): Promise<
  Pick<
    WithdrawalFollowupContext,
    | 'allocated'
    | 'creditCents'
    | 'packageSales'
    | 'freeTuitionContractIds'
    | 'scholarshipEnds'
    | 'participations'
  >
> {
  const allocated = await allocatedByInvoice(tx, ctx.institutionId, studentId)
  const total = await paymentTotal(tx, ctx.institutionId, studentId)
  const distributed = [...allocated.values()].reduce((sum, value) => sum + value, 0)
  const packageSales = await loadWithdrawalPackageSales(tx, ctx.institutionId, studentId)
  // Ücretsiz okutmalı sözleşmede öğrenim ücreti istenmez, iadesi hakkın kendisindedir (K-270).
  const { contractIds } = await studentFreeTuitionCoverage(tx, ctx.institutionId, studentId)
  // Kesilen ya da iptal edilen burs tabanı ve istisnayı değiştirir, geri isteme ayrı satırdır
  // (K-350, K-351); etkinlik katılımı ayrılışla iptal edilir ya da borcu kalır (K-348).
  const ends = await listStudentScholarshipEnds(tx, ctx.institutionId, studentId)
  const participations = await withdrawalParticipations(tx, ctx.institutionId, studentId)
  return {
    allocated,
    creditCents: Math.max(total - distributed, 0),
    packageSales,
    freeTuitionContractIds: contractIds,
    scholarshipEnds: ends.map((end) => ({
      awardId: end.awardId,
      contractId: end.contractId,
      kind: end.kind,
      effectiveDate: end.effectiveDate,
      reinstatedCents: end.reinstatedCents,
      principalCents: end.principalCents,
      interestCents: end.interestCents,
      clawbackInvoiceIds: scholarshipEndClawbackInvoiceIds(end),
    })),
    participations: participations.map((row) => ({
      participantId: row.id,
      activityId: row.activityId,
      studentId: row.studentId,
      name: row.name,
      status: row.status,
      invoiceId: row.invoiceId,
      feeCents: row.feeCents,
      debtInvoiceId: row.debtInvoiceId,
      activity: {
        activityDate: row.activityDate,
        cancelDeadline: row.cancelDeadline,
        lateRefundRule: row.lateRefundRule,
        lateRefundPercent: row.lateRefundPercent,
        lateCostCents: row.lateCostCents,
        feeCents: row.activityFeeCents,
      },
    })),
  }
}

/**
 * Ayrılışla iptal edilen etkinlik katılımlarını yazar (K-348): katılımcı iptaliyle aynı alanlar,
 * iade katılım kaydından ödenir (K-303). Kurum kilidi altında okunduğu için sürüm beklenmez.
 */
async function cancelActivityParticipations(
  tx: Database,
  ctx: ServiceContext,
  cancels: readonly WithdrawalActivityCancel[],
): Promise<void> {
  for (const { participantId, plan } of cancels) {
    const saved = await markParticipantCancelled(tx, ctx.institutionId, {
      id: participantId,
      expectedVersion: null,
      ...plan,
      userId: ctx.actor.userId,
      now: ctx.now,
    })
    if (!saved) throw new ConflictError()
    await auditWork(
      tx,
      ctx,
      'paid_activity.participant_cancel',
      { type: 'paid_activity_participants', id: participantId },
      [
        'status',
        'cancelKind',
        'cancelledDate',
        'paidCents',
        'retainedCents',
        'refundCents',
        ...(plan.closedInvoiceId === null ? [] : ['closedInvoiceId']),
        ...(plan.debtInvoiceId === null ? [] : ['debtInvoiceId']),
      ],
    )
  }
}

/**
 * Kalan paket saatini iade edilmiş yazar (DOM-DIL-051): bakiye sıfırlanır, yoklama köprüsü sonradan
 * saat düşemez. Kaynak ayrılış kaydıdır; öğrenci pasifleştiği için ayrılış yinelenmez.
 */
async function returnPackageHours(
  tx: Database,
  ctx: ServiceContext,
  withdrawal: { id: string; date: string; breakdown: WithdrawalBreakdown },
): Promise<void> {
  for (const line of withdrawal.breakdown.contracts ?? []) {
    if (line.packageSaleId === undefined || !line.returnedHours) continue
    const id = randomUUID()
    await insertPackageHourEntry(tx, ctx.institutionId, {
      id,
      saleId: line.packageSaleId,
      kind: 'refunded',
      hours: line.returnedHours,
      occurredDate: withdrawal.date,
      sourceType: 'withdrawal',
      sourceId: withdrawal.id,
      recordedByUserId: ctx.actor.userId,
      now: ctx.now,
    })
    await auditWork(tx, ctx, 'package.hours', { type: 'lesson_package_hour_entries', id }, [
      'kind',
      'hours',
      'occurredDate',
      'sourceType',
      'sourceId',
    ])
  }
}

/** Hesabı yazmadan gösterir (DOM-FIN-040, IST-110). */
export function quoteWithdrawalFor(ctx: ServiceContext, studentId: string, input: unknown) {
  return runReadOnly(ctx, {
    action: 'student.withdraw.quote',
    collections: SPEC.collections,
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => {
      const { institutionType, scalars } = await environment(tx, ctx, SPEC)
      const account = await accountContext(tx, ctx, studentId)
      return {
        scalars,
        run: (state, { now }) =>
          quoteWithdrawalWithFollowups(state, studentId, input, {
            institutionType,
            ...account,
            now,
          }),
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
      stores: FINANCE_TABLE_STORES,
      // Ayrılış yalnız öğrencinin sözleşme zincirine ve taksitlerine dokunur (DOM-FIN-040, -041).
      loadScope: {
        invoices: studentFinanceScope(studentId),
        contracts: studentFinanceScope(studentId),
      },
      entity: { type: 'student_withdrawals', id },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
        const account = await accountContext(tx, ctx, studentId)
        return {
          scalars,
          run: (state, { now, makeId }) => {
            requireAuthorized(actor, 'student.withdraw', {}, state, { now, institutionType })
            const plan = withdrawStudentWithFollowups(state, studentId, input, makeId, {
              institutionType,
              ...account,
              now,
            })
            return {
              ...plan,
              cancelledContractIds: cancelledRenewalContractIds(state, studentId),
              cancelledScholarshipYears: cancelledRenewalScholarshipYears(state, studentId),
            }
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
        await returnPackageHours(tx, ctx, {
          id,
          date: plan.withdrawalDate,
          breakdown: plan.breakdown,
        })
        await archiveStudentIdentity(tx, ctx.institutionId, plan.studentId, ctx.now)
        await applyWithdrawalToReferralRewards(tx, ctx, plan)
        await archiveCancelledRenewalAwards(tx, ctx, plan.studentId, plan.cancelledScholarshipYears)
        await cancelActivityParticipations(tx, ctx, plan.activityCancels)
        await audit(tx, ctx, 'student.withdraw', id, [
          'withdrawalDate',
          'reason',
          'targetSchool',
          'breakdown',
          ...(plan.breakdown.payerDecision ? ['payerDecision'] : []),
          ...(plan.breakdown.refundApprovedCents === undefined ? [] : ['refundApprovedCents']),
          ...(plan.breakdown.scholarshipClawbacks ? ['scholarshipClawbacks'] : []),
          ...(plan.breakdown.activities ? ['activities'] : []),
        ])
        const row = await findWithdrawal(tx, ctx.institutionId, id)
        if (row === null) throw new NotFoundError()
        result = withoutDecisionReason(view(row))
      },
    },
    () => {
      if (result === undefined) throw new Error('withdrawal was not written')
      return { statusCode: 201, body: { data: result } }
    },
    options.idempotency,
  )
}

/**
 * İadeyi ödenmiş işaretler; ödenen iade değişmez, hesap sahibi ödeyicidir (DOM-FIN-041). İade
 * kurumun bildirilmiş hesabından çıkar ve ödeme gününün gün sonuna girer; kapanış ve ödeme kurum
 * kilidi altında sıraya girer, kapatılmış güne iade yazılmaz (M-13, DOM-FIN-036).
 * `Idempotency-Key` kaydı yanıtı 24 saat saklar; IBAN'ın son haneleri ve hesap sahibi bu kayda
 * yazılmaz, yanıta iade kaydından eklenir (guvenlik-kvkk.md §10).
 */
export async function payRefundCommand(
  ctx: ServiceContext,
  withdrawalId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let result: WithdrawalView | undefined
  const response = await runCommand(
    ctx,
    {
      action: 'student.withdraw.refund',
      collections: SPEC.collections,
      stores: FINANCE_TABLE_STORES,
      entity: { type: 'student_withdrawals', id: withdrawalId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
        const row = await findWithdrawal(tx, ctx.institutionId, withdrawalId)
        if (row === null) throw new NotFoundError()
        if (row.version !== expectedVersion) throw new ConflictError()
        const accounts = await listBankAccounts(tx, ctx.institutionId)
        // Gün ham gövdeden okunur; biçimsizse şema reddeder, kilit altındaki denetim boşa gitmez.
        const paidDay = rawDay(input)
        const dayClosed =
          paidDay !== null && (await isFinanceDayClosed(tx, ctx.institutionId, paidDay))
        return {
          scalars,
          run: (state, { now }) => {
            requireAuthorized(actor, 'student.withdraw', {}, state, { now, institutionType })
            return planRefundPayment(
              {
                refundCents: row.refundCents,
                refundPaidDate: row.refundPaidDate,
                payerName: refundPayerName(state, row, institutionType),
                withdrawalDate: row.withdrawalDate,
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
        const saved = await markRefundPaid(tx, ctx.institutionId, {
          id: withdrawalId,
          expectedVersion,
          paidDate: plan.paidDate,
          iban: plan.iban,
          accountHolder: plan.accountHolder,
          bankAccountId: plan.bankAccountId,
          paidByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await audit(tx, ctx, 'student.withdraw.refund_paid', withdrawalId, [
          'refundPaidDate',
          'refundIban',
          'refundAccountHolder',
          'refundBankAccountId',
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
      return { statusCode: 200, body: { data: withoutAccount(result) } }
    },
    idempotency,
  )
  // Tekrarda işlem çalışmadığı için hesap alanları kalıcı kayıttan okunur.
  const account =
    !response.replayed && result !== undefined ? result : await getWithdrawalFor(ctx, withdrawalId)
  return { ...response, body: withAccount(response.body, account) }
}

export async function listWithdrawalsFor(
  ctx: ServiceContext,
  query: {
    refundStatus?: RefundStatus | undefined
    q?: string | undefined
    page: number
    pageSize: number
  },
): Promise<{ items: WithdrawalView[]; total: number }> {
  const { items, total } = await listWithdrawals(ctx.db, ctx.institutionId, query)
  return { items: items.map((row) => readView(ctx, row)), total }
}

export async function getWithdrawalFor(ctx: ServiceContext, id: string): Promise<WithdrawalView> {
  const row = await findWithdrawal(ctx.db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return readView(ctx, row)
}
