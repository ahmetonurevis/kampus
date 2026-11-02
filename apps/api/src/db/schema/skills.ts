import { sql, type SQL } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

import { GRADE_TYPES, type GradeType } from '@kampus/school-core/lib/grades.ts'
import {
  TARGET_KINDS,
  type FixedAssignment,
  type TargetKind,
} from '@kampus/school-core/skills/assignment.ts'
import {
  APPEAL_OUTCOMES,
  RATER_ROLES,
  RUBRIC_KINDS,
  RUBRIC_SKILLS,
  RUBRIC_VERSION_STATUSES,
  type AppealOutcome,
  type RaterRole,
  type RubricKind,
  type RubricScoreData,
  type RubricSkill,
  type RubricVersionData,
  type RubricVersionStatus,
} from '@kampus/school-core/skills/rubric.ts'
import {
  ATTEMPT_LIMITS,
  COUNT_POLICIES,
  LATE_ACCEPTANCE_MAX_DAYS,
  TASK_KINDS,
  type Answers,
  type CountPolicy,
  type TaskKind,
} from '@kampus/school-core/skills/scoring.ts'
import {
  submissionSettingsSchema,
  type SubmissionSettings,
} from '@kampus/school-core/skills/submission.ts'

import { institutions } from './auth.ts'
import { keys, oneOf, requiredColumns } from './columns.ts'
import { files } from './files.ts'
import { resources, resourceVersions } from './resources.ts'

/**
 * Beceri görevleri (ADR 0004 karar 4–7; docs/domain/beceri-gelisimi.md DOM-BEC-020…025, 040…046,
 * 060). Kural school-core `skills/*`'tadır; bu tablolar onun satırlarıdır.
 *
 * - Kimlik uygulamada üretilen `uuid`'dir; her yabancı anahtar `(institution_id, …_id)` bileşiktir.
 * - Kursiyer ve hedef kimlikleri (`learner_id`, `target_id`) `records` kayıtlarıdır; veritabanı
 *   yabancı anahtarı yoktur (karar 12), bütünlüğü core kapsam kuralı ve servis sağlar.
 * - Hesaplanan değer saklanmaz (karar 5): otomatik puan, rubrik toplamı, son puan, sayılan deneme,
 *   geç bayrağı, sözcük sayısı. Yalnız kararın kendisi ve not defterine aktarım anındaki puan
 *   (`score_transfers`) saklanır.
 * - Değişmez satırlar (teslim sürümü, rubrik puanı, yeniden teslim isteği, not aktarımı) migration
 *   0013'teki `kampus_reject_immutable_change()` tetikleyicisiyle korunur: her `update`, `delete`
 *   ve `truncate` 55000 ile reddedilir. Tek istisna imha işidir: transaction'da
 *   `set local kampus.allow_immutable_purge = 'on'` verilince yalnız `delete` geçer. Tetikleyiciyi
 *   Drizzle şeması izlemez (elle SQL); `<tablo>_version_check` yalnız eklenen satırı sınırlar.
 * - Kullanılmış rubrik sürümü atama ve puan satırlarının `on delete restrict` yabancı anahtarıyla
 *   korunur; yalnız arşivlenir (DOM-BEC-022).
 * - Tablolar yeni ve boştur; kısıtlar `not valid` adımına gerek olmadan tek adımda eklenir.
 *
 * - Dinleme hakkı `attempt_media_plays` satırlarıyla sayılır (migration 0030, OG-049).
 *
 * TODO(F3c2-files): teslim sürümünün `files` bağlantıları (el yazısı ve konuşma kaydı) ileri
 * migration'da eklenir. O zamana kadar yalnız metin teslimi saklanabilir.
 */

const required = requiredColumns

/** Teslim türleri core `submissionSettingsSchema` seçeneklerinden türetilir (`text`, `file`, `audio`). */
const SUBMISSION_KINDS = submissionSettingsSchema.options.map(
  (option) => option.shape.submissionKind.value,
)

/**
 * TODO(core-scoring-modes): core'da puanlama kipi sabiti yok; değerler `scoringModeFor` dönüş
 * tipindedir (`FixedAssignment['scoringMode']`). Sabit eklenince buradan türetilir.
 */
const SCORING_MODES = [
  'auto',
  'teacher',
] as const satisfies readonly FixedAssignment['scoringMode'][]

/**
 * Serbest metin sınırları core şemalarıyla aynıdır (`skills/rubric.ts`: başlık 200, genel yorum
 * 5000, itiraz ve karar gerekçesi 2000). Core bunları dışa aktarmadığı için burada sayıdır.
 */
const RUBRIC_TITLE_MAX = 200
const OVERALL_COMMENT_MAX = 5000
const REASON_MAX = 2000

/**
 * Değişmez satır ilk sürümüyle ve arşivsiz eklenir. Kısıt yalnız eklemede anlamlıdır; sonraki her
 * `update`/`delete` tetikleyiciyle reddedilir (`kampus_reject_immutable_change`, migration 0013).
 */
function firstVersion(table: { version: AnyPgColumn; archivedAt: AnyPgColumn }): SQL {
  return sql`${table.version} = 1 and ${table.archivedAt} is null`
}

/** Rubrik (karar 7). Başlık ve kriterler sürümdedir; rubrik kurumundur (IST-048). */
export const rubrics = pgTable(
  'rubrics',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K
    ownerUserId: text('owner_user_id').notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'rubrics_pkey', columns: [table.institutionId, table.id] }),
    // "Benim rubriklerim" süzgeci ve sahiplik (`canManageRubric`).
    index('rubrics_owner_idx').on(table.institutionId, table.ownerUserId),
  ],
)

/**
 * Rubrik sürümü (karar 7; DOM-BEC-020, 022). `archived_at` core `archivedAt`'tır: arşivli sürüm
 * sabitlendiği atamada puanlanmaya devam eder, sorgular onu varsayılan olarak dışlamaz. Taslak
 * içerik kolonları yalnız taslakken ve kullanılmamışken değişir; servis reddeder.
 */
export const rubricVersions = pgTable(
  'rubric_versions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    rubricId: uuid('rubric_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    status: text('status').$type<RubricVersionStatus>().notNull(),
    title: text('title').notNull(),
    kind: text('kind').$type<RubricKind>().notNull(),
    skill: text('skill').$type<RubricSkill>().notNull(),
    /** Core `rubricVersionInputSchema` çıktısı: kriter × bant, ağırlık, tanımlayıcı eşlemesi. */
    criteria: jsonb('criteria').$type<RubricVersionData['criteria']>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'rubric_versions_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'rubric_versions_rubric_fkey',
      columns: [table.institutionId, table.rubricId],
      foreignColumns: [rubrics.institutionId, rubrics.id],
    }),
    check('rubric_versions_status_check', oneOf(table.status, keys(RUBRIC_VERSION_STATUSES))),
    check('rubric_versions_kind_check', oneOf(table.kind, keys(RUBRIC_KINDS))),
    check('rubric_versions_skill_check', oneOf(table.skill, RUBRIC_SKILLS)),
    check('rubric_versions_number_check', sql`${table.versionNumber} >= 1`),
    check(
      'rubric_versions_title_check',
      sql`char_length(${table.title}) <= ${sql.raw(String(RUBRIC_TITLE_MAX))}`,
    ),
    check(
      'rubric_versions_criteria_check',
      sql`jsonb_typeof(${table.criteria}) = 'array' and jsonb_array_length(${table.criteria}) between 1 and 10`,
    ),
    // Taslak yayımlanmamıştır; yayındaki sürüm arşivli değildir; arşiv yalnız yayımlanmış sürümdendir.
    check(
      'rubric_versions_published_check',
      sql`(${table.status} = 'draft') = (${table.publishedAt} is null)
        and (${table.status} <> 'published' or ${table.archivedAt} is null)
        and (${table.status} <> 'archived' or ${table.archivedAt} is not null)`,
    ),
    // Sürüm numarası rubrikte tekildir; rubrik yabancı anahtarının indeksidir.
    uniqueIndex('rubric_versions_rubric_number_key').on(
      table.institutionId,
      table.rubricId,
      table.versionNumber,
    ),
    // Rubrik başına tek açık taslak (`planNewRubricVersion`) ve tek yayındaki sürüm
    // (`planRubricPublish` öncekini aynı işlemde arşivler).
    uniqueIndex('rubric_versions_draft_key')
      .on(table.institutionId, table.rubricId)
      .where(sql`${table.status} = 'draft' and ${table.archivedAt} is null`),
    uniqueIndex('rubric_versions_published_key')
      .on(table.institutionId, table.rubricId)
      .where(sql`${table.status} = 'published'`),
  ],
)

/**
 * Görev ataması (karar 4; DOM-KYN-032, DOM-BEC-041, 042, 044; IST-034). İçerik, puanlama ve
 * rubrik sürümü ile ayarlar atama anında sabitlenir (core `resolveAssignmentSettings`). Sonradan
 * yalnız son teslim uzar (`planAssignmentChange`) ve puanlama sürümü gerekçeli işlemle değişir
 * (`planRescore`). Deneme ayarı kolonlardır: alıştırmada boş, değerlendirmede dolu.
 */
export const taskAssignments = pgTable(
  'task_assignments',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    resourceId: uuid('resource_id').notNull(),
    resourceVersionId: uuid('resource_version_id').notNull(),
    /** Puanlamanın okunduğu sürüm; başta `resource_version_id`'dir (karar 4). */
    scoringVersionId: uuid('scoring_version_id').notNull(),
    rubricVersionId: uuid('rubric_version_id'),
    scoringMode: text('scoring_mode').$type<FixedAssignment['scoringMode']>().notNull(),
    kind: text('kind').$type<TaskKind>().notNull(),
    maxAttempts: integer('max_attempts'),
    countPolicy: text('count_policy').$type<CountPolicy>(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    lateAcceptanceDays: integer('late_acceptance_days').notNull().default(0),
    timeLimitMinutes: integer('time_limit_minutes'),
    /** Dinleme hakkı; boş: sınırsız veya dinleme görevi değil (DOM-BEC-005). */
    listeningPlays: integer('listening_plays'),
    showTranscript: boolean('show_transcript').notNull().default(false),
    /** Öğretmen puanlı görevin teslim ayarı (core `submissionSettingsSchema`); otomatikte boş. */
    submissionSettings: jsonb('submission_settings').$type<SubmissionSettings>(),
    /** Süzgeç için teslim türü; `submission_settings`'ten türetilir, elle yazılmaz. */
    submissionKind: text('submission_kind')
      .$type<SubmissionSettings['submissionKind']>()
      .generatedAlwaysAs(sql`(submission_settings ->> 'submissionKind')`),
    highStakes: boolean('high_stakes').notNull().default(false),
    secondRatingPercent: integer('second_rating_percent').notNull().default(0),
    /**
     * İkinci puanlama örnekleminin çekildiği an (DOM-BEC-024); boş: çekilmedi. Örneklem teslim
     * penceresi kapanınca bir kez çekilir, karar `second_rating_requests` satırlarıdır; bu kolon
     * yalnız "çekildi" kararıdır (örneklemdeki teslimler elle istenmiş olsa da tekrar çekilmez).
     */
    secondRatingSampledAt: timestamp('second_rating_sampled_at', { withTimezone: true }),
    // kvkk: K
    assignedByUserId: text('assigned_by_user_id').notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'task_assignments_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'task_assignments_resource_fkey',
      columns: [table.institutionId, table.resourceId],
      foreignColumns: [resources.institutionId, resources.id],
    }),
    foreignKey({
      name: 'task_assignments_resource_version_fkey',
      columns: [table.institutionId, table.resourceVersionId],
      foreignColumns: [resourceVersions.institutionId, resourceVersions.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'task_assignments_scoring_version_fkey',
      columns: [table.institutionId, table.scoringVersionId],
      foreignColumns: [resourceVersions.institutionId, resourceVersions.id],
    }).onDelete('restrict'),
    // Kullanılmış rubrik sürümü silinemez (DOM-BEC-022).
    foreignKey({
      name: 'task_assignments_rubric_version_fkey',
      columns: [table.institutionId, table.rubricVersionId],
      foreignColumns: [rubricVersions.institutionId, rubricVersions.id],
    }).onDelete('restrict'),
    check('task_assignments_kind_check', oneOf(table.kind, keys(TASK_KINDS))),
    check('task_assignments_scoring_mode_check', oneOf(table.scoringMode, SCORING_MODES)),
    // `attemptRulesSchema`: alıştırmada hak ve politika yok; değerlendirmede hak 1–3, "en yüksek"
    // yalnız hak 1'den büyükse; öğretmen puanlı değerlendirmede hak 1 ve ilk deneme.
    check(
      'task_assignments_attempts_check',
      sql`(${table.kind} = 'practice') = (${table.maxAttempts} is null)
        and (${table.maxAttempts} is null) = (${table.countPolicy} is null)
        and (${table.maxAttempts} is null or ${table.maxAttempts} between ${sql.raw(String(ATTEMPT_LIMITS.min))} and ${sql.raw(String(ATTEMPT_LIMITS.max))})
        and (${table.countPolicy} is null or ${oneOf(table.countPolicy, keys(COUNT_POLICIES))})
        and (${table.countPolicy} is distinct from 'highest' or ${table.maxAttempts} > 1)
        and (${table.scoringMode} = 'auto' or ${table.maxAttempts} is null
          or (${table.maxAttempts} = 1 and ${table.countPolicy} = 'first'))`,
    ),
    // Değerlendirmede son teslim zorunlu; geç kabul 0–7 gün (DOM-BEC-044).
    check(
      'task_assignments_deadline_check',
      sql`(${table.kind} = 'practice' or ${table.dueAt} is not null)
        and ${table.lateAcceptanceDays} between 0 and ${sql.raw(String(LATE_ACCEPTANCE_MAX_DAYS))}`,
    ),
    check(
      'task_assignments_time_limit_check',
      sql`${table.timeLimitMinutes} is null or ${table.timeLimitMinutes} between 1 and 300`,
    ),
    check(
      'task_assignments_listening_plays_check',
      sql`${table.listeningPlays} is null or ${oneOf(table.listeningPlays, [1, 2])}`,
    ),
    // Değerlendirmede döküm görev kapanmadan gösterilmez (DOM-BEC-005).
    check(
      'task_assignments_transcript_check',
      sql`not (${table.kind} = 'evaluation' and ${table.showTranscript})`,
    ),
    // İkinci puanlama yalnız öğretmen puanlı görevde; yüksek sonuçlu görevde en az %10 (DOM-BEC-024).
    check(
      'task_assignments_second_rating_check',
      sql`${table.secondRatingPercent} between 0 and 100
        and (${table.scoringMode} = 'teacher' or ${table.secondRatingPercent} = 0)
        and not (${table.kind} = 'practice' and ${table.highStakes})
        and (not ${table.highStakes} or ${table.scoringMode} = 'auto' or ${table.secondRatingPercent} >= 10)`,
    ),
    // Otomatik görevde teslim ayarı ve rubrik yok; öğretmen puanlı görevde süre ve dinleme hakkı yok.
    check(
      'task_assignments_mode_check',
      sql`(${table.scoringMode} = 'teacher') = (${table.submissionSettings} is not null)
        and (${table.scoringMode} = 'teacher' or ${table.rubricVersionId} is null)
        and (${table.scoringMode} = 'auto'
          or (${table.timeLimitMinutes} is null and ${table.listeningPlays} is null))`,
    ),
    check(
      'task_assignments_submission_kind_check',
      sql`${table.submissionKind} is null or ${oneOf(table.submissionKind, SUBMISSION_KINDS)}`,
    ),
    // Yabancı anahtar indeksleri; kaynak indeksi aynı içeriğin açık atamalarını da bulur (IST-034).
    index('task_assignments_resource_idx').on(table.institutionId, table.resourceId),
    index('task_assignments_resource_version_idx').on(table.institutionId, table.resourceVersionId),
    index('task_assignments_scoring_version_idx').on(table.institutionId, table.scoringVersionId),
    index('task_assignments_rubric_version_idx')
      .on(table.institutionId, table.rubricVersionId)
      .where(sql`${table.rubricVersionId} is not null`),
    // Öğretmenin kendi atamaları.
    index('task_assignments_assigned_by_idx').on(table.institutionId, table.assignedByUserId),
  ],
)

/**
 * Atama hedefleri (karar 4): sınıf/şube, dil grubu, öğrenci. Kimlikler `records` kayıtlarıdır
 * (karar 12); kapsamı core `resolveTargets` doğrular. Kaldırılan hedef arşivlenir.
 */
export const taskAssignmentTargets = pgTable(
  'task_assignment_targets',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    assignmentId: uuid('assignment_id').notNull(),
    targetKind: text('target_kind').$type<TargetKind>().notNull(),
    // kvkk: K (school-core öğrenci/sınıf kimliği)
    targetId: text('target_id').notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({
      name: 'task_assignment_targets_pkey',
      columns: [table.institutionId, table.assignmentId, table.targetKind, table.targetId],
    }),
    foreignKey({
      name: 'task_assignment_targets_assignment_fkey',
      columns: [table.institutionId, table.assignmentId],
      foreignColumns: [taskAssignments.institutionId, taskAssignments.id],
    }),
    check('task_assignment_targets_kind_check', oneOf(table.targetKind, keys(TARGET_KINDS))),
    // Kursiyerin ve sınıfın görevleri.
    index('task_assignment_targets_target_idx')
      .on(table.institutionId, table.targetKind, table.targetId)
      .where(sql`${table.archivedAt} is null`),
  ],
)

/**
 * Otomatik görevin denemesi (karar 6; DOM-BEC-042, 043). Başlangıç ve teslim sunucu saatidir;
 * süre dolup teslim edilmemiş deneme `submitted_at` boş kalır, durumu core `attemptState`
 * hesaplar. Puan saklanmaz.
 *
 * TODO(F4b-ek-sure): Bireysel ek süre (DOM-BEC-043, `extraTimeSchema`) için tablo ADR 0004'te yok;
 * gerekçeli ek süre ayrı karar ve migration'la gelir. O zamana kadar ek süre 0'dır.
 */
export const taskAttempts = pgTable(
  'task_attempts',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    assignmentId: uuid('assignment_id').notNull(),
    // kvkk: K
    learnerId: text('learner_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    // kvkk: K
    answers: jsonb('answers').$type<Answers>().notNull().default({}),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'task_attempts_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'task_attempts_assignment_fkey',
      columns: [table.institutionId, table.assignmentId],
      foreignColumns: [taskAssignments.institutionId, taskAssignments.id],
    }),
    check('task_attempts_number_check', sql`${table.attemptNumber} >= 1`),
    check(
      'task_attempts_submitted_check',
      sql`${table.submittedAt} is null or ${table.submittedAt} >= ${table.startedAt}`,
    ),
    check('task_attempts_answers_check', sql`jsonb_typeof(${table.answers}) = 'object'`),
    // Deneme numarası kursiyerin atamasında tekildir: eşzamanlı iki başlatmadan biri reddedilir.
    // Atama yabancı anahtarının indeksidir.
    uniqueIndex('task_attempts_assignment_learner_number_key').on(
      table.institutionId,
      table.assignmentId,
      table.learnerId,
      table.attemptNumber,
    ),
    // Birincil anahtarı genişletir; tek amacı not aktarımının sahiplik yabancı anahtarıdır
    // (`score_transfers_source_attempt_fkey`: deneme aynı atama ve kursiyerindir). Kısıttır, indeks
    // değil: drizzle-kit yabancı anahtarları indekslerden önce oluşturur.
    unique('task_attempts_id_assignment_learner_key').on(
      table.institutionId,
      table.id,
      table.assignmentId,
      table.learnerId,
    ),
  ],
)

/** Bir deneme × dosyada sayılabilecek en çok dinleme: core dinleme hakkının üst sınırı (1 veya 2). */
const LISTENING_PLAY_NUMBERS = [1, 2] as const

/**
 * Dinleme hakkı sayımı (ADR 0003 karar 6, ADR 0004 karar 6; DOM-BEC-005, IST-045). Öğrencinin
 * süren denemesinde dinleme kaydının imzalı bağlantısı sayılarak verildiğinde bir satır yazılır
 * (`services/listening-plays.ts`); kalan hak satırlardan sayılır, sayaç kolonu yoktur.
 *
 * - `play_number` deneme × dosya içinde 1'den başlar; tekil indeks eşzamanlı iki yazmadan birini
 *   reddeder, kontrol kısıtı core'un en büyük hakkını (2) aşan satırı reddeder.
 * - `played_at` sunucu saatidir; aynı dinlemenin yeniden bağlantı penceresi buradan hesaplanır.
 * - Satır değişmezdir: migration 0030'daki tetikleyici (`kampus_reject_immutable_change`) her
 *   `update`/`delete`/`truncate`'i reddeder; yalnız imha işi silebilir.
 */
export const attemptMediaPlays = pgTable(
  'attempt_media_plays',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    attemptId: uuid('attempt_id').notNull(),
    fileId: uuid('file_id').notNull(),
    playNumber: integer('play_number').notNull(),
    playedAt: timestamp('played_at', { withTimezone: true }).notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'attempt_media_plays_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'attempt_media_plays_attempt_fkey',
      columns: [table.institutionId, table.attemptId],
      foreignColumns: [taskAttempts.institutionId, taskAttempts.id],
    }),
    foreignKey({
      name: 'attempt_media_plays_file_fkey',
      columns: [table.institutionId, table.fileId],
      foreignColumns: [files.institutionId, files.id],
    }),
    check('attempt_media_plays_play_number_check', oneOf(table.playNumber, LISTENING_PLAY_NUMBERS)),
    check('attempt_media_plays_version_check', firstVersion(table)),
    // Eşzamanlı iki sayımdan biri reddedilir; deneme yabancı anahtarının da indeksidir.
    uniqueIndex('attempt_media_plays_attempt_file_number_key').on(
      table.institutionId,
      table.attemptId,
      table.fileId,
      table.playNumber,
    ),
    // Dosya yabancı anahtarının indeksi.
    index('attempt_media_plays_file_idx').on(table.institutionId, table.fileId),
  ],
)

/**
 * Öğretmen puanlı görevin teslim kaydı (karar 6; DOM-BEC-040): kursiyer × atama başına tek satır.
 * Yeniden teslim isteği `resubmission_requests`'tedir; core `ResubmittableSubmission` alanları son
 * istekten okunur (depo).
 */
export const taskSubmissions = pgTable(
  'task_submissions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    assignmentId: uuid('assignment_id').notNull(),
    // kvkk: K
    learnerId: text('learner_id').notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'task_submissions_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'task_submissions_assignment_fkey',
      columns: [table.institutionId, table.assignmentId],
      foreignColumns: [taskAssignments.institutionId, taskAssignments.id],
    }),
    uniqueIndex('task_submissions_assignment_learner_key').on(
      table.institutionId,
      table.assignmentId,
      table.learnerId,
    ),
  ],
)

/**
 * Değişmez teslim sürümü (karar 6; DOM-BEC-040, 046). Geç bayrağı ve sözcük sayısı saklanmaz.
 * TODO(F3c2-files): dosya ve konuşma kaydı bağlantıları `files` ile gelir.
 */
export const submissionVersions = pgTable(
  'submission_versions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    submissionId: uuid('submission_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    // kvkk: K — kursiyerin metni; loglanmaz
    body: text('body'),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'submission_versions_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'submission_versions_submission_fkey',
      columns: [table.institutionId, table.submissionId],
      foreignColumns: [taskSubmissions.institutionId, taskSubmissions.id],
    }),
    check('submission_versions_number_check', sql`${table.versionNumber} >= 1`),
    check(
      'submission_versions_body_check',
      sql`${table.body} is null or char_length(${table.body}) <= 50000`,
    ),
    check('submission_versions_version_check', firstVersion(table)),
    // Sürüm numarası teslimde tekildir; teslim yabancı anahtarının indeksidir. Kısıt (indeks değil):
    // yeniden teslim isteğinin bileşik yabancı anahtarı ona bağlanır ve migration'da tabloyla
    // birlikte, yabancı anahtarlardan önce oluşur.
    unique('submission_versions_submission_number_key').on(
      table.institutionId,
      table.submissionId,
      table.versionNumber,
    ),
  ],
)

/**
 * Yazma taslağı (karar 6; IST-047): kursiyer × atama başına tek satır, üzerine yazılır. Satır
 * sürümü (`version`) core `DraftRow.revision`'dır; iyimser kilit beklenen sürümle yazılır.
 * Taslak teslim değildir: öğretmen görmez (`canReadDraft`).
 */
export const submissionDrafts = pgTable(
  'submission_drafts',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    assignmentId: uuid('assignment_id').notNull(),
    // kvkk: K
    learnerId: text('learner_id').notNull(),
    // kvkk: K — kursiyerin metni; loglanmaz
    body: text('body').notNull().default(''),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({
      name: 'submission_drafts_pkey',
      columns: [table.institutionId, table.assignmentId, table.learnerId],
    }),
    foreignKey({
      name: 'submission_drafts_assignment_fkey',
      columns: [table.institutionId, table.assignmentId],
      foreignColumns: [taskAssignments.institutionId, taskAssignments.id],
    }),
    check('submission_drafts_body_check', sql`char_length(${table.body}) <= 50000`),
  ],
)

/**
 * Yeniden teslim isteği (ADR 0004 karar 6 eki; DOM-BEC-040): puanlanan sürüm ve kendi son tarihi
 * (`planResubmissionRequest`). Her tur ayrı satırdır; sürüm numarası teslimin var olan sürümüne
 * bileşik yabancı anahtarla bağlıdır. Değişmezdir.
 */
export const resubmissionRequests = pgTable(
  'resubmission_requests',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    submissionId: uuid('submission_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    // kvkk: K
    requestedByUserId: text('requested_by_user_id').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({
      name: 'resubmission_requests_pkey',
      columns: [table.institutionId, table.submissionId, table.versionNumber],
    }),
    foreignKey({
      name: 'resubmission_requests_version_fkey',
      columns: [table.institutionId, table.submissionId, table.versionNumber],
      foreignColumns: [
        submissionVersions.institutionId,
        submissionVersions.submissionId,
        submissionVersions.versionNumber,
      ],
    }),
    check('resubmission_requests_due_check', sql`${table.dueAt} > ${table.requestedAt}`),
    check('resubmission_requests_version_check', firstVersion(table)),
  ],
)

/**
 * Rubrik puanı (karar 6; DOM-BEC-021…025). Puanlanan teslim sürümü ve rubrik sürümü sabitlenir;
 * toplam ve son puan saklanmaz (`rubricScore`, `scoreResolution`). İlk ve ikinci puan sürüm başına
 * birer tanedir; `final` (koordinatör veya itiraz) birden çok olabilir, en yenisi geçerlidir.
 * Değişmezdir: yeni puan eskisinin yerine geçer, eskisi geçmişte kalır.
 */
export const rubricScores = pgTable(
  'rubric_scores',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    submissionVersionId: uuid('submission_version_id').notNull(),
    rubricVersionId: uuid('rubric_version_id').notNull(),
    // kvkk: K
    raterUserId: text('rater_user_id').notNull(),
    raterRole: text('rater_role').$type<RaterRole>().notNull(),
    // kvkk: K — kriter yorumları serbest metin; loglanmaz
    criteria: jsonb('criteria').$type<RubricScoreData['criteria']>().notNull(),
    // kvkk: K — serbest metin; loglanmaz
    overallComment: text('overall_comment').notNull(),
    scoredAt: timestamp('scored_at', { withTimezone: true }).notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'rubric_scores_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'rubric_scores_submission_version_fkey',
      columns: [table.institutionId, table.submissionVersionId],
      foreignColumns: [submissionVersions.institutionId, submissionVersions.id],
    }).onDelete('restrict'),
    // Kullanılmış rubrik sürümü silinemez (DOM-BEC-022).
    foreignKey({
      name: 'rubric_scores_rubric_version_fkey',
      columns: [table.institutionId, table.rubricVersionId],
      foreignColumns: [rubricVersions.institutionId, rubricVersions.id],
    }).onDelete('restrict'),
    check('rubric_scores_rater_role_check', oneOf(table.raterRole, keys(RATER_ROLES))),
    check(
      'rubric_scores_criteria_check',
      sql`jsonb_typeof(${table.criteria}) = 'array' and jsonb_array_length(${table.criteria}) between 1 and 10`,
    ),
    check(
      'rubric_scores_overall_comment_check',
      sql`char_length(${table.overallComment}) <= ${sql.raw(String(OVERALL_COMMENT_MAX))}`,
    ),
    check('rubric_scores_version_check', firstVersion(table)),
    // Teslim sürümünün puanları; yabancı anahtar indeksi.
    index('rubric_scores_submission_version_idx').on(
      table.institutionId,
      table.submissionVersionId,
    ),
    // Sürüm başına tek ilk ve tek ikinci puan (`planRubricScore`; eşzamanlı ikinci yazma reddedilir).
    uniqueIndex('rubric_scores_version_role_key')
      .on(table.institutionId, table.submissionVersionId, table.raterRole)
      .where(sql`${table.raterRole} in ('first', 'second')`),
    // Rubrik sürümünün kullanımı (`RubricUsage`) ve yabancı anahtar indeksi.
    index('rubric_scores_rubric_version_idx').on(table.institutionId, table.rubricVersionId),
  ],
)

export const SECOND_RATING_SOURCES = ['sample', 'manual'] as const
export type SecondRatingSource = (typeof SECOND_RATING_SOURCES)[number]

/**
 * İkinci puanlama isteği (ADR 0004 karar 6 eki; DOM-BEC-024): core `secondRatingRequested`
 * kararının kendisi. `sample`: yüksek sonuçlu görevde `pickSecondRatingSample` örneklemi
 * (istek yapan boş, sistem); `manual`: diğer görevde öğretmenin isteği. Teslim başına bir satır.
 */
export const secondRatingRequests = pgTable(
  'second_rating_requests',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    submissionId: uuid('submission_id').notNull(),
    source: text('source').$type<SecondRatingSource>().notNull(),
    // kvkk: K
    requestedByUserId: text('requested_by_user_id'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({
      name: 'second_rating_requests_pkey',
      columns: [table.institutionId, table.submissionId],
    }),
    foreignKey({
      name: 'second_rating_requests_submission_fkey',
      columns: [table.institutionId, table.submissionId],
      foreignColumns: [taskSubmissions.institutionId, taskSubmissions.id],
    }),
    check('second_rating_requests_source_check', oneOf(table.source, SECOND_RATING_SOURCES)),
    check(
      'second_rating_requests_requester_check',
      sql`(${table.source} = 'manual') = (${table.requestedByUserId} is not null)`,
    ),
  ],
)

/**
 * Sonuç itirazı (ADR 0004 karar 6 eki; DOM-BEC-025). Teslim sürümü başına tek itiraz; karar
 * kolonları birlikte dolar. Kabulde yeni `final` puan `rubric_scores`'a eklenir, ilk puan kalır.
 */
export const scoreAppeals = pgTable(
  'score_appeals',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    submissionVersionId: uuid('submission_version_id').notNull(),
    // kvkk: K
    learnerId: text('learner_id').notNull(),
    // kvkk: K
    filedByUserId: text('filed_by_user_id').notNull(),
    // kvkk: K — serbest metin; loglanmaz
    reason: text('reason').notNull(),
    filedAt: timestamp('filed_at', { withTimezone: true }).notNull(),
    // kvkk: K
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    outcome: text('outcome').$type<AppealOutcome>(),
    // kvkk: K — serbest metin; loglanmaz
    decisionReason: text('decision_reason'),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'score_appeals_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'score_appeals_submission_version_fkey',
      columns: [table.institutionId, table.submissionVersionId],
      foreignColumns: [submissionVersions.institutionId, submissionVersions.id],
    }).onDelete('restrict'),
    check(
      'score_appeals_outcome_check',
      sql`${table.outcome} is null or ${oneOf(table.outcome, keys(APPEAL_OUTCOMES))}`,
    ),
    check(
      'score_appeals_decision_check',
      sql`(${table.outcome} is null) = (${table.decidedAt} is null)
        and (${table.outcome} is null) = (${table.decidedByUserId} is null)
        and (${table.outcome} is null) = (${table.decisionReason} is null)
        and (${table.decidedAt} is null or ${table.decidedAt} >= ${table.filedAt})`,
    ),
    check(
      'score_appeals_reason_check',
      sql`char_length(${table.reason}) <= ${sql.raw(String(REASON_MAX))}`,
    ),
    check(
      'score_appeals_decision_reason_check',
      sql`${table.decisionReason} is null or char_length(${table.decisionReason}) <= ${sql.raw(String(REASON_MAX))}`,
    ),
    // Sürüm başına tek itiraz (`planAppeal`); yabancı anahtar indeksi.
    uniqueIndex('score_appeals_submission_version_key').on(
      table.institutionId,
      table.submissionVersionId,
    ),
  ],
)

export const SCORE_TRANSFER_GRADE_TYPES = GRADE_TYPES.filter(
  (type): type is Exclude<GradeType, 'katilim'> => type !== 'katilim',
)

/**
 * Not defterine aktarım (karar 5; DOM-BEC-060, DOM-AKD): aktarım anındaki 100'lük puanın kopyası,
 * kararın kendisidir ve başka hesabın girdisi olmaz. Kaynak ya sayılan deneme ya kesinleşmiş rubrik
 * puanıdır. Not kaydı `records` `grades` koleksiyonundadır (yabancı anahtar yok, karar 12).
 * Görev ve kursiyer başına tek satır, değişmez.
 *
 * TODO(F4b-aktarim-duzeltme): Anahtar düzeltmesinden sonra onaylanan fark (DOM-BEC-011) not
 * kaydında gerekçeli düzeltmedir; aktarım kopyası değişmez. Yeni kopya gerekirse ayrı migration.
 */
export const scoreTransfers = pgTable(
  'score_transfers',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    assignmentId: uuid('assignment_id').notNull(),
    // kvkk: K
    learnerId: text('learner_id').notNull(),
    gradeType: text('grade_type').$type<Exclude<GradeType, 'katilim'>>().notNull(),
    // kvkk: K
    score: integer('score').notNull(),
    sourceAttemptId: uuid('source_attempt_id'),
    sourceRubricScoreId: uuid('source_rubric_score_id'),
    /** `records` `grades` kaydının kimliği. */
    gradeRecordId: text('grade_record_id').notNull(),
    // kvkk: K
    transferredByUserId: text('transferred_by_user_id').notNull(),
    transferredAt: timestamp('transferred_at', { withTimezone: true }).notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'score_transfers_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'score_transfers_assignment_fkey',
      columns: [table.institutionId, table.assignmentId],
      foreignColumns: [taskAssignments.institutionId, taskAssignments.id],
    }),
    // Kaynak deneme aynı atamanın ve kursiyerin denemesidir (sahiplik). Kaynak boşken (rubrik
    // puanından aktarım) MATCH SIMPLE gereği denetlenmez. Rubrik puanı kaynağının sahipliğini
    // depo denetler (`insertScoreTransfer`): puan satırında atama ve kursiyer kolonu yoktur.
    foreignKey({
      name: 'score_transfers_source_attempt_fkey',
      columns: [table.institutionId, table.sourceAttemptId, table.assignmentId, table.learnerId],
      foreignColumns: [
        taskAttempts.institutionId,
        taskAttempts.id,
        taskAttempts.assignmentId,
        taskAttempts.learnerId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'score_transfers_source_rubric_score_fkey',
      columns: [table.institutionId, table.sourceRubricScoreId],
      foreignColumns: [rubricScores.institutionId, rubricScores.id],
    }).onDelete('restrict'),
    check('score_transfers_grade_type_check', oneOf(table.gradeType, SCORE_TRANSFER_GRADE_TYPES)),
    check('score_transfers_score_check', sql`${table.score} between 0 and 100`),
    check(
      'score_transfers_source_check',
      sql`(${table.sourceAttemptId} is null) <> (${table.sourceRubricScoreId} is null)`,
    ),
    check('score_transfers_version_check', firstVersion(table)),
    // Görev ve kursiyer başına tek aktarım (DOM-BEC-060); atama yabancı anahtarının indeksi.
    uniqueIndex('score_transfers_assignment_learner_key').on(
      table.institutionId,
      table.assignmentId,
      table.learnerId,
    ),
    index('score_transfers_source_attempt_idx')
      .on(table.institutionId, table.sourceAttemptId, table.assignmentId, table.learnerId)
      .where(sql`${table.sourceAttemptId} is not null`),
    index('score_transfers_source_rubric_score_idx')
      .on(table.institutionId, table.sourceRubricScoreId)
      .where(sql`${table.sourceRubricScoreId} is not null`),
  ],
)

export type RubricRow = typeof rubrics.$inferSelect
export type RubricVersionDbRow = typeof rubricVersions.$inferSelect
export type TaskAssignmentRow = typeof taskAssignments.$inferSelect
export type TaskAttemptRow = typeof taskAttempts.$inferSelect
export type SubmissionVersionDbRow = typeof submissionVersions.$inferSelect
export type RubricScoreDbRow = typeof rubricScores.$inferSelect
export type ScoreAppealRow = typeof scoreAppeals.$inferSelect
export type ScoreTransferRow = typeof scoreTransfers.$inferSelect
