import { filesPurgeJob } from './files-purge.ts'
import { idempotencyPurgeJob } from './idempotency-purge.ts'
import type { AnyInstitutionJob } from './types.ts'

/**
 * Kuyruğun kurduğu zamanlanmış işler. Yeni iş `src/jobs/<ad>.ts`'te tanımlanır ve buraya eklenir;
 * listeden çıkan işin zamanlaması açılışta kaldırılır (`startJobs`).
 */
export const INSTITUTION_JOBS: readonly AnyInstitutionJob[] = [idempotencyPurgeJob, filesPurgeJob]
