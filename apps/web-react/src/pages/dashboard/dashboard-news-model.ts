// Genel Bakış "Kampüsten haberler" kartının saf hesabı. Girdi duyuru listesi ucunun
// (`GET /collections/announcements`, yeniden eskiye) yanıtıdır: kurum, rol ve hedef kitle kapsamı
// sunucuda uygulanır (DOM-ILT-001…004), burada yeniden süzülmez. Yalnız gösterim kararı verilir:
// geri çekilen duyuru haber değildir ve metni alıcıya zaten gelmez.
import type {
  AnnouncementRecord,
  AnnouncementRow,
} from '@kampus/react-shared/announcement-model.ts'
import { announcementRow } from '@kampus/react-shared/announcement-model.ts'
import type { CollectionRow } from '@kampus/react-shared/collections.ts'

/** Kartta gösterilen en çok haber sayısı (Vue ilk üç duyuruyu gösterir). */
export const NEWS_LIMIT = 3

/**
 * Listeden geri çekilmeyen ilk `limit` duyuru, gelen sırayla (sunucu `-date` ile sıralar).
 * Sunucu geri çekilmişi süzemediği için istek `NEWS_FETCH_SIZE` kadar duyuru okur; böylece geri
 * çekilenler kartı boş bırakmaz.
 */
export function newsItems(
  rows: readonly CollectionRow<AnnouncementRecord>[],
  limit = NEWS_LIMIT,
): AnnouncementRow[] {
  return rows
    .map(announcementRow)
    .filter((row) => !row.withdrawn)
    .slice(0, limit)
}

/** İstenen duyuru sayısı: gösterilen sayının iki katı; geri çekilenler için pay bırakır. */
export const NEWS_FETCH_SIZE = NEWS_LIMIT * 2 + 4

/** Haber özeti: ilk `max` karakter, kelime ortasında bölmeden ve "…" ile. */
export function newsExcerpt(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}
