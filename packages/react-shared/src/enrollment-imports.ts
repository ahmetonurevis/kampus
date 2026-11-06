import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components } from '@kampus/api-client/schema.d.ts'
import type { ImportFileInput } from '@kampus/school-core/lib/enrollment-import-cells.ts'

import { collectionKeyPrefix } from './collections.ts'
import type { CommandHeaders } from './commands.ts'

/**
 * Pilot verisi aktarımı uçlarının saf yardımcıları (IST-007, ON-060, ON-061): istek kurucular,
 * hata ayrımı ve geçersiz kılınacak sorgular. Kancalar `use-enrollment-imports.ts`'tedir. Uçlar
 * taze oturum ister; 403 `reauthentication_required` çağıranın parola penceresine gider.
 */

export type StudentImportResult = components['schemas']['StudentImportResult']
export type StudentImportRowResult = components['schemas']['StudentImportRow']
export type InstallmentImportResult = components['schemas']['InstallmentImportResult']
export type InstallmentImportRowResult = components['schemas']['InstallmentImportRow']
export type ImportRowIssue = components['schemas']['ImportIssue']

export const STUDENT_IMPORT_INVALIDATES: readonly (readonly unknown[])[] = [
  collectionKeyPrefix('students'),
  collectionKeyPrefix('parents'),
]
export const INSTALLMENT_IMPORT_INVALIDATES: readonly (readonly unknown[])[] = [
  collectionKeyPrefix('invoices'),
  collectionKeyPrefix('contracts'),
  // Finans kartları, bakiye ve ekstre `['payments', …]`, dönem özeti `['finance-summary', …]`'dedir.
  ['payments'],
  ['finance-summary'],
]

export function importStudentsRequest(
  client: KampusClient,
  body: Required<ImportFileInput>,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/prospects/student-imports', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

export function importInstallmentsRequest(
  client: KampusClient,
  body: Required<ImportFileInput>,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/finance/installment-imports', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

const INVALID_CODES = new Set(['student_import_invalid', 'installment_import_invalid'])

/** Dosya düzeyindeki sorun: başlık, satır sınırı, okunamayan dosya (422; alana yazılır). */
export function isImportFileError(error: ApiError): boolean {
  return error.status === 422 && /^(csv_|import_file_)/.test(error.code)
}

/** 422 satır hatası mı (önizlemeden sonra değişen kurum ya da hatalı dosyada onay). */
export const isImportRowsError = (error: ApiError) =>
  error.status === 422 && INVALID_CODES.has(error.code)

/**
 * Onayın satır hatalarını (`['rows', satır, alan?]`, ileti "N. satır: …") önizleme tablosunun
 * satırlarına çevirir; başka hata `null`.
 */
export function importIssuesOf(error: ApiError): ImportRowIssue[] | null {
  if (!isImportRowsError(error)) return null
  return error.issues.flatMap((issue) => {
    const [root, line, field = null] = issue.path
    if (root !== 'rows' || typeof line !== 'number') return []
    return [
      {
        line,
        field: typeof field === 'string' ? field : null,
        code: issue.code,
        message: issue.message.replace(/^\d+\. satır: /, ''),
      },
    ]
  })
}
