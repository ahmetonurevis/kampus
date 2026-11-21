// Yalnız geliştirme: "Kolay giriş" satırına tıklanınca yapılan adımlar (giriş → `/me` → gerekirse
// kurum geçişi) ve her hata yolunun kullanıcı mesajı. React'ten ayrı tutulur; adımlar dışarıdan
// verilir, böylece hata yolları birim testinde sahte adımlarla sınanır. Yalnız `EasyLogin.tsx`
// içe aktarır; üretim derlemesine girmez.
import type { SignInResult } from '@kampus/react-shared/sign-in-errors.ts'
import {
  institutionToActivate,
  type EasyLoginAccount,
  type MeInstitutions,
} from './easy-login-accounts.ts'

export type EasyLoginSteps = {
  signIn: (input: { email: string; password: string }) => Promise<SignInResult>
  /** Girişten sonra oturumun etkin kurumu ve üyelikleri. */
  fetchMe: () => Promise<MeInstitutions>
  switchInstitution: (institutionId: string) => Promise<unknown>
}

/** Kullanıcıya gösterilecek hata; `cause` yalnız loga gider. Tam başarıda bildirim yoktur. */
export type EasyLoginNotice = { message: string; cause?: unknown }

export const EASY_LOGIN_MESSAGES = {
  signInFailed: 'Giriş şu an yapılamıyor. Lütfen tekrar deneyin.',
  meFailed: 'Giriş yapıldı ancak oturum bilgileri alınamadı. Lütfen sayfayı yenileyin.',
} as const

/** Seçilen kuruma geçilemediğinde oturumun hangi kurumda açık kaldığını söyleyen mesaj. */
export function stayedInInstitutionMessage(
  wanted: string,
  current: string | null,
  reason: 'switch-failed' | 'no-membership',
): string {
  const where = current ? `${current} kurumunda` : 'varsayılan kurumda'
  const head =
    reason === 'switch-failed'
      ? `${wanted} kurumuna geçilemedi`
      : `${wanted} kurumunda üyelik bulunamadı`
  return `${head}; ${where} oturum açıldı.`
}

/**
 * Hesapla giriş yapar; seçilen satırın kurumu oturumun etkin kurumu değilse o kuruma geçer.
 * Kurum geçişi başarısız olsa da oturum kapatılmaz (kullanıcı açık kalan kurumda devam eder).
 */
export async function runEasyLogin(
  account: EasyLoginAccount,
  password: string,
  steps: EasyLoginSteps,
): Promise<EasyLoginNotice | null> {
  let result: SignInResult
  try {
    result = await steps.signIn({ email: account.email, password })
  } catch (cause) {
    return { message: EASY_LOGIN_MESSAGES.signInFailed, cause }
  }
  if (!result.ok) return { message: result.message }

  let me: MeInstitutions
  try {
    me = await steps.fetchMe()
  } catch (cause) {
    return { message: EASY_LOGIN_MESSAGES.meFailed, cause }
  }

  const current = me.activeInstitution?.name ?? null
  const target = institutionToActivate(account, me)
  if (!target) {
    // Üyelik hiç yoksa giriş sayfası kendi uyarısını gösterir.
    if (current === null || current === account.institution) return null
    return { message: stayedInInstitutionMessage(account.institution, current, 'no-membership') }
  }
  try {
    await steps.switchInstitution(target)
  } catch (cause) {
    return {
      message: stayedInInstitutionMessage(account.institution, current, 'switch-failed'),
      cause,
    }
  }
  return null
}
