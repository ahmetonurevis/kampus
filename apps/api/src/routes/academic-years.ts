import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'

import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  activateYear,
  addTerm,
  closeYear,
  createYear,
  currentPeriod,
  getYear,
  listYears,
  removeTerm,
  updateTerm,
  updateYear,
} from '../services/academic-years.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  academicTermBodySchema,
  academicTermParamsSchema,
  academicYearListQuerySchema,
  academicYearListResponseSchema,
  academicYearParamsSchema,
  academicYearResponseSchema,
  createAcademicYearBodySchema,
  currentAcademicPeriodResponseSchema,
  updateAcademicTermBodySchema,
  updateAcademicYearBodySchema,
} from './academic-years.schemas.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import { emptyCommandBodySchema } from './workflows.schemas.ts'

/**
 * Eğitim yılı ve dönem uçları (IST-011; docs/domain/yetki-ve-kapsam.md DOM-YTK-063…067). Eğitim
 * yılı platform yeteneğidir: modüle bağlı değildir, kapatılamaz. Rol listesi core yetki tablosundan
 * (`WRITE_ACTION_ROLES`) gelir ve `preValidation`'da denetlenir: rol reddi gövde ve başlık
 * doğrulamasından önce gelir. Sıra: 401 → 403 rol → `If-Match` → 400 → işlem (404, 409, 422).
 */

const rolesOf = (action: WriteAction) =>
  WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')

const READ_ACCESS = `Roller: ${rolesOf('academicYear.read')}. Öğrenci ve veli yalnız ad, tarih ve etkinlik bilgisini görür (durum, işlem anları, sürüm ve dönem kimliği personele döner; DOM-YTK-067).`
const WRITE_ACCESS = `Yalnız ${rolesOf('academicYear.manage')}; diğer roller 403. Denetime yalnız alan adları yazılır.`
const VERSIONED =
  "`If-Match` yılın `rowVersion`'ı (zorunlu; yıl ve dönemlerinin ortak sürümü), tutmazsa 409 `version_conflict`; olmayan ya da başka kurumun yılı 404. Kapanmış yıl değişmez: 409 `academic_year_closed`. `Idempotency-Key` isteğe bağlı."

function requiredVersion(request: FastifyRequest): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

function sendYear(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return academicYearResponseSchema.parse(response.body)
}

const target = (request: FastifyRequest<{ Params: { startYear: number } }>) => ({
  startYear: request.params.startYear,
  expectedVersion: requiredVersion(request),
})

export function registerAcademicYearRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const read = app.requireRole(WRITE_ACTION_ROLES['academicYear.read'])
  const manage = app.requireRole(WRITE_ACTION_ROLES['academicYear.manage'])
  const versioned = [manage, requireIfMatch()]
  const versionedHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    '/api/v1/academic-years',
    {
      preValidation: read,
      schema: {
        operationId: 'listAcademicYears',
        tags: ['institution'],
        summary: 'Eğitim yılları',
        description: `Kurumun eğitim yılları (yeni yıl önce) ve dönemleri (gün sırasıyla), sayfalı. Yıl kimliği başlangıç yılıdır (\`startYear\`; tarife ve sözleşmedeki \`academicYear\` sayısı). Bilinmeyen parametre 400. ${READ_ACCESS}`,
        querystring: academicYearListQuerySchema,
        response: { 200: academicYearListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const result = await listYears(contextOf(request), { page, pageSize })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/academic-years/current',
    {
      preValidation: read,
      schema: {
        operationId: 'getCurrentAcademicPeriod',
        tags: ['institution'],
        summary: 'Güncel eğitim yılı ve dönem',
        description: `Bugünün (Europe/Istanbul) eğitim yılı ve dönemi (DOM-YTK-067): gün etkin yılın içindeyse etkin yıl, değilse günü içeren yıl, o da yoksa etkin yıl. Dönem yalnız gün bir döneme düşüyorsa doludur (tatilde \`null\`). Yıl tanımlı değilse \`year\` ve \`term\` boştur. Yıl seçicilerin varsayılanıdır. ${READ_ACCESS}`,
        response: { 200: currentAcademicPeriodResponseSchema, ...readErrors },
      },
    },
    async (request) => ({ data: await currentPeriod(contextOf(request)) }),
  )

  typed.get(
    '/api/v1/academic-years/:startYear',
    {
      preValidation: read,
      schema: {
        operationId: 'getAcademicYear',
        tags: ['institution'],
        summary: 'Eğitim yılı',
        description: `Tek eğitim yılı ve dönemleri; olmayan ya da başka kurumun yılı 404. ${READ_ACCESS}`,
        params: academicYearParamsSchema,
        response: { 200: academicYearResponseSchema, ...readErrors },
      },
    },
    async (request) => ({ data: await getYear(contextOf(request), request.params.startYear) }),
  )

  typed.post(
    '/api/v1/academic-years',
    {
      preValidation: manage,
      schema: {
        operationId: 'createAcademicYear',
        tags: ['institution'],
        summary: 'Eğitim yılı oluştur',
        description: `Yeni eğitim yılı \`planned\` durumunda açılır (core \`planAcademicYearCreation\`, DOM-YTK-063, -064). Tarih verilmezse 1 Eylül – 31 Ağustos. Başlangıç günü başlangıç yılında olmalı (422 \`academic_year_start_mismatch\`), bitiş başlangıçtan sonra (422 \`academic_year_dates_invalid\`) ve bir yıldan kısa (422 \`academic_year_too_long\`); başka yılla örtüşme 422 \`academic_year_overlap\`; aynı başlangıç yılı 409 \`academic_year_exists\`. İlk dönemler isteğe bağlıdır: yılın içinde (422 \`academic_term_outside_year\`), örtüşmeden (422 \`academic_term_overlap\`), ad yılda tekil (409 \`academic_term_name_exists\`). \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\`. ${WRITE_ACCESS}`,
        body: createAcademicYearBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: academicYearResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const body = sendYear(
        reply,
        await createYear(contextOf(request), request.body, idempotencyOf(request, true)),
      )
      reply.header('location', `/api/v1/academic-years/${body.data.startYear}`)
      return body
    },
  )

  typed.patch(
    '/api/v1/academic-years/:startYear',
    {
      preValidation: versioned,
      schema: {
        operationId: 'updateAcademicYear',
        tags: ['institution'],
        summary: 'Eğitim yılının tarihlerini değiştir',
        description: `Yılın başlangıç ve bitiş gününü değiştirir (DOM-YTK-063); aralık kuralları oluşturmadaki gibidir ve var olan dönemler yeni aralığın içinde kalmalıdır (422 \`academic_term_outside_year\`). ${VERSIONED} ${WRITE_ACCESS}`,
        params: academicYearParamsSchema,
        body: updateAcademicYearBodySchema,
        headers: versionedHeaders,
        response: { 200: academicYearResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendYear(
        reply,
        await updateYear(
          contextOf(request),
          target(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.post(
    '/api/v1/academic-years/:startYear/terms',
    {
      preValidation: versioned,
      schema: {
        operationId: 'addAcademicTerm',
        tags: ['institution'],
        summary: 'Dönem ekle',
        description: `Yıla dönem ekler (DOM-YTK-064): dönem yılın içinde kalır (422 \`academic_term_outside_year\`), diğer dönemlerle örtüşmez (422 \`academic_term_overlap\`), adı yılda tekildir (409 \`academic_term_name_exists\`), yılda en çok 12 dönem (422 \`academic_term_limit\`). Sıra başlangıç gününden hesaplanır. Başarı 201; yanıt yılın yeni hâlidir. ${VERSIONED} ${WRITE_ACCESS}`,
        params: academicYearParamsSchema,
        body: academicTermBodySchema,
        headers: versionedHeaders,
        response: { 201: academicYearResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendYear(
        reply,
        await addTerm(
          contextOf(request),
          target(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.patch(
    '/api/v1/academic-years/:startYear/terms/:termId',
    {
      preValidation: versioned,
      schema: {
        operationId: 'updateAcademicTerm',
        tags: ['institution'],
        summary: 'Dönemi değiştir',
        description: `Dönemin adını ya da tarihlerini değiştirir (DOM-YTK-064); kurallar eklemedeki gibidir. Olmayan, kaldırılmış ya da başka yılın dönemi 404. ${VERSIONED} ${WRITE_ACCESS}`,
        params: academicTermParamsSchema,
        body: updateAcademicTermBodySchema,
        headers: versionedHeaders,
        response: { 200: academicYearResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendYear(
        reply,
        await updateTerm(
          contextOf(request),
          { ...target(request), termId: request.params.termId },
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.delete(
    '/api/v1/academic-years/:startYear/terms/:termId',
    {
      preValidation: versioned,
      schema: {
        operationId: 'removeAcademicTerm',
        tags: ['institution'],
        summary: 'Dönemi kaldır',
        description: `Dönemi kaldırır (arşiv; DOM-YTK-064). Okulda (\`school\`) etkin yılın son dönemi kaldırılamaz: 422 \`academic_terms_required\` (DOM-YTK-065). Olmayan, kaldırılmış ya da başka yılın dönemi 404. Yanıt yılın yeni hâlidir. ${VERSIONED} ${WRITE_ACCESS}`,
        params: academicTermParamsSchema,
        headers: versionedHeaders,
        response: { 200: academicYearResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendYear(
        reply,
        await removeTerm(
          contextOf(request),
          { ...target(request), termId: request.params.termId },
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.post(
    '/api/v1/academic-years/:startYear/activate',
    {
      preValidation: versioned,
      schema: {
        operationId: 'activateAcademicYear',
        tags: ['institution'],
        summary: 'Eğitim yılını etkinleştir',
        description: `Yılı etkinleştirir (DOM-YTK-065). Kurumda tek etkin yıl bulunur: önceki etkin yıl aynı işlemde kapanır (yıl geçişi) ve kurumun güncel yılı (\`academicYear\`: yenileme, rıza süresi, tarife varsayılanı) bu yıla eşitlenir. Zaten etkin 409 \`academic_year_already_active\`; daha yeni bir yıl etkinken eski yıl 422 \`academic_year_activation_order\`; bitmiş yıl 422 \`academic_year_ended\`; okulda (\`school\`) dönemsiz yıl 422 \`academic_terms_required\` (dil okulunda dönem isteğe bağlı). Gövde yok ya da boş nesne. ${VERSIONED} ${WRITE_ACCESS}`,
        params: academicYearParamsSchema,
        body: emptyCommandBodySchema.strict().optional(),
        headers: versionedHeaders,
        response: { 200: academicYearResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendYear(
        reply,
        await activateYear(contextOf(request), target(request), idempotencyOf(request, false)),
      ),
  )

  typed.post(
    '/api/v1/academic-years/:startYear/close',
    {
      preValidation: versioned,
      schema: {
        operationId: 'closeAcademicYear',
        tags: ['institution'],
        summary: 'Eğitim yılını kapat',
        description: `Etkin yılı kapatır (DOM-YTK-066). Yalnız etkin yıl (422 \`academic_year_not_active\`) ve yalnız son gününden itibaren (422 \`academic_year_not_ended\`; yıl ortasında geçiş yeni yılın etkinleştirilmesiyle yapılır). Kapanan yıl değişmez, yeniden açılmaz. Gövde yok ya da boş nesne. ${VERSIONED} ${WRITE_ACCESS}`,
        params: academicYearParamsSchema,
        body: emptyCommandBodySchema.strict().optional(),
        headers: versionedHeaders,
        response: { 200: academicYearResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendYear(
        reply,
        await closeYear(contextOf(request), target(request), idempotencyOf(request, false)),
      ),
  )
}
