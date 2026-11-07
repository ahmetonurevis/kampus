import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  FREEZE_REASONS,
  FREEZE_REJECTION_CATEGORIES,
  FREEZE_STATUSES,
  type FreezeReason,
  type FreezeRejectionCategory,
  type FreezeStatus,
} from '@kampus/school-core/lib/enrollment-freezes.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

/**
 * Kayıt dondurma (docs/domain/dil-okulu.md DOM-DIL-052; kayit-ve-crm.md DOM-KAY-024, -026; IST-084;
 * kural core `lib/enrollment-freezes.ts`). Talep, karar, etki ve dönüş tek satırdır.
 *
 * - `student_id` `records` kimliğidir, yabancı anahtar değildir (`student_withdrawals` gibi).
 * - `started_at` etkinin doğduğu andır; onay ileri tarihliyse günlük iş yazar. Kayıt durumu öğrencinin
 *   `frozenAt` bayrağından türetilir (DOM-KAY-026); bayrak bu sütunla aynı transaction'da yazılır.
 * - Serbest metin kolonu yoktur (K-20, KVKK m.6): neden yalnız kategoridir, sağlık nedeni `documented`
 *   altında kalır; karar ve belge için de yazılacak metin alanı bulunmaz. Ret nedeni kapalı listedir
 *   (`rejection_category`, K-29), yalnız reddedilen kayıtta doludur.
 * - Belgenin kendisi ve tanımı tutulmaz (kural yalnız alındı beyanı ister): `document_received`.
 * - Aşama (`scheduled`, `frozen`, `overdue`) saklanmaz, durumdan ve tarihlerden türetilir.
 * - Kursiyerin tek açık kaydı olur: tekil kısmi indeks, eşzamanlı talebin son savunmasıdır.
 */
export const enrollmentFreezes = pgTable(
  'enrollment_freezes',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K
    studentId: text('student_id').notNull(),
    status: text('status').$type<FreezeStatus>().notNull(),
    // kvkk: Ç (askerlik gibi kişisel durum; sağlık ayrıntısı taşımaz, K-20)
    reason: text('reason').$type<FreezeReason>().notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    /** Planlanan dönüş; kursiyer kendiliğinden dönmez. */
    returnDate: date('return_date', { mode: 'string' }).notNull(),
    /** Gerçek bitiş: dönüş ya da ayrılış günü. */
    endedDate: date('ended_date', { mode: 'string' }),
    midCourse: boolean('mid_course').notNull().default(false),
    documentReceived: boolean('document_received').notNull().default(false),
    // kvkk: K
    requestedByUserId: text('requested_by_user_id').notNull(),
    // kvkk: K
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // kvkk: Ç (reşit olmayan kursiyerin kayıt kararı; sağlık ayrıntısı taşımaz, K-20)
    rejectionCategory: text('rejection_category').$type<FreezeRejectionCategory>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    /** Dönüşte eski grup uygun değildi; kursiyer yeniden yerleştirilir. */
    needsPlacement: boolean('needs_placement').notNull().default(false),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'enrollment_freezes_pkey', columns: [table.institutionId, table.id] }),
    check('enrollment_freezes_status_check', oneOf(table.status, FREEZE_STATUSES)),
    check('enrollment_freezes_reason_check', oneOf(table.reason, FREEZE_REASONS)),
    check(
      'enrollment_freezes_rejection_category_check',
      oneOf(table.rejectionCategory, FREEZE_REJECTION_CATEGORIES),
    ),
    // Ret nedeni zorunludur ve yalnız reddedilen kayıtta bulunur (K-29).
    check(
      'enrollment_freezes_rejection_check',
      sql`(${table.rejectionCategory} is not null) = (${table.status} = 'rejected')`,
    ),
    check('enrollment_freezes_dates_check', sql`${table.returnDate} > ${table.startDate}`),
    // Kur ortası dondurma yalnız belgeli nedenle olur (DOM-DIL-052).
    check(
      'enrollment_freezes_document_check',
      sql`not ${table.midCourse} or ${table.documentReceived}`,
    ),
    // Karar alanları birlikte bulunur; karara bağlanmamış talep `requested` ya da `cancelled`'dır.
    check(
      'enrollment_freezes_decision_check',
      sql`(${table.decidedAt} is null) = (${table.decidedByUserId} is null)
        and (${table.decidedAt} is null) = (${table.status} in ('requested', 'cancelled'))`,
    ),
    check(
      'enrollment_freezes_lifecycle_check',
      sql`(${table.endedDate} is not null) = (${table.status} = 'ended')
        and (${table.startedAt} is null or ${table.status} in ('approved', 'ended'))`,
    ),
    uniqueIndex('enrollment_freezes_open_key')
      .on(table.institutionId, table.studentId)
      .where(sql`${table.status} in ('requested', 'approved') and ${table.archivedAt} is null`),
    index('enrollment_freezes_student_idx').on(table.institutionId, table.studentId),
    index('enrollment_freezes_created_idx').on(table.institutionId, table.createdAt),
    // Günlük işin taraması: onaylanmış, etkisi doğmamış ve başlangıcı gelmiş kayıtlar.
    index('enrollment_freezes_due_idx')
      .on(table.institutionId, table.startDate)
      .where(sql`${table.status} = 'approved' and ${table.startedAt} is null`),
  ],
)
