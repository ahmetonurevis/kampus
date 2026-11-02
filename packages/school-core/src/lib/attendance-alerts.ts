import type { State } from '../data/seed.ts'
import { dayKey } from './format.ts'

/**
 * Yoklamadan devamsızlık bildirimi kararı (IST-072; docs/domain/iletisim-ve-veli.md DOM-ILT-052).
 * Saf kural: yoklama yazılmadan önceki ve sonraki satırlardan hangi öğrenciye hangi bildirimin
 * yazılacağını söyler; yazma API `services/attendance-alerts.ts`'te, yoklamayla aynı
 * transaction'dadır. Alıcı kitlesini (veli ya da yetişkin kursiyer) türün kuralı belirler
 * (`notificationAudiences`), burada değildir.
 *
 * - Öğrenci "gelmedi" (`absent`) durumuna geçtiyse ve yoklamanın günü bugünse `absence_recorded`:
 *   yeni kayıtta ya da önceki durumdan farklıysa. Aynı durumu yeniden kaydetmek bildirim üretmez;
 *   geçmiş güne ilk kez yazılan "gelmedi" "aynı gün" bildirimi değildir, üretmez.
 * - "Gelmedi"den başka duruma düzeltme `absence_corrected` üretir; önceki bildirim geri
 *   çekilmez, düzeltme ayrı bildirimle belirtilir. Düzeltmenin gerçekten bir "gelmedi"
 *   bildirimine karşılık geldiğini API denetler (`origin`).
 * - `dedupeKey` kayıt kimliği ve o ana kadarki düzeltme sayısıdır: aynı durum yeniden
 *   gönderilince aynı anahtar çıkar (yinelenmez); "gelmedi → geldi → gelmedi" yeni bir olaydır.
 * - Bildirim durumu söylemez, neden ya da mazeret taşımaz (DOM-ILT-023); yoklamadaki gerekçe ve
 *   durum yalnız bu karara girer, çıktıya girmez.
 */
// TODO(devamsizlik-esik): yasal eşik bildirimleri (özürsüz 5/10/15 gün, lisede ardışık 2 gün ve
// 5/15/25. gün; DOM-AKD-001 mevzuat profili) ayrı işlerdir; bu kural yalnız anlık bildirimi üretir.

export interface AttendanceSnapshot {
  id: string
  studentId: string
  status: string
  /** Kayıttaki düzeltme sayısı. */
  corrections: number
  /** Yoklamanın tarihi (ISO ya da `YYYY-MM-DD`). */
  date: string
}

export type AttendanceAlert = {
  type: 'absence_recorded' | 'absence_corrected'
  studentId: string
  attendanceId: string
  dedupeKey: string
  /**
   * `absence_corrected` için düzeltilen "gelmedi" bildiriminin `dedupeKey`'i: yalnız o bildirim
   * yazılmışsa düzeltme yazılır. `absence_recorded` için `null`.
   */
  origin: string | null
}

/** Günün yoklama satırlarının karar için gereken kısmı (yoklama yazılmadan önce ve sonra alınır). */
export function attendanceSnapshots(
  state: Pick<State, 'attendance'>,
  date: string,
): AttendanceSnapshot[] {
  const day = dayKey(date)
  return state.attendance
    .filter((row) => dayKey(row.date) === day)
    .map((row) => ({
      id: row.id,
      studentId: row.studentId,
      status: row.status,
      corrections: row.corrections?.length ?? 0,
      date: row.date,
    }))
}

/** Satırın bildirim anahtarı: kayıt ve düzeltme sayısı. */
export const attendanceAlertKey = (row: Pick<AttendanceSnapshot, 'id' | 'corrections'>) =>
  `${row.id}:${row.corrections}`

/**
 * Yoklama yazımının bildirim kararı. `before` yazımdan önceki, `after` sonraki satırlardır (aynı
 * öğrenci ve gün için en çok bir satır); `now` uygulamanın saatidir (Europe/Istanbul günü).
 */
export function attendanceAlerts(
  before: readonly AttendanceSnapshot[],
  after: readonly AttendanceSnapshot[],
  now: string,
): AttendanceAlert[] {
  const previous = new Map(before.map((row) => [row.id, row]))
  const today = dayKey(now)
  const alerts: AttendanceAlert[] = []
  for (const row of after) {
    const old = previous.get(row.id)
    if (old?.status === row.status) continue
    if (row.status === 'absent') {
      if (dayKey(row.date) !== today) continue
      alerts.push({
        type: 'absence_recorded',
        studentId: row.studentId,
        attendanceId: row.id,
        dedupeKey: attendanceAlertKey(row),
        origin: null,
      })
    } else if (old?.status === 'absent')
      alerts.push({
        type: 'absence_corrected',
        studentId: row.studentId,
        attendanceId: row.id,
        dedupeKey: attendanceAlertKey(row),
        origin: attendanceAlertKey(old),
      })
  }
  return alerts
}
