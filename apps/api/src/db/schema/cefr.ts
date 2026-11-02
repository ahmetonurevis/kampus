import { sql, type SQL } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
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

import {
  LEARNER_KINDS,
  PLACEMENT_MODES,
  placementDecisionInputSchema,
  type LearnerKind,
  type PlacementMode,
} from '@kampus/school-core/cefr/placement.ts'
import {
  PROGRESSION_DECISION_STATUSES,
  PROGRESSION_OUTCOMES,
  progressionBasisSchema,
  progressionDecisionInputSchema,
  progressionReviewInputSchema,
  type ProgressionBasis,
  type ProgressionDecisionStatus,
  type ProgressionOutcome,
} from '@kampus/school-core/cefr/progression.ts'
import {
  LEVEL_DECISION_KINDS,
  evidenceSnapshotSchema,
  type EvidenceSnapshot,
  type LevelDecisionKind,
} from '@kampus/school-core/cefr/suggestion.ts'
import {
  CEFR_LEVELS,
  PRIMARY_SKILLS,
  type CefrLevel,
  type PrimarySkill,
} from '@kampus/school-core/content/taxonomy.ts'

import { institutions, memberships } from './auth.ts'
import { keys, oneOf, requiredColumns } from './columns.ts'
import { languageGroupMembers, languageGroups } from './language-groups.ts'
import { records } from './records.ts'
import { resources, resourceVersions } from './resources.ts'

/**
 * Seviye tespiti, CEFR seviye kararları ve kur sonu kararları (ADR 0004 karar 8; IST-058, IST-060,
 * IST-062; docs/domain/dil-okulu.md DOM-DIL-010…012, 070; docs/domain/beceri-gelisimi.md
 * DOM-BEC-030, 034). Kural school-core `cefr/placement.ts`, `cefr/progression.ts` ve
 * `cefr/suggestion.ts`'tedir; bu tablolar onun satırlarıdır (`PlacementSessionRow`,
 * `LevelDecisionRow` + `PlacementDecisionDraft`, `ProgressionDecisionRecord`).
 *
 * - Öneri, geçerlilik, devam oranı ve geçiş koşulları saklanmaz (karar 5); karar satırı yalnız
 *   karar anının kopyasını (`evidence_snapshot`, `basis`) taşır.
 * - Tespit ve seviye kararında kursiyer aynı kurumun `records` kaydıdır: üretilen
 *   `learner_collection` kolonu (`student` → `students`, `prospect` → `prospects`) ile `records
 *   (institution_id, collection, id)` birincil anahtarına bileşik yabancı anahtar (`on delete
 *   restrict`; kayıt silinmez, arşivlenir). Kur sonu kararında kursiyer dil grubu kaydından gelir.
 * - Karar veren ve onaylayan aynı kurumun üyesidir: `(institution_id, …_user_id)` →
 *   `memberships (institution_id, user_id)` tekil indeksi (migration 0001). Karar geçmişi
 *   korunduğundan `on delete restrict`'tir; üyelik bugün uygulamada silinmez.
 * - `level_decisions` geçmiştir: satır değişmez, yeni karar yeni satırdır; güncel seviye beceri
 *   başına en yeni karardır (core `cefrProfileView`). `kampus_reject_immutable_change()`
 *   tetikleyicisi (migration 0013) her `update`/`delete`/`truncate`'i 55000 ile reddeder.
 * - `progression_decisions` öğretmenin önerisiyle `pending` açılır, koordinatör bir kez onaylar ya
 *   da reddeder (`planProgressionReview`); sonuçlanmış satır aynı tetikleyiciyle (`when old.status
 *   <> 'pending'`) değişmez. Açık satırda yalnız inceleme alanları, `updated_at`, `version` ve
 *   `archived_at` değişir; kimlik, bağ, sonuç, gerekçe ve kopya değişikliği ile silme
 *   `kampus_progression_pending_guard()` ile 55000'dir. Düzeltme `corrects_decision_id` ile yeni
 *   satırdır.
 * - Tetikleyiciler Drizzle şemasında izlenmez, migration'a elle yazılır.
 * - Tablolar yeni ve boştur; kısıtlar `not valid` adımı olmadan tek adımda eklenir.
 */

const required = requiredColumns

/** Tespite giren kişinin `records` koleksiyonu (ADR 0004 karar 8: öğrenci veya CRM adayı). */
export const LEARNER_COLLECTIONS = {
  student: 'students',
  prospect: 'prospects',
} as const satisfies Record<LearnerKind, string>

const learnerCollection = sql.raw(
  `case "learner_kind" ${keys(LEARNER_KINDS)
    .map((kind) => `when '${kind}' then '${LEARNER_COLLECTIONS[kind as LearnerKind]}'`)
    .join(' ')} end`,
)

const max = (value: number | null) => {
  if (value === null) throw new Error('core şemasında üst sınır yok')
  return sql.raw(String(value))
}
/** Gerekçe sınırları core gövde şemalarındadır (2.000 karakter). */
const PLACEMENT_RATIONALE_MAX = max(placementDecisionInputSchema.shape.rationale.maxLength)
const PROGRESSION_RATIONALE_MAX = max(progressionDecisionInputSchema.shape.rationale.maxLength)
const REJECTION_REASON_MAX = max(progressionReviewInputSchema.options[1].shape.reason.maxLength)
const SNAPSHOT_VERSION = sql.raw(String(evidenceSnapshotSchema.shape.schemaVersion.value))
const BASIS_VERSION = sql.raw(String(progressionBasisSchema.shape.schemaVersion.value))

const rationaleCheck = (column: AnyPgColumn, limit: SQL) =>
  sql`char_length(btrim(${column})) >= 1 and char_length(${column}) <= ${limit}`

/** Kopya `jsonb` nesnedir ve core şemasının sürümünü taşır; yapı core şemasıyla doğrulanır. */
const snapshotCheck = (column: AnyPgColumn, version: SQL) =>
  sql`jsonb_typeof(${column}) = 'object' and ${column} ->> 'schemaVersion' = '${version}'`

/** Değişmez satır ilk sürümüyle ve arşivsiz eklenir (skills.ts `firstVersion` ile aynı). */
const firstVersion = (table: { version: AnyPgColumn; archivedAt: AnyPgColumn }) =>
  sql`${table.version} = 1 and ${table.archivedAt} is null`

/**
 * Seviye tespit oturumu (DOM-DIL-010…012, IST-058; core `PlacementSessionRow`). Form bölümlü quiz
 * kaynağının sabit sürümüdür: `(institution_id, form_id)` → `resources`, `(institution_id,
 * form_version_id)` → `resource_versions`. Bitiş anı (`completed_at`) sunucu saatidir; 90 günlük
 * geçerlilik ondan hesaplanır, saklanmaz. Kişinin aynı anda tek süren oturumu olur
 * (`placement_in_progress`).
 */
export const placementSessions = pgTable(
  'placement_sessions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    learnerKind: text('learner_kind').$type<LearnerKind>().notNull(),
    // kvkk: K (school-core öğrenci ya da aday kaydı kimliği)
    learnerId: text('learner_id').notNull(),
    /** Yabancı anahtarın koleksiyon parçası; `learner_kind`'dan üretilir. */
    learnerCollection: text('learner_collection').notNull().generatedAlwaysAs(learnerCollection),
    formId: uuid('form_id').notNull(),
    formVersionId: uuid('form_version_id').notNull(),
    mode: text('mode').$type<PlacementMode>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'placement_sessions_pkey', columns: [table.institutionId, table.id] }),
    // Kararın oturumla aynı kişiye ait olması için bileşik yabancı anahtar hedefi. Kısıt (indeks
    // değil): drizzle-kit yabancı anahtarları indekslerden önce oluşturur.
    unique('placement_sessions_learner_key').on(
      table.institutionId,
      table.id,
      table.learnerKind,
      table.learnerId,
    ),
    foreignKey({
      name: 'placement_sessions_learner_fkey',
      columns: [table.institutionId, table.learnerCollection, table.learnerId],
      foreignColumns: [records.institutionId, records.collection, records.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'placement_sessions_form_fkey',
      columns: [table.institutionId, table.formId],
      foreignColumns: [resources.institutionId, resources.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'placement_sessions_form_version_fkey',
      columns: [table.institutionId, table.formVersionId],
      foreignColumns: [resourceVersions.institutionId, resourceVersions.id],
    }).onDelete('restrict'),
    check('placement_sessions_learner_kind_check', oneOf(table.learnerKind, keys(LEARNER_KINDS))),
    check('placement_sessions_mode_check', oneOf(table.mode, keys(PLACEMENT_MODES))),
    check(
      'placement_sessions_completed_check',
      sql`${table.completedAt} is null or ${table.completedAt} >= ${table.startedAt}`,
    ),
    // Kişinin tek süren oturumu (DOM-DIL-012; core `placement_in_progress`).
    uniqueIndex('placement_sessions_in_progress_key')
      .on(table.institutionId, table.learnerKind, table.learnerId)
      .where(sql`${table.completedAt} is null and ${table.archivedAt} is null`),
    // Kişinin oturumları (dönem sayımı, geçerlilik) ve kursiyer yabancı anahtarının indeksi.
    index('placement_sessions_learner_idx').on(
      table.institutionId,
      table.learnerId,
      table.startedAt,
    ),
    index('placement_sessions_form_idx').on(table.institutionId, table.formId),
    index('placement_sessions_form_version_idx').on(table.institutionId, table.formVersionId),
  ],
)

/**
 * Seviye kararı (ADR 0004 karar 8; IST-060; DOM-BEC-034; core `LevelDecisionRow` ve
 * `PlacementDecisionDraft`): profili değiştiren insan kararı. `skill` boşsa genel seviyedir.
 * Yerleştirme kararı (`kind = 'placement'`) tespit oturumuna ve onun kişisine bağlıdır; oturum
 * başına beceri (ve genel) için tek karar olur (`placement_already_decided`). Değişmezdir.
 */
export const levelDecisions = pgTable(
  'level_decisions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    learnerKind: text('learner_kind').$type<LearnerKind>().notNull(),
    // kvkk: K (school-core öğrenci ya da aday kaydı kimliği)
    learnerId: text('learner_id').notNull(),
    learnerCollection: text('learner_collection').notNull().generatedAlwaysAs(learnerCollection),
    kind: text('kind').$type<LevelDecisionKind>().notNull(),
    placementSessionId: uuid('placement_session_id'),
    skill: text('skill').$type<PrimarySkill>(),
    // kvkk: Ç (kursiyerin ölçme sonucuna dayanan seviyesi; reşit olmayan kursiyer olabilir)
    level: text('level').$type<CefrLevel>().notNull(),
    // kvkk: Ç (kursiyerin ölçme yorumu; reşit olmayan kursiyer olabilir; loglanmaz)
    rationale: text('rationale').notNull(),
    // kvkk: K
    decidedByUserId: text('decided_by_user_id').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    // kvkk: Ç (kanıt kimlikleri, görev adları ve puan yüzdeleri; loglanmaz)
    evidenceSnapshot: jsonb('evidence_snapshot').$type<EvidenceSnapshot>().notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'level_decisions_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'level_decisions_learner_fkey',
      columns: [table.institutionId, table.learnerCollection, table.learnerId],
      foreignColumns: [records.institutionId, records.collection, records.id],
    }).onDelete('restrict'),
    // Oturum aynı kurumun ve aynı kişinin oturumudur.
    foreignKey({
      name: 'level_decisions_placement_session_fkey',
      columns: [table.institutionId, table.placementSessionId, table.learnerKind, table.learnerId],
      foreignColumns: [
        placementSessions.institutionId,
        placementSessions.id,
        placementSessions.learnerKind,
        placementSessions.learnerId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'level_decisions_decided_by_fkey',
      columns: [table.institutionId, table.decidedByUserId],
      foreignColumns: [memberships.institutionId, memberships.userId],
    }).onDelete('restrict'),
    check('level_decisions_learner_kind_check', oneOf(table.learnerKind, keys(LEARNER_KINDS))),
    check('level_decisions_kind_check', oneOf(table.kind, keys(LEVEL_DECISION_KINDS))),
    check(
      'level_decisions_skill_check',
      sql`${table.skill} is null or ${oneOf(table.skill, PRIMARY_SKILLS)}`,
    ),
    check('level_decisions_level_check', oneOf(table.level, keys(CEFR_LEVELS))),
    check(
      'level_decisions_rationale_check',
      rationaleCheck(table.rationale, PLACEMENT_RATIONALE_MAX),
    ),
    // Yerleştirme kararı ve yalnız o, tespit oturumuna bağlıdır (core `PlacementDecisionDraft`).
    check(
      'level_decisions_placement_check',
      sql`(${table.kind} = 'placement') = (${table.placementSessionId} is not null)`,
    ),
    check(
      'level_decisions_evidence_snapshot_check',
      snapshotCheck(table.evidenceSnapshot, SNAPSHOT_VERSION),
    ),
    check('level_decisions_version_check', firstVersion(table)),
    // Oturum başına beceri (genel için `overall`) başına tek yerleştirme kararı.
    uniqueIndex('level_decisions_placement_skill_key')
      .on(table.institutionId, table.placementSessionId, sql`coalesce(${table.skill}, 'overall')`)
      .where(sql`${table.placementSessionId} is not null`),
    // Kursiyerin zaman çizelgesi ve güncel seviyesi; kursiyer yabancı anahtarının indeksi.
    index('level_decisions_learner_idx').on(table.institutionId, table.learnerId, table.decidedAt),
    index('level_decisions_placement_session_idx').on(
      table.institutionId,
      table.placementSessionId,
    ),
    index('level_decisions_decided_by_idx').on(table.institutionId, table.decidedByUserId),
  ],
)

/**
 * Kur sonu kararı (DOM-DIL-070, IST-062; core `ProgressionDecisionRecord`). Kayıt kursiyerin dil
 * grubu kaydıdır (`language_group_members` satırı, OG-029). Kayıt, grup, kursiyer ve kur birbirine
 * bileşik yabancı anahtarla kilitlidir; uyuşmaz kursiyer ya da kur yazılamaz:
 *
 * - `(institution_id, enrollment_id, group_id, learner_id)` → `language_group_members
 *   (institution_id, id, group_id, student_id)`: karar kaydın kendi kursiyerine ve grubuna aittir.
 *   Kursiyerin `records` bağı kayıt satırından gelir (`language_group_members_student_fkey`).
 * - `(institution_id, group_id, course_id)` → `language_groups (institution_id, id, course_id)`:
 *   kur grubun kurudur. Kurun `courses` bağı grup satırından gelir.
 * - Düzeltme `(institution_id, enrollment_id, corrects_decision_id)` ile aynı kaydın kararına
 *   işaret eder.
 *
 * `group_id` ve `course_id` sorgu kolaylığı değil, bu kilidin parçasıdır. `basis` devam ve ölçme
 * kopyası, `evidence_snapshot` seviye önerisinin kopyasıdır. Kayıt başına tek açık (`pending`)
 * karar olur (`progression_pending`).
 */
export const progressionDecisions = pgTable(
  'progression_decisions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    groupId: uuid('group_id').notNull(),
    courseId: uuid('course_id').notNull(),
    // kvkk: K (school-core öğrenci kaydı kimliği)
    learnerId: text('learner_id').notNull(),
    // kvkk: Ç (kursiyerin kur sonucu)
    outcome: text('outcome').$type<ProgressionOutcome>().notNull(),
    status: text('status').$type<ProgressionDecisionStatus>().notNull(),
    // kvkk: Ç (kursiyerin kur sonu değerlendirmesi; reşit olmayan kursiyer olabilir; loglanmaz)
    rationale: text('rationale').notNull(),
    correctsDecisionId: uuid('corrects_decision_id'),
    // kvkk: K
    decidedByUserId: text('decided_by_user_id').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    // kvkk: K
    reviewedByUserId: text('reviewed_by_user_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    // kvkk: Ç (koordinatörün kursiyerin değerlendirmesine ret gerekçesi; loglanmaz)
    rejectionReason: text('rejection_reason'),
    // kvkk: Ç (devam ve beceri puanı kopyası; loglanmaz)
    basis: jsonb('basis').$type<ProgressionBasis>().notNull(),
    // kvkk: Ç (kanıt kimlikleri, görev adları ve puan yüzdeleri; loglanmaz)
    evidenceSnapshot: jsonb('evidence_snapshot').$type<EvidenceSnapshot>().notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'progression_decisions_pkey', columns: [table.institutionId, table.id] }),
    // Düzeltme yabancı anahtarının hedefi: aynı kaydın kararı.
    unique('progression_decisions_enrollment_id_key').on(
      table.institutionId,
      table.enrollmentId,
      table.id,
    ),
    foreignKey({
      name: 'progression_decisions_enrollment_fkey',
      columns: [table.institutionId, table.enrollmentId, table.groupId, table.learnerId],
      foreignColumns: [
        languageGroupMembers.institutionId,
        languageGroupMembers.id,
        languageGroupMembers.groupId,
        languageGroupMembers.studentId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'progression_decisions_group_fkey',
      columns: [table.institutionId, table.groupId, table.courseId],
      foreignColumns: [languageGroups.institutionId, languageGroups.id, languageGroups.courseId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'progression_decisions_corrects_fkey',
      columns: [table.institutionId, table.enrollmentId, table.correctsDecisionId],
      foreignColumns: [table.institutionId, table.enrollmentId, table.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'progression_decisions_decided_by_fkey',
      columns: [table.institutionId, table.decidedByUserId],
      foreignColumns: [memberships.institutionId, memberships.userId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'progression_decisions_reviewed_by_fkey',
      columns: [table.institutionId, table.reviewedByUserId],
      foreignColumns: [memberships.institutionId, memberships.userId],
    }).onDelete('restrict'),
    check('progression_decisions_outcome_check', oneOf(table.outcome, keys(PROGRESSION_OUTCOMES))),
    check(
      'progression_decisions_status_check',
      oneOf(table.status, keys(PROGRESSION_DECISION_STATUSES)),
    ),
    check(
      'progression_decisions_rationale_check',
      rationaleCheck(table.rationale, PROGRESSION_RATIONALE_MAX),
    ),
    // Açık kararda inceleme yok; sonuçlanmış kararda inceleyen ve an var; ret gerekçesi yalnız
    // reddedilmiş kararda ve zorunlu (core `planProgressionReview`).
    check(
      'progression_decisions_review_check',
      sql`(${table.status} = 'pending') = (${table.reviewedByUserId} is null)
        and (${table.reviewedByUserId} is null) = (${table.reviewedAt} is null)
        and (${table.status} = 'rejected') = (${table.rejectionReason} is not null)
        and (${table.rejectionReason} is null
          or ${rationaleCheck(table.rejectionReason, REJECTION_REASON_MAX)})
        and (${table.reviewedAt} is null or ${table.reviewedAt} >= ${table.decidedAt})`,
    ),
    check(
      'progression_decisions_corrects_check',
      sql`${table.correctsDecisionId} is null or ${table.correctsDecisionId} <> ${table.id}`,
    ),
    check('progression_decisions_basis_check', snapshotCheck(table.basis, BASIS_VERSION)),
    check(
      'progression_decisions_evidence_snapshot_check',
      snapshotCheck(table.evidenceSnapshot, SNAPSHOT_VERSION),
    ),
    // Kayıt başına tek açık karar (core `progression_pending`).
    uniqueIndex('progression_decisions_pending_key')
      .on(table.institutionId, table.enrollmentId)
      .where(sql`${table.status} = 'pending' and ${table.archivedAt} is null`),
    // Kaydın kararları (zaman sırası) ve kayıt yabancı anahtarının indeksi.
    index('progression_decisions_enrollment_idx').on(
      table.institutionId,
      table.enrollmentId,
      table.decidedAt,
    ),
    // Grup ve kur yabancı anahtarının indeksi; kurun bütün kararları ayrıca kur indeksinden.
    index('progression_decisions_group_idx').on(table.institutionId, table.groupId, table.courseId),
    index('progression_decisions_course_idx').on(table.institutionId, table.courseId),
    // Kursiyerin geçmişi.
    index('progression_decisions_learner_idx').on(
      table.institutionId,
      table.learnerId,
      table.decidedAt,
    ),
    index('progression_decisions_corrects_idx').on(
      table.institutionId,
      table.enrollmentId,
      table.correctsDecisionId,
    ),
    index('progression_decisions_decided_by_idx').on(table.institutionId, table.decidedByUserId),
    index('progression_decisions_reviewed_by_idx').on(table.institutionId, table.reviewedByUserId),
  ],
)
