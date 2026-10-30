import type { FastifyInstance, FastifyRequest, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'
import {
  conversationAccessSchema,
  publishAnnouncementSchema,
  reviseAnnouncementSchema,
  sendMessageSchema,
  startConversationSchema,
  withdrawAnnouncementSchema,
} from '@kampus/school-core/lib/communication.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  listConversationMessages,
  listConversations,
  listStudentParentAccounts,
  openConversationAccessCommand,
  publishAnnouncementCommand,
  readAnnouncementCommand,
  readMessagesCommand,
  reviseAnnouncementCommand,
  sendMessageCommand,
  startConversationCommand,
  withdrawAnnouncementCommand,
} from '../services/communication.ts'
import { sendCommand } from './command-support.ts'
import { captureInput, options, rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'
import {
  announcementParamsSchema,
  conversationAccessResponseSchema,
  conversationListQuerySchema,
  conversationListResponseSchema,
  conversationParamsSchema,
  messageListQuerySchema,
  messagePageResponseSchema,
  parentAccountsResponseSchema,
  readErrors,
  studentParamsSchema,
} from './communication.schemas.ts'
import { emptyCommandBodySchema } from './workflows.schemas.ts'

/**
 * İletişim uçları (docs/domain/iletisim-ve-veli.md, api-tasarimi.md §1): duyuru ve birebir
 * yazışma. Sıra komut uçlarıyla aynıdır: 401 → 403 `module_disabled` → 403 `forbidden` (core
 * `WRITE_ACTION_ROLES`) → 400 gövde → işlem (404, 422, 409). Kapsam core `requireAuthorized`'dadır.
 * Yazışma taraf olmayana 404 döner (DOM-YTK-052).
 */

const MODULE = 'communication'
const response = { 200: commandResponseSchema, ...commandErrors }
const created = { 201: commandResponseSchema, ...commandErrors }
const startResponse = { 200: commandResponseSchema, 201: commandResponseSchema, ...commandErrors }

/** Mesaj gönderiminde kullanıcı başına hız sınırı (dakikada); genel sınır 300'dür. */
export const MESSAGE_RATE_LIMIT = 30

const conversationRoles: readonly Role[] = ['ogretmen', 'ogrenci', 'veli', 'yonetici']

export function registerCommunicationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /** Komut ön işleyicileri: kimlik → modül → rol (core tablosu) → `If-Match` → ham gövde. */
  function guard(action: WriteAction, { subject = true } = {}): preValidationAsyncHookHandler[] {
    const module = OPERATION_COMMANDS[action].module ?? MODULE
    return [
      app.authenticate,
      app.requireModule(module),
      app.requireRole(WRITE_ACTION_ROLES[action]),
      ...(subject ? [] : [rejectIfMatch()]),
      captureInput(),
    ]
  }
  const rolesOf = (action: WriteAction) =>
    WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')
  const readGuard = (roles: readonly Role[]) => [app.requireModule(MODULE), app.requireRole(roles)]
  const input = (request: FastifyRequest) => request.commandInput

  // --- Duyuru -------------------------------------------------------------------------------
  // Okuma genel koleksiyon ucundadır (`GET /collections/announcements`): core kapsamı alıcı
  // listesine göre süzer, geri çekilen duyurunun metnini yetkisize vermez (DOM-ILT-004).

  typed.post(
    '/api/v1/announcements',
    {
      preValidation: guard('announcement.publish', { subject: false }),
      schema: {
        operationId: 'publishAnnouncement',
        tags: ['communication'],
        summary: 'Duyuru yayınla',
        description: `Duyuru yayınlar; hedef kitle (kampüs, düzey, CEFR seviyesi, sınıf × rol) yayın anında alıcı listesine çözülür (core \`publishAnnouncement\`, DOM-ILT-001). Yetki core \`authorize('announcement.publish')\` (DOM-ILT-002): öğretmen yalnız ders verdiği/rehberi olduğu sınıflara, ön büro yalnız \`İdari\` kategoride kurum veya kampüs kapsamında (403 \`announcement_scope_denied\`). Alıcısı olmayan hedef 422 \`announcement_no_recipients\`. \`Idempotency-Key\` zorunludur. Başarı 201 ve \`Location\`. Roller: ${rolesOf('announcement.publish')}.`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: publishAnnouncementSchema,
        response: created,
      },
    },
    async (request, reply) => {
      const body = sendCommand(
        reply,
        await publishAnnouncementCommand(
          contextOf(request),
          input(request),
          options(request, 'required'),
        ),
      )
      const entity = body.data.entity
      if (entity)
        reply.header(
          'location',
          `/api/v1/collections/announcements/${encodeURIComponent(entity.id)}`,
        )
      return body
    },
  )

  typed.patch(
    '/api/v1/announcements/:announcementId',
    {
      preValidation: guard('announcement.revise'),
      schema: {
        operationId: 'reviseAnnouncement',
        tags: ['communication'],
        summary: 'Duyuruyu düzelt',
        description: `Duyurunun başlık, metin veya kategorisini düzeltir; önceki içerik \`revisions\` geçmişinde kalır, alıcı "Güncellendi" işaretini görür (core \`reviseAnnouncement\`, DOM-ILT-004). Hedef kitle değişmez. Duyuruyu görmeye yetkisi olmayan olmayan kayıtla aynı 404'ü alır; görüp yayınlayan olmayan 403 \`announcement_publisher_only\` alır (yalnız yayınlayan veya yönetici, ön büroda yayınlayan kişi); değişiklik yoksa 409 \`announcement_unchanged\`, geri çekilmişse 409 \`announcement_withdrawn\`. \`If-Match\` duyurunun sürümüdür; tutmazsa 409 \`version_conflict\`. Roller: ${rolesOf('announcement.revise')}.`,
        headers: commandHeadersSchema('optional'),
        params: announcementParamsSchema,
        body: reviseAnnouncementSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await reviseAnnouncementCommand(
          contextOf(request),
          request.params.announcementId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )

  typed.post(
    '/api/v1/announcements/:announcementId/withdraw',
    {
      preValidation: guard('announcement.withdraw'),
      schema: {
        operationId: 'withdrawAnnouncement',
        tags: ['communication'],
        summary: 'Duyuruyu geri çek',
        description: `Duyuruyu silmeden geri çeker (core \`withdrawAnnouncement\`, DOM-ILT-004): alıcılar duyuruyu "Geri çekildi" işaretiyle (\`withdrawnAt\`) görmeye devam eder, metni ve gerekçeyi yalnız yayınlayan ve yönetici görür. Gerekçe zorunludur. Yalnız yayınlayan veya yönetici (görmeye yetkisi olmayana 404, görüp yayınlayan olmayana 403); ikinci geri çekme 409 \`announcement_withdrawn\`. Roller: ${rolesOf('announcement.withdraw')}.`,
        headers: commandHeadersSchema('optional'),
        params: announcementParamsSchema,
        body: withdrawAnnouncementSchema,
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await withdrawAnnouncementCommand(
          contextOf(request),
          request.params.announcementId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )

  typed.post(
    '/api/v1/announcements/:announcementId/read',
    {
      preValidation: guard('announcement.read', { subject: false }),
      schema: {
        operationId: 'readAnnouncement',
        tags: ['communication'],
        summary: 'Duyuruyu okundu işaretle',
        description: `Alıcının ilk açılış anını bir kez yazar (core \`markAnnouncementRead\`, DOM-ILT-003); tekrar çağrı kaydı değiştirmez. Alıcı olmayan ama duyuruyu gören (yönetici, yayınlayan) için etkisizdir. Görülemeyen duyuru 404, geri çekilmiş duyuru 409 \`announcement_withdrawn\`. Roller: ${rolesOf('announcement.read')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: announcementParamsSchema,
        body: emptyCommandBodySchema.optional(),
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await readAnnouncementCommand(
          contextOf(request),
          request.params.announcementId,
          options(request, 'optional'),
        ),
      ),
  )

  // --- Yazışma ------------------------------------------------------------------------------

  typed.get(
    '/api/v1/conversations',
    {
      preHandler: readGuard(conversationRoles),
      schema: {
        operationId: 'listConversations',
        tags: ['communication'],
        summary: 'Yazışmalar',
        description:
          'Oturum sahibinin tarafı olduğu yazışmalar, son etkinliğe göre azalan; satırda son mesaj, okunmamış sayısı ve öğretmende yanıt bekleme durumu (DOM-ILT-010, -013, -024). Yönetici taraf değildir: yalnız `studentId` ile ve yalnız üst veriyi (son mesaj yok) görür; içeriği `POST /conversations/{id}/access` ile gerekçe vererek açar (DOM-YTK-052).',
        querystring: conversationListQuerySchema,
        response: { 200: conversationListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize, studentId } = request.query
      const result = await listConversations(contextOf(request), { page, pageSize, studentId })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/conversations/:conversationId/messages',
    {
      preHandler: readGuard(conversationRoles),
      schema: {
        operationId: 'listConversationMessages',
        tags: ['communication'],
        summary: 'Yazışmanın mesajları',
        description:
          'Mesajlar en yeniden geriye imleçli sayfalanır (core `messagePage`); sayfa içinde sıra eskiden yeniyedir, `meta.nextCursor` daha eski sayfayı verir. Mesajlar değişmez ve silinmez, imleç kararlıdır; geçersiz imleç 400. Taraf olmayana 404. Yönetici yalnız öğrenci–öğretmen yazışmasını ve yalnız son 30 dakikada açtığı gerekçeli erişimle okur, aksi halde 404; okuması okundu üretmez (DOM-YTK-052).',
        params: conversationParamsSchema,
        querystring: messageListQuerySchema,
        response: { 200: messagePageResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const page = await listConversationMessages(
        contextOf(request),
        request.params.conversationId,
        request.query,
      )
      return { data: page.items, meta: { nextCursor: page.nextCursor } }
    },
  )

  typed.post(
    '/api/v1/conversations',
    {
      preValidation: guard('conversation.start', { subject: false }),
      schema: {
        operationId: 'startConversation',
        tags: ['communication'],
        summary: 'Yazışma başlat',
        description: `Öğrenci + öğretmen + hedef kitle + veli hesabı için tek yazışma açar; varsa yenisi açılmaz, \`text\` var olan yazışmaya eklenir (core \`startConversation\`, DOM-ILT-010, -011). Yeni yazışma 201, var olan 200. Öğretmen \`studentId\` + \`audience\` verir; veli yazışmasında öğrencinin tek veli hesabı kendiliğinden seçilir, birden çoksa \`parentUserId\` zorunludur (422 \`parent_choice_required\`; hesaplar \`GET /students/{id}/parent-accounts\`). Öğrenci ve veli \`studentId\` + \`teacherId\` verir. İlişki yoksa 403 \`conversation_party_forbidden\`. \`Idempotency-Key\` zorunludur. Roller: ${rolesOf('conversation.start')}.`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: startConversationSchema,
        response: startResponse,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await startConversationCommand(
          contextOf(request),
          input(request),
          options(request, 'required'),
        ),
      ),
  )

  typed.post(
    '/api/v1/conversations/:conversationId/messages',
    {
      preValidation: guard('message.send', { subject: false }),
      config: {
        // Kullanıcı başına sınır: kimlik `preValidation`'da çözülür, sınır ondan sonra sayar.
        rateLimit: {
          max: MESSAGE_RATE_LIMIT,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) =>
            request.auth ? `message:${request.auth.userId}` : request.ip,
        },
      },
      schema: {
        operationId: 'sendConversationMessage',
        tags: ['communication'],
        summary: 'Mesaj gönder',
        description: `Yazışmaya mesaj ekler; mesaj sonradan değiştirilemez ve silinemez (core \`sendMessage\`, DOM-ILT-012). Taraf olmayana 404; öğretmenin öğrenciyle ders ilişkisi bittiyse yazışmayı okur ama gönderemez (403 \`conversation_relationship_ended\`). En fazla 2000 karakter. \`Idempotency-Key\` zorunludur: aynı anahtarla tekrar tek mesaj üretir. Kullanıcı başına dakikada ${String(MESSAGE_RATE_LIMIT)} istek, aşılırsa 429. Başarı 201. Roller: ${rolesOf('message.send')}.`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: conversationParamsSchema,
        body: sendMessageSchema,
        response: created,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await sendMessageCommand(
          contextOf(request),
          request.params.conversationId,
          input(request),
          options(request, 'required'),
        ),
      ),
  )

  typed.post(
    '/api/v1/conversations/:conversationId/read',
    {
      preValidation: guard('message.read', { subject: false }),
      schema: {
        operationId: 'readConversation',
        tags: ['communication'],
        summary: 'Yazışmayı okundu işaretle',
        description: `Karşı tarafın okunmamış mesajlarına ilk görme anını yazar (core \`markMessagesRead\`, DOM-ILT-024). Taraf olmayana 404. Roller: ${rolesOf('message.read')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: conversationParamsSchema,
        body: emptyCommandBodySchema.optional(),
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await readMessagesCommand(
          contextOf(request),
          request.params.conversationId,
          options(request, 'optional'),
        ),
      ),
  )

  typed.post(
    '/api/v1/conversations/:conversationId/access',
    {
      preValidation: [
        app.authenticate,
        app.requireModule(MODULE),
        app.requireRole(WRITE_ACTION_ROLES['conversation.access']),
        captureInput(),
      ],
      schema: {
        operationId: 'openConversationAccess',
        tags: ['communication'],
        summary: 'Yazışmayı gerekçeyle aç',
        description: `Yöneticinin şikâyet veya soruşturma gerekçesiyle yazışmayı açması (core \`openConversationAccess\`, DOM-YTK-052, DOM-ILT-011). Yalnız öğrenci–öğretmen yazışmasında geçerlidir: veli tarafı yazışma gerekçeyle de açılmaz (403 \`conversation_access_student_only\`). Gerekçe en az 10 karakter, yoksa 422 \`access_reason_required\`. Erişim gerekçesiyle \`audit_log\`'a (\`conversation.access\`) yazılır ve 30 dakika geçerlidir; bu sürede \`GET /conversations/{id}/messages\` açıktır. Yazışma yoksa 404. Roller: ${rolesOf('conversation.access')}.`,
        params: conversationParamsSchema,
        body: conversationAccessSchema,
        response: { 200: conversationAccessResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({
      data: await openConversationAccessCommand(
        contextOf(request),
        request.params.conversationId,
        input(request),
      ),
    }),
  )

  typed.get(
    '/api/v1/students/:studentId/parent-accounts',
    {
      preHandler: readGuard(['ogretmen']),
      schema: {
        operationId: 'listStudentParentAccounts',
        tags: ['communication'],
        summary: 'Öğrencinin veli hesapları',
        description:
          'Öğrenciye bağlı platform veli hesapları (kullanıcı kimliği ve ad); öğretmenin veli yazışması başlatırken `parentUserId` seçimi için (DOM-ILT-010). Yalnız veliyle yazışma başlatabilen öğretmen okur (yönetici, ön büro, öğrenci ve veli 403); kapsam `POST /conversations` ile birebir aynıdır: ders verdiği, sınıf rehberi olduğu öğrenci ya da rehberlik görevlisi olarak her öğrenci. Kapsam dışı, var olmayan veya başka kurumun öğrencisi 404.',
        params: studentParamsSchema,
        response: { 200: parentAccountsResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await listStudentParentAccounts(contextOf(request), request.params.studentId),
    }),
  )
}
