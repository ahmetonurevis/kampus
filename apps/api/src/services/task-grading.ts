import { randomUUID } from 'node:crypto'

import { planResubmissionRequest } from '@kampus/school-core/skills/assignment.ts'
import {
  planRubricScore,
  type RubricScoreDraft,
  type RubricScoreInput,
} from '@kampus/school-core/skills/rubric.ts'

import type { Database } from '../db/client.ts'
import {
  findAssignment,
  findRubricVersion,
  findSubmission,
  insertResubmissionRequest,
  insertRubricScore,
  isSecondRatingRequested,
  listAwaitingScore,
  loadSubmissionScores,
  touchSubmission,
  type StoredAssignment,
  type StoredSubmissionWork,
} from '../db/skills.ts'
import { ConflictError, ForbiddenError, NotFoundError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { viewerOf, visible, type Viewer } from './task-assignments.ts'
import { detailView, listSummaries } from './task-submissions.ts'
import { auditWork } from './task-work.ts'

/**
 * Yazma tesliminin öğretmen puanlaması, yeniden teslim isteği ve puanlama kuyruğu (F4b3b1;
 * ADR 0004 karar 6; docs/domain/beceri-gelisimi.md DOM-BEC-020…023, 040, 045;
 * yetki-ve-kapsam.md DOM-YTK-028).
 *
 * Kurallar core'dadır: puan `planRubricScore` (atamanın sabitlediği rubrik sürümü, yalnız son
 * sürüm, kriterlerin tamamı ve yalnızları, hedefin altındaki banda yorum, sürüm başına tek ilk
 * puan), yeniden teslim `planResubmissionRequest` (kesinleşmiş puan, 14 gün). Toplam saklanmaz,
 * istemciden alınmaz; her okumada kriter bantlarından hesaplanır (DOM-BEC-021). Yazma otomatik
 * puanlanmaz (DOM-BEC-023): puan yalnız bu uçtan gelir.
 *
 * Puanlayan, atamayı gören öğretmen (atayan ya da kapsamındaki sınıf/öğrenci hedefi yüzünden
 * gören; görünürlük atamayı izler, DOM-YTK-028) veya yöneticidir. Sıra: kapsam 404 → rol 403 →
 * `If-Match` 409 → core kuralı. Puan ve istek değişmez satırlardır; teslim kaydının satır sürümü
 * artar (iyimser kilit). Tek transaction ve kurum kilidi `runCommand`'dadır. Geri bildirim metni
 * ve öğrenci kimliği loglanmaz; denetime yalnız alan adları yazılır.
 */

// TODO(core-atama-yetki): "Atamayı gören öğretmen veya yönetici puanlar" kuralı core yetki
// tablosunda (`lib/authorize.ts`) yok; web ve mobil aynı kuralı çalıştırsın diye core'a taşınır.
// TODO(F4b3b2): İkinci puanlayıcı (DOM-BEC-024: örneklem ve `second` rolü), koordinatör son puanı,
// itiraz ve puanlama süresi (DOM-BEC-025), not aktarımı ve yeniden puanlama (DOM-BEC-011) bu
// servise eklenmedi; burada yalnız ilk puan (`first`) verilir.

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

type Graded = { work: StoredSubmissionWork; assignment: StoredAssignment }

/**
 * Puanlanacak teslim ve ataması: başka kurumun, arşivli veya olmayan teslim 404; öğretmen atamayı
 * görmüyorsa 404; öğrenci/veli 403; satır sürümü `If-Match`'ten farklıysa 409.
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
  if (!work || !assignment) throw new NotFoundError()
  assertGrader(viewer, assignment)
  if (work.submission.rowVersion !== expectedVersion) throw new ConflictError()
  return { work, assignment }
}

function written(out: { body?: unknown }) {
  return () => {
    if (out.body === undefined) throw new Error('task grading was not written')
    return { statusCode: 201, body: out.body }
  }
}

/** Yazmadan sonra teslimin güncel görünümü (personel görünümü). */
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

export interface ScoreWriteInput {
  submissionId: string
  expectedVersion: number
  versionNumber: number
  score: RubricScoreInput
}

/**
 * Öğretmenin rubrik puanı ve geri bildirimi (DOM-BEC-020…023; core `planRubricScore`). Puan
 * atamanın sabitlediği rubrik sürümüyle verilir (DOM-BEC-022); rubriksiz görev 422
 * `rubric_not_assigned`. Eksik veya rubrikte olmayan kriter 422, hedefin altındaki banda yorumsuz
 * puan 422, son olmayan sürüm 409 `version_not_latest`, aynı sürümün ikinci ilk puanı 409
 * `rubric_score_exists` (eşzamanlıda kurum kilidi ve benzersiz indeks). Puan değişmez satırdır.
 */
export async function scoreTaskSubmission(
  ctx: ServiceContext,
  input: ScoreWriteInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  type Score = Graded & { draft: RubricScoreDraft }
  return runCommand<Score>(
    ctx,
    {
      action: 'task_submission.score',
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
        const { work, assignment } = graded
        const rubricVersionId = assignment.rubricVersionId
        if (rubricVersionId === null)
          throw new RuleViolationError('rubric_not_assigned', 'Bu görev rubrikle puanlanmaz.')
        const [rubricVersion, scores, secondRatingRequested] = await Promise.all([
          findRubricVersion(tx, ctx.institutionId, rubricVersionId),
          loadSubmissionScores(tx, ctx.institutionId, work.submission.id),
          isSecondRatingRequested(tx, ctx.institutionId, work.submission.id),
        ])
        if (rubricVersion === null) throw new NotFoundError()
        // Bilinmeyen sürüm numarası core'un `submission_version_not_found` (404) yoluna düşer.
        const version = work.versions.find((v) => v.number === input.versionNumber)
        return {
          run: (_state, tools) => ({
            ...graded,
            draft: planRubricScore({
              rubricVersion,
              assignmentRubricVersionId: rubricVersionId,
              versions: work.versions,
              submissionVersionId: version?.id ?? '',
              scores,
              rater: { userId: ctx.actor.userId, coordinator: false },
              raterRole: 'first',
              secondRatingRequested,
              input: input.score,
              now: tools.now,
            }),
          }),
        }
      },
      after: async (tx, { work, assignment, draft }) => {
        await insertRubricScore(tx, ctx.institutionId, { id: randomUUID(), ...draft }, ctx.now)
        await touchSubmission(tx, ctx.institutionId, work.submission, ctx.now)
        await auditWork(
          tx,
          ctx,
          'task_submission.score',
          { type: ENTITY, id: work.submission.id },
          ['criteria', 'overallComment', 'scoredAt'],
        )
        out.body = await readBack(tx, ctx, viewer, assignment, work.submission.id)
      },
    },
    written(out),
    idempotency,
  )
}

export interface ResubmissionWriteInput {
  submissionId: string
  expectedVersion: number
  request: { versionNumber: number; dueAt: string }
}

/**
 * Yeniden teslim isteği (DOM-BEC-040; core `planResubmissionRequest`): yalnız puanı kesinleşen son
 * sürüm için, önümüzdeki 14 gün içinde kendi son tarihiyle. Puanlanmamış sürüm 409
 * `resubmission_not_graded`, aynı sürüme ikinci istek 409 `resubmission_exists`. Kursiyer sonra
 * yeni sürüm gönderebilir (`versionAllowance.resubmissionOpen`); yeni sürüm hakka sayılmaz.
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
        const { work } = graded
        const [scores, secondRatingRequested] = await Promise.all([
          loadSubmissionScores(tx, ctx.institutionId, work.submission.id),
          isSecondRatingRequested(tx, ctx.institutionId, work.submission.id),
        ])
        return {
          run: (_state, tools) => {
            const plan = planResubmissionRequest({
              submission: work.submission,
              versions: work.versions,
              scores,
              secondRatingRequested,
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

// --- Puanlama kuyruğu -----------------------------------------------------------------------

export interface GradingQueueInput {
  assignmentId?: string | undefined
  page: number
  pageSize: number
}

/**
 * Puanlanmayı bekleyen teslimler (öğretmen puanlama kuyruğu): kişinin gördüğü (DOM-YTK-028)
 * arşivsiz, rubrikli atamaların son sürümü ilk puanı almamış teslimleri, en eski gönderim önce.
 * Öğrenci ve veli 403 (rota ve servis).
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
    page: input.page,
    pageSize: input.pageSize,
  })
  const assignments = new Map<string, StoredAssignment>()
  for (const assignmentId of new Set(rows.map((row) => row.submission.assignmentId))) {
    const assignment = await findAssignment(ctx.db, ctx.institutionId, assignmentId)
    // SQL yalnız adayları daraltır; satır yine kapsam kuralıyla doğrulanır.
    if (assignment && visible(viewer, assignment)) assignments.set(assignmentId, assignment)
  }
  const shown = rows.filter((row) => assignments.has(row.submission.assignmentId))
  if (shown.length !== rows.length)
    ctx.log.warn({
      event: 'grading_queue.visibility_mismatch',
      dropped: rows.length - shown.length,
    })
  return { total, items: await listSummaries(ctx.db, ctx, viewer, assignments, shown) }
}
