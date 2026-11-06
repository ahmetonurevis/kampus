import { sql } from 'drizzle-orm'
import {
  check,
  index,
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
 * Yenileme daveti (K-10; DOM-KAY-027, IST-100). Durum saklanmaz: `response` ve öğrencinin o yılki
 * yenileme kaydından türer (core `renewalInvitationStatus`). Öğrenci ve yıl başına tek etkin satır.
 */
export const renewalInvitations = pgTable(
  'renewal_invitations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K
    studentId: text('student_id').notNull(),
    academicYear: integer('academic_year').notNull(),
    // kvkk: K
    invitedByUserId: text('invited_by_user_id').notNull(),
    response: text('response'),
    // kvkk: K — velinin serbest metin notu; loglanmaz, denetime yalnız alan adı düşer.
    responseNote: text('response_note'),
    // kvkk: K
    respondedByUserId: text('responded_by_user_id'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'renewal_invitations_pkey', columns: [table.institutionId, table.id] }),
    check(
      'renewal_invitations_response_check',
      sql`${table.response} is null or ${table.response} in ('will_renew', 'will_not_renew')`,
    ),
    check(
      'renewal_invitations_answer_check',
      sql`(${table.response} is null) = (${table.respondedAt} is null) and (${table.response} is null) = (${table.respondedByUserId} is null) and (${table.responseNote} is null or ${table.response} is not null)`,
    ),
    check(
      'renewal_invitations_note_check',
      sql`${table.responseNote} is null or char_length(${table.responseNote}) <= 280`,
    ),
    uniqueIndex('renewal_invitations_student_year_key')
      .on(table.institutionId, table.studentId, table.academicYear)
      .where(sql`${table.archivedAt} is null`),
    index('renewal_invitations_year_idx').on(table.institutionId, table.academicYear),
  ],
)
