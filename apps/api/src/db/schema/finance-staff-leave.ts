import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  LEAVE_CANCEL_REASON_MAX,
  LEAVE_CANCEL_REASON_MIN,
  LEAVE_DAYS_MAX,
  LEAVE_KINDS,
  LEAVE_LABEL_MAX,
  LEAVE_LABEL_MIN,
  LEAVE_NOTE_MAX,
  LEAVE_OPENING_DAYS_MAX,
  LEAVE_OPENING_DAYS_MIN,
  type LeaveKind,
} from '@kampus/school-core/lib/finance-staff-leave.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Kurumun izin türü ayarı (DOM-FIN-109; ON-181; K-361). Varsayılan türler kodda durur; satır yalnız
 * kurum bir varsayılanı ayarladığında (ad, ücretli mi, yıllıktan düşer mi, gün, etkinlik) ya da ek
 * tür açtığında yazılır. Kilitli alanlar core'da denetlenir; birleşik görünüm `effectiveLeaveTypes`.
 */
export const staffLeaveTypes = pgTable(
  'staff_leave_types',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    code: text('code').notNull(),
    kind: text('kind').$type<LeaveKind>().notNull(),
    label: text('label').notNull(),
    paid: boolean('paid').notNull(),
    deductsFromAnnual: boolean('deducts_from_annual').notNull(),
    defaultDays: integer('default_days'),
    isActive: boolean('is_active').notNull().default(true),
    // kvkk: K
    updatedByUserId: text('updated_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_leave_types_pkey', columns: [table.institutionId, table.code] }),
    check('staff_leave_types_kind_check', oneOf(table.kind, LEAVE_KINDS)),
    check('staff_leave_types_code_check', sql`${table.code} ~ '^[a-z][a-z0-9_]{1,39}$'`),
    check(
      'staff_leave_types_label_check',
      sql`char_length(${table.label}) between ${n(LEAVE_LABEL_MIN)} and ${n(LEAVE_LABEL_MAX)}`,
    ),
    check(
      'staff_leave_types_days_check',
      sql`${table.defaultDays} is null or ${table.defaultDays} between 1 and ${n(LEAVE_DAYS_MAX)}`,
    ),
    // Yıllık izin ücretli ve yıllıktan düşer; ücretsiz izin ve rapor yıllıktan düşmez.
    check(
      'staff_leave_types_rules_check',
      sql`(${table.kind} <> 'annual' or (${table.paid} and ${table.deductsFromAnnual}))
        and (${table.kind} <> 'unpaid' or not (${table.paid} or ${table.deductsFromAnnual}))
        and (${table.kind} <> 'sick' or not ${table.deductsFromAnnual})`,
    ),
  ],
)

/**
 * Personelin izin profili (DOM-FIN-109; K-360): kıdem başlangıcı (işe giriş; personel kaydında
 * olmadığı için elle), yaş kuralı için isteğe bağlı doğum günü ve açılış devri. Üyelik başına tek
 * satır. Kıdem başlangıcı personel belgesi ve kıdem hesaplayıcısı için önerilen ortak kaynaktır.
 */
export const staffLeaveProfiles = pgTable(
  'staff_leave_profiles',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    // kvkk: K
    seniorityStartDate: date('seniority_start_date', { mode: 'string' }).notNull(),
    // kvkk: K
    birthDate: date('birth_date', { mode: 'string' }),
    openingBalanceDate: date('opening_balance_date', { mode: 'string' }),
    openingBalanceDays: integer('opening_balance_days'),
    // kvkk: K
    updatedByUserId: text('updated_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'staff_leave_profiles_pkey',
      columns: [table.institutionId, table.membershipId],
    }),
    foreignKey({
      name: 'staff_leave_profiles_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'staff_leave_profiles_opening_check',
      sql`(${table.openingBalanceDate} is null) = (${table.openingBalanceDays} is null)
        and (${table.openingBalanceDays} is null or ${table.openingBalanceDays}
          between ${n(LEAVE_OPENING_DAYS_MIN)} and ${n(LEAVE_OPENING_DAYS_MAX)})
        and (${table.openingBalanceDate} is null
          or ${table.openingBalanceDate} >= ${table.seniorityStartDate})`,
    ),
    check(
      'staff_leave_profiles_birth_check',
      sql`${table.birthDate} is null or ${table.birthDate} < ${table.seniorityStartDate}`,
    ),
  ],
)

/**
 * Kullanılmış izin kaydı (DOM-FIN-109; K-362). Talep ve onay akışı (ON-182) gelene kadar yönetici
 * elle yazar. Tür ayarının anlık kopyasını (biçim, ad, ücretli, yıllıktan düşer) taşır; ayar
 * sonradan değişse de bakiye geçmişi değişmez. Düzeltilmez; gerekçeyle iptal (arşiv) edilir. Rapor
 * (sağlık) bu tabloya yazılmaz.
 */
export const staffLeaveRecords = pgTable(
  'staff_leave_records',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    typeCode: text('type_code').notNull(),
    kind: text('kind').$type<LeaveKind>().notNull(),
    typeLabel: text('type_label').notNull(),
    paid: boolean('paid').notNull(),
    deductsFromAnnual: boolean('deducts_from_annual').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    days: integer('days').notNull(),
    note: text('note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    cancelReason: text('cancel_reason'),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_leave_records_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_leave_records_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    // Rapor elle yazılmaz (sağlık verisi sağlık raporu kaydında, ON-185).
    check(
      'staff_leave_records_kind_check',
      sql`${oneOf(table.kind, LEAVE_KINDS)} and ${table.kind} <> 'sick'`,
    ),
    check(
      'staff_leave_records_dates_check',
      sql`${table.endDate} >= ${table.startDate}
        and ${table.days} between 1 and least(${n(LEAVE_DAYS_MAX)},
          ${table.endDate} - ${table.startDate} + 1)`,
    ),
    check(
      'staff_leave_records_label_check',
      sql`char_length(${table.typeLabel}) between ${n(LEAVE_LABEL_MIN)} and ${n(LEAVE_LABEL_MAX)}`,
    ),
    check(
      'staff_leave_records_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(LEAVE_NOTE_MAX)}`,
    ),
    check(
      'staff_leave_records_cancel_check',
      sql`((${table.archivedAt} is null) = (${table.cancelReason} is null))
        and ((${table.archivedAt} is null) = (${table.cancelledByUserId} is null))
        and (${table.cancelReason} is null or char_length(${table.cancelReason})
          between ${n(LEAVE_CANCEL_REASON_MIN)} and ${n(LEAVE_CANCEL_REASON_MAX)})`,
    ),
    index('staff_leave_records_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.startDate,
    ),
  ],
)
