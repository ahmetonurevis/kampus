// Personel self-servisi formları ve gösterimi (DOM-FIN-166; ON-189; K-553…K-555). Formlar düz
// metin alanlarıdır; gövde core şemasıyla (`staffChangeRequestInputSchema`) aynı mesajlarla
// denetlenir. Boş iletişim alanı "değişmesin" demektir; gövdeye girmez.
import { z } from 'zod'
import type {
  CreateOwnChangeRequestBody,
  StaffChangeRequest,
} from '@kampus/react-shared/use-finance-staff-self-service.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  HEALTH_REPORT_KIND_LABELS,
  STAFF_DOCUMENT_TYPE_LABELS,
  type HealthReportKind,
  type StaffDocumentType,
} from '@kampus/school-core/lib/finance-staff-documents.ts'
import {
  STAFF_CHANGE_KIND_LABELS,
  STAFF_CHANGE_REASON_MAX,
  STAFF_CHANGE_REASON_MIN,
  STAFF_CHANGE_STATUS_LABELS,
  STAFF_CHANGE_STATUSES,
  staffChangeRequestInputSchema,
  type StaffChangeKind,
  type StaffChangeStatus,
} from '@kampus/school-core/lib/finance-staff-self-service.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

type Issue = { path: PropertyKey[]; message: string }

/** Gövdeyi core şemasından geçirir; sorunu forma ait alana taşır. */
function checkBody(
  body: unknown,
  context: z.RefinementCtx,
  field: (path: string) => string | undefined,
) {
  const parsed = staffChangeRequestInputSchema.safeParse(body)
  if (parsed.success) return
  for (const issue of parsed.error.issues as readonly Issue[]) {
    const target = field(issue.path.map(String).join('.'))
    context.addIssue({ code: 'custom', path: target ? [target] : [], message: issue.message })
  }
}

// --- Adres ve telefon ----------------------------------------------------------------------------

const contactFields = z.object({ address: z.string(), phone: z.string() })
export type ContactFormValues = z.input<typeof contactFields>
export const contactDefaults = (): ContactFormValues => ({ address: '', phone: '' })

export function contactBody(values: ContactFormValues): CreateOwnChangeRequestBody {
  const address = values.address.trim()
  const phone = values.phone.trim()
  return {
    kind: 'contact',
    ...(address === '' ? {} : { address }),
    ...(phone === '' ? {} : { phone }),
  }
}
export const contactFormField = (path: string): keyof ContactFormValues | undefined =>
  path === 'address' || path === 'phone' ? path : undefined
export const contactFormSchema = contactFields.superRefine((values, context) => {
  if (values.address.trim() === '' && values.phone.trim() === '') {
    context.addIssue({
      code: 'custom',
      path: ['address'],
      message: 'Değiştirilecek adresi ya da telefonu yazın.',
    })
    return
  }
  checkBody(contactBody(values), context, contactFormField)
})

// --- Acil durum kişileri -------------------------------------------------------------------------

const personFields = z.object({ name: z.string(), relation: z.string(), phone: z.string() })
const emergencyFields = z.object({ contacts: z.array(personFields) })
export type EmergencyFormValues = z.input<typeof emergencyFields>
export const EMPTY_PERSON = { name: '', relation: '', phone: '' } as const

export function emergencyDefaults(
  current: readonly { name: string; relation: string; phone: string }[] | undefined,
): EmergencyFormValues {
  return {
    contacts:
      current === undefined || current.length === 0
        ? [{ ...EMPTY_PERSON }]
        : current.map((person) => ({ ...person })),
  }
}
export function emergencyBody(values: EmergencyFormValues): CreateOwnChangeRequestBody {
  return {
    kind: 'emergency_contacts',
    emergencyContacts: values.contacts.map((person) => ({
      name: person.name.trim(),
      relation: person.relation.trim(),
      phone: person.phone.trim(),
    })),
  }
}
/** `emergencyContacts.0.phone` → `contacts.0.phone`. */
export function emergencyFormField(path: string): string | undefined {
  const match = /^emergencyContacts\.(\d+)\.(name|relation|phone)$/.exec(path)
  if (match) return `contacts.${match[1] ?? '0'}.${match[2] ?? 'name'}`
  return path === 'emergencyContacts' ? 'contacts' : undefined
}
export const emergencyFormSchema = emergencyFields.superRefine((values, context) =>
  checkBody(emergencyBody(values), context, emergencyFormField),
)

// --- Banka ---------------------------------------------------------------------------------------

const bankFields = z.object({ iban: z.string(), accountHolder: z.string() })
export type BankFormValues = z.input<typeof bankFields>
export const bankDefaults = (name: string): BankFormValues => ({ iban: '', accountHolder: name })
export const bankBody = (values: BankFormValues): CreateOwnChangeRequestBody => ({
  kind: 'bank',
  iban: values.iban,
  accountHolder: values.accountHolder.trim(),
})
export const bankFormField = (path: string): keyof BankFormValues | undefined =>
  path === 'iban' || path === 'accountHolder' ? path : undefined
export const bankFormSchema = bankFields.superRefine((values, context) =>
  checkBody(bankBody(values), context, bankFormField),
)

// --- Belge ---------------------------------------------------------------------------------------

const documentFields = z.object({
  documentType: z.string(),
  healthReportKind: z.string(),
  documentDate: z.string(),
  note: z.string(),
})
export type DocumentFormValues = z.input<typeof documentFields>
export const documentDefaults = (today: string): DocumentFormValues => ({
  documentType: 'diploma',
  healthReportKind: '',
  documentDate: today,
  note: '',
})
export function documentBody(
  values: DocumentFormValues,
  fileId: string | null,
  sensitive: boolean,
): CreateOwnChangeRequestBody {
  const note = values.note.trim()
  return {
    kind: 'document',
    documentType: values.documentType as StaffDocumentType,
    healthReportKind:
      values.documentType === 'health_report' && values.healthReportKind !== ''
        ? (values.healthReportKind as HealthReportKind)
        : null,
    documentDate: values.documentDate,
    fileId,
    // Özel nitelikli türde not alanı gizlidir; önceki türde yazılmış not gönderilmez.
    note: sensitive || note === '' ? null : note,
  }
}
export const documentFormField = (path: string): keyof DocumentFormValues | undefined =>
  path === 'documentType' ||
  path === 'healthReportKind' ||
  path === 'documentDate' ||
  path === 'note'
    ? path
    : undefined
export const documentFormSchema = documentFields.superRefine((values, context) =>
  checkBody(documentBody(values, null, false), context, documentFormField),
)

// --- Ret -----------------------------------------------------------------------------------------

export const rejectFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(
      STAFF_CHANGE_REASON_MIN,
      `Ret gerekçesi en az ${String(STAFF_CHANGE_REASON_MIN)} karakter olmalı.`,
    )
    .max(
      STAFF_CHANGE_REASON_MAX,
      `Ret gerekçesi en çok ${String(STAFF_CHANGE_REASON_MAX)} karakter olabilir.`,
    ),
})
export type RejectFormValues = z.input<typeof rejectFormSchema>

// --- Gösterim ------------------------------------------------------------------------------------

export const kindLabel = (kind: StaffChangeKind) => STAFF_CHANGE_KIND_LABELS[kind]
export const changeStatusLabel = (status: StaffChangeStatus) => STAFF_CHANGE_STATUS_LABELS[status]
export function changeStatusTone(status: StaffChangeStatus): BadgeTone {
  switch (status) {
    case 'pending':
      return 'amber'
    case 'approved':
      return 'green'
    case 'rejected':
      return 'red'
    case 'cancelled':
      return 'gray'
    default:
      return status satisfies never
  }
}
export const CHANGE_STATUS_OPTIONS = STAFF_CHANGE_STATUSES.map((value) => ({
  value,
  label: STAFF_CHANGE_STATUS_LABELS[value],
}))

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const cleared = 'silinsin'

/** Önerinin tek satırlık özeti (liste hücresi). IBAN zaten maskeli gelir. */
export function proposalText(proposal: StaffChangeRequest['proposal']): string {
  switch (proposal.kind) {
    case 'contact':
      return [
        proposal.address === undefined ? null : `Adres: ${proposal.address ?? cleared}`,
        proposal.phone === undefined ? null : `Telefon: ${proposal.phone ?? cleared}`,
      ]
        .filter((part) => part !== null)
        .join(' · ')
    case 'emergency_contacts':
      return proposal.emergencyContacts
        .map((person) => `${person.name} (${person.relation}) ${person.phone}`)
        .join(' · ')
    case 'bank':
      return `${proposal.ibanMasked} · ${proposal.accountHolder}`
    case 'document':
      return [
        STAFF_DOCUMENT_TYPE_LABELS[proposal.documentType],
        proposal.healthReportKind === null
          ? null
          : HEALTH_REPORT_KIND_LABELS[proposal.healthReportKind],
        dayText(proposal.documentDate),
        proposal.hasFile ? 'dosyalı' : 'dosyasız',
      ]
        .filter((part) => part !== null)
        .join(' · ')
    default:
      return proposal satisfies never
  }
}

/** `2026-03` → "Mart 2026". */
const monthFormatter = new Intl.DateTimeFormat('tr-TR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Istanbul',
})
export const payslipMonthText = (month: string) =>
  monthFormatter.format(new Date(`${month}-15T09:00:00Z`))

export const requestDayText = (iso: string) => dateLabel(iso, { year: 'numeric' })
