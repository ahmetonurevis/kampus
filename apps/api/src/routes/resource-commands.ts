import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import { RESOURCE_ACTIONS, type ResourceAction } from '@kampus/school-core/content/resource.ts'

import type { Role } from '../auth.ts'
import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  copyResource,
  createResource,
  openNewVersion,
  removeResource,
  shareResource,
  transitionVersion,
  updateDraftVersion,
} from '../services/resource-commands.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  draftPatchBodySchema,
  emptyBodySchema,
  reasonBodySchema,
  removalResponseSchema,
  resourceCreateBodySchema,
  resourceParamsSchema,
  resourceShareBodySchema,
  resourceVersionParamsSchema,
  resourceWriteResponseSchema,
  shareResponseSchema,
  transitionBodySchema,
} from './resources.schemas.ts'

/**
 * İçerik havuzu yazma uçları (ADR 0004 karar 3; docs/domain/kaynak-platformu.md). `learning`
 * modülüne bağlıdır; yalnız yönetici ve öğretmen (öğrenci, veli, ön büro 403). Kural core
 * `content/*`'tadır; okunamayan veya başka kurumun kaynağı 404. `Idempotency-Key` isteğe bağlıdır;
 * verilirse aynı istek ilk yanıtı tekrarlar.
 */

const MODULE = 'learning'
const WRITERS: readonly Role[] = ['yonetici', 'ogretmen']
const ACCESS =
  'Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`. Okunamayan veya başka kurumun kaynağı 404.'

const created = { 201: resourceWriteResponseSchema, ...commandErrors }
const updated = { 200: resourceWriteResponseSchema, ...commandErrors }

function send<T extends z.ZodType>(reply: FastifyReply, schema: T, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return schema.parse(response.body) as z.output<T>
}

function sendCreated(reply: FastifyReply, response: CommandResponse) {
  const body = send(reply, resourceWriteResponseSchema, response)
  reply.header('location', `/api/v1/resources/${body.data.resource.id}`)
  return body
}

const ACTION_NOTES: Record<ResourceAction, string> = {
  submit:
    'Taslağı onaya gönderir (DOM-KYN-030); yalnız yazar. Yayım koşulları eksikse 422 (ilk eksiğin kodu, ör. `subject_required`).',
  publish:
    'Onaysız yayın (DOM-KYN-031): yalnız `Kurum özgün` ve kapsamı yazarın kendi öğrencileri/sınıfları olan taslak; diğerleri 403 `review_required`. Önceki yayın sürümü arşivlenir.',
  withdraw:
    'İncelemedeki sürümü taslağa döndürür; yalnız yazar. Önceden yayımlanmış sürüm 409 `version_immutable`.',
  approve:
    'İncelemedeki sürümü yayımlar (DOM-KYN-031); yazar ve sahip onaylayamaz (403). Önceki yayın sürümü aynı işlemde arşivlenir. Telif bildirimi incelenen içeriği yalnız yönetici yeniden yayına alır.',
  reject:
    'İncelemedeki sürümü gerekçeyle reddeder (`reason` zorunlu, yoksa 422 `reason_required`).',
  reopen: 'Reddedilen sürümü taslağa döndürür; yalnız yazar.',
  archive:
    'Taslak, reddedilmiş veya yayındaki sürümü arşivler (DOM-KYN-042, 051); sahip, zümre başkanı veya yönetici. Kaynağın bütün sürümleri arşivlenince kaynak da arşivlenir ve listeden düşer.',
  report:
    'Telif bildirimi (DOM-KYN-025): yayındaki sürüm `İncelemede`ye alınır, öğrenci ve veliden düşer. `reason` zorunlu. Gerekçe saklanmaz (`TODO(content-report-log)`).',
}

export function registerResourceCommandRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const preValidation = [app.requireModule(MODULE), app.requireRole(WRITERS)]

  typed.post(
    '/api/v1/resources',
    {
      preValidation,
      schema: {
        operationId: 'createResource',
        tags: ['resources'],
        summary: 'Kaynak oluştur',
        description: `Yeni kaynak ve ilk taslak sürüm (DOM-KYN-001): sahip ve yazar işlemi yapan kişi, kapsam \`private\`. Gövde core \`resourceVersionInputSchema\` (taslak eksik kaydedilebilir; yayım koşulları onaya gönderirken denetlenir). Quiz/alıştırma sorusu kurumda yoksa veya okunamıyorsa 422 \`quiz_item_missing\`; dosyalı içerik henüz 422 \`resource_files_unsupported\`. Başarı 201 ve \`Location\`. ${ACCESS}`,
        body: resourceCreateBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: created,
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const result = await createResource(
        contextOf(request),
        request.body,
        idempotencyOf(request, false),
      )
      return sendCreated(reply, result)
    },
  )

  typed.patch(
    '/api/v1/resources/:resourceId/versions/:versionId',
    {
      preValidation,
      schema: {
        operationId: 'updateResourceDraft',
        tags: ['resources'],
        summary: 'Taslağı düzenle',
        description: `Taslak veya reddedilmiş sürümün alanlarını değiştirir (DOM-KYN-030, 032); verilmeyen alan aynen kalır, \`tags\` bütün olarak değişir. Yalnız yazar (403). Yayımlanmış, incelemedeki veya arşivli sürüm 409 \`version_immutable\`; içerik türü değişmez (422 \`content_type_immutable\`). Kopyada miras lisans ve kaynak gösterimi değişmez (422 \`license_inherited\`, \`attribution_inherited\`; DOM-KYN-050). Reddedilen sürüm taslağa döner. \`If-Match\` zorunlu: sürümün \`rowVersion\`'ı (yoksa 400 \`if_match_required\`, tutmazsa 409). ${ACCESS}`,
        params: resourceVersionParamsSchema,
        body: draftPatchBodySchema,
        headers: commandHeadersSchema('optional'),
        response: updated,
      },
    },
    async (request, reply) => {
      const expectedVersion = ifMatchVersion(request)
      if (expectedVersion === null)
        throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
      const result = await updateDraftVersion(
        contextOf(request),
        { ...request.params, patch: request.body, expectedVersion },
        idempotencyOf(request, false),
      )
      return send(reply, resourceWriteResponseSchema, result)
    },
  )

  typed.post(
    '/api/v1/resources/:resourceId/versions',
    {
      preValidation,
      schema: {
        operationId: 'createResourceVersion',
        tags: ['resources'],
        summary: 'Yeni sürüm aç',
        description: `Yayındaki (yoksa son) sürümün içeriğinden yeni taslak sürüm açar (DOM-KYN-032); numara bir artar. Sahip, zümre başkanı veya yönetici (403). Açık sürüm varken 409 \`open_version_exists\`, kaldırılmış kaynakta 409 \`resource_removed\`. Arşivlenmiş kaynak yeniden açılır. Başarı 201. ${ACCESS}`,
        params: resourceParamsSchema,
        body: emptyBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: created,
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const result = await openNewVersion(
        contextOf(request),
        request.params.resourceId,
        idempotencyOf(request, false),
      )
      return send(reply, resourceWriteResponseSchema, result)
    },
  )

  for (const action of Object.keys(RESOURCE_ACTIONS) as ResourceAction[]) {
    const needsReason = action === 'reject' || action === 'report'
    typed.post(
      `/api/v1/resources/:resourceId/versions/:versionId/${action}`,
      {
        preValidation,
        schema: {
          operationId: `${action}ResourceVersion`,
          tags: ['resources'],
          summary: `Sürüm: ${RESOURCE_ACTIONS[action].label}`,
          description: `${ACTION_NOTES[action]} İzinsiz geçiş 409 \`resource_transition_invalid\`. \`If-Match\` isteğe bağlı: sürümün \`rowVersion\`'ı. ${ACCESS}`,
          params: resourceVersionParamsSchema,
          body: needsReason ? reasonBodySchema : transitionBodySchema,
          headers: commandHeadersSchema('optional'),
          response: updated,
        },
      },
      async (request, reply) => {
        const result = await transitionVersion(
          contextOf(request),
          {
            ...request.params,
            action,
            reason: request.body.reason,
            expectedVersion: ifMatchVersion(request),
          },
          idempotencyOf(request, false),
        )
        return send(reply, resourceWriteResponseSchema, result)
      },
    )
  }

  typed.post(
    '/api/v1/resources/:resourceId/remove',
    {
      preValidation,
      schema: {
        operationId: 'removeResource',
        tags: ['resources'],
        summary: 'Kaynağı kaldır',
        description: `Telif ihlali veya kişisel veri nedeniyle kaynağı kaldırır (DOM-KYN-025, 051): bütün sürümlerin içeriği ve cevap anahtarı silinir; başlık, menşe, gerekçe ve tarih kalır; kaynak arşivlenir. Yalnız yönetici (öğretmen 403); \`reason\` zorunlu (422 \`reason_required\`); ikinci kez 409 \`resource_removed\`. Yanıt bu sürümlerden türetilmiş kopyaları ve soruyu içeren quiz sürümlerini listeler. \`If-Match\` isteğe bağlı: kaynağın \`rowVersion\`'ı. ${ACCESS}`,
        params: resourceParamsSchema,
        body: reasonBodySchema,
        headers: commandHeadersSchema('optional'),
        response: { 200: removalResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await removeResource(
        contextOf(request),
        {
          resourceId: request.params.resourceId,
          reason: request.body.reason,
          expectedVersion: ifMatchVersion(request),
        },
        idempotencyOf(request, false),
      )
      return send(reply, removalResponseSchema, result)
    },
  )

  typed.post(
    '/api/v1/resources/:resourceId/share',
    {
      preValidation,
      schema: {
        operationId: 'shareResource',
        tags: ['resources'],
        summary: 'Paylaşımı değiştir',
        description: `Paylaşım kapsamı ve hedefleri (DOM-KYN-021, 031, 040): \`private\`, \`students\` (\`studentIds\`), \`classes\` (\`classIds\`), \`department\`, \`institution\`. Sahip, zümre başkanı veya yönetici (403). Öğretmen yalnız ders verdiği sınıf ve öğrencilerle paylaşır (403 \`share_target_out_of_scope\`); kurumda olmayan kimlik 422 \`share_target_not_found\`. Kitap sahibiyle sınırlı lisans sınıf/kurum kapsamına açılmaz (422 \`license_restricts_share\`); onaysız yayın zümre/kuruma açılırken 409 \`share_scope_review_required\`. \`If-Match\` isteğe bağlı: kaynağın \`rowVersion\`'ı. ${ACCESS}`,
        params: resourceParamsSchema,
        body: resourceShareBodySchema,
        headers: commandHeadersSchema('optional'),
        response: { 200: shareResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await shareResource(
        contextOf(request),
        {
          resourceId: request.params.resourceId,
          targets: request.body,
          expectedVersion: ifMatchVersion(request),
        },
        idempotencyOf(request, false),
      )
      return send(reply, shareResponseSchema, result)
    },
  )

  typed.post(
    '/api/v1/resources/:resourceId/copy',
    {
      preValidation,
      schema: {
        operationId: 'copyResource',
        tags: ['resources'],
        summary: 'Kaynağı kopyala',
        description: `Yayındaki güncel sürümü yeni kaynağa kopyalar (DOM-KYN-050): sahibi kopyalayan, kapsam \`private\`, durum \`Taslak\`; \`derivedFromVersionId\`, lisans ve kaynak gösterimleri miras alınır ve sonraki taslaklarda değiştirilemez. Yayında sürüm yoksa 409 \`copy_source_not_published\`; uyarlamaya izin vermeyen lisans 403 \`license_forbids_copy\`; süresi dolan lisans 409 \`license_expired\`. Başarı 201 ve \`Location\`. ${ACCESS}`,
        params: resourceParamsSchema,
        body: emptyBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: created,
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const result = await copyResource(
        contextOf(request),
        request.params.resourceId,
        idempotencyOf(request, false),
      )
      return sendCreated(reply, result)
    },
  )
}
