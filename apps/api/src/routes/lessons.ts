import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { mayRun, type WorkflowCommand } from '@kampus/school-core/lib/school-workflows.ts'
import { WORKFLOW_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { ROLES } from '../auth.ts'
import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelLesson,
  createLesson,
  getLesson,
  listLessons,
  substituteLesson,
  updateLesson,
  type LessonTarget,
} from '../services/lessons.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  cancelLessonBodySchema,
  createLessonBodySchema,
  lessonListQuerySchema,
  lessonListResponseSchema,
  lessonParamsSchema,
  lessonResponseSchema,
  substituteLessonBodySchema,
  updateLessonBodySchema,
} from './lessons.schemas.ts'

/**
 * Ders programı uçları (IST-094; docs/domain/yetki-ve-kapsam.md DOM-YTK-068, DOM-YTK-069).
 * Kural core iş akışındadır (`lesson`, `substitute`, `lesson-cancel`); köprü
 * (`/workflows/<komut>`) aynı kuralı çalıştırır. Modül `planning` (core komut tablosu): kapalıysa
 * her uç 403 `module_disabled`. Okuma ayrıca ders programı koleksiyonunun modülünü (`academic`)
 * ve core okuma kuralını ister. Yazma rolleri core `mayRun`'dan gelir ve gövdeden önce denetlenir.
 * Sıra: 401 → 403 modül → 403 rol → `If-Match` → 400 gövde → işlem (404, 403, 409 sürüm, 422, 409).
 */

const PLANNING = WORKFLOW_COMMANDS.lesson.module
const writers = (command: WorkflowCommand) => ROLES.filter((role) => mayRun({ role }, command))
const rolesOf = (command: WorkflowCommand) =>
  writers(command)
    .map((role) => `\`${role}\``)
    .join(', ')

const READ_ACCESS =
  'Yönetici ve ön büro kurumun bütün programını, öğretmen kendi (asıl ya da yedek olduğu) derslerini, öğrenci kendi sınıfının, veli çocuğunun sınıfının programını okur (DOM-YTK-068). İptal ve görevlendirme gerekçesi (`cancelReason`, `substitutions`) yalnız yöneticiye döner; öğretmen, ön büro, öğrenci ve veli `status` ve `originalTeacherId` alanlarını görür. Modül `planning` ve `academic`; kapalıysa 403 `module_disabled`.'
const VERSIONED =
  "`If-Match` dersin `version`'ı (zorunlu; yoksa 400 `if_match_required`), tutmazsa 409 `version_conflict`; olmayan ya da başka kurumun dersi 404. `Idempotency-Key` isteğe bağlı."
const PAST = 'Başlamış veya geçmiş ders değişmez: 422 `lesson_in_past` (DOM-YTK-069).'
const CONFLICTS =
  'Çakışma 409: öğretmenin başka dersi `teacher_lesson_conflict`, sınıfın başka dersi `class_lesson_conflict`, aynı kampüste derslik `room_conflict` (boşluk ve büyük/küçük harf duyarsız), öğretmenin randevusu `teacher_appointment_conflict`, öğretmenin okul etkinliği `teacher_event_conflict`, öğretmenin etüdü ya da dersliğin etüdü `tutor_schedule_conflict`. İptal edilen ders saati boşaltır.'
const TEACHER_RULE =
  'Öğretmen etkin olmalı (pasif 422 `record_inactive`), sınıfın kampüsünde ve dersin branşında (422 `lesson_teacher_mismatch`).'

function requiredVersion(request: FastifyRequest): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

const target = (request: FastifyRequest<{ Params: { lessonId: string } }>): LessonTarget => ({
  lessonId: request.params.lessonId,
  expectedVersion: requiredVersion(request),
})

function sendLesson(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return lessonResponseSchema.parse(response.body)
}

export function registerLessonRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const read = [app.authenticate, app.requireModule(PLANNING)]
  const write = (command: WorkflowCommand) => [
    app.authenticate,
    app.requireModule(PLANNING),
    app.requireRole(writers(command)),
  ]
  const versionedHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    '/api/v1/lessons',
    {
      preValidation: read,
      schema: {
        operationId: 'listLessons',
        tags: ['lessons'],
        summary: 'Ders programı',
        description: `Dersler başlangıca göre, sonra kimliğe göre sıralı, sayfalı. Süzgeç: \`dateFrom\`/\`dateTo\` (Europe/Istanbul günü, dahil; ters aralık 400), \`classId\`, \`teacherId\` (dersi veren), \`room\`, \`cancelled\`. İptal edilen ders varsayılan olarak dönmez (günlük program); \`cancelled=true\` ya da \`all\` iptal geçmişini verir. Bilinmeyen parametre 400. ${READ_ACCESS}`,
        querystring: lessonListQuerySchema,
        response: { 200: lessonListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize, dateFrom, dateTo, classId, teacherId, room, cancelled } =
        request.query
      const result = await listLessons(contextOf(request), {
        page,
        pageSize,
        dateFrom,
        dateTo,
        classId,
        teacherId,
        room,
        cancelled,
      })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/lessons/:lessonId',
    {
      preValidation: read,
      schema: {
        operationId: 'getLesson',
        tags: ['lessons'],
        summary: 'Ders',
        description: `Tek ders (iptal edilmiş olsa da). Olmayan, başka kurumun ya da aktörün göremediği ders 404. ${READ_ACCESS}`,
        params: lessonParamsSchema,
        response: { 200: lessonResponseSchema, ...readErrors },
      },
    },
    async (request) => ({ data: await getLesson(contextOf(request), request.params.lessonId) }),
  )

  typed.post(
    '/api/v1/lessons',
    {
      preValidation: [...write('lesson'), rejectIfMatch()],
      schema: {
        operationId: 'createLesson',
        tags: ['lessons'],
        summary: 'Ders planla',
        description: `Yeni ders (core \`runWorkflow('lesson')\`, DOM-YTK-069). Ders geçmiş saate planlanamaz (422 \`lesson_in_past\`). ${TEACHER_RULE} ${CONFLICTS} Pasif sınıf 422 \`record_inactive\`; olmayan sınıf, öğretmen veya kampüs 404. \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\`. Roller: ${rolesOf('lesson')}.`,
        body: createLessonBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: lessonResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const body = sendLesson(
        reply,
        await createLesson(contextOf(request), request.body, idempotencyOf(request, true)),
      )
      reply.header('location', `/api/v1/lessons/${encodeURIComponent(body.data.id)}`)
      return body
    },
  )

  typed.patch(
    '/api/v1/lessons/:lessonId',
    {
      preValidation: [...write('lesson'), requireIfMatch()],
      schema: {
        operationId: 'updateLesson',
        tags: ['lessons'],
        summary: 'Dersi düzenle',
        description: `Dersin alanlarını kısmi değiştirir; gönderilmeyen alanlar dersin mevcut değeridir ve ders bütün olarak yeniden doğrulanır (core \`runWorkflow('lesson')\`). İptal edilmiş ders 422 \`lesson_cancelled\`. Yedek atanmış derste öğretmen değişmez: 422 \`lesson_has_substitution\` (yedek atama işlemi kullanılır). ${PAST} ${TEACHER_RULE} ${CONFLICTS} ${VERSIONED} Roller: ${rolesOf('lesson')}.`,
        params: lessonParamsSchema,
        body: updateLessonBodySchema,
        headers: versionedHeaders,
        response: { 200: lessonResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendLesson(
        reply,
        await updateLesson(
          contextOf(request),
          target(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.post(
    '/api/v1/lessons/:lessonId/substitute',
    {
      preValidation: [...write('substitute'), requireIfMatch()],
      schema: {
        operationId: 'substituteLesson',
        tags: ['lessons'],
        summary: 'Derse yedek öğretmen ata',
        description: `Yalnız bu derse yedek öğretmen atar (core \`runWorkflow('substitute')\`); asıl öğretmen \`originalTeacherId\`'de, görevlendirme \`substitutions\` geçmişinde kalır, kalıcı branş ataması değişmez. Gerekçe zorunlu (en çok 500 karakter) ve denetim kaydına yazılır. Aynı öğretmen 422 \`teacher_unchanged\`; iptal edilmiş ders 422 \`lesson_cancelled\`. ${PAST} ${TEACHER_RULE} ${CONFLICTS} ${VERSIONED} Roller: ${rolesOf('substitute')}.`,
        params: lessonParamsSchema,
        body: substituteLessonBodySchema,
        headers: versionedHeaders,
        response: { 200: lessonResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendLesson(
        reply,
        await substituteLesson(
          contextOf(request),
          target(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.post(
    '/api/v1/lessons/:lessonId/cancel',
    {
      preValidation: [...write('lesson-cancel'), requireIfMatch()],
      schema: {
        operationId: 'cancelLesson',
        tags: ['lessons'],
        summary: 'Dersi iptal et',
        description: `Dersi gerekçeyle iptal eder (core \`runWorkflow('lesson-cancel')\`); kayıt silinmez, \`cancelledAt\` ve \`cancelReason\` yazılır, gerekçe denetim kaydına da düşer. İptal edilen ders günlük programda görünmez, \`cancelled=true\` ile listelenir. Gerekçe yoksa 400 \`validation_failed\` (\`reason\`). Zaten iptal 409 \`lesson_already_cancelled\`. ${PAST} Sınıfın ders günü için yoklama alınmışsa 422 \`lesson_attendance_taken\`. ${VERSIONED} Roller: ${rolesOf('lesson-cancel')}.`,
        params: lessonParamsSchema,
        body: cancelLessonBodySchema,
        headers: versionedHeaders,
        response: { 200: lessonResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendLesson(
        reply,
        await cancelLesson(
          contextOf(request),
          target(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )
}
