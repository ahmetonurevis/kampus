import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components } from '@kampus/api-client/schema.d.ts'
import {
  WORKFLOW_COMMANDS,
  isWorkflowCommand,
  type WorkflowCommand,
} from '@kampus/school-core/modules/commands.ts'

import type { ApiResult } from './api-result.ts'
import { collectionKeyPrefix } from './collections.ts'
import type { CommandHeaders } from './commands.ts'

/**
 * Okul iş akışı köprüsü (`POST /api/v1/workflows/<komut>[/:recordId]`, api-tasarimi.md §1) için
 * saf yardımcılar. Hook `use-workflow-command.ts`'tedir; burası React olmadan test edilir.
 * Komutun modülü ve okuyup yazabileceği koleksiyonlar core komut tablosundandır
 * (`WORKFLOW_COMMANDS`); istemci kopya tutmaz.
 */

export type { WorkflowCommand }
export type CommandResult = components['schemas']['CommandResult']

export interface WorkflowCommandInput {
  /** Komutun konusu (ör. hedef kimliği); kimliksiz oluşturma komutlarında verilmez. */
  recordId?: string | undefined
  /**
   * Konu kaydın okunan sürümü: verilirse `If-Match` gider, tutmazsa 409 `version_conflict`.
   * Konusu olmayan oluşturmada gönderilmez (sunucu 400 `if_match_not_supported` döner).
   */
  version?: number | null | undefined
  /** Yalnız veli: işlemin yapıldığı çocuk (`?childId=`). */
  childId?: string | undefined
  /** Form değerleri; core şemasını sunucu uygular (ham gövde gönderilir). */
  body: Readonly<Record<string, unknown>>
}

/** Komutun yolu (openapi-fetch şablonu); konu kimliği `params.path`'ten yerleşir. */
export function workflowCommandPath(command: WorkflowCommand, recordId?: string): string {
  return recordId === undefined
    ? `/api/v1/workflows/${command}`
    : `/api/v1/workflows/${command}/{recordId}`
}

/**
 * Başarıda ve 409 çakışmada tazelenecek koleksiyonlar: komutun okuduğu ve yazabileceği bütün
 * koleksiyonlar (kapsam kaynakları dahil; ör. `club` kulübü, `renewal-activate` öğrencinin
 * sınıfını yazar). Fazla tazeleme yanlış veriden ucuzdur.
 */
export function workflowInvalidates(command: WorkflowCommand): unknown[][] {
  return WORKFLOW_COMMANDS[command].collections.map((collection) => collectionKeyPrefix(collection))
}

/** If-Match yalnız konusu olan komutta ve sürüm biliniyorsa. */
export function workflowVersion(input: WorkflowCommandInput): number | null {
  if (input.recordId === undefined) return null
  return typeof input.version === 'number' ? input.version : null
}

/** Dışarıdan gelen komut adını doğrular; bilinmeyen ad programlama hatasıdır. */
export function requireWorkflowCommand(name: string): WorkflowCommand {
  if (!isWorkflowCommand(name)) throw new Error(`Bilinmeyen iş akışı komutu: ${name}`)
  return name
}

type WorkflowResult = ApiResult & { data?: { data: CommandResult } }
type WorkflowPost = (
  path: string,
  init: {
    params: {
      path?: { recordId: string }
      query?: { childId: string }
      header: CommandHeaders
    }
    body: Readonly<Record<string, unknown>>
  },
) => Promise<WorkflowResult>

/**
 * İsteği gönderir. Her komut OpenAPI'de ayrı işlemdir (34 yol); yol komuttan üretildiği için
 * openapi-fetch'in yol başına tipi burada tek imzaya indirilir. Gövde ve yanıt şeması sunucuda
 * core `workflowSchemas` ve `CommandResult` ile doğrulanır.
 */
export function postWorkflowCommand(
  client: KampusClient,
  command: WorkflowCommand,
  input: WorkflowCommandInput,
  headers: CommandHeaders,
): Promise<WorkflowResult> {
  const post = client.POST as unknown as WorkflowPost
  return post(workflowCommandPath(command, input.recordId), {
    params: {
      ...(input.recordId === undefined ? {} : { path: { recordId: input.recordId } }),
      ...(input.childId ? { query: { childId: input.childId } } : {}),
      header: headers,
    },
    body: input.body,
  })
}
