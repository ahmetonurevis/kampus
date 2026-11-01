import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { z } from 'zod'

import { assertStorageKey, type SignedGetOptions, type StorageDriver } from './storage.ts'

/**
 * `disk` sürücüsü (ADR 0003 karar 1): birim/API testleri ve S3 sunucusu kurmak istemeyen yerel
 * geliştirme. Nesne `<kök>/<anahtar>` dosyasıdır; yazma önce aynı klasörde geçici dosyaya yapılır,
 * akış başarıyla bitince yeniden adlandırılır: yarıda kesilen yüklemeden nesne kalmaz.
 *
 * İmzalı bağlantıyı API'nin kendi ucu (`GET /api/v1/files/download?token=…`) sunar. Belirteç
 * `<yük>.<imza>`dır: yük base64url JSON (kurum, dosya kimliği, bitiş, disposition), imza yükün
 * HMAC-SHA256'sı. Belirteç imzalıdır ama şifreli değildir; URL vekil loguna ve tarayıcı geçmişine
 * girebilir. Bu yüzden özgün ad (kişisel veri olabilir) ve tür belirteçte taşınmaz: indirme ucu
 * ikisini `files` satırından okur, satır silinmiş veya reddedilmişse 404 döner (KVKK, F3c2a takip).
 */

export const DOWNLOAD_PATH = '/api/v1/files/download'

const tokenPayloadSchema = z.strictObject({
  // Kimlikler nesne anahtarı bölümü biçimindedir (`STORAGE_KEY_PATTERN`; kurum kimliği UUID değildir).
  i: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  f: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  e: z.number().int().positive(),
  d: z.enum(['inline', 'attachment']),
})

/** Belirtecin yetkilendirdiği dosya: ad ve tür `files` satırından okunur. */
export type SignedObject = {
  institutionId: string
  fileId: string
  disposition: 'inline' | 'attachment'
}

/** İmza doğrulamasının sonucu: geçerli nesne, süresi geçmiş veya bozuk belirteç. */
export type TokenCheck =
  { ok: true; object: SignedObject } | { ok: false; reason: 'expired' | 'invalid' }

export interface DiskStorageOptions {
  root: string
  /** API'nin dışarıdan görünen kökü (`publicUrl`); bağlantı bu köke göre üretilir. */
  baseUrl: string
  /** İmza anahtarı; sunucu sırrından türetilir (`storageSigningKey`). */
  signingKey: string
}

/** Sunucu sırrından alan ayrımlı imza anahtarı: oturum sırrı doğrudan kullanılmaz. */
export function storageSigningKey(secret: string): string {
  return createHmac('sha256', secret).update('kampus:storage-download:v1').digest('base64url')
}

export class DiskStorage implements StorageDriver {
  readonly kind = 'disk' as const
  readonly #root: string
  readonly #baseUrl: string
  readonly #signingKey: string

  constructor(options: DiskStorageOptions) {
    this.#root = resolve(options.root)
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.#signingKey = options.signingKey
  }

  /** Anahtarın kök altındaki yolu; biçim dışı anahtar ve kök dışına çıkan yol reddedilir. */
  #path(key: string): string {
    assertStorageKey(key)
    const path = resolve(this.#root, key)
    if (!path.startsWith(this.#root + sep)) throw new Error('storage key escapes root')
    return path
  }

  async put(key: string, body: Readable): Promise<void> {
    const path = this.#path(key)
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.part`
    try {
      await pipeline(body, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  async head(key: string): Promise<{ byteSize: number } | null> {
    try {
      const info = await stat(this.#path(key))
      return info.isFile() ? { byteSize: info.size } : null
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.#path(key), { force: true })
  }

  async signedGetUrl(key: string, options: SignedGetOptions): Promise<string> {
    assertStorageKey(key)
    const payload = Buffer.from(
      JSON.stringify({
        i: options.institutionId,
        f: options.fileId,
        e: Math.floor(options.expiresAt.getTime() / 1000),
        d: options.disposition,
      } satisfies z.infer<typeof tokenPayloadSchema>),
    ).toString('base64url')
    const token = `${payload}.${this.#sign(payload)}`
    return `${this.#baseUrl}${DOWNLOAD_PATH}?token=${token}`
  }

  #sign(payload: string): string {
    return createHmac('sha256', this.#signingKey).update(payload).digest('base64url')
  }

  /**
   * Belirteci doğrular: imza sabit zamanlı karşılaştırılır, sonra yük okunur ve süre denetlenir.
   * Bitiş anı dahil değildir (`now >= bitiş` → süresi geçmiş).
   */
  verify(token: string, now: Date): TokenCheck {
    const [payload, signature, ...rest] = token.split('.')
    if (!payload || !signature || rest.length > 0) return { ok: false, reason: 'invalid' }
    const expected = Buffer.from(this.#sign(payload))
    const given = Buffer.from(signature)
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      return { ok: false, reason: 'invalid' }
    let decoded: unknown
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    } catch {
      return { ok: false, reason: 'invalid' }
    }
    const parsed = tokenPayloadSchema.safeParse(decoded)
    if (!parsed.success) return { ok: false, reason: 'invalid' }
    if (now.getTime() >= parsed.data.e * 1000) return { ok: false, reason: 'expired' }
    return {
      ok: true,
      object: {
        institutionId: parsed.data.i,
        fileId: parsed.data.f,
        disposition: parsed.data.d,
      },
    }
  }

  /** Nesneyi okuma akışı ve boyutu; nesne yoksa `null`. */
  async open(key: string): Promise<{ stream: Readable; byteSize: number } | null> {
    const info = await this.head(key)
    if (info === null) return null
    return { stream: createReadStream(this.#path(key)), byteSize: info.byteSize }
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT'
}
