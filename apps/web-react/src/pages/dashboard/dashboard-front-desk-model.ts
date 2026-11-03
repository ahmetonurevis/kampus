// Ön büro Genel Bakışı iletişim kartının saf gösterim hesabı. Girdi özet yanıtının `requests`
// bölümüdür (sunucu sayımı); burada yalnız etiket ve liste süzgeci türetilir.
import type { components } from '@kampus/api-client/schema.d.ts'
import { number } from '@kampus/school-core/lib/format.ts'
import { REQUEST_STATUSES } from '@kampus/school-core/lib/requests.ts'

type RequestCounts = NonNullable<components['schemas']['DashboardFrontDesk']['requests']>

const [NEW_STATUS] = REQUEST_STATUSES

export type RequestCardModel = {
  /** Kartın sayısı: `Yeni` durumundaki talepler; yanıt gelene kadar `undefined`. */
  value: number | undefined
  note: string
  /** Şikayet & Talepler adres süzgeci (`?durum=`): sayı bu listenin toplamıdır. */
  filter: Readonly<Record<string, string>>
}

export function requestCardModel(counts: RequestCounts | null): RequestCardModel {
  const inReview = counts?.inReview ?? 0
  return {
    value: counts?.new,
    note: inReview > 0 ? `${number(inReview)} talep inceleniyor` : 'İncelenen talep yok',
    filter: { durum: NEW_STATUS },
  }
}
