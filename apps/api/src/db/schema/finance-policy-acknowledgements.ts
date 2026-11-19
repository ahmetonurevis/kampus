import { sql } from 'drizzle-orm'
import {
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
  POLICY_ACK_CHANNELS,
  POLICY_AUDIENCES,
  POLICY_TITLE_MAX,
  POLICY_TYPES,
  type PolicyAckChannel,
  type PolicyAudience,
  type PolicyType,
} from '@kampus/school-core/lib/finance-policy-acknowledgements.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { files } from './files.ts'

/**
 * Politika belgesi sürümü (DOM-FIN-127; ON-190, K-436). Her satır bir sürümdür; aynı belgenin
 * sürümleri `series_id` ile bağlanır (ilk sürümde kendi kimliği). Yeni sürüm öncekine
 * `superseded_at` yazar; geçerli sürüm seri başına tektir (kısmi tekil indeks). Silinmez.
 */
export const policyDocuments = pgTable(
  'policy_documents',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    seriesId: uuid('series_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    title: text('title').notNull(),
    policyType: text('policy_type').$type<PolicyType>().notNull(),
    audience: text('audience').$type<PolicyAudience>().notNull(),
    publishedOn: date('published_on', { mode: 'string' }).notNull(),
    fileId: uuid('file_id').notNull(),
    replacesId: uuid('replaces_id'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'policy_documents_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'policy_documents_file_fkey',
      columns: [table.institutionId, table.fileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'policy_documents_replaces_fkey',
      columns: [table.institutionId, table.replacesId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    check('policy_documents_type_check', oneOf(table.policyType, POLICY_TYPES)),
    check('policy_documents_audience_check', oneOf(table.audience, POLICY_AUDIENCES)),
    check('policy_documents_version_check', sql`${table.versionNumber} >= 1`),
    check(
      'policy_documents_title_check',
      sql`char_length(${table.title}) between 2 and ${sql.raw(String(POLICY_TITLE_MAX))}`,
    ),
    check(
      'policy_documents_first_version_check',
      sql`(${table.versionNumber} = 1) = (${table.replacesId} is null)`,
    ),
    uniqueIndex('policy_documents_series_version_key').on(
      table.institutionId,
      table.seriesId,
      table.versionNumber,
    ),
    uniqueIndex('policy_documents_current_key')
      .on(table.institutionId, table.seriesId)
      .where(sql`${table.supersededAt} is null`),
    uniqueIndex('policy_documents_file_key').on(table.institutionId, table.fileId),
    uniqueIndex('policy_documents_replaces_key')
      .on(table.institutionId, table.replacesId)
      .where(sql`${table.replacesId} is not null`),
  ],
)

/**
 * Politika belgesi okundu onayı (DOM-FIN-127; ON-190, K-436, K-437). Personel üyeliği × belge
 * sürümü başına tek satır; onay günü, kanal ve kaydı giren. Silinmez ve düzeltilmez; sürüm yerine
 * geçilince onay geçmişte kalır, yeni sürüme sayılmaz.
 */
export const policyAcknowledgements = pgTable(
  'policy_acknowledgements',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    policyDocumentId: uuid('policy_document_id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    acknowledgedOn: date('acknowledged_on', { mode: 'string' }).notNull(),
    channel: text('channel').$type<PolicyAckChannel>().notNull(),
    // kvkk: K (ıslak imzalı form taraması)
    scanFileId: uuid('scan_file_id'),
    // kvkk: K
    recordedByUserId: text('recorded_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'policy_acknowledgements_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'policy_acknowledgements_document_fkey',
      columns: [table.institutionId, table.policyDocumentId],
      foreignColumns: [policyDocuments.institutionId, policyDocuments.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'policy_acknowledgements_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'policy_acknowledgements_scan_file_fkey',
      columns: [table.institutionId, table.scanFileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    check('policy_acknowledgements_channel_check', oneOf(table.channel, POLICY_ACK_CHANNELS)),
    uniqueIndex('policy_acknowledgements_member_key').on(
      table.institutionId,
      table.policyDocumentId,
      table.membershipId,
    ),
    uniqueIndex('policy_acknowledgements_scan_file_key')
      .on(table.institutionId, table.scanFileId)
      .where(sql`${table.scanFileId} is not null`),
    index('policy_acknowledgements_membership_idx').on(table.institutionId, table.membershipId),
  ],
)
