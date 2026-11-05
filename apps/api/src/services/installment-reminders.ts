import type { FastifyBaseLogger } from 'fastify'

import { installmentReminders } from '@kampus/school-core/lib/installment-reminders.ts'
import {
  NOTIFICATION_AUDIENCES,
  notificationEnabled,
} from '@kampus/school-core/lib/notifications.ts'

import type { Database } from '../db/client.ts'
import { allocatedTotals } from '../db/payments.ts'
import { loadFinanceRecords } from '../db/finance-mirror-store.ts'
import { loadRecordsByIds, lockInstitution } from '../db/records.ts'
import { invoiceStatusFilter } from './list-filters.ts'
import { getInstitutionModules } from './modules.ts'
import { dedupedNotificationId, notify } from './notify.ts'

/**
 * Vade ve gecikme taraması (IST-109; docs/domain/finans.md DOM-FIN-034, DOM-FIN-035; işi
 * `jobs/installment-reminders.ts`). Kural core `lib/installment-reminders.ts`'tedir. Kurum kilidi
 * altında çalışır: tahsilat da aynı kilidi alır, ödenmiş taksite hatırlatma gitmez. Daha önce
 * yazılmış bildirim kilit süresi uzamasın diye önden elenir; asıl tekillik `notify` `dedupeKey`'dir.
 *
 * Arşivlenmiş öğrencinin taksiti taranmaz. Ayrılan (pasif) öğrencinin kalan borç taksiti taranır:
 * borç sürer ve velisi kaydı görmeye devam eder. Log ve sonuç yalnız sayı taşır.
 */
// Alıcı `notify` öğrenci bağından çözülür (velayetli kısıtsız veliler ya da yetişkin kursiyer);
// ödeyici veli, velayeti olmasa da, finans bildirimini okuma kapsamından görür (K-04, DOM-ILT-074;
// core `PAYER_NOTIFICATION_KINDS`). İletişim kısıtlı veli görmez.

export type InstallmentReminderResult = {
  invoices: number
  reminded: number
  created: number
  deduplicated: number
  skipped: string | null
}

export function sendInstallmentReminders(input: {
  db: Database
  institutionId: string
  now: Date
  log: FastifyBaseLogger
}): Promise<InstallmentReminderResult> {
  const { institutionId, now, log } = input
  const result: InstallmentReminderResult = {
    invoices: 0,
    reminded: 0,
    created: 0,
    deduplicated: 0,
    skipped: null,
  }
  return input.db.transaction(async (tx) => {
    await lockInstitution(tx, institutionId)
    const institution = await getInstitutionModules(tx, institutionId)
    if (institution === null) return { ...result, skipped: 'institution_missing' }
    if (!notificationEnabled('installment_due', institution.modules))
      return { ...result, skipped: 'module_disabled' }

    const open = await loadFinanceRecords(tx, institutionId, 'invoices', {
      match: [invoiceStatusFilter(['Gecikmiş', 'Yaklaşan'], now)],
    })
    const allocated = await allocatedTotals(tx, institutionId)
    const { reminders, invalid } = installmentReminders(
      open.map((row) => ({ ...row.data, id: row.id })),
      allocated,
      now,
    )
    if (invalid > 0) log.warn({ event: 'installment_reminder.invalid_invoice', count: invalid })

    const students = await loadRecordsByIds(tx, institutionId, 'students', [
      ...new Set(reminders.map((item) => item.studentId)),
    ])
    const known = new Set(students.map((student) => student.id))
    const due = reminders.filter((item) => known.has(item.studentId))
    result.invoices = due.length

    const idsOf = (item: (typeof due)[number]) =>
      NOTIFICATION_AUDIENCES.map((audience) =>
        dedupedNotificationId(item.type, item.dedupeKey, audience, item.studentId),
      )
    const written = new Set(
      (
        await loadRecordsByIds(tx, institutionId, 'notifications', due.flatMap(idsOf), {
          includeArchived: true,
        })
      ).map((row) => row.id),
    )
    const ctx = { institutionId, now, log, actor: null }
    for (const item of due) {
      if (idsOf(item).some((id) => written.has(id))) {
        result.deduplicated += 1
        continue
      }
      const sent = await notify(tx, ctx, {
        type: item.type,
        recipients: { studentIds: [item.studentId] },
        data: { invoiceId: item.invoiceId },
        dedupeKey: item.dedupeKey,
      })
      if (sent.created.length > 0) result.reminded += 1
      result.created += sent.created.length
      result.deduplicated += sent.deduplicated
    }
    return result
  })
}
