import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  answeredCount,
  attemptSummary,
  canStartQuiz,
  changedQuizFields,
  createQuizBody,
  eligibleQuestions,
  keepEligible,
  optionText,
  planQuizUpdate,
  QUIZ_PHASE_TEXT,
  QUIZ_QUESTION_LIMIT,
  quizReviewRows,
  quizActions,
  quizFormDefaults,
  quizFormSchema,
  quizLocked,
  questionTopics,
  seesQuizResults,
  toggleQuestion,
  type QuizFormOutput,
} from '../src/pages/learning/quiz-forms.ts'

// OG-047 (DOM-AKD-075…079): quiz formunun gövde planı, soru seçimi, kilit ve yetki hesapları.

const opened = {
  title: 'Kesirler quizi',
  duration: 20,
  dueDate: '2026-11-10T14:00:00.000Z' as string | null,
  questionIds: ['q1', 'q2'],
}

const values = (patch: Partial<QuizFormOutput> = {}): QuizFormOutput => ({
  classId: 'c1',
  subjectId: 'math',
  title: opened.title,
  duration: opened.duration,
  dueDate: '2026-11-10T14:00:00.000Z',
  questionIds: [...opened.questionIds],
  ...patch,
})

describe('quiz düzenleme planı: sessiz ezme yok (OG-047, DOM-AKD-076)', () => {
  test('yalnız kullanıcının değiştirdiği alan gider; başkasının başlığı geri yazılmaz', () => {
    const fresh = { ...opened, title: 'Kesirler quizi (B)' }
    const plan = planQuizUpdate(opened, fresh, values({ duration: 30 }))
    assert.deepEqual(plan.body, { duration: 30 })
    assert.deepEqual(plan.overlaps, [])
  })

  test('aynı alanı başkası da değiştirdiyse iki değer listelenir ve alan gövdede kalır', () => {
    const fresh = { ...opened, duration: 25 }
    const plan = planQuizUpdate(opened, fresh, values({ duration: 30 }))
    assert.deepEqual(plan.body, { duration: 30 })
    assert.deepEqual(plan.overlaps, [
      { field: 'duration', label: 'Süre', theirs: '25 dk', mine: '30 dk' },
    ])
  })

  test('kullanıcının girdiği değer zaten kayıtlıysa gövde boştur', () => {
    const fresh = { ...opened, duration: 30 }
    assert.deepEqual(planQuizUpdate(opened, fresh, values({ duration: 30 })).body, {})
  })

  test('son tarih kaldırılınca null gider; aynı an farklı yazımda değişiklik sayılmaz', () => {
    assert.deepEqual(changedQuizFields(opened, values({ dueDate: undefined })), {
      dueDate: null,
    })
    assert.deepEqual(
      changedQuizFields(opened, values({ dueDate: '2026-11-10T17:00:00+03:00' })),
      {},
    )
    assert.deepEqual(
      changedQuizFields({ ...opened, dueDate: null }, values({ dueDate: undefined })),
      {},
    )
  })

  test('soru sırası değişikliktir', () => {
    assert.deepEqual(changedQuizFields(opened, values({ questionIds: ['q2', 'q1'] })), {
      questionIds: ['q2', 'q1'],
    })
  })

  test('çözülmeye başlanmış quizde sorular plandan düşer ve işaretlenir (DOM-AKD-076)', () => {
    const plan = planQuizUpdate(
      opened,
      opened,
      values({ questionIds: ['q1'], title: 'Yeni başlık' }),
      true,
    )
    assert.deepEqual(plan.body, { title: 'Yeni başlık' })
    assert.equal(plan.questionsBlocked, true)
    const open = planQuizUpdate(opened, opened, values({ questionIds: ['q1'] }), false)
    assert.deepEqual(open.body, { questionIds: ['q1'] })
    assert.equal(open.questionsBlocked, false)
  })
})

describe('quiz formu şeması (DOM-AKD-075)', () => {
  test('boş son tarih gönderilmez; Türkiye saati ISO ana çevrilir', () => {
    const base = { classId: 'c1', subjectId: 'math', title: 'Kesirler', duration: 20 }
    const open = quizFormSchema.parse({ ...base, dueDate: '', questionIds: ['q1'] })
    assert.equal(open.dueDate, undefined)
    assert.equal('dueDate' in createQuizBody(open), false)
    const due = quizFormSchema.parse({ ...base, dueDate: '2026-11-10T17:00', questionIds: ['q1'] })
    assert.equal(due.dueDate, '2026-11-10T14:00:00.000Z')
    assert.equal(createQuizBody(due).dueDate, '2026-11-10T14:00:00.000Z')
  })

  test('süre 5–120 dakika, en az bir ve en çok 50 soru', () => {
    const base = { classId: 'c1', subjectId: 'math', title: 'Kesirler', dueDate: '' }
    assert.equal(
      quizFormSchema.safeParse({ ...base, duration: 4, questionIds: ['q1'] }).success,
      false,
    )
    assert.equal(
      quizFormSchema.safeParse({ ...base, duration: 121, questionIds: ['q1'] }).success,
      false,
    )
    assert.equal(
      quizFormSchema.safeParse({ ...base, duration: 20, questionIds: [] }).success,
      false,
    )
    const many = Array.from({ length: QUIZ_QUESTION_LIMIT + 1 }, (_, i) => `q${i}`)
    assert.equal(
      quizFormSchema.safeParse({ ...base, duration: 20, questionIds: many }).success,
      false,
    )
  })

  test('düzenleme varsayılanları kaydın değerleridir; yeni formda süre 20 dk', () => {
    assert.deepEqual(quizFormDefaults(), {
      classId: '',
      subjectId: '',
      title: '',
      duration: 20,
      dueDate: '',
      questionIds: [],
    })
    const edit = quizFormDefaults({ classId: 'c1', subjectId: 'math', ...opened })
    assert.equal(edit.dueDate, '2026-11-10T17:00')
    assert.deepEqual(edit.questionIds, ['q1', 'q2'])
  })
})

describe('soru seçimi (DOM-AKD-075)', () => {
  const seed = createSeed(new Date('2026-10-15T09:00:00.000Z'))

  test('yalnız quizin dersindeki ve sınıfın düzeyindeki sorular listelenir', () => {
    const list = eligibleQuestions(seed.bank, 'math', 7)
    assert.ok(list.length > 0)
    for (const question of list) {
      assert.equal(question.subjectId, 'math')
      assert.ok(question.minGrade <= 7 && question.maxGrade >= 7)
    }
    assert.equal(
      list.some((question) => question.id === 'q-math-8-0'),
      false,
      'başka düzeyin sorusu',
    )
    assert.deepEqual(eligibleQuestions(seed.bank, '', 7), [])
    // Düzeysiz sınıfta (dil okulu kuru) düzey süzgeci uygulanmaz.
    assert.ok(eligibleQuestions(seed.bank, 'math', undefined).length > list.length)
    const topics = questionTopics(list)
    assert.deepEqual(
      topics,
      [...topics].sort((a, b) => a.localeCompare(b, 'tr')),
    )
    assert.equal(new Set(topics).size, topics.length)
  })

  test('seçim sırası korunur, sınırda yeni soru eklenmez; uymayan seçim ayıklanır', () => {
    assert.deepEqual(toggleQuestion(['a'], 'b'), ['a', 'b'])
    assert.deepEqual(toggleQuestion(['a', 'b'], 'a'), ['b'])
    const full = Array.from({ length: QUIZ_QUESTION_LIMIT }, (_, i) => `q${i}`)
    assert.equal(toggleQuestion(full, 'yeni').length, QUIZ_QUESTION_LIMIT)
    assert.equal(toggleQuestion(full, 'q0').length, QUIZ_QUESTION_LIMIT - 1)
    assert.deepEqual(keepEligible(['a', 'b', 'c'], [{ id: 'c' }, { id: 'a' }]), ['a', 'c'])
  })
})

describe('quiz yetkisi, kilit ve sonuç metni (DOM-AKD-076, DOM-AKD-079)', () => {
  const teacher = { role: 'ogretmen', teacherId: 't1' }
  const other = { role: 'ogretmen', teacherId: 't2' }
  const admin = { role: 'yonetici', teacherId: null }

  test('quizi öğretmeni ve yönetici yönetir; başka öğretmen yalnız görür', () => {
    assert.deepEqual(quizActions(teacher, { teacherId: 't1' }), { create: true, manage: true })
    assert.deepEqual(quizActions(other, { teacherId: 't1' }), { create: true, manage: false })
    assert.deepEqual(quizActions(admin, { teacherId: 't1' }), { create: true, manage: true })
    assert.deepEqual(quizActions({ role: 'ogrenci', teacherId: null }), {
      create: false,
      manage: false,
    })
  })

  test('sonuçları quizin öğretmeni, rehber öğretmen ve yönetici görür', () => {
    assert.equal(seesQuizResults(teacher, { teacherId: 't1' }, undefined), true)
    assert.equal(seesQuizResults(other, { teacherId: 't1' }, 't2'), true)
    assert.equal(seesQuizResults(other, { teacherId: 't1' }, 't3'), false)
    assert.equal(seesQuizResults(admin, { teacherId: 't1' }, undefined), true)
  })

  test('başlatılmış deneme de quizi kilitler', () => {
    assert.equal(quizLocked({ statistics: { started: 0 }, attempts: [] }), false)
    assert.equal(quizLocked({ statistics: { started: 1 }, attempts: [] }), true)
    assert.equal(quizLocked({ statistics: null, attempts: [{}] }), true)
  })

  test('öğrenci satırı sunucunun sonucunu yazar; süre işlerken sonuç yoktur', () => {
    assert.equal(attemptSummary(undefined), 'Henüz çözmedi')
    assert.equal(attemptSummary({ status: 'in_progress', result: null }), 'Çözüyor')
    assert.equal(
      attemptSummary({ status: 'completed', result: { score: 67, correctCount: 2, total: 3 } }),
      '2/3 doğru · %67',
    )
    assert.equal(
      attemptSummary({ status: 'expired', result: { score: 0, correctCount: 0, total: 3 } }),
      'Süresi doldu · 0/3 doğru · %0',
    )
  })
})

describe('öğrenci quiz çözme ve inceleme (DOM-AKD-077, DOM-AKD-078)', () => {
  test('quiz yalnız açıkken ve deneme yokken başlatılır', () => {
    assert.equal(canStartQuiz({ status: 'open' }, undefined), true)
    assert.equal(canStartQuiz({ status: 'closed' }, undefined), false)
    assert.equal(canStartQuiz({ status: 'open' }, { status: 'in_progress' }), false)
    assert.equal(canStartQuiz({ status: 'open' }, { status: 'expired' }), false)
  })

  test('cevaplanan soru sayısı yalnız quizin sorularını sayar', () => {
    assert.equal(answeredCount(['q1', 'q2', 'q3'], { q1: 0, q3: 2, yabanci: 1 }), 2)
    assert.equal(answeredCount(['q1'], {}), 0)
  })

  test('inceleme satırı öğrencinin şıkkını verir; doğru şık ve çözüm üretmez', () => {
    const questions = [
      { id: 'q1', text: '2 + 2', topic: 'Toplama', options: ['3', '4', '5'] },
      { id: 'q2', text: '3 × 3', topic: 'Çarpma', options: ['6', '9'] },
      { id: 'q3', text: '5 − 1', topic: 'Çıkarma', options: ['4', '3'] },
    ]
    const rows = quizReviewRows(questions, { q1: 1, q2: 7 })
    assert.deepEqual(rows, [
      { id: 'q1', text: '2 + 2', topic: 'Toplama', chosen: 'B) 4' },
      // Quizde olmayan şık ve boş soru "boş" görünür.
      { id: 'q2', text: '3 × 3', topic: 'Çarpma', chosen: null },
      { id: 'q3', text: '5 − 1', topic: 'Çıkarma', chosen: null },
    ])
    for (const row of rows)
      assert.deepEqual(Object.keys(row).sort(), ['chosen', 'id', 'text', 'topic'])
  })

  test('durum metinleri ve şık harfi', () => {
    assert.equal(QUIZ_PHASE_TEXT.none, 'Henüz çözülmedi')
    assert.equal(QUIZ_PHASE_TEXT.expired, 'Süresi doldu')
    assert.equal(optionText(['x', 'y', 'z'], 2), 'C) z')
  })
})
