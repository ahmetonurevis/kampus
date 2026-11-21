// Hesap güvenliği (IST-003): parola sıfırlama, parola değişimi ve oturum listesi için ortak
// doğrulama, oturum satırı ayrıştırması ve Better Auth hatalarının Türkçe mesajı. Web ve mobil
// aynı kuralı kullanır; parola uzunluğu API'deki Better Auth ayarıyla aynıdır (`apps/api/src/auth.ts`).
import { z } from 'zod'

import { ApiError } from '@kampus/api-client/errors.ts'

import { REAUTHENTICATION_CODE } from './reauthentication.ts'
import type { AuthClientError } from './sign-in-errors.ts'

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

export const ACCOUNT_SECURITY_MESSAGES = {
  /** Sıfırlama isteğinden sonra her durumda aynı bilgi (hesabın varlığı belli edilmez). */
  resetRequested:
    'Bu e-posta adresiyle kayıtlı bir hesap varsa parola sıfırlama bağlantısı gönderildi. Bağlantı 30 dakika geçerlidir.',
  resetDone: 'Parolanız değiştirildi. Yeni parolanızla giriş yapın.',
  passwordChanged: 'Parolanız değiştirildi.',
  passwordChangedOthersSignedOut: 'Parolanız değiştirildi; diğer cihazlardaki oturumlar kapatıldı.',
  sessionRevoked: 'Oturum kapatıldı.',
  otherSessionsRevoked: 'Diğer cihazlardaki oturumlar kapatıldı.',
  invalidToken: 'Bağlantının süresi dolmuş veya geçersiz. Yeni bir bağlantı isteyin.',
  missingToken: 'Bağlantı eksik. E-postadaki bağlantıyı yeniden açın ya da yeni bağlantı isteyin.',
  wrongPassword: 'Mevcut parola hatalı.',
  weakPassword:
    'Bu parola çok yaygın veya kişisel bilgilerinize fazla benziyor. Başka bir parola seçin.',
  rateLimited: 'Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.',
  network: 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.',
  reauth: 'Bu işlem için parolanızı yeniden doğrulayın.',
  unavailable: 'İşlem şu an yapılamıyor. Lütfen tekrar deneyin.',
} as const

const emailField = z
  .string()
  .trim()
  .min(1, 'E-posta adresinizi girin.')
  .pipe(z.email('Geçerli bir e-posta adresi girin.'))

const newPasswordField = z
  .string()
  .min(1, 'Yeni parolayı girin.')
  .min(PASSWORD_MIN_LENGTH, `Parola en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`)
  .max(PASSWORD_MAX_LENGTH, `Parola en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.`)

const MISMATCH = 'Parolalar eşleşmiyor.'

export const forgotPasswordSchema = z.object({ email: emailField })
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({ newPassword: newPasswordField, confirmPassword: z.string() })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: MISMATCH,
  })
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Mevcut parolanızı girin.'),
    newPassword: newPasswordField,
    confirmPassword: z.string(),
    revokeOtherSessions: z.boolean(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: MISMATCH,
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'Yeni parola mevcut paroladan farklı olmalı.',
  })
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

/** Better Auth istemcisi tarihleri `Date`'e çevirebilir; ISO dizgisine döndürülür. */
const isoDate = z
  .union([z.string(), z.date()])
  .transform((value) => (typeof value === 'string' ? value : value.toISOString()))

/**
 * API'nin daralttığı `/list-sessions` satırı (`apps/api/src/lib/session-device.ts`): IP, ham
 * kullanıcı ajanı ve oturum belirteci yoktur, yalnız kaba cihaz özeti (IST-025). Tek oturum `id`
 * ile kapatılır.
 */
export const sessionListItemSchema = z.object({
  id: z.string().min(1),
  createdAt: isoDate,
  updatedAt: isoDate,
  expiresAt: isoDate,
  device: z.string().nullable(),
  current: z.boolean(),
})
export type SessionListItem = z.infer<typeof sessionListItemSchema>

/** Beklenmeyen biçimdeki satır listeden düşer (istemci eski API'ye bağlıysa sayfa kırılmaz). */
export function parseSessionList(data: unknown): SessionListItem[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((item) => {
    const parsed = sessionListItemSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

export const UNKNOWN_DEVICE = 'Bilinmeyen cihaz'

export function sessionDeviceLabel(item: Pick<SessionListItem, 'device'>): string {
  return item.device ?? UNKNOWN_DEVICE
}

/** İşlem türü: aynı hata kodu bağlama göre farklı alana/mesaja düşer. */
export type AccountSecurityAction = 'request-reset' | 'reset' | 'change' | 'sessions'

/** Hatanın gösterileceği alan (`field`) ya da form üstü/toast mesajı. */
export interface AccountSecurityFailure {
  message: string
  field?: 'currentPassword' | 'newPassword'
}

const PASSWORD_LENGTH_CODES: ReadonlySet<string> = new Set([
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
])

/**
 * Better Auth hata nesnesinden kullanıcı mesajı. Sunucu metni gösterilmez (kod ve durumdan
 * üretilir); sıfırlama isteğinde hiçbir hata hesabın varlığını belli etmez.
 */
export function accountSecurityFailure(
  action: AccountSecurityAction,
  error: AuthClientError,
): AccountSecurityFailure {
  if (error.status === 0) return { message: ACCOUNT_SECURITY_MESSAGES.network }
  if (error.status === 429) return { message: ACCOUNT_SECURITY_MESSAGES.rateLimited }
  if (error.code === 'SESSION_NOT_FRESH') return { message: ACCOUNT_SECURITY_MESSAGES.reauth }
  if (action === 'reset' && (error.code === 'INVALID_TOKEN' || error.code === 'USER_NOT_FOUND'))
    return { message: ACCOUNT_SECURITY_MESSAGES.invalidToken }
  if (action === 'change' && error.code === 'INVALID_PASSWORD')
    return { field: 'currentPassword', message: ACCOUNT_SECURITY_MESSAGES.wrongPassword }
  if (error.code === 'PASSWORD_TOO_COMMON')
    return { field: 'newPassword', message: ACCOUNT_SECURITY_MESSAGES.weakPassword }
  if (error.code && PASSWORD_LENGTH_CODES.has(error.code))
    return {
      field: 'newPassword',
      message: `Parola ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} karakter olmalı.`,
    }
  return { message: ACCOUNT_SECURITY_MESSAGES.unavailable }
}

/**
 * Better Auth hatasını `ApiError`'a çevirir; eski oturum (`SESSION_NOT_FRESH`) ortak taze oturum
 * koduna (`reauthentication_required`) dönüşür, böylece web'in parola penceresi akışı işler.
 */
export function accountSecurityError(
  action: AccountSecurityAction,
  error: AuthClientError,
): ApiError {
  return new ApiError({
    status: error.status,
    code:
      error.code === 'SESSION_NOT_FRESH'
        ? REAUTHENTICATION_CODE
        : (error.code ?? `auth_${action.replace('-', '_')}_failed`),
    message: accountSecurityFailure(action, error).message,
  })
}
