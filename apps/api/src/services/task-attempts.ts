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
  submissionWindow,
  subskillBreakdown,
  type Answers,
  type CompletedAttempt,
} from '@kampus/school-core/skills/scoring.ts'
import { transcriptShown } from '@kampus/school-core/skills/assignment.ts'
import {
  itemFeedback,
  planItemCheck,
  withLockedAnswers,
  type ItemCheckInput,
  type ItemCheckRow,
} from '@kampus/school-core/skills/practice.ts'

import type { Database } from '../db/client.ts'
import {
  findAssignment,
  findAttempt,
  insertAttempt,
  insertItemCheck,
  listAttempts,
  loadAttempts,
  loadItemChecks,
  loadLearnersAttempts,
  saveAttemptAnswers,
  submitAttempt,
  type StoredAssignment,
  type StoredAttempt,
} from '../db/skills.ts'
import { ConflictError, NotFoundError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { attemptContentGate, contentRemoved } from './learner-content.ts'
import { listeningSummary } from './listening-plays.ts'
import { loadLearnerNames } from './task-learner-names.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { viewerOf, visible, type Viewer } from './task-assignments.ts'
import {
  assertWorkOpen,
  auditWork,
  canReadLearner,
  inAttemptOrder,
  learnerFilter,
  listeningFor,
  loadWorkPairs,
  ownedLearners,
  ownRecord,
  pairsScoringContext,
  passageFor,
  questionsFor,
  recordingFileOf,
  type WorkPairs,
  readableLearners,
  scoringLicenseExpired,
  targetedLearner,
  timingOf,
  workPairsOf,
  type ReadableLearners,
  type ScoringContext,
} from './task-work.ts'

/**
 * Otomatik puanlı görev denemeleri: başlatma, cevap kaydı, teslim ve okuma (F4b3a; ADR 0004
 * karar 5, 6; docs/domain/beceri-gelisimi.md DOM-BEC-010, 042…045; yetki-ve-kapsam.md DOM-YTK-028).
 * Kurallar core `skills/scoring.ts`'tedir; burada kapsam, sıra (kapsam 404 → rol 403, rotada ve
 * serviste → sürüm 409 → içerik kuralı → core kuralı) ve tek transaction vardır. Puan
 * saklanmaz: her okumada cevaplardan ve puanlama sürümünün anahtarından hesaplanır (DOM-BEC-010).
 * Yazmalar `runCommand` ile kurum
 * kilidi altında çalışır; eşzamanlı iki başlatma hakkı aşamaz, eşzamanlı iki tesliminden biri 409
 * alır. Denetime yalnız başlatma ve teslim yazılır, yalnız alan adlarıyla; cevap kaydı sık ve
 * otomatik olduğu için denetlenmez (cevap içeriği hiçbir kayıtta ve logda yoktur).
 */

const ENTITY = 'task_attempt'

/** Tamamlanmış denemeler ve puanları (sayılan ve gösterilen deneme seçimi; DOM-BEC-042, 048). */
export function completedOf(
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
 * Kaldırmanın beklenen sonucu olan bağlam hatası: içerik ya da soru okunamıyor (`NotFoundError`)
 * veya anahtarı silinmiş (`answer_key_missing`). Başka hata (otomatik puanlanmayan tür, anahtar
 * uyuşmazlığı, programlama hatası) kaldırmayla açıklanamaz; veri bütünlüğü sinyalidir.
 */
function removalExplains(error: unknown): boolean {
  return (
    error instanceof NotFoundError ||
    (error instanceof RuleViolationError && error.code === 'answer_key_missing')
  )
}

/**
 * Denemenin puanlama bağlamı ve kaldırılma durumu (DOM-KYN-051, DOM-BEC-010). Kaldırma içeriği ve
 * cevap anahtarını siler; puan saklanmadığı için (her okumada anahtardan hesaplanır) bağlam
 * kurulamazsa deneme kaydı ve cevaplar puansız döner (`context: null`), 404 değil. Yalnız
 * kaldırmanın beklenen sonucu olan hatalar yutulur (`removalExplains`); kaldırılmamış içerikte
 * ya da başka sınıf bir hata (veri bütünlüğü) eskisi gibi fırlar. Okuma parçası kaldırıldığında
 * soruların anahtarı durur: bağlam kurulur, puan görünür.
 */
// TODO(kaldirilan-puan): quizin kendisi ya da bağlı sorusu kaldırılınca geçmiş puan kaybolur;
// DOM-KYN-051 geçmiş notu korumak ister, DOM-BEC-010 puanı saklamaz. Kaldırma anında puanın
// saklanması (migration) ürün kararı bekler.
export function attemptScoring(
  assignment: StoredAssignment,
  pairs: WorkPairs,
): { context: ScoringContext | null; removed: boolean } {
  const removed = contentRemoved(workPairsOf(assignment, pairs))
  try {
    return { context: pairsScoringContext(assignment, pairs), removed }
  } catch (error) {
    if (removed && removalExplains(error)) return { context: null, removed }
    throw error
  }
}

/**
 * Veli alıştırma puanını, madde sonucunu ve anında geri bildirimi görmez (DOM-BEC-041, 047, 048):
 * alıştırma ölçme değildir, sonuç yalnız kursiyere ve öğretmene ilerlemedir. Deneme görünümü ve
 * atama listesindeki durum özeti (`services/task-progress.ts`) aynı yüklemi kullanır.
 */
export function hidesPracticeResult(viewer: Viewer, assignment: Pick<StoredAssignment, 'kind'>) {
  return viewer.kind === 'learner' && viewer.role === 'veli' && assignment.kind === 'practice'
}

/**
 * Denemenin görünümü. Kursiyer ve veli core `learnerResultLevel`'ı alır: süren denemede sonuç
 * yok, tamamlanınca yalnız toplam puan, anahtar açılınca madde sonuçları ve anahtar (DOM-BEC-045).
 * Personel tamamlanan denemenin madde sonuçlarını görür; anahtar ona da yalnız açılınca döner.
 * Puanlama bağlamı yoksa (kaldırılmış içerik, `attemptScoring`) sonuç ve sayılan deneme yoktur;
 * `contentRemoved` kaldırmayı söyler.
 */
function attemptView(
  viewer: Viewer,
  assignment: StoredAssignment,
  scoring: { context: ScoringContext | null; removed: boolean },
  attempt: StoredAttempt,
  learnerAttempts: readonly StoredAttempt[],
  now: string,
  learnerName: string | null,
  checks: readonly ItemCheckRow[],
) {
  const { context } = scoring
  const timing = timingOf(assignment)
  const state = attemptState(attempt, timing, now)
  const completed = state.completedAt !== null
  const counted =
    context === null
      ? null
      : countedAttempt(assignment.attempts, completedOf(assignment, context, learnerAttempts, now))
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
  const parentPractice = hidesPracticeResult(viewer, assignment)
  const items = level === 'none' || parentPractice ? null : (context?.items ?? null)
  const score = items === null ? null : scoreAttempt(items, attempt.answers)
  // Kursiyer ve veli madde sonuçlarını soru listesiyle aynı sırada görür (quiz `shuffleItems`);
  // personel yazarın sırasında inceler. Puan her zaman yazarın sırasında ve madde kimliğiyle
  // hesaplanır, yalnız liste sırası değişir.
  const shown = <T extends { questionVersionId: string }>(list: readonly T[]): T[] =>
    viewer.kind === 'learner' && context !== null
      ? inAttemptOrder(list, context, attempt.id)
      : [...list]
  return {
    id: attempt.id,
    assignmentId: attempt.assignmentId,
    learnerId: attempt.learnerId,
    learnerName,
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
      score === null || items === null
        ? null
        : {
            earned: score.earned,
            possible: score.possible,
            percent: score.percent,
            items: level === 'score' ? null : shown(score.items),
            // Alt beceri dökümü madde sonuçlarıyla aynı anda açılır: tek maddeli alt beceri
            // maddenin doğruluğunu verir (DOM-BEC-006, DOM-BEC-045).
            subskills: level === 'score' ? null : subskillBreakdown(items, score),
            answerKey:
              level === 'full'
                ? shown(
                    items.map((item) => ({
                      questionVersionId: item.questionVersionId,
                      answerKey: item.answerKey,
                    })),
                  )
                : null,
          },
    // Anında geri bildirim (DOM-BEC-047): alıştırmada kontrol edilen maddeler; anahtar yalnız kilitli
    // maddede. Veli görmez; değerlendirmede ve puanlama bağlamı yoksa `null`.
    feedback:
      assignment.kind !== 'practice' || parentPractice || context === null
        ? null
        : shown(itemFeedback(context.items, checks)),
    contentRemoved: scoring.removed,
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
 * `hideScore` velinin alıştırma satırında puanı kapatır (`hidesPracticeResult`, DOM-BEC-041).
 * Puanlama bağlamı kurulamadıysa (`Error`; veri bütünlüğü) puan yoktur ve başlatma kapalıdır.
 */
export function learnerAttemptProgress(
  assignment: StoredAssignment,
  context: ScoringContext | Error,
  attempts: readonly StoredAttempt[],
  now: Date,
  hideScore: boolean,
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
    scorable && shown !== null && level !== 'none' && !hideScore
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
    // Süren deneme bitince ya da (yeni deneme açıkken) pencere kapanınca özet değişir.
    actionableUntil: running
      ? running.state.endsAt
      : blockedBy === null
        ? submissionWindow(assignment.deadline).closesAt
        : null,
    score:
      score === null
        ? null
        : { earned: score.earned, possible: score.possible, percent: score.percent },
  }
}

/**
 * Kursiyerin bu atamadaki sayılan denemesi ve puanı (beceri ilerleme panosu, DOM-BEC-035,
 * DOM-BEC-042). Sayılan deneme yalnız değerlendirmede ve tamamlanmış denemeler arasından seçilir;
 * tamamlanmış denemenin toplam puanı kursiyer ve veliye de açıktır (core `learnerResultLevel`,
 * DOM-BEC-045). Puanlama bağlamı yoksa (kaldırılmış içerik) sonuç yoktur.
 */
export function countedAttemptResult(
  assignment: StoredAssignment,
  context: ScoringContext,
  attempts: readonly StoredAttempt[],
  now: Date,
): { attemptId: string; completedAt: string; percent: number } | null {
  const counted = countedAttempt(
    assignment.attempts,
    completedOf(assignment, context, attempts, now.toISOString()),
  )
  return counted === null
    ? null
    : { attemptId: counted.id, completedAt: counted.completedAt, percent: counted.score.percent }
}

/** Kursiyerin bu atamada süren denemesi var mı (içerik kapısının süren işi; Sabah kararı 47). */
function hasRunning(assignment: StoredAssignment, attempts: readonly StoredAttempt[], now: string) {
  const timing = timingOf(assignment)
  return attempts.some((own) => attemptState(own, timing, now).status === 'in_progress')
}

/** Anahtar ve açıklaması içeriğin parçasıdır: kapalı içerikte dönmez; madde sonucu ve puan kalır. */
function withoutKey<V extends ReturnType<typeof attemptView>>(view: V, open: boolean): V {
  if (open) return view
  return {
    ...view,
    result: view.result === null ? null : { ...view.result, answerKey: null },
    feedback:
      view.feedback === null ? null : view.feedback.map((entry) => ({ ...entry, answerKey: null })),
  }
}

/**
 * Denemenin ayrıntısı: soruları, okuma parçası ve dinleme hakkı. Soru ve parça metni içerik
 * kapısından geçer (`attemptContentGate`; DOM-KYN-025, 051): kaldırılmış içerikte süren ya da
 * tamamlanmış hiçbir denemede, telif askısında süren denemesi olmayan kursiyerde, lisansı dolmuş
 * içerikte süren denemesi olmayan kursiyerde metin ve cevap anahtarı (açıklamasıyla) dönmez
 * (`questions: []`, `passage: null`, `result.answerKey: null`) ve `contentUnavailable` nedeni
 * söyler. Cevaplar, puan ve madde sonuçları görünür kalır. Kaldırılmış içerikte deneme 404 değil:
 * kayıt ve cevaplar döner, `contentRemoved: true`; anahtar silindiği için puanlama bağlamı
 * kurulamıyorsa sonuç da yoktur (`result: null`; DOM-KYN-051, DOM-BEC-010).
 */
async function detailView(
  db: Database,
  ctx: ServiceContext,
  viewer: Viewer,
  assignment: StoredAssignment,
  attempt: StoredAttempt,
) {
  const pairs = await loadWorkPairs(db, ctx.institutionId, [assignment])
  const scoring = attemptScoring(assignment, pairs)
  const { context } = scoring
  const [learnerAttempts, names, checks] = await Promise.all([
    loadAttempts(db, ctx.institutionId, assignment.id, attempt.learnerId),
    loadLearnerNames({ ...ctx, db }, viewer, [attempt.learnerId]),
    loadItemChecks(db, ctx.institutionId, [attempt.id]),
  ])
  const learnerName = names.get(attempt.learnerId) ?? null
  const now = ctx.now.toISOString()
  const running = hasRunning(assignment, learnerAttempts, now)
  const contentUnavailable = await attemptContentGate(
    { ...ctx, db },
    viewer,
    attempt.learnerId,
    workPairsOf(assignment, pairs),
    () => Promise.resolve(running),
  )
  // Kaldırılmış içerikte kapı her bakana kapalıdır; bağlamın olmaması da aynı yüzü kapatır.
  const open = contentUnavailable === null && context !== null
  return {
    ...withoutKey(
      attemptView(
        viewer,
        assignment,
        scoring,
        attempt,
        learnerAttempts,
        now,
        learnerName,
        checks.get(attempt.id) ?? [],
      ),
      open,
    ),
    // Kursiyer ve veli denemenin sırasını görür (`shuffleItems`); personel yazarın sırasını.
    questions: open
      ? questionsFor(context, attempt.id, { authorOrder: viewer.kind !== 'learner' })
      : [],
    passage: open ? passageFor(context) : null,
    // Döküm personelde hep, kursiyer ve velide görev kapanınca ya da alıştırmada açık ayarla
    // (DOM-BEC-005); kayıt da sorular gibi içerik kapısından geçer.
    listeningRecording: open
      ? listeningFor(context, viewer.kind !== 'learner' || transcriptShown(assignment, now))
      : null,
    contentUnavailable,
    listening: await listeningSummary(
      db,
      ctx.institutionId,
      assignment,
      attempt.id,
      recordingFileOf(assignment, pairs),
    ),
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

/**
 * Atamanın denemeleri, okuma kapsamında (DOM-YTK-028); kapalı atama 404. Kapalı içerikte cevap
 * anahtarı ayrıntıdaki gibi dönmez (DOM-KYN-025, 051); kaldırılmış içerikte liste döner,
 * satırlar `contentRemoved` taşır (puanlama bağlamı yoksa puansız).
 */
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
  const pairs = await loadWorkPairs(ctx.db, ctx.institutionId, [assignment])
  const scoring = attemptScoring(assignment, pairs)
  const all = await loadLearnersAttempts(
    ctx.db,
    ctx.institutionId,
    assignment.id,
    rows.map((row) => row.learnerId),
  )
  const now = ctx.now.toISOString()
  const [learnerNames, checks] = await Promise.all([
    loadLearnerNames(
      ctx,
      viewer,
      rows.map((row) => row.learnerId),
    ),
    loadItemChecks(
      ctx.db,
      ctx.institutionId,
      rows.map((row) => row.id),
    ),
  ])
  const ownOf = (learnerId: string) => all.filter((other) => other.learnerId === learnerId)
  // Anahtar ayrıntıdaki kapıyla gizlenir (`attemptContentGate`): personelde atama başına bir,
  // öğrenci ve velide kursiyer başına bir sınama (kendisi ya da çocukları).
  const gates = new Map<string, boolean>()
  for (const learnerId of new Set(rows.map((row) => row.learnerId))) {
    const key = viewer.kind === 'learner' ? learnerId : ''
    if (gates.has(key)) continue
    const gate = await attemptContentGate(
      ctx,
      viewer,
      learnerId,
      workPairsOf(assignment, pairs),
      () => Promise.resolve(hasRunning(assignment, ownOf(learnerId), now)),
    )
    gates.set(key, gate === null)
  }
  return {
    total,
    items: rows.map((row) =>
      withoutKey(
        attemptView(
          viewer,
          assignment,
          scoring,
          row,
          ownOf(row.learnerId),
          now,
          learnerNames.get(row.learnerId) ?? null,
          checks.get(row.id) ?? [],
        ),
        gates.get(viewer.kind === 'learner' ? row.learnerId : '') ?? false,
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
 * hedeflediği öğrenci başlatır (veli 403). İçerik kuralı core planından önce gelir (süren deneme
 * varken de; `assertWorkOpen`, yeni denemede süren iş yoktur): kaldırılmış, telif bildirimiyle
 * incelemedeki ya da kitap sahibine sınırlı içerik 422 `content_unavailable` (DOM-KYN-021, 025,
 * 051), lisansı dolmuş içerik 409 `resource_license_expired` (DOM-KYN-021). Sonra hakkı biten 422
 * `attempt_limit_reached`, süren deneme varken 409 `attempt_in_progress`, teslim kapandıysa 422
 * `submission_closed`.
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
        const pairs = await loadWorkPairs(tx, ctx.institutionId, [assignment])
        await assertWorkOpen(tx, ctx, assignment, pairs, learnerId, () => Promise.resolve(false))
        // Otomatik puanlanmayan görev (yazma) 422 `not_auto_scored`. Bağlam yalnız sıra için
        // kurulur: puanlanamayan atamada deneme açılmaz.
        pairsScoringContext(assignment, pairs)
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

type Owned = {
  attempt: StoredAttempt
  assignment: StoredAssignment
  context: ScoringContext
  /** Denemenin madde kontrolleri (DOM-BEC-047); kilitli maddenin cevabı değişmez. */
  checks: ItemCheckRow[]
}

/**
 * Yazılacak deneme: öğrencinin kendi denemesi ve arşivsiz atama; değilse 404 (kapsam), veli 403,
 * eski sürüm 409 `version_conflict`. Teslim ve cevap kaydı hedefe bakmaz: sınıf değiştiren öğrenci
 * süren denemesini bitirir. Sürüm içerik kuralından önce sınanır (taslakla aynı sıra; api-tasarimi
 * §6): eski sürümle gelen istek içerik kaldırılmış olsa da 409 alır, istemci tazeleyince kapalı
 * içeriği görür. İçerik kuralında deneme süren iştir (`assertWorkOpen`): lisansı bu arada dolan ve
 * telif bildirimiyle incelemeye alınan içerikte süren deneme bitirilir; kaldırılan ya da kursiyerin
 * kitap sahibi olmadığı içerikte 422 `content_unavailable` (DOM-KYN-021, 025, 051). İçerik kapısı
 * ve puanlama bağlamı aynı sürüm okumasını kullanır.
 */
async function ownedAttempt(
  tx: Database,
  ctx: ServiceContext,
  viewer: Viewer,
  input: { attemptId: string; expectedVersion: number },
): Promise<Owned> {
  const attempt = await findAttempt(tx, ctx.institutionId, input.attemptId)
  if (!attempt) throw new NotFoundError()
  const assignment = await findAssignment(tx, ctx.institutionId, attempt.assignmentId)
  if (!assignment || assignment.archivedAt !== null) throw new NotFoundError()
  ownRecord(viewer, attempt.learnerId)
  if (attempt.rowVersion !== input.expectedVersion) throw new ConflictError()
  const pairs = await loadWorkPairs(tx, ctx.institutionId, [assignment])
  await assertWorkOpen(tx, ctx, assignment, pairs, attempt.learnerId, () => Promise.resolve(true))
  const checks = await loadItemChecks(tx, ctx.institutionId, [attempt.id])
  return {
    attempt,
    assignment,
    context: pairsScoringContext(assignment, pairs),
    checks: checks.get(attempt.id) ?? [],
  }
}

export interface AttemptWriteInput {
  attemptId: string
  answers?: Answers | undefined
  expectedVersion: number
}

/**
 * Süren denemeye cevap kaydı (DOM-BEC-043; core `planAnswerSave`). Denetime yazılmaz. Alıştırmada
 * kilitli maddenin cevabı değişmez (DOM-BEC-047; core `withLockedAnswers`).
 */
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
        const owned = await ownedAttempt(tx, ctx, viewer, input)
        return {
          run: (_state, tools) => {
            const answers = withLockedAnswers(
              planAnswerSave({
                attempt: owned.attempt,
                timing: timingOf(owned.assignment),
                items: owned.context.items,
                answers: input.answers,
                now: tools.now,
              }),
              owned.context.items,
              owned.checks,
            )
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
        const owned = await ownedAttempt(tx, ctx, viewer, input)
        return {
          run: (_state, tools) => {
            const planned = planAttemptSubmit({
              attempt: owned.attempt,
              timing: timingOf(owned.assignment),
              items: owned.context.items,
              ...(input.answers === undefined ? {} : { answers: input.answers }),
              now: tools.now,
            })
            // Kilitli maddenin cevabı teslimde de değişmez (DOM-BEC-047).
            const plan = {
              ...planned,
              answers: withLockedAnswers(planned.answers, owned.context.items, owned.checks),
            }
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

/**
 * Alıştırmada madde kontrolü (OG-085, IST-056; DOM-BEC-047; core `planItemCheck`). Cevap denemeye
 * kaydedilir ve kontrol satırı açılır; yanıt denemenin ayrıntısıdır, `feedback` o maddenin
 * sonucunu ve (kilitlendiyse) yalnız onun anahtarını taşır. Son kontrolle aynı cevap mükerrerdir:
 * hiçbir şey yazılmaz, hak tüketilmez, aynı ayrıntı döner. Denetime yazılmaz (cevap kaydı gibi sık
 * ve otomatiktir). Sıra cevap kaydıyla aynıdır: kapsam 404 → rol 403 → sürüm 409 → içerik → core.
 */
export async function checkTaskAttemptItem(
  ctx: ServiceContext,
  input: { attemptId: string; expectedVersion: number; check: ItemCheckInput },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const viewer = await viewerOf(ctx)
  const out: { body?: unknown } = {}
  type Check = { owned: Owned; plan: ReturnType<typeof planItemCheck> }
  return runCommand<Check>(
    ctx,
    {
      action: 'task_attempt.check',
      collections: [],
      entity: { type: ENTITY, id: input.attemptId },
      load: async (tx) => {
        const owned = await ownedAttempt(tx, ctx, viewer, input)
        return {
          run: (_state, tools) => ({
            owned,
            plan: planItemCheck({
              kind: owned.assignment.kind,
              attempt: owned.attempt,
              timing: timingOf(owned.assignment),
              items: owned.context.items,
              checks: owned.checks,
              check: input.check,
              now: tools.now,
            }),
          }),
        }
      },
      after: async (tx, { owned, plan }) => {
        if (plan.kind === 'new') {
          await insertItemCheck(tx, ctx.institutionId, owned.attempt.id, plan.check)
          await saveAttemptAnswers(tx, ctx.institutionId, owned.attempt, plan.answers, ctx.now)
        }
        out.body = await readBack(tx, ctx, viewer, owned.assignment, owned.attempt.id)
      },
    },
    written(out, 200),
    idempotency,
  )
}
