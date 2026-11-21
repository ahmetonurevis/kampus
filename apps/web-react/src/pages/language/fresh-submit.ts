// Sürümlü yazma işlemlerinde kayıt, gönderim anında kimlikle yeniden okunur (IST-076, IST-077):
// ekrandaki kopya (liste durumu, açılışta okunan kayıt) bayat olabilir; bayat `If-Match` ya
// başkasının değişikliğini ezer ya da gereksiz 409 üretir.
import { isApiError } from '@kampus/api-client/errors.ts'

const isConflict = (error: unknown) =>
  isApiError(error) && error.status === 409 && error.code === 'version_conflict'

type Outcome = { status: 'success' | 'failed' | 'busy'; error?: unknown }

export type FreshSubmit<TOutcome extends Outcome> =
  /** Kayıt okunamadı ya da artık uygun değil: istek atılmadı. */
  { status: 'missing' } | { status: 'sent'; outcome: TOutcome; conflicted: boolean }

/**
 * Önce `load` ile güncel kaydı çeker, sonra `send` ile o kaydın sürümüyle yazar. `load` `undefined`
 * dönerse (okunamadı, kapanmış, listeden düştü) istek atılmaz. `conflicted`, sunucunun bu
 * gönderimde 409 `version_conflict` verdiğini söyler; form bunu `ConflictNotice` ile gösterir.
 */
export async function submitWithFreshRecord<TLoaded, TOutcome extends Outcome>(
  load: () => Promise<TLoaded | undefined>,
  send: (loaded: TLoaded) => Promise<TOutcome>,
): Promise<FreshSubmit<TOutcome>> {
  const loaded = await load()
  if (loaded === undefined) return { status: 'missing' }
  const outcome = await send(loaded)
  return {
    status: 'sent',
    outcome,
    conflicted: outcome.status === 'failed' && isConflict(outcome.error),
  }
}

/** Kayıt okunamadığında gösterilen metin. */
export const RECORD_UNAVAILABLE_MESSAGE =
  'Kayıt okunamadı ya da artık bu işleme uygun değil. Listeyi yenileyip yeniden deneyin.'
