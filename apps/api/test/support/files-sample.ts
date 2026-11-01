import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DiskStorage, storageSigningKey } from '../../src/storage/disk.ts'

/** Dosya testlerinin örnek içerikleri, multipart gövdesi ve geçici disk deposu (ADR 0003). */

export const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
)

/** Geçerli imzalı PNG başlığı; `size` bayta dolgu eklenir (boyut sınırı denemeleri). */
export function png(size = 64): Buffer {
  const header = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c489',
    'hex',
  )
  return Buffer.concat([header, Buffer.alloc(Math.max(0, size - header.length))])
}

/** ID3 başlıklı MP3. */
export const MP3 = Buffer.concat([
  Buffer.from('4944330300000000000a', 'hex'),
  Buffer.alloc(10),
  Buffer.from('fffb9064', 'hex'),
  Buffer.alloc(400),
])

export const TEXT = Buffer.from('düz metin; tanınan bir dosya türü değil\n'.repeat(4))

export type Part =
  | { name: string; value: string }
  | { name: string; fileName: string; contentType: string; data: Buffer }

/** `multipart/form-data` gövdesi; parçalar verilen sırayla yazılır. */
export function multipart(parts: readonly Part[]) {
  const boundary = `----kampus-test-${randomUUID()}`
  const chunks: Buffer[] = []
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`))
    if ('value' in part) {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`),
      )
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.fileName}"\r\n` +
            `Content-Type: ${part.contentType}\r\n\r\n`,
        ),
        part.data,
        Buffer.from('\r\n'),
      )
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

export function uploadParts(
  purpose: string,
  data: Buffer,
  fileName = 'odev.pdf',
  contentType = 'application/pdf',
): Part[] {
  return [
    { name: 'purpose', value: purpose },
    { name: 'file', fileName, contentType, data },
  ]
}

export const TEST_SECRET = 'test-secret-test-secret-test-secret-0123'

/** Geçici klasörde disk deposu; `files()` kökteki bütün dosyaları (geçici dahil) listeler. */
export async function tempStorage(baseUrl = 'http://localhost:3000') {
  const root = await mkdtemp(join(tmpdir(), 'kampus-files-'))
  const storage = new DiskStorage({ root, baseUrl, signingKey: storageSigningKey(TEST_SECRET) })
  return {
    root,
    storage,
    files: async () =>
      (await readdir(root, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name)),
    remove: () => rm(root, { recursive: true, force: true }),
  }
}
