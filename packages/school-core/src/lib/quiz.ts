import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { requireAuthorized } from './authorize.ts'
import type { Participant } from './communication.ts'
import { gradeQuiz, type BankQuestion, type MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import type { RequestActor } from './requests.ts'

/**
 * Quiz hazırlama, çözme ve sunucu puanlaması (`quizzes`, `quizAttempts`, modül `learning`;
 * IST-095, docs/domain/akademik-olcme.md DOM-AKD-075…079). Saf işlemler; önce bütün kurallar
 * denetlenir, sonra State değişir. Yetki `lib/authorize.ts` tablosundadır (`quiz.create`,
 * `quiz.update`, `quiz.archive`, `quiz.start`, `quiz.submit`).
 *
 * - Quizi yönetici ya da sınıfın o dersine atanmış öğretmen soru bankasından hazırlar; soru
 *   kurumun bankasında, quizin dersinde ve sınıfın düzeyinde olmalıdır (DOM-AKD-075).
 * - Denemesi olan quizin soruları değişmez ve quiz arşivlenmez (DOM-AKD-076).
 * - Öğrenci başına tek deneme: deneme başlatılınca süre işler (`expiresAt`, en geç son tarih);
 *   gönderim süre ve kısa ağ payı içinde kabul edilir, ikinci gönderim 409'dur (DOM-AKD-077).
 * - Puan gönderilen cevaplardan sunucuda hesaplanır; istemciden puan alınmaz. Cevap anahtarı ve
 *   çözüm açıklaması öğrenci ve veliye hiçbir yanıtta dönmez (DOM-AKD-078).
 * - Quiz ortalaması denemelerden hesaplanır, saklanmaz (`quizStatistics`, DOM-AKD-079).
 *
 * Şemalar API gövde şeması ve web/mobil form şemasıdır (`zodResolver`).
 */

z.config(z.locales.tr())

export type QuizOptions = { institutionType?: InstitutionType }

export const QUIZ_TITLE_MAX_LENGTH = 120
export const QUIZ_DURATION_MIN = 5
export const QUIZ_DURATION_MAX = 120
export const QUIZ_QUESTION_LIMIT = 50
/** Süre dolduktan sonra gönderimin kabul edildiği ağ payı (saniye; DOM-AKD-077). */
export const QUIZ_SUBMIT_GRACE_SECONDS = 60

const identifier = (message: string) => z.string().trim().min(1, message).max(200)

const title = z
  .string()
  .trim()
  .min(2, 'Quiz başlığını yazın.')
  .max(QUIZ_TITLE_MAX_LENGTH, `Quiz başlığı en fazla ${QUIZ_TITLE_MAX_LENGTH} karakter olabilir.`)
/** Çözme süresi (dakika); deneme başlatılınca işler (DOM-AKD-077). */
const duration = z
  .number('Süreyi dakika olarak girin.')
  .int('Süre tam dakika olmalı.')
  .min(QUIZ_DURATION_MIN, `Süre ${QUIZ_DURATION_MIN}–${QUIZ_DURATION_MAX} dakika olmalı.`)
  .max(QUIZ_DURATION_MAX, `Süre ${QUIZ_DURATION_MIN}–${QUIZ_DURATION_MAX} dakika olmalı.`)
/** Son tarih: saat dilimli ISO 8601 an; UTC'ye çevrilip saklanır. */
const dueDate = z.iso.datetime({ offset: true, error: 'Son tarihi ve saati seçin.' })
const questionIds = z
  .array(identifier('Soru kimliği geçersiz.'))
  .min(1, 'En az bir soru seçin.')
  .max(QUIZ_QUESTION_LIMIT, `Bir quizde en fazla ${QUIZ_QUESTION_LIMIT} soru olabilir.`)
  .refine((ids) => new Set(ids).size === ids.length, 'Aynı soruyu bir kez ekleyin.')

export const createQuizSchema = z.strictObject({
  classId: identifier('Sınıf seçin.'),
  /** Ders; öğretmen sınıfa tek dersle giriyorsa verilmeyebilir. Yöneticide zorunlu. */
  subjectId: identifier('Ders seçin.').optional(),
  title,
  duration,
  /** Bu andan sonra deneme başlatılamaz; verilmezse quiz süresiz açıktır. */
  dueDate: dueDate.optional(),
  questionIds,
})
export type CreateQuizInput = z.input<typeof createQuizSchema>

/** Kısmi düzenleme: sınıf ve ders değişmez (gövdede 400); `dueDate: null` son tarihi kaldırır. */
export const updateQuizSchema = z
  .strictObject({
    title: title.optional(),
    duration: duration.optional(),
    dueDate: dueDate.nullable().optional(),
    questionIds: questionIds.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'En az bir alan gönderin.',
  })
export type UpdateQuizInput = z.input<typeof updateQuizSchema>

/**
 * Gönderim: soru kimliğinden seçilen şıkkın sırasına (0'dan) eşleme. Boş bırakılan soru gönderilmez
 * ya da `null`dır ve yanlış sayılır. Puan alanı yoktur; puan sunucuda hesaplanır (DOM-AKD-078).
 */
export const submitQuizSchema = z.strictObject({
  answers: z
    .record(
      identifier('Soru kimliği geçersiz.'),
      z.number('Şıkkı seçin.').int('Şık geçersiz.').min(0, 'Şık geçersiz.').nullable(),
    )
    .refine(
      (answers) => Object.keys(answers).length <= QUIZ_QUESTION_LIMIT,
      'Quizde olmayan soruya cevap gönderilemez.',
    ),
})
export type SubmitQuizInput = z.input<typeof submitQuizSchema>

/** Quiz işlemlerinin eklediği alanlar; örnek veri ve eski kayıtlar taşımaz. */
export type QuizFields = {
  /** Deneme başlatmanın son anı (UTC); yoksa süresiz açık. */
  dueDate?: string
  createdBy?: RequestActor
  updatedAt?: string
}

/**
 * Deneme işlemlerinin eklediği alanlar. Alanı olmayan eski kayıt tamamlanmış denemedir.
 * Başlatılan denemenin sonuç alanları (`score`, `correct`, `topicScores`) boş cevaplı sonuçla
 * doldurulur: süresi içinde gönderilmeyen deneme bu sonuçla (0) kalır (DOM-AKD-077).
 */
export type QuizAttemptFields = {
  status?: 'started' | 'completed'
  startedAt?: string
  /** Gönderimin son anı: başlangıç + süre, son tarih daha erkense son tarih. */
  expiresAt?: string
  submittedAt?: string
  startedBy?: RequestActor
  updatedAt?: string
}

/** Yetkinin dayandığı quiz tarafları (DOM-AKD-076). */
export type QuizParties = { classId: string; subjectId: string; teacherId: string }

type QuizRecord = State['quizzes'][number] & QuizFields
type AttemptRecord = State['quizAttempts'][number] & QuizAttemptFields

/** Denemenin durumu: `in_progress` süresi işleyen, `expired` süresinde gönderilmemiş deneme. */
export type QuizAttemptStatus = 'in_progress' | 'expired' | 'completed'

const actorOf = (by: Participant): RequestActor => ({ role: by.role, userId: by.userId })
const instant = (value: string) => new Date(value).toISOString()

/**
 * Denemenin durumu (DOM-AKD-077). Alanı olmayan eski kayıt tamamlanmıştır; başlatılmış deneme
 * `expiresAt` ile ağ payı geçince `expired` olur.
 */
export function quizAttemptStatus(
  attempt: Pick<QuizAttemptFields, 'status' | 'expiresAt'>,
  now: string,
): QuizAttemptStatus {
  if (attempt.status !== 'started') return 'completed'
  if (attempt.expiresAt === undefined) return 'in_progress'
  return Date.parse(now) > Date.parse(attempt.expiresAt) + QUIZ_SUBMIT_GRACE_SECONDS * 1000
    ? 'expired'
    : 'in_progress'
}

/** Denemenin puanı sayılır mı: tamamlanmış ya da süresi dolmuş (boş cevaplı, 0). */
export const isScoredAttempt = (
  attempt: Pick<QuizAttemptFields, 'status' | 'expiresAt'>,
  now: string,
) => quizAttemptStatus(attempt, now) !== 'in_progress'

/** Quizin son tarihi geçti mi; son tarihi olmayan quiz kapanmaz. */
export const isQuizClosed = (quiz: Pick<QuizFields, 'dueDate'>, now: string) =>
  quiz.dueDate !== undefined && Date.parse(quiz.dueDate) <= Date.parse(now)

/** Öğrenciye giden soru: cevap anahtarı (`answer`) ve çözüm açıklaması yoktur (DOM-AKD-078). */
export type QuizQuestionView = Pick<BankQuestion, 'id' | 'text' | 'options' | 'topic'>

/**
 * Quizin sorularını cevap anahtarsız döndürür (DOM-AKD-078). Bankada bulunmayan soru varsa
 * 422 `quiz_question_unavailable`: eksik soruyla deneme başlatılmaz ve puanlanmaz.
 */
export function quizQuestionsView(
  quiz: { questionIds: readonly string[] },
  bank: readonly BankQuestion[],
): QuizQuestionView[] {
  return quiz.questionIds.map((id) => {
    const question = bank.find((q) => q.id === id)
    if (!question)
      throw new DomainError(
        'quiz_question_unavailable',
        'Quizin bazı soruları artık bulunamıyor; öğretmeninize bildirin.',
      )
    return {
      id: question.id,
      text: question.text,
      options: question.options,
      topic: question.topic,
    }
  })
}

export type QuizResult = Pick<AttemptRecord, 'score' | 'correct' | 'total' | 'topicScores'>

/**
 * Denemenin sonucu cevaplardan, bankadaki anahtarla hesaplanır (DOM-AKD-078): kayıttaki sonuç
 * alanları yalnız eski görünümler için gönderim anında yazılan kopyadır. Sorulardan biri bankada
 * yoksa (silinmiş soru) kayıttaki sonuca düşülür.
 */
export function quizAttemptResult(
  attempt: Pick<AttemptRecord, 'answers' | 'score' | 'correct' | 'total' | 'topicScores'>,
  quiz: { questionIds: readonly string[] },
  bank: readonly BankQuestion[],
): QuizResult {
  const known = new Set(bank.map((q) => q.id))
  if (quiz.questionIds.length > 0 && quiz.questionIds.every((id) => known.has(id))) {
    const { score, correct, total, topicScores } = gradeQuiz(quiz, bank, attempt.answers, true)
    return { score, correct, total, topicScores }
  }
  return {
    score: attempt.score,
    correct: attempt.correct,
    total: attempt.total,
    topicScores: attempt.topicScores.map((t) => ({ ...t })),
  }
}

/** Öğrenci ve veliye dönen deneme: sonuç süre işlerken yoktur; anahtar hiç yoktur. */
export type QuizAttemptView = {
  id: string
  quizId: string
  studentId: string
  status: QuizAttemptStatus
  startedAt: string | null
  expiresAt: string | null
  submittedAt: string | null
  /** Öğrencinin kendi cevapları (soru kimliği → şık sırası); doğru şık yoktur. */
  answers: Record<string, number>
  result: QuizResult | null
}

/**
 * Denemenin öğrenci/veli görünümü (DOM-AKD-078): puan, doğru ve soru sayısı ile konu yüzdeleri
 * deneme tamamlanınca ya da süresi dolunca açılır; soru bazında doğru/yanlış, doğru şık ve
 * açıklama açılmaz.
 */
export function quizAttemptView(
  attempt: AttemptRecord,
  quiz: { questionIds: readonly string[] },
  bank: readonly BankQuestion[],
  now: string,
): QuizAttemptView {
  const status = quizAttemptStatus(attempt, now)
  return {
    id: attempt.id,
    quizId: attempt.quizId,
    studentId: attempt.studentId,
    status,
    startedAt: attempt.startedAt ?? null,
    expiresAt: attempt.expiresAt ?? null,
    submittedAt: attempt.submittedAt ?? (attempt.status === undefined ? attempt.date : null),
    answers: status === 'in_progress' ? {} : { ...attempt.answers },
    result: status === 'in_progress' ? null : quizAttemptResult(attempt, quiz, bank),
  }
}

/**
 * Rol soru metnini görür mü (DOM-AKD-078): yönetici ve öğretmen bankadan anahtarla okur; öğrenci
 * denemeyi başlatınca, veli çocuğunun denemesi sonuçlanınca anahtarsız görür.
 */
export function canSeeQuizQuestions(role: Role, status: QuizAttemptStatus | undefined): boolean {
  if (role === 'yonetici' || role === 'ogretmen') return true
  if (role === 'ogrenci') return status !== undefined
  if (role === 'veli') return status === 'completed' || status === 'expired'
  return false
}

export type QuizStatistics = {
  /** Deneme başlatan öğrenci sayısı. */
  started: number
  /** Puanı sayılan deneme (tamamlanmış ya da süresi dolmuş) sayısı. */
  scored: number
  inProgress: number
  /** Puanı sayılan denemelerin ortalaması (tam sayı yüzde); deneme yoksa `null`. */
  average: number | null
}

/**
 * Quizin deneme özeti (DOM-AKD-079): ortalama saklanmaz, her okumada denemelerden hesaplanır.
 * Puan cevaplardan hesaplanır (`quizAttemptResult`). Süresi işleyen deneme ortalamaya girmez;
 * süresi dolmuş deneme boş cevaplı sonucuyla (0) girer.
 * Eski kayıtlarda öğrenci başına birden çok deneme varsa ilk deneme sayılır (DOM-AKD-060).
 */
export function quizStatistics(
  quiz: { id: string; questionIds: readonly string[] },
  attempts: readonly AttemptRecord[],
  bank: readonly BankQuestion[],
  now: string,
): QuizStatistics {
  const first = new Map<string, (typeof attempts)[number]>()
  const own = attempts.filter((a) => a.quizId === quiz.id)
  for (const attempt of own.sort((a, b) => a.date.localeCompare(b.date)))
    if (!first.has(attempt.studentId)) first.set(attempt.studentId, attempt)
  const scores: number[] = []
  let inProgress = 0
  for (const attempt of first.values())
    if (isScoredAttempt(attempt, now)) scores.push(quizAttemptResult(attempt, quiz, bank).score)
    else inProgress += 1
  return {
    started: first.size,
    scored: scores.length,
    inProgress,
    average: scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : null,
  }
}

function linkedStudentId(state: State, by: Participant): string | undefined {
  if (by.role !== 'ogrenci') return undefined
  const ids = new Set(
    by.links.filter((link) => link.kind === 'student').map((link) => link.recordId),
  )
  const found = state.students.filter((s) => ids.has(s.id))
  return found.length === 1 ? found[0]?.id : undefined
}

const quizNotFound = () =>
  new DomainError('quiz_not_found', 'Quiz bulunamadı.', { kind: 'not_found' })
const hasAttempts = () =>
  new DomainError(
    'quiz_has_attempts',
    'Çözülmeye başlanmış quizin soruları değiştirilemez ve quiz arşivlenemez.',
    { kind: 'conflict' },
  )

function assertFutureDue(due: string, now: string) {
  if (Date.parse(due) <= Date.parse(now))
    throw new DomainError('quiz_due_in_past', 'Son tarih geçmişte olamaz.', { path: ['dueDate'] })
}

/**
 * Soruların hepsi kurumun bankasında, quizin dersinde ve sınıfın düzeyinde mi (DOM-AKD-075).
 * Bankada olmayan (başka kurumun ya da silinmiş) soru 422 `quiz_question_unavailable`, ders ya da
 * düzey dışı soru 422 `quiz_question_mismatch`.
 */
function assertQuestions(
  state: State,
  ids: readonly string[],
  subjectId: string,
  grade: number | undefined,
) {
  for (const id of ids) {
    const question = state.bank.find((q) => q.id === id)
    if (!question)
      throw new DomainError('quiz_question_unavailable', 'Seçilen soru soru bankasında yok.', {
        path: ['questionIds'],
      })
    if (
      question.subjectId !== subjectId ||
      (grade !== undefined && (grade < question.minGrade || grade > question.maxGrade))
    )
      throw new DomainError(
        'quiz_question_mismatch',
        'Sorular quizin dersine ve sınıfın düzeyine uygun olmalıdır.',
        { path: ['questionIds'] },
      )
  }
}

type ClassRow = { id: string; grade?: number; isActive?: boolean; deletedAt?: string | null }
const gradeOf = (state: State, classId: string): number | undefined => {
  const classroom: ClassRow | undefined = state.classes.find((c) => c.id === classId)
  return typeof classroom?.grade === 'number' ? classroom.grade : undefined
}

/**
 * Quiz hazırla (DOM-AKD-075). Öğretmen yalnız derse girdiği sınıf ve branşa (403
 * `quiz_scope_denied`); sınıfa birden çok dersle giren öğretmen dersi seçer (422
 * `quiz_subject_required`). Yönetici dersi seçer; quizin öğretmeni sınıfın o dersine atanmış
 * aktif öğretmendir (yoksa 422 `quiz_teacher_unavailable`). Olmayan sınıf 404, pasif sınıf 422
 * `record_inactive`, geçmiş son tarih 422 `quiz_due_in_past`; soru denetimi `assertQuestions`.
 */
export function createQuiz(
  state: State,
  by: Participant,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: QuizOptions = {},
): QuizRecord {
  const data = createQuizSchema.parse(input)
  const teacherId =
    by.role === 'ogretmen' ? by.links.find((link) => link.kind === 'teacher')?.recordId : undefined
  let subjectId = data.subjectId
  if (subjectId === undefined) {
    if (by.role !== 'ogretmen')
      throw new DomainError('quiz_subject_required', 'Quizin dersini seçin.', {
        path: ['subjectId'],
      })
    const subjects = [
      ...new Set(
        state.assignments
          .filter((a) => a.classId === data.classId && a.teacherId === teacherId)
          .map((a) => a.subjectId),
      ),
    ]
    // Sınıfa girmeyen öğretmen yetki denetiminde 403 alır; dersi tek olan öğretmen seçmez.
    subjectId = subjects.length === 1 ? subjects[0] : undefined
    if (subjects.length > 1)
      throw new DomainError('quiz_subject_required', 'Quizin dersini seçin.', {
        path: ['subjectId'],
      })
  }
  requireAuthorized(
    by,
    'quiz.create',
    { classId: data.classId, subjectId: subjectId ?? '' },
    state,
    options,
  )
  const classroom: ClassRow | undefined = state.classes.find((c) => c.id === data.classId)
  if (!classroom)
    throw new DomainError('class_not_found', 'Sınıf bulunamadı.', { kind: 'not_found' })
  if (classroom.isActive === false || classroom.deletedAt)
    throw new DomainError('record_inactive', 'Pasif sınıfa quiz hazırlanamaz.', {
      path: ['classId'],
    })
  const assignment = state.assignments.find(
    (a) =>
      a.classId === data.classId &&
      a.subjectId === subjectId &&
      (teacherId === undefined || a.teacherId === teacherId),
  )
  const teacher = state.teachers.find((t) => t.id === assignment?.teacherId)
  if (!assignment || !teacher || teacher.isActive === false || teacher.deletedAt)
    throw new DomainError(
      'quiz_teacher_unavailable',
      'Bu sınıfın bu dersine atanmış aktif öğretmen yok.',
      { path: ['subjectId'] },
    )
  const due = data.dueDate === undefined ? undefined : instant(data.dueDate)
  if (due !== undefined) assertFutureDue(due, now)
  assertQuestions(state, data.questionIds, assignment.subjectId, gradeOf(state, classroom.id))
  const subject = state.subjects.find((s) => s.id === assignment.subjectId)
  const quiz: QuizRecord = {
    id: makeId('quiz'),
    title: data.title,
    classId: classroom.id,
    subjectId: assignment.subjectId,
    teacherId: teacher.id,
    subject: subject?.name ?? '',
    questionIds: [...data.questionIds],
    duration: data.duration,
    ...(due === undefined ? {} : { dueDate: due }),
    createdAt: now,
    createdBy: actorOf(by),
    updatedAt: now,
  }
  // Yeni kayıt sona eklenir: API koleksiyonu kısmi yükler (yalnız sona ekleme serbesttir).
  state.quizzes.push(quiz)
  return quiz
}

function findQuiz(state: State, quizId: string): QuizRecord | undefined {
  return state.quizzes.find((q) => q.id === quizId)
}
const partiesOf = (quiz: QuizRecord | undefined): QuizParties | undefined =>
  quiz && { classId: quiz.classId, subjectId: quiz.subjectId, teacherId: quiz.teacherId }
const attemptsOf = (state: State, quizId: string) =>
  state.quizAttempts.some((a) => a.quizId === quizId)

/**
 * Quizi düzenle (DOM-AKD-076): başlık, süre, son tarih ve sorular. Sınıf ve ders değişmez.
 * Denemesi olan quizin soruları değişmez (409 `quiz_has_attempts`); süre ve son tarih yalnız
 * sonraki denemeleri etkiler. Yeni son tarih geçmişte olamaz. Yönetici ya da sınıfın o dersine
 * atanmış öğretmen düzenler; quizi gören başka öğretmen 403 `quiz_not_owner`, görmeyen 404.
 */
export function updateQuiz(
  state: State,
  by: Participant,
  quizId: string,
  input: unknown,
  now: string,
  options: QuizOptions = {},
): QuizRecord {
  const data = updateQuizSchema.parse(input)
  const quiz = findQuiz(state, quizId)
  requireAuthorized(by, 'quiz.update', { quiz: partiesOf(quiz) }, state, options)
  if (!quiz) throw quizNotFound()
  const questionsChanged =
    data.questionIds !== undefined &&
    (data.questionIds.length !== quiz.questionIds.length ||
      data.questionIds.some((id, i) => quiz.questionIds[i] !== id))
  if (questionsChanged && attemptsOf(state, quiz.id)) throw hasAttempts()
  if (questionsChanged && data.questionIds)
    assertQuestions(state, data.questionIds, quiz.subjectId, gradeOf(state, quiz.classId))
  const due = data.dueDate == null ? data.dueDate : instant(data.dueDate)
  if (typeof due === 'string' && due !== quiz.dueDate) assertFutureDue(due, now)
  Object.assign(quiz, {
    ...(data.title === undefined ? {} : { title: data.title }),
    ...(data.duration === undefined ? {} : { duration: data.duration }),
    ...(questionsChanged && data.questionIds ? { questionIds: [...data.questionIds] } : {}),
    ...(typeof due === 'string' ? { dueDate: due } : {}),
    updatedAt: now,
  })
  if (due === null) delete quiz.dueDate
  return quiz
}

/**
 * Quizi arşivle (DOM-AKD-076): kayıt State'ten çıkar (API arşivler, silmez). Denemesi olan quiz
 * arşivlenmez: 409 `quiz_has_attempts` (öğrencinin sonucu ve aktarılmış not korunur). Yetki
 * düzenlemeyle aynıdır.
 */
export function archiveQuiz(
  state: State,
  by: Participant,
  quizId: string,
  options: QuizOptions = {},
): QuizRecord {
  const quiz = findQuiz(state, quizId)
  requireAuthorized(by, 'quiz.archive', { quiz: partiesOf(quiz) }, state, options)
  if (!quiz) throw quizNotFound()
  if (attemptsOf(state, quiz.id)) throw hasAttempts()
  state.quizzes = state.quizzes.filter((q) => q.id !== quiz.id)
  return quiz
}

/** Öğrencinin quizi ve denemesi; yetki ve varlık denetimi `start` ve `submit` için ortaktır. */
function studentQuiz(
  state: State,
  by: Participant,
  action: 'quiz.start' | 'quiz.submit',
  quizId: string,
  options: QuizOptions,
) {
  const studentId = linkedStudentId(state, by)
  const quiz = findQuiz(state, quizId)
  requireAuthorized(
    by,
    action,
    { studentId, quiz: quiz && { classId: quiz.classId } },
    state,
    options,
  )
  const student = state.students.find((s) => s.id === studentId)
  if (!quiz) throw quizNotFound()
  if (!student)
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  if (student.isActive === false)
    throw new DomainError('student_inactive', 'Kaydı pasif olan öğrenci quiz çözemez.')
  const attempt: AttemptRecord | undefined = state.quizAttempts.find(
    (a) => a.quizId === quiz.id && a.studentId === student.id,
  )
  return { quiz, student, attempt }
}

export type StartQuizOutcome = {
  attempt: AttemptRecord
  /** Yeni deneme mi (201) yoksa süresi işleyen deneme mi (200). */
  created: boolean
  /** Cevap anahtarsız sorular (DOM-AKD-078). */
  questions: QuizQuestionView[]
}

/**
 * Denemeyi başlat (DOM-AKD-077). Öğrenci oturumdan çözülür; yalnız kendi sınıfının quizi
 * (başka sınıfın quizi ve olmayan quiz 404). Süresi işleyen deneme varsa aynısı döner (sayfa
 * yenilemesi süreyi baştan başlatmaz). Tamamlanmış ya da süresi dolmuş deneme 409
 * `quiz_already_attempted`; son tarihi geçmiş quiz 422 `quiz_closed`. Deneme boş cevaplı sonuçla
 * yazılır: süresinde gönderilmezse sonuç budur.
 */
export function startQuiz(
  state: State,
  by: Participant,
  quizId: string,
  makeId: MakeId,
  now: string,
  options: QuizOptions = {},
): StartQuizOutcome {
  const { quiz, student, attempt } = studentQuiz(state, by, 'quiz.start', quizId, options)
  if (attempt) {
    if (quizAttemptStatus(attempt, now) !== 'in_progress')
      throw new DomainError('quiz_already_attempted', 'Bu quizi zaten çözdünüz.', {
        kind: 'conflict',
      })
    return { attempt, created: false, questions: quizQuestionsView(quiz, state.bank) }
  }
  if (isQuizClosed(quiz, now)) throw new DomainError('quiz_closed', 'Bu quizin son tarihi geçti.')
  const questions = quizQuestionsView(quiz, state.bank)
  const limit = Date.parse(now) + quiz.duration * 60_000
  const expiresAt = new Date(
    quiz.dueDate === undefined ? limit : Math.min(limit, Date.parse(quiz.dueDate)),
  ).toISOString()
  const created: AttemptRecord = {
    id: makeId('attempt'),
    quizId: quiz.id,
    studentId: student.id,
    answers: {},
    ...gradeQuiz(quiz, state.bank, {}, true),
    date: now,
    status: 'started',
    startedAt: now,
    expiresAt,
    startedBy: actorOf(by),
    updatedAt: now,
  }
  state.quizAttempts.push(created)
  return { attempt: created, created: true, questions }
}

/**
 * Cevapları gönder (DOM-AKD-077, -078). Puan yalnız cevaplardan, bankadaki anahtarla hesaplanır.
 * Başlatılmamış deneme 422 `quiz_not_started`; tamamlanmış deneme 409 `quiz_already_submitted`
 * (yinelenen istek aynı `Idempotency-Key` ile ilk yanıtı alır); süre ve ağ payı geçmişse 422
 * `quiz_time_expired` ve deneme boş cevaplı sonucuyla kalır. Quizde olmayan soru ya da olmayan
 * şık 422 `quiz_answer_invalid`; boş soru yanlış sayılır.
 */
export function submitQuiz(
  state: State,
  by: Participant,
  quizId: string,
  input: unknown,
  now: string,
  options: QuizOptions = {},
): AttemptRecord {
  const data = submitQuizSchema.parse(input)
  const { quiz, attempt } = studentQuiz(state, by, 'quiz.submit', quizId, options)
  if (!attempt) throw new DomainError('quiz_not_started', 'Önce quizi başlatın.')
  const status = quizAttemptStatus(attempt, now)
  if (status === 'completed')
    throw new DomainError('quiz_already_submitted', 'Bu quizin cevaplarını zaten gönderdiniz.', {
      kind: 'conflict',
    })
  if (status === 'expired')
    throw new DomainError('quiz_time_expired', 'Quizin süresi doldu; cevaplar kaydedilmedi.')
  const questions = new Map(
    quizQuestionsView(quiz, state.bank).map((question) => [question.id, question]),
  )
  const answers: Record<string, number> = {}
  for (const [questionId, answer] of Object.entries(data.answers)) {
    const question = questions.get(questionId)
    if (!question || (answer !== null && answer >= question.options.length))
      throw new DomainError('quiz_answer_invalid', 'Cevaplar bu quizin sorularıyla uyuşmuyor.', {
        path: ['answers'],
      })
    if (answer !== null) answers[questionId] = answer
  }
  Object.assign(attempt, {
    answers,
    ...gradeQuiz(quiz, state.bank, answers, true),
    date: now,
    status: 'completed',
    submittedAt: now,
    updatedAt: now,
  })
  return attempt
}
