import type { components } from '@kampus/api-client/schema.d.ts'

/**
 * Beceri görevinin tür etiketleri (web ve mobil ortak): içerik türü adı ve konuşma görevi ayrımı.
 * Konuşma görevi ses kaydıyla teslim edilen öğretmen puanlı görevdir (IST-051).
 */
type Learner = components['schemas']['TaskAssignmentLearner']

export const TASK_CONTENT_LABELS: Record<Learner['contentType'], string> = {
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

type SubmissionOf = { submission?: { submissionKind: string } | null | undefined }

export const isSpeakingTask = (assignment: SubmissionOf): boolean =>
  assignment.submission?.submissionKind === 'audio'

export const taskTypeLabel = (assignment: Pick<Learner, 'contentType'> & SubmissionOf): string =>
  isSpeakingTask(assignment) ? 'Konuşma görevi' : TASK_CONTENT_LABELS[assignment.contentType]
