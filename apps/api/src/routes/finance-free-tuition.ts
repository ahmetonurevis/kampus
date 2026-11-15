import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import {
  confirmFreeTuitionQuotaSchema,
  createFreeTuitionApplicationSchema,
  createFreeTuitionRoundSchema,
  freeTuitionMebbisSchema,
  recordFreeTuitionBoardSchema,
  updateFreeTuitionDocumentsSchema,
} from '@kampus/school-core/lib/finance-free-tuition.ts'
import { payRefundSchema } from '@kampus/school-core/lib/withdrawals.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  confirmFreeTuitionQuotaCommand,
  createFreeTuitionApplicationCommand,
  createFreeTuitionRoundCommand,
  getFreeTuitionMeetingFor,
  listFreeTuitionApplicationsFor,
  listFreeTuitionAwardsFor,
  listFreeTuitionMeetingsFor,
  listFreeTuitionRoundsFor,
  payFreeTuitionRefundCommand,
  recordFreeTuitionBoardCommand,
  recordFreeTuitionMebbisCommand,
  updateFreeTuitionDocumentsCommand,
} from '../services/finance-free-tuition.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  applicationListResponse,
  applicationParams,
  applicationQuerySchema,
  applicationResponse,
  awardListResponse,
  awardParams,
  awardQuerySchema,
  awardResponse,
  meetingListResponse,
  meetingParams,
  meetingResponse,
  roundListResponse,
  roundParams,
  roundResponse,
} from './finance-free-tuition.schemas.ts'

/**
 * Ücretsiz okutma uçları (docs/domain/finans.md DOM-FIN-026; IST-105; K-268…K-271). Modül
 * `finance`. Gerekçe ve belge hassas olduğundan okuma da yazma da yalnız yöneticidedir
 * (`scholarship.manage`, K-269). Kurul kararı taksit kapatıp iade kaydı açtığı, iade ödemesi para
 * hareketi olduğu için ikisinde `Idempotency-Key` zorunludur; iade ödemesi taze oturum ister.
 */

const ROLE = 'Rol: `yonetici`.'
const BASE = '/api/v1/finance/free-tuition'
const TAG = ['finance-free-tuition']

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceFreeTuitionRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const roles = app.requireRole(WRITE_ACTION_ROLES['scholarship.manage'])
  const read: preValidationAsyncHookHandler[] = [app.authenticate, finance, roles]
  const write = (
    ifMatch: 'reject' | 'required',
    fresh = false,
  ): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    roles,
    ...(fresh ? [app.requireFreshSession] : []),
    ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
    captureInput(),
  ]

  typed.get(
    `${BASE}/rounds`,
    {
      preValidation: read,
      schema: {
        operationId: 'listFreeTuitionRounds',
        tags: TAG,
        summary: 'Ücretsiz okutma dönemlerini listele',
        description: `Dönemleri yeni yıl önce; bugünkü öğrenci sayısı ve en az kontenjan (\`freeQuotaCount\`, %3) canlı hesaplanır, kesinleşen kontenjan ve aday/kabul sayısıyla (DOM-FIN-026, K-268). ${ROLE}`,
        response: { 200: roundListResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listFreeTuitionRoundsFor(contextOf(request)) }),
  )

  typed.post(
    `${BASE}/rounds`,
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'createFreeTuitionRound',
        tags: TAG,
        summary: 'Ücretsiz okutma dönemi aç',
        description: `Eğitim yılı ve öğretimin başladığı günle dönem açar (K-268). Aynı yıl ikinci kez 409 \`free_tuition_round_exists\`. ${ROLE}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: createFreeTuitionRoundSchema,
        response: { 201: roundResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createFreeTuitionRoundCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return roundResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${BASE}/rounds/:roundId/confirm-quota`,
    {
      preValidation: write('required'),
      schema: {
        operationId: 'confirmFreeTuitionQuota',
        tags: TAG,
        summary: 'Ücretsiz okutma kontenjanını kesinleştir',
        description: `Öğrenci sayısı kilit altında yeniden sayılır; kontenjan en az sayının altına inerse 422 \`free_tuition_quota_below_minimum\`, kabul sayısının altına inerse 422 \`free_tuition_quota_below_accepted\` (K-268). \`If-Match\` zorunlu. ${ROLE}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: roundParams,
        body: confirmFreeTuitionQuotaSchema,
        response: { 200: roundResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await confirmFreeTuitionQuotaCommand(
        contextOf(request),
        request.params.roundId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return roundResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${BASE}/rounds/:roundId/applications`,
    {
      preValidation: read,
      schema: {
        operationId: 'listFreeTuitionApplications',
        tags: TAG,
        summary: 'Ücretsiz okutma adaylarını listele',
        description: `Dönemin adayları kayıt sırasıyla; \`status\` süzer (K-269). Başka kurumun dönemi 404. ${ROLE}`,
        params: roundParams,
        querystring: applicationQuerySchema,
        response: { 200: applicationListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listFreeTuitionApplicationsFor(
        contextOf(request),
        request.params.roundId,
        request.query,
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${BASE}/rounds/:roundId/applications`,
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'createFreeTuitionApplication',
        tags: TAG,
        summary: 'Ücretsiz okutma adayı ekle',
        description: `Öğrenci, sabit listeden gerekçe ve teslim edilen belge işaretleriyle aday kaydeder; belgenin kendisi ve serbest metin alınmaz (K-269). Dönemde ikinci başvuru 409 \`free_tuition_application_exists\`, o yıl bursu olan öğrenci 422 \`free_tuition_scholarship_conflict\`, pasif ya da başka kurumun öğrencisi 404. ${ROLE}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: roundParams,
        body: createFreeTuitionApplicationSchema,
        response: { 201: applicationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createFreeTuitionApplicationCommand(
        contextOf(request),
        request.params.roundId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return applicationResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${BASE}/applications/:applicationId/documents`,
    {
      preValidation: write('required'),
      schema: {
        operationId: 'updateFreeTuitionDocuments',
        tags: TAG,
        summary: 'Adayın teslim ettiği belgeleri işaretle',
        description: `Belge işaretlerini bütün olarak yazar; kabul ya da ret almış adayda 409 \`free_tuition_application_decided\` (K-269). \`If-Match\` zorunlu. ${ROLE}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: applicationParams,
        body: updateFreeTuitionDocumentsSchema,
        response: { 200: applicationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateFreeTuitionDocumentsCommand(
        contextOf(request),
        request.params.applicationId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return applicationResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${BASE}/rounds/:roundId/board-meetings`,
    {
      preValidation: read,
      schema: {
        operationId: 'listFreeTuitionBoardMeetings',
        tags: TAG,
        summary: 'Değerlendirme kurulu toplantılarını listele',
        description: `Dönemin toplantıları yeni önce, karar sayılarıyla (K-270). ${ROLE}`,
        params: roundParams,
        response: { 200: meetingListResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await listFreeTuitionMeetingsFor(contextOf(request), request.params.roundId),
    }),
  )

  typed.post(
    `${BASE}/rounds/:roundId/board-meetings`,
    {
      preValidation: write('reject'),
      schema: {
        operationId: 'recordFreeTuitionBoard',
        tags: TAG,
        summary: 'Değerlendirme kurulu kararını kaydet',
        description: `Toplantı günü, üyeler (3–9) ve adaylara kabul/yedek/ret kararı (DOM-FIN-026, K-270). Kabul edilen öğrencinin o yılki ödenmemiş öğrenim taksitleri aynı işlemde kapanır, öğrenim taksitlerine alınmış tutar iade kaydı olur; son gün öğretim başlangıcından iki ay sonradır. Kontenjan kesinleşmemişse 422 \`free_tuition_quota_not_confirmed\`, kabul kontenjanı aşarsa 422 \`free_tuition_quota_exceeded\`, karar verilmiş aday 409 \`free_tuition_application_decided\`, başka dönemin ya da kurumun adayı 404, sözleşmesi yoksa 422 \`free_tuition_contract_missing\`, onay bekleyen ek protokol 409 \`free_tuition_amendment_pending\`, bursu olan 422 \`free_tuition_scholarship_conflict\` (hata yolu kararın satırını gösterir). \`Idempotency-Key\` zorunlu. ${ROLE}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: roundParams,
        body: recordFreeTuitionBoardSchema,
        response: { 201: meetingResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await recordFreeTuitionBoardCommand(
        contextOf(request),
        request.params.roundId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return meetingResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${BASE}/board-meetings/:meetingId`,
    {
      preValidation: read,
      schema: {
        operationId: 'getFreeTuitionBoardMeeting',
        tags: TAG,
        summary: 'Kurul toplantısını ve kararlarını getir',
        description: `Tutanak PDF'inin verisi: toplantı günü, üyeler, adayların adı, gerekçesi, belgeleri ve kararı (K-270). Başka kurumun toplantısı 404. ${ROLE}`,
        params: meetingParams,
        response: { 200: meetingResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getFreeTuitionMeetingFor(contextOf(request), request.params.meetingId),
    }),
  )

  typed.get(
    `${BASE}/awards`,
    {
      preValidation: read,
      schema: {
        operationId: 'listFreeTuitionAwards',
        tags: TAG,
        summary: 'Ücretsiz okutma haklarını listele',
        description: `Haklar iade son gününe göre; \`roundId\`, \`mebbis=unrecorded\` (MEBBİS'e işlenmemişler, K-271) ve \`refundStatus\` süzer. IBAN yalnız son dört hanesiyle döner. ${ROLE}`,
        querystring: awardQuerySchema,
        response: { 200: awardListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listFreeTuitionAwardsFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${BASE}/awards/:awardId/mebbis-record`,
    {
      preValidation: write('required'),
      schema: {
        operationId: 'recordFreeTuitionMebbis',
        tags: TAG,
        summary: "Hakkın MEBBİS'e işlendiğini kaydet",
        description: `İşlendiği günü bir kez kaydeder; MEBBİS'e otomatik gönderim yoktur (IST-143, K-271). Gelecek gün 422 \`free_tuition_date_future\`, kabul gününden önce 422 \`free_tuition_mebbis_before_award\`, ikinci kez 409 \`free_tuition_mebbis_recorded\`. \`If-Match\` zorunlu. ${ROLE}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: awardParams,
        body: freeTuitionMebbisSchema,
        response: { 200: awardResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await recordFreeTuitionMebbisCommand(
        contextOf(request),
        request.params.awardId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return awardResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${BASE}/awards/:awardId/pay-refund`,
    {
      preValidation: write('required', true),
      schema: {
        operationId: 'payFreeTuitionRefund',
        tags: TAG,
        summary: 'Ücretsiz okutma iadesini ödenmiş işaretle',
        description: `Ayrılış iadesinin kurallarıyla (DOM-FIN-041, K-270): hesap sahibi sözleşmedeki ödeyici değilse 422 \`refund_holder_mismatch\`, kurum hesabı geçersizse 422 \`refund_bank_account_invalid\`, ödeme günü kapatılmışsa 422 \`finance_day_closed\`, kabul gününden önce 422 \`free_tuition_refund_before_award\`, iade yoksa 409 \`free_tuition_refund_not_due\`, ödenmişse 409 \`refund_already_paid\`. İade ödeme gününün gün sonuna girer (M-13). Taze oturum; \`If-Match\` ve \`Idempotency-Key\` zorunlu; anahtar kaydı maskeli IBAN ve hesap sahibini saklamaz. ${ROLE}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: awardParams,
        body: payRefundSchema,
        response: { 200: awardResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await payFreeTuitionRefundCommand(
        contextOf(request),
        request.params.awardId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return awardResponse.parse(sendBody(reply, result))
    },
  )
}
