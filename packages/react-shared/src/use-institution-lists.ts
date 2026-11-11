import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useCallback } from 'react'

import type { ApiError } from '@kampus/api-client/errors.ts'

import {
  auditListKey,
  fetchAllAuditEvents,
  fetchAllPages,
  fetchAuditPage,
  fetchMemberPage,
  memberAllKey,
  memberListKey,
  type AuditEvent,
  type AuditQuery,
  type InstitutionMember,
  type ListPage,
  type MemberQuery,
} from './institution-lists.ts'
import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId, useMe } from './use-active-institution.ts'

interface Options {
  enabled?: boolean
}

/** Etkin kurum ve oturumun kullanıcısı; ikisi de belli olmadan yönetici listesi istenmez. */
function useListScope() {
  const institutionId = useActiveInstitutionId()
  const userId = useMe().data?.user.id ?? null
  return { institutionId, userId, ready: institutionId !== null && userId !== null }
}

/**
 * Kurum kullanıcıları (`GET /institution-members`, yalnız yönetici). Anahtar kurum ve kullanıcıya
 * bağlıdır; sorgu değişirken önceki sayfa ekranda kalır.
 */
export function useInstitutionMembers(
  query: MemberQuery,
  options: Options = {},
): UseQueryResult<ListPage<InstitutionMember>, ApiError> {
  const client = useKampusClient()
  const { institutionId, userId, ready } = useListScope()
  return useQuery<ListPage<InstitutionMember>, ApiError>({
    queryKey: institutionKey(institutionId, ...memberListKey(userId, query)),
    queryFn: ({ signal }) => fetchMemberPage(client, query, signal),
    enabled: ready && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

/**
 * Süzgece uyan bütün kullanıcılar (100'lük sayfalarla): ad eşlemesi gibi küçük kümeler için;
 * sayfa sınırı olan `useInstitutionMembers` kimlik çözümünde kişileri sessizce düşürürdü.
 * Sayfa sayısı sınırı aşılırsa `CollectionTooLargeError`.
 */
export function useInstitutionMembersAll(
  query: Omit<MemberQuery, 'page' | 'pageSize'>,
  options: Options = {},
): UseQueryResult<InstitutionMember[], ApiError> {
  const client = useKampusClient()
  const { institutionId, userId, ready } = useListScope()
  return useQuery<InstitutionMember[], ApiError>({
    queryKey: institutionKey(institutionId, ...memberAllKey(userId, query)),
    queryFn: ({ signal }) =>
      fetchAllPages<MemberQuery, InstitutionMember>(
        (pageQuery, pageSignal) => fetchMemberPage(client, pageQuery, pageSignal),
        query,
        signal,
      ),
    enabled: ready && (options.enabled ?? true),
  })
}

/** İşlem geçmişi (`GET /audit-events`, yalnız yönetici); en yeniden eskiye, sayfalı. */
export function useAuditEvents(
  query: AuditQuery,
  options: Options = {},
): UseQueryResult<ListPage<AuditEvent>, ApiError> {
  const client = useKampusClient()
  const { institutionId, userId, ready } = useListScope()
  return useQuery<ListPage<AuditEvent>, ApiError>({
    queryKey: institutionKey(institutionId, ...auditListKey(userId, query)),
    queryFn: ({ signal }) => fetchAuditPage(client, query, signal),
    enabled: ready && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

/** Filtrelenmiş bütün kullanıcılar (CSV); önbelleğe yazmaz. */
export function useInstitutionMembersFetchAll() {
  const client = useKampusClient()
  return useCallback(
    (query: Omit<MemberQuery, 'page' | 'pageSize'>) =>
      fetchAllPages<MemberQuery, InstitutionMember>(
        (pageQuery, signal) => fetchMemberPage(client, pageQuery, signal),
        query,
      ),
    [client],
  )
}

/** Filtrelenmiş bütün işlem geçmişi (CSV); önbelleğe yazmaz. */
export function useAuditEventsFetchAll() {
  const client = useKampusClient()
  return useCallback(
    (query: Omit<AuditQuery, 'page' | 'pageSize'>) => fetchAllAuditEvents(client, query),
    [client],
  )
}
