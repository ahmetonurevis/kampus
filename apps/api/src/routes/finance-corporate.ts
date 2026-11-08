import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  cancelCorporateInvoiceSchema,
  CORPORATE_INVOICE_CANCEL_ROLES,
  CORPORATE_ROLES,
  corporateCustomerSchema,
  corporateInvoiceSchema,
  endCorporateEmployeeSchema,
  linkCorporateEmployeeSchema,
  updateCorporateCustomerSchema,
} from '@kampus/school-core/lib/finance-corporate.ts'

import { NotFoundError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveCorporateCustomerCommand,
  cancelCorporateInvoiceCommand,
  corporateAttendanceCsvFor,
  corporateAttendanceReportFor,
  corporateBillableFor,
  corporateInvoiceCsvFor,
  createCorporateCustomerCommand,
  createCorporateInvoiceCommand,
  endCorporateEmployeeCommand,
  getCorporateCustomerFor,
  getCorporateInvoiceFor,
  linkCorporateEmployeeCommand,
  listCorporateCustomersFor,
  listCorporateEmployeesFor,
  listCorporateInvoicesFor,
  updateCorporateCustomerCommand,
} from '../services/finance-corporate.ts'
import { getInstitutionModules } from '../services/modules.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  attendanceReportResponse,
  billableResponse,
  customerArchiveResponse,
  customerListQuery,
  customerListResponse,
  customerParams,
  customerResponse,
  employeeListQuery,
  employeeListResponse,
  employeeParams,
  employeeResponse,
  invoiceListQuery,
  invoiceListResponse,
  invoiceParams,
  invoiceResponse,
  periodQuery,
} from './finance-corporate.schemas.ts'

/**
 * Kurumsal müşteri, çalışan bağı, toplu fatura ve katılım özeti uçları (IST-089; docs/domain/
 * finans.md DOM-FIN-060, dil-okulu.md DOM-DIL-093). Modül `finance`. Yalnız dil okulundadır: öteki
 * kurum türlerinde her uç her rol için 404, rol denetiminden önce (DOM-YTK-012). Sıra: 401 → 403
 * modül → 404 tür → 403 rol → `If-Match` → 400 → işlem. Okuma ve yazma yönetici ile ön büro;
 * toplu fatura iptali yönetici (K-51). Şirket yetkilisinin girişi yoktur.
 */

const LANGUAGE_ONLY =
  'Yalnız dil okulunda (`language_school`); öteki türlerde her rol için 404, rol denetiminden önce.'
const STAFF = 'Roller: `yonetici`, `onburo`.'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

/** Döküm `Accept: text/csv` ile dosya olarak döner (api-tasarimi.md §CSV). */
const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')
const CSV_PER_MINUTE = 10
const READS_PER_MINUTE = 300
const CSV_NOTE =
  '`Accept: text/csv` ile dosya iner: `;` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı; taze oturum ister (eskiyse 403 `reauthentication_required`), kullanıcı başına 10/dk, denetime yazılır.'

function sendCsv(reply: FastifyReply, name: string, csv: string) {
  return reply
    .type('text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${name}.csv"`)
    .serializer((payload: unknown) => String(payload))
    .send(`\uFEFF${csv}`)
}

export function registerFinanceCorporateRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const languageSchool: preValidationAsyncHookHandler = async function (request) {
    const ctx = contextOf(request)
    const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
    if (institution?.type !== 'language_school') throw new NotFoundError()
  }
  const guarded = (roles: readonly ('yonetici' | 'onburo')[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    languageSchool,
    app.requireRole(roles),
  ]
  // Dosya kişisel veri taşır: taze oturum ve kullanıcı başına 10/dk yalnız CSV isteğinde.
  const freshForCsv: preValidationAsyncHookHandler = async function (request, reply) {
    if (wantsCsv(request)) await app.requireFreshSession.call(app, request, reply)
  }
  const csvRateLimit = (prefix: string) => ({
    rateLimit: {
      max: (request: FastifyRequest) => (wantsCsv(request) ? CSV_PER_MINUTE : READS_PER_MINUTE),
      timeWindow: '1 minute',
      hook: 'preHandler' as const,
      keyGenerator: (request: FastifyRequest) =>
        wantsCsv(request) ? `${prefix}:${request.auth?.userId ?? request.ip}` : request.ip,
    },
  })
  const tags = ['finance-corporate']

  // --- Müşteri -----------------------------------------------------------------------------------

  typed.get(
    '/api/v1/finance/corporate-customers',
    {
      preValidation: guarded(CORPORATE_ROLES),
      schema: {
        operationId: 'listCorporateCustomers',
        tags,
        summary: 'Kurumsal müşterileri listele',
        description: `Etkin şirketler, unvana göre; bugün etkin bağlı kursiyer sayısıyla (DOM-FIN-060). \`q\` unvanda ya da vergi numarasında arar; arşivli şirket görünmez. ${LANGUAGE_ONLY} ${STAFF}`,
        querystring: customerListQuery,
        response: { 200: customerListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listCorporateCustomersFor(contextOf(request), {
        page,
        pageSize,
        q,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/corporate-customers',
    {
      preValidation: [...guarded(CORPORATE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createCorporateCustomer',
        tags,
        summary: 'Kurumsal müşteri ekle',
        description: `Unvan, vergi numarası (10 haneli VKN ya da 11 haneli TCKN; kontrol hanesi denetlenir), vergi dairesi, fatura adresi ve isteğe bağlı iletişim kişisi (DOM-FIN-060). Vergi numarası etkin şirketlerde tekildir: 409 \`corporate_tax_number_exists\`. ${LANGUAGE_ONLY} ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: corporateCustomerSchema,
        response: { 201: customerResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createCorporateCustomerCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = customerResponse.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/finance/corporate-customers/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/finance/corporate-customers/:customerId',
    {
      preValidation: guarded(CORPORATE_ROLES),
      schema: {
        operationId: 'getCorporateCustomer',
        tags,
        summary: 'Kurumsal müşteri ayrıntısı',
        description: `Olmayan, arşivli ya da başka kurumun şirketi 404. ${LANGUAGE_ONLY} ${STAFF}`,
        params: customerParams,
        response: { 200: customerResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getCorporateCustomerFor(contextOf(request), request.params.customerId),
    }),
  )

  typed.patch(
    '/api/v1/finance/corporate-customers/:customerId',
    {
      preValidation: [...guarded(CORPORATE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateCorporateCustomer',
        tags,
        summary: 'Kurumsal müşteriyi düzelt',
        description: `Kısmi düzeltme; kesilmiş toplu fatura kesim anının kopyasını taşıdığından değişmez. Başka şirketin vergi numarası 409 \`corporate_tax_number_exists\`, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${LANGUAGE_ONLY} ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: customerParams,
        body: updateCorporateCustomerSchema,
        response: { 200: customerResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateCorporateCustomerCommand(
        contextOf(request),
        request.params.customerId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return customerResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    '/api/v1/finance/corporate-customers/:customerId',
    {
      preValidation: [...guarded(CORPORATE_ROLES), requireIfMatch()],
      schema: {
        operationId: 'archiveCorporateCustomer',
        tags,
        summary: 'Kurumsal müşteriyi arşivle',
        description: `Etkin bağlı kursiyeri olan şirket 422 \`corporate_customer_has_employees\`; kesilmiş faturalar kalır. Sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${LANGUAGE_ONLY} ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: customerParams,
        response: { 200: customerArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveCorporateCustomerCommand(
        contextOf(request),
        request.params.customerId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return customerArchiveResponse.parse(sendBody(reply, result))
    },
  )

  // --- Çalışan bağı ------------------------------------------------------------------------------

  typed.get(
    '/api/v1/finance/corporate-customers/:customerId/employees',
    {
      preValidation: guarded(CORPORATE_ROLES),
      schema: {
        operationId: 'listCorporateEmployees',
        tags,
        summary: 'Şirkete bağlı kursiyerler',
        description: `Etkin bağlar önce, sonra yeni başlayan önce. \`status\` etkin ya da biten bağları süzer. Olmayan ya da başka kurumun şirketi 404. ${LANGUAGE_ONLY} ${STAFF}`,
        params: customerParams,
        querystring: employeeListQuery,
        response: { 200: employeeListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status } = request.query
      const { items, total } = await listCorporateEmployeesFor(
        contextOf(request),
        request.params.customerId,
        { page, pageSize, status },
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/corporate-customers/:customerId/employees',
    {
      preValidation: [...guarded(CORPORATE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'linkCorporateEmployee',
        tags,
        summary: 'Kursiyeri şirkete bağla',
        description: `Şirket, başlangıç gününden sonra vadesi gelen taksitlerin ödeyicisi olur; sözleşmenin ödeyici alanı değişmez (K-45). Kursiyere işveren raporu aydınlatmasının yapıldığı onaylanmadan bağ kurulmaz (\`noticeConfirmed: true\`; DOM-DIL-093). Kursiyerin tek etkin bağı olur: 409 \`corporate_employee_linked\`; yeni bağ önceki bağın bitişinden sonra başlar: 422 \`corporate_link_overlaps\`. Olmayan kursiyer ya da şirket 404. ${LANGUAGE_ONLY} ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: customerParams,
        body: linkCorporateEmployeeSchema,
        response: { 201: employeeResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await linkCorporateEmployeeCommand(
        contextOf(request),
        request.params.customerId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return employeeResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    '/api/v1/finance/corporate-customers/:customerId/employees/:linkId/end',
    {
      preValidation: [...guarded(CORPORATE_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'endCorporateEmployee',
        tags,
        summary: 'Şirket bağını bitir',
        description: `Bağ bitiş günüyle kapanır, silinmez; geçmiş dönemin faturası için kalır. Bitiş başlangıçtan önceyse 422 \`corporate_link_end_before_start\`, bitmiş bağ 409 \`corporate_link_ended\`, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${LANGUAGE_ONLY} ${STAFF}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: employeeParams,
        body: endCorporateEmployeeSchema,
        response: { 200: employeeResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await endCorporateEmployeeCommand(
        contextOf(request),
        request.params.customerId,
        request.params.linkId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return employeeResponse.parse(sendBody(reply, result))
    },
  )

  // --- Toplu fatura ------------------------------------------------------------------------------

  typed.get(
    '/api/v1/finance/corporate-customers/:customerId/billable',
    {
      preValidation: guarded(CORPORATE_ROLES),
      schema: {
        operationId: 'getCorporateBillable',
        tags,
        summary: 'Toplu fatura önizlemesi',
        description: `Hiçbir kayıt yazmaz; kesimle aynı seçim (DOM-FIN-060): dönemde ve şirket bağının içinde vadesi gelen, iptal edilmemiş, hiçbir geçerli toplu faturada olmayan taksitler. Ödenmiş taksit de girer (K-46); ek protokolle yerine gelen faturalı taksit girmez (K-52). Ters dönem 422 \`export_period_invalid\`, bir yıldan uzun 422 \`export_period_too_long\`. ${LANGUAGE_ONLY} ${STAFF}`,
        params: customerParams,
        querystring: periodQuery,
        response: { 200: billableResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await corporateBillableFor(contextOf(request), request.params.customerId, {
        from: request.query.from,
        to: request.query.to,
      }),
    }),
  )

  typed.get(
    '/api/v1/finance/corporate-invoices',
    {
      preValidation: guarded(CORPORATE_ROLES),
      schema: {
        operationId: 'listCorporateInvoices',
        tags,
        summary: 'Toplu faturaları listele',
        description: `Yeni kesilen önce. \`customerId\` şirkete, \`status\` geçerli ya da iptal edilmiş faturaya süzer. ${LANGUAGE_ONLY} ${STAFF}`,
        querystring: invoiceListQuery,
        response: { 200: invoiceListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, customerId, status } = request.query
      const { items, total } = await listCorporateInvoicesFor(contextOf(request), {
        page,
        pageSize,
        customerId,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    '/api/v1/finance/corporate-invoices',
    {
      preValidation: [...guarded(CORPORATE_ROLES), rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createCorporateInvoice',
        tags,
        summary: 'Toplu fatura kes',
        description: `Önizlemeyle aynı seçim kurum kilidi altında yapılır ve tek belge olarak yazılır (DOM-FIN-060). Bir taksit en çok bir geçerli toplu faturada yer alır; faturalanacak taksit kalmadıysa 422 \`corporate_invoice_empty\`. Numara \`KF-<yıl>-<sıra>\` (K-53). Şirket bilgisi, satırlar ve toplam kesim anının kopyasıdır. \`Idempotency-Key\` zorunlu; aynı anahtar ilk yanıtı tekrarlar. Olmayan şirket 404. ${LANGUAGE_ONLY} ${STAFF}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: corporateInvoiceSchema,
        response: { 201: invoiceResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createCorporateInvoiceCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = invoiceResponse.parse(sendBody(reply, result))
      reply.header('location', `/api/v1/finance/corporate-invoices/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/finance/corporate-invoices/:invoiceId',
    {
      config: csvRateLimit('corporate-invoice-csv'),
      preValidation: [...guarded(CORPORATE_ROLES), freshForCsv],
      schema: {
        operationId: 'getCorporateInvoice',
        tags,
        summary: 'Toplu fatura ve satırları',
        description: `Satırın durumu bugünkü taksitten hesaplanır (\`open\`, \`partial\`, \`paid\`, \`cancelled\`); iptal edilmiş faturanın satırları da döner. ${CSV_NOTE} Denetim \`finance.corporate_invoice_export\`. Olmayan ya da başka kurumun faturası 404. ${LANGUAGE_ONLY} ${STAFF}`,
        params: invoiceParams,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur, istemci tipi tek kalsın.
        response: { 200: invoiceResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      if (wantsCsv(request)) {
        const { number, csv } = await corporateInvoiceCsvFor(ctx, request.params.invoiceId)
        return sendCsv(reply as FastifyReply, `toplu-fatura-${number}`, csv)
      }
      return { data: await getCorporateInvoiceFor(ctx, request.params.invoiceId) }
    },
  )

  typed.post(
    '/api/v1/finance/corporate-invoices/:invoiceId/cancel',
    {
      preValidation: [...guarded(CORPORATE_INVOICE_CANCEL_ROLES), requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelCorporateInvoice',
        tags,
        summary: 'Toplu faturayı iptal et',
        description: `Gerekçeyle (5–500 karakter); satırlar serbest kalır, taksitler yeniden faturalanabilir, numara boşta kalır. İptal edilmiş fatura 409 \`corporate_invoice_cancelled\`, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${LANGUAGE_ONLY} Rol: \`yonetici\`.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: invoiceParams,
        body: cancelCorporateInvoiceSchema,
        response: { 200: invoiceResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelCorporateInvoiceCommand(
        contextOf(request),
        request.params.invoiceId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return invoiceResponse.parse(sendBody(reply, result))
    },
  )

  // --- Katılım özeti -----------------------------------------------------------------------------

  typed.get(
    '/api/v1/finance/corporate-customers/:customerId/attendance-report',
    {
      config: csvRateLimit('corporate-report-csv'),
      preValidation: [...guarded(CORPORATE_ROLES), freshForCsv],
      schema: {
        operationId: 'getCorporateAttendanceReport',
        tags,
        summary: 'Şirket çalışanlarının katılım özeti',
        description: `Şirkete bugün etkin bağlı kursiyerlerin kur kayıtları (DOM-DIL-093, K-49): kur, grup, toplam, yoklaması alınan, katılınan ve gelinmeyen saat, katılım oranı (katılınan ÷ yoklaması alınan, binde), devam şartı ve onaylı en son kur sonucu. Yazma ürünü, ses kaydı, beceri puanı, öğretmen yorumu, kur sonu gerekçesi ve özür bilgisi yanıtta yoktur. Bozuk yoklama verisi satırı \`attendanceUnavailable\` yapar, raporu düşürmez. ${CSV_NOTE} Denetim \`finance.corporate_report_export\`. Olmayan ya da başka kurumun şirketi 404. ${LANGUAGE_ONLY} ${STAFF}`,
        params: customerParams,
        response: { 200: attendanceReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      if (wantsCsv(request)) {
        const csv = await corporateAttendanceCsvFor(ctx, request.params.customerId)
        return sendCsv(reply as FastifyReply, `katilim-ozeti-${request.params.customerId}`, csv)
      }
      return { data: await corporateAttendanceReportFor(ctx, request.params.customerId) }
    },
  )
}
