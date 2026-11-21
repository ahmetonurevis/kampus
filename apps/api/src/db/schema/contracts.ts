import { sql, type SQL } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

import {
  CONTRACT_APPROVAL_METHODS,
  SIGNATORY_ROLES,
  type ContractPlanLine,
  type ContractProposedPlan,
} from '@kampus/school-core/lib/contract-status.ts'
import type { ContractTerms } from '@kampus/school-core/lib/domain.ts'
import type { ContractPaymentTerm } from '@kampus/school-core/lib/payment-terms.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { feeTariffs } from './fee-tariffs.ts'
import { scholarshipPrograms } from './finance-scholarships.ts'

/** Sözleşmenin ödeyicisi (core `ContractTerms.payer`). */
export const CONTRACT_PAYERS = ['guardian', 'student'] as const

/** Alan grubunun ya hep dolu ya hep boş olması (`check`). */
function allOrNone(columns: readonly AnyPgColumn[]): SQL {
  const filled = sql.join(
    columns.map((column) => sql`${column} is not null`),
    sql` and `,
  )
  const empty = sql.join(
    columns.map((column) => sql`${column} is null`),
    sql` and `,
  )
  return sql`(${filled}) or (${empty})`
}

/**
 * Sözleşme sürümü (ADR 0010 karar 1; DOM-FIN-010, -012, -051; IST-092). Her satır bir sürümdür; ek
 * protokol yeni satırdır ve önceki sürüme `amends_contract_id` ile bağlanır. Kimlik `records`
 * kimliğidir (`text`, ADR 0004 `uuid` kuralına bilinçli istisna). `student_id` ve `class_id`
 * `records` kimlikleridir, yabancı anahtar değildir. Onaylı ya da iptal edilmiş satırın koşulları
 * tetikleyiciyle donar (migration 0061). Taksit bağı `contract_invoices`'tadır. ON-046e'den beri
 * `records`'un aynasıdır (migration 0063, `db/finance-mirror-store.ts`); okuma geçişine (046f) kadar
 * uygulama bu tablodan okumaz.
 */
export const contracts = pgTable(
  'contracts',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: text('id').notNull(),
    // kvkk: Ç
    studentId: text('student_id').notNull(),
    rootContractId: text('root_contract_id').notNull(),
    amendsContractId: text('amends_contract_id'),
    revision: integer('revision').notNull().default(1),
    academicYear: integer('academic_year'),
    classId: text('class_id'),
    title: text('title').notNull(),
    contractAt: timestamp('contract_at', { withTimezone: true }).notNull(),
    // kvkk: Ç
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    // Tarifeli kopya (ContractTerms, DOM-FIN-010); eski kayıtlarda boş.
    tariffId: uuid('tariff_id'),
    tariffVersion: integer('tariff_version'),
    // kvkk: Ç
    grossCents: bigint('gross_cents', { mode: 'number' }),
    // kvkk: Ç
    netCents: bigint('net_cents', { mode: 'number' }),
    // kvkk: Ç
    discounts: jsonb('discounts').$type<ContractTerms['discounts']>(),
    // kvkk: Ç
    extras: jsonb('extras').$type<ContractTerms['extras']>(),
    // kvkk: K
    termsApprovedByUserId: text('terms_approved_by_user_id'),
    payer: text('payer'),
    scholarshipProgramId: uuid('scholarship_program_id'),
    // kvkk: Ç
    scholarshipCents: bigint('scholarship_cents', { mode: 'number' }),
    // Sözleşmenin dayandığı ilanlı ödeme koşulunun kopyası (DOM-FIN-013); eski kayıtta boş.
    // kvkk: Ç
    paymentTerm: jsonb('payment_term').$type<ContractPaymentTerm>(),
    // İmza yetkilisi (ÖÖKY m.31/4).
    // kvkk: K
    signatoryName: text('signatory_name'),
    signatoryRole: text('signatory_role'),
    signatoryRecordedAt: timestamp('signatory_recorded_at', { withTimezone: true }),
    // kvkk: K
    signatoryRecordedByUserId: text('signatory_recorded_by_user_id'),
    // Ödeyici onayı; plan onay anının kopyasıdır (DOM-FIN-051).
    approvalMethod: text('approval_method'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    // kvkk: K
    approvedByUserId: text('approved_by_user_id'),
    // kvkk: K
    approvalPayerName: text('approval_payer_name'),
    // kvkk: Ç
    approvalPlan: jsonb('approval_plan').$type<ContractPlanLine[]>(),
    // Ek protokol.
    // kvkk: Ç
    amendmentReason: text('amendment_reason'),
    // kvkk: Ç
    proposedPlan: jsonb('proposed_plan').$type<ContractProposedPlan>(),
    // İptal (yalnız onaysız ek protokol).
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    // kvkk: Ç
    cancelReason: text('cancel_reason'),
    hasInvoiceList: boolean('has_invoice_list').notNull().default(true),
    position: bigint('position', { mode: 'number' }).notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'contracts_pkey', columns: [table.institutionId, table.id] }),
    // Yabancı anahtarların kök kopyasını da denetlemesi için: ek protokol ve taksit, bağlandığı
    // sürümün kökünü taşımak zorundadır; kopya sürümden ayrışamaz.
    unique('contracts_id_root_key').on(table.institutionId, table.id, table.rootContractId),
    foreignKey({
      name: 'contracts_amends_contract_fkey',
      columns: [table.institutionId, table.amendsContractId, table.rootContractId],
      foreignColumns: [table.institutionId, table.id, table.rootContractId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'contracts_root_contract_fkey',
      columns: [table.institutionId, table.rootContractId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'contracts_tariff_fkey',
      columns: [table.institutionId, table.tariffId],
      foreignColumns: [feeTariffs.institutionId, feeTariffs.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'contracts_scholarship_program_fkey',
      columns: [table.institutionId, table.scholarshipProgramId],
      foreignColumns: [scholarshipPrograms.institutionId, scholarshipPrograms.id],
    }).onDelete('restrict'),
    check('contracts_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'contracts_amounts_check',
      sql`${table.amountCents} >= 0 and (${table.grossCents} is null or ${table.grossCents} >= 0) and (${table.netCents} is null or ${table.netCents} >= 0) and (${table.scholarshipCents} is null or ${table.scholarshipCents} >= 0)`,
    ),
    check('contracts_payer_check', oneOf(table.payer, CONTRACT_PAYERS)),
    check('contracts_signatory_role_check', oneOf(table.signatoryRole, SIGNATORY_ROLES)),
    check(
      'contracts_approval_method_check',
      oneOf(table.approvalMethod, CONTRACT_APPROVAL_METHODS),
    ),
    check(
      'contracts_revision_check',
      sql`${table.revision} >= 1 and (${table.amendsContractId} is null) = (${table.revision} = 1) and (${table.amendsContractId} is null) = (${table.rootContractId} = ${table.id})`,
    ),
    check(
      'contracts_terms_check',
      allOrNone([
        table.tariffId,
        table.tariffVersion,
        table.grossCents,
        table.netCents,
        table.discounts,
        table.extras,
        table.termsApprovedByUserId,
        table.payer,
      ]),
    ),
    check(
      'contracts_scholarship_check',
      sql`(${table.scholarshipProgramId} is null) = (${table.scholarshipCents} is null) and (${table.scholarshipProgramId} is null or ${table.tariffId} is not null)`,
    ),
    check(
      'contracts_payment_term_check',
      sql`${table.paymentTerm} is null or ${table.tariffId} is not null`,
    ),
    check(
      'contracts_signatory_check',
      allOrNone([
        table.signatoryName,
        table.signatoryRole,
        table.signatoryRecordedAt,
        table.signatoryRecordedByUserId,
      ]),
    ),
    check(
      'contracts_approval_check',
      allOrNone([
        table.approvalMethod,
        table.approvedAt,
        table.approvedByUserId,
        table.approvalPayerName,
        table.approvalPlan,
      ]),
    ),
    check(
      'contracts_cancel_check',
      sql`(${allOrNone([table.cancelledAt, table.cancelledByUserId, table.cancelReason])}) and (${table.cancelledAt} is null or ${table.amendsContractId} is not null)`,
    ),
    check(
      'contracts_approval_requires_signatory_check',
      sql`${table.approvedAt} is null or ${table.signatoryRecordedAt} is not null`,
    ),
    check(
      'contracts_approved_or_cancelled_check',
      sql`${table.approvedAt} is null or ${table.cancelledAt} is null`,
    ),
    check(
      'contracts_proposed_plan_check',
      sql`${table.proposedPlan} is null or (${table.amendsContractId} is not null and ${table.approvedAt} is null)`,
    ),
    // Core `contract_amendment_open`: sürüm başına tek açık (iptal edilmemiş) ek protokol.
    uniqueIndex('contracts_amendment_open_key')
      .on(table.institutionId, table.amendsContractId)
      .where(
        sql`${table.amendsContractId} is not null and ${table.cancelledAt} is null and ${table.archivedAt} is null`,
      ),
    index('contracts_student_idx').on(table.institutionId, table.studentId),
    index('contracts_root_idx').on(table.institutionId, table.rootContractId),
    index('contracts_amends_contract_idx')
      .on(table.institutionId, table.amendsContractId, table.rootContractId)
      .where(sql`${table.amendsContractId} is not null`),
    index('contracts_tariff_idx')
      .on(table.institutionId, table.tariffId)
      .where(sql`${table.tariffId} is not null`),
    index('contracts_scholarship_program_idx')
      .on(table.institutionId, table.scholarshipProgramId)
      .where(sql`${table.scholarshipProgramId} is not null`),
    index('contracts_position_idx').on(table.institutionId, table.position),
  ],
)
