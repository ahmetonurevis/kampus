import { z } from 'zod'

import {
  defineNotificationType,
  notificationId,
  type NotificationTypeSpec,
} from '../lib/notification-type.ts'
import { PLATFORM_NOTIFICATION_TYPES } from '../platform/notification-types.ts'
// Onur: kayıt ve finans (içe aktarma)
import {
  CONTRACT_NOTIFICATION_TYPES,
  FINANCE_NOTIFICATION_TYPES,
  RENEWAL_NOTIFICATION_TYPES,
} from '../lib/finance-notifications.ts'
// Onur: kayıt ve finans (içe aktarma) sonu

/**
 * Bildirim türleri kaydı (IST-065): tür kodu → konu, sınıf, alıcı kuralı, ilgili modül, veri
 * şeması, konu kimliği ve başlık şablonu (`lib/notification-type.ts`). API `notify` yalnız
 * kayıtlı türü yazar; okuma ucu tür listesini buradan alır. Kendi kopyası tutulmaz.
 *
 * İki kaynak birleşir: Oğuzhan'ın türleri `platform/notification-types.ts`, kayıt ve finans
 * türleri aşağıdaki `// Onur: kayıt ve finans` bloğu (kendi dosyasından içe aktarılabilir;
 * içe aktarma üstteki blokta). Bir tür kodu yalnız bir kaynakta bulunur
 * (`tests/notification-types.test.ts` yakalar). Yeni tür eklemek migration gerektirmez; tür
 * listesi OpenAPI'ye girdiği için `pnpm gen` gerekir.
 */

// Onur: kayıt ve finans
/** Kayıt ve finans bildirim türleri. */
export const ONUR_NOTIFICATION_TYPES = {
  /** Kesin kayıt tamamlandı (DOM-KAY-011); 18 yaş altında veliye, yetişkinde kursiyere. */
  enrollment_completed: defineNotificationType({
    topic: 'enrollment',
    category: 'service',
    mandatory: false,
    module: 'crm',
    audiences: { minor: ['parent'], adult: ['student'] },
    subjectType: 'students',
    data: z.strictObject({ studentId: notificationId }),
    subjectId: (data) => data.studentId,
    titles: {
      student: 'Kesin kaydın tamamlandı.',
      parent: '{öğrenci} için kesin kayıt tamamlandı.',
    },
  }),
  ...FINANCE_NOTIFICATION_TYPES,
  ...CONTRACT_NOTIFICATION_TYPES,
  ...RENEWAL_NOTIFICATION_TYPES,
} as const
// Onur: kayıt ve finans sonu

/** Birleşik bildirim türleri kaydı; iki kaynağın toplamı. */
export const NOTIFICATION_TYPES = {
  ...PLATFORM_NOTIFICATION_TYPES,
  ...ONUR_NOTIFICATION_TYPES,
} as const satisfies Record<string, NotificationTypeSpec>
export type NotificationType = keyof typeof NOTIFICATION_TYPES
export const NOTIFICATION_TYPE_NAMES = Object.keys(NOTIFICATION_TYPES) as NotificationType[]

const TYPE_TABLE: Readonly<Record<string, NotificationTypeSpec>> = NOTIFICATION_TYPES

/** Tür kodu dışarıdan gelebilir; `toString` gibi yerleşik özellikler tür sayılmaz. */
export function isNotificationType(code: string): code is NotificationType {
  return Object.hasOwn(TYPE_TABLE, code)
}

/** Türün tanımı; bilinmeyen tür `undefined`. */
export function notificationTypeSpec(code: string): NotificationTypeSpec | undefined {
  return isNotificationType(code) ? TYPE_TABLE[code] : undefined
}
