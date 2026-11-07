import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Dil okulu paket ve satış kancaları (`/finance/packages`, `/finance/package-sales`,
// `/finance/course-offers`; IST-078, IST-088, DOM-DIL-050, -051). Tanım yönetici; satış, süre uzatma ve kullanılan saat yönetici ile ön büro;
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

/**
 * Öğrencinin paket saat bakiyesi (`/finance/students/:id/package-balance`; IST-114, DOM-DIL-051):
 * satış başına ve toplam satılan, kullanılan, iade edilen, kalan ve süresi dolan saat. Saat burada
 * hesaplanmaz, sunucudan okunur. Anahtar paket önekindedir: satış, uzatma ve saat girişi tazeler.
 * Veli ve öğrenci yanıtında tutar yoktur (K-40).
 */
export function useStudentPackageBalance(studentId: string, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: [...PACKAGES_KEY, 'balance', studentId],
    enabled: (options.enabled ?? true) && studentId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/students/{studentId}/package-balance', {
        params: { path: { studentId } },
        signal,
      }),
  })
}

export type CourseOfferListQuery = NonNullable<
  operations['listCourseOffers']['parameters']['query']
>

/**
 * Kur yenileme ve üst kur teklif listesi (IST-088, ON-082; DOM-DIL-070): onaylı kur sonu kararı olan
 * kursiyerler ve teklife uyan paketlerin tarife fiyatı. Anahtar paket önekindedir: satış listeyi
 * yeniler, satılan teklif `saleId` ile kapanır.
 */
export function useCourseOffers(query: CourseOfferListQuery & { page: number; pageSize: number }) {
  return useApiQuery({
    key: [...PACKAGES_KEY, 'course-offers', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/course-offers', { params: { query }, signal }),
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

export type PackageReportQuery = { from: string; to: string; page: number; pageSize: number }

/**
 * Paket saat raporu (IST-114, DOM-FIN-058): toplam ve ay dökümü bütün satırlardan, satırlar sayfalı;
 * yalnız yönetici okur. Saat girişi ve satış paket anahtarını tazeler, rapor da onunla tazelenir.
 */
export function usePackageReport(query: PackageReportQuery, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: [...PACKAGES_KEY, 'report', query],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/package-report', { params: { query }, signal }),
  })
}

/** Raporun CSV dosyası (`Accept: text/csv`); taze oturum ister, denetime düşer, sorgu tazelenmez. */
export function usePackageReportExport() {
  return useApiCommand({
    request: (client, period: { from: string; to: string }) =>
      client.GET('/api/v1/finance/package-report', {
        params: { query: { ...period, page: 1, pageSize: 20 } },
        headers: { accept: 'text/csv' },
        parseAs: 'text',
      }),
    invalidates: [],
  })
}
