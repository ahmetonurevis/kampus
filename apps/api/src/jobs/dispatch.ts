import type { Database } from '../db/client.ts'
import { listInstitutionIds } from '../db/institutions.ts'
import type { AnyInstitutionJob, InstitutionJobData } from './types.ts'

/** Kuyruğa iş bırakan arayüz; çalışma zamanında pg-boss `send`, testte kayıt tutan sahte. */
export interface JobSender {
  send(
    name: string,
    data: InstitutionJobData,
    options: { singletonKey: string; singletonSeconds: number },
  ): Promise<string | null>
}

/** Zamanlayıcının tetiklediği dağıtım kuyruğunun adı. */
export const dispatchQueueName = (job: Pick<AnyInstitutionJob, 'name'>) => `${job.name}.dispatch`

/**
 * Kurumları dolaşıp her kurum için işi kuyruğa koyar. Tekil anahtar kurum kimliğidir ve
 * `slotSeconds` dilimiyle birlikte pg-boss'ta benzersizdir: dağıtım aynı dilimde iki kez çalışsa
 * da (yeniden deneme, iki örnek) kurum başına tek iş açılır; ikinci `send` `null` döner.
 * Yalnız sayılar döner.
 */
export async function dispatchInstitutionJobs(
  db: Database,
  sender: JobSender,
  job: Pick<AnyInstitutionJob, 'name' | 'slotSeconds'>,
): Promise<{ institutions: number; queued: number }> {
  const institutionIds = await listInstitutionIds(db)
  let queued = 0
  for (const institutionId of institutionIds) {
    const id = await sender.send(
      job.name,
      { institutionId },
      { singletonKey: institutionId, singletonSeconds: job.slotSeconds },
    )
    if (id !== null) queued += 1
  }
  return { institutions: institutionIds.length, queued }
}
