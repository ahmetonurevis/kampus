import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'

import type { Database } from './client.ts'
import { files, type FileStatus } from './schema/files.ts'
import { institutionSettings } from './schema/institution-settings.ts'

/**
 * `files` deposu (ADR 0003 karar 4, 5, 13). İlk parametre her zaman `institutionId`'dir. İçerik kolonları
 * değişmez (migration 0015 tetikleyicisi); depo yalnız durum, bağlama ve silme yazar.
 */

export type StoredFile = typeof files.$inferSelect
export type NewFile = Pick<
  typeof files.$inferInsert,
  | 'id'
  | 'purpose'
  | 'storageKey'
  | 'contentType'
  | 'byteSize'
  | 'sha256'
  | 'originalName'
  | 'uploadedByUserId'
>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Nesnesi silinmiş durumlar: kotaya sayılmaz ve anahtarı nesneyi tutmaz (`findHeldStorageKeys`).
 */
const OBJECTLESS_STATUSES: FileStatus[] = ['rejected', 'deleted']

/**
 * Yeni dosya satırı. Dönüşümden geçecek ses (`media.transcode`, ADR 0003 karar 10) `processing`
 * başlar; öteki dosyalar denetimi (karar 7, 8) `pending` bekler. Tarayıcı açıkken yüklenen ses
 * `scanPending` ile başlar (OG-988): dönüşüm bitse de tarama temiz çıkana kadar `ready` olmaz.
 */
export async function insertFile(
  tx: Database,
  institutionId: string,
  file: NewFile,
  now: Date,
  status: 'pending' | 'processing' = 'pending',
  options: { scanPending?: boolean } = {},
): Promise<StoredFile> {
  const scanPending = options.scanPending ?? false
  const [row] = await tx
    .insert(files)
    .values({ ...file, institutionId, status, scanPending, createdAt: now, updatedAt: now })
    .returning()
  if (!row) throw new Error('file insert returned no row')
  return row
}

export async function findFile(
  tx: Database,
  institutionId: string,
  fileId: string,
  options: { lock?: boolean } = {},
): Promise<StoredFile | null> {
  const query = tx
    .select()
    .from(files)
    .where(and(eq(files.institutionId, institutionId), eq(files.id, fileId)))
    .limit(1)
  const [row] = options.lock ? await query.for('update') : await query
  return row ?? null
}

/**
 * Kayda bağlı, verilen amaçtaki görünür dosyalar (silinmiş ve reddedilmiş hariç), kimlik sırasıyla.
 * Dinleme denemesinin kayıtları (`services/listening-plays.ts`) böyle bulunur.
 */
export async function listAttachedFiles(
  db: Database,
  institutionId: string,
  attached: { type: string; id: string; purpose: StoredFile['purpose'] },
): Promise<StoredFile[]> {
  return db
    .select()
    .from(files)
    .where(
      and(
        eq(files.institutionId, institutionId),
        eq(files.attachedType, attached.type),
        eq(files.attachedId, attached.id),
        eq(files.purpose, attached.purpose),
        notInArray(files.status, OBJECTLESS_STATUSES),
      ),
    )
    .orderBy(asc(files.id))
}

/**
 * Kimlikleri verilen dosyalar (durumdan bağımsız; silinmiş satır da döner: imhadan sonra süre
 * okunur, DOM-BEC-052). Geçersiz (uuid olmayan) kimlik sorguya girmez, sonuçta yoktur.
 */
export async function loadFilesByIds(
  db: Database,
  institutionId: string,
  fileIds: readonly string[],
): Promise<StoredFile[]> {
  const ids = [...new Set(fileIds.filter((id) => UUID.test(id)))]
  if (ids.length === 0) return []
  return db
    .select()
    .from(files)
    .where(and(eq(files.institutionId, institutionId), inArray(files.id, ids)))
}

/** Kurumun depoda tuttuğu toplam bayt (karar 3: `files` tablosundan toplanır). */
export async function usedStorageBytes(tx: Database, institutionId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${files.byteSize}), 0)` })
    .from(files)
    .where(
      and(eq(files.institutionId, institutionId), notInArray(files.status, OBJECTLESS_STATUSES)),
    )
  return Number(row?.total ?? 0)
}

/** Kurum ayarındaki kota; ayar satırı veya değer yoksa `null` (varsayılan çağıranda). */
export async function storageQuotaSetting(
  tx: Database,
  institutionId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ quota: institutionSettings.storageQuotaBytes })
    .from(institutionSettings)
    .where(eq(institutionSettings.institutionId, institutionId))
    .limit(1)
  return row?.quota ?? null
}

/** Satırı iyimser kilitle günceller; sürüm tutmazsa `null`. */
async function updateFile(
  tx: Database,
  institutionId: string,
  current: StoredFile,
  values: Partial<
    Pick<
      StoredFile,
      | 'status'
      | 'attachedType'
      | 'attachedId'
      | 'attachedAt'
      | 'dataSubjectId'
      | 'retentionUntil'
      | 'deletedAt'
      | 'originalName'
      | 'readyAt'
      | 'scanPending'
    >
  >,
  now: Date,
): Promise<StoredFile | null> {
  const [row] = await tx
    .update(files)
    .set({ ...values, updatedAt: now, version: current.version + 1 })
    .where(
      and(
        eq(files.institutionId, institutionId),
        eq(files.id, current.id),
        eq(files.version, current.version),
      ),
    )
    .returning()
  return row ?? null
}

/**
 * Dosyayı kayda bağlar. Saklama sonu verilirse yazılır (ADR 0003 karar 13: bağlanma anında
 * hesaplanır); daha erken bir saklama sonu (rıza geri çekme işareti) korunur.
 */
export function attachFileRow(
  tx: Database,
  institutionId: string,
  current: StoredFile,
  attachment: {
    type: string
    id: string
    dataSubjectId: string | null
    retentionUntil?: Date | null
  },
  now: Date,
) {
  const retention = attachment.retentionUntil ?? null
  const keepEarlier =
    current.retentionUntil !== null && (retention === null || current.retentionUntil < retention)
  return updateFile(
    tx,
    institutionId,
    current,
    {
      attachedType: attachment.type,
      attachedId: attachment.id,
      attachedAt: now,
      dataSubjectId: attachment.dataSubjectId,
      ...(keepEarlier || retention === null ? {} : { retentionUntil: retention }),
    },
    now,
  )
}

/**
 * Bağı kaldırır (kayıttan düşen dosya; ör. yeniden teslimde çıkarılan dosya). Veri sahibi kalır
 * (imha ve başvuru için, karar 13); dosya bağsız olur ve karar 5'in bağlanmamış dosya
 * temizliğine girer.
 */
export function detachFileRow(tx: Database, institutionId: string, current: StoredFile, now: Date) {
  return updateFile(
    tx,
    institutionId,
    current,
    { attachedType: null, attachedId: null, attachedAt: null },
    now,
  )
}

export function setFileStatus(
  tx: Database,
  institutionId: string,
  current: StoredFile,
  status: 'processing' | 'ready' | 'rejected',
  now: Date,
) {
  // `ready` anı bağsız dosya temizliğinin başlangıcıdır (OG-995).
  return updateFile(
    tx,
    institutionId,
    current,
    { status, ...(status === 'ready' ? { readyAt: now } : {}) },
    now,
  )
}

/**
 * Ses dönüşümünün sonucu (ADR 0003 karar 10): `processing` satır dönüşmüş nesnenin anahtarı, türü,
 * boyutu, özeti ve ölçülen süresiyle `ready` olur; özgün nesnenin anahtarı aynı güncellemede
 * `superseded_storage_key`'e geçer (silinene kadar izlenir). Taraması süren seste (`scanPending`,
 * OG-988) içerik yazılır ama dosya `processing` kalır; `ready`'yi tarama yazar
 * (`completeAudioScan`). İçerik kolonları yalnız bu geçişte ve bir kez değişebilir (migration 0033,
 * 0042 tetikleyicisi); iyimser kilit tutmazsa `null`.
 */
export async function completeFileTranscode(
  tx: Database,
  institutionId: string,
  current: StoredFile,
  output: Pick<StoredFile, 'storageKey' | 'contentType' | 'byteSize' | 'sha256' | 'durationMs'>,
  now: Date,
): Promise<StoredFile | null> {
  const [row] = await tx
    .update(files)
    .set({
      ...output,
      ...(current.scanPending ? {} : { status: 'ready' as const, readyAt: now }),
      supersededStorageKey: current.storageKey,
      updatedAt: now,
      version: current.version + 1,
    })
    .where(
      and(
        eq(files.institutionId, institutionId),
        eq(files.id, current.id),
        eq(files.version, current.version),
        eq(files.status, 'processing'),
        isNull(files.supersededStorageKey),
      ),
    )
    .returning()
  return row ?? null
}

/**
 * Sesin temiz tarama sonucu (ADR 0003 karar 8, OG-988): `scanPending` düşer. Dönüşüm bitmişse
 * (`superseded_storage_key` dolu: özgün nesne taramayı bekliyor) dosya aynı güncellemede `ready`
 * olur; bitmemişse `processing` kalır ve `ready`'yi dönüşüm yazar. Çağıran satırı kilitler
 * (`findFile` `lock`); iyimser kilit ve durum koşulu tutmazsa `null`.
 */
export async function completeAudioScan(
  tx: Database,
  institutionId: string,
  current: StoredFile,
  now: Date,
): Promise<StoredFile | null> {
  const transcoded = current.supersededStorageKey !== null
  const [row] = await tx
    .update(files)
    .set({
      scanPending: false,
      ...(transcoded ? { status: 'ready' as const, readyAt: now } : {}),
      updatedAt: now,
      version: current.version + 1,
    })
    .where(
      and(
        eq(files.institutionId, institutionId),
        eq(files.id, current.id),
        eq(files.version, current.version),
        eq(files.status, 'processing'),
        eq(files.scanPending, true),
      ),
    )
    .returning()
  return row ?? null
}

/**
 * Kurumun `before`'dan önce güncellenmiş, hâlâ `processing` ve henüz dönüşmemiş ses dosyaları
 * (verilen amaçlarda); en eskiler önce, `limit` kadar. İşi kaybolmuş dönüşümleri yeniden başlatmak
 * için (`media.transcode`). Dönüşmüş ama taraması süren ses (`superseded_storage_key` dolu,
 * OG-988) dönüşüm beklemez, listeye girmez.
 */
export async function listStaleTranscodeFiles(
  db: Database,
  institutionId: string,
  purposes: readonly StoredFile['purpose'][],
  before: Date,
  limit: number,
): Promise<StoredFile[]> {
  if (purposes.length === 0) return []
  return db
    .select()
    .from(files)
    .where(
      and(
        eq(files.institutionId, institutionId),
        eq(files.status, 'processing'),
        inArray(files.purpose, [...purposes]),
        isNull(files.supersededStorageKey),
        lt(files.updatedAt, before),
      ),
    )
    .orderBy(asc(files.updatedAt), asc(files.id))
    .limit(limit)
}

/**
 * Kurumun `before`'dan önce güncellenmiş, taraması bitmemiş dosyaları (işi kaybolmuş ya da
 * denemeleri bitmiş `file.scan`): ses dışı `processing` dosyalar ve taraması süren
 * (`scanPending`) ses (OG-988). Yalnız dönüşüm bekleyen ses (tarama temiz ya da tarayıcı kapalıyken
 * yüklenmiş) girmez. En eskiler önce, `limit` kadar.
 */
export async function listStaleScanFiles(
  db: Database,
  institutionId: string,
  transcodedPurposes: readonly StoredFile['purpose'][],
  before: Date,
  limit: number,
): Promise<StoredFile[]> {
  return db
    .select()
    .from(files)
    .where(
      and(
        eq(files.institutionId, institutionId),
        eq(files.status, 'processing'),
        transcodedPurposes.length === 0
          ? undefined
          : or(notInArray(files.purpose, [...transcodedPurposes]), eq(files.scanPending, true)),
        lt(files.updatedAt, before),
      ),
    )
    .orderBy(asc(files.updatedAt), asc(files.id))
    .limit(limit)
}

/**
 * Silinmeyi bekleyen özgün nesnesi olan dosyalar (`superseded_storage_key` dolu; ses dönüşümü,
 * ADR 0003 karar 10), kimlik sırasıyla `limit` kadar. `processing` satır girmez: dönüşmüş ama
 * taraması süren seste özgün nesneyi tarama okur (OG-988); silinmesi `ready`, ret ya da imhayı
 * bekler.
 */
export async function listSupersededObjects(
  db: Database,
  institutionId: string,
  limit: number,
): Promise<Pick<StoredFile, 'institutionId' | 'id' | 'supersededStorageKey'>[]> {
  return db
    .select({
      institutionId: files.institutionId,
      id: files.id,
      supersededStorageKey: files.supersededStorageKey,
    })
    .from(files)
    .where(
      and(
        eq(files.institutionId, institutionId),
        isNotNull(files.supersededStorageKey),
        ne(files.status, 'processing'),
      ),
    )
    .orderBy(asc(files.id))
    .limit(limit)
}

/**
 * Özgün nesne depodan silindikten sonra izini kaldırır. Yalnız anahtar hâlâ aynıysa yazar
 * (eşzamanlı iki temizlik zararsızdır); iç kayıttır, sürüm ve güncelleme zamanı değişmez.
 */
export async function clearSupersededStorageKey(
  db: Database,
  institutionId: string,
  fileId: string,
  key: string,
): Promise<void> {
  await db
    .update(files)
    .set({ supersededStorageKey: null })
    .where(
      and(
        eq(files.institutionId, institutionId),
        eq(files.id, fileId),
        eq(files.supersededStorageKey, key),
      ),
    )
}

/**
 * Yetim nesne taraması (OG-093, IST-027; `services/file-orphans.ts`): verilen anahtarlardan hâlâ
 * bir dosyanın tuttuğu nesnelerinkini döndürür. Tutan: nesnesi yaşayan satırın güncel anahtarı
 * (`pending`, `processing`, `ready`) ve silinmeyi bekleyen özgün ses nesnesi
 * (`superseded_storage_key`, her durumda; onu `releaseSupersededObject` izleyip siler).
 * `rejected` ve `deleted` satırın anahtarı tutmaz: nesnesi silinmiş olmalıdır, silinemeyip
 * kalmışsa yetimdir. Anahtar araması `files_storage_key_key` indeksini kullanır.
 */
export async function findHeldStorageKeys(
  db: Database,
  institutionId: string,
  keys: readonly string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  const list = [...keys]
  const current = await db
    .select({ key: files.storageKey })
    .from(files)
    .where(
      and(
        eq(files.institutionId, institutionId),
        inArray(files.storageKey, list),
        notInArray(files.status, OBJECTLESS_STATUSES),
      ),
    )
  const superseded = await db
    .select({ key: files.supersededStorageKey })
    .from(files)
    .where(and(eq(files.institutionId, institutionId), inArray(files.supersededStorageKey, list)))
  const held = new Set(current.map((row) => row.key))
  for (const row of superseded) if (row.key !== null) held.add(row.key)
  return held
}

/** İmha: nesne silindikten sonra satır `deleted` kalır, özgün ad (K) silinir (karar 13). */
export function markFileDeleted(
  tx: Database,
  institutionId: string,
  current: StoredFile,
  now: Date,
) {
  return updateFile(
    tx,
    institutionId,
    current,
    { status: 'deleted', deletedAt: now, originalName: null },
    now,
  )
}

/**
 * Rızaya dayalı dosyaların imha işareti (ADR 0003 karar 9, 13; DOM-YTK-059): veri sahibinin bu
 * amaçlardaki silinmemiş dosyalarının saklama sonu `now`'a çekilir; daha erken saklama sonu
 * korunur. Konuşma kaydıyla aynı veri sahibine bağlı sesli geri bildirim (`feedback_audio`,
 * DOM-BEC-056) aynı taramaya girer.
 * Henüz bağlanmamış dosyada veri sahibi yazılı değildir: veri sahibinin hesaplarının
 * (`uploaderUserIds`) yüklediği bağlanmamış dosyalar da işaretlenir. Nesneyi imha işi siler.
 * İşaretlenen dosyaların kimliklerini döndürür.
 */
export async function scheduleSubjectFilesPurge(
  tx: Database,
  institutionId: string,
  subject: {
    purposes: readonly StoredFile['purpose'][]
    dataSubjectId: string
    uploaderUserIds: readonly string[]
  },
  now: Date,
): Promise<string[]> {
  const owned = eq(files.dataSubjectId, subject.dataSubjectId)
  const rows = await tx
    .update(files)
    .set({ retentionUntil: now, updatedAt: now, version: sql`${files.version} + 1` })
    .where(
      and(
        eq(files.institutionId, institutionId),
        inArray(files.purpose, [...subject.purposes]),
        subject.uploaderUserIds.length === 0
          ? owned
          : or(
              owned,
              and(
                isNull(files.attachedId),
                inArray(files.uploadedByUserId, [...subject.uploaderUserIds]),
              ),
            ),
        ne(files.status, 'deleted'),
        or(isNull(files.retentionUntil), gt(files.retentionUntil, now)),
      ),
    )
    .returning({ id: files.id })
  return rows.map((row) => row.id)
}

/**
 * Kurumun bağlanmamış ve `before`'dan önce yüklenmiş, silinmemiş dosyaları (karar 5: 24 saat);
 * en eskiler önce, `limit` kadar. Tarama `(institution_id, created_at)` indeksini kullanır.
 * Taranan ya da dönüştürülen (`processing`) dosya ancak `processingBefore`'dan önce yüklendiyse
 * listeye girer: tarayıcı kesintisi dosyayı bağlanmadan silmesin (OG-092). `ready` olmuş dosyanın
 * süresi `ready_at`'ten de sayılır (OG-995): geç taranan dosya taramadan 24 saat sonra silinir.
 * `ready_at` hiçbir zaman `created_at`'ten önce olmadığından ek koşul indeks taramasını daraltır.
 */
export async function listStaleUnattachedFiles(
  db: Database,
  institutionId: string,
  before: Date,
  limit: number,
  processingBefore: Date,
): Promise<StoredFile[]> {
  return db
    .select()
    .from(files)
    .where(
      and(
        eq(files.institutionId, institutionId),
        isNull(files.attachedId),
        ne(files.status, 'deleted'),
        lt(files.createdAt, before),
        or(isNull(files.readyAt), lt(files.readyAt, before)),
        or(ne(files.status, 'processing'), lt(files.createdAt, processingBefore)),
      ),
    )
    .orderBy(asc(files.createdAt), asc(files.id))
    .limit(limit)
}

/** Saklama sonu taramasının sayfa imleci: son bakılan satırın saklama sonu ve kimliği. */
export type ExpiredFileCursor = { retentionUntil: Date; id: string }

/**
 * Kurumun saklama sonu gelmiş (`retention_until <= now`), silinmemiş dosyaları (karar 13; imha
 * işi `files.purge-expired`): bağlı ya da bağsız, rıza geri çekmesiyle işaretlenmiş olanlar dahil.
 * En eski saklama sonu önce, `limit` kadar; `after` verilirse o satırdan sonrası (imha işinin
 * beklettiği satırlar sonraki sayfaları tıkamaz). Saklama sonu yalnız konuşma kaydında yazılır
 * (`TODO(F3c2-retention)`); tarama kurumun satırlarıyla sınırlıdır.
 */
export async function listExpiredFiles(
  db: Database,
  institutionId: string,
  now: Date,
  limit: number,
  after: ExpiredFileCursor | null = null,
): Promise<StoredFile[]> {
  return db
    .select()
    .from(files)
    .where(
      and(
        eq(files.institutionId, institutionId),
        isNotNull(files.retentionUntil),
        lte(files.retentionUntil, now),
        ne(files.status, 'deleted'),
        after === null
          ? undefined
          : or(
              gt(files.retentionUntil, after.retentionUntil),
              and(eq(files.retentionUntil, after.retentionUntil), gt(files.id, after.id)),
            ),
      ),
    )
    .orderBy(asc(files.retentionUntil), asc(files.id))
    .limit(limit)
}

/**
 * Saklama sonunu yeniden hesaplanan değere taşır (DOM-BEC-052). Kararı (yalnız ileri) çağıran
 * core `extendedRecordingRetention` ile verir; satır sürümü tutmazsa (eşzamanlı imha) `null`.
 */
export function extendFileRetention(
  tx: Database,
  institutionId: string,
  current: StoredFile,
  retentionUntil: Date,
  now: Date,
) {
  return updateFile(tx, institutionId, current, { retentionUntil }, now)
}
