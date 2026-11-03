import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Role } from '../auth.ts'
import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  decideTaskAppeal,
  drawSecondRatingSample,
  fileAppeal,
  finalScoreTaskSubmission,
  listGradingQueue,
  requestSecondRating,
  requestTaskResubmission,
  scoreTaskSubmission,
  secondScoreTaskSubmission,
} from '../services/task-grading.ts'
import {
  getTaskDraft,
  getTaskSubmission,
  listTaskSubmissions,
  saveTaskDraft,
  submitTaskDraft,
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
  taskDraftSubmitBodySchema,
  taskSubmissionAssignmentParamsSchema,
  taskSubmissionBodySchema,
  taskSubmissionDetailResponseSchema,
  taskSubmissionListQuerySchema,
  taskSubmissionListResponseSchema,
  taskSubmissionParamsSchema,
  taskResubmissionBodySchema,
  taskScoreBodySchema,
  secondRatingRequestBodySchema,
  secondRatingSampleBodySchema,
  secondRatingSampleResponseSchema,
  taskAppealBodySchema,
  taskAppealDecisionBodySchema,
  taskAppealParamsSchema,
} from './task-submissions.schemas.ts'

/**
 * Yazma görevinin taslak ve teslim uçları (F4b3a; ADR 0004 karar 6; docs/domain/beceri-gelisimi.md
 * DOM-BEC-023, 040, 044, 046; IST-047, IST-051; yetki-ve-kapsam.md DOM-YTK-028). `learning`
 * modülüne bağlıdır. Teslim okuması yönetici, öğretmen, öğrenci ve velinindir (ön büro 403);
 * taslak yalnız öğrencinin kendisinindir; yazma yalnız öğrencinindir. Taslak ve teslim atamanın
 * altında yazılır, teslim üst düzey `task-submissions` kaynağıyla okunur (api-tasarimi.md §1).
 * Öğretmen puanlaması, yeniden teslim isteği ve puanlama kuyruğu (F4b3b1; DOM-BEC-020…023, 040,
 * 045) yönetici ve atamayı gören öğretmenindir; servis `services/task-grading.ts`. İkinci
 * puanlama (örneklem, elle istek, ikinci puan; DOM-BEC-024) ve puanlama süresi de onlarındır;
 * itirazı kursiyer veya velisi yapar, kararı yalnız atamayı gören öğretmen verir (DOM-BEC-025;
 * yönetici okur, karar veremez; F4b3b2a).
 */

const MODULE = 'learning'
const READERS: readonly Role[] = ['yonetici', 'ogretmen', 'ogrenci', 'veli']
const WRITERS: readonly Role[] = ['ogrenci']
const APPELLANTS: readonly Role[] = ['ogrenci', 'veli']
const GRADERS: readonly Role[] = ['yonetici', 'ogretmen']
/** İtiraz kararı yalnız öğretmendedir (DOM-BEC-025); yönetici okur ama karar vermez. */
const APPEAL_DECIDERS: readonly Role[] = ['ogretmen']
/** Son puan yalnız koordinatör görevli öğretmendedir (DOM-YTK-027); yönetici koordinatör sayılmaz. */
const FINALIZERS: readonly Role[] = ['ogretmen']
const READ_ACCESS =
  'Roller: `yonetici` kurumun bütün teslimlerini; atamayı gören `ogretmen` (atayan veya kapsamındaki sınıf/öğrenci hedefi yüzünden gören) atamanın bütün teslimlerini, kursiyerin güncel sınıfına bakılmaz (görünürlük atamayı izler; DOM-YTK-028); `ogrenci` kendi, `veli` çocuklarının teslimini (sınıf değiştirse de eski sınıfta yaptığı teslimi görür); ön büro 403. Taslak teslim okumasında hiç dönmez. Yazma otomatik puanlanmaz (DOM-BEC-023); puan öğretmenin rubrik puanıdır, her okumada kriter bantlarından hesaplanır. Kursiyer ve veli puanı ve geri bildirimi yalnız puan kesinleşip geri bildirim açılınca görür (DOM-BEC-045); öncesinde `score: null`, puanlanmamış sürümle aynı. Kesinleşmemiş puanı yalnız personel görür: öğretmen ve yönetici kendi puanını (kör puanlama, DOM-BEC-024); atanan içeriğin dersinin zümre başkanı veya seviyesinin akademik koordinatörü hepsini, ama sürümü kendisi puanladıysa yalnız kendininkini. Koordinatör atamayı görmese de alanındaki uyuşmazlıklı teslimi tek tek okur (DOM-YTK-027); teslim listesine erişimi yoktur. Modül `learning`; kapalıysa 403 `module_disabled`. Kapsam dışı veya başka kurumun kaydı 404.'
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
  const appeal = [app.requireModule(MODULE), app.requireRole(APPELLANTS)]
  const appealDecider = [app.requireModule(MODULE), app.requireRole(APPEAL_DECIDERS)]
  const finalizer = [app.requireModule(MODULE), app.requireRole(FINALIZERS)]

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
        description: `Öğretmenin puanlama kuyruğu: kişinin gördüğü arşivsiz, rubrikli atamalarda son sürümü ilk puanı veya istenmiş ikinci puanı (DOM-BEC-024) almamış teslimler ile iki puanı uyuşmayıp koordinatörü bekleyen teslimler, en eski gönderim önce, sayfalı; kişinin bir rolde puanladığı bekleyen sürüm listede yoktur (aynı kişi iki rolde puanlamaz), uyuşmazlıklı sürüm puanlayıcılara da görünür. Her kayıtta son sürümün özeti (metin yok), görev başlığı (\`assignmentTitle\`; atamayı görmeyen koordinatör de okur) ve \`grading\`: bekleyen roller (\`awaiting\`; ikinci puan bekleyenler ayrı görünür), uyuşmazlık (\`awaitingResolution\`; yalnız iki puan da verilince), örneklem bekleniyor mu, puanlama süresi (\`dueAt\`: son teslim + 7 gün, core \`gradingDueAt\`; örneklemli görevde örneklem anından, örneklemden önce \`null\`) ve gecikme (\`overdue\`; DOM-BEC-025). Süzgeçler: \`assignmentId\`, \`awaiting=first|second\` (uyuşmazlıklı satırları dışarıda bırakır), \`awaiting=resolution\` (yalnız kişinin son puanı verebileceği uyuşmazlıklar: öğretmende koordinatörü olduğu alandaki ve kendisinin puanlamadığı teslimler, \`canResolve\` ile aynı kural; yönetici koordinatör sayılmaz, hepsini görür), \`overdue=true|false\`; bilinmeyen parametre 400. Roller: \`yonetici\` kurumun bütün, \`ogretmen\` gördüğü atamaların (DOM-YTK-028) teslimleri, zümre başkanı/akademik koordinatör ayrıca alanındaki (atanan içeriğin dersi/seviyesi; DOM-YTK-027) uyuşmazlıklı teslimleri; öğrenci, veli ve ön büro 403. Modül \`learning\`; kapalıysa 403 \`module_disabled\`.`,
        querystring: gradingQueueQuerySchema,
        response: { 200: gradingQueueResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { overdue, ...query } = request.query
      const result = await listGradingQueue(contextOf(request), {
        ...query,
        overdue: overdue === undefined ? undefined : overdue === 'true',
      })
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
        description: `Taslağın otomatik kaydı (IST-047; core \`planDraftSave\`); kursiyer × atama başına tek taslak üzerine yazılır. \`If-Match\` taslağın \`revision\`'ıdır: yalnız henüz taslak yokken atlanabilir (ilk kayıt); taslak varken başlıksız istek 400 \`if_match_required\`, eski revizyon 409 \`draft_conflict\` (başka pencere; eşzamanlı iki kayıttan biri). Teslim kapandıysa 422 \`submission_closed\`, yazma dışı görevde 422 \`draft_not_supported\`. İçerik kuralı (görev içeriğinin okuma kuralıyla aynı; DOM-KYN-021, 025, 051): kaldırılan ya da öğrencinin kitap sahibi olmadığı içerikte 422 \`content_unavailable\`; taslağı ve teslimi olmayan öğrenciye telif bildirimiyle incelemedeki içerik 422 \`content_unavailable\`, lisansı dolmuş içerik 409 \`resource_license_expired\`. Taslağı ya da teslimi olan öğrencinin süren işi sürer. Otomatik kayıt denetim kaydına yazılmaz. ${WRITE_ACCESS}`,
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
    '/api/v1/task-assignments/:assignmentId/draft/submit',
    {
      preValidation: [...write, requireIfMatch()],
      schema: {
        operationId: 'submitTaskDraft',
        tags: ['task-submissions'],
        summary: 'Taslağı teslim et',
        description: `Kaydedilmiş yazma taslağını yeni değişmez teslim sürümü yapar (IST-047; DOM-BEC-040, 044, 046). Teslim edilen metin \`If-Match\` ile verilen taslak revizyonudur; böylece kursiyerin son gördüğü metin teslim edilir. Sıra: kapsam dışı atama 404 → taslak yoksa 404 \`not_found\` → eski revizyon 409 \`draft_conflict\` → bu revizyon taslaktan zaten teslim edildiyse 409 \`draft_already_submitted\` (zamanla değil revizyonla ölçülür: teslimden sonra yazılan otomatik kayıt yeni revizyondur; metinle teslim taslağı tüketmez) → yazma dışı görev 422 \`draft_not_supported\` → boş taslak 422 \`draft_empty\` → içerik kuralı (metin teslimiyle aynı) → core \`planSubmissionVersion\`: sürüm sınırı 422 \`version_limit_reached\`, puanlanmış teslimde öğretmen yeniden teslim istemeden 409 \`resubmission_not_requested\` (geri bildirim açılmadan genel 409 \`submission_locked\`), teslim kapandıysa 422 \`submission_closed\`; yeniden teslim istendiyse pencere isteğin son tarihidir (geç kabulsüz), geç kabuldeki sürüm \`late\`. Taslak silinmez. Gövde boş nesnedir. \`If-Match\` (taslağın \`revision\`'ı) ve \`Idempotency-Key\` zorunlu; istek özeti \`If-Match\` revizyonunu da kapsar (aynı anahtarla başka revizyon 422 \`idempotency_key_reused\`). Başarı 201 ve teslim kaydının \`Location\`'ı. Denetime \`task_submission.submit_draft\` alan adlarıyla yazılır; metin loglanmaz. ${WRITE_ACCESS}`,
        params: taskSubmissionAssignmentParamsSchema,
        body: taskDraftSubmitBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        response: { 201: taskSubmissionDetailResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const expectedRevision = requiredVersion(request)
      // Gövde boş: teslim edilen metni `If-Match` seçer; aynı anahtarla başka revizyon 422
      // `idempotency_key_reused` alsın diye revizyon istek özetine girer.
      const result = await submitTaskDraft(
        contextOf(request),
        { assignmentId: request.params.assignmentId, expectedRevision },
        idempotencyOf(request, true, { ifMatch: expectedRevision }),
      )
      const body = sendWith(reply, result, (value) =>
        taskSubmissionDetailResponseSchema.parse(value),
      )
      reply.header('location', `/api/v1/task-submissions/${body.data.id}`)
      return body
    },
  )

  typed.post(
    '/api/v1/task-assignments/:assignmentId/submissions',
    {
      preValidation: write,
      schema: {
        operationId: 'submitTaskSubmission',
        tags: ['task-submissions'],
        summary: 'Beceri görevini teslim et',
        description: `Yeni teslim sürümü (DOM-BEC-040, 044, 046; IST-051; core \`planSubmissionVersion\`). İlk gönderim kursiyerin tek teslim kaydını açar, sonrakiler değişmez sürüm ekler; önceki sürümler ve metinleri değişmez. Sürüm sınırı (\`maxVersions\`) dolunca 422 \`version_limit_reached\`; puanlanmış teslimde öğretmen yeniden teslim istemeden 409 \`resubmission_not_requested\` (geri bildirim açılmadan genel 409 \`submission_locked\`; DOM-BEC-045); teslim kapandıysa (geç kabul dahil) 422 \`submission_closed\`; son teslimden sonra geç kabul süresindeki sürüm \`late\`. Sözcük sınırı dışındaki metin uyarıyla kabul edilir. Otomatik puanlı görev 422 \`submission_not_expected\`; görevin türünden başka teslim 422 \`submission_kind_mismatch\`. İçerik kuralı (görev içeriğinin okuma kuralıyla aynı; DOM-KYN-021, 025, 051): kaldırılan ya da öğrencinin kitap sahibi olmadığı içerikte 422 \`content_unavailable\`; taslağı ve teslimi olmayan öğrenciye telif bildirimiyle incelemedeki içerik 422 \`content_unavailable\`, lisansı dolmuş içerik 409 \`resource_license_expired\`. Taslağı ya da teslimi olan öğrencinin süren işi sürer. Dosyalı (\`fileIds\`, el yazısı görüntü/PDF) ve sesli (\`recordingFileId\`, konuşma kaydı) teslimde dosya kursiyerin \`POST /api/v1/files\` ile yüklediği, hazır ve bağlanmamış dosyadır (başkasının veya olmayan dosya genel 404 \`not_found\`, hazır değilse 422 \`file_not_ready\`, taramada reddedildiyse 422 \`file_rejected\`, başka kayda bağlıysa 409 \`file_already_attached\`, rıza geri çekildiği için imhaya işaretliyse 422 \`file_unavailable\`); sesli teslim işlem anında geçerli rıza ister (403 \`consent_required\`; DOM-BEC-050), kayıt ölçülmemişse 422 \`recording_not_measured\`, boşsa \`recording_empty\`, sınırı aşıyorsa \`recording_too_long\` (DOM-BEC-054). Dosyalar sürüme bağlanır; konuşma kaydının saklama sonu yazılır (DOM-BEC-052). Teslim otomatik puanlanmaz. \`Idempotency-Key\` zorunlu; \`If-Match\` desteklenmez (400 \`if_match_not_supported\`). Başarı 201 ve teslim kaydının \`Location\`'ı. ${WRITE_ACCESS}`,
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

  typed.post(
    '/api/v1/task-submissions/:submissionId/second-scores',
    {
      preValidation: [...grade, requireIfMatch()],
      schema: {
        operationId: 'secondScoreTaskSubmission',
        tags: ['task-submissions'],
        summary: 'İkinci puanı ver',
        description: `İkinci puanlayıcı son sürümü ilk puanı görmeden rubrikle puanlar (DOM-BEC-024; core \`planRubricScore\`, \`scoresVisibleToRater\`). Gövde ilk puanınkiyle aynıdır. Sürüm ikinci puanlama isteğinin (örneklem veya elle) kapsamında değilse 409 \`second_rating_not_requested\`; ilk puanı veren kişi 409 \`rater_not_independent\`; aynı sürümün ikinci ikinci puanı 409 \`rubric_score_exists\`. Herhangi bir kriterde iki puan arasında birden fazla bant fark varsa sonuç uyuşmazlıktır: son puanı kapsamındaki koordinatör verir (\`final-scores\`), o zamana kadar sonuç kursiyere ve veliye kapalıdır. Uyuşmazlık yoksa ilk puan geçerlidir ve geri bildirim açılır (DOM-BEC-045). ${GRADE_ACCESS}`,
        params: taskSubmissionParamsSchema,
        body: taskScoreBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        response: { 201: taskSubmissionDetailResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const expectedVersion = requiredVersion(request)
      const { versionNumber, ...score } = request.body
      const result = await secondScoreTaskSubmission(
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
    '/api/v1/task-submissions/:submissionId/final-scores',
    {
      preValidation: [...finalizer, requireIfMatch()],
      schema: {
        operationId: 'finalScoreTaskSubmission',
        tags: ['task-submissions'],
        summary: 'Uyuşmazlıkta son puanı ver',
        description:
          "İlk ve ikinci puan herhangi bir kriterde birden fazla bant ayrıştığında (DOM-BEC-024) atamanın içerik dersinin zümre başkanı (`school`) veya seviyesinin akademik koordinatörü (`language_school`) son sürümü rubrikle puanlar (DOM-YTK-027; core `planRubricScore`, `final`). Gövde ilk puanınkiyle aynıdır. Son puan sonucu kesinleştirir; kursiyer ve veli puanı ve geri bildirimi DOM-BEC-045 kuralıyla görür. Uyuşmazlık yoksa veya son puan zaten verildiyse 409 `final_score_not_needed`; koordinatör o sürümün iki puanlayıcısından biriyse 409 `rater_not_independent`. Roller: yalnız `ogretmen`; yönetici koordinatör sayılmaz, öğrenci, veli ve ön büro 403. Sıra: başka kurumun, arşivli veya kapsam dışı teslim 404 (atamayı görmeyen ve alanının koordinatörü olmayan öğretmen) → atamayı gören ama dersin/seviyenin koordinatörü olmayan öğretmen 403 `coordinator_required` → `If-Match` (teslimin `rowVersion`'ı, zorunlu) 409 `version_conflict` → core kuralı. Eşzamanlı iki son puandan yalnız biri yazılır. `Idempotency-Key` zorunlu. Başarı 201, teslimin güncel ayrıntısı ve teslim kaydının `Location`'ı. Geri bildirim metni ve öğrenci kimliği loglanmaz; denetime yalnız alan adları. Modül `learning`; kapalıysa 403 `module_disabled`.",
        params: taskSubmissionParamsSchema,
        body: taskScoreBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        response: { 201: taskSubmissionDetailResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const expectedVersion = requiredVersion(request)
      const { versionNumber, ...score } = request.body
      const result = await finalScoreTaskSubmission(
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
    '/api/v1/task-submissions/:submissionId/second-rating-requests',
    {
      preValidation: [...grade, requireIfMatch()],
      schema: {
        operationId: 'requestSecondRating',
        tags: ['task-submissions'],
        summary: 'İkinci puanlama iste',
        description: `Öğretmen veya yönetici son teslim sürümü için ikinci puanlama ister (DOM-BEC-024: diğer görevlerde isteğe bağlı). İstek, kursiyer yeni sürüm gönderemezken yapılır: sıradaki sürümün teslim penceresi (geç kabul dahil) kapandı ya da sürüm hakkı doldu, aksi 409 \`second_rating_window_open\`. Böylece kursiyerin yanıtı ve yazma hakkı istekten ve sonraki puanlamadan etkilenmez (DOM-BEC-045). Puanı kesinleşen sürüm 409 \`second_rating_too_late\` (açılmış sonuç geri alınmaz); teslim başına tek istek 409 \`second_rating_exists\`; son olmayan sürüm 409 \`version_not_latest\`, bilinmeyen sürüm 404; rubriksiz görev 422 \`rubric_not_assigned\`. ${GRADE_ACCESS}`,
        params: taskSubmissionParamsSchema,
        body: secondRatingRequestBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        response: { 201: taskSubmissionDetailResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const expectedVersion = requiredVersion(request)
      const result = await requestSecondRating(
        contextOf(request),
        {
          submissionId: request.params.submissionId,
          expectedVersion,
          versionNumber: request.body.versionNumber,
        },
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
    '/api/v1/task-assignments/:assignmentId/second-rating-sample',
    {
      preValidation: [...grade, requireIfMatch()],
      schema: {
        operationId: 'drawSecondRatingSample',
        tags: ['task-submissions'],
        summary: 'İkinci puanlama örneklemini seç',
        description: `Örneklemli görevde (\`secondRatingPercent > 0\`; seviye tespiti ve kur sonu değerlendirmesinde en az %10) ikinci puanlanacak teslimler seçilir (DOM-BEC-024; core \`secondRatingQuota\`, \`pickSecondRatingSample\`): sürümü olan bütün teslimlerden oranın yukarı yuvarlanmışı, en az bir. Örneklem teslim penceresi (geç kabul dahil) kapanınca bir kez seçilir (açıkken 409 \`second_rating_window_open\`, ikinci kez 409 \`second_rating_sample_drawn\`); seçilmeden ilk puan verilmez (409 \`second_rating_sample_pending\`) ve puanlama süresi örneklem anından başlar. Böylece kursiyere açılmış bir sonuç sonradan ikinci puan beklemeye dönmez ve kursiyer puanlandığını yeni sürüm reddinden çıkaramaz (DOM-BEC-045). Son tarihsiz görevde pencere kapanmaz, örneklem seçilmez (409 \`second_rating_sample_unavailable\`): ilk puan örneklemi beklemez, ikinci puan teslim bazında elle istenir. Örneklemsiz görev 422 \`second_rating_not_configured\`. Rastgelelik atama kimliğiyle tohumlanır. \`If-Match\` atamanın \`rowVersion\`'ıdır; başarı 201, atamanın yeni sürümü ve ikinci puan kuyruğunun \`Location\`'ı. Roller: \`yonetici\` ve atamayı gören \`ogretmen\`; öğrenci, veli ve ön büro 403; kapsam dışı veya başka kurumun ataması 404. \`Idempotency-Key\` zorunlu. Modül \`learning\`; kapalıysa 403 \`module_disabled\`.`,
        params: taskSubmissionAssignmentParamsSchema,
        body: secondRatingSampleBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        response: { 201: secondRatingSampleResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const expectedVersion = requiredVersion(request)
      const result = await drawSecondRatingSample(
        contextOf(request),
        { assignmentId: request.params.assignmentId, expectedVersion },
        idempotencyOf(request, true),
      )
      const body = sendWith(reply, result, (value) => secondRatingSampleResponseSchema.parse(value))
      reply.header(
        'location',
        `/api/v1/task-submissions/grading-queue?assignmentId=${body.data.assignmentId}&awaiting=second`,
      )
      return body
    },
  )

  typed.post(
    '/api/v1/task-submissions/:submissionId/appeals',
    {
      preValidation: appeal,
      schema: {
        operationId: 'fileTaskAppeal',
        tags: ['task-submissions'],
        summary: 'Sonuca itiraz et',
        description: `Kursiyer/öğrenci veya velisi sonuç duyurusundan (geri bildirimin açılması) sonra 5 iş günü içinde gerekçeli itiraz eder (DOM-BEC-025; core \`planAppeal\`, \`appealDeadline\`: süre ertesi gün başlar, hafta sonu ve kurum tatili sayılmaz, Europe/Istanbul gün sonu). Duyurudan önce 409 \`appeal_not_open\`; puanlanmamış ve açılmamış puanlı sürümde yanıt aynıdır (DOM-BEC-045). Süre geçince 422 \`appeal_window_closed\`; alıştırmada 422 \`appeal_not_available\`; sürüm başına tek itiraz 409 \`appeal_exists\`; yalnız son sürüme, eski sürüme 409 \`appeal_not_latest\`; bilinmeyen sürüm 404. İtirazı o sürümü puanlamamış bir öğretmen karara bağlar. Gerekçe loglanmaz; denetime yalnız alan adları. \`Idempotency-Key\` zorunlu; \`If-Match\` desteklenmez (400 \`if_match_not_supported\`). Başarı 201 ve teslim kaydının \`Location\`'ı. Roller: \`ogrenci\` kendi, \`veli\` çocuğunun teslimine; yönetici, öğretmen ve ön büro 403; okuma kapsamı dışı veya başka kurumun teslimi ve arşivli atama 404. Modül \`learning\`; kapalıysa 403 \`module_disabled\`.`,
        params: taskSubmissionParamsSchema,
        body: taskAppealBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: taskSubmissionDetailResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const result = await fileAppeal(
        contextOf(request),
        {
          submissionId: request.params.submissionId,
          versionNumber: request.body.versionNumber,
          reason: request.body.reason,
        },
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
    '/api/v1/task-submissions/:submissionId/appeals/:appealId/decision',
    {
      preValidation: [...appealDecider, requireIfMatch()],
      schema: {
        operationId: 'decideTaskAppeal',
        tags: ['task-submissions'],
        summary: 'İtirazı karara bağla',
        description: `İtirazı o sürümü hiçbir rolde puanlamamış, atamayı gören öğretmen karara bağlar (DOM-BEC-025: itiraz ilk puanlayıcı dışında bir öğretmene gider; core \`planAppealDecision\`); puanlayan öğretmen 409 \`rater_not_independent\`. Yönetici itirazı okur ama karar veremez (403 \`forbidden\`). Karar gerekçesiyle bildirilir: \`upheld\` yeni rubrik puanı (son puan) ister, \`rejected\` yalnız gerekçe. İlk puan ve önceki puanlar kayıt geçmişinde kalır; kabulde son puan geçerli olur ve kursiyere açılır. Sonuçlanmış itiraz 409 \`appeal_decided\`; bilinmeyen itiraz 404. Karar gerekçesi loglanmaz. Başarı 200 ve teslimin güncel ayrıntısı. Roller: yalnız \`ogretmen\` (atamayı gören; DOM-YTK-028); yönetici, öğrenci, veli ve ön büro 403. Sıra: kapsam dışı veya başka kurumun teslimi 404 → rol 403 → \`If-Match\` (teslimin \`rowVersion\`'ı, zorunlu) 409 \`version_conflict\` → core kuralı. \`Idempotency-Key\` zorunlu. Modül \`learning\`; kapalıysa 403 \`module_disabled\`.`,
        params: taskAppealParamsSchema,
        body: taskAppealDecisionBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        response: { 200: taskSubmissionDetailResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const expectedVersion = requiredVersion(request)
      const result = await decideTaskAppeal(
        contextOf(request),
        {
          submissionId: request.params.submissionId,
          appealId: request.params.appealId,
          expectedVersion,
          decision: request.body,
        },
        idempotencyOf(request, true),
      )
      return sendWith(reply, result, (value) => taskSubmissionDetailResponseSchema.parse(value))
    },
  )
}
