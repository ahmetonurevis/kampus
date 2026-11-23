import { sendPermissionReminders } from '../services/permission-forms.ts'
import { DAY_SECONDS, type InstitutionJob } from './types.ts'

/** Hatırlatma bu saatten (Europe/Istanbul) önce gönderilmez. */
export const REMINDER_EARLIEST_HOUR = 7

const ISTANBUL_HOUR = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Istanbul',
  hour: '2-digit',
  hourCycle: 'h23',
})

/** `now`'ın Europe/Istanbul saatindeki saati (0-23). */
export const istanbulHour = (now: Date) => Number(ISTANBUL_HOUR.format(now))

/**
 * İzin formu son gün hatırlatması (DOM-ILT-039, IST-067): her sabah 08:00 Europe/Istanbul kurum
 * başına çalışır; kural ve bildirim `sendPermissionReminders`'tadır. Aynı gün ikinci çalıştırma
 * yeni bildirim yazmaz (`dedupeKey`). Kapalıyken kaçırılan oluşum açılışta gönderilir
 * (`missed: 'once'`); İstanbul saatiyle 07:00'den önce çalışırsa gece bildirimi gitmesin diye
 * hiçbir şey okunmaz ya da yazılmaz (`skipped: 'before_morning'`) ve sabah 08:00 oluşumu işler.
 */
export const permissionRemindersJob: InstitutionJob<{
  forms: number
  reminded: number
  created: number
  deduplicated: number
  skipped: string | null
}> = {
  name: 'permission-forms.remind',
  cron: '0 8 * * *',
  slotSeconds: DAY_SECONDS,
  run: async ({ db, log }, { institutionId }, now) =>
    istanbulHour(now) < REMINDER_EARLIEST_HOUR
      ? { forms: 0, reminded: 0, created: 0, deduplicated: 0, skipped: 'before_morning' }
      : sendPermissionReminders({ db, institutionId, now, log }),
}
