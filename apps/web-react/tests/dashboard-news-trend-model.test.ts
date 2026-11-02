import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import type { AnnouncementRecord } from '@kampus/react-shared/announcement-model.ts'
import type { CollectionRow } from '@kampus/react-shared/collections.ts'
import {
  gradeTrendSummary,
  hasGradeTrend,
  monthlyGradePoints,
} from '../src/pages/dashboard/dashboard-grade-trend-model.ts'
import { newsExcerpt, newsItems } from '../src/pages/dashboard/dashboard-news-model.ts'
import { openQuestions } from '../src/pages/dashboard/dashboard-teacher-model.ts'

// Genel Bakış "Kampüsten haberler", "Yanıt bekleyen sorular" ve not ortalaması eğilimi (OG-226):
// haber seçimi, aylık ortalama kovaları, az veri ve soru sayacı.

const NOW = new Date('2026-10-15T09:00:00.000Z')
const wrap = <T extends { id: string }>(record: T): CollectionRow<T> => ({
  id: record.id,
  version: 1,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  archivedAt: null,
  record,
})

const news = (id: string, extra: Partial<AnnouncementRecord> = {}) =>
  wrap<AnnouncementRecord>({
    id,
    title: `Duyuru ${id}`,
    text: 'Metin',
    date: '2026-10-10T09:00:00.000Z',
    category: 'Etkinlik',
    ...extra,
  })

test('haber: gelen sırayla ilk üç duyuru seçilir, sunucu sırası değiştirilmez', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => news(id))
  assert.deepEqual(
    newsItems(rows).map((row) => row.id),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(
    newsItems(rows, 5).map((row) => row.id),
    ['a', 'b', 'c', 'd', 'e'],
  )
})

test('haber: geri çekilen duyuru atlanır ve yerine sıradaki girer (DOM-ILT-004)', () => {
  const rows = [
    news('a', { withdrawnAt: '2026-10-11T09:00:00.000Z' }),
    news('b'),
    news('c'),
    news('d'),
  ]
  assert.deepEqual(
    newsItems(rows).map((row) => row.id),
    ['b', 'c', 'd'],
  )
})

test('haber: duyuru yoksa liste boştur', () => {
  assert.deepEqual(newsItems([]), [])
  assert.deepEqual(newsItems([news('a', { withdrawnAt: '2026-10-11T09:00:00.000Z' })]), [])
})

test('haber: özet kelime ortasında kesilmez, kısa metin olduğu gibi kalır', () => {
  assert.equal(newsExcerpt('  Kısa   metin  '), 'Kısa metin')
  const text =
    'Cuma günü müze gezisi var; öğrenciler formalarıyla gelsin ve yanlarında su getirsin.'
  const cut = newsExcerpt(text, 40)
  assert.ok(cut.endsWith('…'))
  assert.ok(text.startsWith(cut.slice(0, -1)))
  assert.ok(cut.length <= 41)
  assert.ok(!cut.slice(0, -1).endsWith(' '))
})

test('eğilim: aylar kovalanır, ortalama toplam/sayıdan yuvarlanır, eskiden yeniye sıralanır', () => {
  const points = monthlyGradePoints([
    { value: '2026-10', count: 13, sum: 874 },
    { value: '2026-05', count: 10, sum: 540 },
    { value: '2026-09', count: 10, sum: 620 },
  ])
  assert.deepEqual(
    points.map((point) => point.value),
    [54, 62, 67],
  )
  assert.equal(points.length, 3)
  assert.match(points[0]?.label ?? '', /May/)
  assert.match(points[2]?.label ?? '', /Eki/)
})

test('eğilim: tarihsiz grup, geçersiz ay ve notsuz ay serisine girmez', () => {
  const points = monthlyGradePoints([
    { value: null, count: 4, sum: 200 },
    { value: '2026-13', count: 1, sum: 10 },
    { value: 'bilinmiyor', count: 1, sum: 10 },
    { value: '2026-08', count: 0, sum: 0 },
    { value: '2026-09', count: 2, sum: 101 },
  ])
  assert.deepEqual(
    points.map((point) => point.value),
    [51],
  )
})

test('eğilim: yalnız son altı ay gösterilir', () => {
  const groups = Array.from({ length: 9 }, (_, index) => ({
    value: `2026-${String(index + 1).padStart(2, '0')}`,
    count: 1,
    sum: 40 + index,
  }))
  const points = monthlyGradePoints(groups)
  assert.equal(points.length, 6)
  assert.deepEqual(
    points.map((point) => point.value),
    [43, 44, 45, 46, 47, 48],
  )
})

test('eğilim: iki aydan az veride grafik çizilmez', () => {
  assert.equal(hasGradeTrend([]), false)
  assert.equal(hasGradeTrend([{ label: 'Eki 26', value: 70 }]), false)
  assert.equal(
    hasGradeTrend([
      { label: 'Eyl 26', value: 60 },
      { label: 'Eki 26', value: 70 },
    ]),
    true,
  )
  assert.equal(gradeTrendSummary([], 'Not ortalaması'), '')
})

test('eğilim: metin özeti ilk, son, değişim ve en yüksek ayı söyler', () => {
  const text = gradeTrendSummary(
    [
      { label: 'May 26', value: 54 },
      { label: 'Haz 26', value: 80 },
      { label: 'Eki 26', value: 67 },
    ],
    'Not ortalaması',
  )
  assert.equal(
    text,
    'Not ortalaması May 26 ayında 54, Eki 26 ayında 67 (13 puan arttı). En yüksek ay: Haz 26 (80).',
  )
  assert.match(
    gradeTrendSummary(
      [
        { label: 'Eyl 26', value: 70 },
        { label: 'Eki 26', value: 60 },
      ],
      'X',
    ),
    /10 puan azaldı/,
  )
  assert.match(
    gradeTrendSummary(
      [
        { label: 'Eyl 26', value: 70 },
        { label: 'Eki 26', value: 70 },
      ],
      'X',
    ),
    /değişmedi/,
  )
})

const seed = createSeed(NOW)
const base = seed.questions[0]
if (!base) throw new Error('örnek veride soru bekleniyor')
const question = (id: string, createdAt: string, extra: Record<string, unknown> = {}) =>
  wrap({ ...base, id, createdAt, answeredAt: null, answer: '', ...extra })

test('soru sayacı: yalnız yanıtsız ve geri çekilmemiş soru sayılır (DOM-ILT-093)', () => {
  const result = openQuestions(
    [
      question('q1', '2026-10-15T08:00:00.000Z'),
      question('q2', '2026-10-15T07:00:00.000Z', {
        answeredAt: '2026-10-15T08:30:00.000Z',
        answer: 'Yanıt',
      }),
      question('q3', '2026-10-15T06:00:00.000Z', { withdrawnAt: '2026-10-15T06:30:00.000Z' }),
      question('q4', '2026-10-15T05:00:00.000Z'),
    ],
    NOW.toISOString(),
  )
  assert.equal(result.total, 2)
  assert.deepEqual(
    result.items.map((row) => row.id),
    ['q4', 'q1'],
  )
})

test('soru sayacı: liste en eski üç soruyla sınırlıdır, sayı sınırlanmaz', () => {
  const rows = [1, 2, 3, 4, 5].map((n) => question(`q${n}`, `2026-10-15T0${n}:00:00.000Z`))
  const result = openQuestions(rows, NOW.toISOString())
  assert.equal(result.total, 5)
  assert.deepEqual(
    result.items.map((row) => row.id),
    ['q1', 'q2', 'q3'],
  )
})

test('soru sayacı: süresi aşılan soru ayrı sayılır, kuyruk boşsa sıfır döner (DOM-ILT-013)', () => {
  const later = new Date('2026-10-20T09:00:00.000Z').toISOString()
  const result = openQuestions([question('q1', '2026-10-15T08:00:00.000Z')], later)
  assert.equal(result.total, 1)
  assert.equal(result.overdue, 1)
  assert.equal(
    openQuestions([question('q1', '2026-10-15T08:00:00.000Z')], NOW.toISOString()).overdue,
    0,
  )
  assert.deepEqual(openQuestions([], NOW.toISOString()), { total: 0, overdue: 0, items: [] })
})
