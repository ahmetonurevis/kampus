import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'
import {
  ownSlotTeacher,
  teacherSlotRows,
  TEACHER_SLOT_SOURCES,
} from '../src/pages/communication/teacher-availability.ts'

const NOW = '2026-10-30T09:00:00.000Z'
const teacher: Session = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] }
const admin: Session = { role: 'yonetici' }

function build() {
  const state = structuredClone(createSeed(new Date(NOW)))
  state.availability = [
    { id: 'a-past', teacherId: 't1', date: '2026-10-29T10:00:00.000Z', duration: 30 },
    { id: 'a-late', teacherId: 't1', date: '2026-11-04T10:00:00.000Z', duration: 30 },
    { id: 'a-booked', teacherId: 't1', date: '2026-11-02T10:00:00.000Z', duration: 30 },
    { id: 'a-other', teacherId: 't2', date: '2026-11-03T10:00:00.000Z', duration: 30 },
    { id: 'a-old', teacherId: 't1', date: '2026-11-05T10:00:00.000Z', duration: 30 },
  ]
  const base = state.appointments[0]
  assert.ok(base)
  state.appointments = [
    { ...base, id: 'p1', teacherId: 't1', slotId: 'a-booked', status: 'Bekliyor' },
    // Saati bilinmeyen eski randevu aynı aralıktaki saati tutar.
    {
      ...base,
      id: 'p2',
      teacherId: 't1',
      date: '2026-11-05T10:10:00.000Z',
      duration: 30,
      status: 'Onaylandı',
    },
  ]
  delete state.appointments[1]?.slotId
  return state
}

test('müsaitlik satırları yalnız öğretmenin gelecek saatlerini artan sırada verir', () => {
  const rows = teacherSlotRows(build(), teacher, NOW)
  assert.deepEqual(
    rows.map((row) => row.id),
    ['a-booked', 'a-late', 'a-old'],
  )
  assert.ok(rows.every((row) => row.duration === 30))
  assert.match(rows[0]?.time ?? '', /^\d{2}:\d{2}$/)
  assert.deepEqual(teacherSlotRows(build(), admin, NOW), [])
})

test('bekleyen/onaylı randevuya bağlı saat Dolu, kapanmış randevu saati boş bırakır (DOM-ILT-101)', () => {
  const state = build()
  const status = (id: string) => teacherSlotRows(state, teacher, NOW).find((r) => r.id === id)
  assert.equal(status('a-booked')?.status, 'Dolu')
  assert.equal(status('a-old')?.status, 'Dolu')
  assert.equal(status('a-late')?.status, 'Müsait')
  assert.equal(status('a-late')?.booked, false)
  for (const closed of ['Reddedildi', 'İptal', 'Geri çekildi'] as const)
    for (const item of state.appointments) item.status = closed
  assert.ok(teacherSlotRows(state, teacher, NOW).every((row) => !row.booked))
})

test('forma bağlanan öğretmen oturumdaki öğretmendir; etkin değilse ya da yoksa bağlanmaz', () => {
  const state = build()
  assert.deepEqual(ownSlotTeacher(state, teacher)?.id, 't1')
  assert.equal(ownSlotTeacher(state, admin), undefined)
  const own = state.teachers.find((item) => item.id === 't1')
  assert.ok(own)
  own.isActive = false
  assert.equal(ownSlotTeacher(state, teacher), undefined)
  assert.equal(TEACHER_SLOT_SOURCES[0], 'availability')
})
