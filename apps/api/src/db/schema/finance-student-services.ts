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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { FEE_UNITS } from '@kampus/school-core/lib/fee-tariffs.ts'
import {
  STUDENT_SERVICE_END_REASONS,
  STUDENT_SERVICE_KINDS,
  STUDENT_SERVICE_STATUSES,
} from '@kampus/school-core/lib/finance-student-services.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { contracts } from './contracts.ts'
import { feeTariffs } from './fee-tariffs.ts'
import { invoices } from './invoices.ts'

/**
 * Ek hizmet aboneliği (DOM-FIN-003; ON-087). Ücret karar anının kopyasıdır: tarife sürümü, kalem
 * düzeyi, birim ve birim ücret sonradan değişmez. Aynı öğrenci ve türde tek açık abonelik kısmi
 * benzersiz indeksle korunur. `student_id` `records` kimliğidir, yabancı anahtar değildir.
 * `contract_id` yürürlükteki sözleşmeyi gösterir; taksit o sözleşmenin planına girmez (DOM-FIN-010).
 */
export const studentServices = pgTable(
  'student_services',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: Ç
    studentId: text('student_id').notNull(),
    kind: text('kind').notNull(),
    academicYear: integer('academic_year').notNull(),
    tariffId: uuid('tariff_id').notNull(),
    tariffVersion: integer('tariff_version').notNull(),
    feeLevel: text('fee_level'),
    unit: text('unit').notNull(),
    // kvkk: Ç
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    contractId: text('contract_id'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    status: text('status').notNull().default('active'),
    endedDate: date('ended_date'),
    endReason: text('end_reason'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    // kvkk: K
    endedByUserId: text('ended_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'student_services_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'student_services_tariff_fkey',
      columns: [table.institutionId, table.tariffId],
      foreignColumns: [feeTariffs.institutionId, feeTariffs.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'student_services_contract_fkey',
      columns: [table.institutionId, table.contractId],
      foreignColumns: [contracts.institutionId, contracts.id],
    }).onDelete('restrict'),
    check('student_services_kind_check', oneOf(table.kind, STUDENT_SERVICE_KINDS)),
    check('student_services_unit_check', oneOf(table.unit, FEE_UNITS)),
    check('student_services_status_check', oneOf(table.status, STUDENT_SERVICE_STATUSES)),
    check(
      'student_services_end_reason_check',
      sql`${table.endReason} is null or ${oneOf(table.endReason, STUDENT_SERVICE_END_REASONS)}`,
    ),
    check('student_services_amount_check', sql`${table.amountCents} > 0`),
    check('student_services_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'student_services_dates_check',
      sql`(${table.endDate} is null or ${table.endDate} >= ${table.startDate}) and (${table.endedDate} is null or ${table.endedDate} >= ${table.startDate})`,
    ),
    check(
      'student_services_ended_check',
      sql`(${table.status} = 'ended') = (${table.endedDate} is not null) and (${table.endedDate} is null) = (${table.endReason} is null) and (${table.endedDate} is null) = (${table.endedByUserId} is null)`,
    ),
    uniqueIndex('student_services_student_kind_open_key')
      .on(table.institutionId, table.studentId, table.kind)
      .where(sql`${table.status} = 'active' and ${table.archivedAt} is null`),
    index('student_services_student_idx').on(table.institutionId, table.studentId),
    index('student_services_tariff_idx').on(table.institutionId, table.tariffId),
    index('student_services_contract_idx')
      .on(table.institutionId, table.contractId)
      .where(sql`${table.contractId} is not null`),
  ],
)

/** Aboneliğin açtığı taksitler; bir taksit tek aboneliğindir, iptalde taksit satırı arşivlenir. */
export const studentServiceInvoices = pgTable(
  'student_service_invoices',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    studentServiceId: uuid('student_service_id').notNull(),
    invoiceId: text('invoice_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'student_service_invoices_pkey',
      columns: [table.institutionId, table.studentServiceId, table.invoiceId],
    }),
    foreignKey({
      name: 'student_service_invoices_service_fkey',
      columns: [table.institutionId, table.studentServiceId],
      foreignColumns: [studentServices.institutionId, studentServices.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'student_service_invoices_invoice_fkey',
      columns: [table.institutionId, table.invoiceId],
      foreignColumns: [invoices.institutionId, invoices.id],
    }).onDelete('restrict'),
    uniqueIndex('student_service_invoices_invoice_key').on(table.institutionId, table.invoiceId),
  ],
)
