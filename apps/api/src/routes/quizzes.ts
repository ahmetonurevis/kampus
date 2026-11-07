import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'
import { QUIZ_SUBMIT_GRACE_SECONDS } from '@kampus/school-core/lib/quiz.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  archiveQuizCommand,
  createQuizCommand,
  getQuiz,
  listQuizzes,
  startQuizCommand,
  submitQuizCommand,
  updateQuizCommand,
} from '../services/quizzes.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  createQuizBodySchema,
  quizAttemptResponseSchema,
  quizDetailResponseSchema,
  quizListQuerySchema,
  quizListResponseSchema,
  quizParamsSchema,
  quizPersonalDetailResponseSchema,
  quizResponseSchema,
  quizStaffDetailResponseSchema,
  quizStartResponseSchema,
  submitQuizBodySchema,
  updateQuizBodySchema,
} from './quizzes.schemas.ts'

/**
 * Quiz uçları (IST-095; docs/domain/akademik-olcme.md DOM-AKD-075…079). Kural, rol ve kapsam core
 * `lib/quiz.ts`'dedir. Modül `learning` (core komut tablosu): kapalıysa her uç 403
 * `module_disabled`. Yazma rolleri core `WRITE_ACTION_ROLES`'tan gelir ve gövdeden önce
 * denetlenir. Sıra: 401 → 403 modül → 403 rol → `Idempotency-Key`/`If-Match` → 400 gövde →
 * işlem (404, 403, 409 sürüm, 422, 409). Yanıt şeması role özgüdür: öğrenci ve veli yanıtı
 * anahtarsız şemayla ayrıştırılır, şemada olmayan alan istemciye gitmez (DOM-AKD-078).
 */

const LEARNING = OPERATION_COMMANDS['quiz.create'].module ?? 'learning'
const rolesOf = (action: WriteAction) =>
  WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')

const READ_ACCESS =
  'Yönetici kurumun bütün quizlerini, öğretmen derse girdiği sınıfların ve kendi hazırladığı quizleri, öğrenci kendi sınıfının, veli çocuğunun sınıfının quizlerini okur; ön büro okumaz (403). Cevap anahtarı ve çözüm açıklaması yalnız yönetici ve öğretmen yanıtındadır; öğrenci ve veli soru bazında doğru/yanlış da görmez; kendi cevaplarını ve konu yüzdelerini son tarih geçene ya da quiz kapanana kadar görmez, yalnız puan ve doğru sayısını görür (DOM-AKD-078). Denemeleri ve ortalamayı yönetici, quizin öğretmeni (sınıftan ayrılmış olsa da) ve öğrencinin sınıf rehber öğretmeni görür; aynı sınıfa başka dersle giren öğretmen görmez. Öğrenci yalnız kendi, veli çocuğunun denemesini görür (DOM-AKD-079). Görmediği ve başka kurumun quizi olmayan kimlikle aynı 404. Modül `learning`; kapalıysa 403 `module_disabled`.'
const QUIZ_VERSION =
  "`If-Match` quizin `version`'ı (zorunlu; yoksa 400 `if_match_required`), tutmazsa 409 `version_conflict`. Quizi gören başka öğretmen 403 `quiz_not_owner`, görmeyen ve başka kurumun quizi 404. `Idempotency-Key` isteğe bağlı."

function requiredVersion(request: FastifyRequest): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

function send<T>(reply: FastifyReply, response: CommandResponse, schema: z.ZodType<T>): T {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return schema.parse(response.body)
}

const quizLocation = (id: string) => `/api/v1/quizzes/${encodeURIComponent(id)}`

export function registerQuizRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const read = [app.authenticate, app.requireModule(LEARNING)]
  const write = (
    action: WriteAction,
    ifMatch: 'reject' | 'required',
  ): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule(LEARNING),
    app.requireRole(WRITE_ACTION_ROLES[action]),
    ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
  ]
  const versionedHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    '/api/v1/quizzes',
    {
      preValidation: read,
      schema: {
        operationId: 'listQuizzes',
        tags: ['quizzes'],
        summary: 'Quizler',
        description: `Quizler oluşturma anına göre yeniden eskiye, sonra kimliğe göre sıralı, sayfalı. Süzgeç: \`classId\`, \`subjectId\`, \`q\` (başlıkta harf ve aksan duyarsız arama), \`status\` (\`open\`, \`closed\`, \`all\`). Yönetici ve öğretmen satırı deneme özetini (\`statistics\`: başlatan, sonuçlanan, süren, cevaplardan hesaplanan ortalama), öğrenci ve veli satırı yalnız kendi/çocuğunun denemesini (\`attempts\`) taşır. Bilinmeyen parametre 400. ${READ_ACCESS}`,
        querystring: quizListQuerySchema,
        response: { 200: quizListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize, classId, subjectId, q, status } = request.query
      const result = await listQuizzes(contextOf(request), {
        page,
        pageSize,
        classId,
        subjectId,
        q,
        status,
      })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/quizzes/:quizId',
    {
      preValidation: read,
      schema: {
        operationId: 'getQuiz',
        tags: ['quizzes'],
        summary: 'Quiz',
        description: `Tek quiz. Yönetici ve öğretmen \`QuizStaffDetail\` alır: anahtarsız sorular, cevap anahtarı (\`answerKey\`), görünen bütün denemeler ve özet. Öğrenci ve veli \`QuizPersonalDetail\` alır: sorular öğrencide deneme başlatılınca, velide çocuğunun denemesi sonuçlanınca açılır (aksi \`null\`); \`attempts\` kendi/çocuğunun denemesidir, sonuç süre işlerken \`null\`. ${READ_ACCESS}`,
        params: quizParamsSchema,
        response: { 200: quizDetailResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const result = await getQuiz(contextOf(request), request.params.quizId)
      // Role özgü şema: öğrenci ve veli gövdesi anahtarsız şemadan geçer (DOM-AKD-078).
      return result.kind === 'staff'
        ? quizStaffDetailResponseSchema.parse({ data: result.data })
        : quizPersonalDetailResponseSchema.parse({ data: result.data })
    },
  )

  typed.post(
    '/api/v1/quizzes',
    {
      preValidation: write('quiz.create', 'reject'),
      schema: {
        operationId: 'createQuiz',
        tags: ['quizzes'],
        summary: 'Quiz hazırla',
        description: `Soru bankasından yeni quiz (core \`createQuiz\`, DOM-AKD-075). Öğretmen yalnız derse girdiği sınıf ve branşa (403 \`quiz_scope_denied\`); sınıfa birden çok dersle giriyorsa \`subjectId\` zorunlu (422 \`quiz_subject_required\`). Yönetici \`subjectId\` verir; quizin öğretmeni sınıfın o dersine atanmış aktif öğretmendir (yoksa 422 \`quiz_teacher_unavailable\`). Sorular (\`questionIds\`, 1–50, tekil) kurumun bankasında (422 \`quiz_question_unavailable\`), quizin dersinde ve sınıfın düzeyinde olmalı (422 \`quiz_question_mismatch\`). \`duration\` 5–120 dakika. \`dueDate\` isteğe bağlı saat dilimli ISO 8601 an, UTC saklanır; geçmişte olamaz (422 \`quiz_due_in_past\`). Olmayan sınıf 404, pasif sınıf 422 \`record_inactive\`. \`Idempotency-Key\` zorunlu; \`If-Match\` 400. Başarı 201 ve \`Location\`. Roller: ${rolesOf('quiz.create')}.`,
        body: createQuizBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: quizResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const body = send(
        reply,
        await createQuizCommand(contextOf(request), request.body, idempotencyOf(request, true)),
        quizResponseSchema,
      )
      reply.header('location', quizLocation(body.data.id))
      return body
    },
  )

  typed.patch(
    '/api/v1/quizzes/:quizId',
    {
      preValidation: write('quiz.update', 'required'),
      schema: {
        operationId: 'updateQuiz',
        tags: ['quizzes'],
        summary: 'Quizi düzenle',
        description: `Başlık, süre, son tarih (\`null\` kaldırır) ve sorular (core \`updateQuiz\`, DOM-AKD-076); sınıf ve ders değişmez (gövdede 400). Deneme kaydı olan (başlatılmış dahil) quizin soruları değişmez: 409 \`quiz_has_attempts\`; süre ve son tarih yalnız sonraki denemeleri etkiler. Yeni son tarih geçmişte olamaz (422 \`quiz_due_in_past\`). ${QUIZ_VERSION} Roller: ${rolesOf('quiz.update')}.`,
        params: quizParamsSchema,
        body: updateQuizBodySchema,
        headers: versionedHeaders,
        response: { 200: quizResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await updateQuizCommand(
          contextOf(request),
          { quizId: request.params.quizId, expectedVersion: requiredVersion(request) },
          request.body,
          idempotencyOf(request, false),
        ),
        quizResponseSchema,
      ),
  )

  typed.delete(
    '/api/v1/quizzes/:quizId',
    {
      preValidation: write('quiz.archive', 'required'),
      schema: {
        operationId: 'archiveQuiz',
        tags: ['quizzes'],
        summary: 'Quizi arşivle',
        description: `Quizi arşivler (core \`archiveQuiz\`, DOM-AKD-076); kayıt silinmez. Deneme kaydı olan quiz arşivlenmez: 409 \`quiz_has_attempts\` (sonuç ve aktarılmış not korunur). ${QUIZ_VERSION} Roller: ${rolesOf('quiz.archive')}.`,
        params: quizParamsSchema,
        headers: versionedHeaders,
        response: { 200: quizResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await archiveQuizCommand(
          contextOf(request),
          { quizId: request.params.quizId, expectedVersion: requiredVersion(request) },
          idempotencyOf(request, false),
        ),
        quizResponseSchema,
      ),
  )

  typed.post(
    '/api/v1/quizzes/:quizId/attempt',
    {
      preValidation: write('quiz.start', 'reject'),
      schema: {
        operationId: 'startQuiz',
        tags: ['quizzes'],
        summary: 'Quizi başlat',
        description: `Öğrenci kendi sınıfının quizinde denemesini başlatır (core \`startQuiz\`, DOM-AKD-077). Öğrenci oturumdan gelir; başka sınıfın quizi ve olmayan quiz 404, bağlantısız öğrenci 403 \`student_scope_denied\`, pasif öğrenci 422 \`student_inactive\`. Süre sunucuda işler: \`expiresAt\` = başlangıç + süre, son tarih daha erkense son tarih. Yeni deneme 201 + \`Location\`; süresi işleyen deneme varsa aynı deneme ve bitiş anı 200 ile döner. Sonuçlanmış deneme 409 \`quiz_already_attempted\`; son tarihi geçmiş quiz 422 \`quiz_closed\`; bankada eksik soru 422 \`quiz_question_unavailable\`. Yanıt anahtarsız soruları taşır (DOM-AKD-078). Gövde yok. \`Idempotency-Key\` zorunlu; \`If-Match\` 400. Roller: ${rolesOf('quiz.start')}.`,
        params: quizParamsSchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: {
          200: quizStartResponseSchema,
          201: quizStartResponseSchema,
          ...commandErrors,
        },
      },
    },
    async (request, reply) => {
      const body = send(
        reply,
        await startQuizCommand(
          contextOf(request),
          request.params.quizId,
          idempotencyOf(request, true),
        ),
        quizStartResponseSchema,
      )
      if (reply.statusCode === 201) reply.header('location', quizLocation(request.params.quizId))
      return body
    },
  )

  typed.post(
    '/api/v1/quizzes/:quizId/attempt/submit',
    {
      preValidation: write('quiz.submit', 'reject'),
      schema: {
        operationId: 'submitQuiz',
        tags: ['quizzes'],
        summary: 'Quiz cevaplarını gönder',
        description: `Öğrenci başlattığı denemenin cevaplarını gönderir (core \`submitQuiz\`, DOM-AKD-077, -078): \`answers\` soru kimliğinden şık sırasına (0'dan); boş soru gönderilmez ya da \`null\`dır ve yanlış sayılır. Puan yalnız cevaplardan, bankadaki anahtarla sunucuda hesaplanır; gövdede puan ya da bilinmeyen alan 400. Başlatılmamış deneme 422 \`quiz_not_started\`; bitiş anı ve ${String(QUIZ_SUBMIT_GRACE_SECONDS)} sn ağ payı geçtiyse 422 \`quiz_time_expired\` (deneme 0 ile kalır); quizde olmayan soru ya da şık 422 \`quiz_answer_invalid\`; gönderilmiş deneme 409 \`quiz_already_submitted\` (ağ yinelemesi aynı \`Idempotency-Key\` ile ilk yanıtı alır). Başarı 200 ve sonuç (puan, doğru ve soru sayısı, konu yüzdeleri; soru bazında doğru/yanlış yok). \`Idempotency-Key\` zorunlu; \`If-Match\` 400. Roller: ${rolesOf('quiz.submit')}.`,
        params: quizParamsSchema,
        body: submitQuizBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 200: quizAttemptResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await submitQuizCommand(
          contextOf(request),
          request.params.quizId,
          request.body,
          idempotencyOf(request, true),
        ),
        quizAttemptResponseSchema,
      ),
  )
}
