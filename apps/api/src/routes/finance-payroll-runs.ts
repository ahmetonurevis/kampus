import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  PAYROLL_CALC_ROLES,
  payrollRunSaveSchema,
  payrollTaxCarryoverInputSchema,
} from '@kampus/school-core/lib/finance-payroll-calc.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveTaxCarryoverCommand,
  createTaxCarryoverCommand,
  listTaxCarryoversFor,
  payrollCalculationCsvFor,
  payrollCalculationFor,
  payrollRunCsvFor,
  payrollRunFor,
  savePayrollRunCommand,
} from '../services/finance-payroll-runs.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  carryoverArchiveResponse,
  carryoverListQuery,
  carryoverListResponse,
  carryoverParams,
  carryoverResponse,
  payrollCalculationResponse,
  payrollMonthParams,
  payrollRunResponse,
  payrollRunSaveResponse,
} from './finance-payroll-runs.schemas.ts'

/**
 * Bordro hesabı uçları (docs/domain/finans.md DOM-FIN-115; ON-198). Kampüs bordroyu kendisi
 * hesaplar (ON-193, ADR 0011). Modül `finance`; yalnız yönetici (K-391). Önizleme, kayıtlı hesap ve
 * devir listesi ücret taşır: her okuma denetime düşer; CSV taze oturum ister, kullanıcı başına
 * 10/dk. Kaydetme `Idempotency-Key` ister; onaylı (kilitli) ayda 409.
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-391). Modül `finance`.'
const CALC_URL = '/api/v1/finance/payroll-calculations'
const RUN_URL = '/api/v1/finance/payroll-runs'
const CARRYOVER_URL = '/api/v1/finance/payroll-tax-carryovers'
const EXPORTS_PER_MINUTE = 10
const READS_PER_MINUTE = 300
const VERIFY =
  'Hesap mali müşavir doğrulaması bekler (M-75…M-77); resmî beyanname ve bildirge Kampüs dışında verilir.'

const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

function sendCsv(reply: FastifyReply, file: { csv: string; filename: string }) {
  return reply
    .type('text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${file.filename}"`)
    .serializer((payload: unknown) => String(payload))
    .send(`\uFEFF${file.csv}`)
}

export function registerFinancePayrollRunRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(PAYROLL_CALC_ROLES),
  ]
  const freshForCsv: preValidationAsyncHookHandler = async function (request, reply) {
    if (wantsCsv(request)) await app.requireFreshSession.call(app, request, reply)
  }
  const csvRateLimit = (prefix: string) => ({
    rateLimit: {
      max: (request: FastifyRequest) => (wantsCsv(request) ? EXPORTS_PER_MINUTE : READS_PER_MINUTE),
      timeWindow: '1 minute',
      hook: 'preHandler' as const,
      keyGenerator: (request: FastifyRequest) =>
        wantsCsv(request) ? `${prefix}:${request.auth?.userId ?? request.ip}` : request.ip,
    },
  })
  const tags = ['finance-payroll-runs']

  typed.get(
    `${CALC_URL}/:month`,
    {
      config: csvRateLimit('payroll-calculation-export'),
      preValidation: [...guarded, freshForCsv],
      schema: {
        operationId: 'getPayrollCalculation',
        tags,
        summary: 'Bordro ön hesabı (önizleme)',
        description: `Ayın canlı bordro hesabı (DOM-FIN-115; kaydedilmez): ayda ana ücret tanımı yürürlükte olan, o ay ek ders saati, aya aktarılan düzeltme ya da elle SGK satırı bulunan personel. Satır: prim günü (SGK hazırlık listesiyle aynı, DOM-FIN-107), brüt kalemleri (aylık brüt gün oranlı, ek ders saat × ücret — yalnız ek ders çizelgesi müdür onaylı ayda (DOM-FIN-120, K-423); onay bekleyen saat hesaba girmez, personelin satırı \`lesson_hours_unapproved\` uyarısı taşır ve \`lessonSheet\` çizelge durumunu ve bekleyen saat özetini verir —, nakdi yan hak; vergiye tabi işaretli olan GV ve DV matrahına da girer; ayni yan hak yalnız maliyete; düzeltme kayıtları brüt fark, kesinti kalemi net fark; K-387), SGK taban/tavan, işçi payları, GV matrahı, önceki kümülatif matrah (yılın kayıtlı hesapları + elle devir), hesaplanan GV, asgari ücret GV istisnası (asgari ücretin yıl başından kümülatif matrahıyla, gün oranlı) ve DV istisnası (K-388), net, kesintiler (DOM-FIN-101 sırası; icra net ücretten), ödenecek net, işveren payları (5 puan indirim setten) ve maliyet. Net tanımlı ücret ters hesapla brüte çevrilir (K-389); yuvarlama her kalemde bir kez yarım yukarı, vergi tek yuvarlama (K-390). Saatlik ya da ders saati ana ücret hesaplanmaz (\`complete: false\`, toplama ve kayda girmez). \`saved\` ayın etkin kayıtlı hesabının özeti, \`locked\` ayın onaylı olup olmadığıdır. Set yoksa 422 \`payroll_parameters_missing\`. Her okuma denetime düşer: ekran \`finance.payroll_calculation.read\`, \`Accept: text/csv\` \`finance.payroll_calculation_export\` (yalnız alan adları); sağlık raporu günü varsa ayrıca \`finance.medical_report.read\`. CSV taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk. ${VERIFY} ${MANAGER}`,
        params: payrollMonthParams,
        response: { 200: payrollCalculationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const { month } = request.params
      if (wantsCsv(request))
        return sendCsv(reply as FastifyReply, await payrollCalculationCsvFor(ctx, month))
      return { data: await payrollCalculationFor(ctx, month, 'view') }
    },
  )

  typed.get(
    `${RUN_URL}/:month`,
    {
      config: csvRateLimit('payroll-run-export'),
      preValidation: [...guarded, freshForCsv],
      schema: {
        operationId: 'getPayrollRun',
        tags,
        summary: 'Kayıtlı bordro hesabı',
        description: `Ayın etkin kayıtlı hesabı (K-391): kaydedildiği andaki satırlar değişmeden döner; ücret tanımı ya da parametre sonradan değişse de kayıt aynıdır. Kayıt yoksa 404. Her okuma \`finance.payroll_run.read\` (CSV \`finance.payroll_run_export\`) denetimi yazar. CSV taze oturum ister, kullanıcı başına 10/dk. ${MANAGER}`,
        params: payrollMonthParams,
        response: { 200: payrollRunResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const { month } = request.params
      if (wantsCsv(request))
        return sendCsv(reply as FastifyReply, await payrollRunCsvFor(ctx, month))
      return { data: await payrollRunFor(ctx, month, 'view') }
    },
  )

  typed.post(
    `${RUN_URL}/:month/calculate`,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'savePayrollRun',
        tags,
        summary: 'Bordro hesabını kaydet ya da yeniden hesapla',
        description: `Ay kurum kilidi altında yeniden hesaplanır ve kaydedilir (K-391). Onaylı (kilitli) ay 409 \`payroll_period_locked\`: dönem onayı kayıtlı hesabı dondurur (DOM-FIN-108). \`previousRunId\` ekranda görülen kayıtlı hesabın kimliğidir (ilk kayıtta \`null\`); güncel değilse 409 \`payroll_run_changed\`. Hesaplanabilen satır yoksa 422 \`payroll_run_empty\`. Varsa eski hesap arşivlenir, revizyonu bir artırılmış yeni hesap yazılır; eksik satırlar (saatlik ücret, tanımsız) kayda girmez. Ek ders yalnız müdür onaylı çizelgeden girer (K-423); çizelge sonradan yeniden açılsa da kayıtlı satırlar değişmez. Kayıtlı hesabın GV matrahı sonraki ayların kümülatifine girer. Kayıt ödeme yapmaz, icra kalanını değiştirmez. İlk kayıt 201, yeniden hesaplama 200. \`Idempotency-Key\` zorunlu. ${VERIFY} ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: payrollMonthParams,
        body: payrollRunSaveSchema,
        response: { 200: payrollRunSaveResponse, 201: payrollRunSaveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await savePayrollRunCommand(
        contextOf(request),
        request.params.month,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return payrollRunSaveResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    CARRYOVER_URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listPayrollTaxCarryovers',
        tags,
        summary: 'Kümülatif matrah devirleri',
        description: `Yılın etkin kümülatif gelir vergisi matrahı devirleri (K-388), personel adına göre. Her okuma \`finance.payroll_tax_carryover.read\` denetimi yazar. ${MANAGER}`,
        querystring: carryoverListQuery,
        response: { 200: carryoverListResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await listTaxCarryoversFor(contextOf(request), request.query.year),
    }),
  )

  typed.post(
    CARRYOVER_URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPayrollTaxCarryover',
        tags,
        summary: 'Kümülatif matrah devri gir',
        description: `Personelin yıl içinde önceki işyerinde ya da Kampüs öncesinde oluşan kümülatif gelir vergisi matrahı (K-388); o yılın hesaplarında önceki kümülatife eklenir. Personel × yıl başına tek etkin kayıt: varsa 409 \`payroll_carryover_exists\` (önce kaldırılır). Olmayan üyelik 422 \`payroll_carryover_staff_not_found\`, öğrenci ya da veli 422 \`payroll_carryover_not_staff\`. Kayıtlı hesaplar kendiliğinden değişmez; etkilenen ay yeniden hesaplanır. Denetime alan adları yazılır. \`Idempotency-Key\` isteğe bağlı. 201. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: payrollTaxCarryoverInputSchema,
        response: { 201: carryoverResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createTaxCarryoverCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = carryoverResponse.parse(sendBody(reply, result))
      reply.header('location', `${CARRYOVER_URL}/${body.data.id}`)
      return body
    },
  )

  typed.delete(
    `${CARRYOVER_URL}/:carryoverId`,
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'archivePayrollTaxCarryover',
        tags,
        summary: 'Kümülatif matrah devrini kaldır',
        description: `Devir arşivlenir; sonraki hesaplara girmez. Olmayan, kaldırılmış ya da başka kurumun kaydı 404; \`If-Match\` zorunlu, sürüm tutmazsa 409. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: carryoverParams,
        response: { 200: carryoverArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveTaxCarryoverCommand(
        contextOf(request),
        request.params.carryoverId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return carryoverArchiveResponse.parse(sendBody(reply, result))
    },
  )
}
