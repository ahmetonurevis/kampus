import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import {
  monthlyDeductionRequestSchema,
  STAFF_DEDUCTION_ROLES,
  staffAdvanceCloseSchema,
  staffAdvanceSchema,
  staffDeductionCancelSchema,
  staffGarnishmentBalanceSchema,
  staffGarnishmentCloseSchema,
  staffGarnishmentSchema,
  staffPensionOptOutSchema,
  staffPensionPauseSchema,
  staffPensionSchema,
} from '@kampus/school-core/lib/finance-staff-deductions.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelAdvanceCommand,
  closeAdvanceCommand,
  closeGarnishmentCommand,
  createAdvanceCommand,
  createGarnishmentCommand,
  createPensionCommand,
  getStaffDeductionsFor,
  listDeductionStaffFor,
  optOutPensionCommand,
  pausePensionCommand,
  previewMonthlyDeductionsFor,
  updateGarnishmentCommand,
} from '../services/finance-staff-deductions.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  advanceParams,
  advanceResponse,
  garnishmentParams,
  garnishmentResponse,
  membershipParams,
  monthlyDeductionResponse,
  pensionParams,
  pensionResponse,
  staffDeductionsResponse,
  staffListQuery,
  staffListResponse,
} from './finance-staff-deductions.schemas.ts'

/**
 * Avans ve kesinti uçları (docs/domain/finans.md DOM-FIN-101; ON-199). Modül `finance`; okuma ve
 * yazma yalnız yönetici (K-315; muhasebe/İK rolü açılınca o da). İcra bilgisi hassastır: icra
 * dönen okuma denetim kaydına düşer. Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem.
 * Kayıtlar silinmez: avans erken kapanır ya da iptal edilir, icra kapanır, BES'ten ayrılınır.
 */

const MANAGER = 'Rol: `yonetici` (muhasebe/İK rolü açılınca o da; K-315). Modül `finance`.'
const FINANCE = '/api/v1/finance'
const STAFF = `${FINANCE}/staff-deductions`
const ADVANCES = `${FINANCE}/staff-advances`
const GARNISHMENTS = `${FINANCE}/staff-garnishments`
const PENSIONS = `${FINANCE}/staff-pension-enrollments`
const IF_MATCH = '`If-Match` zorunlu (409 `version_conflict`).'
const STAFF_ERRORS =
  'olmayan üyelik 422 `staff_deduction_staff_not_found`, öğrenci ya da veli 422 `staff_deduction_not_staff`, pasif personel 422 `staff_deduction_staff_inactive`'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

type Updater = (
  ctx: ReturnType<typeof contextOf>,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: ReturnType<typeof options>['idempotency'],
) => Promise<CommandResponse>

export function registerFinanceStaffDeductionRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(STAFF_DEDUCTION_ROLES),
  ]
  const tags = ['finance-staff-deductions']

  typed.get(
    STAFF,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listStaffDeductionStaff',
        tags,
        summary: 'Avans ve kesinti personel listesi',
        description: `Kurumun yönetici, öğretmen ve ön büro üyelikleri ada göre; her satırda mahsubu süren avans, açık icra ve açık BES katılımı sayısı. Pasif (ayrılan) personel de listelenir; \`holding=true\` yalnız açık kaydı olanları verir. İcra sayısı dönen sayfa denetim kaydına yazılır (DOM-FIN-101). ${MANAGER}`,
        querystring: staffListQuery,
        response: { 200: staffListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, holding } = request.query
      const { items, total } = await listDeductionStaffFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        holding: holding === undefined ? undefined : holding === 'true',
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${STAFF}/:membershipId`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffDeductions',
        tags,
        summary: 'Personelin avans, icra ve BES kayıtları',
        description: `Avanslar (taksit planı ve kalan tutarla; plan saklanmaz), icralar (kesinti sırasıyla) ve BES katılımları (bugünkü durumla). İcra dönerse okuma denetim kaydına alan adlarıyla yazılır (K-315). Olmayan ya da başka kurumun üyeliği 404. ${MANAGER}`,
        params: membershipParams,
        response: { 200: staffDeductionsResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStaffDeductionsFor(contextOf(request), request.params.membershipId),
    }),
  )

  typed.post(
    `${STAFF}/:membershipId/month-preview`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'previewStaffMonthlyDeductions',
        tags,
        summary: 'Ay için kesinti listesi',
        description: `Verilen ay ve isteğe bağlı net ücret ile BES matrahından personelin o ayki kesintilerini sırayla hesaplar (K-315): avans taksitleri, icralar (nafaka önce, nafaka dışından yalnız sıradaki; ötekiler \`waiting\`), BES. İcra net ücret × oran ve kalan alacakla, her satır net ücretin kalanıyla sınırlıdır (\`capped\`); net yoksa icra \`needs_net\`, matrah yoksa BES \`needs_base\`. Oranlı tutarlar kuruşa aşağı yuvarlanır. **Hiçbir şey yazmaz**; net ücret saklanmaz ve loglanmaz (\`Idempotency-Key\` gerekmez). İcra satırı dönerse okuma denetime yazılır. Başka kurumun üyeliği 404. ${MANAGER}`,
        params: membershipParams,
        body: monthlyDeductionRequestSchema,
        response: { 200: monthlyDeductionResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await previewMonthlyDeductionsFor(
        contextOf(request),
        request.params.membershipId,
        request.body,
      ),
    }),
  )

  function create(spec: {
    url: string
    operationId: string
    summary: string
    description: string
    body: z.ZodType
    response: z.ZodType
    idempotency: 'required' | 'optional'
    run: typeof createAdvanceCommand
  }) {
    // Genel yardımcıda yanıt tipi daraltılamaz; şema doğrulaması ve serileştirme yine Zod'dadır.
    app.post(
      spec.url,
      {
        preValidation: [...guarded, rejectIfMatch(), captureInput()],
        schema: {
          operationId: spec.operationId,
          tags,
          summary: spec.summary,
          description: `${spec.description} ${MANAGER}`,
          headers: commandHeadersSchema(spec.idempotency, { ifMatch: false }),
          body: spec.body,
          response: { 201: spec.response, ...commandErrors },
        },
      },
      async (request, reply) => {
        const result = await spec.run(
          contextOf(request),
          request.commandInput,
          options(request, spec.idempotency).idempotency,
        )
        return spec.response.parse(sendBody(reply, result))
      },
    )
  }

  function update(spec: {
    method: 'POST' | 'PATCH'
    url: string
    params: typeof advanceParams | typeof garnishmentParams | typeof pensionParams
    idOf: (params: Record<string, string>) => string
    operationId: string
    summary: string
    description: string
    body: z.ZodType
    response: z.ZodType
    run: Updater
  }) {
    app.route({
      method: spec.method,
      url: spec.url,
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: spec.operationId,
        tags,
        summary: spec.summary,
        description: `${spec.description} ${IF_MATCH} ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: spec.params,
        body: spec.body,
        response: { 200: spec.response, ...commandErrors },
      },
      handler: async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await spec.run(
          contextOf(request),
          spec.idOf(request.params as Record<string, string>),
          request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return spec.response.parse(sendBody(reply, result))
      },
    })
  }

  create({
    url: ADVANCES,
    operationId: 'createStaffAdvance',
    summary: 'Personele avans ver',
    description: `Personel, tutar (kuruş), veriliş günü, ödeme yöntemi (\`cash\`, \`bank_transfer\`), taksit sayısı (1–24) ve mahsubun ilk ayı (K-312). Taksit planı eşit kuruştur, yuvarlama farkı son taksite eklenir; plan saklanmaz. Gelecek gün 422 \`staff_deduction_date_in_future\`; ilk ay veriliş ayından önce 422 \`staff_advance_first_month_before_given\`, 12 aydan sonra 422 \`staff_advance_first_month_too_late\`; ${STAFF_ERRORS}. Taksit planı oluşturduğu için \`Idempotency-Key\` zorunlu.`,
    body: staffAdvanceSchema,
    response: advanceResponse,
    idempotency: 'required',
    run: createAdvanceCommand,
  })
  update({
    method: 'POST',
    url: `${ADVANCES}/:advanceId/close`,
    params: advanceParams,
    idOf: (params) => params.advanceId ?? '',
    operationId: 'closeStaffAdvance',
    summary: 'Avansı erken kapat',
    description:
      'Kalanı personel öder: kapama günü, kesilmeyecek ilk taksit ayı ve geri ödeme yöntemi (K-312). Bu ay ve sonraki taksitler kesilmez; kalan plandan hesaplanır. Açık olmayan avans 422 `staff_advance_not_active`; gelecek gün 422 `staff_deduction_date_in_future`; veriliş gününden önce 422 `staff_advance_close_before_given`; kapama ayından önceki ay 422 `staff_advance_close_month_past`; plan dışı ay 422 `staff_advance_close_month_outside_plan`. Başka kurumun avansı 404.',
    body: staffAdvanceCloseSchema,
    response: advanceResponse,
    run: closeAdvanceCommand,
  })
  update({
    method: 'POST',
    url: `${ADVANCES}/:advanceId/cancel`,
    params: advanceParams,
    idOf: (params) => params.advanceId ?? '',
    operationId: 'cancelStaffAdvance',
    summary: 'Avansı iptal et',
    description:
      'Yanlış girilen avans silinmez, gerekçeyle (5–500 karakter) iptal edilir; hiçbir taksiti kesilmez (K-312). Gerekçe denetim kaydına yazılmaz. Açık olmayan avans 422 `staff_advance_not_active`. Başka kurumun avansı 404.',
    body: staffDeductionCancelSchema,
    response: advanceResponse,
    run: cancelAdvanceCommand,
  })

  create({
    url: GARNISHMENTS,
    operationId: 'createStaffGarnishment',
    summary: 'İcra kesintisi kaydet',
    description: `İcra dairesi, dosya no, alacak (kuruş), net ücretten oran (onbinde, varsayılan 2500 = dörtte bir; İİK md. 83), nafaka işareti ve tebliğ günü (K-313). Kalan alacak alacağa eşit başlar; kayıt sıra numarası verilir. Aynı personele aynı daire ve dosya 409 \`staff_garnishment_duplicate\`; gelecek tebliğ günü 422 \`staff_deduction_date_in_future\`; ${STAFF_ERRORS}. Hassas veri: değerler loglanmaz, denetime alan adı yazılır.`,
    body: staffGarnishmentSchema,
    response: garnishmentResponse,
    idempotency: 'optional',
    run: createGarnishmentCommand,
  })
  update({
    method: 'PATCH',
    url: `${GARNISHMENTS}/:garnishmentId`,
    params: garnishmentParams,
    idOf: (params) => params.garnishmentId ?? '',
    operationId: 'updateStaffGarnishment',
    summary: 'İcranın kalan alacağını güncelle',
    description:
      'İcra dairesinin bakiye yazısına göre kalan alacak (kuruş, K-313). Alacağı aşan 422 `staff_garnishment_remaining_exceeds_claim`; kapanmış icra 422 `staff_garnishment_closed`. Başka kurumun kaydı 404.',
    body: staffGarnishmentBalanceSchema,
    response: garnishmentResponse,
    run: updateGarnishmentCommand,
  })
  update({
    method: 'POST',
    url: `${GARNISHMENTS}/:garnishmentId/close`,
    params: garnishmentParams,
    idOf: (params) => params.garnishmentId ?? '',
    operationId: 'closeStaffGarnishment',
    summary: 'İcrayı kapat',
    description:
      'Kapanış günü ve nedeni (`paid_off` borç ödendi, `lifted` haciz kaldırıldı, `other`; K-313). Kapanış ayından itibaren kesilmez, sıradaki icra başlar. Zaten kapalı 422 `staff_garnishment_closed`; tebliğden önce 422 `staff_garnishment_close_before_received`; gelecek gün 422 `staff_deduction_date_in_future`. Başka kurumun kaydı 404.',
    body: staffGarnishmentCloseSchema,
    response: garnishmentResponse,
    run: closeGarnishmentCommand,
  })

  create({
    url: PENSIONS,
    operationId: 'createStaffPensionEnrollment',
    summary: 'BES otomatik katılımı kaydet',
    description: `Çalışan katkı oranı (onbinde, varsayılan ve en az 300 = %3) ve başlangıç günü (K-314). Yalnız kayıttır; katkı emeklilik şirketine aktarılmaz. Personelin açık katılımı varken 409 \`staff_pension_already_enrolled\`; ${STAFF_ERRORS}.`,
    body: staffPensionSchema,
    response: pensionResponse,
    idempotency: 'optional',
    run: createPensionCommand,
  })
  update({
    method: 'POST',
    url: `${PENSIONS}/:enrollmentId/pause`,
    params: pensionParams,
    idOf: (params) => params.enrollmentId ?? '',
    operationId: 'pauseStaffPensionEnrollment',
    summary: 'BES kesintisine ara ver',
    description:
      'İlk ve son ay (dahil), en çok 12 ay (K-314). Ayrılmış katılım 422 `staff_pension_opted_out`; katılım ayından önce 422 `staff_pension_pause_before_start`; önceki arayla çakışma 422 `staff_pension_pause_overlap`. Başka kurumun kaydı 404.',
    body: staffPensionPauseSchema,
    response: pensionResponse,
    run: pausePensionCommand,
  })
  update({
    method: 'POST',
    url: `${PENSIONS}/:enrollmentId/opt-out`,
    params: pensionParams,
    idOf: (params) => params.enrollmentId ?? '',
    operationId: 'optOutStaffPensionEnrollment',
    summary: 'BES katılımından cay ya da ayrıl',
    description:
      'Gün (K-314); o günün ayından itibaren kesilmez. Katılımdan iki ay içindeyse `optOutKind: cooling_off` (katkı iade edilir), sonra `exit`. Zaten ayrılmış 422 `staff_pension_opted_out`; başlangıçtan önce 422 `staff_pension_opt_out_before_start`; gelecek gün 422 `staff_deduction_date_in_future`. Başka kurumun kaydı 404.',
    body: staffPensionOptOutSchema,
    response: pensionResponse,
    run: optOutPensionCommand,
  })
}
