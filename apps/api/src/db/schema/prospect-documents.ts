import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
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
  DOCUMENT_CONSENT_GRANTORS,
  DOCUMENT_CONSENT_METHODS,
  PROSPECT_DOCUMENT_KINDS,
  PROSPECT_DOCUMENT_LABEL_MAX,
  PROSPECT_DOCUMENT_REJECTION_MAX,
  PROSPECT_DOCUMENT_STAGES,
  PROSPECT_DOCUMENT_STATUSES,
  type DocumentConsentGrantor,
  type DocumentConsentMethod,
  type ProspectDocumentKind,
  type ProspectDocumentStage,
  type ProspectDocumentStatus,
} from '@kampus/school-core/lib/prospect-documents.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { files } from './files.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Aday belge türü listesi (docs/domain/kayit-ve-crm.md DOM-KAY-043; ON-263, K-320): kurum ayarıdır.
 * Kurumun ilk okumasında core `defaultProspectDocumentTypes` satırları yazılır (kimlik türün
 * kendisidir: `identity`, `report_card` …); yöneticinin eklediği tür UUID alır. Silme arşivdir: belgesi
 * olan tür arşivlense de belgeleri adıyla görünür, yeni belge alınmaz.
 */
export const prospectDocumentTypes = pgTable(
  'prospect_document_types',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: text('id').notNull(),
    kind: text('kind').$type<ProspectDocumentKind>().notNull(),
    label: text('label').notNull(),
    required: boolean('required').notNull(),
    stage: text('stage').$type<ProspectDocumentStage>().notNull(),
    specialCategory: boolean('special_category').notNull(),
    position: integer('position').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'prospect_document_types_pkey', columns: [table.institutionId, table.id] }),
    check('prospect_document_types_id_check', sql`char_length(${table.id}) between 1 and 64`),
    check('prospect_document_types_kind_check', oneOf(table.kind, PROSPECT_DOCUMENT_KINDS)),
    check('prospect_document_types_stage_check', oneOf(table.stage, PROSPECT_DOCUMENT_STAGES)),
    check(
      'prospect_document_types_label_check',
      sql`char_length(${table.label}) between 2 and ${n(PROSPECT_DOCUMENT_LABEL_MAX)}`,
    ),
    // Sağlık raporu her zaman özel nitelikli (KVKK md. 6; K-322).
    check(
      'prospect_document_types_special_check',
      sql`${table.kind} <> 'health_report' or ${table.specialCategory}`,
    ),
    // Liste kurumun bütün türlerini okur (en çok 30 etkin satır); PK yeterli.
  ],
)

/**
 * Adaya eklenen belge (DOM-KAY-043): platform dosyasına (`files`, amaç `document`) bağ ve inceleme
 * durumu. Aday `records`'tadır (yabancı anahtar yok). Türde tek güncel belge bulunur; yeni yükleme
 * öncekini `superseded` yapar. Dosya içeriği bu tabloda değildir; özel nitelikli belgenin dosyası
 * yalnız yöneticiye ve denetimli açılır (K-322).
 */
export const prospectDocuments = pgTable(
  'prospect_documents',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K — adayın kaydı (records `prospects`)
    prospectId: text('prospect_id').notNull(),
    documentTypeId: text('document_type_id').notNull(),
    // kvkk: Ö — sağlık raporu gibi özel nitelikli belgenin dosyası olabilir (içerik `files` deposunda)
    fileId: uuid('file_id').notNull(),
    status: text('status').$type<ProspectDocumentStatus>().notNull(),
    // Yükleme anındaki tür işareti; tür sonradan değişse de belgenin erişim kuralı değişmez.
    specialCategory: boolean('special_category').notNull(),
    // kvkk: K — ret gerekçesi (serbest metin, en çok 300 karakter); loglanmaz, denetime alan adı düşer
    rejectionReason: text('rejection_reason'),
    uploadedByUserId: text('uploaded_by_user_id').notNull(),
    reviewedByUserId: text('reviewed_by_user_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    supersededById: uuid('superseded_by_id'),
    // Kesin kayıtla eklenen ikinci bağ (DOM-KAY-045, K-384): belgenin öğrenci dosyasındaki yeri.
    // kvkk: K — öğrencinin kaydı (records `students`); dosya kopyalanmaz, bağı aday belgesinde kalır
    studentId: text('student_id'),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    linkedByUserId: text('linked_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'prospect_documents_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'prospect_documents_type_fkey',
      columns: [table.institutionId, table.documentTypeId],
      foreignColumns: [prospectDocumentTypes.institutionId, prospectDocumentTypes.id],
    }),
    foreignKey({
      name: 'prospect_documents_file_fkey',
      columns: [table.institutionId, table.fileId],
      foreignColumns: [files.institutionId, files.id],
    }),
    check('prospect_documents_status_check', oneOf(table.status, PROSPECT_DOCUMENT_STATUSES)),
    check(
      'prospect_documents_rejection_check',
      // Reddedilen belgenin gerekçesi zorunlu; yerine yenisi yüklenen reddedilmiş belge gerekçesini korur.
      sql`(${table.status} <> 'rejected' or ${table.rejectionReason} is not null) and (${table.rejectionReason} is null or ${table.status} in ('rejected', 'superseded'))`,
    ),
    check(
      'prospect_documents_rejection_length_check',
      sql`${table.rejectionReason} is null or char_length(${table.rejectionReason}) between 2 and ${n(PROSPECT_DOCUMENT_REJECTION_MAX)}`,
    ),
    check(
      'prospect_documents_superseded_check',
      sql`(${table.status} = 'superseded') = (${table.supersededAt} is not null)`,
    ),
    check(
      'prospect_documents_link_check',
      sql`(${table.studentId} is null) = (${table.linkedAt} is null) and (${table.studentId} is null) = (${table.linkedByUserId} is null)`,
    ),
    // Yalnız kabul edilmiş belge bağlanır; yerine yenisi yüklenince bağ geçmiş olarak kalır (K-384).
    check(
      'prospect_documents_link_status_check',
      sql`${table.studentId} is null or ${table.status} in ('accepted', 'superseded')`,
    ),
    // Öğrencinin kayıt belgeleri bu indeksten okunur.
    index('prospect_documents_student_idx')
      .on(table.institutionId, table.studentId)
      .where(sql`${table.studentId} is not null`),
    // Adayın belgeleri bu indeksten okunur.
    index('prospect_documents_prospect_idx').on(table.institutionId, table.prospectId),
    // Türde tek güncel belge.
    uniqueIndex('prospect_documents_current_key')
      .on(table.institutionId, table.prospectId, table.documentTypeId)
      .where(sql`${table.status} <> 'superseded' and ${table.archivedAt} is null`),
    // Bir dosya tek belgeye bağlanır (dosya da tek kayda bağlanır; ADR 0003 karar 5).
    uniqueIndex('prospect_documents_file_key').on(table.institutionId, table.fileId),
    // Tür yabancı anahtarı indeksli.
    index('prospect_documents_type_idx').on(table.institutionId, table.documentTypeId),
  ],
)

/**
 * Özel nitelikli aday belgesi için açık rıza kaydı (DOM-KAY-043, K-322; rıza deseni DOM-YTK-058,
 * DOM-YTK-059): ön büro velinin (yetişkin kursiyer adayında adayın) ıslak imzalı formunu aldığını
 * işaretler. Satır rızanın metnini taşımaz; geri çekme aynı satıra yazılır, başka alan değişmez.
 * Aday başına tek etkin rıza.
 */
export const prospectDocumentConsents = pgTable(
  'prospect_document_consents',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K — adayın kaydı (records `prospects`)
    prospectId: text('prospect_id').notNull(),
    grantor: text('grantor').$type<DocumentConsentGrantor>().notNull(),
    method: text('method').$type<DocumentConsentMethod>().notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
    grantedByUserId: text('granted_by_user_id').notNull(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnByUserId: text('withdrawn_by_user_id'),
    // Kesin kayıtla rızanın bağlandığı öğrenci (DOM-KAY-045, K-385; H-80).
    // kvkk: K — öğrencinin kaydı (records `students`)
    studentId: text('student_id'),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'prospect_document_consents_pkey',
      columns: [table.institutionId, table.id],
    }),
    check(
      'prospect_document_consents_grantor_check',
      oneOf(table.grantor, DOCUMENT_CONSENT_GRANTORS),
    ),
    check('prospect_document_consents_method_check', oneOf(table.method, DOCUMENT_CONSENT_METHODS)),
    check(
      'prospect_document_consents_withdrawn_check',
      sql`(${table.withdrawnAt} is null) = (${table.withdrawnByUserId} is null)`,
    ),
    check(
      'prospect_document_consents_link_check',
      sql`(${table.studentId} is null) = (${table.linkedAt} is null)`,
    ),
    index('prospect_document_consents_prospect_idx').on(table.institutionId, table.prospectId),
    // Aday başına tek etkin rıza.
    uniqueIndex('prospect_document_consents_active_key')
      .on(table.institutionId, table.prospectId)
      .where(sql`${table.withdrawnAt} is null and ${table.archivedAt} is null`),
  ],
)
