import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  createHomework,
  editHomework,
  getHomework,
  gradeSubmissionCommand,
  listHomework,
  removeHomework,
  submitHomeworkCommand,
} from '../services/homework.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  createHomeworkBodySchema,
  gradeSubmissionBodySchema,
  homeworkDetailResponseSchema,
  homeworkListQuerySchema,
  homeworkListResponseSchema,
  homeworkParamsSchema,
  homeworkResponseSchema,
  submissionParamsSchema,
  submissionResponseSchema,
  submitHomeworkBodySchema,
  updateHomeworkBodySchema,
} from './homework.schemas.ts'

/**
 * Ödev uçları (IST-095; docs/domain/akademik-olcme.md DOM-AKD-070…074). Kural, rol ve kapsam core
 * `lib/homework.ts`'dedir. Modül `learning` (core komut tablosu): kapalıysa her uç 403
 * `module_disabled`. Yazma rolleri core `WRITE_ACTION_ROLES`'tan gelir ve gövdeden önce
 * denetlenir. Sıra: 401 → 403 modül → 403 rol → `Idempotency-Key`/`If-Match` → 400 gövde →
 * işlem (404, 403, 409 sürüm, 422, 409).
 */

const LEARNING = OPERATION_COMMANDS['homework.assign'].module ?? 'learning'
const rolesOf = (action: WriteAction) =>
  WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')

const READ_ACCESS =
  'Yönetici kurumun bütün ödevlerini, öğretmen derse girdiği sınıfların ve kendi verdiği ödevleri, öğrenci kendi sınıfının, veli çocuğunun sınıfının ödevlerini okur; ön büro okumaz (403). Teslimleri öğrenci yalnız kendisininkini, veli çocuğununkini, öğretmen sınıflarındaki öğrencilerinkini görür (DOM-AKD-074). Görmediği ve başka kurumun ödevi olmayan kimlikle aynı 404. Modül `learning`; kapalıysa 403 `module_disabled`.'
const HOMEWORK_VERSION =
  "`If-Match` ödevin `version`'ı (zorunlu; yoksa 400 `if_match_required`), tutmazsa 409 `version_conflict`. Ödevi gören başka öğretmen 403 `homework_not_owner`, görmeyen ve başka kurumun ödevi 404. `Idempotency-Key` isteğe bağlı."

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

const homeworkLocation = (id: string) => `/api/v1/homework/${encodeURIComponent(id)}`

export function registerHomeworkRoutes(app: FastifyInstance) {
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
    '/api/v1/homework',
    {
      preValidation: read,
      schema: {
        operationId: 'listHomework',
        tags: ['homework'],
        summary: 'Ödevler',
        description: `Ödevler son teslim anına göre yeniden eskiye, sonra kimliğe göre sıralı, sayfalı. Süzgeç: \`classId\`, \`subjectId\`, \`status\` (\`open\`, \`closed\`, \`all\`), \`dateFrom\`/\`dateTo\` (son teslim anının Europe/Istanbul günü, dahil; ters aralık 400). Her satır okuyanın gördüğü teslimlerin sayılarını taşır (\`submissionCounts\`). Bilinmeyen parametre 400. ${READ_ACCESS}`,
        querystring: homeworkListQuerySchema,
        response: { 200: homeworkListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize, classId, subjectId, status, dateFrom, dateTo } = request.query
      const result = await listHomework(contextOf(request), {
        page,
        pageSize,
        classId,
        subjectId,
        status,
        dateFrom,
        dateTo,
      })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/homework/:homeworkId',
    {
      preValidation: read,
      schema: {
        operationId: 'getHomework',
        tags: ['homework'],
        summary: 'Ödev',
        description: `Tek ödev ve okuyanın görebildiği teslimleri (\`submissions\`, teslim anına göre). ${READ_ACCESS}`,
        params: homeworkParamsSchema,
        response: { 200: homeworkDetailResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getHomework(contextOf(request), request.params.homeworkId),
    }),
  )

  typed.post(
    '/api/v1/homework',
    {
      preValidation: write('homework.assign', 'reject'),
      schema: {
        operationId: 'createHomework',
        tags: ['homework'],
        summary: 'Ödev ver',
        description: `Yeni ödev (core \`assignHomework\`, DOM-AKD-070). Öğretmen yalnız derse girdiği sınıf ve branşa (403 \`homework_scope_denied\`); sınıfa birden çok dersle giriyorsa \`subjectId\` zorunlu (422 \`homework_subject_required\`). Yönetici \`subjectId\` verir; ödevin öğretmeni sınıfın o dersine atanmış öğretmendir (yoksa 422 \`homework_teacher_unavailable\`). \`dueDate\` saat dilimli ISO 8601 an, UTC saklanır; geçmişte olamaz (422 \`homework_due_in_past\`). \`allowLate\` varsayılan \`true\`. Olmayan sınıf 404, pasif sınıf 422 \`record_inactive\`. \`Idempotency-Key\` zorunlu; \`If-Match\` 400. Başarı 201 ve \`Location\`. Roller: ${rolesOf('homework.assign')}.`,
        body: createHomeworkBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: homeworkResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const body = send(
        reply,
        await createHomework(contextOf(request), request.body, idempotencyOf(request, true)),
        homeworkResponseSchema,
      )
      reply.header('location', homeworkLocation(body.data.id))
      return body
    },
  )

  typed.patch(
    '/api/v1/homework/:homeworkId',
    {
      preValidation: write('homework.update', 'required'),
      schema: {
        operationId: 'updateHomework',
        tags: ['homework'],
        summary: 'Ödevi düzenle',
        description: `Başlık, açıklama, son teslim anı ve geç teslim (core \`updateHomework\`, DOM-AKD-071); sınıf ve ders değişmez (gövdede 400). Yeni son teslim anı geçmişte olamaz (422 \`homework_due_in_past\`). ${HOMEWORK_VERSION} Roller: ${rolesOf('homework.update')}.`,
        params: homeworkParamsSchema,
        body: updateHomeworkBodySchema,
        headers: versionedHeaders,
        response: { 200: homeworkResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await editHomework(
          contextOf(request),
          { homeworkId: request.params.homeworkId, expectedVersion: requiredVersion(request) },
          request.body,
          idempotencyOf(request, false),
        ),
        homeworkResponseSchema,
      ),
  )

  typed.delete(
    '/api/v1/homework/:homeworkId',
    {
      preValidation: write('homework.archive', 'required'),
      schema: {
        operationId: 'archiveHomework',
        tags: ['homework'],
        summary: 'Ödevi arşivle',
        description: `Ödevi arşivler (core \`archiveHomework\`, DOM-AKD-071); kayıt silinmez. Teslim alınmış ödev arşivlenmez: 409 \`homework_has_submissions\` (teslim, puan ve geri bildirim korunur). ${HOMEWORK_VERSION} Roller: ${rolesOf('homework.archive')}.`,
        params: homeworkParamsSchema,
        headers: versionedHeaders,
        response: { 200: homeworkResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await removeHomework(
          contextOf(request),
          { homeworkId: request.params.homeworkId, expectedVersion: requiredVersion(request) },
          idempotencyOf(request, false),
        ),
        homeworkResponseSchema,
      ),
  )

  typed.post(
    '/api/v1/homework/:homeworkId/submissions',
    {
      preValidation: write('homework.submit', 'reject'),
      schema: {
        operationId: 'submitHomework',
        tags: ['homework'],
        summary: 'Ödevi teslim et',
        description: `Öğrenci kendi sınıfının ödevini metin (\`note\`) ve/veya dosyayla (\`fileIds\`, en çok 5) teslim eder (core \`submitHomework\`, DOM-AKD-072). Öğrenci oturumdan gelir; başka sınıfın ödevi ve olmayan ödev 404, bağlantısız öğrenci 403 \`student_scope_denied\`, pasif öğrenci 422 \`student_inactive\`. Son teslim anı geçmişse ödev geç teslime açıksa \`late: true\` ile kabul edilir, değilse 422 \`homework_closed\`. İlk teslim 201 + \`Location\`, puanlanmamış teslimin yenilenmesi 200; puanlanmış teslim 409 \`submission_graded\`. Dosyalar \`POST /files\` (amaç \`submission\`) ile yüklenir ve aynı işlemde teslime bağlanır (ADR 0003): başkasının, başka kurumun ya da olmayan dosyası 422 \`file_unavailable\`, denetimi bitmemiş 422 \`file_not_ready\`, başka kayda bağlı 409 \`file_already_attached\`; hata olursa hiçbir kayıt değişmez. \`Idempotency-Key\` zorunlu; \`If-Match\` 400. Roller: ${rolesOf('homework.submit')}.`,
        params: homeworkParamsSchema,
        body: submitHomeworkBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: {
          200: submissionResponseSchema,
          201: submissionResponseSchema,
          ...commandErrors,
        },
      },
    },
    async (request, reply) => {
      const body = send(
        reply,
        await submitHomeworkCommand(
          contextOf(request),
          request.params.homeworkId,
          request.body,
          idempotencyOf(request, true),
        ),
        submissionResponseSchema,
      )
      if (reply.statusCode === 201)
        reply.header('location', homeworkLocation(request.params.homeworkId))
      return body
    },
  )

  typed.post(
    '/api/v1/homework/:homeworkId/submissions/:submissionId/grade',
    {
      preValidation: write('homework.grade', 'required'),
      schema: {
        operationId: 'gradeHomeworkSubmission',
        tags: ['homework'],
        summary: 'Teslimi değerlendir',
        description: `Ödevin öğretmeni teslime 0–100 tam sayı puan (\`score\`) ve geri bildirim (\`feedback\`, 2–2000 karakter) yazar (core \`gradeSubmission\`, DOM-AKD-073); yeniden değerlendirme ikisini günceller. Puan resmî not değildir (DOM-AKD-060). Aynı işlemde öğrenciye ve 18 yaş altında veliye \`homework_graded\` bildirimi yazılır (öğrenme ya da iletişim modülü kapalıysa yazılmaz). Ödevi gören başka öğretmen 403 \`homework_not_owner\`; görmeyen, başka kurumun ya da başka ödevin teslimi 404. \`If-Match\` teslimin \`version\`'ı (zorunlu; yoksa 400 \`if_match_required\`), tutmazsa 409 \`version_conflict\`. \`Idempotency-Key\` isteğe bağlı. Roller: ${rolesOf('homework.grade')}.`,
        params: submissionParamsSchema,
        body: gradeSubmissionBodySchema,
        headers: versionedHeaders,
        response: { 200: submissionResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await gradeSubmissionCommand(
          contextOf(request),
          {
            homeworkId: request.params.homeworkId,
            submissionId: request.params.submissionId,
            expectedVersion: requiredVersion(request),
          },
          request.body,
          idempotencyOf(request, false),
        ),
        submissionResponseSchema,
      ),
  )
}
