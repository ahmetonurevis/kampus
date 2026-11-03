import {
  learnerView,
  listeningView,
  passageView,
  seededRandom,
  shuffleItemOrder,
} from '@kampus/school-core/content/resource.ts'
import { licenseExpired } from '@kampus/school-core/content/taxonomy.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { scoringItemsFor, type QuestionVersionRef } from '@kampus/school-core/skills/assignment.ts'
import type { AttemptTiming, ScoringItem } from '@kampus/school-core/skills/scoring.ts'

import type { Database } from '../db/client.ts'
import { asCoreVersion, loadVersionPairs, type StoredResourceVersion } from '../db/resources.ts'
import type { StoredAssignment } from '../db/skills.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ForbiddenError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { assertLearnerWork, type VersionPair } from './learner-content.ts'
import { mapOperationError } from './operation-runner.ts'
import { targetedLearners, visible, type Viewer } from './task-assignments.ts'

/**
 * Deneme ve teslim uçlarının ortak kapsamı ve puanlama bağlamı (F4b3a; ADR 0004 karar 5, 6;
 * docs/domain/beceri-gelisimi.md DOM-BEC-010, 040…046; yetki-ve-kapsam.md DOM-YTK-028).
 *
 * Görünürlük atamayı izler (DOM-YTK-028): atamayı gören personel (yönetici; atayan öğretmen;
 * atamayı kapsamındaki sınıf veya öğrenci hedefi yüzünden gören öğretmen, `visible`) o atamaya
 * yapılmış bütün deneme ve teslimleri görür; kursiyerin güncel sınıfına bakılmaz. Sınıf değiştiren
 * öğrencinin eski sınıftaki teslimini eski sınıfı gören öğretmen görmeye devam eder; yeni sınıfın
 * öğretmeni, yeni sınıfı hedeflemeyen atamayı (ve teslimlerini) görmez. Öğrenci kendi, veli
 * çocuklarının denemesini ve teslimini görür: bu kayıt sahipliğidir, hedefe bakmaz; sınıf
 * değiştiren öğrenci eski sınıfta yaptığı denemeyi, teslimi ve puanı görmeye devam eder.
 * Yazma (deneme başlatma, cevap, teslim, taslak) yalnız `ogrenci` rolündedir; rota ve servis ayrı
 * ayrı denetler (veli okur, yazamaz). Yeni deneme ve teslim yalnız atamanın şu an hedeflediği
 * öğrenciye açıktır. Her yazma içeriğin kursiyere açık olmasını da ister (`assertWorkOpen`).
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Atamada kişinin okuyabildiği kursiyerler. */
export type ReadableLearners =
  /** Atamanın bütün kursiyerleri (yönetici, atamayı gören öğretmen). */
  | { kind: 'all' }
  /** Yalnız bu kursiyerler (öğrencide kendisi, velide çocukları; sahiplik). */
  | { kind: 'some'; ids: readonly string[] }
  /** Atama kişiye kapalı (404). */
  | { kind: 'none' }

/**
 * Atamada kişinin okuyabildiği kursiyerler. Personelde atamayı görmek yeterlidir (görünürlük
 * atamayı izler, DOM-YTK-028). Öğrenci ve velide atamanın görünür olması gerekmez (sahiplik);
 * varlık sızıntısını çağıranın `assertLearnerReach`'i önler.
 */
export function readableLearners(viewer: Viewer, assignment: StoredAssignment): ReadableLearners {
  switch (viewer.kind) {
    case 'admin':
      return { kind: 'all' }
    case 'teacher':
      return visible(viewer, assignment) ? { kind: 'all' } : { kind: 'none' }
    case 'learner':
      return { kind: 'some', ids: [...viewer.classOf.keys()] }
    default:
      return viewer satisfies never
  }
}

/** Kişi atamanın bu kursiyerinin kaydını okuyabilir mi (`readableLearners`). */
export function canReadLearner(
  viewer: Viewer,
  assignment: StoredAssignment,
  learnerId: string,
): boolean {
  const readable = readableLearners(viewer, assignment)
  return readable.kind === 'all' || (readable.kind === 'some' && readable.ids.includes(learnerId))
}

/**
 * Liste sorgusunun kursiyer süzgeci: `undefined` atamanın bütün kursiyerleri. İstenen kursiyer
 * okuma kapsamı dışındaysa boş liste (sonuç boş döner, varlık sızmaz).
 */
export function learnerFilter(
  readable: Exclude<ReadableLearners, { kind: 'none' }>,
  requested: string | undefined,
): readonly string[] | undefined {
  if (readable.kind === 'all') return requested === undefined ? undefined : [requested]
  if (requested === undefined) return readable.ids
  return readable.ids.includes(requested) ? [requested] : []
}

/** Okuma kapsamındaki öğrenci/veli kursiyerleri (`assertLearnerReach` için); personelde boş. */
export const ownedLearners = (readable: ReadableLearners): readonly string[] =>
  readable.kind === 'some' ? readable.ids : []

/**
 * Yazan kişi yalnız öğrencidir (rol rotada da denetlenir; servis tek başına güvenli olsun diye
 * burada da). Kapsam denetiminden sonra çağrılır: sıra kapsam 404 → rol 403.
 */
function assertStudent(viewer: Extract<Viewer, { kind: 'learner' }>) {
  if (viewer.role !== 'ogrenci') throw new ForbiddenError()
}

/**
 * Yazan öğrencinin kendi kaydı: atama arşivlenmemiş ve öğrenciyi şu an hedefliyorsa öğrenci
 * kimliği, değilse 404 (kapsam; varlık sızmaz). Veli 403 (yalnız `ogrenci` yazar).
 */
export function targetedLearner(viewer: Viewer, assignment: StoredAssignment | null): string {
  if (!assignment || viewer.kind !== 'learner' || !visible(viewer, assignment))
    throw new NotFoundError()
  const [learnerId] = targetedLearners(viewer.classOf, assignment)
  if (learnerId === undefined) throw new NotFoundError()
  assertStudent(viewer)
  return learnerId
}

/**
 * Öğrencinin kendi kaydı: öğrenci/veli değilse 404; kaydın kursiyeri kapsamında değilse 404; veli
 * 403 (yalnız `ogrenci` yazar).
 */
export function ownRecord(viewer: Viewer, learnerId: string): void {
  if (viewer.kind !== 'learner' || !viewer.classOf.has(learnerId)) throw new NotFoundError()
  assertStudent(viewer)
}

/** Öğrencinin kendi kimliği (öğrenci görünümünde tek kursiyer); yoksa 404, veli 403. */
export function ownLearner(viewer: Viewer): string {
  if (viewer.kind !== 'learner') throw new NotFoundError()
  const [learnerId] = viewer.classOf.keys()
  if (learnerId === undefined) throw new NotFoundError()
  assertStudent(viewer)
  return learnerId
}

/**
 * Denemenin süre bağlamı (DOM-BEC-043): süre atamada sabitlenmiştir (içeriğin süresi atamada
 * çözülür). Bireysel ek süre için tablo yok; `TODO(F4b3-ek-sure)` ile 0 dakikadır.
 */
// TODO(F4b3-ek-sure): Ek süre (`extraTimeSchema`, gerekçesi kayıt geçmişinde) tablosu ve öğretmen
// ucu gelince kursiyerin ek süresi buradan okunur.
export function timingOf(assignment: StoredAssignment): AttemptTiming {
  return {
    timeLimitMinutes: assignment.timeLimitMinutes,
    extraMinutes: 0,
    deadline: assignment.deadline,
  }
}

/** Puanlama maddeleri ve kursiyerin gördüğü soru sürümleri. */
export interface ScoringContext {
  items: ScoringItem[]
  /** Soru sürümü kimliği → sürüm satırı; öğrenci görünümü `questionsFor` ile üretilir. */
  versions: ReadonlyMap<string, StoredResourceVersion>
  /**
   * Puanlama sürümü, soruların, okuma parçasının ve dinleme kaydının lisansları (DOM-KYN-021; `assertLicenseActive`,
   * kursiyer özetindeki başlatma engeli).
   */
  licenses: readonly StoredResourceVersion['license'][]
  /**
   * Okuma-anlama etkinliğinin parçası (IST-042; DOM-BEC-006): puanlama sürümündeki
   * `passageVersionId`. Bağ yoksa ya da parça okunamıyorsa (kaldırıldı) `null`.
   */
  passage: StoredResourceVersion | null
  /**
   * Dinleme etkinliğinin kaydı (IST-045; DOM-BEC-005): puanlama sürümündeki `listeningVersionId`.
   * Bağ yoksa ya da kayıt okunamıyorsa (kaldırıldı) `null`.
   */
  listening: StoredResourceVersion | null
  /**
   * Quiz'in `shuffleItems` ayarı (core `shuffleItemOrder`): açıksa kursiyer maddeleri deneme
   * kimliğinden tohumlu sırayla görür (`attemptItemOrder`). Puan, cevap ve sonuç madde kimliğiyle
   * eşlenir; `items` her zaman yazarın sırasındadır. Tek soru görevinde `false`.
   */
  shuffleItems: boolean
}

/**
 * Bir içerik sürümünün puanlama maddeleri (DOM-BEC-010; core `scoringItemsFor`; seviye tespit
 * formu, `services/cefr.ts`). Puan her okumada bu sürümün anahtarından hesaplanır (ADR 0004 karar
 * 5); yeniden puanlama sürümü değiştirince aynı cevaplar yeni anahtarla okunur. Tek soru atanmışsa
 * soru kendi maddesidir (1 puan). Okunamayan veya anahtarsız soru core'un 404/422'sidir. Görev
 * atamasında bağlam içerik kapısının okuduğu sürümlerden kurulur (`pairsScoringContext`).
 */
export async function versionScoringContext(
  db: Database,
  institutionId: string,
  versionId: string,
): Promise<ScoringContext> {
  const pairs = await loadVersionPairs(db, institutionId, [versionId])
  const scoring = pairs.get(versionId)?.version
  const questions = await loadVersionPairs(db, institutionId, linkedIdsOf(scoring))
  return buildScoringContext(scoring, questions)
}

/** Atamaların kursiyerin gördüğü sürüm çiftleri, sürüm kimliğiyle (`loadWorkPairs`). */
export type WorkPairs = ReadonlyMap<string, VersionPair>

/**
 * Atamaların kursiyerin denemede veya teslimde gördüğü bütün sürümleri, iki toplu okumayla:
 * sabitlenen sürüm, puanlama sürümü ve onun soruları ve okuma parçası. İçerik kapısı
 * (`assertWorkOpen`, görev özeti) ve puanlama bağlamı (`scoringContexts`) aynı okumayı kullanır.
 */
export async function loadWorkPairs(
  db: Database,
  institutionId: string,
  assignments: readonly StoredAssignment[],
): Promise<WorkPairs> {
  const ids = [
    ...new Set(assignments.flatMap((item) => [item.resourceVersionId, item.scoringVersionId])),
  ]
  const pinned = await loadVersionPairs(db, institutionId, ids)
  const linked = [
    ...new Set(
      assignments.flatMap((item) => linkedIdsOf(pinned.get(item.scoringVersionId)?.version)),
    ),
  ]
  const questions = await loadVersionPairs(
    db,
    institutionId,
    linked.filter((id) => !pinned.has(id)),
  )
  return new Map([...pinned, ...questions])
}

/**
 * İçerik kapısından geçmesi gereken sürümler (bulunmayan soru ya da parça `undefined`, kapalıdır):
 * sabitlenen sürüm, puanlama sürümü, soruları ve okuma parçası.
 */
export function workPairsOf(
  assignment: StoredAssignment,
  pairs: WorkPairs,
): (VersionPair | undefined)[] {
  const ids = [...new Set([assignment.resourceVersionId, assignment.scoringVersionId])]
  const linked = linkedIdsOf(pairs.get(assignment.scoringVersionId)?.version)
  return [...ids, ...linked].map((id) => pairs.get(id))
}

/**
 * Birden çok atamanın puanlama bağlamı, toplu okunmuş sürümlerden (`loadWorkPairs`; kursiyerin
 * görev listesindeki durum özeti, `services/task-progress.ts`). Bağlamı kurulamayan atama
 * (okunamayan sürüm, otomatik puanlanmayan içerik, anahtarsız soru) haritada `Error` olarak durur;
 * listenin geri kalanı etkilenmez.
 */
export function scoringContexts(
  assignments: readonly StoredAssignment[],
  pairs: WorkPairs,
): Map<string, ScoringContext | Error> {
  const contexts = new Map<string, ScoringContext | Error>()
  for (const assignment of assignments) {
    try {
      contexts.set(assignment.id, pairsScoringContext(assignment, pairs))
    } catch (error) {
      contexts.set(assignment.id, error instanceof Error ? error : new Error('scoring context'))
    }
  }
  return contexts
}

/**
 * Atamanın puanlama bağlamı, okunmuş sürümlerden (`loadWorkPairs`); kurallar `versionScoringContext`
 * ile aynıdır, kurulamazsa aynı hatayı fırlatır. Deneme ayrıntısı içerik kapısını aynı okumayla sınar.
 */
export function pairsScoringContext(
  assignment: StoredAssignment,
  pairs: WorkPairs,
): ScoringContext {
  return buildScoringContext(pairs.get(assignment.scoringVersionId)?.version, pairs)
}

/**
 * Quiz ve alıştırma setinin soru sürümleri, okuma parçası ve dinleme kaydı; diğer türlerde okunmaz.
 * Bağlı sürümlerin hepsi içerik kapısından geçer (`workPairsOf`): parça ya da kayıt kaldırılınca
 * etkinlik de kursiyere kapanır (DOM-KYN-025, 051).
 */
function linkedIdsOf(scoring: StoredResourceVersion | undefined): string[] {
  const content = scoring?.content ?? null
  if (content?.type !== 'quiz' && content?.type !== 'exercise_set') return []
  const links = [content.passageVersionId, content.listeningVersionId]
  return [
    ...content.items.map((item) => item.questionVersionId),
    ...links.filter((id): id is string => id !== null),
  ]
}

/**
 * Atamanın dinleme kaydının dosyası, okunmuş sürümlerden (`loadWorkPairs`): puanlama sürümündeki
 * `listeningVersionId`'nin ses dosyası. Puanlama bağlamı kurulamasa da (kaldırılmış soru) okunur:
 * hak özeti dosya kimliğini buradan alır. Bağ yoksa, kayıt ses değilse ya da içeriği silindiyse
 * `null` (sayılmış dinlemeler özette yine görünür).
 */
export function recordingFileOf(assignment: StoredAssignment, pairs: WorkPairs): string | null {
  const content = pairs.get(assignment.scoringVersionId)?.version.content ?? null
  if (content?.type !== 'quiz' && content?.type !== 'exercise_set') return null
  if (content.listeningVersionId === null) return null
  const linked = pairs.get(content.listeningVersionId)?.version.content
  return linked?.type === 'audio' ? linked.fileId : null
}

function buildScoringContext(
  scoring: StoredResourceVersion | undefined,
  questionPairs: ReadonlyMap<string, { version: StoredResourceVersion }>,
): ScoringContext {
  const content = scoring?.content ?? null
  if (!scoring || content === null) throw new NotFoundError()
  let entries: { questionVersionId: string; points: number }[]
  let versions: Map<string, StoredResourceVersion>
  let passage: StoredResourceVersion | null = null
  let listening: StoredResourceVersion | null = null
  let shuffleItems = false
  switch (content.type) {
    case 'question':
      entries = [{ questionVersionId: scoring.id, points: 1 }]
      versions = new Map([[scoring.id, scoring]])
      break
    case 'quiz':
    case 'exercise_set':
      entries = content.items
      shuffleItems = content.shuffleItems
      if (content.passageVersionId !== null) {
        const linked = questionPairs.get(content.passageVersionId)?.version
        // Okunamayan parça metinsiz gelir; kaldırılmış ya da askıdaki parçada yazma kapısı
        // (`assertWorkOpen`) zaten kapalıdır, bu yalnız okuma yüzü içindir.
        passage = linked?.content?.type === 'reading_passage' ? linked : null
      }
      if (content.listeningVersionId !== null) {
        const linked = questionPairs.get(content.listeningVersionId)?.version
        listening = linked?.content?.type === 'audio' ? linked : null
      }
      versions = new Map()
      for (const item of content.items) {
        const version = questionPairs.get(item.questionVersionId)?.version
        if (version !== undefined) versions.set(version.id, version)
      }
      break
    default:
      throw mapOperationError(
        new DomainError(
          'not_auto_scored',
          'Bu görev otomatik puanlanmaz; yazma, konuşma ve aracılık puanını öğretmen verir.',
        ),
      )
  }
  const refs = new Map<string, QuestionVersionRef>()
  for (const version of versions.values())
    if (version.content !== null)
      refs.set(version.id, {
        id: version.id,
        tags: version.tags,
        content: version.content,
        answerKey: version.answerKey,
      })
  try {
    return {
      items: scoringItemsFor({ parentTags: scoring.tags, items: entries, questions: refs }),
      versions,
      licenses: [
        scoring.license,
        ...[...versions.values()].map((version) => version.license),
        ...(passage === null ? [] : [passage.license]),
        ...(listening === null ? [] : [listening.license]),
      ],
      passage,
      listening,
      shuffleItems,
    }
  } catch (error) {
    throw mapOperationError(error)
  }
}

/** Puanlama sürümünün veya sorularından birinin lisansı doldu mu (bitiş günü dahil geçerli). */
export const scoringLicenseExpired = (context: ScoringContext, now: Date) =>
  context.licenses.some((license) => licenseExpired(license, now))

/**
 * Kursiyerin görevin içeriğinde çalışabilmesi (DOM-KYN-021, 025, 051; IST-036): okumayla aynı kural
 * (`services/learner-content.ts` `assertLearnerWork`). Sınanan sürümler kursiyerin denemede veya
 * teslimde gördükleridir: atamanın sabitlediği sürüm, puanlama sürümü ve onun soruları ve okuma parçası
 * (bulunmayan soru ya da parça da kapalıdır). `pairs` çağıranın aynı yazma transaction'ında
 * `loadWorkPairs` ile okuduğu sürümlerdir (puanlama bağlamı da onlardan kurulur; ikinci okuma yok):
 * kapı kurum kilidinden sonra okunan veriyle sınanır. Hata sırasında sürüm 409'undan sonra, core
 * kuralından önce gelir (`docs/muhendislik/api-tasarimi.md` §6).
 */
export async function assertWorkOpen(
  tx: Database,
  ctx: ServiceContext,
  assignment: StoredAssignment,
  pairs: WorkPairs,
  learnerId: string,
  hasWork: () => Promise<boolean>,
): Promise<void> {
  // Sorular ve okuma parçası (IST-042): parça kaldırılmış ya da askıdaysa etkinlik de kapalıdır.
  await assertLearnerWork({ ...ctx, db: tx }, learnerId, workPairsOf(assignment, pairs), hasWork)
}

/**
 * Denemenin madde sırası: `shuffleItems` açıksa deneme kimliğinden tohumlu karışım (sayfa
 * yenilenince aynı, denemeler arasında farklı olabilir), kapalıysa yazarın sırası. Yalnız
 * gösterim sırasıdır; puanlama ve cevap eşleme madde kimliğiyledir.
 */
export function attemptItemOrder(context: ScoringContext, attemptId: string): ScoringItem[] {
  return shuffleItemOrder(context.items, context.shuffleItems, seededRandom(`${attemptId}:items`))
}

/**
 * Madde kimlikli bir listeyi denemenin sırasına dizer (kursiyerin sonuç görünümü soru listesiyle
 * aynı sırada olsun diye); listede olmayan kimlik sona gider, göreli sırası korunur.
 */
export function inAttemptOrder<T extends { questionVersionId: string }>(
  list: readonly T[],
  context: ScoringContext,
  attemptId: string,
): T[] {
  if (!context.shuffleItems) return [...list]
  const rank = new Map(
    attemptItemOrder(context, attemptId).map((item, index) => [item.questionVersionId, index]),
  )
  const at = (item: T) => rank.get(item.questionVersionId) ?? rank.size
  return [...list].sort((a, b) => at(a) - at(b))
}

/**
 * Denemede gösterilen sorular: anahtar ve açıklama yoktur (ADR 0004 karar 3, core `learnerView`);
 * seçenekler deneme ve soru kimliğinden tohumlu karıştırılır, sayfa yenilenince sıra aynı kalır.
 * Quiz'in `shuffleItems` ayarı açıksa maddeler de deneme sırasıyla gelir (`attemptItemOrder`);
 * `authorOrder` personelin inceleme görünümüdür ve yazarın sırasını korur.
 */
export function questionsFor(
  context: ScoringContext,
  attemptId: string,
  options: { authorOrder?: boolean } = {},
) {
  const items = options.authorOrder === true ? context.items : attemptItemOrder(context, attemptId)
  return items.map((item) => {
    const version = context.versions.get(item.questionVersionId)
    const view =
      version === undefined
        ? null
        : learnerView(asCoreVersion(version), {
            random: seededRandom(`${attemptId}:${item.questionVersionId}`),
          })
    return {
      questionVersionId: item.questionVersionId,
      points: item.points,
      subskill: item.subskill ?? null,
      question: view?.content.type === 'question' ? view.content.question : item.question,
    }
  })
}

/**
 * Denemede okunan metin (IST-042; core `passageView`): seviye, hesaplanan kelime sayısı, sözlükçe
 * ve kaynak gösterimi. Sorular gibi yalnız denemede döner (süre denemeyle başlar, DOM-BEC-043);
 * parçada cevap yoktur. Bağ yoksa `null`.
 */
export function passageFor(context: ScoringContext) {
  return context.passage === null ? null : passageView(asCoreVersion(context.passage))
}

/**
 * Denemede dinlenen kayıt (IST-045; core `listeningView`): dosya kimliği, seviye ve kaynak
 * gösterimi; döküm ve altyazı yalnız `showTranscript` ile (personel hep; kursiyer ve veli core
 * `transcriptShown`: görev kapandı ya da alıştırmada açık ayar, DOM-BEC-005). Kaydın bağlantısı
 * `GET /files/:fileId/url` ile, hak sayılarak açılır. Bağ yoksa `null`.
 */
export function listeningFor(context: ScoringContext, showTranscript: boolean) {
  return context.listening === null
    ? null
    : listeningView(asCoreVersion(context.listening), { showTranscript })
}

/** Denetim kaydı: yalnız alan adları (cevap, metin ve öğrenci kimliği yazılmaz). */
export async function auditWork(
  tx: Database,
  ctx: ServiceContext,
  action: string,
  entity: { type: string; id: string },
  fields: string[],
) {
  await tx.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action,
    entityType: entity.type,
    entityId: entity.id,
    changes: { fields },
    createdAt: ctx.now,
  })
}
