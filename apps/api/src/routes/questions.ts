import type { FastifyInstance, FastifyRequest, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'
import {
  answerQuestionSchema,
  askQuestionSchema,
  withdrawQuestionSchema,
} from '@kampus/school-core/lib/questions.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  answerQuestionCommand,
  askQuestionCommand,
  withdrawQuestionCommand,
} from '../services/questions.ts'
import { sendCommand } from './command-support.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'
import { questionParamsSchema } from './questions.schemas.ts'

/**
 * Öğretmenime Sor uçları (docs/domain/iletisim-ve-veli.md DOM-ILT-090…093). Okuma genel koleksiyon
 * ucundadır (`GET /collections/questions`): öğrenci kendi, veli bağlı çocuklarının, öğretmen
 * kendisine atanan sorularını, yönetici tümünü görür; ön büro göremez. Sıra komut uçlarıyla
 * aynıdır: 401 → 403 `module_disabled` → 403 `forbidden` (core `WRITE_ACTION_ROLES`) → `If-Match`
 * → 400 gövde → işlem (404, 422, 409). Kapsam core `requireAuthorized`'dadır.
 *
 * Yanıt ve geri çekme var olan bir soruyu değiştirir: `If-Match` zorunludur. Aynı soruya eşzamanlı
 * iki yanıtta ikincisi 409 `version_conflict` alır; öğretmen güncel soruyu görmeden ek yanıt
 * yazmaz. Soru gönderme oluşturmadır: `Idempotency-Key` zorunlu, `If-Match` 400.
 */

const response = { 200: commandResponseSchema, ...commandErrors }
const created = { 201: commandResponseSchema, ...commandErrors }
const location = (id: string) => `/api/v1/collections/questions/${encodeURIComponent(id)}`

export function registerQuestionRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /** Kimlik → modül (core komut tablosu) → rol → `If-Match` → ham gövde. */
  function guard(
    action: WriteAction,
    ifMatch: 'reject' | 'required',
  ): preValidationAsyncHookHandler[] {
    const module = OPERATION_COMMANDS[action].module
    return [
      app.authenticate,
      ...(module === null ? [] : [app.requireModule(module)]),
      app.requireRole(WRITE_ACTION_ROLES[action]),
      ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
      captureInput(),
    ]
  }
  const rolesOf = (action: WriteAction) =>
    WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')
  const input = (request: FastifyRequest) => request.commandInput

  typed.post(
    '/api/v1/questions',
    {
      preValidation: guard('question.ask', 'reject'),
      schema: {
        operationId: 'askQuestion',
        tags: ['questions'],
        summary: 'Öğretmene soru gönder',
        description: `Öğrenci kendi sınıfının o dersine atanmış öğretmene soru gönderir; öğretmen ders atamasından çözülür (core \`askQuestion\`, DOM-ILT-090). Öğrenci oturumdan gelir, gövdede \`studentId\` ve bilinmeyen alan 400 \`validation_failed\`; başlık 2–120, metin 10–2000 karakter. Kapsam dışı ders veya öğretmen 403 \`question_scope_denied\` (varlık sızdırılmaz), bağlantısız öğrenci 403 \`student_scope_denied\`; pasif öğrenci 422 \`student_inactive\`, öğretmeni pasif ders 422 \`question_teacher_unavailable\`, ortak derste öğretmen seçilmezse 422 \`question_teacher_required\`, dersin listesinde olmayan kazanım 422 \`question_topic_unknown\`. Fotoğraf \`fileIds\` ile gelir (DOM-ILT-094): en çok 3, 4. fotoğraf 422 \`question_photo_limit\`; öğrencinin kendi yüklediği \`student_question_photo\` dosyası olmalı, değilse 422 \`question_photo_unavailable\` ya da \`question_photo_purpose\`. Modül \`learning\`. \`Idempotency-Key\` zorunludur. Başarı 201 ve \`Location\`. Roller: ${rolesOf('question.ask')}.`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: askQuestionSchema,
        response: created,
      },
    },
    async (request, reply) => {
      const body = sendCommand(
        reply,
        await askQuestionCommand(contextOf(request), input(request), options(request, 'required')),
      )
      const entity = body.data.entity
      if (entity) reply.header('location', location(entity.id))
      return body
    },
  )

  typed.post(
    '/api/v1/questions/:questionId/answers',
    {
      preValidation: guard('question.answer', 'required'),
      schema: {
        operationId: 'answerQuestion',
        tags: ['questions'],
        summary: 'Soruyu yanıtla',
        description: `Sorunun atandığı öğretmen yanıt yazar (core \`answerQuestion\`, DOM-ILT-092). İlk yanıt \`answer\`, \`answeredAt\`, \`answeredBy\` alanlarına, sonrakiler ek yanıt olarak \`followUps\` listesine eklenir; verilmiş yanıt değişmez. Ek yanıtı yalnız sınıfın o dersine hâlâ atanmış öğretmen yazar; dersten alınan öğretmen 403 \`question_teacher_reassigned\`. Yanıt süresi saklanmaz (DOM-ILT-013). Başka öğretmenin sorusu ve olmayan soru 404; geri çekilmiş soru 409 \`question_withdrawn\`; en çok 10 yanıt, aşılırsa 422 \`question_answer_limit\`. \`If-Match\` zorunludur (sorunun sürümü): eksikse 400 \`if_match_required\`, tutmazsa 409 \`version_conflict\`. Başarı 201 ve \`Location\` (soru kaydı). Roller: ${rolesOf('question.answer')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: questionParamsSchema,
        body: answerQuestionSchema,
        response: created,
      },
    },
    async (request, reply) => {
      const body = sendCommand(
        reply,
        await answerQuestionCommand(
          contextOf(request),
          request.params.questionId,
          input(request),
          options(request, 'optional'),
        ),
      )
      const entity = body.data.entity
      if (entity) reply.header('location', location(entity.id))
      return body
    },
  )

  typed.patch(
    '/api/v1/questions/:questionId',
    {
      preValidation: guard('question.withdraw', 'required'),
      schema: {
        operationId: 'withdrawQuestion',
        tags: ['questions'],
        summary: 'Soruyu geri çek',
        description: `Öğrenci yanıtlanmamış sorusunu geri çeker (core \`withdrawQuestion\`, DOM-ILT-091). Tek izinli değişiklik \`{ "withdrawn": true }\`'dur; başlık, metin, ders veya kazanım gönderilirse 400 \`validation_failed\` (gönderilen soru değişmez). Kayıt silinmez, \`withdrawnAt\` yazılır. Yanıtlanmış soru 409 \`question_answered\`, ikinci geri çekme 409 \`question_withdrawn\`; başkasının sorusu ve olmayan soru 404. \`If-Match\` zorunludur: eksikse 400 \`if_match_required\`, tutmazsa 409 \`version_conflict\`. Roller: ${rolesOf('question.withdraw')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: questionParamsSchema,
        body: withdrawQuestionSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await withdrawQuestionCommand(
          contextOf(request),
          request.params.questionId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )
}
