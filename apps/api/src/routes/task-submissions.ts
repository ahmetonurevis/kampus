import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Role } from '../auth.ts'
import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  listGradingQueue,
  requestTaskResubmission,
  scoreTaskSubmission,
} from '../services/task-grading.ts'
import {
  getTaskDraft,
  getTaskSubmission,
  listTaskSubmissions,
  saveTaskDraft,
  submitTaskSubmission,
} from '../services/task-submissions.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  gradingQueueQuerySchema,
  gradingQueueResponseSchema,
  taskDraftBodySchema,
  taskDraftReadResponseSchema,
  taskDraftResponseSchema,
  taskSubmissionAssignmentParamsSchema,
  taskSubmissionBodySchema,
  taskSubmissionDetailResponseSchema,
  taskSubmissionListQuerySchema,
  taskSubmissionListResponseSchema,
  taskSubmissionParamsSchema,
  taskResubmissionBodySchema,
  taskScoreBodySchema,
} from './task-submissions.schemas.ts'

/**
 * Yazma görevinin taslak ve teslim uçları (F4b3a; ADR 0004 karar 6; docs/domain/beceri-gelisimi.md
 * DOM-BEC-023, 040, 044, 046; IST-047, IST-051; yetki-ve-kapsam.md DOM-YTK-028). `learning`
 * modülüne bağlıdır. Teslim okuması yönetici, öğretmen, öğrenci ve velinindir (ön büro 403);
 * taslak yalnız öğrencinin kendisinindir; yazma yalnız öğrencinindir. Taslak ve teslim atamanın
 * altında yazılır, teslim üst düzey `task-submissions` kaynağıyla okunur (api-tasarimi.md §1).
 * Öğretmen puanlaması, yeniden teslim isteği ve puanlama kuyruğu (F4b3b1; DOM-BEC-020…023, 040,
 * 045) yönetici ve atamayı gören öğretmenindir; servis `services/task-grading.ts`.
 */

const MODULE = 'learning'
const READERS: readonly Role[] = ['yonetici', 'ogretmen', 'ogrenci', 'veli']
const WRITERS: readonly Role[] = ['ogrenci']
const GRADERS: readonly Role[] = ['yonetici', 'ogretmen']
const READ_ACCESS =
  'Roller: `yonetici` kurumun bütün teslimlerini; atamayı gören `ogretmen` (atayan veya kapsamındaki sınıf/öğrenci hedefi yüzünden gören) atamanın bütün teslimlerini, kursiyerin güncel sınıfına bakılmaz (görünürlük atamayı izler; DOM-YTK-028); `ogrenci` kendi, `veli` çocuklarının teslimini (sınıf değiştirse de eski sınıfta yaptığı teslimi görür); ön büro 403. Taslak teslim okumasında hiç dönmez. Yazma otomatik puanlanmaz (DOM-BEC-023); puan öğretmenin rubrik puanıdır, her okumada kriter bantlarından hesaplanır. Kursiyer ve veli puanı ve geri bildirimi yalnız puan kesinleşip geri bildirim açılınca görür (DOM-BEC-045); öncesinde `score: null`, puanlanmamış sürümle aynı. Kesinleşmemiş puanı yalnız personel görür (öğretmen kendi puanını, yönetici hepsini). Modül `learning`; kapalıysa 403 `module_disabled`. Kapsam dışı veya başka kurumun kaydı 404.'
const GRADE_ACCESS =
  "Roller: `yonetici` ve atamayı gören `ogretmen` (atayan olmasa da kapsamındaki sınıf/öğrenci hedefi yüzünden gören; DOM-YTK-028); öğrenci, veli ve ön büro 403. Sıra: kapsam dışı veya başka kurumun teslimi 404 → rol 403 → `If-Match` (teslimin `rowVersion`'ı, zorunlu) 409 `version_conflict` → core kuralı. `Idempotency-Key` zorunlu. Başarı 201, teslimin güncel ayrıntısı ve teslim kaydının `Location`'ı. Geri bildirim metni ve öğrenci kimliği loglanmaz; denetime yalnız alan adları. Modül `learning`; kapalıysa 403 `module_disabled`."
const WRITE_ACCESS =
  'Roller: yalnız `ogrenci` (kendi taslağı ve teslimi, atama onu şu an hedefliyorsa; rota ve servis ayrı denetler); yönetici, öğretmen, veli ve ön büro 403. Sıra: kapsam dışı 404 → rol 403 → sürüm → kural. Modül `learning`; kapalıysa 403 `module_disabled`.'

function requiredVersion(request: FastifyRequest): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

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
  const grade = [app.requireModule(MODULE), app.requireRole(GRADERS)]

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
    '/api/v1/task-submissions/grading-queue',
    {
      preValidation: grade,
      schema: {
        operationId: 'listGradingQueue',
        tags: ['task-submissions'],
        summary: 'Puanlanmayı bekleyen teslimler',
        description: `Öğretmenin puanlama kuyruğu: kişinin gördüğü arşivsiz, rubrikli atamalarda son sürümü henüz puanlanmamış teslimler, en eski gönderim önce, sayfalı; her kayıtta son sürümün özeti (metin yok). \`assignmentId\` isteğe bağlı süzgeçtir. Roller: \`yonetici\` kurumun bütün, \`ogretmen\` gördüğü atamaların (DOM-YTK-028) teslimleri; öğrenci, veli ve ön büro 403. Modül \`learning\`; kapalıysa 403 \`module_disabled\`.`,
        querystring: gradingQueueQuerySchema,
        response: { 200: gradingQueueResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const result = await listGradingQueue(contextOf(request), request.query)
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
        description: `Yeni teslim sürümü (DOM-BEC-040, 044, 046; IST-051; core \`planSubmissionVersion\`). İlk gönderim kursiyerin tek teslim kaydını açar, sonrakiler değişmez sürüm ekler; önceki sürümler ve metinleri değişmez. Sürüm sınırı (\`maxVersions\`) dolunca 422 \`version_limit_reached\`; puanlanmış teslimde öğretmen yeniden teslim istemeden 409 \`resubmission_not_requested\` (geri bildirim açılmadan genel 409 \`submission_locked\`; DOM-BEC-045); teslim kapandıysa (geç kabul dahil) 422 \`submission_closed\`; son teslimden sonra geç kabul süresindeki sürüm \`late\`. Sözcük sınırı dışındaki metin uyarıyla kabul edilir. Otomatik puanlı görev 422 \`submission_not_expected\`; dosyalı ve sesli teslim 422 \`submission_kind_unavailable\`. Yazma otomatik puanlanmaz. \`Idempotency-Key\` zorunlu; \`If-Match\` desteklenmez (400 \`if_match_not_supported\`). Başarı 201 ve teslim kaydının \`Location\`'ı. ${WRITE_ACCESS}`,
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

  typed.post(
    '/api/v1/task-submissions/:submissionId/scores',
    {
      preValidation: [...grade, requireIfMatch()],
      schema: {
        operationId: 'scoreTaskSubmission',
        tags: ['task-submissions'],
        summary: 'Teslimi rubrikle puanla',
        description: `Öğretmen yazma teslimi sürümünü rubrikle puanlar ve geri bildirim yazar (DOM-BEC-020…023; core \`planRubricScore\`). Rubrik atamanın sabitlediği sürümdür (DOM-BEC-022), gövdede seçilmez; rubriksiz görev 422 \`rubric_not_assigned\`. Her kritere bir bant (0–5) verilir: eksik kriter 422 \`rubric_criterion_missing\`, rubrikte olmayan veya tekrar eden kriter 422 \`rubric_criterion_invalid\`, hedefin altındaki (0–2) bantta kriter yorumu yoksa 422 \`criterion_comment_required\`. Toplam ve yüzde sunucuda hesaplanır, saklanmaz; gövdedeki toplam/yüzde/rol 400. Yalnız son sürüm puanlanır (409 \`version_not_latest\`; bilinmeyen sürüm 404); aynı sürümün ikinci puanı 409 \`rubric_score_exists\` (puan değişmez; yeniden puanlama ve ikinci puanlayıcı ayrı iştir). Puan kesinleşince geri bildirim kursiyere ve veliye açılır (DOM-BEC-045). ${GRADE_ACCESS}`,
        params: taskSubmissionParamsSchema,
        body: taskScoreBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        response: { 201: taskSubmissionDetailResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const expectedVersion = requiredVersion(request)
      const { versionNumber, ...score } = request.body
      const result = await scoreTaskSubmission(
        contextOf(request),
        { submissionId: request.params.submissionId, expectedVersion, versionNumber, score },
        idempotencyOf(request, true),
      )
      const body = sendWith(reply, result, (value) =>
        taskSubmissionDetailResponseSchema.parse(value),
      )
      reply.header('location', `/api/v1/task-submissions/${body.data.id}`)
      return body
    },
  )

  typed.post(
    '/api/v1/task-submissions/:submissionId/resubmission-requests',
    {
      preValidation: [...grade, requireIfMatch()],
      schema: {
        operationId: 'requestTaskResubmission',
        tags: ['task-submissions'],
        summary: 'Yeniden teslim iste',
        description: `Öğretmen puanlanan son sürüm için kursiyerden yeni sürüm ister (DOM-BEC-040; core \`planResubmissionRequest\`). Son tarih ileri ve en çok 14 gün sonradır (422 \`resubmission_due_invalid\`), geç kabul yoktur. Son olmayan sürüm 409 \`version_not_latest\`, puanı kesinleşmemiş sürüm 409 \`resubmission_not_graded\`, aynı sürüme ikinci istek 409 \`resubmission_exists\`. Kursiyer sonra yeni sürüm gönderebilir; bu sürüm hakka sayılmaz. ${GRADE_ACCESS}`,
        params: taskSubmissionParamsSchema,
        body: taskResubmissionBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        response: { 201: taskSubmissionDetailResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const expectedVersion = requiredVersion(request)
      const result = await requestTaskResubmission(
        contextOf(request),
        { submissionId: request.params.submissionId, expectedVersion, request: request.body },
        idempotencyOf(request, true),
      )
      const body = sendWith(reply, result, (value) =>
        taskSubmissionDetailResponseSchema.parse(value),
      )
      reply.header('location', `/api/v1/task-submissions/${body.data.id}`)
      return body
    },
  )
}
