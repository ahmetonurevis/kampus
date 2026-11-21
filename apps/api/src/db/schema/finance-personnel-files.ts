import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core'

import {
  PERSONNEL_ADDRESS_MAX,
  PERSONNEL_ADDRESS_MIN,
  PERSONNEL_EDUCATION_MAX,
  PERSONNEL_EMERGENCY_MAX,
  PERSONNEL_HOLDER_MAX,
  PERSONNEL_HOLDER_MIN,
  type PersonnelEducation,
  type PersonnelEmergencyContact,
} from '@kampus/school-core/lib/finance-personnel-files.ts'

import { institutions, memberships } from './auth.ts'
import { requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Personel özlük kartı (DOM-FIN-140; ON-172; K-475…K-477). Kurum üyeliği başına tek satır; personel
 * tablosu yoktur, kart üyeliğe bağlanır. Ad, iş e-postası ve rol platform hesabındadır, burada
 * kopyalanmaz. T.C. kimlik no ve IBAN uygulama düzeyinde şifrelidir (AES-256-GCM, kurum anahtarı
 * `FIELD_ENCRYPTION_KEY`'den; `src/lib/field-crypto.ts`); şifreli değer kurum, üyelik, tablo ve
 * kolona bağlıdır, başka personelin satırına kopyalanırsa çözülmez. Eğitim geçmişi ve acil durum
 * kişileri core şemasıyla doğrulanan küçük listelerdir (en çok 10 ve 5 satır). Kart özlük imhasında
 * (`DOM-FIN-122`, `personnel_file` kategorisi) fiziksel silinir (K-477).
 */
export const staffPersonnelFiles = pgTable(
  'staff_personnel_files',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    // kvkk: Ç — şifreli T.C. kimlik no: base64(IV ‖ GCM etiketi ‖ şifreli metin); düz metin yok
    nationalIdCiphertext: text('national_id_ciphertext'),
    // Kişisel veri değil: yalnız anahtar sürümü.
    nationalIdKeyVersion: integer('national_id_key_version'),
    // kvkk: K
    birthDate: date('birth_date', { mode: 'string' }),
    // kvkk: K
    address: text('address'),
    // kvkk: K
    phone: text('phone'),
    // kvkk: K
    email: text('email'),
    // kvkk: K — eğitim geçmişi (düzey, okul, bölüm, mezuniyet yılı)
    education: jsonb('education').$type<PersonnelEducation[]>().notNull().default([]),
    // kvkk: Ç — şifreli IBAN: base64(IV ‖ GCM etiketi ‖ şifreli metin); düz metin yok
    ibanCiphertext: text('iban_ciphertext'),
    // Kişisel veri değil: yalnız anahtar sürümü.
    ibanKeyVersion: integer('iban_key_version'),
    // kvkk: K
    bankAccountHolder: text('bank_account_holder'),
    // kvkk: K — acil durum kişileri (ad, yakınlık, telefon)
    emergencyContacts: jsonb('emergency_contacts')
      .$type<PersonnelEmergencyContact[]>()
      .notNull()
      .default([]),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    // kvkk: K
    updatedByUserId: text('updated_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'staff_personnel_files_pkey',
      columns: [table.institutionId, table.membershipId],
    }),
    foreignKey({
      name: 'staff_personnel_files_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    // Şifreli değer ve anahtar sürümü birlikte bulunur.
    check(
      'staff_personnel_files_national_id_check',
      sql`(${table.nationalIdCiphertext} is null) = (${table.nationalIdKeyVersion} is null)
        and (${table.nationalIdKeyVersion} is null or ${table.nationalIdKeyVersion} > 0)`,
    ),
    // IBAN ile hesap sahibi birlikte bulunur.
    check(
      'staff_personnel_files_bank_check',
      sql`(${table.ibanCiphertext} is null) = (${table.ibanKeyVersion} is null)
        and (${table.ibanCiphertext} is null) = (${table.bankAccountHolder} is null)
        and (${table.ibanKeyVersion} is null or ${table.ibanKeyVersion} > 0)
        and (${table.bankAccountHolder} is null or char_length(${table.bankAccountHolder})
          between ${n(PERSONNEL_HOLDER_MIN)} and ${n(PERSONNEL_HOLDER_MAX)})`,
    ),
    check(
      'staff_personnel_files_address_check',
      sql`${table.address} is null or char_length(${table.address})
        between ${n(PERSONNEL_ADDRESS_MIN)} and ${n(PERSONNEL_ADDRESS_MAX)}`,
    ),
    check(
      'staff_personnel_files_phone_check',
      sql`${table.phone} is null or ${table.phone} ~ '^0[0-9]{10}$'`,
    ),
    check(
      'staff_personnel_files_lists_check',
      sql`jsonb_typeof(${table.education}) = 'array'
        and jsonb_array_length(${table.education}) <= ${n(PERSONNEL_EDUCATION_MAX)}
        and jsonb_typeof(${table.emergencyContacts}) = 'array'
        and jsonb_array_length(${table.emergencyContacts}) <= ${n(PERSONNEL_EMERGENCY_MAX)}`,
    ),
  ],
)
