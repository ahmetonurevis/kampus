import type { TaskAssignmentStaff } from '@kampus/react-shared/use-task-assignments.ts'
import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import type {
  GradingQueueItem,
  SecondRatingSample,
  TaskVersionGrading,
} from '@kampus/react-shared/use-task-grading.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { dateTimeLabel, submissionStatus } from './task-model.ts'

/**
 * İkinci puanlama ekranının saf sunum kuralları (OG-210; DOM-BEC-024, 025). Örneklemin ne zaman
 * çekilebileceği, kimin ikinci puan verebileceği, ilk puanın ikinci puanlayıcıdan gizlenmesi ve
 * uyuşmazlık sunucudadır (`second_rating_*`, `rater_not_independent`); burada yalnız sunucunun
 * döndürdüğü alanlardan ekranın durumu ve metni türetilir, kural yeniden yazılmaz.
 */

type Version = TaskSubmissionDetail['versions'][number]

// --- Örneklem (atama düzeyi) ---------------------------------------------------------------

export type SampleState =
  | { kind: 'none'; text: string }
  | { kind: 'drawn'; text: string }
  | { kind: 'unavailable'; text: string }
  | { kind: 'drawable'; text: string }

/**
 * Atamanın örneklem durumu, sunucunun atama alanlarından (`secondRatingPercent`,
 * `secondRatingSampledAt`, `deadline.dueAt`). `drawable` düğmeyi açar; süre bitmediyse sunucu
 * 409 `second_rating_window_open` ile reddeder ve metni toast'ta görünür.
 */
export function sampleState(
  item: Pick<
    TaskAssignmentStaff,
    'secondRatingPercent' | 'secondRatingSampledAt' | 'deadline' | 'rubricVersionId'
  >,
): SampleState {
  if (item.rubricVersionId === null || item.secondRatingPercent === 0) {
    return { kind: 'none', text: 'Bu görevde ikinci puanlama örneklemi yok.' }
  }
  if (item.secondRatingSampledAt !== null) {
    return {
      kind: 'drawn',
      text: `Örneklem ${dateTimeLabel(item.secondRatingSampledAt)} tarihinde seçildi (%${item.secondRatingPercent}). Seçilen teslimler ikinci puanlayıcıyı bekler.`,
    }
  }
  if (item.deadline.dueAt === null) {
    return {
      kind: 'unavailable',
      text: 'Son tarihi olmayan görevde örneklem seçilmez; ikinci puanı teslim bazında isteyin.',
    }
  }
  return {
    kind: 'drawable',
    text: `Örneklem oranı %${item.secondRatingPercent}. Teslim süresi (geç kabul dahil) bitince seçilir; seçilmeden ilk puan verilmez.`,
  }
}

/** Başarı toast'ı: örneklem havuzu ve seçilen sayı sunucunun yanıtındandır. */
export const sampleDrawnText = (
  sample: Pick<SecondRatingSample, 'submissionCount' | 'submissionIds'>,
) =>
  `Örneklem seçildi: ${sample.submissionCount} teslimden ${sample.submissionIds.length} tanesi ikinci puanlanacak.`

// --- Elle istem (teslim düzeyi) -------------------------------------------------------------

export type RequestState =
  | { kind: 'requested'; text: string }
  | { kind: 'used'; text: string }
  | { kind: 'available'; text: string }
  | { kind: 'closed' }

/**
 * Teslimin ikinci puanlama isteği durumu (`TaskVersionGrading`): istek varsa durum yazılır, henüz
 * puanlanmamış sürümde (`unscored`) düğme açılır; puanı oluşmuş sürüm için istek sunucuda
 * `second_rating_too_late` olur, bölüm gizlenir. Pencerenin kapanıp kapanmadığını sunucu söyler.
 * İstem teslim başına birdir: sürüm kapsamda değilken istem kullanılmışsa (yeniden teslimle gelen
 * sürüm) düğme açılmaz, çünkü sunucu `second_rating_exists` 409 der; yerine bilgi yazılır.
 */
export function requestState(
  grading: Pick<
    TaskVersionGrading,
    'status' | 'secondRatingRequested' | 'secondRatingRequestUsed'
  > | null,
): RequestState {
  if (grading === null) return { kind: 'closed' }
  if (grading.secondRatingRequested) {
    return {
      kind: 'requested',
      text: 'Bu sürüm için ikinci puanlama istendi; ikinci puanlayıcı ilk puanı görmeden puanlar.',
    }
  }
  if (grading.secondRatingRequestUsed) {
    return {
      kind: 'used',
      text: 'Bu teslim için ikinci puanlama daha önce istendi; yeni sürüm ikinci puanlama beklemez.',
    }
  }
  if (grading.status === 'unscored') {
    return {
      kind: 'available',
      text: 'İkinci değerlendirici, öğrenci yeni sürüm gönderemez olunca (teslim süresi bitince veya sürüm hakkı dolunca) istenir.',
    }
  }
  return { kind: 'closed' }
}

export const REQUEST_SUCCESS_TEXT = 'İkinci puanlama istendi.'

// --- Kör ikinci puan ------------------------------------------------------------------------

export type SecondScoringState =
  /** İkinci puan bekleniyor ve kişi verebilir: kör form. */
  | { kind: 'blind' }
  /** İkinci puan bekleniyor ama kişi ilk puanı verdi: puanlayamaz. */
  | { kind: 'own'; text: string }
  | { kind: 'none' }

/**
 * Sürümün ikinci puan bekleyip beklemediği (`status: 'pending'`, `missing: 'second'`). Kişinin
 * kendi ilk puanını verdiği sürümde (`scoredByViewer`) form açılmaz; sunucu da
 * `rater_not_independent` der.
 */
export function secondScoringState(
  grading: Pick<TaskVersionGrading, 'status' | 'missing' | 'scoredByViewer'> | null,
): SecondScoringState {
  if (grading === null || grading.status !== 'pending' || grading.missing !== 'second') {
    return { kind: 'none' }
  }
  if (grading.scoredByViewer) {
    return {
      kind: 'own',
      text: 'Bu sürümün ilk puanını siz verdiniz; ikinci puanı bağımsız başka bir öğretmen verir.',
    }
  }
  return { kind: 'blind' }
}

/** Kör puan penceresinin ekranda tuttuğu tek şekil: puan ve puanlayıcı bilgisi içermez. */
export interface BlindVersionView {
  number: number
  submittedAt: string
  late: boolean
  body: string | null
  wordCount: number | null
  versionId: string
  files: Version['files']
}

/**
 * İkinci puanlayıcıya gösterilen sürüm: yalnız teslim içeriği. `score`, `grading` ve puan
 * ayrıntıları bilerek taşınmaz; sunucu zaten ilk puanı bu kişiden saklar (core
 * `scoresVisibleToRater`), bu ikinci savunmadır: ekran, yanıtta ne gelirse gelsin, ilk puanı
 * çizemez.
 */
export function blindVersionView(version: Version): BlindVersionView {
  return {
    versionId: version.id,
    number: version.number,
    submittedAt: version.submittedAt,
    late: version.late,
    body: version.body,
    wordCount: version.wordCount?.count ?? null,
    files: version.files,
  }
}

/** Kör puanın tazelenip pencerede uyarı gösterdiği hatalar. */
const SECOND_STALE_CODES = new Set([
  'version_conflict',
  'version_not_latest',
  'submission_version_not_found',
  'rubric_score_exists',
  'second_rating_not_requested',
  'rater_not_independent',
])
export const showsSecondStaleNotice = (error: { code: string }) =>
  SECOND_STALE_CODES.has(error.code)

/** Eskiyen kör puan penceresinin uyarısı. */
export const secondStaleText =
  'Teslim bu arada değişti ve güncel hâli yüklendi. İkinci puan artık bu ekrandan verilemiyorsa form kalkar; aksi hâlde puanı gözden geçirip yeniden kaydedin.'

/** Puan formunun türüne göre metinler; gövde ve uç farkı kancadadır. */
export const SCORE_FORM_COPY = {
  first: {
    ariaLabel: 'Rubrik puanı',
    submit: 'Puanı kaydet',
    success: 'Puan kaydedildi.',
    note: 'Toplam puan kayıtta sunucuda hesaplanır; puan kesinleşince geri bildirim öğrenciye ve velisine açılır.',
  },
  second: {
    ariaLabel: 'İkinci puan',
    submit: 'İkinci puanı kaydet',
    success: 'İkinci puan kaydedildi.',
    note: 'Toplam puan kayıtta sunucuda hesaplanır. İlk puan size gösterilmez; iki puan arasında belirgin fark varsa son puanı koordinatör verir, yoksa ilk puan geçerli olur.',
  },
  final: {
    ariaLabel: 'Son puan',
    submit: 'Son puanı kaydet',
    success: 'Son puan kaydedildi; sonuç kesinleşti.',
    note: 'Toplam puan kayıtta sunucuda hesaplanır; puan kesinleşince geri bildirim öğrenciye ve velisine açılır.',
  },
} as const

// --- Kuyruk ---------------------------------------------------------------------------------

export type QueuePhase = 'first' | 'second' | 'resolution'

export interface QueueStatus {
  label: string
  tone: BadgeTone
  phase: QueuePhase
}

/**
 * Kuyruk satırının durumu (`grading.awaiting`, `awaitingResolution`, `samplePending`): örneklem
 * bekleyen görevde ilk puan verilemez, durum bunu söyler; ikinci puanı bekleyen satır ayrı
 * görünür ve kör puanlamaya gider.
 */
export function queueStatus(item: Pick<GradingQueueItem, 'status' | 'grading'>): QueueStatus {
  const { awaiting, awaitingResolution, samplePending } = item.grading
  if (awaitingResolution) return { label: 'Son puan bekliyor', tone: 'amber', phase: 'resolution' }
  if (samplePending && awaiting.includes('first')) {
    return { label: 'Örneklem bekliyor', tone: 'gray', phase: 'first' }
  }
  if (awaiting.includes('first') && awaiting.includes('second')) {
    return { label: 'İlk ve ikinci puan bekliyor', tone: 'purple', phase: 'first' }
  }
  if (awaiting.includes('second')) {
    return { label: 'İkinci puan bekliyor', tone: 'purple', phase: 'second' }
  }
  return { ...submissionStatus(item.status), phase: 'first' }
}

/** Satırdaki eylem düğmesinin metni ve erişilebilir adı. */
export function queueAction(phase: QueuePhase, learner: string) {
  return phase === 'second'
    ? { label: 'İkinci puanla', ariaLabel: `${learner} teslimini ikinci puanla` }
    : { label: 'Puanla', ariaLabel: `${learner} teslimini puanla` }
}

/** Kuyruk süzgeci: bekleyen puan türü (`awaiting`; son puan ayrı kuyruktadır). */
export const AWAITING_OPTIONS = [
  { value: '', label: 'Tüm bekleyenler' },
  { value: 'first', label: 'İlk puan bekleyenler' },
  { value: 'second', label: 'İkinci puan bekleyenler' },
] as const
export type AwaitingFilter = Exclude<(typeof AWAITING_OPTIONS)[number]['value'], ''>

export const isAwaitingFilter = (value: unknown): value is AwaitingFilter =>
  value === 'first' || value === 'second'
