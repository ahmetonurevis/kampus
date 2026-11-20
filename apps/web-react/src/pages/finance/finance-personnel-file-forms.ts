import { z } from 'zod'
import type {
  PersonnelFileStaffRow,
  PersonnelFileView,
  UpdatePersonnelFileBody,
} from '@kampus/react-shared/use-finance-personnel-files.ts'
import { isValidTckn } from '@kampus/school-core/lib/finance-corporate.ts'
import {
  EDUCATION_LEVEL_LABELS,
  EDUCATION_LEVELS,
  PERSONNEL_ADDRESS_MAX,
  PERSONNEL_ADDRESS_MIN,
  PERSONNEL_EDUCATION_MAX,
  PERSONNEL_EMERGENCY_MAX,
  PERSONNEL_FILE_GROUP_LABELS,
  PERSONNEL_FILE_GROUPS,
  type EducationLevel,
  type PersonnelFileGroup,
} from '@kampus/school-core/lib/finance-personnel-files.ts'
import { isValidTurkishIban } from '@kampus/school-core/lib/withdrawals.ts'

/**
 * Özlük kartı formlarının saf mantığı (DOM-FIN-140; ON-172). Her grup ayrı formla yazılır; kart
 * yoksa ilk kayıt kartı açar (`POST`), sonra grup düzeltmesi (`PATCH`) gider. T.C. kimlik no ve
 * IBAN yanıtta maskeli olduğundan formda boş başlar: boş bırakılırsa değişmez.
 */

const PHONE = /^0\d{10}$/
const digits = (value: string) => value.replace(/\s/g, '')
const compactPhone = (value: string) => value.replace(/[\s()-]+/g, '')
const compactIban = (value: string) => value.replace(/\s/g, '').toUpperCase()
const orNull = (value: string) => (value.trim() === '' ? null : value.trim())

// --- Kimlik --------------------------------------------------------------------------------------

export const identityFormSchema = z.object({
  nationalId: z
    .string()
    .refine(
      (value) => digits(value) === '' || isValidTckn(digits(value)),
      'Geçerli bir T.C. kimlik numarası girin (11 hane).',
    ),
  birthDate: z.string(),
  removeNationalId: z.boolean(),
})
export type IdentityFormValues = z.output<typeof identityFormSchema>

export const identityDefaults = (view: PersonnelFileView['identity']): IdentityFormValues => ({
  nationalId: '',
  birthDate: view?.birthDate ?? '',
  removeNationalId: false,
})

export function identityBody(values: IdentityFormValues): UpdatePersonnelFileBody {
  const nationalId = digits(values.nationalId)
  return {
    identity: {
      ...(values.removeNationalId ? { nationalId: null } : nationalId === '' ? {} : { nationalId }),
      birthDate: values.birthDate === '' ? null : values.birthDate,
    },
  }
}

// --- İletişim ------------------------------------------------------------------------------------

export const contactFormSchema = z.object({
  address: z
    .string()
    .refine(
      (value) =>
        value.trim() === '' ||
        (value.trim().length >= PERSONNEL_ADDRESS_MIN &&
          value.trim().length <= PERSONNEL_ADDRESS_MAX),
      `Adres ${String(PERSONNEL_ADDRESS_MIN)}–${String(PERSONNEL_ADDRESS_MAX)} karakter olmalı.`,
    ),
  phone: z
    .string()
    .refine(
      (value) => compactPhone(value) === '' || PHONE.test(compactPhone(value)),
      'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.',
    ),
  email: z
    .string()
    .refine(
      (value) => value.trim() === '' || z.email().safeParse(value.trim()).success,
      'Geçerli bir e-posta adresi girin.',
    ),
})
export type ContactFormValues = z.output<typeof contactFormSchema>

export const contactDefaults = (view: PersonnelFileView['contact']): ContactFormValues => ({
  address: view?.address ?? '',
  phone: view?.phone ?? '',
  email: view?.email ?? '',
})

export const contactBody = (values: ContactFormValues): UpdatePersonnelFileBody => ({
  contact: {
    address: orNull(values.address),
    phone: compactPhone(values.phone) === '' ? null : compactPhone(values.phone),
    email: orNull(values.email),
  },
})

// --- Banka ---------------------------------------------------------------------------------------

/** IBAN zorunluluğu karta göre: banka bilgisi yoksa IBAN girilmeli, varsa boş IBAN değişmez. */
export const bankFormSchema = (hasIban: boolean) =>
  z.object({
    iban: z
      .string()
      .refine((value) => hasIban || compactIban(value) !== '', 'IBAN yazın.')
      .refine(
        (value) => compactIban(value) === '' || isValidTurkishIban(compactIban(value)),
        'Geçerli bir TR IBAN girin (TR ile başlayan 26 karakter).',
      ),
    accountHolder: z
      .string()
      .trim()
      .min(2, 'Hesap sahibini en az 2 karakterle yazın.')
      .max(120, 'Hesap sahibi en çok 120 karakter olabilir.'),
  })
export type BankFormValues = z.output<ReturnType<typeof bankFormSchema>>

export const bankDefaults = (view: PersonnelFileView['bank']): BankFormValues => ({
  iban: '',
  accountHolder: view?.accountHolder ?? '',
})

export function bankBody(values: BankFormValues): UpdatePersonnelFileBody {
  const iban = compactIban(values.iban)
  return { bank: { ...(iban === '' ? {} : { iban }), accountHolder: values.accountHolder.trim() } }
}

// --- Eğitim --------------------------------------------------------------------------------------

const educationRowSchema = z.object({
  level: z.enum(EDUCATION_LEVELS, 'Eğitim düzeyini seçin.'),
  school: z
    .string()
    .trim()
    .min(2, 'Okul adını en az 2 karakterle yazın.')
    .max(150, 'Okul adı en çok 150 karakter olabilir.'),
  department: z.string().trim().max(150, 'Bölüm en çok 150 karakter olabilir.'),
  graduationYear: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || (/^\d{4}$/.test(value) && Number(value) >= 1950),
      'Mezuniyet yılını dört haneli yazın (1950 ve sonrası).',
    ),
})
export const educationFormSchema = z.object({
  rows: z
    .array(educationRowSchema)
    .max(PERSONNEL_EDUCATION_MAX, `En çok ${String(PERSONNEL_EDUCATION_MAX)} satır girilebilir.`),
})
export type EducationFormValues = z.input<typeof educationFormSchema>
export type EducationRowValues = EducationFormValues['rows'][number]

export const emptyEducationRow = (): EducationRowValues => ({
  level: 'bachelor',
  school: '',
  department: '',
  graduationYear: '',
})

export const educationDefaults = (view: PersonnelFileView['education']): EducationFormValues => ({
  rows: (view ?? []).map((row) => ({
    level: row.level,
    school: row.school,
    department: row.department ?? '',
    graduationYear: row.graduationYear === null ? '' : String(row.graduationYear),
  })),
})

export const educationBody = (values: EducationFormValues): UpdatePersonnelFileBody => ({
  education: values.rows.map((row) => ({
    level: row.level,
    school: row.school.trim(),
    department: orNull(row.department),
    graduationYear: row.graduationYear.trim() === '' ? null : Number(row.graduationYear),
  })),
})

export const educationLevelLabel = (level: EducationLevel) => EDUCATION_LEVEL_LABELS[level]

/** "Lisans · Boğaziçi Üniversitesi, Matematik · 2012" (mezuniyet yoksa "sürüyor"). */
export function educationText(row: NonNullable<PersonnelFileView['education']>[number]): string {
  const school = row.department === null ? row.school : `${row.school}, ${row.department}`
  const year = row.graduationYear === null ? 'sürüyor' : String(row.graduationYear)
  return `${educationLevelLabel(row.level)} · ${school} · ${year}`
}

// --- Acil durum ----------------------------------------------------------------------------------

const emergencyRowSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Adı en az 2 karakterle yazın.')
    .max(120, 'Ad en çok 120 karakter olabilir.'),
  relation: z
    .string()
    .trim()
    .min(2, 'Yakınlığı en az 2 karakterle yazın.')
    .max(60, 'Yakınlık en çok 60 karakter olabilir.'),
  phone: z
    .string()
    .refine(
      (value) => PHONE.test(compactPhone(value)),
      'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.',
    ),
})
export const emergencyFormSchema = z.object({
  rows: z
    .array(emergencyRowSchema)
    .max(PERSONNEL_EMERGENCY_MAX, `En çok ${String(PERSONNEL_EMERGENCY_MAX)} kişi girilebilir.`),
})
export type EmergencyFormValues = z.input<typeof emergencyFormSchema>
export type EmergencyRowValues = EmergencyFormValues['rows'][number]

export const emptyEmergencyRow = (): EmergencyRowValues => ({ name: '', relation: '', phone: '' })

export const emergencyDefaults = (
  view: PersonnelFileView['emergencyContacts'],
): EmergencyFormValues => ({
  rows: (view ?? []).map((row) => ({ ...row })),
})

export const emergencyBody = (values: EmergencyFormValues): UpdatePersonnelFileBody => ({
  emergencyContacts: values.rows.map((row) => ({
    name: row.name.trim(),
    relation: row.relation.trim(),
    phone: compactPhone(row.phone),
  })),
})

// --- Ortak ---------------------------------------------------------------------------------------

/**
 * Sunucu alan yolu → grup formunun alanı (`identity.nationalId` → `nationalId`,
 * `education.0.school` → `rows.0.school`); başka grubun yolu `null` (kök hata).
 */
export function personnelFormField(group: PersonnelFileGroup, path: string): string | null {
  if (!path.startsWith(`${group}.`)) return null
  const rest = path.slice(group.length + 1)
  if (group === 'education' || group === 'emergencyContacts')
    return /^\d+\.[a-zA-Z]+$/.test(rest) ? `rows.${rest}` : null
  return /^[a-zA-Z]+$/.test(rest) ? rest : null
}

/** Listede dolu grupların metni ("Kimlik · Banka"); kart yoksa "Kart açılmadı". */
export function filledGroupsText(row: Pick<PersonnelFileStaffRow, 'hasFile' | 'filledGroups'>) {
  if (!row.hasFile) return 'Kart açılmadı'
  if (row.filledGroups.length === 0) return 'Görebildiğiniz bilgi yok'
  return PERSONNEL_FILE_GROUPS.filter((group) => row.filledGroups.includes(group))
    .map((group) => PERSONNEL_FILE_GROUP_LABELS[group])
    .join(' · ')
}
