// Yazma komutlarının hata görünümü (öğrenci soru ve randevu formları; IST-124). Komut kancası
// (`useApiCommand`) hatayı alan maddelerine ve tek mesaja ayırır; telefon toast yerine formun içinde
// gösterir (`silent`). Saf işlevlerdir: hata girer, ekranın göstereceği metin çıkar.
//
// - 409 ve 422 sunucunun Türkçe mesajıyla (ya da komuta özgü sözlükle) gösterilir.
// - Alan maddesi (`issues`) varsa mesaj alanın altındadır; alan maddesi yoksa tek genel mesajdır.
// - Ağ hatası ve 5xx belirsizdir: istek işlenmiş olabilir, bu yüzden "Yeniden dene" sunulur ve komut
//   kancası aynı gövdede aynı `Idempotency-Key`'i yeniden kullanır (mükerrer kayıt oluşmaz).
import type { ApiError } from '@kampus/api-client/errors.ts'
import { ROOT_FIELD } from '@kampus/api-client/errors.ts'
import { commandFeedback, type CommandMessages } from '@kampus/react-shared/commands.ts'

/** Sunucu alan hatalarını toplar; `useApiCommand` `submit(…, { setError })` buna yazar. */
export type FieldErrors = Record<string, string>

export function createFieldCollector(): {
  fields: FieldErrors
  setError: (name: string, error: { type: string; message: string }) => void
} {
  const fields: FieldErrors = {}
  return {
    fields,
    setError: (name, error) => {
      // Aynı alanın ilk maddesi kalır; sonraki maddeler ekranı uzatmaz.
      if (!(name in fields)) fields[name] = error.message
    },
  }
}

export type CommandFailure = {
  /** Formun üstünde gösterilecek genel mesaj; alan maddeleri varsa ve genel mesaj yoksa `null`. */
  message: string | null
  /** Alan adı → mesaj (`ROOT_FIELD` hariç). */
  fields: FieldErrors
  /** Ağ hatası ya da 5xx: istek işlenmiş olabilir, aynı işlem yeniden denenebilir. */
  retryable: boolean
}

export const isRetryableFailure = (error: ApiError): boolean =>
  error.isNetworkError || error.status >= 500

export function commandFailure(
  error: ApiError,
  messages: CommandMessages = {},
  collected: FieldErrors = {},
): CommandFailure {
  const { [ROOT_FIELD]: root, ...fields } = collected
  const hasFields = Object.keys(fields).length > 0
  return {
    message:
      root ?? (hasFields ? null : (commandFeedback(error, messages).message ?? error.message)),
    fields,
    retryable: isRetryableFailure(error),
  }
}
