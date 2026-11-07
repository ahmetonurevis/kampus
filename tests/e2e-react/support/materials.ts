import { randomUUID } from 'node:crypto'

import pg from 'pg'

import type { ApiClient } from './api.ts'
import { e2e } from './env.ts'
import { expect } from './fixtures.ts'

/**
 * Materyal dosyası e2e kurulumu (OG-250, OG-982; DOM-KYN-006, 040): PDF örneği, taranmış sayma ve
 * API'den yayımlanıp paylaşılan materyal. Öğretmen akışı (`materyal-dosyasi.spec.ts`) dosyayı
 * arayüzden yükler; veli akışı (`veli-materyal.spec.ts`) kurulumu tamamen API'den yapar.
 */

export interface UploadFile {
  name: string
  mimeType: string
  buffer: Buffer
}

/** İçerikten tür tespitini geçen küçük PDF. */
export const pdf = (name: string): UploadFile => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(
    `%PDF-1.4\n% ${name}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`,
    'latin1',
  ),
})

/**
 * E2E API'si tarayıcısız koşar (`FILE_SCANNER=off`, clamd yok): yüklenen dosya `pending` kalır;
 * test kendi kurumunun dosyalarını doğrudan `ready` yapar (taramadan geçmiş gibi;
 * `sorular.spec.ts` ile aynı). Ses (`listening_audio`) iş kuyruğu kapalıyken dönüşüm bekleyerek
 * `processing` kalır; `processing: true` onları da dönüştürülmüş gibi `ready` yapar (OG-052).
 */
export async function markFilesReady(
  institutionId: string,
  options: { processing?: boolean } = {},
): Promise<void> {
  const statuses = options.processing ? ['pending', 'processing'] : ['pending']
  const client = new pg.Client({ connectionString: e2e.databaseUrl })
  await client.connect()
  try {
    const result = await client.query(
      "update files set status = 'ready' where institution_id = $1 and status = any($2::text[])",
      [institutionId, statuses],
    )
    expect(result.rowCount).toBeGreaterThan(0)
  } finally {
    await client.end()
  }
}

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function ok(result: { status: number; body: unknown }, status: number): Promise<Json> {
  expect(result.status, JSON.stringify(result.body)).toBe(status)
  return (result.body as { data: Json }).data
}

const idempotent = () => ({ 'idempotency-key': randomUUID() })
const versioned = (version: number) => ({ ...idempotent(), 'if-match': `"${String(version)}"` })

/** Dosyayı `material` amacıyla yükler (multipart: önce `purpose`, sonra `file`); kimliği döner. */
export async function uploadMaterialFile(client: ApiClient, file: UploadFile): Promise<string> {
  const response = await client.context.fetch('/api/v1/files', {
    method: 'POST',
    multipart: { purpose: 'material', file },
    headers: idempotent(),
    failOnStatusCode: false,
  })
  const body = (await response.json()) as { data: { id: string } }
  expect(response.status(), JSON.stringify(body)).toBe(201)
  return body.data.id
}

export interface SharedMaterial {
  resourceId: string
  fileId: string
}

export interface PublishedMaterial extends SharedMaterial {
  /** Kaynağın yayından sonraki `rowVersion` değeri (paylaşımın `If-Match`'i). */
  rowVersion: number
}

/**
 * Öğretmen materyal dosyasını yükler, içerik havuzunda kurum özgün materyal açar ve onaysız
 * yayımlar (kendi kapsamlı özgün içerik onaya girmez, DOM-KYN-031); kapsam `Yalnız ben` kalır.
 * Dosya bağlanmadan önce `ready` yapılır.
 */
export async function publishMaterial(
  teacher: ApiClient,
  institutionId: string,
  input: { title: string; file: UploadFile; gradeLevel: number },
): Promise<PublishedMaterial> {
  const fileId = await uploadMaterialFile(teacher, input.file)
  await markFilesReady(institutionId)
  const created = await ok(
    await teacher.post(
      '/api/v1/resources',
      {
        title: input.title,
        content: { type: 'file', fileId },
        fileIds: [fileId],
        license: { kind: 'institution_original' },
        tags: {
          subjectId: 'math',
          gradeLevels: [input.gradeLevel],
          outcomes: [
            { outcomeId: `MAT.${String(input.gradeLevel)}.1.1`, outcomeSource: 'platform' },
          ],
        },
      },
      idempotent(),
    ),
    201,
  )
  const resourceId = created.resource.id as string
  const published = await ok(
    await teacher.post(
      `/api/v1/resources/${resourceId}/versions/${created.version.id as string}/publish`,
      {},
      versioned(created.version.rowVersion as number),
    ),
    200,
  )
  return { resourceId, fileId, rowVersion: published.resource.rowVersion as number }
}

/**
 * `publishMaterial` ve ardından öğretmenin ders verdiği sınıflarla paylaşım (DOM-KYN-040).
 */
export async function publishSharedMaterial(
  teacher: ApiClient,
  institutionId: string,
  input: { title: string; file: UploadFile; gradeLevel: number; classIds: readonly string[] },
): Promise<SharedMaterial> {
  const { resourceId, fileId, rowVersion } = await publishMaterial(teacher, institutionId, input)
  await ok(
    await teacher.post(
      `/api/v1/resources/${resourceId}/share`,
      { scope: 'classes', classIds: [...input.classIds] },
      versioned(rowVersion),
    ),
    200,
  )
  return { resourceId, fileId }
}
