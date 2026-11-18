import { z } from 'zod'
import type {
  CertificateStaffRow,
  CreateStaffCertificateBody,
} from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  STAFF_CERTIFICATE_KIND_LABELS,
  staffCertificateInputSchema,
  type StaffCertificateKind,
} from '@kampus/school-core/lib/finance-staff-certificates.ts'
import { STAFF_ROLE_LABELS, isStaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

// Personel belgesi formunun saf mantığı (DOM-FIN-106; ON-175): varsayılanlar personelin durumundan
// ve son belgesinden (K-340), gövde ve doğrulama core şemasından. Bileşen yalnız bağlar.

export type StaffCertificateFormValues = {
  membershipId: string
  kind: StaffCertificateKind
  position: string
  hireDate: string
  exitDate: string
  identityNumber: string
  addressee: string
  includeWage: boolean
}

const FORM_FIELDS = [
  'membershipId',
  'kind',
  'position',
  'hireDate',
  'exitDate',
  'identityNumber',
  'addressee',
  'includeWage',
] as const satisfies readonly (keyof StaffCertificateFormValues)[]
type FormField = (typeof FORM_FIELDS)[number]

/** Sunucu ya da core hatasının yolu forma düşen alansa onu verir; değilse kök hata. */
export function staffCertificateFormField(name: string): FormField | null {
  return (FORM_FIELDS as readonly string[]).includes(name) ? (name as FormField) : null
}

/** Personelin rol etiketi; bilinmeyen rol olduğu gibi. */
export const staffRoleText = (role: string) => (isStaffRole(role) ? STAFF_ROLE_LABELS[role] : role)

/** Seçim listesi satırı: "Ad · Rol" ve ayrılan personelde "ayrıldı". */
export const staffOptionText = (staff: Pick<CertificateStaffRow, 'name' | 'role' | 'active'>) =>
  `${staff.name} · ${staffRoleText(staff.role)}${staff.active ? '' : ' · ayrıldı'}`

export const emptyStaffCertificateForm = (): StaffCertificateFormValues => ({
  membershipId: '',
  kind: 'employment',
  position: '',
  hireDate: '',
  exitDate: '',
  identityNumber: '',
  addressee: '',
  includeWage: false,
})

/**
 * Personel seçilince önerilen değerler (K-340): etkin personele çalışma, ayrılana hizmet belgesi;
 * görev ve işe giriş son belgeden (yoksa görev rol adı), ayrılış pasifleştirme gününden. Muhatap,
 * kimlik no ve ücret seçimi korunur.
 */
export function staffCertificateDefaults(
  staff: CertificateStaffRow,
  current: StaffCertificateFormValues,
): StaffCertificateFormValues {
  return {
    ...current,
    membershipId: staff.membershipId,
    kind: staff.active ? 'employment' : 'service',
    position: staff.lastPosition ?? staffRoleText(staff.role),
    hireDate: staff.lastHireDate ?? '',
    exitDate: staff.leftDate ?? '',
    includeWage: staff.active ? current.includeWage : false,
  }
}

/** API gövdesi: türe göre çıkış günü ya da ücret seçimi; boş metinler core'da `null` olur. */
export function staffCertificateBody(
  values: StaffCertificateFormValues,
): CreateStaffCertificateBody {
  const common = {
    membershipId: values.membershipId,
    position: values.position,
    hireDate: values.hireDate,
    identityNumber: values.identityNumber,
    addressee: values.addressee,
  }
  return values.kind === 'service'
    ? { kind: 'service', ...common, exitDate: values.exitDate }
    : { kind: 'employment', ...common, includeWage: values.includeWage }
}

/** Form şeması: gövde core şemasıyla doğrulanır, hata alana düşer. */
export const staffCertificateFormSchema = z
  .object({
    membershipId: z.string(),
    kind: z.enum(['employment', 'service']),
    position: z.string(),
    hireDate: z.string(),
    exitDate: z.string(),
    identityNumber: z.string(),
    addressee: z.string(),
    includeWage: z.boolean(),
  })
  .superRefine((values, context) => {
    const result = staffCertificateInputSchema.safeParse(staffCertificateBody(values))
    if (result.success) return
    const seen = new Set<string>()
    for (const issue of result.error.issues) {
      const field = staffCertificateFormField(String(issue.path[0] ?? '')) ?? 'membershipId'
      if (seen.has(field)) continue
      seen.add(field)
      context.addIssue({ code: 'custom', path: [field], message: issue.message })
    }
  })

export const staffCertificateKindText = (kind: StaffCertificateKind) =>
  STAFF_CERTIFICATE_KIND_LABELS[kind]
