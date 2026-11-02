import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router'
import { isApiError } from '@kampus/api-client/errors.ts'
import {
  ACCOUNT_SECURITY_MESSAGES,
  accountSecurityFailure,
  resetPasswordSchema,
  type ResetPasswordInput,
} from '@kampus/react-shared/account-security.ts'
import { useResetPassword } from '@kampus/react-shared/use-account-security.ts'
import { FormField } from '@/components/FormField.tsx'
import { PasswordInput } from '@/components/PasswordInput.tsx'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { authClient } from '@/lib/kampus-clients.ts'
import { notify } from '@/lib/notify.ts'
import { AuthCard } from './AuthCard.tsx'

const fieldClass = 'h-[46px] rounded-field px-3.5 text-base md:text-base'

/** E-postadaki bağlantının açtığı sayfa (IST-003): yeni parola + tekrar; başarıda girişe döner. */
export function ResetPasswordPage() {
  useDocumentTitle('Parola sıfırla')
  const { hash } = useLocation()
  // Bağlantı `/parola-sifirla#token=…` biçimindedir: adres parçası sunucuya, Referer'e ve erişim
  // loguna gitmez. Belirteç bir kez okunur, sonra adres çubuğundan silinir: geçmişte ve ekran
  // paylaşımında görünmesin. Sayfa yenilenirse bağlantı e-postadan yeniden açılır.
  const [token] = useState(() => new URLSearchParams(hash.replace(/^#/, '')).get('token'))
  const [tokenInvalid, setTokenInvalid] = useState(false)
  const reset = useResetPassword(authClient)
  const navigate = useNavigate()
  const tokenInAddress = hash !== ''
  useEffect(() => {
    if (tokenInAddress) void navigate('/parola-sifirla', { replace: true })
  }, [tokenInAddress, navigate])
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  })

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    if (!token) return
    try {
      await reset.mutateAsync({ token, newPassword })
      notify.success(ACCOUNT_SECURITY_MESSAGES.resetDone)
      await navigate('/giris', { replace: true })
    } catch (error) {
      if (!isApiError(error)) {
        notify.error(ACCOUNT_SECURITY_MESSAGES.unavailable, error)
        return
      }
      const failure = accountSecurityFailure('reset', { status: error.status, code: error.code })
      if (failure.message === ACCOUNT_SECURITY_MESSAGES.invalidToken) setTokenInvalid(true)
      else if (failure.field === 'newPassword')
        setError('newPassword', { message: failure.message }, { shouldFocus: true })
      else notify.error(failure.message, error)
    }
  })

  const problem = !token
    ? ACCOUNT_SECURITY_MESSAGES.missingToken
    : tokenInvalid
      ? ACCOUNT_SECURITY_MESSAGES.invalidToken
      : null

  return (
    <AuthCard
      title="Yeni parola belirleyin"
      description="Parolanız değişince bütün cihazlardaki oturumlarınız kapanır."
    >
      {problem ? (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border bg-surface px-4 py-3">
          <p className="text-sm">{problem}</p>
          <Button asChild variant="secondary" size="sm" className="self-start">
            <Link to="/parolami-unuttum">Yeni bağlantı iste</Link>
          </Button>
        </div>
      ) : (
        <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
          <FormField
            id="sifirla-yeni-parola"
            label="Yeni parola"
            description="En az 12 karakter. Yaygın parolalar ve e-postanıza benzeyenler kabul edilmez."
            error={errors.newPassword}
          >
            {(control) => (
              <PasswordInput
                {...control}
                {...register('newPassword')}
                autoComplete="new-password"
                className={fieldClass}
              />
            )}
          </FormField>
          <FormField
            id="sifirla-parola-tekrar"
            label="Yeni parola (tekrar)"
            error={errors.confirmPassword}
          >
            {(control) => (
              <PasswordInput
                {...control}
                {...register('confirmPassword')}
                autoComplete="new-password"
                className={fieldClass}
              />
            )}
          </FormField>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="min-h-[47px] rounded-lg bg-brand px-5 text-base text-on-brand hover:bg-brand-hover"
          >
            {isSubmitting ? 'Kaydediliyor…' : 'Parolayı değiştir'}
          </Button>
        </form>
      )}
    </AuthCard>
  )
}
