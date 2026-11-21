import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Personel özlük kartı kancaları (`/finance/personnel-files`; DOM-FIN-140, ON-172). Yanıt yalnız
// okuyanın görebildiği grupları taşır (K-475); tam T.C. kimlik no ayrı uçtan, yalnız yöneticiye ve
// her okumada denetimle döner (K-476): yalnız istendiği an okunur, önbellekte tutulmaz.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never
type Query<TOperation extends keyof operations> = operations[TOperation]['parameters'] extends {
  query?: infer TQuery
}
  ? NonNullable<TQuery>
  : never

export type PersonnelFileStaffRow =
  operations['listPersonnelFiles']['responses'][200]['content']['application/json']['data'][number]
export type PersonnelFileStaffQuery = Query<'listPersonnelFiles'>
export type PersonnelFileView =
  operations['getPersonnelFile']['responses'][200]['content']['application/json']['data']
export type CreatePersonnelFileBody = JsonBody<'createPersonnelFile'>
export type UpdatePersonnelFileBody = JsonBody<'updatePersonnelFile'>

export const PERSONNEL_FILES_KEY = ['finance', 'personnel-files'] as const
const MESSAGES = {
  version_conflict: 'Özlük kartı başka biri tarafından değiştirildi. Kart güncellendi.',
}

export function usePersonnelFiles(query: PersonnelFileStaffQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...PERSONNEL_FILES_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/personnel-files', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function usePersonnelFile(membershipId: string) {
  return useApiQuery({
    key: [...PERSONNEL_FILES_KEY, 'detail', membershipId],
    enabled: membershipId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/personnel-files/{membershipId}', {
        params: { path: { membershipId } },
        signal,
      }),
  })
}

/**
 * Tam T.C. kimlik no (K-476): kapalı başlar, `show` ile okur, `hide` ile bellekten atar; personel
 * değişince yeniden kapanır. Her okuma sunucuda denetim kaydı bıraktığı için önbellekte tutulmaz
 * (`gcTime: 0`), pencere odağı ve yeniden bağlanma yeni okuma başlatmaz.
 */
export function usePersonnelNationalIdReveal(membershipId: string) {
  const queryClient = useQueryClient()
  const institutionId = useActiveInstitutionId()
  const [revealedFor, setRevealedFor] = useState<string | null>(null)
  if (revealedFor !== null && revealedFor !== membershipId) setRevealedFor(null)
  const revealed = revealedFor === membershipId
  // Kart anahtarının dışında: kart yazması tazelediğinde yeni okuma (yeni denetim satırı) olmaz.
  const key = ['finance', 'personnel-national-id', membershipId] as const
  const query = useApiQuery({
    key,
    enabled: revealed,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    request: (client, signal) =>
      client.GET('/api/v1/finance/personnel-files/{membershipId}/national-id', {
        params: { path: { membershipId } },
        signal,
      }),
  })
  return {
    revealed,
    query,
    show: () => setRevealedFor(membershipId),
    hide: () => {
      setRevealedFor(null)
      queryClient.removeQueries({ queryKey: institutionKey(institutionId, ...key) })
    },
  }
}

export function useCreatePersonnelFile() {
  return useApiCommand({
    request: (client, body: CreatePersonnelFileBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/personnel-files', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [PERSONNEL_FILES_KEY],
    exclusive: true,
  })
}

export function useUpdatePersonnelFile() {
  return useApiCommand({
    request: (
      client,
      input: { membershipId: string; version: number; body: UpdatePersonnelFileBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/personnel-files/{membershipId}', {
        params: {
          path: { membershipId: input.membershipId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [PERSONNEL_FILES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
