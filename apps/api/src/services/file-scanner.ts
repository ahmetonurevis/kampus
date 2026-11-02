import type { Readable } from 'node:stream'

import NodeClam from 'clamscan'

import { fileScannerDriver, type Config } from '../config.ts'

/**
 * Dosya tarayıcısı (ADR 0003 karar 8; OG-092, IST-027). `file.scan` işi depodaki nesneyi akışla
 * okur ve buraya verir. Sonuç yalnız temiz ya da zararlıdır (imza adıyla); tarayıcıya ulaşılamaz,
 * süre aşılır ya da yanıt belirsizse (`isInfected: null`, `ERROR`) `ScannerUnavailableError`
 * fırlatılır: geçici hatadır, iş yeniden denenir ve dosya taramasız `ready` olmaz.
 *
 * Sürücüler: `clamav` (`clamd`, `clamscan` paketiyle TCP `INSTREAM`); testte sahte tarayıcı
 * (`buildApp({ fileScan: { scanner } })`); `off` tarayıcı yoktur (`null`), yükleme bugünkü gibi
 * `pending` kalır. `AlertOLE2Macros`, `AlertEncrypted` ve PDF sezgileri `clamd` yapılandırmasındadır
 * (`deploy/clamav/clamd.conf`); sezgi bulguları (`Heuristics.*`) da zararlı sayılır.
 */

export type ScanVerdict = { infected: false } | { infected: true; signature: string }

export interface FileScanner {
  /** Akışı sonuna kadar tarar; sinyal iptal edilirse akış bırakılır ve geçici hata fırlar. */
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

export interface ClamavOptions {
  host: string
  port: number
  /** Bağlantı, akış ve yanıt dahil tek taramanın üst süresi. */
  timeoutMs: number
}

/**
 * `clamd` sürücüsü. İstemci ilk taramada bir kez kurulur; bağlantı denemesi (`ping`) atlanır
 * (`bypassTest`), böylece `clamd` kapalıyken API açılır ve tarama geçici hatayla ertelenir. Yerel
 * `clamscan`/`clamdscan` ikilisine düşülmez (`localFallback: false`), nesne diske yazılmaz.
 *
 * Paket kendi soket zaman aşımını bağlantıdan sonra uygulamaz; üst süre burada `AbortSignal` ile
 * tutulur. Süre dolunca giriş akışı bırakılır ve tarama geçici hatayla biter; yarım kalan bağlantıyı
 * `clamd` kendi okuma süresinde (`ReadTimeout`) kapatır.
 */
export function createClamavScanner(options: ClamavOptions): FileScanner {
  let client: Promise<NodeClam> | null = null
  const connect = () => {
    client ??= new NodeClam()
      .init({
        removeInfected: false,
        debugMode: false,
        clamscan: { active: false },
        clamdscan: {
          host: options.host,
          port: options.port,
          timeout: options.timeoutMs,
          localFallback: false,
          bypassTest: true,
          active: true,
        },
        preference: 'clamdscan',
      })
      .catch((error: unknown) => {
        client = null
        throw new ScannerUnavailableError('clamd client could not be initialised', {
          cause: error,
        })
      })
    return client
  }
  return {
    async scan(input, scanOptions = {}) {
      const deadline = AbortSignal.timeout(options.timeoutMs)
      const signal = scanOptions.signal ? AbortSignal.any([scanOptions.signal, deadline]) : deadline
      const clam = await connect()
      return new Promise<ScanVerdict>((resolve, reject) => {
        const abort = () => {
          input.destroy()
          reject(
            new ScannerUnavailableError(
              deadline.aborted ? 'clamd scan timed out' : 'clamd scan aborted',
            ),
          )
        }
        if (signal.aborted) return abort()
        signal.addEventListener('abort', abort, { once: true })
        clam.scanStream(input).then(
          (result) => {
            signal.removeEventListener('abort', abort)
            // `null`: süre aşımı ya da tanınmayan yanıt; temiz sayılmaz.
            const isInfected: unknown = result.isInfected
            if (isInfected === false) return resolve({ infected: false })
            if (isInfected === true)
              return resolve({ infected: true, signature: result.viruses[0] ?? 'unknown' })
            reject(new ScannerUnavailableError('clamd returned no verdict'))
          },
          (error: unknown) => {
            signal.removeEventListener('abort', abort)
            reject(new ScannerUnavailableError('clamd scan failed', { cause: error }))
          },
        )
      })
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
