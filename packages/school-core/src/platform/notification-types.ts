import { z } from 'zod'

import { defineNotificationType, notificationId } from '../lib/notification-type.ts'

/**
 * Platform ve akademik bildirim türleri: Onur'un kayıt ve finans türleri dışındaki her tür.
 * Birleşik kayıt ve sözleşme `modules/notification-types.ts`'tedir; bir tür kodu iki kaynakta
 * bulunamaz (`tests/notification-types.test.ts`). Üretim API `services/notify.ts` `notify` ile
 * olayın kendi transaction'ındadır.
 */
export const PLATFORM_NOTIFICATION_TYPES = {
  /** Öğretmen geri bildirimi açıldı: puan kesinleşti ve kursiyere açıldı (DOM-BEC-045). */
  feedback_released: defineNotificationType({
    topic: 'homework',
    category: 'service',
    mandatory: false,
    module: 'learning',
    audiences: { minor: ['student', 'parent'], adult: ['student'] },
    subjectType: 'task_submission',
    data: z.strictObject({ submissionId: notificationId }),
    subjectId: (data) => data.submissionId,
    titles: {
      student: 'Görevine öğretmen geri bildirimi geldi.',
      parent: '{öğrenci} için öğretmen geri bildirimi geldi.',
    },
  }),
} as const
