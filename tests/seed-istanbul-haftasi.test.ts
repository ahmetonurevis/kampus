import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { dayKey } from '../packages/school-core/src/lib/format.ts'

// Örnek veri haftası ekranın gösterdiği haftayla aynıdır: hafta İstanbul gününe göre seçilir
// (OG-971). Önceki davranışta pazartesi 00.00–03.00 (İstanbul) arasında seed bir önceki UTC
// haftasından başlıyordu. İstanbul sabit +03'tür (yaz/kış farkı yok).

/** Gün anahtarının (YYYY-AA-GG) ait olduğu haftanın pazartesisi. */
function mondayOf(key: string): string {
  const day = new Date(`${key}T12:00:00.000Z`)
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day.toISOString().slice(0, 10)
}

function addDays(key: string, days: number): string {
  const day = new Date(`${key}T12:00:00.000Z`)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

const CASES: [string, string, string][] = [
  ['pazartesi 00.30 İstanbul (pazar 21.30 UTC)', '2026-11-01T21:30:00Z', '2026-11-02'],
  ['pazartesi 02.59 İstanbul', '2026-11-01T23:59:00Z', '2026-11-02'],
  ['pazartesi 03.30 İstanbul', '2026-11-02T00:30:00Z', '2026-11-02'],
  ['pazartesi öğlen İstanbul', '2026-11-02T09:00:00Z', '2026-11-02'],
  ['pazar 23.59 İstanbul', '2026-11-01T20:59:00Z', '2026-10-26'],
  ['pazar öğlen İstanbul', '2026-11-01T09:00:00Z', '2026-10-26'],
  ['cumartesi 23.30 İstanbul', '2026-11-07T20:30:00Z', '2026-11-02'],
  ['yaz saatinde pazartesi 00.30 İstanbul', '2026-07-05T21:30:00Z', '2026-07-06'],
]

for (const [name, now, monday] of CASES) {
  test(`seed ders programı İstanbul pazartesisinden başlar: ${name} (OG-971)`, () => {
    assert.equal(mondayOf(dayKey(now)), monday, 'test beklentisi tutarsız')
    const { schedule } = createSeed(new Date(now))
    const days = [...new Set(schedule.map((lesson) => dayKey(lesson.date)))].sort()
    assert.equal(days[0], monday)
    // İki hafta: pazartesi–cuma, bir sonraki pazartesi–cuma; hafta sonu ders yok.
    assert.deepEqual(
      days,
      [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((n) => addDays(monday, n)),
    )
    // Ekranın gösterdiği haftada (İstanbul) ders vardır.
    assert.ok(days.some((day) => mondayOf(day) === mondayOf(dayKey(now))))
  })
}

test('UTC ve İstanbul pazartesisinin aynı olduğu saatlerde ilk gün o pazartesidir (OG-971)', () => {
  for (const now of ['2026-11-02T00:30:00Z', '2026-11-04T10:00:00Z', '2026-11-08T20:59:00Z']) {
    const { schedule } = createSeed(new Date(now))
    const first = schedule.map((lesson) => lesson.date).sort()[0]
    assert.equal(first?.slice(0, 10), '2026-11-02')
  }
})

test('seed kimlikleri hafta düzeltmesinden etkilenmez (OG-971)', () => {
  const a = createSeed(new Date('2026-11-01T21:30:00Z')).schedule.map((lesson) => lesson.id)
  const b = createSeed(new Date('2026-11-02T09:00:00Z')).schedule.map((lesson) => lesson.id)
  assert.deepEqual(a, b)
})
