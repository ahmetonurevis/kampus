import type { GradingQueueItem, TaskVersionGrading } from '@kampus/react-shared/use-task-grading.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { aspectLabel, dateTimeLabel, learnerLabel } from './task-model.ts'

/**
 * Koordinatörün uyuşmazlık kuyruğu ve son puan penceresi (OG-058; IST-005, IST-048;
 * DOM-BEC-024, DOM-YTK-027). Kuyruk sunucunun `awaiting=resolution` süzgecidir; son puanı kimin
 * verebileceği (`canResolve`), hangi kriterlerin ayrıştığı ve toplam sunucudadır. Burada yalnız
 * ekranın satırları, iki puanın kriter bazında yan yana dizilişi ve pencerenin durum metni vardır.
 */

export interface DisputeRow extends Record<string, unknown> {
  id: string
  learner: string
  assignment: string
  submittedAt: string
  dueAt: string
  overdue: boolean
}

/**
 * Kuyruk satırı: öğrenci, görev, son gönderim ve puanlama süresi (aşıldıysa işaretli). Görev
 * başlığı satırdan gelir; koordinatör atamayı görmeyebilir (DOM-YTK-027).
 */
export function disputeRow(item: GradingQueueItem): DisputeRow {
  return {
    id: item.id,
    learner: learnerLabel(item),
    assignment: item.assignmentTitle ?? 'Görev',
    submittedAt: dateTimeLabel(item.latestVersion?.submittedAt),
    dueAt: dateTimeLabel(item.grading.dueAt),
    overdue: item.grading.overdue,
  }
}

type RaterScore = TaskVersionGrading['raterScores'][number]

export interface CriterionComparison {
  criterionId: string
  label: string
  first: number | null
  second: number | null
  /** Sunucunun bildirdiği uyuşmazlık kriteri (birden fazla bant fark; DOM-BEC-024). */
  disputed: boolean
}

/**
 * İlk ve ikinci puanın kriter bazında yan yana dizilişi; sıra rubriğin kriter sırasıdır.
 * Uyuşmazlık işaretini istemci hesaplamaz, sunucunun `disagreementCriterionIds` listesidir.
 * Puanlardan biri koordinatöre görünmüyorsa (kör puanlama) o sütun `null` kalır.
 */
export function compareRaterScores(
  criteria: readonly { id: string; aspect: string }[],
  grading: Pick<TaskVersionGrading, 'raterScores' | 'disagreementCriterionIds'>,
): CriterionComparison[] {
  const bandOf = (role: RaterScore['raterRole'], criterionId: string) =>
    grading.raterScores
      .find((item) => item.raterRole === role)
      ?.score.criteria.find((item) => item.criterionId === criterionId)?.band ?? null
  const disputed = new Set(grading.disagreementCriterionIds)
  return criteria.map((criterion) => ({
    criterionId: criterion.id,
    label: aspectLabel(criterion.aspect),
    first: bandOf('first', criterion.id),
    second: bandOf('second', criterion.id),
    disputed: disputed.has(criterion.id),
  }))
}

export type FinalScoreState =
  { kind: 'resolve' } | { kind: 'notice'; text: string; tone: BadgeTone; label: string }

/**
 * Pencerenin son puan bölümü: form yalnız sunucu `canResolve` derse açılır. Diğer durumlar
 * nedeniyle yazılır; sunucu nedeni (puanlayıcı mı, alan dışı mı) ayırt etmez, metin ikisini de söyler.
 */
export function finalScoreState(
  grading: Pick<TaskVersionGrading, 'status' | 'canResolve' | 'raterScores'> | null,
): FinalScoreState {
  if (grading?.canResolve) return { kind: 'resolve' }
  if (grading?.status === 'settled') {
    const final = grading.raterScores.some((item) => item.raterRole === 'final')
    return {
      kind: 'notice',
      tone: 'green',
      label: 'Kesinleşti',
      text: final
        ? 'Son puan verildi; sonuç kesinleşti ve öğrenciye açıldı.'
        : 'Bu teslimin sonucu kesinleşti; son puan gerekmiyor.',
    }
  }
  if (grading?.status === 'disagreement') {
    return {
      kind: 'notice',
      tone: 'amber',
      label: 'Son puan bekliyor',
      text: 'Son puanı siz veremezsiniz (puanlayıcısınız ya da alanınız dışında).',
    }
  }
  return {
    kind: 'notice',
    tone: 'gray',
    label: 'Uyuşmazlık yok',
    text: 'Bu teslimde iki puan arasında uyuşmazlık yok; son puan verilmez.',
  }
}

/** Son puan formunun güncel teslimi yükleyip uyarıyı pencerede gösterdiği hatalar. */
const FINAL_STALE_CODES = new Set([
  'version_conflict',
  'version_not_latest',
  'submission_version_not_found',
  'final_score_not_needed',
])
export const showsFinalStaleNotice = (error: { code: string }) => FINAL_STALE_CODES.has(error.code)

/** Eskiyen pencerenin uyarısı: başka koordinatör son puanı verdiyse form kalkar. */
export function finalStaleText(resolvable: boolean): string {
  const head = 'Teslim bu arada değişti ve güncel hâli yüklendi.'
  return resolvable
    ? `${head} Puanı gözden geçirip yeniden kaydedin.`
    : `${head} Son puan artık bu ekrandan verilemez; güncel durum aşağıdadır.`
}
