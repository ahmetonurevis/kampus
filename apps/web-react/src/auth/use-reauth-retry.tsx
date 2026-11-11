import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { runWithReauth, type ReauthRun } from '@/auth/reauth-retry.ts'

interface Prompt {
  promise: Promise<boolean>
  settle: (confirmed: boolean) => void
}

/**
 * Hassas işlemin taze oturum akışı: `run(action)` işlemi çalıştırır; 403 `reauthentication_required`
 * gelirse parola penceresini açar, doğrulanınca işlemi bir kez tekrarlar, vazgeçilirse sessizce
 * `{ status: 'cancelled' }` döner. `reauthModal` bileşenin çıktısında bir kez yer almalıdır.
 *
 * ```tsx
 * const { run, reauthModal } = useReauthRetry()
 * const outcome = await run(() => withdraw.submit(input, fields))
 * if (outcome.status === 'done' && outcome.result.status === 'success') onClose()
 * return <>{…}{reauthModal}</>
 * ```
 */
export function useReauthRetry() {
  const [open, setOpen] = useState(false)
  const prompt = useRef<Prompt | null>(null)

  const askPassword = useCallback(() => {
    // Eşzamanlı iki işlem tek pencereyi paylaşır; ikisi de doğrulamadan sonra tekrarlanır.
    if (prompt.current) return prompt.current.promise
    let settle: (confirmed: boolean) => void = () => undefined
    const promise = new Promise<boolean>((resolve) => {
      settle = resolve
    })
    prompt.current = { promise, settle }
    setOpen(true)
    return promise
  }, [])

  const close = useCallback((confirmed: boolean) => {
    const current = prompt.current
    prompt.current = null
    setOpen(false)
    current?.settle(confirmed)
  }, [])

  // Bileşen kapanırken bekleyen işlem vazgeçilmiş sayılır; asılı kalmaz.
  useEffect(() => () => close(false), [close])

  const run = useCallback(
    <T,>(action: () => Promise<T>): Promise<ReauthRun<T>> => runWithReauth(action, askPassword),
    [askPassword],
  )

  const reauthModal: ReactNode = open ? (
    <ReauthModal onDone={() => close(true)} onCancel={() => close(false)} />
  ) : null

  return { run, reauthModal }
}
