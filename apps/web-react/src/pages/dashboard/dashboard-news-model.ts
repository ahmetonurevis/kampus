// Genel Bakış "Kampüsten haberler" kartının saf hesabı. Girdi duyuru listesi ucunun
// (`GET /collections/announcements`, yeniden eskiye) yanıtıdır: kurum, rol ve hedef kitle kapsamı
// sunucuda uygulanır (DOM-ILT-001…004), burada yeniden süzülmez. Yalnız gösterim kararı verilir:
// geri çekilen duyuru haber değildir ve metni alıcıya zaten gelmez.
import type {
  AnnouncementRecord,
  AnnouncementRow,
} from '@kampus/react-shared/announcement-model.ts'
import { announcementRow } from '@kampus/react-shared/announcement-model.ts'
import type { CollectionPage, CollectionRow } from '@kampus/react-shared/collections.ts'

/** Kartta gösterilen en çok haber sayısı (Vue ilk üç duyuruyu gösterir). */
export const NEWS_LIMIT = 3

/**
 * Listeden geri çekilmeyen ilk `limit` duyuru, gelen sırayla (sunucu `-date` ile sıralar).
 * Sunucuda geri çekilmişi eleyen süzgeç yoktur (`status` kayıt alanı değildir, durum istemcide
 * türetilir); bu yüzden `fetchNewsRows` yeterli yayında duyuru bulunana kadar sayfa okur.
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

/** Sayfa başına istenen duyuru sayısı: gösterilen sayının iki katı; geri çekilenler için pay. */
export const NEWS_FETCH_SIZE = NEWS_LIMIT * 2 + 4
/** En çok okunan sayfa; hepsi geri çekilmiş çok eski bir geçmişte sonsuz okumayı sınırlar. */
export const NEWS_MAX_PAGES = 5

/**
 * Yeterli yayında duyuru (`limit`) bulunana, kayıt bitene ya da `maxPages` dolana kadar sonraki
 * sayfaları okur; tek sayfadaki son duyuruların hepsi geri çekilmişse daha eski yayında duyuru
 * kartı boş bırakmaz. Okunan bütün satırlar gelen sırayla döner (süzme `newsItems`'tadır). Sayfa
 * sınırına ulaşmak hata değildir: bulunan kadarı gösterilir.
 */
export async function fetchNewsRows(
  fetchPage: (page: number) => Promise<CollectionPage<AnnouncementRecord>>,
  limit = NEWS_LIMIT,
  maxPages = NEWS_MAX_PAGES,
): Promise<CollectionRow<AnnouncementRecord>[]> {
  const rows: CollectionRow<AnnouncementRecord>[] = []
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page)
    rows.push(...result.rows)
    if (
      newsItems(rows, limit).length >= limit ||
      rows.length >= result.total ||
      result.rows.length === 0
    )
      break
  }
  return rows
}

/** Haber özeti: ilk `max` karakter, kelime ortasında bölmeden ve "…" ile. */
export function newsExcerpt(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}
