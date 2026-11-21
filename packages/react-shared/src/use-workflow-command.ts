import type { CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import {
  postWorkflowCommand,
  workflowInvalidates,
  workflowVersion,
  type CommandResult,
  type WorkflowCommand,
  type WorkflowCommandInput,
} from './workflow-commands.ts'

/** Kayıt başka biri tarafından değiştirildi (409 `version_conflict`); liste aynı anda tazelenir. */
export const VERSION_CONFLICT_MESSAGE =
  'Kayıt başka biri tarafından değiştirildi. Güncel bilgiler yüklendi; yeniden deneyin.'

interface WorkflowCommandOptions {
  messages?: CommandMessages
  onSuccess?: (data: { data: CommandResult }) => void | Promise<void>
}

/**
 * Okul iş akışı komutu (`POST /workflows/<komut>[/:recordId]`). `useApiCommand` kalıbıdır: her
 * kullanıcı eylemine `Idempotency-Key` (`exam-import`, `renewal`'da sunucu zorunlu tutar),
 * konusu olan komutta okunan sürümle `If-Match`, çift tıklama kilidi, başarıda ve 409'da
 * komutun koleksiyonlarının tazelenmesi, `ApiError.issues` → `setError`.
 */
export function useWorkflowCommand(command: WorkflowCommand, options: WorkflowCommandOptions = {}) {
  return useApiCommand({
    request: (client, input: WorkflowCommandInput, headers) =>
      postWorkflowCommand(client, command, input, headers),
    invalidates: workflowInvalidates(command),
    version: workflowVersion,
    messages: { version_conflict: VERSION_CONFLICT_MESSAGE, ...options.messages },
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}
