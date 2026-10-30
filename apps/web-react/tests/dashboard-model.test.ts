import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { CollectionCounts } from '@kampus/react-shared/collections.ts'
import {
  attendanceSummary,
  campusOccupancy,
  dashboardHref,
  firstName,
  hasTrendData,
  invoiceStatusSlices,
  monthlyPoints,
  monthRangeStart,
  monthSlices,
  outstandingAmount,
  overallAverage,
  subjectAverageRows,
  trendSummary,
  weeklyPoints,
  weekSlices,
} from '../src/pages/dashboard/dashboard-model.ts'

const counts = (
  groups: CollectionCounts['groups'],
  sum?: number,
  total = groups.reduce((n, group) => n + group.count, 0),
): CollectionCounts => ({ groups, total, ...(sum === undefined ? {} : { sum }) })

describe('bağlantılar ve adlar', () => {
  test('ilk ad boşluklardan ayrılır', () => {
    assert.equal(firstName('  Selin   Kaya '), 'Selin')
    assert.equal(firstName(''), '')
  })

  test('filtre adreste taşınır; velide seçili çocuk eklenir, boş değer yazılmaz', () => {
    assert.equal(
      dashboardHref('yonetici', 'finans', { durum: 'gecikmis' }),
      '/yonetici/finans?durum=gecikmis',
    )
    assert.equal(dashboardHref('ogrenci', 'odevler'), '/ogrenci/odevler')
    assert.equal(
      dashboardHref('veli', 'akademik-takip', { sekme: 'notlar', bos: '' }, 's2'),
      '/veli/akademik-takip?cocuk=s2&sekme=notlar',
    )
    // Veli dışında çocuk parametresi eklenmez.
    assert.equal(dashboardHref('ogretmen', 'yoklama', {}, 's2'), '/ogretmen/yoklama')
  })
})

describe('taksit dağılımı', () => {
  test('durumlar öncelik sırasıyla, kayıt olmayan durum sıfırla gelir', () => {
    const slices = invoiceStatusSlices(
      counts(
        [
          { value: 'Gecikmiş', count: 2, sum: 250_000 },
          { value: 'Ödendi', count: 6, sum: 750_000 },
        ],
        1_000_000,
      ),
    )
    assert.deepEqual(
      slices.map(({ key, count, amount, share }) => [key, count, amount, share]),
      [
        ['gecikmis', 2, 250_000, 25],
        ['yaklasan', 0, 0, 0],
        ['odendi', 6, 750_000, 75],
      ],
    )
    assert.equal(slices[0]?.label, 'Gecikmiş')
  })

  test('toplam yoksa pay sıfırdır; ödenmemiş tutar gecikmiş + yaklaşandır', () => {
    assert.ok(invoiceStatusSlices(counts([])).every((slice) => slice.share === 0))
    assert.equal(
      outstandingAmount(
        counts(
          [
            { value: 'Gecikmiş', count: 1, sum: 100 },
            { value: 'Yaklaşan', count: 2, sum: 300 },
            { value: 'Ödendi', count: 5, sum: 900 },
          ],
          1300,
        ),
      ),
      400,
    )
  })
})

describe('yoklama özeti', () => {
  test('katılım geldi + geç geldi üzerinden; kayıt yoksa oran yok', () => {
    const summary = attendanceSummary(
      counts([
        { value: 'absent', count: 1 },
        { value: 'late', count: 1 },
        { value: 'present', count: 6 },
      ]),
    )
    assert.deepEqual(summary, { present: 6, absent: 1, late: 1, excused: 0, total: 8, rate: 88 })
    assert.equal(attendanceSummary(counts([])).rate, null)
  })
})

describe('haftalık seri', () => {
  test('bugünün haftası dahil sekiz pazartesi, eskiden yeniye', () => {
    // 2026-10-30 cuma; haftası 26 Ekim pazartesi.
    const slices = weekSlices('2026-10-30')
    assert.equal(slices.length, 8)
    assert.deepEqual(slices.at(-1), { from: '2026-10-26', to: '2026-11-01', label: '26 Eki' })
    assert.equal(slices[0]?.from, '2026-09-07')
    assert.equal(slices[1]?.from, '2026-09-14')
  })

  test('dilim sayımlarından istenen grup; veri yoksa grafik yok ve özet bunu söyler', () => {
    const slices = weekSlices('2026-10-30', 3)
    const points = weeklyPoints(
      slices,
      [
        counts([{ value: 'absent', count: 2 }]),
        counts([{ value: 'present', count: 4 }]),
        counts([
          { value: 'absent', count: 1 },
          { value: 'late', count: 3 },
        ]),
      ],
      'absent',
    )
    assert.deepEqual(
      points.map((point) => point.value),
      [2, 0, 1],
    )
    assert.equal(hasTrendData(points), true)
    assert.equal(
      trendSummary(points, 'gün devamsızlık'),
      'Son 3 haftada toplam 3 gün devamsızlık. En yüksek: 12 Eki haftası (2). Bu hafta: 1.',
    )
    const empty = points.map((point) => ({ ...point, value: 0 }))
    assert.equal(hasTrendData(empty), false)
    assert.equal(trendSummary(empty, 'gün devamsızlık'), 'Son 3 haftada gün devamsızlık kaydı yok.')
    assert.equal(trendSummary([], 'x'), '')
  })
})

describe('not ortalamaları', () => {
  test('ders ortalaması sum / count, ders adına göre Türkçe sıralı; genel ortalama meta’dan', () => {
    const grades = counts(
      [
        { value: 'math', count: 2, sum: 171 },
        { value: 'eng', count: 3, sum: 240 },
        { value: null, count: 1, sum: 50 },
      ],
      461,
    )
    const names = new Map([
      ['math', 'Matematik'],
      ['eng', 'İngilizce'],
    ])
    assert.deepEqual(subjectAverageRows(grades, names), [
      { subjectId: 'eng', name: 'İngilizce', average: 80, count: 3 },
      { subjectId: 'math', name: 'Matematik', average: 86, count: 2 },
    ])
    assert.equal(overallAverage(grades), 77)
    assert.equal(overallAverage(counts([])), null)
  })
})

describe('aylık seri', () => {
  test('bugünün ayı dahil altı ay, yıl sınırını aşar ve eskiden yeniye sıralanır', () => {
    const slices = monthSlices('2026-02-10')
    assert.deepEqual(
      slices.map((slice) => slice.key),
      ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'],
    )
    assert.equal(monthRangeStart(slices), '2025-09-01')
  })

  test('sunucunun YYYY-MM gruplarından değer; grubu olmayan ay sıfır', () => {
    const slices = monthSlices('2026-10-30', 3)
    const grouped = counts(
      [
        { value: '2026-08', count: 2, sum: 5000 },
        { value: '2026-10', count: 1, sum: 2500 },
        { value: null, count: 4, sum: 100 },
      ],
      7600,
    )
    assert.deepEqual(
      monthlyPoints(slices, grouped, 'sum').map((point) => point.value),
      [5000, 0, 2500],
    )
    assert.deepEqual(
      monthlyPoints(slices, grouped).map((point) => point.value),
      [2, 0, 1],
    )
  })
})

describe('kampüs doluluğu', () => {
  test('sınıf sayımı sınıfın kampüsüyle birleşir; kontenjan yoksa yüzde sıfır', () => {
    const rows = campusOccupancy(
      [
        { id: 'b1', name: 'Merkez' },
        { id: 'b2', name: 'Kuzey' },
        { id: 'b3', name: 'Yeni' },
      ],
      new Map([
        ['c1', 'b1'],
        ['c2', 'b1'],
        ['c3', 'b2'],
      ]),
      counts([
        { value: 'c1', count: 20 },
        { value: 'c2', count: 10 },
        { value: 'c3', count: 30 },
        { value: 'c9', count: 5 },
      ]),
      counts(
        [
          { value: 'b1', count: 2, sum: 60 },
          { value: 'b2', count: 1, sum: 24 },
        ],
        84,
      ),
    )
    assert.deepEqual(rows, [
      { id: 'b1', name: 'Merkez', students: 30, capacity: 60, percentage: 50 },
      { id: 'b2', name: 'Kuzey', students: 30, capacity: 24, percentage: 100 },
      { id: 'b3', name: 'Yeni', students: 0, capacity: 0, percentage: 0 },
    ])
  })
})
