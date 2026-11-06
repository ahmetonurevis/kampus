import { randomUUID } from 'node:crypto'

import {
  assertFinanceDayReportable,
  financeDayCashNet,
  financeDayLines,
  financeDayStamp,
  financeDaySummary,
  isCashCountRequired,
  planFinanceDayClosing,
  planFinanceDayReopen,
  type FinanceDayCash,
  type FinanceDaySummary,
} from '@kampus/school-core/lib/finance-day-closings.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import {
  closingActorNames,
  dayClosingsOf,
  insertDayClosing,
  isFinanceDayClosed,
  lastCountedCash,
  markDayClosingReopened,
  type StoredDayClosing,
} from '../db/finance-day-closings.ts'
import type { Database } from '../db/client.ts'
import { loadPaymentSettings, paymentsTouchingDay, type StoredPayment } from '../db/payments.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { dayRange } from './list-filters.ts'
import {
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'

/**
 * Kasa ve gün sonu servisi (IST-113, DOM-FIN-036). Kural core `lib/finance-day-closings.ts`'tedir.
 * Kapanış kurum kilidi altında okunan tahsilatlardan kurulur; aynı kilit tahsilat ve iptali de
 * sıraya sokar, kapanışla aynı anda güne yazılamaz. Tutar, sayım, açıklama ve gerekçe loglanmaz;
 * denetime yalnız alan adları düşer. Rapor içeriği `paymentsTouchingDay` satırlarından gelir.
 */

const ENTITY = 'finance_day_closings'

export interface FinanceDayClosingView {
  id: string
  closingDate: string
  summary: FinanceDaySummary
  cash: FinanceDayCash | null
  note: string | null
  closedAt: string
  closedByName: string | null
  reopenedAt: string | null
  reopenedByName: string | null
  reopenReason: string | null
  version: number
}

export interface FinanceDayLine {
  paymentId: string
  receiptYear: number
  receiptNumber: number
  studentName: string | null
  amountCents: number
  method: StoredPayment['method']
  reference: string | null
  bankAccountLabel: string | null
  paidAt: string
  reversedAt: string | null
  reversalReason: string | null
}

export interface FinanceDayReport {
  closingDate: string
  status: 'open' | 'closed'
  /** Kapalı günde kapanış anının özeti; açık günde tahsilatlardan hesaplanır. */
  summary: FinanceDaySummary
  /** `POST …/close` gövdesine geri gönderilir; rapor değiştiyse kapanış 409 alır. */
  reportStamp: string
  cashNetCents: number
  cashCountRequired: boolean
  /** Önceki kapanışta sayılan nakit; hiç kapanış yoksa boş. */
  suggestedOpeningCents: number | null
  collected: FinanceDayLine[]
  reversed: FinanceDayLine[]
  /** Geçerli kapanış; gün açıksa boş. */
  closing: FinanceDayClosingView | null
  /** Yeniden açılmış eski kapanışlar, en yeni önce. */
  history: FinanceDayClosingView[]
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
    entityType: ENTITY,
    entityId: id,
    changes: { fields: [...fields] },
    createdAt: ctx.now,
  })
}

/** Günün iki ucu arasındaki tahsilat ve iptaller; kesin gün süzmesi core'dadır. */
function dayPayments(tx: Database, ctx: ServiceContext, closingDate: string) {
  const range = dayRange('paidAt', closingDate, closingDate)
  if (range?.fromInstant == null || range.toInstant === null)
    throw new Error('day range was not built')
  return paymentsTouchingDay(
    tx,
    ctx.institutionId,
    new Date(range.fromInstant),
    new Date(range.toInstant),
  )
}

const summaryPayments = (payments: readonly StoredPayment[]) =>
  payments.map((payment) => ({
    ...payment,
    paidAt: payment.paidAt.toISOString(),
    reversedAt: payment.reversedAt?.toISOString() ?? null,
  }))

function closingView(
  closing: StoredDayClosing,
  names: ReadonlyMap<string, string>,
): FinanceDayClosingView {
  return {
    id: closing.id,
    closingDate: closing.closingDate,
    summary: closing.summary,
    cash: closing.cash,
    note: closing.note,
    closedAt: closing.closedAt.toISOString(),
    closedByName: names.get(closing.closedByUserId) ?? null,
    reopenedAt: closing.reopenedAt?.toISOString() ?? null,
    reopenedByName: closing.reopenedByUserId ? (names.get(closing.reopenedByUserId) ?? null) : null,
    reopenReason: closing.reopenReason,
    version: closing.version,
  }
}

async function closingViews(
  db: Database,
  ctx: ServiceContext,
  closings: readonly StoredDayClosing[],
): Promise<FinanceDayClosingView[]> {
  const names = await closingActorNames(
    db,
    ctx.institutionId,
    closings.flatMap((item) =>
      item.reopenedByUserId === null
        ? [item.closedByUserId]
        : [item.closedByUserId, item.reopenedByUserId],
    ),
  )
  return closings.map((item) => closingView(item, names))
}

type DayLineSource = ReturnType<typeof summaryPayments>[number]

const lineOf = (payment: DayLineSource): FinanceDayLine => ({
  paymentId: payment.id,
  receiptYear: payment.receiptYear,
  receiptNumber: payment.receiptNumber,
  studentName: payment.studentName,
  amountCents: payment.amountCents,
  method: payment.method,
  reference: payment.reference,
  bankAccountLabel: payment.bankAccountLabel,
  paidAt: payment.paidAt,
  reversedAt: payment.reversedAt,
  reversalReason: payment.reversalReason,
})

/**
 * Tek görüntüden gün raporu (`GET /finance/day-closings/:closingDate`). Tahsilat satırında sonraki
 * günlerin iptali gösterilmez: kapatılmış günün satırı da o günkü hâliyle kalır, iptal kendi gününe
 * yazılır (DOM-FIN-033, DOM-FIN-036).
 */
export function financeDayReportFor(
  ctx: ServiceContext,
  closingDate: string,
): Promise<FinanceDayReport> {
  return runReadOnly(ctx, {
    action: 'finance.day_report',
    collections: [],
    load: async (tx) => {
      const payments = summaryPayments(await dayPayments(tx, ctx, closingDate))
      const closings = await closingViews(
        tx,
        ctx,
        await dayClosingsOf(tx, ctx.institutionId, closingDate),
      )
      const { cashPaymentsEnabled } = await loadPaymentSettings(tx, ctx.institutionId)
      const suggestedOpeningCents = await lastCountedCash(tx, ctx.institutionId, closingDate)
      return {
        run: (): FinanceDayReport => {
          assertFinanceDayReportable(closingDate, dayKey(ctx.now))
          const closing = closings.find((item) => item.reopenedAt === null) ?? null
          const summary = closing?.summary ?? financeDaySummary(payments, closingDate)
          const { collected, reversed } = financeDayLines(payments, closingDate)
          return {
            closingDate,
            status: closing === null ? 'open' : 'closed',
            summary,
            reportStamp: financeDayStamp(summary),
            cashNetCents: financeDayCashNet(summary),
            cashCountRequired: isCashCountRequired(summary, cashPaymentsEnabled),
            suggestedOpeningCents,
            collected: collected.map((line) => ({
              // Tahsilat satırı günün kaydıdır; sonraki iptal kendi gününde görünür.
              ...lineOf(line),
              reversedAt: null,
              reversalReason: null,
            })),
            reversed: reversed.map(lineOf),
            closing,
            history: closings.filter((item) => item.reopenedAt !== null),
          }
        },
      }
    },
  })
}

/** Günü kapatır: özet kurum kilidi altında yeniden hesaplanır, kasa farkı burada kesinleşir. 201. */
export function closeFinanceDayCommand(
  ctx: ServiceContext,
  closingDate: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  let view: FinanceDayClosingView | undefined
  return runCommand(
    ctx,
    {
      action: 'finance_day.close',
      collections: [],
      entity: { type: ENTITY, id },
      load: async (tx) => {
        const payments = summaryPayments(await dayPayments(tx, ctx, closingDate))
        const alreadyClosed = await isFinanceDayClosed(tx, ctx.institutionId, closingDate)
        const { cashPaymentsEnabled: cashEnabled } = await loadPaymentSettings(
          tx,
          ctx.institutionId,
        )
        const suggestedOpeningCents = await lastCountedCash(tx, ctx.institutionId, closingDate)
        return {
          run: () =>
            planFinanceDayClosing(closingDate, financeDaySummary(payments, closingDate), input, {
              today: dayKey(ctx.now),
              alreadyClosed,
              cashEnabled,
              suggestedOpeningCents,
            }),
        }
      },
      after: async (tx, plan) => {
        const stored = await insertDayClosing(tx, ctx.institutionId, {
          id,
          plan,
          closedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await audit(tx, ctx, 'finance_day.close', id, [
          'closingDate',
          'summary',
          ...(plan.cash === null ? [] : ['cash']),
          ...(plan.note === null ? [] : ['note']),
        ])
        ;[view] = await closingViews(tx, ctx, [stored])
      },
    },
    () => {
      if (view === undefined) throw new Error('day closing was not written')
      return { statusCode: 201, body: { data: view } }
    },
    idempotency,
  )
}

/** Kapatılmış günü gerekçeyle yeniden açar; eski kapanış gerekçesiyle kayıtta kalır (DOM-FIN-036). */
export function reopenFinanceDayCommand(
  ctx: ServiceContext,
  closingDate: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let view: FinanceDayClosingView | undefined
  // Yeniden açılan satırın kimliği yüklemede bulunur; denetim varlığı bu kimliktir.
  let closingId = closingDate
  return runCommand(
    ctx,
    {
      action: 'finance_day.reopen',
      collections: [],
      entity: () => ({ type: ENTITY, id: closingId }),
      load: async (tx) => {
        const closings = await dayClosingsOf(tx, ctx.institutionId, closingDate)
        // Kapanışı hiç olmayan gün de başka kurumun günü de aynı 404'tür; varlık sızmaz.
        if (closings.length === 0) throw new NotFoundError()
        const current = closings.find((item) => item.reopenedAt === null)
        if (current !== undefined && current.version !== expectedVersion) throw new ConflictError()
        if (current !== undefined) closingId = current.id
        return { run: () => planFinanceDayReopen(current !== undefined, input) }
      },
      after: async (tx, { reason }) => {
        const updated = await markDayClosingReopened(tx, ctx.institutionId, {
          id: closingId,
          expectedVersion,
          reopenedByUserId: ctx.actor.userId,
          reason,
          now: ctx.now,
        })
        if (updated === null) throw new ConflictError()
        await audit(tx, ctx, 'finance_day.reopen', closingId, ['reopenedAt', 'reopenReason'])
        ;[view] = await closingViews(tx, ctx, [updated])
      },
    },
    () => {
      if (view === undefined) throw new Error('day closing was not reopened')
      return { statusCode: 200, body: { data: view } }
    },
    idempotency,
  )
}
