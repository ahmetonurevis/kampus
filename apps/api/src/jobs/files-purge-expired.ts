import { purgeExpiredFiles, PURGE_BATCH_SIZE } from '../services/files.ts'
import { DAY_SECONDS, type InstitutionJob } from './types.ts'

/** Bir çalıştırmada en çok tur; kalan dosyalar ertesi gün imha edilir. */
const MAX_ROUNDS = 20

/**
 * Saklama sonu imhası (ADR 0003 karar 9, 13; guvenlik-kvkk.md §10; DOM-BEC-052, DOM-YTK-059):
 * `retention_until` gelmiş dosyaların nesnesi silinir, satırı `deleted` kalır. Saklama sonu
 * konuşma kaydında teslime bağlanırken yazılır (dönem sonu ya da puanlama/itiraz kapanışı + 6 ay)
 * ve rıza geri çekilince `now`'a çekilir. Günde bir çalışır (04:15, Europe/Istanbul): saklama sonu
 * gün sonuna yazıldığından dosya en geç ertesi sabah silinir. Kurum başına tur tur
 * (`PURGE_BATCH_SIZE`) ilerler; dolu tur bir sonrakini başlatır. İdempotenttir: silinmiş dosya
 * taramaya girmez. Satırı olmayan nesneler bu işin kapsamı dışındadır (`TODO(F3c2-orphans)`).
 */
export const filesPurgeExpiredJob: InstitutionJob<{ purged: number; rounds: number }> = {
  name: 'files.purge-expired',
  cron: '15 4 * * *',
  slotSeconds: DAY_SECONDS,
  run: async ({ db, storage, log, signal }, { institutionId }, now) => {
    let purged = 0
    let rounds = 0
    // İptal edilen iş (süre aşımı, kapanış) yeni tura başlamaz; kalan dosyalar sonraki çalıştırmada.
    while (rounds < MAX_ROUNDS && signal?.aborted !== true) {
      rounds += 1
      const count = await purgeExpiredFiles({ db, storage, institutionId, now, log })
      purged += count
      if (count < PURGE_BATCH_SIZE) break
    }
    return { purged, rounds }
  },
}
