import type { Config } from '../config.ts'

// E-posta gönderim arabirimi (IST-003). Gerçek sağlayıcı ayrı karardır (OG-095); o gelene kadar
// geliştirme bağlantıyı loga, test bellek içi kutuya yazar, üretim hiçbir şey göndermez.

/** Yapılandırılmış log; Fastify/pino logger'ı buna uyar. E-posta adresi loga yazılmaz. */
export interface MailLog {
  info(object: object, message: string): void
  warn(object: object, message: string): void
  error(object: object, message: string): void
}

export const SILENT_MAIL_LOG: MailLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

export interface PasswordResetMail {
  to: string
  /** Web'in `/parola-sifirla?token=…` sayfası; belirteç içerir. */
  url: string
  /** Kullanıcının varsayılan kurumu (en eski üyelik); şablonda gönderen adı olarak geçer. */
  institutionName: string
}

export interface Mailer {
  /** Sağlayıcı bağlı mı; `false` ise gönderim yapılmaz (üretimde sağlayıcı yokken). */
  readonly configured: boolean
  sendPasswordReset(mail: PasswordResetMail): Promise<void>
}

/** Bağlantıdaki belirteç loga yazılmadan önce gizlenir (`deliverPasswordReset`). */
export function maskResetUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has('token')) parsed.searchParams.set('token', '[gizli]')
    return parsed.toString().replace('%5Bgizli%5D', '[gizli]')
  } catch {
    return '[gizli]'
  }
}

/** Geliştirme: bağlantı (belirteç dahil) loga yazılır; yerel geliştirici sıfırlamayı loga bakarak dener. */
export function createLogMailer(log: MailLog): Mailer {
  return {
    configured: true,
    sendPasswordReset({ url, institutionName }) {
      log.info(
        { event: 'mail.password_reset_dev_link', url, institutionName },
        'Parola sıfırlama bağlantısı (geliştirme; e-posta gönderilmedi)',
      )
      return Promise.resolve()
    },
  }
}

/** Test: iletiler bellek içi kutuda toplanır (kutu testten okunur). */
export class MemoryMailer implements Mailer {
  readonly configured = true
  readonly outbox: PasswordResetMail[] = []

  sendPasswordReset(mail: PasswordResetMail): Promise<void> {
    this.outbox.push(mail)
    return Promise.resolve()
  }

  /** Belirli bir adrese giden son ileti. */
  lastTo(email: string): PasswordResetMail | undefined {
    return this.outbox.findLast((mail) => mail.to === email)
  }
}

/** Üretimde sağlayıcı yapılandırılmamışsa: gönderim yapılmaz, uyarı loglanır. */
export function createUnconfiguredMailer(log: MailLog): Mailer {
  return {
    configured: false,
    sendPasswordReset() {
      log.warn(
        { event: 'mail.password_reset_not_sent', code: 'mail_provider_not_configured' },
        'E-posta sağlayıcısı yapılandırılmadığı için parola sıfırlama iletisi gönderilmedi',
      )
      return Promise.resolve()
    },
  }
}

/** Ortamın varsayılan gönderici. TODO(OG-095): sağlayıcı ortam değişkenleri ve gerçek gönderim. */
export function createMailer(config: Config, log: MailLog): Mailer {
  switch (config.NODE_ENV) {
    case 'development':
      return createLogMailer(log)
    case 'test':
      return new MemoryMailer()
    case 'production':
      return createUnconfiguredMailer(log)
  }
}
