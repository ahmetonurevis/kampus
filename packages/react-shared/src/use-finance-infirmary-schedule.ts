import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import {
  healthReasonHeaders,
  healthReasonKey,
  type HealthAccessReason,
} from './use-finance-health-access.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { INFIRMARY_KEY } from './use-finance-infirmary.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// İlaç çizelgesi, atlama ve düzeltme kancaları (`/finance/infirmary/medication-*`; DOM-FIN-152,
// ON-161). Atlama ve düzeltme `Idempotency-Key`, gecikme payı `If-Match` ile gider. Her yazma revir
// anahtarının tamamını tazeler (çizelge, talep ayrıntısı ve eski gün planı birlikte değişir).
// Sağlık ayrıntısı dönen okumalar sunucuda denetime düşer.

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
type Ok<TOperation extends keyof operations> = operations[TOperation]['responses'] extends {
  200: { content: { 'application/json': infer TBody } }
}
  ? TBody
  : never

export type MedicationChart = Ok<'getMedicationChart'>['data']
export type MedicationChartItem = MedicationChart['items'][number]
export type MedicationDoseRecord = MedicationChartItem['records'][number]
export type MedicationDoseSkipBody = JsonBody<'recordMedicationDoseSkip'>
export type AdministrationCorrectionBody = JsonBody<'correctMedicationAdministration'>
export type SkipCorrectionBody = JsonBody<'correctMedicationDoseSkip'>
export type MedicationSettingsBody = JsonBody<'setMedicationSettings'>
export type GuardianMedicationDose = Ok<'listGuardianMedicationDoses'>['data'][number]
export type GuardianMedicationDoseQuery = Query<'listGuardianMedicationDoses'>

const SETTINGS_MESSAGES = {
  version_conflict: 'Ayar başka biri tarafından değiştirildi. Ayar güncellendi.',
}

/** Çizelge sağlık ayrıntısı döndürür: personel okuması gerekçe ister (DOM-FIN-156). */
export function useMedicationChart(
  date: string | undefined,
  reason: HealthAccessReason | null,
  enabled = true,
) {
  return useApiQuery({
    key: [...INFIRMARY_KEY, 'chart', date ?? 'today', ...healthReasonKey(reason)],
    enabled: enabled && reason !== null,
    refetchOnWindowFocus: false,
    request: (client, signal) =>
      client.GET('/api/v1/finance/infirmary/medication-chart', {
        params: {
          query: date === undefined ? {} : { date },
          header: healthReasonHeaders(reason),
        },
        signal,
      }),
  })
}

export function useMedicationSettings(enabled = true) {
  return useApiQuery({
    key: [...INFIRMARY_KEY, 'medication-settings'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/infirmary/medication-settings', { signal }),
  })
}

export function useGuardianMedicationDoses(query: GuardianMedicationDoseQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INFIRMARY_KEY, 'my-doses', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/infirmary/my-medication-doses', {
          params: { query },
          signal,
        }),
    },
    { enabled },
  )
}

export function useRecordMedicationDoseSkip() {
  return useApiCommand({
    request: (
      client,
      input: { consentId: string; body: MedicationDoseSkipBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/infirmary/medication-consents/{consentId}/skips', {
        params: {
          path: { consentId: input.consentId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [INFIRMARY_KEY],
    exclusive: true,
  })
}

export function useCorrectMedicationAdministration() {
  return useApiCommand({
    request: (
      client,
      input: { administrationId: string; body: AdministrationCorrectionBody },
      headers: CommandHeaders,
    ) =>
      client.POST(
        '/api/v1/finance/infirmary/medication-administrations/{administrationId}/corrections',
        {
          params: {
            path: { administrationId: input.administrationId },
            header: { 'idempotency-key': headers['idempotency-key'] },
          },
          body: input.body,
        },
      ),
    invalidates: [INFIRMARY_KEY],
    exclusive: true,
  })
}

export function useCorrectMedicationDoseSkip() {
  return useApiCommand({
    request: (
      client,
      input: { skipId: string; body: SkipCorrectionBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/infirmary/medication-skips/{skipId}/corrections', {
        params: {
          path: { skipId: input.skipId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [INFIRMARY_KEY],
    exclusive: true,
  })
}

export function useSetMedicationSettings() {
  return useApiCommand({
    request: (
      client,
      input: { version: number; body: MedicationSettingsBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/infirmary/medication-settings', {
        params: {
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [INFIRMARY_KEY],
    version: (input) => input.version,
    messages: SETTINGS_MESSAGES,
    exclusive: true,
  })
}
