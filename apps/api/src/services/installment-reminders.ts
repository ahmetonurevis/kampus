import type { FastifyBaseLogger } from 'fastify'
import { z } from 'zod'

import { DomainError } from '@kampus/school-core/lib/errors.ts'
import {
  installmentReminders,
  manualInstallmentReminder,
  scanReminderKey,
  type ManualInstallmentReminder,
} from '@kampus/school-core/lib/installment-reminders.ts'
import {
  NOTIFICATION_AUDIENCES,
  notificationEnabled,
} from '@kampus/school-core/lib/notifications.ts'

import type { Database } from '../db/client.ts'
import { allocatedForInvoices, allocatedTotals } from '../db/payments.ts'
import { loadFinanceRecords } from '../db/finance-mirror-store.ts'
import { loadRecordsByIds, lockInstitution } from '../db/records.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { invoiceStatusFilter } from './list-filters.ts'
import { getInstitutionModules } from './modules.ts'
import { notifyFinance } from './finance-payers.ts'
import { dedupedNotificationId } from './notify.ts'
import {
  FINANCE_TABLE_STORES,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'

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
      const sent = await notifyFinance(tx, ctx, {
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

const reminderFacts = z.object({ studentId: z.string(), dueDate: z.string() })

/** Taramanın bu vade günü için yazdığı gecikme bildiriminin anı; yazmadıysa `null`. */
async function scanOverdueSentAt(
  tx: Database,
  institutionId: string,
  invoice: { id: string; studentId: string; dueDate: string },
): Promise<string | null> {
  const ids = NOTIFICATION_AUDIENCES.map((audience) =>
    dedupedNotificationId(
      'installment_overdue',
      scanReminderKey(invoice),
      audience,
      invoice.studentId,
    ),
  )
  const written = await loadRecordsByIds(tx, institutionId, 'notifications', ids, {
    includeArchived: true,
  })
  const sentAt = written[0]?.data.createdAt
  return typeof sentAt === 'string' ? sentAt : null
}

/**
 * Gecikmiş taksitte personelin elle hatırlatması (DOM-FIN-035, ON-113): kural core
 * `manualInstallmentReminder`. `reminderAt`, gecikme bildirimi ve denetim satırı aynı transaction'da
 * ve kurum kilidi altındadır: tahsilatla yarışan taksite hatırlatma gitmez. Bugün zaten hatırlatıldıysa
 * bildirim yazılmaz, yanıt `already_sent` olur. Arşivlenmiş öğrencinin taksiti 422; ayrılan öğrencinin
 * kalan borcu taramadaki gibi hatırlatılır. Bildirim merkezi kapalıysa `reminderAt` de yazılmaz (422).
 * Uygulama içi kayıt sessiz saatte de anında düşer (DOM-ILT-021).
 */
export function remindInstallmentCommand(
  ctx: ServiceContext,
  invoiceId: string,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const { institutionId } = ctx
  return runCommand<ManualInstallmentReminder>(
    ctx,
    {
      action: 'invoice.remind',
      collections: ['invoices'],
      stores: FINANCE_TABLE_STORES,
      loadScope: { invoices: { ids: [invoiceId] } },
      entity: { type: 'invoices', id: invoiceId },
      load: async (tx) => {
        const [row] = await loadFinanceRecords(tx, institutionId, 'invoices', { ids: [invoiceId] })
        if (!row) throw new NotFoundError()
        const facts = reminderFacts.parse(row.data)
        const [student] = await loadRecordsByIds(tx, institutionId, 'students', [facts.studentId])
        const allocated = await allocatedForInvoices(tx, institutionId, [invoiceId])
        const scanSentAt = await scanOverdueSentAt(tx, institutionId, { id: invoiceId, ...facts })
        return {
          run: (state, { now }) => {
            const invoice = state.invoices.find((item) => item.id === invoiceId)
            if (!invoice) throw new NotFoundError()
            if (!student)
              throw new DomainError(
                'invoice_student_archived',
                'Arşivlenmiş öğrencinin taksiti için hatırlatma gönderilmez.',
              )
            const decision = manualInstallmentReminder(invoice, allocated, now, scanSentAt)
            invoice.reminderAt = decision.reminderAt
            return decision
          },
        }
      },
      after: async (tx, { reminder }) => {
        if (reminder === null) return
        const sent = await notifyFinance(tx, ctx, {
          type: reminder.type,
          recipients: { studentIds: [reminder.studentId] },
          data: { invoiceId: reminder.invoiceId },
          dedupeKey: reminder.dedupeKey,
        })
        if (sent.skipped !== null)
          throw new DomainError(
            'notifications_disabled',
            'Bildirim merkezi kapalı olduğu için hatırlatma gönderilemedi.',
          )
      },
    },
    ({ result, changes }) =>
      commandBody({ collection: 'invoices', id: invoiceId }, changes, 200, {
        reminder: result.reminder === null ? 'already_sent' : 'sent',
      }),
    idempotency,
  )
}
