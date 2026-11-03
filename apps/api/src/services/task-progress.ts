import {
  learnerView,
  seededRandom,
  type LearnerResourceView,
} from '@kampus/school-core/content/resource.ts'

import { asCoreVersion } from '../db/resources.ts'
import {
  draftKeysAmong,
  loadAttemptsAmong,
  loadSubmissionsAmong,
  type StoredAssignment,
  type StoredAttempt,
  type StoredSubmissionWork,
} from '../db/skills.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { learnerContentGate, learnerWorkBlocks, type LearnerWorkBlock } from './learner-content.ts'
import {
  learnerAssignmentView,
  loadTaskAssignment,
  loadTaskAssignmentPage,
  staffAssignmentView,
  targetedLearners,
  type TaskAssignmentListInput,
  type Viewer,
} from './task-assignments.ts'
import { learnerAttemptProgress } from './task-attempts.ts'
import { learnerSubmissionProgress, loadGrading } from './task-submissions.ts'
import {
  loadWorkPairs,
  scoringContexts,
  workPairsOf,
  type ScoringContext,
  type WorkPairs,
} from './task-work.ts'

/**
 * Atama okumalarının kursiyer ve veli eki (IST-051; docs/domain/beceri-gelisimi.md DOM-BEC-040…046;
 * kaynak-platformu.md DOM-KYN-021, 024; yetki-ve-kapsam.md DOM-YTK-028).
 *
 * Durum özeti (`progress`): kursiyer görünümündeki her hedeflenen kişi (öğrencide kendisi, velide
 * yalnız kendi çocukları; `targetedLearners`) için kullanılan ve kalan hak, son deneme veya teslim
 * durumu, yeni deneme/sürüm hakkı (`canAct`, `blockedBy`) ve açılmışsa puan. Deneme ve teslim
 * uçlarının kendi kurallarıyla hesaplanır (`learnerAttemptProgress`, `learnerSubmissionProgress`),
 * dolayısıyla aynı gizlemeyi taşır (DOM-BEC-045): açılmamış puan, ikinci puan, ikinci puanlama
 * örneklemi ve isteği, uyuşmazlık ve itiraz durumu hiçbir alandan çıkarılamaz; satır sürümü yoktur.
 * Hak, içerik kapısının yazma yüzünü de yansıtır (`learnerWorkBlocks`; DOM-KYN-021, 025, 051):
 * yazma ucunun 422 `content_unavailable` vereceği satırda `canAct: false`, `blockedBy:
 * 'content_unavailable'`; 409 `resource_license_expired` vereceği satırda `license_expired`.
 * Liste satır başına istek atmaz: denemeler, teslimler, taslaklar, sürümler, çekilmiş kaynaklar,
 * puanlar ve puanlama bağlamları toplu okunur.
 *
 * İçerik (`content`, yalnız ayrıntı): atamada sabitlenen sürümün kursiyere dönük hâli (core
 * `learnerView`): cevap anahtarı ve lisans ayrıntısı yoktur, kaynak gösterimi korunur (DOM-KYN-024),
 * yazma şablonunun değerlendirme ölçütü ve rubrik bağı (puanlama notu) çıkarılır, otomatik puanlı
 * içeriğin soru metinleri yalnız denemede görünür (burada soru sayısı). İçeriğin açıklığı deneme
 * ve teslim uçlarıyla aynı kuraldır (`services/learner-content.ts`): kaldırılmış veya yayın
 * geçmişi olmayan sürüm (süren iş olsa da) ve herhangi bir sürümü telif bildirimiyle incelemede
 * olan kaynak (DOM-KYN-025) süren işi olmayana `unavailable`; telif askısında süren işi olan
 * kursiyer yönergeyi görmeye devam eder (Sabah kararı 47); kitap sahibiyle sınırlı lisansta hedeflenen
 * kişilerden biri kitap sahibi değilse de `unavailable` (DOM-KYN-021). Lisansı dolmuş içerik
 * (DOM-KYN-021) yeni iş başlatmaz ama süren iş biter: süren denemesi, teslimi ya da taslağı olan
 * kursiyere içerik gösterilir, olmayana `license_expired` döner.
 */

export type LearnerViewer = Extract<Viewer, { kind: 'learner' }>

interface WorkBook {
  attempts: readonly StoredAttempt[]
  submissions: readonly StoredSubmissionWork[]
  /** Taslağı olan `atama:kursiyer` çiftleri; yalnız öğrencide okunur (veli taslağı görmez). */
  drafts: ReadonlySet<string>
  /** Kursiyerin gördüğü sürümler (`loadWorkPairs`): içerik kapısı ve puanlama bağlamı. */
  pairs: WorkPairs
  contexts: ReadonlyMap<string, ScoringContext | Error>
  grading: Awaited<ReturnType<typeof loadGrading>>
}

/**
 * Atamaların kursiyer kayıtları, toplu okumayla (deneme, teslim, taslak, sürümler, puan, puanlama
 * bağlamı); atama sayısından bağımsız sabit sayıda sorgu.
 */
async function loadWork(
  ctx: ServiceContext,
  viewer: LearnerViewer,
  assignments: readonly StoredAssignment[],
): Promise<WorkBook> {
  const learnerIds = [...viewer.classOf.keys()]
  const auto = assignments.filter((assignment) => assignment.scoringMode === 'auto')
  const written = assignments.filter((assignment) => assignment.scoringMode === 'teacher')
  const [attempts, submissions, drafts, pairs] = await Promise.all([
    loadAttemptsAmong(
      ctx.db,
      ctx.institutionId,
      auto.map((assignment) => assignment.id),
      learnerIds,
    ),
    loadSubmissionsAmong(
      ctx.db,
      ctx.institutionId,
      written.map((assignment) => assignment.id),
      learnerIds,
    ),
    ctx.actor.role === 'ogrenci'
      ? draftKeysAmong(
          ctx.db,
          ctx.institutionId,
          written.map((assignment) => assignment.id),
          learnerIds,
        )
      : Promise.resolve(new Set<string>()),
    loadWorkPairs(ctx.db, ctx.institutionId, assignments),
  ])
  const contexts = scoringContexts(auto, pairs)
  // Bağlam veri bütünlüğü sorunuyla kurulamadı: atama başına bir uyarı, yalnız atama kimliğiyle
  // (kişisel veri ve içerik loglanmaz). Özet bu atamada `unavailable` döner.
  for (const [assignmentId, context] of contexts)
    if (context instanceof Error)
      ctx.log.warn({ event: 'task_progress.scoring_unavailable', assignmentId })
  const grading = await loadGrading(
    ctx.db,
    ctx,
    submissions.map((work) => work.submission.id),
  )
  return { attempts, submissions, drafts, pairs, contexts, grading }
}

function rawProgressOf(
  ctx: ServiceContext,
  viewer: LearnerViewer,
  book: WorkBook,
  assignment: StoredAssignment,
) {
  return targetedLearners(viewer.classOf, assignment).map((learnerId) => {
    if (assignment.scoringMode === 'auto') {
      const context = book.contexts.get(assignment.id) ?? new Error('scoring context missing')
      const own = book.attempts.filter(
        (attempt) => attempt.assignmentId === assignment.id && attempt.learnerId === learnerId,
      )
      const progress = learnerAttemptProgress(assignment, context, own, ctx.now)
      return {
        learnerId,
        resubmissionRequested: false,
        submissionId: null,
        ...progress,
      }
    }
    const work =
      book.submissions.find(
        (row) =>
          row.submission.assignmentId === assignment.id && row.submission.learnerId === learnerId,
      ) ?? null
    const progress = learnerSubmissionProgress(ctx, viewer, book.grading, assignment, work)
    const allowance = progress.allowance
    return {
      learnerId,
      status: progress.status,
      resubmissionRequested: progress.resubmissionRequested,
      attemptId: null,
      submissionId: progress.submissionId,
      lastActivityAt: progress.latest?.submittedAt ?? null,
      used: work?.versions.length ?? 0,
      limit: allowance?.limit ?? null,
      remaining: allowance?.remaining ?? null,
      canAct: allowance?.canSubmit ?? false,
      blockedBy: allowance === null ? ('unavailable' as const) : allowance.blockedBy,
      actionableUntil: progress.actionableUntil,
      score:
        progress.score === null
          ? null
          : {
              earned: progress.score.total,
              possible: progress.score.max,
              percent: progress.score.percent,
            },
    }
  })
}

type RawProgress = ReturnType<typeof rawProgressOf>[number]

/** Kursiyerin bu atamada şu an yürüyen işi var mı: süren deneme, teslim ya da (öğrencide) taslak. */
function rowHasWork(book: WorkBook, assignment: StoredAssignment, row: RawProgress): boolean {
  return (
    row.status === 'in_progress' ||
    row.submissionId !== null ||
    book.drafts.has(`${assignment.id}:${row.learnerId}`)
  )
}

/** Hedeflenen kişilerden birinin yürüyen işi var mı (okuma yüzü: içerik ve dosya). */
const hasWork = (book: WorkBook, assignment: StoredAssignment, progress: readonly RawProgress[]) =>
  progress.some((row) => rowHasWork(book, assignment, row))

const rowKey = (assignmentId: string, learnerId: string) => `${assignmentId}:${learnerId}`

/**
 * İçerik kapısının yazma yüzü özetin her satırına (DOM-KYN-021, 025, 051; Sabah kararı 40): satırın
 * sonucu, sıradaki işlemin (süren işi sürdürmek ya da yeni iş açmak) yazma ucunda alacağı yanıttır.
 * Bütün satırlar tek sorguyla sınanır (`learnerWorkBlocks`).
 */
function contentBlocks(
  ctx: ServiceContext,
  book: WorkBook,
  rows: readonly { assignment: StoredAssignment; progress: readonly RawProgress[] }[],
) {
  return learnerWorkBlocks(
    ctx,
    rows.flatMap(({ assignment, progress }) =>
      progress.map((row) => ({
        key: rowKey(assignment.id, row.learnerId),
        learnerId: row.learnerId,
        pairs: workPairsOf(assignment, book.pairs),
        hasWork: rowHasWork(book, assignment, row),
      })),
    ),
  )
}

/**
 * Satıra içerik engelini işler. İçerik kuralı yazma uçlarında (`assertWorkOpen`) kapsam ve sürüm
 * denetiminden sonra, her core kuralından önce çalışır: kapalı içerik (`content_unavailable`) ve lisans engeli (`license_expired`) süren deneme,
 * hak ve pencere engellerinin yerine geçer. Süren işi olana lisans engeli dönmez; dolayısıyla
 * lisans engeli yalnız yeni iş açan satırda pencere ya da hak engelini örter (yazma ucu da önce 409
 * `resource_license_expired` döner). İçerik kapalıyken yeni işlem penceresi (`actionableUntil`)
 * anlamsızdır; süren denemenin bitişi kalır (durum zamanla değişir).
 */
function withContentBlock(row: RawProgress, block: LearnerWorkBlock) {
  if (block === null) return row
  return {
    ...row,
    canAct: false,
    blockedBy: block,
    actionableUntil: row.status === 'in_progress' ? row.actionableUntil : null,
  }
}

/** Satırların durum özeti, içerik engeliyle. */
async function progressOf(
  ctx: ServiceContext,
  viewer: LearnerViewer,
  book: WorkBook,
  assignments: readonly StoredAssignment[],
) {
  const rows = assignments.map((assignment) => ({
    assignment,
    progress: rawProgressOf(ctx, viewer, book, assignment),
  }))
  const blocks = await contentBlocks(ctx, book, rows)
  return new Map(
    rows.map(({ assignment, progress }) => [
      assignment.id,
      progress.map((row) =>
        withContentBlock(row, blocks.get(rowKey(assignment.id, row.learnerId)) ?? null),
      ),
    ]),
  )
}

/** Kursiyerin atama üzerinden şu an yürüyen işi var mı (görevden dosya açma yolunun lisans kuralı). */
export async function learnerHasWork(
  ctx: ServiceContext,
  viewer: LearnerViewer,
  assignment: StoredAssignment,
): Promise<boolean> {
  const book = await loadWork(ctx, viewer, [assignment])
  return hasWork(book, assignment, rawProgressOf(ctx, viewer, book, assignment))
}

/**
 * Sabitlenen sürümün kursiyer içeriği. Kapı, özetin ve yazma uçlarının sınadığı bütün sürümlere
 * bakar (`workPairsOf`: sabitlenen sürüm, puanlama sürümü, soruları ve okuma parçası). Telif
 * askısında süren işi olan kursiyer yönergeyi görmeye devam eder (Sabah kararı 47;
 * `learnerContentGate` `content` yüzü); yeni işi olmayan görmez, kaldırılmış içeriği kimse görmez.
 */
async function learnerContent(
  ctx: ServiceContext,
  viewer: LearnerViewer,
  book: WorkBook,
  assignment: StoredAssignment,
) {
  const progress = rawProgressOf(ctx, viewer, book, assignment)
  const pair = book.pairs.get(assignment.resourceVersionId)
  // Özetle aynı küme (`workPairsOf`): bağlı soru ya da okuma parçası kapalıysa görev içeriği de.
  const gate = await learnerContentGate(
    ctx,
    viewer,
    assignment,
    workPairsOf(assignment, book.pairs),
    () => Promise.resolve(hasWork(book, assignment, progress)),
    'content',
  )
  if (gate !== null || !pair) return { content: null, contentUnavailable: gate ?? 'unavailable' }
  const version = pair.version
  const view = learnerView(asCoreVersion(version), {
    random: seededRandom(`${version.id}:${ctx.actor.userId}`),
    showTranscript: assignment.showTranscript,
  })
  return {
    content: {
      versionId: view.id,
      title: view.title,
      body: learnerBody(view.content),
      attributions: view.attributions,
      licenseKind: view.licenseKind,
    },
    contentUnavailable: null,
  }
}

/**
 * Kursiyere dönük içerik gövdesi; her tür açıkça eşlenir, sayılmayan alan (ileride eklenecek
 * öğretmen notu gibi) yanıta girmez (yanıt şeması da süzer). Yazma şablonunun değerlendirme ölçütü
 * ve rubrik bağı öğretmenin puanlama notudur, çıkarılır. Otomatik puanlı içeriğin soruları yalnız
 * denemede gösterilir (süre denemeyle başlar, DOM-BEC-043): burada yalnız soru sayısı vardır.
 */
function learnerBody(content: LearnerResourceView['content']) {
  switch (content.type) {
    case 'text':
    case 'worksheet':
      return { type: content.type, body: content.body, fileId: content.fileId }
    case 'reading_passage':
      return { type: content.type, body: content.body }
    case 'audio':
    case 'video':
      return {
        type: content.type,
        fileId: content.fileId,
        transcript: content.transcript,
        captionsVtt: content.captionsVtt,
      }
    case 'file':
      return { type: content.type, fileId: content.fileId }
    case 'link':
      return { type: content.type, url: content.url, provider: content.provider }
    case 'book_reference':
      return {
        type: content.type,
        publisher: content.publisher,
        bookTitle: content.bookTitle,
        edition: content.edition,
        isbn: content.isbn,
        pages: content.pages,
        note: content.note,
      }
    case 'homework_template':
      return {
        type: content.type,
        instructions: content.instructions,
        submissionKinds: content.submissionKinds,
      }
    case 'question':
      return { type: content.type, questionCount: 1 }
    case 'quiz':
    case 'exercise_set':
      return { type: content.type, questionCount: content.items.length }
    default:
      return content satisfies never
  }
}

/** Rol kapsamlı, sayfalı atama listesi (IST-034); kursiyer satırında durum özeti (IST-051). */
export async function listTaskAssignments(ctx: ServiceContext, input: TaskAssignmentListInput) {
  const { viewer, total, rows, refs } = await loadTaskAssignmentPage(ctx, input)
  if (viewer.kind !== 'learner')
    return { total, items: rows.map((row) => staffAssignmentView(ctx, viewer, row, refs)) }
  const book = await loadWork(ctx, viewer, rows)
  const progress = await progressOf(ctx, viewer, book, rows)
  return {
    total,
    items: rows.map((row) => ({
      ...learnerAssignmentView(ctx, viewer, row, refs),
      progress: progress.get(row.id) ?? [],
    })),
  }
}

/**
 * Tek atama; kapsam dışı, olmayan veya başka kurumun ataması 404. Kursiyer görünümünde durum özeti
 * ve sabitlenen sürümün kursiyere dönük içeriği.
 */
export async function getTaskAssignment(ctx: ServiceContext, assignmentId: string) {
  const { viewer, assignment, refs } = await loadTaskAssignment(ctx, assignmentId)
  if (viewer.kind !== 'learner') return staffAssignmentView(ctx, viewer, assignment, refs)
  const view = learnerAssignmentView(ctx, viewer, assignment, refs)
  const book = await loadWork(ctx, viewer, [assignment])
  const progress = (await progressOf(ctx, viewer, book, [assignment])).get(assignment.id) ?? []
  return { ...view, progress, ...(await learnerContent(ctx, viewer, book, assignment)) }
}
