import { useQuery } from '@tanstack/react-query'

import type { ApiError } from '@kampus/api-client/errors.ts'

import { useKampusClient } from './kampus-context.ts'
import { institutionKey } from './query-keys.ts'
import { fetchSkillProgress, SKILL_PROGRESS_KEY, type SkillProgress } from './skill-progress.ts'
import { useActiveInstitutionId } from './use-active-institution.ts'

interface Options {
  enabled?: boolean
}

/**
 * Öğrencinin dört beceri eğrisi (OG-080; IST-057, DOM-BEC-035). Pano saklanmaz; her okumada
 * sunucuda puanlardan hesaplanır. Anahtar etkin kurumu ve öğrenciyi içerir; öğrenci kimliği boşken
 * ya da `enabled: false` iken istek atılmaz.
 */
export function useSkillProgress(studentId: string, options: Options = {}) {
  const client = useKampusClient()
  const institutionId = useActiveInstitutionId()
  return useQuery<SkillProgress, ApiError>({
    queryKey: institutionKey(institutionId, ...SKILL_PROGRESS_KEY, studentId),
    queryFn: async ({ signal }) => (await fetchSkillProgress(client, studentId, signal)).data,
    enabled: institutionId !== null && studentId !== '' && (options.enabled ?? true),
  })
}
