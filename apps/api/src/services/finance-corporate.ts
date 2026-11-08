import { randomUUID } from 'node:crypto'

import {
  assertCustomerArchivable,
  assertTaxNumberFree,
  billableLines,
  corporateAttendanceCsv,
  corporateAttendanceRow,
  corporateCustomerSchema,
  corporateInvoiceCsv,
  corporateInvoiceNumber,
  corporateInvoiceSchema,
  corporateLineStatus,
  corporateReportTotals,
  linkCorporateEmployeeSchema,
  linkCovers,
  planCorporateInvoice,
  planCorporateInvoiceCancel,
  planEmployeeEnd,
  planEmployeeLink,
  updateCorporateCustomerSchema,
  type BillableLine,
  type CorporateEmployeeReport,
} from '@kampus/school-core/lib/finance-corporate.ts'
import { assertFinancePeriod, type FinancePeriod } from '@kampus/school-core/lib/finance-export.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { listProgressionDecisions } from '../db/cefr.ts'
import {
  archiveCorporateCustomer,
  cancelCorporateInvoice,
  countActiveEmployees,
  endCustomerLink,
  findCorporateCustomer,
  findCorporateInvoice,
  findCustomerLink,
  insertCorporateCustomer,
  insertCorporateInvoice,
  insertCustomerLink,
  isTaxNumberTaken,
  listCorporateCustomers,
  listCorporateInvoices,
  listCustomerLinks,
  loadBilledKeys,
  loadCorporateInvoiceLines,
  loadCustomerLinks,
  loadEnrollmentsOfStudents,
  loadInvoiceCandidates,
  loadInvoiceStates,
  loadStudentLinks,
  nextInvoiceSequence,
  updateCorporateCustomer,
  type StoredCorporateCustomer,
} from '../db/finance-corporate.ts'
import { allocatedForInvoices } from '../db/payments.ts'
import { listLessonHourAttendances } from '../db/progression.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Kurumsal müşteri, çalışan bağı, toplu fatura ve katılım özeti (IST-089; docs/domain/finans.md
 * DOM-FIN-060, dil-okulu.md DOM-DIL-093). Kural core `lib/finance-corporate.ts`'tedir; servis kurum
 * kilidi altında yükler, core'a karar verdirir ve aynı transaction'da yazar. Rol ve kurum türü
 * denetimi rotadadır (yönetici ve ön büro, yalnız dil okulu).
 */

const CUSTOMER_ENTITY = 'corporate_customers'
const LINK_ENTITY = 'corporate_customer_employees'
const INVOICE_ENTITY = 'corporate_invoices'

async function studentNames(db: Database, institutionId: string, ids: readonly string[]) {
  const rows = await loadRecordsByIds(db, institutionId, 'students', [...new Set(ids)], {
    includeArchived: true,
  })
  return new Map(
    rows.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : null]),
  )
}

async function customerOf(
  db: Database,
  ctx: ServiceContext,
  id: string,
): Promise<StoredCorporateCustomer> {
  const found = await findCorporateCustomer(db, ctx.institutionId, id)
  if (found === null) throw new NotFoundError()
  return found
}

/** Dönem yüklemeden önce denetlenir; core hatası 422'ye çevrilir. */
function checkedPeriod(period: FinancePeriod): FinancePeriod {
  try {
    assertFinancePeriod(period)
  } catch (error) {
    throw mapOperationError(error)
  }
  return period
}

// --- Müşteri -------------------------------------------------------------------------------------

export const listCorporateCustomersFor = (
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) => listCorporateCustomers(ctx.db, ctx.institutionId, query)

export async function getCorporateCustomerFor(ctx: ServiceContext, id: string) {
  const customer = await customerOf(ctx.db, ctx, id)
  return {
    ...customer,
    activeEmployeeCount: await countActiveEmployees(ctx.db, ctx.institutionId, id),
  }
}

async function customerBody(tx: Database, ctx: ServiceContext, id: string) {
  const customer = await customerOf(tx, ctx, id)
  return {
    data: {
      ...customer,
      activeEmployeeCount: await countActiveEmployees(tx, ctx.institutionId, id),
    },
  }
}

/** Kurumsal müşteri kaydı (DOM-FIN-060); vergi numarası etkin müşterilerde tekil. 201. */
export function createCorporateCustomerCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: CUSTOMER_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'corporate_customer.create',
      collections: [],
      entity,
      load: async (tx) => {
        const data = corporateCustomerSchema.parse(input)
        const taken = await isTaxNumberTaken(tx, ctx.institutionId, data.taxNumber)
        return {
          run: () => {
            assertTaxNumberFree(taken)
            return data
          },
        }
      },
      after: async (tx, data) => {
        await insertCorporateCustomer(tx, ctx.institutionId, { ...data, id, now: ctx.now })
        await auditWork(tx, ctx, 'corporate_customer.create', entity, Object.keys(data))
        body = await customerBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Düzeltme kesilmiş toplu faturayı değiştirmez (fatura kopya taşır). */
export function updateCorporateCustomerCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: CUSTOMER_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'corporate_customer.update',
      collections: [],
      entity,
      load: async (tx) => {
        const changes = updateCorporateCustomerSchema.parse(input)
        const current = await customerOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const taken =
          changes.taxNumber !== undefined &&
          (await isTaxNumberTaken(tx, ctx.institutionId, changes.taxNumber, id))
        return {
          run: () => {
            assertTaxNumberFree(taken)
            return changes
          },
        }
      },
      after: async (tx, changes) => {
        const saved = await updateCorporateCustomer(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'corporate_customer.update', entity, Object.keys(changes))
        body = await customerBody(tx, ctx, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Etkin çalışanı olan şirket arşivlenemez; kesilmiş faturalar kalır. */
export function archiveCorporateCustomerCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: CUSTOMER_ENTITY, id }
  return runCommand(
    ctx,
    {
      action: 'corporate_customer.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await customerOf(tx, ctx, id)
        if (current.version !== expectedVersion) throw new ConflictError()
        const active = await countActiveEmployees(tx, ctx.institutionId, id)
        return { run: () => assertCustomerArchivable(active) }
      },
      after: async (tx) => {
        const saved = await archiveCorporateCustomer(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'corporate_customer.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id } } }),
    idempotency,
  )
}

// --- Çalışan bağı --------------------------------------------------------------------------------

export async function listCorporateEmployeesFor(
  ctx: ServiceContext,
  customerId: string,
  query: { page: number; pageSize: number; status?: 'active' | 'ended' | undefined },
) {
  await customerOf(ctx.db, ctx, customerId)
  const { items, total } = await listCustomerLinks(ctx.db, ctx.institutionId, customerId, query)
  const names = await studentNames(
    ctx.db,
    ctx.institutionId,
    items.map((item) => item.studentId),
  )
  return {
    items: items.map((item) => ({ ...item, studentName: names.get(item.studentId) ?? null })),
    total,
  }
}

async function linkBody(tx: Database, ctx: ServiceContext, customerId: string, linkId: string) {
  const link = await findCustomerLink(tx, ctx.institutionId, customerId, linkId)
  if (link === null) throw new NotFoundError()
  const names = await studentNames(tx, ctx.institutionId, [link.studentId])
  return { data: { ...link, studentName: names.get(link.studentId) ?? null } }
}

/**
 * Kursiyeri şirkete bağlar (DOM-FIN-060). İşveren raporu aydınlatması onaylanmadan bağ kurulmaz
 * (DOM-DIL-093); kursiyerin tek etkin bağı olur. 201.
 */
export function linkCorporateEmployeeCommand(
  ctx: ServiceContext,
  customerId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: LINK_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'corporate_employee.link',
      collections: [],
      entity,
      load: async (tx) => {
        await customerOf(tx, ctx, customerId)
        const { studentId } = linkCorporateEmployeeSchema.parse(input)
        const [students, links] = await Promise.all([
          loadRecordsByIds(tx, ctx.institutionId, 'students', [studentId]),
          loadStudentLinks(tx, ctx.institutionId, studentId),
        ])
        return {
          run: () => planEmployeeLink(input, { studentExists: students.length === 1, links }),
        }
      },
      after: async (tx, plan) => {
        await insertCustomerLink(
          tx,
          ctx.institutionId,
          { id, customerId, ...plan },
          { userId: ctx.actor.userId, now: ctx.now },
        )
        await auditWork(tx, ctx, 'corporate_employee.link', entity, [
          'customerId',
          'studentId',
          'startsOn',
          'noticeConfirmedAt',
        ])
        body = await linkBody(tx, ctx, customerId, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Bağı bitiş günüyle kapatır; bağ silinmez, geçmiş dönemin faturası için kalır. */
export function endCorporateEmployeeCommand(
  ctx: ServiceContext,
  customerId: string,
  linkId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: LINK_ENTITY, id: linkId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'corporate_employee.end',
      collections: [],
      entity,
      load: async (tx) => {
        await customerOf(tx, ctx, customerId)
        const link = await findCustomerLink(tx, ctx.institutionId, customerId, linkId)
        if (link === null) throw new NotFoundError()
        if (link.version !== expectedVersion) throw new ConflictError()
        return { run: () => planEmployeeEnd(link, input) }
      },
      after: async (tx, plan) => {
        const saved = await endCustomerLink(tx, ctx.institutionId, {
          id: linkId,
          expectedVersion,
          endsOn: plan.endsOn,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'corporate_employee.end', entity, ['endsOn'])
        body = await linkBody(tx, ctx, customerId, linkId)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Toplu fatura --------------------------------------------------------------------------------

/** Kurum kilidi altında da aynı kalan yükleme: bağlar, adaylar ve faturalanmış satırlar. */
async function billingInputs(
  db: Database,
  ctx: ServiceContext,
  customerId: string,
  period: FinancePeriod,
) {
  const links = await loadCustomerLinks(db, ctx.institutionId, customerId)
  const studentIds = [...new Set(links.map((link) => link.studentId))]
  const [invoices, billed] = await Promise.all([
    loadInvoiceCandidates(db, ctx.institutionId, studentIds, period),
    loadBilledKeys(db, ctx.institutionId, studentIds),
  ])
  return { links, invoices, billed }
}

async function linesWithNames(db: Database, ctx: ServiceContext, lines: readonly BillableLine[]) {
  const names = await studentNames(
    db,
    ctx.institutionId,
    lines.map((line) => line.studentId),
  )
  return lines.map((line) => ({
    invoiceId: line.id,
    studentId: line.studentId,
    studentName: names.get(line.studentId) ?? null,
    installment: line.installment,
    feeKind: line.feeKind,
    dueDate: line.dueDate,
    amountCents: line.amountCents,
  }))
}

/** Toplu fatura önizlemesi: hiçbir kayıt yazmaz, kesimle aynı seçimi yapar. */
export async function corporateBillableFor(
  ctx: ServiceContext,
  customerId: string,
  period: FinancePeriod,
) {
  checkedPeriod(period)
  await customerOf(ctx.db, ctx, customerId)
  const lines = billableLines({ ...(await billingInputs(ctx.db, ctx, customerId, period)), period })
  return {
    from: period.from,
    to: period.to,
    totalCents: lines.reduce((total, line) => total + line.amountCents, 0),
    lines: await linesWithNames(ctx.db, ctx, lines),
  }
}

/**
 * Toplu faturayı keser (DOM-FIN-060): seçim kurum kilidi altında yapılır, aynı taksit iki geçerli
 * faturaya girmez (core seçimi ve `corporate_invoice_lines_invoice_key`). `Idempotency-Key` aynı
 * isteği tekrarlar. 201.
 */
export function createCorporateInvoiceCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: INVOICE_ENTITY, id }
  const year = Number(dayKey(ctx.now).slice(0, 4))
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'corporate_invoice.create',
      collections: [],
      entity,
      load: async (tx) => {
        const data = corporateInvoiceSchema.parse(input)
        const period = { from: data.from, to: data.to }
        const customer = await customerOf(tx, ctx, data.customerId)
        const [inputs, sequence] = await Promise.all([
          billingInputs(tx, ctx, customer.id, period),
          nextInvoiceSequence(tx, ctx.institutionId, year),
        ])
        return {
          run: () => {
            const lines = billableLines({ ...inputs, period })
            const plan = planCorporateInvoice({ period, lines })
            return { ...plan, lines, period, customer, sequence }
          },
        }
      },
      after: async (tx, plan) => {
        await insertCorporateInvoice(tx, ctx.institutionId, {
          id,
          customer: plan.customer,
          number: corporateInvoiceNumber(year, plan.sequence),
          year,
          sequence: plan.sequence,
          period: plan.period,
          totalCents: plan.totalCents,
          lines: plan.lines,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'corporate_invoice.create', entity, [
          'customerId',
          'periodFrom',
          'periodTo',
          'totalCents',
          'lineCount',
        ])
        body = { data: await invoiceDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

export const listCorporateInvoicesFor = (
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    customerId?: string | undefined
    status?: 'issued' | 'cancelled' | undefined
  },
) => listCorporateInvoices(ctx.db, ctx.institutionId, query)

/** Fatura ve satırları; satırın ödeme durumu bugünkü taksitten hesaplanır, saklanmaz. */
async function invoiceDetail(db: Database, ctx: ServiceContext, id: string) {
  const invoice = await findCorporateInvoice(db, ctx.institutionId, id)
  if (invoice === null) throw new NotFoundError()
  const lines = await loadCorporateInvoiceLines(db, ctx.institutionId, id)
  const invoiceIds = lines.map((line) => line.invoiceId)
  const [states, allocated, names] = await Promise.all([
    loadInvoiceStates(db, ctx.institutionId, invoiceIds),
    allocatedForInvoices(db, ctx.institutionId, invoiceIds),
    studentNames(
      db,
      ctx.institutionId,
      lines.map((line) => line.studentId),
    ),
  ])
  return {
    ...invoice,
    lines: lines.map((line) => {
      const state = states.get(line.invoiceId) ?? { archived: true, paid: false }
      return {
        ...line,
        studentName: names.get(line.studentId) ?? null,
        status: corporateLineStatus({
          ...state,
          allocatedCents: allocated.get(line.invoiceId) ?? 0,
        }),
      }
    }),
  }
}

export const getCorporateInvoiceFor = (ctx: ServiceContext, id: string) =>
  invoiceDetail(ctx.db, ctx, id)

/** Toplu fatura dökümü CSV; şirket ve kursiyer adı taşıdığı için denetime yazılır. */
export async function corporateInvoiceCsvFor(ctx: ServiceContext, id: string) {
  const detail = await invoiceDetail(ctx.db, ctx, id)
  const csv = corporateInvoiceCsv(detail, detail.lines)
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.corporate_invoice_export',
    entityType: INVOICE_ENTITY,
    entityId: id,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return { number: detail.number, csv }
}

/** İptal yalnız yöneticide (rota); satırlar serbest kalır, numara boşta kalır. */
export function cancelCorporateInvoiceCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: INVOICE_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'corporate_invoice.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await findCorporateInvoice(tx, ctx.institutionId, id)
        if (current === null) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        return { run: () => planCorporateInvoiceCancel(current, input) }
      },
      after: async (tx, plan) => {
        const saved = await cancelCorporateInvoice(tx, ctx.institutionId, {
          id,
          expectedVersion,
          reason: plan.reason,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'corporate_invoice.cancel', entity, [
          'cancelledAt',
          'cancelReason',
        ])
        body = { data: await invoiceDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Katılım özeti -------------------------------------------------------------------------------

/**
 * Şirkete bugün etkin bağlı kursiyerlerin kur kayıtları (DOM-FIN-060, DOM-DIL-093, K-49): yalnız devam
 * saatleri, oran, devam şartı ve onaylı kur sonucu. Bağ bugünü kapsamalıdır (başlangıcı ya da bitişi
 * ileri tarihli olabilir); kur kaydı bağın içinde başlamalıdır ki bağdan önceki, kursiyerin kendi
 * ödediği kur işverene gitmesin. Gerekçe, puan ve özür bilgisi okunsa da satıra girmez.
 */
async function attendanceReport(ctx: ServiceContext, customerId: string) {
  const customer = await customerOf(ctx.db, ctx, customerId)
  const today = dayKey(ctx.now)
  const links = (await loadCustomerLinks(ctx.db, ctx.institutionId, customerId)).filter((link) =>
    linkCovers(link, today),
  )
  const linkOf = new Map(links.map((link) => [link.studentId, link]))
  const studentIds = links.map((link) => link.studentId)
  const enrollments = (
    await loadEnrollmentsOfStudents(ctx.db, ctx.institutionId, studentIds)
  ).filter((row) => {
    const link = linkOf.get(row.studentId)
    return link !== undefined && linkCovers(link, dayKey(row.joinedAt))
  })
  const enrollmentIds = enrollments.map((row) => row.enrollmentId)
  const [attendance, decisions, names] = await Promise.all([
    listLessonHourAttendances(ctx.db, ctx.institutionId, enrollmentIds),
    listProgressionDecisions(ctx.db, ctx.institutionId, { enrollmentIds }),
    studentNames(ctx.db, ctx.institutionId, studentIds),
  ])
  const employees: CorporateEmployeeReport[] = links
    .map((link) => ({
      studentId: link.studentId,
      studentName: names.get(link.studentId) ?? null,
      startsOn: link.startsOn,
      enrollments: enrollments
        .filter((row) => row.studentId === link.studentId)
        .map((row) =>
          corporateAttendanceRow({
            ...row,
            attendance: attendance.get(row.enrollmentId) ?? [],
            decisions: decisions
              .filter((decision) => decision.enrollmentId === row.enrollmentId)
              .map((decision) => ({
                outcome: decision.outcome,
                status: decision.status,
                decidedAt: decision.decidedAt,
              })),
          }),
        ),
    }))
    .sort((a, b) => (a.studentName ?? '').localeCompare(b.studentName ?? '', 'tr'))
  return {
    customerId: customer.id,
    customerName: customer.name,
    totals: corporateReportTotals(employees),
    employees,
  }
}

export const corporateAttendanceReportFor = attendanceReport

/** Katılım özeti CSV; kursiyer adı ve devam taşır, denetime yazılır. */
export async function corporateAttendanceCsvFor(ctx: ServiceContext, customerId: string) {
  const report = await attendanceReport(ctx, customerId)
  const csv = corporateAttendanceCsv(report.employees)
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.corporate_report_export',
    entityType: CUSTOMER_ENTITY,
    entityId: customerId,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return csv
}
