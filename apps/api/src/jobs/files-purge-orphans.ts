import { purgeOrphanObjects } from '../services/file-orphans.ts'
import { DAY_SECONDS, type InstitutionJob } from './types.ts'

/**
 * Yetim nesne taraması (OG-093, IST-027; ADR 0003 karar 4, 5, 13; guvenlik-kvkk.md §10): kurumun
 * depo önekinde hiçbir `files` satırının tutmadığı ve 24 saatten eski nesneleri siler
 * (`services/file-orphans.ts`). Satırlı dosyaları silen işler (`files.purge-unattached`,
 * `files.purge-expired`) nesneyi silemezse ya da yükleme satır yazılmadan çökerse nesne buraya
 * kalır. Günde bir çalışır (04:45, Europe/Istanbul; saklama sonu imhasının 04:15 turundan sonra),
 * kurum başına en çok `ORPHAN_PURGE_LIMIT` silme dener; kalan yetimler ertesi gün silinir. İptal
 * edilen iş (pg-boss `job.signal`) taramayı bırakır. İdempotenttir: silinen nesne yeniden
 * listelenmez, satırlı nesneye dokunulmaz.
 */
export const filesPurgeOrphansJob: InstitutionJob<{
  scanned: number
  candidates: number
  purged: number
  failed: number
  recent: number
  stopped: 'limit' | 'aborted' | null
}> = {
  name: 'files.purge-orphans',
  cron: '45 4 * * *',
  slotSeconds: DAY_SECONDS,
  run: ({ db, storage, log, signal }, { institutionId }, now) =>
    purgeOrphanObjects({ db, storage, institutionId, now, log, signal }),
}
