import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import {
  applyApiErrorToForm,
  issuesToFieldIssues,
  type ApiError,
  type FieldIssue,
} from '@kampus/api-client/errors.ts'

import { runRequest, type ApiResult, type DataOf } from './api-result.ts'
import { invalidateInstitutionQueries } from './commands.ts'
import { useKampusClient } from './kampus-context.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'

export interface ApiMutationOptions<TVariables, TResult extends ApiResult> {
  /** `client.POST(...)` vb. çağrı. Komut uçlarında (`Idempotency-Key`) `useApiCommand` kullanın. */
  request: (client: KampusClient, variables: TVariables) => Promise<TResult>
  /** Başarıdan sonra geçersiz kılınacak sorgu anahtarı önekleri (kurum kendiliğinden eklenir). */
  invalidates?: readonly (readonly unknown[])[]
  onSuccess?: (data: DataOf<TResult>, variables: TVariables) => void | Promise<void>
}

export type ApiMutationResult<TData, TVariables> = UseMutationResult<
  TData,
  ApiError,
  TVariables
> & {
  /** Sunucu doğrulama maddeleri, react-hook-form `setError` biçiminde (alan yolu noktalıdır). */
  fieldIssues: FieldIssue[]
  /** Hatayı forma yazar; `setError` `form.setError`'dır. Aktarılacak hata yoksa `false`. */
  applyToForm: <TName extends string>(
    setError: (name: TName, error: { type: string; message: string }) => void,
  ) => boolean
}

/**
 * `openapi-fetch` yazma çağrısını TanStack Query mutasyonu olarak çalıştıran ince sarmalayıcı.
 * Hata her zaman `ApiError`'dır; `fieldIssues`/`applyToForm` doğrulama maddelerini form
 * alanlarına taşır, kalan hatalar toast içindir.
 */
export function useApiMutation<TVariables, TResult extends ApiResult>(
  options: ApiMutationOptions<TVariables, TResult>,
): ApiMutationResult<DataOf<TResult>, TVariables> {
  const client = useKampusClient()
  const queryClient = useQueryClient()
  const institutionId = useActiveInstitutionId()

  const mutation = useMutation<DataOf<TResult>, ApiError, TVariables>({
    mutationFn: (variables) => runRequest(() => options.request(client, variables)),
    onSuccess: async (data, variables) => {
      await invalidateInstitutionQueries(queryClient, institutionId, options.invalidates ?? [])
      await options.onSuccess?.(data, variables)
    },
  })

  const error = mutation.error
  return {
    ...mutation,
    fieldIssues: error ? issuesToFieldIssues(error.issues) : [],
    applyToForm: (setError) => applyApiErrorToForm(error, setError),
  }
}
