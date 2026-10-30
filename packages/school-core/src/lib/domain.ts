import { z } from 'zod'
import type { questionBank } from '../data/question-bank.ts'
import type { State } from '../data/seed.ts'
import type { Role } from '../modules/navigation.ts'
import { dayKey } from './format.ts'
import type { ActorLink } from './scope.ts'
import { DomainError } from './errors.ts'

z.config(z.locales.tr())

export const requiredText = z
  .string()
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(2000, 'En fazla 2000 karakter girebilirsiniz.')
export const prospectSchema = z.object({
  name: requiredText.max(80),
  phone: z.string().regex(/^0\d{10}$/, 'Telefonu 05XXXXXXXXX biçiminde girin.'),
  email: z.email('Geçerli bir e-posta adresi girin.'),
  branchId: requiredText,
  interest: requiredText,
  source: requiredText,
})
export const registrationSchema = z.object({
  prospectId: requiredText,
  classId: requiredText,
  total: z.coerce
    .number()
    .int('Tutar tam sayı olmalıdır.')
    .min(100, 'Tutar en az 100 ₺ olmalıdır.')
    .max(1000000, 'Tutar en fazla 1.000.000 ₺ olabilir.'),
  count: z.coerce.number().int().min(1).max(12),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'İlk ödeme tarihini seçin.'),
})
export type MakeId = (prefix: string) => string
// Oturum: rol ve velinin seçili çocuğu. API oturumu üyelik bağlantılarını (`links`) da taşır;
// çevrimdışı demoda bağlantılar sabit demo kimliklerinden türetilir (`lib/scope.ts`).
export type Session = { role: Role; childId?: string; links?: readonly ActorLink[] }
export type BankQuestion = (typeof questionBank)[number]

export function installmentAmounts(cents: number, count: number) {
  if (
    !Number.isSafeInteger(cents) ||
    cents <= 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12
  )
    throw new DomainError('invalid_installment', 'Taksit tutarı veya sayısı geçersiz.')
  const base = Math.floor(cents / count)
  return Array.from({ length: count }, (_, i) => base + (i < cents % count ? 1 : 0))
}
export function payInvoice(
  state: State,
  invoiceId: string,
  method: string,
  now = new Date().toISOString(),
) {
  const invoice = state.invoices.find((i) => i.id === invoiceId)
  if (!invoice)
    throw new DomainError('invoice_not_found', 'Ödeme kaydı bulunamadı.', { kind: 'not_found' })
  if (invoice.paidAt)
    throw new DomainError('invoice_already_paid', 'Bu taksit zaten ödenmiş.', { kind: 'conflict' })
  invoice.paidAt = now
  invoice.method = method
  return invoice
}
const ATTENDANCE_STATUSES: readonly string[] = ['present', 'absent', 'late', 'excused']
export function recordAttendance(
  state: State,
  classId: string,
  date: string,
  marks: Readonly<Record<string, string>>,
) {
  const students = state.students.filter((s) => s.classId === classId && s.isActive)
  if (!Number.isFinite(+new Date(date)))
    throw new DomainError('invalid_attendance_date', 'Geçerli bir yoklama tarihi seçin.')
  if (dayKey(date) > dayKey())
    throw new DomainError('attendance_future_date', 'Gelecek tarih için yoklama alınamaz.')
  if (!students.length)
    throw new DomainError('class_has_no_active_students', 'Bu sınıfta aktif öğrenci bulunmuyor.')
  // Önce tüm işaretler doğrulanır; geçersiz işaret varsa hiçbir kayıt değişmez.
  const marked = students.map((student) => {
    const status = marks[student.id]
    if (status === undefined || !ATTENDANCE_STATUSES.includes(status))
      throw new DomainError('attendance_incomplete', 'Tüm öğrencilerin yoklama durumunu seçin.')
    return { student, status }
  })
  for (const { student, status } of marked) {
    const existing = state.attendance.find(
      (a) => a.studentId === student.id && dayKey(a.date) === dayKey(date),
    )
    if (existing) existing.status = status
    else
      state.attendance.push({
        id: `att-${student.id}-${dayKey(date)}`,
        studentId: student.id,
        classId,
        date,
        status,
        reason: '',
      })
  }
}
// Parametreler yapısal tiplidir; örnek veri üreticisi de bu fonksiyonu çağırdığından State'e bağlanmaz.
export function gradeQuiz(
  quiz: { questionIds: readonly string[] },
  bank: readonly BankQuestion[],
  answers: Readonly<Record<string, number | null | undefined>>,
  allowUnanswered = false,
) {
  const found = quiz.questionIds.map((id) => bank.find((q) => q.id === id))
  const questions = found.filter((q) => q !== undefined)
  if (!found.length || questions.length !== found.length)
    throw new DomainError('quiz_questions_not_found', 'Sınav soruları bulunamadı.', {
      kind: 'not_found',
    })
  if (
    questions.some((q) => {
      const answer = answers[q.id]
      return (
        !(allowUnanswered && answer == null) &&
        (typeof answer !== 'number' ||
          !Number.isInteger(answer) ||
          answer < 0 ||
          answer >= q.options.length)
      )
    })
  )
    throw new DomainError('quiz_unanswered', 'Lütfen tüm soruları yanıtlayın.')
  const correct = questions.filter((q) => answers[q.id] === q.answer).length
  const topicScores = [...new Set(questions.map((q) => q.topic))].map((topic) => {
    const subset = questions.filter((q) => q.topic === topic)
    return {
      topic,
      score: Math.round(
        (subset.filter((q) => answers[q.id] === q.answer).length / subset.length) * 100,
      ),
    }
  })
  return {
    correct,
    total: questions.length,
    score: Math.round((correct / questions.length) * 100),
    topicScores,
  }
}
export function enrollProspect(
  state: State,
  input: unknown,
  makeId: MakeId,
  now = new Date().toISOString(),
) {
  const data = registrationSchema.parse(input)
  const prospect = state.prospects.find((p) => p.id === data.prospectId)
  const cls = state.classes.find((c) => c.id === data.classId && c.isActive)
  if (!prospect || !cls || !state.branches.some((b) => b.id === cls.branchId && b.isActive))
    throw new DomainError('prospect_or_class_not_found', 'Aday veya sınıf bulunamadı.', {
      kind: 'not_found',
    })
  if (prospect.studentId || prospect.stage === 'Kayıt oldu')
    throw new DomainError('prospect_already_enrolled', 'Bu adayın kaydı zaten tamamlanmış.', {
      kind: 'conflict',
    })
  if (state.students.filter((s) => s.classId === cls.id && s.isActive).length >= cls.capacity)
    throw new DomainError('class_capacity_full', 'Seçilen sınıfın kontenjanı dolu.')
  const student = {
    id: makeId('s'),
    name: prospect.name,
    classId: cls.id,
    parentId: makeId('p'),
    email: prospect.email,
    phone: prospect.phone,
    joinedAt: now,
    isActive: true,
    progress: 0,
  }
  const amounts = installmentAmounts(data.total * 100, data.count)
  const start = new Date(`${data.startDate}T09:00:00.000Z`)
  if (Number.isNaN(+start) || dayKey(start) !== data.startDate)
    throw new DomainError('invalid_payment_date', 'Geçerli bir ödeme tarihi girin.')
  const invoices = amounts.map((amount, i) => {
    const lastDay = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i + 1, 0),
    ).getUTCDate()
    const due = new Date(
      Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth() + i,
        Math.min(start.getUTCDate(), lastDay),
        9,
      ),
    )
    return {
      id: makeId('inv'),
      studentId: student.id,
      installment: i + 1,
      amount,
      dueDate: due.toISOString(),
      paidAt: null,
      method: null,
      reminderAt: null,
    }
  })
  state.parents.push({
    id: student.parentId,
    name: `${student.name} velisi`,
    studentIds: [student.id],
  })
  state.students.push(student)
  state.invoices.push(...invoices)
  const contract = {
    id: makeId('contract'),
    studentId: student.id,
    date: now,
    amount: data.total * 100,
    title: 'Özel okul eğitim sözleşmesi',
  }
  state.contracts.push(contract)
  prospect.studentId = student.id
  prospect.stage = 'Kayıt oldu'
  return { student, contract }
}
