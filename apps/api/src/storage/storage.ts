import type { Readable } from 'node:stream'

/**
 * Dosya deposu arayüzü (ADR 0003 karar 1). Nesne anahtarı sunucuda üretilir ve kişisel veri
 * taşımaz (`storageKey`); sürücü anahtarı yorumlamaz, yalnız saklar.
 *
 * Sürücüler: `disk` (bugün; `STORAGE_DIR`, imzalı bağlantıyı API'nin kendi ucu üretir) ve
 * TODO(F3c2-s3): `s3` (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`; tek kova, kurum
 * öneki; `signedGetUrl` S3 ön imzalı GET'i ve `response-content-type`/`-disposition`
 * parametrelerini döndürür). Özgün ad bağlantıya girmez (KVKK: URL vekil loguna ve tarayıcı
 * geçmişine düşer); S3'te adlı `Content-Disposition` yüklemede nesne meta verisine yazılır.
 * TODO(F3c2-encryption): Ö sınıfı dosya gelirse (karar 12) uygulama düzeyi AES-256-GCM ile
 * şifrelenir ve imzalı bağlantı verilmez; bu arayüze akışla okuma sürücüsü eklenir.
 */
export interface StorageDriver {
  readonly kind: 'disk'
  /**
   * Akışı anahtara yazar. Akış hata verirse (boyut sınırı, istemci kopması) yarım nesne kalmaz ve
   * hata olduğu gibi fırlatılır. Aynı anahtar ikinci kez yazılmaz (anahtar her yüklemede yenidir).
   */
  put(key: string, body: Readable, options: { contentType: string }): Promise<void>
  /** Nesne varsa boyutu; yoksa `null`. */
  head(key: string): Promise<{ byteSize: number } | null>
  /** Nesneyi okuma akışı ve boyutu; nesne yoksa `null` (ses dönüşümü, ADR 0003 karar 10). */
  open(key: string): Promise<{ stream: Readable; byteSize: number } | null>
  /** Nesneyi siler; olmayan nesne hata değildir (temizlik yeniden denenebilir). */
  delete(key: string): Promise<void>
  /**
   * Önek (`<kurum>/`, `assertStoragePrefix`) altındaki nesneleri anahtar ve son değişiklik
   * zamanıyla akışla verir; yetim nesne taraması (OG-093, `services/file-orphans.ts`) kullanır.
   * Sıra tanımsızdır ve liste bellekte toplanmaz: tüketici erken bırakınca (`break`) sürücü açık
   * kaynakları kapatır. Yalnız anahtar biçimine (`STORAGE_KEY_PATTERN`) uyan tamamlanmış nesneler
   * verilir; yazımı süren geçici nesne listeye girmez. Tarama sırasında silinen ya da eklenen nesne
   * listede görünebilir de görünmeyebilir de.
   * TODO(F3c2-s3): S3'te `ListObjectsV2` (`Prefix`, `ContinuationToken`, sayfa başına en çok 1000)
   * sayfa sayfa okunur; `Key` ve `LastModified` verilir.
   */
  list(prefix: string): AsyncIterable<StoredObjectInfo>
  /**
   * Kısa ömürlü, imzalı GET bağlantısı (karar 6); disposition imzaya dahildir. Bağlantı özgün adı
   * taşımaz (KVKK); ad ve tür indirmede `files` satırından gelir.
   */
  signedGetUrl(key: string, options: SignedGetOptions): Promise<string>
}

/** Listelenen nesne: anahtar ve son değişiklik (yazım) zamanı. */
export interface StoredObjectInfo {
  key: string
  lastModified: Date
}

export interface SignedGetOptions {
  institutionId: string
  fileId: string
  expiresAt: Date
  /** Belge `attachment`, ses/görüntü/görsel `inline` (karar 6). */
  disposition: 'inline' | 'attachment'
}

/** Nesne anahtarı biçimi: `<kurum>/<amaç>/<yyyy>/<mm>/<uuid>`; yol geçişine izin vermez. */
export const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+){4}$/

export function assertStorageKey(key: string): void {
  if (!STORAGE_KEY_PATTERN.test(key)) throw new Error('invalid storage key')
}

/** Anahtarın bir bölümü (kurum, amaç, yıl, ay, kimlik). */
export const STORAGE_KEY_SEGMENT = /^[A-Za-z0-9_-]+$/

/** Liste öneki: anahtarın ilk 1–4 bölümü ve sonda `/` (`<kurum>/`); öteki kurumun öneki eşleşmez. */
export const STORAGE_PREFIX_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+){0,3}\/$/

export function assertStoragePrefix(prefix: string): void {
  if (!STORAGE_PREFIX_PATTERN.test(prefix)) throw new Error('invalid storage prefix')
}

/** Sunucuda üretilen anahtar (ADR 0003 karar 4); ay ve yıl UTC'dir. */
export function storageKeyFor(input: {
  institutionId: string
  purpose: string
  fileId: string
  now: Date
}): string {
  const year = String(input.now.getUTCFullYear())
  const month = String(input.now.getUTCMonth() + 1).padStart(2, '0')
  const key = [input.institutionId, input.purpose, year, month, input.fileId].join('/')
  assertStorageKey(key)
  return key
}
