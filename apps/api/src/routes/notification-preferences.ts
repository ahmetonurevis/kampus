import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { ROLES } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  notificationPreferencesFor,
  patchNotificationPreferences,
} from '../services/notification-preferences.ts'
import { commandErrors } from './commands.schemas.ts'
import {
  notificationPreferencesResponseSchema,
  patchNotificationPreferencesBodySchema,
} from './notification-preferences.schemas.ts'

/**
 * Bildirim tercihi ve sessiz saat uçları (OG-107; docs/domain/iletisim-ve-veli.md DOM-ILT-020,
 * -021). Her rol kendi tercihini yönetir; kimlik oturumdandır, yolda kullanıcı kimliği yoktur.
 * Modül `communication`. Gönderimde uygulanması ayrı iştir (`services/notify.ts`).
 */

const MODULE = 'communication'

export function registerNotificationPreferenceRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guard = [app.authenticate, app.requireModule(MODULE), app.requireRole(ROLES)]

  typed.get(
    '/api/v1/notification-preferences',
    {
      preValidation: guard,
      schema: {
        operationId: 'getNotificationPreferences',
        tags: ['notifications'],
        summary: 'Bildirim tercihlerim',
        description:
          'Oturum sahibinin konu × kanal tercihi ve sessiz saati (DOM-ILT-020, -021). Kayıt yoksa varsayılan ve `version: 1` döner. Uygulama içi kanal her konuda açıktır; zorunlu konularda (devamsızlık, etkinlik onayı) anlık bildirim de kapatılamaz. Modül `communication`. Roller: bütün roller.',
        response: { 200: notificationPreferencesResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({ data: await notificationPreferencesFor(contextOf(request)) }),
  )

  typed.patch(
    '/api/v1/notification-preferences',
    {
      preValidation: guard,
      schema: {
        operationId: 'patchNotificationPreferences',
        tags: ['notifications'],
        summary: 'Bildirim tercihlerimi güncelle',
        description:
          'Kısmi güncelleme: `topics` konu bazında birleştirilir, `quietHours` ve `children` verilirse bütün olarak yerini alır. `version` okunan sürümdür; tutmazsa 409 `version_conflict`. Zorunlu konuda taban kanal (uygulama içi, anlık bildirim) çıkarılırsa 422 `notification_channel_required`; sessiz saatte başlangıç ile bitiş aynıysa 422 `quiet_hours_invalid`. `children` yalnız `veli` rolü içindir (çocuğa göre tercih). Başka kullanıcının tercihi bu uçtan okunmaz ya da yazılmaz. Modül `communication`. Roller: bütün roller.',
        body: patchNotificationPreferencesBodySchema,
        response: { 200: notificationPreferencesResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({
      data: await patchNotificationPreferences(contextOf(request), request.body),
    }),
  )
}
