import { createElement, type ReactNode } from 'react'
import { toast } from 'sonner'

/**
 * Sonner toast'a rol vermez; tüm toast'lar kapsayıcıdaki `aria-live="polite"` ile okunur. Hata
 * mesajı ekran okuyucuya hemen iletilsin diye metin `role="alert"` ile, diğerleri `role="status"`
 * ile işaretlenir.
 */
export function toastMessage(kind: 'alert' | 'status', message: string): ReactNode {
  return createElement('span', { role: kind }, message)
}

// Kullanıcı bildirimleri tek yerden geçer: metin Türkçe, teknik ayrıntı yalnız loga yazılır.
export const notify = {
  success(message: string) {
    toast.success(toastMessage('status', message))
  },
  info(message: string) {
    toast.info(toastMessage('status', message))
  },
  /** Aynı `id` ile tekrarlanan uyarı tek toast olarak kalır (ör. yönlendirme korumaları). */
  warning(message: string, id?: string) {
    toast.warning(toastMessage('status', message), id ? { id } : undefined)
  },
  /** Teknik neden kullanıcıya gösterilmez; yalnız konsola/log'a gider. */
  error(message: string, cause?: unknown) {
    if (cause !== undefined) console.error('[kampus]', message, cause)
    toast.error(toastMessage('alert', message))
  },
}
