import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'
import type { Actor } from '../packages/school-core/src/lib/scope.ts'
import {
  gradeRecordSchema,
  gradeUpdateSchema,
  recordGrade,
  subjectAverages,
  updateGrade,
} from '../packages/school-core/src/lib/grades.ts'
import { isDomainError } from './support/domain-error.ts'

const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-grade-test-${++sequence}`
const actors: Record<Role, Actor> = {
  yonetici: { role: 'yonetici', links: [] },
  onburo: { role: 'onburo', links: [] },
  ogretmen: { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] },
  ogrenci: { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] },
  veli: { role: 'veli', links: [{ kind: 'child', recordId: 's1' }] },
}
const teacher = actors.ogretmen
// s1 (7-A) matematik dersini t1 okutur.
const valid = {
  studentId: 's1',
  subjectId: 'math',
  term: 1,
  assessmentType: 'sinav',
  date: '2026-10-05',
  score: 78,
}
function unchangedOnFailure(
  state: State,
  action: () => unknown,
  check: (error: unknown) => boolean,
) {
  const before = JSON.stringify(state.grades)
  assert.throws(action, check)
  assert.equal(JSON.stringify(state.grades), before)
}
// Kök pakette zod bağımlılığı yok; şema hatası adıyla tanınır.
const zodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

test('Öğretmen atandığı sınıf ve derste resmî not girer; kayıt tür, dönem ve sırayı taşır', () => {
  const state = seed()
  const count = state.grades.length
  const grade = recordGrade(state, teacher, valid, id, now)
  assert.equal(state.grades.length, count + 1)
  assert.equal(state.grades.at(-1), grade)
  assert.deepEqual(
    {
      studentId: grade.studentId,
      subjectId: grade.subjectId,
      subject: grade.subject,
      assessmentType: grade.assessmentType,
      term: grade.term,
      sequence: grade.sequence,
      score: grade.score,
      date: grade.date,
      teacherId: grade.teacherId,
      title: grade.title,
      createdAt: grade.createdAt,
    },
    {
      studentId: 's1',
      subjectId: 'math',
      subject: 'Matematik',
      assessmentType: 'sinav',
      term: 1,
      sequence: 1,
      score: 78,
      date: '2026-10-05T09:00:00.000Z',
      teacherId: 't1',
      title: 'Matematik · 1. dönem 1. sınav',
      createdAt: now,
    },
  )
  // Aynı türde ikinci not sırayı artırır; form metni sayıya çevrilir.
  const second = recordGrade(state, teacher, { ...valid, date: '2026-10-06', score: '91' }, id, now)
  assert.equal(second.sequence, 2)
  assert.equal(second.score, 91)
  assert.equal(
    recordGrade(state, teacher, { ...valid, assessmentType: 'performans' }, id, now).sequence,
    1,
  )
})

test('Doğrulama hatasında hiçbir not eklenmez', () => {
  const state = seed()
  for (const input of [
    { ...valid, score: 101 },
    { ...valid, score: 7.5 },
    { ...valid, term: 3 },
    { ...valid, assessmentType: 'deneme' },
    { ...valid, date: '2026-02-31' },
    { ...valid, score: undefined },
    { ...valid, quizId: 'quiz1' },
    { ...valid, score: undefined, quizId: 'quiz1', assessmentType: 'sinav' },
  ])
    unchangedOnFailure(state, () => recordGrade(state, teacher, input, id, now), zodError)
  unchangedOnFailure(
    state,
    () => recordGrade(state, teacher, { ...valid, date: '2026-10-07' }, id, now),
    isDomainError('grade_future_date'),
  )
  // 7. sınıf öğrencisine ortaokul dışı ders ve lisede katılım puanı girilemez.
  const lise = state.classes.find((c) => c.grade >= 9)!
  const liseAssignment = state.assignments.find((a) => a.classId === lise.id)!
  const liseStudent = state.students.find((s) => s.classId === lise.id && s.isActive)!
  const liseTeacher: Actor = {
    role: 'ogretmen',
    links: [{ kind: 'teacher', recordId: liseAssignment.teacherId }],
  }
  unchangedOnFailure(
    state,
    () =>
      recordGrade(
        state,
        liseTeacher,
        {
          ...valid,
          studentId: liseStudent.id,
          subjectId: liseAssignment.subjectId,
          assessmentType: 'katilim',
        },
        id,
        now,
      ),
    isDomainError('grade_kind_level_mismatch'),
  )
  // Atama tutarsız olsa bile sınıf düzeyinde okutulmayan derse not girilmez.
  state.assignments.push({
    id: 'assign-grade-test',
    classId: 'c1',
    subjectId: 'physics',
    teacherId: 't1',
  })
  unchangedOnFailure(
    state,
    () => recordGrade(state, teacher, { ...valid, subjectId: 'physics' }, id, now),
    isDomainError('grade_subject_level_mismatch'),
  )
  // Pasif öğrenciye not girilmez.
  const s1 = state.students.find((s) => s.id === 's1')!
  s1.isActive = false
  unchangedOnFailure(
    state,
    () => recordGrade(state, teacher, valid, id, now),
    isDomainError('student_not_found', 'not_found'),
  )
})

test('Aynı gün aynı türde ikinci not mükerrer sayılır ve eklenmez', () => {
  const state = seed()
  recordGrade(state, teacher, valid, id, now)
  unchangedOnFailure(
    state,
    () => recordGrade(state, teacher, { ...valid, score: 90 }, id, now),
    isDomainError('grade_duplicate', 'conflict'),
  )
})

test('Notlu quiz tek kayıt olarak aktarılır; puan ilk tamamlanan denemeden hesaplanır', () => {
  const state = seed()
  const quiz = state.quizzes.find((q) => q.classId === 'c1' && q.subjectId === 'math')!
  const attempts = state.quizAttempts.filter((a) => a.quizId === quiz.id && a.studentId === 's1')
  assert.ok(attempts.length > 0)
  const first = [...attempts].sort((a, b) => a.date.localeCompare(b.date))[0]!
  // Sonraki yüksek puanlı tekrar notu değiştirmez.
  state.quizAttempts.push({
    ...first,
    id: 'attempt-retry',
    date: now,
    score: 100,
    correct: first.total,
  })
  const input = { ...valid, assessmentType: 'performans', score: undefined, quizId: quiz.id }
  const grade = recordGrade(state, teacher, input, id, now)
  assert.equal(grade.score, first.score)
  assert.equal(grade.quizId, quiz.id)
  unchangedOnFailure(
    state,
    () => recordGrade(state, teacher, { ...input, date: '2026-10-04' }, id, now),
    isDomainError('quiz_already_graded', 'conflict'),
  )
  unchangedOnFailure(
    state,
    () => recordGrade(state, teacher, { ...input, quizId: 'quiz-yok' }, id, now),
    isDomainError('quiz_not_found', 'not_found'),
  )
  const other = state.students.find((s) => s.classId === 'c1' && s.id !== 's1')!
  state.quizAttempts = state.quizAttempts.filter(
    (a) => !(a.quizId === quiz.id && a.studentId === other.id),
  )
  unchangedOnFailure(
    state,
    () => recordGrade(state, teacher, { ...input, studentId: other.id }, id, now),
    isDomainError('quiz_not_attempted'),
  )
  // Quizden aktarılan not elle düzeltilemez.
  assert.throws(
    () => updateGrade(state, teacher, grade.id, { score: 50, reason: 'Yeniden puanlama' }, now),
    isDomainError('grade_score_from_quiz'),
  )
})

test('Not girişi rol kapsamı: yalnız atanmış ders öğretmeni', () => {
  const state = seed()
  for (const role of ['yonetici', 'onburo', 'ogrenci', 'veli'] as const)
    unchangedOnFailure(
      state,
      () => recordGrade(state, actors[role], valid, id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
  unchangedOnFailure(
    state,
    () => recordGrade(state, teacher, { ...valid, subjectId: 'science' }, id, now),
    isDomainError('grade_assignment_forbidden', 'forbidden'),
  )
  const outsider = state.students.find(
    (s) => !state.assignments.some((a) => a.classId === s.classId && a.teacherId === 't1'),
  )!
  unchangedOnFailure(
    state,
    () => recordGrade(state, teacher, { ...valid, studentId: outsider.id }, id, now),
    isDomainError('grade_assignment_forbidden', 'forbidden'),
  )
  // Kimliği bilinmeyen öğrenci de yetki reddiyle döner; kayıt varlığı sızmaz.
  unchangedOnFailure(
    state,
    () => recordGrade(state, teacher, { ...valid, studentId: 's-yok' }, id, now),
    isDomainError('grade_assignment_forbidden', 'forbidden'),
  )
})

test('Modül kapalıyken veya dil okulunda not girilmez', () => {
  const state = seed()
  const grade = recordGrade(state, teacher, valid, id, now)
  state.modules.academic = false
  unchangedOnFailure(
    state,
    () => recordGrade(state, teacher, { ...valid, date: '2026-10-06' }, id, now),
    isDomainError('module_disabled', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    () => updateGrade(state, teacher, grade.id, { score: 60, reason: 'Okuma hatası' }, now),
    isDomainError('module_disabled', 'forbidden'),
  )
  state.modules.academic = true
  unchangedOnFailure(
    state,
    () =>
      recordGrade(state, teacher, { ...valid, date: '2026-10-06' }, id, now, {
        institutionType: 'language_school',
      }),
    isDomainError('official_grades_school_only'),
  )
})

test('Not düzeltmesi eski puanı gerekçesiyle saklar', () => {
  const state = seed()
  const grade = recordGrade(state, teacher, valid, id, now)
  const later = '2026-10-08T08:00:00.000Z'
  updateGrade(state, teacher, grade.id, { score: '82', reason: 'Toplama hatası' }, later)
  assert.equal(grade.score, 82)
  assert.equal(grade.updatedAt, later)
  updateGrade(state, actors.yonetici, grade.id, { score: 85, reason: 'İtiraz komisyonu' }, later)
  assert.deepEqual(grade.corrections, [
    {
      previousScore: 78,
      score: 82,
      reason: 'Toplama hatası',
      actor: 'ogretmen',
      userId: 't1',
      date: later,
    },
    {
      previousScore: 82,
      score: 85,
      reason: 'İtiraz komisyonu',
      actor: 'yonetici',
      userId: 'role-yonetici',
      date: later,
    },
  ])
  // Örnek veri notları (türsüz) da düzeltilebilir.
  const legacy = state.grades.find(
    (g) => g.studentId === 's1' && g.subjectId === 'math' && !g.assessmentType,
  )!
  updateGrade(
    state,
    teacher,
    legacy.id,
    { score: legacy.score === 50 ? 51 : 50, reason: 'Düzeltme' },
    now,
  )
  assert.equal(legacy.corrections?.length, 1)
})

test('Not düzeltmesi: doğrulama hatası, aynı puan ve kapsam dışı kayıt notu değiştirmez', () => {
  const state = seed()
  const grade = recordGrade(state, teacher, valid, id, now)
  for (const input of [{ score: 80 }, { score: 80, reason: ' ' }, { score: -1, reason: 'Gerekçe' }])
    unchangedOnFailure(state, () => updateGrade(state, teacher, grade.id, input, now), zodError)
  unchangedOnFailure(
    state,
    () => updateGrade(state, teacher, grade.id, { score: 78, reason: 'Aynı puan' }, now),
    isDomainError('grade_unchanged', 'conflict'),
  )
  unchangedOnFailure(
    state,
    () => updateGrade(state, teacher, 'g-yok', { score: 80, reason: 'Gerekçe' }, now),
    isDomainError('grade_not_found', 'not_found'),
  )
  // Başka dersin notu: öğretmen görmüyorsa bulunamadı, sınıf rehberi olarak görüyorsa yetkisiz.
  const science = state.grades.find((g) => g.studentId === 's1' && g.subjectId === 'science')!
  const homeroom = state.classes.find((c) => c.id === 'c1')!.teacherId === 't1'
  unchangedOnFailure(
    state,
    () => updateGrade(state, teacher, science.id, { score: 10, reason: 'Gerekçe' }, now),
    homeroom
      ? isDomainError('grade_assignment_forbidden', 'forbidden')
      : isDomainError('grade_not_found', 'not_found'),
  )
  const outsider = state.grades.find(
    (g) =>
      !state.assignments.some(
        (a) =>
          a.teacherId === 't1' &&
          a.classId === state.students.find((s) => s.id === g.studentId)!.classId,
      ),
  )!
  unchangedOnFailure(
    state,
    () => updateGrade(state, teacher, outsider.id, { score: 10, reason: 'Gerekçe' }, now),
    isDomainError('grade_not_found', 'not_found'),
  )
  // Ön büro notları okuyamaz; öğrenci ve veli kendi notunu görür ama düzeltemez.
  unchangedOnFailure(
    state,
    () => updateGrade(state, actors.onburo, grade.id, { score: 80, reason: 'Gerekçe' }, now),
    isDomainError('permission_denied', 'forbidden'),
  )
  for (const role of ['ogrenci', 'veli'] as const)
    unchangedOnFailure(
      state,
      () => updateGrade(state, actors[role], grade.id, { score: 80, reason: 'Gerekçe' }, now),
      isDomainError('permission_denied', 'forbidden'),
    )
  // Yönetici gerekçesiz düzeltemez (şema gerekçeyi zorunlu tutar).
  unchangedOnFailure(
    state,
    () => updateGrade(state, actors.yonetici, grade.id, { score: 80 }, now),
    zodError,
  )
})

// 7-B (c9, ikinci kampüs) matematiğini ve rehberliğini t17 yapar; t1 7-A'nın (c1) öğretmenidir.
const newTeacher: Actor = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't17' }] }
function moveToNewClass(state: State) {
  const student = state.students.find((s) => s.id === 's1')!
  student.classId = 'c9'
}

test('Not, verildiği sınıfı saklar; sınıf değiştiren öğrencinin notunu eski öğretmen düzeltir', () => {
  const state = seed()
  const grade = recordGrade(state, teacher, valid, id, now)
  assert.equal(grade.classId, 'c1')
  moveToNewClass(state)
  const later = '2026-10-07T08:00:00.000Z'
  updateGrade(state, teacher, grade.id, { score: 81, reason: 'Toplama hatası' }, later)
  assert.equal(grade.score, 81)
  assert.equal(grade.classId, 'c1', 'düzeltme notun sınıfını değiştirmez')
  // Yönetici her durumda gerekçeyle düzeltir.
  updateGrade(state, actors.yonetici, grade.id, { score: 84, reason: 'İtiraz komisyonu' }, later)
  assert.deepEqual(
    grade.corrections?.map((c) => [c.previousScore, c.score, c.actor]),
    [
      [78, 81, 'ogretmen'],
      [81, 84, 'yonetici'],
    ],
  )
})

test('Yeni sınıfın öğretmeni öğrencinin eski sınıfta aldığı notu düzeltemez', () => {
  const state = seed()
  const grade = recordGrade(state, teacher, valid, id, now)
  moveToNewClass(state)
  // t17 öğrencinin yeni sınıfında matematik ve rehber öğretmenidir: notu görür, düzeltemez.
  unchangedOnFailure(
    state,
    () => updateGrade(state, newTeacher, grade.id, { score: 10, reason: 'Gerekçe' }, now),
    isDomainError('grade_assignment_forbidden', 'forbidden'),
  )
  // Ders vermediği başka sınıfın öğretmeni notu hiç görmez.
  const outsider: Actor = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't33' }] }
  unchangedOnFailure(
    state,
    () => updateGrade(state, outsider, grade.id, { score: 10, reason: 'Gerekçe' }, now),
    isDomainError('grade_not_found', 'not_found'),
  )
})

test('Sınıfı saklanmamış eski notta yetki öğrencinin güncel sınıfına düşer', () => {
  const state = seed()
  // Örnek veri notları `classId` taşımaz (sınıf saklanmadan önceki kayıtlar).
  const legacy = state.grades.find((g) => g.studentId === 's1' && g.subjectId === 'math')!
  assert.equal(legacy.classId, undefined)
  moveToNewClass(state)
  // Yedek yol: güncel sınıf (c9) esas alınır; eski öğretmen görmez, yeni öğretmen düzeltir.
  unchangedOnFailure(
    state,
    () => updateGrade(state, teacher, legacy.id, { score: 10, reason: 'Gerekçe' }, now),
    isDomainError('grade_not_found', 'not_found'),
  )
  const score = legacy.score === 50 ? 51 : 50
  updateGrade(state, newTeacher, legacy.id, { score, reason: 'Okuma hatası' }, now)
  assert.equal(legacy.score, score)
  assert.equal(legacy.classId, undefined, 'yedek yol eski kayda sınıf yazmaz')
})

test('Not şemaları form/API gövdesi olarak kullanılabilir', () => {
  assert.equal(gradeRecordSchema.safeParse(valid).success, true)
  const parsed = gradeRecordSchema.parse({ ...valid, term: '2', score: '0' })
  assert.equal(parsed.term, 2)
  assert.equal(parsed.score, 0)
  assert.equal(parsed.topic, '')
  const issue = gradeRecordSchema.safeParse({ ...valid, score: undefined })
  assert.equal(issue.success, false)
  assert.deepEqual(issue.error?.issues[0]?.path, ['score'])
  assert.equal(issue.error?.issues[0]?.message, 'Puanı girin.')
  assert.equal(gradeUpdateSchema.safeParse({ score: 70, reason: 'Gerekçe' }).success, true)
})

test('subjectAverages: boş liste boş döner', () => {
  assert.deepEqual(subjectAverages([]), [])
})
test('subjectAverages: tek not kendi puanıdır', () => {
  assert.deepEqual(subjectAverages([{ subjectId: 'math', subject: 'Matematik', score: 85 }]), [
    { subjectId: 'math', name: 'Matematik', average: 85, count: 1 },
  ])
})
test('subjectAverages: karışık dersler ders adına göre (tr) sıralı, ortalama yuvarlanır', () => {
  const grades = [
    { subjectId: 'turkish', subject: 'Türkçe', score: 90 },
    { subjectId: 'math', subject: 'Matematik', score: 70 },
    { subjectId: 'english', subject: 'İngilizce', score: 100 },
    { subjectId: 'math', subject: 'Matematik', score: 85 },
    { subjectId: 'math', subject: 'Matematik', score: 80 },
    { subjectId: 'turkish', subject: 'Türkçe', score: 75 },
  ]
  const before = JSON.stringify(grades)
  assert.deepEqual(subjectAverages(grades), [
    { subjectId: 'english', name: 'İngilizce', average: 100, count: 1 },
    // (70 + 85 + 80) / 3 = 78,33 → 78
    { subjectId: 'math', name: 'Matematik', average: 78, count: 3 },
    // (90 + 75) / 2 = 82,5 → 83
    { subjectId: 'turkish', name: 'Türkçe', average: 83, count: 2 },
  ])
  assert.equal(JSON.stringify(grades), before)
})
test('subjectAverages: örnek veri notlarını ders bazında toplar', () => {
  const state = seed()
  const own = state.grades.filter((g) => g.studentId === 's1')
  const rows = subjectAverages(own)
  assert.ok(rows.length > 0)
  assert.equal(
    rows.reduce((total, row) => total + row.count, 0),
    own.length,
  )
})
