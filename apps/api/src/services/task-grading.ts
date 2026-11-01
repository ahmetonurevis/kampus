import { randomUUID } from 'node:crypto'

import { seededRandom } from '@kampus/school-core/content/resource.ts'
import {
  deadlineForVersion,
  planResubmissionRequest,
} from '@kampus/school-core/skills/assignment.ts'
import {
  gradingDueAt,
  gradingOverdue,
  pickSecondRatingSample,
  planAppeal,
  planAppealDecision,
  planRubricScore,
  releasesFeedback,
  type AppealDraft,
  type AppealRow,
  type RaterRole,
  type RubricScoreDraft,
  type RubricScoreInput,
} from '@kampus/school-core/skills/rubric.ts'
import { isClosed } from '@kampus/school-core/skills/scoring.ts'
import { versionAllowance } from '@kampus/school-core/skills/submission.ts'
import { notifyStudentEvent } from '@kampus/school-core/lib/notifications.ts'

import type { Database } from '../db/client.ts'
import {
  decideAppeal,
  findAssignment,
  findRubricVersion,
  findSubmission,
  insertAppeal,
  insertResubmissionRequest,
  insertRubricScore,
  insertSecondRatingRequest,
  listAwaitingScore,
  listSubmittedIds,
  markSecondRatingSampled,
  touchSubmission,
  type StoredAssignment,
  type StoredSubmissionWork,
} from '../db/skills.ts'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RuleViolationError,
} from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { listMembershipLinks } from './memberships.ts'
import { studentNotice } from './notifications.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { viewerOf, visible, type Viewer } from './task-assignments.ts'
import {
  APPEAL_HOLIDAYS,
  detailView,
  gradingDeadlineOf,
  listSummaries,
  loadGrading,
  resolutionOf,
  sampleLocked,
  secondRatingFor,
  type Grading,
} from './task-submissions.ts'
import { auditWork, canReadLearner } from './task-work.ts'

/**
 * Yazma tesliminin öğretmen puanlaması, ikinci puanlama, itiraz ve puanlama kuyruğu (F4b3b1,
 * F4b3b2a; ADR 0004 karar 6; docs/domain/beceri-gelisimi.md DOM-BEC-020…025, 040, 045;
 * yetki-ve-kapsam.md DOM-YTK-028).
 *
 * Kurallar core'dadır: puan `planRubricScore` (atamanın sabitlediği rubrik sürümü, yalnız son
 * sürüm, kriterlerin tamamı ve yalnızları, hedefin altındaki banda yorum, sürüm ve rol başına tek
 * puan, ilk ve ikinci puanlayıcı ayrı kişi), yeniden teslim `planResubmissionRequest`, örneklem
 * `pickSecondRatingSample`, itiraz `planAppeal` ve `planAppealDecision`, puanlama süresi
 * `gradingDueAt`/`gradingOverdue`. Toplam ve son puan saklanmaz, her okumada hesaplanır.
 *
 * İkinci puanlamanın zamanı (DOM-BEC-024; core `TODO(beceri-ikinci-puan-orneklem)` kararı):
 * ikinci puanlama yalnız kursiyer yeni sürüm gönderemezken istenir. Örneklemli görevde
 * (`secondRatingPercent > 0`) örneklem teslim penceresi (geç kabul dahil) kapanınca açık uçla bir
 * kez çekilir ve o çekilmeden ilk puan verilmez; böylece kesinleşip kursiyere açılmış bir puan
 * sonradan "ikinci puan bekliyor"a dönmez. Elle istek de pencere kapanınca veya sürüm hakkı
 * dolunca ve sürümün puanı kesinleşmeden yapılır. İstek, istendiği anda var olan sürümleri kapsar
 * (`secondRatingFor`). Sonuç: açılmamış puanlı son sürüm yalnız kursiyerin zaten yeni sürüm
 * gönderemediği teslimde bulunur; kursiyerin yanıtı ve yeni sürüm reddi puanlama ve ikinci puan
 * isteminden önceki ve sonraki hâliyle aynıdır (DOM-BEC-045).
 *
 * Puanlayan ve karar veren, atamayı gören öğretmen veya yöneticidir; yönetici koordinatör
 * sayılmaz, ilk puanı görmez. Sıra: kapsam 404 → rol 403 → `If-Match` 409 → core kuralı. Puan,
 * istek ve itiraz değişmez satırlardır (itiraz kararı satırın tek değişikliğidir); teslim kaydının
 * satır sürümü artar. Tek transaction ve kurum kilidi `runCommand`'dadır. Geri bildirim, itiraz
 * gerekçesi ve öğrenci kimliği loglanmaz; denetime yalnız alan adları yazılır.
 */

// TODO(core-atama-yetki): "Atamayı gören öğretmen veya yönetici puanlar" kuralı core yetki
// tablosunda (`lib/authorize.ts`) yok; web ve mobil aynı kuralı çalıştırsın diye core'a taşınır.
// TODO(F4b3b2b): Koordinatör son puanı (DOM-YTK-027; uyuşmazlıkta), yeniden puanlama ve anahtar
// düzeltmesi (DOM-BEC-011) ve not aktarımı bu servise eklenmedi.

const ENTITY = 'task_submission'

/**
 * Puanlayan kişi: yönetici ya da atamayı gören öğretmen. Öğretmen atamayı görmüyorsa 404
 * (kapsam; varlık sızmaz); öğrenci ve veli 403 (rota da reddeder; servis tek başına güvenli).
 */
function assertGrader(viewer: Viewer, assignment: StoredAssignment) {
  switch (viewer.kind) {
    case 'admin':
      return
    case 'teacher':
      if (!visible(viewer, assignment)) throw new NotFoundError()
      return
    case 'learner':
      throw new ForbiddenError()
    default:
      return viewer satisfies never
  }
}

type Graded = { work: StoredSubmissionWork; assignment: StoredAssignment; grading: Grading }

async function gradingOf(tx: Database, ctx: ServiceContext, submissionId: string) {
  const book = await loadGrading(tx, ctx, [submissionId])
  const grading = book.bySubmission.get(submissionId)
  if (grading === undefined) throw new Error('grading book without its submission')
  return grading
}

/**
 * Puanlanacak teslim, ataması ve puanlama durumu: başka kurumun, arşivli veya olmayan teslim 404;
 * öğretmen atamayı görmüyorsa 404; öğrenci/veli 403; satır sürümü `If-Match`'ten farklıysa 409.
 */
async function gradableSubmission(
  tx: Database,
  ctx: ServiceContext,
  viewer: Viewer,
  submissionId: string,
  expectedVersion: number,
): Promise<Graded> {
  const work = await findSubmission(tx, ctx.institutionId, submissionId)
  const assignment =
    work && (await findAssignment(tx, ctx.institutionId, work.submission.assignmentId))
  // Arşivli atamada yazma kapalıdır, okuma açık kalır: öğrenci yazmalarıyla aynı kalıp
  // (`task-submissions.ts` `writableAssignment`, `task-attempts.ts`; kapsam 404).
  if (!work || !assignment || assignment.archivedAt !== null) throw new NotFoundError()
  assertGrader(viewer, assignment)
  if (work.submission.rowVersion !== expectedVersion) throw new ConflictError()
  return { work, assignment, grading: await gradingOf(tx, ctx, work.submission.id) }
}

/** Gövdedeki sürüm numarasının sürümü; bilinmeyen numara 404 (core `submission_version_not_found`). */
function versionOf(work: StoredSubmissionWork, versionNumber: number) {
  const version = work.versions.find((v) => v.number === versionNumber)
  if (version === undefined)
    throw new AppError(404, 'submission_version_not_found', 'Teslim sürümü bulunamadı.')
  return version
}

function latestOnly(work: StoredSubmissionWork, versionNumber: number) {
  const version = versionOf(work, versionNumber)
  if (version.number !== work.versions.at(-1)?.number)
    throw new AppError(409, 'version_not_latest', 'Yalnız son sürüm için istenir.')
  return version
}

function written(out: { body?: unknown }, statusCode = 201) {
  return () => {
    if (out.body === undefined) throw new Error('task grading was not written')
    return { statusCode, body: out.body }
  }
}

/** Yazmadan sonra teslimin güncel görünümü. */
async function readBack(
  tx: Database,
  ctx: ServiceContext,
  viewer: Viewer,
  assignment: StoredAssignment,
  submissionId: string,
) {
  const saved = await findSubmission(tx, ctx.institutionId, submissionId)
  if (!saved) throw new Error('task submission disappeared after write')
  return { data: await detailView(tx, ctx, viewer, assignment, saved) }
}

function rubricOf(assignment: StoredAssignment) {
  if (assignment.rubricVersionId === null)
    throw new RuleViolationError('rubric_not_assigned', 'Bu görev rubrikle puanlanmaz.')
  return assignment.rubricVersionId
}

/**
 * Örneklemli görevde (DOM-BEC-024) örneklem çekilmeden ilk puan verilmez. Son tarihsiz görevde
 * örneklem çekilemez, kilit de yoktur (`sampleLocked`); ikinci puan yalnız elle istenir.
 */
function assertSampleDrawn(assignment: StoredAssignment) {
  if (sampleLocked(assignment) && assignment.secondRatingSampledAt === null)
    throw new AppError(
      409,
      'second_rating_sample_pending',
      'Önce ikinci puanlama örneklemi seçilmeli; örneklem teslim süresi bitince seçilir.',
    )
}

const WINDOW_OPEN_MESSAGE =
  'İkinci puanlama, kursiyer yeni sürüm gönderemez olunca istenir (teslim süresi bitince veya sürüm hakkı dolunca).'

/**
 * Kursiyer yeni sürüm gönderemiyor mu, puanlamadan bağımsız olarak: sıradaki sürümün penceresi
 * kapandı ya da sürüm hakkı doldu. İkinci puanlama yalnız bu durumda istenir (DOM-BEC-024, 045).
 */
function assertLearnerCannotSubmit(
  assignment: StoredAssignment,
  work: StoredSubmissionWork,
  now: Date,
) {
  const settings = assignment.submission
  const next = deadlineForVersion(
    assignment.deadline,
    work.submission,
    (work.versions.at(-1)?.number ?? 0) + 1,
  )
  if (settings === null || isClosed(next, now)) return
  const allowance = versionAllowance({
    settings,
    submission: work.submission,
    versions: work.versions,
    gradedVersionNumbers: [],
  })
  if (allowance.blockedBy === 'limit') return
  throw new AppError(409, 'second_rating_window_open', WINDOW_OPEN_MESSAGE)
}

export interface ScoreWriteInput {
  submissionId: string
  expectedVersion: number
  versionNumber: number
  score: RubricScoreInput
}

/**
 * Öğretmenin rubrik puanı ve geri bildirimi (DOM-BEC-020…024; core `planRubricScore`). `first`:
 * ilk puan; örneklemli görevde örneklem çekilmeden 409 `second_rating_sample_pending`. `second`:
 * ikinci puan; yalnız sürüm ikinci puanlama isteğinin kapsamındaysa (409
 * `second_rating_not_requested`) ve ilk puanı vermeyen kişiden (409 `rater_not_independent`).
 * Puanlayıcı ilk puanı görmez (`scoresVisibleToRater`). Puan değişmez satırdır.
 */
async function writeScore(
  ctx: ServiceContext,
  role: Extract<RaterRole, 'first' | 'second'>,
  input: ScoreWriteInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  type Score = Graded & { draft: RubricScoreDraft }
  const action = role === 'first' ? 'task_submission.score' : 'task_submission.second_score'
  return runCommand<Score>(
    ctx,
    {
      action,
      // Bildirim yalnız eklenir; var olan bildirimler yüklenmez (F6a).
      collections: ['notifications'],
      loadScope: { notifications: { ids: [] } },
      entity: { type: ENTITY, id: input.submissionId },
      load: async (tx) => {
        const graded = await gradableSubmission(
          tx,
          ctx,
          viewer,
          input.submissionId,
          input.expectedVersion,
        )
        const { work, assignment, grading } = graded
        const rubricVersionId = rubricOf(assignment)
        if (role === 'first') assertSampleDrawn(assignment)
        const rubricVersion = await findRubricVersion(tx, ctx.institutionId, rubricVersionId)
        if (rubricVersion === null) throw new NotFoundError()
        // Bilinmeyen sürüm numarası core'un `submission_version_not_found` (404) yoluna düşer.
        const version = work.versions.find((v) => v.number === input.versionNumber)
        const notice = await studentNotice(tx, ctx, work.submission.learnerId)
        return {
          run: (state, tools) => {
            const secondRatingRequested = secondRatingFor(grading, version)
            const draft = planRubricScore({
              rubricVersion,
              assignmentRubricVersionId: rubricVersionId,
              versions: work.versions,
              submissionVersionId: version?.id ?? '',
              scores: grading.scores,
              rater: { userId: ctx.actor.userId, coordinator: false },
              raterRole: role,
              secondRatingRequested,
              input: input.score,
              now: tools.now,
            })
            // Puanı kesinleştiren yazma geri bildirimi o anda açar (DOM-BEC-045): öğrenciye ve
            // (18 yaş altında) veliye uygulama içi bildirim aynı transaction'da eklenir. Bildirim
            // puan ve geri bildirim metni taşımaz (DOM-ILT-023).
            const released = releasesFeedback({
              scores: grading.scores.filter(
                (s) => s.submissionVersionId === draft.submissionVersionId,
              ),
              added: { id: 'pending', ...draft },
              secondRatingRequested,
            })
            if (notice.enabled && released)
              notifyStudentEvent(
                state,
                {
                  kind: 'feedback_released',
                  studentId: work.submission.learnerId,
                  subjectId: work.submission.id,
                  minor: notice.minor,
                },
                tools.makeId,
                tools.now,
              )
            return { ...graded, draft }
          },
        }
      },
      after: async (tx, { work, assignment, draft }) => {
        await insertRubricScore(tx, ctx.institutionId, { id: randomUUID(), ...draft }, ctx.now)
        await touchSubmission(tx, ctx.institutionId, work.submission, ctx.now)
        await auditWork(tx, ctx, action, { type: ENTITY, id: work.submission.id }, [
          'criteria',
          'overallComment',
          'scoredAt',
        ])
        out.body = await readBack(tx, ctx, viewer, assignment, work.submission.id)
      },
    },
    written(out),
    idempotency,
  )
}

/** İlk puan (DOM-BEC-020…023): aynı sürümün ikinci ilk puanı 409 `rubric_score_exists`. */
export function scoreTaskSubmission(
  ctx: ServiceContext,
  input: ScoreWriteInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return writeScore(ctx, 'first', input, idempotency)
}

/** İkinci puan (DOM-BEC-024): ilk puanı görmeden, ilk puanlayıcıdan başka kişi verir. */
export function secondScoreTaskSubmission(
  ctx: ServiceContext,
  input: ScoreWriteInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  return writeScore(ctx, 'second', input, idempotency)
}

export interface ResubmissionWriteInput {
  submissionId: string
  expectedVersion: number
  request: { versionNumber: number; dueAt: string }
}

/**
 * Yeniden teslim isteği (DOM-BEC-040; core `planResubmissionRequest`): yalnız puanı kesinleşen son
 * sürüm için, önümüzdeki 14 gün içinde kendi son tarihiyle. Puanlanmamış veya kesinleşmemiş
 * (ikinci puan, uyuşmazlık) sürüm 409 `resubmission_not_graded`, aynı sürüme ikinci istek 409
 * `resubmission_exists`. Kursiyer sonra yeni sürüm gönderebilir; yeni sürüm hakka sayılmaz.
 */
export async function requestTaskResubmission(
  ctx: ServiceContext,
  input: ResubmissionWriteInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  type Request = Graded & { versionNumber: number; dueAt: string }
  return runCommand<Request>(
    ctx,
    {
      action: 'task_submission.request_resubmission',
      collections: [],
      entity: { type: ENTITY, id: input.submissionId },
      load: async (tx) => {
        const graded = await gradableSubmission(
          tx,
          ctx,
          viewer,
          input.submissionId,
          input.expectedVersion,
        )
        const { work, grading } = graded
        return {
          run: (_state, tools) => {
            const plan = planResubmissionRequest({
              submission: work.submission,
              versions: work.versions,
              scores: grading.scores,
              secondRatingRequested: secondRatingFor(grading, work.versions.at(-1)),
              input: input.request,
              now: tools.now,
            })
            if (plan.resubmissionRequestedForVersion === null || plan.resubmissionDueAt === null)
              throw new Error('resubmission plan is incomplete')
            return {
              ...graded,
              versionNumber: plan.resubmissionRequestedForVersion,
              dueAt: plan.resubmissionDueAt,
            }
          },
        }
      },
      after: async (tx, { work, assignment, versionNumber, dueAt }) => {
        await insertResubmissionRequest(
          tx,
          ctx.institutionId,
          work.submission.id,
          {
            versionNumber,
            dueAt,
            requestedByUserId: ctx.actor.userId,
            requestedAt: ctx.now.toISOString(),
          },
          ctx.now,
        )
        await touchSubmission(tx, ctx.institutionId, work.submission, ctx.now)
        await auditWork(
          tx,
          ctx,
          'task_submission.request_resubmission',
          { type: ENTITY, id: work.submission.id },
          ['versionNumber', 'dueAt'],
        )
        out.body = await readBack(tx, ctx, viewer, assignment, work.submission.id)
      },
    },
    written(out),
    idempotency,
  )
}

// --- İkinci puanlama --------------------------------------------------------------------------

export interface SecondRatingRequestInput {
  submissionId: string
  expectedVersion: number
  versionNumber: number
}

/**
 * Elle ikinci puanlama isteği (DOM-BEC-024: "diğer görevlerde isteğe bağlı"). Yalnız son sürüm
 * (409 `version_not_latest`), rubrikli görev (422 `rubric_not_assigned`), teslim başına bir istek
 * (409 `second_rating_exists`), sürümün puanı kesinleşmeden (409 `second_rating_too_late`;
 * kursiyere açılmış puan geri alınmaz) ve kursiyer yeni sürüm gönderemezken (409
 * `second_rating_window_open`). Kursiyerin yanıtı istekten etkilenmez (DOM-BEC-045).
 */
export async function requestSecondRating(
  ctx: ServiceContext,
  input: SecondRatingRequestInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  return runCommand<Graded>(
    ctx,
    {
      action: 'task_submission.request_second_rating',
      collections: [],
      entity: { type: ENTITY, id: input.submissionId },
      load: async (tx) => {
        const graded = await gradableSubmission(
          tx,
          ctx,
          viewer,
          input.submissionId,
          input.expectedVersion,
        )
        const { work, assignment, grading } = graded
        rubricOf(assignment)
        const version = latestOnly(work, input.versionNumber)
        if (grading.secondRatingRequestedAt !== null)
          throw new AppError(
            409,
            'second_rating_exists',
            'Bu teslim için ikinci puanlama zaten istendi.',
          )
        if (resolutionOf(grading, version).status === 'settled')
          throw new AppError(
            409,
            'second_rating_too_late',
            'Puanı kesinleşen sürüm için ikinci puanlama istenemez.',
          )
        assertLearnerCannotSubmit(assignment, work, ctx.now)
        return { run: () => graded }
      },
      after: async (tx, { work, assignment }) => {
        await insertSecondRatingRequest(
          tx,
          ctx.institutionId,
          {
            submissionId: work.submission.id,
            source: 'manual',
            requestedByUserId: ctx.actor.userId,
            requestedAt: ctx.now.toISOString(),
          },
          ctx.now,
        )
        await touchSubmission(tx, ctx.institutionId, work.submission, ctx.now)
        await auditWork(
          tx,
          ctx,
          'task_submission.request_second_rating',
          { type: ENTITY, id: work.submission.id },
          ['source', 'requestedAt'],
        )
        out.body = await readBack(tx, ctx, viewer, assignment, work.submission.id)
      },
    },
    written(out),
    idempotency,
  )
}

export interface SecondRatingSampleInput {
  assignmentId: string
  expectedVersion: number
}

/**
 * İkinci puanlama örneklemi (DOM-BEC-024; core `pickSecondRatingSample`): örneklemli görevde
 * (`secondRatingPercent > 0`, aksi 422 `second_rating_not_configured`) teslim penceresi (geç
 * kabul dahil) kapanınca (aksi 409 `second_rating_window_open`; son tarihsiz görevde pencere
 * kapanmaz, 409 `second_rating_sample_unavailable`) bütün teslimlerden bir kez
 * (409 `second_rating_sample_drawn`) çekilir: oranın yukarı yuvarlanmışı, en az bir teslim.
 * Rastgelelik atama kimliğiyle tohumlanır (tekrarlanabilir). `If-Match` atamanın `rowVersion`'ıdır.
 */
export async function drawSecondRatingSample(
  ctx: ServiceContext,
  input: SecondRatingSampleInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  type Sample = { assignment: StoredAssignment; pool: string[]; picked: string[] }
  return runCommand<Sample>(
    ctx,
    {
      action: 'task_assignment.second_rating_sample',
      collections: [],
      entity: { type: 'task_assignment', id: input.assignmentId },
      load: async (tx) => {
        const assignment = await findAssignment(tx, ctx.institutionId, input.assignmentId)
        if (!assignment || assignment.archivedAt !== null) throw new NotFoundError()
        assertGrader(viewer, assignment)
        if (assignment.rowVersion !== input.expectedVersion) throw new ConflictError()
        if (assignment.rubricVersionId === null || assignment.secondRatingPercent === 0)
          throw new RuleViolationError(
            'second_rating_not_configured',
            'Bu görevde ikinci puanlama örneklemi yok.',
          )
        if (assignment.secondRatingSampledAt !== null)
          throw new AppError(
            409,
            'second_rating_sample_drawn',
            'Bu görevin ikinci puanlama örneklemi zaten seçildi.',
          )
        if (assignment.deadline.dueAt === null)
          throw new AppError(
            409,
            'second_rating_sample_unavailable',
            'Son tarihi olmayan görevde örneklem seçilmez; ikinci puanı teslim bazında isteyin.',
          )
        if (!isClosed(assignment.deadline, ctx.now))
          throw new AppError(
            409,
            'second_rating_window_open',
            'Örneklem, teslim süresi (geç kabul dahil) bitince seçilir.',
          )
        const pool = await listSubmittedIds(tx, ctx.institutionId, assignment.id)
        return {
          run: () => ({
            assignment,
            pool,
            picked: pickSecondRatingSample(
              pool,
              assignment.secondRatingPercent,
              seededRandom(assignment.id),
            ),
          }),
        }
      },
      after: async (tx, { assignment, pool, picked }) => {
        const rowVersion = await markSecondRatingSampled(tx, ctx.institutionId, assignment, ctx.now)
        for (const submissionId of picked) {
          await insertSecondRatingRequest(
            tx,
            ctx.institutionId,
            {
              submissionId,
              source: 'sample',
              requestedByUserId: null,
              requestedAt: ctx.now.toISOString(),
            },
            ctx.now,
          )
          const work = await findSubmission(tx, ctx.institutionId, submissionId)
          if (!work) throw new Error('sampled submission disappeared')
          await touchSubmission(tx, ctx.institutionId, work.submission, ctx.now)
        }
        await auditWork(
          tx,
          ctx,
          'task_assignment.second_rating_sample',
          { type: 'task_assignment', id: assignment.id },
          ['secondRatingSampledAt', 'secondRatingRequests'],
        )
        out.body = {
          data: {
            assignmentId: assignment.id,
            sampledAt: ctx.now.toISOString(),
            percent: assignment.secondRatingPercent,
            submissionCount: pool.length,
            submissionIds: picked,
            rowVersion,
          },
        }
      },
    },
    written(out),
    idempotency,
  )
}

// --- İtiraz ---------------------------------------------------------------------------------

export interface AppealWriteInput {
  submissionId: string
  versionNumber: number
  reason: string
}

/**
 * Sonuç itirazı (DOM-BEC-025; core `planAppeal`): kursiyer veya velisi, sonuç duyurusundan
 * (geri bildirimin açılması) sonra 5 iş günü içinde, gerekçeyle; sürüm başına bir (409
 * `appeal_exists`, eşzamanlıda benzersiz indeks). Duyurudan önce 409 `appeal_not_open` döner:
 * puanlanmamış ve açılmamış puanlı sürümde aynı yanıt (DOM-BEC-045). Alıştırmada 422
 * `appeal_not_available`, süre geçince 422 `appeal_window_closed`; son sürüm dışındaki sürüme 409
 * `appeal_not_latest` (DOM-BEC-025: sonuç son sürümündür). Okuma kapsamı dışı teslim ve
 * arşivli atama 404; personel 403. Gerekçe loglanmaz.
 */
export async function fileAppeal(
  ctx: ServiceContext,
  input: AppealWriteInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  type Filed = { work: StoredSubmissionWork; assignment: StoredAssignment; draft: AppealDraft }
  return runCommand<Filed>(
    ctx,
    {
      action: 'task_submission.appeal',
      collections: [],
      entity: { type: ENTITY, id: input.submissionId },
      load: async (tx) => {
        const work = await findSubmission(tx, ctx.institutionId, input.submissionId)
        const assignment =
          work && (await findAssignment(tx, ctx.institutionId, work.submission.assignmentId))
        if (
          !work ||
          !assignment ||
          assignment.archivedAt !== null ||
          !canReadLearner(viewer, assignment, work.submission.learnerId)
        )
          throw new NotFoundError()
        if (viewer.kind !== 'learner') throw new ForbiddenError()
        const version = versionOf(work, input.versionNumber)
        // Yalnız son sürümün sonucuna itiraz edilir; eski sürümün sonucu yerini yenisine bıraktı.
        // Kursiyer sürümlerini zaten bilir, ret puanlamayı ele vermez (DOM-BEC-045).
        if (version.number !== work.versions.at(-1)?.number)
          throw new AppError(
            409,
            'appeal_not_latest',
            'Yalnız son teslim sürümünün sonucuna itiraz edilebilir.',
          )
        const [grading, links] = await Promise.all([
          gradingOf(tx, ctx, work.submission.id),
          listMembershipLinks(tx, ctx.institutionId, ctx.actor.membershipId),
        ])
        return {
          run: (_state, tools) => ({
            work,
            assignment,
            draft: planAppeal({
              actor: { role: ctx.actor.role, links, userId: ctx.actor.userId },
              learnerId: work.submission.learnerId,
              kind: assignment.kind,
              submissionVersionId: version.id,
              resolution: resolutionOf(grading, version),
              appeals: grading.appeals,
              holidays: APPEAL_HOLIDAYS,
              input: { reason: input.reason },
              now: tools.now,
            }),
          }),
        }
      },
      after: async (tx, { work, assignment, draft }) => {
        await insertAppeal(tx, ctx.institutionId, { id: randomUUID(), ...draft }, ctx.now)
        await touchSubmission(tx, ctx.institutionId, work.submission, ctx.now)
        await auditWork(
          tx,
          ctx,
          'task_submission.appeal',
          { type: ENTITY, id: work.submission.id },
          ['reason', 'filedAt'],
        )
        out.body = await readBack(tx, ctx, viewer, assignment, work.submission.id)
      },
    },
    written(out),
    idempotency,
  )
}

export interface AppealDecisionWriteInput {
  submissionId: string
  appealId: string
  expectedVersion: number
  decision: unknown
}

/**
 * İtiraz kararı (DOM-BEC-025; core `planAppealDecision`): o sürümü hiçbir rolde puanlamamış
 * öğretmen (409 `rater_not_independent`; rota yalnız `ogretmen` rolüne açar, yönetici 403), gerekçeyle; kabulde yeni `final` puan
 * eklenir, ilk puan ve önceki puanlar kayıt geçmişinde kalır. Sonuçlanmış itiraz 409
 * `appeal_decided`. `If-Match` teslimin `rowVersion`'ıdır. Karar gerekçesi loglanmaz.
 */
export async function decideTaskAppeal(
  ctx: ServiceContext,
  input: AppealDecisionWriteInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  type Decided = Graded & {
    appeal: AppealRow & { rowVersion: number }
    plan: ReturnType<typeof planAppealDecision>
  }
  return runCommand<Decided>(
    ctx,
    {
      action: 'task_submission.decide_appeal',
      collections: [],
      entity: { type: ENTITY, id: input.submissionId },
      load: async (tx) => {
        const graded = await gradableSubmission(
          tx,
          ctx,
          viewer,
          input.submissionId,
          input.expectedVersion,
        )
        const appeal = graded.grading.appeals.find((row) => row.id === input.appealId)
        if (appeal === undefined) throw new NotFoundError()
        const rubricVersion = await findRubricVersion(
          tx,
          ctx.institutionId,
          rubricOf(graded.assignment),
        )
        if (rubricVersion === null) throw new NotFoundError()
        return {
          run: (_state, tools) => ({
            ...graded,
            appeal,
            plan: planAppealDecision({
              appeal,
              reviewer: { userId: ctx.actor.userId, coordinator: false },
              rubricVersion,
              scores: graded.grading.scores,
              input: input.decision,
              now: tools.now,
            }),
          }),
        }
      },
      after: async (tx, { work, assignment, appeal, plan }) => {
        await decideAppeal(tx, ctx.institutionId, appeal, plan.appeal, ctx.now)
        if (plan.score !== null)
          await insertRubricScore(
            tx,
            ctx.institutionId,
            { id: randomUUID(), ...plan.score },
            ctx.now,
          )
        await touchSubmission(tx, ctx.institutionId, work.submission, ctx.now)
        await auditWork(
          tx,
          ctx,
          'task_submission.decide_appeal',
          { type: ENTITY, id: work.submission.id },
          plan.score === null
            ? ['outcome', 'decisionReason', 'decidedAt']
            : ['outcome', 'decisionReason', 'decidedAt', 'criteria', 'overallComment'],
        )
        out.body = await readBack(tx, ctx, viewer, assignment, work.submission.id)
      },
    },
    written(out, 200),
    idempotency,
  )
}

// --- Puanlama kuyruğu -----------------------------------------------------------------------

export interface GradingQueueInput {
  assignmentId?: string | undefined
  awaiting?: 'first' | 'second' | undefined
  overdue?: boolean | undefined
  page: number
  pageSize: number
}

/**
 * Puanlanmayı bekleyen teslimler (öğretmen puanlama kuyruğu; DOM-BEC-021, 024, 025): kişinin
 * gördüğü (DOM-YTK-028) arşivsiz, rubrikli atamaların son sürümü ilk puanı ya da istenmiş ikinci
 * puanı almamış teslimleri ve iki puanı uyuşmayıp koordinatörü bekleyenler, en eski gönderim önce.
 * Kişinin puan verdiği bekleyen sürüm listede yoktur; uyuşmazlıklı sürüm puanlayıcılara da görünür.
 * Her satırda bekleyen roller (`awaiting`; ikinci puan bekleyenler ayrı görünür ve süzülür),
 * uyuşmazlık (`awaitingResolution`) ve puanlama süresi (`gradingDueAt`, `gradingOverdue`);
 * gecikene göre süzülebilir. Öğrenci ve veli 403 (rota ve servis).
 */
export async function listGradingQueue(ctx: ServiceContext, input: GradingQueueInput) {
  const viewer = await viewerOf(ctx)
  if (viewer.kind === 'learner') throw new ForbiddenError()
  const scope =
    viewer.kind === 'teacher'
      ? {
          assignedByUserId: viewer.userId,
          learnerTargets: {
            studentIds: [...viewer.studentIds],
            classIds: [...viewer.classIds],
          },
        }
      : {}
  const { rows, total } = await listAwaitingScore(ctx.db, ctx.institutionId, {
    ...scope,
    assignmentId: input.assignmentId,
    awaiting: input.awaiting,
    overdue: input.overdue,
    raterUserId: ctx.actor.userId,
    now: ctx.now,
    page: input.page,
    pageSize: input.pageSize,
  })
  const assignments = new Map<string, StoredAssignment>()
  for (const assignmentId of new Set(rows.map((row) => row.submission.assignmentId))) {
    const assignment = await findAssignment(ctx.db, ctx.institutionId, assignmentId)
    // Kapsam SQL'dedir (`assignmentScopeFilter`, `visible` ile aynı koşul: atayan veya arşivsiz
    // hedefi öğretmenin sınıf/öğrencisi); `total` aynı koşulla sayılır. Satır yine kapsam
    // kuralıyla doğrulanır; uyuşmazlık hatadır, satır düşer ve sayıdan da çıkar.
    if (assignment && visible(viewer, assignment)) assignments.set(assignmentId, assignment)
  }
  const shown = rows.filter((row) => assignments.has(row.submission.assignmentId))
  const dropped = rows.length - shown.length
  if (dropped > 0) ctx.log.warn({ event: 'grading_queue.visibility_mismatch', dropped })
  const book = await loadGrading(
    ctx.db,
    ctx,
    shown.map((row) => row.submission.id),
  )
  const summaries = await listSummaries(ctx.db, ctx, viewer, assignments, shown)
  return {
    total: total - dropped,
    items: summaries.map((summary, index) => {
      const work = shown[index]
      const assignment = work && assignments.get(work.submission.assignmentId)
      const grading = work && book.bySubmission.get(work.submission.id)
      const latest = work?.versions.at(-1)
      if (!work || !assignment || !grading || !latest)
        throw new Error('grading queue row without its submission')
      return { ...summary, grading: queueGrading(ctx, assignment, work, grading, latest) }
    }),
  }
}

/**
 * Kuyruk satırının bekleyen rolleri, uyuşmazlığı ve puanlama süresi (core `gradingDueAt`,
 * `gradingOverdue`; başlangıç `gradingDeadlineOf`). `awaitingResolution` iki puan da verildikten
 * sonra uyuşmazlıkta `true` olur (koordinatör bekleniyor); ikinci puan verilmeden uyuşmazlık
 * hesaplanmaz, kör puanlama korunur (DOM-BEC-024).
 */
function queueGrading(
  ctx: ServiceContext,
  assignment: StoredAssignment,
  work: StoredSubmissionWork,
  grading: Grading,
  latest: StoredSubmissionWork['versions'][number],
) {
  const scores = grading.scores.filter((score) => score.submissionVersionId === latest.id)
  const has = (role: RaterRole) => scores.some((score) => score.raterRole === role)
  const awaiting: ('first' | 'second')[] = []
  if (!has('first')) awaiting.push('first')
  if (secondRatingFor(grading, latest) && !has('second')) awaiting.push('second')
  const resolution = resolutionOf(grading, latest)
  const deadline = gradingDeadlineOf(assignment, work.submission, latest.number)
  return {
    awaiting,
    awaitingResolution: resolution.status === 'disagreement',
    samplePending: sampleLocked(assignment) && assignment.secondRatingSampledAt === null,
    dueAt: deadline === null ? null : gradingDueAt(deadline, latest),
    overdue:
      deadline !== null && gradingOverdue({ deadline, version: latest, resolution, now: ctx.now }),
  }
}
