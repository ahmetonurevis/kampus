import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Role } from '../auth.ts'
import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  createTaskAssignment,
  getTaskAssignment,
  listTaskAssignments,
  updateTaskAssignment,
} from '../services/task-assignments.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  taskAssignmentBodySchema,
  taskAssignmentDetailResponseSchema,
  taskAssignmentListQuerySchema,
  taskAssignmentListResponseSchema,
  taskAssignmentParamsSchema,
  taskAssignmentPatchSchema,
  taskAssignmentWriteResponseSchema,
} from './task-assignments.schemas.ts'

/**
 * Görev atama uçları (ADR 0004 karar 4; docs/domain/beceri-gelisimi.md DOM-BEC-041, 042, 044;
 * kaynak-platformu.md DOM-KYN-032; IST-034). Ödev, quiz ve beceri görevi aynı uçla atanır.
 * `learning` modülüne bağlıdır. Okuma yönetici, öğretmen, öğrenci ve velinindir (ön büro 403);
 * yazma core `ASSIGNING_ROLES`'tur (yönetici, öğretmen); değiştirme yalnız atayan ve yöneticidir
 * (DOM-YTK-028). Olmayan, kapsam dışı veya başka kurumun ataması 404. Yeniden puanlama (`TODO(F4b-rescore)`) ve arşiv (`TODO(F4b-atama-arsiv)`) açılmadı;
 * gerekçe `services/task-assignments.ts`'te.
 */

const MODULE = 'learning'
const READERS: readonly Role[] = ['yonetici', 'ogretmen', 'ogrenci', 'veli']
const WRITERS: readonly Role[] = ['yonetici', 'ogretmen']
const READ_ACCESS =
  'Roller: `yonetici` kurumun bütün atamaları; `ogretmen` kendi atamaları, kapsamındaki (ders verdiği veya sınıf rehber öğretmeni olduğu) sınıfı/grubu hedefleyenler ve o sınıfların güncel öğrencilerine hedeflenenler (DOM-YTK-028; atayan değilse `targets` yalnız kendi kapsamındaki hedefleri içerir); `ogrenci` kendisine hedeflenenler, `veli` çocuklarına hedeflenenler; ön büro 403. Öğrenci ve veli `learner` görünümünü alır: hedef listesi, puanlama ve rubrik sürümü, ikinci puanlama oranı ve atayan yoktur; cevap anahtarı hiçbir görünümde yoktur. Modül `learning`; kapalıysa 403 `module_disabled`. Kapsam dışı veya başka kurumun ataması 404.'
const WRITE_ACCESS =
  'Roller: `yonetici`, `ogretmen`; öğrenci, veli ve ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`.'

function send(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return taskAssignmentWriteResponseSchema.parse(response.body)
}

export function registerTaskAssignmentRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Kimlik, modül ve rol şema doğrulamasından önce: oturumsuz istek geçersiz kimlikte de 401 alır.
  const read = [app.requireModule(MODULE), app.requireRole(READERS)]
  const write = [app.requireModule(MODULE), app.requireRole(WRITERS)]

  typed.get(
    '/api/v1/task-assignments',
    {
      preValidation: read,
      schema: {
        operationId: 'listTaskAssignments',
        tags: ['task-assignments'],
        summary: 'Görev atamaları',
        description: `Arşivlenmemiş atamalar, en yeni önce, sayfalı (IST-034). Süzgeçler: içerik (\`resourceId\`; aynı içeriğin farklı son tarihli ayrı atamaları) ve görev türü. Bilinmeyen parametre 400. ${READ_ACCESS}`,
        querystring: taskAssignmentListQuerySchema,
        response: { 200: taskAssignmentListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const result = await listTaskAssignments(contextOf(request), request.query)
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/task-assignments/:assignmentId',
    {
      preValidation: read,
      schema: {
        operationId: 'getTaskAssignment',
        tags: ['task-assignments'],
        summary: 'Görev ataması ayrıntısı',
        description: `Atamanın sabitlenmiş içerik sürümü ve ayarları (DOM-KYN-032, DOM-BEC-041, 042). ${READ_ACCESS}`,
        params: taskAssignmentParamsSchema,
        response: { 200: taskAssignmentDetailResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getTaskAssignment(contextOf(request), request.params.assignmentId),
    }),
  )

  typed.post(
    '/api/v1/task-assignments',
    {
      preValidation: write,
      schema: {
        operationId: 'createTaskAssignment',
        tags: ['task-assignments'],
        summary: 'Görev ata',
        description: `İçeriğin güncel yayındaki sürümünü, ayarları ve (varsa) yayındaki rubrik sürümünü atamaya sabitler (ADR 0004 karar 4; DOM-KYN-032, DOM-BEC-041, 042); \`scoringVersionId\` başta içerik sürümüdür. Hedefler sınıf/şube (okul), dil grubu (dil okulu) veya öğrencidir; öğretmen yalnız ders verdiği sınıfa ve içeriğin dersine atar, yönetici kurumda atar. Aynı içerik farklı son tarihle ayrı atamadır (IST-034); açık atamadaki kursiyere ikinci kez 409 \`assignment_duplicate\`/\`assignment_overlap\`. Sıra: atayanın göremediği veya olmayan içerik 404 → lisansı dolmuş içerik 409 \`resource_license_expired\` → kapsam dışı hedef 403 \`target_scope_denied\` (olmayan hedef veya rubrik sürümü 404 \`not_found\`, mesaj ve \`issues\` yoluyla) → yayında olmayan veya güncel olmayan sürüm 409 \`resource_version_not_assignable\`, taslak veya arşivli rubrik sürümü 409 \`rubric_version_not_assignable\`. Geçici sınırlar: dosyalı ve sesli teslim 422 \`submission_kind_unavailable\`, dinleme hakkı sayımı açılana kadar gönderilmeyen hak sınırsız (\`null\`) saklanır, 1 veya 2 seçilirse 422 \`listening_plays_unavailable\`. Sınıf/şube hedefli atama o sınıfın güncel öğrencilerine görünür. \`Idempotency-Key\` zorunludur (sınıfa toplu dağıtım). Başarı 201 ve \`Location\`. ${WRITE_ACCESS}`,
        body: taskAssignmentBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: taskAssignmentWriteResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const idempotency = idempotencyOf(request, true)
      const result = await createTaskAssignment(contextOf(request), request.body, idempotency)
      const body = send(reply, result)
      reply.header('location', `/api/v1/task-assignments/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    '/api/v1/task-assignments/:assignmentId',
    {
      preValidation: [...write, requireIfMatch()],
      schema: {
        operationId: 'updateTaskAssignment',
        tags: ['task-assignments'],
        summary: 'Görev atamasını değiştir',
        description: `Yalnız son teslim ve geç kabul süresi uzatılır (core \`planAssignmentChange\`; DOM-BEC-041, 042, 044): kısaltma 422 \`deadline_shortened\`; içerik, puanlama ve rubrik sürümü, görev türü, deneme hakkı ve diğer ayarlar 409 \`assignment_setting_frozen\`. Değiştiren yalnız atayan veya yöneticidir (DOM-YTK-028). Sıra: kapsam dışı atama 404 → görünür ama atayan olmayan öğretmen 403 \`forbidden\` → sürüm. \`If-Match\` zorunlu: atamanın \`rowVersion\`'ı (yoksa 400 \`if_match_required\`, tutmazsa 409 \`version_conflict\`). ${WRITE_ACCESS}`,
        params: taskAssignmentParamsSchema,
        body: taskAssignmentPatchSchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        response: { 200: taskAssignmentWriteResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const expectedVersion = ifMatchVersion(request)
      if (expectedVersion === null)
        throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
      const result = await updateTaskAssignment(
        contextOf(request),
        {
          assignmentId: request.params.assignmentId,
          patch: request.body,
          expectedVersion,
        },
        idempotencyOf(request, false),
      )
      return send(reply, result)
    },
  )
}
