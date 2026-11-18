// Personel sağlık raporu formu ve gösterimi (DOM-FIN-110; ON-185). Form tek düz nesnedir; veren
// kurum türü boş seçenekle isteğe bağlıdır. Gün sırası, en uzun süre ve türler core
// `medicalReportInputSchema`'dan gelir (aynı mesajlar). Tanı alanı yoktur (K-363).
import { z } from 'zod'
import type {
  CreateMedicalReportBody,
  MedicalReport,
} from '@kampus/react-shared/use-finance-medical-reports.ts'
import {
  MEDICAL_REPORT_ISSUER_LABELS,
  MEDICAL_REPORT_ISSUERS,
  MEDICAL_REPORT_TYPE_LABELS,
  MEDICAL_REPORT_TYPES,
  medicalReportInputSchema,
  monthPeriod,
  type MedicalReportType,
} from '@kampus/school-core/lib/finance-medical-reports.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

const fieldsSchema = z.object({
  reportType: z.enum(MEDICAL_REPORT_TYPES, 'Rapor türünü seçin.'),
  startDate: z.string(),
  endDate: z.string(),
  issuerType: z.union([z.literal(''), z.enum(MEDICAL_REPORT_ISSUERS)]),
})
export type MedicalReportFormValues = z.input<typeof fieldsSchema>
type FormField = keyof MedicalReportFormValues

/** Gövde alanı → form alanı (sunucu `issues` eşlemesi). */
const BODY_FIELDS: Readonly<Record<string, FormField>> = {
  reportType: 'reportType',
  startDate: 'startDate',
  endDate: 'endDate',
  issuerType: 'issuerType',
}
export const medicalReportFormField = (name: string): FormField | undefined => BODY_FIELDS[name]

export const medicalReportDefaults = (today: string): MedicalReportFormValues => ({
  reportType: 'sickness',
  startDate: today,
  endDate: today,
  issuerType: '',
})

/** Formdan gövde: dosya ayrı yüklenir ve kimliğiyle gelir. */
export function medicalReportBody(
  membershipId: string,
  values: MedicalReportFormValues,
  fileId: string | null,
): CreateMedicalReportBody {
  return {
    membershipId,
    reportType: values.reportType,
    startDate: values.startDate,
    endDate: values.endDate,
    issuerType: values.issuerType === '' ? null : values.issuerType,
    fileId,
  }
}

/** Form şeması: gövdeyi core şemasından geçirir, hatayı form alanına taşır. */
export function medicalReportFormSchema(membershipId: string) {
  return fieldsSchema.superRefine((values, context) => {
    const parsed = medicalReportInputSchema.safeParse(medicalReportBody(membershipId, values, null))
    if (parsed.success) return
    for (const issue of parsed.error.issues) {
      const field = medicalReportFormField(String(issue.path[0] ?? ''))
      if (field) context.addIssue({ code: 'custom', path: [field], message: issue.message })
    }
  })
}

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** "5 Eki 2026 – 7 Eki 2026 · 3 gün". */
export function reportPeriodText(
  report: Pick<MedicalReport, 'startDate' | 'endDate' | 'dayCount'>,
) {
  const range =
    report.startDate === report.endDate
      ? dayText(report.startDate)
      : `${dayText(report.startDate)} – ${dayText(report.endDate)}`
  return `${range} · ${String(report.dayCount)} gün`
}

export const reportTitle = (report: Pick<MedicalReport, 'reportType'>) =>
  MEDICAL_REPORT_TYPE_LABELS[report.reportType]

export const issuerText = (report: Pick<MedicalReport, 'issuerType'>) =>
  report.issuerType === null ? null : MEDICAL_REPORT_ISSUER_LABELS[report.issuerType]

/** İşaret özeti: SGK onayı, yalnız bildirim ya da ikisi de yok. */
export function flagsText(report: Pick<MedicalReport, 'employerNotifiedAt' | 'sgkApprovedAt'>) {
  if (report.sgkApprovedAt !== null) return 'İşverene bildirildi · SGK sisteminde onaylandı'
  if (report.employerNotifiedAt !== null) return 'İşverene bildirildi · SGK onayı bekliyor'
  return 'İşverene bildirilmedi'
}

/** Türe göre gün özeti; sıfır olan tür yazılmaz. */
export function byTypeText(byType: Readonly<Record<MedicalReportType, number>>): string {
  const parts = MEDICAL_REPORT_TYPES.filter((type) => byType[type] > 0).map(
    (type) => `${MEDICAL_REPORT_TYPE_LABELS[type]} ${String(byType[type])}`,
  )
  return parts.length === 0 ? '—' : parts.join(' · ')
}

/** Ay seçicisi (`YYYY-MM`) → dönem; geçersiz değerde bugünün ayı. */
export function monthToPeriod(month: string, today: string): { from: string; to: string } {
  return monthPeriod(/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `${month}-01` : today)
}
