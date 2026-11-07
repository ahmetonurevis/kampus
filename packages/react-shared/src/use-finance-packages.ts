import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Dil okulu paket ve satış kancaları (`/finance/packages`, `/finance/package-sales`; IST-078,
// DOM-DIL-050, -051). Tanım yönetici; satış, süre uzatma ve kullanılan saat yönetici ile ön büro;
// okuma veli ve öğrencide kendi kapsamıyla. Komutlar `exclusive`: alan hatası formda, yolsuz hata tek toast.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateLessonPackageBody = JsonBody<'createLessonPackage'>
export type UpdateLessonPackageBody = JsonBody<'updateLessonPackage'>
export type QuotePackageSaleBody = JsonBody<'quotePackageSale'>
export type SellPackageBody = JsonBody<'sellPackage'>
export type ExtendPackageSaleBody = JsonBody<'extendPackageSale'>
export type SetPackageUsedHoursBody = JsonBody<'setPackageSaleUsedHours'>

export const PACKAGE_CHANGED_MESSAGE =
  'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.'

const PACKAGES_KEY = ['finance-packages'] as const
const MESSAGES = { version_conflict: PACKAGE_CHANGED_MESSAGE }
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useLessonPackages(
  query: {
    page: number
    pageSize: number
    q?: string
    kind?: 'course' | 'hours' | 'private'
  },
  options: { enabled?: boolean } = {},
) {
  return useApiQuery({
    key: [...PACKAGES_KEY, 'catalog', query],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/packages', { params: { query }, signal }),
  })
}

export function useCreateLessonPackage() {
  return useApiCommand({
    request: (client, body: CreateLessonPackageBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/packages', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [PACKAGES_KEY],
    exclusive: true,
  })
}

export function useUpdateLessonPackage() {
  return useApiCommand({
    request: (
      client,
      input: { packageId: string; version: number; body: UpdateLessonPackageBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/packages/{packageId}', {
        params: { path: { packageId: input.packageId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [PACKAGES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Arşivli paket satılamaz; geçmiş satışlar ve bakiyeleri kalır. */
export function useArchiveLessonPackage() {
  return useApiCommand({
    request: (client, input: { packageId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/packages/{packageId}', {
        params: { path: { packageId: input.packageId }, header: versioned(headers) },
      }),
    invalidates: [PACKAGES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Ücret önizlemesi; yazma değildir, sorgu tazelenmez. */
export function useQuotePackageSale() {
  return useApiCommand({
    request: (client, body: QuotePackageSaleBody) =>
      client.POST('/api/v1/finance/package-sales/quote', { body }),
    invalidates: [],
    exclusive: true,
  })
}

/** Satış sözleşme ve taksit de açar: finans listeleri ve toplamlar birlikte tazelenir. */
export function useSellPackage() {
  return useApiCommand({
    request: (client, body: SellPackageBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/package-sales', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [
      PACKAGES_KEY,
      collectionKeyPrefix('contracts'),
      collectionKeyPrefix('invoices'),
      ['payments'],
    ],
    exclusive: true,
  })
}

export function usePackageSales(query: {
  page: number
  pageSize: number
  studentId?: string
  packageId?: string
}) {
  return useApiQuery({
    key: [...PACKAGES_KEY, 'sales', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/package-sales', { params: { query }, signal }),
  })
}

export function usePackageSale(saleId: string) {
  return useApiQuery({
    key: [...PACKAGES_KEY, 'sale', saleId],
    enabled: saleId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/package-sales/{saleId}', {
        params: { path: { saleId } },
        signal,
      }),
  })
}

export function useExtendPackageSale() {
  return useApiCommand({
    request: (
      client,
      input: { saleId: string; version: number; body: ExtendPackageSaleBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/package-sales/{saleId}/extend', {
        params: { path: { saleId: input.saleId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [PACKAGES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Kullanılan saat elle girilir (K-21); ayrılış hesabı bu saate dayanır. */
export function useSetPackageUsedHours() {
  return useApiCommand({
    request: (
      client,
      input: { saleId: string; version: number; body: SetPackageUsedHoursBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/package-sales/{saleId}/set-used-hours', {
        params: { path: { saleId: input.saleId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [PACKAGES_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
