import { randomUUID } from 'node:crypto'

import { attemptState, isClosed } from '@kampus/school-core/skills/scoring.ts'

import type { Database } from '../db/client.ts'
import { listAttachedFiles, type StoredFile } from '../db/files.ts'
import {
  findAttempt,
  insertMediaPlay,
  loadAttemptsAmong,
  loadListeningAssignments,
  loadMediaPlays,
  type StoredAssignment,
  type StoredAttempt,
  type StoredMediaPlay,
} from '../db/skills.ts'
import { RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { FILE_PURPOSE_ACCESS } from './file-registry.ts'
import { viewerOf, visible, type Viewer } from './task-assignments.ts'
import { timingOf } from './task-work.ts'

/**
 * Dinleme hakkı sayımı (OG-049; IST-045; ADR 0003 karar 6, ADR 0004 karar 6; DOM-BEC-005). Hak
 * dinleme kaydının imzalı bağlantısı verilirken sayılır (`services/files.ts` `getFileUrl`) ve
 * `attempt_media_plays` satırı olarak bağlantıyla aynı transaction'da yazılır; hak bitince bağlantı
 * verilmez.
 *
 * Kurallar:
 * - Yalnız öğrencide sayılır. Öğretmen, yönetici (değerlendirme, dinleyip puanlama) ve veli
 *   bağlantısı sayılmaz; dosyanın okuma kuralı yine geçerlidir.
 * - Denemenin dinleme kaydı, atamanın sabitlediği içerik sürümüne bağlı (`attached_type =
 *   'resource_version'`) `listening_audio` dosyasıdır. Hak deneme × dosya başınadır; sınırı atama
 *   sabitler (1 veya 2; `null` sınırsız, sayılmaz).
 * - Süren deneme varsa hak ondan düşer. Süren deneme yokken görev kursiyere açık ve teslim
 *   penceresi kapanmamışsa bağlantı verilmez (422 `listening_attempt_required`): deneme dışından
 *   sınırsız dinleme hakkı anlamsız kılardı. Teslim kapandıktan sonra bağlantı sayılmadan verilir.
 * - Bir dinleme bir bağlantı ömrüdür: son sayılan dinlemenin bağlantısı geçerliyken (dinleme
 *   bağlantısı 5 dk) aynı deneme ve dosya için yeni bağlantı istenirse hak yeniden sayılmaz, aynı
 *   bitiş anıyla yeni imzalı bağlantı döner (sayfa yenileme, oynatıcının yeniden bağlanması).
 *   Aralık (`Range`) istekleri imzalı bağlantının kendisine gider ve hiç sayılmaz.
 * - Eşzamanlılık: deneme satırı `for update` ile kilitlenir; aynı denemenin sayımları ve teslimi
 *   sıraya girer. `(institution_id, attempt_id, file_id, play_number)` tekil indeksi son güvencedir.
 */

/** İçerik sürümüne bağlı dosyanın kayıt türü (ADR 0003 karar 5; bağlama işlemi F4b4'tedir). */
export const RESOURCE_VERSION_ATTACHMENT = 'resource_version'

export const LISTENING_MESSAGES = {
  listening_plays_exhausted: 'Bu kaydın dinleme hakkı doldu.',
  listening_attempt_required: 'Dinleme kaydı görevin denemesi içinde açılır; önce görevi başlatın.',
} as const

/** Aynı dinlemenin yeniden bağlantı penceresi: dinleme bağlantısının ömrü. */
export const LISTENING_REPLAY_WINDOW_MS = FILE_PURPOSE_ACCESS.listening_audio.linkTtlSeconds * 1000

export type ListeningPlan =
  { kind: 'count'; playNumber: number; expiresAt: Date } | { kind: 'reuse'; expiresAt: Date }

/**
 * Dosyanın bu denemedeki dinlemeleri ve hak sınırıyla karar (saf): pencere içindeyse yeniden
 * bağlantı, hak varsa yeni sayım, yoksa 422 `listening_plays_exhausted`.
 */
export function planListeningPlay(input: {
  limit: number
  plays: readonly Pick<StoredMediaPlay, 'playNumber' | 'playedAt'>[]
  now: Date
}): ListeningPlan {
  const last = input.plays.reduce<(typeof input.plays)[number] | null>(
    (latest, play) => (latest === null || play.playNumber > latest.playNumber ? play : latest),
    null,
  )
  if (last !== null) {
    const windowEnds = Date.parse(last.playedAt) + LISTENING_REPLAY_WINDOW_MS
    if (windowEnds > input.now.getTime()) return { kind: 'reuse', expiresAt: new Date(windowEnds) }
  }
  if (input.plays.length >= input.limit)
    throw new RuleViolationError(
      'listening_plays_exhausted',
      LISTENING_MESSAGES.listening_plays_exhausted,
    )
  return {
    kind: 'count',
    playNumber: input.plays.length + 1,
    expiresAt: new Date(input.now.getTime() + LISTENING_REPLAY_WINDOW_MS),
  }
}

export type ListeningGrant = {
  attemptId: string
  limit: number
  used: number
  remaining: number
  counted: boolean
  expiresAt: Date
}

const running = (assignment: StoredAssignment, attempt: StoredAttempt, now: Date) =>
  attemptState(attempt, timingOf(assignment), now.toISOString()).status === 'in_progress'

/** Öğrencinin kendi kursiyer kimliği; öğrenci bağlantısı yoksa `null` (sayılacak deneme yok). */
function learnerOf(viewer: Viewer): string | null {
  if (viewer.kind !== 'learner') return null
  const [learnerId] = viewer.classOf.keys()
  return learnerId ?? null
}

/**
 * Dinleme kaydının bağlantısı için hak kararı ve sayım (`getFileUrl` transaction'ında, dosyanın
 * okuma kuralından sonra). Sayılmayan durumda (personel, sınırsız veya kapanmış görev) `null`.
 */
export async function grantListeningPlay(
  tx: Database,
  ctx: ServiceContext,
  file: StoredFile,
): Promise<ListeningGrant | null> {
  if (
    ctx.actor.role !== 'ogrenci' ||
    file.purpose !== 'listening_audio' ||
    file.attachedType !== RESOURCE_VERSION_ATTACHMENT ||
    file.attachedId === null
  )
    return null
  const assignments = await loadListeningAssignments(tx, ctx.institutionId, file.attachedId)
  if (assignments.length === 0) return null
  // Kapsam işlemin bağlantısıyla okunur: PGlite tek bağlantılıdır, `ctx.db` burada beklerdi.
  const viewer = await viewerOf({ ...ctx, db: tx })
  const learnerId = learnerOf(viewer)
  if (learnerId === null) return null
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]))
  const attempts = await loadAttemptsAmong(tx, ctx.institutionId, [...byId.keys()], [learnerId])
  const candidate = attempts
    .filter((attempt) => {
      const assignment = byId.get(attempt.assignmentId)
      return assignment !== undefined && running(assignment, attempt, ctx.now)
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0]
  // Kilitten sonra yeniden okunur: bu arada teslim edilmiş deneme sayılmaz.
  const locked =
    candidate && (await findAttempt(tx, ctx.institutionId, candidate.id, { lock: true }))
  const assignment = locked ? byId.get(locked.assignmentId) : undefined
  if (!locked || !assignment || !running(assignment, locked, ctx.now)) {
    const open = assignments.some(
      (item) => visible(viewer, item) && !isClosed(item.deadline, ctx.now.toISOString()),
    )
    if (open)
      throw new RuleViolationError(
        'listening_attempt_required',
        LISTENING_MESSAGES.listening_attempt_required,
      )
    return null
  }
  const limit = assignment.listeningPlays
  if (limit === null) return null
  const plays = (await loadMediaPlays(tx, ctx.institutionId, locked.id)).filter(
    (play) => play.fileId === file.id,
  )
  const plan = planListeningPlay({ limit, plays, now: ctx.now })
  if (plan.kind === 'count')
    await insertMediaPlay(tx, ctx.institutionId, {
      id: randomUUID(),
      attemptId: locked.id,
      fileId: file.id,
      playNumber: plan.playNumber,
      playedAt: ctx.now,
    })
  const used = plays.length + (plan.kind === 'count' ? 1 : 0)
  ctx.log.info({ event: 'listening.play', counted: plan.kind === 'count', used, limit })
  return {
    attemptId: locked.id,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    counted: plan.kind === 'count',
    expiresAt: plan.expiresAt,
  }
}

/**
 * Deneme okumasındaki dinleme özeti: sınırlı atamada içerik sürümünün dinleme kayıtları ve
 * sayılmış dinlemeler (kayıt sonradan silindiyse de sayım görünür). Sınırsız atamada `null`.
 */
export async function listeningSummary(
  db: Database,
  institutionId: string,
  assignment: StoredAssignment,
  attemptId: string,
) {
  const limit = assignment.listeningPlays
  if (limit === null) return null
  const media = await listAttachedFiles(db, institutionId, {
    type: RESOURCE_VERSION_ATTACHMENT,
    id: assignment.resourceVersionId,
    purpose: 'listening_audio',
  })
  const plays = await loadMediaPlays(db, institutionId, attemptId)
  const fileIds = [...new Set([...media.map((file) => file.id), ...plays.map((p) => p.fileId)])]
  return {
    limit,
    media: fileIds.sort().map((fileId) => {
      const used = plays.filter((play) => play.fileId === fileId).length
      return { fileId, used, remaining: Math.max(0, limit - used) }
    }),
  }
}
