import { isApiError } from '@kampus/api-client/errors.ts'
import { CollectionTooLargeError } from '@kampus/react-shared/collections.ts'

const FALLBACK = 'Kayıtlar yüklenemedi. Lütfen yeniden deneyin.'
const FORBIDDEN = 'Bu kayıtları görüntüleme yetkiniz yok.'
const TOO_LARGE =
  'Kayıt sayısı çok fazla olduğu için bu özet gösterilemiyor. Tam listeyi sayfasından açın.'
export const NOT_FOUND_MESSAGE = 'Kayıt bulunamadı. Silinmiş veya arşive taşınmış olabilir.'

/** Kullanıcıya gösterilecek Türkçe metin; teknik ayrıntı (kod, istek kimliği) yalnız loga gider. */
export function queryErrorMessage(error: unknown): string {
  // Bütün sayfaları çeken özet kartları (ör. yanıt bekleyen sorular) sayfa sınırını aşabilir;
  // yeniden denemek aynı sonucu verir, bu yüzden "yeniden deneyin" denmez.
  if (error instanceof CollectionTooLargeError) return TOO_LARGE
  if (!isApiError(error)) return FALLBACK
  if (error.status === 403 && error.code === 'forbidden') return FORBIDDEN
  if (error.status === 404) return NOT_FOUND_MESSAGE
  return error.message || FALLBACK
}
