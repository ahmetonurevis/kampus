import { randomUUID } from 'node:crypto'

import {
  answerKeyReleased,
  attemptState,
  countedAttempt,
  isClosed,
  isLate,
  learnerResultLevel,
  planAnswerSave,
  planAttemptStart,
  planAttemptSubmit,
  scoreAttempt,
  type Answers,
  type CompletedAttempt,
} from '@kampus/school-core/skills/scoring.ts'

import type { Database } from '../db/client.ts'
import {
  findAssignment,
  findAttempt,
  insertAttempt,
  listAttempts,
  loadAttempts,
  loadLearnersAttempts,
  saveAttemptAnswers,
  submitAttempt,
  type StoredAssignment,
  type StoredAttempt,
} from '../db/skills.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { viewerOf, visible, type Viewer } from './task-assignments.ts'
import {
  assertLicenseActive,
  auditWork,
  canReadLearner,
  learnerFilter,
  ownedLearners,
  ownRecord,
  questionsFor,
  readableLearners,
  scoringContext,
  scoringLicenseExpired,
  targetedLearner,
  timingOf,
  type ReadableLearners,
  type ScoringContext,
} from './task-work.ts'

/**
 * Otomatik puanlı görev denemeleri: başlatma, cevap kaydı, teslim ve okuma (F4b3a; ADR 0004
 * karar 5, 6; docs/domain/beceri-gelisimi.md DOM-BEC-010, 042…045; yetki-ve-kapsam.md DOM-YTK-028).
 * Kurallar core `skills/scoring.ts`'tedir; burada kapsam, sıra (kapsam 404 → rol 403, rotada ve
 * serviste → sürüm 409 → core kuralı) ve tek transaction vardır. Puan saklanmaz: her okumada cevaplardan ve
 * puanlama sürümünün anahtarından hesaplanır (DOM-BEC-010). Yazmalar `runCommand` ile kurum
 * kilidi altında çalışır; eşzamanlı iki başlatma hakkı aşamaz, eşzamanlı iki tesliminden biri 409
 * alır. Denetime yalnız başlatma ve teslim yazılır, yalnız alan adlarıyla; cevap kaydı sık ve
 * otomatik olduğu için denetlenmez (cevap içeriği hiçbir kayıtta ve logda yoktur).
 */

const ENTITY = 'task_attempt'

/** Tamamlanmış denemeler ve puanları (sayılan deneme seçimi için; DOM-BEC-042). */
function completedOf(
  assignment: StoredAssignment,
  context: ScoringContext,
  attempts: readonly StoredAttempt[],
  now: string,
): CompletedAttempt[] {
  const timing = timingOf(assignment)
  return attempts.flatMap((attempt) => {
    const { completedAt } = attemptState(attempt, timing, now)
    return completedAt === null
      ? []
      : [{ id: attempt.id, completedAt, score: scoreAttempt(context.items, attempt.answers) }]
  })
}

/**
 * Denemenin görünümü. Kursiyer ve veli core `learnerResultLevel`'ı alır: süren denemede sonuç
 * yok, tamamlanınca yalnız toplam puan, anahtar açılınca madde sonuçları ve anahtar (DOM-BEC-045).
 * Personel tamamlanan denemenin madde sonuçlarını görür; anahtar ona da yalnız açılınca döner.
 */
function attemptView(
  viewer: Viewer,
  assignment: StoredAssignment,
  context: ScoringContext,
  attempt: StoredAttempt,
  learnerAttempts: readonly StoredAttempt[],
  now: string,
) {
  const timing = timingOf(assignment)
  const state = attemptState(attempt, timing, now)
  const completed = state.completedAt !== null
  const counted = countedAttempt(
    assignment.attempts,
    completedOf(assignment, context, learnerAttempts, now),
  )
  const released = answerKeyReleased({
    kind: assignment.kind,
    deadline: assignment.deadline,
    attemptCompleted: completed,
    now,
  })
  const level =
    viewer.kind === 'learner'
      ? learnerResultLevel({
          kind: assignment.kind,
          deadline: assignment.deadline,
          attempt: state,
          now,
        })
      : !completed
        ? 'none'
        : released
          ? 'full'
          : 'items'
  const score = level === 'none' ? null : scoreAttempt(context.items, attempt.answers)
  return {
    id: attempt.id,
    assignmentId: attempt.assignmentId,
    learnerId: attempt.learnerId,
    attemptNumber: attempt.attemptNumber,
    status: state.status,
    startedAt: attempt.startedAt,
    endsAt: state.endsAt,
    remainingMs: state.remainingMs,
    completedAt: state.completedAt,
    autoSubmitted: state.autoSubmitted,
    late: state.completedAt !== null && isLate(state.completedAt, assignment.deadline),
    counted: counted?.id === attempt.id,
    answers: attempt.answers,
    result:
      score === null
        ? null
        : {
            earned: score.earned,
            possible: score.possible,
            percent: score.percent,
            items: level === 'score' ? null : score.items,
            answerKey:
              level === 'full'
                ? context.items.map((item) => ({
                    questionVersionId: item.questionVersionId,
                    answerKey: item.answerKey,
                  }))
                : null,
          },
    rowVersion: attempt.rowVersion,
  }
}

/** Kursiyerin yeni deneme başlatamama nedeni; puanlamadan bağımsızdır (DOM-BEC-045). */
type StartBlock = 'in_progress' | 'license_expired' | 'locked' | 'limit' | 'unavailable'

/**
 * Kursiyerin bir otomatik puanlı görevdeki durumu (atama listesi ve ayrıntısındaki özet;
 * `services/task-progress.ts`, IST-051). Deneme uçlarıyla aynı kuralları kullanır: gösterilen
 * deneme sayılan deneme (DOM-BEC-042), alıştırmada ya da sayılan yoksa son tamamlanan; puan core
 * `learnerResultLevel` izin verdiğinde (tamamlanınca toplam; DOM-BEC-045). Başlatma engeli
 * `startTaskAttempt` sırasıyla aynıdır, yalnız süren deneme önce gelir (kursiyer ona devam eder).
 * Puanlama bağlamı kurulamadıysa (`Error`; veri bütünlüğü) puan yoktur ve başlatma kapalıdır.
 */
export function learnerAttemptProgress(
  assignment: StoredAssignment,
  context: ScoringContext | Error,
  attempts: readonly StoredAttempt[],
  now: Date,
) {
  const at = now.toISOString()
  const timing = timingOf(assignment)
  const states = attempts
    .map((attempt) => ({ attempt, state: attemptState(attempt, timing, at) }))
    .sort((a, b) => a.attempt.attemptNumber - b.attempt.attemptNumber)
  const running = states.findLast(({ state }) => state.status === 'in_progress')
  const completed = states.filter(({ state }) => state.completedAt !== null)
  const scorable = !(context instanceof Error)
  const counted = scorable
    ? countedAttempt(assignment.attempts, completedOf(assignment, context, attempts, at))
    : null
  const shown =
    completed.find(({ attempt }) => attempt.id === counted?.id) ?? completed.at(-1) ?? null
  const limit = assignment.attempts.kind === 'evaluation' ? assignment.attempts.maxAttempts : null
  const closed = isClosed(assignment.deadline, at)
  const blockedBy: StartBlock | null = running
    ? 'in_progress'
    : !scorable
      ? 'unavailable'
      : scoringLicenseExpired(context, now)
        ? 'license_expired'
        : closed
          ? 'locked'
          : limit !== null && attempts.length >= limit
            ? 'limit'
            : null
  const level =
    shown === null
      ? 'none'
      : learnerResultLevel({
          kind: assignment.kind,
          deadline: assignment.deadline,
          attempt: shown.state,
          now: at,
        })
  const score =
    scorable && shown !== null && level !== 'none'
      ? scoreAttempt(context.items, shown.attempt.answers)
      : null
  const latest = running ?? shown
  const late =
    shown?.state.completedAt != null && isLate(shown.state.completedAt, assignment.deadline)
  return {
    attemptId: latest?.attempt.id ?? null,
    status: running
      ? ('in_progress' as const)
      : shown !== null
        ? late
          ? ('late' as const)
          : ('submitted' as const)
        : closed
          ? ('not_submitted' as const)
          : ('pending' as const),
    lastActivityAt: shown?.state.completedAt ?? null,
    used: attempts.length,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - attempts.length),
    canAct: blockedBy === null,
    blockedBy,
    score:
      score === null
        ? null
        : { earned: score.earned, possible: score.possible, percent: score.percent },
  }
}

async function detailView(
  db: Database,
  ctx: ServiceContext,
  viewer: Viewer,
  assignment: StoredAssignment,
  attempt: StoredAttempt,
) {
  const context = await scoringContext(db, ctx.institutionId, assignment)
  const learnerAttempts = await loadAttempts(
    db,
    ctx.institutionId,
    assignment.id,
    attempt.learnerId,
  )
  return {
    ...attemptView(viewer, assignment, context, attempt, learnerAttempts, ctx.now.toISOString()),
    questions: questionsFor(context, attempt.id),
  }
}

/**
 * Öğrenci ve velide atama artık görünmüyorsa (sınıf değişimi) yalnız kendi/çocuğunun kaydı varken
 * okunur; hiç kaydı yoksa 404 (atamanın varlığı sızmaz).
 */
async function assertLearnerReach(
  ctx: ServiceContext,
  viewer: Viewer,
  assignment: StoredAssignment,
  readable: ReadableLearners,
) {
  if (viewer.kind !== 'learner' || visible(viewer, assignment)) return
  const own = await loadLearnersAttempts(
    ctx.db,
    ctx.institutionId,
    assignment.id,
    ownedLearners(readable),
  )
  if (own.length === 0) throw new NotFoundError()
}

export interface TaskAttemptListInput {
  assignmentId: string
  learnerId?: string | undefined
  page: number
  pageSize: number
}

/** Atamanın denemeleri, okuma kapsamında (DOM-YTK-028); kapalı atama 404. */
export async function listTaskAttempts(ctx: ServiceContext, input: TaskAttemptListInput) {
  const viewer = await viewerOf(ctx)
  const assignment = await findAssignment(ctx.db, ctx.institutionId, input.assignmentId)
  if (!assignment) throw new NotFoundError()
  const readable = readableLearners(viewer, assignment)
  if (readable.kind === 'none') throw new NotFoundError()
  await assertLearnerReach(ctx, viewer, assignment, readable)
  const { rows, total } = await listAttempts(ctx.db, ctx.institutionId, {
    assignmentId: assignment.id,
    learnerIds: learnerFilter(readable, input.learnerId),
    page: input.page,
    pageSize: input.pageSize,
  })
  if (rows.length === 0) return { items: [], total }
  const context = await scoringContext(ctx.db, ctx.institutionId, assignment)
  const all = await loadLearnersAttempts(
    ctx.db,
    ctx.institutionId,
    assignment.id,
    rows.map((row) => row.learnerId),
  )
  const now = ctx.now.toISOString()
  return {
    total,
    items: rows.map((row) =>
      attemptView(
        viewer,
        assignment,
        context,
        row,
        all.filter((other) => other.learnerId === row.learnerId),
        now,
      ),
    ),
  }
}

/** Tek deneme; kapsam dışı, olmayan veya başka kurumun denemesi 404. */
export async function getTaskAttempt(ctx: ServiceContext, attemptId: string) {
  const viewer = await viewerOf(ctx)
  const attempt = await findAttempt(ctx.db, ctx.institutionId, attemptId)
  const assignment =
    attempt && (await findAssignment(ctx.db, ctx.institutionId, attempt.assignmentId))
  if (!attempt || !assignment || !canReadLearner(viewer, assignment, attempt.learnerId))
    throw new NotFoundError()
  return detailView(ctx.db, ctx, viewer, assignment, attempt)
}

// --- Yazma --------------------------------------------------------------------------------

function written(out: { body?: unknown }, statusCode: number) {
  return () => {
    if (out.body === undefined) throw new Error('task attempt was not written')
    return { statusCode, body: out.body }
  }
}

async function readBack(
  tx: Database,
  ctx: ServiceContext,
  viewer: Viewer,
  assignment: StoredAssignment,
  attemptId: string,
) {
  const attempt = await findAttempt(tx, ctx.institutionId, attemptId)
  if (!attempt) throw new Error('task attempt disappeared after write')
  return { data: await detailView(tx, ctx, viewer, assignment, attempt) }
}

/**
 * Deneme başlatır (DOM-BEC-042, 043, 044; core `planAttemptStart`). Yalnız atamanın şu an
 * hedeflediği öğrenci başlatır (veli 403); lisansı dolmuş içerik 409 `resource_license_expired`
 * (DOM-KYN-021), hakkı biten 422 `attempt_limit_reached`, süren deneme varken 409
 * `attempt_in_progress`, teslim kapandıysa 422 `submission_closed`.
 */
export async function startTaskAttempt(
  ctx: ServiceContext,
  assignmentId: string,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const attemptId = randomUUID()
  const out: { body?: unknown } = {}
  type Start = {
    assignment: StoredAssignment
    learnerId: string
    plan: ReturnType<typeof planAttemptStart>
  }
  return runCommand<Start>(
    ctx,
    {
      action: 'task_attempt.start',
      collections: [],
      entity: { type: ENTITY, id: attemptId },
      load: async (tx) => {
        const assignment = await findAssignment(tx, ctx.institutionId, assignmentId)
        // Kapsam (404): olmayan, başka kurumun, arşivli veya öğrenciyi hedeflemeyen atama.
        if (!assignment || assignment.archivedAt !== null) throw new NotFoundError()
        const learnerId = targetedLearner(viewer, assignment)
        // Otomatik puanlanmayan görev (yazma) 422 `not_auto_scored`.
        const context = await scoringContext(tx, ctx.institutionId, assignment)
        assertLicenseActive(context, ctx.now)
        const attempts = await loadAttempts(tx, ctx.institutionId, assignment.id, learnerId)
        return {
          run: (_state, tools) => ({
            assignment,
            learnerId,
            plan: planAttemptStart({
              rules: assignment.attempts,
              timing: timingOf(assignment),
              attempts,
              now: tools.now,
            }),
          }),
        }
      },
      after: async (tx, { assignment, learnerId, plan }) => {
        await insertAttempt(
          tx,
          ctx.institutionId,
          {
            id: attemptId,
            assignmentId: assignment.id,
            learnerId,
            attemptNumber: plan.attemptNumber,
            startedAt: plan.startedAt,
          },
          ctx.now,
        )
        await auditWork(tx, ctx, 'task_attempt.start', { type: ENTITY, id: attemptId }, [
          'assignmentId',
          'attemptNumber',
          'startedAt',
        ])
        out.body = await readBack(tx, ctx, viewer, assignment, attemptId)
      },
    },
    written(out, 201),
    idempotency,
  )
}

type Owned = { attempt: StoredAttempt; assignment: StoredAssignment; context: ScoringContext }

/**
 * Yazılacak deneme: öğrencinin kendi denemesi ve arşivsiz atama; değilse 404 (kapsam), veli 403.
 * Teslim ve cevap kaydı hedefe ve lisansa bakmaz: sınıf değiştiren öğrenci ve lisansı bu arada
 * dolan içerikte süren deneme bitirilebilir.
 */
async function ownedAttempt(
  tx: Database,
  ctx: ServiceContext,
  viewer: Viewer,
  attemptId: string,
): Promise<Owned> {
  const attempt = await findAttempt(tx, ctx.institutionId, attemptId)
  if (!attempt) throw new NotFoundError()
  const assignment = await findAssignment(tx, ctx.institutionId, attempt.assignmentId)
  if (!assignment || assignment.archivedAt !== null) throw new NotFoundError()
  ownRecord(viewer, attempt.learnerId)
  return { attempt, assignment, context: await scoringContext(tx, ctx.institutionId, assignment) }
}

export interface AttemptWriteInput {
  attemptId: string
  answers?: Answers | undefined
  expectedVersion: number
}

/** Süren denemeye cevap kaydı (DOM-BEC-043; core `planAnswerSave`). Denetime yazılmaz. */
export async function saveTaskAttemptAnswers(
  ctx: ServiceContext,
  input: AttemptWriteInput & { answers: Answers },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  type Save = { owned: Owned; answers: Answers }
  return runCommand<Save>(
    ctx,
    {
      action: 'task_attempt.answer',
      collections: [],
      entity: { type: ENTITY, id: input.attemptId },
      load: async (tx) => {
        const owned = await ownedAttempt(tx, ctx, viewer, input.attemptId)
        return {
          run: (_state, tools) => {
            if (owned.attempt.rowVersion !== input.expectedVersion) throw new ConflictError()
            const answers = planAnswerSave({
              attempt: owned.attempt,
              timing: timingOf(owned.assignment),
              items: owned.context.items,
              answers: input.answers,
              now: tools.now,
            })
            return { owned, answers }
          },
        }
      },
      after: async (tx, { owned, answers }) => {
        await saveAttemptAnswers(tx, ctx.institutionId, owned.attempt, answers, ctx.now)
        out.body = await readBack(tx, ctx, viewer, owned.assignment, owned.attempt.id)
      },
    },
    written(out, 200),
    idempotency,
  )
}

/**
 * Deneme teslimi (DOM-BEC-010, 043; core `planAttemptSubmit`). Puan sunucuda cevaplardan
 * hesaplanır; süre dolduysa gönderilen cevaplar alınmaz, kaydedilmiş cevaplarla bitiş anında
 * teslim edilir. Teslim edilmiş deneme 409 `attempt_already_submitted`.
 */
export async function submitTaskAttempt(
  ctx: ServiceContext,
  input: AttemptWriteInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  type Submit = { owned: Owned; plan: ReturnType<typeof planAttemptSubmit> }
  return runCommand<Submit>(
    ctx,
    {
      action: 'task_attempt.submit',
      collections: [],
      entity: { type: ENTITY, id: input.attemptId },
      load: async (tx) => {
        const owned = await ownedAttempt(tx, ctx, viewer, input.attemptId)
        return {
          run: (_state, tools) => {
            if (owned.attempt.rowVersion !== input.expectedVersion) throw new ConflictError()
            const plan = planAttemptSubmit({
              attempt: owned.attempt,
              timing: timingOf(owned.assignment),
              items: owned.context.items,
              ...(input.answers === undefined ? {} : { answers: input.answers }),
              now: tools.now,
            })
            return { owned, plan }
          },
        }
      },
      after: async (tx, { owned, plan }) => {
        await submitAttempt(tx, ctx.institutionId, owned.attempt, plan, ctx.now)
        await auditWork(tx, ctx, 'task_attempt.submit', { type: ENTITY, id: owned.attempt.id }, [
          'answers',
          'submittedAt',
        ])
        out.body = await readBack(tx, ctx, viewer, owned.assignment, owned.attempt.id)
      },
    },
    written(out, 200),
    idempotency,
  )
}
