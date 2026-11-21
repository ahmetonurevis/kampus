import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'

import { institutions } from './auth.ts'
import { requiredColumns } from './columns.ts'

/**
 * Kazanım / öğrenme çıktısı kataloğu (ADR 0004 karar 9; docs/domain/kaynak-platformu.md
 * DOM-KYN-011). Kaynak etiketi (`resource_version_outcomes`) `outcome_source` ile hangi tabloya,
 * `outcome_id` ile o tablonun koduna işaret eder. Kural core `content/outcomes.ts`'tedir.
 *
 * - `platform_learning_outcomes` kurumdan bağımsız platform tablosudur (`institution_id` yok, ADR
 *   0004 karar 9): öğretim programı kodları sürümüyle. HTTP'den yazılmaz; platform bakım betiği
 *   (`db/learning-outcomes.ts` `syncPlatformOutcomes`) yazar. Kod platformda tekildir.
 * - `learning_outcomes` kurumun kendi kodlarıdır. Kod kurumda arşivliler dahil tekildir (birincil
 *   anahtar): arşivlenen kod yeniden verilmez, çünkü eski içerik aynı koda bağlı kalır.
 * - Kaynak bağlantısında veritabanı yabancı anahtarı yoktur: kaynak iki tablodan birine işaret eder
 *   ve katalog öncesi serbest girilmiş kodlar korunur. Bütünlük servistedir (yeni seçim katalogda
 *   ve etkin olmalı; `services/learning-outcomes.ts` `assertOutcomesSelectable`).
 */

const gradeCheck = (column: unknown) => sql`${column} between 5 and 12`

export const platformLearningOutcomes = pgTable(
  'platform_learning_outcomes',
  {
    code: text('code').notNull(),
    /** Öğretim programı sürümü (ör. örnek katalog `ornek-2025`). */
    programVersion: text('program_version').notNull(),
    subjectId: text('subject_id').notNull(),
    gradeLevel: integer('grade_level').notNull(),
    name: text('name').notNull(),
    /** Katalog sırası (ders, düzey, ünite); kimlik değildir. */
    position: integer('position').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'platform_learning_outcomes_pkey', columns: [table.code] }),
    check('platform_learning_outcomes_grade_level_check', gradeCheck(table.gradeLevel)),
    check(
      'platform_learning_outcomes_code_check',
      sql`char_length(${table.code}) between 1 and 40`,
    ),
    // Ders ve düzey süzgeci (seçici her açılışta ikisini birlikte verir).
    index('platform_learning_outcomes_subject_grade_idx').on(
      table.subjectId,
      table.gradeLevel,
      table.position,
    ),
  ],
)

export const learningOutcomes = pgTable(
  'learning_outcomes',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    code: text('code').notNull(),
    subjectId: text('subject_id').notNull(),
    gradeLevel: integer('grade_level').notNull(),
    name: text('name').notNull(),
    // kvkk: K — ekleyen kişinin kullanıcı kimliği
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'learning_outcomes_pkey', columns: [table.institutionId, table.code] }),
    check('learning_outcomes_grade_level_check', gradeCheck(table.gradeLevel)),
    check('learning_outcomes_code_check', sql`char_length(${table.code}) between 1 and 40`),
    check('learning_outcomes_name_check', sql`char_length(${table.name}) between 1 and 300`),
    index('learning_outcomes_subject_grade_idx').on(
      table.institutionId,
      table.subjectId,
      table.gradeLevel,
    ),
  ],
)
