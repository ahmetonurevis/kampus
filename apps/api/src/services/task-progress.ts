import {
  learnerView,
  seededRandom,
  type LearnerResourceView,
} from '@kampus/school-core/content/resource.ts'
import { licenseExpired } from '@kampus/school-core/content/taxonomy.ts'

import type { Database } from '../db/client.ts'
import { asCoreVersion, listResourceVersions, loadVersionPairs } from '../db/resources.ts'
import {
  loadAttemptsAmong,
  loadDraft,
  loadSubmissionsAmong,
  type StoredAssignment,
  type StoredAttempt,
  type StoredSubmissionWork,
} from '../db/skills.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
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
import { scoringContexts, type ScoringContext } from './task-work.ts'

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
 * Liste satır başına istek atmaz: denemeler, teslimler, puanlar ve puanlama bağlamları toplu okunur.
 *
 * İçerik (`content`, yalnız ayrıntı): atamada sabitlenen sürümün kursiyere dönük hâli (core
 * `learnerView`): cevap anahtarı ve lisans ayrıntısı yoktur, kaynak gösterimi korunur (DOM-KYN-024),
 * yazma şablonunun değerlendirme ölçütü ve rubrik bağı (puanlama notu) çıkarılır, otomatik puanlı
 * içeriğin soru metinleri yalnız denemede görünür (burada soru sayısı). Kaldırılmış veya
 * yayın geçmişi olmayan sürüm ve herhangi bir sürümü telif bildirimiyle incelemede olan kaynak
 * (DOM-KYN-025; süren iş olsa da) `unavailable`. Lisansı dolmuş içerik (DOM-KYN-021; deneme uçlarındaki
 * kural) yeni iş başlatmaz ama süren iş biter: süren denemesi, teslimi ya da taslağı olan kursiyere
 * içerik gösterilir, olmayana `license_expired` döner.
 */

type LearnerViewer = Extract<Viewer, { kind: 'learner' }>

interface WorkBook {
  attempts: readonly StoredAttempt[]
  submissions: readonly StoredSubmissionWork[]
  contexts: ReadonlyMap<string, ScoringContext | Error>
  grading: Awaited<ReturnType<typeof loadGrading>>
}

/** Atamaların kursiyer kayıtları, toplu okumayla (deneme, teslim, puan, puanlama bağlamı). */
async function loadWork(
  ctx: ServiceContext,
  viewer: LearnerViewer,
  assignments: readonly StoredAssignment[],
): Promise<WorkBook> {
  const learnerIds = [...viewer.classOf.keys()]
  const auto = assignments.filter((assignment) => assignment.scoringMode === 'auto')
  const written = assignments.filter((assignment) => assignment.scoringMode === 'teacher')
  const [attempts, submissions, contexts] = await Promise.all([
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
    scoringContexts(ctx.db, ctx.institutionId, auto),
  ])
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
  return { attempts, submissions, contexts, grading }
}

function progressOf(
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

type Progress = ReturnType<typeof progressOf>[number]

/** Kursiyerin şu an yürüyen işi var mı: süren deneme, teslim ya da (öğrencide) taslak. */
async function hasWork(ctx: ServiceContext, assignment: StoredAssignment, progress: Progress[]) {
  if (progress.some((row) => row.status === 'in_progress' || row.submissionId !== null)) return true
  if (assignment.scoringMode !== 'teacher' || ctx.actor.role !== 'ogrenci') return false
  const [learnerId] = progress.map((row) => row.learnerId)
  if (learnerId === undefined) return false
  return (await loadDraft(ctx.db, ctx.institutionId, assignment.id, learnerId)) !== null
}

/** Yayın geçmişi olan sürüm (yayında veya yerini yeni sürüme bırakmış) kursiyere gösterilir. */
const SHOWN_STATUSES = new Set(['published', 'archived'])

/**
 * Kaynak kursiyerden çekildi mi (DOM-KYN-025, 051): bir sürümü telif bildirimiyle incelemede
 * (yayın geçmişi olan `in_review`; ilk onay sürecindeki yeni taslak sayılmaz) ya da kaynak
 * kaldırılmış. Bildirim kaynak düzeyindedir: atamanın sabitlendiği eski sürüm de gösterilmez.
 */
function withdrawnFromLearners(
  versions: readonly { status: string; publishedAt: string | null }[],
) {
  return versions.some(
    (version) =>
      version.status === 'removed' ||
      (version.status === 'in_review' && version.publishedAt !== null),
  )
}

/**
 * Atamanın sabitlediği sürüm kursiyere gösterilebilir mi: yayın geçmişi var, içeriği silinmemiş ve
 * kaynağı kursiyerden çekilmemiş (DOM-KYN-025, 051). Ayrıntıdaki içerik ve sürüme atanmış görevden
 * dosya okuma (`services/resource-files.ts`) aynı kuralı kullanır.
 */
export async function shownToLearners(
  db: Database,
  institutionId: string,
  pair: { resource: { id: string }; version: { status: string; content: unknown } } | undefined,
): Promise<boolean> {
  if (!pair || pair.version.content === null || !SHOWN_STATUSES.has(pair.version.status))
    return false
  return !withdrawnFromLearners(await listResourceVersions(db, institutionId, pair.resource.id))
}

async function learnerContent(
  ctx: ServiceContext,
  assignment: StoredAssignment,
  progress: Progress[],
) {
  const pairs = await loadVersionPairs(ctx.db, ctx.institutionId, [assignment.resourceVersionId])
  const pair = pairs.get(assignment.resourceVersionId)
  const version = pair?.version
  if (!pair || !version || !(await shownToLearners(ctx.db, ctx.institutionId, pair)))
    return { content: null, contentUnavailable: 'unavailable' as const }
  if (licenseExpired(version.license, ctx.now) && !(await hasWork(ctx, assignment, progress)))
    return { content: null, contentUnavailable: 'license_expired' as const }
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
  return {
    total,
    items: rows.map((row) => ({
      ...learnerAssignmentView(ctx, viewer, row, refs),
      progress: progressOf(ctx, viewer, book, row),
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
  const progress = progressOf(ctx, viewer, book, assignment)
  return { ...view, progress, ...(await learnerContent(ctx, assignment, progress)) }
}
