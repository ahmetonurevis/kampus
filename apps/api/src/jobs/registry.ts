import { filesPurgeExpiredJob } from './files-purge-expired.ts'
import { filesPurgeJob } from './files-purge.ts'
import { idempotencyPurgeJob } from './idempotency-purge.ts'
import { permissionRemindersJob } from './permission-reminders.ts'
import type { AnyInstitutionJob } from './types.ts'

/**
 * Kuyruğun kurduğu zamanlanmış işler. Yeni iş `src/jobs/<ad>.ts`'te tanımlanır ve buraya eklenir.
 */
export const INSTITUTION_JOBS: readonly AnyInstitutionJob[] = [
  idempotencyPurgeJob,
  filesPurgeJob,
  filesPurgeExpiredJob,
  permissionRemindersJob,
]

/**
 * Emekliye ayrılan işlerin adları: zamanlamaları açılışta silinir (`startJobs`). İş listeden
 * çıkarılırken adı buraya eklenir; listede olmayan başka zamanlamaya dokunulmaz, böylece kademeli
 * dağıtımda eski sürüm yeni işin zamanlamasını silmez.
 */
export const RETIRED_JOBS: readonly string[] = []
