import { learnerView, seededRandom } from '@kampus/school-core/content/resource.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { scoringItemsFor, type QuestionVersionRef } from '@kampus/school-core/skills/assignment.ts'
import type { AttemptTiming, ScoringItem } from '@kampus/school-core/skills/scoring.ts'

import type { Database } from '../db/client.ts'
import { asCoreVersion, loadVersionPairs, type StoredResourceVersion } from '../db/resources.ts'
import type { StoredAssignment } from '../db/skills.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { mapOperationError } from './operation-runner.ts'
import { targetedLearners, visible, type Viewer } from './task-assignments.ts'

/**
 * Deneme ve teslim uçlarının ortak kapsamı ve puanlama bağlamı (F4b3a; ADR 0004 karar 5, 6;
 * docs/domain/beceri-gelisimi.md DOM-BEC-010, 040…046; yetki-ve-kapsam.md DOM-YTK-028).
 *
 * Okuma kapsamı atama okumasıyla aynıdır (`services/task-assignments.ts` `visible`): yönetici
 * kurumun bütün kursiyerlerini; atayan öğretmen atamanın bütün kursiyerlerini; atamayı kapsamındaki
 * sınıf veya öğrenci hedefi yüzünden gören öğretmen yalnız kapsamındaki (güncel) öğrencilerini
 * görür. Öğrenci kendi, veli çocuklarının denemesini ve teslimini görür: bu kayıt sahipliğidir,
 * hedefe bakmaz; sınıf değiştiren öğrenci eski sınıfta yaptığı denemeyi, teslimi ve puanı görmeye
 * devam eder (F4b2b `TODO(F4b3-sinif-degisimi)` kapandı). Yazma (deneme başlatma, teslim) yalnız
 * atamanın şu an hedeflediği öğrenciye açıktır.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Atamada kişinin okuyabildiği kursiyerler: `undefined` bütün kursiyerler, liste yalnız onlar,
 * `null` atama kişiye kapalı (404). Öğrenci ve velide liste kendisi veya çocuklarıdır; atamanın
 * görünür olması gerekmez (sahiplik), varlık sızıntısını çağıran `assertReadable` ile önler.
 */
export function readableLearners(
  viewer: Viewer,
  assignment: StoredAssignment,
): readonly string[] | undefined | null {
  switch (viewer.kind) {
    case 'admin':
      return undefined
    case 'teacher':
      if (!visible(viewer, assignment)) return null
      return assignment.assignedByUserId === viewer.userId ? undefined : [...viewer.studentIds]
    case 'learner':
      return [...viewer.classOf.keys()]
    default:
      return viewer satisfies never
  }
}

/**
 * Kişi atamanın kursiyerinin kaydını okuyabilir mi. Öğrenci ve veli kendi/çocuğunun kaydını
 * atama görünmese de okur (sınıf değişimi); öğretmen `readableLearners` kapsamında.
 */
export function canReadLearner(
  viewer: Viewer,
  assignment: StoredAssignment,
  learnerId: string,
): boolean {
  const learners = readableLearners(viewer, assignment)
  return learners !== null && (learners === undefined || learners.includes(learnerId))
}

/**
 * Yazan öğrencinin kendi kaydı: atama arşivlenmemiş ve öğrenciyi şu an hedefliyorsa öğrenci
 * kimliği, değilse 404 (kapsam; varlık sızmaz). Rol denetimi (yalnız `ogrenci`) rotadadır.
 */
export function targetedLearner(viewer: Viewer, assignment: StoredAssignment | null): string {
  if (!assignment || viewer.kind !== 'learner' || !visible(viewer, assignment))
    throw new NotFoundError()
  const [learnerId] = targetedLearners(viewer.classOf, assignment)
  if (learnerId === undefined) throw new NotFoundError()
  return learnerId
}

/** Öğrencinin kendi kimliği (öğrenci görünümünde tek kursiyer); yoksa 404. */
export function ownLearner(viewer: Viewer): string {
  if (viewer.kind !== 'learner') throw new NotFoundError()
  const [learnerId] = viewer.classOf.keys()
  if (learnerId === undefined) throw new NotFoundError()
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
}

/**
 * Atamanın puanlama sürümünün maddeleri (DOM-BEC-010; core `scoringItemsFor`). Puan her okumada
 * bu sürümün anahtarından hesaplanır (ADR 0004 karar 5); yeniden puanlama sürümü değiştirince
 * aynı cevaplar yeni anahtarla okunur. Tek soru atanmışsa soru kendi maddesidir (1 puan).
 * Okunamayan veya anahtarsız soru core'un 404/422'sidir.
 */
export async function scoringContext(
  db: Database,
  institutionId: string,
  assignment: StoredAssignment,
): Promise<ScoringContext> {
  const pairs = await loadVersionPairs(db, institutionId, [assignment.scoringVersionId])
  const scoring = pairs.get(assignment.scoringVersionId)?.version
  const content = scoring?.content ?? null
  if (!scoring || content === null) throw new NotFoundError()
  let entries: { questionVersionId: string; points: number }[]
  let questionPairs = pairs
  switch (content.type) {
    case 'question':
      entries = [{ questionVersionId: scoring.id, points: 1 }]
      break
    case 'quiz':
    case 'exercise_set':
      entries = content.items
      questionPairs = await loadVersionPairs(
        db,
        institutionId,
        content.items.map((item) => item.questionVersionId),
      )
      break
    default:
      throw mapOperationError(
        new DomainError(
          'not_auto_scored',
          'Bu görev otomatik puanlanmaz; yazma, konuşma ve aracılık puanını öğretmen verir.',
        ),
      )
  }
  const versions = new Map([...questionPairs.values()].map(({ version }) => [version.id, version]))
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
    }
  } catch (error) {
    throw mapOperationError(error)
  }
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
      question: view?.content.type === 'question' ? view.content.question : item.question,
    }
  })
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
