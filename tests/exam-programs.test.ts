import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EXAMS,
  SAMPLE_EXAM_PROGRAMS,
  TOPIC_MAX_DEPTH,
  examProgramSchema,
  programQuestionCount,
  programTopics,
  type ExamProgram,
} from '../packages/school-core/src/lib/exam-programs.ts'

const tyt = () => structuredClone(SAMPLE_EXAM_PROGRAMS.find((p) => p.id === 'yks-tyt')!)

function issuesOf(value: unknown) {
  const result = examProgramSchema.safeParse(value)
  assert.equal(result.success, false)
  return result.error!.issues
}

test('IST-001: örnek programlar şemadan geçer, kimlikleri tekildir', () => {
  const ids = SAMPLE_EXAM_PROGRAMS.map((program) => program.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const program of SAMPLE_EXAM_PROGRAMS) {
    const parsed = examProgramSchema.parse(program)
    assert.deepEqual(parsed, program)
    assert.ok(Object.hasOwn(EXAMS, program.exam))
  }
  // YKS, KPSS ve LGS örnekleri bulunur.
  const exams = new Set(SAMPLE_EXAM_PROGRAMS.map((program) => program.exam))
  for (const exam of ['yks', 'kpss', 'lgs']) assert.ok(exams.has(exam as ExamProgram['exam']))
})

test('IST-001: toplam soru sayısı derslerden hesaplanır', () => {
  assert.equal(programQuestionCount(tyt()), 120)
  const lgs = SAMPLE_EXAM_PROGRAMS.find((program) => program.id === 'lgs')!
  assert.equal(programQuestionCount(lgs), 90)
})

test('IST-001: konular ağaç sırasıyla ve yoluyla düzleşir', () => {
  const topics = programTopics(tyt())
  const problem = topics.find((topic) => topic.topicId === 'yas-problemleri')
  assert.deepEqual(problem, {
    subjectId: 'temel-matematik',
    topicId: 'yas-problemleri',
    path: ['Problemler', 'Yaş problemleri'],
  })
  const parent = topics.findIndex((topic) => topic.topicId === 'problemler')
  assert.equal(topics[parent + 1]?.topicId, 'sayi-problemleri')
})

test('IST-001: aynı ders iki kez, aynı konu bir derste iki kez yer alamaz', () => {
  const program = tyt()
  program.subjects.push(structuredClone(program.subjects[0]!))
  assert.ok(issuesOf(program).some((issue) => issue.path.join('.') === 'subjects'))

  const repeated = tyt()
  repeated.subjects[0]!.topics.push({ id: 'paragraf', name: 'Paragraf tekrar' })
  assert.ok(issuesOf(repeated).some((issue) => issue.path.join('.') === 'subjects.0.topics'))
})

test('IST-001: konu ağacı en çok üç düzeydir; derinlik aşımı reddedilir', () => {
  const program = tyt()
  program.subjects[0]!.topics = [
    { id: 'a', name: 'A', children: [{ id: 'b', name: 'B', children: [{ id: 'c', name: 'C' }] }] },
  ]
  assert.equal(examProgramSchema.safeParse(program).success, true)
  program.subjects[0]!.topics = [
    {
      id: 'a',
      name: 'A',
      children: [
        {
          id: 'b',
          name: 'B',
          children: [{ id: 'c', name: 'C', children: [{ id: 'd', name: 'D' }] }],
        },
      ],
    },
  ]
  const issues = issuesOf(program)
  assert.ok(issues.some((issue) => issue.message.includes(`${TOPIC_MAX_DEPTH} düzey`)))
})

test('IST-001: bilinmeyen sınav, boş ders listesi, geçersiz kimlik ve fazla alan reddedilir', () => {
  assert.ok(issuesOf({ ...tyt(), exam: 'sat' }).some((issue) => issue.path[0] === 'exam'))
  assert.ok(issuesOf({ ...tyt(), subjects: [] }).some((issue) => issue.path[0] === 'subjects'))
  assert.ok(issuesOf({ ...tyt(), id: 'YKS TYT' }).some((issue) => issue.path[0] === 'id'))
  assert.ok(issuesOf({ ...tyt(), grade: 12 }).length > 0)
  const zero = tyt()
  zero.subjects[0]!.questionCount = 0
  assert.ok(issuesOf(zero).some((issue) => issue.path.join('.') === 'subjects.0.questionCount'))
})
