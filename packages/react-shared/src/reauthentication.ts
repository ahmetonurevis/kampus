import { isApiError } from '@kampus/api-client/errors.ts'

/**
 * Sunucu "oturum eski" dediğinde (hassas işlem, 403) ekran parola penceresini açar
 * (guvenlik-kvkk.md §3; API tarafı `requireFreshSession`).
 */
export const REAUTHENTICATION_CODE = 'reauthentication_required'

/** Hata, hassas işlem için yeniden giriş istiyor mu (`ApiError`, 403 + `reauthentication_required`)? */
export function isReauthenticationRequired(error: unknown): boolean {
  return isApiError(error) && error.code === REAUTHENTICATION_CODE
}
