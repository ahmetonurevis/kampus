import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  getTaskDraft,
  getTaskSubmission,
  listTaskSubmissions,
  saveTaskDraft,
  submitTaskSubmission,
} from '../services/task-submissions.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  taskDraftBodySchema,
  taskDraftReadResponseSchema,
  taskDraftResponseSchema,
  taskSubmissionAssignmentParamsSchema,
  taskSubmissionBodySchema,
  taskSubmissionDetailResponseSchema,
  taskSubmissionListQuerySchema,
  taskSubmissionListResponseSchema,
  taskSubmissionParamsSchema,
} from './task-submissions.schemas.ts'

/**
 * Yazma görevinin taslak ve teslim uçları (F4b3a; ADR 0004 karar 6; docs/domain/beceri-gelisimi.md
 * DOM-BEC-023, 040, 044, 046; IST-047, IST-051; yetki-ve-kapsam.md DOM-YTK-028). `learning`
 * modülüne bağlıdır. Teslim okuması yönetici, öğretmen, öğrenci ve velinindir (ön büro 403);
 * taslak yalnız öğrencinin kendisinindir; yazma yalnız öğrencinindir. Taslak ve teslim atamanın
 * altında yazılır, teslim üst düzey `task-submissions` kaynağıyla okunur (api-tasarimi.md §1).
 */

const MODULE = 'learning'
const READERS: readonly Role[] = ['yonetici', 'ogretmen', 'ogrenci', 'veli']
const WRITERS: readonly Role[] = ['ogrenci']
const READ_ACCESS =
  'Roller: `yonetici` kurumun bütün teslimlerini; atayan `ogretmen` atamanın bütün teslimlerini, atamayı kapsamındaki sınıf/öğrenci hedefi yüzünden gören öğretmen yalnız kapsamındaki öğrencilerinkini (DOM-YTK-028); `ogrenci` kendi, `veli` çocuklarının teslimini (sınıf değiştirse de eski sınıfta yaptığı teslimi görür); ön büro 403. Taslak teslim okumasında hiç dönmez. Yazma otomatik puanlanmaz; yanıtta puan alanı yoktur (rubrik puanlaması ayrı uçtadır). Modül `learning`; kapalıysa 403 `module_disabled`. Kapsam dışı veya başka kurumun kaydı 404.'
const WRITE_ACCESS =
  'Roller: yalnız `ogrenci` (kendi taslağı ve teslimi, atama onu şu an hedefliyorsa); yönetici, öğretmen, veli ve ön büro 403. Sıra: kapsam dışı 404 → rol 403 → sürüm → kural. Modül `learning`; kapalıysa 403 `module_disabled`.'

function sendWith<T>(reply: FastifyReply, response: CommandResponse, parse: (body: unknown) => T) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return parse(response.body)
}

export function registerTaskSubmissionRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Kimlik, modül ve rol şema doğrulamasından önce: oturumsuz istek geçersiz kimlikte de 401 alır.
  const read = [app.requireModule(MODULE), app.requireRole(READERS)]
  const write = [app.requireModule(MODULE), app.requireRole(WRITERS)]

  typed.get(
    '/api/v1/task-submissions',
    {
      preValidation: read,
      schema: {
        operationId: 'listTaskSubmissions',
        tags: ['task-submissions'],
        summary: 'Görev teslimleri',
        description: `Atamanın arşivlenmemiş teslim kayıtları (kursiyer başına bir), kursiyer sırasıyla, sayfalı; her kayıtta son sürümün özeti (metin yok). \`assignmentId\` zorunlu; \`learnerId\` süzgeci okuma kapsamıyla kesişir. Bilinmeyen parametre 400. ${READ_ACCESS}`,
        querystring: taskSubmissionListQuerySchema,
        response: { 200: taskSubmissionListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const result = await listTaskSubmissions(contextOf(request), request.query)
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/task-submissions/:submissionId',
    {
      preValidation: read,
      schema: {
        operationId: 'getTaskSubmission',
        tags: ['task-submissions'],
        summary: 'Görev teslimi ayrıntısı',
        description: `Teslim kaydı, değişmez sürümleri (eskiden yeniye, metinleriyle), her sürümün geç bayrağı ve sözcük sayısı (DOM-BEC-044, 046), teslim durumu ve yeni sürüm hakkı. ${READ_ACCESS}`,
        params: taskSubmissionParamsSchema,
        response: { 200: taskSubmissionDetailResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getTaskSubmission(contextOf(request), request.params.submissionId),
    }),
  )

  typed.get(
    '/api/v1/task-assignments/:assignmentId/draft',
    {
      preValidation: write,
      schema: {
        operationId: 'getTaskDraft',
        tags: ['task-submissions'],
        summary: 'Yazma taslağı',
        description: `Öğrencinin kendi taslağı (IST-047); yoksa \`data: null\`. Taslağı yalnız öğrenci görür (ADR 0004 karar 6); öğretmen, yönetici, veli ve ön büro 403. Atama öğrenciyi artık hedeflemiyorsa taslak varken okunur, yoksa 404. Modül \`learning\`; kapalıysa 403 \`module_disabled\`.`,
        params: taskSubmissionAssignmentParamsSchema,
        response: { 200: taskDraftReadResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getTaskDraft(contextOf(request), request.params.assignmentId),
    }),
  )

  typed.patch(
    '/api/v1/task-assignments/:assignmentId/draft',
    {
      preValidation: write,
      schema: {
        operationId: 'saveTaskDraft',
        tags: ['task-submissions'],
        summary: 'Yazma taslağını kaydet',
        description: `Taslağın otomatik kaydı (IST-047; core \`planDraftSave\`); kursiyer × atama başına tek taslak üzerine yazılır. \`If-Match\` taslağın \`revision\`'ıdır: yalnız henüz taslak yokken atlanabilir (ilk kayıt); taslak varken başlıksız istek 400 \`if_match_required\`, eski revizyon 409 \`draft_conflict\` (başka pencere; eşzamanlı iki kayıttan biri). Teslim kapandıysa 422 \`submission_closed\`, yazma dışı görevde 422 \`draft_not_supported\`. Otomatik kayıt denetim kaydına yazılmaz. ${WRITE_ACCESS}`,
        params: taskSubmissionAssignmentParamsSchema,
        body: taskDraftBodySchema,
        headers: commandHeadersSchema('optional'),
        response: { 200: taskDraftResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await saveTaskDraft(
        contextOf(request),
        {
          assignmentId: request.params.assignmentId,
          body: request.body.body,
          expectedRevision: ifMatchVersion(request),
        },
        idempotencyOf(request, false),
      )
      return sendWith(reply, result, (body) => taskDraftResponseSchema.parse(body))
    },
  )

  typed.post(
    '/api/v1/task-assignments/:assignmentId/submissions',
    {
      preValidation: write,
      schema: {
        operationId: 'submitTaskSubmission',
        tags: ['task-submissions'],
        summary: 'Yazma görevini teslim et',
        description: `Yeni teslim sürümü (DOM-BEC-040, 044, 046; IST-051; core \`planSubmissionVersion\`). İlk gönderim kursiyerin tek teslim kaydını açar, sonrakiler değişmez sürüm ekler; önceki sürümler ve metinleri değişmez. Sürüm sınırı (\`maxVersions\`) dolunca 422 \`version_limit_reached\`; puanlanmış teslimde öğretmen yeniden teslim istemeden 409 \`resubmission_not_requested\`; teslim kapandıysa (geç kabul dahil) 422 \`submission_closed\`; son teslimden sonra geç kabul süresindeki sürüm \`late\`. Sözcük sınırı dışındaki metin uyarıyla kabul edilir. Otomatik puanlı görev 422 \`submission_not_expected\`; dosyalı ve sesli teslim 422 \`submission_kind_unavailable\`. Yazma otomatik puanlanmaz. \`Idempotency-Key\` zorunlu; \`If-Match\` desteklenmez (400 \`if_match_not_supported\`). Başarı 201 ve teslim kaydının \`Location\`'ı. ${WRITE_ACCESS}`,
        params: taskSubmissionAssignmentParamsSchema,
        body: taskSubmissionBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: taskSubmissionDetailResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const idempotency = idempotencyOf(request, true)
      const result = await submitTaskSubmission(
        contextOf(request),
        request.params.assignmentId,
        request.body,
        idempotency,
      )
      const body = sendWith(reply, result, (value) =>
        taskSubmissionDetailResponseSchema.parse(value),
      )
      reply.header('location', `/api/v1/task-submissions/${body.data.id}`)
      return body
    },
  )
}
