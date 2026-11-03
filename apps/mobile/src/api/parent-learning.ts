// Veli "Akademik takip" ekranının quiz sonuçları ve beceri görevleri sekmelerinin saf hesapları
// (`screens/parent-quizzes.tsx`, `screens/parent-skill-tasks.tsx`). Puan, deneme durumu ve hak
// sunucudan gelir; burada yalnız gösterim metni üretilir, puan hesaplanmaz. Cevap anahtarı ve
// çözüm veliye hiç gelmez; açılmamış puana dair ifade üretilmez (DOM-AKD-078, DOM-BEC-045).
// Web karşılıkları `apps/web-react/src/pages/{learning/{learning-rows,quiz-forms},tasks/{parent-task-model,student-task-model}}.ts`.
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { isClosed } from '@kampus/school-core/skills/scoring.ts'

// --- Quiz sonuçları -------------------------------------------------------------------------

export type QuizPhase = 'none' | 'in_progress' | 'completed' | 'expired'

export const QUIZ_PHASE_TEXT = {
  none: 'Henüz çözülmedi',
  in_progress: 'Devam ediyor',
  completed: 'Çözüldü',
  expired: 'Süresi doldu',
} as const satisfies Record<QuizPhase, string>

/** Son tarih metni (Europe/Istanbul); son tarihsiz quiz süresiz açıktır. */
export const quizDueText = (dueDate: string | null | undefined): string =>
  dueDate
    ? dateLabel(dueDate, { year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Süresiz açık'

type QuizResultFields = {
  score: number
  correctCount: number
  total: number
  topicScores?: readonly { topic: string; score: number }[]
}

type QuizAttemptFields = {
  studentId: string
  status: 'in_progress' | 'expired' | 'completed'
  submittedAt: string | null
  expiresAt: string | null
  answers?: Readonly<Record<string, number>> | undefined
  result: QuizResultFields | null
}

export type QuizItemFields = {
  id: string
  title: string
  subject: string
  questionCount: number
  duration: number
  dueDate: string | null
  attempts: readonly QuizAttemptFields[]
}

/** Satır yalnız seçili çocuğun denemesinden kurulur: iki çocuk aynı sınıfta olabilir (DOM-AKD-079). */
const attemptOf = (item: Pick<QuizItemFields, 'attempts'>, studentId: string) =>
  item.attempts.find((attempt) => attempt.studentId === studentId)

export type QuizRow = {
  id: string
  title: string
  subtitle: string
  phase: QuizPhase
  status: string
  /** Sunucunun cevaplardan hesapladığı yüzde puan; sonuç yoksa `undefined`. */
  score: string | undefined
}

export function quizRow(item: QuizItemFields, studentId: string): QuizRow {
  const attempt = attemptOf(item, studentId)
  const phase: QuizPhase = attempt?.status ?? 'none'
  return {
    id: item.id,
    title: item.title,
    subtitle: [
      item.subject,
      `${item.questionCount} soru`,
      `${item.duration} dk`,
      quizDueText(item.dueDate),
    ].join(' · '),
    phase,
    status: QUIZ_PHASE_TEXT[phase],
    score: attempt?.result ? `%${attempt.result.score}` : undefined,
  }
}

export const quizRows = (items: readonly QuizItemFields[], studentId: string): QuizRow[] =>
  items.map((item) => quizRow(item, studentId))

/** Arama başlık ve derse bakar (büyük/küçük harf ve Türkçe karakter duyarsız, `matchesSearch` gibi). */
export const quizMatches = (row: Pick<QuizRow, 'title' | 'subtitle'>, search: string): boolean => {
  const needle = search.trim().toLocaleLowerCase('tr')
  return !needle || `${row.title} ${row.subtitle}`.toLocaleLowerCase('tr').includes(needle)
}

type QuizQuestionFields = { id: string; text: string; topic: string; options: readonly string[] }

export type QuizDetailFields = {
  title: string
  subject: string
  questionCount: number
  duration: number
  dueDate: string | null
  questions: readonly QuizQuestionFields[] | null
  attempts: readonly QuizAttemptFields[]
}

export type QuizDetailView = {
  title: string
  subtitle: string
  phase: QuizPhase
  status: string
  /** Sonuç yoksa durum açıklaması (çözülmedi, sürüyor). */
  note: string | null
  result: {
    score: string
    correct: string
    /** "Gönderilme tarihi: …" ya da süresi dolan denemede "Süre bitişi: …". */
    stamp: string | null
    expiredNote: string | null
  } | null
  /** Konu yüzdeleri ve cevaplar yalnız inceleme açılınca (sunucu `answers` gönderince) vardır. */
  review: {
    topics: { topic: string; score: string }[]
    answers: { id: string; text: string; detail: string }[] | null
  } | null
  reviewLocked: boolean
}

export const REVIEW_LOCKED_TEXT =
  'Konu bazında sonuç ve cevaplar quizin son tarihi geçince ya da quiz kapanınca açılır.'
export const QUESTIONS_MISSING_TEXT = 'Quizin bazı soruları soru bankasında artık bulunmuyor.'
export const NO_ANSWER_TEXT = 'Boş bırakıldı'

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const

/** Şıkkın görünen metni: `B) 46`. */
export function optionText(options: readonly string[], index: number): string {
  const letter = OPTION_LETTERS[index] ?? String(index + 1)
  return `${letter}) ${options[index] ?? ''}`
}

/**
 * Quiz ayrıntısı: durum, puan ve doğru sayısı her zaman; konu yüzdeleri ve verilen cevaplar yalnız
 * sunucu `answers` alanını gönderdiyse (DOM-AKD-078). Doğru şık ve çözüm hiç gösterilmez.
 */
export function quizDetailView(quiz: QuizDetailFields, studentId: string): QuizDetailView {
  const attempt = attemptOf(quiz, studentId)
  const phase: QuizPhase = attempt?.status ?? 'none'
  const result = attempt?.result ?? null
  const answers = attempt?.answers
  const stampAt = attempt?.submittedAt ?? attempt?.expiresAt ?? null
  return {
    title: quiz.title,
    subtitle: `${quiz.subject} · ${quiz.questionCount} soru · ${quiz.duration} dk`,
    phase,
    status: QUIZ_PHASE_TEXT[phase],
    note: result
      ? null
      : phase === 'in_progress'
        ? 'Bu quiz şu an çözülüyor; sonuç cevaplar gönderilince görünür.'
        : 'Bu quiz henüz çözülmedi.',
    result:
      attempt && result
        ? {
            score: `%${result.score}`,
            correct: `${result.correctCount} / ${result.total}`,
            stamp: stampAt
              ? `${attempt.status === 'expired' ? 'Süre bitişi' : 'Gönderilme tarihi'}: ${dateLabel(
                  stampAt,
                  { year: 'numeric', hour: '2-digit', minute: '2-digit' },
                )}`
              : null,
            expiredNote:
              attempt.status === 'expired'
                ? 'Cevaplar süresinde gönderilmediği için deneme boş cevaplı sayıldı.'
                : null,
          }
        : null,
    review:
      result && answers !== undefined
        ? {
            topics: (result.topicScores ?? []).map((topic) => ({
              topic: topic.topic,
              score: `%${topic.score}`,
            })),
            answers: quiz.questions
              ? quiz.questions.map((question) => {
                  const chosen = answers[question.id]
                  return {
                    id: question.id,
                    text: question.text,
                    detail: `${question.topic} · Verilen cevap: ${
                      typeof chosen === 'number' && chosen < question.options.length
                        ? optionText(question.options, chosen)
                        : NO_ANSWER_TEXT
                    }`,
                  }
                })
              : null,
          }
        : null,
    reviewLocked: result !== null && answers === undefined,
  }
}

// --- Beceri görevleri -----------------------------------------------------------------------

type ProgressStatus = 'pending' | 'in_progress' | 'submitted' | 'late' | 'not_submitted'

export type SkillProgressFields = {
  learnerId: string
  status: ProgressStatus
  resubmissionRequested: boolean
  attemptId: string | null
  submissionId: string | null
  used: number
  limit: number | null
  score: { percent: number } | null
}

export type SkillAssignmentFields = {
  id: string
  title: string
  contentType: string
  scoringMode: 'auto' | 'teacher'
  kind: 'evaluation' | 'practice'
  deadline: { dueAt: string | null; lateAcceptanceDays: number }
  timeLimitMinutes: number | null
  submission: { submissionKind: string } | null
  learnerIds: readonly string[]
  progress: readonly SkillProgressFields[]
}

const CONTENT_LABELS: Record<string, string> = {
  quiz: 'Quiz',
  exercise_set: 'Alıştırma seti',
  question: 'Soru',
  homework_template: 'Yazma ödevi',
  text: 'Metin',
  reading_passage: 'Okuma parçası',
  audio: 'Dinleme',
  video: 'Video',
  worksheet: 'Çalışma kâğıdı',
  file: 'Dosya',
  link: 'Bağlantı',
  book_reference: 'Kitap',
}

/** Konuşma görevi: ses kaydıyla teslim edilen öğretmen puanlı görev. */
export const isSpeakingTask = (assignment: Pick<SkillAssignmentFields, 'submission'>): boolean =>
  assignment.submission?.submissionKind === 'audio'

export const skillTypeLabel = (
  assignment: Pick<SkillAssignmentFields, 'contentType' | 'submission'>,
): string =>
  isSpeakingTask(assignment)
    ? 'Konuşma görevi'
    : (CONTENT_LABELS[assignment.contentType] ?? assignment.contentType)

export const skillKindLabel = (assignment: Pick<SkillAssignmentFields, 'kind'>): string =>
  assignment.kind === 'evaluation' ? 'Değerlendirme' : 'Alıştırma'

const AUTO_STATUS: Record<ProgressStatus, string> = {
  pending: 'Başlanmadı',
  in_progress: 'Sürüyor',
  submitted: 'Tamamlandı',
  late: 'Geç tamamlandı',
  not_submitted: 'Teslim edilmedi',
}

const TEACHER_STATUS: Record<ProgressStatus, string> = {
  pending: 'Bekliyor',
  in_progress: 'Bekliyor',
  submitted: 'Teslim edildi',
  late: 'Geç teslim edildi',
  not_submitted: 'Teslim edilmedi',
}

/** Sunucu çocuğun özetini döndürmediyse satır bunu gösterir; diğer satırlar etkilenmez. */
export const SKILL_UNREADABLE = 'Okunamadı'

/** Seçili çocuğa hedeflenen atamalar (atama listesi velide her çocuğun özetini taşır). */
export function childSkillAssignments<T extends Pick<SkillAssignmentFields, 'learnerIds'>>(
  items: readonly T[],
  childId: string,
): T[] {
  return items.filter((item) => childId !== '' && item.learnerIds.includes(childId))
}

export type SkillProgressView = {
  status: string
  /** "2 / 3 deneme", "Sınırsız". */
  rights: string
  /** Yalnız sunucunun açtığı puan; yoksa `—`. */
  score: string
}

/**
 * Çocuğun durumu, hakkı ve açılmış puanı (web `summaryProgress`, veli için): özet yoksa "Okunamadı".
 * Teslim süresi dolan başlanmamış görev ekran açıkken "Teslim edilmedi" olur; son söz sunucunundur.
 */
export function skillProgress(
  assignment: SkillAssignmentFields,
  childId: string,
  now: Date,
): SkillProgressView {
  const entry = assignment.progress.find((item) => item.learnerId === childId)
  if (!entry) return { status: SKILL_UNREADABLE, rights: '—', score: '—' }
  const auto = assignment.scoringMode === 'auto'
  const expired = entry.status === 'pending' && isClosed(assignment.deadline, now.toISOString())
  const status: ProgressStatus = expired ? 'not_submitted' : entry.status
  const unit = auto || isSpeakingTask(assignment) ? 'deneme' : 'sürüm'
  return {
    status:
      !auto && entry.resubmissionRequested
        ? 'Yeniden teslim istendi'
        : (auto ? AUTO_STATUS : TEACHER_STATUS)[status],
    rights:
      entry.limit === null ? (auto ? 'Sınırsız' : '—') : `${entry.used} / ${entry.limit} ${unit}`,
    score: entry.status === 'in_progress' || !entry.score ? '—' : `${entry.score.percent} / 100`,
  }
}

const dueStamp = (iso: string | null) =>
  iso ? `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}` : 'Süresiz'

export type SkillRow = {
  id: string
  title: string
  subtitle: string
  status: string
  score: string
}

export function skillRow(assignment: SkillAssignmentFields, childId: string, now: Date): SkillRow {
  const progress = skillProgress(assignment, childId, now)
  return {
    id: assignment.id,
    title: assignment.title,
    subtitle: [
      skillTypeLabel(assignment),
      skillKindLabel(assignment),
      `Son teslim: ${dueStamp(assignment.deadline.dueAt)}`,
      progress.rights !== '—' ? progress.rights : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
    status: progress.status,
    score: progress.score,
  }
}

export const skillRows = (
  assignments: readonly SkillAssignmentFields[],
  childId: string,
  now: Date,
): SkillRow[] => assignments.map((assignment) => skillRow(assignment, childId, now))

export const skillMatches = (row: Pick<SkillRow, 'title' | 'subtitle'>, search: string): boolean =>
  quizMatches(row, search)

/**
 * Ayrıntıda gösterilecek sonuç kaynağı (web `parentResultOf`): öğretmen puanlı görevde teslim
 * sürümleri; otomatik puanlı görevde sonuç, listedeki özetten gelen puandır. Süren deneme okunmaz.
 */
export type SkillResultSource = { kind: 'submission'; submissionId: string } | { kind: 'none' }

export function skillResultSource(
  assignment: Pick<SkillAssignmentFields, 'scoringMode'>,
  progress: Pick<SkillProgressFields, 'submissionId' | 'used'> | undefined,
): SkillResultSource {
  if (assignment.scoringMode === 'auto' || !progress) return { kind: 'none' }
  return progress.submissionId && progress.used > 0
    ? { kind: 'submission', submissionId: progress.submissionId }
    : { kind: 'none' }
}

export type SkillFacts = { label: string; value: string }[]

export function skillFacts(
  assignment: SkillAssignmentFields,
  childId: string,
  now: Date,
): SkillFacts {
  const progress = skillProgress(assignment, childId, now)
  return [
    { label: 'Durum', value: progress.status },
    { label: 'Son teslim', value: dueStamp(assignment.deadline.dueAt) },
    {
      label:
        assignment.scoringMode === 'auto' || isSpeakingTask(assignment)
          ? 'Deneme hakkı'
          : 'Sürüm hakkı',
      value: progress.rights,
    },
    ...(assignment.timeLimitMinutes
      ? [{ label: 'Süre sınırı', value: `${assignment.timeLimitMinutes} dk` }]
      : []),
    { label: 'Puan', value: progress.score },
  ]
}

type VersionFields = {
  id: string
  number: number
  submittedAt: string
  late: boolean
  body: string | null
  score: {
    settled: boolean
    percent: number
    overallComment?: string | null
    criteria: readonly { criterionId: string; band: number; comment?: string | null }[]
  } | null
}

export type VersionView = {
  id: string
  title: string
  stamp: string
  late: boolean
  /** Yalnız sunucunun kesinleştirdiği puan; açılmadıysa `null` (DOM-BEC-045). */
  score: string | null
  body: string | null
  comment: string | null
  criteria: string[]
}

/** Gönderilen sürümler yeniden eskiye; puan ve geri bildirim yalnız kesinleşmişse (DOM-BEC-045). */
export function submissionVersions(versions: readonly VersionFields[]): VersionView[] {
  return [...versions]
    .sort((left, right) => right.number - left.number)
    .map((version) => {
      const score = version.score?.settled ? version.score : null
      return {
        id: version.id,
        title: `${version.number}. sürüm`,
        stamp: `${dateLabel(version.submittedAt, { year: 'numeric' })} ${timeLabel(
          version.submittedAt,
        )}`,
        late: version.late,
        score: score ? `Puan ${score.percent} / 100` : null,
        body: version.body,
        comment: score?.overallComment?.trim() || null,
        criteria: score
          ? score.criteria.map(
              (criterion, index) =>
                `${index + 1}. kriter: ${criterion.band}. bant${
                  criterion.comment ? ` · ${criterion.comment}` : ''
                }`,
            )
          : [],
      }
    })
}
