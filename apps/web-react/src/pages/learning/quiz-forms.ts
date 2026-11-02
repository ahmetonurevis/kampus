// Quiz ekranlarının form ve işlem hesapları (IST-095; DOM-AKD-075…079). Kural sunucudadır
// (core `lib/quiz.ts`); burası kullanıcıya geçersiz seçenek ve işlem göstermemek, girdiyi core
// şemasıyla erkenden doğrulamak ve sunucu hatasını doğru alana bağlamak içindir. Puan burada
// hesaplanmaz: sonuç ve ortalama sunucudan gelir (DOM-AKD-078, DOM-AKD-079).
import { z } from 'zod'
import type { ApiError } from '@kampus/api-client/errors.ts'
import {
  isQuizVersionConflict,
  quizErrorField,
  type Quiz,
  type QuizAttempt,
  type QuizFormKind,
  type UpdateQuizBody,
} from '@kampus/react-shared/quizzes.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  createQuizSchema,
  QUIZ_DURATION_MAX,
  QUIZ_DURATION_MIN,
  QUIZ_QUESTION_LIMIT,
  QUIZ_TITLE_MAX_LENGTH,
} from '@kampus/school-core/lib/quiz.ts'
import { istanbulToIso, isoToIstanbul } from '../../lib/istanbul-time.ts'
import type { HomeworkActor } from './homework-forms.ts'

export { QUIZ_DURATION_MAX, QUIZ_DURATION_MIN, QUIZ_QUESTION_LIMIT, QUIZ_TITLE_MAX_LENGTH }

/** Quiz ekranlarının oturum sahibi (rol ve bağlı öğretmen kaydı); ödevle aynıdır. */
export type QuizActor = HomeworkActor

// --- Kim ne yapabilir --------------------------------------------------------

/**
 * Ekranda gösterilecek işlemler (DOM-AKD-075, 076). Quiz hazırlama yönetici ve öğretmende;
 * düzenleme ve arşiv yönetici ile quizin öğretmeninde. Aynı sınıfa başka dersle giren öğretmen
 * quizi görür, değiştiremez.
 */
export function quizActions(actor: QuizActor, quiz?: Pick<Quiz, 'teacherId'>) {
  const owner =
    actor.role === 'ogretmen' && actor.teacherId !== null && quiz?.teacherId === actor.teacherId
  return {
    create: actor.role === 'yonetici' || actor.role === 'ogretmen',
    manage: quiz !== undefined && (actor.role === 'yonetici' || owner),
  }
}

/**
 * Denemeleri ve ortalamayı görebilen okur (DOM-AKD-079): yönetici, quizin öğretmeni ve sınıfın
 * rehber öğretmeni. Aynı sınıfa başka dersle giren öğretmenin özeti boş gelir; sayı yerine "—".
 */
export function seesQuizResults(
  actor: QuizActor,
  quiz: Pick<Quiz, 'teacherId'>,
  guidanceTeacherId: string | undefined,
): boolean {
  if (actor.role === 'yonetici') return true
  return (
    actor.teacherId !== null &&
    (quiz.teacherId === actor.teacherId || guidanceTeacherId === actor.teacherId)
  )
}

/**
 * Quiz çözülmeye başlandı mı (DOM-AKD-076): denemesi olan quizin soruları değişmez ve quiz
 * arşivlenmez. Başlatılmış (süresi işleyen) deneme de sayılır.
 */
export const quizLocked = (detail: {
  statistics: { started: number } | null
  attempts: readonly unknown[]
}) => (detail.statistics?.started ?? 0) > 0 || detail.attempts.length > 0

export const QUIZ_LOCKED_REASON =
  'Bu quiz çözülmeye başlandı: sorular değiştirilemez ve quiz arşivlenemez. Öğrencilerin sonuçları korunur.'

// --- Quiz hazırla / düzenle --------------------------------------------------

/**
 * Quiz formu: core `createQuiz` alanları. Son tarih isteğe bağlıdır, formda Türkiye saatiyle
 * girilir ve ISO'ya çevrilir; ders her zaman seçilir (tek dersli öğretmende kendiliğinden).
 */
export const quizFormSchema = z.object({
  classId: z.string().trim().min(1, 'Sınıf seçin.'),
  subjectId: z.string().trim().min(1, 'Ders seçin.'),
  title: createQuizSchema.shape.title,
  duration: createQuizSchema.shape.duration,
  dueDate: z
    .string()
    .trim()
    .transform((value) => (value === '' ? undefined : istanbulToIso(value)))
    .pipe(z.iso.datetime({ offset: true, error: 'Son tarihi ve saati seçin.' }).optional()),
  questionIds: createQuizSchema.shape.questionIds,
})
export type QuizFormValues = z.input<typeof quizFormSchema>
export type QuizFormOutput = z.output<typeof quizFormSchema>

type EditableQuiz = Pick<Quiz, 'title' | 'duration' | 'dueDate' | 'questionIds'>

export function quizFormDefaults(
  quiz?: Pick<Quiz, 'classId' | 'subjectId'> & EditableQuiz,
): QuizFormValues {
  return {
    classId: quiz?.classId ?? '',
    subjectId: quiz?.subjectId ?? '',
    title: quiz?.title ?? '',
    duration: quiz?.duration ?? 20,
    dueDate: quiz?.dueDate ? isoToIstanbul(quiz.dueDate) : '',
    questionIds: [...(quiz?.questionIds ?? [])],
  }
}

/** Yeni quizin gövdesi: boş son tarih gönderilmez (quiz süresiz açık kalır). */
export function createQuizBody(values: QuizFormOutput) {
  return {
    classId: values.classId,
    subjectId: values.subjectId,
    title: values.title,
    duration: values.duration,
    questionIds: [...values.questionIds],
    ...(values.dueDate === undefined ? {} : { dueDate: values.dueDate }),
  }
}

const sameInstant = (left: string | null | undefined, right: string | null | undefined) =>
  (left ?? null) === null || (right ?? null) === null
    ? (left ?? null) === (right ?? null)
    : Date.parse(left ?? '') === Date.parse(right ?? '')

const sameList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id, index) => right[index] === id)

/**
 * Düzenlemede formda değişen alanlar (`PATCH` kısmidir; sınıf ve ders değişmez). Son tarih
 * kaldırılırsa `null` gider; sorular sırasıyla karşılaştırılır.
 */
export function changedQuizFields(quiz: EditableQuiz, values: QuizFormOutput): UpdateQuizBody {
  const changed: UpdateQuizBody = {}
  if (values.title !== quiz.title) changed.title = values.title
  if (values.duration !== quiz.duration) changed.duration = values.duration
  if (!sameInstant(values.dueDate, quiz.dueDate)) changed.dueDate = values.dueDate ?? null
  if (!sameList(values.questionIds, quiz.questionIds)) changed.questionIds = [...values.questionIds]
  return changed
}

export type QuizField = 'title' | 'duration' | 'dueDate' | 'questionIds'

export const QUIZ_FIELD_LABELS = {
  title: 'Başlık',
  duration: 'Süre',
  dueDate: 'Son tarih',
  questionIds: 'Sorular',
} as const satisfies Record<QuizField, string>

/** Kullanıcının değiştirdiği bir alanı başkası da farklı bir değere çevirmiş. */
export type QuizOverlap = { field: QuizField; label: string; theirs: string; mine: string }

const dueLabel = (value: string | null | undefined) =>
  value
    ? dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Son tarih yok'

/** Alanın ekranda gösterilen değeri. */
export function quizFieldText(
  field: QuizField,
  value: Pick<EditableQuiz, 'title' | 'duration' | 'questionIds'> & {
    dueDate?: string | null | undefined
  },
): string {
  switch (field) {
    case 'title':
      return value.title
    case 'duration':
      return `${value.duration} dk`
    case 'dueDate':
      return dueLabel(value.dueDate)
    case 'questionIds':
      return `${value.questionIds.length} soru`
  }
}

/**
 * Gönderim anındaki taze kayda göre düzenleme planı (ödevdeki `planHomeworkUpdate` kalıbı).
 * Kullanıcının değiştirdiği alanlar formun açıldığı andaki quizle (`opened`) karşılaştırılır; yalnız
 * onlar gider, böylece başkasının değiştirdiği alanlar eski değere geri yazılmaz (sessiz ezme yok).
 * `overlaps`: kullanıcının değiştirdiği alanı başkası da farklı değere çevirmiş. `locked`: quiz
 * çözülmeye başlanmışsa sorular plandan düşer ve `questionsBlocked` işaretlenir (DOM-AKD-076).
 */
export function planQuizUpdate(
  opened: EditableQuiz,
  fresh: EditableQuiz,
  values: QuizFormOutput,
  locked = false,
): { body: UpdateQuizBody; overlaps: QuizOverlap[]; questionsBlocked: boolean } {
  const mine = changedQuizFields(opened, values)
  const differsFromFresh = changedQuizFields(fresh, values)
  const theirs = changedQuizFields(opened, {
    ...values,
    title: fresh.title,
    duration: fresh.duration,
    dueDate: fresh.dueDate ?? undefined,
    questionIds: fresh.questionIds,
  })
  const body: UpdateQuizBody = {}
  const overlaps: QuizOverlap[] = []
  let questionsBlocked = false
  for (const field of Object.keys(QUIZ_FIELD_LABELS) as QuizField[]) {
    if (!(field in mine) || !(field in differsFromFresh)) continue
    if (field === 'questionIds' && locked) {
      questionsBlocked = true
      continue
    }
    Object.assign(body, { [field]: differsFromFresh[field] })
    if (field in theirs)
      overlaps.push({
        field,
        label: QUIZ_FIELD_LABELS[field],
        theirs: quizFieldText(field, fresh),
        mine: quizFieldText(field, values),
      })
  }
  return { body, overlaps, questionsBlocked }
}

// --- Soru seçimi -------------------------------------------------------------

type BankLike = {
  id: string
  subjectId: string
  minGrade: number
  maxGrade: number
  topic: string
}

/**
 * Quize eklenebilecek sorular (DOM-AKD-075): quizin dersinde ve sınıfın düzeyinde. Düzeyi olmayan
 * sınıfta (dil okulu kuru) düzey süzgeci uygulanmaz; sunucu da uygulamaz.
 */
export function eligibleQuestions<T extends BankLike>(
  bank: readonly T[],
  subjectId: string,
  grade: number | undefined,
): T[] {
  if (!subjectId) return []
  return bank.filter(
    (question) =>
      question.subjectId === subjectId &&
      (grade === undefined || (grade >= question.minGrade && grade <= question.maxGrade)),
  )
}

/** Soru listesindeki konular (Türkçe sırayla). */
export function questionTopics(questions: readonly { topic: string }[]): string[] {
  return [...new Set(questions.map((question) => question.topic))].sort((a, b) =>
    a.localeCompare(b, 'tr'),
  )
}

/**
 * Seçimi değiştirir: seçili soru çıkar, seçilmemiş soru sona eklenir (quizdeki sıra seçim
 * sırasıdır). Sınıra ulaşıldıysa yeni soru eklenmez.
 */
export function toggleQuestion(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((item) => item !== id)
  if (selected.length >= QUIZ_QUESTION_LIMIT) return [...selected]
  return [...selected, id]
}

/**
 * Sınıf ya da ders değişince sorular yeni derse ve düzeye uymayabilir: yalnız hâlâ uygun olanlar
 * kalır.
 */
export function keepEligible(selected: readonly string[], eligible: readonly { id: string }[]) {
  const ids = new Set(eligible.map((question) => question.id))
  return selected.filter((id) => ids.has(id))
}

// --- Liste ve sonuç satırları -------------------------------------------------

/** Öğrenci ya da velinin gördüğü deneme durumu. */
export type AttemptPhase = 'none' | 'in_progress' | 'completed' | 'expired'

export const attemptPhase = (attempt: Pick<QuizAttempt, 'status'> | undefined): AttemptPhase =>
  attempt?.status ?? 'none'

/** Öğretmen panelindeki öğrenci satırının metni (sonuç sunucudandır). */
export function attemptSummary(attempt: Pick<QuizAttempt, 'status' | 'result'> | undefined) {
  if (!attempt) return 'Henüz çözmedi'
  if (attempt.status === 'in_progress') return 'Çözüyor'
  const result = attempt.result
  if (!result) return 'Sonuç yok'
  const prefix = attempt.status === 'expired' ? 'Süresi doldu · ' : ''
  return `${prefix}${result.correctCount}/${result.total} doğru · %${result.score}`
}

/** Son tarih metni (Türkiye saati); son tarihsiz quiz süresiz açıktır. */
export const quizDueText = (dueDate: string | null) =>
  dueDate ? dueLabel(dueDate) : 'Süresiz açık'

// --- Hata yönlendirme --------------------------------------------------------

/** Hata tek yerde görünür: alana bağlanan alanda, sürüm çakışması form uyarısında, gerisi toast. */
export function quizErrorRoutes(kind: QuizFormKind) {
  return {
    fieldFor: (error: ApiError) => quizErrorField(error, kind),
    silent: isQuizVersionConflict,
  }
}
