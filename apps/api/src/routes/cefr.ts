import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { PLACEMENT_DECIDER_ROLES } from '@kampus/school-core/cefr/placement.ts'
import { CEFR_PROFILE_ROLES } from '@kampus/school-core/cefr/suggestion.ts'

import { NotFoundError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  completePlacementSession,
  decidePlacement,
  getCefrProfile,
  getPlacementSession,
  listLearnerPlacementSessions,
  openPlacementSession,
  scorePlacementSection,
} from '../services/cefr.ts'
import { getInstitutionModules } from '../services/modules.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  cefrProfileParamsSchema,
  cefrProfileResponseSchema,
  completePlacementSessionBodySchema,
  decidePlacementBodySchema,
  openPlacementSessionBodySchema,
  placementSessionListQuerySchema,
  placementSessionListResponseSchema,
  placementSessionParamsSchema,
  placementSessionResponseSchema,
  scorePlacementSectionBodySchema,
} from './cefr.schemas.ts'
import { idempotencyOf } from './command-support.ts'
import { rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'

/**
 * Seviye tespiti ve CEFR profili uçları (OG-054; IST-058, IST-060; DOM-DIL-010…012, DOM-BEC-034).
 * Kur ve grup uçları gibi modüle değil kurum türüne bağlıdır: okulda (`school`) her uç her rol için
 * 404, rol denetiminden önce (DOM-YTK-012). Sıra: 401 → 404 kurum türü → 403 rol → 400 → işlem
 * (404 oturum, 409 sürüm, core kuralları 403/409/422).
 */

const TYPE_ONLY =
  'Yalnız dil okulunda (`language_school`); okulda her rol için 404, rol denetiminden önce.'
const PLACEMENT_ACCESS = `Roller: ${PLACEMENT_DECIDER_ROLES.map((r) => `\`${r}\``).join(', ')} (öğretmen veya akademik koordinatör); diğer roller 403. Öğretmen yalnız kendi grubundaki ya da akademik koordinatörü olduğu seviyenin grubundaki öğrenciye ulaşır, kapsam dışı öğrenci ve oturumu 404; aday gruba bağlı olmadığından her öğretmene açıktır. ${TYPE_ONLY}`
const VERSIONED =
  'Gövdedeki `version` oturumun satır sürümüdür; tutmazsa 409 `version_conflict`, olmayan ya da başka kurumun oturumu 404. `Idempotency-Key` isteğe bağlı; aynı anahtarla tekrar aynı yanıtı verir.'

function send(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return placementSessionResponseSchema.parse(response.body)
}

export function registerCefrRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /** Seviye tespiti ve CEFR profili yalnız dil okulundadır (DOM-YTK-012); okulda 404. */
  const languageSchool: preValidationAsyncHookHandler = async function (request) {
    const ctx = contextOf(request)
    const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
    if (institution?.type !== 'language_school') throw new NotFoundError()
  }
  const placement = [app.authenticate, languageSchool, app.requireRole(PLACEMENT_DECIDER_ROLES)]
  const command = [...placement, rejectIfMatch()]
  const headers = commandHeadersSchema('optional', { ifMatch: false })

  typed.get(
    '/api/v1/placement-sessions',
    {
      preValidation: placement,
      schema: {
        operationId: 'listPlacementSessions',
        tags: ['learning'],
        summary: 'Kişinin seviye tespitleri',
        description: `Öğrencinin ya da adayın tespit oturumları, başlangıca göre eskiden yeniye, sayfalı; geçerlilik (90 gün, DOM-DIL-012) her okumada hesaplanır. ${PLACEMENT_ACCESS}`,
        querystring: placementSessionListQuerySchema,
        response: { 200: placementSessionListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize, learnerKind, learnerId } = request.query
      const items = await listLearnerPlacementSessions(contextOf(request), {
        learnerKind,
        learnerId,
      })
      const start = (page - 1) * pageSize
      return {
        data: items.slice(start, start + pageSize),
        meta: { page, pageSize, total: items.length },
      }
    },
  )

  typed.get(
    '/api/v1/placement-sessions/:sessionId',
    {
      preValidation: placement,
      schema: {
        operationId: 'getPlacementSession',
        tags: ['learning'],
        summary: 'Seviye tespiti',
        description: `Tek oturum: beş bölümün sonucu (dil kullanımı, okuma, dinleme otomatik; yazma, konuşma rubrikli), geçerlilik, önerilen seviye (tespit bağlamı, DOM-DIL-010) ve verilmiş yerleştirme kararı. Puan ve öneri saklanmaz. Olmayan ya da başka kurumun oturumu 404. ${PLACEMENT_ACCESS}`,
        params: placementSessionParamsSchema,
        response: { 200: placementSessionResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getPlacementSession(contextOf(request), request.params.sessionId),
    }),
  )

  typed.post(
    '/api/v1/placement-sessions',
    {
      preValidation: command,
      schema: {
        operationId: 'openPlacementSession',
        tags: ['learning'],
        summary: 'Seviye tespiti aç',
        description: `Öğrenci ya da aday için tespit oturumu açar (DOM-DIL-010, 012). Kişi kurumun kaydı (404), form kurumun quiz kaynağının sürümü olmalı (404, 422 \`placement_form_invalid\`). Süren oturum varken (409 \`placement_in_progress\`) ya da iki tespitten sonra (409 \`placement_limit_reached\`) yenisi açılmaz; ikinci tespit farklı formla (422 \`placement_form_repeated\`). Başarı 201 ve \`Location\`. \`Idempotency-Key\` isteğe bağlı. ${PLACEMENT_ACCESS}`,
        body: openPlacementSessionBodySchema,
        headers,
        response: { 201: placementSessionResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const body = send(
        reply,
        await openPlacementSession(contextOf(request), request.body, idempotencyOf(request, false)),
      )
      reply.header('location', `/api/v1/placement-sessions/${body.data.id}`)
      return body
    },
  )

  typed.post(
    '/api/v1/placement-sessions/:sessionId/score',
    {
      preValidation: command,
      schema: {
        operationId: 'scorePlacementSection',
        tags: ['learning'],
        summary: 'Tespit bölümünü puanla',
        description: `Bölüm girişi (DOM-DIL-010, IST-058). Dil kullanımı, okuma ve dinleme \`answers\` taşır; puan formun o bölümdeki sorularının anahtarıyla sunucuda hesaplanır, yalnız süren oturumda (409 \`placement_completed\`), formda bölüm yoksa 422 \`placement_section_empty\`. Yazma ve konuşma yayındaki, bölümle aynı becerideki rubrik sürümüyle (404, 409 \`rubric_version_unpublished\`, 422 \`placement_rubric_skill_mismatch\`) kriter bantı ve görevin hedef seviyesini taşır; oturum bittikten sonra da girilir. Her bölüm bir kez (409 \`placement_section_scored\`); karar verilmiş oturumda giriş yok (409 \`placement_already_decided\`). ${VERSIONED} ${PLACEMENT_ACCESS}`,
        params: placementSessionParamsSchema,
        body: scorePlacementSectionBodySchema,
        headers,
        response: { 200: placementSessionResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await scorePlacementSection(
          contextOf(request),
          request.params.sessionId,
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.post(
    '/api/v1/placement-sessions/:sessionId/complete',
    {
      preValidation: command,
      schema: {
        operationId: 'completePlacementSession',
        tags: ['learning'],
        summary: 'Seviye tespitini bitir',
        description: `Süren oturumu bitirir; bitiş anı sunucu saatidir ve 90 günlük geçerlilik ondan sayılır (DOM-DIL-012). Bitmiş oturum 409 \`placement_completed\`. ${VERSIONED} ${PLACEMENT_ACCESS}`,
        params: placementSessionParamsSchema,
        body: completePlacementSessionBodySchema,
        headers,
        response: { 200: placementSessionResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await completePlacementSession(
          contextOf(request),
          request.params.sessionId,
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.post(
    '/api/v1/placement-sessions/:sessionId/decide',
    {
      preValidation: command,
      schema: {
        operationId: 'decidePlacement',
        tags: ['learning'],
        summary: 'Yerleştirme kararı ver',
        description: `Öğretmen veya akademik koordinatör gerekçeyle genel seviyeyi ve isteğe bağlı beceri seviyelerini seçer (DOM-DIL-010); öneriden farklı olabilir. Her satır \`level_decisions\`'a karar anının önerisiyle yazılır ve değişmez. Oturum bitmiş (409 \`placement_incomplete\`), kurumda yapılmış (422 \`placement_preliminary\`), 90 günü dolmamış (422 \`placement_expired\`) ve yazma ile konuşma puanlanmış (422 \`placement_production_missing\`) olmalı; oturum başına bir karar (409 \`placement_already_decided\`). ${VERSIONED} ${PLACEMENT_ACCESS}`,
        params: placementSessionParamsSchema,
        body: decidePlacementBodySchema,
        headers,
        response: { 200: placementSessionResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await decidePlacement(
          contextOf(request),
          request.params.sessionId,
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.get(
    '/api/v1/students/:studentId/cefr-profile',
    {
      preValidation: [app.authenticate, languageSchool, app.requireRole(CEFR_PROFILE_ROLES)],
      schema: {
        operationId: 'getCefrProfile',
        tags: ['learning'],
        summary: 'CEFR profili',
        description: `Kursiyerin CEFR profili (IST-060, DOM-BEC-034): beceri başına güncel seviye (en yeni insan kararı), "Tahmini seviye" önerisi ve dayandığı kanıtlar, karar zaman çizelgesi ve tespit oturumları. Öneri karar değildir ve saklanmaz. Öğrenci kendisini, veli bağlı çocuğunu, öğretmen kendi grubundaki ya da akademik koordinatörü olduğu seviyenin grubundaki kursiyeri, yönetici herkesi görür; göremediği ya da olmayan öğrenci 404. Ön büro 403. ${TYPE_ONLY}`,
        params: cefrProfileParamsSchema,
        response: { 200: cefrProfileResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getCefrProfile(contextOf(request), request.params.studentId),
    }),
  )
}
