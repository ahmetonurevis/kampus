import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { FIXED_NOW, TEST_ORIGIN } from './support/app.ts'
import {
  app,
  assertError,
  classStudents,
  count,
  DAY,
  db,
  institution,
  marksFor,
  member,
  OUTSIDE_TEACHER,
  post,
  REASON,
  SEED,
  useCommandsHarness,
  version,
} from './support/commands-harness.ts'

/**
 * Yoklamada geç gelme, toplu işaretleme ve tarih aralığı (OG-042, IST-093; DOM-AKD-036).
 * `POST /classes/:classId/attendance` `lateMinutes` alır; geç gelme "gelmedi" bildirimi üretmez.
 * `GET /collections/attendance` `dateFrom`/`dateTo` aralığını sayfalamadan önce süzer; ters ya
 * da 1 yıldan uzun aralık 400'dür.
 */

const URL = '/api/v1/classes/c1/attendance'
const students = classStudents('c1')
const [first, second, third] = students
if (!first || !second || !third) throw new Error('örnek veride c1 öğrencileri eksik')
const FIRST_ID = first.id

describe('DOM-AKD-036: yoklamada geç gelme dakikası', () => {
  useCommandsHarness()

  const stored = async (institutionId: string) =>
    new Map(
      (await loadRecords(db, institutionId, ['attendance'])).map((row) => [
        row.data.studentId as string,
        row.data,
      ]),
    )

  test('geç gelen öğrencinin dakikası kayda yazılır; dakikasız geç gelme geçerlidir', async () => {
    const a = await institution()
    const response = await post(URL, a.adminCookie, {
      date: DAY,
      marks: { ...marksFor('c1'), [first.id]: 'late', [second.id]: 'late' },
      lateMinutes: { [first.id]: 15 },
      reason: REASON,
    })
    assert.equal(response.statusCode, 200, response.body)
    const rows = await stored(a.id)
    assert.deepEqual([rows.get(first.id)?.status, rows.get(first.id)?.lateMinutes], ['late', 15])
    assert.deepEqual(
      [rows.get(second.id)?.status, rows.get(second.id)?.lateMinutes],
      ['late', undefined],
    )
    assert.equal(rows.get(third.id)?.lateMinutes, undefined)
  })

  test('IST-093: toplu yazma tek işlemdir; aynı gün ikinci gönderim yinelemez, değişen dakika geçmişe düşer', async () => {
    const a = await institution()
    const teacher = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    // Tümünü geldi işaretle: sınıfın tüm kayıtları tek istekte yazılır.
    const all = await post(URL, teacher, { date: DAY, marks: marksFor('c1') })
    assert.equal(all.statusCode, 200, all.body)
    assert.equal(all.json().data.changes.inserted, students.length)
    // Seçili satırlara toplu "geç geldi": yalnız durumu değişenler güncellenir.
    const bulk = Object.fromEntries([first, second].map((student) => [student.id, 'late']))
    const marks = { ...marksFor('c1'), ...bulk }
    const late = await post(URL, teacher, {
      date: DAY,
      marks,
      lateMinutes: { [first.id]: 10, [second.id]: 10 },
    })
    assert.equal(late.statusCode, 200, late.body)
    assert.deepEqual(late.json().data.changes, {
      inserted: 0,
      updated: 2,
      archived: 0,
      restored: 0,
    })
    // Aynı istek yeniden: değişen yok, kayıt yinelenmez.
    const same = await post(URL, teacher, {
      date: DAY,
      marks,
      lateMinutes: { [first.id]: 10, [second.id]: 10 },
    })
    assert.equal(same.statusCode, 200, same.body)
    assert.deepEqual(same.json().data.changes, {
      inserted: 0,
      updated: 0,
      archived: 0,
      restored: 0,
    })
    assert.equal(await count(a.id, 'attendance'), students.length)
    // Dakika değişince düzeltme geçmişine eski ve yeni değer yazılır.
    const changed = await post(URL, teacher, {
      date: DAY,
      marks,
      lateMinutes: { [first.id]: 20, [second.id]: 10 },
    })
    assert.equal(changed.statusCode, 200, changed.body)
    const row = (await stored(a.id)).get(first.id)
    assert.equal(row?.lateMinutes, 20)
    const corrections = row?.corrections as { previousLateMinutes?: number; lateMinutes?: number }[]
    assert.deepEqual(
      corrections.map((c) => [c.previousLateMinutes, c.lateMinutes]),
      [
        [undefined, 10],
        [10, 20],
      ],
    )
    assert.equal(await count(a.id, 'attendance'), students.length)
  })

  test('geçersiz dakika 400, gelmeyen ya da ders süresini aşan dakika 422; hiçbir kayıt ve sürüm değişmez', async () => {
    const a = await institution()
    const classVersion = await version(a.id, 'classes', 'c1')
    const marks = { ...marksFor('c1'), [first.id]: 'late' }
    const send = (lateMinutes: unknown) =>
      post(URL, a.adminCookie, { date: DAY, marks, lateMinutes, reason: REASON })
    for (const bad of [0, -3, 2.5, '10', null])
      assertError(await send({ [first.id]: bad }), 400, 'validation_failed')
    // c1'in ders süresi 40 dakikadır (örnek program).
    assertError(await send({ [first.id]: 41 }), 422, 'late_minutes_out_of_range')
    assertError(await send({ [second.id]: 5 }), 422, 'late_minutes_without_late')
    assertError(await send({ yabanci: 5 }), 422, 'late_minutes_without_late')
    assert.equal(await count(a.id, 'attendance'), 0)
    assert.equal(await version(a.id, 'classes', 'c1'), classVersion)
    // Sınırdaki değer kabul edilir.
    assert.equal((await send({ [first.id]: 40 })).statusCode, 200)
  })

  test('DOM-AKD-036: ders süresi sınırı yalnız sınıfın kendi derslerinden gelir; başka sınıfın dersi etkilemez', async () => {
    const a = await institution()
    const lesson = (classId: string, duration: number) => {
      const id = `test-late-lesson-${classId}-${duration}`
      return {
        collection: 'schedule' as const,
        id,
        data: {
          id,
          classId,
          teacherId: 't1',
          subjectId: 'math',
          date: `${DAY}T06:00:00.000Z`,
          duration,
          title: 'Matematik',
          room: '101',
        },
      }
    }
    // c2'nin o günkü 90 dakikalık dersi c1'in sınırını (40 dk) yükseltmez.
    await insertMissingRecords(db, a.id, [lesson('c2', 90)], FIXED_NOW)
    const marks = { ...marksFor('c1'), [first.id]: 'late' }
    const send = (minutes: number) =>
      post(URL, a.adminCookie, {
        date: DAY,
        marks,
        lateMinutes: { [first.id]: minutes },
        reason: REASON,
      })
    assertError(await send(41), 422, 'late_minutes_out_of_range')
    // c1'in kendi 90 dakikalık dersi (kısmi yükleme onu da getirir) sınırı yükseltir.
    await insertMissingRecords(db, a.id, [lesson('c1', 90)], FIXED_NOW)
    assert.equal((await send(90)).statusCode, 200)
    assertError(await send(91), 422, 'late_minutes_out_of_range')
  })

  test('geç gelme "gelmedi" bildirimi üretmez; gelmedi düzeltilirse düzeltme bildirimi gider', async () => {
    const a = await institution()
    const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: first.id }])
    const notified = async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: { origin: TEST_ORIGIN, cookie: parent },
      })
      assert.equal(response.statusCode, 200, response.body)
      return (response.json().data as { kind: string }[]).map((item) => item.kind)
    }
    const take = async (status: string, minutes: Record<string, number> = {}) =>
      assert.equal(
        (
          await post(URL, a.adminCookie, {
            date: DAY,
            marks: { ...marksFor('c1'), [first.id]: status },
            lateMinutes: minutes,
            reason: REASON,
          })
        ).statusCode,
        200,
      )
    await take('late', { [first.id]: 10 })
    await take('late', { [first.id]: 25 })
    assert.deepEqual(await notified(), [])
    await take('absent')
    assert.deepEqual(await notified(), ['absence_recorded'])
    await take('late', { [first.id]: 5 })
    assert.deepEqual((await notified()).toSorted(), ['absence_corrected', 'absence_recorded'])
  })

  test('401, 403 (öğrenci, kapsam dışı öğretmen), başka kurumun sınıfı 404; kayıt yazılmaz', async () => {
    const a = await institution()
    const b = await institution()
    const body = {
      date: DAY,
      marks: { ...marksFor('c1'), [first.id]: 'late' },
      lateMinutes: { [first.id]: 10 },
    }
    assertError(await post(URL, null, body), 401)
    const student = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: first.id }])
    assertError(await post(URL, student, body), 403, 'forbidden')
    const outside = await member(a.id, 'ogretmen', [
      { kind: 'teacher', recordId: OUTSIDE_TEACHER.id },
    ])
    assertError(await post(URL, outside, body), 403, 'attendance_class_forbidden')
    const foreign = { ...SEED.classes[0], id: 'test-late-b-only' }
    await insertMissingRecords(
      db,
      b.id,
      [{ collection: 'classes', id: foreign.id, data: foreign }],
      FIXED_NOW,
    )
    assertError(
      await post(`/api/v1/classes/${foreign.id}/attendance`, a.adminCookie, {
        ...body,
        reason: REASON,
      }),
      404,
      'not_found',
    )
    assert.equal(await count(a.id, 'attendance'), 0)
    assert.equal(await count(b.id, 'attendance'), 0)
  })
})

describe('IST-093: yoklama geçmişi tarih aralığı', () => {
  useCommandsHarness()

  const row = (studentId: string, day: string) => ({
    collection: 'attendance' as const,
    id: `att-test-${studentId}-${day}`,
    data: {
      id: `att-test-${studentId}-${day}`,
      studentId,
      classId: 'c1',
      date: `${day}T09:00:00.000Z`,
      status: 'present',
      reason: '',
    },
  })
  const DAYS = ['2025-05-01', '2025-11-02', '2026-03-10', '2026-10-05', '2026-10-06']

  async function seeded() {
    const a = await institution()
    await insertMissingRecords(
      db,
      a.id,
      DAYS.map((day) => row(FIRST_ID, day)),
      FIXED_NOW,
    )
    return a
  }
  const list = (cookie: string, query: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/collections/attendance?${query}`,
      headers: { origin: TEST_ORIGIN, cookie },
    })
  const dates = (body: { data: { record: { date: string } }[] }) =>
    body.data.map((item) => item.record.date.slice(0, 10)).toSorted()

  test('aralık sunucuda süzülür, iki uç dahil; toplam sayfalamadan önceki süzülmüş sayıdır', async () => {
    const a = await seeded()
    const response = await list(
      a.adminCookie,
      'dateFrom=2026-03-10&dateTo=2026-10-05&sort=date&pageSize=1&page=2',
    )
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.meta.total, 2)
    assert.equal(body.data.length, 1)
    const all = (await list(a.adminCookie, 'dateFrom=2026-03-10&dateTo=2026-10-05')).json()
    assert.deepEqual(dates(all), ['2026-03-10', '2026-10-05'])
    const open = (await list(a.adminCookie, 'dateFrom=2026-10-05')).json()
    assert.deepEqual(dates(open), ['2026-10-05', '2026-10-06'])
  })

  test('bitiş başlangıçtan önceyse ve aralık 1 yıldan uzunsa 400 ve Türkçe alan mesajı', async () => {
    const a = await seeded()
    const reversed = await list(a.adminCookie, 'dateFrom=2026-10-06&dateTo=2026-10-05')
    assert.equal(reversed.statusCode, 400, reversed.body)
    assert.match(reversed.body, /Bitiş günü başlangıç gününden önce olamaz/)
    const long = await list(a.adminCookie, 'dateFrom=2025-10-05&dateTo=2026-10-06')
    assert.equal(long.statusCode, 400, long.body)
    assert.equal(long.json().code, 'validation_failed')
    assert.deepEqual(
      long.json().issues?.map((issue: { path: string[] }) => issue.path),
      [['dateTo']],
    )
    assert.match(long.body, /Tarih aralığı en fazla 1 yıl olabilir/)
    // Tam bir yıl (iki uç dahil) geçerlidir.
    const exact = await list(a.adminCookie, 'dateFrom=2025-10-06&dateTo=2026-10-06')
    assert.equal(exact.statusCode, 200, exact.body)
    // Sayım ucu aynı denetimi uygular.
    const counts = await app.inject({
      method: 'GET',
      url: '/api/v1/collections/attendance/counts?groupBy=status&dateFrom=2024-01-01&dateTo=2026-10-06',
      headers: { origin: TEST_ORIGIN, cookie: a.adminCookie },
    })
    assert.equal(counts.statusCode, 400, counts.body)
  })

  test('oturumsuz 401; veli yalnız çocuğunun kaydını görür ve aynı aralık denetimi uygulanır', async () => {
    const a = await seeded()
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/collections/attendance?dateFrom=2026-01-01',
    })
    assert.equal(anonymous.statusCode, 401)
    const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: first.id }])
    const own = await list(parent, 'dateFrom=2026-10-05&dateTo=2026-10-06')
    assert.equal(own.statusCode, 200, own.body)
    assert.deepEqual(dates(own.json()), ['2026-10-05', '2026-10-06'])
    const other = await member(a.id, 'veli', [{ kind: 'child', recordId: second.id }])
    assert.equal((await list(other, 'dateFrom=2026-10-05&dateTo=2026-10-06')).json().meta.total, 0)
    assert.equal((await list(parent, 'dateFrom=2024-01-01&dateTo=2026-10-06')).statusCode, 400)
  })
})
