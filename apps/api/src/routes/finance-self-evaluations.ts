import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_SELF_EVALUATION_ROLES,
  selfEvaluationCreateSchema,
  selfEvaluationReopenSchema,
  selfEvaluationSubmitSchema,
  selfEvaluationTemplateInputSchema,
  selfEvaluationUpdateSchema,
} from '@kampus/school-core/lib/finance-self-evaluations.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  createSelfEvaluationCommand,
  createSelfEvaluationTemplateCommand,
  getSelfEvaluationFor,
  getSelfEvaluationOverview,
  listSelfEvaluationTrackingFor,
  reopenSelfEvaluationCommand,
  submitSelfEvaluationCommand,
  updateSelfEvaluationCommand,
  updateSelfEvaluationTemplateCommand,
} from '../services/finance-self-evaluations.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  overviewResponse,
  periodParams,
  responseParams,
  selfEvaluationResponse,
  templateParams,
  templateResponse,
  trackingListQuery,
  trackingListResponse,
} from './finance-self-evaluations.schemas.ts'

/**
 * Öz değerlendirme uçları (docs/domain/finans.md DOM-FIN-131; ON-210). Modül `finance`; okuma ve
 * yazma yalnız yönetici (K-450). Şablon ve yanıt açmak `Idempotency-Key`, düzeltme, gönderim ve geri
 * açma `If-Match` ister. Yanıt ayrıntısının okunuşu denetime düşer. Personelin kendi ekranı yoktur;
 * yönetici yanıtı personel adına girer (K-449).
 */

const MANAGER =
  'Rol: yalnız `yonetici` (K-450; öz değerlendirme kişiseldir, personelin kendi ekranı ayrı iştir). Modül `finance`.'
const PERIODS = '/api/v1/finance/performance-periods'
const TEMPLATES = '/api/v1/finance/self-evaluation-templates'
const RESPONSES = '/api/v1/finance/self-evaluations'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceSelfEvaluationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_SELF_EVALUATION_ROLES),
  ]
  const tags = ['finance-self-evaluations']

  typed.get(
    `${PERIODS}/:periodId/self-evaluation`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getSelfEvaluationOverview',
        tags,
        summary: 'Dönemin öz değerlendirme şablonu ve gönderen oranı',
        description: `Şablon (sorular, açılmış yanıt sayısı, kilit) ya da hazırlanmadıysa boş; özet: dönemde performans kaydı olan personel, gönderen, taslak, gönderilmeyen ve gönderen oranı (yüzde, bir ondalık; K-450). Kişisel veri taşımaz, okuma denetime yazılmaz. Başka kurumun dönemi 404. ${MANAGER}`,
        params: periodParams,
        response: { 200: overviewResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getSelfEvaluationOverview(contextOf(request), request.params.periodId),
    }),
  )

  typed.post(
    `${PERIODS}/:periodId/self-evaluation-template`,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createSelfEvaluationTemplate',
        tags,
        summary: 'Dönemin öz değerlendirme şablonunu hazırla',
        description: `Sorular (1–20): tür (\`scale\` puanlı 1–5, \`open\` açık uçlu), metin (5–300), zorunlu mu (K-448). Dönem başına tek şablon (409 \`self_evaluation_template_exists\`); kapanmış dönem 409 \`performance_period_closed\`. \`Idempotency-Key\` zorunlu. Başka kurumun dönemi 404. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: periodParams,
        body: selfEvaluationTemplateInputSchema,
        response: { 201: templateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createSelfEvaluationTemplateCommand(
        contextOf(request),
        request.params.periodId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return templateResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${TEMPLATES}/:templateId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateSelfEvaluationTemplate',
        tags,
        summary: 'Öz değerlendirme şablonunun sorularını düzelt',
        description: `Soruların tamamı yeniden yazılır (K-448). Dönemde yanıt açıldıysa 409 \`self_evaluation_template_in_use\`, kapanmış dönem 409 \`performance_period_closed\`, sürüm tutmazsa 409. \`If-Match\` zorunlu. Başka kurumun şablonu 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: templateParams,
        body: selfEvaluationTemplateInputSchema,
        response: { 200: templateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateSelfEvaluationTemplateCommand(
        contextOf(request),
        request.params.templateId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return templateResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${PERIODS}/:periodId/self-evaluations`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listSelfEvaluations',
        tags,
        summary: 'Dönemin öz değerlendirme takibi',
        description: `Dönemde performans kaydı olan her personel, ada göre: yanıt durumu (\`missing\` gönderilmedi, \`draft\` taslak, \`submitted\` gönderildi), kanal, gönderim anı, geri açılma sayısı ve yönetici görüşü var mı (K-450). Cevap ve görüş metni dönmez; okuma denetime yazılmaz. Ad aranır, durumla süzülür. Başka kurumun dönemi 404. ${MANAGER}`,
        params: periodParams,
        querystring: trackingListQuery,
        response: { 200: trackingListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status } = request.query
      const { items, total } = await listSelfEvaluationTrackingFor(
        contextOf(request),
        request.params.periodId,
        { page, pageSize, q, status },
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${PERIODS}/:periodId/self-evaluations`,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createSelfEvaluation',
        tags,
        summary: 'Personel adına öz değerlendirme yanıtı aç',
        description: `Personel üyeliği, kanal (\`paper\` kâğıt form, \`email\` e-posta) ve isteğe bağlı cevaplar (soru sırasıyla; puanlı soruda \`score\` 1–5, açık uçluda \`text\`); yanıt taslak açılır (K-449). Dönem yürürlük, ara görüşme ya da değerlendirmede olmalı (422 \`self_evaluation_not_open\`; kapanmış 409 \`performance_period_closed\`); şablon yoksa 422 \`self_evaluation_template_missing\`; dönemde performans kaydı olmayan personel 422 \`self_evaluation_not_enrolled\`; personel × dönem tek yanıt (409 \`self_evaluation_exists\`); cevap sayısı ya da türü şablona uymazsa 422 \`self_evaluation_answers_mismatch\` / \`self_evaluation_answer_kind\`. \`Idempotency-Key\` zorunlu. Başka kurumun dönemi 404. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: periodParams,
        body: selfEvaluationCreateSchema,
        response: { 201: selfEvaluationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createSelfEvaluationCommand(
        contextOf(request),
        request.params.periodId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return selfEvaluationResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${RESPONSES}/:responseId`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getSelfEvaluation',
        tags,
        summary: 'Öz değerlendirme yanıtı',
        description: `Sorular ve cevaplar, durum, kanal, yönetici görüşü ve son geri açma (an, gerekçe). Okuma aynı transaction'da denetime yazılır (\`finance.self_evaluation.read\`; alan adları, K-450). Başka kurumun yanıtı 404. ${MANAGER}`,
        params: responseParams,
        response: { 200: selfEvaluationResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getSelfEvaluationFor(contextOf(request), request.params.responseId),
    }),
  )

  typed.patch(
    `${RESPONSES}/:responseId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateSelfEvaluation',
        tags,
        summary: 'Öz değerlendirme yanıtını düzelt',
        description: `Kısmi düzeltme: cevaplar ve kanal yalnız taslakta (gönderilmiş yanıt 409 \`self_evaluation_submitted\`; K-449), yönetici görüşü (≤ 2000, boş metin siler) yalnız gönderilmiş yanıtta (422 \`self_evaluation_not_submitted\`; K-450). Kapanmış dönem 409 \`performance_period_closed\`, sürüm tutmazsa 409. Cevap ve görüş metni denetime yazılmaz. \`If-Match\` zorunlu. Başka kurumun yanıtı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: responseParams,
        body: selfEvaluationUpdateSchema,
        response: { 200: selfEvaluationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateSelfEvaluationCommand(
        contextOf(request),
        request.params.responseId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return selfEvaluationResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${RESPONSES}/:responseId/submit`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'submitSelfEvaluation',
        tags,
        summary: 'Öz değerlendirmeyi gönder',
        description: `Taslak gönderilir (K-449): zorunlu sorular cevaplı olmalı (422 \`self_evaluation_incomplete\`, ileti eksik soru sayısını verir); gönderilmiş yanıt 409 \`self_evaluation_already_submitted\`; dönem yanıta kapalıysa 422 \`self_evaluation_not_open\`, kapanmışsa 409 \`performance_period_closed\`. Gönderilen yanıt düzenlenmez. \`If-Match\` zorunlu. Başka kurumun yanıtı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: responseParams,
        body: selfEvaluationSubmitSchema,
        response: { 200: selfEvaluationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await submitSelfEvaluationCommand(
        contextOf(request),
        request.params.responseId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return selfEvaluationResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${RESPONSES}/:responseId/reopen`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'reopenSelfEvaluation',
        tags,
        summary: 'Gönderilmiş öz değerlendirmeyi geri aç',
        description: `Gerekçe (5–500) zorunlu; yanıt taslağa döner, son gerekçe, açan ve an saklanır, açılma sayısı artar (K-449). Taslak 409 \`self_evaluation_not_submitted\`, kapanmış dönem 409 \`performance_period_closed\`. Denetime \`finance.self_evaluation.reopen\` alan adlarıyla yazılır, gerekçe metni yazılmaz. \`If-Match\` zorunlu. Başka kurumun yanıtı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: responseParams,
        body: selfEvaluationReopenSchema,
        response: { 200: selfEvaluationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await reopenSelfEvaluationCommand(
        contextOf(request),
        request.params.responseId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return selfEvaluationResponse.parse(sendBody(reply, result))
    },
  )
}
