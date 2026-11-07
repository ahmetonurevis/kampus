import { createConnection } from 'node:net'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { fileScannerDriver, type Config } from '../config.ts'

/**
 * Dosya tarayıcısı (ADR 0003 karar 8; OG-092, IST-027). `file.scan` işi depodaki nesneyi akışla
 * okur ve buraya verir. Sonuç üç türlüdür:
 *
 * - temiz ya da zararlı (imza adıyla; `Heuristics.*` sezgi ve `AlertExceedsMax` sınır bulguları
 *   dahil);
 * - kalıcı ret: içerik tarama sınırını aşıyor (`ScanLimitExceededError`); yeniden denemek sonucu
 *   değiştirmez, dosya taramasız `ready` olamaz (Sabah kararı 43);
 * - geçici hata: tarayıcıya ulaşılamadı, süre aşıldı, iş iptal edildi, yanıt eksik/bozuk ya da
 *   `clamd` başka bir `ERROR` döndü (`ScannerUnavailableError`). İş yeniden denenir; `ERROR` asla
 *   temiz sayılmaz.
 *
 * Sürücüler: `clamav` (aşağıdaki küçük `clamd` INSTREAM istemcisi); testte sahte tarayıcı
 * (`buildApp({ fileScan: { scanner } })`); `off` tarayıcı yoktur (`null`), yükleme bugünkü gibi
 * `pending` kalır. `AlertOLE2Macros`, `AlertEncrypted`, PDF sezgileri ve sınırlar `clamd`
 * yapılandırmasındadır (`deploy/clamav/clamd.conf`).
 */

export type ScanVerdict = { infected: false } | { infected: true; signature: string }

export interface FileScanner {
  /**
   * Akışı sonuna kadar tarar. Sinyal iptal edilirse ya da süre dolarsa bağlantı ve giriş akışı
   * kapatılır, geçici hata fırlar.
   */
  scan(input: Readable, options?: { signal?: AbortSignal }): Promise<ScanVerdict>
}

/** Tarayıcıya ulaşılamadı, süre aşıldı ya da sonuç belirsiz: geçici hata. */
export class ScannerUnavailableError extends Error {
  readonly code = 'scanner_unavailable'

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ScannerUnavailableError'
  }
}

/** İçerik tarayıcının akış sınırını aşıyor (`INSTREAM size limit exceeded`): kalıcı ret. */
export class ScanLimitExceededError extends Error {
  readonly code = 'scan_limit_exceeded'

  constructor() {
    super('clamd stream size limit exceeded')
    this.name = 'ScanLimitExceededError'
  }
}

export interface ClamavOptions {
  host: string
  port: number
  /** Bağlantı, akış ve yanıt dahil tek taramanın üst süresi. */
  timeoutMs: number
}

const INSTREAM_COMMAND = Buffer.from('zINSTREAM\0')
/** Bir INSTREAM parçasının en büyük veri boyu; `clamd` her parçayı ayrı uzunlukla okur. */
export const INSTREAM_CHUNK_BYTES = 64 * 1024
/** Yanıtın üst sınırı: `clamd` yanıtı tek kısa satırdır; fazlası bozuk yanıttır. */
const MAX_RESPONSE_BYTES = 4096
/** İmza adının üst sınırı ve izinli karakterleri (log'a yalnız bu ad yazılır). */
const SIGNATURE_PATTERN = /^[\w.:/+-]{1,200}$/

/**
 * Giriş akışını INSTREAM çerçevesine çevirir: önce `zINSTREAM\0`, her parça 4 bayt big-endian
 * uzunluk + veri (en çok `INSTREAM_CHUNK_BYTES`), sonda 4 bayt sıfır. Üreteç `pipeline` içinde
 * çalışır: soket dolunca (`write()` `false`) bir sonraki parça istenmez, böylece büyük video
 * bellekte birikmez.
 */
async function* instreamFrames(source: AsyncIterable<Uint8Array | string>) {
  yield INSTREAM_COMMAND
  for await (const chunk of source) {
    // Kopya yok: Buffer görünümü aynı belleği paylaşır.
    const bytes =
      typeof chunk === 'string'
        ? Buffer.from(chunk)
        : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    for (let offset = 0; offset < bytes.length; offset += INSTREAM_CHUNK_BYTES) {
      const part = bytes.subarray(offset, offset + INSTREAM_CHUNK_BYTES)
      const size = Buffer.alloc(4)
      size.writeUInt32BE(part.length)
      yield size
      yield part
    }
  }
  yield Buffer.alloc(4)
}

export type ClamdReply =
  | { kind: 'clean' }
  | { kind: 'infected'; signature: string }
  | { kind: 'limit_exceeded' }
  | { kind: 'error' }
  | { kind: 'malformed' }

/**
 * `clamd` yanıtını ayrıştırır. `z` önekli komutta yanıt `\0` ile biter; sonlandırıcısı olmayan
 * (yarım) yanıt bozuktur. Biçimler: `stream: OK`, `stream: <imza> FOUND`, `... ERROR`
 * (`INSTREAM size limit exceeded. ERROR` ayrıca ayrılır).
 */
export function parseClamdReply(raw: Buffer): ClamdReply {
  const end = raw.indexOf(0)
  if (end < 0) return { kind: 'malformed' }
  const line = raw.subarray(0, end).toString('utf8').trim()
  if (line === 'stream: OK') return { kind: 'clean' }
  const found = /^stream: ([\s\S]+) FOUND$/.exec(line)
  if (found) {
    const signature = (found[1] ?? '').trim()
    return SIGNATURE_PATTERN.test(signature)
      ? { kind: 'infected', signature }
      : { kind: 'infected', signature: 'unknown' }
  }
  if (/INSTREAM size limit exceeded/i.test(line)) return { kind: 'limit_exceeded' }
  if (/ERROR$/.test(line)) return { kind: 'error' }
  return { kind: 'malformed' }
}

/**
 * `clamd` sürücüsü: her tarama için yeni TCP bağlantısı, `node:net` + `pipeline` ile INSTREAM
 * (Sabah kararı 41; ADR 0003 uygulama notu). `clamd` kapalıyken API açılır, tarama geçici hatayla
 * ertelenir. Nesne diske yazılmaz, yerel `clamscan` ikilisine düşülmez.
 *
 * Süre (`timeoutMs`) ve çağıranın sinyali (`JobDeps.signal`) tek `AbortSignal`'de birleşir; iptal
 * edilince soket ve giriş akışı `destroy()` edilir (yarım bağlantı `clamd`'de beklemez). Yanıt
 * kuralları: `OK` yalnız bütün akış ve bitiş parçası gönderildiyse temizdir; `FOUND` ve sınır
 * aşımı akış yarıda kesilse de geçerlidir (`clamd` sınırda bağlantıyı kendisi kapatır); `ERROR`,
 * eksik ya da bozuk yanıt geçici hatadır. Hata iletisi kimlik ve içerik taşımaz.
 */
export function createClamavScanner(options: ClamavOptions): FileScanner {
  return {
    async scan(input, scanOptions = {}) {
      const deadline = AbortSignal.timeout(options.timeoutMs)
      const signal = scanOptions.signal ? AbortSignal.any([scanOptions.signal, deadline]) : deadline
      const failure = () =>
        new ScannerUnavailableError(
          deadline.aborted ? 'clamd scan timed out' : 'clamd scan aborted',
        )
      if (signal.aborted) {
        input.destroy()
        throw failure()
      }
      const socket = createConnection({ host: options.host, port: options.port })
      const abort = () => {
        socket.destroy()
        input.destroy()
      }
      signal.addEventListener('abort', abort, { once: true })
      const chunks: Buffer[] = []
      let received = 0
      // Yanıt `\0` gelince hemen çözülür (sınır yanıtı akış sürerken gelir; kalan akış beklenmez).
      const response = new Promise<Buffer>((resolve, reject) => {
        socket.on('data', (data: Buffer) => {
          received += data.length
          if (received > MAX_RESPONSE_BYTES) {
            socket.destroy()
            return reject(new ScannerUnavailableError('clamd response too long'))
          }
          chunks.push(data)
          if (data.includes(0)) resolve(Buffer.concat(chunks))
        })
        // `clamd` yanıttan sonra bağlantıyı kapatır; sıfırlama (`ECONNRESET`) da yanıttan sonra
        // gelebilir: okunan bayt varsa ayrıştırılır, yoksa geçici hatadır.
        socket.once('close', () => resolve(Buffer.concat(chunks)))
        socket.once('error', (error) => {
          if (chunks.length === 0)
            reject(new ScannerUnavailableError('clamd connection failed', { cause: error }))
        })
      })
      // Yazma yarısı kapatılmaz (`end: false`): `clamd` bitiş parçasından sonra yanıtlar ve
      // bağlantıyı kendisi kapatır. Sonuç burada yakalanır: yanıttan sonra kesilen akışın hatası
      // işlenmemiş ret olmaz.
      let streamFailed = false
      const sent = pipeline(input, instreamFrames, socket, { signal, end: false }).then(
        () => null,
        (error: unknown) => {
          streamFailed = true
          return { error }
        },
      )
      try {
        const raw = await response
        if (signal.aborted) throw failure()
        const reply = parseClamdReply(raw)
        switch (reply.kind) {
          case 'infected':
            return { infected: true, signature: reply.signature }
          case 'limit_exceeded':
            throw new ScanLimitExceededError()
          case 'clean': {
            // `OK` yalnız bütün akış ve bitiş parçası gönderildiyse geçerlidir.
            const streamed = await sent
            if (streamed !== null)
              throw new ScannerUnavailableError('clamd stream incomplete', {
                cause: streamed.error,
              })
            return { infected: false }
          }
          case 'error':
            throw new ScannerUnavailableError('clamd returned ERROR')
          case 'malformed':
            throw new ScannerUnavailableError(
              streamFailed ? 'clamd stream failed' : 'clamd reply malformed',
            )
          default:
            return reply satisfies never
        }
      } catch (error) {
        if (signal.aborted) throw failure()
        throw error
      } finally {
        signal.removeEventListener('abort', abort)
        // Erken yanıtta (zararlı, sınır, hata) kalan akış kesilir: soket ve giriş kapanır.
        socket.destroy()
        input.destroy()
      }
    },
  }
}

/** Ortamın tarayıcısı: `clamav` sürücüsü ya da `off` (`null`). */
export function createFileScanner(config: Config): FileScanner | null {
  const driver = fileScannerDriver(config)
  switch (driver) {
    case 'clamav':
      return createClamavScanner({
        host: config.CLAMAV_HOST,
        port: config.CLAMAV_PORT,
        timeoutMs: config.CLAMAV_TIMEOUT_MS,
      })
    case 'off':
      return null
    default:
      return driver satisfies never
  }
}
