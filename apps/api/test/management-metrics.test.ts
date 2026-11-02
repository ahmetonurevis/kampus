import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import { ROLES } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { CollectionName, RecordData } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { teacherPerformance } from '../src/services/management-metrics.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  type InstitutionOverrides,
} from './support/app.ts'

// Kampüs ve kadro ekranlarının toplu ölçüleri (IST-010): `GET /api/v1/class-metrics` (not
// ortalaması) ve `GET /api/v1/teacher-metrics` (soru süresi uyumu ve performans). Toplam SQL'de.

const HOUR = 3_600_000
const at = (offsetHours: number) => new Date(FIXED_NOW.getTime() + offsetHours * HOUR).toISOString()

type Item = { collection: CollectionName; id: string; data: RecordData }
const item = (collection: CollectionName, data: RecordData & { id: string }): Item => ({
  collection,
  id: data.id,
  data,
})

/** Kurum A'nın kayıtları; B'de aynı kimliklerle başka değerler vardır. */
function sample(prefix: string, score: number): Item[] {
  return [
    item('teachers', {
      id: 'mt-t1',
      name: `${prefix} Öğretmen 1`,
      attendanceRate: 90,
      homeworkRate: 80,
    }),
    item('teachers', {
      id: 'mt-t2',
      name: `${prefix} Öğretmen 2`,
      attendanceRate: 100,
      homeworkRate: 100,
      isActive: false,
    }),
    item('teachers', { id: 'mt-t3', name: `${prefix} Öğretmen 3` }),
    item('classes', { id: 'mt-c1', name: '7-A' }),
    item('classes', { id: 'mt-c2', name: '7-B' }),
    item('students', { id: 'mt-s1', classId: 'mt-c1', isActive: true }),
    item('students', { id: 'mt-s2', classId: 'mt-c1', isActive: true }),
    item('students', { id: 'mt-s3', classId: 'mt-c1' }),
    item('students', { id: 'mt-s4', classId: 'mt-c1', isActive: false }),
    item('students', { id: 'mt-s5', classId: 'mt-c2', isActive: true }),
    // s1: (80 + 91) / 2 = 85,5 → 86; s2: 70; s3 notsuz; s4 pasif; sayısal olmayan puan sayılmaz.
    item('grades', { id: 'mt-g1', studentId: 'mt-s1', score: 80 }),
    item('grades', { id: 'mt-g2', studentId: 'mt-s1', score: 91 }),
    item('grades', { id: 'mt-g3', studentId: 'mt-s2', score }),
    item('grades', { id: 'mt-g4', studentId: 'mt-s2', score: 'yüz' }),
    item('grades', { id: 'mt-g5', studentId: 'mt-s4', score: 10 }),
    // t1: 2 saatte yanıt (uyum), 30 saatte yanıt (ihlal), 30 saattir yanıtsız (ihlal), 2 saatlik
    // yanıtsız (uyum), geri çekilen (sayılmaz).
    item('questions', { id: 'mt-q1', teacherId: 'mt-t1', createdAt: at(-48), answeredAt: at(-46) }),
    item('questions', { id: 'mt-q2', teacherId: 'mt-t1', createdAt: at(-48), answeredAt: at(-18) }),
    item('questions', { id: 'mt-q3', teacherId: 'mt-t1', createdAt: at(-30), answeredAt: null }),
    item('questions', { id: 'mt-q4', teacherId: 'mt-t1', createdAt: at(-2) }),
    item('questions', {
      id: 'mt-q5',
      teacherId: 'mt-t1',
      createdAt: at(-48),
      withdrawnAt: at(-47),
    }),
  ]
}

describe('yönetim ölçüleri (IST-010)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(score: number, overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, sample(created.id, score), FIXED_NOW)
    return { ...created, cookie: await signInAs(app, created.admin) }
  }

  const get = (url: string, cookie?: string) =>
    app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })

  for (const url of ['/api/v1/class-metrics', '/api/v1/teacher-metrics']) {
    test(`${url}: kimliksiz 401, bilinmeyen parametre 400`, async () => {
      assert.equal((await get(url)).statusCode, 401)
      const a = await institution(70)
      const response = await get(`${url}?institutionId=x`, a.cookie)
      assert.equal(response.statusCode, 400, response.body)
    })

    test(`${url}: yönetici dışındaki roller 403 ve veri dönmez`, async () => {
      const a = await institution(70)
      for (const role of ROLES.filter((value) => value !== 'yonetici')) {
        const cookie = await signInAs(app, await createMember(app, a.id, role))
        const response = await get(url, cookie)
        assert.equal(response.statusCode, 403, `${role}: ${response.body}`)
        assert.ok(!response.body.includes('mt-'), role)
      }
    })
  }

  test('sınıf ortalaması SQL’de öğrenci ortalamalarından; notsuz ve pasif öğrenci girmez', async () => {
    const a = await institution(70)
    // Kurum B'de aynı kimlikler başka puanla: A'nın sonucuna karışmaz.
    await institution(10)
    const response = await get('/api/v1/class-metrics', a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json().data, [
      { classId: 'mt-c1', students: 3, gradedStudents: 2, averageScore: 78 },
      { classId: 'mt-c2', students: 1, gradedStudents: 0, averageScore: null },
    ])
  })

  test('öğretmen ölçüsü: 24 saat ihlali, geri çekilen soru dışarıda, performans üç oranın ortalaması (DOM-ILT-091)', async () => {
    const a = await institution(70)
    const response = await get('/api/v1/teacher-metrics', a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json().data, [
      { teacherId: 'mt-t1', questions: 4, breaches: 2, slaRate: 50, performance: 73 },
      { teacherId: 'mt-t2', questions: 0, breaches: 0, slaRate: 100, performance: 100 },
      { teacherId: 'mt-t3', questions: 0, breaches: 0, slaRate: 100, performance: null },
    ])
  })

  test('modül kapalıysa 403 module_disabled', async () => {
    const a = await institution(70, { enabledModules: { academic: false, learning: false } })
    for (const url of ['/api/v1/class-metrics', '/api/v1/teacher-metrics']) {
      const response = await get(url, a.cookie)
      assert.equal(response.statusCode, 403, response.body)
      assert.equal(response.json().code, 'module_disabled')
    }
  })

  test('performans: soru yoksa uyum 100, oran eksikse null', () => {
    assert.deepEqual(
      teacherPerformance({ attendanceRate: 90, homeworkRate: 90, questions: 3, breaches: 1 }),
      { slaRate: 67, performance: 82 },
    )
    assert.deepEqual(
      teacherPerformance({ attendanceRate: 60, homeworkRate: 60, questions: 0, breaches: 0 }),
      { slaRate: 100, performance: 73 },
    )
    assert.deepEqual(
      teacherPerformance({ attendanceRate: null, homeworkRate: 60, questions: 1, breaches: 1 }),
      { slaRate: 0, performance: null },
    )
  })
})
