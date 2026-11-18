// Personel özlük belgesi formları ve gösterimi (DOM-FIN-113; ON-173). Form tek düz nesnedir; boş
// metin alanları gövdede `null` olur. Kurallar ve mesajlar core `staffDocumentInputSchema` ve
// `staffDocumentSettingsUpdateSchema`'dandır; burada yalnız form biçimi ve gösterim vardır.
import { z } from 'zod'
import type {
  CreateStaffDocumentBody,
  StaffDocument,
  StaffDocumentAlerts,
  StaffDocumentTypeSettingRow,
  UpdateStaffDocumentTypesBody,
} from '@kampus/react-shared/use-finance-staff-documents.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  HEALTH_REPORT_KIND_LABELS,
  HEALTH_REPORT_KINDS,
  isMultiDocumentType,
  STAFF_DOCUMENT_NOTE_MAX,
  STAFF_DOCUMENT_STATUS_LABELS,
  STAFF_DOCUMENT_TYPE_LABELS,
  STAFF_DOCUMENT_TYPES,
  STAFF_DOCUMENT_VALIDITY_MONTHS_MAX,
  type StaffDocumentStatus,
  type StaffDocumentType,
} from '@kampus/school-core/lib/finance-staff-documents.ts'
import { dateLabel, number } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/**
 * Takip görünümünün durum süzgeci adres parametresi (liste öneki `ozluk_takip_` + `durum`); pano
 * kartı "Tümünü gör" bunu `attention` ile verir ve sekme takip görünümüyle açılır.
 */
export const STAFF_DOCUMENT_TRACKING_DUE_PARAM = 'ozluk_takip_durum'

export const STAFF_DOCUMENT_STATUS_TONE = {
  valid: 'green',
  expiring: 'amber',
  expired: 'red',
  superseded: 'gray',
} as const satisfies Record<StaffDocumentStatus, BadgeTone>

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** "Sağlık raporu · Periyodik"; diğer türlerde tür adı. */
export function documentTitle(
  doc: Pick<StaffDocument, 'documentType' | 'healthReportKind'>,
): string {
  const label = STAFF_DOCUMENT_TYPE_LABELS[doc.documentType]
  return doc.healthReportKind === null
    ? label
    : `${label} · ${HEALTH_REPORT_KIND_LABELS[doc.healthReportKind]}`
}

/** Geçerlilik metni: süresiz, kalan gün, bugün son gün ya da geçen gün. */
export function validityText(
  doc: Pick<StaffDocument, 'validUntil' | 'daysLeft' | 'status'>,
): string {
  if (doc.validUntil === null || doc.daysLeft === null) return 'Süresiz'
  const until = `${dayText(doc.validUntil)} bitiş`
  if (doc.status === 'superseded') return until
  if (doc.daysLeft < 0) return `${until} · ${number(-doc.daysLeft)} gün geçti`
  if (doc.daysLeft === 0) return `${until} · bugün son gün`
  return `${until} · ${number(doc.daysLeft)} gün kaldı`
}

export const documentDateText = (doc: Pick<StaffDocument, 'documentDate'>) =>
  `${dayText(doc.documentDate)} tarihli`

export const statusLabel = (status: StaffDocumentStatus) => STAFF_DOCUMENT_STATUS_LABELS[status]

/** Eksik zorunlu türler: "Diploma / mezuniyet belgesi, Kimlik fotokopisi"; yoksa `null`. */
export function missingText(types: readonly StaffDocumentType[]): string | null {
  return types.length === 0
    ? null
    : types.map((type) => STAFF_DOCUMENT_TYPE_LABELS[type]).join(', ')
}

/** Uyarı rozetleri (sıfır olanlar gösterilmez). */
export function alertBadges(alerts: StaffDocumentAlerts | undefined) {
  if (alerts === undefined) return []
  const badges: { key: 'expired' | 'expiring' | 'missing'; text: string; tone: BadgeTone }[] = []
  if (alerts.expiredCount > 0)
    badges.push({
      key: 'expired',
      text: `${number(alerts.expiredCount)} belgenin süresi geçti`,
      tone: 'red',
    })
  if (alerts.expiringCount > 0)
    badges.push({
      key: 'expiring',
      text: `${number(alerts.expiringCount)} belge ${number(alerts.withinDays)} gün içinde bitiyor`,
      tone: 'amber',
    })
  if (alerts.staffMissingCount > 0)
    badges.push({
      key: 'missing',
      text: `${number(alerts.staffMissingCount)} personelin zorunlu belgesi eksik`,
      tone: 'amber',
    })
  return badges
}

/** Belge geçmişi: önce geçerliler (tür sırasıyla), sonra yerine geçilenler; türde yeni önce. */
export function sortDocuments<
  T extends Pick<StaffDocument, 'documentType' | 'documentDate'> & {
    supersededAt: string | null
  },
>(docs: readonly T[]): T[] {
  const order = (doc: T) =>
    (doc.supersededAt === null ? 0 : 100) + STAFF_DOCUMENT_TYPES.indexOf(doc.documentType)
  return [...docs].sort(
    (a, b) => order(a) - order(b) || b.documentDate.localeCompare(a.documentDate),
  )
}

/** Çoklu türde yerine geçilebilecek geçerli belgeler (aynı tür). */
export function replaceOptions(
  docs: readonly StaffDocument[],
  type: StaffDocumentType,
): StaffDocument[] {
  if (!isMultiDocumentType(type)) return []
  return docs.filter((doc) => doc.documentType === type && doc.supersededAt === null)
}

// --- Belge formu ---------------------------------------------------------------------------------

const optionalDay = z.union([z.literal(''), daySchema])

export const staffDocumentFormSchema = z
  .object({
    documentType: z.enum(STAFF_DOCUMENT_TYPES, 'Belge türünü seçin.'),
    healthReportKind: z.union([z.literal(''), z.enum(HEALTH_REPORT_KINDS)]),
    documentDate: daySchema,
    validUntil: optionalDay,
    replacesDocumentId: z.string(),
    note: z
      .string()
      .trim()
      .max(
        STAFF_DOCUMENT_NOTE_MAX,
        `En fazla ${String(STAFF_DOCUMENT_NOTE_MAX)} karakter girebilirsiniz.`,
      ),
  })
  .superRefine((value, context) => {
    if (value.documentType === 'health_report' && value.healthReportKind === '')
      context.addIssue({
        code: 'custom',
        path: ['healthReportKind'],
        message: 'Raporun işe giriş ya da periyodik olduğunu seçin.',
      })
    if (value.validUntil !== '' && value.validUntil < value.documentDate)
      context.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'Geçerlilik bitişi belge tarihinden önce olamaz.',
      })
  })
export type StaffDocumentFormValues = z.input<typeof staffDocumentFormSchema>

export const staffDocumentDefaults = (today: string): StaffDocumentFormValues => ({
  documentType: 'diploma',
  healthReportKind: '',
  documentDate: today,
  validUntil: '',
  replacesDocumentId: '',
  note: '',
})

/** Gövde: sağlık raporu dışında rapor türü, çoklu tür dışında yerine geçme seçimi gitmez. */
export function staffDocumentBody(
  membershipId: string,
  values: StaffDocumentFormValues,
  fileId: string | null,
): CreateStaffDocumentBody {
  const note = values.note.trim()
  return {
    membershipId,
    documentType: values.documentType,
    healthReportKind:
      values.documentType === 'health_report' && values.healthReportKind !== ''
        ? values.healthReportKind
        : null,
    documentDate: values.documentDate,
    validUntil: values.validUntil === '' ? null : values.validUntil,
    fileId,
    note: note === '' ? null : note,
    replacesDocumentId:
      isMultiDocumentType(values.documentType) && values.replacesDocumentId !== ''
        ? values.replacesDocumentId
        : null,
  }
}

const FORM_FIELDS = [
  'documentType',
  'healthReportKind',
  'documentDate',
  'validUntil',
  'replacesDocumentId',
  'note',
] as const
/** Sunucu alan hatasının form alanı; `membershipId`, `fileId` gibi alanlar kök hataya düşer. */
export function staffDocumentFormField(name: string): (typeof FORM_FIELDS)[number] | null {
  return (FORM_FIELDS as readonly string[]).includes(name)
    ? (name as (typeof FORM_FIELDS)[number])
    : null
}

// --- Tür ayarları formu --------------------------------------------------------------------------

export type TypeSettingFormRow = {
  documentType: StaffDocumentType
  required: boolean
  /** Ay; boş metin süresiz. */
  validityMonths: string
  sensitive: boolean
}

export const typeSettingsDefaults = (
  rows: readonly StaffDocumentTypeSettingRow[],
): TypeSettingFormRow[] =>
  rows.map((row) => ({
    documentType: row.documentType,
    required: row.required,
    validityMonths: row.validityMonths === null ? '' : String(row.validityMonths),
    sensitive: row.sensitive,
  }))

const MONTHS_MESSAGE = `Geçerlilik süresi 1–${String(STAFF_DOCUMENT_VALIDITY_MONTHS_MAX)} ay arasında tam sayı olmalıdır.`

/**
 * Değişen satırların gövdesi; geçersiz süre alan hatası olarak döner. Değişiklik yoksa gövde
 * `null`'dur (istek gönderilmez).
 */
export function typeSettingsBody(
  rows: readonly TypeSettingFormRow[],
  original: readonly StaffDocumentTypeSettingRow[],
):
  | { ok: true; body: UpdateStaffDocumentTypesBody | null }
  | { ok: false; errors: Partial<Record<StaffDocumentType, string>> } {
  const errors: Partial<Record<StaffDocumentType, string>> = {}
  const body: Partial<
    Record<StaffDocumentType, NonNullable<UpdateStaffDocumentTypesBody['diploma']>>
  > = {}
  for (const row of rows) {
    const text = row.validityMonths.trim()
    const months = text === '' ? null : Number(text)
    if (
      months !== null &&
      (!Number.isInteger(months) || months < 1 || months > STAFF_DOCUMENT_VALIDITY_MONTHS_MAX)
    ) {
      errors[row.documentType] = MONTHS_MESSAGE
      continue
    }
    const before = original.find((item) => item.documentType === row.documentType)
    if (
      before !== undefined &&
      before.required === row.required &&
      before.validityMonths === months &&
      before.sensitive === row.sensitive
    )
      continue
    body[row.documentType] = {
      required: row.required,
      validityMonths: months,
      sensitive: row.sensitive,
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, body: Object.keys(body).length === 0 ? null : body }
}
