// API satırlarının görünüm metinleri (demo `model/school.ts` `rowsFor` ile aynı biçim).
// Rol kapsamı sunucuda uygulanır; rolün göremediği alanlar satırda bulunmayabilir.
import type { HomeworkListItem, HomeworkSubmission } from '@kampus/react-shared/homework.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { average, dateLabel, homeworkStatus } from '@kampus/school-core/lib/format.ts'
import { subjectAverages, withSubjectNames } from '@kampus/school-core/lib/grades.ts'
import { acceptsLate, isHomeworkClosed } from '@kampus/school-core/lib/homework.ts'

type ClassRecord = Partial<State['classes'][number]>
type GradeRecord = Partial<State['grades'][number]>

/** Kampüs · düzey · derslik; eksik parça atlanır. */
export function classSubtitle(record: ClassRecord, branchName: string | undefined): string {
  return [branchName, record.level, record.room ? `Derslik ${record.room}` : undefined]
    .filter(Boolean)
    .join(' · ')
}

/** Notun başarı eşiği demo ekranıyla aynıdır (70). */
export const PASSING_SCORE = 70

export function gradeView(record: GradeRecord) {
  const score = typeof record.score === 'number' ? record.score : null
  return {
    title: record.title ?? record.subject ?? 'Değerlendirme',
    subtitle: [record.date ? dateLabel(record.date) : undefined, record.topic]
      .filter(Boolean)
      .join(' · '),
    score: score === null ? '—' : `${score} / 100`,
    status: score === null ? '' : score >= PASSING_SCORE ? 'Başarılı' : 'Tekrar önerilir',
  }
}

const scoreLabel = (score: number) => `${score} / 100`

export type SubjectSummary = { subjectId: string; name: string; average: string; count: number }
export type GradeSummary = { overall: string; count: number; subjects: SubjectSummary[] }

/**
 * Öğrencinin not özeti: genel ortalama bütün notların ortalamasıdır (ders ortalamalarının değil),
 * ders ortalamaları core `subjectAverages` ile hesaplanır; ikisi de saklanmaz, kayıtlardan türetilir.
 * Ders adı güncel ders kaydından gelir (`withSubjectNames`, web ile aynı). Puanı ya da dersi olmayan
 * kayıt (kapsamın gizlediği alan) hesaba girmez.
 *
 * Kısıt: core `average` web'deki gibi tam sayıya yuvarlar; lisede dört ondalık isteyen
 * DOM-AKD-003 ile çelişir (kural belgesinde "Kodda: çelişiyor"), düzeltme core'da yapılır.
 */
export function gradeSummary(
  records: readonly GradeRecord[],
  subjects: ReadonlyMap<string, { name: string }> = new Map(),
): GradeSummary {
  const scored = records.flatMap((record) =>
    typeof record.score === 'number' && record.subjectId
      ? [{ subjectId: record.subjectId, subject: record.subject ?? 'Ders', score: record.score }]
      : [],
  )
  return {
    overall: scored.length ? scoreLabel(average(scored.map((grade) => grade.score))) : '—',
    count: scored.length,
    subjects: withSubjectNames(subjectAverages(scored), subjects).map((item) => ({
      subjectId: item.subjectId,
      name: item.name,
      average: scoreLabel(item.average),
      count: item.count,
    })),
  }
}

/** Ödev listesi ve tek kayıt ucunun (`/homework`) ortak alanları. */
type HomeworkFields = Pick<HomeworkListItem, 'id' | 'title' | 'subject' | 'dueDate'>
/**
 * Teslimin durum için gereken alanları (api-client tipinden). Genel `/collections/submissions`
 * okumasında eski kayıt `late` ve `score` taşımayabilir; ikisi bu yüzden isteğe bağlıdır.
 */
export type SubmissionFields = Pick<HomeworkSubmission, 'homeworkId' | 'studentId'> &
  Partial<Pick<HomeworkSubmission, 'score' | 'late'>>

/** Öğrencinin ödev durumu etiketleri (core `homeworkStatus` çıktısı). */
export type HomeworkStatus = ReturnType<typeof homeworkStatus>

/** Son teslim ve teslim zamanı: gün, ay, yıl ve saat (Europe/Istanbul). */
export const dueText = (value: string | null | undefined) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })

export type HomeworkView = {
  id: string
  title: string
  subject: string
  subtitle: string
  status: HomeworkStatus
  late: boolean
  score: string | null
}

/**
 * Öğrencinin ödev satırı: durum core `homeworkStatus` ile teslim kaydından ve son tarihten
 * hesaplanır, saklanmaz (DOM-AKD-072). Puan yalnız değerlendirilmiş teslimde görünür.
 */
export function homeworkView(
  homework: HomeworkFields,
  submissions: readonly SubmissionFields[],
  studentId: string,
  now: Date,
): HomeworkView {
  const submission = submissions.find(
    (entry) => entry.homeworkId === homework.id && entry.studentId === studentId,
  )
  const score = typeof submission?.score === 'number' ? submission.score : null
  return {
    id: homework.id,
    title: homework.title,
    subject: homework.subject,
    subtitle: `${homework.subject} · Son teslim ${dateLabel(homework.dueDate, { year: 'numeric' })}`,
    status: homeworkStatus(homework, submissions, studentId, now),
    late: submission?.late === true,
    score: score === null ? null : scoreLabel(score),
  }
}

/** İstemci araması: ödev başlığı ve ders adı, Türkçe büyük/küçük harf duyarsız. */
export function matchesSearch(fields: readonly string[], search: string): boolean {
  const query = search.trim().toLocaleLowerCase('tr')
  if (!query) return true
  return fields.some((field) => field.toLocaleLowerCase('tr').includes(query))
}

/**
 * Telefondaki teslim bilgisi: teslim yazma web'dedir. Ödev hâlâ teslim alıyorsa (son tarih
 * gelmedi ya da geç teslim kabul ediliyor) web'e yönlendirilir; kapalı ve geç teslime kapalı
 * ödevde süre doldu bilgisi verilir; değerlendirilmiş teslimde bilgi yoktur (değiştirilemez).
 * Karar core `isHomeworkClosed`/`acceptsLate` ile verilir; kesin ret yine sunucudadır.
 */
export function submissionHint(
  homework: Pick<HomeworkListItem, 'dueDate' | 'allowLate'>,
  status: HomeworkStatus,
  now: Date,
): 'web' | 'closed' | null {
  if (status === 'Değerlendirildi') return null
  if (isHomeworkClosed(homework, now.toISOString()) && !acceptsLate(homework)) return 'closed'
  return 'web'
}

/** Teslim dosyası özeti: tek dosyada adı, birden çok dosyada sayısı. */
export function fileSummary(
  submission: { fileIds: readonly string[]; fileName: string } | undefined,
): string {
  if (!submission) return '—'
  if (submission.fileIds.length > 1) return `${submission.fileIds.length} dosya`
  if (submission.fileName) return submission.fileName
  return submission.fileIds.length ? '1 dosya' : '—'
}

/** Öğrenci kendi ödevlerini, veli seçili çocuğun ödevlerini görür; ikisi de salt okunurdur. */
export type HomeworkAudience = 'student' | 'parent'

/**
 * Ödev ekranının kitleye göre farkları: teslim yönlendirmesi yalnız öğrencidir (veli teslim
 * yapamaz, yalnız durumu görür); teslim bölümü başlığı da kitleye göredir.
 */
export function homeworkAudienceView(
  audience: HomeworkAudience,
  homework: Pick<HomeworkListItem, 'dueDate' | 'allowLate'>,
  status: HomeworkStatus,
  now: Date,
) {
  const student = audience === 'student'
  return {
    hint: student ? submissionHint(homework, status, now) : null,
    submissionTitle: student ? 'Teslimin' : 'Teslim açıklaması',
  }
}

/** Ödev listesi boşken gösterilen metin. */
export const homeworkEmptyText = (audience: HomeworkAudience) =>
  audience === 'student'
    ? 'Öğretmenlerin ödev verdiğinde burada görünür.'
    : 'Öğretmenler ödev verdiğinde burada görünür.'
