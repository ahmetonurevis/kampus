import { z } from 'zod'
import type {
  StaffRetentionCandidateRow,
  StaffRetentionPolicyRow,
  UpdateStaffRetentionPoliciesBody,
} from '@kampus/react-shared/use-finance-staff-retention.ts'
import {
  STAFF_RETENTION_CATEGORY_LABELS,
  STAFF_RETENTION_METHOD_LABELS,
  staffRetentionPeriodLabel,
  type StaffRetentionCategory,
} from '@kampus/school-core/lib/finance-staff-retention.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

/**
 * Özlük saklama ve imha sekmesinin saf mantığı (DOM-FIN-122; ON-176): süre formu (yıl ya da ay;
 * yasal en az süre ve en çok süre denetimi, K-415), gövde, kalan gün ve onay metni.
 */

export const RETENTION_UNITS = ['year', 'month'] as const
export type RetentionUnit = (typeof RETENTION_UNITS)[number]
export const RETENTION_UNIT_LABELS = { year: 'Yıl', month: 'Ay' } as const satisfies Record<
  RetentionUnit,
  string
>

export interface RetentionFormValues {
  amount: number
  unit: RetentionUnit
}

export const retentionMonthsOf = (values: RetentionFormValues) =>
  values.unit === 'year' ? values.amount * 12 : values.amount

/** Süre formu: tam sayı, yasal en az sürenin altı ve en çok sürenin üstü alan hatası (K-415). */
export function retentionFormSchema(
  row: Pick<StaffRetentionPolicyRow, 'legalMinimumMonths' | 'maximumMonths'>,
) {
  return z
    .object({
      amount: z.number('Süre girin.').int('Süre tam sayı olmalı.').min(1, 'Süre en az 1 olmalı.'),
      unit: z.enum(RETENTION_UNITS),
    })
    .superRefine((values, context) => {
      const months = retentionMonthsOf(values)
      if (months < row.legalMinimumMonths)
        context.addIssue({
          code: 'custom',
          path: ['amount'],
          message: `Yasal en az süre ${staffRetentionPeriodLabel(row.legalMinimumMonths)}; daha kısa süre girilemez.`,
        })
      else if (months > row.maximumMonths)
        context.addIssue({
          code: 'custom',
          path: ['amount'],
          message: `Süre en çok ${staffRetentionPeriodLabel(row.maximumMonths)} olabilir.`,
        })
    })
}

export function retentionFormDefaults(row: Pick<StaffRetentionPolicyRow, 'retentionMonths'>) {
  return row.retentionMonths % 12 === 0
    ? { amount: row.retentionMonths / 12, unit: 'year' as const }
    : { amount: row.retentionMonths, unit: 'month' as const }
}

/** Tek kategorinin gövdesi; `null` yasal en az süreye döner. */
export function retentionPolicyBody(
  category: StaffRetentionCategory,
  retentionMonths: number | null,
): UpdateStaffRetentionPoliciesBody {
  return { [category]: { retentionMonths } } as UpdateStaffRetentionPoliciesBody
}

export const periodText = (months: number) => staffRetentionPeriodLabel(months)

/** Adayın durum metni: süre doldu mu, kaç gün kaldı. */
export function dueText(row: Pick<StaffRetentionCandidateRow, 'status' | 'daysLeft' | 'dueDate'>) {
  if (row.status === 'waiting')
    return `${String(row.daysLeft)} gün kaldı (${dateLabel(row.dueDate, { year: 'numeric' })})`
  if (row.daysLeft === 0) return 'Süre bugün doldu'
  return `Süre doldu (${dateLabel(row.dueDate, { year: 'numeric' })})`
}

export const categoryLabel = (category: StaffRetentionCategory) =>
  STAFF_RETENTION_CATEGORY_LABELS[category]

/** İmha onay penceresinin uyarısı: ne silinir, nasıl, geri alınamaz. */
export function destroyNotice(
  row: Pick<StaffRetentionCandidateRow, 'name' | 'category' | 'method' | 'recordCount'>,
) {
  const what = `${row.name} adlı personelin ${categoryLabel(row.category).toLocaleLowerCase('tr')} kategorisindeki ${String(row.recordCount)} kaydı`
  return row.method === 'anonymize'
    ? `${what} kişi düzeyinde silinerek anonimleştirilecek; kurumun kişisiz toplamları (onaylı bordro dönemi ve aktarım özetleri) kalır. İşlem geri alınamaz.`
    : `${what} ve bağlı dosyaları kalıcı olarak silinecek (${STAFF_RETENTION_METHOD_LABELS.delete.toLocaleLowerCase('tr')}). İşlem geri alınamaz.`
}
