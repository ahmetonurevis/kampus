import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { moduleAvailableFor } from '@kampus/school-core/modules/collection-modules.ts'

import type { App } from '../src/app.ts'
import { ROLES } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { CollectionName, RecordData } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { institutions } from '../src/db/schema/auth.ts'
import { records } from '../src/db/schema/records.ts'
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
    item('classes', { id: 'mt-c3', name: '7-C' }),
    item('students', { id: 'mt-s6', classId: 'mt-c3', isActive: true }),
    item('students', { id: 'mt-s7', classId: 'mt-c3', isActive: true }),
    // s1: (80 + 91) / 2 = 85,5; s2: 70; s3 notsuz; s4 pasif. Sınıf c1: (85,5 + 70) / 2 = 77,75 → 78.
    item('grades', { id: 'mt-g1', studentId: 'mt-s1', score: 80 }),
    item('grades', { id: 'mt-g2', studentId: 'mt-s1', score: 91 }),
    item('grades', { id: 'mt-g3', studentId: 'mt-s2', score }),
    item('grades', { id: 'mt-g5', studentId: 'mt-s4', score: 10 }),
    // DOM-AKD-003: s6 70,5 ve s7 70 → sınıf ortalaması 70,25 → 70 (öğrenci başına yuvarlansaydı
    // 71 ve 70 → 70,5 → 71 çıkardı).
    item('grades', { id: 'mt-g6', studentId: 'mt-s6', score: 70 }),
    item('grades', { id: 'mt-g7', studentId: 'mt-s6', score: 71 }),
    item('grades', { id: 'mt-g8', studentId: 'mt-s7', score: 70 }),
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

/** Kurum A'nın (puan 70) beklenen ölçüleri. */
const A_CLASSES = [
  { classId: 'mt-c1', students: 3, gradedStudents: 2, averageScore: 78 },
  { classId: 'mt-c2', students: 1, gradedStudents: 0, averageScore: null },
  { classId: 'mt-c3', students: 2, gradedStudents: 2, averageScore: 70 },
]
const A_TEACHERS = [
  { teacherId: 'mt-t1', questions: 4, breaches: 2, slaRate: 50, performance: 73 },
  { teacherId: 'mt-t2', questions: 0, breaches: 0, slaRate: 100, performance: 100 },
  { teacherId: 'mt-t3', questions: 0, breaches: 0, slaRate: 100, performance: null },
]

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

  async function institution(
    score: number,
    overrides: Partial<InstitutionOverrides> = {},
    extra: Item[] = [],
  ) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, [...sample(created.id, score), ...extra], FIXED_NOW)
    return { ...created, cookie: await signInAs(app, created.admin) }
  }

  /** Kaydı arşivler (`archived_at` dolar); ölçü sorguları bu kayıtları saymamalı. */
  async function archive(institutionId: string, collection: CollectionName, ids: string[]) {
    for (const id of ids)
      await db
        .update(records)
        .set({ archivedAt: FIXED_NOW })
        .where(
          and(
            eq(records.institutionId, institutionId),
            eq(records.collection, collection),
            eq(records.id, id),
          ),
        )
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

  test('DOM-AKD-003: sınıf ortalaması yuvarlanmamış öğrenci ortalamalarından, sonda bir kez yuvarlanır; notsuz ve pasif öğrenci girmez', async () => {
    const a = await institution(70)
    // Kurum B'de aynı kimlikler başka puanla: A'nın sonucuna karışmaz.
    await institution(10)
    const response = await get('/api/v1/class-metrics', a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json().data, A_CLASSES)
  })

  test('sayı olmayan geçersiz değer atlanır; 0–100 dışı puan da sayılmaz', async () => {
    // TODO(kg-not): `K`/`G` (DOM-AKD-013) saklanmıyor; saklanınca ortalamaya 0 olarak girer.
    const a = await institution(70, {}, [
      item('classes', { id: 'mt-c9', name: '9-A' }),
      item('students', { id: 'mt-s9', classId: 'mt-c9', isActive: true }),
      item('grades', { id: 'mt-g90', studentId: 'mt-s9', score: 60 }),
      item('grades', { id: 'mt-g91', studentId: 'mt-s9', score: 'yüz' }),
      item('grades', { id: 'mt-g92', studentId: 'mt-s9', score: '90' }),
      item('grades', { id: 'mt-g93', studentId: 'mt-s9', score: 'K' }),
      item('grades', { id: 'mt-g94', studentId: 'mt-s9', score: null }),
      item('grades', { id: 'mt-g95', studentId: 'mt-s9', score: 150 }),
      item('grades', { id: 'mt-g96', studentId: 'mt-s9', score: -5 }),
      item('grades', { id: 'mt-g97', studentId: 'mt-s9' }),
    ])
    const response = await get('/api/v1/class-metrics', a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(
      response.json().data.find((row: { classId: string }) => row.classId === 'mt-c9'),
      { classId: 'mt-c9', students: 1, gradedStudents: 1, averageScore: 60 },
    )
  })

  test('öğretmen ölçüsü: 24 saat ihlali, geri çekilen soru dışarıda, performans üç oranın ortalaması (DOM-ILT-091)', async () => {
    const a = await institution(70)
    const response = await get('/api/v1/teacher-metrics', a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json().data, A_TEACHERS)
  })

  test('başka kurumun verisi iki ucun toplamına girmez; kimlikler çakışsa da', async () => {
    const a = await institution(70)
    // B: aynı kimlikli öğretmen ve sınıfa yığılan kayıtlar ile yalnız B'de olan kayıtlar.
    const b = await institution(10, {}, [
      item('teachers', {
        id: 'mt-b-only',
        name: 'B Öğretmeni',
        attendanceRate: 50,
        homeworkRate: 50,
      }),
      item('classes', { id: 'mt-b-class', name: 'B-1' }),
      item('students', { id: 'mt-b-s1', classId: 'mt-b-class', isActive: true }),
      item('students', { id: 'mt-b-s2', classId: 'mt-c1', isActive: true }),
      item('grades', { id: 'mt-b-g1', studentId: 'mt-b-s1', score: 5 }),
      item('grades', { id: 'mt-b-g2', studentId: 'mt-s1', score: 0 }),
      item('questions', { id: 'mt-b-q1', teacherId: 'mt-t1', createdAt: at(-100) }),
      item('questions', { id: 'mt-b-q2', teacherId: 'mt-t1', createdAt: at(-90) }),
      item('questions', { id: 'mt-b-q3', teacherId: 'mt-b-only', createdAt: at(-80) }),
    ])
    const classes = await get('/api/v1/class-metrics', a.cookie)
    assert.equal(classes.statusCode, 200, classes.body)
    assert.deepEqual(classes.json().data, A_CLASSES)
    assert.ok(!classes.body.includes('mt-b-'), classes.body)
    const teachers = await get('/api/v1/teacher-metrics', a.cookie)
    assert.equal(teachers.statusCode, 200, teachers.body)
    assert.deepEqual(teachers.json().data, A_TEACHERS)
    assert.ok(!teachers.body.includes('mt-b-'), teachers.body)

    // Sınama geçerli: B kendi verisini görür (sınıf ve öğretmen B'ye özgü satırlarla gelir).
    const bClasses = (await get('/api/v1/class-metrics', b.cookie)).json().data
    assert.ok(bClasses.some((row: { classId: string }) => row.classId === 'mt-b-class'))
    const bTeachers = (await get('/api/v1/teacher-metrics', b.cookie)).json().data
    assert.ok(bTeachers.some((row: { teacherId: string }) => row.teacherId === 'mt-b-only'))
  })

  test('arşivlenmiş öğrenci, not, soru ve öğretmen iki uçta da dışlanır', async () => {
    const a = await institution(70, {}, [
      item('teachers', {
        id: 'mt-t-arch',
        name: 'Arşiv Öğretmeni',
        attendanceRate: 10,
        homeworkRate: 10,
      }),
      item('students', { id: 'mt-s-arch', classId: 'mt-c2', isActive: true }),
      item('students', { id: 'mt-s-arch2', classId: 'mt-c1', isActive: true }),
      item('grades', { id: 'mt-g-arch1', studentId: 'mt-s1', score: 0 }),
      item('grades', { id: 'mt-g-arch2', studentId: 'mt-s-arch2', score: 1 }),
      item('questions', { id: 'mt-q-arch1', teacherId: 'mt-t1', createdAt: at(-90) }),
      item('questions', { id: 'mt-q-arch2', teacherId: 'mt-t-arch', createdAt: at(-90) }),
    ])
    const before = await Promise.all([
      get('/api/v1/class-metrics', a.cookie),
      get('/api/v1/teacher-metrics', a.cookie),
    ])
    // Arşivlenmeden önce kayıtlar sayılır (sınama etkili): sonuç taban sonuçtan farklıdır.
    assert.notDeepEqual(before[0].json().data, A_CLASSES)
    assert.notDeepEqual(before[1].json().data, A_TEACHERS)

    await archive(a.id, 'teachers', ['mt-t-arch'])
    await archive(a.id, 'students', ['mt-s-arch', 'mt-s-arch2'])
    await archive(a.id, 'grades', ['mt-g-arch1', 'mt-g-arch2'])
    await archive(a.id, 'questions', ['mt-q-arch1', 'mt-q-arch2'])

    const classes = await get('/api/v1/class-metrics', a.cookie)
    assert.equal(classes.statusCode, 200, classes.body)
    assert.deepEqual(classes.json().data, A_CLASSES)
    const teachers = await get('/api/v1/teacher-metrics', a.cookie)
    assert.equal(teachers.statusCode, 200, teachers.body)
    assert.deepEqual(teachers.json().data, A_TEACHERS)
    assert.ok(!teachers.body.includes('mt-t-arch'), teachers.body)
  })

  test('geçersiz tarihli soru 500 vermez ve sayılmaz; geçersiz yanıt tarihi yanıtsız sayılır', async () => {
    const a = await institution(70, {}, [
      // Biçime uyan ama takvimde olmayan ya da saat dilimsiz tarih: soru hiçbir sayıya girmez.
      item('questions', { id: 'mt-qd1', teacherId: 'mt-t3', createdAt: '2026-13-01T00:00:00Z' }),
      item('questions', { id: 'mt-qd2', teacherId: 'mt-t3', createdAt: '2026-02-30T00:00:00Z' }),
      item('questions', { id: 'mt-qd3', teacherId: 'mt-t3', createdAt: 'bozuk' }),
      item('questions', { id: 'mt-qd4', teacherId: 'mt-t3', createdAt: '2026-01-01T10:00:00' }),
      item('questions', { id: 'mt-qd5', teacherId: 'mt-t3', createdAt: '2026-01-01T25:00:00Z' }),
      item('questions', { id: 'mt-qd6', teacherId: 'mt-t3' }),
      // Geçerli oluşturma anı, bozuk yanıt anı: yanıtsız (30 saattir bekliyor → ihlal).
      item('questions', {
        id: 'mt-qd7',
        teacherId: 'mt-t3',
        createdAt: at(-30),
        answeredAt: '2026-13-40T00:00:00Z',
      }),
    ])
    const response = await get('/api/v1/teacher-metrics', a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    const row = response
      .json()
      .data.find((value: { teacherId: string }) => value.teacherId === 'mt-t3')
    assert.deepEqual(row, {
      teacherId: 'mt-t3',
      questions: 1,
      breaches: 1,
      slaRate: 0,
      performance: null,
    })
  })

  test('bozuk uyum oranı 500 vermez: yoklama ve ödev oranı 0–100 aralığına sıkıştırılır', async () => {
    const a = await institution(70, {}, [
      item('teachers', { id: 'mt-t4', name: 'Aşırı', attendanceRate: 250, homeworkRate: 250 }),
      item('teachers', { id: 'mt-t5', name: 'Eksi', attendanceRate: -40, homeworkRate: 140 }),
      item('teachers', { id: 'mt-t6', name: 'Metin', attendanceRate: 'yüksek', homeworkRate: 80 }),
      item('teachers', { id: 'mt-t7', name: 'Ondalık', attendanceRate: 33.4, homeworkRate: 66.6 }),
    ])
    const response = await get('/api/v1/teacher-metrics', a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    const rows = response.json().data as { teacherId: string; performance: number | null }[]
    const performance = (id: string) => rows.find((row) => row.teacherId === id)?.performance
    assert.equal(performance('mt-t4'), 100)
    assert.equal(performance('mt-t5'), 67) // (0 + 100 + 100) / 3
    assert.equal(performance('mt-t6'), null)
    assert.equal(performance('mt-t7'), 67) // (33,4 + 66,6 + 100) / 3
    for (const row of rows)
      assert.ok(row.performance === null || (row.performance >= 0 && row.performance <= 100))
  })

  test('modül kapalıysa 403 module_disabled', async () => {
    const a = await institution(70, { enabledModules: { academic: false, learning: false } })
    for (const url of ['/api/v1/class-metrics', '/api/v1/teacher-metrics']) {
      const response = await get(url, a.cookie)
      assert.equal(response.statusCode, 403, response.body)
      assert.equal(response.json().code, 'module_disabled')
    }
  })

  test('academic kapalıyken yalnız sınıf ölçüsü, learning kapalıyken yalnız öğretmen ölçüsü kapanır', async () => {
    const noAcademic = await institution(70, { enabledModules: { academic: false } })
    const closedClass = await get('/api/v1/class-metrics', noAcademic.cookie)
    assert.equal(closedClass.statusCode, 403, closedClass.body)
    assert.equal(closedClass.json().code, 'module_disabled')
    const openTeacher = await get('/api/v1/teacher-metrics', noAcademic.cookie)
    assert.equal(openTeacher.statusCode, 200, openTeacher.body)
    assert.deepEqual(openTeacher.json().data, A_TEACHERS)

    const noLearning = await institution(70, { enabledModules: { learning: false } })
    const closedTeacher = await get('/api/v1/teacher-metrics', noLearning.cookie)
    assert.equal(closedTeacher.statusCode, 403, closedTeacher.body)
    assert.equal(closedTeacher.json().code, 'module_disabled')
    const openClass = await get('/api/v1/class-metrics', noLearning.cookie)
    assert.equal(openClass.statusCode, 200, openClass.body)
    assert.deepEqual(openClass.json().data, A_CLASSES)
  })

  test('DOM-YTK-012: dil okulunda iki modül de vardır; kurum türünde olmayan modül 404 döner', async () => {
    // `academic` ve `learning` her iki kurum türünde bulunur: dil okulu 200 alır.
    assert.ok(moduleAvailableFor('academic', 'language_school'))
    assert.ok(moduleAvailableFor('learning', 'language_school'))
    const language = await institution(70, { type: 'language_school' })
    for (const url of ['/api/v1/class-metrics', '/api/v1/teacher-metrics'])
      assert.equal((await get(url, language.cookie)).statusCode, 200, url)

    // Katalogda bu iki modülü barındırmayan bir tür olsaydı uç 404 verirdi: kurum türü katalogda
    // olmayan bir değere çevrilir (ayar ekranı bu değeri üretemez, yalnız korumayı sınar).
    const unknown = await institution(70)
    await db
      .update(institutions)
      .set({ type: sql`'olmayan-tur'` as never })
      .where(eq(institutions.id, unknown.id))
    for (const url of ['/api/v1/class-metrics', '/api/v1/teacher-metrics']) {
      const response = await get(url, unknown.cookie)
      assert.equal(response.statusCode, 404, `${url}: ${response.body}`)
      assert.equal(response.json().code, 'not_found')
    }
  })

  test('performans: soru yoksa uyum 100, oran eksikse null, bozuk oran 0–100 aralığına iner', () => {
    assert.deepEqual(
      teacherPerformance({ attendanceRate: 400, homeworkRate: -10, questions: 2, breaches: 5 }),
      { slaRate: 0, performance: 33 },
    )
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
