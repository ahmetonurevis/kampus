import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useKampusClient } from './kampus-context.ts'
import {
  cancelGroupCommand,
  createGroupCommand,
  fetchAllGroups,
  fetchGroupPage,
  LANGUAGE_GROUPS_KEY,
  mergeGroupCommand,
  openGroupCommand,
  updateGroupCommand,
  type GroupListQuery,
} from './language-groups.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Dil okulu grup kancaları (`/groups`, IST-077; DOM-DIL-008, -040…043). Okuma kapsamı sunucudadır:
// öğrenci ve veli yalnız kursiyer olunan grubu ve takvim alanlarını alır.

interface Options {
  enabled?: boolean
}

/** Sayfalı grup listesi; süzgeç değişirken önceki sayfa ekranda kalır. */
export function useLanguageGroups(query: GroupListQuery, options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...LANGUAGE_GROUPS_KEY, 'list', query),
    queryFn: ({ signal }) => fetchGroupPage(client, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

/** Süzgeçle bütün gruplar (öğrenci/veli takvimi, birleştirme kaynakları). */
export function useAllLanguageGroups(
  query: Omit<GroupListQuery, 'page' | 'pageSize'>,
  options: Options = {},
) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery({
    queryKey: institutionKey(institutionId, ...LANGUAGE_GROUPS_KEY, 'all', query),
    queryFn: ({ signal }) => fetchAllGroups(client, query, signal),
    enabled: institutionId !== null && (options.enabled ?? true),
  })
}

/** Filtrelenmiş bütün gruplar (CSV); önbelleğe yazmaz. */
export function useLanguageGroupsFetchAll() {
  const client = useKampusClient()
  return useCallback(
    (query: Omit<GroupListQuery, 'page' | 'pageSize'>) => fetchAllGroups(client, query),
    [client],
  )
}

/** Tek grup; personele kursiyer listesi (`members`) de döner. */
export function useLanguageGroup(groupId: string) {
  return useApiQuery({
    key: [...LANGUAGE_GROUPS_KEY, 'item', groupId],
    request: (client, signal) =>
      client.GET('/api/v1/groups/{groupId}', { params: { path: { groupId } }, signal }),
    enabled: groupId !== '',
  })
}

/** Grubun ve kurunun bekleme sırası, açık teklifler ve teklif önerisi (salt okunur). */
export function useGroupWaitlist(groupId: string, options: Options = {}) {
  return useApiQuery({
    key: [...LANGUAGE_GROUPS_KEY, 'waitlist', groupId],
    request: (client, signal) =>
      client.GET('/api/v1/groups/{groupId}/waitlist', { params: { path: { groupId } }, signal }),
    enabled: groupId !== '' && (options.enabled ?? true),
  })
}

interface CommandOptions {
  onSuccess?: () => void | Promise<void>
}
const withSuccess = (options: CommandOptions) =>
  options.onSuccess ? { onSuccess: options.onSuccess } : {}

/** Etkin kurdan grup planlar (`POST /groups`, 201); bitiş tarihi sunucuda hesaplanır. */
export function useCreateLanguageGroup(options: CommandOptions = {}) {
  return useApiCommand({ ...createGroupCommand, ...withSuccess(options) })
}

export function useUpdateLanguageGroup(options: CommandOptions = {}) {
  return useApiCommand({ ...updateGroupCommand, ...withSuccess(options) })
}

/** Planlanan grubu açar (asgari sayı, öğretmen ve derslik zorunlu). */
export function useOpenLanguageGroup(options: CommandOptions = {}) {
  return useApiCommand({ ...openGroupCommand, ...withSuccess(options) })
}

/** Grubu gerekçeyle iptal eder. */
export function useCancelLanguageGroup(options: CommandOptions = {}) {
  return useApiCommand({ ...cancelGroupCommand, ...withSuccess(options) })
}

/** Kaynak grubu hedefe birleştirir; kaynak iptal olur, kursiyerleri ve sırası taşınır. */
export function useMergeLanguageGroup(options: CommandOptions = {}) {
  return useApiCommand({ ...mergeGroupCommand, ...withSuccess(options) })
}
