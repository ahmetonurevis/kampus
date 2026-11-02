import { createHash, randomUUID } from 'node:crypto'

import type { FastifyBaseLogger } from 'fastify'
import type { z } from 'zod'

import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import {
  isMinorLearner,
  notificationAudiences,
  notificationEnabled,
  notificationRecordSchema,
  notificationSubject,
  type NotificationAudience,
  type NotificationRecord,
} from '@kampus/school-core/lib/notifications.ts'
import type {
  NOTIFICATION_TYPES,
  NotificationType,
} from '@kampus/school-core/modules/notification-types.ts'

import type { Database } from '../db/client.ts'
import { insertNotifications, institutionStudentIds } from '../db/notifications.ts'
import { loadRecords } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { findStudentIdentity } from '../db/student-identities.ts'
import { AppError, MESSAGES } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'

/**
 * Bildirim gönderimi (IST-065, OG-018; docs/domain/iletisim-ve-veli.md DOM-ILT-020, -022, -023,
 * -052, -073). Bir alanın işlemi kendi transaction'ında `notify(tx, ctx, { type, recipients,
 * data })` çağırır; tür alanın kendi tür dosyasındadır (`modules/notification-types.ts`
 * birleşimi). Sözleşme:
 *
 * - Yazma çağıranın transaction'ındadır, ayrı transaction açılmaz: çağıran işlem geri alınırsa
 *   bildirim de yoktur. `tx` dışında bir bağlantı verilmez.
 * - `data` türün katı şemasıyla doğrulanır; geçersiz veri, bilinmeyen ve ticari tür programlama
 *   hatasıdır (500, çağıranın işlemi de geri alınır). Kayda veri yazılmaz; yalnız tür, kitle,
 *   öğrenci, konu kaydının kimliği ve an yazılır (DOM-ILT-023, `records.data` kuralı: özel
 *   nitelikli veri yok). Başlık okumada türün şablonundan üretilir.
 * - Alıcılar öğrenci kimliğidir; kurumda olmayan (başka kurumun ya da olmayan) öğrenci atlanır
 *   ve yalnız sayısı loglanır. Her öğrenci için türün kitlesi yaşa göre seçilir: 18 yaş altında
 *   `minor`, yetişkin kursiyerde `adult` (veli bildirimi yetişkine gitmez). Veli kullanıcıya değil
 *   öğrenci bağına çözülür; görünürlük okumada üyelik bağlarındandır (`notificationAudienceOf`).
 * - Bildirim merkezi (`communication`) ya da türün modülü kapalıysa hiçbir şey yazılmaz;
 *   `notification.skipped` logu düşer, çağıranın işlemi sürer.
 * - `dedupeKey` verilirse kimlik tür, anahtar, kitle ve öğrenciden türetilir: aynı olay aynı
 *   alıcıya ikinci kez yazılmaz (yeniden deneme, tarama işinin tekrar koşması). Verilmezse her
 *   çağrı yeni bildirimdir.
 * - Yazılan bildirimler için tek denetim satırı: `notification.create`, varlık konu kaydı, yalnız
 *   alan adları. Log yalnız tür ve sayıları taşır; öğrenci kimliği, adı ve başlık loglanmaz.
 */

/** `notify` için gereken bağlam; istekteki `ServiceContext` doğrudan verilir. */
export interface NotifyContext {
  institutionId: string
  now: Date
  log: FastifyBaseLogger
  /** Denetim satırının aktörü; zamanlanmış işte (aktörsüz) `null`. */
  actor?: Pick<ServiceContext['actor'], 'userId' | 'role'> | null
}

export interface NotifyRecipients {
  /** Olayın ait olduğu öğrenciler; veli ve kursiyer kitlesi türün kuralıyla seçilir. */
  studentIds: readonly string[]
}

export type NotificationData<T extends NotificationType> = z.input<
  (typeof NOTIFICATION_TYPES)[T]['data']
>

export interface NotifyInput<T extends NotificationType = NotificationType> {
  type: T
  recipients: NotifyRecipients
  /** Türün `data` şeması: yalnız kimlik (DOM-ILT-023). */
  data: NotificationData<T>
  /** Olayın tekil anahtarı (ör. taksit kimliği + vade günü); aynı alıcıya ikinci yazmayı önler. */
  dedupeKey?: string | undefined
}

export interface NotifyResult {
  /** Yazılan bildirim kimlikleri, alıcı ve kitle sırasıyla. */
  created: string[]
  /** Daha önce yazıldığı için (`dedupeKey`) atlanan bildirim sayısı. */
  deduplicated: number
  /** Kurumda bulunmadığı için atlanan alıcı sayısı. */
  unknownRecipients: number
  /** Modül kapalıysa `module_disabled`; yazıldıysa `null`. */
  skipped: 'module_disabled' | null
}

/**
 * Teslim kanalı arayüzü. Uygulama içi kanal her zaman açıktır ve tercihle kapanmaz
 * (DOM-ILT-020); bugünkü tek kanal odur ve kaydı yazar.
 */
export interface NotificationChannel {
  readonly name: 'in_app'
  deliver(
    tx: Database,
    ctx: NotifyContext,
    notifications: readonly NotificationRecord[],
  ): Promise<string[]>
}
// TODO(D2-bildirim-kanali): e-posta (D2), SMS ve anlık bildirim (D3) bu arayüzle ayrı kanal olur:
// `name` birleşimine eklenir, uygulama içi kayıt yazıldıktan sonra kullanıcının konu bazında kanal
// tercihi (DOM-ILT-020), sessiz saat (DOM-ILT-021) ve ticari ileti onayıyla (DOM-ILT-022) kuyruğa
// (`pg-boss`, yalnız kurum ve kayıt kimliği) bırakılır; gövde DOM-ILT-023 kuralıyla şablondan.
const IN_APP: NotificationChannel = {
  name: 'in_app',
  deliver: (tx, ctx, notifications) =>
    insertNotifications(tx, ctx.institutionId, notifications, ctx.now),
}

const dedupeKeySchema = notificationRecordSchema.shape.id

function programmingError(what: string, cause?: unknown): AppError {
  return new AppError(500, 'internal_error', MESSAGES.internal_error, {
    cause: new Error(what, { cause }),
  })
}

/**
 * `dedupeKey`li bildirimin kimliği: aynı olay, kitle ve öğrenci için hep aynı. Önceki bildirimin
 * yazılıp yazılmadığını soran işlem (devamsızlık düzeltmesi) kimliği buradan hesaplar.
 */
export function dedupedNotificationId(
  type: string,
  key: string,
  audience: NotificationAudience,
  studentId: string,
): string {
  const digest = createHash('sha256')
    .update([type, key, audience, studentId].join('\u0000'))
    .digest('hex')
  return `ntf-${digest.slice(0, 32)}`
}

/**
 * Öğrenci 18 yaş altında mı (core `isMinorLearner`). Okulda her öğrenci velilidir; dil okulunda
 * kimlik satırındaki doğum tarihi (`student_identities`, ADR 0006 karar 9), yoksa kesin kayda
 * alınan adayın 18 yaş seçimi okunur. Kişisel veri loglanmaz.
 */
async function learnerMinor(
  tx: Database,
  ctx: NotifyContext,
  institutionType: InstitutionType,
  studentId: string,
): Promise<boolean> {
  const options = { institutionType, now: ctx.now.toISOString() }
  if (institutionType === 'school') return isMinorLearner({}, options)
  const identity = await findStudentIdentity(tx, ctx.institutionId, studentId)
  if (identity !== null) return isMinorLearner({ birthDate: identity.birthDate }, options)
  const [prospect] = await loadRecords(tx, ctx.institutionId, ['prospects'], {
    match: [{ kind: 'equals', field: 'studentId', values: [studentId] }],
  })
  const prospectMinor = typeof prospect?.data.minor === 'boolean' ? prospect.data.minor : undefined
  return isMinorLearner({ prospectMinor }, options)
}

/**
 * Bildirim gönderir (uygulama içi kanal). Çağıranın transaction'ında yazar; ayrıntı yukarıda.
 * Çağrı bildirim yazsa da yazmasa da (modül kapalı, alıcı yok, mükerrer) çağıranın işlemini
 * bozmaz; yalnız programlama hatası (geçersiz veri, bilinmeyen tür) atar.
 */
export async function notify<T extends NotificationType>(
  tx: Database,
  ctx: NotifyContext,
  input: NotifyInput<T>,
): Promise<NotifyResult> {
  let subject: NotificationRecord['subject']
  try {
    subject = notificationSubject(input.type, input.data).subject
  } catch (error) {
    throw programmingError(`notify: ${input.type}`, error)
  }
  if (input.dedupeKey !== undefined && !dedupeKeySchema.safeParse(input.dedupeKey).success)
    throw programmingError(`notify: invalid dedupe key for ${input.type}`)

  const result: NotifyResult = {
    created: [],
    deduplicated: 0,
    unknownRecipients: 0,
    skipped: null,
  }
  const institution = await getInstitutionModules(tx, ctx.institutionId)
  if (institution === null || !notificationEnabled(input.type, institution.modules)) {
    ctx.log.info({ event: 'notification.skipped', type: input.type, reason: 'module_disabled' })
    return { ...result, skipped: 'module_disabled' }
  }

  const requested = [...new Set(input.recipients.studentIds)]
  const known = await institutionStudentIds(tx, ctx.institutionId, requested)
  const students = requested.filter((id) => known.has(id))
  result.unknownRecipients = requested.length - students.length
  if (result.unknownRecipients > 0)
    ctx.log.warn({
      event: 'notification.recipient_skipped',
      type: input.type,
      count: result.unknownRecipients,
    })

  const createdAt = ctx.now.toISOString()
  const drafts: NotificationRecord[] = []
  for (const studentId of students) {
    const minor = await learnerMinor(tx, ctx, institution.type, studentId)
    for (const audience of notificationAudiences(input.type, minor))
      drafts.push(
        notificationRecordSchema.parse({
          id:
            input.dedupeKey === undefined
              ? `ntf-${randomUUID()}`
              : dedupedNotificationId(input.type, input.dedupeKey, audience, studentId),
          kind: input.type,
          audience,
          studentId,
          subject,
          createdAt,
        }),
      )
  }
  result.created = await IN_APP.deliver(tx, ctx, drafts)
  result.deduplicated = drafts.length - result.created.length
  const [first] = drafts
  if (result.created.length > 0 && first)
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor?.userId ?? null,
      actorRole: ctx.actor?.role ?? null,
      action: 'notification.create',
      entityType: subject.type,
      entityId: subject.id,
      changes: { fields: Object.keys(first).sort() },
      createdAt: ctx.now,
    })
  ctx.log.info({
    event: 'notification.created',
    type: input.type,
    created: result.created.length,
    deduplicated: result.deduplicated,
  })
  return result
}
