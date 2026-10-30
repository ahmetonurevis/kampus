import { sql, type SQL } from 'drizzle-orm'
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core'

import { RESOURCE_STATUSES } from '@kampus/school-core/content/resource.ts'
import type {
  AnswerKey,
  Attribution,
  ResourceContent,
  ResourceLicense,
  ResourceTags,
} from '@kampus/school-core/content/resource.ts'
import {
  ACTIVITY_MODES,
  CEFR_LEVELS,
  CONTENT_TYPES,
  DIFFICULTIES,
  INTERACTION_CHANNELS,
  OUTCOME_SOURCES,
  PRIMARY_SKILLS,
  SHARE_SCOPES,
} from '@kampus/school-core/content/taxonomy.ts'

import { institutions } from './auth.ts'

/**
 * İçerik havuzu (ADR 0004 karar 1, 3; docs/domain/kaynak-platformu.md). Kaynak (`resources`)
 * kimliği, sahibi, türü, paylaşım kapsamını ve güncel yayındaki sürümü; sürüm
 * (`resource_versions`) içeriği, cevap anahtarını, etiketleri ve lisansı tutar. Kural
 * school-core `content/*`'tadır; bu tablolar onun satırlarıdır.
 *
 * - Kimlik uygulamada üretilen `uuid`'dir; her yabancı anahtar `(institution_id, …_id)`
 *   bileşiktir: başka kurumun satırına bağlanmak veritabanınca imkânsızdır.
 * - Yayımlanmış sürümün içerik, etiket ve lisans kolonları değişmez; servis reddeder
 *   (`services/resources.ts`), testler denetler. Veritabanı tetikleyicisi yok (karar 3).
 * - Sürümde `archived_at` core'un `archivedAt` alanıdır (durum `archived`): arşivlenen sürüm
 *   geçmiş görevlerde ve sürüm geçmişinde okunmaya devam eder (DOM-KYN-032, 051). Bu yüzden sürüm
 *   sorguları arşivliyi varsayılan olarak dışlamaz; görünürlüğü `status` belirler.
 * - Tablolar yeni ve boştur; kısıtlar `not valid` adımına gerek olmadan tek adımda eklenir.
 */

/** PostgreSQL `tsvector`; değer uygulamada `to_tsvector('simple', …)` ile yazılır, okunmaz. */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })

/** Sabit sözlük değerleri için `check` ifadesi; değerler kodun kendisidir, kullanıcı girdisi değil. */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  for (const value of values)
    if (!/^[A-Za-z0-9_+-]+$/.test(value)) throw new Error(`invalid check value: ${value}`)
  return sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`
}
const keys = (record: Record<string, unknown>) => Object.keys(record)

export const RESOURCE_SHARE_TARGET_KINDS = ['student', 'class'] as const
export type ResourceShareTargetKind = (typeof RESOURCE_SHARE_TARGET_KINDS)[number]

/** Zorunlu kolonlar (veritabani.md §2). */
const required = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})

export const resources = pgTable(
  'resources',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    contentType: text('content_type').$type<keyof typeof CONTENT_TYPES>().notNull(),
    // kvkk: K — sahibin kullanıcı kimliği (DOM-KYN-001)
    ownerUserId: text('owner_user_id').notNull(),
    shareScope: text('share_scope').$type<keyof typeof SHARE_SCOPES>().notNull().default('private'),
    currentVersionId: uuid('current_version_id'),
    derivedFromVersionId: uuid('derived_from_version_id'),
    // TODO(F3b-library): `platform_resource_versions` gelince bileşik olmayan yabancı anahtar eklenir.
    derivedFromPlatformVersionId: uuid('derived_from_platform_version_id'),
    ...required(),
  },
  // Açık dönüş tipi: `resources` ↔ `resource_versions` bileşik yabancı anahtarları döngüseldir;
  // tip çıkarımı döngüye girmesin diye ekstra yapılandırma dönüş tipi elle verilir.
  (table): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'resources_pkey', columns: [table.institutionId, table.id] }),
    check('resources_content_type_check', oneOf(table.contentType, keys(CONTENT_TYPES))),
    check('resources_share_scope_check', oneOf(table.shareScope, keys(SHARE_SCOPES))),
    foreignKey({
      name: 'resources_current_version_fkey',
      columns: [table.institutionId, table.currentVersionId],
      foreignColumns: [resourceVersions.institutionId, resourceVersions.id],
    }),
    foreignKey({
      name: 'resources_derived_from_version_fkey',
      columns: [table.institutionId, table.derivedFromVersionId],
      foreignColumns: [resourceVersions.institutionId, resourceVersions.id],
    }),
    // Sahip süzgeci ("benim içeriklerim") ve sahiplik devri (DOM-KYN-052).
    index('resources_owner_idx').on(table.institutionId, table.ownerUserId),
    // Yabancı anahtar indeksleri (veritabani.md §6); boş değerler indekse girmez.
    index('resources_current_version_idx')
      .on(table.institutionId, table.currentVersionId)
      .where(sql`${table.currentVersionId} is not null`),
    // Kaldırmada türetilmiş kopyalar (DOM-KYN-050, 051).
    index('resources_derived_from_version_idx')
      .on(table.institutionId, table.derivedFromVersionId)
      .where(sql`${table.derivedFromVersionId} is not null`),
  ],
)

export const resourceVersions = pgTable(
  'resource_versions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    resourceId: uuid('resource_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    status: text('status').$type<keyof typeof RESOURCE_STATUSES>().notNull(),
    // kvkk: K
    authorUserId: text('author_user_id').notNull(),
    title: text('title').notNull(),
    /** Tür başına core şeması (`resourceContentSchema`); yalnız kaldırılan sürümde boştur. */
    content: jsonb('content').$type<ResourceContent>(),
    /** Ayrı kolon (karar 3): öğrenci/veli yanıt şemasında yoktur. */
    answerKey: jsonb('answer_key').$type<AnswerKey>(),
    license: jsonb('license').$type<ResourceLicense>(),
    /** Süzgeç ve bağımlılık göstergesi için lisans türü; `license`'tan türetilir, elle yazılmaz. */
    licenseKind: text('license_kind')
      .$type<ResourceLicense['kind']>()
      .generatedAlwaysAs(sql`(license ->> 'kind')`),
    attributions: jsonb('attributions').$type<Attribution[]>().notNull().default([]),
    subjectId: text('subject_id'),
    gradeLevels: integer('grade_levels')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    cefrLevel: text('cefr_level').$type<keyof typeof CEFR_LEVELS>(),
    primarySkill: text('primary_skill').$type<(typeof PRIMARY_SKILLS)[number]>(),
    skills: text('skills')
      .array()
      .$type<ResourceTags['skills']>()
      .notNull()
      .default(sql`'{}'::text[]`),
    activityMode: text('activity_mode').$type<keyof typeof ACTIVITY_MODES>(),
    interactionChannel: text('interaction_channel').$type<keyof typeof INTERACTION_CHANNELS>(),
    mediation: jsonb('mediation').$type<ResourceTags['mediation']>(),
    durationMinutes: integer('duration_minutes'),
    difficulty: text('difficulty').$type<keyof typeof DIFFICULTIES>(),
    /** Core `searchDocument` çıktısı (açık soru 5a; SQL'de ikinci normalleştirme yok). */
    searchVector: tsvector('search_vector').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    // kvkk: K
    reviewedByUserId: text('reviewed_by_user_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    // kvkk: K — serbest metin; loglanmaz
    rejectionReason: text('rejection_reason'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    // kvkk: K — serbest metin; loglanmaz
    removalReason: text('removal_reason'),
    ...required(),
  },
  (table): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'resource_versions_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'resource_versions_resource_fkey',
      columns: [table.institutionId, table.resourceId],
      foreignColumns: [resources.institutionId, resources.id],
    }),
    check('resource_versions_status_check', oneOf(table.status, keys(RESOURCE_STATUSES))),
    check(
      'resource_versions_cefr_level_check',
      sql`${table.cefrLevel} is null or ${oneOf(table.cefrLevel, keys(CEFR_LEVELS))}`,
    ),
    check(
      'resource_versions_primary_skill_check',
      sql`${table.primarySkill} is null or ${oneOf(table.primarySkill, PRIMARY_SKILLS)}`,
    ),
    check(
      'resource_versions_difficulty_check',
      sql`${table.difficulty} is null or ${oneOf(table.difficulty, keys(DIFFICULTIES))}`,
    ),
    check('resource_versions_number_check', sql`${table.versionNumber} >= 1`),
    // Kaldırılan sürümde içerik ve anahtar silinir; başka durumda içerik zorunludur (DOM-KYN-051).
    check(
      'resource_versions_content_check',
      sql`(${table.status} = 'removed') = (${table.content} is null)`,
    ),
    check(
      'resource_versions_published_check',
      sql`${table.status} <> 'published' or ${table.publishedAt} is not null`,
    ),
    // Sürüm numarası kaynakta tekildir; kaynak yabancı anahtarının indeksidir.
    uniqueIndex('resource_versions_resource_number_key').on(
      table.institutionId,
      table.resourceId,
      table.versionNumber,
    ),
    // Kaynakta düzenlenen (taslak/reddedilmiş) en fazla bir sürüm (core `planNewVersion`'ın
    // güvencesi). İncelemedeki sürüm hariç: telif bildirimiyle yayındaki sürüm incelemeye
    // alınırken açık taslak bulunabilir (DOM-KYN-025).
    uniqueIndex('resource_versions_editable_key')
      .on(table.institutionId, table.resourceId)
      .where(sql`${table.status} in ('draft', 'rejected')`),
    // Metin araması (karar 3, açık soru 5a). Bileşik GIN `btree_gin` eklentisiyle (migration
    // 0010) `institution_id` ile başlar: kurum koşulu ve sözcük eşleşmesi tek indeks taramasıdır
    // (veritabani.md §6, EXPLAIN gerekçesi orada).
    index('resource_versions_search_idx').using('gin', table.institutionId, table.searchVector),
  ],
)

/** Sürümün kazanım bağlantıları (karar 3; kazanım kataloğu sonraki dilimde). */
export const resourceVersionOutcomes = pgTable(
  'resource_version_outcomes',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    versionId: uuid('version_id').notNull(),
    outcomeSource: text('outcome_source').$type<keyof typeof OUTCOME_SOURCES>().notNull(),
    // TODO(F3b-outcomes): `learning_outcomes`/`platform_learning_outcomes` gelince yabancı anahtar.
    outcomeId: text('outcome_id').notNull(),
    /** Etiket sırası (core listesi sırası). */
    position: integer('position').notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({
      name: 'resource_version_outcomes_pkey',
      columns: [table.institutionId, table.versionId, table.outcomeSource, table.outcomeId],
    }),
    foreignKey({
      name: 'resource_version_outcomes_version_fkey',
      columns: [table.institutionId, table.versionId],
      foreignColumns: [resourceVersions.institutionId, resourceVersions.id],
    }),
    check(
      'resource_version_outcomes_source_check',
      oneOf(table.outcomeSource, keys(OUTCOME_SOURCES)),
    ),
  ],
)

/**
 * Quiz ve alıştırma setinin soruları, sürüm kimlikleriyle (karar 3): sorunun yeni sürümü quiz'i
 * değiştirmez. İçerikteki `items` dizisiyle aynıdır; servis ikisini birlikte yazar.
 */
export const resourceVersionItems = pgTable(
  'resource_version_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    versionId: uuid('version_id').notNull(),
    position: integer('position').notNull(),
    itemVersionId: uuid('item_version_id').notNull(),
    points: integer('points').notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({
      name: 'resource_version_items_pkey',
      columns: [table.institutionId, table.versionId, table.position],
    }),
    foreignKey({
      name: 'resource_version_items_version_fkey',
      columns: [table.institutionId, table.versionId],
      foreignColumns: [resourceVersions.institutionId, resourceVersions.id],
    }),
    foreignKey({
      name: 'resource_version_items_item_version_fkey',
      columns: [table.institutionId, table.itemVersionId],
      foreignColumns: [resourceVersions.institutionId, resourceVersions.id],
    }),
    check('resource_version_items_points_check', sql`${table.points} between 1 and 100`),
    // Soru yabancı anahtarı ve kaldırmada soruyu içeren quiz'ler (DOM-KYN-051).
    index('resource_version_items_item_idx').on(table.institutionId, table.itemVersionId),
  ],
)

/**
 * Paylaşım hedefleri (DOM-KYN-040): `students` kapsamında öğrenci, `classes` kapsamında sınıf/grup
 * kimlikleri. Kimlikler `records` kayıtlarıdır; veritabanı yabancı anahtarı yoktur (karar 12),
 * bütünlüğü core kapsam kuralı sağlar. Kaldırılan hedef arşivlenir (`archived_at`).
 */
export const resourceShares = pgTable(
  'resource_shares',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    resourceId: uuid('resource_id').notNull(),
    targetKind: text('target_kind').$type<ResourceShareTargetKind>().notNull(),
    // kvkk: K (school-core öğrenci/sınıf kimliği)
    targetId: text('target_id').notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({
      name: 'resource_shares_pkey',
      columns: [table.institutionId, table.resourceId, table.targetKind, table.targetId],
    }),
    foreignKey({
      name: 'resource_shares_resource_fkey',
      columns: [table.institutionId, table.resourceId],
      foreignColumns: [resources.institutionId, resources.id],
    }),
    check(
      'resource_shares_target_kind_check',
      oneOf(table.targetKind, RESOURCE_SHARE_TARGET_KINDS),
    ),
    // Öğrencinin kütüphanesi: kendisiyle veya sınıfıyla paylaşılan kaynaklar (DOM-KYN-041).
    index('resource_shares_target_idx')
      .on(table.institutionId, table.targetKind, table.targetId)
      .where(sql`${table.archivedAt} is null`),
  ],
)

export type ResourceRow = typeof resources.$inferSelect
export type ResourceVersionRow = typeof resourceVersions.$inferSelect
