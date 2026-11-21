import type { FastifyInstance, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  countUnreadNotifications,
  listNotifications,
  readAllNotificationsCommand,
  readNotificationCommand,
} from '../services/notifications.ts'
import { sendCommand } from './command-support.ts'
import { captureInput, options, rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  notificationListQuerySchema,
  notificationPageResponseSchema,
  notificationParamsSchema,
  unreadNotificationsResponseSchema,
} from './notifications.schemas.ts'
import { emptyCommandBodySchema } from './workflows.schemas.ts'

/**
 * Uygulama içi bildirim merkezi uçları (F6a; core `lib/notifications.ts`;
 * docs/domain/iletisim-ve-veli.md DOM-ILT-020, -023, -073). Her rol kendi bildirim merkezini
 * kullanır; bugün yalnız öğrenci ve veli bildirim alır, personelin listesi boştur. Sıra bütün
 * uçlarda: 401 → 403 `module_disabled` (`communication`) → 403 `forbidden` → 400 → işlem (404);
 * bu yüzden okumalar da yazmalar gibi denetimi `preValidation`'da yapar. Bildirimler genel
 * koleksiyon ucuna kapalıdır (`services/collection-access.ts`).
 */

const MODULE = 'communication'
const READ_ROLES = WRITE_ACTION_ROLES['notification.read']
const response = { 200: commandResponseSchema, ...commandErrors }

export function registerNotificationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /** Okundu işaretleri: kimlik → modül → rol → `If-Match` yasak → ham gövde. */
  function guard(action: WriteAction): preValidationAsyncHookHandler[] {
    return [
      app.authenticate,
      app.requireModule(OPERATION_COMMANDS[action].module ?? MODULE),
      app.requireRole(WRITE_ACTION_ROLES[action]),
      rejectIfMatch(),
      captureInput(),
    ]
  }
  /**
   * Okumalar: kimlik → modül → rol, sorgu doğrulamasından önce (`preValidation`). `preHandler`
   * doğrulamadan sonra çalışır; modül kapalıyken veya oturumsuz geçersiz sorgu 403/401 yerine
   * 400 alırdı.
   */
  const readGuard: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule(MODULE),
    app.requireRole(READ_ROLES),
  ]

  typed.get(
    '/api/v1/notifications',
    {
      preValidation: readGuard,
      schema: {
        operationId: 'listNotifications',
        tags: ['notifications'],
        summary: 'Bildirimlerim',
        description:
          'Oturum sahibinin uygulama içi bildirimleri, en yeni önce (DOM-ILT-020). Öğrenci kendi kaydının, veli bağlı çocuklarının bildirimini görür; başka velinin çocuğu ve başka kurum hiç görünmez, personelin listesi boştur. Bildirim serbest metin taşımaz: `title` türün sabit şablonundan, yalnız öğrencinin ilk adıyla üretilir; puan, geri bildirim metni, tutar veya sağlık bilgisi yoktur (DOM-ILT-023). `readAt` yalnız okuyanın kendi okumasıdır; diğer velinin okuması görünmez (DOM-ILT-073). İmleçli sayfalama: `cursor` önceki sayfanın `meta.nextCursor` değeridir, toplam dönmez (okunmamış sayısı ayrı uçtadır); görülemeyen bildirim imleci 400. `unread=true` yalnız okunmamışları verir. Modül `communication`; türün kendi modülü kapalıysa (ör. `learning` kapalıyken öğretmen geri bildirimi) bildirim listede ve imleçte görünmez, silinmez, modül açılınca döner (DOM-YTK-040).',
        querystring: notificationListQuerySchema,
        response: { 200: notificationPageResponseSchema, ...authenticatedErrors },
      },
    },
    async (request) => {
      const { cursor, limit, unread } = request.query
      return listNotifications(contextOf(request), { cursor, limit, unread: unread === 'true' })
    },
  )

  typed.get(
    '/api/v1/notifications/unread-count',
    {
      preValidation: readGuard,
      schema: {
        operationId: 'countUnreadNotifications',
        tags: ['notifications'],
        summary: 'Okunmamış bildirim sayısı',
        description:
          'Oturum sahibinin okunmamış bildirim sayısı; saklanmaz, her istekte hesaplanır. Kapalı modülün bildirim türleri sayılmaz (DOM-YTK-040). Modül `communication`.',
        response: { 200: unreadNotificationsResponseSchema, ...authenticatedErrors },
      },
    },
    async (request) => countUnreadNotifications(contextOf(request)),
  )

  typed.post(
    '/api/v1/notifications/read-all',
    {
      preValidation: guard('notification.read_all'),
      schema: {
        operationId: 'readAllNotifications',
        tags: ['notifications'],
        summary: 'Bütün bildirimleri okundu işaretle',
        description: `Oturum sahibinin gördüğü bütün okunmamış bildirimlere ilk okuma anını yazar (core \`markAllNotificationsRead\`); okunmuşların anı değişmez, tekrar çağrı kayıt eklemez. Okuma kullanıcıya özeldir (DOM-ILT-073). \`Idempotency-Key\` isteğe bağlıdır, \`If-Match\` kabul edilmez. Modül \`communication\`. Roller: ${READ_ROLES.map((r) => `\`${r}\``).join(', ')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: emptyCommandBodySchema.optional(),
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await readAllNotificationsCommand(contextOf(request), options(request, 'optional')),
      ),
  )

  typed.post(
    '/api/v1/notifications/:notificationId/read',
    {
      preValidation: guard('notification.read'),
      schema: {
        operationId: 'readNotification',
        tags: ['notifications'],
        summary: 'Bildirimi okundu işaretle',
        description: `Bildirime oturum sahibinin ilk okuma anını yazar (core \`markNotificationRead\`); tekrar çağrı kaydı değiştirmez. Görülemeyen (başka öğrencinin, başka velinin çocuğunun, başka kurumun) veya olmayan bildirim 404 \`not_found\` (core \`notification_not_found\` genel koda çevrilir). \`Idempotency-Key\` isteğe bağlıdır, \`If-Match\` kabul edilmez. Modül \`communication\`. Roller: ${READ_ROLES.map((r) => `\`${r}\``).join(', ')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: notificationParamsSchema,
        body: emptyCommandBodySchema.optional(),
        response,
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await readNotificationCommand(
          contextOf(request),
          request.params.notificationId,
          options(request, 'optional'),
        ),
      ),
  )
}
