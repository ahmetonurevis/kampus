import { toast } from 'sonner'

// Kullanıcı bildirimleri tek yerden geçer: metin Türkçe, teknik ayrıntı yalnız loga yazılır.
export const notify = {
  success(message: string) {
    toast.success(message)
  },
  info(message: string) {
    toast.info(message)
  },
  /** Teknik neden kullanıcıya gösterilmez; yalnız konsola/log'a gider. */
  error(message: string, cause?: unknown) {
    if (cause !== undefined) console.error('[kampus]', message, cause)
    toast.error(message)
  },
}
