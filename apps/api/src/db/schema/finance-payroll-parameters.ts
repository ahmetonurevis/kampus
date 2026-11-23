import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import type { IncomeTaxBracket } from '@kampus/school-core/lib/finance-payroll-parameters.ts'

import { institutions } from './auth.ts'
import { requiredColumns } from './columns.ts'

/**
 * Bordro parametrelerinin kurum kopyası (DOM-FIN-100; ON-197). Platform varsayılanı kodda durur
 * (`PAYROLL_PLATFORM_DEFAULTS`, K-308); bu tablo yalnız kurumun yazdığı setleri tutar. Aynı yürürlük
 * başlangıcında kurum seti platform setinin yerini alır, arşivlenince platform değeri geri gelir
 * (K-309). Oranlar on binde bir, damga vergisi yüz binde bir, tutarlar kuruştur. Dilimler
 * `incomeTaxBracketsSchema` ile doğrulanmış dizi olarak yazılır.
 */
export const payrollParameterSets = pgTable(
  'payroll_parameter_sets',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    minimumWageGrossCents: bigint('minimum_wage_gross_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    incomeTaxBrackets: jsonb('income_tax_brackets').$type<IncomeTaxBracket[]>().notNull(),
    sgkEmployeeRateBasisPoints: integer('sgk_employee_rate_basis_points').notNull(),
    sgkEmployerRateBasisPoints: integer('sgk_employer_rate_basis_points').notNull(),
    sgkEmployerIncentiveBasisPoints: integer('sgk_employer_incentive_basis_points').notNull(),
    unemploymentEmployeeRateBasisPoints: integer(
      'unemployment_employee_rate_basis_points',
    ).notNull(),
    unemploymentEmployerRateBasisPoints: integer(
      'unemployment_employer_rate_basis_points',
    ).notNull(),
    sgkFloorMultiplierBasisPoints: integer('sgk_floor_multiplier_basis_points').notNull(),
    sgkCeilingMultiplierBasisPoints: integer('sgk_ceiling_multiplier_basis_points').notNull(),
    stampTaxRatePer100k: integer('stamp_tax_rate_per_100k').notNull(),
    minimumWageIncomeTaxExempt: boolean('minimum_wage_income_tax_exempt').notNull(),
    minimumWageStampTaxExempt: boolean('minimum_wage_stamp_tax_exempt').notNull(),
    severanceCeilingCents: bigint('severance_ceiling_cents', { mode: 'number' }).notNull(),
    source: text('source').notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'payroll_parameter_sets_pkey', columns: [table.institutionId, table.id] }),
    check(
      'payroll_parameter_sets_effective_from_check',
      sql`extract(day from ${table.effectiveFrom}) = 1
        and ${table.effectiveFrom} between date '2020-01-01' and date '2099-12-01'`,
    ),
    check(
      'payroll_parameter_sets_amounts_check',
      sql`${table.minimumWageGrossCents} > 0 and ${table.severanceCeilingCents} > 0`,
    ),
    check('payroll_parameter_sets_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'payroll_parameter_sets_brackets_check',
      sql`jsonb_typeof(${table.incomeTaxBrackets}) = 'array'
        and jsonb_array_length(${table.incomeTaxBrackets}) between 1 and 10`,
    ),
    check(
      'payroll_parameter_sets_rates_check',
      sql`${table.sgkEmployeeRateBasisPoints} between 0 and 10000
        and ${table.sgkEmployerRateBasisPoints} between 0 and 10000
        and ${table.sgkEmployerIncentiveBasisPoints} between 0 and ${table.sgkEmployerRateBasisPoints}
        and ${table.unemploymentEmployeeRateBasisPoints} between 0 and 10000
        and ${table.unemploymentEmployerRateBasisPoints} between 0 and 10000
        and ${table.stampTaxRatePer100k} between 0 and 10000`,
    ),
    check(
      'payroll_parameter_sets_multipliers_check',
      sql`${table.sgkFloorMultiplierBasisPoints} > 0
        and ${table.sgkCeilingMultiplierBasisPoints} > ${table.sgkFloorMultiplierBasisPoints}
        and ${table.sgkCeilingMultiplierBasisPoints} <= 200000`,
    ),
    uniqueIndex('payroll_parameter_sets_effective_from_key')
      .on(table.institutionId, table.effectiveFrom)
      .where(sql`${table.archivedAt} is null`),
  ],
)
