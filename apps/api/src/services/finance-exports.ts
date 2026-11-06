import { z } from 'zod'

import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  assertFinancePeriod,
  defaultOverviewPeriod,
  financeOverview,
  financeSummary,
  financeTotals,
  invoiceLines,
  invoicesCsv,
  paymentLines,
  paymentsCsv,
  refundLines,
  refundsCsv,
  studentBalance,
  studentDirectory,
  type FinanceExportKind,
  type FinanceOverview,
  type FinanceOverviewQuery,
  type FinancePeriod,
  type FinanceSummary,
  type FinanceTotals,
  type StudentBalance,
} from '@kampus/school-core/lib/finance-export.ts'
import {
  profiledInvoicesCsv,
  profiledPaymentsCsv,
  profiledRefundsCsv,
  setFinanceExportProfileSchema,
} from '@kampus/school-core/lib/finance-export-profile.ts'
import {
  studentStatement,
  type StudentStatement,
} from '@kampus/school-core/lib/finance-statement.ts'
import { financeStudentIds } from '@kampus/school-core/lib/scope.ts'

import {
  allocatedForInvoices,
  allocatedTotals,
  paymentsOfStudent,
  paymentsTouchingPeriod,
} from '../db/payments.ts'
import { loadFinanceRecords } from '../db/finance-mirror-store.ts'
import {
  loadFinanceExportProfile,
  saveFinanceExportProfile,
  type StoredFinanceExportProfile,
} from '../db/finance-export-profiles.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { refundsPaidInPeriod } from '../db/withdrawals.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import {
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
  FINANCE_TABLE_STORES,
} from './operation-runner.ts'
import { assertReadable, readScope } from './read-scope.ts'

/**
 * Muhasebe dışa aktarımı (IST-111). Toplam ve dosya aynı görüntüden, aynı satırlardan üretilir.
 * Satır ve tutar loglanmaz; denetime dönem ve tür düşer (DOM-YTK-053, toplu dışa aktarım).
 */

const DAY = 86_400_000
/** İstanbul gününün iki yanını da kapsar; kesin gün süzmesi core `dayKey` ile yapılır. */
const instant = (day: string, offsetDays: number) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + offsetDays * DAY)

function linesOf(ctx: ServiceContext, period: FinancePeriod) {
  return runReadOnly(ctx, {
    action: 'finance.export',
    collections: ['students', 'invoices'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => {
      const [payments, refunds, allocated] = [
        await paymentsTouchingPeriod(
          tx,
          ctx.institutionId,
          instant(period.from, -1),
          instant(period.to, 2),
        ),
        await refundsPaidInPeriod(tx, ctx.institutionId, period),
        await allocatedTotals(tx, ctx.institutionId),
      ]
      return {
        run: (state) => {
          // İşlem içinde denetlenir: DomainError yalnız burada 422'ye çevrilir.
          assertFinancePeriod(period)
          const students = studentDirectory(state.students)
          return {
            payments: paymentLines(payments, students, period),
            refunds: refundLines(refunds, students, period),
            invoices: invoiceLines(state.invoices, allocated, students, period),
          }
        },
      }
    },
  })
}

/** Finans ekranı kartları: kurum geneli, kısmi ödemeler dahil (DOM-FIN-030). */
export function financeTotalsFor(ctx: ServiceContext): Promise<FinanceTotals> {
  return runReadOnly(ctx, {
    action: 'finance.totals',
    collections: ['invoices'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => {
      const allocated = await allocatedTotals(tx, ctx.institutionId)
      return { run: (state) => financeTotals(state.invoices, allocated, dayKey(ctx.now)) }
    },
  })
}

/**
 * Finans özeti (`GET /finance/overview`; IST-116, IST-121): dönemin tahsilatı ve ay kırılımı, bugünkü
 * açık ve gecikmiş tutar, gecikmiş borcu olan öğrenciler. Dönem verilmezse son altı takvim ayı.
 */
export function financeOverviewFor(
  ctx: ServiceContext,
  query: FinanceOverviewQuery,
): Promise<FinanceOverview> {
  const today = dayKey(ctx.now)
  const period =
    query.from !== undefined && query.to !== undefined
      ? { from: query.from, to: query.to }
      : defaultOverviewPeriod(today)
  return runReadOnly(ctx, {
    action: 'finance.overview',
    collections: ['invoices'],
    stores: FINANCE_TABLE_STORES,
    load: async (tx) => {
      const [payments, allocated] = [
        await paymentsTouchingPeriod(
          tx,
          ctx.institutionId,
          instant(period.from, -1),
          instant(period.to, 2),
        ),
        await allocatedTotals(tx, ctx.institutionId),
      ]
      return {
        run: (state) => {
          // İşlem içinde denetlenir: DomainError yalnız burada 422'ye çevrilir.
          assertFinancePeriod(period)
          return financeOverview({
            invoices: state.invoices,
            allocated,
            payments,
            period,
            today,
          })
        },
      }
    },
  })
}

const balanceInvoice = z.object({
  id: z.string(),
  amount: z.number().int(),
  paidAt: z.string().nullable().optional(),
  dueDate: z.string(),
  method: z.string().nullable().optional(),
})

/**
 * Öğrencinin bakiyesi (`GET /finance/students/:id/balance`). Kapsam core'dan gelir: yönetici ve ön
 * büro kurumun öğrencisini, veli velayetli ve kısıtsız bağlı çocuğunu ve velayeti olmasa da
 * ödeyicisi olduğu öğrenciyi (`financeStudentIds`; K-04, DOM-ILT-074), öğrenci kendisini okur
 * (DOM-FIN-052, DOM-ILT-070). Kapsam dışı, olmayan ya da başka kurumun öğrencisi aynı 404'tür.
 */
export async function studentBalanceFor(
  ctx: ServiceContext,
  studentId: string,
): Promise<StudentBalance> {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'invoices')
  if (!financeStudentIds(scope).has(studentId)) throw new NotFoundError()
  const rows = await loadFinanceRecords(ctx.db, ctx.institutionId, 'invoices', {
    match: [{ kind: 'equals', field: 'studentId', values: [studentId] }],
  })
  const invoices = rows.map((row) => {
    const invoice = balanceInvoice.parse({ ...row.data, id: row.id })
    return { ...invoice, paidAt: invoice.paidAt ?? null }
  })
  const allocated = await allocatedForInvoices(
    ctx.db,
    ctx.institutionId,
    invoices.map((invoice) => invoice.id),
  )
  return studentBalance(studentId, invoices, allocated, dayKey(ctx.now))
}

const statementInvoice = balanceInvoice.extend({ installment: z.number().int() })

/**
 * Cari ekstre (`GET /finance/students/:id/statement`, IST-107). Kapsam bakiyeyle aynıdır; hesap
 * core `studentStatement`'tadır. İptal gerekçesi personel alanı olduğu için satıra girmez.
 */
export async function studentStatementFor(
  ctx: ServiceContext,
  studentId: string,
): Promise<StudentStatement> {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'invoices')
  if (!financeStudentIds(scope).has(studentId)) throw new NotFoundError()
  const rows = await loadFinanceRecords(ctx.db, ctx.institutionId, 'invoices', {
    match: [{ kind: 'equals', field: 'studentId', values: [studentId] }],
  })
  const invoices = rows.map((row) => {
    const invoice = statementInvoice.parse({ ...row.data, id: row.id })
    return { ...invoice, paidAt: invoice.paidAt ?? null }
  })
  const stored = await paymentsOfStudent(ctx.db, ctx.institutionId, studentId)
  const payments = stored.map((payment) => ({
    ...payment,
    paidAt: payment.paidAt.toISOString(),
    reversedAt: payment.reversedAt?.toISOString() ?? null,
  }))
  return studentStatement(studentId, invoices, payments, dayKey(ctx.now))
}

export async function financeSummaryFor(
  ctx: ServiceContext,
  period: FinancePeriod,
): Promise<FinanceSummary> {
  const lines = await linesOf(ctx, period)
  return financeSummary(lines.payments, lines.refunds, lines.invoices)
}

export async function financeExportFor(
  ctx: ServiceContext,
  query: FinancePeriod & { kind: FinanceExportKind },
): Promise<string> {
  const lines = await linesOf(ctx, query)
  const { profile } = await loadFinanceExportProfile(ctx.db, ctx.institutionId)
  const csv =
    query.kind === 'payments'
      ? profile
        ? profiledPaymentsCsv(lines.payments, profile)
        : paymentsCsv(lines.payments)
      : query.kind === 'refunds'
        ? profile
          ? profiledRefundsCsv(lines.refunds, profile)
          : refundsCsv(lines.refunds)
        : profile
          ? profiledInvoicesCsv(lines.invoices, profile)
          : invoicesCsv(lines.invoices)
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.export',
    entityType: 'finance_export',
    entityId: `${query.kind}:${query.from}:${query.to}`,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return csv
}

export function financeExportProfileFor(ctx: ServiceContext): Promise<StoredFinanceExportProfile> {
  return loadFinanceExportProfile(ctx.db, ctx.institutionId)
}

/**
 * Aktarım profilini yazar (ON-024). Denetime yalnız alan adı düşer; sabit değerler hesap kodu
 * olabilir. Profil dosya satırlarını ve toplamları değiştirmez.
 */
export function setFinanceExportProfile(
  ctx: ServiceContext,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const { profile } = setFinanceExportProfileSchema.parse(input)
  let result: StoredFinanceExportProfile | undefined
  return runCommand(
    ctx,
    {
      action: 'finance.export_profile',
      collections: [],
      entity: { type: 'finance_export_profiles', id: ctx.institutionId },
      load: async (tx) => {
        const row = await loadFinanceExportProfile(tx, ctx.institutionId)
        if (row.version !== expectedVersion) throw new ConflictError()
        return { run: () => profile }
      },
      after: async (tx) => {
        const saved = await saveFinanceExportProfile(tx, ctx.institutionId, {
          profile,
          expectedVersion,
          now: ctx.now,
        })
        if (saved === null) throw new ConflictError()
        await tx.insert(auditLog).values({
          institutionId: ctx.institutionId,
          actorUserId: ctx.actor.userId,
          actorRole: ctx.actor.role,
          action: 'finance.export_profile',
          entityType: 'finance_export_profiles',
          entityId: ctx.institutionId,
          changes: { fields: ['profile'] },
          createdAt: ctx.now,
        })
        result = saved
      },
    },
    () => {
      if (result === undefined) throw new Error('export profile was not written')
      return { statusCode: 200, body: { data: result } }
    },
    idempotency,
  )
}
