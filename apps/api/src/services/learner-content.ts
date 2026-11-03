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
 * kuraldır; üç yüzü vardır:
 *
 * - Okuma (`learnerContentGate`): görev ayrıntısındaki içerik (`services/task-progress.ts`,
 *   `surface: 'content'`) ve görevden dosya açma (`services/resource-files.ts`, `surface: 'file'`);
 *   deneme ayrıntısının soru ve parça metni (`attemptContentGate`, `services/task-attempts.ts`).
 * - Yazma (`assertLearnerWork`): deneme başlatma, cevap kaydı ve deneme teslimi
 *   (`services/task-attempts.ts`), taslak ve teslim (`services/task-submissions.ts`; konuşma kaydı
 *   da teslim sürümüdür). Dinleme hakkı dosya bağlantısıyla sayılır, okuma yüzünden geçer.
 * - Özet (`learnerWorkBlocks`): kursiyerin görev listesi ve ayrıntısındaki `canAct`/`blockedBy`
 *   yazma yüzünün sonucunu toplu sorguyla söyler; arayüz uçtan dönecek işlemi önermez.
 *
 * Kurallar ucuzdan pahalıya sınanır, ilk kapanan durur (`contentClosures`):
 *
 * 1. Sürüm var, içeriği silinmemiş ve yayın geçmişi var (bellekte; telif bildirimiyle incelemeye
 *    alınan sürümün yayın geçmişi vardır, 3. adımda kapanır).
 * 2. Kitap sahibiyle sınırlı lisansta kursiyerlerden biri kitap sahibi (core `reachesBookOwner`;
 *    bellekte). Okumada atamanın hedeflediği kişiler, yazmada kaydın kursiyeri sınanır.
 * 3. Kaynak kursiyerden çekilmemiş (bütün girdiler için tek sorgu): kaldırılmış (her yüzde kapalı)
 *    ya da telif bildirimiyle incelemede değil.
 * 4. Lisans süresi dolmuşsa yalnız süren işi olana açık (`hasWork` yalnız gerektiğinde çağrılır).
 *
 * İnceleme (telif askısı; Sabah kararları 40 ve 47): yeni iş açılmaz; süren işi (süren deneme,
 * taslak ya da teslim) olan kursiyer işi tamamlar ve görevin yönergesini ve sorularını görmeye
 * devam eder. Askıdaki içeriğin dosyası kimseye açılmaz (`surface: 'file'`; sabah kararları 36 ve
 * 39). Kaldırılmış içerikte süren iş dahil her yazma ve okuma kapalıdır.
 */

export type VersionPair = { resource: StoredResource; version: StoredResourceVersion }

/** Görev içeriğinin kursiyere kapalı olma nedeni; açıksa `null`. */
export type LearnerContentGate = 'unavailable' | 'license_expired' | null

/** Yazmanın (ve özetin) içerik engeli; açıksa `null`. Kodlar yazma uçlarının hata kodlarıdır. */
export type LearnerWorkBlock = 'content_unavailable' | 'license_expired' | null

/** Yayın geçmişi olan sürüm (yayında veya yerini yeni sürüme bırakmış) kursiyere gösterilir. */
const SHOWN_STATUSES = new Set(['published', 'archived'])

type ContentClosure = 'unavailable' | 'in_review' | 'license_expired'

interface ClosureInput {
  learners: readonly string[]
  pairs: readonly (VersionPair | undefined)[]
  hasWork: () => Promise<boolean>
}

/** Bellekte sınanan kurallar (1, 2); geçen girdinin sürüm çiftleri döner. */
function presentPairs({ learners, pairs }: ClosureInput): VersionPair[] | 'unavailable' {
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
  return present
}

/** Girdilerin kapanma nedenleri, sırayla; çekilmiş kaynaklar bütün girdiler için tek sorguda. */
async function contentClosures(
  ctx: ServiceContext,
  inputs: readonly ClosureInput[],
): Promise<(ContentClosure | null)[]> {
  const present = inputs.map(presentPairs)
  const resourceIds = new Set<string>()
  for (const pairs of present)
    if (pairs !== 'unavailable') for (const { resource } of pairs) resourceIds.add(resource.id)
  const withdrawn = await withdrawnResources(ctx.db, ctx.institutionId, [...resourceIds])
  return Promise.all(
    inputs.map(async (input, index): Promise<ContentClosure | null> => {
      const pairs = present[index] ?? 'unavailable'
      if (pairs === 'unavailable') return 'unavailable'
      const kinds = pairs.map(({ resource }) => withdrawn.get(resource.id))
      if (kinds.includes('removed')) return 'unavailable'
      if (kinds.includes('in_review')) return 'in_review'
      if (
        pairs.some(({ version }) => licenseExpired(version.license, ctx.now)) &&
        !(await input.hasWork())
      )
        return 'license_expired'
      return null
    }),
  )
}

async function contentClosure(ctx: ServiceContext, input: ClosureInput) {
  const [closure] = await contentClosures(ctx, [input])
  return closure ?? null
}

/**
 * Atamanın sabitlediği içerik kursiyere görünür mü. `pairs` sabitlenen sürüm ve gerekiyorsa (soru
 * görseli) quiz'in ilgili soru sürümleridir; hepsi açık olmalıdır. Kitap sahibi sınırında atamanın
 * hedeflediği kişilerden biri (velide çocuklarından biri) kitap sahibi olmalıdır. Telif askısında
 * görev içeriği (`content`) süren işi olana açıktır (Sabah kararı 47); dosya (`file`) kapalıdır.
 */
export function learnerContentGate(
  ctx: ServiceContext,
  viewer: Extract<Viewer, { kind: 'learner' }>,
  assignment: StoredAssignment,
  pairs: readonly (VersionPair | undefined)[],
  hasWork: () => Promise<boolean>,
  surface: 'content' | 'file',
): Promise<LearnerContentGate> {
  const learners = targetedLearners(viewer.classOf, assignment)
  return gateOf(ctx, { learners, pairs, hasWork }, surface)
}

async function gateOf(
  ctx: ServiceContext,
  input: ClosureInput,
  surface: 'content' | 'file',
): Promise<LearnerContentGate> {
  const closure = await contentClosure(ctx, input)
  if (closure !== 'in_review') return closure
  return surface === 'content' && (await input.hasWork()) ? null : 'unavailable'
}

/**
 * Denemenin soru ve parça metni kime görünür (`GET /task-attempts/:id`; DOM-KYN-025, 051). Öğrenci
 * ve veli görev içeriğiyle aynı `content` yüzünden geçer; kitap sahibi sınırı atamanın şu anki
 * hedefine değil kaydın kursiyerine uygulanır (sınıf değiştiren öğrenci eski denemesini okur).
 * `hasWork` kursiyerin bu atamada süren denemesidir: telif askısında süren denemesi olan görür
 * (Sabah kararı 47), olmayan görmez. Personel kaynak ayrıntısıyla tutarlıdır: kaldırılan sürümün
 * içeriği silinmiştir ve personele de gösterilmez (DOM-KYN-051), askıdaki ve lisansı dolmuş içerik
 * personele açıktır. Kapanan metin ve cevap anahtarıdır (açıklamasıyla); cevaplar, madde sonucu ve
 * puan görünür kalır.
 */
export async function attemptContentGate(
  ctx: ServiceContext,
  viewer: Viewer,
  learnerId: string,
  pairs: readonly (VersionPair | undefined)[],
  hasWork: () => Promise<boolean>,
): Promise<LearnerContentGate> {
  if (viewer.kind === 'learner')
    return gateOf(ctx, { learners: [learnerId], pairs, hasWork }, 'content')
  if (pairs.some((pair) => !pair || pair.version.content === null)) return 'unavailable'
  const ids = pairs.flatMap((pair) => (pair ? [pair.resource.id] : []))
  const withdrawn = await withdrawnResources(ctx.db, ctx.institutionId, [...new Set(ids)])
  return [...withdrawn.values()].includes('removed') ? 'unavailable' : null
}

/**
 * Görevin sürümlerinden biri kaldırıldı mı (DOM-KYN-051; bellekte, sorgusuz). Kaldırma kaynağın
 * bütün sürümlerini `removed` yapar, içeriğini ve cevap anahtarını siler: sabitlenen ya da bağlı
 * sürümün durumu yeterlidir. Geçmiş deneme kaydı ve cevaplar korunur; arayüz "Bu içerik kaldırıldı"
 * der. Telif askısı ve kitap sahibi sınırı kaldırma değildir (`attemptContentGate` söyler).
 */
export function contentRemoved(pairs: readonly (VersionPair | undefined)[]): boolean {
  return pairs.some((pair) => pair?.version.status === 'removed' || pair?.version.content === null)
}

export const CONTENT_MESSAGES = {
  content_unavailable: 'Bu içerik şu an kullanılamıyor; görev üzerinde çalışılamaz.',
  resource_license_expired:
    'Bu içeriğin lisans süresi dolmuş; yeni deneme veya teslim başlatılamaz.',
} as const

async function workBlock(
  closure: ContentClosure | null,
  hasWork: () => Promise<boolean>,
): Promise<LearnerWorkBlock> {
  switch (closure) {
    case null:
      return null
    case 'in_review':
      return (await hasWork()) ? null : 'content_unavailable'
    case 'unavailable':
      return 'content_unavailable'
    case 'license_expired':
      return 'license_expired'
    default:
      return closure satisfies never
  }
}

/** Özetin bir satırı: kaydın kursiyeri, sınanan sürümler ve sıradaki işlemin süren işi. */
export interface WorkBlockInput<K> {
  key: K
  learnerId: string
  pairs: readonly (VersionPair | undefined)[]
  /** Sıradaki işlem süren işi sürdürür mü (süren deneme, taslak ya da teslim). */
  hasWork: boolean
}

/**
 * Yazma yüzünün sonucu, birden çok satır için tek sorguyla (kursiyer görev özeti; N+1 yok). Bir
 * satırın sonucu, aynı girdiyle yazma ucunun (`assertLearnerWork`) vereceği yanıttır.
 */
export async function learnerWorkBlocks<K>(
  ctx: ServiceContext,
  inputs: readonly WorkBlockInput<K>[],
): Promise<Map<K, LearnerWorkBlock>> {
  const hasWork = (input: WorkBlockInput<K>) => () => Promise.resolve(input.hasWork)
  const closures = await contentClosures(
    ctx,
    inputs.map((input) => ({
      learners: [input.learnerId],
      pairs: input.pairs,
      hasWork: hasWork(input),
    })),
  )
  const blocks = new Map<K, LearnerWorkBlock>()
  for (const [index, input] of inputs.entries())
    blocks.set(input.key, await workBlock(closures[index] ?? null, hasWork(input)))
  return blocks
}

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
  const closure = await contentClosure(ctx, { learners: [learnerId], pairs, hasWork })
  const block = await workBlock(closure, hasWork)
  switch (block) {
    case null:
      return
    case 'content_unavailable':
      throw new RuleViolationError('content_unavailable', CONTENT_MESSAGES.content_unavailable)
    case 'license_expired':
      throw new AppError(409, 'resource_license_expired', CONTENT_MESSAGES.resource_license_expired)
    default:
      return block satisfies never
  }
}
