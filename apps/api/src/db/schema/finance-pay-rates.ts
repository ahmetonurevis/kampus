import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  BENEFIT_FORMS,
  BENEFIT_TYPES,
  LESSON_PAY_TYPES,
  PAY_RATE_AMOUNT_MAX_CENTS,
  PAY_RATE_CANCEL_REASON_MAX,
  PAY_RATE_CANCEL_REASON_MIN,
  PAY_RATE_COMPONENTS,
  PAY_RATE_NOTE_MAX,
  WAGE_TYPES,
  type BenefitForm,
  type PayRateComponent,
  type PayRateType,
} from '@kampus/school-core/lib/finance-pay-rates.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Personel ücret tanımı (DOM-FIN-099; ON-194). Bir personel üyeliğine yürürlük tarihli ana ücret,
 * ek ders ücreti ya da yan hak. Çakışma yuvası (`slot`) ana ücrette tektir, ek ders ve yan hak
 * türlerinde ayrıdır (K-304); yuva başına tek süresiz tanım ve tek başlangıç günü kısmi tekil
 * indekslerle, aralıkların çakışmaması kurum kilidi altında servis denetimiyle güvencededir. Tanım
 * düzeltilmez: bitiş değişir ya da gerekçeyle iptal (arşiv) edilir; kendiliğinden kapatılan tanım
 * kapatanı ve eski bitişi taşır, iptalde eski bitiş geri yazılır. Ücret kişisel veridir (K-306).
 */
export const staffPayRates = pgTable(
  'staff_pay_rates',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    component: text('component').$type<PayRateComponent>().notNull(),
    rateType: text('rate_type').$type<PayRateType>().notNull(),
    slot: text('slot').notNull(),
    // kvkk: K (ücret)
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    benefitForm: text('benefit_form').$type<BenefitForm>(),
    taxable: boolean('taxable'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    note: text('note'),
    closedByRateId: uuid('closed_by_rate_id'),
    closedFromEndDate: date('closed_from_end_date', { mode: 'string' }),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    cancelReason: text('cancel_reason'),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_pay_rates_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_pay_rates_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_pay_rates_closed_by_fkey',
      columns: [table.institutionId, table.closedByRateId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    check('staff_pay_rates_component_check', oneOf(table.component, PAY_RATE_COMPONENTS)),
    // Tür bileşene uyar; yuva bileşen ve türden türetilir (ana ücret tek yuva).
    check(
      'staff_pay_rates_rate_type_check',
      sql`(${table.component} = 'wage' and ${oneOf(table.rateType, WAGE_TYPES)})
        or (${table.component} = 'lesson' and ${oneOf(table.rateType, LESSON_PAY_TYPES)})
        or (${table.component} = 'benefit' and ${oneOf(table.rateType, BENEFIT_TYPES)})`,
    ),
    check(
      'staff_pay_rates_slot_check',
      sql`${table.slot} = case when ${table.component} = 'wage' then 'wage'
        else ${table.component} || ':' || ${table.rateType} end`,
    ),
    check(
      'staff_pay_rates_amount_check',
      sql`${table.amountCents} > 0 and ${table.amountCents} <= ${n(PAY_RATE_AMOUNT_MAX_CENTS)}`,
    ),
    check('staff_pay_rates_currency_check', sql`${table.currency} = 'TRY'`),
    // Nakdi/ayni ve vergi işareti yalnız yan hakta ve orada zorunlu.
    check(
      'staff_pay_rates_benefit_check',
      sql`((${table.component} = 'benefit') = (${table.benefitForm} is not null))
        and ((${table.component} = 'benefit') = (${table.taxable} is not null))
        and (${table.benefitForm} is null or ${oneOf(table.benefitForm, BENEFIT_FORMS)})`,
    ),
    check(
      'staff_pay_rates_dates_check',
      sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
    check(
      'staff_pay_rates_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(PAY_RATE_NOTE_MAX)}`,
    ),
    // Eski bitiş yalnız kendiliğinden kapatılan tanımda bulunur.
    check(
      'staff_pay_rates_closed_check',
      sql`${table.closedFromEndDate} is null or ${table.closedByRateId} is not null`,
    ),
    // İptal (arşiv) gerekçe ve iptal edeni birlikte taşır.
    check(
      'staff_pay_rates_cancel_check',
      sql`((${table.archivedAt} is null) = (${table.cancelReason} is null))
        and ((${table.archivedAt} is null) = (${table.cancelledByUserId} is null))
        and (${table.cancelReason} is null or char_length(${table.cancelReason})
          between ${n(PAY_RATE_CANCEL_REASON_MIN)} and ${n(PAY_RATE_CANCEL_REASON_MAX)})`,
    ),
    uniqueIndex('staff_pay_rates_open_key')
      .on(table.institutionId, table.membershipId, table.slot)
      .where(sql`${table.endDate} is null and ${table.archivedAt} is null`),
    uniqueIndex('staff_pay_rates_start_key')
      .on(table.institutionId, table.membershipId, table.slot, table.startDate)
      .where(sql`${table.archivedAt} is null`),
    index('staff_pay_rates_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.slot,
      table.startDate,
    ),
    index('staff_pay_rates_closed_by_idx').on(table.institutionId, table.closedByRateId),
  ],
)
