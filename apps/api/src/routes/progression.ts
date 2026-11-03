import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import type { Role } from '../auth.ts'
import { AppError, MESSAGES, NotFoundError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { getInstitutionModules } from '../services/modules.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  getGroupProgression,
  getStudentProgression,
  proposeProgressionDecision,
  recordCourseAssessment,
  reviewProgressionDecision,
} from '../services/progression.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  approveProgressionBodySchema,
  courseAssessmentBodySchema,
  courseAssessmentResponseSchema,
  groupProgressionParamsSchema,
  groupProgressionResponseSchema,
  progressionDecisionBodySchema,
  progressionDecisionParamsSchema,
  progressionDecisionResponseSchema,
  rejectProgressionBodySchema,
  studentProgressionParamsSchema,
  studentProgressionResponseSchema,
} from './progression.schemas.ts'

/**
 * Kur sonu değerlendirme ve geçiş kararı uçları (OG-086; IST-062; DOM-DIL-013, DOM-DIL-060,
 * DOM-DIL-070). Modül `academic`; yalnız dil okulunda. Sıra: 401 → 403 modül kapalı → 404 kurum
 * türü (okulda her rol için) → 403 rol → 400 → işlem (404 kayıt/kapsam, 409 sürüm, core kuralları
 * 403/409/422). Yazma uçlarında rol yalnız `ogretmen`: ölçme ve öneri grubun öğretmeninin, onay
 * akademik koordinatörün işidir; yönetici koordinatörün yerine geçmez.
 */

const MODULE = 'academic'
const WRITERS: readonly Role[] = ['ogretmen']
const STAFF: readonly Role[] = ['yonetici', 'ogretmen']
const READERS: readonly Role[] = ['yonetici', 'ogretmen', 'ogrenci', 'veli']
const SCOPE =
  'Modül `academic` (kapalıysa 403 `module_disabled`); yalnız dil okulunda, okulda 404. Grubu okuyamayan öğretmen için kayıt yoktur (404).'
const IDEMPOTENT = '`Idempotency-Key` isteğe bağlı; aynı anahtarla tekrar aynı yanıtı verir.'
const ATTENDANCE =
  'Devam ders saati yoklamasındandır; yoklaması alınmamış saat varken devam belli değildir ve karar 409 `attendance_pending` olur (yoklama alma ucu OG-269).'

function sender<T extends z.ZodType>(schema: T) {
  return (reply: FastifyReply, response: CommandResponse): z.output<T> => {
    if (response.replayed) reply.header('idempotent-replayed', 'true')
    reply.status(response.statusCode)
    return schema.parse(response.body)
  }
}

/** Karar komutlarında `If-Match` zorunludur (önceden `requireIfMatch` denetler). */
function requiredVersion(request: FastifyRequest): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

export function registerProgressionRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /** Kur sonu kararı yalnız dil okulundadır (DOM-YTK-012); okulda 404, rol denetiminden önce. */
  const languageSchool: preValidationAsyncHookHandler = async function (request) {
    const ctx = contextOf(request)
    const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
    if (institution?.type !== 'language_school') throw new NotFoundError()
  }
  const guard = (roles: readonly Role[]) => [
    app.requireModule(MODULE),
    languageSchool,
    app.requireRole(roles),
  ]
  const sendAssessment = sender(courseAssessmentResponseSchema)
  const sendDecision = sender(progressionDecisionResponseSchema)

  typed.post(
    '/api/v1/course-assessments',
    {
      preValidation: [...guard(WRITERS), rejectIfMatch()],
      schema: {
        operationId: 'recordCourseAssessment',
        tags: ['learning'],
        summary: 'Kur içi ölçme sonucunu gir',
        description: `Başlangıç, ara ya da kur sonu ölçmesi (DOM-DIL-013): dört becerinin puanı ve geri bildirimi zorunlu. Yalnız grubun öğretmeni (diğer öğretmen 403); nokta kayıt başına bir kez (409 \`assessment_already_recorded\`), ölçme değişmez. Başarı 201. ${IDEMPOTENT} ${SCOPE}`,
        body: courseAssessmentBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: { 201: courseAssessmentResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendAssessment(
        reply,
        await recordCourseAssessment(
          contextOf(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.post(
    '/api/v1/progression-decisions',
    {
      preValidation: [...guard(WRITERS), rejectIfMatch()],
      schema: {
        operationId: 'proposeProgressionDecision',
        tags: ['learning'],
        summary: 'Kur sonu kararını öner',
        description: `Grubun öğretmeni kur sonu kararını önerir (DOM-DIL-070, DOM-DIL-060): \`passed\` için devam şartı, kur sonu eşiği ve dört becerinin her biri 50; koşulları sağlamayan sonuç 422. Kayıtta açık karar varken 409 \`progression_pending\`; onaylı karar varken değişiklik \`correctsDecisionId\` ile düzeltme kararıdır. ${ATTENDANCE} Başarı 201, durum \`pending\`. ${IDEMPOTENT} ${SCOPE}`,
        body: progressionDecisionBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: { 201: progressionDecisionResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendDecision(
        reply,
        await proposeProgressionDecision(
          contextOf(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  const REVIEW = `Yalnız kurun seviyesinin akademik koordinatörü (öğretmen + \`academic_coordinator\` görevi; diğer öğretmen 403, yönetici 403). Kararı veren onaylayamaz (403 \`progression_self_review\`); sonuçlanmış karar 409 \`progression_already_reviewed\`. \`If-Match\` kararın satır sürümü (\`rowVersion\`; yoksa 400 \`if_match_required\`, tutmazsa 409 \`version_conflict\`). Olmayan ya da başka kurumun kararı 404. ${IDEMPOTENT} ${SCOPE}`

  typed.post(
    '/api/v1/progression-decisions/:decisionId/approve',
    {
      preValidation: [...guard(WRITERS), requireIfMatch()],
      schema: {
        operationId: 'approveProgressionDecision',
        tags: ['learning'],
        summary: 'Kur sonu kararını onayla',
        description: `Koşullar güncel devam ve ölçmelerle yeniden hesaplanır; dayanak değiştiyse 409 \`progression_basis_changed\`. Onaylı \`passed\` kararında \`next\` üst kur çıktısıdır. ${REVIEW}`,
        params: progressionDecisionParamsSchema,
        body: approveProgressionBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        response: { 200: progressionDecisionResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendDecision(
        reply,
        await reviewProgressionDecision(
          contextOf(request),
          {
            decisionId: request.params.decisionId,
            expectedVersion: requiredVersion(request),
            body: { action: 'approve' },
          },
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.post(
    '/api/v1/progression-decisions/:decisionId/reject',
    {
      preValidation: [...guard(WRITERS), requireIfMatch()],
      schema: {
        operationId: 'rejectProgressionDecision',
        tags: ['learning'],
        summary: 'Kur sonu kararını reddet',
        description: `Ret gerekçesi zorunlu; öğretmen yeniden önerebilir. ${REVIEW}`,
        params: progressionDecisionParamsSchema,
        body: rejectProgressionBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        response: { 200: progressionDecisionResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendDecision(
        reply,
        await reviewProgressionDecision(
          contextOf(request),
          {
            decisionId: request.params.decisionId,
            expectedVersion: requiredVersion(request),
            body: { action: 'reject', reason: request.body.reason },
          },
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.get(
    '/api/v1/groups/:groupId/progression',
    {
      preValidation: guard(STAFF),
      schema: {
        operationId: 'getGroupProgression',
        tags: ['learning'],
        summary: 'Grubun kur sonu tablosu',
        description: `Kursiyer başına devam özeti, ölçmeler, kur geçme koşulları, verilebilir sonuçlar ve engel (hesaplanır, saklanmaz), kararlar ve üst kur çıktısı (IST-062). Roller: \`yonetici\`, \`ogretmen\` (grubun öğretmeni ya da kurun seviyesinin akademik koordinatörü); diğer roller 403. Olmayan ya da başka kurumun grubu 404. ${SCOPE}`,
        params: groupProgressionParamsSchema,
        response: { 200: groupProgressionResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getGroupProgression(contextOf(request), request.params.groupId),
    }),
  )

  typed.get(
    '/api/v1/students/:studentId/progression-decisions',
    {
      preValidation: guard(READERS),
      schema: {
        operationId: 'getStudentProgressionDecisions',
        tags: ['learning'],
        summary: 'Kursiyerin kur sonu kararları',
        description: `Öğrenci kendisinin, veli 18 yaş altı çocuğunun yalnız onaylı kararlarını görür; gerekçe, karar veren ve inceleyen gösterilmez, onaylanmamış öneri görünmez. Personel (yönetici; öğretmen yalnız okuyabildiği grupların kararları) bütün kararları görür. Ön büro 403; kapsam dışı ya da başka kurumun öğrencisi 404. ${SCOPE}`,
        params: studentProgressionParamsSchema,
        response: { 200: studentProgressionResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getStudentProgression(contextOf(request), request.params.studentId),
    }),
  )
}
