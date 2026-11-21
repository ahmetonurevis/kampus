import { sendInstallmentReminders } from '../services/installment-reminders.ts'
import { istanbulHour } from './permission-reminders.ts'
import { HOUR_SECONDS, type InstitutionJob } from './types.ts'

/** Varsayılan sessiz saat (DOM-ILT-021, Europe/Istanbul): 21:00–08:00. */
const QUIET_HOURS_START = 21
const QUIET_HOURS_END = 8

/**
 * Vade ve gecikme hatırlatması (IST-109, DOM-FIN-035): her sabah 09:00 Europe/Istanbul kurum başına
 * çalışır; kural ve bildirim `sendInstallmentReminders`'tadır. Aynı gün ikinci çalıştırma yeni
 * bildirim yazmaz (`dedupeKey`). Kapalıyken kaçırılan oluşum açılışta gönderilir (`missed: 'once'`);
 * sessiz saate denk gelirse hiçbir şey okunmaz ya da yazılmaz (`skipped: 'quiet_hours'`) ve sonraki
 * 09:00 oluşumu işler. Dilim saattir: pg-boss günlük dilimi UTC gününe hizalar, sabaha karşı atlanan
 * çalıştırma aynı günün 09:00 oluşumunu engellemesin; tekrar çalıştırma zararsızdır.
 */
// TODO(finans-bildirim-kayit): iş `jobs/registry.ts` `INSTITUTION_JOBS` listesine eklenince
// zamanlanır; dosya Oğuzhan'ın alanındadır, o satır gelene kadar tarama otomatik çalışmaz.
export const installmentRemindersJob: InstitutionJob<{
  invoices: number
  reminded: number
  created: number
  deduplicated: number
  skipped: string | null
}> = {
  name: 'installments.remind',
  cron: '0 9 * * *',
  slotSeconds: HOUR_SECONDS,
  run: async ({ db, log }, { institutionId }, now) => {
    const hour = istanbulHour(now)
    return hour < QUIET_HOURS_END || hour >= QUIET_HOURS_START
      ? { invoices: 0, reminded: 0, created: 0, deduplicated: 0, skipped: 'quiet_hours' }
      : sendInstallmentReminders({ db, institutionId, now, log })
  },
}
