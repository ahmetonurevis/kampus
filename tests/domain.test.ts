import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../apps/web/src/data/seed.js'
import {
  installmentAmounts,
  enrollProspect,
  gradeQuiz,
  payInvoice,
  recordAttendance,
} from '../apps/web/src/lib/domain.js'
import { dayKey } from '../apps/web/src/lib/format.js'
import { isDomainError } from './support/domain-error.ts'

test('Zengin veri kümesinin kimlikleri ve ilişkileri tutarlı', () => {
  const s = createSeed()
  assert.equal(s.students.length, 240)
  assert.equal(s.classes.length, 24)
  assert.equal(s.teachers.length, 48)
  assert.equal(s.prospects.length, 30)
  assert.ok(s.bank.length >= 50)
  assert.equal(new Set(s.bank.map((q) => q.text)).size, s.bank.length)
  assert.equal(s.quizAttempts.length, s.students.length * 3)
  for (const attempt of s.quizAttempts)
    assert.equal(
      gradeQuiz(
        s.quizzes.find((q) => q.id === attempt.quizId)!,
        s.bank,
        attempt.answers,
      ).score,
      attempt.score,
    )
  assert.equal(s.videos.filter((v) => v.src).length, 2)
  for (const student of s.students) {
    assert.ok(s.classes.some((c) => c.id === student.classId))
    assert.equal(s.invoices.filter((i) => i.studentId === student.id).length, 8)
    assert.ok(
      new Set(s.grades.filter((g) => g.studentId === student.id).map((g) => g.date!.slice(0, 7)))
        .size >= 4,
    )
    assert.ok(s.attendance.filter((a) => a.studentId === student.id).length >= 20)
  }
  for (const cls of s.classes) assert.ok(s.teachers.some((t) => t.id === cls.teacherId))
  for (const q of s.questions) {
    const cls = s.students.find((student) => student.id === q.studentId)!.classId
    assert.equal(
      q.teacherId,
      s.assignments.find((a) => a.classId === cls && a.subjectId === q.subjectId)!.teacherId,
    )
  }
  for (const quiz of s.quizzes)
    assert.ok(quiz.questionIds.every((id) => s.bank.some((q) => q.id === id)))
  for (const entries of Object.values(s).filter(Array.isArray))
    if (entries[0]?.id) assert.equal(new Set(entries.map((e) => e.id)).size, entries.length)
})
test('Taksit dağılımı kuruş kaybetmez ve tutarları dengeler', () => {
  for (const cents of [10001, 2850001, 3000000])
    for (const count of [1, 3, 6, 12]) {
      const amounts = installmentAmounts(cents, count)
      assert.equal(
        amounts.reduce((a, b) => a + b),
        cents,
      )
      assert.ok(Math.max(...amounts) - Math.min(...amounts) <= 1)
    }
  assert.throws(() => installmentAmounts(10.5, 3))
  assert.throws(() => installmentAmounts(1000, 0))
})
test('Ödeme bir defa yapılabilir; mükerrer işlem veri değiştirmez', () => {
  const s = createSeed(),
    invoice = s.invoices.find((i) => !i.paidAt)
  payInvoice(s, invoice!.id, 'Demo Sanal POS', '2026-09-26T12:00:00.000Z')
  const snapshot = JSON.stringify(invoice)
  assert.throws(() => payInvoice(s, invoice!.id, 'Nakit'), /zaten ödenmiş/)
  assert.equal(JSON.stringify(invoice), snapshot)
  assert.throws(() => payInvoice(s, 'missing', 'Nakit'), /bulunamadı/)
})
test('Kesin kayıt tüm ilişkileri ve sözleşme toplamını birlikte oluşturur', () => {
  const s = createSeed()
  let n = 0
  const result = enrollProspect(
    s,
    { prospectId: 'pr1', classId: 'c1', total: 28501, count: 6, startDate: '2026-01-31' },
    (p) => `${p}-test-${n++}`,
  )
  assert.equal(s.students.length, 241)
  assert.equal(s.prospects[0]!.studentId, result.student.id)
  assert.equal(s.prospects[0]!.stage, 'Kayıt oldu')
  const invoices = s.invoices.filter((i) => i.studentId === result.student.id)
  assert.equal(invoices.length, 6)
  assert.equal(
    invoices.reduce((a, b) => a + b.amount, 0),
    result.contract.amount,
  )
  assert.equal(invoices[1]!.dueDate.slice(0, 10), '2026-02-28')
  assert.equal(invoices[2]!.dueDate.slice(0, 10), '2026-03-31')
  assert.throws(
    () =>
      enrollProspect(
        s,
        { prospectId: 'pr1', classId: 'c1', total: 10000, count: 2, startDate: '2026-01-01' },
        (p) => p,
      ),
    /zaten/,
  )
})
test('Dolu sınıfa veya geçersiz tarihle kayıt kısmi veri oluşturmaz', () => {
  const s = createSeed()
  s.classes[0]!.capacity = 4
  const snapshot = JSON.stringify(s)
  assert.throws(
    () =>
      enrollProspect(
        s,
        { prospectId: 'pr1', classId: 'c1', total: 10000, count: 2, startDate: '2026-01-01' },
        (p) => p,
      ),
    /kontenjanı dolu/,
  )
  assert.equal(JSON.stringify(s), snapshot)
  s.classes[0]!.capacity = 24
  const snapshot2 = JSON.stringify(s)
  assert.throws(
    () =>
      enrollProspect(
        s,
        { prospectId: 'pr1', classId: 'c1', total: 10000, count: 2, startDate: '2026-02-31' },
        (p) => p,
      ),
    /Geçerli bir ödeme/,
  )
  assert.equal(JSON.stringify(s), snapshot2)
})
test('Yoklama aynı gün tekrar kaydedilince mevcut kaydı günceller', () => {
  const s = createSeed(),
    date = new Date().toISOString(),
    students = s.students.filter((st) => st.classId === 'c1')
  const marks = Object.fromEntries(students.map((st) => [st.id, 'present']))
  const before = s.attendance.length
  recordAttendance(s, 'c1', date, marks)
  assert.equal(s.attendance.length, before + students.length)
  marks.s1 = 'absent'
  recordAttendance(s, 'c1', date, marks)
  assert.equal(s.attendance.length, before + students.length)
  assert.equal(
    s.attendance.find((a) => a.studentId === 's1' && dayKey(a.date) === dayKey(date))!.status,
    'absent',
  )
})
test('Eksik veya ileri tarihli yoklama kaydı eklenmez', () => {
  const s = createSeed(),
    count = s.attendance.length
  assert.throws(
    () => recordAttendance(s, 'c1', new Date().toISOString(), { s1: 'present' }),
    /Tüm öğrencilerin/,
  )
  assert.throws(
    () => recordAttendance(s, 'c1', new Date(Date.now() + 86400000).toISOString(), {}),
    /Gelecek/,
  )
  assert.equal(s.attendance.length, count)
})
test('Quiz skoru cevaplardan ve konu dağılımından hesaplanır', () => {
  const s = createSeed(),
    quiz = s.quizzes[0]
  const answers = Object.fromEntries(
    quiz!.questionIds.map((id) => [id, s.bank.find((q) => q.id === id)!.answer]),
  )
  assert.equal(gradeQuiz(quiz!, s.bank, answers).score, 100)
  assert.ok(gradeQuiz(quiz!, s.bank, answers).topicScores.every((t) => t.score === 100))
  const first = quiz!.questionIds[0]
  answers[first!] = (answers[first!]! + 1) % 4
  assert.equal(gradeQuiz(quiz!, s.bank, answers).score, 90)
  delete answers[first!]
  assert.throws(() => gradeQuiz(quiz!, s.bank, answers), /tüm soruları/)
})

test('Domain işlemleri DomainError, kod ve tür ile reddeder', () => {
  const s = createSeed()
  assert.throws(() => installmentAmounts(10.5, 3), isDomainError('invalid_installment'))
  assert.throws(
    () => payInvoice(s, 'missing', 'Nakit'),
    isDomainError('invoice_not_found', 'not_found'),
  )
  const invoice = s.invoices.find((i) => !i.paidAt)
  payInvoice(s, invoice!.id, 'Nakit', '2026-09-26T12:00:00.000Z')
  assert.throws(
    () => payInvoice(s, invoice!.id, 'Nakit'),
    isDomainError('invoice_already_paid', 'conflict'),
  )
})
