import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  goalRows,
  guidanceRows,
  PROFILE_FALLBACK_PATH,
  profileHomeworkRows,
  profileMetrics,
  profileReturnPath,
  profileTab,
  profileTabs,
  quizResultRows,
  readsStudentWork,
  studentProfileHref,
  teacherDuty,
} from '../src/pages/academic/student-profile-model.ts'

const ALL_OPEN = {
  academic: true,
  learning: true,
  exams: true,
  goals: true,
  guidance: true,
  communication: true,
}
const SUBJECTS = new Map([
  ['math', { name: 'Matematik' }],
  ['turkish', { name: 'Türkçe' }],
])
const NOW = new Date('2026-10-15T09:00:00.000Z')

test('OG-205: profil sekmeleri açık modüllere göre görünür, bilinmeyen sekme ilke düşer', () => {
  assert.deepEqual(
    profileTabs(ALL_OPEN).map((tab) => tab.value),
    ['gelisim', 'notlar', 'devamsizlik', 'odevler', 'sinavlar', 'takip'],
  )
  const closed = profileTabs({ academic: true, exams: true })
  assert.deepEqual(
    closed.map((tab) => tab.value),
    ['gelisim', 'notlar', 'devamsizlik', 'sinavlar'],
  )
  assert.equal(profileTab('takip', closed), 'gelisim')
  assert.equal(profileTab('olmayan', closed), 'gelisim')
  assert.equal(profileTab(null, closed), 'gelisim')
  assert.equal(profileTab('sinavlar', closed), 'sinavlar')
  assert.ok(profileTabs({ academic: true, guidance: true }).some((tab) => tab.value === 'takip'))
})

test('OG-205: profil adresi kodlanır; dönüş adresi yalnız öğretmen kabuğundaki göreli yoldur', () => {
  assert.equal(studentProfileHref('s1'), '/ogretmen/ogrenci/s1')
  assert.equal(studentProfileHref('a/b'), '/ogretmen/ogrenci/a%2Fb')
  assert.equal(
    profileReturnPath({ from: '/ogretmen/siniflarim?sinif=c1' }),
    '/ogretmen/siniflarim?sinif=c1',
  )
  for (const state of [
    null,
    undefined,
    'metin',
    {},
    { from: 42 },
    { from: '//kotu.example/ogretmen/x' },
    { from: 'https://kotu.example/ogretmen/x' },
    { from: '/veli/dashboard' },
  ])
    assert.equal(profileReturnPath(state), PROFILE_FALLBACK_PATH, JSON.stringify(state))
})

test('DOM-AKD-074/079: teslim ve deneme yalnız işin öğretmenine ve sınıf danışmanına görünür', () => {
  assert.equal(readsStudentWork({ teacherId: 't2' }, 't2', false), true)
  assert.equal(readsStudentWork({ teacherId: 't1' }, 't2', false), false)
  assert.equal(readsStudentWork({ teacherId: 't1' }, 't2', true), true)
  // Öğretmen kaydı gelmeden (boş kimlik) başka işin durumu çıkarılmaz.
  assert.equal(readsStudentWork({ teacherId: '' }, '', false), false)
  assert.equal(teacherDuty(true), 'Sınıf danışmanı')
  assert.equal(teacherDuty(false), 'Branş öğretmeni')
})

test('OG-205: ödev durumu başka öğretmenin ödevini "teslim edilmedi" diye göstermez', () => {
  const homework = [
    {
      id: 'hw1',
      title: 'Türkçe ödevi',
      subject: 'Türkçe',
      dueDate: '2026-10-10T20:59:00.000Z',
      description: 'Okuma',
      teacherId: 't2',
    },
    {
      id: 'hw2',
      title: 'Matematik ödevi',
      subject: 'Matematik',
      dueDate: '2026-10-20T20:59:00.000Z',
      description: 'Denklem',
      teacherId: 't1',
    },
    {
      id: 'hw3',
      title: 'Türkçe ikinci',
      subject: 'Türkçe',
      dueDate: '2026-10-25T20:59:00.000Z',
      description: 'Yazma',
      teacherId: 't2',
    },
  ]
  const submissions = [{ id: 'sub1', homeworkId: 'hw1', studentId: 's1', score: 80 }]
  const subjectTeacher = profileHomeworkRows(homework, submissions, {
    studentId: 's1',
    teacherId: 't2',
    homeroom: false,
    now: NOW,
  })
  assert.deepEqual(
    subjectTeacher.map((row) => [row.id, row.score]),
    [
      ['hw3', null],
      ['hw1', 80],
    ],
  )
  const homeroom = profileHomeworkRows(homework, submissions, {
    studentId: 's1',
    teacherId: 't1',
    homeroom: true,
    now: NOW,
  })
  assert.deepEqual(
    homeroom.map((row) => row.id),
    ['hw3', 'hw2', 'hw1'],
  )
})

test('DOM-AKD-079: quiz sonuçları sunucu puanını taşır, süren deneme puansızdır', () => {
  const quizzes = [
    { id: 'q1', title: 'Denklemler', subjectId: 'math', teacherId: 't1' },
    { id: 'q2', title: 'Paragraf', subjectId: 'turkish', teacherId: 't2' },
  ]
  const attempts = [
    {
      id: 'a1',
      quizId: 'q1',
      studentId: 's1',
      date: '2026-10-01T09:00:00.000Z',
      score: 75,
      correct: 3,
      total: 4,
    },
    {
      id: 'a2',
      quizId: 'q1',
      studentId: 's1',
      date: '2026-10-05T09:00:00.000Z',
      status: 'started' as const,
    },
    {
      id: 'a3',
      quizId: 'q2',
      studentId: 's1',
      date: '2026-10-03T09:00:00.000Z',
      score: 50,
      correct: 1,
      total: 2,
    },
    {
      id: 'a4',
      quizId: 'q1',
      studentId: 's2',
      date: '2026-10-03T09:00:00.000Z',
      score: 100,
      correct: 4,
      total: 4,
    },
  ]
  const rows = quizResultRows(attempts, quizzes, SUBJECTS, {
    studentId: 's1',
    teacherId: 't1',
    homeroom: false,
  })
  assert.deepEqual(rows, [
    {
      id: 'a2',
      title: 'Denklemler',
      subject: 'Matematik',
      date: '2026-10-05T09:00:00.000Z',
      score: null,
      result: 'Devam ediyor',
    },
    {
      id: 'a1',
      title: 'Denklemler',
      subject: 'Matematik',
      date: '2026-10-01T09:00:00.000Z',
      score: 75,
      result: '3 / 4 doğru',
    },
  ])
  // Quizi gelmeyen deneme (kapsam dışı ya da arşiv) satır olmaz.
  assert.deepEqual(
    quizResultRows(attempts, [], SUBJECTS, { studentId: 's1', teacherId: 't1', homeroom: true }),
    [],
  )
})

test('OG-205: hedef satırları ders adını ve tamamlanan adımı gösterir', () => {
  const goals = [
    {
      id: 'g2',
      studentId: 's1',
      title: 'Genel net 60',
      targetNet: 60,
      deadline: '2026-12-01T00:00:00.000Z',
      status: 'Onay bekliyor',
      steps: [],
    },
    {
      id: 'g1',
      studentId: 's1',
      subjectId: 'math',
      title: 'Matematik 16',
      targetNet: 16,
      deadline: '2026-11-01T00:00:00.000Z',
      status: 'Aktif',
      steps: [{ done: true }, { done: false }],
    },
    {
      id: 'g3',
      studentId: 's2',
      title: 'Başkası',
      targetNet: 1,
      deadline: '2026-10-01T00:00:00.000Z',
      status: 'Aktif',
      steps: [],
    },
  ]
  assert.deepEqual(
    goalRows(goals, SUBJECTS, 's1').map((row) => [row.id, row.subject, row.steps]),
    [
      ['g1', 'Matematik', '1 / 2 adım'],
      ['g2', 'Genel net', '0 / 0 adım'],
    ],
  )
})

test('DOM-YTK-020: profil rehberlik satırı iç notu ve görüşme notlarını hiç taşımaz', () => {
  const counselorRecord = {
    id: 'guidance-s1',
    studentId: 's1',
    teacherId: 't1',
    title: 'Matematik çalışma alışkanlığı',
    plan: 'Haftada üç gün',
    sharedNote: 'Kısa tekrarlar',
    internalNote: 'GİZLİ İÇ NOT',
    notes: [{ text: 'GİZLİ GÖRÜŞME' }],
    followUp: '2026-10-22T00:00:00.000Z',
    status: 'Takipte',
  }
  const rows = guidanceRows([counselorRecord], 's1')
  assert.deepEqual(Object.keys(rows[0] ?? {}).sort(), [
    'followUp',
    'id',
    'plan',
    'sharedNote',
    'status',
    'title',
  ])
  assert.equal(JSON.stringify(rows).includes('GİZLİ'), false)
  assert.deepEqual(guidanceRows([counselorRecord], 's2'), [])
})

test('OG-205: özet göstergeleri kayıtlardan hesaplanır, veri yokken boştur', () => {
  assert.deepEqual(profileMetrics(undefined, undefined), { average: null, absent: null })
  assert.deepEqual(profileMetrics([], []), { average: null, absent: 0 })
  assert.deepEqual(
    profileMetrics(
      [{ score: 70 }, { score: 81 }],
      [{ status: 'absent' }, { status: 'present' }, { status: 'absent' }, { status: 'late' }],
    ),
    { average: 76, absent: 2 },
  )
})
