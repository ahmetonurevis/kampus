// Optik ve etüt CSV'lerinin saf üretimi. Biçim (`;` ayırıcı, CRLF, formül kaçışı) ortak
// `csvCell`/`toCsv` yardımcılarındandır; burada yalnız sütunlar ve satır eşlemesi bulunur.
// Satırlar ekranda görünen kapsamdan gelir (rol kapsamı ve tablo süzgeçleri çağıranda uygulanır).
import { keyHeader } from '@kampus/school-core/lib/assessment-automation.ts'
import { CSV_SEPARATOR, csvCell } from '../../lib/csv.ts'
import type { ListColumn } from '../../lib/list-view.ts'
import type { EvaluationRow, Profile } from './optical-model.ts'
import type { PlanView, TutorRow } from './tutoring-model.ts'

/** Kayıtlı optik değerlendirmeler (sonuç CSV'si); Vue `optik-sonuclar` ile aynı sütunlar. */
export const RESULT_CSV_COLUMNS: readonly ListColumn[] = [
  { key: 'student', label: 'Öğrenci' },
  { key: 'exam', label: 'Deneme' },
  { key: 'subject', label: 'Ders' },
  { key: 'booklet', label: 'Kitapçık' },
  { key: 'correct', label: 'Doğru' },
  { key: 'wrong', label: 'Yanlış' },
  { key: 'blank', label: 'Boş' },
  { key: 'multiple', label: 'Çoklu işaret' },
  { key: 'cancelled', label: 'İptal soru' },
  { key: 'net', label: 'Net' },
  { key: 'status', label: 'Durum' },
  { key: 'reason', label: 'Açıklama' },
]

export function resultCsvRows(rows: readonly EvaluationRow[]) {
  return rows.map((row) => ({
    ...row,
    status: row.current ? 'Güncel' : 'Eski analiz',
    reason: row.staleReason,
  }))
}

// Anahtar sütunları içe aktarma başlığıyla aynıdır (`booklet;question;subjectId;topic;answer`):
// şablonu indirip doldurup profil formuna yüklemek çalışır.
const KEY_ANSWER = /^[A-E-]$/

/**
 * Profilin cevap anahtarı, içe aktarmayla aynı biçimde. Başlık ham alan adlarıdır. Cevap
 * hücresi sistem değeridir (`A–E` ya da iptal soru için `-`): `-` formül kaçışı alsa içe
 * aktarma "geçersiz cevap" derdi, bu yüzden yalnız bu desene uyan cevap kaçışsız yazılır.
 * Kazanım metni kullanıcı verisidir ve kaçış alır.
 */
export function answerKeyCsv(profile: Pick<Profile, 'keys'>): string {
  const rows = profile.keys.flatMap((key) =>
    key.questions.map((question) =>
      [
        csvCell(key.booklet),
        csvCell(question.number),
        csvCell(question.subjectId),
        csvCell(question.topic),
        KEY_ANSWER.test(question.answer) ? `"${question.answer}"` : csvCell(question.answer),
      ].join(CSV_SEPARATOR),
    ),
  )
  return [keyHeader.map((name) => csvCell(name)).join(CSV_SEPARATOR), ...rows].join('\r\n')
}

/** Etüt listesi (Vue `etut-plani`); kampüs ve öğrenci adları dahil. */
export const TUTOR_CSV_COLUMNS: readonly ListColumn[] = [
  { key: 'title', label: 'Etüt / Kazanım' },
  { key: 'teacher', label: 'Öğretmen' },
  { key: 'campus', label: 'Kampüs' },
  { key: 'when', label: 'Tarih' },
  { key: 'room', label: 'Derslik' },
  { key: 'studentNames', label: 'Öğrenciler' },
  { key: 'status', label: 'Durum' },
]

export function tutorCsvRows(rows: readonly TutorRow[]) {
  return rows.map((row) => ({
    ...row,
    studentNames: row.students.map((student) => student.name).join(', '),
  }))
}

/** Plan önizlemesi (Vue `etut-onizleme`): planlanabilir etütler ve yerleşemeyen gruplar. */
export const PLAN_CSV_COLUMNS: readonly ListColumn[] = [
  { key: 'title', label: 'Etüt / Kazanım' },
  { key: 'teacher', label: 'Öğretmen' },
  { key: 'campus', label: 'Kampüs' },
  { key: 'when', label: 'Tarih' },
  { key: 'room', label: 'Derslik' },
  { key: 'students', label: 'Öğrenciler' },
  { key: 'status', label: 'Durum' },
  { key: 'reason', label: 'Açıklama' },
]

export function planCsvRows(view: Pick<PlanView, 'sessions' | 'unresolved'>) {
  return [
    ...view.sessions.map((row) => ({
      title: row.title,
      teacher: row.teacher,
      campus: row.campus,
      when: row.when,
      room: row.room,
      students: row.students,
      status: row.full ? 'Planlanabilir (dolu)' : 'Planlanabilir',
      reason: '',
    })),
    ...view.unresolved.map((row) => ({
      title: row.title,
      teacher: '—',
      campus: row.campus,
      when: '—',
      room: '—',
      students: row.students,
      status: 'Yerleştirilemedi',
      reason: row.reason,
    })),
  ]
}
