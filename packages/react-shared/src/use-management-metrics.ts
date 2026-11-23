import type { UseQueryResult } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components } from '@kampus/api-client/schema.d.ts'

import { useApiQuery } from './use-api-query.ts'

/**
 * Kampüs ve kadro ekranlarının toplu ölçüleri (IST-010): sınıf not ortalaması
 * (`GET /api/v1/class-metrics`, `academic`) ve öğretmen soru süresi uyumu ile performansı
 * (`GET /api/v1/teacher-metrics`, `learning`). Toplam sunucuda SQL'dedir; web not ve soru
 * kayıtlarını çekmez. Yalnız yönetici; modül kapalıyken sorgu hiç atılmaz (`enabled`).
 * Arşiv ve kayıt düzenleme sonrası `MANAGEMENT_METRICS_KEY` önekiyle tazelenir.
 */

export const MANAGEMENT_METRICS_KEY = 'management-metrics'

export type ClassMetric = components['schemas']['ClassMetric']
export type TeacherMetric = components['schemas']['TeacherMetric']

export const classMetricsRequest = (client: KampusClient, signal?: AbortSignal) =>
  client.GET('/api/v1/class-metrics', { ...(signal ? { signal } : {}) })

export const teacherMetricsRequest = (client: KampusClient, signal?: AbortSignal) =>
  client.GET('/api/v1/teacher-metrics', { ...(signal ? { signal } : {}) })

/** Kimlik → ölçü eşlemesi (tablo satırı başına tarama yapılmaz). */
export function metricsById<T, K extends keyof T>(
  rows: readonly T[] | undefined,
  key: K,
): ReadonlyMap<T[K], T> {
  return new Map((rows ?? []).map((row) => [row[key], row]))
}

/** Yanıt zarfı (`{ data: [...] }`); satırlar `data.data`'dadır. */
export function useClassMetrics(
  options: { enabled?: boolean } = {},
): UseQueryResult<{ data: ClassMetric[] }, ApiError> {
  return useApiQuery({
    key: [MANAGEMENT_METRICS_KEY, 'classes'],
    request: classMetricsRequest,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}

export function useTeacherMetrics(
  options: { enabled?: boolean } = {},
): UseQueryResult<{ data: TeacherMetric[] }, ApiError> {
  return useApiQuery({
    key: [MANAGEMENT_METRICS_KEY, 'teachers'],
    request: teacherMetricsRequest,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}
