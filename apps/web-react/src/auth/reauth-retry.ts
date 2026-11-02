import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'

/** `done` işlem sonuçlandı (sonuç ya da ikinci denemenin sonucu); `cancelled` kullanıcı vazgeçti. */
export type ReauthRun<T> = { status: 'done'; result: T } | { status: 'cancelled' }

/**
 * Sonuç, taze oturum gerektiren bir hata mı: ya da `useApiCommand().submit` sonucu
 * (`{ status: 'failed', error }`) ya da doğrudan `ApiError`.
 */
function needsReauth(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false
  if (isReauthenticationRequired(result)) return true
  const outcome = result as { status?: unknown; error?: unknown }
  return outcome.status === 'failed' && isReauthenticationRequired(outcome.error)
}

/**
 * İşlemi çalıştırır; sunucu 403 `reauthentication_required` derse `askPassword` ile parola
 * penceresini açtırır, doğrulanırsa işlemi bir kez tekrarlar. Vazgeçilirse sessizce `cancelled`
 * döner. Tekrarın sonucu (yine eski oturum dahil) olduğu gibi döner: döngü yoktur. Diğer
 * hatalar (fırlatılan ya da `failed` sonuç) çağırana aittir.
 */
export async function runWithReauth<T>(
  action: () => Promise<T>,
  askPassword: () => Promise<boolean>,
): Promise<ReauthRun<T>> {
  let first: { value: T } | null
  try {
    const value = await action()
    first = needsReauth(value) ? null : { value }
  } catch (error) {
    if (!isReauthenticationRequired(error)) throw error
    first = null
  }
  if (first) return { status: 'done', result: first.value }
  if (!(await askPassword())) return { status: 'cancelled' }
  return { status: 'done', result: await action() }
}
