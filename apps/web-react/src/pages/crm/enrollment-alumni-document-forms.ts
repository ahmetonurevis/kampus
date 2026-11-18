// Mezun belge talebi formları (DOM-KAY-044; ON-260): form değerleri metin, gönderimde API gövdesine
// çevrilir. Kural sunucudadır (core `planAlumniDocumentRequest`); form yalnız alanların doluluğunu
// ve biçimini denetler, sunucu iletisi alana (`setError`) ya da kök hataya düşer.
import { z } from 'zod'
import type {
  AlumniRequestRow,
  AlumniStudent,
  CreateAlumniRequestBody,
} from '@kampus/react-shared/use-enrollment-alumni-documents.ts'
import {
  ALUMNI_COPIES_MAX,
  ALUMNI_DELIVERY_LABELS,
  ALUMNI_DELIVERY_METHODS,
  ALUMNI_DOCUMENT_TYPE_LABELS,
  ALUMNI_DOCUMENT_TYPES,
  ALUMNI_FEE_MAX_CENTS,
  ALUMNI_REQUEST_CHANNELS,
  ALUMNI_REQUEST_STATUS_LABELS,
  ALUMNI_REQUESTER_KINDS,
  ALUMNI_REQUESTER_LABELS,
  type AlumniDocumentType,
  type AlumniRequestStatus,
} from '@kampus/school-core/lib/enrollment-alumni-documents.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

const YEAR = { year: 'numeric' } as const

export const ALUMNI_STATUS_TONES = {
  received: 'amber',
  preparing: 'purple',
  ready: 'green',
  delivered: 'gray',
  rejected: 'red',
} as const satisfies Record<AlumniRequestStatus, BadgeTone>

export const alumniRequestFormSchema = z
  .object({
    studentId: z.string().min(1, 'Öğrenciyi seçin.'),
    documentType: z.enum(ALUMNI_DOCUMENT_TYPES, 'Belge türünü seçin.'),
    copies: z
      .string()
      .regex(/^\d{1,2}$/, 'Adedi girin.')
      .refine(
        (value) => Number(value) >= 1 && Number(value) <= ALUMNI_COPIES_MAX,
        `Adet 1 ile ${String(ALUMNI_COPIES_MAX)} arasında olmalıdır.`,
      ),
    channel: z.enum(ALUMNI_REQUEST_CHANNELS, 'Talebin nasıl geldiğini seçin.'),
    requesterKind: z.enum(ALUMNI_REQUESTER_KINDS, 'Talep edeni seçin.'),
    guardianParentId: z.string(),
    proxyName: z.string().max(120, 'En fazla 120 karakter girebilirsiniz.'),
    deliveryMethod: z.enum(ALUMNI_DELIVERY_METHODS, 'Teslim yolunu seçin.'),
    deliveryEmail: z.string().max(254, 'Geçerli bir e-posta adresi girin.'),
    deliveryAddress: z.string().max(500, 'En fazla 500 karakter girebilirsiniz.'),
  })
  .superRefine((values, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })
    if (values.requesterKind === 'guardian' && values.guardianParentId === '')
      issue('guardianParentId', 'Talep eden veliyi seçin.')
    if (values.requesterKind === 'proxy' && values.proxyName.trim().length < 2)
      issue('proxyName', 'Vekilin adını yazın.')
    if (values.deliveryMethod === 'email' && values.deliveryEmail.trim() === '')
      issue('deliveryEmail', 'Belgenin gönderileceği e-posta adresini girin.')
    if (values.deliveryMethod === 'cargo' && values.deliveryAddress.trim().length < 10)
      issue('deliveryAddress', 'Kargo adresini açık yazın.')
  })
export type AlumniRequestFormValues = z.infer<typeof alumniRequestFormSchema>

export const ALUMNI_REQUEST_DEFAULTS: AlumniRequestFormValues = {
  studentId: '',
  documentType: 'education_certificate',
  copies: '1',
  channel: 'in_person',
  requesterKind: 'self',
  guardianParentId: '',
  proxyName: '',
  deliveryMethod: 'in_person',
  deliveryEmail: '',
  deliveryAddress: '',
}

export const ALUMNI_FORM_FIELDS = [
  'studentId',
  'documentType',
  'copies',
  'channel',
  'requesterKind',
  'guardianParentId',
  'proxyName',
  'deliveryMethod',
  'deliveryEmail',
  'deliveryAddress',
] as const
export type AlumniFormField = (typeof ALUMNI_FORM_FIELDS)[number] | 'authorizationFileId'

/** Sunucu iletisinin alanı; formda olmayan yol kök hataya düşer. */
export function alumniFormField(path: string): AlumniFormField | null {
  if (path === 'authorizationFileId') return 'authorizationFileId'
  return ALUMNI_FORM_FIELDS.find((field) => field === path) ?? null
}

export function createAlumniRequestBody(
  values: AlumniRequestFormValues,
  authorizationFileId: string | null,
): CreateAlumniRequestBody {
  return {
    studentId: values.studentId,
    documentType: values.documentType,
    copies: Number(values.copies),
    channel: values.channel,
    requesterKind: values.requesterKind,
    ...(values.requesterKind === 'guardian' ? { guardianParentId: values.guardianParentId } : {}),
    ...(values.requesterKind === 'proxy' ? { proxyName: values.proxyName.trim() } : {}),
    ...(values.requesterKind !== 'self' && authorizationFileId !== null
      ? { authorizationFileId }
      : {}),
    deliveryMethod: values.deliveryMethod,
    ...(values.deliveryMethod === 'email' ? { deliveryEmail: values.deliveryEmail.trim() } : {}),
    ...(values.deliveryMethod === 'cargo'
      ? { deliveryAddress: values.deliveryAddress.trim() }
      : {}),
  }
}

/**
 * Seçilen kişi ve talep edene göre gereken yetki belgesi (K-328): vekilde vekâletname, reşit (ya da
 * yaşı bilinmeyen) kişinin velisinde yazılı rıza; gerekmiyorsa `null`.
 */
export function authorizationNeed(
  student: Pick<AlumniStudent, 'adult'> | undefined,
  requesterKind: AlumniRequestFormValues['requesterKind'],
): 'proxy' | 'consent' | null {
  if (requesterKind === 'proxy') return 'proxy'
  if (requesterKind === 'guardian' && student?.adult !== false) return 'consent'
  return null
}

/** Seçilebilecek veliler: velayetli ve iletişim kısıtı olmayan bağlar (DOM-ILT-070, DOM-ILT-074). */
export function eligibleGuardians(student: AlumniStudent | undefined) {
  return (student?.guardians ?? []).filter(
    (guardian) => guardian.custody !== 'none' && !guardian.contactRestricted,
  )
}

/** Belge türleri; diploma örneği yalnız okulda ve mezuna (K-331). */
export function documentTypeOptions(
  institutionType: string | undefined,
  student: Pick<AlumniStudent, 'status'> | undefined,
): AlumniDocumentType[] {
  return ALUMNI_DOCUMENT_TYPES.filter(
    (type) =>
      type !== 'diploma_copy' ||
      (institutionType !== 'language_school' && student?.status !== 'withdrawn'),
  )
}

export const studentOptionLabel = (student: AlumniStudent) =>
  [
    student.name,
    student.schoolNumber,
    student.status === 'graduated' ? 'Mezun' : 'Ayrıldı',
    student.leftDate === null ? null : dateLabel(`${student.leftDate}T09:00:00.000Z`, YEAR),
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ')

export type AlumniListRow = {
  id: string
  number: string
  student: string
  document: string
  requester: string
  delivery: string
  fee: string
  received: string
  status: AlumniRequestStatus
  statusLabel: string
}

export function alumniListRow(row: AlumniRequestRow): AlumniListRow {
  return {
    id: row.id,
    number: row.documentNumber ?? '—',
    student: row.studentName ?? '—',
    document: `${ALUMNI_DOCUMENT_TYPE_LABELS[row.documentType]} × ${String(row.copies)}`,
    requester: `${row.requesterName} (${ALUMNI_REQUESTER_LABELS[row.requesterKind]})`,
    delivery: ALUMNI_DELIVERY_LABELS[row.deliveryMethod],
    fee:
      row.feeCents === 0
        ? 'Ücretsiz'
        : `${money(row.feeCents)}${row.paidAt === null ? '' : ' · ödendi'}`,
    received: dateLabel(row.receivedAt, YEAR),
    status: row.status,
    statusLabel: ALUMNI_REQUEST_STATUS_LABELS[row.status],
  }
}

// --- Ücret ayarı ---------------------------------------------------------------------------------

const feeText = z
  .string()
  .refine(
    (value) =>
      parseAmountInput(value, { allowZero: true, maxCents: ALUMNI_FEE_MAX_CENTS }) !== null,
    'Ücreti 0 ile 10.000,00 ₺ arasında girin.',
  )
export const alumniFeesFormSchema = z.object({
  education_certificate: feeText,
  transcript: feeText,
  diploma_copy: feeText,
})
export type AlumniFeesFormValues = z.infer<typeof alumniFeesFormSchema>

export const alumniFeesDefaults = (fees: Record<AlumniDocumentType, number> | undefined) =>
  Object.fromEntries(
    ALUMNI_DOCUMENT_TYPES.map((type) => [type, amountInputValue(fees?.[type] ?? 0)]),
  ) as AlumniFeesFormValues

/** Yalnız değişen türler gönderilir. */
export function alumniFeesBody(
  values: AlumniFeesFormValues,
  current: Record<AlumniDocumentType, number> | undefined,
): Partial<Record<AlumniDocumentType, number>> {
  const body: Partial<Record<AlumniDocumentType, number>> = {}
  for (const type of ALUMNI_DOCUMENT_TYPES) {
    const cents = parseAmountInput(values[type], {
      allowZero: true,
      maxCents: ALUMNI_FEE_MAX_CENTS,
    })
    if (cents !== null && cents !== (current?.[type] ?? 0)) body[type] = cents
  }
  return body
}
