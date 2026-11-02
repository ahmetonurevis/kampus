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
  /** Web'in `/parola-sifirla#token=…` sayfası; belirteç adres parçasındadır (sunucuya gitmez). */
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
    parsed.search = ''
    parsed.hash = parsed.hash ? 'token=[gizli]' : ''
    return parsed.toString()
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

/** Seçili gönderici: `MAIL_DRIVER`, verilmezse ortamın varsayılanı (üretimde `none`). */
export function mailDriver(config: Config): 'log' | 'memory' | 'none' {
  if (config.MAIL_DRIVER) return config.MAIL_DRIVER
  switch (config.NODE_ENV) {
    case 'development':
      return 'log'
    case 'test':
      return 'memory'
    case 'production':
      return 'none'
  }
}

/** TODO(OG-095): sağlayıcı sürücüsü (`smtp` vb.) ve gerçek gönderim. */
export function createMailer(config: Config, log: MailLog): Mailer {
  switch (mailDriver(config)) {
    case 'log':
      return createLogMailer(log)
    case 'memory':
      return new MemoryMailer()
    case 'none':
      return createUnconfiguredMailer(log)
  }
}
