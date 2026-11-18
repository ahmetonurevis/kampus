import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'
import { PROSPECT_DOCUMENTS_KEY } from './use-prospect-documents.ts'

// Kayıt belgeleri kancaları (`/prospects/enrollment-documents`,
// `/prospects/students/:id/enrollment-documents`; DOM-KAY-045, ON-344). Anahtar aday belgeleri
// önekini paylaşır: aday belge yazmaları (kabul, rıza) öğrenci tarafını da tazeler. Belge açılışı
// aday belge ucundandır (`useProspectDocumentUrlFetcher`).

type Query<TOperation extends keyof operations> = operations[TOperation]['parameters'] extends {
  query?: infer TQuery
}
  ? NonNullable<TQuery>
  : never

export type EnrollmentDocumentRow =
  operations['listEnrollmentDocuments']['responses'][200]['content']['application/json']['data'][number]
export type EnrollmentDocumentQuery = Query<'listEnrollmentDocuments'>
export type EnrollmentDocuments =
  operations['getEnrollmentDocuments']['responses'][200]['content']['application/json']['data']
export type EnrollmentDocument = EnrollmentDocuments['documents'][number]

/** Aday kaydından gelen aktif öğrenciler ve kayıt belgesi durumu (sayfalı). */
export function useEnrollmentDocumentList(query: EnrollmentDocumentQuery) {
  return useFinanceListQuery({
    key: [...PROSPECT_DOCUMENTS_KEY, 'enrollment', 'list', query],
    request: (client, signal) =>
      client.GET('/api/v1/prospects/enrollment-documents', { params: { query }, signal }),
  })
}

/** Öğrencinin bağlı kayıt belgeleri, eksikleri ve bağlı rızası. */
export function useEnrollmentDocuments(studentId: string | null) {
  return useApiQuery({
    key: [...PROSPECT_DOCUMENTS_KEY, 'enrollment', 'item', studentId],
    request: (client, signal) =>
      client.GET('/api/v1/prospects/students/{studentId}/enrollment-documents', {
        params: { path: { studentId: studentId ?? '' } },
        signal,
      }),
    enabled: studentId !== null && studentId !== '',
  })
}
