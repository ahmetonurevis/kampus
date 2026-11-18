import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { WAGE_TYPES, type WageType } from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  STAFF_CERTIFICATE_ADDRESSEE_MAX,
  STAFF_CERTIFICATE_CANCEL_REASON_MAX,
  STAFF_CERTIFICATE_CANCEL_REASON_MIN,
  STAFF_CERTIFICATE_KINDS,
  STAFF_CERTIFICATE_POSITION_MAX,
  STAFF_CERTIFICATE_POSITION_MIN,
  type StaffCertificateKind,
} from '@kampus/school-core/lib/finance-staff-certificates.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Personel çalışma ve hizmet belgesi (DOM-FIN-106; ON-175). Her satır bir üretimdir: içerik
 * (kurum adı, personel adı, görev, günler, T.C. kimlik no, muhatap, ücret, düzenleyen) üretim
 * anında kopyalanır ve sonra değişmez (K-341); depo yalnız iptal alanlarını yazar. Numara kurumda
 * yıl bazlı ardışıktır, iki tür ortak sıradadır; iptal edilen belgenin numarası yeniden
 * kullanılmaz. Belge silinmez, gerekçeyle iptal edilir. Personel kaydı ayrı tablo değildir
 * (üyelik Oğuzhan'ın alanı); belge üyeliğe bağlanır.
 */
export const staffCertificates = pgTable(
  'staff_certificates',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    kind: text('kind').$type<StaffCertificateKind>().notNull(),
    certificateYear: integer('certificate_year').notNull(),
    certificateNumber: integer('certificate_number').notNull(),
    institutionName: text('institution_name').notNull(),
    // kvkk: K
    staffName: text('staff_name').notNull(),
    position: text('position').notNull(),
    // kvkk: K (T.C. kimlik no; yalnız belge ucunda döner, loglanmaz)
    identityNumber: text('identity_number'),
    hireDate: date('hire_date', { mode: 'string' }).notNull(),
    exitDate: date('exit_date', { mode: 'string' }),
    addressee: text('addressee').notNull(),
    wageRateType: text('wage_rate_type').$type<WageType>(),
    // kvkk: K (ücret)
    wageAmountCents: bigint('wage_amount_cents', { mode: 'number' }),
    currency: text('currency').notNull().default('TRY'),
    // kvkk: K
    issuedByUserId: text('issued_by_user_id').notNull(),
    // kvkk: K
    issuedByName: text('issued_by_name').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    // kvkk: K (serbest metin; loglanmaz)
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_certificates_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_certificates_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('staff_certificates_kind_check', oneOf(table.kind, STAFF_CERTIFICATE_KINDS)),
    check(
      'staff_certificates_number_check',
      sql`${table.certificateYear} between 2000 and 2999 and ${table.certificateNumber} > 0`,
    ),
    check(
      'staff_certificates_position_check',
      sql`char_length(${table.position}) between ${n(STAFF_CERTIFICATE_POSITION_MIN)} and ${n(STAFF_CERTIFICATE_POSITION_MAX)}`,
    ),
    check(
      'staff_certificates_addressee_check',
      sql`char_length(${table.addressee}) between 1 and ${n(STAFF_CERTIFICATE_ADDRESSEE_MAX)}`,
    ),
    check(
      'staff_certificates_identity_number_check',
      sql`${table.identityNumber} is null or ${table.identityNumber} ~ '^[1-9][0-9]{10}$'`,
    ),
    // Çıkış günü yalnız hizmet belgesinde ve orada zorunlu; giriş gününden önce olamaz.
    check(
      'staff_certificates_dates_check',
      sql`((${table.kind} = 'service') = (${table.exitDate} is not null))
        and (${table.exitDate} is null or ${table.exitDate} >= ${table.hireDate})`,
    ),
    // Ücret yalnız çalışma belgesinde; tür ve tutar birlikte.
    check(
      'staff_certificates_wage_check',
      sql`((${table.wageRateType} is null) = (${table.wageAmountCents} is null))
        and (${table.wageRateType} is null or (${table.kind} = 'employment'
          and ${oneOf(table.wageRateType, WAGE_TYPES)} and ${table.wageAmountCents} > 0))`,
    ),
    check('staff_certificates_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'staff_certificates_cancel_check',
      sql`((${table.cancelledAt} is null) = (${table.cancelledByUserId} is null))
        and ((${table.cancelledAt} is null) = (${table.cancelReason} is null))
        and (${table.cancelReason} is null or char_length(${table.cancelReason})
          between ${n(STAFF_CERTIFICATE_CANCEL_REASON_MIN)} and ${n(STAFF_CERTIFICATE_CANCEL_REASON_MAX)})`,
    ),
    uniqueIndex('staff_certificates_number_key').on(
      table.institutionId,
      table.certificateYear,
      table.certificateNumber,
    ),
    index('staff_certificates_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.createdAt,
    ),
  ],
)
