import { purgeUnattachedFiles, PURGE_BATCH_SIZE } from '../services/files.ts'
import { HOUR_SECONDS, type InstitutionJob } from './types.ts'

/** Bir çalıştırmada en çok tur; kalan dosyalar sonraki saatte silinir. */
const MAX_ROUNDS = 20

/**
 * Bağlanmamış ya da reddedilmiş yüklemelerin temizliği (ADR 0003 karar 5, guvenlik-kvkk.md §10):
 * 24 saatte bir kayda bağlanmayan dosyanın nesnesi silinir, satırı `deleted` kalır. Saatlik
 * çalışır (her saatin 17. dakikası, Europe/Istanbul): dosya en geç 25 saatte silinir. Kurum başına
 * tur tur (`PURGE_BATCH_SIZE`) ilerler; dolu tur bir sonrakini başlatır. İdempotenttir: silinmiş
 * dosya taramaya girmez.
 */
export const filesPurgeJob: InstitutionJob<{ purged: number; rounds: number }> = {
  name: 'files.purge-unattached',
  cron: '17 * * * *',
  slotSeconds: HOUR_SECONDS,
  run: async ({ db, storage, log, signal }, { institutionId }, now) => {
    let purged = 0
    let rounds = 0
    // İptal edilen iş (süre aşımı, kapanış) yeni tura başlamaz; kalan dosyalar sonraki çalıştırmada.
    while (rounds < MAX_ROUNDS && signal?.aborted !== true) {
      rounds += 1
      const count = await purgeUnattachedFiles({ db, storage, institutionId, now, log })
      purged += count
      if (count < PURGE_BATCH_SIZE) break
    }
    return { purged, rounds }
  },
}
