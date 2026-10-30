import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Navigate, useSearchParams } from 'react-router'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loginSchema, type LoginInput } from '@/auth/auth-port.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { notify } from '@/lib/notify.ts'
import { RETURN_PARAM, returnPathFor } from '@/lib/return-path.ts'
import { SessionPending } from '@/pages/shell/SessionPending.tsx'
import { LoginStory } from './LoginStory.tsx'

const YEAR = new Date().getFullYear()
const fieldClass = 'h-[46px] rounded-field px-3.5 text-base md:text-base'

const STATUS_MESSAGES = {
  'no-membership':
    'Hesabınız etkin bir kuruma bağlı değil. Kurum yöneticinizle iletişime geçin veya başka bir hesapla giriş yapın.',
  error: 'Oturum bilgileri alınamadı. Lütfen tekrar deneyin.',
} as const

export function LoginPage() {
  const { status, session, signIn, retry } = useAuth()
  useDocumentTitle('Giriş')
  const [searchParams] = useSearchParams()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  // Giriş başarılı olunca yönlendirme oturum durumundan çıkar (yeni rol `/me`'den gelir).
  if (session)
    return <Navigate to={returnPathFor(searchParams.get(RETURN_PARAM), session.role)} replace />
  if (status === 'loading' && !isSubmitting) return <SessionPending />

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await signIn(values)
      if (result.ok) return
      // Alan hatası parolanın altında; hız sınırı ve hizmet hataları toast'ta.
      if (result.field) setError(result.field, { message: result.message })
      else notify.error(result.message)
    } catch (error) {
      notify.error('Giriş şu an yapılamıyor. Lütfen tekrar deneyin.', error)
    }
  })

  const statusMessage =
    status === 'no-membership' || status === 'error' ? STATUS_MESSAGES[status] : null

  return (
    <div className="login-page grid min-h-dvh grid-cols-2 bg-background max-[900px]:grid-cols-1">
      <LoginStory />

      <main
        id="main"
        className="flex flex-col items-center justify-center gap-10 p-10 max-[650px]:p-5"
      >
        <div className="flex w-full max-w-[430px] flex-col gap-7">
          <div className="flex flex-col gap-3">
            <h1 className="text-[28px] font-semibold tracking-[-0.8px]">Kampüs’e hoş geldiniz.</h1>
            <p className="text-base text-muted-foreground">
              Kurum hesabınızla giriş yapın. Rolünüze uygun panel otomatik açılır.
            </p>
          </div>
          {statusMessage ? (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-2xl border bg-surface px-4 py-3 text-sm"
            >
              <p>{statusMessage}</p>
              {status === 'error' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={() => void retry()}
                >
                  Tekrar dene
                </Button>
              ) : null}
            </div>
          ) : null}
          <form
            noValidate
            onSubmit={(event) => void onSubmit(event)}
            className="flex flex-col gap-5"
          >
            <FormField id="giris-eposta" label="E-posta" error={errors.email}>
              {(control) => (
                <Input
                  {...control}
                  {...register('email')}
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  className={fieldClass}
                />
              )}
            </FormField>
            <FormField id="giris-parola" label="Parola" error={errors.password}>
              {(control) => (
                <Input
                  {...control}
                  {...register('password')}
                  type="password"
                  autoComplete="current-password"
                  className={fieldClass}
                />
              )}
            </FormField>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="min-h-[47px] justify-between rounded-lg bg-brand px-5 text-base text-on-brand hover:bg-brand-hover"
            >
              {isSubmitting ? 'Giriş yapılıyor…' : 'Giriş yap'}
              <Icon name="ArrowRight" size={18} />
            </Button>
          </form>
        </div>
        <p className="text-2xs text-muted-foreground">© {YEAR} Kampüs. Öğrenmenin her adımında.</p>
      </main>
    </div>
  )
}
