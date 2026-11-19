import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_PERFORMANCE_ROLES,
  performancePeriodInputSchema,
  performancePeriodStatusSchema,
  performanceReviewCreateSchema,
  performanceReviewUpdateSchema,
} from '@kampus/school-core/lib/finance-performance.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  changePerformancePeriodStatusCommand,
  createPerformancePeriodCommand,
  createPerformanceReviewCommand,
  listPerformancePeriodsFor,
  listPerformanceReviewsFor,
  updatePerformanceReviewCommand,
} from '../services/finance-performance.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  periodListQuery,
  periodListResponse,
  periodParams,
  periodResponse,
  reviewListQuery,
  reviewListResponse,
  reviewParams,
  reviewResponse,
} from './finance-performance.schemas.ts'

/**
 * Personel performans dönemi uçları (docs/domain/finans.md DOM-FIN-124; ON-211). Modül `finance`;
 * okuma ve yazma yalnız yönetici (K-429). Dönem ve personel kaydı açmak `Idempotency-Key`, aşama
 * geçişi ve kayıt düzeltmesi `If-Match` ister. Kayıt okuması denetime düşer.
 */

const MANAGER =
  'Rol: yalnız `yonetici` (K-429; performans verisi kişiseldir, personelin kendi ekranı ayrı iştir). Modül `finance`.'
const PERIODS = '/api/v1/finance/performance-periods'
const REVIEWS = '/api/v1/finance/performance-reviews'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinancePerformanceRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_PERFORMANCE_ROLES),
  ]
  const tags = ['finance-performance']

  typed.get(
    PERIODS,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listPerformancePeriods',
        tags,
        summary: 'Performans dönemlerini listele',
        description: `Dönemler, yeni başlangıç önce (DOM-FIN-124); ad, aşama, kayıt ve puanı tamamlanmış kayıt sayısı. Kişisel veri taşımaz, okuma denetime yazılmaz (K-429). Ad aranır, aşamayla süzülür. ${MANAGER}`,
        querystring: periodListQuery,
        response: { 200: periodListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status } = request.query
      const { items, total } = await listPerformancePeriodsFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    PERIODS,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPerformancePeriod',
        tags,
        summary: 'Performans dönemi aç',
        description: `Ad (2–120), başlangıç ve bitiş günü; dönem planlama aşamasında açılır. Bitiş başlangıçtan önce olamaz (400). \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: performancePeriodInputSchema,
        response: { 201: periodResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPerformancePeriodCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return periodResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${PERIODS}/:periodId/status`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'changePerformancePeriodStatus',
        tags,
        summary: 'Performans döneminin aşamasını ilerlet',
        description: `Dönem yalnız sıradaki aşamaya geçer: planlama → yürürlükte → ara görüşme → değerlendirme → kapandı (K-427); atlama ya da geri dönüş 409 \`performance_status_invalid\`, kapanmış dönem 409 \`performance_period_closed\`. Kapanış için bütün kayıtların bütün hedefleri puanlanmış olmalı, değilse 422 \`performance_period_unscored\`; kapanınca kayıtlar kilitlenir (K-428). \`If-Match\` zorunlu. Başka kurumun dönemi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: periodParams,
        body: performancePeriodStatusSchema,
        response: { 200: periodResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await changePerformancePeriodStatusCommand(
        contextOf(request),
        request.params.periodId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return periodResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${PERIODS}/:periodId/reviews`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listPerformanceReviews',
        tags,
        summary: 'Dönemin personel performans kayıtları',
        description: `Personel adına göre: hedefler (başlık, ölçüt, ağırlık, puan), genel puan (ağırlıklı ortalama, iki ondalık; puanı eksikse boş), ara görüşme notu ve günü, değerlendiren ve personel görüşü. Okuma aynı transaction'da denetime yazılır (\`finance.performance_review.read\`; alan adları ve kayıt sayısı, K-429). Başka kurumun dönemi 404. ${MANAGER}`,
        params: periodParams,
        querystring: reviewListQuery,
        response: { 200: reviewListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listPerformanceReviewsFor(
        contextOf(request),
        request.params.periodId,
        { page, pageSize, q },
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${PERIODS}/:periodId/reviews`,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPerformanceReview',
        tags,
        summary: 'Döneme personel ekle ve hedeflerini belirle',
        description: `Personel üyeliği ve hedefler (1–10; başlık, ölçüt, ağırlık %, toplam 100). Yalnız planlama ve yürürlük aşamasında (409 \`performance_enroll_closed\`); dönemde personel başına tek kayıt (409 \`performance_review_exists\`). Olmayan üyelik 422 \`performance_staff_not_found\`, öğrenci ya da veli 422 \`performance_not_staff\`, ayrılan personel 422 \`performance_staff_inactive\`, yöneticinin kendisi 422 \`performance_self_review\`. \`Idempotency-Key\` zorunlu. Başka kurumun dönemi 404. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: periodParams,
        body: performanceReviewCreateSchema,
        response: { 201: reviewResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createPerformanceReviewCommand(
        contextOf(request),
        request.params.periodId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return reviewResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${REVIEWS}/:reviewId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updatePerformanceReview',
        tags,
        summary: 'Performans kaydını düzelt',
        description: `Kısmi düzeltme (K-428): hedefler planlama, yürürlük ve ara görüşmede (değişince puanlar sıfırlanır; değerlendirmede 422 \`performance_goals_locked\`); ara görüşme notu ve günü ara görüşme ve değerlendirmede (422 \`performance_interim_not_open\`; gün dönem içinde ve bugünden sonra değil); puanlar (hedef sırasıyla 1–5, boş = girilmedi) ve personel görüşü yalnız değerlendirmede (422 \`performance_evaluation_not_open\`). Puan yazan yönetici değerlendiren olur. Personel görüşünü yönetici personel adına girer. Kapanmış dönem 409 \`performance_period_closed\`, sürüm tutmazsa 409. Not ve görüş metni denetime yazılmaz. \`If-Match\` zorunlu. Başka kurumun kaydı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: reviewParams,
        body: performanceReviewUpdateSchema,
        response: { 200: reviewResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updatePerformanceReviewCommand(
        contextOf(request),
        request.params.reviewId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return reviewResponse.parse(sendBody(reply, result))
    },
  )
}
