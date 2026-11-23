import type { Readable } from 'node:stream'

import type { FileScanJobData, FileScanScheduler } from '../../src/services/file-scan.ts'
import {
  ScanLimitExceededError,
  ScannerUnavailableError,
  type FileScanner,
  type ScanVerdict,
} from '../../src/services/file-scanner.ts'

/**
 * Dosya tarama testlerinin sahte bağımlılıkları (OG-092). INSTREAM istemcisi
 * `file-scanner.test.ts`'te sahte `clamd` sunucusuyla sınanır.
 */

export type FakeScanResult = 'clean' | 'infected' | 'unavailable' | 'limit'

/** Sahte imza adı: EICAR test dosyasının ClamAV'deki adı. */
export const FAKE_SIGNATURE = 'Eicar-Test-Signature'

/** Akışı sonuna kadar okur, okunan baytları kaydeder ve verilen sonucu döndürür. */
export class FakeFileScanner implements FileScanner {
  result: FakeScanResult = 'clean'
  readonly scanned: Buffer[] = []

  async scan(input: Readable): Promise<ScanVerdict> {
    const chunks: Buffer[] = []
    for await (const chunk of input) chunks.push(Buffer.from(chunk as Uint8Array))
    this.scanned.push(Buffer.concat(chunks))
    switch (this.result) {
      case 'clean':
        return { infected: false }
      case 'infected':
        return { infected: true, signature: FAKE_SIGNATURE }
      case 'unavailable':
        throw new ScannerUnavailableError('connect ECONNREFUSED 127.0.0.1:3310')
      case 'limit':
        throw new ScanLimitExceededError()
      default:
        return this.result satisfies never
    }
  }
}

/** Kuyruk açıkmış gibi davranan sahte: işi kaydeder, çalıştırmaz. */
export class RecordingScanScheduler implements FileScanScheduler {
  readonly queued: FileScanJobData[] = []

  async enqueue(_tx: unknown, data: FileScanJobData): Promise<void> {
    this.queued.push(data)
  }

  async afterCommit(): Promise<void> {}
}
