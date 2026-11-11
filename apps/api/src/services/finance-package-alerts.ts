import type { FastifyBaseLogger } from 'fastify'

import { packageAlertNotices } from '@kampus/school-core/lib/finance-package-alerts.ts'
import { packageHourBalance } from '@kampus/school-core/lib/finance-packages.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  NOTIFICATION_AUDIENCES,
  notificationEnabled,
} from '@kampus/school-core/lib/notifications.ts'

import type { Database } from '../db/client.ts'
import { loadPackageReportSales } from '../db/finance-packages.ts'
import { loadRecordsByIds, lockInstitution } from '../db/records.ts'
import { getInstitutionModules } from './modules.ts'
import { dedupedNotificationId, notify } from './notify.ts'

/**
 * Paket saat uyarı taraması (ON-084; IST-078, IST-114; docs/domain/finans.md DOM-FIN-058,
 * dil-okulu.md DOM-DIL-051; K-248, K-249; işi `jobs/finance-package-alerts.ts`). Kural core
 * `lib/finance-package-alerts.ts`'tedir. Kurum kilidi altında çalışır: saat girişi ve ayrılış da
 * aynı kilidi alır, kapanmış satışa uyarı gitmez. Yalnız dil okulunda ve finans modülü ile bildirim
 * merkezi açıkken çalışır. Arşivlenmiş ya da ayrılmış (pasif) kursiyerin satışı taranmaz. Daha önce
 * yazılmış bildirim önden elenir; asıl tekillik `notify` `dedupeKey`'dir. Log ve sonuç yalnız sayı
 * taşır.
 */

export type PackageAlertResult = {
  sales: number
  notices: number
  created: number
  deduplicated: number
  skipped: string | null
}

export function sendPackageAlerts(input: {
  db: Database
  institutionId: string
  now: Date
  log: FastifyBaseLogger
}): Promise<PackageAlertResult> {
  const { institutionId, now, log } = input
  const result: PackageAlertResult = {
    sales: 0,
    notices: 0,
    created: 0,
    deduplicated: 0,
    skipped: null,
  }
  return input.db.transaction(async (tx) => {
    await lockInstitution(tx, institutionId)
    const institution = await getInstitutionModules(tx, institutionId)
    if (institution === null) return { ...result, skipped: 'institution_missing' }
    if (institution.type !== 'language_school') return { ...result, skipped: 'not_language_school' }
    if (!notificationEnabled('package_hours_low', institution.modules))
      return { ...result, skipped: 'module_disabled' }

    const sales = await loadPackageReportSales(tx, institutionId)
    const students = await loadRecordsByIds(tx, institutionId, 'students', [
      ...new Set(sales.map((sale) => sale.studentId)),
    ])
    const active = new Set(
      students.filter((row) => row.data.isActive !== false).map((row) => row.id),
    )
    const open = sales
      .filter((sale) => active.has(sale.studentId))
      .map((sale) => ({
        id: sale.id,
        studentId: sale.studentId,
        purchasedHours: sale.purchasedHours,
        expiresDate: sale.expiresDate,
        remainingHours: packageHourBalance(
          sale.purchasedHours,
          sale.entries.filter((entry) => entry.archivedAt === null),
        ).remainingHours,
      }))
    result.sales = open.length
    const notices = packageAlertNotices(open, dayKey(now))
    result.notices = notices.length

    const idsOf = (item: (typeof notices)[number]) =>
      NOTIFICATION_AUDIENCES.map((audience) =>
        dedupedNotificationId(item.type, item.dedupeKey, audience, item.studentId),
      )
    const written = new Set(
      (
        await loadRecordsByIds(tx, institutionId, 'notifications', notices.flatMap(idsOf), {
          includeArchived: true,
        })
      ).map((row) => row.id),
    )
    const ctx = { institutionId, now, log, actor: null }
    for (const item of notices) {
      if (idsOf(item).some((id) => written.has(id))) {
        result.deduplicated += 1
        continue
      }
      const sent = await notify(tx, ctx, {
        type: item.type,
        recipients: { studentIds: [item.studentId] },
        data: { saleId: item.saleId },
        dedupeKey: item.dedupeKey,
      })
      result.created += sent.created.length
      result.deduplicated += sent.deduplicated
    }
    return result
  })
}
