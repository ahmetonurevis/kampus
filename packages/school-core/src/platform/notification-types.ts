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
   * Ödev teslimi değerlendirildi (DOM-AKD-073): öğretmen puan ve geri bildirim yazınca öğrenciye
   * ve 18 yaş altında veliye; yeniden değerlendirmede de yazılır. Puan ve geri bildirim metni
   * bildirimde yoktur, teslim ayrıntısında okunur (DOM-ILT-023).
   */
  homework_graded: defineNotificationType({
    topic: 'homework',
    category: 'service',
    mandatory: false,
    module: 'learning',
    audiences: { minor: ['student', 'parent'], adult: ['student'] },
    // Konu ödevdir: istemci ödev ayrıntısını açar, öğrenci orada kendi teslimini görür.
    subjectType: 'homework',
    data: z.strictObject({ homeworkId: notificationId }),
    subjectId: (data) => data.homeworkId,
    titles: {
      student: 'Ödevin değerlendirildi.',
      parent: '{öğrenci} için ödev değerlendirildi.',
    },
  }),
  /**
   * İzin formu açıldı ya da öğrenci düzenlemeyle hedefe girdi (IST-067, DOM-ILT-036, -039): 18
   * yaş altında veliye, yetişkin kursiyerde kendisine. Karar istenen bildirimdir ve son güne
   * bağlıdır; konu tercihiyle kapanmaz (DOM-ILT-020 "onay son tarihi"). Konu, son gün ve açıklama
   * bildirimde yoktur, form ayrıntısında okunur (DOM-ILT-023).
   */
  permission_form_opened: defineNotificationType({
    topic: 'consent',
    category: 'service',
    mandatory: true,
    module: 'communication',
    audiences: { minor: ['parent'], adult: ['student'] },
    subjectType: 'permission_form',
    data: z.strictObject({ formId: notificationId }),
    subjectId: (data) => data.formId,
    titles: {
      student: 'Senden izin bekleyen bir form var.',
      parent: '{öğrenci} için izin formu açıldı.',
    },
  }),
  /**
   * Etkinlik ayrıntısı (gün, saat, yer, ulaşım, ücret) değişti, verilen izin düştü (DOM-ILT-032):
   * izni ya da reddi düşen öğrenci için kararı veren tarafa (18 yaş altında veli, yetişkinde
   * kendisi) yeniden karar istenir. Zorunludur (DOM-ILT-020 "onay son tarihi"). Neyin değiştiği
   * ve yeni ayrıntı bildirimde yoktur, form ayrıntısında okunur (DOM-ILT-023).
   */
  permission_form_reconsent: defineNotificationType({
    topic: 'consent',
    category: 'service',
    mandatory: true,
    module: 'communication',
    audiences: { minor: ['parent'], adult: ['student'] },
    subjectType: 'permission_form',
    data: z.strictObject({ formId: notificationId }),
    subjectId: (data) => data.formId,
    titles: {
      student: 'Etkinlik değişti, izninin yeniden verilmesi gerekiyor.',
      parent: '{öğrenci} için etkinlik değişti, izin yeniden istenir.',
    },
  }),
  /**
   * Etkinlik iptal edildi (DOM-ILT-032): izin vermiş ve karar bekleyen öğrencinin kararı veren
   * tarafına gider; etkinliği reddedene gitmez. Zorunludur (DOM-ILT-020). Neden ve ayrıntı
   * bildirimde yoktur (DOM-ILT-023).
   */
  permission_form_cancelled: defineNotificationType({
    topic: 'consent',
    category: 'service',
    mandatory: true,
    module: 'communication',
    audiences: { minor: ['parent'], adult: ['student'] },
    subjectType: 'permission_form',
    data: z.strictObject({ formId: notificationId }),
    subjectId: (data) => data.formId,
    titles: {
      student: 'İzin istenen etkinlik iptal edildi.',
      parent: '{öğrenci} için izin istenen etkinlik iptal edildi.',
    },
  }),
  /**
   * Son gün yaklaşırken karar bekleyen öğrenci için hatırlatma (DOM-ILT-039; `permissionReminders`
   * saf hesaptır, API'nin `permission-forms.remind` işi her sabah yazar). Zorunludur (DOM-ILT-020).
   */
  permission_form_reminder: defineNotificationType({
    topic: 'consent',
    category: 'service',
    mandatory: true,
    module: 'communication',
    audiences: { minor: ['parent'], adult: ['student'] },
    subjectType: 'permission_form',
    data: z.strictObject({ formId: notificationId }),
    subjectId: (data) => data.formId,
    titles: {
      student: 'İzin formunun son günü yaklaşıyor.',
      parent: '{öğrenci} için izin formunun son günü yaklaşıyor.',
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
  /**
   * İzin/mazeret bildirimi sonuçlandı (DOM-ILT-053): idare onayladı ya da reddetti; ikisinde de
   * bildirilir. Sonuç, gerekçe ve kategori bildirimde yoktur (sağlık bilgisi sızmaz,
   * DOM-ILT-023); bildirim ayrıntısında okunur. Bildirimi veli yaptığı için 18 yaş altında yalnız
   * veliye gider.
   */
  absence_decided: defineNotificationType({
    topic: 'attendance',
    category: 'service',
    mandatory: true,
    module: 'academic',
    audiences: { minor: ['parent'], adult: ['student'] },
    subjectType: 'absence',
    data: z.strictObject({ absenceId: notificationId }),
    subjectId: (data) => data.absenceId,
    titles: {
      student: 'İzin/mazeret bildirimin sonuçlandı.',
      parent: '{öğrenci} için izin/mazeret bildirimi sonuçlandı.',
    },
  }),
} as const
