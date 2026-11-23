import { sql, type SQL } from 'drizzle-orm'
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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

import { CEFR_LEVELS, type CefrLevel } from '@kampus/school-core/content/taxonomy.ts'
import {
  COURSE_DESCRIPTION_MAX,
  COURSE_EOZEL_APPROVALS,
  COURSE_GROUP_CAPACITY_MAX,
  COURSE_LANGUAGES,
  COURSE_NAME_MAX,
  COURSE_PROGRAM_CODE_MAX,
  COURSE_SESSION_MINUTES,
  COURSE_SKILL_FOCUS,
  COURSE_STATUSES,
  COURSE_TOTAL_HOURS_MAX,
  COURSE_WEEKLY_HOURS_MAX,
  type CourseEOzelApproval,
  type CourseLanguage,
  type CourseSessionMinutes,
  type CourseSkillFocus,
  type CourseStatus,
} from '@kampus/school-core/lib/courses.ts'

import { institutions } from './auth.ts'
import { keys, oneOf, requiredColumns } from './columns.ts'

const between = (column: AnyPgColumn | SQL, min: number, max: number) =>
  sql`${column} between ${sql.raw(String(min))} and ${sql.raw(String(max))}`

/** Sabit sözlükten `text[]` alt küme denetimi; değerler kodun kendisidir (`oneOf` gibi). */
function subsetOf(column: AnyPgColumn, values: readonly string[]) {
  for (const value of values)
    if (!/^[a-z_]+$/.test(value)) throw new Error(`invalid check value: ${value}`)
  return sql`${column} <@ array[${sql.raw(values.map((value) => `'${value}'`).join(', '))}]::text[]`
}

/**
 * Dil okulu kur programı (IST-076; docs/domain/dil-okulu.md DOM-DIL-005…007; kural core
 * `lib/courses.ts`). Kur kurumun öğretim programıdır; tarih, öğretmen, derslik (grup, OG-029) ve
 * fiyat (paket, ON-058) bu tabloda yoktur. Süre (hafta) hesaplanır, saklanmaz.
 *
 * Arşiv kurun son durumudur ve satır arşividir: `status = 'archived'` ile `archived_at` birlikte
 * yazılır. Ad ve e-Özel program kodu arşivlenmemiş kurlarda tekildir; anahtarlar core'dan
 * türetilir (`courseNameKey`, `courseProgramKey`), `lower()` yerel ayara bağlı olduğundan
 * kullanılmaz. Sonraki kur bağı aynı kurumun kuruna bileşik yabancı anahtardır; döngü, dil ve
 * seviye kuralı core'da kurum kilidi altında denetlenir.
 */
export const courses = pgTable(
  'courses',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    /** Ad tekilliği anahtarı: core `courseNameKey(name)`. */
    nameKey: text('name_key').notNull(),
    language: text('language').$type<CourseLanguage>().notNull(),
    level: text('level').$type<CefrLevel>().notNull(),
    skillFocus: text('skill_focus')
      .array()
      .$type<CourseSkillFocus[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    description: text('description'),
    totalHours: integer('total_hours').notNull(),
    weeklyHours: integer('weekly_hours').notNull(),
    sessionMinutes: integer('session_minutes').$type<CourseSessionMinutes>().notNull(),
    minLearners: integer('min_learners').notNull(),
    maxLearners: integer('max_learners').notNull(),
    certified: boolean('certified').notNull(),
    nextCourseId: uuid('next_course_id'),
    status: text('status').$type<CourseStatus>().notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    eOzelProgramCode: text('e_ozel_program_code'),
    /** Program kodu tekilliği anahtarı: core `courseProgramKey(code)`. */
    eOzelProgramKey: text('e_ozel_program_key'),
    eOzelApproval: text('e_ozel_approval').$type<CourseEOzelApproval>().notNull(),
    eOzelRecordedAt: timestamp('e_ozel_recorded_at', { withTimezone: true }),
    // kvkk: K
    eOzelRecordedByUserId: text('e_ozel_recorded_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'courses_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'courses_next_course_fkey',
      columns: [table.institutionId, table.nextCourseId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    check('courses_name_check', between(sql`char_length(${table.name})`, 1, COURSE_NAME_MAX)),
    check(
      'courses_description_check',
      sql`${table.description} is null or char_length(${table.description}) <= ${sql.raw(String(COURSE_DESCRIPTION_MAX))}`,
    ),
    check('courses_language_check', oneOf(table.language, keys(COURSE_LANGUAGES))),
    check('courses_level_check', oneOf(table.level, keys(CEFR_LEVELS))),
    check('courses_skill_focus_check', subsetOf(table.skillFocus, COURSE_SKILL_FOCUS)),
    // Saatler, oturum ve mevcut (DOM-DIL-002, -040, -042); 90 dakikalık blokta saatler çifttir.
    check(
      'courses_hours_check',
      sql`${between(table.totalHours, 1, COURSE_TOTAL_HOURS_MAX)}
        and ${between(table.weeklyHours, 1, COURSE_WEEKLY_HOURS_MAX)}
        and ${table.totalHours} >= ${table.weeklyHours}`,
    ),
    check(
      'courses_session_check',
      sql`${oneOf(table.sessionMinutes, COURSE_SESSION_MINUTES)}
        and (${table.sessionMinutes} = 45
          or (${table.weeklyHours} % 2 = 0 and ${table.totalHours} % 2 = 0))`,
    ),
    check(
      'courses_learners_check',
      sql`${table.minLearners} >= 1 and ${table.minLearners} <= ${table.maxLearners}
        and ${table.maxLearners} <= ${sql.raw(String(COURSE_GROUP_CAPACITY_MAX))}`,
    ),
    check('courses_next_course_check', sql`${table.nextCourseId} <> ${table.id}`),
    check('courses_status_check', oneOf(table.status, COURSE_STATUSES)),
    // Yaşam döngüsü (DOM-DIL-005): taslak hiç etkinleşmemiştir; arşiv satır arşividir.
    check(
      'courses_lifecycle_check',
      sql`(${table.status} = 'draft' and ${table.activatedAt} is null and ${table.archivedAt} is null)
        or (${table.status} = 'active' and ${table.activatedAt} is not null and ${table.archivedAt} is null)
        or (${table.status} = 'archived' and ${table.archivedAt} is not null)`,
    ),
    check('courses_e_ozel_approval_check', oneOf(table.eOzelApproval, COURSE_EOZEL_APPROVALS)),
    // e-Özel izi (DOM-DIL-006): işlenmiş kayıtta kod, an ve işaretleyen birlikte bulunur.
    check(
      'courses_e_ozel_check',
      sql`(${table.eOzelProgramCode} is null) = (${table.eOzelProgramKey} is null)
        and (${table.eOzelProgramCode} is null
          or char_length(${table.eOzelProgramCode}) between 1 and ${sql.raw(String(COURSE_PROGRAM_CODE_MAX))})
        and ((${table.eOzelApproval} = 'not_submitted'
            and ${table.eOzelRecordedAt} is null and ${table.eOzelRecordedByUserId} is null)
          or (${table.eOzelApproval} <> 'not_submitted' and ${table.eOzelProgramCode} is not null
            and ${table.eOzelRecordedAt} is not null and ${table.eOzelRecordedByUserId} is not null))`,
    ),
    // Belgeli etkin kur e-Özel'de onaylıdır (DOM-DIL-006).
    check(
      'courses_certified_check',
      sql`not (${table.certified} and ${table.status} = 'active' and ${table.eOzelApproval} <> 'approved')`,
    ),
    uniqueIndex('courses_name_key')
      .on(table.institutionId, table.nameKey)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex('courses_e_ozel_program_key')
      .on(table.institutionId, table.eOzelProgramKey)
      .where(sql`${table.archivedAt} is null and ${table.eOzelProgramKey} is not null`),
    // Sonraki kur yabancı anahtarının indeksi (kurun kime bağlandığı: arşiv denetimi).
    index('courses_next_course_idx').on(table.institutionId, table.nextCourseId),
  ],
)
