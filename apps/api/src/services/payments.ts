import { randomUUID } from 'node:crypto'

import { requireAuthorized } from '@kampus/school-core/lib/authorize.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import {
  assertMebbisChangeAllowed,
  bankAccountSchema,
  paymentMebbisSchema,
  planPayment,
  recordPaymentSchema,
  reversePayment,
  type PaymentMethod,
  type PaymentPlan,
  type PaymentSettingsInput,
} from '@kampus/school-core/lib/payments.ts'
import { financeStudentIds } from '@kampus/school-core/lib/scope.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import {
  allocatedByInvoice,
  archiveBankAccount,
  findPayment,
  insertBankAccount,
  insertPayment,
  isReferenceInUse,
  listBankAccounts,
  listPayments,
  loadPaymentSettings,
  markPaymentReversed,
  savePaymentSettings,
  setPaymentMebbis,
  type StoredBankAccount,
  type StoredPayment,
  type StoredPaymentSettings,
} from '../db/payments.ts'
import { withdrawalsForReversal } from '../db/withdrawals.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { environment, type CommandOptions } from './commands.ts'
import { notify } from './notify.ts'
import {
  FINANCE_TABLE_STORES,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
  type LoadScope,
} from './operation-runner.ts'
import { readScope } from './read-scope.ts'
import { dayRange } from './list-filters.ts'

/**
 * Tahsilat servisi (ADR 0006; docs/domain/finans.md DOM-FIN-030…033, DOM-FIN-052). Kural core
 * `lib/payments.ts`'tedir. Taksit ve tahsilat aynı transaction'da, kurum kilidi altında yazılır;
 * tutar, referans ve gerekçe loglanmaz, denetim kaydına yalnız alan adları düşer.
 *
 * Denetimde iki eylem vardır: `payment.record`/`payment.reverse` tahsilatın kendisi, çalıştırıcının
 * yazdığı `invoice.pay`/`payment.invoices` ise taksitlerde değişen alanlardır.
 *
 * Tahsilat bildirimi (`payment_received`, IST-106) aynı transaction'dadır; yalnız tahsilat kimliğini
 * taşır, tutar ve referans yazmaz. İptal bildirim üretmez.
 */

const SPEC = OPERATION_COMMANDS['invoice.pay']

/**
 * Öğrencinin taksit ve sözleşmeleri (ADR 0010 karar 8, ölçüt 4; ON-046f). Tahsilat, iptal ve ayrılış
 * yalnız o öğrencinin taksit ve sözleşmelerine bakar ve yazar; kurum kilidi altında kurumun bütün
 * taksitlerini yüklemek gerekmez. `studentId` eşitliği tablo indeksine (`invoices_student_due_idx`,
 * `contracts_student_idx`) iner.
 */
export const studentFinanceScope = (studentId: string): LoadScope => ({
  match: [{ kind: 'equals', field: 'studentId', values: [studentId] }],
})
const STAFF_ROLES: ReadonlySet<string> = new Set(['yonetici', 'onburo'])

export interface PaymentView {
  id: string
  studentId: string
  studentName: string | null
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
  bankAccountLabel: string | null
  /** MEBBİS takibi personel içindir; veli ve öğrenciye gitmez. */
  mebbisRecordedAt: string | null
  version: number
  allocations: StoredPayment['allocations']
}

function paymentView(payment: StoredPayment, staff: boolean): PaymentView {
  const allocated = payment.allocations.reduce((sum, item) => sum + item.amountCents, 0)
  return {
    id: payment.id,
    studentId: payment.studentId,
    studentName: payment.studentName,
    amountCents: payment.amountCents,
    creditCents: payment.amountCents - allocated,
    method: payment.method,
    reference: payment.reference,
    paidAt: payment.paidAt.toISOString(),
    receiptYear: payment.receiptYear,
    receiptNumber: payment.receiptNumber,
    reversedAt: payment.reversedAt?.toISOString() ?? null,
    reversalReason: staff ? payment.reversalReason : null,
    bankAccountLabel: payment.bankAccountLabel,
    mebbisRecordedAt: staff ? (payment.mebbisRecordedAt?.toISOString() ?? null) : null,
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

/** Tahsilat kaydeder, açık taksitlere dağıtır; denetimler kurum kilidi altındadır (DOM-FIN-030, -031). 201. */
export function recordPaymentCommand(
  ctx: ServiceContext,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const data = recordPaymentSchema.parse(input)
  const reference = data.reference ?? null
  const id = randomUUID()
  let stored: StoredPayment | undefined
  return runCommand<PaymentPlan>(
    ctx,
    {
      action: 'payment.invoices',
      collections: SPEC.collections,
      stores: FINANCE_TABLE_STORES,
      // Core yalnız bu öğrencinin taksitlerini dağıtır ve burslu sözleşmesine bakar (DOM-FIN-030).
      loadScope: {
        invoices: studentFinanceScope(data.studentId),
        contracts: studentFinanceScope(data.studentId),
      },
      entity: { type: 'payments', id },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
        const allocated = await allocatedByInvoice(tx, ctx.institutionId, data.studentId)
        const { cashPaymentsEnabled: cashEnabled } = await loadPaymentSettings(
          tx,
          ctx.institutionId,
        )
        const referenceInUse =
          reference !== null && (await isReferenceInUse(tx, ctx.institutionId, reference))
        const accounts = await listBankAccounts(tx, ctx.institutionId)
        const bankAccountIds = accounts.map((account) => account.id)
        return {
          scalars,
          run: (state, { now }) => {
            requireAuthorized(actor, 'invoice.pay', { studentId: data.studentId }, state, {
              now,
              institutionType,
            })
            return planPayment(state, data, {
              allocated,
              cashEnabled,
              referenceInUse,
              bankAccountIds,
              now,
            })
          },
        }
      },
      after: async (tx, plan) => {
        await insertPayment(tx, ctx.institutionId, {
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
          'bankAccountId',
          'paidAt',
          'allocations',
        ])
        stored = (await findPayment(tx, ctx.institutionId, id)) ?? undefined
        await notify(tx, ctx, {
          type: 'payment_received',
          recipients: { studentIds: [plan.studentId] },
          data: { paymentId: id },
          dedupeKey: id,
        })
      },
    },
    () => {
      if (stored === undefined) throw new Error('payment was not written')
      return { statusCode: 201, body: { data: paymentView(stored, true) } }
    },
    options.idempotency,
  )
}

/** Tahsilatı gerekçeyle iptal eder, taksitleri yeniden açar; yalnız yönetici (DOM-FIN-033). */
export async function reversePaymentCommand(
  ctx: ServiceContext,
  paymentId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS['payment.reverse']
  let view: PaymentView | undefined
  // Tahsilatın öğrencisi değişmez; kurum kilidinden önce okunabilir. Yok ya da başka kurumun
  // tahsilatıysa hiçbir taksit yüklenmez, 404 eskisi gibi kilit altındaki okumadan gelir.
  const owner = await findPayment(ctx.db, ctx.institutionId, paymentId)
  return runCommand(
    ctx,
    {
      action: 'payment.invoices',
      collections: spec.collections,
      stores: FINANCE_TABLE_STORES,
      loadScope: {
        invoices: owner === null ? { ids: [] } : studentFinanceScope(owner.studentId),
      },
      entity: { type: 'payments', id: paymentId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, spec)
        const payment = await findPayment(tx, ctx.institutionId, paymentId)
        if (payment === null) throw new NotFoundError()
        if (payment.version !== expectedVersion) throw new ConflictError()
        const withdrawals = await withdrawalsForReversal(tx, ctx.institutionId, payment.studentId)
        return {
          scalars,
          run: (state, { now }) => {
            requireAuthorized(actor, 'payment.reverse', {}, state, { now, institutionType })
            return reversePayment(
              state,
              {
                reversedAt: payment.reversedAt?.toISOString() ?? null,
                allocations: payment.allocations,
                withdrawals,
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

/** Tahsilatın MEBBİS'e işlendiğini işaretler veya işareti kaldırır (DOM-FIN-032). */
export function setPaymentMebbisCommand(
  ctx: ServiceContext,
  paymentId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const { recorded } = paymentMebbisSchema.parse(input)
  let view: PaymentView | undefined
  return runCommand(
    ctx,
    {
      action: 'payment.mebbis',
      collections: [],
      entity: { type: 'payments', id: paymentId },
      load: async (tx) => {
        const payment = await findPayment(tx, ctx.institutionId, paymentId)
        if (payment === null) throw new NotFoundError()
        if (payment.version !== expectedVersion) throw new ConflictError()
        return {
          run: () =>
            assertMebbisChangeAllowed({
              reversedAt: payment.reversedAt?.toISOString() ?? null,
            }),
        }
      },
      after: async (tx) => {
        const updated = await setPaymentMebbis(tx, ctx.institutionId, {
          id: paymentId,
          expectedVersion,
          recordedByUserId: recorded ? ctx.actor.userId : null,
          now: ctx.now,
        })
        if (updated === null) throw new ConflictError()
        await audit(tx, ctx, 'payment.mebbis', { type: 'payments', id: paymentId }, [
          'mebbisRecordedAt',
        ])
        const payment = await findPayment(tx, ctx.institutionId, paymentId)
        if (payment === null) throw new NotFoundError()
        view = paymentView(payment, true)
      },
    },
    () => {
      if (view === undefined) throw new Error('payment mebbis mark was not written')
      return { statusCode: 200, body: { data: view } }
    },
    idempotency,
  )
}

export function getBankAccounts(db: Database, institutionId: string): Promise<StoredBankAccount[]> {
  return listBankAccounts(db, institutionId)
}

/** Bildirilmiş hesap ekler; aynı IBAN iki kez eklenmez (DOM-FIN-032). */
export function createBankAccountCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const data = bankAccountSchema.parse(input)
  const id = randomUUID()
  let stored: StoredBankAccount | undefined
  return runCommand(
    ctx,
    {
      action: 'bank_account.create',
      collections: [],
      entity: { type: 'bank_accounts', id },
      load: async (tx) => {
        const accounts = await listBankAccounts(tx, ctx.institutionId)
        return {
          run: () => {
            if (accounts.some((account) => account.iban === data.iban))
              throw new DomainError('bank_account_exists', 'Bu IBAN zaten tanımlı.', {
                kind: 'conflict',
                path: ['iban'],
              })
          },
        }
      },
      after: async (tx) => {
        stored = await insertBankAccount(tx, ctx.institutionId, { id, ...data, now: ctx.now })
        await audit(tx, ctx, 'bank_account.create', { type: 'bank_accounts', id }, [
          'bankName',
          'iban',
          'accountHolder',
        ])
      },
    },
    () => {
      if (stored === undefined) throw new Error('bank account was not written')
      return { statusCode: 201, body: { data: stored } }
    },
    idempotency,
  )
}

/** Hesabı arşivler: yeni tahsilatta seçilmez, geçmiş tahsilat bağı korunur. */
export function archiveBankAccountCommand(
  ctx: ServiceContext,
  bankAccountId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return runCommand(
    ctx,
    {
      action: 'bank_account.archive',
      collections: [],
      entity: { type: 'bank_accounts', id: bankAccountId },
      load: async (tx) => {
        const accounts = await listBankAccounts(tx, ctx.institutionId)
        const account = accounts.find((item) => item.id === bankAccountId)
        if (account === undefined) throw new NotFoundError()
        if (account.version !== expectedVersion) throw new ConflictError()
        return { run: () => undefined }
      },
      after: async (tx) => {
        const archived = await archiveBankAccount(tx, ctx.institutionId, {
          id: bankAccountId,
          expectedVersion,
          now: ctx.now,
        })
        if (archived === null) throw new ConflictError()
        await audit(tx, ctx, 'bank_account.archive', { type: 'bank_accounts', id: bankAccountId }, [
          'archivedAt',
        ])
      },
    },
    () => ({ statusCode: 200, body: { data: { id: bankAccountId } } }),
    idempotency,
  )
}

/**
 * Personel kurumun tamamını, veli ve öğrenci yalnız finans kapsamındaki öğrencileri görür
 * (DOM-FIN-052): veli velayetli çocuğunu ve velayeti olmasa da ödeyicisi olduğu öğrenciyi (K-04,
 * DOM-ILT-074). Tahsilat ayrıntısı dekontun kaynağıdır; aynı kapsamla okunur.
 */
async function visibleStudents(ctx: ServiceContext): Promise<readonly string[] | null> {
  if (STAFF_ROLES.has(ctx.actor.role)) return null
  return [...financeStudentIds(await readScope(ctx))]
}

export async function listPaymentsFor(
  ctx: ServiceContext,
  query: {
    studentId?: string | undefined
    q?: string | undefined
    mebbis?: 'pending' | undefined
    method?: PaymentMethod | undefined
    dateFrom?: string | undefined
    dateTo?: string | undefined
    page: number
    pageSize: number
  },
): Promise<{ items: PaymentView[]; total: number }> {
  const studentIds = await visibleStudents(ctx)
  if (studentIds !== null && studentIds.length === 0) return { items: [], total: 0 }
  // Gün aralığı Europe/Istanbul günüdür; uçlar dahil (ON-118).
  const range = dayRange('paidAt', query.dateFrom, query.dateTo)
  const { items, total } = await listPayments(ctx.db, ctx.institutionId, {
    ...query,
    paidFrom: range?.fromInstant ? new Date(range.fromInstant) : undefined,
    paidBefore: range?.toInstant ? new Date(range.toInstant) : undefined,
    studentIds,
    // MEBBİS takibi personelindir: veli ve öğrencide süzgeç bilgi sızdırmasın diye yok sayılır.
    mebbisPending: query.mebbis === 'pending' && studentIds === null,
  })
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
