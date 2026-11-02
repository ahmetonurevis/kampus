import { asc, eq } from 'drizzle-orm'

import type { Database } from '../db/client.ts'
import { institutions, memberships } from '../db/schema/auth.ts'
import { recordAudit } from './audit.ts'
import { FORWARDED_IP_HEADER, FORWARDED_REQUEST_ID_HEADER } from './auth-hooks.ts'
import { maskResetUrl, type MailLog, type Mailer } from './mailer.ts'

// Parola sıfırlama (IST-003): Better Auth belirteci üretir, saklar ve tüketir; burada yalnız
// bağlantı kurulur, iletinin kime gideceğine karar verilir ve denetim kaydı yazılır.

export interface PasswordResetContext {
  db: Database
  secret: string
  mailer: Mailer
  /** Web kök adresi; `null` ise (üretimde `WEB_URL` yok) bağlantı kurulamaz, ileti gönderilmez. */
  webUrl: string | null
  log: MailLog
}

/** Sıfırlama isteğinin sonucu; yalnız denetim kaydı ve log içindir, yanıta yansımaz. */
export type PasswordResetOutcome =
  | 'sent'
  | 'no_membership'
  | 'mail_not_configured'
  | 'web_url_missing'
  | 'send_failed'

export const RESET_PAGE_PATH = '/parola-sifirla'

export function resetPageUrl(webUrl: string, token: string): string {
  return `${webUrl}${RESET_PAGE_PATH}?token=${encodeURIComponent(token)}`
}

/** Kullanıcının en eski üyeliğinin kurumu (oturum açılışındaki varsayılan kurumla aynı kural). */
async function defaultInstitution(db: Database, userId: string) {
  const [row] = await db
    .select({ id: institutions.id, name: institutions.name })
    .from(memberships)
    .innerJoin(institutions, eq(institutions.id, memberships.institutionId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt), asc(memberships.id))
    .limit(1)
  return row ?? null
}

/**
 * Better Auth `sendResetPassword`. Hiçbir durumda fırlatmaz: hata ya da gönderilmeme yanıta
 * yansırsa hesabın varlığı belli olur. Kurumda üyeliği kalmamış hesaba ileti gitmez; giriş zaten
 * kurumsuz açılmaz ("no-membership"), kurum dışı kişi bağlantı alıp parola koyamaz.
 */
export async function deliverPasswordReset(
  ctx: PasswordResetContext,
  input: { user: { id: string; email: string }; token: string },
  request: Request | undefined,
): Promise<PasswordResetOutcome> {
  const institution = await defaultInstitution(ctx.db, input.user.id)
  let outcome: PasswordResetOutcome
  if (!institution) outcome = 'no_membership'
  else if (!ctx.webUrl) {
    outcome = 'web_url_missing'
    ctx.log.warn(
      { event: 'mail.password_reset_not_sent', code: 'web_url_missing' },
      'WEB_URL verilmediği için parola sıfırlama bağlantısı kurulamadı',
    )
  } else {
    // Sağlayıcı yoksa gönderici yalnız uyarı loglar (`createUnconfiguredMailer`).
    outcome = ctx.mailer.configured ? 'sent' : 'mail_not_configured'
    const url = resetPageUrl(ctx.webUrl, input.token)
    try {
      await ctx.mailer.sendPasswordReset({
        to: input.user.email,
        url,
        institutionName: institution.name,
      })
      // Belirteç gizli, adres yok; belirteçli bağlantıyı yalnız geliştirme göndericisi yazar.
      if (ctx.mailer.configured)
        ctx.log.info(
          { event: 'mail.password_reset', url: maskResetUrl(url) },
          'Parola sıfırlama iletisi gönderildi',
        )
    } catch (error) {
      outcome = 'send_failed'
      ctx.log.error(
        { event: 'mail.password_reset_failed', err: error },
        'Parola sıfırlama iletisi gönderilemedi',
      )
    }
  }

  await recordAudit(ctx, {
    action: 'auth.password_reset_requested',
    actorUserId: input.user.id,
    institutionId: institution?.id ?? null,
    requestId: request?.headers.get(FORWARDED_REQUEST_ID_HEADER),
    ip: request?.headers.get(FORWARDED_IP_HEADER),
    // Gönderildiyse kod yok; gönderilmediyse nedeni teknik kod olarak (`changes.reason`).
    changes: outcome === 'sent' ? null : { reason: outcome },
  })
  return outcome
}

/** Better Auth `onPasswordReset`: parola yeni değerle kaydedildi, oturumlar kapatıldı. */
export async function recordPasswordResetCompleted(
  ctx: Pick<PasswordResetContext, 'db' | 'secret'>,
  userId: string,
  request: Request | undefined,
): Promise<void> {
  const institution = await defaultInstitution(ctx.db, userId)
  await recordAudit(ctx, {
    action: 'auth.password_reset_completed',
    actorUserId: userId,
    institutionId: institution?.id ?? null,
    requestId: request?.headers.get(FORWARDED_REQUEST_ID_HEADER),
    ip: request?.headers.get(FORWARDED_IP_HEADER),
  })
}
