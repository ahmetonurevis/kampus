import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components } from '@kampus/api-client/schema.d.ts'
import type { EokulImportInput } from '@kampus/school-core/lib/enrollment-eokul-import.ts'

import { collectionKeyPrefix } from './collections.ts'
import type { CommandHeaders } from './commands.ts'

/**
 * e-Okul öğrenci listesi aktarımının saf yardımcıları (IST-134, ON-062; DOM-KAY-042): istek kurucu
 * ve geçersiz kılınacak sorgular. Kanca `use-enrollment-eokul-imports.ts`'tedir. Uç taze oturum
 * ister; dosya ve satır hataları pilot aktarımın yardımcılarıyla ayrılır (`enrollment-imports.ts`).
 */

export type EokulImportResult = components['schemas']['EokulImportResult']
export type EokulImportRowResult = components['schemas']['EokulImportRow']
export type EokulMappingResult = components['schemas']['EokulMapping']

export const EOKUL_IMPORT_INVALIDATES: readonly (readonly unknown[])[] = [
  collectionKeyPrefix('students'),
  collectionKeyPrefix('parents'),
]

export type EokulImportBody = Omit<EokulImportInput, 'dryRun'> & { dryRun: boolean }

export function importEokulStudentsRequest(
  client: KampusClient,
  body: EokulImportBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/prospects/eokul-student-imports', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

/** Onayın eşleme hatası (422 `eokul_mapping_invalid`): önizleme yeniden alınmalı. */
export const isEokulMappingError = (error: { status: number; code: string }) =>
  error.status === 422 && error.code === 'eokul_mapping_invalid'
