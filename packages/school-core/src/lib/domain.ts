// @ts-nocheck — TODO(ts): tiplenecek (C2)
import { z } from 'zod'
import { dayKey } from './format.ts'

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
export function installmentAmounts(cents, count) {
  if (
    !Number.isSafeInteger(cents) ||
    cents <= 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12
  )
    throw new Error('Taksit tutarı veya sayısı geçersiz.')
  const base = Math.floor(cents / count)
  return Array.from({ length: count }, (_, i) => base + (i < cents % count ? 1 : 0))
}
export function payInvoice(state, invoiceId, method, now = new Date().toISOString()) {
  const invoice = state.invoices.find((i) => i.id === invoiceId)
  if (!invoice) throw new Error('Ödeme kaydı bulunamadı.')
  if (invoice.paidAt) throw new Error('Bu taksit zaten ödenmiş.')
  invoice.paidAt = now
  invoice.method = method
  return invoice
}
export function recordAttendance(state, classId, date, marks) {
  const students = state.students.filter((s) => s.classId === classId && s.isActive)
  if (!Number.isFinite(+new Date(date))) throw new Error('Geçerli bir yoklama tarihi seçin.')
  if (dayKey(date) > dayKey()) throw new Error('Gelecek tarih için yoklama alınamaz.')
  if (!students.length) throw new Error('Bu sınıfta aktif öğrenci bulunmuyor.')
  for (const student of students) {
    if (!['present', 'absent', 'late', 'excused'].includes(marks[student.id]))
      throw new Error('Tüm öğrencilerin yoklama durumunu seçin.')
  }
  for (const student of students) {
    const existing = state.attendance.find(
      (a) => a.studentId === student.id && dayKey(a.date) === dayKey(date),
    )
    if (existing) existing.status = marks[student.id]
    else
      state.attendance.push({
        id: `att-${student.id}-${dayKey(date)}`,
        studentId: student.id,
        classId,
        date,
        status: marks[student.id],
        reason: '',
      })
  }
}
export function gradeQuiz(quiz, bank, answers, allowUnanswered = false) {
  const questions = quiz.questionIds.map((id) => bank.find((q) => q.id === id))
  if (!questions.length || questions.some((q) => !q)) throw new Error('Sınav soruları bulunamadı.')
  if (
    questions.some(
      (q) =>
        !(allowUnanswered && answers[q.id] == null) &&
        (!Number.isInteger(answers[q.id]) ||
          answers[q.id] < 0 ||
          answers[q.id] >= q.options.length),
    )
  )
    throw new Error('Lütfen tüm soruları yanıtlayın.')
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
export function enrollProspect(state, input, makeId, now = new Date().toISOString()) {
  const data = registrationSchema.parse(input)
  const prospect = state.prospects.find((p) => p.id === data.prospectId)
  const cls = state.classes.find((c) => c.id === data.classId && c.isActive)
  if (!prospect || !cls || !state.branches.some((b) => b.id === cls.branchId && b.isActive))
    throw new Error('Aday veya sınıf bulunamadı.')
  if (prospect.studentId || prospect.stage === 'Kayıt oldu')
    throw new Error('Bu adayın kaydı zaten tamamlanmış.')
  if (state.students.filter((s) => s.classId === cls.id && s.isActive).length >= cls.capacity)
    throw new Error('Seçilen sınıfın kontenjanı dolu.')
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
    throw new Error('Geçerli bir ödeme tarihi girin.')
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
