import { sql } from 'drizzle-orm'
import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { institutions } from './auth.ts'
import { requiredColumns } from './columns.ts'

/**
 * Acil durum özeti (DOM-FIN-155; ON-165; K-520…K-522). Öğrenci başına bir etkin satır: yöneticinin
 * yazdığı acil eylem metni iki şifreli kolonda durur. `published_*` onaylanmış ve görünen metin,
 * `draft_*` onay bekleyen metin; yayındaki metin düzeltme onaylanana kadar görünmeye devam eder.
 * Metin özel nitelikli sağlık verisidir (AES-256-GCM, kurum anahtarı; değer kurum, satır, tablo,
 * kolon ve öğrenciye bağlı). Sağlık profili (IST-020) buraya kopyalanmaz: onay anındaki profil
 * damgası (sürüm ve güncelleme anı) gözden geçirme işareti için saklanır. Öğrenci kaydı
 * `records`'tadır (yabancı anahtar yok). Kaldırma arşivdir.
 */
export const emergencySummaries = pgTable(
  'emergency_summaries',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: Ç — özetin öğrencisi (öğrenci kaydı)
    studentId: text('student_id').notNull(),
    // kvkk: Ö — onaylanmış acil eylem metni: base64(IV ‖ GCM etiketi ‖ şifreli metin)
    publishedCiphertext: text('published_ciphertext'),
    // Kişisel veri değil: yalnız anahtar sürümü.
    publishedKeyVersion: integer('published_key_version'),
    // kvkk: Ö — onay bekleyen acil eylem metni (şifreli)
    draftCiphertext: text('draft_ciphertext'),
    // Kişisel veri değil: yalnız anahtar sürümü.
    draftKeyVersion: integer('draft_key_version'),
    // Onay anındaki sağlık profili sürümü (kayıt yoksa 1); sağlık değeri taşımaz.
    reviewedProfileVersion: integer('reviewed_profile_version'),
    // Onay anındaki sağlık profili güncelleme anı (kayıt yoksa boş).
    reviewedProfileUpdatedAt: timestamp('reviewed_profile_updated_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    // kvkk: K — son onaylayan kullanıcı
    approvedByUserId: text('approved_by_user_id'),
    // kvkk: K — özeti açan kullanıcı
    createdByUserId: text('created_by_user_id').notNull(),
    // kvkk: K — metni son yazan kullanıcı
    updatedByUserId: text('updated_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'emergency_summaries_pkey', columns: [table.institutionId, table.id] }),
    // Şifreli değer ve anahtar sürümü birlikte; en az bir metin bulunur.
    check(
      'emergency_summaries_texts_check',
      sql`((${table.publishedCiphertext} is null) = (${table.publishedKeyVersion} is null))
        and ((${table.draftCiphertext} is null) = (${table.draftKeyVersion} is null))
        and (${table.publishedCiphertext} is not null or ${table.draftCiphertext} is not null)
        and (${table.publishedKeyVersion} is null or ${table.publishedKeyVersion} > 0)
        and (${table.draftKeyVersion} is null or ${table.draftKeyVersion} > 0)`,
    ),
    // Onay bilgisi yalnız yayındaki metinle birlikte.
    check(
      'emergency_summaries_approval_check',
      sql`((${table.publishedCiphertext} is null) = (${table.approvedAt} is null))
        and ((${table.approvedAt} is null) = (${table.approvedByUserId} is null))
        and ((${table.approvedAt} is null) = (${table.reviewedProfileVersion} is null))
        and (${table.reviewedProfileVersion} is null or ${table.reviewedProfileVersion} > 0)
        and (${table.approvedAt} is not null or ${table.reviewedProfileUpdatedAt} is null)`,
    ),
    // Öğrenci başına bir etkin özet; okuma ve tekillik bu indeksten.
    uniqueIndex('emergency_summaries_student_key')
      .on(table.institutionId, table.studentId)
      .where(sql`${table.archivedAt} is null`),
  ],
)
