import { enrollmentFunnel } from '@kampus/school-core/lib/enrollment-funnel.ts'

import { loadCounselorNames, loadFunnelProspects } from '../db/enrollment-funnel.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { dayRange } from './list-filters.ts'
import { getInstitutionModules } from './modules.ts'

export interface EnrollmentFunnelQuery {
  dateFrom?: string | undefined
  dateTo?: string | undefined
}

/**
 * Kayıt hunisi (`GET /api/v1/prospects/funnel`; DOM-KAY-040, IST-117). Kurum oturumdan gelir;
 * hesap core `enrollmentFunnel`'dadır. Danışman satırına yalnız kurum üyesinin adı eklenir.
 */
export async function getEnrollmentFunnel(ctx: ServiceContext, query: EnrollmentFunnelQuery) {
  const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
  if (institution === null) throw new NotFoundError()
  const prospects = await loadFunnelProspects(
    ctx.db,
    ctx.institutionId,
    dayRange('createdAt', query.dateFrom, query.dateTo),
  )
  const funnel = enrollmentFunnel(prospects, institution.type)
  const names = await loadCounselorNames(
    ctx.db,
    ctx.institutionId,
    funnel.byCounselor.flatMap((row) => (row.counselorId === null ? [] : [row.counselorId])),
  )
  return {
    institutionType: institution.type,
    total: funnel.total,
    bySource: funnel.bySource,
    byCounselor: funnel.byCounselor.map(({ counselorId, ...row }) => ({
      counselorId,
      counselorName: counselorId === null ? null : (names.get(counselorId) ?? null),
      ...row,
    })),
  }
}
