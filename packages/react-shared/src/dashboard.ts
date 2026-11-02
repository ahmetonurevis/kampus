import { queryOptions } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'
import { institutionKey } from './query-keys.ts'

/**
 * Genel Bakış özeti (`GET /api/v1/dashboard`): etkin rolün bütün kart, kısa liste ve mini grafik
 * verisi tek istekte. Yanıt `role` ile ayrılır; okuduğu modül kapalı bölüm `null`'dır.
 */
export type Dashboard = components['schemas']['Dashboard']
export type DashboardRole = Dashboard['role']
/** Rolün özeti (ör. `DashboardOf<'yonetici'>`). */
export type DashboardOf<R extends DashboardRole> = Extract<Dashboard, { role: R }>

export interface DashboardQuery {
  /** Yalnız velide: seçili çocuk. Öğrencide sunucu kendi kaydını seçer. */
  studentId?: string | undefined
  /** Yalnız yönetici ve ön büroda: özeti daraltılacak kampüs; yoksa tüm kampüsler. */
  branchId?: string | undefined
}

export const DASHBOARD_KEY_ROOT = 'dashboard'

/**
 * Sorgu anahtarı: etkin kurum, rol, seçili çocuk ve kampüs süzgeci. Rol anahtardadır; aynı kurumda rol değişirse
 * önceki rolün özeti yeni rolün ekranında görünmez.
 */
export function dashboardKey(
  institutionId: string | null,
  role: DashboardRole,
  query: DashboardQuery = {},
) {
  return institutionKey(institutionId, DASHBOARD_KEY_ROOT, role, {
    studentId: query.studentId || null,
    branchId: query.branchId || null,
  })
}

export async function fetchDashboard(
  client: KampusClient,
  query: DashboardQuery = {},
  signal?: AbortSignal,
): Promise<Dashboard> {
  const body = await runRequest(() =>
    client.GET('/api/v1/dashboard', {
      params: {
        query: {
          ...(query.studentId ? { studentId: query.studentId } : {}),
          ...(query.branchId ? { branchId: query.branchId } : {}),
        },
      },
      ...(signal ? { signal } : {}),
    }),
  )
  return body.data
}

/** Yanıt ekranın rolünün özeti değilse (oturumun rolü değişti) `null`: yanlış şekil çizilmez. */
export function dashboardOfRole<R extends DashboardRole>(
  data: Dashboard,
  role: R,
): DashboardOf<R> | null {
  return data.role === role ? (data as DashboardOf<R>) : null
}

/**
 * Özet sayfa her açıldığında tazelenir (`staleTime: 0`): kartlar birçok koleksiyondan beslenir ve
 * yazma sonrası koleksiyon önekleriyle geçersiz kılınmaz. Önbellekteki özet yeni yanıt gelene
 * kadar ekranda kalır. Etkin kurum bilinmeden istek atılmaz.
 */
export function dashboardQueryOptions<R extends DashboardRole>(
  client: KampusClient,
  institutionId: string | null,
  role: R,
  query: DashboardQuery = {},
  enabled = true,
) {
  return queryOptions<Dashboard, ApiError, DashboardOf<R> | null>({
    queryKey: dashboardKey(institutionId, role, query),
    queryFn: ({ signal }) => fetchDashboard(client, query, signal),
    select: (data) => dashboardOfRole(data, role),
    enabled: institutionId !== null && enabled,
    staleTime: 0,
  })
}
