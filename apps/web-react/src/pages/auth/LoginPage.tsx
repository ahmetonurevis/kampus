import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loginSchema, type LoginInput } from '@/auth/auth-port.ts'
import { DEV_ACCOUNTS, DEV_PASSWORD } from '@/auth/dev-auth.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { isRoleKey, pageHref } from '@/lib/navigation.ts'
import { notify } from '@/lib/notify.ts'
import { LoginStory } from './LoginStory.tsx'

const YEAR = new Date().getFullYear()
const fieldClass = 'h-[46px] rounded-field px-3.5 text-base md:text-base'

function returnPath(state: unknown, role: string): string {
  const from =
    state && typeof state === 'object' && 'from' in state && typeof state.from === 'string'
      ? state.from
      : ''
  // Yalnız aynı rolün kabuğuna geri dönülür; başka rolün adresi kendi dashboard'una gider.
  return from.startsWith(`/${role}/`) ? from : `/${role}/dashboard`
}

export function LoginPage() {
  const { session, signIn } = useAuth()
  useDocumentTitle('Giriş')
  const navigate = useNavigate()
  const location = useLocation()
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  if (session) return <Navigate to={pageHref(session.role, { path: 'dashboard' })} replace />

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await signIn(values)
      if (!result.ok) {
        setError('password', { message: result.message })
        return
      }
      if (isRoleKey(result.session.role))
        await navigate(returnPath(location.state, result.session.role), { replace: true })
    } catch (error) {
      notify.error('Giriş şu an yapılamıyor. Lütfen tekrar deneyin.', error)
    }
  })

  function signInWithDevAccount(email: string) {
    setValue('email', email)
    setValue('password', DEV_PASSWORD)
    void onSubmit()
  }

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

          {import.meta.env.DEV ? (
            <section
              aria-labelledby="gelistirme-hesaplari"
              className="flex flex-col gap-3 border-t pt-5"
            >
              <h2 id="gelistirme-hesaplari" className="text-sm font-semibold">
                Geliştirme hesapları
              </h2>
              <p className="text-xs text-muted-foreground">
                Yalnız geliştirme sunucusunda görünür; API bağlanınca kaldırılır.
              </p>
              <div className="flex flex-wrap gap-2">
                {DEV_ACCOUNTS.map((account) => (
                  <Button
                    key={account.role}
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isSubmitting}
                    data-dev-role={account.role}
                    onClick={() => signInWithDevAccount(account.email)}
                  >
                    <Icon name={account.icon} size={16} />
                    {account.label}
                  </Button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <p className="text-2xs text-muted-foreground">© {YEAR} Kampüs. Öğrenmenin her adımında.</p>
      </main>
    </div>
  )
}
