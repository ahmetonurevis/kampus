import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_MEDICAL_REPORT_ROLES,
  medicalReportCancelSchema,
  medicalReportInputSchema,
  medicalReportUpdateSchema,
} from '@kampus/school-core/lib/finance-medical-reports.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelMedicalReportCommand,
  createMedicalReportCommand,
  listMedicalReportsFor,
  medicalReportSummaryFor,
  updateMedicalReportCommand,
} from '../services/finance-medical-reports.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  medicalReportListQuery,
  medicalReportListResponse,
  medicalReportParams,
  medicalReportResponse,
  medicalReportSummaryQuery,
  medicalReportSummaryResponse,
} from './finance-medical-reports.schemas.ts'

/**
 * Personel sağlık raporu uçları (docs/domain/finans.md DOM-FIN-110; ON-185). Modül `finance`;
 * okuma ve yazma yalnız yönetici (K-363). Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 →
 * işlem. Rapor düzeltilmez: `PATCH` yalnız işaret ve dosyayı değiştirir, `…/cancel` gerekçeyle
 * iptal eder (K-364, K-365).
 */

const MANAGER =
  'Rol: yalnız `yonetici` (K-363; muhasebe rolü açılsa da sağlık raporu görmez). Modül `finance`.'
const URL = '/api/v1/finance/medical-reports'
const SUMMARY_URL = '/api/v1/finance/medical-report-summary'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceMedicalReportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_MEDICAL_REPORT_ROLES),
  ]
  const tags = ['finance-medical-reports']

  typed.get(
    URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listMedicalReports',
        tags,
        summary: 'Sağlık raporları',
        description: `Personel istirahat raporları, en yeni başlangıç önce. \`from\`/\`to\` verilirse dönemle kesişen raporlar ve satırda döneme düşen gün (\`daysInPeriod\`); yalnız biri verilirse eksik uç ayın başı ya da sonudur, dönem en çok 366 gün (422 \`medical_report_period_too_long\`, sonu başından önce 422 \`medical_report_period_invalid\`). \`state=cancelled\` iptal edilmiş raporları gerekçesiyle verir. Tanı tutulmaz (K-363). Sağlık verisi olduğu için her okuma denetim kaydına \`finance.medical_report.read\` olarak düşer (yalnız alan adları). ${MANAGER}`,
        querystring: medicalReportListQuery,
        response: { 200: medicalReportListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total, period } = await listMedicalReportsFor(
        contextOf(request),
        request.query,
      )
      return { data: items, meta: { page, pageSize, total, period } }
    },
  )

  typed.get(
    SUMMARY_URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getMedicalReportSummary',
        tags,
        summary: 'Dönem rapor günü özeti',
        description: `Bordro girdisi: kurumun personeli (yönetici, öğretmen, ön büro; pasif dahil) ada göre, her satırda dönemde (\`from\`–\`to\`, varsayılan bugünün ayı, en çok 366 gün) iptal edilmemiş raporların döneme düşen takvim günü, türe göre gün, rapor sayısı ve işareti eksik rapor sayısı. \`withReports=true\` yalnız dönemde raporu olan personeli verir. SGK ödeneği ve bordro kesintisi hesaplanmaz (K-365). Her okuma denetim kaydına \`finance.medical_report.read\` olarak düşer. ${MANAGER}`,
        querystring: medicalReportSummaryQuery,
        response: { 200: medicalReportSummaryResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, from, to, withReports } = request.query
      const { items, total, period } = await medicalReportSummaryFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        from,
        to,
        withReports: withReports === 'true',
      })
      return { data: items, meta: { page, pageSize, total, period } }
    },
  )

  typed.post(
    URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createMedicalReport',
        tags,
        summary: 'Sağlık raporu gir',
        description: `Personel (kurum üyeliği), rapor türü (\`sickness\` istirahat, \`work_accident\` iş kazası, \`occupational_disease\` meslek hastalığı, \`maternity\` analık), başlangıç–bitiş günü (dahil; bitiş başlangıçtan önce ya da rapor 366 günden uzunsa 400), isteğe bağlı veren kurum türü ve rapor dosyası (\`POST /files\`, \`purpose: document\`, PDF; yükleyen yönetici bağlar: başkasının ya da başka kurumun dosyası 422 \`file_unavailable\`, başka kayda bağlı 409 \`file_already_attached\`). Tanı, hastalık adı, ICD kodu ve not alanı yoktur; bilinmeyen alan 400 (K-363). Gün sayısı takvim günüdür. Aynı personelin iptal edilmemiş raporuyla bir gün bile kesişirse 422 \`medical_report_overlap\`; başlangıç bugünden 180 günden ileride 422 \`medical_report_start_too_far\`; pasif personelde ayrıldığı günden sonra başlarsa 422 \`medical_report_after_leave\` (K-364). Olmayan ya da başka kurumun üyeliği 422 \`medical_report_staff_not_found\`, öğrenci ya da veli 422 \`medical_report_not_staff\`. Denetim kaydına yalnız alan adları yazılır. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: medicalReportInputSchema,
        response: { 201: medicalReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createMedicalReportCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return medicalReportResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${URL}/:reportId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateMedicalReport',
        tags,
        summary: 'Rapor işaretlerini ya da dosyasını değiştir',
        description: `Yalnız "işverene bildirildi" (\`employerNotified\`), "SGK sisteminde onaylandı" (\`sgkApproved\`; e-Rapor onayı işverence SGK'da yapılır, burada yalnız işaretlenir) ve rapor dosyası (\`fileId\`; \`null\` kaldırır) değişir; tarih ve tür değişmez, yanlışsa rapor iptal edilip yeniden girilir (K-364, K-365). SGK onayı bildirim işaretini ister (422 \`medical_report_sgk_requires_notice\`); işaretler geri alınabilir, işaretleyen ve an saklanır. Değişiklik yoksa 422 \`medical_report_unchanged\`, iptal edilmiş rapor 422 \`medical_report_cancelled\`. \`If-Match\` zorunlu, sürüm tutmazsa 409. Başka kurumun raporu 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: medicalReportParams,
        body: medicalReportUpdateSchema,
        response: { 200: medicalReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateMedicalReportCommand(
        contextOf(request),
        request.params.reportId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return medicalReportResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/:reportId/cancel`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelMedicalReport',
        tags,
        summary: 'Sağlık raporunu iptal et',
        description: `Yanlış kayıt gerekçeyle (5–500 karakter; tanı yazılmaz) iptal edilir; rapor silinmez, gün hesabına ve çakışma denetimine girmez. Rapor dosyasının bağı kalkar (bağsız dosya 24 saat sonra silinir; K-363). İkinci iptal 422 \`medical_report_cancelled\`. Gerekçe denetim kaydına yazılmaz. \`If-Match\` ve \`Idempotency-Key\` zorunlu. Başka kurumun raporu 404. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: medicalReportParams,
        body: medicalReportCancelSchema,
        response: { 200: medicalReportResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await cancelMedicalReportCommand(
        contextOf(request),
        request.params.reportId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return medicalReportResponse.parse(sendBody(reply, result))
    },
  )
}
