import { sendPackageAlerts, type PackageAlertResult } from '../services/finance-package-alerts.ts'
import { istanbulHour } from './permission-reminders.ts'
import { HOUR_SECONDS, type InstitutionJob } from './types.ts'

/** Varsayılan sessiz saat (DOM-ILT-021, Europe/Istanbul): 21:00–08:00. */
const QUIET_HOURS_START = 21
const QUIET_HOURS_END = 8

/**
 * Paket saat uyarısı (ON-084; IST-078, DOM-FIN-058, K-248, K-249): her sabah 09:30 Europe/Istanbul
 * kurum başına çalışır; kural ve bildirim `sendPackageAlerts`'tadır. Aynı gün ikinci çalıştırma yeni
 * bildirim yazmaz (`dedupeKey`). Kapalıyken kaçırılan oluşum açılışta gönderilir (`missed: 'once'`);
 * sessiz saate denk gelirse hiçbir şey okunmaz ya da yazılmaz ve sonraki oluşum işler. Dilim saattir
 * (taksit hatırlatmasıyla aynı gerekçe).
 */
// TODO(finans-bildirim-kayit): iş `jobs/registry.ts` `INSTITUTION_JOBS` listesine eklenince
// zamanlanır; dosya Oğuzhan'ın alanındadır, o satır gelene kadar tarama otomatik çalışmaz.
export const packageAlertsJob: InstitutionJob<PackageAlertResult> = {
  name: 'packages.alert',
  cron: '30 9 * * *',
  slotSeconds: HOUR_SECONDS,
  run: async ({ db, log }, { institutionId }, now) => {
    const hour = istanbulHour(now)
    return hour < QUIET_HOURS_END || hour >= QUIET_HOURS_START
      ? { sales: 0, notices: 0, created: 0, deduplicated: 0, skipped: 'quiet_hours' }
      : sendPackageAlerts({ db, institutionId, now, log })
  },
}
