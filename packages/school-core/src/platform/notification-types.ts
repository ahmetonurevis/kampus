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
  /**
   * İtiraz sonuçlandı (DOM-BEC-025): kabul ya da ret, ikisinde de bildirilir. `feedback_released`
   * kullanılmadı: ret yeni geri bildirim açmaz, o başlık yanıltırdı. Sonuç ve gerekçe yalnız
   * teslim ayrıntısında okunur, bildirimde yoktur (DOM-ILT-023).
   */
  appeal_decided: defineNotificationType({
    topic: 'grade',
    category: 'service',
    mandatory: false,
    module: 'learning',
    audiences: { minor: ['student', 'parent'], adult: ['student'] },
    subjectType: 'task_submission',
    data: z.strictObject({ submissionId: notificationId }),
    subjectId: (data) => data.submissionId,
    titles: {
      student: 'Görev itirazın sonuçlandı.',
      parent: '{öğrenci} için görev itirazı sonuçlandı.',
    },
  }),
  /**
   * Yoklamada "gelmedi" işaretlendi (DOM-ILT-052): 18 yaş altında velilere, yetişkin kursiyerde
   * kendisine aynı gün bildirilir. Zorunludur, konu tercihiyle kapanmaz (DOM-ILT-020). Başlık
   * gün ve ders söylemez (okunduğu gün farklı olabilir); gün bildirimin kendi zamanıdır. Neden,
   * mazeret ve sağlık bilgisi bildirimde yoktur (DOM-ILT-023).
   */
  absence_recorded: defineNotificationType({
    topic: 'attendance',
    category: 'service',
    mandatory: true,
    module: 'academic',
    audiences: { minor: ['parent'], adult: ['student'] },
    subjectType: 'attendance',
    data: z.strictObject({ attendanceId: notificationId }),
    subjectId: (data) => data.attendanceId,
    titles: {
      student: 'Yoklamada gelmedi olarak işaretlendin.',
      parent: '{öğrenci} yoklamada gelmedi olarak işaretlendi.',
    },
  }),
  /**
   * "Gelmedi" kaydı sonradan düzeltildi (DOM-ILT-052). Önceki bildirim geri çekilmez, tarihçe
   * kalır; düzeltme ayrı bildirimle belirtilir. Yalnız gelmedi bildirimi gitmiş alıcıya yazılır
   * (`services/attendance-alerts.ts`). Yeni durum bildirimde yoktur: mazeret ve sağlık bilgisi
   * sızmaz.
   */
  absence_corrected: defineNotificationType({
    topic: 'attendance',
    category: 'service',
    mandatory: true,
    module: 'academic',
    audiences: { minor: ['parent'], adult: ['student'] },
    subjectType: 'attendance',
    data: z.strictObject({ attendanceId: notificationId }),
    subjectId: (data) => data.attendanceId,
    titles: {
      student: 'Gelmedi kaydın düzeltildi.',
      parent: '{öğrenci} için gelmedi kaydı düzeltildi.',
    },
  }),
} as const
