// Öğretmenime Sor (öğrenci) ve Soru Kuyruğu (öğretmen) satır hesapları (Vue `Learning.vue`).
// Saf işlevlerdir: API satırı girer, tablo ve panel satırı çıkar. Durum ve yanıt süresi saklanmaz;
// core `questionStatus` ve `questionResponse` ile her okumada hesaplanır (DOM-ILT-013, DOM-ILT-093).
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  QUESTION_ANSWER_LIMIT,
  QUESTION_STATUS_LABELS,
  questionResponse,
  questionStatus,
  type QuestionStatus,
} from '@kampus/school-core/lib/questions.ts'
import type { CoreRow } from '@/hooks/use-core-collection.ts'

/** Ders ve öğretmen adları; kapsamlı koleksiyon yanıtlarından kurulur. */
export type QuestionLookups = {
  subjects: ReadonlyMap<string, string>
  teachers: ReadonlyMap<string, string>
}

export const OVERDUE_LABEL = 'Süre aşıldı'

/** "Süresi yaklaşan": hedefe en çok bu kadar dakika kalmış, henüz aşılmamış soru (Vue 4 saat). */
export const DUE_SOON_MINUTES = 4 * 60

/** Yanıt süresi süzgeci (Vue "Süresi aşılmış sorular" ve "Süresi yaklaşan sorular" ön ayarları). */
export const SLA_FILTERS = [
  { value: 'all', label: 'Tüm süreler' },
  { value: 'overdue', label: 'Süresi aşılmış' },
  { value: 'soon', label: 'Süresi yaklaşan' },
] as const
export type SlaFilter = (typeof SLA_FILTERS)[number]['value']

/** Yanıtı yazanın rolü ekranda yalnız "Öğretmen" olarak görünür; kişi adı gösterilmez. */
const ANSWER_AUTHOR = 'Öğretmen'

export type AnswerRow = {
  id: string
  text: string
  /** ISO an. */
  at: string
  by: string
  /** İlk yanıt mı, ek yanıt mı. */
  kind: 'first' | 'follow-up'
}

export type QuestionRow = {
  id: string
  /** `If-Match` için okunan sürüm. */
  version: number
  studentId: string
  student: string
  className: string
  teacherId: string
  teacher: string
  subjectId: string
  subject: string
  topic: string
  title: string
  text: string
  /** Durumun Türkçe etiketi (filtre ve rozet). */
  status: string
  state: QuestionStatus
  /** ISO an; gönderim zamanı. */
  createdAt: string
  /** İlk yanıtın metni; yanıt yoksa boş. */
  answer: string
  answers: AnswerRow[]
  /** Yanıt süresi metni: yanıtlandıysa geçen süre, bekliyorsa hedef ya da "Süre aşıldı". */
  response: string
  /**
   * Yanıt bekleyen soruda hedefe kalan tam dakika (aşıldıysa negatif); yanıtlanan ve geri çekilen
   * soruda `null`. "Yanıt süresi" sütununun sayısal sıralama anahtarıdır: en acil soru önce gelir,
   * `null`'lar sona düşer.
   */
  remainingMinutes: number | null
  overdue: boolean
  /** Öğrenci yalnız yanıtsız soruyu geri çeker (DOM-ILT-091). */
  canWithdraw: boolean
  /** Öğretmen geri çekilmemiş soruya, yanıt sınırı dolmadıkça yanıt yazar (DOM-ILT-092). */
  canAnswer: boolean
  answerLimitReached: boolean
}

/** "3 sa 20 dk" biçiminde süre; bir dakikadan kısası "1 dakikadan kısa". */
export function durationText(milliseconds: number): string {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000)
  if (minutes < 1) return '1 dakikadan kısa'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  return [
    days > 0 ? `${days} gün` : '',
    hours > 0 ? `${hours} sa` : '',
    days === 0 && rest > 0 ? `${rest} dk` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** "31 Eki 2026 14:05" biçiminde gün ve saat (Europe/Istanbul). */
export const questionStamp = (iso: string) =>
  `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`

function responseText(
  state: QuestionStatus,
  createdAt: string,
  answeredAt: string | null,
  dueAt: string,
  overdue: boolean,
): string {
  if (state === 'withdrawn') return '—'
  if (state === 'answered' && answeredAt)
    return durationText(Date.parse(answeredAt) - Date.parse(createdAt))
  return overdue ? OVERDUE_LABEL : `Hedef ${questionStamp(dueAt)}`
}

export function questionRow(
  item: CoreRow<'questions'>,
  lookups: QuestionLookups,
  now: string,
): QuestionRow {
  const record = item.record
  const state = questionStatus(record)
  const timing = questionResponse(record, now)
  const answers: AnswerRow[] = [
    ...(record.answeredAt
      ? [
          {
            id: `${item.id}-ilk`,
            text: record.answer,
            at: record.answeredAt,
            by: ANSWER_AUTHOR,
            kind: 'first' as const,
          },
        ]
      : []),
    ...(record.followUps ?? []).map((followUp) => ({
      id: followUp.id,
      text: followUp.text,
      at: followUp.at,
      by: ANSWER_AUTHOR,
      kind: 'follow-up' as const,
    })),
  ]
  const limitReached = answers.length >= QUESTION_ANSWER_LIMIT
  return {
    id: item.id,
    version: item.version,
    studentId: record.studentId,
    student: item.joined?.studentName ?? '',
    className: item.joined?.className ?? '',
    teacherId: record.teacherId,
    teacher: lookups.teachers.get(record.teacherId) ?? '—',
    subjectId: record.subjectId,
    subject: lookups.subjects.get(record.subjectId) ?? '—',
    topic: record.topic ?? '',
    title: record.title,
    text: record.text,
    status: QUESTION_STATUS_LABELS[state],
    state,
    createdAt: record.createdAt,
    answer: record.answeredAt ? record.answer : '',
    answers,
    response: responseText(
      state,
      record.createdAt,
      timing.answeredAt,
      timing.dueAt,
      timing.overdue,
    ),
    remainingMinutes:
      state === 'pending'
        ? Math.floor((Date.parse(timing.dueAt) - Date.parse(now)) / 60_000)
        : null,
    overdue: timing.overdue,
    canWithdraw: state === 'pending',
    canAnswer: state !== 'withdrawn' && !limitReached,
    answerLimitReached: state !== 'withdrawn' && limitReached,
  }
}

/** Yanıt süresi süzgecine uyar mı: aşılmış ya da hedefe `DUE_SOON_MINUTES` kala (aşılmamış). */
export function matchesSla(
  row: Pick<QuestionRow, 'overdue' | 'remainingMinutes'>,
  filter: SlaFilter,
): boolean {
  if (filter === 'overdue') return row.overdue
  if (filter === 'soon')
    return (
      row.remainingMinutes !== null &&
      row.remainingMinutes >= 0 &&
      row.remainingMinutes <= DUE_SOON_MINUTES
    )
  return true
}

/** Ders adı ve öğretmen adı eşlemeleri; kapsamlı koleksiyon satırlarından. */
export function questionLookups(
  subjects: ReadonlyArray<{ id: string; record: { name: string } }>,
  teachers: ReadonlyArray<{ id: string; record: { name: string } }>,
): QuestionLookups {
  return {
    subjects: new Map(subjects.map((item) => [item.id, item.record.name])),
    teachers: new Map(teachers.map((item) => [item.id, item.record.name])),
  }
}

const byCreated = (a: QuestionRow, b: QuestionRow) =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt)

/**
 * Varsayılan sıra. Öğretmen kuyruğunda yanıt bekleyenler önce ve en eski soru en üstte (süre
 * hedefi ona yakın); sonra yanıtlananlar ve geri çekilenler yeniden eskiye. Öğrencinin listesi
 * yeniden eskiyedir.
 */
export function orderQuestions(
  rows: readonly QuestionRow[],
  audience: 'student' | 'teacher',
): QuestionRow[] {
  if (audience === 'student') return [...rows].sort((a, b) => byCreated(b, a))
  const pending = rows.filter((row) => row.state === 'pending').sort(byCreated)
  const rest = rows.filter((row) => row.state !== 'pending').sort((a, b) => byCreated(b, a))
  return [...pending, ...rest]
}
