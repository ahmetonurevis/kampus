import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { useKampusClient } from './kampus-context.ts'
import {
  archivePermissionFormCommand,
  cancelPermissionFormCommand,
  closePermissionFormCommand,
  createPermissionFormCommand,
  decidePermissionCommand,
  fetchAllPermissionForms,
  fetchPermissionFormPage,
  getPermissionFormRequest,
  permissionFormItemKey,
  permissionFormListKey,
  updatePermissionFormCommand,
  type PermissionFormListQuery,
} from './permission-forms.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// İzin formu kancaları (`/permission-forms`, IST-067; DOM-ILT-030, -031, -036…039). `If-Match`
// formun `version`'ı (`version` girdisi); `Idempotency-Key` kanca içinde yönetilir
// (`useApiCommand`). Yetki ve kapsam sunucudadır; burada çağrı, tazeleme ve Türkçe hata vardır.

interface Options {
  enabled?: boolean
}

/** Sayfalı form listesi; yeni sayfa gelene kadar önceki sayfa kalır. */
export function usePermissionFormList(query: PermissionFormListQuery, options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...permissionFormListKey(query)),
    queryFn: ({ signal }) => fetchPermissionFormPage(client, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

/** Süzgece uyan bütün formlar; veli ve öğrenci ekranı tek listeyi çocuk bazında süzer. */
export function useAllPermissionForms(
  query: Omit<PermissionFormListQuery, 'page' | 'pageSize'>,
  options: Options = {},
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...permissionFormListKey(query), 'all'),
    queryFn: ({ signal }) => fetchAllPermissionForms(client, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
  })
}

/** Tek form ve okuyanın gördüğü öğrencilerin durumları (DOM-ILT-037). */
export function usePermissionForm(formId: string) {
  return useApiQuery({
    key: permissionFormItemKey(formId),
    request: (client, signal) => getPermissionFormRequest(client, formId, signal),
    enabled: formId !== '',
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

/** İzin formu açar (`POST /permission-forms`, 201; DOM-ILT-036). */
export function useCreatePermissionForm(options: CommandOptions = {}) {
  return useApiCommand({ ...createPermissionFormCommand, ...withSuccess(options) })
}

/** Formu düzenler (`PATCH /permission-forms/:id`, `If-Match`; DOM-ILT-038). */
export function useUpdatePermissionForm(options: CommandOptions = {}) {
  return useApiCommand({ ...updatePermissionFormCommand, ...withSuccess(options) })
}

/** Formu kapatır (`POST /permission-forms/:id/close`, `If-Match`); kararlar korunur. */
export function useClosePermissionForm(options: CommandOptions = {}) {
  return useApiCommand({ ...closePermissionFormCommand, ...withSuccess(options) })
}

/** Etkinliği iptal eder (`POST /permission-forms/:id/cancel`, `If-Match`; DOM-ILT-032). */
export function useCancelPermissionForm(options: CommandOptions = {}) {
  return useApiCommand({ ...cancelPermissionFormCommand, ...withSuccess(options) })
}

/** Kararsız formu arşivler (`DELETE /permission-forms/:id`, `If-Match`). */
export function useArchivePermissionForm(options: CommandOptions = {}) {
  return useApiCommand({ ...archivePermissionFormCommand, ...withSuccess(options) })
}

/** Veli ya da yetişkin öğrenci öğrenci için onay/ret verir (DOM-ILT-030, -031). */
export function useDecidePermission(options: CommandOptions = {}) {
  return useApiCommand({ ...decidePermissionCommand, ...withSuccess(options) })
}
