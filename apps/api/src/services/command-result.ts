import type { WrittenRecord } from '../db/records.ts'
import type { OperationResponse } from './operation-runner.ts'

/** Komut uçlarının tek yanıt biçimi (`CommandResult`, `routes/commands.schemas.ts`): `{ data }`. */
export function commandBody(
  entity: { collection: string; id: string } | null,
  changes: readonly WrittenRecord[],
  /** Oluşturma uçlarında 201 (api-tasarimi.md §1); idempotent tekrar aynı durumu döndürür. */
  statusCode = 200,
  /** Uca özgü ek yanıt alanları (ör. kesin kayıtta `contractId`); yanıt şeması tanımlar. */
  extra: Readonly<Record<string, string>> = {},
): OperationResponse {
  const count = (kind: WrittenRecord['kind']) =>
    changes.filter((change) => change.kind === kind).length
  return {
    statusCode,
    body: {
      data: {
        ...extra,
        entity,
        changes: {
          inserted: count('insert'),
          updated: count('update'),
          archived: count('archive'),
          restored: count('restore'),
        },
        records: changes.map((change) => ({
          collection: change.collection,
          id: change.id,
          version: change.version,
          change: change.kind,
        })),
      },
    },
  }
}
