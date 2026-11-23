import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'

import { AppError, MESSAGES, NotFoundError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  activateCourse,
  archiveCourse,
  createCourse,
  getCourse,
  listCourses,
  recordCourseEOzel,
  updateCourse,
} from '../services/courses.ts'
import { getInstitutionModules } from '../services/modules.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  courseEOzelBodySchema,
  courseListQuerySchema,
  courseListResponseSchema,
  courseParamsSchema,
  courseResponseSchema,
  createCourseBodySchema,
  updateCourseBodySchema,
} from './courses.schemas.ts'
import { emptyCommandBodySchema } from './workflows.schemas.ts'

/**
 * Dil okulu kur programı uçları (IST-076; docs/domain/dil-okulu.md DOM-DIL-005…007). Kur modüle
 * bağlı değildir, kurum türüne bağlıdır: okulda (`school`) her uç her rol için 404, rol
 * denetiminden önce (core `authorize` ile aynı sıra; yetkisiz rol 403 ile ucun varlığını öğrenmez,
 * DOM-YTK-012). Rol listesi core yetki tablosundan (`WRITE_ACTION_ROLES`) gelir ve
 * `preValidation`'da denetlenir. Sıra: 401 → 404 kurum türü → 403 rol → `If-Match` → 400 → işlem
 * (404 kur, 409 sürüm, 403 koordinatör kapsamı, 409, 422).
 */

const rolesOf = (action: WriteAction) =>
  WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')

const TYPE_ONLY =
  'Yalnız dil okulunda (`language_school`); okulda her rol için 404, rol denetiminden önce.'
const READ_ACCESS = `Roller: ${rolesOf('course.read')}. Öğrenci ve veli yalnız etkin kurları ve katalog alanlarını görür (en az mevcut, durum, e-Özel kaydı, işlem anları ve sürüm dönmez; sonraki kur yalnız etkinse). ${TYPE_ONLY}`
const MANAGE_ACCESS = `Roller: ${rolesOf('course.manage')}; diğer roller 403. Öğretmen yalnız akademik koordinatörü olduğu seviyenin kurlarını yönetir (403 \`course_coordinator_required\`; seviye değişiminde eski ve yeni seviye). Denetime yalnız alan adları yazılır. ${TYPE_ONLY}`
const EOZEL_ACCESS = `Yalnız ${rolesOf('course.eozel')}; diğer roller 403. Denetime yalnız alan adları yazılır. ${TYPE_ONLY}`
const VERSIONED =
  "`If-Match` kurun `rowVersion`'ı (zorunlu), tutmazsa 409 `version_conflict`; olmayan ya da başka kurumun kuru 404. Arşivli kur değişmez: 409 `course_archived`. `Idempotency-Key` isteğe bağlı."

function requiredVersion(request: FastifyRequest): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

function sendCourse(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return courseResponseSchema.parse(response.body)
}

const target = (request: FastifyRequest<{ Params: { courseId: string } }>) => ({
  courseId: request.params.courseId,
  expectedVersion: requiredVersion(request),
})

export function registerCourseRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /** Kur yalnız dil okulunda vardır (DOM-DIL-005); okulda 404 (prospects deneme dersiyle aynı). */
  const languageSchool: preValidationAsyncHookHandler = async function (request) {
    const ctx = contextOf(request)
    const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
    if (institution?.type !== 'language_school') throw new NotFoundError()
  }
  const guard = (action: WriteAction) => [
    app.authenticate,
    languageSchool,
    app.requireRole(WRITE_ACTION_ROLES[action]),
  ]
  const read = guard('course.read')
  const created = [...guard('course.manage'), rejectIfMatch()]
  const managed = [...guard('course.manage'), requireIfMatch()]
  const eOzel = [...guard('course.eozel'), requireIfMatch()]
  const versionedHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    '/api/v1/courses',
    {
      preValidation: read,
      schema: {
        operationId: 'listCourses',
        tags: ['institution'],
        summary: 'Kurlar',
        description: `Kurumun kur programı: seviye sırasıyla (Pre-A1 … C2), sonra ada göre, sayfalı. Arşiv varsayılan olarak dışlanır, \`status=archived\` ile okunur. Süzgeç \`status\`, \`level\`, \`language\`; bilinmeyen parametre 400. ${READ_ACCESS}`,
        querystring: courseListQuerySchema,
        response: { 200: courseListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status, level, language } = request.query
      const result = await listCourses(contextOf(request), {
        page,
        pageSize,
        status,
        level,
        language,
      })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/courses/:courseId',
    {
      preValidation: read,
      schema: {
        operationId: 'getCourse',
        tags: ['institution'],
        summary: 'Kur',
        description: `Tek kur; olmayan, başka kurumun ya da rolün göremediği (öğrenci ve velide etkin olmayan) kur 404. ${READ_ACCESS}`,
        params: courseParamsSchema,
        response: { 200: courseResponseSchema, ...readErrors },
      },
    },
    async (request) => ({ data: await getCourse(contextOf(request), request.params.courseId) }),
  )

  typed.post(
    '/api/v1/courses',
    {
      preValidation: created,
      schema: {
        operationId: 'createCourse',
        tags: ['institution'],
        summary: 'Kur oluştur',
        description: `Yeni kur \`draft\` durumunda açılır (core \`planCourseCreation\`, DOM-DIL-005). Dil verilmezse \`en\`, oturum 45 dakika, belgesiz. Ad arşivlenmemiş kurlarda tekil (409 \`course_name_exists\`); toplam saat haftalık saatten az olamaz (422 \`course_hours_invalid\`); 90 dakikalık oturumda saatler çift (422 \`course_session_mismatch\`); en az mevcut en çok mevcudu aşamaz (422 \`course_learners_invalid\`); sonraki kur aynı dilde, seviyesi düşük olmayan, arşivlenmemiş ve döngüsüz (422 \`course_next_*\`, DOM-DIL-007). \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\`. ${MANAGE_ACCESS}`,
        body: createCourseBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: courseResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const body = sendCourse(
        reply,
        await createCourse(contextOf(request), request.body, idempotencyOf(request, true)),
      )
      reply.header('location', `/api/v1/courses/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    '/api/v1/courses/:courseId',
    {
      preValidation: managed,
      schema: {
        operationId: 'updateCourse',
        tags: ['institution'],
        summary: 'Kuru değiştir',
        description: `Kurun alanlarını değiştirir (DOM-DIL-005…007); kurallar oluşturmadaki gibidir. Etkin kurun dili, seviyesi, saatleri, oturumu ve belge türü değişmez (422 \`course_active_locked\`; yeni kur tanımlanır). Taslakta bu alanlardan biri değişirse e-Özel onayı sıfırlanır (\`not_submitted\`, program kodu kalır; DOM-DIL-006). ${VERSIONED} ${MANAGE_ACCESS}`,
        params: courseParamsSchema,
        body: updateCourseBodySchema,
        headers: versionedHeaders,
        response: { 200: courseResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendCourse(
        reply,
        await updateCourse(
          contextOf(request),
          target(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.post(
    '/api/v1/courses/:courseId/activate',
    {
      preValidation: managed,
      schema: {
        operationId: 'activateCourse',
        tags: ['institution'],
        summary: 'Kuru etkinleştir',
        description: `Taslak kuru etkinleştirir (DOM-DIL-005); yalnız taslak (409 \`course_not_draft\`). Belgeli kur, programı e-Özel'de onaylanmadan etkinleşmez (422 \`course_program_not_approved\`, DOM-DIL-006). Gövde yok ya da boş nesne. ${VERSIONED} ${MANAGE_ACCESS}`,
        params: courseParamsSchema,
        body: emptyCommandBodySchema.strict().optional(),
        headers: versionedHeaders,
        response: { 200: courseResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendCourse(
        reply,
        await activateCourse(contextOf(request), target(request), idempotencyOf(request, false)),
      ),
  )

  typed.delete(
    '/api/v1/courses/:courseId',
    {
      preValidation: managed,
      schema: {
        operationId: 'archiveCourse',
        tags: ['institution'],
        summary: 'Kuru arşivle',
        description: `Taslak ya da etkin kuru arşivler (DOM-DIL-005); arşiv geri alınmaz. Arşivlenmemiş başka bir kurun sonraki kuruysa arşivlenmez (422 \`course_has_dependents\`, DOM-DIL-007). ${VERSIONED} ${MANAGE_ACCESS}`,
        params: courseParamsSchema,
        headers: versionedHeaders,
        response: { 200: courseResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendCourse(
        reply,
        await archiveCourse(contextOf(request), target(request), idempotencyOf(request, false)),
      ),
  )

  typed.post(
    '/api/v1/courses/:courseId/record-e-ozel',
    {
      preValidation: eOzel,
      schema: {
        operationId: 'recordCourseEOzel',
        tags: ['institution'],
        summary: 'Kurun e-Özel kaydını işaretle',
        description: `Kurumun e-Özel'e elle işlediği kurs programının kodunu ve onay durumunu (\`pending\`, \`approved\`, \`rejected\`) işaretler; iz işaretleyen ve anla tutulur (DOM-DIL-006). Platform e-Özel'e yazmaz. Program kodu arşivlenmemiş kurlarda tekil (409 \`course_program_code_exists\`, büyük/küçük harf duyarsız). Etkin belgeli kurun kaydı değişmez (422 \`course_active_locked\`). ${VERSIONED} ${EOZEL_ACCESS}`,
        params: courseParamsSchema,
        body: courseEOzelBodySchema,
        headers: versionedHeaders,
        response: { 200: courseResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendCourse(
        reply,
        await recordCourseEOzel(
          contextOf(request),
          target(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )
}
