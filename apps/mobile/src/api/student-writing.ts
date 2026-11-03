// Öğrenci yazma görevinin mobil saf modeli (OG-061; IST-124, IST-047; DOM-BEC-040, 044, 045, 046).
// Liste satırı, görev durumu, yönerge, sözcük sayacı ve taslak kaydı kuralları web ile ortaktır
// (`@kampus/react-shared/student-task-model.ts`, `writing-model.ts`, `draft-autosave-model.ts`); burada
// yalnız telefonun kararları vardır: hangi satır açılır, pencere hangi kipte açılır, durum ve hata
// metinleri. Taslak metni cihaza yazılmaz, yalnız sunucuya kaydedilir.
import type { ApiError } from '@kampus/api-client/errors.ts'
import {
  FAILED,
  summaryProgress,
  taskKindLabel,
  type TaskTone,
} from '@kampus/react-shared/student-task-model.ts'
import { dateTimeLabel, taskTypeLabel } from '@kampus/react-shared/task-labels.ts'
import type { TaskAssignmentLearner } from '@kampus/react-shared/use-task-assignments.ts'
import {
  TASK_DRAFT_SAVED_ELSEWHERE_MESSAGE,
  TASK_DRAFT_SUBMIT_MESSAGES,
} from '@kampus/react-shared/use-task-submissions.ts'
import type { DraftSaveState } from '@kampus/react-shared/use-draft-autosave.ts'
import { submissionVersionInputSchema } from '@kampus/school-core/skills/submission.ts'
import { timeLabel } from '@kampus/school-core/lib/format.ts'
import { commandFailure, type CommandFailure, type FieldErrors } from './command-failure.ts'

/** Mobil rozet tonları (`ui/components.tsx` `Tone`); gri ton telefonda sakin birincil tondur. */
export type MobileTone = 'primary' | 'green' | 'amber' | 'red'

export const mobileTone = (tone: TaskTone): MobileTone => (tone === 'gray' ? 'primary' : tone)

type LearnerFields = Pick<
  TaskAssignmentLearner,
  'scoringMode' | 'submission' | 'contentType' | 'kind' | 'deadline' | 'progress' | 'id' | 'title'
>

/**
 * Telefonda açılan görev: öğretmen puanlı metin teslimi. Konuşma (ses kaydı) ve el yazısı (dosya)
 * görevleri listede görünür ama açılmaz.
 */
export const isWritingTask = (assignment: Pick<LearnerFields, 'scoringMode' | 'submission'>) =>
  assignment.scoringMode === 'teacher' && assignment.submission?.submissionKind === 'text'

export type WritingTaskRow = {
  id: string
  title: string
  subtitle: string
  status: string
  tone: MobileTone
  /** Yalnız açılmış (kesinleşmiş) puan; yoksa `null` (DOM-BEC-045). */
  score: string | null
  /** Yazma görevi: dokununca yazma penceresi açılır. */
  writable: boolean
  /** Erişilebilir ad: başlık, durum ve (açılıyorsa) eylem. */
  label: string
}

/**
 * Ödevlerim > Görevler satırı (web `StudentTaskSection` `mode="teacher"`): durum, hak ve puan atama
 * listesinin kursiyer özetinden gelir, satır başına istek atılmaz. Özeti olmayan satır "Okunamadı".
 */
export function writingTaskRow(assignment: TaskAssignmentLearner, now: Date): WritingTaskRow {
  const progress = summaryProgress(assignment, now) ?? FAILED
  const writable = isWritingTask(assignment)
  const subtitle = [
    taskTypeLabel(assignment),
    taskKindLabel(assignment),
    `Son teslim: ${assignment.deadline.dueAt ? dateTimeLabel(assignment.deadline.dueAt) : 'Belirtilmemiş'}`,
    progress.rights !== '—' ? progress.rights : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    id: assignment.id,
    title: assignment.title,
    subtitle,
    status: progress.status,
    tone: mobileTone(progress.tone),
    score: progress.score === '—' ? null : progress.score,
    writable,
    label: `${assignment.title}, ${progress.status}${writable ? '. Görevi aç' : ''}`,
  }
}

/** Öğretmen puanlı görevler (yazma, konuşma, el yazısı); otomatik puanlı quiz görevleri burada yok. */
export const teacherTasks = <T extends Pick<LearnerFields, 'scoringMode'>>(items: readonly T[]) =>
  items.filter((item) => item.scoringMode === 'teacher')

/** Arama başlık, tür ve son tarihe bakar (Türkçe büyük/küçük harf duyarsız). */
export function writingTaskMatches(
  row: Pick<WritingTaskRow, 'title' | 'subtitle'>,
  search: string,
) {
  const needle = search.trim().toLocaleLowerCase('tr')
  return !needle || `${row.title} ${row.subtitle}`.toLocaleLowerCase('tr').includes(needle)
}

// --- Yazma penceresi ----------------------------------------------------------------------

export type WritingMode = 'editor' | 'readonly'

/**
 * Pencerenin açılış kipi: hiç sürüm gönderilmediyse ya da son sürümden yeni bir taslak varsa
 * (yarım kalan yazı) ve teslim açıksa editör; aksi hâlde gönderilenler ve geri bildirim salt okur
 * görünür, yeni sürüm (izin varsa) düğmeyle açılır.
 */
export function initialWritingMode({
  canAct,
  versionCount,
  draftSavedAt,
  latestSubmittedAt,
}: {
  canAct: boolean
  versionCount: number
  draftSavedAt: string | null
  latestSubmittedAt: string | null
}): WritingMode {
  if (!canAct) return 'readonly'
  if (versionCount === 0) return 'editor'
  const draftIsNewer =
    draftSavedAt !== null &&
    (latestSubmittedAt === null ||
      new Date(draftSavedAt).getTime() > new Date(latestSubmittedAt).getTime())
  return draftIsNewer ? 'editor' : 'readonly'
}

/** Salt okur görünümdeki yeni sürüm düğmesi (web `actionLabel` metni). */
export const newVersionText = (versionCount: number) =>
  versionCount === 0 ? 'Yazmaya başla' : 'Yeni sürüm yaz'

/**
 * Taslak kaydının canlı durumu (web `WritingEditor` ile aynı metinler): ekran okuyucuya kibar canlı
 * bölgeyle duyurulur, yazmayı kesmez.
 */
export function draftStatusText({
  state,
  savedAt,
  conflict,
  canSubmit,
}: {
  state: DraftSaveState
  savedAt: string | null
  conflict: boolean
  canSubmit: boolean
}): string {
  if (!canSubmit) return 'Teslim şu an açık değil.'
  if (state === 'saving') return 'Taslak kaydediliyor…'
  if (state === 'error') return 'Taslak kaydedilemedi; yazmaya devam edebilirsiniz.'
  if (conflict) return TASK_DRAFT_SAVED_ELSEWHERE_MESSAGE
  if (state === 'saved' && savedAt) return `Taslak kaydedildi (${timeLabel(savedAt)}).`
  return 'Taslak otomatik kaydedilir.'
}

/** Metin teslimi alanı çekirdeğin teslim şemasındandır (boş metin ve 50.000 karakter sınırı). */
const textBody = submissionVersionInputSchema.options[0].shape.body

/** Teslim onayından önce metnin denetimi; hata alanın altında gösterilir. */
export function checkWritingBody(body: string): string | null {
  const result = textBody.safeParse(body)
  return result.success ? null : (result.error.issues[0]?.message ?? 'Metin geçersiz.')
}

export const SUBMIT_CONFIRM_TEXT =
  'Metnin yeni bir sürüm olarak öğretmenine gönderilecek. Gönderilen sürüm sonradan değiştirilemez.'
export const SUBMIT_DONE_TEXT = 'Teslim edildi.'
/** Bekleyen taslak kaydedilemediği için teslim edilmedi (kayıt hatası taslak durumunda da görünür). */
export const DRAFT_NOT_SAVED_TEXT =
  'Taslak kaydedilemediği için teslim edilmedi. Bağlantını denetleyip yeniden dene.'

/** Taslağa ait teslim hataları metin alanının altında görünür (web `FIELD_CODES`). */
const FIELD_CODES = new Set(['draft_empty', 'draft_already_submitted'])

export const writingFieldFor = (error: ApiError): string | undefined =>
  FIELD_CODES.has(error.code) ? 'body' : undefined

/**
 * Teslim hatasının pencere içi görünümü: alan maddesi metnin altında, diğerleri tek mesaj; ağ ve
 * 5xx belirsizdir, "Yeniden dene" aynı revizyonu aynı `Idempotency-Key` ile gönderir.
 */
export const writingSubmitFailure = (error: ApiError, collected: FieldErrors): CommandFailure =>
  commandFailure(error, TASK_DRAFT_SUBMIT_MESSAGES, collected)

/**
 * Teslim düğmesinin kararı: önce bekleyen kayıt tamamlanır (`flush`), başarısızsa teslim gitmez.
 * Başka pencerenin kaydı henüz bildirilmediyse ilk basış yalnız uyarır (`null` + çakışma).
 */
export function flushFailureText(hadConflict: boolean): string {
  return hadConflict ? TASK_DRAFT_SAVED_ELSEWHERE_MESSAGE : DRAFT_NOT_SAVED_TEXT
}
