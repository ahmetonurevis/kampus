import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Role } from '../auth.ts'
import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  archiveRubricVersion,
  createRubric,
  getRubric,
  getRubricVersion,
  listRubricLibrary,
  openRubricVersion,
  publishRubricVersion,
  updateRubricDraft,
} from '../services/rubrics.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  rubricBodySchema,
  rubricCommandBodySchema,
  rubricDetailResponseSchema,
  rubricDraftPatchSchema,
  rubricListQuerySchema,
  rubricListResponseSchema,
  rubricParamsSchema,
  rubricVersionIdParamsSchema,
  rubricVersionParamsSchema,
  rubricVersionResponseSchema,
  rubricWriteResponseSchema,
} from './rubrics.schemas.ts'

/**
 * Rubrik kütüphanesi uçları (ADR 0004 karar 7; docs/domain/beceri-gelisimi.md DOM-BEC-020, 022;
 * IST-048). `learning` modülüne bağlıdır; yalnız içerik personeli (yönetici, öğretmen; öğrenci,
 * veli, ön büro 403). Düzenleme, yeni sürüm, yayım ve arşiv rubriğin sahibi veya yöneticinindir
 * (core `canManageRubric`, 403). Olmayan veya başka kurumun rubriği 404. `Idempotency-Key`
 * isteğe bağlıdır. Atama, deneme ve teslim uçları ayrı dilimlerdedir (F4b2b, F4b3).
 */

const MODULE = 'learning'
const STAFF: readonly Role[] = ['yonetici', 'ogretmen']
const ACCESS =
  'Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Olmayan veya başka kurumun rubriği 404.'
const MANAGE =
  'Yalnız rubriğin sahibi ve yönetici (core `canManageRubric`; diğer öğretmen 403). Sıra: kapsam (404) → yetki (403) → sürüm (409).'
const IF_MATCH =
  "`If-Match` zorunlu: sürümün `rowVersion`'ı (yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`)."

const created = { 201: rubricWriteResponseSchema, ...commandErrors }
const updated = { 200: rubricWriteResponseSchema, ...commandErrors }

function send(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return rubricWriteResponseSchema.parse(response.body)
}

/** `If-Match` zorunlu uçta `requireIfMatch` ön işleyicisi başlığı garanti eder. */
function expectedVersionOf(request: Parameters<typeof ifMatchVersion>[0]): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

export function registerRubricRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Kimlik, modül ve rol şema doğrulamasından önce: oturumsuz istek geçersiz kimlikte de 401 alır.
  const preValidation = [app.requireModule(MODULE), app.requireRole(STAFF)]
  const versioned = [...preValidation, requireIfMatch()]

  typed.get(
    '/api/v1/rubrics',
    {
      preValidation,
      schema: {
        operationId: 'listRubrics',
        tags: ['rubrics'],
        summary: 'Rubrik kütüphanesi',
        description: `Kurumun rubrikleri, sayfalı (IST-048): rubrik kurumundur, bütün içerik personeli görür ve yayındaki sürümü görevlerde kullanır. Satır en yüksek numaralı sürümü (\`head\`) ve yayındaki sürümün kimliğini taşır. Süzgeçler baş sürüme uygulanır; son güncellenen önce. Bilinmeyen parametre 400. ${ACCESS}`,
        querystring: rubricListQuerySchema,
        response: { 200: rubricListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const result = await listRubricLibrary(contextOf(request), request.query)
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/rubrics/:rubricId',
    {
      preValidation,
      schema: {
        operationId: 'getRubric',
        tags: ['rubrics'],
        summary: 'Rubrik ayrıntısı',
        description: `Rubrik ve bütün sürümleri (arşivli dahil; DOM-BEC-022): kriterler, bantlar, tanımlayıcı eşlemesi ve sürüm başına kullanım (atama ve puan sayısı). ${ACCESS}`,
        params: rubricParamsSchema,
        response: { 200: rubricDetailResponseSchema, ...readErrors },
      },
    },
    async (request) => ({ data: await getRubric(contextOf(request), request.params.rubricId) }),
  )

  typed.get(
    '/api/v1/rubric-versions/:versionId',
    {
      preValidation,
      schema: {
        operationId: 'getRubricVersion',
        tags: ['rubrics'],
        summary: 'Rubrik sürümü',
        description: `Tek rubrik sürümü kimliğiyle (DOM-BEC-022): atamanın \`rubricVersionId\`'si rubrik aranmadan okunur. Kriterler, bantlar, tanımlayıcı eşlemesi ve kullanım. Rubrik sonradan arşivlense de sürüm okunur. ${ACCESS} Olmayan veya başka kurumun sürümü 404.`,
        params: rubricVersionIdParamsSchema,
        response: { 200: rubricVersionResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getRubricVersion(contextOf(request), request.params.versionId),
    }),
  )

  typed.post(
    '/api/v1/rubrics',
    {
      preValidation,
      schema: {
        operationId: 'createRubric',
        tags: ['rubrics'],
        summary: 'Rubrik oluştur',
        description: `Yeni rubrik ve ilk taslak sürüm (DOM-BEC-020, 022): sahibi oluşturan kişi. Gövde core \`rubricVersionInputSchema\`: analitik rubrikte becerinin en az iki niteliksel yönü, bütüncülde tek \`overall\` kriteri; her kriterde 0–5 altı bant, kurum cümlesi ve tanımlayıcı. Dil okulunda bant kazanıma bağlanamaz (422 \`rubric_alignment_invalid\`). Başarı 201 ve \`Location\`. ${ACCESS}`,
        body: rubricBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: created,
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const result = await createRubric(
        contextOf(request),
        request.body,
        idempotencyOf(request, false),
      )
      const body = send(reply, result)
      reply.header('location', `/api/v1/rubrics/${body.data.rubric.id}`)
      return body
    },
  )

  typed.post(
    '/api/v1/rubrics/:rubricId/versions',
    {
      preValidation,
      schema: {
        operationId: 'createRubricVersion',
        tags: ['rubrics'],
        summary: 'Yeni rubrik sürümü aç',
        description: `Gövdedeki içerikle yeni taslak sürüm açar (DOM-BEC-022); numara bir artar, yayındaki sürüm ve eski puanlar değişmez. Açık taslak varken 409 \`open_rubric_version_exists\`. Başarı 201. ${MANAGE} ${ACCESS}`,
        params: rubricParamsSchema,
        body: rubricBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: created,
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const result = await openRubricVersion(
        contextOf(request),
        request.params.rubricId,
        request.body,
        idempotencyOf(request, false),
      )
      reply.header('location', `/api/v1/rubrics/${request.params.rubricId}`)
      return send(reply, result)
    },
  )

  typed.patch(
    '/api/v1/rubrics/:rubricId/versions/:versionId',
    {
      preValidation: versioned,
      schema: {
        operationId: 'updateRubricDraft',
        tags: ['rubrics'],
        summary: 'Rubrik taslağını düzenle',
        description: `Taslak sürümün alanlarını değiştirir (DOM-BEC-020, 022); verilmeyen alan aynen kalır, \`criteria\` bütün olarak değişir ve birleşmiş içerik core şemasıyla yeniden doğrulanır (400). Yayımlanmış, arşivli veya kullanılmış (atamaya ya da puana bağlı) sürüm 409 \`rubric_version_immutable\`. ${IF_MATCH} ${MANAGE} ${ACCESS}`,
        params: rubricVersionParamsSchema,
        body: rubricDraftPatchSchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        response: updated,
      },
    },
    async (request, reply) => {
      const result = await updateRubricDraft(
        contextOf(request),
        { ...request.params, patch: request.body, expectedVersion: expectedVersionOf(request) },
        idempotencyOf(request, false),
      )
      return send(reply, result)
    },
  )

  typed.post(
    '/api/v1/rubrics/:rubricId/versions/:versionId/publish',
    {
      preValidation: versioned,
      schema: {
        operationId: 'publishRubricVersion',
        tags: ['rubrics'],
        summary: 'Rubrik sürümünü yayımla',
        description: `Taslağı yayımlar (DOM-BEC-022): rubriğin önceki yayındaki sürümü aynı işlemde arşivlenir; o sürümle verilmiş puanlar onunla hesaplanmaya, sabitlendiği atamalar onunla puanlanmaya devam eder. Taslak olmayan sürüm 409 \`rubric_version_immutable\`; eşzamanlı ikinci yayım 409. ${IF_MATCH} ${MANAGE} ${ACCESS}`,
        params: rubricVersionParamsSchema,
        body: rubricCommandBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        response: updated,
      },
    },
    async (request, reply) => {
      const result = await publishRubricVersion(
        contextOf(request),
        { ...request.params, expectedVersion: expectedVersionOf(request) },
        idempotencyOf(request, false),
      )
      return send(reply, result)
    },
  )

  typed.post(
    '/api/v1/rubrics/:rubricId/versions/:versionId/archive',
    {
      preValidation: versioned,
      schema: {
        operationId: 'archiveRubricVersion',
        tags: ['rubrics'],
        summary: 'Rubrik sürümünü arşivle',
        description: `Yayındaki sürümü arşivler (DOM-BEC-022): yeni görevde kullanılamaz, sabitlendiği atamalarda puanlanmaya devam eder; kullanılmış sürüm silinmez, yalnız arşivlenir. Arşiv geri alınmaz; yeni sürüm açılır. Yayında olmayan sürüm 409 \`rubric_version_not_published\`. ${IF_MATCH} ${MANAGE} ${ACCESS}`,
        params: rubricVersionParamsSchema,
        body: rubricCommandBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        response: updated,
      },
    },
    async (request, reply) => {
      const result = await archiveRubricVersion(
        contextOf(request),
        { ...request.params, expectedVersion: expectedVersionOf(request) },
        idempotencyOf(request, false),
      )
      return send(reply, result)
    },
  )
}
