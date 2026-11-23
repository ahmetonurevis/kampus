import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createSeed } from '../packages/school-core/src/data/seed.ts'

// Örnek veri iki kaynaktan gelir (OG-011): kayıt ve finans verisi `data/seed.ts`'teki
// `// Onur: kayıt ve finans` bloklarında, geri kalan üreticiler `platform/seed-*.ts` dosyalarında.
// İşaret kayarsa ya da Onur verisi platform dosyasına sızarsa bu test yakalar.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const seedSource = read('../packages/school-core/src/data/seed.ts')
const START = '// Onur: kayıt ve finans\n'
const END = '// Onur: kayıt ve finans sonu'
const ONUR_COLLECTIONS = ['invoices', 'prospects', 'contracts', 'renewals', 'enrollmentHistory']

test('seed.ts Onur blokları başlangıç ve bitiş işaretiyle eşleşir (OG-011)', () => {
  const count = (marker: string) => seedSource.split(marker).length - 1
  assert.ok(count(START) >= 1, 'Onur bloğu bulunamadı')
  assert.equal(count(START), count(END), 'başlangıç ve bitiş işaretleri eşleşmiyor')
})

test('Kayıt ve finans örnek veri koleksiyonları platform seed dosyalarında üretilmez (OG-011)', () => {
  const platformDir = new URL('../packages/school-core/src/platform/', import.meta.url)
  const files = readdirSync(platformDir).filter((f) => /^seed-.*\.ts$/.test(f))
  assert.ok(files.length > 0, 'platform seed dosyası bulunamadı')
  for (const file of files) {
    const text = read(`../packages/school-core/src/platform/${file}`)
    for (const name of ONUR_COLLECTIONS)
      assert.equal(new RegExp(`\\b${name}\\b`).test(text), false, `${file}: ${name}`)
  }
})

test('createSeed iki kaynağın koleksiyonlarını birlikte üretir ve deterministiktir (OG-011)', () => {
  const now = new Date('2026-11-02T10:00:00.000Z')
  const state = createSeed(now) as Record<string, unknown>
  for (const key of [...ONUR_COLLECTIONS, 'students', 'parents'])
    assert.ok(Array.isArray(state[key]), key)
  for (const key of [
    'branches',
    'teachers',
    'classes',
    'assignments',
    'grades',
    'attendance',
    'schedule',
    'availability',
    'bank',
    'quizzes',
    'quizAttempts',
    'homework',
    'submissions',
    'questions',
    'videos',
    'materials',
    'announcements',
    'conversations',
    'conversationMessages',
    'appointments',
    'requests',
  ])
    assert.ok(Array.isArray(state[key]) && state[key].length > 0, key)
  assert.deepEqual(createSeed(now), state)
})
