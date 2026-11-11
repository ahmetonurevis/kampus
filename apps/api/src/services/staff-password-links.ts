import { and, eq, isNotNull } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { z } from 'zod'

import type { Auth } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { invitations } from '../db/schema/auth.ts'
import { jobErrorInfo } from '../jobs/job-error.ts'

/**
 * Personel davetinden sonra parola belirleme bağlantısı (IST-007, DOM-YTK-070). Tek davet ve toplu
 * aktarım her davet için aynı yolu izler; hesabın yeni mi, başka kurumda var mı olduğu yanıt
 * yolunda ayrılmaz (karar 73): ayrım yalnız gönderimde, davet satırından okunur
 * (`membership_id` dolu = kurumun açtığı yeni hesap). Böylece yanıt süresi de hesabın varlığını
 * belli etmez.
 *
 * - Kuyruk açıkken (`JOBS_ENABLED`) her davet için `staff.password-link` işi davetleri yazan
 *   transaction'da eklenir (`jobs/staff-password-link.ts`); işlem geri alınırsa iş yoktur.
 * - Kuyruk kapalıyken (test, kuyruk açılamadı) gönderim transaction'dan sonra süreç içinde, yanıtı
 *   beklemeden arka planda ve dörderli gruplarla çalışır (`InlineStaffLinkScheduler`).
 *
 * Yük yalnız kurum ve davet kimliğidir; e-posta işleyicide davet satırından okunur.
 */

/** Yük: kurum ve davet kimliği (katı şema; kişisel veri yok). */
export const staffLinkJobDataSchema = z.strictObject({
  institutionId: z.string().min(1).max(200),
  invitationId: z.string().min(1).max(200),
})
export type StaffLinkJobData = z.infer<typeof staffLinkJobDataSchema>

export interface StaffLinkScheduler {
  /** Davetleri yazan transaction içinde, her davet için çağrılır. */
  enqueue(tx: Database, data: StaffLinkJobData): Promise<void>
  /** Transaction yazıldıktan sonra (tekrarlanan yanıtta çağrılmaz); beklemez, hata fırlatmaz. */
  afterCommit(data: readonly StaffLinkJobData[]): void
}

/** Uygulamanın bağlantı zamanlayıcısı; `inline` kuyruksuz yoldur (test ve kapanış bekler). */
export interface StaffLinkRuntime {
  scheduler: StaffLinkScheduler
  inline: InlineStaffLinkScheduler
}

export interface StaffLinkDeps {
  db: Database
  auth: Auth
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>
}

export type StaffLinkOutcome = 'sent' | 'skipped'

/**
 * Davetin bağlantısını gönderir. Bekleyen ve kurumun açtığı hesaba (`membership_id`) ait davette
 * mevcut sıfırlama akışı (`request-password-reset`, `services/password-reset.ts`) çağrılır;
 * belirteç, soğuma, saatlik sınır ve denetim oradadır. Başka kurumdaki hesabın daveti, iptal ya da
 * kabul edilmiş davet atlanır. Gönderim hatası davetin sonucunu değiştirmez: loglanır (e-posta
 * yazılmaz); yönetici daveti iptal edip yeniden gönderebilir ya da kişi "Parolamı unuttum" ile
 * bağlantı ister. Veritabanı okuma hatası fırlar (kuyrukta yeniden denenir).
 */
export async function sendStaffInvitationLink(
  deps: StaffLinkDeps,
  data: StaffLinkJobData,
): Promise<StaffLinkOutcome> {
  const [row] = await deps.db
    .select({ email: invitations.email })
    .from(invitations)
    .where(
      and(
        eq(invitations.institutionId, data.institutionId),
        eq(invitations.id, data.invitationId),
        eq(invitations.status, 'pending'),
        isNotNull(invitations.membershipId),
      ),
    )
    .limit(1)
  if (row === undefined) return 'skipped'
  try {
    await deps.auth.api.requestPasswordReset({ body: { email: row.email } })
  } catch (error) {
    deps.log.warn({ event: 'staff.invite_link_failed', ...data, ...jobErrorInfo(error) })
  }
  return 'sent'
}

/** Kuyruksuz gönderimde aynı anda en çok bu kadar bağlantı. */
export const INLINE_LINK_CONCURRENCY = 4

/**
 * Kuyruk kapalıyken bağlantılar (yukarıdaki açıklama): iş eklenmez; gönderim transaction'dan sonra
 * arka planda çalışır, yanıt beklemez. `idle()` başlatılmış bütün gönderimler (ve Better Auth'un
 * arka plan iletileri) bitene kadar bekler (test ve kapanış); `close()` yeni gönderim almaz ve
 * sürenleri bekler.
 */
export class InlineStaffLinkScheduler implements StaffLinkScheduler {
  readonly #deps: StaffLinkDeps
  readonly #pending = new Set<Promise<unknown>>()
  #closed = false

  constructor(deps: StaffLinkDeps) {
    this.#deps = deps
  }

  async enqueue(): Promise<void> {}

  afterCommit(data: readonly StaffLinkJobData[]): void {
    if (this.#closed || data.length === 0) return
    const run = this.#sendAll([...data]).catch((error: unknown) => {
      this.#deps.log.error({ event: 'staff.invite_links_failed', ...jobErrorInfo(error) })
    })
    this.#pending.add(run)
    void run.finally(() => this.#pending.delete(run))
  }

  async #sendAll(data: StaffLinkJobData[]): Promise<void> {
    for (let index = 0; index < data.length; index += INLINE_LINK_CONCURRENCY)
      await Promise.all(
        data.slice(index, index + INLINE_LINK_CONCURRENCY).map(async (item) => {
          try {
            await sendStaffInvitationLink(this.#deps, item)
          } catch (error) {
            this.#deps.log.error({
              event: 'staff.invite_link_failed',
              ...item,
              ...jobErrorInfo(error),
            })
          }
        }),
      )
  }

  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending])
    await this.#deps.auth.flushBackground()
  }

  async close(): Promise<void> {
    this.#closed = true
    await this.idle()
  }
}
