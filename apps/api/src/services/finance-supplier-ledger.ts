import { randomUUID } from 'node:crypto'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import { purchaseOrderAmounts } from '@kampus/school-core/lib/finance-purchase-orders.ts'
import {
  defaultPaymentDescription,
  installmentState,
  paymentInstructionCsv,
  planPaymentInstruction,
  planSupplierInvoice,
  planSupplierInvoiceCancel,
  planSupplierInvoicePlan,
  planSupplierPayment,
  planSupplierPaymentCancel,
  supplierInvoiceActions,
  supplierInvoiceStatus,
  supplierStatement,
  type InvoiceOrderLink,
} from '@kampus/school-core/lib/finance-supplier-ledger.ts'
import { maskIban, maskSupplierTaxNumber } from '@kampus/school-core/lib/finance-suppliers.ts'

import type { Database } from '../db/client.ts'
import { isFinanceDayClosed } from '../db/finance-day-closings.ts'
import { findPurchaseOrder, loadOrderItems } from '../db/finance-purchase-orders.ts'
import { purchaseActorNames } from '../db/finance-purchase-requests.ts'
import {
  cancelSupplierPaymentRow,
  findInstallmentForPayment,
  findSupplierInvoice,
  findSupplierPayment,
  insertSupplierInvoice,
  insertSupplierPayment,
  invoiceHasPayments,
  isInvoiceNumberTaken,
  isUuid,
  listSupplierInvoices,
  listSupplierPayments,
  loadInstallments,
  loadInstructionPayments,
  loadInvoicePayments,
  loadSupplierStatementRows,
  markInstructionExported,
  orderInvoicedCents,
  replaceInstallments,
  supplierLedgerFigures,
  updateSupplierInvoice,
  type StoredInvoice,
  type StoredSupplierPayment,
  type SupplierInvoiceQuery,
  type SupplierPaymentQuery,
} from '../db/finance-supplier-ledger.ts'
import { findSupplier, loadSupplierRefs } from '../db/finance-suppliers.ts'
import { listBankAccounts } from '../db/payments.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Tedarikçi carisi ve ödeme planı (DOM-FIN-076; ON-143). Kural core
 * `lib/finance-supplier-ledger.ts`'tedir; servis kurum kilidi altında fatura, taksit, ödeme, banka
 * hesabı ve gün sonu durumunu yükler ve tek işlemde yazar. Kampüs muhasebe defteri tutmaz
 * (IST-142): cari yönetim takibidir. Rol ve modül denetimi rotadadır.
 */

const INVOICES = 'supplier_invoices'
const PAYMENTS = 'supplier_payments'
const today = (ctx: ServiceContext) => dayKey(ctx.now)

/** Gövdedeki kimlik şemadan önce okunur; bozuksa kayıt bulunmaz, şema 400 verir. */
function rawId(input: unknown, key: string): string | null {
  const value = (input ?? {}) as Record<string, unknown>
  const raw = value[key]
  return typeof raw === 'string' && isUuid(raw) ? raw : null
}

// --- Görünümler ----------------------------------------------------------------------------------

function invoiceSummary(invoice: StoredInvoice) {
  const cancelled = invoice.cancelledAt !== null
  const remainingCents = cancelled ? 0 : Math.max(invoice.grossCents - invoice.paidCents, 0)
  const status = supplierInvoiceStatus({ ...invoice, cancelled })
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    nextDueDate: cancelled ? null : invoice.nextDueDate,
    supplier: { id: invoice.supplierId, name: invoice.supplierName },
    purchaseOrderId: invoice.purchaseOrderId,
    netCents: invoice.netCents,
    vatCents: invoice.vatCents,
    grossCents: invoice.grossCents,
    paidCents: invoice.paidCents,
    remainingCents,
    overdueCents: cancelled ? 0 : invoice.overdueCents,
    status,
    cancelledAt: invoice.cancelledAt,
    version: invoice.version,
  }
}

function paymentView(payment: StoredSupplierPayment) {
  return {
    id: payment.id,
    supplier: { id: payment.supplierId, name: payment.supplierName },
    invoice: { id: payment.invoiceId, invoiceNumber: payment.invoiceNumber },
    installmentId: payment.installmentId,
    paidDate: payment.paidDate,
    amountCents: payment.amountCents,
    method: payment.method,
    bankAccount:
      payment.bankAccountId === null
        ? null
        : { id: payment.bankAccountId, label: payment.bankAccountLabel ?? '' },
    description: payment.description ?? defaultPaymentDescription(payment.invoiceNumber),
    createdAt: payment.createdAt,
    cancelledAt: payment.cancelledAt,
    cancelReason: payment.cancelReason,
    instructionExportedAt: payment.instructionExportedAt,
    instructionExportCount: payment.instructionExportCount,
    actions: { cancel: payment.cancelledAt === null },
    version: payment.version,
  }
}

export async function listSupplierInvoicesFor(ctx: ServiceContext, query: SupplierInvoiceQuery) {
  const day = today(ctx)
  const { items, total } = await listSupplierInvoices(ctx.db, ctx.institutionId, query, day)
  return { items: items.map(invoiceSummary), total }
}

async function invoiceDetail(db: Database, ctx: ServiceContext, id: string) {
  const day = today(ctx)
  const invoice = await findSupplierInvoice(db, ctx.institutionId, id, day)
  if (invoice === null) throw new NotFoundError()
  const [installments, payments, order] = await Promise.all([
    loadInstallments(db, ctx.institutionId, [id]),
    loadInvoicePayments(db, ctx.institutionId, id),
    invoice.purchaseOrderId === null
      ? null
      : findPurchaseOrder(db, ctx.institutionId, invoice.purchaseOrderId),
  ])
  const names = await purchaseActorNames(
    db,
    ctx.institutionId,
    [invoice.createdByUserId, invoice.cancelledByUserId].filter(
      (value): value is string => value !== null,
    ),
  )
  const nameOf = (userId: string | null) => (userId === null ? null : (names.get(userId) ?? null))
  const summary = invoiceSummary(invoice)
  const hasPayments = payments.some((payment) => payment.cancelledAt === null)
  return {
    ...summary,
    amountIncludesVat: invoice.amountIncludesVat,
    note: invoice.note,
    purchaseOrder: order === null ? null : { id: order.id, number: order.number },
    installments: (installments.get(id) ?? []).map((item) => {
      const state = installmentState(item, day)
      return {
        id: item.id,
        position: item.position,
        dueDate: item.dueDate,
        amountCents: item.amountCents,
        paidCents: item.paidCents,
        remainingCents: summary.status === 'cancelled' ? 0 : state.remainingCents,
        overdue: summary.status !== 'cancelled' && state.overdue,
      }
    }),
    payments: payments.map(paymentView),
    createdAt: invoice.createdAt,
    createdByName: nameOf(invoice.createdByUserId),
    cancelledByName: nameOf(invoice.cancelledByUserId),
    cancelReason: invoice.cancelReason,
    actions: supplierInvoiceActions({
      cancelled: invoice.cancelledAt !== null,
      hasPayments,
      remainingCents: summary.remainingCents,
    }),
  }
}

export const getSupplierInvoiceFor = (ctx: ServiceContext, id: string) =>
  invoiceDetail(ctx.db, ctx, id)

export async function listSupplierPaymentsFor(ctx: ServiceContext, query: SupplierPaymentQuery) {
  const { items, total } = await listSupplierPayments(ctx.db, ctx.institutionId, query)
  return { items: items.map(paymentView), total }
}

// --- Fatura komutları ----------------------------------------------------------------------------

/** Siparişin tedarikçisi, durumu, KDV dahil tutarı ve bağlı öteki faturaları (K-162). */
async function orderLink(
  tx: Database,
  ctx: ServiceContext,
  orderId: string | null,
): Promise<InvoiceOrderLink | null | undefined> {
  if (orderId === null) return undefined
  const order = await findPurchaseOrder(tx, ctx.institutionId, orderId)
  if (order === null) return null
  const [items, invoicedCents] = await Promise.all([
    loadOrderItems(tx, ctx.institutionId, [orderId]),
    orderInvoicedCents(tx, ctx.institutionId, orderId),
  ])
  return {
    supplierId: order.supplierId,
    status: order.status,
    grossCents: purchaseOrderAmounts(items.get(orderId) ?? []).totals.grossCents,
    invoicedCents,
  }
}

/**
 * Yeni tedarikçi faturası ve ödeme planı (DOM-FIN-076). Numara tekilliği, sipariş aşımı ve plan
 * toplamı kurum kilidi altında denetlenir. `Idempotency-Key` aynı isteği tekrarlar. 201.
 */
export function createSupplierInvoiceCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: INVOICES, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'supplier_invoice.create',
      collections: [],
      entity,
      load: async (tx) => {
        const supplierId = rawId(input, 'supplierId')
        const supplier =
          supplierId === null ? null : await findSupplier(tx, ctx.institutionId, supplierId)
        const rawNumber = (input as Record<string, unknown> | null)?.invoiceNumber
        const number =
          typeof rawNumber === 'string' ? rawNumber.replace(/\s+/g, '').toUpperCase() : ''
        const [numberTaken, order] = await Promise.all([
          supplier === null || number === ''
            ? false
            : isInvoiceNumberTaken(tx, ctx.institutionId, supplier.id, number),
          orderLink(tx, ctx, rawId(input, 'purchaseOrderId')),
        ])
        return {
          run: () =>
            planSupplierInvoice(input, {
              supplier: supplier === null ? null : { id: supplier.id },
              numberTaken,
              order,
              today: today(ctx),
            }),
        }
      },
      after: async (tx, plan) => {
        await insertSupplierInvoice(tx, ctx.institutionId, {
          id,
          supplierId: plan.fields.supplierId,
          invoiceNumber: plan.fields.invoiceNumber,
          invoiceDate: plan.fields.invoiceDate,
          netCents: plan.netCents,
          vatCents: plan.vatCents,
          grossCents: plan.grossCents,
          amountIncludesVat: plan.fields.amountIncludesVat,
          purchaseOrderId: plan.fields.purchaseOrderId,
          note: plan.fields.note,
          createdByUserId: ctx.actor.userId,
          installments: plan.installments,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'supplier_invoice.create', entity, [
          'supplierId',
          'invoiceNumber',
          'invoiceDate',
          'amounts',
          'installments',
          ...(plan.fields.purchaseOrderId === null ? [] : ['purchaseOrderId']),
          ...(plan.orderOverrunConfirmed ? ['confirmOverOrder'] : []),
          ...(plan.fields.note === null ? [] : ['note']),
        ])
        body = { data: await invoiceDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

type InvoiceTransition = 'plan' | 'cancel'

/** Ödeme planının yeniden yazılması ve fatura iptali; ikisi de ödemesiz etkin fatura ister. */
export function transitionSupplierInvoiceCommand(
  ctx: ServiceContext,
  id: string,
  transition: InvoiceTransition,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: INVOICES, id }
  const action = transition === 'plan' ? 'supplier_invoice.replan' : 'supplier_invoice.cancel'
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const invoice = await findSupplierInvoice(tx, ctx.institutionId, id, today(ctx))
        if (invoice === null) throw new NotFoundError()
        if (invoice.version !== expectedVersion) throw new ConflictError()
        const hasPayments = await invoiceHasPayments(tx, ctx.institutionId, id)
        const state = {
          grossCents: invoice.grossCents,
          invoiceDate: invoice.invoiceDate,
          cancelled: invoice.cancelledAt !== null,
          hasPayments,
        }
        return {
          run: () =>
            transition === 'plan'
              ? { kind: 'plan' as const, installments: planSupplierInvoicePlan(state, input) }
              : { kind: 'cancel' as const, ...planSupplierInvoiceCancel(state, input) },
        }
      },
      after: async (tx, plan) => {
        const saved = await updateSupplierInvoice(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes:
            plan.kind === 'cancel'
              ? {
                  cancelledAt: ctx.now,
                  cancelledByUserId: ctx.actor.userId,
                  cancelReason: plan.reason,
                }
              : {},
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        if (plan.kind === 'plan')
          await replaceInstallments(tx, ctx.institutionId, id, plan.installments, ctx.now)
        await auditWork(
          tx,
          ctx,
          action,
          entity,
          plan.kind === 'plan' ? ['installments'] : ['cancelledAt', 'cancelReason'],
        )
        body = { data: await invoiceDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Ödeme komutları -----------------------------------------------------------------------------

/**
 * Taksite ödeme (DOM-FIN-076). Taksitin kalanı kurum kilidi altında yeniden hesaplanır: eşzamanlı
 * iki ödeme aynı kalanı birlikte tüketemez. Nakit ödeme ödeme gününün gün sonuna girer; kapatılmış
 * güne yazılmaz (K-166). 201.
 */
export function createSupplierPaymentCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: PAYMENTS, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'supplier_payment.create',
      collections: [],
      entity,
      load: async (tx) => {
        const installmentId = rawId(input, 'installmentId')
        const rawDay = (input as Record<string, unknown> | null)?.paidDate
        const paidDay =
          typeof rawDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : null
        const [found, accounts, dayClosed] = await Promise.all([
          installmentId === null
            ? null
            : findInstallmentForPayment(tx, ctx.institutionId, installmentId),
          listBankAccounts(tx, ctx.institutionId),
          paidDay === null ? false : isFinanceDayClosed(tx, ctx.institutionId, paidDay),
        ])
        return {
          run: () => {
            const plan = planSupplierPayment(input, {
              installment:
                found === null
                  ? null
                  : {
                      amountCents: found.installment.amountCents,
                      paidCents: found.installment.paidCents,
                      invoiceDate: found.invoiceDate,
                      invoiceCancelled: found.invoiceCancelled,
                    },
              bankAccountIds: accounts.map((account) => account.id),
              dayClosed,
              today: today(ctx),
            })
            if (found === null) throw new NotFoundError()
            return { plan, found }
          },
        }
      },
      after: async (tx, { plan, found }) => {
        await insertSupplierPayment(tx, ctx.institutionId, {
          id,
          supplierId: found.supplierId,
          invoiceId: found.installment.invoiceId,
          installmentId: found.installment.id,
          paidDate: plan.paidDate,
          amountCents: plan.amountCents,
          method: plan.method,
          bankAccountId: plan.bankAccountId,
          description: plan.description,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'supplier_payment.create', entity, [
          'installmentId',
          'paidDate',
          'amountCents',
          'method',
          ...(plan.bankAccountId === null ? [] : ['bankAccountId']),
          ...(plan.description === null ? [] : ['description']),
        ])
        const stored = await findSupplierPayment(tx, ctx.institutionId, id)
        if (stored === null) throw new Error('supplier payment was not written')
        body = { data: paymentView(stored) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/**
 * Ödeme iptali gerekçeyle. Nakit ödeme ödeme gününün gün sonundadır, iptal onu oradan çıkarır; o gün
 * kapatılmışsa reddedilir (K-166, K-190). Kapanışla aynı kurum kilidinde sıraya girer.
 */
export function cancelSupplierPaymentCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PAYMENTS, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'supplier_payment.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const payment = await findSupplierPayment(tx, ctx.institutionId, id)
        if (payment === null) throw new NotFoundError()
        if (payment.version !== expectedVersion) throw new ConflictError()
        const paidDayClosed =
          payment.method === 'cash' &&
          (await isFinanceDayClosed(tx, ctx.institutionId, payment.paidDate))
        return {
          run: () =>
            planSupplierPaymentCancel(
              { cancelled: payment.cancelledAt !== null, method: payment.method },
              input,
              paidDayClosed,
            ),
        }
      },
      after: async (tx, { reason }) => {
        const saved = await cancelSupplierPaymentRow(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          reason,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'supplier_payment.cancel', entity, ['cancelledAt', 'cancelReason'])
        const stored = await findSupplierPayment(tx, ctx.institutionId, id)
        if (stored === null) throw new NotFoundError()
        body = { data: paymentView(stored) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Ödeme talimatı dosyası (K-164, K-165): seçilen havale/EFT ödemeleri için genel CSV. Dosyaya
 * alınan ödemeler aynı işlemde işaretlenir ve denetim kaydına yalnız ödeme kimlikleri düşer; dosya
 * içeriği saklanmaz. IBAN dosyada açıktır.
 */
export async function paymentInstructionFileFor(
  ctx: ServiceContext,
  input: unknown,
): Promise<{ csv: string; fileName: string }> {
  const entity = { type: PAYMENTS, id: `instruction:${ctx.now.toISOString()}` }
  const requested = (input as { paymentIds?: unknown } | null)?.paymentIds
  const ids = Array.isArray(requested)
    ? requested.filter((value): value is string => typeof value === 'string')
    : []
  let csv = ''
  await runCommand(
    ctx,
    {
      action: 'supplier_payment.instruction_export',
      collections: [],
      entity,
      load: async (tx) => {
        const rows = await loadInstructionPayments(tx, ctx.institutionId, ids)
        return {
          run: () =>
            planPaymentInstruction(
              input,
              rows.map((row) => ({
                ...row,
                description: row.description ?? defaultPaymentDescription(row.invoiceNumber),
              })),
            ),
        }
      },
      after: async (tx, { payments, reexported }) => {
        await markInstructionExported(
          tx,
          ctx.institutionId,
          payments.map((payment) => payment.id),
          ctx.actor.userId,
          ctx.now,
        )
        await auditWork(tx, ctx, 'supplier_payment.instruction_export', entity, [
          ...payments.map((payment) => `payment:${payment.id}`),
          ...(reexported ? ['confirmReexport'] : []),
        ])
        csv = paymentInstructionCsv(payments)
      },
    },
    () => ({ statusCode: 200, body: null }),
    null,
  )
  return { csv, fileName: `odeme-talimati-${today(ctx)}.csv` }
}

// --- Cari ----------------------------------------------------------------------------------------

export interface SupplierLedgerQuery {
  page: number
  pageSize: number
  q?: string | undefined
  balance?: 'open' | 'overdue' | undefined
}

const fold = (value: string) => value.toLocaleLowerCase('tr-TR')

/**
 * Tedarikçi carisi özeti (K-163): faturası olan tedarikçiler; vadesi geçmiş tutar büyük olan önce,
 * sonra bakiye ve ad. Tedarikçi sayısı küçük olduğundan süzme ve sayfalama toplamlar üzerindedir.
 */
export async function supplierLedgerFor(ctx: ServiceContext, query: SupplierLedgerQuery) {
  const figures = await supplierLedgerFigures(ctx.db, ctx.institutionId, today(ctx))
  const refs = await loadSupplierRefs(
    ctx.db,
    ctx.institutionId,
    figures.map((row) => row.supplierId),
  )
  const rows = figures.map((row) => ({
    supplier: {
      id: row.supplierId,
      name: refs.get(row.supplierId)?.name ?? '',
      isActive: refs.get(row.supplierId)?.isActive ?? false,
    },
    invoiceCount: row.invoiceCount,
    invoicedCents: row.invoicedCents,
    paidCents: row.paidCents,
    balanceCents: row.invoicedCents - row.paidCents,
    overdueCents: row.overdueCents,
    nextDueDate: row.invoicedCents - row.paidCents > 0 ? row.nextDueDate : null,
  }))
  const totals = rows.reduce(
    (sum, row) => ({
      invoicedCents: sum.invoicedCents + row.invoicedCents,
      paidCents: sum.paidCents + row.paidCents,
      balanceCents: sum.balanceCents + row.balanceCents,
      overdueCents: sum.overdueCents + row.overdueCents,
    }),
    { invoicedCents: 0, paidCents: 0, balanceCents: 0, overdueCents: 0 },
  )
  const needle = query.q === undefined ? null : fold(query.q)
  const filtered = rows
    .filter((row) => needle === null || fold(row.supplier.name).includes(needle))
    .filter((row) =>
      query.balance === 'open'
        ? row.balanceCents > 0
        : query.balance === 'overdue'
          ? row.overdueCents > 0
          : true,
    )
    .sort(
      (a, b) =>
        b.overdueCents - a.overdueCents ||
        b.balanceCents - a.balanceCents ||
        a.supplier.name.localeCompare(b.supplier.name, 'tr'),
    )
  const start = (query.page - 1) * query.pageSize
  return {
    items: filtered.slice(start, start + query.pageSize),
    total: filtered.length,
    totals,
  }
}

/**
 * Tedarikçi ekstresi: fatura, ödeme ve iptaller yürüyen bakiyeyle; yeni hareket önce sayfalanır.
 * IBAN ekranda maskelidir; şahıs TCKN'si maskeli döner (DOM-FIN-070).
 */
export async function supplierStatementFor(
  ctx: ServiceContext,
  supplierId: string,
  page: { page: number; pageSize: number },
) {
  const supplier = await findSupplier(ctx.db, ctx.institutionId, supplierId)
  if (supplier === null) throw new NotFoundError()
  const day = today(ctx)
  const [{ invoices, payments }, figures] = await Promise.all([
    loadSupplierStatementRows(ctx.db, ctx.institutionId, supplierId),
    supplierLedgerFigures(ctx.db, ctx.institutionId, day),
  ])
  const own = figures.find((row) => row.supplierId === supplierId)
  const movements = supplierStatement(invoices, payments).reverse()
  const start = (page.page - 1) * page.pageSize
  return {
    item: {
      supplier: {
        id: supplier.id,
        name: supplier.name,
        type: supplier.type,
        taxNumber: maskSupplierTaxNumber(supplier.type, supplier.taxNumber),
        iban: supplier.iban === null ? null : maskIban(supplier.iban),
        isActive: supplier.isActive,
      },
      invoicedCents: own?.invoicedCents ?? 0,
      paidCents: own?.paidCents ?? 0,
      balanceCents: (own?.invoicedCents ?? 0) - (own?.paidCents ?? 0),
      overdueCents: own?.overdueCents ?? 0,
      movements: movements.slice(start, start + page.pageSize),
    },
    total: movements.length,
  }
}
