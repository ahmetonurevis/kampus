import { randomUUID } from 'node:crypto'

import type { State } from '@kampus/school-core/data/seed.ts'
import { requireAuthorized } from '@kampus/school-core/lib/authorize.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  openAmount,
  planPayment,
  recordPaymentSchema,
  reversePayment,
  type PaymentPlan,
  type PaymentSettingsInput,
} from '@kampus/school-core/lib/payments.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import {
  allocatedByInvoice,
  findPayment,
  insertPayment,
  isReferenceInUse,
  listPayments,
  loadPaymentSettings,
  markPaymentReversed,
  savePaymentSettings,
  type StoredPayment,
  type StoredPaymentSettings,
} from '../db/payments.ts'
import { findRecord } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { environment, type CommandOptions } from './commands.ts'
import {
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
  type OperationResponse,
} from './operation-runner.ts'
import { readScope } from './read-scope.ts'

/**
 * Tahsilat servisi (ADR 0006; docs/domain/finans.md DOM-FIN-030…033, DOM-FIN-052). Kural core
 * `lib/payments.ts`'tedir. Taksit ve tahsilat aynı transaction'da, kurum kilidi altında yazılır;
 * tutar, referans ve gerekçe loglanmaz, denetim kaydına yalnız alan adları düşer.
 *
 * Denetimde iki eylem vardır: `payment.record`/`payment.reverse` tahsilatın kendisi, çalıştırıcının
 * yazdığı `invoice.pay`/`payment.invoices` ise taksitlerde değişen alanlardır.
 */

const SPEC = OPERATION_COMMANDS['invoice.pay']
const STAFF_ROLES: ReadonlySet<string> = new Set(['yonetici', 'onburo'])

export interface PaymentView {
  id: string
  studentId: string
  amountCents: number
  /** Taksitlere dağıtılmayan, iade alacağı olan kısım (DOM-FIN-030); saklanmaz. */
  creditCents: number
  method: StoredPayment['method']
  reference: string | null
  paidAt: string
  receiptYear: number
  receiptNumber: number
  reversedAt: string | null
  /** İptal gerekçesi personel içindir; veli ve öğrenciye gitmez. */
  reversalReason: string | null
  version: number
  allocations: StoredPayment['allocations']
}

function paymentView(payment: StoredPayment, staff: boolean): PaymentView {
  const allocated = payment.allocations.reduce((sum, item) => sum + item.amountCents, 0)
  return {
    id: payment.id,
    studentId: payment.studentId,
    amountCents: payment.amountCents,
    creditCents: payment.amountCents - allocated,
    method: payment.method,
    reference: payment.reference,
    paidAt: payment.paidAt.toISOString(),
    receiptYear: payment.receiptYear,
    receiptNumber: payment.receiptNumber,
    reversedAt: payment.reversedAt?.toISOString() ?? null,
    reversalReason: staff ? payment.reversalReason : null,
    version: payment.version,
    allocations: payment.allocations,
  }
}

async function audit(
  tx: Database,
  ctx: ServiceContext,
  action: string,
  entity: { type: string; id: string },
  fields: readonly string[],
) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action,
    entityType: entity.type,
    entityId: entity.id,
    changes: { fields: [...fields] },
    createdAt: ctx.now,
  })
}

interface PaymentWrite {
  /** Çalıştırıcının taksit değişikliği için yazdığı denetim eylemi ve varlığı. */
  action: string
  entity: (paymentId: string) => { type: string; id: string }
  studentId: (tx: Database) => Promise<string>
  reference: string | null
  referenceOptional: boolean
  expectedVersions?: readonly { collection: 'invoices'; id: string; version: number }[]
  input: (state: State, allocated: ReadonlyMap<string, number>) => unknown
  respond: (payment: StoredPayment, changes: Parameters<typeof commandBody>[1]) => OperationResponse
}

/** Tahsilatı yazan ortak akış. Dağılım ve referans kurum kilidi altında okunur (DOM-FIN-031). */
function writePayment(
  ctx: ServiceContext,
  write: PaymentWrite,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  let stored: StoredPayment | undefined
  return runCommand<PaymentPlan>(
    ctx,
    {
      action: write.action,
      collections: SPEC.collections,
      entity: write.entity(id),
      ...(write.expectedVersions ? { expectedVersions: write.expectedVersions } : {}),
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
        const studentId = await write.studentId(tx)
        const allocated = await allocatedByInvoice(tx, ctx.institutionId, studentId)
        const { cashPaymentsEnabled: cashEnabled } = await loadPaymentSettings(
          tx,
          ctx.institutionId,
        )
        const referenceInUse =
          write.reference !== null &&
          (await isReferenceInUse(tx, ctx.institutionId, write.reference))
        return {
          scalars,
          run: (state, { now }) => {
            // Olmayan taksitte hedef boştur: yetki reddi kayıt aramasından önce döner.
            requireAuthorized(actor, 'invoice.pay', { studentId }, state, { now, institutionType })
            return planPayment(state, write.input(state, allocated), {
              allocated,
              cashEnabled,
              referenceInUse,
              referenceOptional: write.referenceOptional,
              now,
            })
          },
        }
      },
      after: async (tx, plan) => {
        stored = await insertPayment(tx, ctx.institutionId, {
          id,
          plan,
          receiptYear: Number(dayKey(ctx.now).slice(0, 4)),
          recordedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await audit(tx, ctx, 'payment.record', { type: 'payments', id }, [
          'amountCents',
          'method',
          'reference',
          'paidAt',
          'allocations',
        ])
      },
    },
    (outcome) => {
      if (stored === undefined) throw new Error('payment was not written')
      return write.respond(stored, outcome.changes)
    },
    idempotency,
  )
}

/** Tahsilat kaydeder, açık taksitlere dağıtır (DOM-FIN-030, -031). 201. */
export function recordPaymentCommand(
  ctx: ServiceContext,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const data = recordPaymentSchema.parse(input)
  return writePayment(
    ctx,
    {
      action: 'payment.invoices',
      entity: (id) => ({ type: 'payments', id }),
      studentId: () => Promise.resolve(data.studentId),
      reference: data.reference ?? null,
      referenceOptional: false,
      input: () => data,
      respond: (payment) => ({
        statusCode: 201,
        body: { data: paymentView(payment, true) },
      }),
    },
    options.idempotency,
  )
}

/**
 * Eski taksit ödeme ucu: taksitin kalan tutarını referanssız tahsilat olarak yazar (ADR 0006).
 * Yanıt biçimi değişmez. TODO(web-payments): React ekranı `POST /payments`'a geçince kalkar.
 */
export function payInvoiceCommand(
  ctx: ServiceContext,
  invoiceId: string,
  method: string,
  options: CommandOptions,
): Promise<CommandResponse> {
  return writePayment(
    ctx,
    {
      action: 'invoice.pay',
      entity: () => ({ type: 'invoices', id: invoiceId }),
      studentId: async (tx) => {
        const row = await findRecord(tx, ctx.institutionId, 'invoices', invoiceId)
        return typeof row?.data.studentId === 'string' ? row.data.studentId : ''
      },
      reference: null,
      referenceOptional: true,
      ...(options.expectedVersion === null
        ? {}
        : {
            expectedVersions: [
              {
                collection: 'invoices' as const,
                id: invoiceId,
                version: options.expectedVersion,
              },
            ],
          }),
      input: (state, allocated) => {
        const invoice = state.invoices.find((item) => item.id === invoiceId)
        if (!invoice)
          throw new DomainError('invoice_not_found', 'Ödeme kaydı bulunamadı.', {
            kind: 'not_found',
          })
        // Ödenmiş taksitte de tutar pozitif kalır; ret core `invoice_already_paid`'dir.
        const open = openAmount(invoice, allocated)
        return {
          studentId: invoice.studentId,
          amountCents: open === 0 ? invoice.amount : open,
          method,
          invoiceId,
        }
      },
      respond: (_payment, changes) =>
        commandBody({ collection: 'invoices', id: invoiceId }, changes),
    },
    options.idempotency,
  )
}

/** Tahsilatı gerekçeyle iptal eder, taksitleri yeniden açar; yalnız yönetici (DOM-FIN-033). */
export function reversePaymentCommand(
  ctx: ServiceContext,
  paymentId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS['payment.reverse']
  let view: PaymentView | undefined
  return runCommand(
    ctx,
    {
      action: 'payment.invoices',
      collections: spec.collections,
      entity: { type: 'payments', id: paymentId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        const payment = await findPayment(tx, ctx.institutionId, paymentId)
        if (payment === null) throw new NotFoundError()
        if (payment.version !== expectedVersion) throw new ConflictError()
        return {
          scalars,
          run: (state, { now }) => {
            requireAuthorized(actor, 'payment.reverse', {}, state, { now, institutionType })
            return reversePayment(
              state,
              {
                reversedAt: payment.reversedAt?.toISOString() ?? null,
                allocations: payment.allocations,
              },
              input,
            )
          },
        }
      },
      after: async (tx, { reason }) => {
        const updated = await markPaymentReversed(tx, ctx.institutionId, {
          id: paymentId,
          expectedVersion,
          reversedByUserId: ctx.actor.userId,
          reason,
          now: ctx.now,
        })
        if (updated === null) throw new ConflictError()
        await audit(tx, ctx, 'payment.reverse', { type: 'payments', id: paymentId }, [
          'reversedAt',
          'reversalReason',
        ])
        const payment = await findPayment(tx, ctx.institutionId, paymentId)
        if (payment === null) throw new NotFoundError()
        view = paymentView(payment, true)
      },
    },
    () => {
      if (view === undefined) throw new Error('payment was not reversed')
      return { statusCode: 200, body: { data: view } }
    },
    idempotency,
  )
}

/** Personel kurumun tamamını, veli ve öğrenci yalnız kapsamındaki öğrencileri görür (DOM-FIN-052). */
async function visibleStudents(ctx: ServiceContext): Promise<readonly string[] | null> {
  if (STAFF_ROLES.has(ctx.actor.role)) return null
  return [...(await readScope(ctx)).studentIds]
}

export async function listPaymentsFor(
  ctx: ServiceContext,
  query: { studentId?: string | undefined; page: number; pageSize: number },
): Promise<{ items: PaymentView[]; total: number }> {
  const studentIds = await visibleStudents(ctx)
  if (studentIds !== null && studentIds.length === 0) return { items: [], total: 0 }
  const { items, total } = await listPayments(ctx.db, ctx.institutionId, { ...query, studentIds })
  return { items: items.map((item) => paymentView(item, studentIds === null)), total }
}

export async function getPaymentFor(ctx: ServiceContext, paymentId: string): Promise<PaymentView> {
  const payment = await findPayment(ctx.db, ctx.institutionId, paymentId)
  if (payment === null) throw new NotFoundError()
  const studentIds = await visibleStudents(ctx)
  if (studentIds !== null && !studentIds.includes(payment.studentId)) throw new NotFoundError()
  return paymentView(payment, studentIds === null)
}

export function getPaymentSettings(
  db: Database,
  institutionId: string,
): Promise<StoredPaymentSettings> {
  return loadPaymentSettings(db, institutionId)
}

/** Nakit tahsilatı açar veya kapatır (ADR 0006 karar 7). */
export function setPaymentSettings(
  ctx: ServiceContext,
  body: PaymentSettingsInput,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let result: StoredPaymentSettings | undefined
  return runCommand(
    ctx,
    {
      action: 'payment.settings',
      collections: [],
      entity: { type: 'payment_settings', id: ctx.institutionId },
      load: async (tx) => {
        const row = await loadPaymentSettings(tx, ctx.institutionId)
        if (row.version !== expectedVersion) throw new ConflictError()
        return { run: () => body }
      },
      after: async (tx, input) => {
        const saved = await savePaymentSettings(tx, ctx.institutionId, {
          cashPaymentsEnabled: input.cashPaymentsEnabled,
          expectedVersion,
          now: ctx.now,
        })
        if (saved === null) throw new ConflictError()
        await audit(
          tx,
          ctx,
          'payment.settings',
          { type: 'payment_settings', id: ctx.institutionId },
          ['cashPaymentsEnabled'],
        )
        result = saved
      },
    },
    () => {
      if (result === undefined) throw new Error('payment settings were not written')
      return { statusCode: 200, body: { data: result } }
    },
    idempotency,
  )
}
