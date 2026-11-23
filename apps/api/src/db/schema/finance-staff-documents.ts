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
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  HEALTH_REPORT_KINDS,
  MULTI_STAFF_DOCUMENT_TYPES,
  STAFF_DOCUMENT_NOTE_MAX,
  STAFF_DOCUMENT_TYPES,
  STAFF_DOCUMENT_VALIDITY_MONTHS_MAX,
  VALID_UNTIL_SOURCES,
  type HealthReportKind,
  type StaffDocumentType,
  type ValidUntilSource,
} from '@kampus/school-core/lib/finance-staff-documents.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { files } from './files.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Özlük belgesi tür ayarı (DOM-FIN-113; ON-173, K-372). Kurum başına tür satırı; satırı olmayan
 * tür core varsayılanını (`DEFAULT_STAFF_DOCUMENT_SETTINGS`) kullanır. Adli sicil ve sağlık
 * raporunun özel nitelikli işareti kaldırılamaz (veritabanı denetimi).
 */
export const staffDocumentTypeSettings = pgTable(
  'staff_document_type_settings',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    documentType: text('document_type').$type<StaffDocumentType>().notNull(),
    required: boolean('required').notNull(),
    validityMonths: integer('validity_months'),
    sensitive: boolean('sensitive').notNull(),
    // kvkk: K
    updatedByUserId: text('updated_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'staff_document_type_settings_pkey',
      columns: [table.institutionId, table.documentType],
    }),
    check(
      'staff_document_type_settings_type_check',
      oneOf(table.documentType, STAFF_DOCUMENT_TYPES),
    ),
    check(
      'staff_document_type_settings_validity_check',
      sql`${table.validityMonths} is null or ${table.validityMonths} between 1 and ${n(STAFF_DOCUMENT_VALIDITY_MONTHS_MAX)}`,
    ),
    check(
      'staff_document_type_settings_sensitive_check',
      sql`${table.sensitive} or ${table.documentType} not in ('health_report', 'criminal_record')`,
    ),
  ],
)

/**
 * Personel özlük belgesi (DOM-FIN-113; ON-173, K-373, K-374). Belge bir personel üyeliğine
 * bağlıdır (ayrı personel tablosu yoktur). Silinmez ve düzeltilmez: aynı türün yeni belgesi
 * eskisini "yerine geçti" yapar: eskisine `superseded_at`, yenisine `replaces_id` yazılır. Tekil türde (sağlık raporu,
 * adli sicil, kimlik) yerine geçilmemiş tek belge kısmi tekil indeksle güvencededir. Dosya platform
 * dosya altyapısındadır (`files`, amaç `document`, bağ türü `staff_document`).
 */
export const staffDocuments = pgTable(
  'staff_documents',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    documentType: text('document_type').$type<StaffDocumentType>().notNull(),
    healthReportKind: text('health_report_kind').$type<HealthReportKind>(),
    documentDate: date('document_date', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    validUntilSource: text('valid_until_source').$type<ValidUntilSource>().notNull(),
    // kvkk: Ö (adli sicil ve sağlık raporunun dosyası; açılışı denetimde)
    fileId: uuid('file_id'),
    // kvkk: K (serbest metin; özel nitelikli türde yazılmaz)
    note: text('note'),
    replacesId: uuid('replaces_id'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_documents_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_documents_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_documents_file_fkey',
      columns: [table.institutionId, table.fileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_documents_replaces_fkey',
      columns: [table.institutionId, table.replacesId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    check('staff_documents_type_check', oneOf(table.documentType, STAFF_DOCUMENT_TYPES)),
    check(
      'staff_documents_health_kind_check',
      sql`((${table.documentType} = 'health_report') = (${table.healthReportKind} is not null))
        and (${table.healthReportKind} is null or ${oneOf(table.healthReportKind, HEALTH_REPORT_KINDS)})`,
    ),
    check(
      'staff_documents_valid_until_check',
      sql`${table.validUntil} is null or ${table.validUntil} >= ${table.documentDate}`,
    ),
    check(
      'staff_documents_valid_until_source_check',
      sql`${oneOf(table.validUntilSource, VALID_UNTIL_SOURCES)}
        and (${table.validUntilSource} = 'type' or ${table.validUntil} is not null)`,
    ),
    check(
      'staff_documents_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(STAFF_DOCUMENT_NOTE_MAX)}`,
    ),
    // Özel nitelikli veri serbest metne yazılmaz.
    check(
      'staff_documents_sensitive_note_check',
      sql`${table.note} is null or ${table.documentType} not in ('health_report', 'criminal_record')`,
    ),
    uniqueIndex('staff_documents_current_key')
      .on(table.institutionId, table.membershipId, table.documentType)
      .where(
        sql`${table.supersededAt} is null and ${table.documentType} not in (${sql.raw(
          MULTI_STAFF_DOCUMENT_TYPES.map((type) => `'${type}'`).join(', '),
        )})`,
      ),
    uniqueIndex('staff_documents_file_key')
      .on(table.institutionId, table.fileId)
      .where(sql`${table.fileId} is not null`),
    index('staff_documents_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.documentType,
    ),
    index('staff_documents_valid_until_idx')
      .on(table.institutionId, table.validUntil)
      .where(sql`${table.supersededAt} is null and ${table.validUntil} is not null`),
    // Bir belgenin yerine en çok bir belge geçer; yabancı anahtarın indeksidir.
    uniqueIndex('staff_documents_replaces_key')
      .on(table.institutionId, table.replacesId)
      .where(sql`${table.replacesId} is not null`),
  ],
)
