import { learnerView, passageView, seededRandom } from '@kampus/school-core/content/resource.ts'
import { licenseExpired } from '@kampus/school-core/content/taxonomy.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { scoringItemsFor, type QuestionVersionRef } from '@kampus/school-core/skills/assignment.ts'
import type { AttemptTiming, ScoringItem } from '@kampus/school-core/skills/scoring.ts'

import type { Database } from '../db/client.ts'
import { asCoreVersion, loadVersionPairs, type StoredResourceVersion } from '../db/resources.ts'
import type { StoredAssignment } from '../db/skills.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { AppError, ForbiddenError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
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
 * öğrenciye açıktır.
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
  /** Puanlama sürümü, soruların ve okuma parçasının lisansları (DOM-KYN-021; `assertLicenseActive`). */
  licenses: readonly StoredResourceVersion['license'][]
  /**
   * Okuma-anlama etkinliğinin parçası (IST-042; DOM-BEC-006): puanlama sürümündeki
   * `passageVersionId`. Bağ yoksa ya da parça okunamıyorsa (kaldırıldı) `null`.
   */
  passage: StoredResourceVersion | null
}

/**
 * Atamanın puanlama sürümünün maddeleri (DOM-BEC-010; core `scoringItemsFor`). Puan her okumada
 * bu sürümün anahtarından hesaplanır (ADR 0004 karar 5); yeniden puanlama sürümü değiştirince
 * aynı cevaplar yeni anahtarla okunur. Tek soru atanmışsa soru kendi maddesidir (1 puan).
 * Okunamayan veya anahtarsız soru core'un 404/422'sidir.
 */
export function scoringContext(
  db: Database,
  institutionId: string,
  assignment: StoredAssignment,
): Promise<ScoringContext> {
  return versionScoringContext(db, institutionId, assignment.scoringVersionId)
}

/**
 * Bir içerik sürümünün puanlama bağlamı (seviye tespit formu da; `services/cefr.ts`). Kurallar
 * `scoringContext` ile aynıdır.
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

/**
 * Birden çok atamanın puanlama bağlamı, iki toplu okumayla (kursiyerin görev listesindeki durum
 * özeti; `services/task-progress.ts`). Bağlamı kurulamayan atama (okunamayan sürüm, otomatik
 * puanlanmayan içerik, anahtarsız soru) haritada `Error` olarak durur; listenin geri kalanı
 * etkilenmez.
 */
export async function scoringContexts(
  db: Database,
  institutionId: string,
  assignments: readonly StoredAssignment[],
): Promise<Map<string, ScoringContext | Error>> {
  const pairs = await loadVersionPairs(
    db,
    institutionId,
    assignments.map((assignment) => assignment.scoringVersionId),
  )
  const questions = await loadVersionPairs(
    db,
    institutionId,
    [...pairs.values()].flatMap(({ version }) => linkedIdsOf(version)),
  )
  const contexts = new Map<string, ScoringContext | Error>()
  for (const assignment of assignments) {
    try {
      contexts.set(
        assignment.id,
        buildScoringContext(pairs.get(assignment.scoringVersionId)?.version, questions),
      )
    } catch (error) {
      contexts.set(assignment.id, error instanceof Error ? error : new Error('scoring context'))
    }
  }
  return contexts
}

/** Quiz ve alıştırma setinin soru sürümleri ve okuma parçası; diğer türlerde okunmaz. */
function linkedIdsOf(scoring: StoredResourceVersion | undefined): string[] {
  const content = scoring?.content ?? null
  if (content?.type !== 'quiz' && content?.type !== 'exercise_set') return []
  const ids = content.items.map((item) => item.questionVersionId)
  return content.passageVersionId === null ? ids : [...ids, content.passageVersionId]
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
  switch (content.type) {
    case 'question':
      entries = [{ questionVersionId: scoring.id, points: 1 }]
      versions = new Map([[scoring.id, scoring]])
      break
    case 'quiz':
    case 'exercise_set':
      entries = content.items
      if (content.passageVersionId !== null) {
        const linked = questionPairs.get(content.passageVersionId)?.version
        passage = linked?.content?.type === 'reading_passage' ? linked : null
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
      ],
      passage,
    }
  } catch (error) {
    throw mapOperationError(error)
  }
}

/** Puanlama sürümünün veya sorularından birinin lisansı doldu mu (bitiş günü dahil geçerli). */
export const scoringLicenseExpired = (context: ScoringContext, now: Date) =>
  context.licenses.some((license) => licenseExpired(license, now))

/**
 * Lisansı dolmuş içerikte yeni deneme başlamaz (DOM-KYN-021; core `licenseExpired`, bitiş günü
 * dahil geçerli): puanlama sürümünün veya sorularından birinin lisansı dolduysa 409
 * `resource_license_expired`. Süren deneme kaydedilir ve teslim edilir (kursiyerin başladığı iş
 * kaybolmaz); bu denetim yalnız başlatmadadır.
 */
export function assertLicenseActive(context: ScoringContext, now: Date) {
  if (scoringLicenseExpired(context, now))
    throw new AppError(
      409,
      'resource_license_expired',
      'Bu içeriğin lisans süresi dolmuş; yeni deneme başlatılamaz.',
    )
}

/**
 * Denemede gösterilen sorular: anahtar ve açıklama yoktur (ADR 0004 karar 3, core `learnerView`);
 * seçenekler deneme ve soru kimliğinden tohumlu karıştırılır, sayfa yenilenince sıra aynı kalır.
 */
// TODO(F4b3-soru-sirasi): Quiz'in `shuffleItems` ayarı soru sırasını karıştırmaz; core'da madde
// sırası için dışa açık karıştırıcı yok, sorular yazarın sırasıyla gelir.
export function questionsFor(context: ScoringContext, attemptId: string) {
  return context.items.map((item) => {
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
