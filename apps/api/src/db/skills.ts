import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  getTableColumns,
  inArray,
  isNull,
  max,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type { AssignmentTarget, FixedAssignment } from '@kampus/school-core/skills/assignment.ts'
import {
  DISAGREEMENT_BAND_GAP,
  GRADING_DAYS,
  type AppealDraft,
  type AppealRow,
  type RubricRecord,
  type RubricScoreRow,
  type RubricUsage,
  type RubricVersionData,
  type RubricVersionRow,
} from '@kampus/school-core/skills/rubric.ts'
import type { Answers, AttemptRow, AttemptRules } from '@kampus/school-core/skills/scoring.ts'
import type { DraftRow, VersionRow } from '@kampus/school-core/skills/submission.ts'

import {
  AppError,
  ConflictError,
  databaseErrorInfo,
  MESSAGES,
  NotFoundError,
  RuleViolationError,
} from '../errors.ts'
import type { Database } from './client.ts'
import { resources, resourceVersions } from './schema/resources.ts'
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
 * - Satırda kolonu olmayan sahiplik bağları (puan kaynağı, puanın rubrik sürümü, itirazın kursiyeri)
 *   yazmadan önce aynı transaction'da denetlenir: kaynak yoksa 404, başkasınınsa 422. Kaynak
 *   satırlar değişmez veya silinemez olduğundan ekleme anındaki denetim kalıcıdır.
 */

const iso = (value: Date) => value.toISOString()
const isoOrNull = (value: Date | null) => (value === null ? null : value.toISOString())
const dateOrNull = (value: string | null) => (value === null ? null : new Date(value))

/** Kısıt adına göre kullanıcı hatası: benzersizlik 409, sahiplik yabancı anahtarı 422. */
type ConstraintErrors = Record<string, { status: 409 | 422; code: string; message: string }>

/**
 * Bilinen benzersizlik (23505) veya yabancı anahtar (23503) ihlalini kısıt adına göre `AppError`'a
 * çevirir; diğer hatalar olduğu gibi geçer (500, ayrıntı yalnız logda).
 */
async function constraintAs<T>(work: Promise<T>, errors: ConstraintErrors): Promise<T> {
  try {
    return await work
  } catch (error) {
    const info = databaseErrorInfo(error)
    const mapped =
      (info?.code === '23505' || info?.code === '23503') && info.constraint !== undefined
        ? errors[info.constraint]
        : undefined
    if (mapped !== undefined)
      throw new AppError(mapped.status, mapped.code, mapped.message, { cause: error })
    throw error
  }
}

const conflict = (code: string, message: string) => ({ status: 409 as const, code, message })

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

/**
 * Yeni sürüm. Eşzamanlı istekte 409: rubrikte açık taslak varsa `open_rubric_version_exists`, sürüm
 * numarası alınmışsa `rubric_version_exists`, ikinci yayındaki sürümde `published_rubric_version_exists`.
 */
export function insertRubricVersion(
  tx: Database,
  institutionId: string,
  version: RubricVersionRow,
  now: Date,
): Promise<unknown> {
  return constraintAs(
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
    {
      rubric_versions_draft_key: conflict(
        'open_rubric_version_exists',
        'Bu rubriğin açık bir taslağı var; önce onu tamamlayın.',
      ),
      rubric_versions_rubric_number_key: conflict(
        'rubric_version_exists',
        'Rubriğin bu sürümü aynı anda başka bir işlemle oluşturuldu. Sayfayı yenileyip yeniden deneyin.',
      ),
      rubric_versions_published_key: conflict(
        'published_rubric_version_exists',
        'Bu rubriğin yayındaki bir sürümü zaten var. Sayfayı yenileyip yeniden deneyin.',
      ),
    },
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

/** Rubrik listesinin süzgeçleri; hepsi baş sürüme (en yüksek numara) uygulanır. */
export interface RubricListQuery {
  page: number
  pageSize: number
  skill?: RubricVersionRow['skill'] | undefined
  kind?: RubricVersionRow['kind'] | undefined
  status?: RubricVersionRow['status'] | undefined
  ownerUserId?: string | undefined
}

export interface RubricListRow {
  rubric: RubricRecord & { createdAt: string }
  /** En yüksek numaralı sürüm (taslak, yayında veya arşiv). */
  head: StoredRubricVersion
  /** Rubriğin yayındaki sürümü; yoksa `null` (atamada yalnız bu kullanılır, DOM-BEC-022). */
  publishedVersionId: string | null
}

/**
 * Kurumun rubrik kütüphanesi (IST-048): rubrik başına baş sürüm, son güncellenen önce. Baş sürüm
 * `rubric_versions_rubric_number_key` indeksiyle rubrik başına tek erişimdir; sayım aynı
 * koşulla ayrı sorgudur. Arşivli rubrik satırı listede yoktur.
 */
export async function listRubrics(
  db: Database,
  institutionId: string,
  query: RubricListQuery,
): Promise<{ rows: RubricListRow[]; total: number }> {
  const v = rubricVersions
  const head = alias(rubricVersions, 'head')
  const filters = [
    eq(rubrics.institutionId, institutionId),
    isNull(rubrics.archivedAt),
    eq(v.institutionId, institutionId),
    eq(v.rubricId, rubrics.id),
    // Ham `sql` içinde takma ad tablo yalnız adıyla yazılır; kaynak tablo açıkça verilir.
    sql`${v.versionNumber} = (select max(${head.versionNumber}) from ${rubricVersions} as ${sql.identifier('head')}
      where ${head.institutionId} = ${rubrics.institutionId} and ${head.rubricId} = ${rubrics.id})`,
    ...(query.skill ? [eq(v.skill, query.skill)] : []),
    ...(query.kind ? [eq(v.kind, query.kind)] : []),
    ...(query.status ? [eq(v.status, query.status)] : []),
    ...(query.ownerUserId ? [eq(rubrics.ownerUserId, query.ownerUserId)] : []),
  ]
  const where = and(...filters)
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: rubrics.id,
        ownerUserId: rubrics.ownerUserId,
        createdAt: rubrics.createdAt,
        head: getTableColumns(rubricVersions),
      })
      .from(rubrics)
      .innerJoin(v, eq(v.institutionId, rubrics.institutionId))
      .where(where)
      .orderBy(desc(v.updatedAt), asc(rubrics.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ total: count() })
      .from(rubrics)
      .innerJoin(v, eq(v.institutionId, rubrics.institutionId))
      .where(where),
  ])
  const rubricIds = rows.map((row) => row.id)
  const published =
    rubricIds.length === 0
      ? []
      : await db
          .select({ rubricId: v.rubricId, id: v.id })
          .from(v)
          .where(
            and(
              eq(v.institutionId, institutionId),
              inArray(v.rubricId, rubricIds),
              eq(v.status, 'published'),
            ),
          )
  const publishedBy = new Map(published.map((row) => [row.rubricId, row.id]))
  return {
    rows: rows.map((row) => ({
      rubric: { id: row.id, ownerUserId: row.ownerUserId, createdAt: iso(row.createdAt) },
      head: toRubricVersion(row.head),
      publishedVersionId: publishedBy.get(row.id) ?? null,
    })),
    total: totals?.total ?? 0,
  }
}

/** Rubrik satırı ve oluşturulma anı; başka kurumun veya arşivli rubrik `null`. */
export async function findRubric(
  db: Database,
  institutionId: string,
  rubricId: string,
): Promise<(RubricRecord & { createdAt: string }) | null> {
  const [row] = await db
    .select({ id: rubrics.id, ownerUserId: rubrics.ownerUserId, createdAt: rubrics.createdAt })
    .from(rubrics)
    .where(
      and(
        eq(rubrics.institutionId, institutionId),
        eq(rubrics.id, rubricId),
        isNull(rubrics.archivedAt),
      ),
    )
  return row === undefined ? null : { ...row, createdAt: iso(row.createdAt) }
}

/** Satır sürümüyle yazılacak rubrik sürümü (iyimser kilit `rowVersion`). */
type LockedRubricVersion = Pick<StoredRubricVersion, 'id' | 'rowVersion'>

/** Yayındaki sürümün arşivi: yalnız `published` ve beklenen satır sürümünde; 0 satır → 409. */
async function archivePublished(
  tx: Database,
  institutionId: string,
  version: LockedRubricVersion,
  archivedAt: Date,
  now: Date,
): Promise<void> {
  const updated = await tx
    .update(rubricVersions)
    .set({
      status: 'archived',
      archivedAt,
      updatedAt: now,
      version: sql`${rubricVersions.version} + 1`,
    })
    .where(
      and(
        eq(rubricVersions.institutionId, institutionId),
        eq(rubricVersions.id, version.id),
        eq(rubricVersions.version, version.rowVersion),
        eq(rubricVersions.status, 'published'),
      ),
    )
    .returning({ id: rubricVersions.id })
  if (updated.length === 0) throw new ConflictError()
}

/**
 * Core `planRubricPublish` kararını yazar (DOM-BEC-022): önce aynı rubriğin yayındaki sürümleri
 * arşivlenir, sonra taslak yayımlanır. Sıra benzersiz indeks içindir: tek yayındaki sürüm
 * (`rubric_versions_published_key`). Her satır yüklendiği sürümle yazılır; eşzamanlı yazma
 * 0 satır görür ve 409 `version_conflict` alır. Arşivlenmesi gereken yayındaki sürüm plana
 * girmemişse indeks yayımı 409 `published_rubric_version_exists` ile reddeder.
 */
export async function applyRubricPublish(
  tx: Database,
  institutionId: string,
  target: LockedRubricVersion,
  versions: readonly LockedRubricVersion[],
  plan: { publishedAt: string; archiveVersionIds: readonly string[] },
  now: Date,
): Promise<void> {
  const publishedAt = new Date(plan.publishedAt)
  for (const id of plan.archiveVersionIds) {
    const previous = versions.find((version) => version.id === id)
    if (previous === undefined) throw new ConflictError()
    await archivePublished(tx, institutionId, previous, publishedAt, now)
  }
  const updated = await constraintAs(
    tx
      .update(rubricVersions)
      .set({
        status: 'published',
        publishedAt,
        updatedAt: now,
        version: sql`${rubricVersions.version} + 1`,
      })
      .where(
        and(
          eq(rubricVersions.institutionId, institutionId),
          eq(rubricVersions.id, target.id),
          eq(rubricVersions.version, target.rowVersion),
          eq(rubricVersions.status, 'draft'),
          isNull(rubricVersions.archivedAt),
        ),
      )
      .returning({ id: rubricVersions.id }),
    {
      rubric_versions_published_key: conflict(
        'published_rubric_version_exists',
        'Bu rubriğin yayındaki bir sürümü zaten var. Sayfayı yenileyip yeniden deneyin.',
      ),
    },
  )
  if (updated.length === 0) throw new ConflictError()
}

/**
 * Core `planRubricArchive` kararını yazar (DOM-BEC-022): yayındaki sürüm arşivlenir; sabitlendiği
 * atamalarda puanlanmaya devam eder. Beklenen satır sürümü tutmazsa 409.
 */
export function applyRubricArchive(
  tx: Database,
  institutionId: string,
  target: LockedRubricVersion,
  plan: { archivedAt: string },
  now: Date,
): Promise<void> {
  return archivePublished(tx, institutionId, target, new Date(plan.archivedAt), now)
}

/**
 * Sürüm başına kullanım (core `RubricUsage`): tek sorguda sabitlendiği atama ve puan sayısı.
 * Listede olmayan sürüm kullanılmamıştır.
 */
export async function rubricUsageByVersion(
  db: Database,
  institutionId: string,
  versionIds: readonly string[],
): Promise<Map<string, RubricUsage>> {
  const usage = new Map<string, RubricUsage>(
    versionIds.map((id) => [id, { assignmentCount: 0, scoreCount: 0 }]),
  )
  if (versionIds.length === 0) return usage
  const [assignments, scores] = await Promise.all([
    db
      .select({ id: taskAssignments.rubricVersionId, n: count() })
      .from(taskAssignments)
      .where(
        and(
          eq(taskAssignments.institutionId, institutionId),
          inArray(taskAssignments.rubricVersionId, [...versionIds]),
        ),
      )
      .groupBy(taskAssignments.rubricVersionId),
    db
      .select({ id: rubricScores.rubricVersionId, n: count() })
      .from(rubricScores)
      .where(
        and(
          eq(rubricScores.institutionId, institutionId),
          inArray(rubricScores.rubricVersionId, [...versionIds]),
        ),
      )
      .groupBy(rubricScores.rubricVersionId),
  ])
  for (const row of assignments) {
    const entry = row.id === null ? undefined : usage.get(row.id)
    if (entry) entry.assignmentCount = row.n
  }
  for (const row of scores) {
    const entry = usage.get(row.id)
    if (entry) entry.scoreCount = row.n
  }
  return usage
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
  /** İkinci puanlama örnekleminin çekildiği an (DOM-BEC-024); boş: çekilmedi. */
  secondRatingSampledAt: string | null
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
    secondRatingSampledAt: isoOrNull(row.secondRatingSampledAt),
    assignedByUserId: row.assignedByUserId,
    targets,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    archivedAt: isoOrNull(row.archivedAt),
    rowVersion: row.version,
  }
}

/** Yeni atama ve hedefleri (core `planAssignment` çıktısı); aynı hedef iki kez 409. */
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
    await constraintAs(
      tx.insert(taskAssignmentTargets).values(
        input.targets.map((target) => ({
          institutionId,
          assignmentId: input.id,
          targetKind: target.kind,
          targetId: target.id,
          createdAt: now,
          updatedAt: now,
        })),
      ),
      {
        task_assignment_targets_pkey: conflict(
          'assignment_target_exists',
          'Aynı hedef atamaya yalnız bir kez eklenebilir.',
        ),
      },
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

/** Atanan içerik sürümünün başlığı ve kaynağın türü (liste ve ayrıntı satırı). */
export type AssignmentContentRef = {
  title: string
  contentType: (typeof resources.$inferSelect)['contentType']
}

/**
 * Sürüm başına başlık ve içerik türü (`resource_versions` + `resources`, kurumla süzülür). Kaldırılan
 * sürümün başlığı kalır (DOM-KYN-051); cevap anahtarı ve içerik okunmaz.
 */
export async function assignmentContentRefs(
  db: Database,
  institutionId: string,
  resourceVersionIds: readonly string[],
): Promise<Map<string, AssignmentContentRef>> {
  const ids = [...new Set(resourceVersionIds)]
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({
      id: resourceVersions.id,
      title: resourceVersions.title,
      contentType: resources.contentType,
    })
    .from(resourceVersions)
    .innerJoin(
      resources,
      and(
        eq(resources.institutionId, resourceVersions.institutionId),
        eq(resources.id, resourceVersions.resourceId),
      ),
    )
    .where(
      and(eq(resourceVersions.institutionId, institutionId), inArray(resourceVersions.id, ids)),
    )
  return new Map(rows.map(({ id, ...ref }) => [id, ref]))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * İçerik sürümünün kaynağı (atama gövdesindeki `resourceVersionId`); yoksa veya başka kurumdaysa
 * `null`. Core kimliği serbest metindir, kolon `uuid`'dir: uuid olmayan kimlik sorguya girmez.
 */
export async function resourceIdOfVersion(
  db: Database,
  institutionId: string,
  versionId: string,
): Promise<string | null> {
  if (!UUID.test(versionId)) return null
  const [row] = await db
    .select({ resourceId: resourceVersions.resourceId })
    .from(resourceVersions)
    .where(
      and(eq(resourceVersions.institutionId, institutionId), eq(resourceVersions.id, versionId)),
    )
  return row?.resourceId ?? null
}

/**
 * Atama listesinin süzgeçleri. Rol kapsamı servisten gelir: `assignedByUserId` öğretmenin kendi
 * atamaları, `learnerTargets` kursiyerin (veya velinin çocuklarının) ya da öğretmenin kapsamındaki
 * sınıf ve öğrencilerin hedeflendiği atamalar. İkisi birlikte verilirse "veya" ile birleşir
 * (öğretmen: kendi ataması veya kapsamındaki hedef; DOM-YTK-028). İkisi de yoksa kurumun bütün
 * atamaları (yönetici).
 */
export interface AssignmentListQuery {
  page: number
  pageSize: number
  assignedByUserId?: string | undefined
  /** Hedef eşleşmesi: öğrenci hedefi `studentIds`'te veya sınıf/grup hedefi `classIds`'te. */
  learnerTargets?: { studentIds: readonly string[]; classIds: readonly string[] } | undefined
  resourceId?: string | undefined
  kind?: FixedAssignment['kind'] | undefined
}

/**
 * Atama listesinin rol kapsamı süzgeci (`assignedByUserId` veya `learnerTargets`, ikisi "veya" ile);
 * ikisi de yoksa `undefined` (yönetici). Atama listesi ve puanlama kuyruğu ortak kullanır.
 */
function assignmentScopeFilter(
  db: Database,
  query: Pick<AssignmentListQuery, 'assignedByUserId' | 'learnerTargets'>,
) {
  const a = taskAssignments
  const t = taskAssignmentTargets
  const learnerFilter = (() => {
    if (query.learnerTargets === undefined) return undefined
    const { studentIds, classIds } = query.learnerTargets
    const matches = [
      ...(studentIds.length > 0
        ? [and(eq(t.targetKind, 'student'), inArray(t.targetId, [...studentIds]))]
        : []),
      ...(classIds.length > 0
        ? [and(inArray(t.targetKind, ['class', 'group']), inArray(t.targetId, [...classIds]))]
        : []),
    ]
    if (matches.length === 0) return sql`false`
    return exists(
      db
        .select({ one: sql`1` })
        .from(t)
        .where(
          and(
            eq(t.institutionId, a.institutionId),
            eq(t.assignmentId, a.id),
            isNull(t.archivedAt),
            or(...matches),
          ),
        ),
    )
  })()
  const ownerFilter =
    query.assignedByUserId === undefined
      ? undefined
      : eq(a.assignedByUserId, query.assignedByUserId)
  return ownerFilter !== undefined && learnerFilter !== undefined
    ? or(ownerFilter, learnerFilter)
    : (ownerFilter ?? learnerFilter)
}

/**
 * Kurumun arşivlenmemiş atamaları, en yeni önce (IST-034). Kursiyer süzgeci arşivlenmemiş hedefler
 * üzerinde `exists` alt sorgusudur (`task_assignment_targets_target_idx`); boş kimlik listesi hiçbir
 * satır vermez. Sayım aynı koşulla ayrı sorgudur.
 */
export async function listAssignments(
  db: Database,
  institutionId: string,
  query: AssignmentListQuery,
): Promise<{ rows: StoredAssignment[]; total: number }> {
  const a = taskAssignments
  const scopeFilter = assignmentScopeFilter(db, query)
  const where = and(
    eq(a.institutionId, institutionId),
    isNull(a.archivedAt),
    ...(scopeFilter === undefined ? [] : [scopeFilter]),
    ...(query.resourceId === undefined ? [] : [eq(a.resourceId, query.resourceId)]),
    ...(query.kind === undefined ? [] : [eq(a.kind, query.kind)]),
  )
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(a)
      .where(where)
      .orderBy(desc(a.createdAt), asc(a.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(a).where(where),
  ])
  return { rows: await withTargets(db, institutionId, rows), total: totals?.total ?? 0 }
}

/**
 * Son teslim değişikliği (core `planAssignmentChange`; DOM-BEC-041, 044): yalnız arşivlenmemiş
 * atamada ve beklenen satır sürümüyle; 0 satır → 409 `version_conflict`. Sabitlenen diğer
 * kolonlar (içerik, puanlama ve rubrik sürümü, deneme ayarı) bu fonksiyonla yazılamaz.
 */
export async function updateAssignmentDeadline(
  tx: Database,
  institutionId: string,
  assignment: Pick<StoredAssignment, 'id' | 'rowVersion'>,
  deadline: FixedAssignment['deadline'],
  now: Date,
): Promise<void> {
  const updated = await tx
    .update(taskAssignments)
    .set({
      dueAt: dateOrNull(deadline.dueAt),
      lateAcceptanceDays: deadline.lateAcceptanceDays,
      updatedAt: now,
      version: sql`${taskAssignments.version} + 1`,
    })
    .where(
      and(
        eq(taskAssignments.institutionId, institutionId),
        eq(taskAssignments.id, assignment.id),
        eq(taskAssignments.version, assignment.rowVersion),
        isNull(taskAssignments.archivedAt),
      ),
    )
    .returning({ id: taskAssignments.id })
  if (updated.length === 0) throw new ConflictError()
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
  return constraintAs(
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
    {
      task_attempts_assignment_learner_number_key: conflict(
        'attempt_in_progress',
        'Süren bir denemeniz var; ona devam edin.',
      ),
    },
  )
}

type TaskAttemptDbRow = typeof taskAttempts.$inferSelect

function toAttempt(row: TaskAttemptDbRow): StoredAttempt {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    learnerId: row.learnerId,
    attemptNumber: row.attemptNumber,
    startedAt: iso(row.startedAt),
    submittedAt: isoOrNull(row.submittedAt),
    answers: row.answers,
    rowVersion: row.version,
  }
}

/** Kursiyerin bu atamadaki arşivlenmemiş denemeleri, numara sırasıyla. */
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
        isNull(taskAttempts.archivedAt),
      ),
    )
    .orderBy(asc(taskAttempts.attemptNumber))
  return rows.map(toAttempt)
}

/** Arşivlenmemiş deneme; yoksa, arşivliyse veya başka kurumdaysa `null`. */
export async function findAttempt(
  db: Database,
  institutionId: string,
  attemptId: string,
): Promise<StoredAttempt | null> {
  if (!UUID.test(attemptId)) return null
  const [row] = await db
    .select()
    .from(taskAttempts)
    .where(
      and(
        eq(taskAttempts.institutionId, institutionId),
        eq(taskAttempts.id, attemptId),
        isNull(taskAttempts.archivedAt),
      ),
    )
  return row === undefined ? null : toAttempt(row)
}

/**
 * Atamanın denemeleri ve teslimlerinin süzgeci. `learnerIds` rol kapsamıdır (servisten): verilmezse
 * atamanın bütün kursiyerleri (yönetici, atamayı gören öğretmen), boş liste hiçbir satır vermez.
 */
export interface LearnerWorkQuery {
  assignmentId: string
  learnerIds?: readonly string[] | undefined
  page: number
  pageSize: number
}

function learnerFilter(column: typeof taskAttempts.learnerId | typeof taskSubmissions.learnerId) {
  return (learnerIds: readonly string[] | undefined) =>
    learnerIds === undefined
      ? undefined
      : learnerIds.length === 0
        ? sql`false`
        : inArray(column, [...learnerIds])
}

/**
 * Atamanın arşivlenmemiş denemeleri, kursiyer ve deneme numarası sırasıyla, sayfalı (DOM-BEC-042).
 * Süzgeç `task_attempts_assignment_learner_number_key` indeksinin önekidir.
 */
export async function listAttempts(
  db: Database,
  institutionId: string,
  query: LearnerWorkQuery,
): Promise<{ rows: StoredAttempt[]; total: number }> {
  const where = and(
    eq(taskAttempts.institutionId, institutionId),
    eq(taskAttempts.assignmentId, query.assignmentId),
    isNull(taskAttempts.archivedAt),
    learnerFilter(taskAttempts.learnerId)(query.learnerIds),
  )
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(taskAttempts)
      .where(where)
      .orderBy(asc(taskAttempts.learnerId), asc(taskAttempts.attemptNumber))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(taskAttempts).where(where),
  ])
  return { rows: rows.map(toAttempt), total: totals?.total ?? 0 }
}

/**
 * Verilen kursiyerlerin bu atamadaki bütün arşivlenmemiş denemeleri. Sayılan deneme
 * (`countedAttempt`) kursiyerin bütün denemelerinden seçildiği için sayfadaki satırlara eklenir.
 */
export async function loadLearnersAttempts(
  db: Database,
  institutionId: string,
  assignmentId: string,
  learnerIds: readonly string[],
): Promise<StoredAttempt[]> {
  if (learnerIds.length === 0) return []
  const rows = await db
    .select()
    .from(taskAttempts)
    .where(
      and(
        eq(taskAttempts.institutionId, institutionId),
        eq(taskAttempts.assignmentId, assignmentId),
        inArray(taskAttempts.learnerId, [...new Set(learnerIds)]),
        isNull(taskAttempts.archivedAt),
      ),
    )
    .orderBy(asc(taskAttempts.learnerId), asc(taskAttempts.attemptNumber))
  return rows.map(toAttempt)
}

/** Yazılacak deneme: kimlik ve okunduğu satır sürümü (iyimser kilit). */
type LockedAttempt = Pick<StoredAttempt, 'id' | 'rowVersion'>

/**
 * Süren denemenin cevapları (`planAnswerSave` çıktısı, bütün küme). Yalnız teslim edilmemiş ve
 * beklenen satır sürümündeki deneme yazılır; 0 satır → 409 `version_conflict`. Teslim edilmiş
 * denemenin cevabı bu fonksiyonla değişmez (DOM-BEC-010: puan cevaplardan hesaplanır). Yeni satır
 * sürümü döner.
 */
export async function saveAttemptAnswers(
  tx: Database,
  institutionId: string,
  attempt: LockedAttempt,
  answers: Answers,
  now: Date,
): Promise<number> {
  const [row] = await tx
    .update(taskAttempts)
    .set({ answers, updatedAt: now, version: sql`${taskAttempts.version} + 1` })
    .where(
      and(
        eq(taskAttempts.institutionId, institutionId),
        eq(taskAttempts.id, attempt.id),
        eq(taskAttempts.version, attempt.rowVersion),
        isNull(taskAttempts.submittedAt),
        isNull(taskAttempts.archivedAt),
      ),
    )
    .returning({ version: taskAttempts.version })
  if (row === undefined) throw new ConflictError()
  return row.version
}

/**
 * Deneme teslimi (`planAttemptSubmit` çıktısı; DOM-BEC-043): cevaplar ve teslim anı birlikte, yalnız
 * teslim edilmemiş ve beklenen satır sürümündeki denemeye yazılır; 0 satır → 409 `version_conflict`.
 * Puan saklanmaz (DOM-BEC-010). Teslimden sonra cevap ve teslim anı bu depoda değişmez.
 */
export async function submitAttempt(
  tx: Database,
  institutionId: string,
  attempt: LockedAttempt,
  plan: { answers: Answers; submittedAt: string },
  now: Date,
): Promise<number> {
  const [row] = await tx
    .update(taskAttempts)
    .set({
      answers: plan.answers,
      submittedAt: new Date(plan.submittedAt),
      updatedAt: now,
      version: sql`${taskAttempts.version} + 1`,
    })
    .where(
      and(
        eq(taskAttempts.institutionId, institutionId),
        eq(taskAttempts.id, attempt.id),
        eq(taskAttempts.version, attempt.rowVersion),
        isNull(taskAttempts.submittedAt),
        isNull(taskAttempts.archivedAt),
      ),
    )
    .returning({ version: taskAttempts.version })
  if (row === undefined) throw new ConflictError()
  return row.version
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
  return constraintAs(
    tx
      .insert(taskSubmissions)
      .values({ institutionId, ...submission, createdAt: now, updatedAt: now }),
    {
      task_submissions_assignment_learner_key: conflict(
        'submission_exists',
        'Bu görev için teslim kaydınız zaten var; sayfayı yenileyin.',
      ),
    },
  )
}

/**
 * Değişmez teslim sürümü (`planSubmissionVersion`); aynı numara eşzamanlı gönderimde 409
 * `version_conflict`. Satır yazıldıktan sonra değişmez (tetikleyici). Dosyalı ve sesli sürüm
 * (`fileIds` dolu) `files` tablosu gelene kadar 422 `submission_kind_unavailable` ile reddedilir.
 */
export async function insertSubmissionVersion(
  tx: Database,
  institutionId: string,
  submissionId: string,
  version: VersionRow,
  now: Date,
): Promise<unknown> {
  // TODO(F3c2-files): `version.fileIds` `files` bağlantı tablosuna yazılır; şimdilik dosyalı ve
  // sesli teslim saklanamaz ve reddedilir. F4b2: atama oluşturulurken `file`/`audio` türü de
  // reddedilmeli; yoksa kursiyer teslim edemeyeceği bir görev alır.
  if (version.fileIds.length > 0)
    throw new RuleViolationError(
      'submission_kind_unavailable',
      'Dosyalı ve sesli teslim henüz açık değil.',
    )
  return constraintAs(
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
    {
      submission_versions_submission_number_key: conflict(
        'version_conflict',
        MESSAGES.version_conflict,
      ),
    },
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
  return constraintAs(
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
    {
      resubmission_requests_pkey: conflict(
        'resubmission_exists',
        'Bu sürüm için yeniden teslim zaten istendi.',
      ),
    },
  )
}

export type StoredSubmissionWork = {
  submission: StoredSubmission
  versions: VersionRow[]
  resubmissions: ResubmissionRequestRow[]
}

/** Teslim satırlarına değişmez sürümleri ve yeniden teslim isteklerini ekler (iki toplu sorgu). */
async function withVersions(
  db: Database,
  institutionId: string,
  rows: readonly (typeof taskSubmissions.$inferSelect)[],
): Promise<StoredSubmissionWork[]> {
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.id)
  const [versions, requests] = await Promise.all([
    db
      .select()
      .from(submissionVersions)
      .where(
        and(
          eq(submissionVersions.institutionId, institutionId),
          inArray(submissionVersions.submissionId, ids),
          isNull(submissionVersions.archivedAt),
        ),
      )
      .orderBy(asc(submissionVersions.submissionId), asc(submissionVersions.versionNumber)),
    db
      .select()
      .from(resubmissionRequests)
      .where(
        and(
          eq(resubmissionRequests.institutionId, institutionId),
          inArray(resubmissionRequests.submissionId, ids),
          isNull(resubmissionRequests.archivedAt),
        ),
      )
      .orderBy(asc(resubmissionRequests.submissionId), asc(resubmissionRequests.versionNumber)),
  ])
  return rows.map((row) => {
    const resubmissions = requests
      .filter((r) => r.submissionId === row.id)
      .map((r) => ({
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
      versions: versions
        .filter((v) => v.submissionId === row.id)
        .map((v) => ({
          id: v.id,
          number: v.versionNumber,
          submittedAt: iso(v.submittedAt),
          body: v.body,
          fileIds: [],
        })),
      resubmissions,
    }
  })
}

/**
 * Kursiyerin arşivlenmemiş teslim kaydı, değişmez sürümleri (eskiden yeniye) ve yeniden teslim
 * istekleri; teslim yoksa veya arşivliyse `null`. Taslak ayrıdır (`loadDraft`).
 */
export async function loadSubmission(
  db: Database,
  institutionId: string,
  assignmentId: string,
  learnerId: string,
): Promise<StoredSubmissionWork | null> {
  const rows = await db
    .select()
    .from(taskSubmissions)
    .where(
      and(
        eq(taskSubmissions.institutionId, institutionId),
        eq(taskSubmissions.assignmentId, assignmentId),
        eq(taskSubmissions.learnerId, learnerId),
        isNull(taskSubmissions.archivedAt),
      ),
    )
  const [work] = await withVersions(db, institutionId, rows)
  return work ?? null
}

/** Teslim kaydı kimliğiyle (arşivli, başka kurumun veya olmayan kimlik `null`). */
export async function findSubmission(
  db: Database,
  institutionId: string,
  submissionId: string,
): Promise<StoredSubmissionWork | null> {
  if (!UUID.test(submissionId)) return null
  const rows = await db
    .select()
    .from(taskSubmissions)
    .where(
      and(
        eq(taskSubmissions.institutionId, institutionId),
        eq(taskSubmissions.id, submissionId),
        isNull(taskSubmissions.archivedAt),
      ),
    )
  const [work] = await withVersions(db, institutionId, rows)
  return work ?? null
}

/**
 * Atamanın arşivlenmemiş teslimleri, kursiyer sırasıyla, sayfalı (DOM-BEC-040). Süzgeç
 * `task_submissions_assignment_learner_key` indeksinin önekidir.
 */
export async function listSubmissions(
  db: Database,
  institutionId: string,
  query: LearnerWorkQuery,
): Promise<{ rows: StoredSubmissionWork[]; total: number }> {
  const where = and(
    eq(taskSubmissions.institutionId, institutionId),
    eq(taskSubmissions.assignmentId, query.assignmentId),
    isNull(taskSubmissions.archivedAt),
    learnerFilter(taskSubmissions.learnerId)(query.learnerIds),
  )
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(taskSubmissions)
      .where(where)
      .orderBy(asc(taskSubmissions.learnerId))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(taskSubmissions).where(where),
  ])
  return { rows: await withVersions(db, institutionId, rows), total: totals?.total ?? 0 }
}

/**
 * Teslim kaydının satır sürümünü artırır: puan ve yeniden teslim isteği teslimi değiştirir, böylece
 * `If-Match` ile gelen eşzamanlı ikinci istek 409 `version_conflict` alır. Sürümler, puanlar ve
 * istekler ayrı değişmez satırlardır; bu kolon yalnız iyimser kilittir.
 */
export async function touchSubmission(
  tx: Database,
  institutionId: string,
  submission: Pick<StoredSubmission, 'id' | 'rowVersion'>,
  now: Date,
): Promise<number> {
  const [row] = await tx
    .update(taskSubmissions)
    .set({ updatedAt: now, version: sql`${taskSubmissions.version} + 1` })
    .where(
      and(
        eq(taskSubmissions.institutionId, institutionId),
        eq(taskSubmissions.id, submission.id),
        eq(taskSubmissions.version, submission.rowVersion),
        isNull(taskSubmissions.archivedAt),
      ),
    )
    .returning({ version: taskSubmissions.version })
  if (row === undefined) throw new ConflictError()
  return row.version
}

/** Puanlama kuyruğunun süzgeçleri; rol kapsamı servisten gelir (`AssignmentListQuery` ile aynı). */
export interface GradingQueueQuery extends Pick<
  AssignmentListQuery,
  'assignedByUserId' | 'learnerTargets'
> {
  assignmentId?: string | undefined
  /** Kişi son sürümü bir rolde puanladıysa satırı görmez (bağımsız puanlayıcı; DOM-BEC-024). */
  raterUserId: string
  /** Yalnız ilk veya yalnız ikinci puanı bekleyenler (DOM-BEC-024). */
  awaiting?: 'first' | 'second' | undefined
  /** Puanlama süresi aşılmış (`true`) veya aşılmamış (`false`) olanlar (DOM-BEC-025). */
  overdue?: boolean | undefined
  now: Date
  page: number
  pageSize: number
}

/**
 * Puanlanmayı bekleyen teslimler (F4b3b1, F4b3b2a; DOM-BEC-021, 024, 025, 040): arşivlenmemiş,
 * rubrikli atamanın teslimi ve son sürümünün ilk puanı yok ya da kendisini kapsayan ikinci
 * puanlama isteği varken ikinci puanı yok; ya da iki puan uyuşmuyor ve koordinatör bekleniyor
 * (`awaiting` süzgeci yokken). Kişinin son sürüme puan verdiği bekleyen satır düşer (aynı kişi
 * iki rolde puanlayamaz); uyuşmazlıklı satır puanlayıcılara da görünür. En eski son gönderim
 * önce. Gecikme süzgeci core `gradingDueAt` ile aynı hesaptır (sürümün son teslimi ile gönderimin
 * geç olanı + 7 gün; örneklemli görevde başlangıç örneklem anından erken olmaz); servis satırı
 * core ile yeniden hesaplar. Kapsam süzgeci atama listesininkidir; servis satırları `visible` ile doğrular.
 */
export async function listAwaitingScore(
  db: Database,
  institutionId: string,
  query: GradingQueueQuery,
): Promise<{ rows: StoredSubmissionWork[]; total: number }> {
  const s = taskSubmissions
  const a = taskAssignments
  const scopeFilter = assignmentScopeFilter(db, query)
  const latestNumber = sql`(select max(lv.version_number) from ${submissionVersions} lv
    where lv.institution_id = ${s.institutionId} and lv.submission_id = ${s.id}
      and lv.archived_at is null)`
  const latestSubmittedAt = sql`(select max(lv.submitted_at) from ${submissionVersions} lv
    where lv.institution_id = ${s.institutionId} and lv.submission_id = ${s.id}
      and lv.archived_at is null)`
  const latestScored = (condition: SQL) => sql`exists (select 1 from ${rubricScores} rs
    join ${submissionVersions} sv
      on sv.institution_id = rs.institution_id and sv.id = rs.submission_version_id
    where rs.institution_id = ${s.institutionId} and sv.submission_id = ${s.id}
      and sv.version_number = ${latestNumber} and ${condition})`
  const needsFirst = sql`not ${latestScored(sql`rs.rater_role = 'first'`)}`
  // İstek, istendiği anda var olan sürümleri kapsar (servis `secondRatingFor` ile aynı).
  const needsSecond = sql`(exists (select 1 from ${secondRatingRequests} r
      where r.institution_id = ${s.institutionId} and r.submission_id = ${s.id}
        and r.archived_at is null and r.requested_at >= ${latestSubmittedAt})
    and not ${latestScored(sql`rs.rater_role = 'second'`)})`
  const scoredBySelf = latestScored(sql`rs.rater_user_id = ${query.raterUserId}`)
  // Core `scoreResolution` `disagreement`: son sürümde ilk ve ikinci puan var, `final` yok ve bir
  // kriterde fark eşiği aşıyor ya da kriter ikinci puanda yok (`bandDisagreements`). İki puan da
  // verildiği için puanlayıcılara da görünür; kör puanlama bitmiştir (DOM-BEC-024).
  const disputed = sql`exists (select 1 from ${rubricScores} f
    join ${submissionVersions} fv
      on fv.institution_id = f.institution_id and fv.id = f.submission_version_id
    join ${rubricScores} sc on sc.institution_id = f.institution_id
      and sc.submission_version_id = f.submission_version_id and sc.rater_role = 'second'
    where f.institution_id = ${s.institutionId} and fv.submission_id = ${s.id}
      and fv.version_number = ${latestNumber} and f.rater_role = 'first'
      and not exists (select 1 from ${rubricScores} fin
        where fin.institution_id = f.institution_id
          and fin.submission_version_id = f.submission_version_id and fin.rater_role = 'final')
      and exists (select 1 from jsonb_array_elements(f.criteria) fc
        where not exists (select 1 from jsonb_array_elements(sc.criteria) c2
          where c2->>'criterionId' = fc->>'criterionId'
            and abs((c2->>'band')::numeric - (fc->>'band')::numeric) <= ${DISAGREEMENT_BAND_GAP})))`
  const awaiting =
    query.awaiting === 'first'
      ? sql`(${needsFirst} and not ${scoredBySelf})`
      : query.awaiting === 'second'
        ? sql`(${needsSecond} and not ${scoredBySelf})`
        : sql`(((${needsFirst} or ${needsSecond}) and not ${scoredBySelf}) or ${disputed})`
  // Core `deadlineForVersion`: yeniden teslim istenen sürümden sonrakiler isteğin son tarihine bağlı.
  const resubmissionDue = sql`(select case when rr.version_number < ${latestNumber}
      then rr.due_at end from ${resubmissionRequests} rr
    where rr.institution_id = ${s.institutionId} and rr.submission_id = ${s.id}
      and rr.archived_at is null order by rr.version_number desc limit 1)`
  // Servis `gradingDeadlineOf`: örneklemli görevde (oran > 0 ve son tarih var) süre örneklem
  // anından başlar, örneklem seçilmeden süre yoktur (`null`, gecikmiş sayılmaz). `greatest` NULL'u
  // atladığı için örneklem bekleyen durum ayrıca `case` ile `null` yapılır.
  const versionStart = sql`greatest(coalesce(${resubmissionDue}, ${a.dueAt}), ${latestSubmittedAt})`
  const gradingStart = sql`(case
    when ${a.secondRatingPercent} > 0 and ${a.dueAt} is not null then
      case when ${a.secondRatingSampledAt} is null then null
        else greatest(${a.secondRatingSampledAt}, ${versionStart}) end
    else ${versionStart} end)`
  const gradingDueAt = sql`(${gradingStart} + make_interval(days => ${GRADING_DAYS}))`
  const nowAt = sql`${query.now.toISOString()}::timestamptz`
  const overdue =
    query.overdue === undefined
      ? []
      : [
          query.overdue
            ? sql`${gradingDueAt} < ${nowAt}`
            : sql`(${gradingDueAt} is null or ${gradingDueAt} >= ${nowAt})`,
        ]
  const where = and(
    eq(s.institutionId, institutionId),
    isNull(s.archivedAt),
    isNull(a.archivedAt),
    sql`${a.rubricVersionId} is not null`,
    sql`${latestNumber} is not null`,
    awaiting,
    ...overdue,
    ...(scopeFilter === undefined ? [] : [scopeFilter]),
    ...(query.assignmentId === undefined ? [] : [eq(s.assignmentId, query.assignmentId)]),
  )
  const joinAssignment = and(eq(a.institutionId, s.institutionId), eq(a.id, s.assignmentId))
  const [rows, [totals]] = await Promise.all([
    db
      .select({ submission: s })
      .from(s)
      .innerJoin(a, joinAssignment)
      .where(where)
      .orderBy(asc(latestSubmittedAt), asc(s.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(s).innerJoin(a, joinAssignment).where(where),
  ])
  return {
    rows: await withVersions(
      db,
      institutionId,
      rows.map((row) => row.submission),
    ),
    total: totals?.total ?? 0,
  }
}

// --- Taslak -------------------------------------------------------------------------------

/** Core `planDraftSave`'in çakışma mesajı (`draft_conflict`). */
const DRAFT_CONFLICT = 'Taslak başka bir pencerede değişti; sayfayı yenileyip devam edin.'

/** Kursiyerin arşivlenmemiş taslağı; satır sürümü core `revision`'dır. */
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
        isNull(submissionDrafts.archivedAt),
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

/**
 * Rubrik puanı (`planRubricScore`, `planAppealDecision`); sürümde aynı rolde ikinci puan 409.
 * Puanın rubrik sürümü atamanın sabitlenmiş sürümüdür (DOM-BEC-022): değilse 422
 * `rubric_version_mismatch`, teslim sürümü yoksa 404.
 */
export async function insertRubricScore(
  tx: Database,
  institutionId: string,
  score: RubricScoreRow,
  now: Date,
): Promise<unknown> {
  const [pinned] = await tx
    .select({ rubricVersionId: taskAssignments.rubricVersionId })
    .from(submissionVersions)
    .innerJoin(
      taskSubmissions,
      and(
        eq(taskSubmissions.institutionId, submissionVersions.institutionId),
        eq(taskSubmissions.id, submissionVersions.submissionId),
      ),
    )
    .innerJoin(
      taskAssignments,
      and(
        eq(taskAssignments.institutionId, taskSubmissions.institutionId),
        eq(taskAssignments.id, taskSubmissions.assignmentId),
      ),
    )
    .where(
      and(
        eq(submissionVersions.institutionId, institutionId),
        eq(submissionVersions.id, score.submissionVersionId),
      ),
    )
  if (pinned === undefined) throw new NotFoundError()
  if (pinned.rubricVersionId !== score.rubricVersionId)
    throw new RuleViolationError(
      'rubric_version_mismatch',
      'Puan, görevin sabitlenmiş rubrik sürümüyle verilmelidir.',
    )
  return constraintAs(
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
    {
      rubric_scores_version_role_key: conflict(
        'rubric_score_exists',
        'Bu teslim sürümü bu rolde zaten puanlandı.',
      ),
    },
  )
}

/** Teslimin bütün sürümlerinin puanları, puanlama sırasıyla (core `RubricScoreRow`). */
export async function loadSubmissionScores(
  db: Database,
  institutionId: string,
  submissionId: string,
): Promise<RubricScoreRow[]> {
  return (await loadScoresBySubmission(db, institutionId, [submissionId])).get(submissionId) ?? []
}

/** Teslimlerin puanları tek sorguda: teslim kimliği → puanlar (puanlama sırasıyla). */
export async function loadScoresBySubmission(
  db: Database,
  institutionId: string,
  submissionIds: readonly string[],
): Promise<Map<string, RubricScoreRow[]>> {
  const bySubmission = new Map<string, RubricScoreRow[]>()
  if (submissionIds.length === 0) return bySubmission
  const rows = await db
    .select({ score: rubricScores, submissionId: submissionVersions.submissionId })
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
        inArray(submissionVersions.submissionId, [...submissionIds]),
      ),
    )
    .orderBy(asc(rubricScores.scoredAt), asc(rubricScores.id))
  for (const { score, submissionId } of rows) {
    const list = bySubmission.get(submissionId) ?? []
    list.push({
      id: score.id,
      submissionVersionId: score.submissionVersionId,
      rubricVersionId: score.rubricVersionId,
      raterUserId: score.raterUserId,
      raterRole: score.raterRole,
      criteria: score.criteria,
      overallComment: score.overallComment,
      scoredAt: iso(score.scoredAt),
    })
    bySubmission.set(submissionId, list)
  }
  return bySubmission
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

/**
 * İkinci puanlama örneklemi (DOM-BEC-024): atamanın örneklem kararını yazar ve satır sürümünü
 * artırır. Sürüm `If-Match`'ten farklıysa veya örneklem zaten çekildiyse 409.
 */
export async function markSecondRatingSampled(
  tx: Database,
  institutionId: string,
  assignment: Pick<StoredAssignment, 'id' | 'rowVersion'>,
  now: Date,
): Promise<number> {
  const [row] = await tx
    .update(taskAssignments)
    .set({
      secondRatingSampledAt: now,
      updatedAt: now,
      version: sql`${taskAssignments.version} + 1`,
    })
    .where(
      and(
        eq(taskAssignments.institutionId, institutionId),
        eq(taskAssignments.id, assignment.id),
        eq(taskAssignments.version, assignment.rowVersion),
        isNull(taskAssignments.secondRatingSampledAt),
        isNull(taskAssignments.archivedAt),
      ),
    )
    .returning({ version: taskAssignments.version })
  if (row === undefined) throw new ConflictError()
  return row.version
}

/** Atamanın en az bir sürümü olan arşivsiz teslimleri (örneklem havuzu; DOM-BEC-024). */
export async function listSubmittedIds(
  db: Database,
  institutionId: string,
  assignmentId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: taskSubmissions.id })
    .from(taskSubmissions)
    .where(
      and(
        eq(taskSubmissions.institutionId, institutionId),
        eq(taskSubmissions.assignmentId, assignmentId),
        isNull(taskSubmissions.archivedAt),
        sql`exists (select 1 from ${submissionVersions} v
          where v.institution_id = ${taskSubmissions.institutionId}
            and v.submission_id = ${taskSubmissions.id} and v.archived_at is null)`,
      ),
    )
    .orderBy(asc(taskSubmissions.id))
  return rows.map((row) => row.id)
}

/**
 * Atamanın teslimleri için yapılmış en son ikinci puanlama isteğinin anı; istek yoksa `null`.
 * Son tarih kilidi, isteğin teslim penceresi kapandıktan sonra yapılıp yapılmadığına bakar.
 */
export async function latestSecondRatingRequestAt(
  db: Database,
  institutionId: string,
  assignmentId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ requestedAt: max(secondRatingRequests.requestedAt) })
    .from(secondRatingRequests)
    .innerJoin(
      taskSubmissions,
      and(
        eq(taskSubmissions.institutionId, secondRatingRequests.institutionId),
        eq(taskSubmissions.id, secondRatingRequests.submissionId),
      ),
    )
    .where(
      and(
        eq(secondRatingRequests.institutionId, institutionId),
        eq(taskSubmissions.assignmentId, assignmentId),
        isNull(secondRatingRequests.archivedAt),
      ),
    )
  return isoOrNull(row?.requestedAt ?? null)
}

/**
 * Teslimlerin arşivlenmemiş ikinci puanlama isteklerinin anı (teslim → `requestedAt`). İstek,
 * istendiği anda var olan sürümleri kapsar (servis `secondRatingFor`).
 */
export async function secondRatingRequestsAmong(
  db: Database,
  institutionId: string,
  submissionIds: readonly string[],
): Promise<Map<string, string>> {
  if (submissionIds.length === 0) return new Map()
  const rows = await db
    .select({
      submissionId: secondRatingRequests.submissionId,
      requestedAt: secondRatingRequests.requestedAt,
    })
    .from(secondRatingRequests)
    .where(
      and(
        eq(secondRatingRequests.institutionId, institutionId),
        inArray(secondRatingRequests.submissionId, [...submissionIds]),
        isNull(secondRatingRequests.archivedAt),
      ),
    )
  return new Map(rows.map((row) => [row.submissionId, iso(row.requestedAt)]))
}

/** Core `secondRatingRequested`: teslim için arşivlenmemiş ikinci puanlama isteği var mı. */
export async function isSecondRatingRequested(
  db: Database,
  institutionId: string,
  submissionId: string,
): Promise<boolean> {
  return (await secondRatingRequestedAmong(db, institutionId, [submissionId])).has(submissionId)
}

/** Teslimlerden arşivlenmemiş ikinci puanlama isteği olanlar (tek sorgu). */
export async function secondRatingRequestedAmong(
  db: Database,
  institutionId: string,
  submissionIds: readonly string[],
): Promise<Set<string>> {
  return new Set((await secondRatingRequestsAmong(db, institutionId, submissionIds)).keys())
}

// --- İtiraz -------------------------------------------------------------------------------

/**
 * İtiraz (`planAppeal`); aynı sürüme ikinci itiraz 409 `appeal_exists` (DOM-BEC-025). İtirazın
 * kursiyeri teslimin kursiyeridir: değilse 422 `appeal_learner_mismatch`, sürüm yoksa 404.
 */
export async function insertAppeal(
  tx: Database,
  institutionId: string,
  appeal: AppealDraft & { id: string },
  now: Date,
): Promise<unknown> {
  const [owner] = await tx
    .select({ learnerId: taskSubmissions.learnerId })
    .from(submissionVersions)
    .innerJoin(
      taskSubmissions,
      and(
        eq(taskSubmissions.institutionId, submissionVersions.institutionId),
        eq(taskSubmissions.id, submissionVersions.submissionId),
      ),
    )
    .where(
      and(
        eq(submissionVersions.institutionId, institutionId),
        eq(submissionVersions.id, appeal.submissionVersionId),
      ),
    )
  if (owner === undefined) throw new NotFoundError()
  if (owner.learnerId !== appeal.learnerId)
    throw new RuleViolationError(
      'appeal_learner_mismatch',
      'İtiraz yalnız kursiyerin kendi teslimine yapılabilir.',
    )
  return constraintAs(
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
    {
      score_appeals_submission_version_key: conflict(
        'appeal_exists',
        'Bu sonuca zaten itiraz edildi.',
      ),
    },
  )
}

/**
 * Teslimlerin sürümlerine yapılmış arşivlenmemiş itirazlar tek sorguda (core `AppealRow`): teslim
 * kimliği → itirazlar, veriliş sırasıyla. Liste sayfası teslim başına sorgu atmaz.
 */
export async function loadAppealsBySubmission(
  db: Database,
  institutionId: string,
  submissionIds: readonly string[],
): Promise<Map<string, (AppealRow & { rowVersion: number })[]>> {
  const bySubmission = new Map<string, (AppealRow & { rowVersion: number })[]>()
  if (submissionIds.length === 0) return bySubmission
  const rows = await db
    .select({ appeal: scoreAppeals, submissionId: submissionVersions.submissionId })
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
        inArray(submissionVersions.submissionId, [...submissionIds]),
        isNull(scoreAppeals.archivedAt),
        isNull(submissionVersions.archivedAt),
      ),
    )
    .orderBy(asc(scoreAppeals.filedAt), asc(scoreAppeals.id))
  for (const { appeal, submissionId } of rows) {
    const list = bySubmission.get(submissionId) ?? []
    list.push({
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
    })
    bySubmission.set(submissionId, list)
  }
  return bySubmission
}

/**
 * İtiraz kararı (`planAppealDecision`): karar kolonları birlikte yazılır, satır sürümü artar.
 * Sürüm `If-Match`'ten farklıysa veya itiraz zaten sonuçlandıysa 409.
 */
export async function decideAppeal(
  tx: Database,
  institutionId: string,
  appeal: Pick<AppealRow, 'id'> & { rowVersion: number },
  decision: Pick<AppealRow, 'decidedByUserId' | 'decidedAt' | 'outcome' | 'decisionReason'>,
  now: Date,
): Promise<void> {
  const updated = await tx
    .update(scoreAppeals)
    .set({
      decidedByUserId: decision.decidedByUserId,
      decidedAt: dateOrNull(decision.decidedAt),
      outcome: decision.outcome,
      decisionReason: decision.decisionReason,
      updatedAt: now,
      version: sql`${scoreAppeals.version} + 1`,
    })
    .where(
      and(
        eq(scoreAppeals.institutionId, institutionId),
        eq(scoreAppeals.id, appeal.id),
        eq(scoreAppeals.version, appeal.rowVersion),
        isNull(scoreAppeals.outcome),
        isNull(scoreAppeals.archivedAt),
      ),
    )
    .returning({ id: scoreAppeals.id })
  if (updated.length === 0) throw new ConflictError()
}

// --- Not aktarımı -------------------------------------------------------------------------

export type StoredScoreTransfer = Omit<
  ScoreTransferRow,
  'institutionId' | 'transferredAt' | 'createdAt' | 'updatedAt' | 'archivedAt' | 'version'
> & { transferredAt: string }

const SOURCE_MISMATCH = {
  status: 422 as const,
  code: 'score_transfer_source_mismatch',
  message: 'Aktarılacak sonuç bu görevin ve kursiyerin teslimine ait değil.',
}

/**
 * Not defterine aktarım (DOM-BEC-060); görev ve kursiyer başına ikinci aktarım 409. Kaynak aynı
 * görevin ve kursiyerin denemesi ya da rubrik puanıdır, değilse 422 `score_transfer_source_mismatch`:
 * deneme için bileşik yabancı anahtar (`score_transfers_source_attempt_fkey`), rubrik puanı için
 * buradaki denetim (puan satırında atama ve kursiyer kolonu yok); puan yoksa 404.
 */
export async function insertScoreTransfer(
  tx: Database,
  institutionId: string,
  transfer: StoredScoreTransfer,
  now: Date,
): Promise<unknown> {
  if (transfer.sourceRubricScoreId !== null) {
    const [source] = await tx
      .select({ assignmentId: taskSubmissions.assignmentId, learnerId: taskSubmissions.learnerId })
      .from(rubricScores)
      .innerJoin(
        submissionVersions,
        and(
          eq(submissionVersions.institutionId, rubricScores.institutionId),
          eq(submissionVersions.id, rubricScores.submissionVersionId),
        ),
      )
      .innerJoin(
        taskSubmissions,
        and(
          eq(taskSubmissions.institutionId, submissionVersions.institutionId),
          eq(taskSubmissions.id, submissionVersions.submissionId),
        ),
      )
      .where(
        and(
          eq(rubricScores.institutionId, institutionId),
          eq(rubricScores.id, transfer.sourceRubricScoreId),
        ),
      )
    if (source === undefined) throw new NotFoundError()
    if (source.assignmentId !== transfer.assignmentId || source.learnerId !== transfer.learnerId)
      throw new RuleViolationError(SOURCE_MISMATCH.code, SOURCE_MISMATCH.message)
  }
  return constraintAs(
    tx.insert(scoreTransfers).values({
      institutionId,
      ...transfer,
      transferredAt: new Date(transfer.transferredAt),
      createdAt: now,
      updatedAt: now,
    }),
    {
      score_transfers_assignment_learner_key: conflict(
        'score_transfer_exists',
        'Bu görevin sonucu not olarak zaten aktarıldı.',
      ),
      score_transfers_source_attempt_fkey: SOURCE_MISMATCH,
    },
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
