import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { AssignmentTarget, FixedAssignment } from '@kampus/school-core/skills/assignment.ts'
import type {
  AppealDraft,
  AppealRow,
  RubricRecord,
  RubricScoreRow,
  RubricUsage,
  RubricVersionData,
  RubricVersionRow,
} from '@kampus/school-core/skills/rubric.ts'
import type { AttemptRow, AttemptRules } from '@kampus/school-core/skills/scoring.ts'
import type { DraftRow, VersionRow } from '@kampus/school-core/skills/submission.ts'

import { AppError, ConflictError, databaseErrorInfo, MESSAGES } from '../errors.ts'
import type { Database } from './client.ts'
import {
  resubmissionRequests,
  rubrics,
  rubricScores,
  rubricVersions,
  scoreAppeals,
  scoreTransfers,
  secondRatingRequests,
  submissionDrafts,
  submissionVersions,
  taskAssignments,
  taskAssignmentTargets,
  taskAttempts,
  taskSubmissions,
  type ScoreTransferRow,
  type SecondRatingSource,
  type TaskAssignmentRow,
} from './schema/skills.ts'

/**
 * Beceri görevi deposu (ADR 0004 karar 4–7; şema `schema/skills.ts`). Her fonksiyonun ilk
 * parametresi `institutionId`'dir ve yalnız servis bağlamından gelir; sorgular ve birleştirmeler
 * onu her zaman süzer. Dönen satırlar school-core `skills/*` satır tipleridir; hesaplanan değer
 * (puan, toplam, geç bayrağı) burada üretilmez.
 *
 * - Yazmalar çağıranın transaction'ında çalışır. Satır sürümü (`version`) her güncellemede bir
 *   artar; iyimser kilit beklenen sürümle yazılır, 0 satır → 409.
 * - Değişmez satırlar (teslim sürümü, rubrik puanı, yeniden teslim isteği, not aktarımı) için
 *   güncelleme ve silme fonksiyonu yoktur; veritabanı tetikleyicisi de her `update`/`delete`'i
 *   reddeder (`kampus_reject_immutable_change`, migration 0013).
 * - Benzersizlik ihlali (eşzamanlı ikinci yazma) core'un çakışma koduyla 409'a çevrilir.
 */

const iso = (value: Date) => value.toISOString()
const isoOrNull = (value: Date | null) => (value === null ? null : value.toISOString())
const dateOrNull = (value: string | null) => (value === null ? null : new Date(value))

/** Benzersizlik ihlalini (23505, verilen kısıt) core'un çakışma koduyla 409'a çevirir. */
async function uniqueAs<T>(
  work: Promise<T>,
  constraint: string,
  code: string,
  message: string,
): Promise<T> {
  try {
    return await work
  } catch (error) {
    const info = databaseErrorInfo(error)
    if (info?.code === '23505' && info.constraint === constraint)
      throw new AppError(409, code, message, { cause: error })
    throw error
  }
}

// --- Rubrik -------------------------------------------------------------------------------

/** Rubrik sürümü ve sistem kolonları. */
export type StoredRubricVersion = RubricVersionRow & { updatedAt: string; rowVersion: number }

type RubricVersionDbRow = typeof rubricVersions.$inferSelect

function toRubricVersion(row: RubricVersionDbRow): StoredRubricVersion {
  return {
    id: row.id,
    rubricId: row.rubricId,
    versionNumber: row.versionNumber,
    status: row.status,
    title: row.title,
    kind: row.kind,
    skill: row.skill,
    criteria: row.criteria,
    createdAt: iso(row.createdAt),
    publishedAt: isoOrNull(row.publishedAt),
    archivedAt: isoOrNull(row.archivedAt),
    updatedAt: iso(row.updatedAt),
    rowVersion: row.version,
  }
}

export async function insertRubric(
  tx: Database,
  institutionId: string,
  rubric: RubricRecord,
  now: Date,
): Promise<void> {
  await tx.insert(rubrics).values({
    institutionId,
    id: rubric.id,
    ownerUserId: rubric.ownerUserId,
    createdAt: now,
    updatedAt: now,
  })
}

/** Yeni sürüm; rubrikte açık taslak varsa (eşzamanlı istek) 409 `open_rubric_version_exists`. */
export function insertRubricVersion(
  tx: Database,
  institutionId: string,
  version: RubricVersionRow,
  now: Date,
): Promise<unknown> {
  return uniqueAs(
    tx.insert(rubricVersions).values({
      institutionId,
      id: version.id,
      rubricId: version.rubricId,
      versionNumber: version.versionNumber,
      status: version.status,
      title: version.title,
      kind: version.kind,
      skill: version.skill,
      criteria: version.criteria,
      publishedAt: dateOrNull(version.publishedAt),
      archivedAt: dateOrNull(version.archivedAt),
      createdAt: new Date(version.createdAt),
      updatedAt: now,
    }),
    'rubric_versions_draft_key',
    'open_rubric_version_exists',
    'Bu rubriğin açık bir taslağı var; önce onu tamamlayın.',
  )
}

/**
 * Taslağın içerik kolonları (`planRubricDraftUpdate`). Yalnız arşivlenmemiş taslak ve beklenen
 * sürümle yazılır: yayımlanmış veya arşivli sürüm değişmez (DOM-BEC-022), 0 satır → 409.
 * Kullanım denetimi (`rubricVersionUsage`) çağıranın işidir.
 */
export async function updateRubricVersionDraft(
  tx: Database,
  institutionId: string,
  versionId: string,
  expectedVersion: number,
  data: RubricVersionData,
  now: Date,
): Promise<void> {
  const updated = await tx
    .update(rubricVersions)
    .set({
      title: data.title,
      kind: data.kind,
      skill: data.skill,
      criteria: data.criteria,
      updatedAt: now,
      version: sql`${rubricVersions.version} + 1`,
    })
    .where(
      and(
        eq(rubricVersions.institutionId, institutionId),
        eq(rubricVersions.id, versionId),
        eq(rubricVersions.version, expectedVersion),
        eq(rubricVersions.status, 'draft'),
        isNull(rubricVersions.archivedAt),
      ),
    )
    .returning({ id: rubricVersions.id })
  if (updated.length === 0) throw new ConflictError()
}

/** Rubriğin bütün sürümleri (arşivli dahil; DOM-BEC-022), numara sırasıyla. */
export async function loadRubricVersions(
  db: Database,
  institutionId: string,
  rubricId: string,
): Promise<StoredRubricVersion[]> {
  const rows = await db
    .select()
    .from(rubricVersions)
    .where(
      and(eq(rubricVersions.institutionId, institutionId), eq(rubricVersions.rubricId, rubricId)),
    )
    .orderBy(asc(rubricVersions.versionNumber))
  return rows.map(toRubricVersion)
}

export async function findRubricVersion(
  db: Database,
  institutionId: string,
  versionId: string,
): Promise<StoredRubricVersion | null> {
  const [row] = await db
    .select()
    .from(rubricVersions)
    .where(and(eq(rubricVersions.institutionId, institutionId), eq(rubricVersions.id, versionId)))
  return row === undefined ? null : toRubricVersion(row)
}

/** Sürümün sabitlendiği atama ve verilmiş puan sayısı (core `RubricUsage`; arşivli atama dahil). */
export async function rubricVersionUsage(
  db: Database,
  institutionId: string,
  versionId: string,
): Promise<RubricUsage> {
  const [assignments] = await db
    .select({ n: count() })
    .from(taskAssignments)
    .where(
      and(
        eq(taskAssignments.institutionId, institutionId),
        eq(taskAssignments.rubricVersionId, versionId),
      ),
    )
  const [scores] = await db
    .select({ n: count() })
    .from(rubricScores)
    .where(
      and(
        eq(rubricScores.institutionId, institutionId),
        eq(rubricScores.rubricVersionId, versionId),
      ),
    )
  return { assignmentCount: assignments?.n ?? 0, scoreCount: scores?.n ?? 0 }
}

// --- Atama --------------------------------------------------------------------------------

/** Atama satırı: core sabitlenmiş ayarları, etkin hedefler ve sistem kolonları. */
export type StoredAssignment = FixedAssignment & {
  id: string
  assignedByUserId: string
  targets: AssignmentTarget[]
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  rowVersion: number
}

function attemptRulesOf(row: TaskAssignmentRow): AttemptRules {
  if (row.kind === 'practice') return { kind: 'practice' }
  return {
    kind: 'evaluation',
    maxAttempts: row.maxAttempts ?? 1,
    countPolicy: row.countPolicy ?? 'first',
  }
}

function toAssignment(row: TaskAssignmentRow, targets: AssignmentTarget[]): StoredAssignment {
  return {
    id: row.id,
    resourceId: row.resourceId,
    resourceVersionId: row.resourceVersionId,
    scoringVersionId: row.scoringVersionId,
    rubricVersionId: row.rubricVersionId,
    scoringMode: row.scoringMode,
    kind: row.kind,
    attempts: attemptRulesOf(row),
    deadline: { dueAt: isoOrNull(row.dueAt), lateAcceptanceDays: row.lateAcceptanceDays },
    timeLimitMinutes: row.timeLimitMinutes,
    listeningPlays:
      row.listeningPlays === 1 || row.listeningPlays === 2 ? row.listeningPlays : null,
    showTranscript: row.showTranscript,
    submission: row.submissionSettings,
    highStakes: row.highStakes,
    secondRatingPercent: row.secondRatingPercent,
    assignedByUserId: row.assignedByUserId,
    targets,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    archivedAt: isoOrNull(row.archivedAt),
    rowVersion: row.version,
  }
}

/** Yeni atama ve hedefleri (core `planAssignment` çıktısı). */
export async function insertAssignment(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    assignedByUserId: string
    assignment: FixedAssignment
    targets: readonly AssignmentTarget[]
  },
  now: Date,
): Promise<void> {
  const { assignment: a } = input
  await tx.insert(taskAssignments).values({
    institutionId,
    id: input.id,
    resourceId: a.resourceId,
    resourceVersionId: a.resourceVersionId,
    scoringVersionId: a.scoringVersionId,
    rubricVersionId: a.rubricVersionId,
    scoringMode: a.scoringMode,
    kind: a.kind,
    maxAttempts: a.attempts.kind === 'evaluation' ? a.attempts.maxAttempts : null,
    countPolicy: a.attempts.kind === 'evaluation' ? a.attempts.countPolicy : null,
    dueAt: dateOrNull(a.deadline.dueAt),
    lateAcceptanceDays: a.deadline.lateAcceptanceDays,
    timeLimitMinutes: a.timeLimitMinutes,
    listeningPlays: a.listeningPlays,
    showTranscript: a.showTranscript,
    submissionSettings: a.submission,
    highStakes: a.highStakes,
    secondRatingPercent: a.secondRatingPercent,
    assignedByUserId: input.assignedByUserId,
    createdAt: now,
    updatedAt: now,
  })
  if (input.targets.length > 0)
    await tx.insert(taskAssignmentTargets).values(
      input.targets.map((target) => ({
        institutionId,
        assignmentId: input.id,
        targetKind: target.kind,
        targetId: target.id,
        createdAt: now,
        updatedAt: now,
      })),
    )
}

async function withTargets(
  db: Database,
  institutionId: string,
  rows: readonly TaskAssignmentRow[],
): Promise<StoredAssignment[]> {
  if (rows.length === 0) return []
  const targets = await db
    .select({
      assignmentId: taskAssignmentTargets.assignmentId,
      kind: taskAssignmentTargets.targetKind,
      id: taskAssignmentTargets.targetId,
    })
    .from(taskAssignmentTargets)
    .where(
      and(
        eq(taskAssignmentTargets.institutionId, institutionId),
        inArray(
          taskAssignmentTargets.assignmentId,
          rows.map((row) => row.id),
        ),
        isNull(taskAssignmentTargets.archivedAt),
      ),
    )
    .orderBy(asc(taskAssignmentTargets.targetKind), asc(taskAssignmentTargets.targetId))
  const byAssignment = new Map<string, AssignmentTarget[]>()
  for (const { assignmentId, kind, id } of targets)
    byAssignment.set(assignmentId, [...(byAssignment.get(assignmentId) ?? []), { kind, id }])
  return rows.map((row) => toAssignment(row, byAssignment.get(row.id) ?? []))
}

/** Atama (arşivli dahil; başka kurumun kimliği `null`). */
export async function findAssignment(
  db: Database,
  institutionId: string,
  assignmentId: string,
): Promise<StoredAssignment | null> {
  const rows = await db
    .select()
    .from(taskAssignments)
    .where(
      and(eq(taskAssignments.institutionId, institutionId), eq(taskAssignments.id, assignmentId)),
    )
  const [stored] = await withTargets(db, institutionId, rows)
  return stored ?? null
}

/**
 * Aynı içeriğin arşivlenmemiş atamaları (core `assertNoOverlappingAssignment` girdisi; IST-034).
 * Kursiyer listesi hedeflerden servisçe çözülür.
 */
export async function loadResourceAssignments(
  db: Database,
  institutionId: string,
  resourceId: string,
): Promise<StoredAssignment[]> {
  const rows = await db
    .select()
    .from(taskAssignments)
    .where(
      and(
        eq(taskAssignments.institutionId, institutionId),
        eq(taskAssignments.resourceId, resourceId),
        isNull(taskAssignments.archivedAt),
      ),
    )
    .orderBy(asc(taskAssignments.createdAt), asc(taskAssignments.id))
  return withTargets(db, institutionId, rows)
}

// --- Deneme -------------------------------------------------------------------------------

export type StoredAttempt = AttemptRow & {
  assignmentId: string
  learnerId: string
  attemptNumber: number
  rowVersion: number
}

/** Yeni deneme (`planAttemptStart`); aynı numara eşzamanlı başlatmada 409 `attempt_in_progress`. */
export function insertAttempt(
  tx: Database,
  institutionId: string,
  attempt: {
    id: string
    assignmentId: string
    learnerId: string
    attemptNumber: number
    startedAt: string
  },
  now: Date,
): Promise<unknown> {
  return uniqueAs(
    tx.insert(taskAttempts).values({
      institutionId,
      id: attempt.id,
      assignmentId: attempt.assignmentId,
      learnerId: attempt.learnerId,
      attemptNumber: attempt.attemptNumber,
      startedAt: new Date(attempt.startedAt),
      createdAt: now,
      updatedAt: now,
    }),
    'task_attempts_assignment_learner_number_key',
    'attempt_in_progress',
    'Süren bir denemeniz var; ona devam edin.',
  )
}

/** Kursiyerin bu atamadaki bütün denemeleri, numara sırasıyla. */
export async function loadAttempts(
  db: Database,
  institutionId: string,
  assignmentId: string,
  learnerId: string,
): Promise<StoredAttempt[]> {
  const rows = await db
    .select()
    .from(taskAttempts)
    .where(
      and(
        eq(taskAttempts.institutionId, institutionId),
        eq(taskAttempts.assignmentId, assignmentId),
        eq(taskAttempts.learnerId, learnerId),
      ),
    )
    .orderBy(asc(taskAttempts.attemptNumber))
  return rows.map((row) => ({
    id: row.id,
    assignmentId: row.assignmentId,
    learnerId: row.learnerId,
    attemptNumber: row.attemptNumber,
    startedAt: iso(row.startedAt),
    submittedAt: isoOrNull(row.submittedAt),
    answers: row.answers,
    rowVersion: row.version,
  }))
}

// --- Teslim -------------------------------------------------------------------------------

/** Teslim kaydı: core `ResubmittableSubmission`; yeniden teslim alanları son istekten okunur. */
export type StoredSubmission = {
  id: string
  assignmentId: string
  learnerId: string
  resubmissionRequestedForVersion: number | null
  resubmissionDueAt: string | null
  rowVersion: number
}

export type ResubmissionRequestRow = {
  versionNumber: number
  dueAt: string
  requestedByUserId: string
  requestedAt: string
}

/** Kursiyerin ilk teslimi; eşzamanlı ikinci açılış 409 `submission_exists` (DOM-BEC-040). */
export function insertSubmission(
  tx: Database,
  institutionId: string,
  submission: { id: string; assignmentId: string; learnerId: string },
  now: Date,
): Promise<unknown> {
  return uniqueAs(
    tx
      .insert(taskSubmissions)
      .values({ institutionId, ...submission, createdAt: now, updatedAt: now }),
    'task_submissions_assignment_learner_key',
    'submission_exists',
    'Bu görev için teslim kaydınız zaten var; sayfayı yenileyin.',
  )
}

/**
 * Değişmez teslim sürümü (`planSubmissionVersion`); aynı numara eşzamanlı gönderimde 409
 * `version_conflict`. Satır yazıldıktan sonra değişmez (tetikleyici).
 */
export function insertSubmissionVersion(
  tx: Database,
  institutionId: string,
  submissionId: string,
  version: VersionRow,
  now: Date,
): Promise<unknown> {
  // TODO(F3c2-files): `version.fileIds` `files` bağlantı tablosuna yazılır; şimdilik dosyalı
  // teslim saklanamaz ve reddedilir.
  if (version.fileIds.length > 0)
    throw new AppError(500, 'internal_error', MESSAGES.internal_error, {
      cause: new Error('submission files are not supported yet'),
    })
  return uniqueAs(
    tx.insert(submissionVersions).values({
      institutionId,
      id: version.id,
      submissionId,
      versionNumber: version.number,
      submittedAt: new Date(version.submittedAt),
      body: version.body,
      createdAt: now,
      updatedAt: now,
    }),
    'submission_versions_submission_number_key',
    'version_conflict',
    MESSAGES.version_conflict,
  )
}

/** Yeniden teslim isteği (`planResubmissionRequest`); aynı sürüm için ikinci istek 409. */
export function insertResubmissionRequest(
  tx: Database,
  institutionId: string,
  submissionId: string,
  request: ResubmissionRequestRow,
  now: Date,
): Promise<unknown> {
  return uniqueAs(
    tx.insert(resubmissionRequests).values({
      institutionId,
      submissionId,
      versionNumber: request.versionNumber,
      dueAt: new Date(request.dueAt),
      requestedByUserId: request.requestedByUserId,
      requestedAt: new Date(request.requestedAt),
      createdAt: now,
      updatedAt: now,
    }),
    'resubmission_requests_pkey',
    'resubmission_exists',
    'Bu sürüm için yeniden teslim zaten istendi.',
  )
}

/**
 * Kursiyerin teslim kaydı, değişmez sürümleri (eskiden yeniye) ve yeniden teslim istekleri; teslim
 * yoksa `null`. Taslak ayrıdır (`loadDraft`).
 */
export async function loadSubmission(
  db: Database,
  institutionId: string,
  assignmentId: string,
  learnerId: string,
): Promise<{
  submission: StoredSubmission
  versions: VersionRow[]
  resubmissions: ResubmissionRequestRow[]
} | null> {
  const [row] = await db
    .select()
    .from(taskSubmissions)
    .where(
      and(
        eq(taskSubmissions.institutionId, institutionId),
        eq(taskSubmissions.assignmentId, assignmentId),
        eq(taskSubmissions.learnerId, learnerId),
      ),
    )
  if (row === undefined) return null
  const versions = await db
    .select()
    .from(submissionVersions)
    .where(
      and(
        eq(submissionVersions.institutionId, institutionId),
        eq(submissionVersions.submissionId, row.id),
      ),
    )
    .orderBy(asc(submissionVersions.versionNumber))
  const requests = await db
    .select()
    .from(resubmissionRequests)
    .where(
      and(
        eq(resubmissionRequests.institutionId, institutionId),
        eq(resubmissionRequests.submissionId, row.id),
      ),
    )
    .orderBy(asc(resubmissionRequests.versionNumber))
  const resubmissions = requests.map((r) => ({
    versionNumber: r.versionNumber,
    dueAt: iso(r.dueAt),
    requestedByUserId: r.requestedByUserId,
    requestedAt: iso(r.requestedAt),
  }))
  const latest = resubmissions.at(-1) ?? null
  return {
    submission: {
      id: row.id,
      assignmentId: row.assignmentId,
      learnerId: row.learnerId,
      resubmissionRequestedForVersion: latest?.versionNumber ?? null,
      resubmissionDueAt: latest?.dueAt ?? null,
      rowVersion: row.version,
    },
    versions: versions.map((v) => ({
      id: v.id,
      number: v.versionNumber,
      submittedAt: iso(v.submittedAt),
      body: v.body,
      fileIds: [],
    })),
    resubmissions,
  }
}

// --- Taslak -------------------------------------------------------------------------------

/** Core `planDraftSave`'in çakışma mesajı (`draft_conflict`). */
const DRAFT_CONFLICT = 'Taslak başka bir pencerede değişti; sayfayı yenileyip devam edin.'

/** Kursiyerin taslağı; satır sürümü core `revision`'dır. */
export async function loadDraft(
  db: Database,
  institutionId: string,
  assignmentId: string,
  learnerId: string,
): Promise<DraftRow | null> {
  const [row] = await db
    .select()
    .from(submissionDrafts)
    .where(
      and(
        eq(submissionDrafts.institutionId, institutionId),
        eq(submissionDrafts.assignmentId, assignmentId),
        eq(submissionDrafts.learnerId, learnerId),
      ),
    )
  return row === undefined
    ? null
    : { learnerId: row.learnerId, body: row.body, revision: row.version, savedAt: iso(row.savedAt) }
}

/**
 * Taslağı iyimser kilitle yazar (IST-047; core `planDraftSave` çıktısı, `revision` = beklenen + 1).
 * Beklenen 0 ise satır yoktur ve eklenir; varsa beklenen sürümle güncellenir. Başka pencerenin
 * yazması kazanırsa 0 satır → 409 `draft_conflict`.
 */
export async function saveDraft(
  tx: Database,
  institutionId: string,
  assignmentId: string,
  draft: DraftRow,
  now: Date,
): Promise<DraftRow> {
  const expected = draft.revision - 1
  const savedAt = new Date(draft.savedAt)
  const written =
    expected === 0
      ? await tx
          .insert(submissionDrafts)
          .values({
            institutionId,
            assignmentId,
            learnerId: draft.learnerId,
            body: draft.body,
            savedAt,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning({ version: submissionDrafts.version })
      : await tx
          .update(submissionDrafts)
          .set({
            body: draft.body,
            savedAt,
            updatedAt: now,
            version: sql`${submissionDrafts.version} + 1`,
          })
          .where(
            and(
              eq(submissionDrafts.institutionId, institutionId),
              eq(submissionDrafts.assignmentId, assignmentId),
              eq(submissionDrafts.learnerId, draft.learnerId),
              eq(submissionDrafts.version, expected),
            ),
          )
          .returning({ version: submissionDrafts.version })
  const [row] = written
  if (row === undefined) throw new AppError(409, 'draft_conflict', DRAFT_CONFLICT)
  return { ...draft, revision: row.version }
}

// --- Puan ---------------------------------------------------------------------------------

/** Rubrik puanı (`planRubricScore`, `planAppealDecision`); sürümde aynı rolde ikinci puan 409. */
export function insertRubricScore(
  tx: Database,
  institutionId: string,
  score: RubricScoreRow,
  now: Date,
): Promise<unknown> {
  return uniqueAs(
    tx.insert(rubricScores).values({
      institutionId,
      id: score.id,
      submissionVersionId: score.submissionVersionId,
      rubricVersionId: score.rubricVersionId,
      raterUserId: score.raterUserId,
      raterRole: score.raterRole,
      criteria: score.criteria,
      overallComment: score.overallComment,
      scoredAt: new Date(score.scoredAt),
      createdAt: now,
      updatedAt: now,
    }),
    'rubric_scores_version_role_key',
    'rubric_score_exists',
    'Bu teslim sürümü bu rolde zaten puanlandı.',
  )
}

/** Teslimin bütün sürümlerinin puanları, puanlama sırasıyla (core `RubricScoreRow`). */
export async function loadSubmissionScores(
  db: Database,
  institutionId: string,
  submissionId: string,
): Promise<RubricScoreRow[]> {
  const rows = await db
    .select({ score: rubricScores })
    .from(rubricScores)
    .innerJoin(
      submissionVersions,
      and(
        eq(submissionVersions.institutionId, rubricScores.institutionId),
        eq(submissionVersions.id, rubricScores.submissionVersionId),
      ),
    )
    .where(
      and(
        eq(rubricScores.institutionId, institutionId),
        eq(submissionVersions.submissionId, submissionId),
      ),
    )
    .orderBy(asc(rubricScores.scoredAt), asc(rubricScores.id))
  return rows.map(({ score }) => ({
    id: score.id,
    submissionVersionId: score.submissionVersionId,
    rubricVersionId: score.rubricVersionId,
    raterUserId: score.raterUserId,
    raterRole: score.raterRole,
    criteria: score.criteria,
    overallComment: score.overallComment,
    scoredAt: iso(score.scoredAt),
  }))
}

/**
 * İkinci puanlama isteği (DOM-BEC-024). Teslim başına bir kez yazılır: örneklem yeniden
 * çekilirse var olan istek korunur. Yazıldıysa `true`.
 */
export async function insertSecondRatingRequest(
  tx: Database,
  institutionId: string,
  request: {
    submissionId: string
    source: SecondRatingSource
    requestedByUserId: string | null
    requestedAt: string
  },
  now: Date,
): Promise<boolean> {
  const inserted = await tx
    .insert(secondRatingRequests)
    .values({
      institutionId,
      submissionId: request.submissionId,
      source: request.source,
      requestedByUserId: request.requestedByUserId,
      requestedAt: new Date(request.requestedAt),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ submissionId: secondRatingRequests.submissionId })
  return inserted.length > 0
}

/** Core `secondRatingRequested`: teslim için arşivlenmemiş ikinci puanlama isteği var mı. */
export async function isSecondRatingRequested(
  db: Database,
  institutionId: string,
  submissionId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(secondRatingRequests)
    .where(
      and(
        eq(secondRatingRequests.institutionId, institutionId),
        eq(secondRatingRequests.submissionId, submissionId),
        isNull(secondRatingRequests.archivedAt),
      ),
    )
  return (row?.n ?? 0) > 0
}

// --- İtiraz -------------------------------------------------------------------------------

/** İtiraz (`planAppeal`); aynı sürüme ikinci itiraz 409 `appeal_exists` (DOM-BEC-025). */
export function insertAppeal(
  tx: Database,
  institutionId: string,
  appeal: AppealDraft & { id: string },
  now: Date,
): Promise<unknown> {
  return uniqueAs(
    tx.insert(scoreAppeals).values({
      institutionId,
      id: appeal.id,
      submissionVersionId: appeal.submissionVersionId,
      learnerId: appeal.learnerId,
      filedByUserId: appeal.filedByUserId,
      reason: appeal.reason,
      filedAt: new Date(appeal.filedAt),
      createdAt: now,
      updatedAt: now,
    }),
    'score_appeals_submission_version_key',
    'appeal_exists',
    'Bu sonuca zaten itiraz edildi.',
  )
}

/** Teslimin bütün sürümlerine yapılmış itirazlar (core `AppealRow`). */
export async function loadAppeals(
  db: Database,
  institutionId: string,
  submissionId: string,
): Promise<(AppealRow & { rowVersion: number })[]> {
  const rows = await db
    .select({ appeal: scoreAppeals })
    .from(scoreAppeals)
    .innerJoin(
      submissionVersions,
      and(
        eq(submissionVersions.institutionId, scoreAppeals.institutionId),
        eq(submissionVersions.id, scoreAppeals.submissionVersionId),
      ),
    )
    .where(
      and(
        eq(scoreAppeals.institutionId, institutionId),
        eq(submissionVersions.submissionId, submissionId),
      ),
    )
    .orderBy(asc(scoreAppeals.filedAt), asc(scoreAppeals.id))
  return rows.map(({ appeal }) => ({
    id: appeal.id,
    submissionVersionId: appeal.submissionVersionId,
    learnerId: appeal.learnerId,
    filedByUserId: appeal.filedByUserId,
    reason: appeal.reason,
    filedAt: iso(appeal.filedAt),
    decidedByUserId: appeal.decidedByUserId,
    decidedAt: isoOrNull(appeal.decidedAt),
    outcome: appeal.outcome,
    decisionReason: appeal.decisionReason,
    rowVersion: appeal.version,
  }))
}

// --- Not aktarımı -------------------------------------------------------------------------

export type StoredScoreTransfer = Omit<
  ScoreTransferRow,
  'institutionId' | 'transferredAt' | 'createdAt' | 'updatedAt' | 'archivedAt' | 'version'
> & { transferredAt: string }

/** Not defterine aktarım (DOM-BEC-060); görev ve kursiyer başına ikinci aktarım 409. */
export function insertScoreTransfer(
  tx: Database,
  institutionId: string,
  transfer: StoredScoreTransfer,
  now: Date,
): Promise<unknown> {
  return uniqueAs(
    tx.insert(scoreTransfers).values({
      institutionId,
      ...transfer,
      transferredAt: new Date(transfer.transferredAt),
      createdAt: now,
      updatedAt: now,
    }),
    'score_transfers_assignment_learner_key',
    'score_transfer_exists',
    'Bu görevin sonucu not olarak zaten aktarıldı.',
  )
}

/**
 * Atamanın aktarımları. Aktarılmış sonuç yeniden puanlamada kendiliğinden değişmez
 * (`RescoreLearner.locked`; DOM-BEC-011).
 */
export async function loadScoreTransfers(
  db: Database,
  institutionId: string,
  assignmentId: string,
): Promise<StoredScoreTransfer[]> {
  const rows = await db
    .select()
    .from(scoreTransfers)
    .where(
      and(
        eq(scoreTransfers.institutionId, institutionId),
        eq(scoreTransfers.assignmentId, assignmentId),
      ),
    )
    .orderBy(asc(scoreTransfers.learnerId))
  return rows.map((row) => ({
    id: row.id,
    assignmentId: row.assignmentId,
    learnerId: row.learnerId,
    gradeType: row.gradeType,
    score: row.score,
    sourceAttemptId: row.sourceAttemptId,
    sourceRubricScoreId: row.sourceRubricScoreId,
    gradeRecordId: row.gradeRecordId,
    transferredByUserId: row.transferredByUserId,
    transferredAt: iso(row.transferredAt),
  }))
}
