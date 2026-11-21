import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

/** Akış, izin verilen boyutu aştı; yükleme kesilir, yarım nesne silinir (ADR 0003 karar 2). */
export class StreamLimitError extends Error {
  constructor() {
    super('upload stream exceeded its byte limit')
    this.name = 'StreamLimitError'
  }
}

/** Tür tespiti için tutulan baş kısım: OOXML (DOCX/PPTX/XLSX) zip girdileri de buna sığar. */
export const SNIFF_BYTES = 1024 * 1024

export interface MeteredUpload {
  /** Depoya verilecek akış; sınır aşılınca `StreamLimitError` ile hata verir. */
  stream: Readable
  /** Akış bittikten sonra: boyut, SHA-256 (hex) ve tür tespiti için baş kısım. */
  result: () => { byteSize: number; sha256: string; head: Buffer }
}

/**
 * Yükleme akışından geçerken boyutu sayar, SHA-256'yı hesaplar ve ilk `SNIFF_BYTES` baytı tutar;
 * dosya geçici diske yazılmaz. Sınır aşılınca kaynak akış bırakılır (yok edilir) ve dönen akış
 * hata verir; hata akışı tüketen `pipeline`'a gider.
 */
export function meterUpload(source: AsyncIterable<Buffer>, limitBytes: number): MeteredUpload {
  const hash = createHash('sha256')
  const head: Buffer[] = []
  let headBytes = 0
  let byteSize = 0
  async function* metered() {
    for await (const chunk of source) {
      byteSize += chunk.length
      if (byteSize > limitBytes) throw new StreamLimitError()
      hash.update(chunk)
      if (headBytes < SNIFF_BYTES) {
        const part = chunk.subarray(0, SNIFF_BYTES - headBytes)
        head.push(part)
        headBytes += part.length
      }
      yield chunk
    }
  }
  return {
    stream: Readable.from(metered(), { objectMode: false }),
    result: () => ({ byteSize, sha256: hash.digest('hex'), head: Buffer.concat(head) }),
  }
}
