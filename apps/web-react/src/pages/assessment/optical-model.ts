// Optik değerlendirme ekranının saf hesapları. Ayrıştırma, eşleştirme ve net hesabı sunucuda
// (core `lib/assessment-automation.ts`, `POST /assessment/evaluate/preview`) yapılır; burada
// yalnız dosya hazırlığı (kodlama, boyut) ve ekran satırları türetilir.
import type { z } from 'zod'
import { FILE_TOO_LARGE_MESSAGE } from '@kampus/react-shared/assessment-feedback.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import {
  automationExams,
  currentEvaluations,
  type automationSchemas,
} from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import type { CollectionName } from '@kampus/school-core/modules/collection-modules.ts'
import { OUTCOME_LABELS, percentText } from '../academic/exam-analysis-model.ts'

/** Optik sayfasının okuduğu koleksiyonlar; ilki ana koleksiyondur. */
export const OPTICAL_SOURCES = [
  'opticalProfiles',
  'mockExams',
  'mockResults',
  'opticalEvaluations',
  'subjects',
] as const satisfies readonly CollectionName[]

/** Cevap dosyası sınırı (sunucu: alan en fazla 1 MB UTF-8, `.csv`/`.dat`/`.txt`). */
export const ANSWER_FILE_MAX_BYTES = 1024 * 1024

export const FILE_TYPE_MESSAGE = 'En fazla 1 MB boyutunda CSV, DAT veya TXT dosyası seçin.'

/**
 * Seçilen dosya uygun değilse kullanıcıya Türkçe ileti; uygunsa `null`. 1 MB üstü dosya
 * sunucuya gönderilmeden reddedilir.
 */
export function answerFileProblem(file: { name: string; size: number }): string | null {
  if (file.size > ANSWER_FILE_MAX_BYTES) return FILE_TOO_LARGE_MESSAGE
  return /\.(csv|dat|txt)$/i.test(file.name) ? null : FILE_TYPE_MESSAGE
}

/** Metin alanı UTF-8 olarak 1 MB'ı aşıyorsa ileti (yapıştırılan içerik de sınırlıdır). */
export function answerTextProblem(text: string): string | null {
  return new TextEncoder().encode(text).length > ANSWER_FILE_MAX_BYTES
    ? FILE_TOO_LARGE_MESSAGE
    : null
}

export type DecodedFile = { text: string; encoding: 'utf-8' | 'windows-1254' }

/**
 * Okuyucu dosyasını çözer: önce katı UTF-8 (geçersiz bayt varsa hata), olmazsa Windows-1254.
 * Böylece UTF-8 dosyalar bozulmaz, eski Türkçe okuyucu çıktıları (ş, ğ, ı) doğru okunur.
 */
export function decodeAnswerFile(bytes: Uint8Array): DecodedFile {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    // UTF-8 değil: Türkçe okuyucuların ortak kodlaması Windows-1254'tür.
    return { text: new TextDecoder('windows-1254').decode(bytes), encoding: 'windows-1254' }
  }
}

const FORMAT_LABELS = { csv: 'CSV', fixed: 'DAT/TXT (sabit alan)' } as const

export type ProfileRow = {
  id: string
  title: string
  examId: string
  examTitle: string
  format: string
  identifier: string
  revision: number
  booklets: string
  questionCount: number
  /** Cevap anahtarı/kazanım bağlantısı eksikleri; boşsa profil kullanıma hazırdır. */
  gaps: string[]
}

export type Profile = State['opticalProfiles'][number]

/**
 * Profilin anahtar/kazanım eksikleri: sınavın her dersinde her kitapçıkta iptal edilmemiş en az
 * bir soru bulunmalı ve her soru bir kazanıma bağlı olmalıdır (core `parseAnswerKey` kuralları);
 * sınav silinmişse profil kullanılamaz.
 */
export function profileGaps(state: State, profile: Profile): string[] {
  const exam = state.mockExams.find((item) => item.id === profile.examId)
  if (!exam) return ['Profilin denemesi bulunamadı.']
  const gaps: string[] = []
  for (const subjectId of exam.subjectIds) {
    const name = state.subjects.find((subject) => subject.id === subjectId)?.name ?? subjectId
    for (const key of profile.keys) {
      const live = key.questions.filter((q) => q.subjectId === subjectId && q.answer !== '-')
      if (!live.length)
        gaps.push(`${key.booklet} kitapçığında ${name} dersi için anahtar sorusu yok.`)
    }
  }
  if (profile.keys.some((key) => key.questions.some((q) => !q.topic.trim())))
    gaps.push('Kazanımı boş soru var.')
  return gaps
}

export function profileRows(state: State): ProfileRow[] {
  return state.opticalProfiles.map((profile) => ({
    id: profile.id,
    title: profile.title,
    examId: profile.examId,
    examTitle: state.mockExams.find((exam) => exam.id === profile.examId)?.title ?? 'Deneme yok',
    format: profile.format === 'fixed' ? FORMAT_LABELS.fixed : FORMAT_LABELS.csv,
    identifier: profile.identifier === 'number' ? 'Okul numarası' : 'Öğrenci kimliği',
    revision: profile.revision,
    booklets: profile.keys.map((key) => key.booklet).join(', '),
    questionCount: profile.keys[0]?.questions.length ?? 0,
    gaps: profileGaps(state, profile),
  }))
}

/** Optik profili olmayan denemeler: değerlendirme yapılamaz, yönetici önce profil tanımlar. */
export function examsWithoutProfile(
  state: State,
  session: Session,
): { id: string; title: string }[] {
  return automationExams(state, session)
    .filter((exam) => !state.opticalProfiles.some((profile) => profile.examId === exam.id))
    .map((exam) => ({ id: exam.id, title: exam.title }))
}

/** Kazanım başarısı satırı: doğru/yanlış/boş sayıları ve core'un hesapladığı başarı yüzdesi. */
export type TopicRow = {
  id: string
  topic: string
  /** İptal edilmemiş soru sayısı (başarı paydası). */
  total: number
  correct: number
  /** Çoklu işaretler yanlış sayılır (core `summarize`). */
  wrong: number
  blank: number
  /** `%75`; bütün soruları iptal edilen kazanım için "—". */
  percent: string
  weak: boolean
}

/** Soru ayrıntısı satırı: öğrencinin işareti, anahtardaki doğru cevap ve sonuç. */
export type QuestionDetailRow = {
  id: string
  number: number
  topic: string
  response: string
  answer: string
  outcome: string
}

export type EvaluationRow = {
  id: string
  student: string
  subject: string
  exam: string
  booklet: string
  correct: number
  wrong: number
  blank: number
  multiple: number
  cancelled: number
  net: number
  /** Etüt planlamasında kullanılabilir mi; değilse neden (eski analiz). */
  current: boolean
  staleReason: string
  /** Ayrıntı paneli: kazanım başarıları ve soru sonuçları (kayıtlı analizden, yeniden hesaplanmaz). */
  topics: TopicRow[]
  questions: QuestionDetailRow[]
}

type Evaluation = State['opticalEvaluations'][number]

/** Öğrencinin işareti: boş işaret karakterleri "Boş", çoklu işaret açık yazılır. */
function responseText(response: string | undefined): string {
  const mark = (response ?? '').trim()
  if (mark === '' || '-._'.includes(mark)) return 'Boş'
  return mark === '*' ? 'Çoklu işaret' : mark
}

/**
 * Kayıtlı analizin kazanım başarıları. Başarı yüzdesi ve zayıf kazanım işareti analizle birlikte
 * saklanan `topicScores`/`weakTopics` alanlarından gelir (core `summarize`); yanlış ve boş
 * sayıları aynı analizdeki soru sonuçlarından sayılır.
 */
export function topicRows(evaluation: Evaluation): TopicRow[] {
  return evaluation.topicScores.map((score) => {
    const questions = evaluation.questionResults.filter((q) => q.topic === score.topic)
    return {
      id: score.topic,
      topic: score.topic,
      total: score.total,
      correct: score.correct,
      wrong: questions.filter((q) => q.outcome === 'wrong' || q.outcome === 'multiple').length,
      blank: questions.filter((q) => q.outcome === 'blank').length,
      percent: percentText(score.percent),
      weak: evaluation.weakTopics.includes(score.topic),
    }
  })
}

export function questionDetailRows(evaluation: Evaluation): QuestionDetailRow[] {
  return evaluation.questionResults.map((question) => ({
    id: `${evaluation.id}-${question.number}`,
    number: question.number,
    topic: question.topic,
    response: responseText(question.response),
    answer: question.answer === '-' ? '—' : question.answer,
    outcome: OUTCOME_LABELS[question.outcome],
  }))
}

/**
 * Kayıtlı optik analizler. Anahtar revizyonu değişmişse veya deneme sonucu elle/yeniden
 * değerlendirmeyle değişmişse analiz eskidir ve etüt için kullanılamaz (core `currentEvaluations`).
 */
export function evaluationRows(state: State, session: Session): EvaluationRow[] {
  const exams = automationExams(state, session)
  const usable = new Set(
    exams.flatMap((exam) =>
      currentEvaluations(state, exam.id, session).map((evaluation) => evaluation.id),
    ),
  )
  const visible = new Set(exams.map((exam) => exam.id))
  return state.opticalEvaluations
    .filter((evaluation) => visible.has(evaluation.examId))
    .map((evaluation) => {
      const profile = state.opticalProfiles.find((item) => item.id === evaluation.profileId)
      const result = state.mockResults.find(
        (item) =>
          item.examId === evaluation.examId &&
          item.studentId === evaluation.studentId &&
          item.subjectId === evaluation.subjectId,
      )
      const current = usable.has(evaluation.id)
      const staleReason = current
        ? ''
        : profile?.revision !== evaluation.keyRevision
          ? 'Cevap anahtarı değişti; dosyayı yeniden değerlendirin.'
          : result?.evaluationId !== evaluation.id
            ? 'Deneme sonucu değişti; dosyayı yeniden değerlendirin.'
            : 'Bu analiz kapsamınızda kullanılamaz.'
      return {
        id: evaluation.id,
        student: state.students.find((s) => s.id === evaluation.studentId)?.name ?? '—',
        subject:
          state.subjects.find((s) => s.id === evaluation.subjectId)?.name ?? evaluation.subjectId,
        exam: state.mockExams.find((e) => e.id === evaluation.examId)?.title ?? '—',
        booklet: evaluation.booklet,
        correct: evaluation.correct,
        wrong: evaluation.wrong,
        blank: evaluation.blank,
        multiple: evaluation.multiple,
        cancelled: evaluation.cancelled,
        net: evaluation.net,
        current,
        staleReason,
        topics: topicRows(evaluation),
        questions: questionDetailRows(evaluation),
      }
    })
}

export type ProfileFormInput = z.input<typeof automationSchemas.profile>
export type ProfileFormOutput = z.output<typeof automationSchemas.profile>

/** Anahtar şablonunun başlığı; yönetici sınavın sorularını satır satır ekler. */
export const KEY_TEMPLATE = 'booklet;question;subjectId;topic;answer\n'

/**
 * Profil formunun başlangıç değerleri. Düzenlemede kayıttan (anahtar CSV'si dahil), oluşturmada
 * CSV biçimi ve okul numarasıyla eşleşen varsayılanlardan başlar. CSV biçiminde konum alanları
 * kullanılmaz ama şema istediği için geçerli varsayılanlarla gönderilir.
 */
export function profileFormDefaults(
  profile: Profile | undefined,
  examId: string,
): ProfileFormInput {
  if (profile)
    return {
      examId: profile.examId,
      title: profile.title,
      format: profile.format === 'fixed' ? 'fixed' : 'csv',
      identifier: profile.identifier === 'id' ? 'id' : 'number',
      headerLines: profile.headerLines,
      studentStart: profile.studentStart,
      studentLength: profile.studentLength,
      bookletStart: profile.bookletStart,
      bookletLength: profile.bookletLength,
      answersStart: profile.answersStart,
      answersLength: profile.answersLength,
      keyCsv: profile.keyCsv,
    }
  return {
    examId,
    title: '',
    format: 'csv',
    identifier: 'number',
    headerLines: 0,
    studentStart: 1,
    studentLength: 7,
    bookletStart: 8,
    bookletLength: 1,
    answersStart: 9,
    answersLength: 12,
    keyCsv: KEY_TEMPLATE,
  }
}

/** Sunucu alan yolu (`keyCsv.line.4`) formda tek alana (`keyCsv`) bağlanır. */
export function formFieldOf(name: string): string {
  return name.split('.')[0] ?? name
}
