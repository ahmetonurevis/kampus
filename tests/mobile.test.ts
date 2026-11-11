import test from 'node:test'
import assert from 'node:assert/strict'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'
import type { Session } from '../packages/school-core/src/lib/domain.ts'
import type { State } from '../packages/school-core/src/data/seed.ts'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { gradeQuiz } from '../packages/school-core/src/lib/domain.ts'
import {
  createSnapshotWriter,
  restoreSnapshot,
} from '../packages/school-core/src/lib/demo-persistence.ts'
import { availablePages, rowsFor, navigation, clone } from '../apps/mobile/src/model/school.ts'
import {
  operation,
  normalizeFields,
  type FormValues,
  type OperationKind,
  type OperationRecord,
} from '../apps/mobile/src/model/operations.ts'
import { workflowPage } from '../packages/school-core/src/modules/school-workflows.ts'
import { workflowRows } from '../packages/school-core/src/lib/workflow-presentation.ts'
const session = (role: Role): Session => ({ role, childId: 's1' })
let sequence = 0
const id = (prefix: string) => `${prefix}-mobile-test-${++sequence}`
function perform(
  state: State,
  role: Role,
  kind: OperationKind,
  values: FormValues,
  record: OperationRecord | null = null,
) {
  const form = operation(state, session(role), kind, record)
  const input = { ...form.initial, ...values }
  normalizeFields(form.fields(input), input)
  const next = clone(state)
  form.run(next, input, id)
  return next
}

test('Mobil: beş rolün listeleri doludur, çocuk ve öğretmen kapsamları birbirine karışmaz', () => {
  const state = createSeed(),
    special = new Set([
      'dashboard',
      'ayarlar',
      'yoklama',
      'kayit-islemleri',
      'sinif-analizi',
      'cocuk-secici',
      'akademik-takip',
      'sinav-analizi',
      'seviye-takibi',
      'devamsizlik-bildirimi',
    ])
  for (const role of Object.keys(navigation) as Role[])
    for (const page of navigation[role]) {
      // İş akışı sayfaları yetkisiz rolde veya boş örnek veride de hatasız açılır;
      // optik ve etüt ekranları kendi veri kaynaklarını (profil, uygunluk, etüt) kullanır.
      if (workflowPage(page.path)) {
        assert.ok(Array.isArray(workflowRows(state, session(role), page.path)))
      } else if (!special.has(page.path))
        assert.ok(
          rowsFor(state, session(role), page.path).length > 0,
          `${role}/${page.path} dolu olmalı`,
        )
    }
  assert.ok(rowsFor(state, session('veli'), 'finans').every((row) => row.source.studentId === 's1'))
  assert.ok(
    rowsFor(state, { ...session('veli'), childId: 's2' }, 'finans').every(
      (row) => row.source.studentId === 's2',
    ),
  )
  assert.ok(
    rowsFor(state, session('ogretmen'), 'sorular').every((row) => row.source.teacherId === 't1'),
  )
  state.modules.finance = false
  assert.ok(!availablePages(state, 'veli').some((page) => page.module === 'finance'))
})
test('Mobil: veli ödemesi tekrarlanmaz, başka çocuğun taksitine uygulanmaz ve kalıcı kayıttan geri döner', () => {
  const state = createSeed(),
    invoice = state.invoices.find((i) => i.studentId === 's1' && !i.paidAt)
  const next = perform(state, 'veli', 'collect', { method: 'Kredi kartı (demo)' }, invoice)
  assert.ok(next.invoices.find((i) => i.id === invoice!.id)!.paidAt)
  assert.throws(() => perform(next, 'veli', 'collect', {}, invoice), /zaten ödenmiş/)
  assert.throws(
    () =>
      perform(
        state,
        'veli',
        'collect',
        {},
        state.invoices.find((i) => i.studentId === 's2' && !i.paidAt),
      ),
    /çocuğunuza/,
  )
  assert.throws(() => operation(state, session('ogrenci'), 'collect', invoice), /rol/)
  const restored = restoreSnapshot(createSnapshotWriter(state)(next))
  assert.equal(
    restored.invoices.find((i) => i.id === invoice!.id)!.paidAt,
    next.invoices.find((i) => i.id === invoice!.id)!.paidAt,
  )
})
test('Mobil: soru/yanıt, yeni kayıt, ödev teslimi ve not aynı veri modeline yazılır', () => {
  const seed = createSeed()
  let state = perform(seed, 'ogrenci', 'question', {
    teacherId: 't1',
    title: 'Denklem sorusu',
    text: 'İkinci adımı açıklar mısınız?',
  })
  const question = state.questions[0]
  state = perform(
    state,
    'ogretmen',
    'answer',
    { answer: 'Her iki taraftan aynı sayıyı çıkarırız.' },
    question,
  )
  assert.equal(
    rowsFor(state, session('ogrenci'), 'soru-sor').find((i) => i.id === question!.id)!.status,
    'Yanıtlandı',
  )
  state = perform(state, 'onburo', 'registration', {
    prospectId: 'pr1',
    classId: 'c1',
    total: '240001',
    count: '7',
    startDate: '2026-10-01',
  })
  const newStudent = state.students.at(-1)
  assert.equal(
    state.invoices
      .filter((i) => i.studentId === newStudent!.id)
      .reduce((sum, i) => sum + i.amount, 0),
    24000100,
  )
  const homework = state.homework.find(
    (h) =>
      h.classId === 'c1' &&
      h.teacherId === 't1' &&
      !state.submissions.some((s) => s.homeworkId === h.id && s.studentId === 's1'),
  )
  state = perform(
    state,
    'ogrenci',
    'submit',
    { file: { name: 'cozum.pdf', uri: 'file:///cozum.pdf', size: 1234 } },
    homework,
  )
  const submission = state.submissions.at(-1)
  state = perform(
    state,
    'ogretmen',
    'grade',
    { score: '92', feedback: 'Çözüm adımların doğru.' },
    submission,
  )
  assert.equal(state.submissions.find((i) => i.id === submission!.id)!.score, 92)
  assert.throws(
    () =>
      perform(
        state,
        'ogrenci',
        'submit',
        { file: { name: 'ikinci.pdf', uri: 'file:///ikinci.pdf' } },
        homework,
      ),
    /tekrar teslim/,
  )
  assert.deepEqual(restoreSnapshot(createSnapshotWriter(seed)(state)).questions, state.questions)
})
test('Mobil: randevu saati tekrar ayrılamaz ve süresi dolan quiz boş yanıtları doğru saymaz', () => {
  let state = createSeed()
  const slot = state.availability.find(
    (slot) =>
      slot.teacherId === 't1' &&
      !state.appointments.some((a) => a.date === slot.date && a.teacherId === 't1'),
  )
  state = perform(state, 'veli', 'appointment', {
    teacherId: 't1',
    slotId: slot!.id,
    note: 'Dönem gelişimini konuşmak istiyorum.',
  })
  assert.throws(
    () =>
      operation(state, session('veli'), 'appointment').run(
        state,
        { teacherId: 't1', slotId: slot!.id, note: 'Tekrar randevu' },
        id,
      ),
    /başka randevu/,
  )
  const quiz = state.quizzes[0]
  assert.throws(() => gradeQuiz(quiz!, state.bank, {}), /tüm soruları/)
  assert.equal(gradeQuiz(quiz!, state.bank, {}, true).score, 0)
  assert.equal(gradeQuiz(quiz!, state.bank, {}, true).total, quiz!.questionIds.length)
})

test('Mobil: referans ödevi ve yanıtı güncellemede korunur; dosyasız veya değerlendirilmiş teslim reddedilir', async () => {
  const { prepareReferenceData } = await import('../apps/mobile/src/model/experience.ts')
  const seed = createSeed(),
    state = clone(seed)
  assert.equal(prepareReferenceData(state), true)
  const homework = state.homework.find((h) => h.id === 'hw-mobile-equations')
  assert.equal(homework!.title, 'Denklemler çalışma kâğıdı')
  assert.throws(() => perform(state, 'ogrenci', 'submit', {}, homework), /dosya/)
  let next = perform(
    state,
    'ogrenci',
    'submit',
    { file: { name: 'cozum.pdf', uri: 'file:///local/cozum.pdf' } },
    homework,
  )
  next = perform(
    next,
    'ogrenci',
    'submit',
    { file: { name: 'duzeltme.pdf', uri: 'file:///local/duzeltme.pdf' } },
    homework,
  )
  assert.equal(
    next.submissions.filter((s) => s.homeworkId === homework!.id && s.studentId === 's1').length,
    1,
  )
  const question = next.questions.find((q) => q.id === 'ask-mobile-equations')
  assert.throws(() => perform(next, 'ogretmen', 'answer', { answer: ' ' }, question))
  next = perform(
    next,
    'ogretmen',
    'answer',
    { answer: 'Eşitliği korumak için iki tarafa aynı işlemi uygularız.' },
    question,
  )
  const restored = restoreSnapshot(createSnapshotWriter(seed)(next))
  assert.equal(prepareReferenceData(restored), false)
  assert.equal(
    restored.questions.find((q) => q.id === question!.id)!.answer,
    'Eşitliği korumak için iki tarafa aynı işlemi uygularız.',
  )
  const submission = restored.submissions.find(
    (s) => s.homeworkId === homework!.id && s.studentId === 's1',
  )
  assert.equal(submission!.fileName, 'duzeltme.pdf')
  assert.equal((submission as { fileUri?: string }).fileUri, 'file:///local/duzeltme.pdf')
  submission!.score = 80
  assert.throws(
    () =>
      perform(
        restored,
        'ogrenci',
        'submit',
        { file: { name: 'son.pdf', uri: 'file:///local/son.pdf' } },
        homework,
      ),
    /tekrar teslim/,
  )
})

test('Mobil: mazeretli yoklama mevcut günü günceller; devamsızlık sayılmaz ve eski geç kayıtları korunur', async () => {
  const { recordAttendance } = await import('../packages/school-core/src/lib/domain.ts')
  const { absentCount } = await import('../apps/mobile/src/model/school.ts')
  const { dayKey } = await import('../packages/school-core/src/lib/format.ts')
  const seed = createSeed(),
    state = clone(seed),
    date = new Date().toISOString()
  const students = state.students.filter((s) => s.classId === 'c1' && s.isActive)
  const marks = Object.fromEntries(students.map((s) => [s.id, 'present']))
  marks.s1 = 'absent'
  recordAttendance(state, 'c1', date, marks)
  const before = absentCount(state, 's1')
  marks.s1 = 'excused'
  marks[students[1]!.id] = 'late'
  recordAttendance(state, 'c1', date, marks)
  const restored = restoreSnapshot(createSnapshotWriter(seed)(state))
  assert.equal(absentCount(restored, 's1'), before - 1)
  assert.equal(
    restored.attendance.filter((a) => a.studentId === 's1' && dayKey(a.date) === dayKey(date))
      .length,
    1,
  )
  assert.equal(
    restored.attendance.find((a) => a.studentId === 's1' && dayKey(a.date) === dayKey(date))!
      .status,
    'excused',
  )
  assert.equal(
    restored.attendance.find(
      (a) => a.studentId === students[1]!.id && dayKey(a.date) === dayKey(date),
    )!.status,
    'late',
  )
  const original = JSON.stringify(restored.attendance)
  assert.throws(() => recordAttendance(restored, 'c1', 'bozuk-tarih', marks), /tarih/)
  assert.throws(
    () => recordAttendance(restored, 'c1', date, { ...marks, s1: 'unknown' }),
    /durumunu/,
  )
  assert.equal(JSON.stringify(restored.attendance), original)
})
