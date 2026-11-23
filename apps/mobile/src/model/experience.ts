import type { State } from '@kampus/school-core/data/seed.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import { context, rowsFor } from './school.ts'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const resolveTheme = (
  preference: ThemePreference,
  system: string | null | undefined,
): ResolvedTheme =>
  preference === 'system'
    ? system === 'dark'
      ? 'dark'
      : 'light'
    : preference === 'dark'
      ? 'dark'
      : 'light'

// Ek örnekler mevcut teslimlere dokunmadan, yalnızca ilk açılışta eklenir.
export function prepareReferenceData(state: State, now = new Date()) {
  let changed = false
  const student = state.students.find((s) => s.id === 's1')
  if (!student) return false
  const deadline = (days: number) => {
    const date = new Date(now)
    date.setUTCDate(date.getUTCDate() + days)
    date.setUTCHours(14, 0, 0, 0)
    return date.toISOString()
  }
  const references: [
    id: string,
    subjectId: string,
    title: string,
    description: string,
    days: number,
  ][] = [
    [
      'hw-mobile-equations',
      'math',
      'Denklemler çalışma kâğıdı',
      'Çalışma kâğıdındaki 1–10. soruları çöz. Çözüm adımlarını göster ve tamamladığında dosyanı yükle.',
      1,
    ],
    [
      'hw-mobile-experiment',
      'science',
      'Deney raporu',
      'Yaptığın deneyin amacını, kullandığın malzemeleri ve gözlemlerini bir raporda topla.',
      3,
    ],
  ]
  for (const [id, subjectId, title, description, days] of references) {
    const assignment = state.assignments.find(
      (a) => a.classId === student.classId && a.subjectId === subjectId,
    )
    if (!assignment || state.homework.some((h) => h.id === id)) continue
    const subject = state.subjects.find((s) => s.id === subjectId)
    if (!subject) throw new Error('Ders kaydı bulunamadı.')
    state.homework.unshift({
      ...assignment,
      id,
      title,
      description,
      subject: subject.name,
      dueDate: deadline(days),
      createdAt: now.toISOString(),
    })
    changed = true
  }
  if (!state.questions.some((q) => q.id === 'ask-mobile-equations')) {
    state.questions.unshift({
      id: 'ask-mobile-equations',
      studentId: student.id,
      teacherId: 't1',
      subjectId: 'math',
      title: 'Denklemler',
      text: 'Denklem çözerken iki taraftan neden aynı sayıyı çıkarıyoruz?',
      createdAt: new Date(+now - 3 * 3600000).toISOString(),
      answer: '',
      answeredAt: null,
      fileName: null,
    })
    changed = true
  }
  return changed
}

export function homeworkRows(state: State, session: Session) {
  const { student } = context(state, session)
  const submissions = new Map(
    state.submissions.filter((s) => s.studentId === student.id).map((s) => [s.homeworkId, s]),
  )
  return rowsFor(state, session, 'odevler')
    .map((row) => ({ ...row, submission: submissions.get(row.id) }))
    .sort((a, b) => a.source.dueDate.localeCompare(b.source.dueDate))
}

export function waitingLabel(
  question: { createdAt: string; answeredAt?: string | null },
  now = Date.now(),
) {
  const minutes = Math.max(0, Math.floor((now - +new Date(question.createdAt)) / 60000))
  if (question.answeredAt) return 'Yanıtlandı'
  if (minutes < 1) return 'Az önce geldi'
  if (minutes < 60) return `${minutes} dakikadır bekliyor`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} saattir bekliyor`
  return `${Math.floor(minutes / 1440)} gündür bekliyor`
}

export function paymentSummary(state: State, session: Session) {
  const rows = rowsFor(state, session, 'finans').sort((a, b) =>
    a.source.dueDate.localeCompare(b.source.dueDate),
  )
  const unpaid = rows.filter((r) => !r.source.paidAt)
  return {
    rows,
    unpaid,
    balance: unpaid.reduce((sum, r) => sum + r.source.amount, 0),
    next: unpaid[0],
  }
}
