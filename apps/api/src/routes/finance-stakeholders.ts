import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  STAKEHOLDER_ROLES,
  stakeholderAgreementSchema,
  stakeholderSchema,
  terminateStakeholderAgreementSchema,
  updateStakeholderAgreementSchema,
  updateStakeholderSchema,
} from '@kampus/school-core/lib/finance-stakeholders.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  activateAgreementCommand,
  agreementsCsvFor,
  archiveAgreementCommand,
  createAgreementCommand,
  createStakeholderCommand,
  getAgreementFor,
  getStakeholderFor,
  listAgreementsFor,
  listStakeholdersFor,
  stakeholdersCsvFor,
  terminateAgreementCommand,
  updateAgreementCommand,
  updateStakeholderCommand,
} from '../services/finance-stakeholders.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  agreementArchiveResponse,
  agreementListQuery,
  agreementListResponse,
  agreementParams,
  agreementResponse,
  stakeholderListQuery,
  stakeholderListResponse,
  stakeholderParams,
  stakeholderResponse,
} from './finance-stakeholders.schemas.ts'

/**
 * Paydaş ve sponsor uçları (docs/domain/finans.md DOM-FIN-102; ON-262). Modül `finance`; okuma ve
 * yazma yalnız yönetici (K-317). Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem.
 * Paydaş silinmez (`PATCH` `isActive: false`); yalnız taslak anlaşma silinir. Paydaş ve anlaşma
 * açılışı `Idempotency-Key` ister (sözleşme oluşturma). CSV'ler iletişim bilgisi taşımaz:
 * kullanıcı başına 10/dk ve denetim kaydı, taze oturum istemez.
 */

const MANAGER = 'Rol: `yonetici` (muhasebe rolü açılınca o da; K-317). Modül `finance`.'
const STAKEHOLDERS = '/api/v1/finance/stakeholders'
const AGREEMENTS = '/api/v1/finance/stakeholder-agreements'
const CSV_PER_MINUTE = 10
const READS_PER_MINUTE = 300
const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

function sendCsv(reply: FastifyReply, csv: string, filename: string) {
  return reply
    .type('text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .serializer((payload: unknown) => String(payload))
    .send(`\uFEFF${csv}`)
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

export function registerFinanceStakeholderRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const managers: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(STAKEHOLDER_ROLES),
  ]
  const tags = ['finance-stakeholders']

  typed.get(
    STAKEHOLDERS,
    {
      config: csvRateLimit('stakeholder-csv'),
      preValidation: managers,
      schema: {
        operationId: 'listStakeholders',
        tags,
        summary: 'Paydaşları ve sponsorları listele',
        description: `Etkinler önce, ada göre; pasifler dahil (DOM-FIN-102). \`q\` ad, VKN ve iletişim kişisinin adında arar; \`type\`, \`status\`, \`tag\` ve \`renewalDue=true\` (yenileme uyarısında anlaşması olan) süzer. Satırda yürürlükteki ve yenileme uyarısındaki anlaşma sayıları vardır (K-319). İletişim e-postası ve telefonu maskelidir (K-317). \`Accept: text/csv\` süzgeçle eşleşen bütün paydaşları iletişim bilgisi olmadan verir (\`;\`, UTF-8 BOM, formül kaçışı); kullanıcı başına 10/dk, denetim \`finance.stakeholder_export\`. ${MANAGER}`,
        querystring: stakeholderListQuery,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur.
        response: { 200: stakeholderListResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const { page, pageSize, renewalDue, ...filters } = request.query
      const query = { ...filters, renewalDue: renewalDue === 'true' }
      if (wantsCsv(request)) {
        const { csv, filename } = await stakeholdersCsvFor(ctx, query)
        return sendCsv(reply as FastifyReply, csv, filename)
      }
      const { items, total } = await listStakeholdersFor(ctx, { page, pageSize, ...query })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    STAKEHOLDERS,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStakeholder',
        tags,
        summary: 'Paydaş ekle',
        description: `Kurum adı, tür (\`sponsor\`, \`partner\`, \`corporate\`, \`university\`, \`municipality_ngo\`, \`parent_association\`), isteğe bağlı VKN (10 hane, kontrol hanesi denetlenir), iletişim kişisi (ad, e-posta, telefon) ve etiketler (en çok 10; küçük harfe çevrilir). VKN kurumda tekil: 409 \`stakeholder_tax_number_exists\` (K-316). Gövdedeki \`institutionId\` 400. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: stakeholderSchema,
        response: { 201: stakeholderResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStakeholderCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = stakeholderResponse.parse(sendBody(reply, result))
      reply.header('location', `${STAKEHOLDERS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${STAKEHOLDERS}/:stakeholderId`,
    {
      preValidation: managers,
      schema: {
        operationId: 'getStakeholder',
        tags,
        summary: 'Paydaş ayrıntısı',
        description: `Tam iletişim bilgisi (K-317). Anlaşmalar \`GET /finance/stakeholder-agreements?stakeholderId=\` ile okunur. Olmayan ya da başka kurumun paydaşı 404. ${MANAGER}`,
        params: stakeholderParams,
        response: { 200: stakeholderResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getStakeholderFor(contextOf(request), request.params.stakeholderId),
    }),
  )

  typed.patch(
    `${STAKEHOLDERS}/:stakeholderId`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateStakeholder',
        tags,
        summary: 'Paydaşı düzelt ya da pasifleştir',
        description: `Verilen alanlar değişir; etiket listesi bütün olarak yazılır. \`isActive: false\` pasifleştirir (pasif paydaşla anlaşma açılmaz, taslak yürürlüğe alınmaz; yürürlükteki anlaşmalar sürer), \`true\` yeniden etkinleştirir; paydaş silinmez (K-316). Değişiklik yoksa 422 \`stakeholder_unchanged\`, başka paydaşın VKN'si 409 \`stakeholder_tax_number_exists\`, sürüm tutmazsa 409 \`version_conflict\`. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: stakeholderParams,
        body: updateStakeholderSchema,
        response: { 200: stakeholderResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateStakeholderCommand(
        contextOf(request),
        request.params.stakeholderId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return stakeholderResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${STAKEHOLDERS}/:stakeholderId/agreements`,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStakeholderAgreement',
        tags,
        summary: 'İş birliği ya da sponsorluk anlaşması aç',
        description: `Anlaşma taslak olarak açılır (K-318): konu, başlangıç–bitiş (bitiş başlangıçtan önce 422 \`stakeholder_agreement_dates_invalid\`), yenileme bildirim günü (0–365, varsayılan 30), katkı türü (\`cash\` nakdide tutar zorunlu: 422 \`stakeholder_agreement_amount_required\`; \`in_kind\` ve \`service\` için açıklama zorunlu: 422 \`stakeholder_agreement_description_required\`, tutar tahmini değerdir), karşılıklar ve sözleşme dosyası (\`POST /files\`, \`purpose: document\`, PDF; yükleyen yönetici bağlar: başkasının ya da başka kurumun dosyası 422 \`file_unavailable\`, başka kayda bağlı 409 \`file_already_attached\`). Pasif paydaş 422 \`stakeholder_inactive\`; olmayan ya da başka kurumun paydaşı 404. Sponsor katkısı bağış ya da tahsilat kaydı açmaz. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: stakeholderParams,
        body: stakeholderAgreementSchema,
        response: { 201: agreementResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createAgreementCommand(
        contextOf(request),
        request.params.stakeholderId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = agreementResponse.parse(sendBody(reply, result))
      reply.header('location', `${AGREEMENTS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    AGREEMENTS,
    {
      config: csvRateLimit('stakeholder-agreement-csv'),
      preValidation: managers,
      schema: {
        operationId: 'listStakeholderAgreements',
        tags,
        summary: 'Paydaş anlaşmalarını listele',
        description: `Yeni başlangıç önce; \`expiringWithinDays\` ya da \`renewalDue=true\` verilince bitişi en yakın önce. Durum her okumada hesaplanır: yürürlükteki anlaşmanın bitiş günü bugünden (Europe/Istanbul) önceyse \`ended\` (K-318). \`expiringWithinDays=N\` bitişi bugün dahil N gün içindeki yürürlükteki anlaşmaları, \`renewalDue=true\` bitişe kalan günü bildirim gününe eşit ya da az olanları verir (K-319; rozet sayısı \`meta.total\`). \`stakeholderId\`, \`status\`, \`q\` (konu ve paydaş adı) süzer. Arka plan bildirimi gönderilmez. \`Accept: text/csv\` süzgeçle eşleşen bütün anlaşmaları verir; kullanıcı başına 10/dk, denetim \`finance.stakeholder_agreement_export\`. ${MANAGER}`,
        querystring: agreementListQuery,
        response: { 200: agreementListResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const { page, pageSize, renewalDue, ...filters } = request.query
      const query = { ...filters, renewalDue: renewalDue === 'true' }
      if (wantsCsv(request)) {
        const { csv, filename } = await agreementsCsvFor(ctx, query)
        return sendCsv(reply as FastifyReply, csv, filename)
      }
      const { items, total } = await listAgreementsFor(ctx, { page, pageSize, ...query })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${AGREEMENTS}/:agreementId`,
    {
      preValidation: managers,
      schema: {
        operationId: 'getStakeholderAgreement',
        tags,
        summary: 'Anlaşma ayrıntısı',
        description: `Anlaşma, hesaplanan durum ve yenileme günü, sözleşme dosyasının adı ve fesih gerekçesi. Olmayan, silinmiş ya da başka kurumun anlaşması 404. ${MANAGER}`,
        params: agreementParams,
        response: { 200: agreementResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getAgreementFor(contextOf(request), request.params.agreementId),
    }),
  )

  typed.patch(
    `${AGREEMENTS}/:agreementId`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateStakeholderAgreement',
        tags,
        summary: 'Anlaşmayı düzelt',
        description: `Verilen alanlar değişir; birleşik değer açılıştaki kurallardan geçer. Taslak, yürürlükteki ve süresi bitmiş anlaşma düzeltilir (ör. bitiş uzatma); feshedilmiş anlaşma 422 \`stakeholder_agreement_terminated\` (K-318). Değişiklik yoksa 422 \`stakeholder_agreement_unchanged\`. \`contractFileId\` değişince eski dosyanın bağı kalkar, yenisi bağlanır; \`null\` eki kaldırır. \`If-Match\` zorunlu, sürüm tutmazsa 409. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: agreementParams,
        body: updateStakeholderAgreementSchema,
        response: { 200: agreementResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateAgreementCommand(
        contextOf(request),
        request.params.agreementId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return agreementResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${AGREEMENTS}/:agreementId/activate`,
    {
      preValidation: [...managers, requireIfMatch()],
      schema: {
        operationId: 'activateStakeholderAgreement',
        tags,
        summary: 'Anlaşmayı yürürlüğe al',
        description: `Yalnız taslak (422 \`stakeholder_agreement_not_draft\`) ve etkin paydaşla (422 \`stakeholder_inactive\`) (K-318). \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: agreementParams,
        response: { 200: agreementResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await activateAgreementCommand(
        contextOf(request),
        request.params.agreementId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return agreementResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${AGREEMENTS}/:agreementId/terminate`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'terminateStakeholderAgreement',
        tags,
        summary: 'Anlaşmayı feshet',
        description: `Fesih günü (başlangıç ile bitiş arasında; değilse 422 \`stakeholder_agreement_termination_date_invalid\`) ve gerekçe (5–500; denetim kaydına yalnız alan adı düşer). Yalnız yürürlükteki ve bitiş günü geçmemiş anlaşma: taslak 422 \`stakeholder_agreement_not_active\`, süresi biten 422 \`stakeholder_agreement_ended\`, feshedilmiş 422 \`stakeholder_agreement_terminated\` (K-318). \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: agreementParams,
        body: terminateStakeholderAgreementSchema,
        response: { 200: agreementResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await terminateAgreementCommand(
        contextOf(request),
        request.params.agreementId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return agreementResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${AGREEMENTS}/:agreementId`,
    {
      preValidation: [...managers, requireIfMatch()],
      schema: {
        operationId: 'archiveStakeholderAgreement',
        tags,
        summary: 'Taslak anlaşmayı sil',
        description: `Yalnız taslak silinir (arşivlenir; 422 \`stakeholder_agreement_not_draft\`), bağlı sözleşme dosyasının bağı kalkar (K-318). \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: agreementParams,
        response: { 200: agreementArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveAgreementCommand(
        contextOf(request),
        request.params.agreementId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return agreementArchiveResponse.parse(sendBody(reply, result))
    },
  )
}
