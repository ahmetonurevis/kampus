import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
} from './support/app.ts'

/**
 * Öğretmenin öğrenci profili (OG-205) sekmelerinin okuduğu koleksiyonlarda kapsam dışı öğrenci
 * (DOM-YTK-022, DOM-AKD-074, DOM-AKD-079). Selin Kaya (t1) 7-A'nın (c1) sınıf danışmanıdır; Asya
 * Yıldız (s9) 7-B'dedir (c9; t1 oraya girmez). Profil `?studentId=` ile okur; kapsam dışı öğrenci
 * için yanıt boş olmalı, kapsam içi öğrencide veri gelmelidir (sorgu gerçekten çalışıyor).
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c9']
const STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
const ofStudents = (item: { studentId: string }) => STUDENT_IDS.has(item.studentId)
const HOMEWORK = SEED.homework.filter((item) => CLASS_IDS.includes(item.classId))
const QUIZZES = SEED.quizzes.filter((item) => CLASS_IDS.includes(item.classId))
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => STUDENT_IDS.has(item.id)),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  grades: SEED.grades.filter(ofStudents),
  attendance: SEED.attendance.filter(ofStudents),
  homework: HOMEWORK,
  submissions: SEED.submissions.filter(ofStudents),
  quizzes: QUIZZES,
  quizAttempts: SEED.quizAttempts.filter(ofStudents),
}
const PROFILE_COLLECTIONS = ['grades', 'attendance', 'submissions', 'quizAttempts'] as const

function rows() {
  return Object.entries(SAMPLE).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

describe('öğretmen öğrenci profili kapsamı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution() {
    const created = await createInstitution(app)
    await insertMissingRecords(db, created.id, rows(), FIXED_NOW)
    return created.id
  }
  const teacher = async (institutionId: string, teacherId: string) =>
    signInAs(
      app,
      await createMember(app, institutionId, 'ogretmen', [
        { kind: 'teacher', recordId: teacherId },
      ]),
    )
  const list = (cookie: string, collection: string, studentId: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/collections/${collection}?studentId=${studentId}&pageSize=100`,
      headers: { cookie },
    })

  test('örnek kesitte kapsam dışı öğrencinin her profil koleksiyonunda kaydı vardır', () => {
    for (const collection of PROFILE_COLLECTIONS)
      for (const studentId of ['s1', 's9'])
        assert.ok(
          (SAMPLE[collection] ?? []).some((row) => row.studentId === studentId),
          `${collection}/${studentId}`,
        )
  })

  test('DOM-YTK-022: sınıf danışmanı kapsam dışı öğrencinin not, yoklama, teslim ve quiz denemesini görmez', async () => {
    const id = await institution()
    const cookie = await teacher(id, 't1')
    for (const collection of PROFILE_COLLECTIONS) {
      const own = await list(cookie, collection, 's1')
      assert.equal(own.statusCode, 200, own.body)
      assert.ok(own.json().data.length > 0, `${collection}: kapsam içi öğrenci kaydı gelmeli`)
      const foreign = await list(cookie, collection, 's9')
      assert.equal(foreign.statusCode, 200, foreign.body)
      assert.deepEqual(foreign.json().data, [], collection)
      assert.equal(foreign.json().meta.total, 0, collection)
    }
    const student = await app.inject({
      method: 'GET',
      url: '/api/v1/collections/students/s9',
      headers: { cookie },
    })
    assert.equal(student.statusCode, 404)
  })

  test('DOM-AKD-074, DOM-AKD-079: branş öğretmeni de kapsam dışı öğrenciyi görmez', async () => {
    const id = await institution()
    const cookie = await teacher(id, 't2')
    for (const collection of PROFILE_COLLECTIONS) {
      const foreign = await list(cookie, collection, 's9')
      assert.equal(foreign.statusCode, 200, foreign.body)
      assert.deepEqual(foreign.json().data, [], collection)
    }
  })
})
