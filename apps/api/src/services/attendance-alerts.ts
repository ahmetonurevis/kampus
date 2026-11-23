import type { AttendanceAlert } from '@kampus/school-core/lib/attendance-alerts.ts'
import { NOTIFICATION_AUDIENCES } from '@kampus/school-core/lib/notifications.ts'

import type { Database } from '../db/client.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { dedupedNotificationId, notify, type NotifyContext } from './notify.ts'

/**
 * Yoklamadan devamsızlık bildirimi yazımı (IST-072; docs/domain/iletisim-ve-veli.md
 * DOM-ILT-052). Karar core `attendanceAlerts`'tedir; burada yoklamanın transaction'ında
 * (`tx`, işlem çalıştırıcı `after`) `notify` çağrılır. Alıcı kitlesi, kapalı modül, yetişkin
 * kursiyer ve başka kurumun öğrencisi `notify`'ın kurallarıdır; erişimi kısıtlı ya da velayeti
 * olmayan veli bildirimi okuma kapsamında görmez (`guardedActorLinks`, DOM-ILT-070, -074), bu
 * yüzden alıcı hesabı burada ikinci kez yapılmaz.
 *
 * - Gelmedi bildirimi `dedupeKey` ile yinelenmez: aynı durumu yeniden kaydetmek yeni bildirim
 *   açmaz.
 * - Düzeltme ("gelmedi" başka duruma çevrildi) yalnız önceki gelmedi bildirimi gerçekten
 *   yazılmışsa gider; modül kapalıyken ya da başka gün yazılmış kayıt için "düzeltildi"
 *   bildirimi anlamsızdır. Önceki bildirim geri çekilmez, tarihçe kalır.
 * - Bildirimde öğrenci adı dışında kişisel veri yoktur: durum, ders, neden ve mazeret yazılmaz.
 */
export async function notifyAttendanceAlerts(
  tx: Database,
  ctx: NotifyContext,
  alerts: readonly AttendanceAlert[],
): Promise<void> {
  const batches = new Map<string, { alert: AttendanceAlert; studentIds: string[] }>()
  for (const alert of alerts) {
    if (alert.type === 'absence_corrected' && !(await originWritten(tx, ctx, alert))) continue
    const key = `${alert.type}\u0000${alert.dedupeKey}`
    const batch = batches.get(key)
    if (batch) batch.studentIds.push(alert.studentId)
    else batches.set(key, { alert, studentIds: [alert.studentId] })
  }
  for (const { alert, studentIds } of batches.values())
    await notify(tx, ctx, {
      type: alert.type,
      recipients: { studentIds },
      data: { attendanceId: alert.attendanceId },
      dedupeKey: alert.dedupeKey,
    })
}

/** Düzeltilen "gelmedi" bildirimi bu kurumda (hangi kitleye olursa) yazılmış mı. */
async function originWritten(
  tx: Database,
  ctx: NotifyContext,
  alert: AttendanceAlert,
): Promise<boolean> {
  const { origin } = alert
  if (origin === null) return false
  const ids = NOTIFICATION_AUDIENCES.map((audience) =>
    dedupedNotificationId('absence_recorded', origin, audience, alert.studentId),
  )
  const found = await loadRecordsByIds(tx, ctx.institutionId, 'notifications', ids)
  return found.length > 0
}
