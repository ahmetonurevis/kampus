import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  SGK_PREPARATION_ROLES,
  sgkEmploymentDatesInputSchema,
  sgkMissingDayInputSchema,
} from '@kampus/school-core/lib/finance-sgk-preparation.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveSgkEmploymentDatesCommand,
  archiveSgkMissingDayCommand,
  createSgkEmploymentDatesCommand,
  createSgkMissingDayCommand,
  sgkPreparationCsvFor,
  sgkPreparationFor,
} from '../services/finance-sgk-preparation.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  sgkArchiveResponse,
  sgkEmploymentDatesResponse,
  sgkEntryParams,
  sgkMissingDayResponse,
  sgkPreparationQuery,
  sgkPreparationResponse,
} from './finance-sgk-preparation.schemas.ts'

/**
 * SGK bildirge hazırlık listesi uçları (docs/domain/finans.md DOM-FIN-107; ON-203). Modül
 * `finance`; yalnız yönetici (K-355). Liste resmî sisteme gönderilmez (IST-143). Ekran okuması,
 * CSV ve PDF verisi denetime düşer; CSV ve PDF taze oturum ister, kullanıcı başına 10/dk. Elle
 * eksik gün ve giriş/çıkış satırları düzeltilmez: yazılır ya da `If-Match` ile kaldırılır.
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-355). Modül `finance`.'
const LIST_URL = '/api/v1/finance/sgk-preparation'
const MISSING_URL = '/api/v1/finance/sgk-missing-days'
const DATES_URL = '/api/v1/finance/sgk-employment-dates'
const EXPORTS_PER_MINUTE = 10
const READS_PER_MINUTE = 300

const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')
/** CSV ya da PDF verisi (sorgu ayrıştırılmadan önce ham sorgudan). */
const isExport = (request: FastifyRequest) =>
  wantsCsv(request) || (request.query as { purpose?: unknown } | undefined)?.purpose === 'pdf'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceSgkPreparationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(SGK_PREPARATION_ROLES),
  ]
  const freshForExport: preValidationAsyncHookHandler = async function (request, reply) {
    if (isExport(request)) await app.requireFreshSession.call(app, request, reply)
  }
  const tags = ['finance-sgk-preparation']

  typed.get(
    LIST_URL,
    {
      config: {
        rateLimit: {
          max: (request: FastifyRequest) =>
            isExport(request) ? EXPORTS_PER_MINUTE : READS_PER_MINUTE,
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            isExport(request)
              ? `sgk-preparation-export:${request.auth?.userId ?? request.ip}`
              : request.ip,
        },
      },
      preValidation: [...guarded, freshForExport],
      schema: {
        operationId: 'getFinanceSgkPreparation',
        tags,
        summary: 'SGK bildirge hazırlık listesi',
        description: `Ay (\`month\`, \`YYYY-MM\`) için mali müşavire ya da bordrocuya kontrol listesi (DOM-FIN-107); Muhtasar ve Prim Hizmet Beyannamesi değildir, hiçbir resmî sisteme gönderilmez (IST-143). Personel: ayda ana ücret tanımı (DOM-FIN-099) yürürlükte olan ya da o ay elle eksik gün veya giriş/çıkış satırı bulunan yönetici, öğretmen ve ön büro üyelikleri (pasif dahil), ada göre. İşe giriş/çıkış günü ana ücret tanımlarının kesintisiz zincirinden (ücret değişikliği sayılmaz), elle girilen gün önceliklidir (K-352). Prim günü tam ayda 30, ay içi giriş/çıkışta takvim günü (en çok 30), eksi elle eksik gün; birden fazla neden kodu 12 (kısa çalışma 27, yarım çalışma 24) (K-353). SGK matrahı tahmini (aylık brüt ana ücret + nakdi yan haklar) × prim günü / 30; ayni yan hak ve ek ders girmez; taban ve tavan ayın ilk günündeki bordro parametre setinden (DOM-FIN-100) gün oranlı, tabanın altı yükseltilir, tavanın üstü kesilir; ana ücret aylık brüt değilse \`null\` (K-354). Uyarılar kod olarak döner. Kimlik numarası tutulmaz. Set yoksa 422 \`payroll_parameters_missing\`. Her okuma denetime düşer: ekran \`finance.sgk_preparation.read\`, \`purpose=pdf\` ve \`Accept: text/csv\` \`finance.sgk_preparation_export\` (yalnız alan adları; K-355). CSV: \`;\` ayırıcı, UTF-8 BOM, ondalık virgül, formül kaçışı, kimlik sütunu boş. PDF verisi ve CSV taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk. ${MANAGER}`,
        querystring: sgkPreparationQuery,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur.
        response: { 200: sgkPreparationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const { month, purpose } = request.query
      if (wantsCsv(request)) {
        const { csv, filename } = await sgkPreparationCsvFor(ctx, month)
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      return { data: await sgkPreparationFor(ctx, month, purpose) }
    },
  )

  typed.post(
    MISSING_URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createSgkMissingDay',
        tags,
        summary: 'Eksik gün satırı ekle',
        description: `Personelin ay için eksik günü (1–30) ve isteğe bağlı neden kodu (birleşik kodlar 12, 24, 27 seçilmez; boşsa listede "neden girilmemiş" uyarısı) (K-353). Aynı ayda birden çok satır olabilir; ayın toplamı 30'u aşarsa 422 \`sgk_missing_days_exceed_month\`. Olmayan üyelik 422 \`sgk_staff_not_found\`, öğrenci ya da veli 422 \`sgk_not_staff\`. Not tanı içermez. Sağlık raporu ve izinlerden besleme yoktur. Denetim kaydına alan adları yazılır. \`Idempotency-Key\` isteğe bağlı. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: sgkMissingDayInputSchema,
        response: { 201: sgkMissingDayResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createSgkMissingDayCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = sgkMissingDayResponse.parse(sendBody(reply, result))
      reply.header('location', `${MISSING_URL}/${body.data.id}`)
      return body
    },
  )

  typed.delete(
    `${MISSING_URL}/:entryId`,
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'archiveSgkMissingDay',
        tags,
        summary: 'Eksik gün satırını kaldır',
        description: `Satır arşivlenir; listeye ve ay toplamına girmez. Olmayan, kaldırılmış ya da başka kurumun satırı 404; \`If-Match\` zorunlu, sürüm tutmazsa 409. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: sgkEntryParams,
        response: { 200: sgkArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveSgkMissingDayCommand(
        contextOf(request),
        request.params.entryId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return sgkArchiveResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    DATES_URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createSgkEmploymentDates',
        tags,
        summary: 'Elle giriş/çıkış günü gir',
        description: `Personelin ay içindeki işe giriş ve/veya işten çıkış günü; ücret tanımından çıkan günün yerine geçer (K-352). En az biri; günler ayın içinde, çıkış girişten önce olamaz (400). Ayda tek etkin satır: varsa 409 \`sgk_employment_dates_exist\` (önce kaldırılır). Olmayan üyelik 422 \`sgk_staff_not_found\`, öğrenci ya da veli 422 \`sgk_not_staff\`. Resmî işe giriş/ayrılış bildirgesi değildir. \`Idempotency-Key\` isteğe bağlı. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: sgkEmploymentDatesInputSchema,
        response: { 201: sgkEmploymentDatesResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createSgkEmploymentDatesCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      const body = sgkEmploymentDatesResponse.parse(sendBody(reply, result))
      reply.header('location', `${DATES_URL}/${body.data.id}`)
      return body
    },
  )

  typed.delete(
    `${DATES_URL}/:entryId`,
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'archiveSgkEmploymentDates',
        tags,
        summary: 'Elle giriş/çıkış gününü kaldır',
        description: `Satır arşivlenir; giriş/çıkış yeniden ücret tanımından çıkar. Olmayan, kaldırılmış ya da başka kurumun satırı 404; \`If-Match\` zorunlu, sürüm tutmazsa 409. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: sgkEntryParams,
        response: { 200: sgkArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveSgkEmploymentDatesCommand(
        contextOf(request),
        request.params.entryId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return sgkArchiveResponse.parse(sendBody(reply, result))
    },
  )
}
