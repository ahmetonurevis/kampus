import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { askQuestionSchema } from '@kampus/school-core/lib/questions.ts'
import {
  askOptions,
  askQuestionBody,
  optionOf,
  teacherChoice,
  type AskOption,
} from '../src/question-model.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')

const wrap = <T extends { id: string }>(record: T) => ({
  id: record.id,
  version: 1,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  archivedAt: null,
  record,
})

function options(): AskOption[] {
  const seed = createSeed(NOW)
  const student = seed.students.find((item) => item.id === 's1')
  assert.ok(student)
  const assignments = seed.assignments.filter((item) => item.classId === student.classId)
  const teacherIds = new Set(assignments.map((item) => item.teacherId))
  return askOptions(
    assignments.map(wrap),
    seed.teachers.filter((item) => teacherIds.has(item.id)).map(wrap),
    seed.subjects.map(wrap),
  )
}

test('DOM-ILT-090: ders seçenekleri yalnız sınıfın atamalarındaki dersler ve aktif öğretmenlerdir', () => {
  const seed = createSeed(NOW)
  const student = seed.students.find((item) => item.id === 's1')
  assert.ok(student)
  const assigned = seed.assignments.filter((item) => item.classId === student.classId)
  const result = options()
  assert.deepEqual(
    result.map((item) => item.subjectId).sort(),
    [...new Set(assigned.map((item) => item.subjectId))].sort(),
  )
  // Sınıfta verilmeyen ders hiçbir seçenekte yoktur.
  assert.ok(seed.subjects.length > result.length)
  for (const option of result) {
    assert.equal(option.teachers.length, 1)
    const assignment = assigned.find((item) => item.subjectId === option.subjectId)
    assert.equal(option.teachers[0]?.id, assignment?.teacherId)
  }
  const names = result.map((item) => item.subject)
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b, 'tr')),
  )
})

test('DOM-ILT-090: pasif ya da arşivdeki öğretmen seçenek olmaz; öğretmensiz ders sunulmaz', () => {
  const seed = createSeed(NOW)
  const student = seed.students.find((item) => item.id === 's1')
  assert.ok(student)
  const assignments = seed.assignments.filter((item) => item.classId === student.classId)
  const [first, second] = assignments
  assert.ok(first && second)
  const teachers = seed.teachers
    .filter((item) => assignments.some((entry) => entry.teacherId === item.id))
    .map((item) => {
      if (item.id === first.teacherId) return { ...item, isActive: false }
      if (item.id === second.teacherId) return { ...item, deletedAt: NOW.toISOString() }
      return item
    })
  const result = askOptions(assignments.map(wrap), teachers.map(wrap), seed.subjects.map(wrap))
  assert.equal(optionOf(result, first.subjectId), undefined)
  assert.equal(optionOf(result, second.subjectId), undefined)
  assert.equal(result.length, assignments.length - 2)
})

test('DOM-ILT-090: ortak dersin öğretmenini öğrenci seçer, tek öğretmen kendiliğinden seçilir', () => {
  const single: AskOption = {
    subjectId: 'math',
    subject: 'Matematik',
    topics: ['Geometri'],
    teachers: [{ id: 't1', name: 'Selin Kaya' }],
  }
  const shared: AskOption = {
    ...single,
    teachers: [
      { id: 't1', name: 'Selin Kaya' },
      { id: 't2', name: 'Mert Aydın' },
    ],
  }
  assert.equal(teacherChoice(single, ''), 't1')
  assert.equal(teacherChoice(single, 'baska'), 't1')
  assert.equal(teacherChoice(shared, ''), '')
  assert.equal(teacherChoice(shared, 't2'), 't2')
  assert.equal(teacherChoice(shared, 'baska'), '')
  assert.equal(teacherChoice(undefined, 't1'), '')

  const values = {
    subjectId: 'math',
    teacherId: '',
    topic: '',
    title: 'Geometri',
    text: 'Üçgenlerde alan',
    files: [],
  }
  const missing = askQuestionBody({ ...values, text: 'Üçgenlerde alan nasıl bulunur?' }, [shared])
  assert.deepEqual(missing, { ok: false, field: 'teacherId', message: 'Öğretmen seçin.' })
  const chosen = askQuestionBody(
    { ...values, teacherId: 't2', text: 'Üçgenlerde alan nasıl bulunur?' },
    [shared],
  )
  assert.equal(chosen.ok && chosen.body.teacherId, 't2')
  const auto = askQuestionBody({ ...values, text: 'Üçgenlerde alan nasıl bulunur?' }, [single])
  assert.equal(auto.ok && auto.body.teacherId, 't1')
})

test('DOM-ILT-090: soru gövdesi core şemasına uyar; kapsam dışı ders ve kazanım istek atmadan reddedilir', () => {
  const [option] = options()
  assert.ok(option)
  const values = {
    subjectId: option.subjectId,
    teacherId: '',
    topic: '',
    title: '  Konu başlığı  ',
    text: '  Bu soruda iki seçenek arasında kaldım.  ',
    files: [],
  }
  const result = askQuestionBody(values, [option])
  assert.ok(result.ok)
  // Kazanım boşsa gönderilmez; metin kırpılır; gövde API'nin katı şemasından geçer.
  assert.deepEqual(result.body, {
    subjectId: option.subjectId,
    teacherId: option.teachers[0]?.id,
    title: 'Konu başlığı',
    text: 'Bu soruda iki seçenek arasında kaldım.',
  })
  assert.equal(askQuestionSchema.safeParse(result.body).success, true)

  const topic = option.topics[0]
  assert.ok(topic)
  const withTopic = askQuestionBody({ ...values, topic }, [option])
  assert.equal(withTopic.ok && withTopic.body.topic, topic)

  assert.deepEqual(askQuestionBody({ ...values, subjectId: 'olmayan' }, [option]), {
    ok: false,
    field: 'subjectId',
    message: 'Bir ders seçin.',
  })
  assert.deepEqual(askQuestionBody({ ...values, topic: 'Başka dersin kazanımı' }, [option]), {
    ok: false,
    field: 'topic',
    message: 'Kazanım bu derse ait değil.',
  })
})
