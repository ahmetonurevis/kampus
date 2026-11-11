import type { FastifyBaseLogger } from 'fastify'
import type { Job, JobResult, PgBoss, Queue, SendOptions } from 'pg-boss'

import type { Auth } from '../auth.ts'
import type { Database } from '../db/client.ts'
import {
  sendStaffInvitationLink,
  staffLinkJobDataSchema,
  type StaffLinkScheduler,
} from '../services/staff-password-links.ts'
import { jobErrorInfo } from './job-error.ts'
import { transactionConnection } from './media-transcode.ts'

/**
 * Olaya bağlı personel parola bağlantısı işi `staff.password-link` (IST-007, DOM-YTK-070; OG-060).
 * Davet ve toplu aktarım her davet için işi davetleri yazan transaction'da ekler
 * (`send({ db })`): işlem geri alınırsa iş yoktur, yanıt gönderimi beklemez. İşleyici
 * `services/staff-password-links.ts`'tedir; yükte e-posta yoktur.
 */

export const STAFF_PASSWORD_LINK_JOB = 'staff.password-link'

/**
 * Kuyruk ayarı. Politika `exclusive` (anahtar davet kimliği): aynı davet için bekleyen, yeniden
 * denenecek ya da çalışan iş varken ikinci iş açılmaz. Yalnız veritabanı okuma hatası yeniden
 * denenir; gönderim hatası işleyicide loglanır ve iş tamamlanır (aynı kişiye yinelenen bağlantı
 * gitmesin).
 */
export const STAFF_LINK_QUEUE_OPTIONS = {
  policy: 'exclusive',
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 900,
  expireInSeconds: 120,
} as const satisfies Omit<Queue, 'name'>

/** İşçi: kısa iş; aynı anda en çok dört gönderim (kuyruksuz yoldaki sınırla aynı). */
export const STAFF_LINK_WORK_OPTIONS = { batchSize: 1, localConcurrency: 4 } as const

export function queuedStaffLinkScheduler(boss: Pick<PgBoss, 'send'>): StaffLinkScheduler {
  return {
    async enqueue(tx, data) {
      const options: SendOptions = {
        db: transactionConnection(tx),
        singletonKey: data.invitationId,
      }
      await boss.send(STAFF_PASSWORD_LINK_JOB, data, options)
    },
    afterCommit() {},
  }
}

/** Tek işi çalıştırır: bozuk yük `deadletter`, okuma hatası `failed` (yeniden deneme). */
export async function runStaffLinkJob(
  deps: { db: Database; auth: Auth; log: FastifyBaseLogger },
  job: Job<unknown>,
): Promise<JobResult> {
  const parsed = staffLinkJobDataSchema.safeParse(job.data)
  if (!parsed.success) {
    deps.log.error({
      event: 'job.failed',
      job: STAFF_PASSWORD_LINK_JOB,
      retryCount: job.retryCount,
      reason: 'invalid_payload',
    })
    return { id: job.id, status: 'deadletter', output: { reason: 'invalid_payload' } }
  }
  const data = parsed.data
  try {
    const outcome = await sendStaffInvitationLink(deps, data)
    deps.log.info({ event: 'job.completed', job: STAFF_PASSWORD_LINK_JOB, ...data, outcome })
    return { id: job.id, status: 'completed', output: { outcome } }
  } catch (error) {
    const info = jobErrorInfo(error)
    deps.log.error({
      event: 'job.failed',
      job: STAFF_PASSWORD_LINK_JOB,
      ...data,
      retryCount: job.retryCount,
      code: info.code,
      message: info.message,
    })
    return { id: job.id, status: 'failed', output: info }
  }
}
