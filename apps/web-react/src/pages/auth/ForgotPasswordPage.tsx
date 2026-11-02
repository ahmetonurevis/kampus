import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  ACCOUNT_SECURITY_MESSAGES,
  forgotPasswordSchema,
  type ForgotPasswordInput,
} from '@kampus/react-shared/account-security.ts'
import { useRequestPasswordReset } from '@kampus/react-shared/use-account-security.ts'
import { FormField } from '@/components/FormField.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { authClient } from '@/lib/kampus-clients.ts'
import { notify } from '@/lib/notify.ts'
import { AuthCard } from './AuthCard.tsx'

const fieldClass = 'h-[46px] rounded-field px-3.5 text-base md:text-base'

/**
 * "Parolamı unuttum" (IST-003): e-posta alır, sonuç her durumda aynı bilgi mesajıdır; hesabın
 * var olup olmadığı belli edilmez. Yalnız ağ ve hız sınırı hataları ayrıca bildirilir.
 */
export function ForgotPasswordPage() {
  useDocumentTitle('Parolamı unuttum')
  const request = useRequestPasswordReset(authClient)
  const [sent, setSent] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })

  const onSubmit = handleSubmit(async ({ email }) => {
    try {
      await request.mutateAsync(email)
      setSent(true)
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : ACCOUNT_SECURITY_MESSAGES.unavailable,
        error,
      )
    }
  })

  return (
    <AuthCard
      title="Parolamı unuttum"
      description="Hesabınızın e-posta adresini girin; parola sıfırlama bağlantısı gönderelim."
    >
      {sent ? (
        <div role="status" className="rounded-2xl border bg-surface px-4 py-3 text-sm">
          {ACCOUNT_SECURITY_MESSAGES.resetRequested}
        </div>
      ) : (
        <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
          <FormField id="unuttum-eposta" label="E-posta" error={errors.email}>
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
          <Button
            type="submit"
            disabled={isSubmitting}
            className="min-h-[47px] rounded-lg bg-brand px-5 text-base text-on-brand hover:bg-brand-hover"
          >
            {isSubmitting ? 'Gönderiliyor…' : 'Sıfırlama bağlantısı gönder'}
          </Button>
        </form>
      )}
    </AuthCard>
  )
}
