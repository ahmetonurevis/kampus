import { and, asc, eq, gt } from 'drizzle-orm'

import type { Database } from '../db/client.ts'
import { institutions, memberships, verifications } from '../db/schema/auth.ts'
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
  'sent' | 'no_membership' | 'mail_not_configured' | 'web_url_missing' | 'send_failed'

/** Aynı hesaba saatte en çok 3 sıfırlama iletisi: IP değiştirerek posta kutusu doldurulamaz. */
export const RESET_PER_EMAIL_MAX = 3
export const RESET_PER_EMAIL_WINDOW_MS = 60 * 60 * 1000

export interface ResetLimiter {
  /** Gönderime izin verilirse sayar ve `true`, sınır dolduysa sayaç değişmeden `false` döner. */
  take(email: string, now?: number): boolean
}

/**
 * Bellek içi kayan pencere (v1 tek sunucu örneği; Better Auth `rateLimit` ile aynı varsayım,
 * guvenlik-kvkk.md §4). Better Auth'un sınırı yalnız IP başınadır; e-posta anahtarı burada.
 * Yalnız var olan hesaba ileti gitmeden önce çalıştığı için yanıttan hesap sızmaz.
 */
export function createResetLimiter(
  max = RESET_PER_EMAIL_MAX,
  windowMs = RESET_PER_EMAIL_WINDOW_MS,
): ResetLimiter {
  const hits = new Map<string, number[]>()
  return {
    take(email, now = Date.now()) {
      for (const [key, times] of hits) {
        const live = times.filter((time) => now - time < windowMs)
        if (live.length === 0) hits.delete(key)
        else hits.set(key, live)
      }
      const key = email.trim().toLowerCase()
      const times = hits.get(key) ?? []
      if (times.length >= max) return false
      hits.set(key, [...times, now])
      return true
    },
  }
}

export const RESET_PAGE_PATH = '/parola-sifirla'

export function resetPageUrl(webUrl: string, token: string): string {
  // Belirteç adres parçasındadır: tarayıcı parçayı sunucuya, Referer'e ve erişim loguna yazmaz.
  return `${webUrl}${RESET_PAGE_PATH}#token=${encodeURIComponent(token)}`
}

/** Aynı hesaba iki sıfırlama iletisi arasındaki en kısa süre: açık belirteç varken yenisi yazılmaz. */
export const RESET_COOLDOWN_MS = 5 * 60 * 1000

export type ResetThrottle = 'cooldown' | 'rate_limited'

/**
 * Better Auth sıfırlama uç işleyicisi çalışmadan (kanca `before`) sorulur ki reddedilen istek için
 * ne `verifications` satırı ne ileti oluşsun. Hesap zaten bulunmuş olduğundan yanıt aynı kalır.
 * Önce soğuma (son 5 dakikada açık belirteç var mı), sonra saatlik e-posta sınırı.
 */
export async function resetThrottleReason(
  ctx: { db: Database; limiter: ResetLimiter },
  user: { id: string; email: string },
  now: Date = new Date(),
): Promise<ResetThrottle | null> {
  const [recent] = await ctx.db
    .select({ id: verifications.id })
    .from(verifications)
    .where(
      and(
        eq(verifications.value, user.id),
        gt(verifications.createdAt, new Date(now.getTime() - RESET_COOLDOWN_MS)),
        gt(verifications.expiresAt, now),
      ),
    )
    .limit(1)
  if (recent) return 'cooldown'
  return ctx.limiter.take(user.email, now.getTime()) ? null : 'rate_limited'
}

/**
 * Kullanıcının bekleyen bütün sıfırlama belirteçlerini siler. Belirteç özetle saklandığından
 * tanımlayıcıdan aranamaz; bu yapılandırmada `verifications.value` yalnız sıfırlama belirtecinde
 * kullanıcı kimliğidir (e-posta doğrulama ve sihirli bağlantı kapalı). Parola değişince (sıfırlama
 * ya da `change-password`) çağrılır: eşzamanlı açık belirteç parolayı yeniden değiştiremesin.
 */
export async function revokeResetTokens(db: Database, userId: string): Promise<void> {
  await db.delete(verifications).where(eq(verifications.value, userId))
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
    // Talep oturumsuzdur: kimliği kanıtlanmamış kişinin işi hesap sahibine yazılmaz; hedef varlıktır.
    entityType: 'user',
    entityId: input.user.id,
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
  await revokeResetTokens(ctx.db, userId)
  const institution = await defaultInstitution(ctx.db, userId)
  await recordAudit(ctx, {
    action: 'auth.password_reset_completed',
    actorUserId: userId,
    institutionId: institution?.id ?? null,
    requestId: request?.headers.get(FORWARDED_REQUEST_ID_HEADER),
    ip: request?.headers.get(FORWARDED_IP_HEADER),
  })
}
