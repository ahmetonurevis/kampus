import { useState } from 'react'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const FORM_ID = 'yeniden-giris-formu'

/**
 * Hassas işlemde eski oturum (403 `reauthentication_required`, guvenlik-kvkk.md): parola yeniden
 * sorulur, yeni oturum açılır ve çağıran işlemi tekrarlar. Parola saklanmaz, durumda kalmaz.
 */
export function ReauthModal({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { session, signIn } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const email = session?.user.email
    if (!email || password === '') {
      setError('Parolanızı girin.')
      return
    }
    setBusy(true)
    try {
      const result = await signIn({ email, password })
      if (result.ok) onDone()
      else setError(result.message)
    } catch {
      setError('Giriş şu an yapılamıyor. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onCancel())}
      title="Parolanızı doğrulayın"
      description="Bu hassas işlem için oturumunuzun yeni açılmış olması gerekiyor."
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={FORM_ID} disabled={busy} aria-busy={busy || undefined}>
            Doğrula ve devam et
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <FormField
          id="yeniden-giris-parola"
          label="Parola"
          error={error ? { message: error } : undefined}
        >
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </FormField>
      </form>
    </Modal>
  )
}
