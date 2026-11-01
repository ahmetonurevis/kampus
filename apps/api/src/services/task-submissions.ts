import { randomUUID } from 'node:crypto'

import { deadlineForVersion } from '@kampus/school-core/skills/assignment.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import {
  appealDeadline,
  gradedVersionNumbers,
  gradingDueAt,
  gradingOverdue,
  rubricScore,
  scoreResolution,
  scoresVisibleToRater,
  type AppealRow,
  type RubricScoreRow,
  type RubricVersionData,
  type ScoreResolution,
} from '@kampus/school-core/skills/rubric.ts'
import {
  isClosed,
  submissionWindow,
  teacherFeedbackReleased,
} from '@kampus/school-core/skills/scoring.ts'
import {
  canReadDraft,
  planDraftSave,
  planSubmissionVersion,
  submissionStatus,
  versionAllowance,
  versionIsLate,
  wordCountCheck,
  type DraftRow,
  type SubmissionSettings,
  type VersionAllowance,
  type VersionRow,
} from '@kampus/school-core/skills/submission.ts'

import type { Database } from '../db/client.ts'
import {
  findAssignment,
  findRubricVersion,
  findSubmission,
  insertSubmission,
  insertSubmissionVersion,
  listSubmissions,
  loadAppealsBySubmission,
  loadDraft,
  loadSubmission,
  loadScoresBySubmission,
  saveDraft,
  secondRatingRequestsAmong,
  type StoredAssignment,
  type StoredSubmissionWork,
} from '../db/skills.ts'
import { AppError, MESSAGES, NotFoundError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { listMembershipLinks } from './memberships.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { viewerOf, visible, type Viewer } from './task-assignments.ts'
import {
  auditWork,
  canReadLearner,
  learnerFilter,
  ownedLearners,
  ownLearner,
  readableLearners,
  targetedLearner,
  type ReadableLearners,
} from './task-work.ts'

/**
 * Yazma görevinin taslağı ve teslimi (F4b3a; ADR 0004 karar 6; docs/domain/beceri-gelisimi.md
 * DOM-BEC-023, 040, 044, 046; IST-047, IST-051; yetki-ve-kapsam.md DOM-YTK-028).
 *
 * Kurallar core `skills/submission.ts`'tedir; burada kapsam, sıra (kapsam 404 → rol 403, rotada ve
 * serviste → sürüm → core kuralı) ve tek transaction vardır. Kursiyer × atama başına tek teslim
 * kaydı açılır; her gönderim değişmez bir sürüm ekler (tetikleyici metni korur), sınır
 * `maxVersions`'tır. Yazma otomatik puanlanmaz: yanıtta puan alanı yoktur, rubrik puanlaması
 * F4b3b'dedir. Kursiyer ve veli, öğretmen geri bildirimi açılmadan teslimin puanlandığını
 * göremez (DOM-BEC-045): `blockedBy: 'graded'` ve `resubmission_not_requested` onlara genel
 * `locked` / 409 `submission_locked` olarak döner. Taslak yalnız kursiyerin kendisine görünür
 * (`getTaskDraft` core `canReadDraft`'ı uygular); teslim okumasında taslak hiç dönmez. Taslak kaydı sık ve otomatik olduğu için denetime yazılmaz;
 * teslim denetime yalnız alan adlarıyla yazılır. Metin ve öğrenci kimliği hiçbir logda yoktur.
 */

const ENTITY = 'task_submission'

// --- Görünüm ------------------------------------------------------------------------------

/** Atamanın teslim ayarı; otomatik puanlı görevde (ayar yok) teslim beklenmez. */
function settingsOf(assignment: StoredAssignment): SubmissionSettings | null {
  return assignment.submission
}

const wordsOf = (settings: SubmissionSettings | null, body: string | null) =>
  settings?.submissionKind === 'text' && body !== null ? wordCountCheck(body, settings) : null

function versionView(
  assignment: StoredAssignment,
  work: StoredSubmissionWork,
  version: VersionRow,
) {
  const deadline = deadlineForVersion(assignment.deadline, work.submission, version.number)
  return {
    id: version.id,
    number: version.number,
    submittedAt: version.submittedAt,
    late: versionIsLate(version, deadline),
    wordCount: wordsOf(settingsOf(assignment), version.body),
  }
}

// --- Puan ve geri bildirim görünümü ---------------------------------------------------------

/**
 * Teslimin puanlama durumu: bütün sürümlerin puanları, ikinci puanlama isteğinin anı ve
 * itirazları.
 */
export type Grading = {
  scores: readonly RubricScoreRow[]
  secondRatingRequestedAt: string | null
  appeals: readonly (AppealRow & { rowVersion: number })[]
}
/** Puanların rubrik sürümleri (kimlik → kriterler); puan bunlarla hesaplanır (DOM-BEC-022). */
type RubricsById = ReadonlyMap<string, RubricVersionData>
export type GradingBook = { bySubmission: ReadonlyMap<string, Grading>; rubrics: RubricsById }

const NO_GRADING: Grading = { scores: [], secondRatingRequestedAt: null, appeals: [] }

/**
 * Sürüm ikinci puanlama isteğinin kapsamında mı (DOM-BEC-024). İstek teslim başına bir satırdır
 * ve istendiği anda var olan sürümleri kapsar: istek, kursiyerin yeni sürüm gönderemediği anda
 * yapılır (`task-grading.ts` `assertLearnerCannotSubmit`); yeniden teslimle sonradan gelen sürüm
 * yeni bir iştir, ikinci puanlama beklemez. Böylece açılmamış puanlı sürüm yalnız kursiyerin yeni
 * sürüm gönderemediği teslimde bulunur ve ret nedeni puanlamayı ele vermez (DOM-BEC-045).
 */
export function secondRatingFor(
  grading: Pick<Grading, 'secondRatingRequestedAt'>,
  version: Pick<VersionRow, 'submittedAt'> | undefined,
): boolean {
  const requestedAt = grading.secondRatingRequestedAt
  return (
    requestedAt !== null &&
    version !== undefined &&
    Date.parse(version.submittedAt) <= Date.parse(requestedAt)
  )
}

/**
 * Görevde ikinci puanlama örneklemi çekilir mi (DOM-BEC-024): oran sıfırdan büyük ve görevin son
 * tarihi var. Son tarihsiz görevde teslim penceresi kapanmaz, örneklem çekilemez; ilk puan
 * örneklemi beklemez, ikinci puan yalnız elle istenir.
 */
// TODO(core-ikinci-puan-son-tarih): Core `secondRatingPercent > 0` iken `dueAt`'ı zorunlu tutabilir;
// o zaman son tarihsiz örneklemli görev oluşmaz, bu ayrım kalkar.
export function sampleLocked(
  assignment: Pick<StoredAssignment, 'secondRatingPercent' | 'deadline'>,
): boolean {
  return assignment.secondRatingPercent > 0 && assignment.deadline.dueAt !== null
}

/**
 * Sürümün puanlama süresinin başladığı son teslim (DOM-BEC-025; core `gradingDueAt`'a verilir).
 * Örneklemli görevde ilk puan örneklemden önce verilemediği için süre örneklemin seçildiği andan
 * (veya sürümün daha geç son tesliminden) başlar; örneklem seçilmeden süre işlemez (`null`:
 * puanlama süresi yok, gecikmiş sayılmaz). Örneklemsiz görevde sürümün son teslimidir.
 */
// TODO(beceri-puanlama-suresi-orneklem): Domain örneklemli görevde sürenin başlangıcını
// söylemiyor; örneklem anı seçildi, aksi hâlde örneklem kilidindeki günler öğretmenden düşerdi.
export function gradingDeadlineOf(
  assignment: StoredAssignment,
  submission: StoredSubmissionWork['submission'],
  versionNumber: number,
): { dueAt: string | null } | null {
  const deadline = deadlineForVersion(assignment.deadline, submission, versionNumber)
  if (!sampleLocked(assignment)) return deadline
  const sampledAt = assignment.secondRatingSampledAt
  if (sampledAt === null) return null
  const later =
    deadline.dueAt !== null && Date.parse(deadline.dueAt) > Date.parse(sampledAt)
      ? deadline.dueAt
      : sampledAt
  return { dueAt: later }
}

/** Sürümün puan sonucu (core `scoreResolution`); hesaplanır, saklanmaz. */
export function resolutionOf(grading: Grading, version: VersionRow): ScoreResolution {
  return scoreResolution({
    scores: grading.scores.filter((score) => score.submissionVersionId === version.id),
    secondRatingRequested: secondRatingFor(grading, version),
  })
}

/** Teslimlerin puanları, ikinci puanlama istekleri, itirazları ve puanların rubrik sürümleri. */
export async function loadGrading(
  db: Database,
  ctx: Pick<ServiceContext, 'institutionId'>,
  submissionIds: readonly string[],
): Promise<GradingBook> {
  const [scores, second, appeals] = await Promise.all([
    loadScoresBySubmission(db, ctx.institutionId, submissionIds),
    secondRatingRequestsAmong(db, ctx.institutionId, submissionIds),
    loadAppealsBySubmission(db, ctx.institutionId, submissionIds),
  ])
  const rubricIds = [...new Set([...scores.values()].flat().map((score) => score.rubricVersionId))]
  const rubrics = new Map<string, RubricVersionData>()
  for (const version of await Promise.all(
    rubricIds.map((id) => findRubricVersion(db, ctx.institutionId, id)),
  ))
    if (version !== null) rubrics.set(version.id, version)
  return {
    bySubmission: new Map(
      submissionIds.map((id) => [
        id,
        {
          scores: scores.get(id) ?? [],
          secondRatingRequestedAt: second.get(id) ?? null,
          appeals: appeals.get(id) ?? [],
        },
      ]),
    ),
    rubrics,
  }
}

/**
 * Sürümün kişiye gösterilen puanı (DOM-BEC-021, 024, 045). Kesinleşmiş puan (core
 * `scoreResolution`) personele her zaman, kursiyer ve veliye yalnız geri bildirim açılınca
 * (`teacherFeedbackReleased`) görünür; açılmadan önce kursiyerin gördüğü, hiç puanlanmamış sürümle
 * aynıdır (`null`). Uyuşmazlıkta puan kesinleşmez, kursiyere kapalı kalır. Kesinleşmemiş puanı
 * yalnız personel görür, core `scoresVisibleToRater` ile: öğretmen ve yönetici yalnız kendi
 * puanını görür (kör puanlama; ikinci puanlayıcı ilk puanı görmez, DOM-BEC-024); yönetici
 * koordinatör sayılmaz, ikinci puanlayıcı olabilir.
 */
// TODO(F4b3b2b): Koordinatör (DOM-YTK-027) bütün puanları görür ve uyuşmazlıkta son puanı verir.
function shownScore(
  viewer: Viewer,
  ctx: ServiceContext,
  grading: Grading,
  version: VersionRow,
): { row: RubricScoreRow; settled: boolean } | null {
  const scores = grading.scores.filter((score) => score.submissionVersionId === version.id)
  const secondRatingRequested = secondRatingFor(grading, version)
  const resolution = scoreResolution({ scores, secondRatingRequested })
  if (resolution.status === 'settled') {
    if (viewer.kind !== 'learner' || teacherFeedbackReleased(resolution.settledAt, ctx.now))
      return { row: resolution.score, settled: true }
    return null
  }
  if (viewer.kind === 'learner') return null
  const visibleScores = scoresVisibleToRater({
    scores,
    viewer: { userId: ctx.actor.userId, coordinator: false },
    secondRatingRequested,
  })
  const row = visibleScores.at(-1)
  return row === undefined ? null : { row, settled: false }
}

/** Puanın özeti: toplam her okumada kriter bantlarından hesaplanır, saklanmaz (DOM-BEC-021). */
function scoreSummary(
  ctx: ServiceContext,
  rubrics: RubricsById,
  shown: { row: RubricScoreRow; settled: boolean } | null,
) {
  if (shown === null) return null
  const rubric = rubrics.get(shown.row.rubricVersionId)
  if (rubric === undefined) {
    // Puanın rubrik sürümü yabancı anahtarla korunur; bulunamaması veri bütünlüğü sorunudur.
    ctx.log.warn({ event: 'task_submission.rubric_missing' })
    return null
  }
  const result = rubricScore(rubric, shown.row.criteria)
  return { result, row: shown.row, settled: shown.settled }
}

function scoreBrief(summary: ReturnType<typeof scoreSummary>) {
  if (summary === null) return null
  return {
    settled: summary.settled,
    rubricVersionId: summary.row.rubricVersionId,
    total: summary.result.total,
    max: summary.result.max,
    percent: summary.result.percent,
    scoredAt: summary.row.scoredAt,
  }
}

/** Puan ve geri bildirim: kriter bantları, ağırlıklar, kriter yorumları ve genel yorum. */
function scoreFeedback(summary: ReturnType<typeof scoreSummary>) {
  const brief = scoreBrief(summary)
  if (summary === null || brief === null) return null
  const comments = new Map(summary.row.criteria.map((c) => [c.criterionId, c.comment]))
  return {
    ...brief,
    criteria: summary.result.criteria.map((criterion) => ({
      ...criterion,
      comment: comments.get(criterion.criterionId) ?? null,
    })),
    overallComment: summary.row.overallComment,
  }
}

/** Teslimin durumu son sürümün kendi süresine göredir (yeniden teslim süresi dahil). */
function statusOf(assignment: StoredAssignment, work: StoredSubmissionWork, now: Date) {
  const latest = work.versions.at(-1)
  const deadline = deadlineForVersion(
    assignment.deadline,
    work.submission,
    latest?.number ?? work.versions.length + 1,
  )
  return submissionStatus(work.versions, deadline, now)
}

function summaryView(
  viewer: Viewer,
  ctx: ServiceContext,
  book: GradingBook,
  assignment: StoredAssignment,
  work: StoredSubmissionWork,
) {
  const latest = work.versions.at(-1)
  const grading = book.bySubmission.get(work.submission.id) ?? NO_GRADING
  return {
    id: work.submission.id,
    assignmentId: work.submission.assignmentId,
    learnerId: work.submission.learnerId,
    status: statusOf(assignment, work, ctx.now),
    versionCount: work.versions.length,
    latestVersion:
      latest === undefined
        ? null
        : {
            ...versionView(assignment, work, latest),
            score: scoreBrief(
              scoreSummary(ctx, book.rubrics, shownScore(viewer, ctx, grading, latest)),
            ),
          },
    resubmission: resubmissionOf(work),
    // Puan ve yeniden teslim isteği teslimin satır sürümünü artırır; kursiyer ve veli sürümü
    // görse geri bildirim açılmadan puanlandığını anlardı (DOM-BEC-045). Onların yazmaları
    // (teslim, taslak) bu sürümü kullanmaz.
    rowVersion: viewer.kind === 'learner' ? null : work.submission.rowVersion,
  }
}

/**
 * Son yeniden teslim isteği (DOM-BEC-040). İstek yalnız kesinleşmiş puandan sonra açılır
 * (`planResubmissionRequest`); kesinleşme anında geri bildirim de açıldığı için kursiyere
 * gösterilmesi puanı erken sızdırmaz.
 */
function resubmissionOf(work: StoredSubmissionWork) {
  const latest = work.resubmissions.at(-1)
  return latest === undefined ? null : { versionNumber: latest.versionNumber, dueAt: latest.dueAt }
}

/**
 * Sürümün öğretmen geri bildirimi kursiyere açık mı (DOM-BEC-045; core `scoreResolution`,
 * `teacherFeedbackReleased`): puan kesinleşmiş (ikinci puan veya koordinatör beklenmiyor,
 * uyuşmazlık yok) ve kesinleşme anı geçmiş. Sonuç duyurusu bu andır (itiraz süresi; DOM-BEC-025).
 */
export function releasedResolution(grading: Grading, version: VersionRow | undefined, now: Date) {
  if (version === undefined) return null
  const resolution = resolutionOf(grading, version)
  return resolution.status === 'settled' && teacherFeedbackReleased(resolution.settledAt, now)
    ? resolution
    : null
}

function latestFeedbackReleased(
  work: Pick<StoredSubmissionWork, 'versions'>,
  grading: Grading,
  now: Date,
) {
  return releasedResolution(grading, work.versions.at(-1), now) !== null
}

/** Kursiyer ve veliye teslim penceresi kapanmışsa (puanlamadan bağımsız) genel `locked` döner. */
type BlockedBy = VersionAllowance['blockedBy'] | 'locked'
type Allowance = Omit<VersionAllowance, 'blockedBy'> & { blockedBy: BlockedBy }

/**
 * Yeni sürüm hakkı (core `versionAllowance`). Personel core sonucunu olduğu gibi görür. Kursiyer
 * ve veli geri bildirimi açılmamış puanı hiçbir alandan çıkaramaz (DOM-BEC-045): son sürümün
 * geri bildirimi açılmadıysa hak, sürüm hiç puanlanmamış gibi hesaplanır, yani yanıt
 * puanlamadan öncekiyle birebir aynıdır. Onlara `locked` yalnız puanlamadan bağımsız koşulda
 * döner: sıradaki sürümün teslim penceresi (geç kabul veya yeniden teslim süresi dahil) kapandı
 * ve yeni sürüm başka nedenle zaten kapalı değil. Açılmamış puan yalnız ikinci puanlama veya
 * uyuşmazlıkta olur; ikinci puanlama yalnız kursiyer yeni sürüm gönderemezken istenir
 * (`secondRatingFor`), bu yüzden gösterilen hak gerçek hakla aynı kalır.
 */
function allowanceOf(
  ctx: ServiceContext,
  viewer: Viewer,
  assignment: StoredAssignment,
  work: StoredSubmissionWork | null,
  grading: Grading,
): Allowance | null {
  const settings = settingsOf(assignment)
  if (settings === null) return null
  const versions = work?.versions ?? []
  const submission = work?.submission ?? null
  const graded = gradedVersionNumbers(versions, grading.scores)
  if (viewer.kind !== 'learner')
    return versionAllowance({ settings, submission, versions, gradedVersionNumbers: graded })
  const latest = versions.at(-1)
  const hidden =
    latest !== undefined && !latestFeedbackReleased({ versions }, grading, ctx.now)
      ? latest.number
      : null
  const allowance = versionAllowance({
    settings,
    submission,
    versions,
    gradedVersionNumbers: graded.filter((number) => number !== hidden),
  })
  const next = deadlineForVersion(assignment.deadline, submission, (latest?.number ?? 0) + 1)
  return allowance.canSubmit && isClosed(next, ctx.now)
    ? { ...allowance, canSubmit: false, blockedBy: 'locked' }
    : allowance
}

/**
 * Kursiyerin bir yazma görevindeki durumu (atama listesi ve ayrıntısındaki özet;
 * `services/task-progress.ts`, IST-051). Teslim uçlarıyla aynı kuralları kullanır, dolayısıyla
 * aynı gizlemeyi taşır (DOM-BEC-045): puan yalnız geri bildirim açılınca (`shownScore`), hak
 * puanlama yokmuş gibi (`allowanceOf`), satır sürümü, ikinci puanlama, örneklem ve itiraz yok.
 */
export function learnerSubmissionProgress(
  ctx: ServiceContext,
  viewer: Viewer,
  book: GradingBook,
  assignment: StoredAssignment,
  work: StoredSubmissionWork | null,
) {
  const grading = (work && book.bySubmission.get(work.submission.id)) ?? NO_GRADING
  const latest = work?.versions.at(-1)
  const deadline = deadlineForVersion(
    assignment.deadline,
    work?.submission ?? null,
    latest?.number ?? 1,
  )
  const resubmission = work === null ? null : resubmissionOf(work)
  const allowance = allowanceOf(ctx, viewer, assignment, work, grading)
  // Yeni sürüm açıkken bir sonraki sürümün penceresi (istenen yeniden teslim dahil) kapanınca
  // özet değişir. Geri bildirimin açılma anı verilmez (DOM-BEC-045).
  const next = deadlineForVersion(
    assignment.deadline,
    work?.submission ?? null,
    (latest?.number ?? 0) + 1,
  )
  return {
    submissionId: work?.submission.id ?? null,
    status: submissionStatus(work?.versions ?? [], deadline, ctx.now),
    latest: work === null || latest === undefined ? null : versionView(assignment, work, latest),
    // İstek kesinleşmiş puandan sonra açılır ve o an geri bildirim de açıktır (`resubmissionOf`).
    resubmissionRequested:
      resubmission !== null && latest !== undefined && latest.number <= resubmission.versionNumber,
    allowance,
    actionableUntil: allowance?.canSubmit ? submissionWindow(next).closesAt : null,
    score:
      latest === undefined
        ? null
        : scoreBrief(scoreSummary(ctx, book.rubrics, shownScore(viewer, ctx, grading, latest))),
  }
}

const LOCKED_MESSAGE = 'Bu teslim için şu an yeni sürüm gönderilemez.'

export async function detailView(
  db: Database,
  ctx: ServiceContext,
  viewer: Viewer,
  assignment: StoredAssignment,
  work: StoredSubmissionWork,
) {
  const book = await loadGrading(db, ctx, [work.submission.id])
  const grading = book.bySubmission.get(work.submission.id) ?? NO_GRADING
  return {
    ...summaryView(viewer, ctx, book, assignment, work),
    versions: work.versions.map((version) => ({
      ...versionView(assignment, work, version),
      body: version.body,
      score: scoreFeedback(
        scoreSummary(ctx, book.rubrics, shownScore(viewer, ctx, grading, version)),
      ),
      grading: gradingView(ctx, viewer, assignment, work, grading, version),
      appealDeadline: appealDeadlineOf(ctx, viewer, assignment, grading, version),
      appeal: appealView(viewer, grading, version),
    })),
    allowance: allowanceOf(ctx, viewer, assignment, work, grading),
  }
}

/**
 * Personelin gördüğü puanlama durumu (DOM-BEC-024, 025): sonuç, ikinci puanlama isteği,
 * uyuşmazlık kriterleri ve puanlama süresi. Kursiyer ve veliye `null` (DOM-BEC-045). Uyuşmazlık
 * kriterleri iki puan da verildikten sonra döner; puanlar değişmez olduğu için kör puanlamayı
 * etkilemez, bantların kendisi yine `scoresVisibleToRater` ile gizlidir.
 */
function gradingView(
  ctx: ServiceContext,
  viewer: Viewer,
  assignment: StoredAssignment,
  work: StoredSubmissionWork,
  grading: Grading,
  version: VersionRow,
) {
  if (viewer.kind === 'learner') return null
  const resolution = resolutionOf(grading, version)
  const deadline = gradingDeadlineOf(assignment, work.submission, version.number)
  return {
    status: resolution.status,
    missing: resolution.status === 'pending' ? resolution.missing : null,
    secondRatingRequested: secondRatingFor(grading, version),
    disagreementCriterionIds: resolution.status === 'disagreement' ? resolution.criterionIds : [],
    dueAt: deadline === null ? null : gradingDueAt(deadline, version),
    overdue: deadline !== null && gradingOverdue({ deadline, version, resolution, now: ctx.now }),
  }
}

// TODO(institution-settings): Kurum takvimi (resmî tatiller) kurum ayarına gelince itiraz süresi
// onu kullanır; şimdilik yalnız hafta sonu sayılmaz.
export const APPEAL_HOLIDAYS: readonly string[] = []

/**
 * İtirazın son anı (DOM-BEC-025; core `appealDeadline`): yalnız değerlendirme türünde ve sonuç
 * duyurulduysa; kursiyer ve veliye duyurudan önce `null` (puanlanmamışla aynı; DOM-BEC-045).
 * Sürüme itiraz edildiyse `null`: itiraz sürüm başına birdir; kabul edilen itirazın yeni son
 * puanı yeni bir itiraz süresi açmaz.
 */
function appealDeadlineOf(
  ctx: ServiceContext,
  viewer: Viewer,
  assignment: StoredAssignment,
  grading: Grading,
  version: VersionRow,
) {
  if (assignment.kind !== 'evaluation') return null
  if (grading.appeals.some((row) => row.submissionVersionId === version.id)) return null
  const resolution =
    viewer.kind === 'learner'
      ? releasedResolution(grading, version, ctx.now)
      : resolutionOf(grading, version)
  if (resolution === null || resolution.status !== 'settled') return null
  return appealDeadline(resolution.settledAt, APPEAL_HOLIDAYS)
}

/** Sürümün itirazı; itiraz yalnız duyurudan sonra açıldığı için kursiyere sızma yoktur. */
function appealView(viewer: Viewer, grading: Grading, version: VersionRow) {
  const appeal = grading.appeals.find((row) => row.submissionVersionId === version.id)
  if (appeal === undefined) return null
  return {
    id: appeal.id,
    reason: appeal.reason,
    filedAt: appeal.filedAt,
    outcome: appeal.outcome,
    decidedAt: appeal.decidedAt,
    decisionReason: appeal.decisionReason,
    // Karar yalnız personelin yazmasıdır (`If-Match`); kursiyer ve veli sürümü kullanmaz.
    rowVersion: viewer.kind === 'learner' ? null : appeal.rowVersion,
  }
}

/**
 * Teslim özetleri (liste ve puanlama kuyruğu): puanlar tek seferde yüklenir. Her satırın ataması
 * `assignments`'ta olmalıdır.
 */
export async function listSummaries(
  db: Database,
  ctx: ServiceContext,
  viewer: Viewer,
  assignments: ReadonlyMap<string, StoredAssignment>,
  rows: readonly StoredSubmissionWork[],
) {
  const book = await loadGrading(
    db,
    ctx,
    rows.map((work) => work.submission.id),
  )
  return rows.map((work) => {
    const assignment = assignments.get(work.submission.assignmentId)
    if (assignment === undefined) throw new Error('submission summary without its assignment')
    return summaryView(viewer, ctx, book, assignment, work)
  })
}

// --- Okuma --------------------------------------------------------------------------------

/**
 * Öğrenci ve velide atama artık görünmüyorsa (sınıf değişimi) yalnız kendi/çocuğunun teslimi
 * varken okunur; hiç teslim yoksa 404 (atamanın varlığı sızmaz).
 */
async function assertLearnerReach(
  ctx: ServiceContext,
  viewer: Viewer,
  assignment: StoredAssignment,
  readable: ReadableLearners,
) {
  if (viewer.kind !== 'learner' || visible(viewer, assignment)) return
  for (const learnerId of ownedLearners(readable))
    if (await loadSubmission(ctx.db, ctx.institutionId, assignment.id, learnerId)) return
  throw new NotFoundError()
}

export interface TaskSubmissionListInput {
  assignmentId: string
  learnerId?: string | undefined
  page: number
  pageSize: number
}

/** Atamanın teslimleri, okuma kapsamında (DOM-YTK-028); kapalı atama 404. */
export async function listTaskSubmissions(ctx: ServiceContext, input: TaskSubmissionListInput) {
  const viewer = await viewerOf(ctx)
  const assignment = await findAssignment(ctx.db, ctx.institutionId, input.assignmentId)
  if (!assignment) throw new NotFoundError()
  const readable = readableLearners(viewer, assignment)
  if (readable.kind === 'none') throw new NotFoundError()
  await assertLearnerReach(ctx, viewer, assignment, readable)
  const { rows, total } = await listSubmissions(ctx.db, ctx.institutionId, {
    assignmentId: assignment.id,
    learnerIds: learnerFilter(readable, input.learnerId),
    page: input.page,
    pageSize: input.pageSize,
  })
  return {
    total,
    items: await listSummaries(ctx.db, ctx, viewer, new Map([[assignment.id, assignment]]), rows),
  }
}

/** Tek teslim ve bütün sürümleri (taslak asla); kapsam dışı veya başka kurumun kaydı 404. */
export async function getTaskSubmission(ctx: ServiceContext, submissionId: string) {
  const viewer = await viewerOf(ctx)
  const work = await findSubmission(ctx.db, ctx.institutionId, submissionId)
  const assignment =
    work && (await findAssignment(ctx.db, ctx.institutionId, work.submission.assignmentId))
  if (!work || !assignment || !canReadLearner(viewer, assignment, work.submission.learnerId))
    throw new NotFoundError()
  return detailView(ctx.db, ctx, viewer, assignment, work)
}

function draftView(assignment: StoredAssignment, draft: DraftRow) {
  return {
    assignmentId: assignment.id,
    body: draft.body,
    revision: draft.revision,
    savedAt: draft.savedAt,
    wordCount: wordsOf(settingsOf(assignment), draft.body),
  }
}

/**
 * Öğrencinin kendi taslağı (IST-047); taslak yoksa `null`. Atama artık öğrenciyi hedeflemiyorsa
 * (sınıf değişimi) taslak varken okunur, yoksa 404. Veli 403 (`ownLearner`); taslağın sahibi core
 * `canReadDraft` ile de denetlenir (yalnız `ogrenci` ve kendi taslağı; ADR 0004 karar 6).
 */
export async function getTaskDraft(ctx: ServiceContext, assignmentId: string) {
  const viewer = await viewerOf(ctx)
  const learnerId = ownLearner(viewer)
  const assignment = await findAssignment(ctx.db, ctx.institutionId, assignmentId)
  if (!assignment) throw new NotFoundError()
  const draft = await loadDraft(ctx.db, ctx.institutionId, assignment.id, learnerId)
  if (draft === null) {
    if (!visible(viewer, assignment)) throw new NotFoundError()
    return null
  }
  const links = await listMembershipLinks(ctx.db, ctx.institutionId, ctx.actor.membershipId)
  if (!canReadDraft({ role: ctx.actor.role, links, userId: ctx.actor.userId }, draft))
    throw new NotFoundError()
  return draftView(assignment, draft)
}

// --- Yazma --------------------------------------------------------------------------------

function written(out: { body?: unknown }, statusCode: number) {
  return () => {
    if (out.body === undefined) throw new Error('task submission was not written')
    return { statusCode, body: out.body }
  }
}

/** Yazılabilir atama: arşivsiz ve öğrenciyi şu an hedefliyor; değilse 404 (kapsam). */
async function writableAssignment(tx: Database, ctx: ServiceContext, viewer: Viewer, id: string) {
  const assignment = await findAssignment(tx, ctx.institutionId, id)
  if (!assignment || assignment.archivedAt !== null) throw new NotFoundError()
  return { assignment, learnerId: targetedLearner(viewer, assignment) }
}

export interface DraftWriteInput {
  assignmentId: string
  body: string
  /** `If-Match`; yalnız henüz taslak yokken atlanabilir (ilk kayıt). */
  expectedRevision: number | null
}

/**
 * Taslağın otomatik kaydı (IST-047; core `planDraftSave`). Sıra: kapsam 404 → taslak varken
 * `If-Match` yoksa 400 `if_match_required` → eski revizyon 409 `draft_conflict` → kural (teslim
 * kapandıysa 422 `submission_closed`, yazma dışı görevde 422 `draft_not_supported`). Eşzamanlı iki
 * kayıttan biri 409 alır (kurum kilidi ve depoda revizyon koşulu). Denetime yazılmaz.
 */
export async function saveTaskDraft(
  ctx: ServiceContext,
  input: DraftWriteInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  type Save = { assignment: StoredAssignment; draft: DraftRow }
  return runCommand<Save>(
    ctx,
    {
      action: 'task_draft.save',
      collections: [],
      entity: { type: 'task_draft', id: input.assignmentId },
      load: async (tx) => {
        const { assignment, learnerId } = await writableAssignment(
          tx,
          ctx,
          viewer,
          input.assignmentId,
        )
        const current = await loadDraft(tx, ctx.institutionId, assignment.id, learnerId)
        if (current !== null && input.expectedRevision === null)
          throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
        const expectedRevision = input.expectedRevision ?? 0
        if (expectedRevision !== (current?.revision ?? 0))
          throw new AppError(
            409,
            'draft_conflict',
            'Taslak başka bir pencerede değişti; sayfayı yenileyip devam edin.',
          )
        const settings = settingsOf(assignment)
        return {
          run: (_state, tools) => {
            if (settings === null)
              throw new DomainError('draft_not_supported', 'Taslak yalnız yazma görevinde tutulur.')
            return {
              assignment,
              draft: planDraftSave({
                settings,
                deadline: assignment.deadline,
                draft: current,
                learnerId,
                input: { body: input.body, expectedRevision },
                now: tools.now,
              }),
            }
          },
        }
      },
      after: async (tx, { assignment, draft }) => {
        const saved = await saveDraft(tx, ctx.institutionId, assignment.id, draft, ctx.now)
        out.body = { data: draftView(assignment, saved) }
      },
    },
    written(out, 200),
    idempotency,
  )
}

export type SubmissionVersionBody =
  | { submissionKind: 'text'; body: string }
  | { submissionKind: 'file'; fileIds: string[] }
  | { submissionKind: 'audio'; recordingFileId: string }

/**
 * Yeni teslim sürümü (DOM-BEC-040, 044, 046; IST-051; core `planSubmissionVersion`). İlk
 * gönderim kursiyerin tek teslim kaydını açar; sonrakiler değişmez sürüm ekler. Pencere ve geç
 * kabul core'dandır (sürümün süresi `deadlineForVersion`). Sınır dolunca 422
 * `version_limit_reached`, teslim kapandıysa 422 `submission_closed`, otomatik puanlı görevde
 * 422 `submission_not_expected`, dosyalı/sesli teslim 422 `submission_kind_unavailable`. Sözcük
 * sınırı dışındaki metin uyarıyla kabul edilir (DOM-BEC-046). Denetime alan adlarıyla yazılır.
 */
export async function submitTaskSubmission(
  ctx: ServiceContext,
  assignmentId: string,
  body: SubmissionVersionBody,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  const newSubmissionId = randomUUID()
  type Submit = {
    assignment: StoredAssignment
    learnerId: string
    work: StoredSubmissionWork | null
    plan: ReturnType<typeof planSubmissionVersion>
  }
  return runCommand<Submit>(
    ctx,
    {
      action: 'task_submission.submit',
      collections: [],
      entity: { type: ENTITY, id: assignmentId },
      load: async (tx) => {
        const { assignment, learnerId } = await writableAssignment(tx, ctx, viewer, assignmentId)
        const settings = settingsOf(assignment)
        if (settings === null)
          throw new RuleViolationError(
            'submission_not_expected',
            'Bu görev teslim beklemiyor; deneme olarak çözülür.',
          )
        // TODO(F3c2-files): Dosyalı ve sesli teslim `files` tablosu gelince açılır.
        if (settings.submissionKind !== 'text' || body.submissionKind !== 'text')
          throw new RuleViolationError(
            'submission_kind_unavailable',
            'Dosyalı ve sesli teslim henüz açık değil.',
          )
        const work = await loadSubmission(tx, ctx.institutionId, assignment.id, learnerId)
        const versions = work?.versions ?? []
        const grading =
          work === null
            ? NO_GRADING
            : ((await loadGrading(tx, ctx, [work.submission.id])).bySubmission.get(
                work.submission.id,
              ) ?? NO_GRADING)
        const graded = gradedVersionNumbers(versions, grading.scores)
        // Geri bildirim açılmamış son sürüm kursiyere puanlanmamış görünür (`allowanceOf`).
        const latest = versions.at(-1)
        const hidden =
          latest !== undefined &&
          graded.includes(latest.number) &&
          !latestFeedbackReleased({ versions }, grading, ctx.now)
            ? latest.number
            : null
        const nextNumber = (versions.at(-1)?.number ?? 0) + 1
        const deadline = deadlineForVersion(
          assignment.deadline,
          work?.submission ?? null,
          nextNumber,
        )
        return {
          run: (_state, tools) => {
            const plan = (gradedVersionNumbers: readonly number[]) =>
              planSubmissionVersion({
                settings,
                deadline,
                submission: work?.submission ?? null,
                versions,
                gradedVersionNumbers,
                input: body,
                files: [],
                now: tools.now,
              })
            try {
              return { assignment, learnerId, work, plan: plan(graded) }
            } catch (error) {
              if (
                hidden === null ||
                !(error instanceof DomainError) ||
                error.code !== 'resubmission_not_requested'
              )
                throw error
              // Geri bildirim açılmadan "puanlandı" sızmasın (DOM-BEC-045): kursiyerin
              // gördüğü hakla (puanlanmamış gibi) yeniden denenir; o da reddediyorsa ret
              // puanlamadan öncekiyle aynıdır. Yalnız o hak açıksa genel kilit döner; ikinci
              // puanlama zamanlaması (`secondRatingFor`) bu durumu kapatır.
              plan(graded.filter((number) => number !== hidden))
              throw new DomainError('submission_locked', LOCKED_MESSAGE, { kind: 'conflict' })
            }
          },
        }
      },
      after: async (tx, { assignment, learnerId, work, plan }) => {
        const submissionId = work?.submission.id ?? newSubmissionId
        if (plan.createSubmission)
          await insertSubmission(
            tx,
            ctx.institutionId,
            { id: submissionId, assignmentId: assignment.id, learnerId },
            ctx.now,
          )
        // Yeniden teslim isteği yeni sürümle kendiliğinden kapanır: istek son sürümden eski kalır
        // (core `versionAllowance`); ayrıca satır güncellenmez.
        await insertSubmissionVersion(
          tx,
          ctx.institutionId,
          submissionId,
          { id: randomUUID(), ...plan.version },
          ctx.now,
        )
        await auditWork(tx, ctx, 'task_submission.submit', { type: ENTITY, id: submissionId }, [
          'body',
          'versionNumber',
          'submittedAt',
        ])
        const saved = await findSubmission(tx, ctx.institutionId, submissionId)
        if (!saved) throw new Error('task submission disappeared after write')
        out.body = { data: await detailView(tx, ctx, viewer, assignment, saved) }
      },
    },
    written(out, 201),
    idempotency,
  )
}
