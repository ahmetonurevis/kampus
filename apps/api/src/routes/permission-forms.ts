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
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  archivePermissionFormCommand,
  cancelPermissionFormCommand,
  closePermissionFormCommand,
  createPermissionFormCommand,
  decidePermissionCommand,
  editPermissionForm,
  getPermissionForm,
  listPermissionForms,
} from '../services/permission-forms.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  createPermissionFormBodySchema,
  decidePermissionBodySchema,
  permissionDecisionResponseSchema,
  permissionFormDetailResponseSchema,
  permissionFormListQuerySchema,
  permissionFormListResponseSchema,
  permissionFormParamsSchema,
  permissionFormResponseSchema,
  updatePermissionFormBodySchema,
} from './permission-forms.schemas.ts'

/**
 * İzin formu ve dijital veli onayı uçları (OG-055; IST-067, docs/domain/iletisim-ve-veli.md
 * DOM-ILT-030, -031, -036…039). Kural, rol ve kapsam core `lib/permission-forms.ts`'dedir. Modül
 * `communication` (core komut tablosu): kapalıysa her uç 403 `module_disabled`. Yazma rolleri
 * core `WRITE_ACTION_ROLES`'tan gelir ve gövdeden önce denetlenir. Sıra: 401 → 403 modül → 403
 * rol → `Idempotency-Key`/`If-Match` → 400 gövde → işlem (404, 403, 409 sürüm, 422, 409).
 */

const COMMUNICATION = OPERATION_COMMANDS['permissionForm.create'].module ?? 'communication'
const rolesOf = (action: WriteAction) =>
  WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')

const READ_ACCESS =
  'Yönetici bütün formları, öğretmen açtığı ve sınıflarına ya da öğrencilerine açılmış formları, veli çocuğunun, öğrenci kendisinin hedefte olduğu formları okur; ön büro okumaz (403). Hedef öğrencilerden yönetici ve formun öğretmeni hepsini, öbür öğretmen kapsamındakileri, veli çocuğunu, öğrenci kendisini görür; sayılar yalnız görünen öğrencilerdendir. Görmediği ve başka kurumun formu olmayan kimlikle aynı 404. Modül `communication`; kapalıysa 403 `module_disabled`.'
const FORM_VERSION =
  "`If-Match` formun `version`'ı (zorunlu; yoksa 400 `if_match_required`), tutmazsa 409 `version_conflict`. Formu gören başka öğretmen 403 `permission_form_not_owner`, görmeyen ve başka kurumun formu 404. `Idempotency-Key` isteğe bağlı."

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

const formLocation = (id: string) => `/api/v1/permission-forms/${encodeURIComponent(id)}`

export function registerPermissionFormRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const read = [app.authenticate, app.requireModule(COMMUNICATION)]
  const write = (
    action: WriteAction,
    ifMatch: 'reject' | 'required',
  ): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule(COMMUNICATION),
    app.requireRole(WRITE_ACTION_ROLES[action]),
    ifMatch === 'reject' ? rejectIfMatch() : requireIfMatch(),
  ]
  const versionedHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })
  const target = (request: FastifyRequest<{ Params: { formId: string } }>) => ({
    formId: request.params.formId,
    expectedVersion: requiredVersion(request),
  })

  typed.get(
    '/api/v1/permission-forms',
    {
      preValidation: read,
      schema: {
        operationId: 'listPermissionForms',
        tags: ['permission-forms'],
        summary: 'İzin formları',
        description: `İzin formları son güne göre yeniden eskiye, sonra kimliğe göre sıralı, sayfalı. Süzgeç: \`status\` (\`open\` karar alan, \`closed\` kapatılmış ya da son günü geçmiş, \`all\`), \`topic\`, \`q\` (başlıkta harf ve aksan duyarsız arama; okuma kapsamından sonra). Her satır okuyanın gördüğü öğrencilerin bekleyen, onay ve ret sayılarını taşır (\`counts\`; durum kararlardan hesaplanır, bir ret onayın önüne geçer, DOM-ILT-031). Yönetici ve formun öğretmeni \`targetStudentIds\` ve \`hasDecisions\`, veli ve öğrenci öğrenci satırlarını (\`students\`, \`canDecide\` ile) alır. Bilinmeyen parametre 400. ${READ_ACCESS}`,
        querystring: permissionFormListQuerySchema,
        response: { 200: permissionFormListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status, topic, q } = request.query
      const result = await listPermissionForms(contextOf(request), {
        page,
        pageSize,
        status,
        topic,
        q,
      })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/permission-forms/:formId',
    {
      preValidation: read,
      schema: {
        operationId: 'getPermissionForm',
        tags: ['permission-forms'],
        summary: 'İzin formu',
        description: `Tek form; okuyanın gördüğü her öğrencinin geçerli durumu ve görebildiği kararlar (\`students\`). Veli yalnız kendi kararını ve notunu görür, öbür velinin reddi durumda görünür (DOM-ILT-037). Karar verenin kullanıcı kimliği yalnız yöneticiye döner. Her öğrenci satırı okuyanın o öğrenci için karar veren taraf olup olmadığını taşır (\`canDecide\`, core \`permissionDecider\`). ${READ_ACCESS}`,
        params: permissionFormParamsSchema,
        response: { 200: permissionFormDetailResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getPermissionForm(contextOf(request), request.params.formId),
    }),
  )

  typed.post(
    '/api/v1/permission-forms',
    {
      preValidation: write('permissionForm.create', 'reject'),
      schema: {
        operationId: 'createPermissionForm',
        tags: ['permission-forms'],
        summary: 'İzin formu aç',
        description: `Yeni izin formu (core \`createPermissionForm\`, DOM-ILT-036): konu (\`trip\`, \`event\`, \`photo\`, \`club\`, \`other\`), başlık, açıklama, son gün (\`YYYY-MM-DD\`, Europe/Istanbul; o günün sonuna kadar) ve hedef (\`classIds\` ve/veya \`studentIds\`). Hedef öğrenciler açılışta çözülür ve saklanır. Öğretmen yalnız rehberi olduğu sınıflara ve onların öğrencilerine (403 \`permission_form_scope_denied\`). Son gün bugünden önce 422 \`permission_form_deadline_in_past\`; olmayan sınıf ya da öğrenci 404, pasif sınıf 422 \`record_inactive\`, pasif öğrenci 422 \`student_inactive\`, öğrencisiz hedef 422 \`permission_form_no_students\`. Etkinlik ayrıntısı (\`eventDate\`, \`eventTime\`, \`location\`, \`transport\`, \`fee\` kuruş) isteğe bağlıdır; geçmiş etkinlik günü 422 \`permission_form_event_in_past\`. Aynı işlemde 18 yaş altında velilere, yetişkin öğrencide kendisine \`permission_form_opened\` bildirimi yazılır. \`Idempotency-Key\` zorunlu; \`If-Match\` 400. Başarı 201 ve \`Location\`. Roller: ${rolesOf('permissionForm.create')}.`,
        body: createPermissionFormBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: permissionFormResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const body = send(
        reply,
        await createPermissionFormCommand(
          contextOf(request),
          request.body,
          idempotencyOf(request, true),
        ),
        permissionFormResponseSchema,
      )
      reply.header('location', formLocation(body.data.id))
      return body
    },
  )

  typed.patch(
    '/api/v1/permission-forms/:formId',
    {
      preValidation: write('permissionForm.update', 'required'),
      schema: {
        operationId: 'updatePermissionForm',
        tags: ['permission-forms'],
        summary: 'İzin formunu düzenle',
        description: `Başlık, açıklama, son gün, hedef ve etkinlik ayrıntısı (\`eventDate\`, \`eventTime\`, \`location\`, \`transport\`, \`fee\` kuruş; \`null\` kaldırır; core \`updatePermissionForm\`, DOM-ILT-038); konu değişmez (gövdede 400). Etkinlik günü, saati, yeri, ulaşım biçimi ya da ücreti değişirse alınmış kararlar düşer (DOM-ILT-032): form \`detailsRevision\` bir artar, karar satırları silinmez (\`current: false\`), kararı düşen öğrencilerin kararı veren tarafına aynı işlemde \`permission_form_reconsent\` bildirimi yazılır; başlık, açıklama ve son gün düzeltmesi ile aynı değerin yeniden yazılması izni düşürmez. Geçmiş etkinlik günü 422 \`permission_form_event_in_past\`. Kapalı form 422 \`permission_form_closed\`; son günü geçmiş formun son günü 422 \`permission_form_deadline_passed\`; kararı olan formun hedefinden sınıf ya da öğrenci çıkarılamaz (422 \`permission_form_scope_locked\`). Hedefe yeni giren öğrencilere aynı işlemde \`permission_form_opened\` bildirimi yazılır. ${FORM_VERSION} Roller: ${rolesOf('permissionForm.update')}.`,
        params: permissionFormParamsSchema,
        body: updatePermissionFormBodySchema,
        headers: versionedHeaders,
        response: { 200: permissionFormResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await editPermissionForm(
          contextOf(request),
          target(request),
          request.body,
          idempotencyOf(request, false),
        ),
        permissionFormResponseSchema,
      ),
  )

  typed.post(
    '/api/v1/permission-forms/:formId/close',
    {
      preValidation: write('permissionForm.close', 'required'),
      schema: {
        operationId: 'closePermissionForm',
        tags: ['permission-forms'],
        summary: 'İzin formunu kapat',
        description: `Son günden önce karar almayı bitirir (core \`closePermissionForm\`, DOM-ILT-038); kararlar korunur. Kapalı form 409 \`permission_form_closed\`. ${FORM_VERSION} Roller: ${rolesOf('permissionForm.close')}.`,
        params: permissionFormParamsSchema,
        headers: versionedHeaders,
        response: { 200: permissionFormResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await closePermissionFormCommand(
          contextOf(request),
          target(request),
          idempotencyOf(request, false),
        ),
        permissionFormResponseSchema,
      ),
  )

  typed.post(
    '/api/v1/permission-forms/:formId/cancel',
    {
      preValidation: write('permissionForm.cancel', 'required'),
      schema: {
        operationId: 'cancelPermissionForm',
        tags: ['permission-forms'],
        summary: 'Etkinliği iptal et',
        description: `İzin istenen etkinliği iptal eder (core \`cancelPermissionForm\`, DOM-ILT-032): form kapanır ve \`cancelledAt\` işaretlenir; kararlar korunur. Aynı işlemde izin vermiş ve karar bekleyen öğrencilerin kararı veren tarafına (18 yaş altında bugün velayetli veliler, yetişkinde kendisi) \`permission_form_cancelled\` bildirimi yazılır; etkinliği reddedene gitmez. Son günü geçmiş ya da kapatılmış form da iptal edilir (kapanış zamanı korunur); iptal edilmiş form 409 \`permission_form_cancelled\`. ${FORM_VERSION} Roller: ${rolesOf('permissionForm.cancel')}.`,
        params: permissionFormParamsSchema,
        headers: versionedHeaders,
        response: { 200: permissionFormResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await cancelPermissionFormCommand(
          contextOf(request),
          target(request),
          idempotencyOf(request, false),
        ),
        permissionFormResponseSchema,
      ),
  )

  typed.delete(
    '/api/v1/permission-forms/:formId',
    {
      preValidation: write('permissionForm.archive', 'required'),
      schema: {
        operationId: 'archivePermissionForm',
        tags: ['permission-forms'],
        summary: 'İzin formunu arşivle',
        description: `Kararsız formu arşivler (core \`archivePermissionForm\`); kayıt silinmez. Kararı olan form arşivlenmez, kapatılır: 409 \`permission_form_has_decisions\` (kararlar ispat kaydıdır, DOM-ILT-034). ${FORM_VERSION} Roller: ${rolesOf('permissionForm.archive')}.`,
        params: permissionFormParamsSchema,
        headers: versionedHeaders,
        response: { 200: permissionFormResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await archivePermissionFormCommand(
          contextOf(request),
          target(request),
          idempotencyOf(request, false),
        ),
        permissionFormResponseSchema,
      ),
  )

  typed.post(
    '/api/v1/permission-forms/:formId/decisions',
    {
      preValidation: write('permissionForm.decide', 'reject'),
      schema: {
        operationId: 'decidePermissionForm',
        tags: ['permission-forms'],
        summary: 'İzin kararı ver',
        description: `Öğrenci için onay ya da ret (\`{ studentId, decision: approved | rejected, note? }\`; core \`decidePermission\`, DOM-ILT-030, -031, -037). 18 yaş altında velayetli ve iletişim kısıtı olmayan her veli kendi kararını verir; 18 yaşını doldurmuş öğrenci kendisi verir (veliye 403 \`permission_adult_self\`, 18 altı öğrenciye 403 \`permission_guardian_required\`). Yaş kimlik satırındaki doğum tarihinden, yoksa öğrenci kaydından hesaplanır; bilinmiyorsa 18 altıdır. Başka çocuk, velayeti olmayan veli, formun hedefinde olmayan öğrenci, olmayan ve başka kurumun formu 404. Kapalı form 422 \`permission_form_closed\`, son gün geçtiyse 422 \`permission_form_deadline_passed\`, pasif öğrenci 422 \`student_inactive\`. Her karar yeni satırdır: yeni karar 201 + \`Location\`, son kararla aynı karar ve not 200 (yeni satır yok). Yanıt öğrencinin güncel durumunu taşır (\`studentStatus\`). \`Idempotency-Key\` zorunlu; \`If-Match\` 400. Roller: ${rolesOf('permissionForm.decide')}.`,
        params: permissionFormParamsSchema,
        body: decidePermissionBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: {
          200: permissionDecisionResponseSchema,
          201: permissionDecisionResponseSchema,
          ...commandErrors,
        },
      },
    },
    async (request, reply) => {
      const body = send(
        reply,
        await decidePermissionCommand(
          contextOf(request),
          request.params.formId,
          request.body,
          idempotencyOf(request, true),
        ),
        permissionDecisionResponseSchema,
      )
      if (reply.statusCode === 201) reply.header('location', formLocation(request.params.formId))
      return body
    },
  )
}
