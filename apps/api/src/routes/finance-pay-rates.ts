import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_PAY_RATE_ROLES,
  payRateCancelSchema,
  payRateEndSchema,
  payRateInputSchema,
} from '@kampus/school-core/lib/finance-pay-rates.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelPayRateCommand,
  createPayRateCommand,
  endPayRateCommand,
  getStaffPayRatesFor,
  listPayRateStaffFor,
} from '../services/finance-pay-rates.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  payRateCancelResponse,
  payRateCreateResponse,
  payRateParams,
  payRateResponse,
  staffDetailQuery,
  staffDetailResponse,
  staffListQuery,
  staffListResponse,
  staffParams,
} from './finance-pay-rates.schemas.ts'

/**
 * Personel ücret tanımı uçları (docs/domain/finans.md DOM-FIN-099; ON-194). Modül `finance`; okuma
 * ve yazma yalnız yönetici (K-306). Tutar içeren okuma denetime düşer (K-307). Sıra: 401 → 403
 * modül → 403 rol → `If-Match` → 400 → işlem. Tanım düzeltilmez: `POST /pay-rates` yazar,
 * `…/end` son tanımın bitişini değiştirir, `…/cancel` son tanımı gerekçeyle iptal eder.
 */

const MANAGER =
  'Rol: yalnız `yonetici` (K-306; muhasebe rolü açılsa da ücret görmez). Modül `finance`.'
const URL = '/api/v1/finance/pay-rates'
const STAFF_URL = '/api/v1/finance/pay-rate-staff'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinancePayRateRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_PAY_RATE_ROLES),
  ]
  const tags = ['finance-pay-rates']

  typed.get(
    STAFF_URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listPayRateStaff',
        tags,
        summary: 'Personel ve ücret özeti',
        description: `Kurumun yönetici, öğretmen ve ön büro üyelikleri ada göre; her satırda \`date\` günündeki (varsayılan bugün) ana ücret türü ve başlangıcı, yürürlükteki ek ders ve yan hak sayısı. Liste varsayılan **maskelidir**: ana ücret tutarı \`null\` döner (K-306). \`showAmounts=true\` tutarı verir ve okuma denetim kaydına \`finance.pay_rate.read\` olarak düşer (K-307). Pasif (ayrılan) personel de listelenir. ${MANAGER}`,
        querystring: staffListQuery,
        response: { 200: staffListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, date, showAmounts } = request.query
      const { items, total } = await listPayRateStaffFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        day: date,
        showAmounts: showAmounts === 'true',
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${STAFF_URL}/:membershipId`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffPayRates',
        tags,
        summary: 'Personelin ücret geçmişi ve geçerli ücreti',
        description: `İptal edilmemiş bütün tanımlar ve \`date\` gününde (varsayılan bugün) yürürlükteki tanımlar ("şu tarihte geçerli ücret", DOM-FIN-099). Tutar içerdiği için her okuma denetim kaydına \`finance.pay_rate.read\` olarak düşer (yalnız alan adı; K-307); denetim yazılamazsa yanıt dönmez. Olmayan, başka kurumun ya da personel olmayan (öğrenci, veli) üyelik 404. ${MANAGER}`,
        params: staffParams,
        querystring: staffDetailQuery,
        response: { 200: staffDetailResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStaffPayRatesFor(
        contextOf(request),
        request.params.membershipId,
        request.query.date,
      ),
    }),
  )

  typed.post(
    URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPayRate',
        tags,
        summary: 'Ücret tanımı yaz',
        description: `Ana ücret (\`component: wage\`; aylık brüt, aylık net, saatlik ya da ders saati), ek ders ücreti (\`lesson\`; ek ders ya da nöbet, saat başı) ya da yan hak (\`benefit\`; yemek, yol, çocuk yardımı, servis; nakdi/ayni ve vergiye tabi işareti, aylık). Tutar kuruş, yürürlük başlangıcı ve isteğe bağlı bitiş günü (K-305). Çakışma yuvası ana ücrette tektir, ek ders ve yan hak türlerinde ayrıdır; yeni tanım yuvanın son tanımından sonra başlamalıdır (422 \`pay_rate_start_not_after_latest\`), son tanım hâlâ yürürlükteyse bitişi yeni başlangıçtan bir gün önceye kendiliğinden çekilir ve yanıtta \`closedRate\` olarak döner (K-304). Olmayan üyelik 422 \`pay_rate_staff_not_found\`, öğrenci ya da veli 422 \`pay_rate_not_staff\`, pasif personel 422 \`pay_rate_staff_inactive\`. Denetim kaydına alan adları yazılır, tutar ve not yazılmaz. \`Idempotency-Key\` isteğe bağlı. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: payRateInputSchema,
        response: { 201: payRateCreateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPayRateCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = payRateCreateResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.rate.id}`)
      return body
    },
  )

  typed.post(
    `${URL}/:rateId/end`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'endPayRate',
        tags,
        summary: 'Ücret tanımının bitişini değiştir',
        description: `Yalnız yuvanın son tanımının bitişi değişir; öncekilerin bitişini sonraki tanım belirler (422 \`pay_rate_not_latest\`, K-304). \`endDate: null\` süresiz yapar. Başlangıçtan önceki gün 422 \`pay_rate_end_before_start\`, aynı bitiş 422 \`pay_rate_end_unchanged\`. \`If-Match\` zorunlu. Başka kurumun tanımı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: payRateParams,
        body: payRateEndSchema,
        response: { 200: payRateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await endPayRateCommand(
        contextOf(request),
        request.params.rateId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return payRateResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/:rateId/cancel`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelPayRate',
        tags,
        summary: 'Ücret tanımını iptal et',
        description: `Yanlış tanım gerekçeyle (5–500 karakter) iptal edilir; tanım düzeltilmez. Yalnız yuvanın son tanımı iptal edilir (422 \`pay_rate_not_latest\`); iptal edilen tanım öncekini kendiliğinden kapattıysa önceki tanımın eski bitişi geri yazılır ve \`reopenedRate\` olarak döner (K-304). Gerekçe denetim kaydına yazılmaz. \`If-Match\` zorunlu. Başka kurumun ya da iptal edilmiş tanım 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: payRateParams,
        body: payRateCancelSchema,
        response: { 200: payRateCancelResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelPayRateCommand(
        contextOf(request),
        request.params.rateId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return payRateCancelResponse.parse(sendBody(reply, result))
    },
  )
}
