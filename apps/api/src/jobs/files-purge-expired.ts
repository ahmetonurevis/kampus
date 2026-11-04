import type { ExpiredFileCursor } from '../db/files.ts'
import { purgeExpiredFiles } from '../services/files.ts'
import { DAY_SECONDS, type InstitutionJob } from './types.ts'

/** Bir çalıştırmada en çok tur; kalan dosyalar ertesi gün imha edilir. */
const MAX_ROUNDS = 20

/**
 * Saklama sonu imhası (ADR 0003 karar 9, 13; guvenlik-kvkk.md §10; DOM-BEC-052, DOM-YTK-059):
 * `retention_until` gelmiş dosyaların nesnesi silinir, satırı `deleted` kalır. Saklama sonu
 * konuşma kaydında teslime bağlanırken yazılır (dönem sonu ya da puanlama/itiraz kapanışı + 6 ay),
 * sonuç duyurusu, itiraz açılışı ve kararında ileri alınır ve rıza geri çekilince `now`'a çekilir. Günde bir çalışır (04:15, Europe/Istanbul): saklama sonu
 * gün sonuna yazıldığından dosya en geç ertesi sabah silinir. Puanı kesinleşmemiş ya da itirazı
 * açık teslim sürümünün kaydı bekletilir (`held`; DOM-BEC-052). Kurum başına sayfa sayfa
 * (`PURGE_BATCH_SIZE`, imleçle; bekletilen satırlar sonrakileri tıkamaz) ilerler. İdempotenttir: silinmiş dosya
 * taramaya girmez. Silinemeyip kalan nesneyi ve satırı olmayan nesneleri `files.purge-orphans` siler (OG-093).
 */
export const filesPurgeExpiredJob: InstitutionJob<{
  purged: number
  held: number
  rounds: number
}> = {
  name: 'files.purge-expired',
  cron: '15 4 * * *',
  slotSeconds: DAY_SECONDS,
  run: async ({ db, storage, log, signal }, { institutionId }, now) => {
    let purged = 0
    let held = 0
    let rounds = 0
    let after: ExpiredFileCursor | null = null
    // İptal edilen iş (süre aşımı, kapanış) yeni tura başlamaz; kalan dosyalar sonraki çalıştırmada.
    while (rounds < MAX_ROUNDS && signal?.aborted !== true) {
      rounds += 1
      const page = await purgeExpiredFiles({ db, storage, institutionId, now, log, after })
      purged += page.purged
      held += page.held
      if (page.next === null) break
      after = page.next
    }
    return { purged, held, rounds }
  },
}
