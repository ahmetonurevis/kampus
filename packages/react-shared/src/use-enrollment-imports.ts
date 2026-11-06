import type { ImportFileInput } from '@kampus/school-core/lib/enrollment-import-cells.ts'

import {
  importInstallmentsRequest,
  importStudentsRequest,
  INSTALLMENT_IMPORT_INVALIDATES,
  STUDENT_IMPORT_INVALIDATES,
} from './enrollment-imports.ts'
import { useApiCommand } from './use-api-command.ts'

// Pilot verisi aktarımı kancaları (IST-007, ON-060, ON-061). Yalnız yönetici; `Idempotency-Key`
// kanca içinde yönetilir (`useApiCommand`). Taze oturum ve dosya hataları çağırana bırakılır.

export function useImportStudents() {
  return useApiCommand({
    request: (client, body: Required<ImportFileInput>, headers) =>
      importStudentsRequest(client, body, headers),
    invalidates: STUDENT_IMPORT_INVALIDATES,
  })
}

export function useImportInstallments() {
  return useApiCommand({
    request: (client, body: Required<ImportFileInput>, headers) =>
      importInstallmentsRequest(client, body, headers),
    invalidates: INSTALLMENT_IMPORT_INVALIDATES,
  })
}
