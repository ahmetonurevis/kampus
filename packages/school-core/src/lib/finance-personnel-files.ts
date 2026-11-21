import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { isValidTckn } from './finance-corporate.ts'
import { maskIban } from './finance-suppliers.ts'
import { completedYears } from './finance-staff-leave.ts'
import { maskNationalId } from './scope.ts'
import { isStaffRole } from './staff-accounts.ts'
import { isValidTurkishIban } from './withdrawals.ts'

/**
 * Personel özlük kartı (docs/domain/finans.md DOM-FIN-140; ON-172; K-475…K-477). Kurum personeli
 * (yönetici, öğretmen, ön büro üyeliği) başına tek kart: kimlik (T.C. kimlik no, doğum günü),
 * kişisel iletişim (adres, telefon, e-posta), eğitim geçmişi (çok satır), banka (IBAN, hesap
 * sahibi) ve acil durum kişileri (çok satır). Ad, iş e-postası ve rol platform hesabındadır; kart
 * onları kopyalamaz. Sertifikalar özlük belgelerinden (DOM-FIN-113) okunur, kartta yalnız özetleri
 * görünür.
 *
 * Alan bazında yetki (K-475): alan grubu × rol okuma/yazma matrisi bu dosyadadır; yanıt yalnız
 * okunabilen grupları taşır, okunmayan grup anahtarıyla birlikte yanıttan çıkar. T.C. kimlik no
 * okumada her rolde maskelidir; tam hâli yalnız yöneticiye ayrı uçtan döner ve her okuma denetim
 * kaydına düşer. IBAN hiçbir okumada tam dönmez (K-476). Fonksiyonlar saftır.
 */

// --- Alan grupları ve yetki matrisi --------------------------------------------------------------

/** Alan grupları; anahtar istek ve yanıttaki alan adıdır. */
export const PERSONNEL_FILE_GROUPS = [
  'identity',
  'contact',
  'education',
  'bank',
  'emergencyContacts',
] as const
export type PersonnelFileGroup = (typeof PERSONNEL_FILE_GROUPS)[number]

export const PERSONNEL_FILE_GROUP_LABELS: Readonly<Record<PersonnelFileGroup, string>> = {
  identity: 'Kimlik',
  contact: 'İletişim',
  education: 'Eğitim',
  bank: 'Banka',
  emergencyContacts: 'Acil durum',
}

/**
 * Matristeki roller. Muhasebe (`DOM-FIN-057`, IST-006) henüz platform rolü değildir; satırı rol
 * açıldığında kendiliğinden geçerli olur.
 */
export const PERSONNEL_FILE_MATRIX_ROLES = ['yonetici', 'muhasebe', 'onburo'] as const
export type PersonnelFileMatrixRole = (typeof PERSONNEL_FILE_MATRIX_ROLES)[number]

export type PersonnelFileAccess = 'none' | 'read' | 'write'

/**
 * Alan grubu × rol (K-475). Yönetici her grubu yazar. Muhasebe kimliği (maskeli) ve iletişimi okur,
 * bordro ödemesi için bankayı yazar; eğitim ve acil durum kişilerini görmez. Ön büro yalnız acil
 * durum kişilerini okur (acil anda personelin yakınına ulaşmak için). Öğretmen, veli ve öğrenci
 * hiçbir grubu görmez; personelin kendi kartını görmesi self servis işidir (ON-189).
 */
export const PERSONNEL_FILE_ACCESS_MATRIX: Readonly<
  Record<PersonnelFileMatrixRole, Readonly<Record<PersonnelFileGroup, PersonnelFileAccess>>>
> = {
  yonetici: {
    identity: 'write',
    contact: 'write',
    education: 'write',
    bank: 'write',
    emergencyContacts: 'write',
  },
  muhasebe: {
    identity: 'read',
    contact: 'read',
    education: 'none',
    bank: 'write',
    emergencyContacts: 'none',
  },
  onburo: {
    identity: 'none',
    contact: 'none',
    education: 'none',
    bank: 'none',
    emergencyContacts: 'read',
  },
}

const NO_ACCESS: Readonly<Record<PersonnelFileGroup, PersonnelFileAccess>> = {
  identity: 'none',
  contact: 'none',
  education: 'none',
  bank: 'none',
  emergencyContacts: 'none',
}

const isMatrixRole = (role: string): role is PersonnelFileMatrixRole =>
  (PERSONNEL_FILE_MATRIX_ROLES as readonly string[]).includes(role)

/** Rolün grup erişimi; matriste olmayan rol hiçbir grubu görmez (varsayılan ret). */
export function personnelFileAccess(
  role: string,
): Readonly<Record<PersonnelFileGroup, PersonnelFileAccess>> {
  return isMatrixRole(role) ? PERSONNEL_FILE_ACCESS_MATRIX[role] : NO_ACCESS
}

/** Rolün okuyabildiği gruplar (matris sırası). */
export function readablePersonnelFileGroups(role: string): PersonnelFileGroup[] {
  const access = personnelFileAccess(role)
  return PERSONNEL_FILE_GROUPS.filter((group) => access[group] !== 'none')
}

/** Rolün yazabildiği gruplar (matris sırası). */
export function writablePersonnelFileGroups(role: string): PersonnelFileGroup[] {
  const access = personnelFileAccess(role)
  return PERSONNEL_FILE_GROUPS.filter((group) => access[group] === 'write')
}

/** T.C. kimlik numarasının tam hâli yalnız yöneticiye döner ve okuması denetlenir (K-476). */
export const canRevealPersonnelNationalId = (role: string) => role === 'yonetici'

/** Kartları okuyan platform rolleri (en az bir grubu okuyan). */
export const FINANCE_PERSONNEL_FILE_READ_ROLES = [
  'yonetici',
  'onburo',
] as const satisfies readonly Role[]
/** Kart açan ve düzelten platform rolleri (en az bir grubu yazan). */
export const FINANCE_PERSONNEL_FILE_WRITE_ROLES = ['yonetici'] as const satisfies readonly Role[]

// --- Sınırlar ------------------------------------------------------------------------------------

export const PERSONNEL_ADDRESS_MIN = 10
export const PERSONNEL_ADDRESS_MAX = 500
export const PERSONNEL_EMAIL_MAX = 254
export const PERSONNEL_SCHOOL_MIN = 2
export const PERSONNEL_SCHOOL_MAX = 150
export const PERSONNEL_DEPARTMENT_MAX = 150
export const PERSONNEL_EDUCATION_MAX = 10
export const PERSONNEL_GRADUATION_YEAR_MIN = 1950
export const PERSONNEL_GRADUATION_YEAR_MAX = 2100
export const PERSONNEL_HOLDER_MIN = 2
export const PERSONNEL_HOLDER_MAX = 120
export const PERSONNEL_CONTACT_NAME_MIN = 2
export const PERSONNEL_CONTACT_NAME_MAX = 120
export const PERSONNEL_RELATION_MIN = 2
export const PERSONNEL_RELATION_MAX = 60
export const PERSONNEL_EMERGENCY_MAX = 5
/** Doğum günü alt sınırı ve işe başlama yaşı (İş Kanunu md. 71: 14 yaş). */
export const PERSONNEL_BIRTH_MIN_DATE = '1920-01-01'
export const PERSONNEL_MIN_AGE = 14

/** Eğitim düzeyi. */
export const EDUCATION_LEVELS = [
  'high_school',
  'associate',
  'bachelor',
  'master',
  'doctorate',
  'other',
] as const
export type EducationLevel = (typeof EDUCATION_LEVELS)[number]
export const EDUCATION_LEVEL_LABELS: Readonly<Record<EducationLevel, string>> = {
  high_school: 'Lise',
  associate: 'Ön lisans',
  bachelor: 'Lisans',
  master: 'Yüksek lisans',
  doctorate: 'Doktora',
  other: 'Diğer',
}

// --- Şemalar -------------------------------------------------------------------------------------

const PHONE_PATTERN = /^0\d{10}$/

const text = (label: string, min: number, max: number) =>
  z
    .string(`${label} yazın.`)
    .trim()
    .min(min, `${label} en az ${String(min)} karakter olmalı.`)
    .max(max, `${label} en çok ${String(max)} karakter olabilir.`)

/** Telefon: boşluk, parantez ve tire atılır; `0XXXXXXXXXX` (11 hane). */
const phoneSchema = z
  .string('Telefonu yazın.')
  .transform((value) => value.replace(/[\s()-]+/g, ''))
  .pipe(z.string().regex(PHONE_PATTERN, 'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.'))

// kvkk: Ç — T.C. kimlik no; şifreli kolonda saklanır, okumada maskeli.
const nationalIdSchema = z
  .string('T.C. kimlik numarasını yazın.')
  .transform((value) => value.replace(/\s/g, ''))
  .pipe(
    z
      .string()
      .refine(isValidTckn, 'Geçerli bir T.C. kimlik numarası girin (11 hane, kontrol haneli).'),
  )

// kvkk: Ç — IBAN; şifreli kolonda saklanır, okumada maskeli.
const ibanSchema = z
  .string('IBAN yazın.')
  .transform((value) => value.replace(/\s/g, '').toUpperCase())
  .pipe(
    z
      .string()
      .refine(isValidTurkishIban, 'Geçerli bir TR IBAN girin (TR ile başlayan 26 karakter).'),
  )

const membershipSchema = z
  .string('Personel seçin.')
  .trim()
  .min(1, 'Personel seçin.')
  .max(100, 'Personel geçersiz.')

/** Kimlik grubu; alan verilmezse değişmez, `null` temizler. */
export const personnelIdentityInputSchema = z.strictObject({
  // kvkk: Ç
  nationalId: nationalIdSchema
    .nullable()
    .optional()
    .describe('T.C. kimlik no (11 hane); şifreli saklanır, okumada maskeli'),
  // kvkk: K
  birthDate: daySchema.nullable().optional().describe('Doğum günü (YYYY-MM-DD)'),
})

/** Kişisel iletişim grubu; alan verilmezse değişmez, `null` temizler. */
export const personnelContactInputSchema = z.strictObject({
  // kvkk: K
  address: text('Adresi', PERSONNEL_ADDRESS_MIN, PERSONNEL_ADDRESS_MAX)
    .nullable()
    .optional()
    .describe('Ev adresi'),
  // kvkk: K
  phone: phoneSchema.nullable().optional().describe('Kişisel telefon (0XXXXXXXXXX)'),
  // kvkk: K
  email: z
    .email('Geçerli bir e-posta adresi girin.')
    .max(PERSONNEL_EMAIL_MAX, `E-posta en çok ${String(PERSONNEL_EMAIL_MAX)} karakter olabilir.`)
    .nullable()
    .optional()
    .describe('Kişisel e-posta (iş e-postası hesaptadır)'),
})

/** Eğitim geçmişi satırı. */
export const personnelEducationSchema = z.strictObject({
  level: z.enum(EDUCATION_LEVELS, 'Eğitim düzeyini seçin.').describe('Eğitim düzeyi'),
  // kvkk: K
  school: text('Okul adını', PERSONNEL_SCHOOL_MIN, PERSONNEL_SCHOOL_MAX).describe('Okul'),
  // kvkk: K
  department: z
    .string('Bölüm metin olmalı.')
    .trim()
    .max(
      PERSONNEL_DEPARTMENT_MAX,
      `Bölüm en çok ${String(PERSONNEL_DEPARTMENT_MAX)} karakter olabilir.`,
    )
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null)
    .describe('Bölüm'),
  graduationYear: z
    .number('Mezuniyet yılı sayı olmalı.')
    .int('Mezuniyet yılı tam sayı olmalı.')
    .min(PERSONNEL_GRADUATION_YEAR_MIN, 'Mezuniyet yılı 1950 ya da sonrası olmalı.')
    .max(PERSONNEL_GRADUATION_YEAR_MAX, 'Mezuniyet yılı geçersiz.')
    .nullable()
    .default(null)
    .describe('Mezuniyet yılı; boşsa öğrenim sürüyor'),
})
export type PersonnelEducation = z.output<typeof personnelEducationSchema>

const educationListSchema = z
  .array(personnelEducationSchema, 'Eğitim geçmişi liste olmalı.')
  .max(
    PERSONNEL_EDUCATION_MAX,
    `En çok ${String(PERSONNEL_EDUCATION_MAX)} eğitim satırı girilebilir.`,
  )
  .describe('Eğitim geçmişi; liste bütün olarak yazılır')

/** Banka grubu; alan verilmezse değişmez. Bütün grup `null` ise banka bilgisi silinir. */
export const personnelBankInputSchema = z.strictObject({
  // kvkk: Ç
  iban: ibanSchema.optional().describe('TR IBAN (mod-97); şifreli saklanır, okumada maskeli'),
  // kvkk: K
  accountHolder: text('Hesap sahibini', PERSONNEL_HOLDER_MIN, PERSONNEL_HOLDER_MAX)
    .optional()
    .describe('Hesap sahibinin adı'),
})

/** Acil durum kişisi. */
export const personnelEmergencyContactSchema = z.strictObject({
  // kvkk: K
  name: text('Kişinin adını', PERSONNEL_CONTACT_NAME_MIN, PERSONNEL_CONTACT_NAME_MAX).describe(
    'Ad soyad',
  ),
  // kvkk: K
  relation: text('Yakınlığı', PERSONNEL_RELATION_MIN, PERSONNEL_RELATION_MAX).describe(
    'Yakınlık (eşi, annesi, kardeşi…)',
  ),
  // kvkk: K
  phone: phoneSchema.describe('Telefon (0XXXXXXXXXX)'),
})
export type PersonnelEmergencyContact = z.output<typeof personnelEmergencyContactSchema>

const emergencyListSchema = z
  .array(personnelEmergencyContactSchema, 'Acil durum kişileri liste olmalı.')
  .max(
    PERSONNEL_EMERGENCY_MAX,
    `En çok ${String(PERSONNEL_EMERGENCY_MAX)} acil durum kişisi girilebilir.`,
  )
  .describe('Acil durum kişileri; liste bütün olarak yazılır')

const groupFields = {
  identity: personnelIdentityInputSchema.optional().describe('Kimlik grubu'),
  contact: personnelContactInputSchema.optional().describe('Kişisel iletişim grubu'),
  education: educationListSchema.optional(),
  bank: personnelBankInputSchema.nullable().optional().describe('Banka grubu; `null` siler'),
  emergencyContacts: emergencyListSchema.optional(),
}

/** Yeni kart (DOM-FIN-140): personel ve en az bir grup. */
export const personnelFileInputSchema = z
  .strictObject({
    // kvkk: K (personel üyeliği)
    membershipId: membershipSchema.describe('Kartın personeli (kurum üyeliği)'),
    ...groupFields,
  })
  .refine(
    (value) => PERSONNEL_FILE_GROUPS.some((group) => value[group] !== undefined),
    'Kartta en az bir bilgi grubunu doldurun.',
  )
export type PersonnelFileInput = z.input<typeof personnelFileInputSchema>
export type PersonnelFileFields = z.output<typeof personnelFileInputSchema>

/** Kart düzeltmesi (kısmi; grup verilmezse değişmez). */
export const personnelFileUpdateSchema = z
  .strictObject(groupFields)
  .refine(
    (value) => PERSONNEL_FILE_GROUPS.some((group) => value[group] !== undefined),
    'Değiştirilecek bir bilgi grubu seçin.',
  )
export type PersonnelFileUpdate = z.input<typeof personnelFileUpdateSchema>
export type PersonnelFileUpdateFields = z.output<typeof personnelFileUpdateSchema>

// --- Değerler ------------------------------------------------------------------------------------

/** Kartın çözülmüş değerleri (yalnız sunucu belleğinde; yanıta `personnelFileView` ile gider). */
export interface PersonnelFileValues {
  nationalId: string | null
  birthDate: string | null
  address: string | null
  phone: string | null
  email: string | null
  education: PersonnelEducation[]
  iban: string | null
  accountHolder: string | null
  emergencyContacts: PersonnelEmergencyContact[]
}

export const EMPTY_PERSONNEL_FILE: Readonly<PersonnelFileValues> = {
  nationalId: null,
  birthDate: null,
  address: null,
  phone: null,
  email: null,
  education: [],
  iban: null,
  accountHolder: null,
  emergencyContacts: [],
}

/** Saklanan listeler okunurken şemadan geçer (bozuk satır programlama hatasıdır). */
export const storedEducationSchema = z.array(personnelEducationSchema)
export const storedEmergencyContactsSchema = z.array(personnelEmergencyContactSchema)

/** Grubun dolu olup olmadığı (liste ve tamamlık rozeti). */
export function filledPersonnelFileGroups(values: PersonnelFileValues): PersonnelFileGroup[] {
  const filled: Record<PersonnelFileGroup, boolean> = {
    identity: values.nationalId !== null || values.birthDate !== null,
    contact: values.address !== null || values.phone !== null || values.email !== null,
    education: values.education.length > 0,
    bank: values.iban !== null,
    emergencyContacts: values.emergencyContacts.length > 0,
  }
  return PERSONNEL_FILE_GROUPS.filter((group) => filled[group])
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[]) =>
  new DomainError(code, message, { kind: 'rule', path })

/**
 * Gövdedeki her grup rolün yazabildiği grup olmalı (K-475); yazamadığı grup 403
 * `personnel_file_group_forbidden`. Rol denetimi rotada da vardır; bu, matristeki okuyup yazamayan
 * rolün (muhasebe) grup sınırıdır.
 */
export function assertPersonnelFileWritable(
  role: string,
  input: Partial<Record<PersonnelFileGroup, unknown>>,
): void {
  const access = personnelFileAccess(role)
  for (const group of PERSONNEL_FILE_GROUPS)
    if (input[group] !== undefined && access[group] !== 'write')
      throw new DomainError(
        'personnel_file_group_forbidden',
        `${PERSONNEL_FILE_GROUP_LABELS[group]} bilgilerini değiştirme yetkiniz yok.`,
        { kind: 'forbidden', path: [group] },
      )
}

/** Grupları mevcut değerlere uygular (verilmeyen alan değişmez, `null` temizler). */
export function mergePersonnelFile(
  current: PersonnelFileValues,
  update: PersonnelFileUpdateFields,
): PersonnelFileValues {
  const next: PersonnelFileValues = { ...current }
  if (update.identity !== undefined) {
    if (update.identity.nationalId !== undefined) next.nationalId = update.identity.nationalId
    if (update.identity.birthDate !== undefined) next.birthDate = update.identity.birthDate
  }
  if (update.contact !== undefined) {
    if (update.contact.address !== undefined) next.address = update.contact.address
    if (update.contact.phone !== undefined) next.phone = update.contact.phone
    if (update.contact.email !== undefined) next.email = update.contact.email
  }
  if (update.education !== undefined) next.education = update.education
  if (update.bank === null) {
    next.iban = null
    next.accountHolder = null
  } else if (update.bank !== undefined) {
    if (update.bank.iban !== undefined) next.iban = update.bank.iban
    if (update.bank.accountHolder !== undefined) next.accountHolder = update.bank.accountHolder
  }
  if (update.emergencyContacts !== undefined) next.emergencyContacts = update.emergencyContacts
  return next
}

/** Değişen alanların adları (`grup.alan`); denetim kaydına yalnız bunlar yazılır, değer yazılmaz. */
export function changedPersonnelFileFields(
  before: PersonnelFileValues,
  after: PersonnelFileValues,
): string[] {
  const fields: [string, unknown, unknown][] = [
    ['identity.nationalId', before.nationalId, after.nationalId],
    ['identity.birthDate', before.birthDate, after.birthDate],
    ['contact.address', before.address, after.address],
    ['contact.phone', before.phone, after.phone],
    ['contact.email', before.email, after.email],
    ['education', before.education, after.education],
    ['bank.iban', before.iban, after.iban],
    ['bank.accountHolder', before.accountHolder, after.accountHolder],
    ['emergencyContacts', before.emergencyContacts, after.emergencyContacts],
  ]
  return fields
    .filter(([, left, right]) => JSON.stringify(left) !== JSON.stringify(right))
    .map(([name]) => name)
}

/** Birleşik kartın değer kuralları: doğum günü ve banka bütünlüğü. */
export function assertPersonnelFileValues(values: PersonnelFileValues, today: string): void {
  if (values.birthDate !== null) {
    if (values.birthDate < PERSONNEL_BIRTH_MIN_DATE || values.birthDate > today)
      throw ruleError('personnel_file_birth_date_invalid', 'Doğum günü geçersiz.', [
        'identity',
        'birthDate',
      ])
    if (completedYears(values.birthDate, today) < PERSONNEL_MIN_AGE)
      throw ruleError(
        'personnel_file_birth_date_invalid',
        `Personel en az ${String(PERSONNEL_MIN_AGE)} yaşında olmalıdır.`,
        ['identity', 'birthDate'],
      )
  }
  const currentYear = Number(today.slice(0, 4))
  values.education.forEach((row, index) => {
    if (row.graduationYear !== null && row.graduationYear > currentYear + 6)
      throw ruleError('personnel_file_graduation_year_invalid', 'Mezuniyet yılı geçersiz.', [
        'education',
        String(index),
        'graduationYear',
      ])
  })
  if ((values.iban === null) !== (values.accountHolder === null))
    throw ruleError(
      'personnel_file_bank_incomplete',
      'Banka bilgisi için IBAN ve hesap sahibini birlikte girin.',
      ['bank', values.iban === null ? 'iban' : 'accountHolder'],
    )
}

/** Kart açılışı için servis kurum kilidi altında yükler. */
export interface PersonnelFileChecks {
  /** Üyelik; kurumda yoksa `null`. */
  staff: { role: string; active: boolean } | null
  /** Personelin kartı var mı. */
  exists: boolean
  today: string
}

/**
 * Yeni kart (DOM-FIN-140, K-475). Personel kurumun etkin yönetici, öğretmen ya da ön büro
 * üyeliğidir (öğrenci ve veli 422, pasif personel 422); üyelik başına tek kart (409). Değerler
 * birleşik kural denetiminden geçer. Dönen değer saklanacak düz değerlerdir.
 */
export function planPersonnelFile(
  role: string,
  input: PersonnelFileFields,
  checks: PersonnelFileChecks,
): PersonnelFileValues {
  assertPersonnelFileWritable(role, input)
  if (checks.staff === null)
    throw ruleError('personnel_file_staff_not_found', 'Personel bulunamadı.', ['membershipId'])
  if (!isStaffRole(checks.staff.role))
    throw ruleError(
      'personnel_file_not_staff',
      'Özlük kartı yalnız personel (yönetici, öğretmen, ön büro) için açılır.',
      ['membershipId'],
    )
  if (!checks.staff.active)
    throw ruleError(
      'personnel_file_staff_inactive',
      'Ayrılmış personele yeni özlük kartı açılmaz.',
      ['membershipId'],
    )
  if (checks.exists)
    throw new DomainError(
      'personnel_file_exists',
      'Bu personelin özlük kartı zaten var. Kartı açıp düzeltin.',
      { kind: 'conflict', path: ['membershipId'] },
    )
  const values = mergePersonnelFile(EMPTY_PERSONNEL_FILE, input)
  assertPersonnelFileValues(values, checks.today)
  return values
}

/**
 * Kart düzeltmesi (K-475): rol yazabildiği grupları değiştirir; birleşik kart açılış kurallarından
 * geçer. Değişiklik yoksa 422 `personnel_file_unchanged`. Pasif personelin kartı düzeltilebilir.
 */
export function planPersonnelFileUpdate(
  role: string,
  current: PersonnelFileValues,
  update: PersonnelFileUpdateFields,
  today: string,
): { values: PersonnelFileValues; changed: string[] } {
  assertPersonnelFileWritable(role, update)
  const values = mergePersonnelFile(current, update)
  const changed = changedPersonnelFileFields(current, values)
  if (changed.length === 0)
    throw ruleError('personnel_file_unchanged', 'Kartta değişiklik yok.', [])
  assertPersonnelFileValues(values, today)
  return { values, changed }
}

// --- Görünüm -------------------------------------------------------------------------------------

/** Okumada dönen kart grupları; her grup yalnız okuyabilen rolde bulunur. */
export interface PersonnelFileGroupsView {
  identity?: { nationalIdMasked: string | null; birthDate: string | null }
  contact?: { address: string | null; phone: string | null; email: string | null }
  education?: PersonnelEducation[]
  bank?: { ibanMasked: string | null; accountHolder: string | null }
  emergencyContacts?: PersonnelEmergencyContact[]
}

/**
 * Rolün göreceği gruplar (K-475, K-476): okunamayan grubun anahtarı yoktur; T.C. kimlik no ve
 * IBAN her rolde maskelidir (`*******1234`, `TR**…1326`).
 */
export function personnelFileView(
  values: PersonnelFileValues,
  role: string,
): PersonnelFileGroupsView {
  const access = personnelFileAccess(role)
  const view: PersonnelFileGroupsView = {}
  if (access.identity !== 'none')
    view.identity = {
      nationalIdMasked: values.nationalId === null ? null : maskNationalId(values.nationalId),
      birthDate: values.birthDate,
    }
  if (access.contact !== 'none')
    view.contact = { address: values.address, phone: values.phone, email: values.email }
  if (access.education !== 'none') view.education = values.education
  if (access.bank !== 'none')
    view.bank = {
      ibanMasked: values.iban === null ? null : maskIban(values.iban),
      accountHolder: values.accountHolder,
    }
  if (access.emergencyContacts !== 'none') view.emergencyContacts = values.emergencyContacts
  return view
}
