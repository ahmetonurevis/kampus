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
  cancelGroup,
  createGroup,
  getGroup,
  getGroupWaitlist,
  listGroups,
  mergeGroup,
  openGroup,
  updateGroup,
} from '../services/language-groups.ts'
import { getInstitutionModules } from '../services/modules.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  cancelGroupBodySchema,
  createGroupBodySchema,
  groupListQuerySchema,
  groupListResponseSchema,
  groupParamsSchema,
  groupResponseSchema,
  mergeGroupBodySchema,
  updateGroupBodySchema,
  waitlistResponseSchema,
} from './language-groups.schemas.ts'
import { emptyCommandBodySchema } from './workflows.schemas.ts'

/**
 * Dil okulu grup uçları (IST-077; docs/domain/dil-okulu.md DOM-DIL-003, -008, -040…043). Grup kur
 * gibi modüle değil kurum türüne bağlıdır: okulda (`school`) her uç her rol için 404, rol
 * denetiminden önce (DOM-YTK-012). Rol listesi core yetki tablosundan (`WRITE_ACTION_ROLES`) gelir
 * ve `preValidation`'da denetlenir. Sıra: 401 → 404 kurum türü → 403 rol → `If-Match` → 400 →
 * işlem (404 grup, 409 sürüm, 403 koordinatör kapsamı, 409, 422).
 */

const rolesOf = (action: WriteAction) =>
  WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')

const TYPE_ONLY =
  'Yalnız dil okulunda (`language_school`); okulda her rol için 404, rol denetiminden önce.'
const READ_ACCESS = `Roller: ${rolesOf('group.read')}. Yönetici ve ön büro bütün grupları; öğretmen kendi grubunu ve akademik koordinatörü olduğu seviyenin gruplarını; öğrenci ve veli yalnız kendisinin/çocuğunun kursiyer olduğu grubu görür. Öğrenci ve veli takvim alanlarını alır (öğretmen, kapasite, doluluk, iptal bilgisi, işlem anları ve sürüm dönmez). ${TYPE_ONLY}`
const MANAGE_ACCESS = `Roller: ${rolesOf('group.manage')}; diğer roller 403. Öğretmen yalnız akademik koordinatörü olduğu seviyenin kurlarının gruplarını yönetir (403 \`course_coordinator_required\`). Denetime yalnız alan adları yazılır. ${TYPE_ONLY}`
const VERSIONED =
  "`If-Match` grubun `rowVersion`'ı (zorunlu), tutmazsa 409 `version_conflict`; olmayan ya da başka kurumun grubu 404. Tamamlanan ya da iptal edilen grup değişmez: 409 `group_closed`. `Idempotency-Key` isteğe bağlı."
const PLANNING_RULES =
  'Kur etkin olmalı (422 `group_course_inactive`); haftalık oturum sayısı kurun haftalık saatine eşit, oturumlar binmez (422 `group_schedule_mismatch`, `group_schedule_overlap`); oturumlar 07.00–23.00 içinde, çocuk ve genç grubunda 21.00’de biter (422 `group_outside_legal_hours`, `group_minor_late`; DOM-DIL-003); kapasite kurun en çok mevcudunu aşamaz ve doluluktan az olamaz (422 `group_capacity_exceeds_course`, `group_capacity_below_members`; DOM-DIL-040); öğretmen kurumun öğretmenidir (422 `group_teacher_invalid`), çevrim içi grubun dersliği yoktur (422 `group_room_online`); öğretmen ve derslik kurumun kapanmamış gruplarıyla aynı gün ve saatte çakışmaz (422 `group_teacher_conflict`, `group_room_conflict`); başlangıç geçmiş olamaz (422 `group_start_passed`); ad iptal edilmemiş gruplarda tekil (409 `group_name_exists`). Bitiş tarihi kurun toplam saatinden hesaplanır.'

function requiredVersion(request: FastifyRequest): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

function sendGroup(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return groupResponseSchema.parse(response.body)
}

const target = (request: FastifyRequest<{ Params: { groupId: string } }>) => ({
  groupId: request.params.groupId,
  expectedVersion: requiredVersion(request),
})

export function registerLanguageGroupRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /** Grup yalnız dil okulunda vardır (DOM-DIL-008); okulda 404 (kur uçlarıyla aynı). */
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
  const read = guard('group.read')
  const created = [...guard('group.manage'), rejectIfMatch()]
  const managed = [...guard('group.manage'), requireIfMatch()]
  const versionedHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    '/api/v1/groups',
    {
      preValidation: read,
      schema: {
        operationId: 'listGroups',
        tags: ['institution'],
        summary: 'Gruplar',
        description: `Kurumun dil okulu grupları: başlangıç tarihine, sonra ada göre, sayfalı. İptal edilenler varsayılan olarak dışlanır, \`status=cancelled\` ile okunur; \`running\` ve \`completed\` tarihten türetilir. Süzgeç \`courseId\`, \`status\`, \`teacherMembershipId\`; bilinmeyen parametre 400. ${READ_ACCESS}`,
        querystring: groupListQuerySchema,
        response: { 200: groupListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize, courseId, status, teacherMembershipId } = request.query
      const result = await listGroups(contextOf(request), {
        page,
        pageSize,
        courseId,
        status,
        teacherMembershipId,
      })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/groups/:groupId',
    {
      preValidation: read,
      schema: {
        operationId: 'getGroup',
        tags: ['institution'],
        summary: 'Grup',
        description: `Tek grup; personele kursiyerler (\`members\`) de döner. Olmayan, başka kurumun ya da rolün göremediği grup 404. ${READ_ACCESS}`,
        params: groupParamsSchema,
        response: { 200: groupResponseSchema, ...readErrors },
      },
    },
    async (request) => ({ data: await getGroup(contextOf(request), request.params.groupId) }),
  )

  typed.get(
    '/api/v1/groups/:groupId/waitlist',
    {
      preValidation: guard('group.waitlist'),
      schema: {
        operationId: 'getGroupWaitlist',
        tags: ['institution'],
        summary: 'Grubun bekleme sırası',
        description: `Grubun ve kurun grupsuz bekleyenleri istek sırasıyla, ardından gruba yapılmış teklifler; boş yer kadar sıradakine 48 saatlik teklif önerisi ve süresi dolmuş teklifler (DOM-DIL-043). Bekleme listesi kapasiteye sayılmaz; teklif süresi dolana kadar sayılır. Yazma (sıraya alma, teklif, kabul) kayıt akışındadır (ON-058). Roller: ${rolesOf('group.waitlist')}; diğer roller 403. Olmayan ya da başka kurumun grubu 404. ${TYPE_ONLY}`,
        params: groupParamsSchema,
        response: { 200: waitlistResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getGroupWaitlist(contextOf(request), request.params.groupId),
    }),
  )

  typed.post(
    '/api/v1/groups',
    {
      preValidation: created,
      schema: {
        operationId: 'createGroup',
        tags: ['institution'],
        summary: 'Grup planla',
        description: `Etkin kurdan yeni grup \`planned\` durumunda açılır (core \`planGroupCreation\`; IST-077, DOM-DIL-008). Öğretmen ve derslik planlamada boş olabilir, açılışta zorunludur. ${PLANNING_RULES} \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\`. ${MANAGE_ACCESS}`,
        body: createGroupBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: groupResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const body = sendGroup(
        reply,
        await createGroup(contextOf(request), request.body, idempotencyOf(request, true)),
      )
      reply.header('location', `/api/v1/groups/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    '/api/v1/groups/:groupId',
    {
      preValidation: managed,
      schema: {
        operationId: 'updateGroup',
        tags: ['institution'],
        summary: 'Grubu değiştir',
        description: `Grubun alanlarını değiştirir; kurallar planlamadaki gibidir. Kursiyeri olan ya da başlamış grubun gün/saati, başlangıcı ve yaş bandı değişmez (422 \`group_schedule_locked\`; DOM-DIL-042: değişiklik kursiyer onayıyla birleştirme ya da yeni grupla). Çevrim içine geçen grubun dersliği düşer. ${PLANNING_RULES} ${VERSIONED} ${MANAGE_ACCESS}`,
        params: groupParamsSchema,
        body: updateGroupBodySchema,
        headers: versionedHeaders,
        response: { 200: groupResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendGroup(
        reply,
        await updateGroup(
          contextOf(request),
          target(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.post(
    '/api/v1/groups/:groupId/open',
    {
      preValidation: managed,
      schema: {
        operationId: 'openGroup',
        tags: ['institution'],
        summary: 'Grubu aç',
        description: `Planlanan grubu açar (DOM-DIL-042); yalnız \`planned\` (409 \`group_not_planned\`). Aktif kursiyer kurun en az mevcuduna (açılış sayısı) ulaşmalı (422 \`group_below_minimum\`); öğretmen ve yüz yüzede derslik atanmış olmalı (422 \`group_teacher_required\`, \`group_room_required\`); başlangıç geçmemiş, kur etkin ve çakışma yok. Gövde yok ya da boş nesne. ${VERSIONED} ${MANAGE_ACCESS}`,
        params: groupParamsSchema,
        body: emptyCommandBodySchema.strict().optional(),
        headers: versionedHeaders,
        response: { 200: groupResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendGroup(
        reply,
        await openGroup(contextOf(request), target(request), idempotencyOf(request, false)),
      ),
  )

  typed.post(
    '/api/v1/groups/:groupId/cancel',
    {
      preValidation: managed,
      schema: {
        operationId: 'cancelGroup',
        tags: ['institution'],
        summary: 'Grubu iptal et',
        description: `Kapanmamış grubu gerekçeyle iptal eder (DOM-DIL-042). Kursiyerlerin seçenekleri (başka gruba geçiş, bekleme, tam iade) kayıt ve finans akışındadır (ON-058). ${VERSIONED} ${MANAGE_ACCESS}`,
        params: groupParamsSchema,
        body: cancelGroupBodySchema,
        headers: versionedHeaders,
        response: { 200: groupResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendGroup(
        reply,
        await cancelGroup(
          contextOf(request),
          target(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.post(
    '/api/v1/groups/:groupId/merge',
    {
      preValidation: managed,
      schema: {
        operationId: 'mergeGroup',
        tags: ['institution'],
        summary: 'Grupları birleştir',
        description: `\`sourceGroupId\` grubunu bu gruba birleştirir (DOM-DIL-042): kaynak iptal edilir (\`mergedIntoGroupId\`), kursiyerleri ve bekleyenleri bu gruba taşınır. Gruplar farklı (422 \`group_merge_same\`), kapanmamış (409 \`group_closed\`), aynı kurun ve yaş bandının (422 \`group_merge_mismatch\`) olmalı; taşınan aktif kursiyerle doluluk kapasiteyi aşamaz (422 \`group_merge_capacity\`); gün/saat ya da başlangıç farklıysa \`learnersConsented: true\` gerekir (422 \`group_merge_consent_required\`). Olmayan kaynak 404. \`If-Match\` bu (hedef) grubun sürümüdür. ${VERSIONED} ${MANAGE_ACCESS}`,
        params: groupParamsSchema,
        body: mergeGroupBodySchema,
        headers: versionedHeaders,
        response: { 200: groupResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendGroup(
        reply,
        await mergeGroup(
          contextOf(request),
          target(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )
}
