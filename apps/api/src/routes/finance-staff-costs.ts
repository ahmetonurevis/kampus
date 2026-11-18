import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  STAFF_COST_ROLES,
  staffCostAllocationCancelSchema,
  staffCostAllocationInputSchema,
} from '@kampus/school-core/lib/finance-staff-costs.ts'

import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  cancelStaffCostAllocationCommand,
  createStaffCostAllocationCommand,
  getStaffCostAllocationsFor,
  listStaffCostStaffFor,
  staffCostCsvFor,
  staffCostReportFor,
} from '../services/finance-staff-costs.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  allocationCancelResponse,
  allocationParams,
  allocationResponse,
  staffCostQuery,
  staffCostResponse,
  staffDetailResponse,
  staffListQuery,
  staffListResponse,
  staffParams,
} from './finance-staff-costs.schemas.ts'

/**
 * Personel maliyet ataması ve tahmini personel maliyeti raporu uçları (docs/domain/finans.md
 * DOM-FIN-104; ON-204). Modül `finance`; okuma ve yazma yalnız yönetici (K-334). Rapor ücret
 * içerdiği için her okuması denetime düşer; CSV taze oturum ister. Sıra: 401 → 403 modül → 403 rol
 * → `If-Match` → 400 → işlem.
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-334). Modül `finance`; kapalıysa 403 `module_disabled`.'
const ALLOCATIONS_URL = '/api/v1/finance/staff-cost-allocations'
const STAFF_URL = '/api/v1/finance/staff-cost-staff'
const REPORT_URL = '/api/v1/finance/staff-costs'
const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')
const CSV_PER_MINUTE = 10
const READS_PER_MINUTE = 300

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceStaffCostRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(STAFF_COST_ROLES),
  ]
  const freshForCsv: preValidationAsyncHookHandler = async function (request, reply) {
    if (wantsCsv(request)) await app.requireFreshSession.call(app, request, reply)
  }
  const tags = ['finance-staff-costs']

  typed.get(
    REPORT_URL,
    {
      config: {
        rateLimit: {
          max: (request: FastifyRequest) => (wantsCsv(request) ? CSV_PER_MINUTE : READS_PER_MINUTE),
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            wantsCsv(request)
              ? `staff-costs-csv:${request.auth?.userId ?? request.ip}`
              : request.ip,
        },
      },
      preValidation: [...guarded, freshForCsv],
      schema: {
        operationId: 'getFinanceStaffCosts',
        tags,
        summary: 'Tahmini personel maliyeti (maliyet merkezine göre)',
        description: `\`from\`–\`to\` ayları (en çok 12; varsayılan bu ay, Europe/Istanbul) için personelin tahmini işveren maliyeti maliyet merkezlerine dağıtılır (DOM-FIN-104). Bordro değildir: brüt (aylık brüt ana ücret, saatli ücret × atamadaki tahmini saat, ek ders ve nöbet × tahmini saat; yürürlükteki gün oranıyla), SGK işveren payı (prim indirimi düşülmüş) ve işsizlik işveren payı (matrah SGK tavanına kadar, ayın ilk günü geçerli bordro parametresiyle), yan haklar (olduğu gibi) ve toplam (K-333). Net tanımlı ana ücret ve saati girilmemiş saatli ücret dahil edilmez, \`warnings\` ve kişi satırındaki \`flags\` ile bildirilir. Ataması olmayan personel "Atanmamış" satırındadır. Personeli 5'ten az olan merkezin tutarları gizlenir (\`suppressed\`, K-77 deseni); \`people=true\` kişi satırlarını verir ve bastırmayı kaldırır. Her okuma \`finance.staff_cost.read\` denetimi yazar (tutar değil, alan adları; K-334). \`Accept: text/csv\` ile aynı rapor dosya iner (\`;\`, UTF-8 BOM, ondalık virgül, formül kaçışı): taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk, denetim \`finance.staff_cost.export\`. İlk bordro parametre setinden önceki ay 422 \`payroll_parameters_missing\`; \`to\` \`from\`'dan önce ya da dönem 12 aydan uzunsa 400. ${MANAGER}`,
        querystring: staffCostQuery,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur.
        response: { 200: staffCostResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const query = {
        from: request.query.from,
        to: request.query.to,
        people: request.query.people === 'true',
      }
      if (wantsCsv(request)) {
        const { csv, filename } = await staffCostCsvFor(ctx, query)
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      return { data: await staffCostReportFor(ctx, query) }
    },
  )

  typed.get(
    STAFF_URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listStaffCostStaff',
        tags,
        summary: 'Personel ve maliyet merkezi ataması',
        description: `Kurumun yönetici, öğretmen ve ön büro üyelikleri ada göre; her satırda \`month\` ayında (varsayılan bu ay) yürürlükteki atama (merkezler, paylar, tahmini saatler) ve iptal edilmemiş atama sayısı (K-332). Ücret tutarı taşımaz; okuma denetime düşmez. Pasif (ayrılan) personel de listelenir. ${MANAGER}`,
        querystring: staffListQuery,
        response: { 200: staffListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, month } = request.query
      const { items, total } = await listStaffCostStaffFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        month,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${STAFF_URL}/:membershipId`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffCostAllocations',
        tags,
        summary: 'Personelin maliyet merkezi atamaları',
        description: `İptal edilmemiş bütün atamalar başlangıç ayına göre; her atamanın son ayı sonraki atamadan hesaplanır, \`currentId\` bu ay yürürlükteki atamadır. Olmayan, başka kurumun ya da personel olmayan (öğrenci, veli) üyelik 404. ${MANAGER}`,
        params: staffParams,
        response: { 200: staffDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStaffCostAllocationsFor(contextOf(request), request.params.membershipId),
    }),
  )

  typed.post(
    ALLOCATIONS_URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStaffCostAllocation',
        tags,
        summary: 'Personeli maliyet merkezlerine ata',
        description: `Personelin \`startMonth\` ayından yürürlüğe giren ataması (K-332): 1–10 maliyet merkezi ve on binde bir pay (toplamı 10.000 = %100; aynı merkez iki kez 400), saatlik ya da ders saati ücretinin, ek dersin ve nöbetin tahmini aylık saati (0–300, isteğe bağlı). Atama personelin sonraki atamasının başlangıcına kadar sürer. Aynı ayda iptal edilmemiş atama varsa 409 \`staff_cost_allocation_exists\` (önce iptal edin). Olmayan üyelik 422 \`staff_cost_staff_not_found\`, öğrenci ya da veli 422 \`staff_cost_not_staff\`; pasif personele de yazılır (geçmiş aylar). Olmayan ya da başka kurumun merkezi 422 \`staff_cost_center_not_found\`, pasif merkez 422 \`staff_cost_center_inactive\`. Denetim kaydına alan adları yazılır. \`Idempotency-Key\` isteğe bağlı. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: staffCostAllocationInputSchema,
        response: { 201: allocationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStaffCostAllocationCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = allocationResponse.parse(sendBody(reply, result))
      reply.header('location', `${ALLOCATIONS_URL}/${body.data.id}`)
      return body
    },
  )

  typed.post(
    `${ALLOCATIONS_URL}/:allocationId/cancel`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelStaffCostAllocation',
        tags,
        summary: 'Atamayı iptal et',
        description: `Yanlış atama gerekçeyle (5–500 karakter) iptal edilir; atama düzeltilmez (K-332). Önceki atama iptal edilenin aylarını da kapsar hâle gelir; sonraki atamalar yerinde kalır. Gerekçe denetim kaydına yazılmaz. \`If-Match\` zorunlu. Başka kurumun ya da iptal edilmiş atama 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: allocationParams,
        body: staffCostAllocationCancelSchema,
        response: { 200: allocationCancelResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelStaffCostAllocationCommand(
        contextOf(request),
        request.params.allocationId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return allocationCancelResponse.parse(sendBody(reply, result))
    },
  )
}
