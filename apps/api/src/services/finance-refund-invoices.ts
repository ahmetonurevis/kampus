import { randomUUID } from 'node:crypto'

import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  cancelWindowEndsOn,
  planRefundInvoice,
  planRefundInvoiceComplete,
  planRefundInvoiceDiscard,
  planRefundInvoiceReady,
  refundInvoiceActions,
  refundInvoicesCsv,
  type RefundDocumentKind,
  type RefundDocumentStatus,
} from '@kampus/school-core/lib/finance-refund-invoices.ts'

import type { Database } from '../db/client.ts'
import {
  findRefundInvoice,
  hasActiveRefundInvoice,
  insertRefundInvoice,
  listRefundInvoices,
  refundInvoiceNumberTaken,
  updateRefundInvoice,
  type RefundInvoiceFilters,
  type StoredRefundInvoice,
} from '../db/finance-refund-invoices.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { findWithdrawal } from '../db/withdrawals.ts'
import { AppError, ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'

/**
 * İade faturası ve iptal isteği (docs/domain/finans.md DOM-FIN-096; ON-266; IST-110, IST-112). Kural
 * core `lib/finance-refund-invoices.ts`'tedir. Servis kurum kilidi altında iadeyi ve iadenin
 * arşivlenmemiş belgesini okur; belge, durum geçişi ve denetim kaydı tek transaction'dadır. Entegratör
 * bağlantısı yoktur (IST-112, ON-080): belge "gönderime hazır"da kalır, CSV ile dışa aktarılır ve
 * entegratör portalındaki sonuç elle işlenir (K-294). Not, tutar ve fatura numarası loglanmaz;
 * denetime yalnız alan adları düşer (DOM-FIN-053). Rol ve modül denetimi rotadadır.
 */

const ENTITY = 'refund_invoices'
/** CSV'nin satır sınırı; aşılırsa süzgeç daraltılır. */
export const REFUND_INVOICE_CSV_MAX = 5000

export type RefundInvoiceView = ReturnType<typeof view>

function view(ctx: ServiceContext, row: StoredRefundInvoice) {
  const originalInvoice = {
    number: row.originalInvoiceNumber,
    date: row.originalInvoiceDate,
    type: row.originalInvoiceType,
    totalCents: row.originalTotalCents,
    vatRateBasisPoints: row.vatRateBasisPoints,
  }
  return {
    id: row.id,
    withdrawalId: row.withdrawalId,
    studentName: row.studentName,
    withdrawalDate: row.withdrawalDate,
    refundCents: row.refundCents,
    refundPaidDate: row.refundPaidDate,
    kind: row.kind,
    status: row.status,
    originalInvoice,
    cancelWindowEndsOn: cancelWindowEndsOn(originalInvoice),
    amountCents: row.amountCents,
    netCents: row.netCents,
    vatCents: row.vatCents,
    partial: row.amountCents < row.originalTotalCents,
    note: row.note,
    documentNumber: row.documentNumber,
    completedDate: row.completedDate,
    createdAt: row.createdAt,
    readyAt: row.readyAt,
    completedAt: row.completedAt,
    actions: refundInvoiceActions(row, ctx.actor),
    version: row.version,
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
    entityType: ENTITY,
    entityId: id,
    changes: { fields: [...fields] },
    createdAt: ctx.now,
  })
}

async function reload(tx: Database, ctx: ServiceContext, id: string) {
  const row = await findRefundInvoice(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return view(ctx, row)
}

/**
 * Yeni taslak (K-292, K-293). Ayrılış başka kurumunsa ya da yoksa 404. Aynı iadeye ikinci belge
 * kurum kilidi altında core'da 409 olur; kilit dışından gelen yarış kısmi tekil indekse takılır.
 * `Idempotency-Key` zorunlu: çift tıklama iki taslak açmaz. 201.
 */
export function createRefundInvoiceCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'refund_invoice.create',
      collections: [],
      entity: { type: ENTITY, id },
      load: async (tx) => {
        const withdrawalId: unknown =
          typeof input === 'object' && input !== null
            ? Reflect.get(input, 'withdrawalId')
            : undefined
        if (typeof withdrawalId !== 'string') throw new NotFoundError()
        const withdrawal = await findWithdrawal(tx, ctx.institutionId, withdrawalId)
        if (withdrawal === null) throw new NotFoundError()
        const hasActiveDocument = await hasActiveRefundInvoice(tx, ctx.institutionId, withdrawalId)
        return {
          run: () => ({
            withdrawalId,
            plan: planRefundInvoice(input, {
              withdrawal,
              hasActiveDocument,
              today: dayKey(ctx.now),
            }),
          }),
        }
      },
      after: async (tx, { withdrawalId, plan }) => {
        await insertRefundInvoice(tx, ctx.institutionId, {
          id,
          withdrawalId,
          ...plan,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await audit(tx, ctx, 'refund_invoice.create', id, [
          'withdrawalId',
          'kind',
          'originalInvoice',
          'amountCents',
          ...(plan.note === null ? [] : ['note']),
        ])
        body = { data: await reload(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Durum geçişinin ortak gövdesi: kayıt kilit altında okunur, sürüm denetlenir, plan yazılır. */
function transition<P, L = undefined>(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
  step: {
    action: string
    /** Kurum kilidi altında ek okuma (ör. numara tekilliği). */
    load?: (tx: Database) => Promise<L>
    plan: (row: StoredRefundInvoice, loaded: L) => P
    write: (
      row: StoredRefundInvoice,
      plan: P,
    ) => {
      changes: Parameters<typeof updateRefundInvoice>[2]['changes']
      fields: readonly string[]
    }
  },
): Promise<CommandResponse> {
  let body: unknown
  return runCommand(
    ctx,
    {
      action: step.action,
      collections: [],
      entity: { type: ENTITY, id },
      load: async (tx) => {
        const row = await findRefundInvoice(tx, ctx.institutionId, id)
        if (row === null) throw new NotFoundError()
        if (row.version !== expectedVersion) throw new ConflictError()
        const loaded = (step.load === undefined ? undefined : await step.load(tx)) as L
        return { run: () => ({ row, plan: step.plan(row, loaded) }) }
      },
      after: async (tx, { row, plan }) => {
        const { changes, fields } = step.write(row, plan)
        const saved = await updateRefundInvoice(tx, ctx.institutionId, {
          id,
          expectedVersion,
          fromStatus: row.status,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await audit(tx, ctx, step.action, id, fields)
        body = {
          data:
            changes.archivedAt === undefined
              ? await reload(tx, ctx, id)
              : { ...view(ctx, row), version: expectedVersion + 1, actions: noActions },
        }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

const noActions = { ready: false, complete: false, discard: false }

/** Taslağı gönderime hazır işaretler (K-294); iptal isteğinde pencere yeniden denetlenir. */
export const markRefundInvoiceReadyCommand = (
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) =>
  transition(ctx, id, expectedVersion, idempotency, {
    action: 'refund_invoice.ready',
    plan: (row) => planRefundInvoiceReady(row, dayKey(ctx.now)),
    write: () => ({
      changes: { status: 'ready', readyAt: ctx.now, readyByUserId: ctx.actor.userId },
      fields: ['status', 'readyAt'],
    }),
  })

/**
 * Entegratör portalındaki sonucu işler (K-294): iade faturası numarasıyla gönderildi, iptal isteği
 * iptal edildi. Aynı numara kurumda ikinci kez yazılamaz (409 `refund_invoice_number_exists`).
 */
export const completeRefundInvoiceCommand = (
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) =>
  transition(ctx, id, expectedVersion, idempotency, {
    action: 'refund_invoice.complete',
    load: async (tx) => {
      const number: unknown =
        typeof input === 'object' && input !== null
          ? Reflect.get(input, 'documentNumber')
          : undefined
      return (
        typeof number === 'string' &&
        (await refundInvoiceNumberTaken(tx, ctx.institutionId, number.trim().toUpperCase(), id))
      )
    },
    plan: (row, numberTaken) => {
      const plan = planRefundInvoiceComplete(row, input, dayKey(ctx.now))
      if (numberTaken)
        throw new DomainError(
          'refund_invoice_number_exists',
          'Bu iade faturası numarası başka bir belgede kayıtlı.',
          { kind: 'conflict', path: ['documentNumber'] },
        )
      return plan
    },
    write: (_row, plan) => ({
      changes: {
        status: plan.status,
        completedDate: plan.completedDate,
        documentNumber: plan.documentNumber,
        completedAt: ctx.now,
        completedByUserId: ctx.actor.userId,
      },
      fields: [
        'status',
        'completedDate',
        ...(plan.documentNumber === null ? [] : ['documentNumber']),
      ],
    }),
  })

/** Taslaktan ya da hazır belgeden gerekçeyle vazgeçer; belge arşivlenir (K-294). */
export const discardRefundInvoiceCommand = (
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) =>
  transition(ctx, id, expectedVersion, idempotency, {
    action: 'refund_invoice.discard',
    plan: (row) => planRefundInvoiceDiscard(row, input),
    write: (_row, plan) => ({
      changes: {
        archivedAt: ctx.now,
        discardReason: plan.reason,
        discardedByUserId: ctx.actor.userId,
      },
      fields: ['archivedAt', 'discardReason'],
    }),
  })

export async function listRefundInvoicesFor(
  ctx: ServiceContext,
  query: RefundInvoiceFilters & { page: number; pageSize: number },
) {
  const { items, total } = await listRefundInvoices(ctx.db, ctx.institutionId, query)
  return { items: items.map((row) => view(ctx, row)), total }
}

export async function getRefundInvoiceFor(ctx: ServiceContext, id: string) {
  const row = await findRefundInvoice(ctx.db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return view(ctx, row)
}

/**
 * Belge listesinin CSV'si (K-294): entegratör portalına elle giriş için. Öğrenci adı taşıdığı için
 * taze oturum ister ve denetime düşer (DOM-YTK-053, toplu dışa aktarım); satır ve tutar loglanmaz.
 */
export async function refundInvoicesCsvFor(
  ctx: ServiceContext,
  filters: { status?: RefundDocumentStatus | undefined; kind?: RefundDocumentKind | undefined },
): Promise<{ csv: string; filename: string }> {
  const { items, total } = await listRefundInvoices(ctx.db, ctx.institutionId, {
    ...filters,
    page: 1,
    pageSize: REFUND_INVOICE_CSV_MAX,
  })
  if (total > REFUND_INVOICE_CSV_MAX)
    throw new AppError(
      422,
      'refund_invoice_export_too_large',
      `Dosya en çok ${String(REFUND_INVOICE_CSV_MAX)} belge alır; durum ya da tür süzgeci seçin.`,
    )
  const csv = refundInvoicesCsv(
    items.map((row) => {
      const shown = view(ctx, row)
      return { ...shown, studentName: row.studentName }
    }),
  )
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.refund_invoice_export',
    entityType: 'finance_export',
    entityId: `refund-invoices:${filters.status ?? 'all'}:${filters.kind ?? 'all'}`,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return { csv, filename: `iade-belgeleri-${dayKey(ctx.now)}.csv` }
}
