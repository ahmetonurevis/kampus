import type { operations } from '@kampus/api-client/schema.d.ts'
import { resolveEffectiveTariff } from '@kampus/school-core/lib/fee-tariffs.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'

import { requireIfMatch } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useFinanceListQuery, type FinanceListQueryOptions } from './use-finance-list-query.ts'

// Ücret tarifesi kancaları (`/fee-tariffs`; ADR 0006 karar 8, DOM-FIN-002, -004, -006). Komutlar
// `exclusive`: alan hatası formda görünür, yolsuz hata tek toast olur.

// Dosya yükleme uçları `multipart/form-data` gövdesi taşır; JSON gövdesi koşulla seçilir.
type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateFeeTariffBody = JsonBody<'createFeeTariff'>
export type UpdateFeeTariffBody = JsonBody<'updateFeeTariff'>
export type PublishFeeTariffBody = JsonBody<'publishFeeTariff'>

export const FEE_TARIFF_CHANGED_MESSAGE =
  'Tarife başka biri tarafından değiştirildi. Liste güncellendi.'

const FEE_TARIFFS_KEY = ['fee-tariffs'] as const
const MESSAGES = { version_conflict: FEE_TARIFF_CHANGED_MESSAGE }

export function useFeeTariffs(
  query: { page: number; pageSize: number; academicYear?: number },
  options: FinanceListQueryOptions = {},
) {
  return useFinanceListQuery(
    {
      key: [...FEE_TARIFFS_KEY, query],
      request: (client, signal) => client.GET('/api/v1/fee-tariffs', { params: { query }, signal }),
    },
    options,
  )
}

const isPublished = (tariff: { status: string }) => tariff.status === 'published'

/**
 * Eğitim yılının sözleşmeye esas tarifesi (DOM-FIN-002, K-11): hedef yılın yayımlı tarifesi, yoksa
 * core kuralıyla önceki yılınki. Önceki yıl yalnız hedef yılın tarifesi yoksa istenir. Ekran bu
 * tarifeyle önizler; kesin karar sunucunundur, tarife değiştiyse 409 `tariff_changed` döner.
 */
export function useEffectiveFeeTariff(query: {
  academicYear: number
  institutionType: InstitutionType
  pageSize: number
}) {
  const { academicYear, institutionType, pageSize } = query
  // Tarife hesap kaynağıdır: yıl değişince önceki yılın tarifesi yer tutucu olarak hesaba girmez.
  const current = useFeeTariffs({ page: 1, pageSize, academicYear }, { keepPreviousPage: false })
  const published = current.data?.data.find(isPublished) ?? null
  const needsPrevious = current.isSuccess && published === null
  const previous = useFeeTariffs(
    { page: 1, pageSize, academicYear: academicYear - 1 },
    { enabled: needsPrevious, keepPreviousPage: false },
  )
  const effective = resolveEffectiveTariff({
    academicYear,
    institutionType,
    published,
    previousPublished: previous.data?.data.find(isPublished) ?? null,
    now: new Date(),
  })
  return {
    tariff: effective?.tariff ?? null,
    carriedOverFromYear: effective?.carriedOverFromYear ?? null,
    isPending: current.isPending || (needsPrevious && previous.isPending),
    error: current.error ?? (needsPrevious ? previous.error : null),
    refetch: () => {
      void current.refetch()
      if (needsPrevious) void previous.refetch()
    },
  }
}

export function useCreateFeeTariff() {
  return useApiCommand({
    request: (client, body: CreateFeeTariffBody, headers) =>
      client.POST('/api/v1/fee-tariffs', { params: { header: headers }, body }),
    invalidates: [FEE_TARIFFS_KEY],
    exclusive: true,
  })
}

export function useUpdateFeeTariff() {
  return useApiCommand({
    request: (
      client,
      input: { tariffId: string; version: number; body: UpdateFeeTariffBody },
      headers,
    ) =>
      client.PATCH('/api/v1/fee-tariffs/{tariffId}', {
        params: {
          path: { tariffId: input.tariffId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: input.body,
      }),
    invalidates: [FEE_TARIFFS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function usePublishFeeTariff() {
  return useApiCommand({
    request: (
      client,
      input: { tariffId: string; version: number; body: PublishFeeTariffBody },
      headers,
    ) =>
      client.POST('/api/v1/fee-tariffs/{tariffId}/publish', {
        params: {
          path: { tariffId: input.tariffId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: input.body,
      }),
    invalidates: [FEE_TARIFFS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
