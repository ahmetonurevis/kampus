import { randomUUID } from 'node:crypto'

import { FILE_PURPOSES } from '@kampus/school-core/content/taxonomy.ts'
import { attemptState, isClosed } from '@kampus/school-core/skills/scoring.ts'

import type { Database } from '../db/client.ts'
import type { StoredFile } from '../db/files.ts'
import { listFileVersionIds, listListeningContainerVersions } from '../db/resources.ts'
import {
  findAttempt,
  insertMediaPlay,
  loadAttemptsAmong,
  loadMediaPlays,
  loadVersionsAssignments,
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
 * Dinleme hakkı sayımı (OG-049, OG-052; IST-045; ADR 0003 karar 6, ADR 0004 karar 6; DOM-BEC-005).
 * Hak dinleme kaydının imzalı bağlantısı verilirken sayılır (`services/files.ts` `getFileUrl`) ve
 * `attempt_media_plays` satırı olarak bağlantıyla aynı transaction'da yazılır; hak bitince bağlantı
 * verilmez.
 *
 * Dinleme etkinliği quiz ya da alıştırma setidir; kaydı içerikteki `listeningVersionId` ile
 * bağlanan ses (`audio`) sürümüdür (core `content/resource.ts`). Kaydın dosyası ses sürümüne
 * bağlıdır (`listening_audio`), quiz'e değil: hak, dosyayı bağlayan ses sürümlerinden birini
 * dinleme kaydı olarak bağlayan quiz sürümlerinin atamalarından düşer. Atama 1 veya 2 hakkı yalnız
 * sayılabilir kayda (`listening_audio` dosyalı ses) bağlı içerikte kabul eder
 * (`services/task-assignments.ts`).
 *
 * Kurallar:
 * - Yalnız öğrencide sayılır. Öğretmen, yönetici (değerlendirme, dinleyip puanlama) ve veli
 *   bağlantısı sayılmaz; dosyanın okuma kuralı yine geçerlidir.
 * - Dosyayı bağlayan ses sürümleri bağ tablosundan (`resource_version_files`) okunur: sesin yeni
 *   sürümü ve kopyası aynı dosyayı taşır (DOM-KYN-006), quiz hangisine bağlandıysa o sayılır. Hak
 *   deneme × dosya başınadır; sınırı atama sabitler (1 veya 2; `null` sınırsız, sayılmaz).
 * - Karar öğrencinin bu atamalardaki süren denemelerinden verilir: sınırlı atamanın süren denemesi
 *   varsa hak ondan düşer (birden çoksa en erken başlayan); yalnız sınırsız atamanın süren denemesi
 *   varsa bağlantı sayılmadan verilir. Süren deneme hiç yokken sınırlı atama kursiyere açık ve
 *   teslim penceresi kapanmamışsa bağlantı verilmez (422 `listening_attempt_required`): deneme
 *   dışından sınırsız dinleme hakkı anlamsız kılardı. Teslim kapandıktan sonra bağlantı sayılmadan
 *   verilir.
 * - Bir dinleme bir bağlantı ömrüdür (`listeningWindowMs`): son sayılan dinlemenin penceresinde
 *   aynı deneme ve dosya için yeni bağlantı istenirse hak yeniden sayılmaz, aynı bitiş anıyla yeni
 *   imzalı bağlantı döner (sayfa yenileme, oynatıcının yeniden bağlanması). Aralık (`Range`)
 *   istekleri imzalı bağlantının kendisine gider ve hiç sayılmaz.
 * - Eşzamanlılık: deneme satırı `for update` ile kilitlenir; aynı denemenin sayımları ve teslimi
 *   sıraya girer. `(institution_id, attempt_id, file_id, play_number)` tekil indeksi son güvencedir.
 * - TODO(dinleme-teslim-sayisi): DOM-BEC-005 "dinleme sayısı teslimle birlikte kaydedilir" der;
 *   sayım `attempt_media_plays`'te kalır ve deneme ayrıntısında okunur, teslimin kendisine
 *   yazılmaz (deneme kapanınca sabitlenmiş bir dinleme sayısı yoktur).
 */

/** İçerik sürümüne bağlı dosyanın kayıt türü (ADR 0003 karar 5). */
export const RESOURCE_VERSION_ATTACHMENT = 'resource_version'

export const LISTENING_MESSAGES = {
  listening_plays_exhausted: 'Bu kaydın dinleme hakkı doldu.',
  listening_attempt_required: 'Dinleme kaydı görevin denemesi içinde açılır; önce görevi başlatın.',
} as const

/** Kaydın sonundaki pay: yükleme ve oynatıcı gecikmesi. */
const LISTENING_SLACK_MS = 60_000
/** En kısa pencere: dosyaların varsayılan bağlantı ömrü (ADR 0003 karar 6). */
const LISTENING_MIN_WINDOW_MS = FILE_PURPOSE_ACCESS.listening_audio.linkTtlSeconds * 1000
/** Süresi ölçülmemiş kaydın penceresi core kayıt üst sınırından (15 dk, DOM-KYN-004) çıkar. */
const LISTENING_MAX_AUDIO_MS = FILE_PURPOSES.listening_audio.maxDurationSeconds * 1000

/**
 * Bir dinlemenin penceresi ve dinleme bağlantısının ömrü: kayıt süresi + 60 sn, en az 5 dk.
 * Süre ölçülmemişse (`files.duration_ms` boş, F3c2b) kayıt üst sınırı esas alınır: 15 dk + 60 sn.
 * Sabit 5 dk, 15 dk'lık kaydı ortasında keserdi.
 */
export function listeningWindowMs(durationMs: number | null): number {
  if (durationMs === null) return LISTENING_MAX_AUDIO_MS + LISTENING_SLACK_MS
  return Math.max(LISTENING_MIN_WINDOW_MS, durationMs + LISTENING_SLACK_MS)
}

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
  windowMs: number
}): ListeningPlan {
  const last = input.plays.reduce<(typeof input.plays)[number] | null>(
    (latest, play) => (latest === null || play.playNumber > latest.playNumber ? play : latest),
    null,
  )
  if (last !== null) {
    const windowEnds = Date.parse(last.playedAt) + input.windowMs
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
    expiresAt: new Date(input.now.getTime() + input.windowMs),
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
  const audioVersionIds = [
    ...new Set([file.attachedId, ...(await listFileVersionIds(tx, ctx.institutionId, file.id))]),
  ]
  const containers = await listListeningContainerVersions(tx, ctx.institutionId, audioVersionIds)
  if (containers.length === 0) return null
  const assignments = await loadVersionsAssignments(
    tx,
    ctx.institutionId,
    containers.map((container) => container.id),
  )
  const limited = assignments.filter((assignment) => assignment.listeningPlays !== null)
  if (limited.length === 0) return null
  // Kapsam işlemin bağlantısıyla okunur: PGlite tek bağlantılıdır, `ctx.db` burada beklerdi.
  const viewer = await viewerOf({ ...ctx, db: tx })
  const learnerId = learnerOf(viewer)
  if (learnerId === null) return null
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]))
  const attempts = await loadAttemptsAmong(tx, ctx.institutionId, [...byId.keys()], [learnerId])
  const runningAttempts = attempts
    .filter((attempt) => {
      const assignment = byId.get(attempt.assignmentId)
      return assignment !== undefined && running(assignment, attempt, ctx.now)
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const candidate = runningAttempts.find(
    (attempt) => byId.get(attempt.assignmentId)?.listeningPlays !== null,
  )
  // Yalnız sınırsız atamanın denemesi sürüyorsa hak düşülecek deneme yoktur, bağlantı sayılmaz.
  if (candidate === undefined && runningAttempts.length > 0) return null
  // Kilitten sonra yeniden okunur: bu arada teslim edilmiş deneme sayılmaz.
  const locked =
    candidate && (await findAttempt(tx, ctx.institutionId, candidate.id, { lock: true }))
  const assignment = locked ? byId.get(locked.assignmentId) : undefined
  if (!locked || !assignment || !running(assignment, locked, ctx.now)) {
    const open = limited.some(
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
  const plan = planListeningPlay({
    limit,
    plays,
    now: ctx.now,
    windowMs: listeningWindowMs(file.durationMs),
  })
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
 * Deneme okumasındaki dinleme özeti: sınırlı atamada dinleme kaydının dosyası (`recordingFileId`,
 * atamanın puanlama sürümünün bağladığı ses sürümünden) ve sayılmış dinlemeler (kayıt sonradan
 * kaldırıldıysa da sayım görünür). Sınırsız atamada ve sayacak dinleme kaydı olmayan atamada
 * `null`: uygulanmayan sınır gösterilmez.
 */
export async function listeningSummary(
  db: Database,
  institutionId: string,
  assignment: StoredAssignment,
  attemptId: string,
  recordingFileId: string | null,
) {
  const limit = assignment.listeningPlays
  if (limit === null) return null
  const plays = await loadMediaPlays(db, institutionId, attemptId)
  const fileIds = [
    ...new Set([
      ...(recordingFileId === null ? [] : [recordingFileId]),
      ...plays.map((p) => p.fileId),
    ]),
  ]
  if (fileIds.length === 0) return null
  return {
    limit,
    media: fileIds.sort().map((fileId) => {
      const used = plays.filter((play) => play.fileId === fileId).length
      return { fileId, used, remaining: Math.max(0, limit - used) }
    }),
  }
}
