// Optik değerlendirme ekranının saf hesapları. Ayrıştırma, eşleştirme ve net hesabı core
// `lib/assessment-automation.ts`'tedir; burada ikinci kopya yazılmaz, yalnız ekran satırları ve
// ön kontrol sonucu türetilir.
import { ZodError } from 'zod'
import type { State } from '@kampus/school-core/data/seed.ts'
import {
  automationExams,
  currentEvaluations,
  previewOptical,
  type OpticalPreviewRow,
} from '@kampus/school-core/lib/assessment-automation.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import type { CollectionName } from '@kampus/school-core/modules/collection-modules.ts'

/** Optik sayfasının okuduğu koleksiyonlar; ilki ana koleksiyondur. */
export const OPTICAL_SOURCES = [
  'opticalProfiles',
  'mockExams',
  'mockResults',
  'opticalEvaluations',
  'subjects',
] as const satisfies readonly CollectionName[]

/** Cevap dosyası sınırı (core şeması: en fazla 1 MB, `.csv`/`.dat`/`.txt`). */
export const ANSWER_FILE_MAX_BYTES = 1024 * 1024

/** Seçilen dosya uygun değilse kullanıcıya Türkçe ileti; uygunsa `null`. */
export function answerFileProblem(file: { name: string; size: number }): string | null {
  return file.size > ANSWER_FILE_MAX_BYTES || !/\.(csv|dat|txt)$/i.test(file.name)
    ? 'En fazla 1 MB boyutunda CSV, DAT veya TXT dosyası seçin.'
    : null
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

type Profile = State['opticalProfiles'][number]

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

export type PreviewSummary = {
  students: number
  results: number
  /** Aynı sınav/öğrenci/ders için kayıtlı sonucu güncelleyecek satırlar. */
  replacing: number
  multiple: number
}

export type OpticalPreview =
  | { ok: true; rows: OpticalPreviewRow[]; summary: PreviewSummary }
  | { ok: false; message: string; code: string }

export function previewSummary(rows: readonly OpticalPreviewRow[]): PreviewSummary {
  return {
    students: new Set(rows.map((row) => row.studentId)).size,
    results: rows.length,
    replacing: rows.filter((row) => row.replaces).length,
    multiple: rows.reduce((sum, row) => sum + row.multiple, 0),
  }
}

/**
 * Cevap dosyası ön kontrolü: core `previewOptical` ile (saf işlem, kayıt oluşturmaz). Core ilk
 * hatada durur; ileti satır numarasını taşır ("3. satırdaki öğrenci tekil eşleşmedi: …").
 * Kaydı sunucu yine doğrular.
 */
export function previewAnswerFile(
  state: State,
  session: Session,
  profileId: string,
  text: string,
): OpticalPreview {
  try {
    const rows = previewOptical(state, session, { profileId, text })
    return { ok: true, rows, summary: previewSummary(rows) }
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message, code: error.code }
    if (error instanceof ZodError)
      return { ok: false, message: error.issues[0]?.message ?? 'Dosya geçersiz.', code: 'invalid' }
    throw error
  }
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
  net: number
  /** Etüt planlamasında kullanılabilir mi; değilse neden (eski analiz). */
  current: boolean
  staleReason: string
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
        net: evaluation.net,
        current,
        staleReason,
      }
    })
}
