import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { isApiError } from '@kampus/api-client/errors.ts'
import {
  ACCOUNT_SECURITY_MESSAGES,
  changePasswordSchema,
  sessionDeviceLabel,
  type ChangePasswordInput,
  type SessionListItem,
} from '@kampus/react-shared/account-security.ts'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import {
  useChangePassword,
  useRevokeOtherSessions,
  useRevokeSession,
  useSessionList,
} from '@kampus/react-shared/use-account-security.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { PasswordInput } from '@/components/PasswordInput.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { authClient, refreshAuthSession } from '@/lib/kampus-clients.ts'
import { SECURITY_DESCRIPTION, SECURITY_TITLE } from '@/lib/account-pages.ts'
import { notify } from '@/lib/notify.ts'

const DATE_TIME = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : DATE_TIME.format(date)
}

function errorMessage(error: unknown): string {
  return isApiError(error) ? error.message : ACCOUNT_SECURITY_MESSAGES.unavailable
}

/** Hesap menüsündeki "Güvenlik" sayfası (IST-003): parola değişimi ve açık oturumlar. */
export function SecurityPage() {
  useDocumentTitle(SECURITY_TITLE)
  return (
    <>
      <PageHeading title={SECURITY_TITLE} description={SECURITY_DESCRIPTION} />
      <div className="grid gap-6">
        <ChangePasswordSection />
        <SessionsSection />
      </div>
    </>
  )
}

function ChangePasswordSection() {
  const change = useChangePassword(authClient)
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
      revokeOtherSessions: true,
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    try {
      await change.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: values.revokeOtherSessions,
      })
    } catch (error) {
      const field =
        isApiError(error) && error.code === 'INVALID_PASSWORD'
          ? 'currentPassword'
          : isApiError(error) &&
              ['PASSWORD_TOO_COMMON', 'PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG'].includes(
                error.code,
              )
            ? 'newPassword'
            : null
      if (field) setError(field, { message: errorMessage(error) }, { shouldFocus: true })
      else notify.error(errorMessage(error), error)
      return
    }
    // "Diğer cihazlardan çık" bu cihaza yeni oturum çerezi verir; istemci durumu tazelenir.
    if (values.revokeOtherSessions) await refreshAuthSession().catch(() => undefined)
    reset()
    notify.success(
      values.revokeOtherSessions
        ? ACCOUNT_SECURITY_MESSAGES.passwordChangedOthersSignedOut
        : ACCOUNT_SECURITY_MESSAGES.passwordChanged,
    )
  })

  return (
    <section aria-labelledby="parola-baslik" className="panel rounded-card border bg-surface p-6">
      <h2 id="parola-baslik" className="text-lg font-semibold">
        Parolayı değiştir
      </h2>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">
        Yeni parola en az 12 karakter olmalı; yaygın parolalar ve e-postanıza ya da kurum adına
        benzeyenler kabul edilmez.
      </p>
      <form
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid max-w-[460px] gap-5"
      >
        <FormField id="guvenlik-mevcut-parola" label="Mevcut parola" error={errors.currentPassword}>
          {(control) => (
            <PasswordInput
              {...control}
              {...register('currentPassword')}
              autoComplete="current-password"
            />
          )}
        </FormField>
        <FormField id="guvenlik-yeni-parola" label="Yeni parola" error={errors.newPassword}>
          {(control) => (
            <PasswordInput {...control} {...register('newPassword')} autoComplete="new-password" />
          )}
        </FormField>
        <FormField
          id="guvenlik-parola-tekrar"
          label="Yeni parola (tekrar)"
          error={errors.confirmPassword}
        >
          {(control) => (
            <PasswordInput
              {...control}
              {...register('confirmPassword')}
              autoComplete="new-password"
            />
          )}
        </FormField>
        <Controller
          control={control}
          name="revokeOtherSessions"
          render={({ field }) => (
            <div className="flex min-h-6 items-center gap-3">
              <Checkbox
                id="guvenlik-diger-cihazlar"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                ref={field.ref}
              />
              <Label htmlFor="guvenlik-diger-cihazlar" className="text-sm font-normal">
                Diğer cihazlardan çıkış yap
              </Label>
            </div>
          )}
        />
        <Button type="submit" disabled={isSubmitting} className="justify-self-start">
          {isSubmitting ? 'Kaydediliyor…' : 'Parolayı değiştir'}
        </Button>
      </form>
    </section>
  )
}

function SessionsSection() {
  const sessions = useSessionList(authClient)
  const revoke = useRevokeSession(authClient)
  const revokeOthers = useRevokeOtherSessions(authClient)
  const { run, reauthModal } = useReauthRetry()
  const [confirmOthers, setConfirmOthers] = useState(false)
  const list = sessions.data ?? []
  const others = list.filter((item) => !item.current)
  const needsReauth = isReauthenticationRequired(sessions.error)

  async function verifyAndReload() {
    // Parola doğrulanınca yeni (taze) oturum açılır ve liste yeniden istenir.
    await run(async () => {
      const result = await sessions.refetch()
      if (result.error) throw result.error
      return result.data
    })
  }

  function revokeOne(item: SessionListItem) {
    revoke
      .mutateAsync(item.token)
      .then(() => notify.success(ACCOUNT_SECURITY_MESSAGES.sessionRevoked))
      .catch((error: unknown) => notify.error(errorMessage(error), error))
  }

  function revokeAllOthers() {
    revokeOthers
      .mutateAsync()
      .then(() => {
        setConfirmOthers(false)
        notify.success(ACCOUNT_SECURITY_MESSAGES.otherSessionsRevoked)
      })
      .catch((error: unknown) => notify.error(errorMessage(error), error))
  }

  return (
    <section aria-labelledby="oturum-baslik" className="panel rounded-card border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="oturum-baslik" className="text-lg font-semibold">
            Açık oturumlar
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Hesabınızın açık olduğu cihazlar. Tanımadığınız bir oturumu sonlandırın ve parolanızı
            değiştirin.
          </p>
        </div>
        {others.length > 0 ? (
          <Button variant="secondary" onClick={() => setConfirmOthers(true)}>
            Diğer cihazlardan çık
          </Button>
        ) : null}
      </div>

      <div className="mt-5">
        {sessions.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Oturumlar yükleniyor…
          </p>
        ) : needsReauth ? (
          <div role="alert" className="flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm">
            <p>Oturum listesini görmek için parolanızı yeniden doğrulayın.</p>
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => void verifyAndReload()}
            >
              Parolayı doğrula
            </Button>
          </div>
        ) : sessions.error ? (
          <div role="alert" className="flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm">
            <p>{errorMessage(sessions.error)}</p>
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => void sessions.refetch()}
            >
              Yeniden dene
            </Button>
          </div>
        ) : (
          <ul aria-label="Açık oturumlar" className="divide-y rounded-2xl border">
            {list.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Icon name="Smartphone" size={20} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {sessionDeviceLabel(item)}
                      {item.current ? <StatusBadge text="Bu cihaz" tone="purple" /> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Son etkinlik {formatDateTime(item.updatedAt)} · Açılış{' '}
                      {formatDateTime(item.createdAt)}
                    </p>
                  </div>
                </div>
                {item.current ? null : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={revoke.isPending}
                    aria-label={`Oturumu sonlandır: ${sessionDeviceLabel(item)}, son etkinlik ${formatDateTime(item.updatedAt)}`}
                    onClick={() => revokeOne(item)}
                  >
                    Sonlandır
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title="Diğer cihazlardan çıkılsın mı?"
        description="Bu cihaz dışındaki bütün oturumlar kapanır; o cihazlarda yeniden giriş gerekir."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmOthers(false)}
              disabled={revokeOthers.isPending}
            >
              Vazgeç
            </Button>
            <Button onClick={revokeAllOthers} disabled={revokeOthers.isPending}>
              Diğer cihazlardan çık
            </Button>
          </>
        }
      >
        <p className="text-sm">Açık oturum sayısı: {others.length}</p>
      </Modal>
      {reauthModal}
    </section>
  )
}
