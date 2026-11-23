import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { askQuestionSchema } from '@kampus/school-core/lib/questions.ts'
import {
  answerDefaults,
  answerFormSchema,
  addQuestionPhoto,
  askDefaults,
  askFieldName,
  askFormSchema,
  askOptions,
  askQuestionBody,
  type AskOption,
} from '../src/pages/learning/question-forms.ts'

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

test('DOM-ILT-090: soru formu boşken ve sınırlar aşılınca Türkçe alan hatası verir', () => {
  const empty = askFormSchema.safeParse(askDefaults())
  assert.equal(empty.success, false)
  const messages = new Map(empty.error?.issues.map((issue) => [issue.path[0], issue.message]))
  assert.equal(messages.get('subjectId'), 'Bir ders seçin.')
  assert.equal(messages.get('title'), 'Konu başlığını yazın.')
  assert.equal(messages.get('text'), 'Sorunuzu en az 10 karakterle açıklayın.')

  const long = askFormSchema.safeParse({
    ...askDefaults(),
    subjectId: 'math',
    title: 'x'.repeat(121),
    text: 'y'.repeat(2001),
  })
  const longMessages = new Map(long.error?.issues.map((issue) => [issue.path[0], issue.message]))
  assert.equal(longMessages.get('title'), 'Konu başlığı en fazla 120 karakter olabilir.')
  assert.equal(longMessages.get('text'), 'En fazla 2000 karakter yazabilirsiniz.')
})

test('DOM-ILT-092: yanıt formu boşu ve 2000 karakteri aşanı reddeder', () => {
  assert.deepEqual(answerDefaults(), { text: '' })
  const empty = answerFormSchema.safeParse({ text: '   ' })
  assert.equal(empty.error?.issues[0]?.message, 'Yanıtı yazın.')
  const long = answerFormSchema.safeParse({ text: 'a'.repeat(2001) })
  assert.equal(long.error?.issues[0]?.message, 'En fazla 2000 karakter yazabilirsiniz.')
  assert.equal(
    answerFormSchema.safeParse({ text: 'Üçgenin alanı taban çarpı yükseklik bölü ikidir.' })
      .success,
    true,
  )
})

test('DOM-ILT-094: soru fotoğrafları gövdeye yalnız kimlikle gider; en çok 3 fotoğraf, aynı dosya bir kez', () => {
  const [option] = options()
  assert.ok(option)
  const photo = (id: string) => ({ id, name: `${id}.jpg` })
  const values = {
    ...askDefaults(),
    subjectId: option.subjectId,
    title: 'Konu başlığı',
    text: 'Bu soruda iki seçenek arasında kaldım.',
    files: [photo('f1'), photo('f2')],
  }
  const result = askQuestionBody(values, [option])
  assert.ok(result.ok)
  assert.deepEqual(result.body.fileIds, ['f1', 'f2'])
  assert.equal(JSON.stringify(result.body).includes('.jpg'), false)
  assert.equal(askQuestionSchema.safeParse(result.body).success, true)
  // Fotoğrafsız soruda alan gönderilmez.
  const plain = askQuestionBody({ ...values, files: [] }, [option])
  assert.equal(plain.ok && 'fileIds' in plain.body, false)

  let list = addQuestionPhoto([], photo('f1'))
  list = addQuestionPhoto(list, photo('f1'))
  assert.deepEqual(
    list.map((item) => item.id),
    ['f1'],
  )
  for (const id of ['f2', 'f3', 'f4']) list = addQuestionPhoto(list, photo(id))
  assert.deepEqual(
    list.map((item) => item.id),
    ['f1', 'f2', 'f3'],
  )
  const tooMany = askFormSchema.safeParse({
    ...values,
    files: [1, 2, 3, 4].map((n) => photo(`p${n}`)),
  })
  assert.equal(tooMany.success, false)
  assert.equal(tooMany.error?.issues[0]?.message, 'En fazla 3 fotoğraf ekleyebilirsiniz.')

  assert.equal(askFieldName('fileIds'), 'files')
  assert.equal(askFieldName('fileIds.0'), 'files')
  assert.equal(askFieldName('topic'), 'topic')
  assert.equal(askFieldName('root.server'), 'root.server')
  assert.equal(askFieldName('bilinmeyen'), 'root.server')
})
