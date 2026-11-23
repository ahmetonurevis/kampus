import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Personel çalışma ve hizmet belgesi kancaları (`/finance/staff-certificates`,
// `/finance/staff-certificate-staff`; DOM-FIN-106, ON-175). Yalnız yönetici (K-342). Belge üretimi
// numara keser ve `Idempotency-Key` ile gider; iptal `If-Match` ister. Belge içeriği (TCKN, ücret)
// web'de PDF açılınca ayrı uçtan okunur ve denetime düşer (K-343). Komutlar `exclusive`.

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

export type CreateStaffCertificateBody = JsonBody<'createStaffCertificate'>
export type StaffCertificate =
  operations['listStaffCertificates']['responses'][200]['content']['application/json']['data'][number]
export type StaffCertificateDocument =
  operations['getStaffCertificateDocument']['responses'][200]['content']['application/json']['data']
export type StaffCertificateQuery = Query<'listStaffCertificates'>
export type CertificateStaffRow =
  operations['listStaffCertificateStaff']['responses'][200]['content']['application/json']['data'][number]
export type CertificateStaffQuery = Query<'listStaffCertificateStaff'>

export const STAFF_CERTIFICATES_KEY = ['finance', 'staff-certificates'] as const
const MESSAGES = {
  version_conflict: 'Belge başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useStaffCertificates(query: StaffCertificateQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_CERTIFICATES_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/staff-certificates', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Belge formunun personel seçimi (ad, rol, durum, son belgeden öneriler). */
export function useCertificateStaff(query: CertificateStaffQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_CERTIFICATES_KEY, 'staff', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/staff-certificate-staff', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useCreateStaffCertificate() {
  return useApiCommand({
    request: (client, body: CreateStaffCertificateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-certificates', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_CERTIFICATES_KEY],
    exclusive: true,
  })
}

export function useCancelStaffCertificate() {
  return useApiCommand({
    request: (
      client,
      input: { certificateId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/staff-certificates/{certificateId}/cancel', {
        params: {
          path: { certificateId: input.certificateId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { reason: input.reason },
      }),
    invalidates: [STAFF_CERTIFICATES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
