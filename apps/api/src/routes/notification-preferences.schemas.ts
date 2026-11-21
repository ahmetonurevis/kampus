import { z } from 'zod'

import {
  notificationPreferencesPatchSchema,
  notificationPreferencesSchema,
} from '@kampus/school-core/lib/notification-preferences.ts'

import { dataResponse } from './common.schemas.ts'

/** PATCH gövdesi: core kısmi güncelleme şeması ve iyimser kilit sürümü. */
export const patchNotificationPreferencesBodySchema = notificationPreferencesPatchSchema
  .extend({
    version: z.number().int().min(1).describe('Okunan tercih sürümü; tutmazsa 409'),
  })
  .meta({ id: 'PatchNotificationPreferencesBody' })

export const notificationPreferencesResponseSchema = dataResponse(
  z
    .object({
      preferences: notificationPreferencesSchema.describe(
        'Etkin tercih; kayıt yoksa varsayılan (21:00–08:00 sessiz saat, uygulama içi ve anlık bildirim)',
      ),
      version: z.number().int().describe('Sonraki PATCH için sürüm; kayıt yoksa 1'),
    })
    .meta({ id: 'NotificationPreferences' }),
)
