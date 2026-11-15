import {
  EOKUL_IMPORT_INVALIDATES,
  importEokulStudentsRequest,
  type EokulImportBody,
} from './enrollment-eokul-imports.ts'
import { useApiCommand } from './use-api-command.ts'

// e-Okul öğrenci listesi aktarımı kancası (IST-134, ON-062). Yönetici ve ön büro; `Idempotency-Key`
// kanca içinde yönetilir (`useApiCommand`). Taze oturum ve dosya hataları çağırana bırakılır.

export function useImportEokulStudents() {
  return useApiCommand({
    request: (client, body: EokulImportBody, headers) =>
      importEokulStudentsRequest(client, body, headers),
    invalidates: EOKUL_IMPORT_INVALIDATES,
  })
}
