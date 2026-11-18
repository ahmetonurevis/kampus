import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  FINANCE_PAYROLL_EXPORT_ROLES,
  payrollLessonHoursInputSchema,
  payrollLessonHoursUpdateSchema,
  setPayrollExportProfileSchema,
} from '@kampus/school-core/lib/finance-payroll-exports.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveLessonHoursCommand,
  createLessonHoursCommand,
  payrollExportFileFor,
  payrollExportHistoryFor,
  payrollExportPreviewFor,
  payrollExportProfileFor,
  setPayrollExportProfileCommand,
  updateLessonHoursCommand,
} from '../services/finance-payroll-exports.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  lessonHoursArchiveResponse,
  lessonHoursParams,
  lessonHoursResponse,
  payrollExportBody,
  payrollHistoryQuery,
  payrollHistoryResponse,
  payrollMonthQuery,
  payrollPreviewResponse,
  payrollProfileResponse,
} from './finance-payroll-exports.schemas.ts'

/**
 * Bordro programına aktarım uçları (docs/domain/finans.md DOM-FIN-105; ON-202). Modül
 * `finance`; okuma ve yazma yalnız yönetici (K-306, K-338). Kampüs bordro hesaplamaz: önizleme
 * ve dosya ayın girdi satırlarıdır. Dosya taze oturum ister, kullanıcı başına 10/dk; her üretim
 * özet satırı ve denetim kaydı yazar. Sıra: 401 → 403 modül → 403 rol → (taze oturum) →
 * `If-Match` → 400 → işlem.
 */

const MANAGER =
  'Rol: yalnız `yonetici` (K-306, K-338; muhasebe rolü açılsa da ücret görmez). Modül `finance`.'
const BASE = '/api/v1/finance'
const EXPORTS = `${BASE}/payroll-exports`
const HOURS = `${BASE}/payroll-lesson-hours`
const PROFILE = `${BASE}/payroll-export-profile`

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

/** Sayaç doğrulanmış kullanıcıyadır; istemcinin değiştirebildiği başlığa bağlanmaz. */
function exportRateKey(request: FastifyRequest): string {
  return request.auth?.userId ?? request.ip
}

export function registerFinancePayrollExportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_PAYROLL_EXPORT_ROLES),
  ]
  const tags = ['finance-payroll-exports']

  typed.get(
    `${EXPORTS}/preview`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'previewPayrollExport',
        tags,
        summary: 'Bordro girdi önizlemesi',
        description: `Seçilen ayın bordro girdi satırları (DOM-FIN-105). Kampüs bordro hesaplamaz (ON-193). Ana ücret ve yan hak: ayla kesişen her ücret tanımı (DOM-FIN-099) bir satırdır; ay içinde başlayan ya da biten tanım ay içindeki başlangıç/bitiş gününü ve gün sayısını taşır, tutarı orantılanmaz ve boş kalır; saatlik ve ders saati ana ücretinde çalışılan saat bilinmediği için tutar boştur; aylık net ücret brüte çevrilmez (K-336). Ek ders: ay için girilen her saat kaydı bir satırdır, tutar saat × o türün ayla kesişen en geç başlayan ek ders ücretidir; tanım yoksa tutar boş (K-337). Satır yönü bugün yalnız \`earning\`; avans ve kesintiler (ON-199) \`deduction\` satırı olarak eklenecek. Tutar içerdiği için her okuma denetim kaydına \`finance.payroll_export.read\` olarak düşer (yalnız alan adı). ${MANAGER}`,
        querystring: payrollMonthQuery,
        response: { 200: payrollPreviewResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await payrollExportPreviewFor(contextOf(request), request.query.month),
    }),
  )

  typed.post(
    EXPORTS,
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: exportRateKey,
        },
      },
      preValidation: [...guarded, app.requireFreshSession, rejectIfMatch()],
      schema: {
        operationId: 'createPayrollExport',
        tags,
        summary: 'Bordro girdi dosyasını üret',
        description: `Önizlemeyle aynı satırlardan CSV üretir: kurumun sütun eşleme şablonu varsa onun ayırıcısı, ondalık işareti, tarih biçimi ve sütun adı/sırası; yoksa genel dosya (UTF-8 BOM, \`;\` ayırıcı, ondalık virgül, ISO gün, bütün sütunlar). Metin hücreleri formül kaçışlıdır; boş tutar boş hücredir. Belirli bir bordro programının hazır biçimi değildir (K-339). Personel kimlik numarası sütunu yoktur: personel kimlik verisi Kampüs'te tutulmaz, "Personel no" kurum üyeliğidir. Her üretim aynı işlemde özet satırı (ay, biçim, satır ve personel sayısı, toplamlar, dosyanın SHA-256 özeti) ve \`finance.payroll_export.create\` denetimi yazar; dosya saklanmaz. Dönem kilidi yoktur, aynı ay yeniden üretilebilir (K-338). Taze oturum ister: eskiyse 403 \`reauthentication_required\`; kullanıcı başına 10/dk. ${MANAGER}`,
        body: payrollExportBody,
        response: { 200: z.string().describe('CSV dosyası'), ...commandErrors },
      },
    },
    async (request, reply) => {
      const { body, fileName, exportId } = await payrollExportFileFor(
        contextOf(request),
        request.body.month,
      )
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${fileName}"`)
        .header('x-kampus-export-id', exportId)
        .serializer((payload: unknown) => String(payload))
        .send(body)
    },
  )

  typed.get(
    EXPORTS,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listPayrollExports',
        tags,
        summary: 'Bordro girdi dosyası üretim geçmişi',
        description: `Her üretimin özeti, yeni önce: ay, biçim, satır ve personel sayısı, kazanç ve kesinti toplamı, tutarı boş satır sayısı, dosyanın SHA-256 özeti, üreten ve an (K-338). Ücret satırı dönmez. \`month\` ile süzülür. ${MANAGER}`,
        querystring: payrollHistoryQuery,
        response: { 200: payrollHistoryResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, month } = request.query
      const { items, total } = await payrollExportHistoryFor(contextOf(request), {
        page,
        pageSize,
        month,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    HOURS,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createPayrollLessonHours',
        tags,
        summary: 'Ek ders saati gir',
        description: `Ders saati özeti (OG-116) gelene kadar ay için elle girilen ek ders saati: personel, ay (\`YYYY-AA\`), tür (\`extra\` ek ders, \`duty\` nöbet) ve ayın toplam saati (tam sayı, 1–400), isteğe bağlı not (K-337). Ay içinde ayrılan (pasif) personele de girilir. Olmayan ya da başka kurumun üyeliği 422 \`payroll_lesson_hours_staff_not_found\`, öğrenci ya da veli 422 \`payroll_lesson_hours_not_staff\`, gelecek ay 422 \`payroll_lesson_hours_future_month\`; aynı personel, ay ve türde kayıt varsa 409 \`payroll_lesson_hours_exist\` (kayıt düzeltilir). Denetim kaydına alan adları yazılır. \`Idempotency-Key\` isteğe bağlı. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: payrollLessonHoursInputSchema,
        response: { 201: lessonHoursResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createLessonHoursCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = lessonHoursResponse.parse(sendBody(reply, result))
      reply.header('location', `${HOURS}/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    `${HOURS}/:entryId`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updatePayrollLessonHours',
        tags,
        summary: 'Ek ders saatini düzelt',
        description: `Saat ya da not düzeltilir; değişiklik yoksa 422 \`payroll_lesson_hours_unchanged\`. \`If-Match\` zorunlu, sürüm tutmazsa 409. Olmayan, silinmiş ya da başka kurumun kaydı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: lessonHoursParams,
        body: payrollLessonHoursUpdateSchema,
        response: { 200: lessonHoursResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateLessonHoursCommand(
        contextOf(request),
        request.params.entryId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return lessonHoursResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${HOURS}/:entryId`,
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'archivePayrollLessonHours',
        tags,
        summary: 'Ek ders saatini sil',
        description: `Kayıt arşivlenir; dosyaya girmez, aynı ay ve türde yeni kayıt açılabilir. \`If-Match\` zorunlu, sürüm tutmazsa 409. Olmayan ya da başka kurumun kaydı 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: lessonHoursParams,
        response: { 200: lessonHoursArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveLessonHoursCommand(
        contextOf(request),
        request.params.entryId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return lessonHoursArchiveResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    PROFILE,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getPayrollExportProfile',
        tags,
        summary: 'Bordro dosyası sütun eşleme şablonu',
        description: `Kurumun ayırıcı, ondalık, tarih biçimi ve sütun adı/sırası ayarı (K-339). Satır yoksa \`profile\` boştur ve genel dosya iner. ${MANAGER}`,
        response: { 200: payrollProfileResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await payrollExportProfileFor(contextOf(request)) }),
  )

  typed.patch(
    PROFILE,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'setPayrollExportProfile',
        tags,
        summary: 'Bordro dosyası sütun eşleme şablonunu kaydet',
        description: `Şablonu yazar; \`profile: null\` genel dosyaya döner. Sütun kaynağı dosyanın alanlarından biri ya da \`fixed\` sabit değerdir (ör. şube kodu); başlıklar tekil, ayırıcı ondalıkla aynı olamaz (400). Şablon yalnız biçimi belirler, satırları ve toplamları değiştirmez; hazır bordro programı şablonu yoktur (K-339). \`If-Match\` zorunlu; sürüm tutmazsa 409. Denetim kaydına alan adı yazılır. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        body: setPayrollExportProfileSchema,
        response: { 200: payrollProfileResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await setPayrollExportProfileCommand(
        contextOf(request),
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return payrollProfileResponse.parse(sendBody(reply, result))
    },
  )
}
