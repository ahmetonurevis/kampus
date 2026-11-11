import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  CUSTODY_KINDS,
  GUARDIAN_RELATIONSHIPS,
  type CustodyKind,
  type GuardianRelationship,
} from '@kampus/school-core/lib/guardianship.ts'

import { institutions, memberships } from './auth.ts'
import { keys, oneOf, requiredColumns } from './columns.ts'

/**
 * Veli–öğrenci bağı (IST-019; docs/domain/iletisim-ve-veli.md DOM-ILT-070…075; kural core
 * `lib/guardianship.ts`). Normalleştirme ölçütü 2 ve 5 (veritabani.md §4): tek ödeyici
 * benzersizlik ister, velayet ve kısıt ayrı erişim kuralı taşır. Veli bir veli kaydı (`parent_id`,
 * `records` `parents`) ya da platform hesabıdır (`membership_id`); en az biri doludur. Öğrenci ve
 * veli kaydı `records`'tadır (yabancı anahtar yok). Kaldırma arşivdir.
 *
 * Velayet ve kısıt özel nitelikli değil ama hassastır (Ç): belge ve karar ayrıntısı tutulmaz,
 * `records.data`'ya yazılmaz, denetime yalnız alan adları gider. Migration 0027 doğrulanmış eski
 * hesap bağlarını (`membership_links` `child`) velayetli ve kısıtsız geri doldurur.
 */
export const studentGuardians = pgTable(
  'student_guardians',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K — öğrenci kaydı
    studentId: text('student_id').notNull(),
    // kvkk: K — veli kaydı (`parents`)
    parentId: text('parent_id'),
    // kvkk: K — veli hesabının üyeliği
    membershipId: text('membership_id').references(() => memberships.id, { onDelete: 'cascade' }),
    relationship: text('relationship').$type<GuardianRelationship>().notNull(),
    // kvkk: Ç — velayet durumu
    custody: text('custody').$type<CustodyKind>().notNull(),
    // kvkk: Ç — iletişim kısıtı (koruma kararının yalnız varlığı)
    isContactRestricted: boolean('is_contact_restricted').notNull().default(false),
    isPayer: boolean('is_payer').notNull().default(false),
    isPickupAuthorized: boolean('is_pickup_authorized').notNull().default(false),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'student_guardians_pkey', columns: [table.institutionId, table.id] }),
    check(
      'student_guardians_relationship_check',
      oneOf(table.relationship, keys(GUARDIAN_RELATIONSHIPS)),
    ),
    check('student_guardians_custody_check', oneOf(table.custody, keys(CUSTODY_KINDS))),
    check(
      'student_guardians_identity_check',
      sql`${table.parentId} is not null or ${table.membershipId} is not null`,
    ),
    // Kısıtlı veli velayetli, ödeyici ve teslim alan olamaz (DOM-ILT-074; core ile aynı).
    check(
      'student_guardians_restriction_check',
      sql`not ${table.isContactRestricted} or (${table.custody} = 'none' and not ${table.isPayer} and not ${table.isPickupAuthorized})`,
    ),
    // Öğrencinin en çok bir ödeyicisi (DOM-ILT-074); ikinci ödeyici 23505 → 409
    // `guardian_payer_exists` (unique-constraints.ts).
    uniqueIndex('student_guardians_payer_key')
      .on(table.institutionId, table.studentId)
      .where(sql`${table.isPayer} and ${table.archivedAt} is null`),
    // Aynı veli kaydı ya da hesabı öğrenciye bir kez bağlanır (core `guardian_link_exists`).
    uniqueIndex('student_guardians_student_parent_key')
      .on(table.institutionId, table.studentId, table.parentId)
      .where(sql`${table.parentId} is not null and ${table.archivedAt} is null`),
    uniqueIndex('student_guardians_student_membership_key')
      .on(table.institutionId, table.studentId, table.membershipId)
      .where(sql`${table.membershipId} is not null and ${table.archivedAt} is null`),
    // Öğrencinin bağları (liste, yazma yüklemesi) ve hesabın bağları (rıza, kapsam); ikincisi
    // yabancı anahtar indeksidir.
    index('student_guardians_student_idx').on(table.institutionId, table.studentId),
    index('student_guardians_membership_idx').on(table.institutionId, table.membershipId),
  ],
)
