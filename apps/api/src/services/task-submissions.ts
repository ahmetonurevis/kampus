import { randomUUID } from 'node:crypto'

import { deadlineForVersion } from '@kampus/school-core/skills/assignment.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { gradedVersionNumbers } from '@kampus/school-core/skills/rubric.ts'
import {
  planDraftSave,
  planSubmissionVersion,
  submissionStatus,
  versionAllowance,
  versionIsLate,
  wordCountCheck,
  type DraftRow,
  type SubmissionSettings,
  type VersionRow,
} from '@kampus/school-core/skills/submission.ts'

import type { Database } from '../db/client.ts'
import {
  findAssignment,
  findSubmission,
  insertSubmission,
  insertSubmissionVersion,
  listSubmissions,
  loadDraft,
  loadSubmission,
  loadSubmissionScores,
  saveDraft,
  type StoredAssignment,
  type StoredSubmissionWork,
} from '../db/skills.ts'
import { AppError, MESSAGES, NotFoundError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { viewerOf, visible, type Viewer } from './task-assignments.ts'
import {
  auditWork,
  canReadLearner,
  ownLearner,
  readableLearners,
  targetedLearner,
} from './task-work.ts'

/**
 * Yazma görevinin taslağı ve teslimi (F4b3a; ADR 0004 karar 6; docs/domain/beceri-gelisimi.md
 * DOM-BEC-023, 040, 044, 046; IST-047, IST-051; yetki-ve-kapsam.md DOM-YTK-028).
 *
 * Kurallar core `skills/submission.ts`'tedir; burada kapsam, sıra (kapsam 404 → rol 403 rotada →
 * sürüm → core kuralı) ve tek transaction vardır. Kursiyer × atama başına tek teslim kaydı açılır;
 * her gönderim değişmez bir sürüm ekler (tetikleyici metni korur), sınır `maxVersions`'tır. Yazma
 * otomatik puanlanmaz: yanıtta puan alanı yoktur, rubrik puanlaması F4b3b'dedir. Taslak yalnız
 * kursiyerin kendisine görünür (core `canReadDraft`: rol rotada `ogrenci`, sahiplik burada);
 * teslim okumasında taslak hiç dönmez. Taslak kaydı sık ve otomatik olduğu için denetime yazılmaz;
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

function summaryView(assignment: StoredAssignment, work: StoredSubmissionWork, now: Date) {
  const latest = work.versions.at(-1)
  return {
    id: work.submission.id,
    assignmentId: work.submission.assignmentId,
    learnerId: work.submission.learnerId,
    status: statusOf(assignment, work, now),
    versionCount: work.versions.length,
    latestVersion: latest === undefined ? null : versionView(assignment, work, latest),
    rowVersion: work.submission.rowVersion,
  }
}

async function detailView(
  db: Database,
  ctx: ServiceContext,
  assignment: StoredAssignment,
  work: StoredSubmissionWork,
) {
  const settings = settingsOf(assignment)
  const scores = await loadSubmissionScores(db, ctx.institutionId, work.submission.id)
  const allowance =
    settings === null
      ? null
      : versionAllowance({
          settings,
          submission: work.submission,
          versions: work.versions,
          gradedVersionNumbers: gradedVersionNumbers(work.versions, scores),
        })
  return {
    ...summaryView(assignment, work, ctx.now),
    versions: work.versions.map((version) => ({
      ...versionView(assignment, work, version),
      body: version.body,
    })),
    allowance,
  }
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
  learners: readonly string[] | undefined,
) {
  if (viewer.kind !== 'learner' || visible(viewer, assignment)) return
  for (const learnerId of learners ?? [])
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
  if (readable === null) throw new NotFoundError()
  await assertLearnerReach(ctx, viewer, assignment, readable)
  const learnerIds =
    input.learnerId === undefined
      ? readable
      : readable === undefined || readable.includes(input.learnerId)
        ? [input.learnerId]
        : []
  const { rows, total } = await listSubmissions(ctx.db, ctx.institutionId, {
    assignmentId: assignment.id,
    learnerIds,
    page: input.page,
    pageSize: input.pageSize,
  })
  return { total, items: rows.map((work) => summaryView(assignment, work, ctx.now)) }
}

/** Tek teslim ve bütün sürümleri (taslak asla); kapsam dışı veya başka kurumun kaydı 404. */
export async function getTaskSubmission(ctx: ServiceContext, submissionId: string) {
  const viewer = await viewerOf(ctx)
  const work = await findSubmission(ctx.db, ctx.institutionId, submissionId)
  const assignment =
    work && (await findAssignment(ctx.db, ctx.institutionId, work.submission.assignmentId))
  if (!work || !assignment || !canReadLearner(viewer, assignment, work.submission.learnerId))
    throw new NotFoundError()
  return detailView(ctx.db, ctx, assignment, work)
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
 * (sınıf değişimi) taslak varken okunur, yoksa 404.
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
        const graded =
          work === null
            ? []
            : gradedVersionNumbers(
                versions,
                await loadSubmissionScores(tx, ctx.institutionId, work.submission.id),
              )
        const nextNumber = (versions.at(-1)?.number ?? 0) + 1
        const deadline = deadlineForVersion(
          assignment.deadline,
          work?.submission ?? null,
          nextNumber,
        )
        return {
          run: (_state, tools) => ({
            assignment,
            learnerId,
            work,
            plan: planSubmissionVersion({
              settings,
              deadline,
              submission: work?.submission ?? null,
              versions,
              gradedVersionNumbers: graded,
              input: body,
              files: [],
              now: tools.now,
            }),
          }),
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
        out.body = { data: await detailView(tx, ctx, assignment, saved) }
      },
    },
    written(out, 201),
    idempotency,
  )
}
