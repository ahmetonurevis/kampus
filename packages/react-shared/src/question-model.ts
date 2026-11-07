// Öğretmenime Sor (öğrenci ve öğretmen) ortak saf modeli: satır hesapları, ders/öğretmen seçenekleri
// ve soru gövdesi. Web (`pages/learning/question-rows.ts`, `question-forms.ts`) ve mobil
// (`apps/mobile/src/api/student-question.ts`) aynı işlevleri kullanır. Saf işlevlerdir: API satırı
// girer, satır çıkar. Durum ve yanıt süresi saklanmaz; core `questionStatus` ve `questionResponse`
// ile her okumada hesaplanır (DOM-ILT-013, DOM-ILT-093). Kuralın kendisi core'dadır
// (`lib/questions.ts`); burası kullanıcıya kapsam dışı seçenek göstermemek ve sunucuya gereksiz
// istek atmamak içindir. Karar yine sunucudadır (DOM-ILT-090).
import type { State } from '@kampus/school-core/data/seed.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  QUESTION_ANSWER_LIMIT,
  QUESTION_STATUS_LABELS,
  questionResponse,
  questionStatus,
  type AskQuestionInput,
  type QuestionStatus,
} from '@kampus/school-core/lib/questions.ts'

import type { CollectionRow } from './collections.ts'

type QuestionItem = CollectionRow<State['questions'][number]>
type AssignmentItem = CollectionRow<State['assignments'][number]>
type TeacherItem = CollectionRow<State['teachers'][number]>
type SubjectItem = CollectionRow<State['subjects'][number]>

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
  /** Soruya bağlı fotoğrafların dosya kimlikleri (DOM-ILT-094). */
  fileIds: readonly string[]
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
  item: QuestionItem,
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
    // Ad satıra sunucuda bağlıdır (`joined.teacherName`, arşivli öğretmen dahil); kadro listesi
    // yalnız sunucu adı vermediğinde (eski önbellek, tek kayıt) yedektir.
    teacher: item.joined?.teacherName ?? lookups.teachers.get(record.teacherId) ?? '—',
    subjectId: record.subjectId,
    subject: lookups.subjects.get(record.subjectId) ?? '—',
    topic: record.topic ?? '',
    title: record.title,
    text: record.text,
    fileIds: record.fileIds ?? [],
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

// --- Soru formu: seçenekler ve gövde ---

export type AskTeacher = { id: string; name: string }

/** Bir ders: kazanımları ve o dersi sınıfta veren aktif öğretmenler. */
export type AskOption = {
  subjectId: string
  subject: string
  topics: readonly string[]
  teachers: readonly AskTeacher[]
}

/** Sunucunun daralttığı kayıtlardan ders seçenekleri; öğretmeni olmayan ders sunulmaz. */
export function askOptions(
  assignments: readonly AssignmentItem[],
  teachers: readonly TeacherItem[],
  subjects: readonly SubjectItem[],
): AskOption[] {
  const active = new Map(
    teachers
      .filter(({ record }) => record.isActive !== false && !record.deletedAt)
      .map(({ record }) => [record.id, record.name]),
  )
  const options: AskOption[] = []
  for (const { record: subject } of subjects) {
    const ids = [
      ...new Set(
        assignments
          .filter(({ record }) => record.subjectId === subject.id)
          .map(({ record }) => record.teacherId),
      ),
    ]
    const people = ids.flatMap((id): AskTeacher[] => {
      const name = active.get(id)
      return name === undefined ? [] : [{ id, name }]
    })
    if (people.length > 0)
      options.push({
        subjectId: subject.id,
        subject: subject.name,
        topics: subject.topics,
        teachers: people.sort((a, b) => a.name.localeCompare(b.name, 'tr')),
      })
  }
  return options.sort((a, b) => a.subject.localeCompare(b.subject, 'tr'))
}

export const optionOf = (options: readonly AskOption[], subjectId: string) =>
  options.find((option) => option.subjectId === subjectId)

/**
 * Formdaki öğretmen değeri: seçilen öğretmen dersin öğretmenlerindense o, dersin tek öğretmeni
 * varsa o (seçim gerekmez), aksi hâlde boş (öğrenci seçer).
 */
export function teacherChoice(option: AskOption | undefined, selected: string): string {
  if (!option) return ''
  if (option.teachers.some((teacher) => teacher.id === selected)) return selected
  return option.teachers.length === 1 ? (option.teachers[0]?.id ?? '') : ''
}

/** Soru formunun değerleri; fotoğraflar yalnız kimlikle gelir (telefonda fotoğraf yoktur). */
export type AskValues = {
  subjectId: string
  teacherId: string
  topic: string
  title: string
  text: string
  files?: readonly { id: string }[]
}

export type AskOutcome =
  | { ok: true; body: AskQuestionInput }
  | { ok: false; field: 'subjectId' | 'teacherId' | 'topic'; message: string }

/**
 * Gönderilecek gövde: ders ve öğretmen seçeneklerdeki bir değer olmalı (kapsam dışı değer istek
 * atmadan reddedilir), kazanım yalnız dersin listesinden, boşsa gönderilmez. Mesajlar sunucuyla
 * aynıdır.
 */
export function askQuestionBody(values: AskValues, options: readonly AskOption[]): AskOutcome {
  const option = optionOf(options, values.subjectId)
  if (!option) return { ok: false, field: 'subjectId', message: 'Bir ders seçin.' }
  const teacherId = teacherChoice(option, values.teacherId)
  if (teacherId === '') return { ok: false, field: 'teacherId', message: 'Öğretmen seçin.' }
  const topic = values.topic.trim()
  const files = values.files ?? []
  if (topic !== '' && !option.topics.includes(topic))
    return { ok: false, field: 'topic', message: 'Kazanım bu derse ait değil.' }
  return {
    ok: true,
    body: {
      subjectId: option.subjectId,
      teacherId,
      ...(topic === '' ? {} : { topic }),
      title: values.title.trim(),
      text: values.text.trim(),
      ...(files.length === 0 ? {} : { fileIds: files.map((file) => file.id) }),
    },
  }
}
