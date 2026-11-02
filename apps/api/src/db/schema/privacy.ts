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
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  CONSENT_SUBJECT_KINDS,
  type ConsentChannel,
  type ConsentPurpose,
  type ConsentSubjectKind,
} from '@kampus/school-core/lib/consent-purposes.ts'
import {
  CONSENT_DECISIONS,
  GRANTOR_RELATIONS,
  WITHDRAWAL_REASONS,
  type ConsentDecision,
  type GrantorRelation,
  type WithdrawalReason,
} from '@kampus/school-core/lib/consents.ts'
import {
  NOTICE_AUDIENCES,
  PRIVACY_NOTICE_KINDS,
  type NoticeAudience,
  type PrivacyNoticeKind,
} from '@kampus/school-core/lib/privacy-notices.ts'

import { institutions } from './auth.ts'
import { keys, oneOf, requiredColumns } from './columns.ts'

/**
 * Aydınlatma ve açık rıza (guvenlik-kvkk §9; DOM-YTK-056…062; kurallar core
 * `lib/privacy-notices.ts`, `lib/consents.ts`). Kişisel veri `records.data`'ya konmaz; rıza satırı
 * yalnız kod, kimlik ve zaman taşır, metnin kendisi `privacy_notices`'tadır.
 *
 * Değişmezlik migration 0024'ün sonundaki elle yazılmış tetikleyicilerle korunur (Drizzle şeması
 * izlemez): yayımlanmış metin ve gösterim satırı hiç değişmez, arşivlenmez
 * (`kampus_reject_immutable_change`); rıza satırında tek değişiklik geri çekme kolonlarının bir kez
 * yazılmasıdır. Satır silme yalnız imha işinin `kampus.allow_immutable_purge` ayarıyla geçer.
 * Tablolar yeni ve boştur; kısıtlar `not valid` adımına gerek olmadan tek adımda eklenir.
 */

/** Yayımlanmış aydınlatma (`notice`, kitleye) ve rıza (`consent_text`, amaca) metni sürümleri. */
export const privacyNotices = pgTable(
  'privacy_notices',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    kind: text('kind').$type<PrivacyNoticeKind>().notNull(),
    audience: text('audience').$type<NoticeAudience>(),
    purpose: text('purpose').$type<ConsentPurpose>(),
    noticeVersion: integer('notice_version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    requiresReconsent: boolean('requires_reconsent').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    // kvkk: K — yayımlayan yönetici
    publishedByUserId: text('published_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'privacy_notices_pkey', columns: [table.institutionId, table.id] }),
    check('privacy_notices_kind_check', oneOf(table.kind, PRIVACY_NOTICE_KINDS)),
    check(
      'privacy_notices_audience_check',
      sql`${table.audience} is null or ${oneOf(table.audience, keys(NOTICE_AUDIENCES))}`,
    ),
    check(
      'privacy_notices_purpose_check',
      sql`${table.purpose} is null or ${oneOf(table.purpose, keys(CONSENT_PURPOSES))}`,
    ),
    // Aydınlatma kitleye, rıza metni amaca bağlıdır; yeniden rıza yalnız rıza metninde.
    check(
      'privacy_notices_topic_check',
      sql`(${table.kind} = 'notice' and ${table.audience} is not null and ${table.purpose} is null and not ${table.requiresReconsent})
        or (${table.kind} = 'consent_text' and ${table.purpose} is not null and ${table.audience} is null)`,
    ),
    check('privacy_notices_notice_version_check', sql`${table.noticeVersion} >= 1`),
    check('privacy_notices_title_check', sql`char_length(${table.title}) between 1 and 200`),
    check('privacy_notices_body_check', sql`char_length(${table.body}) between 1 and 50000`),
    // Yayımlanmış metin hiç değişmez ve arşivlenmez (DOM-YTK-056, DOM-YTK-060): arşivlenen sürüm
    // listeden düşüp aynı sürüm numarasını yeniden kullandırır ya da yeniden rıza şartını düşürürdü.
    // Yerini yeni sürüm alır; sürüm hesabı ve yeniden rıza alt sınırı bu yüzden bütün satırları görür.
    check(
      'privacy_notices_version_check',
      sql`${table.version} = 1 and ${table.archivedAt} is null`,
    ),
    // Konu başına sürüm tekildir; son sürüm sorgusu da bu indeksleri kullanır.
    uniqueIndex('privacy_notices_audience_version_key')
      .on(table.institutionId, table.audience, table.noticeVersion)
      .where(sql`${table.kind} = 'notice'`),
    uniqueIndex('privacy_notices_purpose_version_key')
      .on(table.institutionId, table.purpose, table.noticeVersion)
      .where(sql`${table.kind} = 'consent_text'`),
  ],
)

/** Aydınlatma gösterim kaydı (kullanıcı, metin sürümü, kanal, zaman); değişmez satır. */
export const noticeAcknowledgements = pgTable(
  'notice_acknowledgements',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    noticeId: uuid('notice_id').notNull(),
    // kvkk: K — metni gören kullanıcı
    userId: text('user_id').notNull(),
    channel: text('channel').$type<ConsentChannel>().notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'notice_acknowledgements_pkey', columns: [table.institutionId, table.id] }),
    // Gösterilmiş sürüm silinemez (ispat).
    foreignKey({
      name: 'notice_acknowledgements_notice_fkey',
      columns: [table.institutionId, table.noticeId],
      foreignColumns: [privacyNotices.institutionId, privacyNotices.id],
    }).onDelete('restrict'),
    check('notice_acknowledgements_channel_check', oneOf(table.channel, CONSENT_CHANNELS)),
    check(
      'notice_acknowledgements_version_check',
      sql`${table.version} = 1 and ${table.archivedAt} is null`,
    ),
    // Kullanıcı aynı sürümü bir kez kaydeder; kullanıcının gösterimleri bu indeksin önekiyle okunur.
    uniqueIndex('notice_acknowledgements_user_notice_key').on(
      table.institutionId,
      table.userId,
      table.noticeId,
    ),
    index('notice_acknowledgements_notice_idx').on(table.institutionId, table.noticeId),
  ],
)

/** Amaç bazlı açık rıza ve öğrenci itirazı (DOM-YTK-057…062). */
export const consents = pgTable(
  'consents',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    subjectKind: text('subject_kind').$type<ConsentSubjectKind>().notNull(),
    // kvkk: K — veri sahibi öğrenci kaydı (`records` students) ya da kullanıcı
    subjectId: text('subject_id').notNull(),
    purpose: text('purpose').$type<ConsentPurpose>().notNull(),
    decision: text('decision').$type<ConsentDecision>().notNull(),
    // kvkk: K — rızayı veren kullanıcı
    grantedByUserId: text('granted_by_user_id').notNull(),
    grantorRelation: text('grantor_relation').$type<GrantorRelation>().notNull(),
    /** Gösterilen rıza metni sürümü. */
    textId: uuid('text_id').notNull(),
    textVersion: integer('text_version').notNull(),
    channel: text('channel').$type<ConsentChannel>().notNull(),
    givenAt: timestamp('given_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    // kvkk: K — geri çeken kullanıcı
    withdrawnByUserId: text('withdrawn_by_user_id'),
    withdrawalReason: text('withdrawal_reason').$type<WithdrawalReason>(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'consents_pkey', columns: [table.institutionId, table.id] }),
    // Rıza verilmiş metin sürümü silinemez (ispat).
    foreignKey({
      name: 'consents_text_fkey',
      columns: [table.institutionId, table.textId],
      foreignColumns: [privacyNotices.institutionId, privacyNotices.id],
    }).onDelete('restrict'),
    check('consents_subject_kind_check', oneOf(table.subjectKind, CONSENT_SUBJECT_KINDS)),
    check('consents_purpose_check', oneOf(table.purpose, keys(CONSENT_PURPOSES))),
    check('consents_decision_check', oneOf(table.decision, CONSENT_DECISIONS)),
    check('consents_grantor_relation_check', oneOf(table.grantorRelation, GRANTOR_RELATIONS)),
    check('consents_channel_check', oneOf(table.channel, CONSENT_CHANNELS)),
    check(
      'consents_withdrawal_reason_check',
      sql`${table.withdrawalReason} is null or ${oneOf(table.withdrawalReason, WITHDRAWAL_REASONS)}`,
    ),
    check('consents_text_version_check', sql`${table.textVersion} >= 1`),
    check('consents_subject_id_check', sql`char_length(${table.subjectId}) between 1 and 200`),
    // Geri çekme anı, geri çeken ve neden birlikte yazılır.
    check(
      'consents_withdrawal_check',
      sql`(${table.withdrawnAt} is null) = (${table.withdrawnByUserId} is null)
        and (${table.withdrawnAt} is null) = (${table.withdrawalReason} is null)`,
    ),
    check(
      'consents_dates_check',
      sql`(${table.expiresAt} is null or ${table.expiresAt} > ${table.givenAt})
        and (${table.withdrawnAt} is null or ${table.withdrawnAt} >= ${table.givenAt})`,
    ),
    // Aynı veri sahibi + amaç + karar için tek etkin (geri çekilmemiş, arşivlenmemiş) satır.
    uniqueIndex('consents_subject_purpose_decision_key')
      .on(table.institutionId, table.subjectKind, table.subjectId, table.purpose, table.decision)
      .where(sql`${table.withdrawnAt} is null and ${table.archivedAt} is null`),
    // Veri sahibinin geçmişi ve başvurusu (guvenlik-kvkk §11).
    index('consents_subject_idx').on(
      table.institutionId,
      table.subjectKind,
      table.subjectId,
      table.purpose,
    ),
    // Kullanıcının verdiği rızalar (veli ekranı).
    index('consents_granted_by_idx').on(table.institutionId, table.grantedByUserId),
    index('consents_text_idx').on(table.institutionId, table.textId),
  ],
)
