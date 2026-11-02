import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Role } from '../auth.ts'
import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  getTaskAttempt,
  listTaskAttempts,
  saveTaskAttemptAnswers,
  startTaskAttempt,
  submitTaskAttempt,
} from '../services/task-attempts.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  taskAttemptAnswersBodySchema,
  taskAttemptAssignmentParamsSchema,
  taskAttemptDetailResponseSchema,
  taskAttemptListQuerySchema,
  taskAttemptListResponseSchema,
  taskAttemptParamsSchema,
  taskAttemptStartBodySchema,
  taskAttemptSubmitBodySchema,
} from './task-attempts.schemas.ts'

/**
 * Otomatik puanlı görev (okuma, dinleme ve quiz soruları) deneme uçları (F4b3a; ADR 0004 karar
 * 5, 6; docs/domain/beceri-gelisimi.md DOM-BEC-010, 042…045; yetki-ve-kapsam.md DOM-YTK-028).
 * `learning` modülüne bağlıdır. Okuma yönetici, öğretmen, öğrenci ve velinindir (ön büro 403);
 * yazma yalnız öğrencinindir. Deneme atamanın altında başlatılır, üst düzey `task-attempts`
 * kaynağıyla okunur ve yazılır (api-tasarimi.md §1: iç içe tek düzey).
 */

const MODULE = 'learning'
const READERS: readonly Role[] = ['yonetici', 'ogretmen', 'ogrenci', 'veli']
const WRITERS: readonly Role[] = ['ogrenci']
const READ_ACCESS =
  'Roller: `yonetici` kurumun bütün denemeleri; atamayı gören `ogretmen` (atayan veya kapsamındaki sınıf/öğrenci hedefi yüzünden gören) atamanın bütün denemeleri, kursiyerin güncel sınıfına bakılmaz (görünürlük atamayı izler; DOM-YTK-028); `ogrenci` kendi, `veli` çocuklarının denemelerini (sınıf değiştirse de eski sınıfta yaptığı denemeyi ve puanı görür); ön büro 403. Kursiyer ve veli süren denemede sonuç görmez, tamamlanınca yalnız toplam puanı, cevap anahtarı açılınca (alıştırmada deneme bitince, değerlendirmede teslim kapanınca) madde sonuçlarını ve anahtarı görür (DOM-BEC-045); personel tamamlanan denemenin madde sonuçlarını görür, anahtar ona da açılınca döner. Puan saklanmaz, her okumada cevaplardan hesaplanır (DOM-BEC-010). Modül `learning`; kapalıysa 403 `module_disabled`. Kapsam dışı veya başka kurumun kaydı 404.'
const WRITE_ACCESS =
  'Roller: yalnız `ogrenci` (kendi denemesi; rota ve servis ayrı denetler); yönetici, öğretmen, veli ve ön büro 403. Sıra: kapsam dışı 404 → rol 403 → sürüm 409 → kural. Modül `learning`; kapalıysa 403 `module_disabled`.'

function send(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return taskAttemptDetailResponseSchema.parse(response.body)
}

function requiredVersion(request: FastifyRequest): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

export function registerTaskAttemptRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Kimlik, modül ve rol şema doğrulamasından önce: oturumsuz istek geçersiz kimlikte de 401 alır.
  const read = [app.requireModule(MODULE), app.requireRole(READERS)]
  const write = [app.requireModule(MODULE), app.requireRole(WRITERS)]

  typed.get(
    '/api/v1/task-attempts',
    {
      preValidation: read,
      schema: {
        operationId: 'listTaskAttempts',
        tags: ['task-attempts'],
        summary: 'Görev denemeleri',
        description: `Atamanın arşivlenmemiş denemeleri, kursiyer ve deneme numarası sırasıyla, sayfalı (DOM-BEC-042). \`assignmentId\` zorunlu; \`learnerId\` süzgeci okuma kapsamıyla kesişir. Bilinmeyen parametre 400. ${READ_ACCESS}`,
        querystring: taskAttemptListQuerySchema,
        response: { 200: taskAttemptListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const result = await listTaskAttempts(contextOf(request), request.query)
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/task-attempts/:attemptId',
    {
      preValidation: read,
      schema: {
        operationId: 'getTaskAttempt',
        tags: ['task-attempts'],
        summary: 'Görev denemesi ayrıntısı',
        description: `Deneme, durumu, süresi, cevapları, sonucu ve soruları (anahtar ve açıklama yok). ${READ_ACCESS}`,
        params: taskAttemptParamsSchema,
        response: { 200: taskAttemptDetailResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getTaskAttempt(contextOf(request), request.params.attemptId),
    }),
  )

  typed.post(
    '/api/v1/task-assignments/:assignmentId/attempts',
    {
      preValidation: write,
      schema: {
        operationId: 'startTaskAttempt',
        tags: ['task-attempts'],
        summary: 'Görev denemesi başlat',
        description: `Atamanın şu an hedeflediği öğrenci için yeni deneme (DOM-BEC-042, 043, 044; core \`planAttemptStart\`). Başlangıç sunucu saatidir; süre başlangıç + süre sınırıdır ve teslim kapanışını aşmaz. Değerlendirmede başlatılan her deneme hakkı tüketir: hak dolunca 422 \`attempt_limit_reached\`; süren deneme varken 409 \`attempt_in_progress\` (eşzamanlı ikinci başlatma da); teslim kapandıysa 422 \`submission_closed\`; otomatik puanlanmayan görev 422 \`not_auto_scored\`. İçerik kuralı core kuralından önce gelir (süren deneme varken de; görev içeriğinin okuma kuralıyla aynı): içerik (sabitlenen sürüm, puanlama sürümü veya bir sorusu) kaldırıldıysa, telif bildirimiyle incelemedeyse ya da kitap sahibiyle sınırlı lisansta öğrenci kitap sahibi değilse 422 \`content_unavailable\` (DOM-KYN-021, 025, 051); lisansı dolduysa 409 \`resource_license_expired\` (DOM-KYN-021). Lisansı dolan ve incelemeye alınan içerikte süren deneme kaydedilir ve teslim edilir. Gövde \`{}\`. \`Idempotency-Key\` zorunlu; \`If-Match\` desteklenmez (400 \`if_match_not_supported\`). Başarı 201 ve \`Location\`. ${WRITE_ACCESS}`,
        params: taskAttemptAssignmentParamsSchema,
        body: taskAttemptStartBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: taskAttemptDetailResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const idempotency = idempotencyOf(request, true)
      const result = await startTaskAttempt(
        contextOf(request),
        request.params.assignmentId,
        idempotency,
      )
      const body = send(reply, result)
      reply.header('location', `/api/v1/task-attempts/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    '/api/v1/task-attempts/:attemptId',
    {
      preValidation: [...write, requireIfMatch()],
      schema: {
        operationId: 'saveTaskAttemptAnswers',
        tags: ['task-attempts'],
        summary: 'Deneme cevaplarını kaydet',
        description: `Süren denemeye cevap kaydı (DOM-BEC-043; core \`planAnswerSave\`): yalnız gönderilen sorular güncellenir. Süre dolduysa 422 \`attempt_time_over\`, teslim edilmiş deneme 409 \`attempt_already_submitted\`, soruyla uyuşmayan cevap 422 \`answer_invalid\`. Kaldırılan ya da öğrencinin kitap sahibi olmadığı içerikte 422 \`content_unavailable\` (DOM-KYN-021, 051); lisansı dolan ve telif bildirimiyle incelemeye alınan içerikte süren deneme sürer (DOM-KYN-021, 025). \`If-Match\` zorunlu: denemenin \`rowVersion\`'ı (yoksa 400 \`if_match_required\`, tutmazsa 409 \`version_conflict\`; sürüm içerik kuralından önce sınanır). Otomatik kayıt denetim kaydına yazılmaz. ${WRITE_ACCESS}`,
        params: taskAttemptParamsSchema,
        body: taskAttemptAnswersBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        response: { 200: taskAttemptDetailResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await saveTaskAttemptAnswers(
        contextOf(request),
        {
          attemptId: request.params.attemptId,
          answers: request.body.answers,
          expectedVersion: requiredVersion(request),
        },
        idempotencyOf(request, false),
      )
      return send(reply, result)
    },
  )

  typed.post(
    '/api/v1/task-attempts/:attemptId/submit',
    {
      preValidation: [...write, requireIfMatch()],
      schema: {
        operationId: 'submitTaskAttempt',
        tags: ['task-attempts'],
        summary: 'Denemeyi teslim et',
        description: `Denemeyi teslim eder (DOM-BEC-010, 043; core \`planAttemptSubmit\`). Puan sunucuda cevaplardan hesaplanır; gövdede puan veya bilinmeyen alan 400. Süre dolduysa gönderilen cevaplar alınmaz, deneme kaydedilmiş cevaplarla bitiş anında teslim edilir (\`autoSubmitted\`). Son teslimden sonra geç kabul süresinde teslim \`late\` işaretlenir. İkinci teslim 409 \`attempt_already_submitted\`. Kaldırılan ya da öğrencinin kitap sahibi olmadığı içerikte 422 \`content_unavailable\` (DOM-KYN-021, 051); lisansı dolan ve telif bildirimiyle incelemeye alınan içerikte süren deneme sürer (DOM-KYN-021, 025). \`If-Match\` zorunlu (denemenin \`rowVersion\`'ı; tutmazsa 409 \`version_conflict\`, içerik kuralından önce); \`Idempotency-Key\` zorunlu. ${WRITE_ACCESS}`,
        params: taskAttemptParamsSchema,
        body: taskAttemptSubmitBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        response: { 200: taskAttemptDetailResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const expectedVersion = requiredVersion(request)
      const result = await submitTaskAttempt(
        contextOf(request),
        { attemptId: request.params.attemptId, answers: request.body.answers, expectedVersion },
        idempotencyOf(request, true),
      )
      return send(reply, result)
    },
  )
}
