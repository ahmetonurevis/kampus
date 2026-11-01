import { sql } from 'drizzle-orm'
import { check, date, integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

/**
 * Öğrenci kimlik verisi (ADR 0006 karar 9; DOM-KAY-011, DOM-KAY-012). `records`'a yazılmaz: genel
 * koleksiyon okuması bu alanlara hiç ulaşmaz. Aynı kişi aynı yılda ikinci aktif kayıt alamaz.
 * `student_id` `records` kimliğidir, yabancı anahtar değildir.
 */
export const studentIdentities = pgTable(
  'student_identities',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    studentId: text('student_id').notNull(),
    academicYear: integer('academic_year').notNull(),
    identityKind: text('identity_kind').notNull(),
    // kvkk: Ç
    identityNumber: text('identity_number').notNull(),
    // kvkk: Ç
    birthDate: date('birth_date').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'student_identities_pkey',
      columns: [table.institutionId, table.studentId],
    }),
    check('student_identities_kind_check', oneOf(table.identityKind, ['tc', 'foreign'])),
    uniqueIndex('student_identities_number_key')
      .on(table.institutionId, table.academicYear, table.identityNumber)
      .where(sql`${table.archivedAt} is null`),
  ],
)
