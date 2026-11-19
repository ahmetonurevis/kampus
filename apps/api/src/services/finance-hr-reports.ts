import {
  hrReport,
  hrReportCsv,
  hrReportFilename,
  hrReportPeriod,
  type HrReport,
} from '@kampus/school-core/lib/finance-hr-reports.ts'
import { monthOf } from '@kampus/school-core/lib/finance-staff-costs.ts'
import { effectiveLeaveTypes } from '@kampus/school-core/lib/finance-staff-leave.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { loadCostCenters } from '../db/finance-budget.ts'
import { loadHrStaff } from '../db/finance-hr-reports.ts'
import { loadStaffCostAllocations } from '../db/finance-staff-costs.ts'
import {
  loadLeaveProfiles,
  loadLeaveRecords,
  loadStoredLeaveTypes,
} from '../db/finance-staff-leave.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { medicalReportDaysFor } from './finance-medical-reports.ts'
import { mapOperationError } from './operation-runner.ts'

/**
 * İK raporları (DOM-FIN-117; ON-192). Hesap core `lib/finance-hr-reports.ts`'tedir; servis kurum
 * kapsamlı girdileri yükler. Personel üyeliği, kıdem başlangıcı ve kullanılmış izin (ON-181),
 * maliyet merkezi ataması (ON-204) ve rapor günleri (ON-185, `medicalReportDaysFor`) yalnız okunur.
 * Rapor kişisel veri toplamıdır: her okuma aynı transaction'da denetime düşer (ekran
 * `finance.hr_report.read`, CSV ve PDF `finance.hr_report.export`; yalnız alan adları), denetim
 * yazılamazsa yanıt dönmez (K-401). Rol ve modül denetimi rotadadır (yalnız yönetici).
 */

const ENTITY = 'hr_report'
const FIELDS = ['turnover', 'seniority', 'leave', 'medicalDays']

export type HrReportPurpose = 'view' | 'pdf' | 'csv'

export interface HrReportQuery {
  from?: string | undefined
  to?: string | undefined
}

async function buildReport(
  tx: Database,
  ctx: ServiceContext,
  query: HrReportQuery,
): Promise<HrReport> {
  const today = dayKey(ctx.now)
  const from = query.from ?? query.to ?? monthOf(today)
  const to = query.to ?? from
  let period: ReturnType<typeof hrReportPeriod>
  try {
    period = hrReportPeriod(from, to, today)
  } catch (error) {
    throw mapOperationError(error)
  }
  const staff = await loadHrStaff(tx, ctx.institutionId)
  const ids = staff.map((member) => member.membershipId)
  const [profiles, records, storedTypes, allocations, centers, medicalDays] = [
    await loadLeaveProfiles(tx, ctx.institutionId, ids),
    await loadLeaveRecords(tx, ctx.institutionId, ids),
    await loadStoredLeaveTypes(tx, ctx.institutionId),
    await loadStaffCostAllocations(tx, ctx.institutionId, null),
    await loadCostCenters(tx, ctx.institutionId),
    await medicalReportDaysFor(
      { db: tx, institutionId: ctx.institutionId },
      { from: period.firstDay, to: period.endDay },
    ),
  ]
  return hrReport({
    period,
    staff,
    profiles: profiles.map(({ membershipId, ...profile }) => ({
      membershipId,
      profile: {
        seniorityStartDate: profile.seniorityStartDate,
        birthDate: profile.birthDate,
        openingBalance: profile.openingBalance,
      },
    })),
    allocations,
    centers,
    leaveTypes: effectiveLeaveTypes(storedTypes),
    leaveRecords: records,
    medicalDays,
  })
}

/** Rapor; her okuma amaca göre denetime düşer (varlık kimliği dönem ve biçim). */
export function hrReportFor(
  ctx: ServiceContext,
  query: HrReportQuery,
  purpose: HrReportPurpose,
): Promise<HrReport> {
  return ctx.db.transaction(async (tx) => {
    const report = await buildReport(tx, ctx, query)
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: purpose === 'view' ? 'finance.hr_report.read' : 'finance.hr_report.export',
      entityType: ENTITY,
      entityId: `hr-report:${report.from}:${report.to}${purpose === 'view' ? '' : `:${purpose}`}`,
      // kvkk: sayı değil, dönen bölümlerin adı.
      changes: { fields: FIELDS },
      createdAt: ctx.now,
    })
    return report
  })
}

/** CSV dosyası; BOM'u rota ekler. */
export async function hrReportCsvFor(
  ctx: ServiceContext,
  query: HrReportQuery,
): Promise<{ csv: string; filename: string }> {
  const report = await hrReportFor(ctx, query, 'csv')
  return { csv: hrReportCsv(report), filename: hrReportFilename(report.from, report.to, 'csv') }
}
