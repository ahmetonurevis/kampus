import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { dateLabel, dayKey, money, timeLabel } from '../packages/school-core/src/lib/format.ts'
import { moduleNavigationState } from '../apps/mobile/src/model/navigation.js'
import { absentCount, gradeAverage, homeSummary, rowsFor } from '../apps/mobile/src/model/school.js'

test('Biçimleyici tekrar kullanımı Türkçe para ve İstanbul gün sınırını korur', () => {
  assert.equal(money(123456), '1.234,56 ₺')
  assert.equal(money(-123456), '-1.234,56 ₺')
  assert.equal(dayKey('2026-09-30T20:59:59.000Z'), '2026-09-30')
  assert.equal(dayKey('2026-09-30T21:00:00.000Z'), '2026-10-01')
  assert.equal(timeLabel('2026-09-30T21:00:00.000Z'), '00:00')
  assert.equal(dateLabel(null), '—')
  const date = '2026-09-30T21:00:00.000Z'
  const options = { year: 'numeric', timeZone: 'UTC' }
  assert.equal(
    dateLabel(date, options),
    new Intl.DateTimeFormat('tr-TR', {
      day: 'numeric',
      month: 'short',
      ...options,
    }).format(new Date(date)),
  )
  assert.notEqual(dateLabel(date, options), dateLabel(date, { year: 'numeric' }))
  const Original = Intl.DateTimeFormat
  let constructions = 0
  Intl.DateTimeFormat = new Proxy(Original, {
    construct(target, args) {
      constructions++
      return Reflect.construct(target, args)
    },
  })
  try {
    for (let i = 0; i < 200; i++) {
      dateLabel(date, { weekday: 'narrow', year: '2-digit' })
      dateLabel(date, { year: '2-digit', weekday: 'narrow' })
      dayKey(date)
      timeLabel(date)
    }
    assert.equal(constructions, 1, 'Aynı biçim için her satırda yeni Intl oluşturulmamalı')
  } finally {
    Intl.DateTimeFormat = Original
  }
})

test('Kategori geçişi ana ekran kimliğini korur ve eski detayları yığında biriktirmez', () => {
  const home = { name: 'Home', key: 'home-existing' }
  const current = {
    routes: [home, { name: 'Module', key: 'old-module' }, { name: 'Detail', key: 'old-detail' }],
  }
  const next = moduleNavigationState(current, 'finans')
  assert.equal(next.routes[0], home)
  assert.equal(next.index, 1)
  assert.equal(next.routes.length, 2)
  assert.deepEqual(next.routes[1], { name: 'Module', params: { page: 'finans' } })
  assert.deepEqual(moduleNavigationState(next, 'dashboard'), { index: 0, routes: [home] })
  assert.equal(moduleNavigationState({ routes: [] }, 'finans').routes[0].name, 'Home')
})

test('Hızlı dashboard ve risk özeti bütün veriden hesaplanan sonuçla aynı; ödeme sonrası güncel', () => {
  const data = createSeed(),
    session = { role: 'yonetici', childId: 's1' }
  // Ayın ilk günlerinde doğal örnek veride gecikmiş taksit bulunmayabilir.
  data.invoices
    .filter((i) => !i.paidAt)
    .slice(0, 4)
    .forEach((i) => {
      i.dueDate = new Date(Date.now() - 2 * 86400000).toISOString()
    })
  const expected = rowsFor(data, session, 'finans')
    .filter((r) => r.status === 'Gecikmiş')
    .slice(0, 3)
  assert.deepEqual(homeSummary(data, session).important, expected)
  const risk = data.students.filter(
    (s) => s.isActive && (absentCount(data, s.id) >= 6 || gradeAverage(data, s.id) < 65),
  )
  assert.deepEqual(
    rowsFor(data, session, 'risk-listesi').map((r) => r.id),
    risk.map((r) => r.id),
  )
  const next = structuredClone(data)
  next.invoices.find((i) => i.id === expected[0].id).paidAt = new Date().toISOString()
  const updated = homeSummary(next, session)
  assert.ok(updated.important.every((r) => r.id !== expected[0].id))
  assert.deepEqual(
    updated.important,
    rowsFor(next, session, 'finans')
      .filter((r) => r.status === 'Gecikmiş')
      .slice(0, 3),
  )
  for (const childId of ['s1', 's2']) {
    assert.ok(
      rowsFor(next, { role: 'veli', childId }, 'finans', { limit: 3, overdueOnly: true }).every(
        (r) => r.source.studentId === childId && r.status === 'Gecikmiş',
      ),
    )
  }
})

test('Ana ekran bitmiş dersleri sıradaki ders olarak göstermez; devam eden ve gelecek dersler korunur', () => {
  const data = createSeed()
  const lesson = data.schedule.find((s) => s.classId === data.students[0].classId)
  const now = Date.now()
  data.schedule = [-500, -400, -300, -10, 60, 120, 180].map((minutes, i) => ({
    ...lesson,
    id: `schedule-${i}`,
    teacherId: 't1',
    date: new Date(now + minutes * 60000).toISOString(),
    duration: 40,
  }))
  for (const role of ['ogrenci', 'veli', 'ogretmen']) {
    const summary = homeSummary(data, { role, childId: data.students[0].id })
    assert.deepEqual(
      summary.lessons.map((r) => r.id),
      ['schedule-3', 'schedule-4', 'schedule-5'],
    )
  }
  data.schedule = data.schedule.slice(0, 3)
  assert.deepEqual(homeSummary(data, { role: 'ogrenci', childId: 's1' }).lessons, [])
})
