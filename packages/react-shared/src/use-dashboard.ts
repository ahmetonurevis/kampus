import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { ApiError } from '@kampus/api-client/errors.ts'

import {
  dashboardQueryOptions,
  type DashboardOf,
  type DashboardQuery,
  type DashboardRole,
} from './dashboard.ts'
import { useKampusClient } from './kampus-context.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'

/**
 * Etkin rolün Genel Bakış özeti (`GET /api/v1/dashboard`), tek istek. `role` ekranın rolüdür ve
 * dönen tipi daraltır; velide `studentId` seçili çocuktur. `enabled: false` isteği bekletir.
 */
export function useDashboard<R extends DashboardRole>(
  role: R,
  query: DashboardQuery = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<DashboardOf<R> | null, ApiError> {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery(dashboardQueryOptions(client, institutionId, role, query, options.enabled))
}
