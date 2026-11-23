import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Role } from '../auth.ts'
import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveOutcome,
  createInstitutionOutcome,
  listOutcomeCatalog,
} from '../services/learning-outcomes.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  learningOutcomeBodySchema,
  learningOutcomeCommandBodySchema,
  learningOutcomeListQuerySchema,
  learningOutcomeListResponseSchema,
  learningOutcomeParamsSchema,
  learningOutcomeResponseSchema,
} from './learning-outcomes.schemas.ts'

/**
 * Kazanım / öğrenme çıktısı kataloğu uçları (ADR 0004 karar 9; docs/domain/kaynak-platformu.md
 * DOM-KYN-011; IST-030, 031). `learning` modülüne bağlıdır. Okuma içerik personelinindir
 * (yönetici, öğretmen); kurum kazanımı ekleme ve arşivi yalnız yönetici ve dersin zümre başkanı
 * (core `canManageLearningOutcomes`, 403). Platform kataloğu HTTP'den yazılmaz. İçerik ve soru
 * formunun kazanım seçicisi listeyi buradan arar; yönetim ekranı sonraki adımdır.
 */

const MODULE = 'learning'
const STAFF: readonly Role[] = ['yonetici', 'ogretmen']
const ACCESS =
  'Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`.'
const MANAGE =
  'Yalnız yönetici ve kazanımın dersinde zümre başkanı olan öğretmen (core `canManageLearningOutcomes`; diğer öğretmen 403).'

function send(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return learningOutcomeResponseSchema.parse(response.body)
}

export function registerLearningOutcomeRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Kimlik, modül ve rol şema doğrulamasından önce: oturumsuz istek geçersiz sorguda da 401 alır.
  const preValidation = [app.requireModule(MODULE), app.requireRole(STAFF)]

  typed.get(
    '/api/v1/learning-outcomes',
    {
      preValidation,
      schema: {
        operationId: 'listLearningOutcomes',
        tags: ['learning-outcomes'],
        summary: 'Kazanım kataloğu',
        description: `Öğretim programı (platform) ve kurum kazanımları birleşik, sayfalı (DOM-KYN-011). Arşivli kod listelenmez ve yeni içerikte seçilemez; \`codes\` verilirse yalnız o kodlar arşivliler dahil döner (mevcut içerikteki kazanımın adı ve arşiv etiketi için). Sıra: sınıf düzeyi, ders, önce öğretim programı, kod. Bilinmeyen parametre 400. ${ACCESS}`,
        querystring: learningOutcomeListQuerySchema,
        response: { 200: learningOutcomeListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const result = await listOutcomeCatalog(contextOf(request), request.query)
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.post(
    '/api/v1/learning-outcomes',
    {
      preValidation,
      schema: {
        operationId: 'createLearningOutcome',
        tags: ['learning-outcomes'],
        summary: 'Kurum kazanımı ekle',
        description: `Kurumun kendi kazanım kodunu ekler (DOM-KYN-011). Kod büyük harfe çevrilir; kurumda (arşivliler dahil) ya da öğretim programında kullanılan kod 409 \`learning_outcome_code_taken\`. \`Idempotency-Key\` zorunlu. Başarı 201 ve \`Location\`. ${MANAGE} ${ACCESS}`,
        body: learningOutcomeBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: learningOutcomeResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const result = await createInstitutionOutcome(
        contextOf(request),
        request.body,
        idempotencyOf(request, true),
      )
      const body = send(reply, result)
      reply.header('location', `/api/v1/learning-outcomes/${encodeURIComponent(body.data.code)}`)
      return body
    },
  )

  typed.post(
    '/api/v1/learning-outcomes/:code/archive',
    {
      preValidation: [...preValidation, requireIfMatch()],
      schema: {
        operationId: 'archiveLearningOutcome',
        tags: ['learning-outcomes'],
        summary: 'Kurum kazanımını arşivle',
        description: `Kurum kazanımını arşivler (DOM-KYN-011): yeni içerikte seçilemez (422 \`outcome_archived\`), bağlı eski içerikte korunur; kod yeniden verilmez. Olmayan, başka kurumun ya da platform kodu 404; arşivli kod 409 \`learning_outcome_archived\`. \`If-Match\` satır sürümü (\`rowVersion\`; yoksa 400 \`if_match_required\`, tutmazsa 409 \`version_conflict\`), \`Idempotency-Key\` zorunlu. ${MANAGE} ${ACCESS}`,
        params: learningOutcomeParamsSchema,
        body: learningOutcomeCommandBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        response: { 200: learningOutcomeResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const expectedVersion = ifMatchVersion(request)
      if (expectedVersion === null)
        throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
      const result = await archiveOutcome(
        contextOf(request),
        { code: request.params.code, expectedVersion },
        idempotencyOf(request, true),
      )
      return send(reply, result)
    },
  )
}
