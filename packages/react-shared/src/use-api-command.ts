import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { KampusClient } from '@kampus/api-client/client.ts'

import type { ApiResult, DataOf } from './api-result.ts'
import {
  createCommandSession,
  invalidateInstitutionQueries,
  routeCommandErrors,
  runCommand,
  type CommandHeaders,
  type CommandMessages,
  type CommandOutcome,
  type InlineErrorRoutes,
  type SetFieldError,
} from './commands.ts'
import { useNotifyError } from './kampus-context.ts'
import { useApiMutation } from './use-api-mutation.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'

export interface ApiCommandOptions<TVariables, TResult extends ApiResult> {
  /** `client.POST(...)`; `headers` `params.header`'a verilir (`Idempotency-Key`, `If-Match`). */
  request: (
    client: KampusClient,
    variables: TVariables,
    headers: CommandHeaders,
  ) => Promise<TResult>
  /**
   * Başarıda ve 409 çakışmada geçersiz kılınacak sorgu önekleri; etkin kurum kendiliğinden
   * eklenir (ör. `collectionKeyPrefix('invoices')`).
   */
  invalidates: readonly (readonly unknown[])[]
  /** Konu kaydın okunan sürümü; verilirse `If-Match` gönderilir, tutmazsa 409 `version_conflict`. */
  version?: (variables: TVariables) => number | null | undefined
  /** Koda özgü kullanıcı mesajı (ör. `invoice_already_paid`); yoksa sunucunun mesajı. */
  messages?: CommandMessages
  onSuccess?: (data: DataOf<TResult>, variables: TVariables) => void | Promise<void>
}

export interface SubmitOptions<TName extends string> extends InlineErrorRoutes {
  /** react-hook-form `form.setError`: sunucu doğrulama maddeleri alanlara yazılır. */
  setError?: (name: TName, error: { type: string; message: string }) => void
}

/**
 * Yazma komutu kancası (`useApiMutation` üzerinde): her kullanıcı eylemine yeni
 * `Idempotency-Key`, belirsiz hatadan (ağ, 5xx) sonra aynı gövdenin yeniden gönderiminde aynı
 * anahtar; eşzamanlı kilit (çift tıklama tek istek); başarıda ve 409'da sorgu tazeleme; hata
 * bildirimi (toast) ve alan hatası (`setError`). `submit` hata fırlatmaz, sonucu döndürür.
 */
export function useApiCommand<TVariables, TResult extends ApiResult>(
  options: ApiCommandOptions<TVariables, TResult>,
) {
  const queryClient = useQueryClient()
  const institutionId = useActiveInstitutionId()
  const notifyError = useNotifyError()
  // Kilit ve anahtar bileşen ömrü boyunca aynı nesnede yaşar; değişmesi çizim gerektirmez.
  const [session] = useState(createCommandSession)

  const mutation = useApiMutation<{ variables: TVariables; headers: CommandHeaders }, TResult>({
    request: (client, { variables, headers }) => options.request(client, variables, headers),
    invalidates: options.invalidates,
    onSuccess: (data, { variables }) => options.onSuccess?.(data, variables),
  })

  function submit<TName extends string = string>(
    variables: TVariables,
    { setError, fieldFor, silent }: SubmitOptions<TName> = {},
  ): Promise<CommandOutcome<DataOf<TResult>>> {
    return runCommand(
      session,
      {
        execute: (input, headers) => mutation.mutateAsync({ variables: input, headers }),
        version: options.version,
        refresh: () =>
          invalidateInstitutionQueries(queryClient, institutionId, options.invalidates),
        messages: options.messages,
      },
      variables,
      // Sunucu yolu formun alan adıdır; tanınmayan yol react-hook-form'da yalnız boşta bir hatadır.
      routeCommandErrors(
        { setError: setError as SetFieldError | undefined, notifyError },
        { fieldFor, silent },
      ),
    )
  }

  return {
    submit,
    /** Gönderim sürüyor: düğme kilitli, `aria-busy`. */
    isPending: mutation.isPending,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  }
}
