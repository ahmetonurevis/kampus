// Servis belgesi formu ve gösterimi (DOM-FIN-147; ON-147; K-496…K-498). Form tek düz nesnedir; boş
// metin alanları gövdede `null` olur. Kurallar ve mesajlar core `transportDocumentInputSchema`'dan
// gelir (sunucu yeniden denetler); burada yalnız form biçimi, gövde ve gösterim metinleri vardır.
import { z } from 'zod'
import type {
  TransportDocumentAlerts,
  TransportDocumentBody,
  TransportDocumentRow,
  TransportVehicleFitness,
} from '@kampus/react-shared/use-finance-transport-documents.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  DRIVING_LICENSE_CLASSES,
  isEndDateRequired,
  TRANSPORT_DOCUMENT_NUMBER_MAX,
  TRANSPORT_DOCUMENT_STATUS_LABELS,
  TRANSPORT_DOCUMENT_SUBJECT_LABELS,
  TRANSPORT_DOCUMENT_SUBJECTS,
  TRANSPORT_DOCUMENT_TYPE_LABELS,
  TRANSPORT_DOCUMENT_TYPES,
  TRANSPORT_DOCUMENT_WARNING_DAYS_MAX,
  TRANSPORT_DOCUMENT_WARNING_DAYS_MIN,
  transportDocumentDaysText,
  transportDocumentTypesFor,
  transportDocumentTypesText,
  type TransportDocumentStatus,
  type TransportDocumentSubject,
  type TransportDocumentType,
} from '@kampus/school-core/lib/finance-transport-documents.ts'
import { transportPlateLabel } from '@kampus/school-core/lib/finance-transport.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

export const TRANSPORT_DOCUMENT_STATUS_TONE = {
  valid: 'green',
  expiring: 'amber',
  expired: 'red',
  superseded: 'gray',
} as const satisfies Record<TransportDocumentStatus, BadgeTone>

export const documentTypeText = (type: TransportDocumentType) =>
  TRANSPORT_DOCUMENT_TYPE_LABELS[type]
export const subjectKindText = (subject: TransportDocumentSubject) =>
  TRANSPORT_DOCUMENT_SUBJECT_LABELS[subject]
export const statusText = (status: TransportDocumentStatus) =>
  TRANSPORT_DOCUMENT_STATUS_LABELS[status]

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Belgenin sahibi: "34 KMP 101", "Sürücü Ali Sürücü · 34 KMP 101", "Rehber Selin Kaya". */
export function subjectText(
  row: Pick<TransportDocumentRow, 'subject' | 'vehiclePlate' | 'subjectName'>,
): string {
  const plate = row.vehiclePlate === null ? null : transportPlateLabel(row.vehiclePlate)
  if (row.subject === 'vehicle') return plate ?? '—'
  const name = row.subjectName ?? '—'
  if (row.subject === 'staff') return `Personel ${name}`
  return plate === null ? `Sürücü ${name}` : `Sürücü ${name} · ${plate}`
}

/** Tür ve ehliyette sınıf: "Sürücü belgesi (ehliyet) · D". */
export function documentTitle(
  row: Pick<TransportDocumentRow, 'documentType' | 'licenseClass'>,
): string {
  const label = documentTypeText(row.documentType)
  return row.licenseClass === null ? label : `${label} · ${row.licenseClass}`
}

/** "10 Oca 2026 – 10 Oca 2027"; bitişsizde "10 Oca 2026'dan, süresiz". */
export function periodText(row: Pick<TransportDocumentRow, 'startDate' | 'endDate'>): string {
  return row.endDate === null
    ? `${dayText(row.startDate)} · süresiz`
    : `${dayText(row.startDate)} – ${dayText(row.endDate)}`
}

/** Durum ve kalan gün: "Süresi yaklaşıyor · 12 gün kaldı". Önceki sürücünün belgesi ayrıca yazılır. */
export function statusLine(
  row: Pick<TransportDocumentRow, 'status' | 'daysLeft' | 'counted' | 'subject'>,
): string {
  const base =
    row.status === 'superseded'
      ? statusText(row.status)
      : `${statusText(row.status)} · ${transportDocumentDaysText(row.daysLeft)}`
  if (row.counted || row.status === 'superseded') return base
  return `${base} · ${row.subject === 'driver' ? 'önceki sürücü' : 'uyarıya sayılmaz'}`
}

/** Sekme rozeti: süresi geçen + yaklaşan belge; uyarı yoksa rozet yok. */
export function alertCount(alerts: TransportDocumentAlerts | undefined): number | undefined {
  if (alerts === undefined) return undefined
  const total = alerts.expiredCount + alerts.expiringCount
  return total === 0 ? undefined : total
}

/** Araç uygunluğu metni (K-498): "Uygun değil: Araç muayenesi", "Eksik belge", "Uygun". */
export function fitnessText(vehicle: TransportVehicleFitness): string {
  if (!vehicle.fit) return `Uygun değil: ${transportDocumentTypesText(vehicle.expiredTypes)}`
  if (vehicle.missingVehicleTypes.length + vehicle.missingDriverTypes.length > 0)
    return 'Eksik belge'
  return 'Uygun'
}
export const fitnessTone = (vehicle: TransportVehicleFitness): BadgeTone =>
  !vehicle.fit
    ? 'red'
    : vehicle.missingVehicleTypes.length + vehicle.missingDriverTypes.length > 0
      ? 'amber'
      : 'green'

/** Eksik türlerin metni: "Araç: Koltuk sigortası · Sürücü: SRC" (yoksa `null`). */
export function missingText(vehicle: TransportVehicleFitness): string | null {
  const parts = [
    vehicle.missingVehicleTypes.length === 0
      ? null
      : `Araç: ${transportDocumentTypesText(vehicle.missingVehicleTypes)}`,
    vehicle.missingDriverTypes.length === 0
      ? null
      : `Sürücü: ${transportDocumentTypesText(vehicle.missingDriverTypes)}`,
  ].filter((part) => part !== null)
  return parts.length === 0 ? null : parts.join(' · ')
}

// --- Belge formu ---------------------------------------------------------------------------------

const optionalDay = z.union([z.literal(''), daySchema])

export const transportDocumentFormSchema = z
  .object({
    subject: z.enum(TRANSPORT_DOCUMENT_SUBJECTS, 'Belgenin kime ait olduğunu seçin.'),
    vehicleId: z.string(),
    membershipId: z.string(),
    documentType: z.enum(TRANSPORT_DOCUMENT_TYPES, 'Belge türünü seçin.'),
    documentNumber: z
      .string()
      .trim()
      .max(
        TRANSPORT_DOCUMENT_NUMBER_MAX,
        `En çok ${String(TRANSPORT_DOCUMENT_NUMBER_MAX)} karakter girebilirsiniz.`,
      ),
    licenseClass: z.union([z.literal(''), z.enum(DRIVING_LICENSE_CLASSES)]),
    startDate: daySchema,
    endDate: optionalDay,
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message })
    if (value.subject === 'staff' && value.membershipId === '')
      issue('membershipId', 'Personeli seçin.')
    if (value.subject !== 'staff' && value.vehicleId === '') issue('vehicleId', 'Aracı seçin.')
    if (
      !(transportDocumentTypesFor(value.subject) as readonly string[]).includes(value.documentType)
    )
      issue('documentType', 'Belge türünü seçin.')
    if (value.documentType === 'driving_license' && value.licenseClass === '')
      issue('licenseClass', 'Ehliyet sınıfını seçin.')
    if (isEndDateRequired(value.documentType) && value.endDate === '')
      issue('endDate', 'Geçerlilik bitişini girin.')
    if (value.endDate !== '' && value.endDate < value.startDate)
      issue('endDate', 'Bitiş başlangıçtan önce olamaz.')
  })
export type TransportDocumentFormValues = z.input<typeof transportDocumentFormSchema>

export const transportDocumentDefaults = (
  today: string,
  subject: TransportDocumentSubject = 'vehicle',
): TransportDocumentFormValues => ({
  subject,
  vehicleId: '',
  membershipId: '',
  documentType: transportDocumentTypesFor(subject)[0],
  documentNumber: '',
  licenseClass: '',
  startDate: today,
  endDate: '',
})

/** Formdan gövde: özneye ait olmayan alanlar `null` gider (sunucu yeniden denetler). */
export function transportDocumentBody(
  values: TransportDocumentFormValues,
  fileId: string | null,
): TransportDocumentBody {
  const number = values.documentNumber.trim()
  return {
    subject: values.subject,
    vehicleId: values.subject === 'staff' || values.vehicleId === '' ? null : values.vehicleId,
    membershipId:
      values.subject === 'staff' && values.membershipId !== '' ? values.membershipId : null,
    documentType: values.documentType,
    documentNumber: values.subject === 'vehicle' && number !== '' ? number : null,
    licenseClass:
      values.documentType === 'driving_license' && values.licenseClass !== ''
        ? values.licenseClass
        : null,
    startDate: values.startDate,
    endDate: values.endDate === '' ? null : values.endDate,
    fileId,
  }
}

const FORM_FIELDS = [
  'subject',
  'vehicleId',
  'membershipId',
  'documentType',
  'documentNumber',
  'licenseClass',
  'startDate',
  'endDate',
] as const

/** Sunucunun alan hatası formda hangi alana düşer (`fileId` ve bilinmeyenler kök hataya). */
export function transportDocumentFormField(name: string): (typeof FORM_FIELDS)[number] | null {
  return (FORM_FIELDS as readonly string[]).includes(name)
    ? (name as (typeof FORM_FIELDS)[number])
    : null
}

// --- Uyarı ayarı ---------------------------------------------------------------------------------

export const warningDaysFormSchema = z.object({
  warningDays: z
    .string()
    .trim()
    .refine(
      (value) =>
        /^\d+$/.test(value) &&
        Number(value) >= TRANSPORT_DOCUMENT_WARNING_DAYS_MIN &&
        Number(value) <= TRANSPORT_DOCUMENT_WARNING_DAYS_MAX,
      `Uyarı süresi ${String(TRANSPORT_DOCUMENT_WARNING_DAYS_MIN)} ile ${String(TRANSPORT_DOCUMENT_WARNING_DAYS_MAX)} gün arasında olmalı.`,
    ),
})
export type WarningDaysFormValues = z.input<typeof warningDaysFormSchema>
