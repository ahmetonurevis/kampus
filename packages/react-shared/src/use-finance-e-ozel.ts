import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch } from './commands.ts'
import { STUDENT_IDENTITY_QUERY_POLICY } from './enrollment-identity.ts'
import { institutionKey } from './query-keys.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// e-Özel işlem listesi kancaları (`/finance/e-ozel`; IST-085, DOM-KAY-015). Platform e-Özel'e
// bağlanmaz: liste elle işlem içindir, işaret kim/ne zaman bilgisiyle tutulur.

export type EOzelListQuery = NonNullable<operations['listEOzelItems']['parameters']['query']>
export type EOzelItemRow =
  operations['listEOzelItems']['responses'][200]['content']['application/json']['data'][number]
export type EOzelFileQuery = NonNullable<operations['exportEOzelItems']['parameters']['query']>

const E_OZEL_KEY = ['payments', 'e-ozel'] as const

export const E_OZEL_CHANGED_MESSAGE = 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.'

export function useEOzelItems(query: EOzelListQuery) {
  return useApiQuery({
    key: [...E_OZEL_KEY, 'list', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/e-ozel/items', { params: { query }, signal }),
  })
}

/**
 * İşaretler ya da geri alır. Anahtar `payments` altındadır: ücret satırı tahsilatın MEBBİS
 * işaretidir, tahsilat geçmişi de tazelenir.
 */
export function useSetEOzelMark() {
  return useApiCommand({
    request: (
      client,
      input: { kind: EOzelItemRow['kind']; sourceId: string; version: number; recorded: boolean },
      headers,
    ) =>
      client.POST('/api/v1/finance/e-ozel/items/{kind}/{sourceId}/record', {
        params: {
          path: { kind: input.kind, sourceId: input.sourceId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: { recorded: input.recorded },
      }),
    invalidates: [['payments']],
    version: (input) => input.version,
    messages: { version_conflict: E_OZEL_CHANGED_MESSAGE },
  })
}

/** `payments` altında değildir: tahsilat tazelemesi yeni okuma (yeni denetim satırı) başlatmamalı. */
export const eOzelIdentityKey = (studentId: string) => ['e-ozel-identity', studentId] as const

export function eOzelIdentityRequest(
  client: KampusClient,
  studentId: string,
  signal?: AbortSignal,
) {
  return client.GET('/api/v1/finance/e-ozel/learners/{studentId}/identity', {
    params: { path: { studentId } },
    ...(signal ? { signal } : {}),
  })
}

/**
 * Tek satırın tam kimlik numarası: her okuma sunucuda denetime yazılır (DOM-YTK-052), bu yüzden
 * kapalı başlar ve aynı anda tek satır açıktır. `hide`, başka satırı açmak ya da satırın listeden
 * çıkması numarayı bellekten atar (`gcTime: 0`); odak ve yeniden bağlanma yeni okuma başlatmaz.
 * `visibleStudentIds` listedeki kursiyerlerdir; liste yüklenirken (`undefined`) durum korunur.
 */
export function useEOzelIdentityReveal(visibleStudentIds: readonly string[] | undefined) {
  const queryClient = useQueryClient()
  const institutionId = useActiveInstitutionId()
  const [revealedFor, setRevealedFor] = useState<string | null>(null)
  if (
    revealedFor !== null &&
    visibleStudentIds !== undefined &&
    !visibleStudentIds.includes(revealedFor)
  )
    setRevealedFor(null)
  const studentId = revealedFor ?? ''
  const query = useApiQuery({
    key: eOzelIdentityKey(studentId),
    request: (client, signal) => eOzelIdentityRequest(client, studentId, signal),
    ...STUDENT_IDENTITY_QUERY_POLICY,
    enabled: revealedFor !== null,
  })
  const queryKey = institutionKey(institutionId, ...eOzelIdentityKey(studentId))
  return {
    revealedFor,
    query,
    show: setRevealedFor,
    hide: () => {
      setRevealedFor(null)
      queryClient.removeQueries({ queryKey })
    },
    /** Yeniden girişten sonra: eski hatayı siler ve okumayı bir kez daha başlatır. */
    retry: () => {
      void queryClient.resetQueries({ queryKey })
    },
  }
}

/** Dosyayı metin olarak alır; yazma değildir, sorgu tazelenmez. Hata mesajı toast olur. */
export function useEOzelExport() {
  return useApiCommand({
    request: (client, query: EOzelFileQuery) =>
      client.GET('/api/v1/finance/e-ozel/export', { params: { query }, parseAs: 'text' }),
    invalidates: [],
  })
}
