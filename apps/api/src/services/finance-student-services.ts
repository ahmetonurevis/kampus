import { randomUUID } from 'node:crypto'

import { requireAuthorized } from '@kampus/school-core/lib/authorize.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  planStudentServiceEnd,
  planStudentServiceSubscribe,
  quoteStudentServiceSchema,
  quoteStudentServiceSubscribe,
  studentServiceBalance,
  subscribeStudentServiceSchema,
  type PlannedStudentService,
  type StudentServiceClosure,
  type StudentServiceKind,
  type StudentServiceQuote,
  type StudentServiceRow,
  type StudentServiceStatus,
} from '@kampus/school-core/lib/finance-student-services.ts'
import { financeStudentIds } from '@kampus/school-core/lib/scope.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Database } from '../db/client.ts'
import {
  endStudentServiceRow,
  findStudentService,
  insertStudentService,
  invoiceIdsOf,
  invoiceLinesOf,
  listStudentServices,
  openStudentServicesOf,
  type StoredStudentService,
  type StudentServiceStoredLine,
} from '../db/finance-student-services.ts'
import { allocatedForInvoices } from '../db/payments.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { environment, type CommandOptions } from './commands.ts'
import { loadEffectiveTariff } from './fee-tariffs.ts'
import {
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
  FINANCE_TABLE_STORES,
} from './operation-runner.ts'
import { studentFinanceScope } from './payments.ts'
import { assertReadable, readScope } from './read-scope.ts'

/**
 * Ek hizmet aboneliği servisi (docs/domain/finans.md DOM-FIN-003; ON-087). Kural core
 * `lib/finance-student-services.ts`'tedir. Abonelik, taksit ve denetim kaydı tek transaction'dadır.
 * Okuma yüzeyi (`listStudentServicesFor`, `getStudentServiceFor`) ve ayrılış kapanışı
 * (`applyStudentServiceClosures`) başka modülün de çağıracağı kadar dardır: bağlam alır, görünüm
 * döner. Taksit öğrencinin sözleşmesine eklenmez; `contract_id` yalnız kaynak bilgisidir.
 */

const SPEC = OPERATION_COMMANDS['studentService.manage']
const STAFF_ROLES: ReadonlySet<string> = new Set(['yonetici', 'onburo'])

export interface StudentServiceInvoiceView {
  id: string
  installment: number
  amountCents: number
  dueDate: string
  paidCents: number
  cancelled: boolean
}

export interface StudentServiceView extends StoredStudentService {
  billedCents: number
  paidCents: number
  openCents: number
  refundDecisionRequired: boolean
  invoices: StudentServiceInvoiceView[]
}

async function viewsOf(
  db: Database,
  institutionId: string,
  rows: readonly StoredStudentService[],
): Promise<StudentServiceView[]> {
  const lines = await invoiceLinesOf(
    db,
    institutionId,
    rows.map((row) => row.id),
  )
  const allocated = await allocatedForInvoices(
    db,
    institutionId,
    [...lines.values()].flat().map((line) => line.id),
  )
  const paidOf = (line: StudentServiceStoredLine) =>
    line.paidAt ? line.amount : (allocated.get(line.id) ?? 0)
  return rows.map((row) => {
    const own = lines.get(row.id) ?? []
    return {
      ...row,
      ...studentServiceBalance(row, own, allocated),
      invoices: own.map((line) => ({
        id: line.id,
        installment: line.installment,
        amountCents: line.amount,
        dueDate: line.dueDate,
        paidCents: line.cancelled ? 0 : paidOf(line),
        cancelled: line.cancelled,
      })),
    }
  })
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
    entityType: 'student_services',
    entityId: id,
    changes: { fields: [...fields] },
    createdAt: ctx.now,
  })
}

/**
 * Abonelik listesi (DOM-FIN-052): yönetici ve ön büro kurumun bütününü, veli velayetli ve kısıtsız
 * bağlı çocuğunu ve ödeyicisi olduğu öğrenciyi, öğrenci kendisini görür. Kapsam dışı `studentId`
 * boş liste döner; varlık sızmaz.
 */
export async function listStudentServicesFor(
  ctx: ServiceContext,
  query: {
    studentId?: string | undefined
    kind?: StudentServiceKind | undefined
    academicYear?: number | undefined
    status?: StudentServiceStatus | undefined
    page: number
    pageSize: number
  },
): Promise<{ items: StudentServiceView[]; total: number }> {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'invoices')
  const { items, total } = await listStudentServices(ctx.db, ctx.institutionId, {
    ...query,
    ...(STAFF_ROLES.has(ctx.actor.role) ? {} : { studentIds: [...financeStudentIds(scope)] }),
  })
  return { items: await viewsOf(ctx.db, ctx.institutionId, items), total }
}

/** Tek abonelik; kapsam dışı, olmayan ya da başka kurumun kaydı aynı 404'tür. */
export async function getStudentServiceFor(
  ctx: ServiceContext,
  id: string,
): Promise<StudentServiceView> {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'invoices')
  const row = await findStudentService(ctx.db, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  if (!STAFF_ROLES.has(ctx.actor.role) && !financeStudentIds(scope).has(row.studentId))
    throw new NotFoundError()
  const [view] = await viewsOf(ctx.db, ctx.institutionId, [row])
  if (view === undefined) throw new NotFoundError()
  return view
}

async function reload(tx: Database, ctx: ServiceContext, id: string): Promise<StudentServiceView> {
  const row = await findStudentService(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  const [view] = await viewsOf(tx, ctx.institutionId, [row])
  if (view === undefined) throw new NotFoundError()
  return view
}

/** Yenilemenin çift borç denetimi: öğrencinin o yılın açık abonelik türleri (DOM-FIN-003). */
export async function openServiceKindsOfYear(
  tx: Database,
  ctx: ServiceContext,
  studentId: string,
  academicYear: number,
): Promise<string[]> {
  const open = await openStudentServicesOf(tx, ctx.institutionId, studentId)
  return open.filter((row) => row.academicYear === academicYear).map((row) => row.kind)
}

/**
 * Yazmadan önizleme (DOM-FIN-003, K-17): önerilen birim tutar ve açılacak taksitler. Öğrencinin
 * düzeyi ve tarifenin önceki yıldan taşınması sunucudadır; form aynı kuralı ikinci kez yazmaz.
 */
export function quoteStudentServiceFor(
  ctx: ServiceContext,
  input: unknown,
): Promise<StudentServiceQuote & { tariffCarriedOverFromYear: number | null }> {
  const data = quoteStudentServiceSchema.parse(input)
  return runReadOnly(ctx, {
    action: 'studentService.quote',
    collections: SPEC.collections,
    stores: FINANCE_TABLE_STORES,
    loadScope: {
      invoices: { ids: [] },
      contracts: studentFinanceScope(data.studentId),
    },
    load: async (tx) => {
      const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
      const effective = await loadEffectiveTariff(tx, ctx, data.academicYear, institutionType)
      const open = await openStudentServicesOf(tx, ctx.institutionId, data.studentId)
      return {
        scalars,
        run: (state, { now }) => {
          requireAuthorized(actor, 'studentService.manage', {}, state, { now, institutionType })
          return {
            ...quoteStudentServiceSubscribe(state, data, {
              institutionType,
              tariff: effective?.tariff ?? null,
              openKinds: open.map((row) => row.kind),
            }),
            tariffCarriedOverFromYear: effective?.carriedOverFromYear ?? null,
          }
        },
      }
    },
  })
}

/**
 * Yazılma (DOM-FIN-002, -003): ücret kurum kilidi altında yayımlı tarifeden hesaplanır, personel
 * tarifenin altına düzeltebilir (K-17); taksit ve abonelik aynı transaction'dadır. 201; yanıt tarife
 * önceki yıldan geldiyse kaynak yılı da söyler.
 */
export function subscribeStudentServiceCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const data = subscribeStudentServiceSchema.parse(input)
  let result: StudentServiceView | undefined
  let carriedOverFromYear: number | null = null
  return runCommand(
    ctx,
    {
      action: 'studentService.subscribe',
      collections: SPEC.collections,
      stores: FINANCE_TABLE_STORES,
      loadScope: {
        invoices: studentFinanceScope(data.studentId),
        contracts: studentFinanceScope(data.studentId),
      },
      entity: { type: 'student_services', id },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
        const effective = await loadEffectiveTariff(tx, ctx, data.academicYear, institutionType)
        carriedOverFromYear = effective?.carriedOverFromYear ?? null
        const open = await openStudentServicesOf(tx, ctx.institutionId, data.studentId)
        return {
          scalars,
          run: (state, { now, makeId }): PlannedStudentService => {
            requireAuthorized(actor, 'studentService.manage', {}, state, { now, institutionType })
            return planStudentServiceSubscribe(state, input, {
              institutionType,
              tariff: effective?.tariff ?? null,
              openKinds: open.map((row) => row.kind),
              makeId,
              now,
            })
          },
        }
      },
      after: async (tx, plan) => {
        await insertStudentService(tx, ctx.institutionId, {
          id,
          ...plan,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await audit(tx, ctx, 'studentService.subscribe', id, [
          'kind',
          'academicYear',
          'tariffId',
          'amountCents',
          'startDate',
          'endDate',
          'contractId',
        ])
        // Elle düzeltme ayrı satırdır: denetim alan adı tutar, tutarın kendisini tutmaz (K-17).
        if (plan.amountCents !== plan.tariffAmountCents)
          await audit(tx, ctx, 'studentService.amountAdjust', id, ['amountCents'])
        result = await reload(tx, ctx, id)
      },
    },
    () => {
      if (result === undefined) throw new Error('student service was not written')
      return {
        statusCode: 201,
        body: { data: { ...result, tariffCarriedOverFromYear: carriedOverFromYear } },
      }
    },
    idempotency,
  )
}

/** Kapanışları aynı transaction'da yazar; ayrılış ve dönem içi çıkış aynı yolu kullanır. */
export async function applyStudentServiceClosures(
  tx: Database,
  ctx: ServiceContext,
  closures: readonly StudentServiceClosure[],
  reason: 'request' | 'withdrawal',
  expectedVersion?: number,
): Promise<void> {
  for (const closure of closures) {
    const saved = await endStudentServiceRow(tx, ctx.institutionId, {
      id: closure.serviceId,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      endedDate: closure.endedDate,
      endReason: reason,
      endedByUserId: ctx.actor.userId,
      now: ctx.now,
    })
    if (!saved) throw new ConflictError()
    await audit(tx, ctx, 'studentService.end', closure.serviceId, [
      'status',
      'endedDate',
      'endReason',
    ])
  }
}

/**
 * Dönem içi çıkış (DOM-FIN-003, -040): ileri vadeli ödenmemiş taksit iptal edilir. Ödenen tutar için
 * iade yazılmaz; yanıttaki `refundDecisionRequired` kullanılmamış dönem için kararı yöneticiye bırakır.
 */
export async function endStudentServiceCommand(
  ctx: ServiceContext,
  serviceId: string,
  input: unknown,
  options: Pick<CommandOptions, 'idempotency'> & { expectedVersion: number },
): Promise<CommandResponse> {
  const owner = await findStudentService(ctx.db, ctx.institutionId, serviceId)
  let result: StudentServiceView | undefined
  return runCommand(
    ctx,
    {
      action: 'studentService.end',
      collections: SPEC.collections,
      stores: FINANCE_TABLE_STORES,
      loadScope: {
        invoices: owner === null ? { ids: [] } : studentFinanceScope(owner.studentId),
        contracts: { ids: [] },
      },
      entity: { type: 'student_services', id: serviceId },
      load: async (tx) => {
        const { actor, institutionType, scalars } = await environment(tx, ctx, SPEC)
        const row = await findStudentService(tx, ctx.institutionId, serviceId)
        if (row === null) throw new NotFoundError()
        if (row.version !== options.expectedVersion) throw new ConflictError()
        const invoiceIds = (await invoiceIdsOf(tx, ctx.institutionId, [serviceId])).get(serviceId)
        const service: StudentServiceRow = { ...row, invoiceIds: invoiceIds ?? [] }
        const allocated = await allocatedForInvoices(tx, ctx.institutionId, service.invoiceIds)
        return {
          scalars,
          run: (state, { now }) => {
            requireAuthorized(actor, 'studentService.manage', {}, state, { now, institutionType })
            return planStudentServiceEnd(state, service, input, {
              allocated,
              today: dayKey(ctx.now),
            })
          },
        }
      },
      after: async (tx, closure) => {
        await applyStudentServiceClosures(tx, ctx, [closure], 'request', options.expectedVersion)
        result = await reload(tx, ctx, serviceId)
      },
    },
    () => {
      if (result === undefined) throw new Error('student service was not ended')
      return { statusCode: 200, body: { data: { ...result, tariffCarriedOverFromYear: null } } }
    },
    options.idempotency,
  )
}
