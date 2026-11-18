import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hrReport, hrReportPeriod } from '@kampus/school-core/lib/finance-hr-reports.ts'
import { defaultHrRange, hrReportQueryOf } from '../src/pages/finance/finance-hr-report-model.ts'
import {
  hrCountText,
  hrReportDocument,
  hrReportPdfFilename,
  hrTurnoverCells,
} from '../src/lib/pdf/templates/finance-hr-report.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// İK raporu PDF'i ve sekme yardımcıları (DOM-FIN-117; ON-192, K-401).

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T09:00:00.000Z'),
}
const member = (id: string, role: string, deactivatedDay: string | null = null) => ({
  membershipId: id,
  role,
  joinedDay: '2024-09-01',
  deactivatedDay,
})

function report() {
  return hrReport({
    period: hrReportPeriod('2026-01', '2026-06', '2026-10-06'),
    staff: [
      ...Array.from({ length: 9 }, (_, index) => member(`t${String(index)}`, 'ogretmen')),
      member('a1', 'onburo'),
      member('a2', 'yonetici', '2026-03-31'),
    ],
    profiles: [],
    allocations: [],
    centers: [],
    leaveTypes: [{ code: 'annual', label: 'Yıllık ücretli izin', kind: 'annual', isActive: true }],
    leaveRecords: [],
    medicalDays: [],
  })
}

test('DOM-FIN-117 K-401: PDF devir, kıdem ve izin bölümlerini yazar; küçük grup "<5", kişi adı yok', () => {
  const data = report()
  const all = allTexts(hrReportDocument(measurer, data, OPTIONS))
  for (const text of [
    'İK RAPORU',
    'Personel devir oranı',
    'Kıdem dağılımı',
    'İzin kullanımı',
    'Kurum toplamı',
    'Öğretmen',
    '<5',
    '%9,52',
    'Yıllık ücretli izin',
    'Bilinmiyor',
  ])
    assert.ok(all.includes(text), text)
  assert.ok(!all.some((text) => text.includes('t1') || text.includes('a2')))
  assert.equal(hrReportPdfFilename(data), 'ik-raporu-2026-01-2026-06.pdf')
})

test('DOM-FIN-117: devir hücreleri ve sayı metni', () => {
  const data = report()
  assert.deepEqual(hrTurnoverCells(data.turnover.totals, 5), [
    '11',
    '0',
    '1',
    '10',
    '10,5',
    '%9,52',
  ])
  assert.deepEqual(hrTurnoverCells(data.turnover.byRole[1]!, 5), [
    '<5',
    '<5',
    '<5',
    '<5',
    '<5',
    '<5',
  ])
  assert.equal(hrCountText(null, 5), '<5')
  assert.equal(hrCountText(0, 5), '0')
})

test('DOM-FIN-117: sekme varsayılanı yıl başından bu aya; geçersiz aralık istek atmaz', () => {
  assert.deepEqual(defaultHrRange('2026-10-06'), { from: '2026-01', to: '2026-10' })
  assert.deepEqual(hrReportQueryOf('2026-01', '2026-10'), {
    query: { from: '2026-01', to: '2026-10' },
  })
  assert.deepEqual(hrReportQueryOf('', '2026-10'), { issue: 'Başlangıç ve bitiş ayını seçin.' })
  assert.deepEqual(hrReportQueryOf('2026-05', '2026-04'), {
    issue: 'Bitiş ayı başlangıç ayından önce olamaz.',
  })
  assert.deepEqual(hrReportQueryOf('2025-01', '2026-01'), {
    issue: 'Dönem en çok 12 ay olabilir.',
  })
})
