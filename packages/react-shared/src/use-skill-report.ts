import type { UseQueryResult } from '@tanstack/react-query'

import type { KampusClient } from '@kampus/api-client/client.ts'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { components } from '@kampus/api-client/schema.d.ts'

import { useApiQuery } from './use-api-query.ts'

/**
 * Beceri ve CEFR raporu (OG-100; IST-118; DOM-BEC-037): dil grubu ya da kur seviyesi başına
 * kursiyer sayısı, dört beceri ortalaması ve kanıt sayısı, güncel seviye dağılımı
 * (`GET /api/v1/reports/skills`, `learning`, yalnız dil okulu). Rapor her okumada sunucuda
 * hesaplanır; kişi adı ya da puanı taşımaz. Yönetici kurum geneli, öğretmen okuyabildiği
 * gruplar. Modül kapalıyken ya da `enabled: false` iken sorgu atılmaz.
 */

export const SKILL_REPORT_KEY = 'skill-report'

export type SkillReport = components['schemas']['SkillReport']
export type SkillReportGroupBy = SkillReport['groupBy']
export type SkillReportGroup = SkillReport['groups'][number]
export type SkillReportSkill = SkillReportGroup['skills'][number]

export const skillReportRequest = (
  client: KampusClient,
  groupBy: SkillReportGroupBy,
  signal?: AbortSignal,
) =>
  client.GET('/api/v1/reports/skills', {
    params: { query: { groupBy } },
    ...(signal ? { signal } : {}),
  })

/** Yanıt zarfı (`{ data: SkillReport }`); rapor `data.data`'dadır. */
export function useSkillReport(
  groupBy: SkillReportGroupBy,
  options: { enabled?: boolean } = {},
): UseQueryResult<{ data: SkillReport }, ApiError> {
  return useApiQuery({
    key: [SKILL_REPORT_KEY, groupBy],
    request: (client, signal) => skillReportRequest(client, groupBy, signal),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  })
}
