import { licenseExpired } from '@kampus/school-core/content/taxonomy.ts'
import { reachesBookOwner } from '@kampus/school-core/content/visibility.ts'

import {
  withdrawnResources,
  type StoredResource,
  type StoredResourceVersion,
} from '../db/resources.ts'
import type { StoredAssignment } from '../db/skills.ts'
import { AppError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { targetedLearners, type Viewer } from './task-assignments.ts'

/**
 * Görevin sabitlediği içeriğin kursiyere açık olma kuralı (DOM-KYN-021, 025, 051; IST-036). Tek
 * kuraldır; iki yüzü vardır:
 *
 * - Okuma (`learnerContentGate`): görev ayrıntısındaki içerik (`services/task-progress.ts`) ve
 *   görevden dosya açma (`services/resource-files.ts`).
 * - Yazma (`assertLearnerWork`): deneme başlatma, cevap kaydı ve deneme teslimi
 *   (`services/task-attempts.ts`), taslak ve teslim (`services/task-submissions.ts`; konuşma kaydı
 *   da teslim sürümüdür). Dinleme hakkı dosya bağlantısıyla sayılır, okuma yüzünden geçer.
 *
 * Kurallar ucuzdan pahalıya sınanır, ilk kapanan durur (`contentClosure`):
 *
 * 1. Sürüm var, içeriği silinmemiş ve yayın geçmişi var (bellekte; telif bildirimiyle incelemeye
 *    alınan sürümün yayın geçmişi vardır, 3. adımda kapanır).
 * 2. Kitap sahibiyle sınırlı lisansta kursiyerlerden biri kitap sahibi (core `reachesBookOwner`;
 *    bellekte). Okumada atamanın hedeflediği kişiler, yazmada kaydın kursiyeri sınanır.
 * 3. Kaynak kursiyerden çekilmemiş (tek sorgu): kaldırılmış (her yüzde kapalı) ya da telif
 *    bildirimiyle incelemede değil.
 * 4. Lisans süresi dolmuşsa yalnız süren işi olana açık (`hasWork` yalnız gerektiğinde çağrılır).
 *
 * İnceleme okumada süren işe de kapalıdır (içerik gösterilmez). Yazmada süren iş tamamlanır, yeni
 * iş açılmaz: süren deneme kaydedilir ve teslim edilir, taslağı ya da teslimi olan kursiyer teslim
 * eder (sabah kararı adayı; DOM-KYN-025 süren işi ayrıca düzenlemez, lisans kuralı örnek alındı).
 */

export type VersionPair = { resource: StoredResource; version: StoredResourceVersion }

/** Görev içeriğinin kursiyere kapalı olma nedeni; açıksa `null`. */
export type LearnerContentGate = 'unavailable' | 'license_expired' | null

/** Yayın geçmişi olan sürüm (yayında veya yerini yeni sürüme bırakmış) kursiyere gösterilir. */
const SHOWN_STATUSES = new Set(['published', 'archived'])

type ContentClosure = 'unavailable' | 'in_review' | 'license_expired'

async function contentClosure(
  ctx: ServiceContext,
  learners: readonly string[],
  pairs: readonly (VersionPair | undefined)[],
  hasWork: () => Promise<boolean>,
): Promise<ContentClosure | null> {
  const present: VersionPair[] = []
  for (const pair of pairs) {
    if (!pair || pair.version.content === null) return 'unavailable'
    const { status, publishedAt } = pair.version
    const reported = status === 'in_review' && publishedAt !== null
    if (!reported && !SHOWN_STATUSES.has(status)) return 'unavailable'
    if (!learners.some((id) => reachesBookOwner(pair.resource, pair.version, id)))
      return 'unavailable'
    present.push(pair)
  }
  const withdrawn = await withdrawnResources(
    ctx.db,
    ctx.institutionId,
    present.map(({ resource }) => resource.id),
  )
  if ([...withdrawn.values()].includes('removed')) return 'unavailable'
  if (withdrawn.size > 0) return 'in_review'
  if (present.some(({ version }) => licenseExpired(version.license, ctx.now)) && !(await hasWork()))
    return 'license_expired'
  return null
}

/**
 * Atamanın sabitlediği içerik kursiyere görünür mü. `pairs` sabitlenen sürüm ve gerekiyorsa (soru
 * görseli) quiz'in ilgili soru sürümleridir; hepsi açık olmalıdır. Kitap sahibi sınırında atamanın
 * hedeflediği kişilerden biri (velide çocuklarından biri) kitap sahibi olmalıdır.
 */
export async function learnerContentGate(
  ctx: ServiceContext,
  viewer: Extract<Viewer, { kind: 'learner' }>,
  assignment: StoredAssignment,
  pairs: readonly (VersionPair | undefined)[],
  hasWork: () => Promise<boolean>,
): Promise<LearnerContentGate> {
  const learners = targetedLearners(viewer.classOf, assignment)
  const closure = await contentClosure(ctx, learners, pairs, hasWork)
  return closure === 'in_review' ? 'unavailable' : closure
}

export const CONTENT_MESSAGES = {
  content_unavailable: 'Bu içerik şu an kullanılamıyor; görev üzerinde çalışılamaz.',
  resource_license_expired:
    'Bu içeriğin lisans süresi dolmuş; yeni deneme veya teslim başlatılamaz.',
} as const

/**
 * Kursiyer bu içerikte çalışabilir mi (yazma uçları). `learnerId` kaydın kursiyeridir: sınıf
 * değiştiren öğrenci süren denemesini bitirir, kitap sahibi sınırı yine ona uygulanır. `hasWork`
 * kursiyerin süren işidir (yeni denemede hiç yoktur; süren denemede vardır; yazmada taslak ya da
 * teslim). Kaldırılmış, yayın geçmişi olmayan ya da kitap sahibine sınırlı içerik ve süren işi
 * olmayan kursiyere incelemedeki içerik 422 `content_unavailable`; süren işi olmayana lisansı
 * dolmuş içerik 409 `resource_license_expired` (atama ucuyla aynı kod). Okuma yüzüyle aynı nedeni
 * söyler: kaldırma ile inceleme kursiyere ayrılmaz.
 */
export async function assertLearnerWork(
  ctx: ServiceContext,
  learnerId: string,
  pairs: readonly (VersionPair | undefined)[],
  hasWork: () => Promise<boolean>,
): Promise<void> {
  const closure = await contentClosure(ctx, [learnerId], pairs, hasWork)
  switch (closure) {
    case null:
      return
    case 'in_review':
      if (await hasWork()) return
      throw new RuleViolationError('content_unavailable', CONTENT_MESSAGES.content_unavailable)
    case 'unavailable':
      throw new RuleViolationError('content_unavailable', CONTENT_MESSAGES.content_unavailable)
    case 'license_expired':
      throw new AppError(409, 'resource_license_expired', CONTENT_MESSAGES.resource_license_expired)
    default:
      return closure satisfies never
  }
}
