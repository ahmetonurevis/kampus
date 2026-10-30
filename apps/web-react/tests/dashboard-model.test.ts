import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  attendanceSummary,
  campusOccupancy,
  dashboardHref,
  firstName,
  hasTrendData,
  invoiceStatusSlices,
  monthLabel,
  monthlyPoints,
  outstandingAmount,
  overallAverage,
  sectionVisible,
  subjectAverageRows,
  trendSummary,
  weeklyPoints,
  type InvoiceSummary,
} from '../src/pages/dashboard/dashboard-model.ts'

// Girdi Genel Bakış özetinin (`GET /api/v1/dashboard`) parçalarıdır; hafta/ay dilimleri ve sayımlar
// sunucudadır (apps/api/test/dashboard.test.ts). Burada yalnız oran, ortalama ve etiket türetilir.

const summary = (parts: Partial<InvoiceSummary> = {}): InvoiceSummary => ({
  total: 0,
  amount: 0,
  overdue: { count: 0, amount: 0 },
  upcoming: { count: 0, amount: 0 },
  paid: { count: 0, amount: 0 },
  ...parts,
})

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

describe('bölüm görünürlüğü', () => {
  test('yanıt gelince sunucunun kararı (null bölüm gizli), gelmeden modül bayrağı', () => {
    assert.equal(sectionVisible(null, true, true), false)
    assert.equal(sectionVisible({}, true, false), true)
    assert.equal(sectionVisible(undefined, false, true), true)
    assert.equal(sectionVisible(undefined, false, false), false)
  })
})

describe('taksit dağılımı', () => {
  test('durumlar öncelik sırasıyla, kayıt olmayan durum sıfırla gelir', () => {
    const slices = invoiceStatusSlices(
      summary({
        total: 8,
        amount: 1_000_000,
        overdue: { count: 2, amount: 250_000 },
        paid: { count: 6, amount: 750_000 },
      }),
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
    assert.ok(invoiceStatusSlices(summary()).every((slice) => slice.share === 0))
    assert.equal(
      outstandingAmount(
        summary({
          total: 8,
          amount: 1300,
          overdue: { count: 1, amount: 100 },
          upcoming: { count: 2, amount: 300 },
          paid: { count: 5, amount: 900 },
        }),
      ),
      400,
    )
  })
})

describe('yoklama özeti', () => {
  test('katılım geldi + geç geldi üzerinden; kayıt yoksa oran yok', () => {
    const counts = { present: 6, absent: 1, late: 1, excused: 0, total: 8 }
    assert.deepEqual(attendanceSummary(counts), { ...counts, rate: 88 })
    assert.equal(
      attendanceSummary({ present: 0, absent: 0, late: 0, excused: 0, total: 0 }).rate,
      null,
    )
  })
})

describe('haftalık seri', () => {
  test('etiket haftanın pazartesisi; veri yoksa grafik yok ve özet bunu söyler', () => {
    const points = weeklyPoints([
      { from: '2026-10-12', to: '2026-10-18', absent: 2 },
      { from: '2026-10-19', to: '2026-10-25', absent: 0 },
      { from: '2026-10-26', to: '2026-11-01', absent: 1 },
    ])
    assert.deepEqual(
      points.map((point) => [point.label, point.value]),
      [
        ['12 Eki', 2],
        ['19 Eki', 0],
        ['26 Eki', 1],
      ],
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
  test('ders ortalaması scoreSum / count, ders adına göre Türkçe sıralı; adsız ders "Ders"', () => {
    const grades = {
      count: 6,
      scoreSum: 461,
      subjects: [
        { subjectId: 'math', name: 'Matematik', count: 2, scoreSum: 171 },
        { subjectId: 'eng', name: 'İngilizce', count: 3, scoreSum: 240 },
        { subjectId: 'x', count: 1, scoreSum: 50 },
      ],
    }
    assert.deepEqual(subjectAverageRows(grades), [
      { subjectId: 'x', name: 'Ders', average: 50, count: 1 },
      { subjectId: 'eng', name: 'İngilizce', average: 80, count: 3 },
      { subjectId: 'math', name: 'Matematik', average: 86, count: 2 },
    ])
    assert.equal(overallAverage(grades), 77)
    assert.equal(overallAverage({ count: 0, scoreSum: 0, subjects: [] }), null)
  })
})

describe('aylık seri', () => {
  test('ay etiketi kısa ad ve iki haneli yıl; değer ayın toplamıdır', () => {
    assert.equal(monthLabel('2026-10'), 'Eki 26')
    assert.deepEqual(
      monthlyPoints([
        { month: '2026-08', count: 2, amount: 5000 },
        { month: '2026-09', count: 0, amount: 0 },
        { month: '2026-10', count: 1, amount: 2500 },
      ]).map((point) => [point.label, point.value]),
      [
        ['Ağu 26', 5000],
        ['Eyl 26', 0],
        ['Eki 26', 2500],
      ],
    )
  })
})

describe('kampüs doluluğu', () => {
  test('doluluk yüzdesi en fazla 100; kontenjan yoksa sıfır', () => {
    const rows = campusOccupancy([
      { id: 'b1', name: 'Merkez', students: 30, capacity: 60 },
      { id: 'b2', name: 'Kuzey', students: 30, capacity: 24 },
      { id: 'b3', name: 'Yeni', students: 0, capacity: 0 },
    ])
    assert.deepEqual(
      rows.map((row) => row.percentage),
      [50, 100, 0],
    )
  })
})
