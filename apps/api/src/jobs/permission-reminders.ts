import { sendPermissionReminders } from '../services/permission-forms.ts'
import { DAY_SECONDS, type InstitutionJob } from './types.ts'

/**
 * İzin formu son gün hatırlatması (DOM-ILT-039, IST-067): her sabah 08:00 Europe/Istanbul kurum
 * başına çalışır; kural ve bildirim `sendPermissionReminders`'tadır. Aynı gün ikinci çalıştırma
 * yeni bildirim yazmaz (`dedupeKey`).
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
  run: ({ db, log }, { institutionId }, now) =>
    sendPermissionReminders({ db, institutionId, now, log }),
}
