import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Özel nitelikli (Ö) alanların uygulama düzeyinde şifrelenmesi (guvenlik-kvkk.md §8, §12;
 * IST-020). AES-256-GCM; anahtar ortamdaki ana anahtardan (`FIELD_ENCRYPTION_KEY`) kurum ve
 * sürüm başına HKDF-SHA256 ile türetilir, böylece bir kurumun türetilmiş anahtarı başka kurumun
 * verisini açmaz. Her şifrelemede rastgele 12 baytlık IV. Ek doğrulanmış veri (AAD) değeri
 * satıra bağlar (kurum, tablo, kolon, satır kimliği, satırdaki bağlı alanlar, anahtar sürümü): şifreli değer başka
 * öğrencinin ya da kurumun satırına kopyalanırsa çözülmez.
 *
 * Saklama biçimi tek pakettir: base64(IV ‖ etiket ‖ şifreli metin) ve ayrı `key_version` kolonu.
 * Anahtar ve düz metin loglanmaz, hata iletisine girmez.
 *
 * TODO(IST-020-anahtar-dondurme): eski sürümlerin anahtarlarını ortamdan okuma
 * (`FIELD_ENCRYPTION_KEYS`) ve satırları yeni sürüme yeniden şifreleyen iş; bugün tek sürüm (1).
 */

export const FIELD_KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const ALGORITHM = 'aes-256-gcm'
/** Bugünkü ana anahtarın sürümü; döndürmede artar. */
export const CURRENT_FIELD_KEY_VERSION = 1

/** Şifreli değerin bağlandığı satır ve kolon. */
export type FieldBinding = {
  institutionId: string
  table: string
  column: string
  /** Satırın kurum içindeki kimliği (satır `id`'si; yazmadan önce bilinmeli). */
  rowKey: string
  /**
   * Değere ayrıca bağlanan, aynı satırdaki diğer alanlar (ör. öğrenci kimliği, hukuki dayanak);
   * sıra sabittir. Ham satırda biri değiştirilirse değer çözülmez.
   */
  context?: readonly string[]
}

export type EncryptedField = {
  /** base64(IV ‖ GCM etiketi ‖ şifreli metin). */
  ciphertext: string
  keyVersion: number
}

/** Çözme başarısız: yanlış satır, değiştirilmiş veri, bilinmeyen sürüm. Ayrıntı içermez. */
export class FieldDecryptionError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Şifreli alan çözülemedi.', options)
    this.name = 'FieldDecryptionError'
  }
}

export type FieldCipher = {
  readonly currentKeyVersion: number
  encrypt(binding: FieldBinding, plaintext: string): EncryptedField
  decrypt(binding: FieldBinding, field: EncryptedField): string
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Ortamdaki ana anahtarı çözer; tam 32 bayt base64 değilse `null`. */
export function decodeFieldKey(value: string): Buffer | null {
  if (!BASE64.test(value)) return null
  const key = Buffer.from(value, 'base64')
  return key.length === FIELD_KEY_BYTES ? key : null
}

function associatedData(binding: FieldBinding, keyVersion: number): Buffer {
  // JSON dizisi alanları belirsizliksiz ayırır ("a|b" + "c" ile "a" + "b|c" çakışmaz).
  return Buffer.from(
    JSON.stringify([
      'kampus-field',
      keyVersion,
      binding.table,
      binding.column,
      binding.institutionId,
      binding.rowKey,
      ...(binding.context ?? []),
    ]),
    'utf8',
  )
}

/**
 * Sürüm → ana anahtar listesinden şifreleyici kurar; yeni değerler `currentKeyVersion` ile
 * şifrelenir, eski sürümlü satırlar kendi anahtarıyla çözülür.
 */
export function createFieldCipher(
  masterKeys: ReadonlyMap<number, Buffer>,
  currentKeyVersion: number,
): FieldCipher {
  for (const key of masterKeys.values())
    if (key.length !== FIELD_KEY_BYTES) throw new Error('Alan şifreleme anahtarı 32 bayt olmalı.')
  if (!masterKeys.has(currentKeyVersion))
    throw new Error('Güncel alan şifreleme anahtarı sürümü tanımlı değil.')
  const derived = new Map<string, Buffer>()

  function institutionKey(institutionId: string, keyVersion: number): Buffer {
    const cacheKey = `${keyVersion}\u0000${institutionId}`
    const cached = derived.get(cacheKey)
    if (cached) return cached
    const master = masterKeys.get(keyVersion)
    if (!master) throw new FieldDecryptionError()
    const key = Buffer.from(
      hkdfSync(
        'sha256',
        master,
        Buffer.from(institutionId, 'utf8'),
        Buffer.from(`kampus/field-encryption/v${keyVersion}`, 'utf8'),
        FIELD_KEY_BYTES,
      ),
    )
    derived.set(cacheKey, key)
    return key
  }

  return {
    currentKeyVersion,
    encrypt(binding, plaintext) {
      const keyVersion = currentKeyVersion
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv(
        ALGORITHM,
        institutionKey(binding.institutionId, keyVersion),
        iv,
      )
      cipher.setAAD(associatedData(binding, keyVersion))
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const packed = Buffer.concat([iv, cipher.getAuthTag(), encrypted])
      return { ciphertext: packed.toString('base64'), keyVersion }
    },
    decrypt(binding, field) {
      const packed = Buffer.from(field.ciphertext, 'base64')
      if (packed.length < IV_BYTES + TAG_BYTES) throw new FieldDecryptionError()
      const key = institutionKey(binding.institutionId, field.keyVersion)
      try {
        const decipher = createDecipheriv(ALGORITHM, key, packed.subarray(0, IV_BYTES), {
          authTagLength: TAG_BYTES,
        })
        decipher.setAAD(associatedData(binding, field.keyVersion))
        decipher.setAuthTag(packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
        return Buffer.concat([
          decipher.update(packed.subarray(IV_BYTES + TAG_BYTES)),
          decipher.final(),
        ]).toString('utf8')
      } catch (error) {
        throw new FieldDecryptionError({ cause: error })
      }
    },
  }
}

/** Ortamdaki tek ana anahtarla (sürüm 1) şifreleyici; anahtar `config.ts`'te doğrulanmıştır. */
export function fieldCipherFromConfig(config: { FIELD_ENCRYPTION_KEY: string }): FieldCipher {
  const key = decodeFieldKey(config.FIELD_ENCRYPTION_KEY)
  if (!key) throw new Error('FIELD_ENCRYPTION_KEY geçersiz.')
  return createFieldCipher(new Map([[CURRENT_FIELD_KEY_VERSION, key]]), CURRENT_FIELD_KEY_VERSION)
}
