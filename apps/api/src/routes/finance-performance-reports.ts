import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  PERFORMANCE_REPORT_MANAGE_ROLES,
  PERFORMANCE_REPORT_READ_ROLES,
  performanceReportAcknowledgeSchema,
  performanceReportFinalizeSchema,
} from '@kampus/school-core/lib/finance-performance-reports.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  acknowledgePerformanceReportCommand,
  finalizePerformanceReportCommand,
  getPerformanceReportFor,
  getPerformanceReportSummaryFor,
  listPerformanceReportRowsFor,
} from '../services/finance-performance-reports.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  periodParams,
  reportQuery,
  reportResponse,
  reviewParams,
  rowListQuery,
  rowListResponse,
  summaryResponse,
} from './finance-performance-reports.schemas.ts'

/**
 * Personel performans raporu uçları (docs/domain/finans.md DOM-FIN-137; ON-220). Modül `finance`.
 * Dönem özeti, satırlar, kesinleştirme ve "okudum" kaydı yalnız yönetici; rapor okuması yönetici
 * ve personelin kendisi (öğretmen, kesinleşmiş raporu; K-468). Kesinleştirme ve "okudum" kaydı
 * `Idempotency-Key` ister. Rapor ve satır okuması denetime düşer.
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-468; performans raporu kişiseldir). Modül `finance`.'
const PERIODS = '/api/v1/finance/performance-periods'
const REVIEWS = '/api/v1/finance/performance-reviews'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinancePerformanceReportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const managed: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(PERFORMANCE_REPORT_MANAGE_ROLES),
  ]
  const readable: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(PERFORMANCE_REPORT_READ_ROLES),
  ]
  const tags = ['finance-performance-reports']

  typed.get(
    `${PERIODS}/:periodId/report-summary`,
    {
      preValidation: managed,
      schema: {
        operationId: 'getPerformanceReportSummary',
        tags,
        summary: 'Performans döneminin rapor özeti',
        description: `Dönemdeki personel kaydı, genel puan ortalaması (iki ondalık), en düşük ve en yüksek puan, bant dağılımı (\`1\` 1,00–1,99 … \`5\` 5,00; puanı eksik kayıt ayrı), rapora giren gözlem sayısı ve 100'lük ortalaması, öz değerlendirme gönderen, kesinleşen ve okunan rapor sayısı (DOM-FIN-137, K-466). Kişi adı ve kimliği taşımaz, okuma denetime yazılmaz. Başka kurumun dönemi 404. ${MANAGER}`,
        params: periodParams,
        response: { 200: summaryResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getPerformanceReportSummaryFor(contextOf(request), request.params.periodId),
    }),
  )

  typed.get(
    `${PERIODS}/:periodId/reports`,
    {
      preValidation: managed,
      schema: {
        operationId: 'listPerformanceReports',
        tags,
        summary: 'Dönemin personel başına rapor satırları',
        description: `Personel adına göre: genel puan, öz değerlendirme durumu, rapora giren gözlem sayısı ve ortalaması, rapor durumu (kesinleşmedi, kesinleşti, okundu) ve okuma kaydı (K-466). Okuma aynı transaction'da \`finance.performance_report.list\` denetimine (alan adları, satır sayısı) yazılır (K-468). Başka kurumun dönemi 404. ${MANAGER}`,
        params: periodParams,
        querystring: rowListQuery,
        response: { 200: rowListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listPerformanceReportRowsFor(
        contextOf(request),
        request.params.periodId,
        { page, pageSize, q },
      )
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${REVIEWS}/:reviewId/report`,
    {
      preValidation: readable,
      schema: {
        operationId: 'getPerformanceReport',
        tags,
        summary: 'Personel × dönem performans raporu',
        description: `Bölümler (K-466): dönem sonu değerlendirmesi (hedefler, puanlar, genel puan, ara görüşme, personel görüşü), öz değerlendirme özeti (yalnız gönderildiyse soru ve cevaplar, puanlı soruların ortalaması, yönetici görüşü), dönemdeki tamamlanmış ders gözlemleri (döneme bağlı ya da günü dönem içinde; kesinleşmiş raporda kesinleştirme anına kadar tamamlananlar) ve puan ortalaması, döneme bağlı gelişim hedefleri (açık, sürüyor, ulaşıldı; kesinleşmiş raporda kesinleştirme anındaki durumuyla, K-468), yönetici görüşü; kesinleştirme ve "okudum" kaydı. Çok kaynaklı geri bildirim bölümü sonraki işte eklenir (\`sections\`). Her okuma aynı transaction'da denetime yazılır: \`purpose=view\` \`finance.performance_report.read\`, \`purpose=pdf\` \`finance.performance_report.export\` (alan adları; K-468). Rol: \`yonetici\` her raporu, \`ogretmen\` yalnız kendi kesinleşmiş raporunu okur; başka personelin ya da kesinleşmemiş rapor 404. Başka kurumun kaydı 404. Modül \`finance\`.`,
        params: reviewParams,
        querystring: reportQuery,
        response: { 200: reportResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getPerformanceReportFor(
        contextOf(request),
        request.params.reviewId,
        request.query.purpose,
      ),
    }),
  )

  typed.post(
    `${REVIEWS}/:reviewId/report/finalize`,
    {
      preValidation: [...managed, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'finalizePerformanceReport',
        tags,
        summary: 'Performans raporunu kesinleştir',
        description: `Yönetici görüşüyle (10–2000) raporu kesinleştirir (K-467). Dönem kapanmamışsa 422 \`performance_report_period_open\`, rapor zaten kesinleştiyse 409 \`performance_report_finalized\`, raporun sahibi yöneticinin kendisiyse 422 \`performance_report_self\`. Kesinleşen raporun görüşü değişmez; rapora kesinleştirme anına kadar tamamlanan gözlemler girer. Görüş metni denetime yazılmaz. \`Idempotency-Key\` zorunlu. Başka kurumun kaydı 404. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: reviewParams,
        body: performanceReportFinalizeSchema,
        response: { 201: reportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await finalizePerformanceReportCommand(
        contextOf(request),
        request.params.reviewId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return reportResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${REVIEWS}/:reviewId/report/acknowledge`,
    {
      preValidation: [...managed, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'acknowledgePerformanceReport',
        tags,
        summary: 'Personelin "okudum" kaydını gir',
        description: `Yönetici personelin raporu okuduğunu kanalıyla (\`paper\` ıslak imzalı nüsha, \`email\` e-posta, \`in_person\` yüz yüze görüşme) ve günüyle personel adına girer (K-467). Kesinleşmemiş rapor 422 \`performance_report_not_finalized\`, kayıt zaten girildiyse 409 \`performance_report_acknowledged\`; gün bugünden sonra 422 \`performance_report_ack_date_future\`, kesinleştirme gününden önce 422 \`performance_report_ack_before_final\`. \`Idempotency-Key\` zorunlu. Başka kurumun kaydı 404. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: reviewParams,
        body: performanceReportAcknowledgeSchema,
        response: { 200: reportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await acknowledgePerformanceReportCommand(
        contextOf(request),
        request.params.reviewId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return reportResponse.parse(sendBody(reply, result))
    },
  )
}
