import { purgeInstitutionIdempotencyKeys } from '../db/idempotency.ts'
import { DAY_SECONDS, type InstitutionJob } from './types.ts'

/**
 * Süresi dolan `Idempotency-Key` kayıtlarının günlük temizliği (guvenlik-kvkk.md §10: 24 saat,
 * api-tasarimi.md §7). Her gece 03:30 (Europe/Istanbul) kurum başına çalışır; yazma sırasındaki
 * fırsatçı temizliğin ulaşmadığı, yazması olmayan kurumları da kapsar.
 */
export const idempotencyPurgeJob: InstitutionJob<{ purged: number }> = {
  name: 'idempotency.purge',
  cron: '30 3 * * *',
  slotSeconds: DAY_SECONDS,
  run: async ({ db }, { institutionId }, now) => ({
    purged: await purgeInstitutionIdempotencyKeys(db, institutionId, now),
  }),
}
