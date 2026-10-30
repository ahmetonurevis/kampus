import { unwrap } from '@kampus/api-client/client.ts'
import { toApiError } from '@kampus/api-client/errors.ts'

/** openapi-fetch çağrı sonucunun ortak şekli (`GET`/`POST`… yanıtı). */
export interface ApiResult {
  data?: unknown
  error?: unknown
  response: Response
}

/** Sonuç birleşiminin başarı kolundaki gövde tipi; hata kolu `never` olur. */
export type DataOf<TResult> = TResult extends { data: infer TData } ? TData : never

/**
 * Çağrıyı çalıştırır, `data`'yı döndürür; her hatayı `ApiError`'a çevirir. TanStack Query'nin
 * `queryFn`/`mutationFn`'ı böylece tek hata türüyle çalışır.
 */
export async function runRequest<TResult extends ApiResult>(
  call: () => Promise<TResult>,
): Promise<DataOf<TResult>> {
  try {
    const result = await call()
    // `DataOf` başarı kolunun gövdesidir; hata kolu ara katmanda zaten fırlatılmıştır.
    return unwrap(result as { data?: DataOf<TResult>; error?: unknown; response: Response })
  } catch (error) {
    throw toApiError(error)
  }
}
