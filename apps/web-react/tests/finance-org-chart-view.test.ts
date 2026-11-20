import assert from 'node:assert/strict'
import test from 'node:test'

import {
  indent,
  parentOptions,
  parseHeadcount,
  positionFormField,
  positionUpdateBody,
  reportsToOptions,
  unitUpdateBody,
  unitWithDescendants,
} from '../src/pages/finance/finance-org-chart-view.ts'

/** Organizasyon sekmesi saf mantığı (DOM-FIN-129; ON-187; K-442, K-443). */

const units = [
  { id: 'kok', parentId: null, isActive: true, name: 'Okul müdürlüğü' },
  { id: 'akademik', parentId: 'kok', isActive: true, name: 'Akademik birimler' },
  { id: 'mat', parentId: 'akademik', isActive: true, name: 'Matematik zümresi' },
  { id: 'idari', parentId: 'kok', isActive: true, name: 'İdari işler' },
  { id: 'eski', parentId: 'kok', isActive: false, name: 'Eski birim' },
]
const positions = [
  { id: 'mudur', unitId: 'kok', title: 'Okul müdürü', reportsToPositionId: null },
  { id: 'baskan', unitId: 'mat', title: 'Zümre başkanı', reportsToPositionId: 'mudur' },
  { id: 'ogretmen', unitId: 'mat', title: 'Matematik öğretmeni', reportsToPositionId: 'baskan' },
  { id: 'sekreter', unitId: 'idari', title: 'Sekreter', reportsToPositionId: 'mudur' },
]

test('DOM-FIN-129 K-442: taşımada birim kendisinin ve alt birimlerinin altına seçilemez', () => {
  assert.deepEqual([...unitWithDescendants(units, 'akademik')].sort(), ['akademik', 'mat'])
  assert.equal(indent(1), '')
  assert.equal(indent(3), '    ')
  assert.deepEqual(
    parentOptions(units, 'akademik').map((option) => option.value),
    ['', 'kok', 'idari'],
  )
  // Yeni birimde bütün etkin birimler seçilebilir; pasif birim seçenek değildir.
  assert.deepEqual(
    parentOptions(units, null).map((option) => option.value),
    ['', 'kok', 'akademik', 'mat', 'idari'],
  )
  assert.equal(parentOptions(units, null)[3]?.label, '    Matematik zümresi')
})

test('DOM-FIN-129 K-443: pozisyon kendisine ya da kendisine raporlayana raporlayamaz', () => {
  assert.deepEqual(
    reportsToOptions(units, positions, 'baskan').map((option) => option.value),
    ['', 'mudur', 'sekreter'],
  )
  assert.deepEqual(
    reportsToOptions(units, positions, null).map((option) => option.value),
    ['', 'mudur', 'baskan', 'ogretmen', 'sekreter'],
  )
  assert.equal(
    reportsToOptions(units, positions, null)[2]?.label,
    '    Zümre başkanı (Matematik zümresi)',
  )
})

test('DOM-FIN-129: düzeltme gövdesi yalnız değişen alanları taşır', () => {
  const unit = {
    name: 'Matematik zümresi',
    kind: 'academic_department' as const,
    parentId: 'akademik',
  }
  assert.deepEqual(
    unitUpdateBody(unit, {
      name: ' Matematik zümresi ',
      kind: 'academic_department',
      parentId: 'akademik',
    }),
    {},
  )
  assert.deepEqual(unitUpdateBody(unit, { name: 'Matematik', kind: 'support', parentId: '' }), {
    name: 'Matematik',
    kind: 'support',
    parentId: null,
  })
  const position = {
    unitId: 'mat',
    title: 'Zümre başkanı',
    headcount: 1,
    reportsToPositionId: 'mudur',
  }
  assert.deepEqual(
    positionUpdateBody(position, {
      unitId: 'mat',
      title: 'Zümre başkanı',
      headcount: '1',
      reportsTo: 'mudur',
    }),
    {},
  )
  assert.deepEqual(
    positionUpdateBody(position, {
      unitId: 'idari',
      title: 'Başkan',
      headcount: '3',
      reportsTo: '',
    }),
    { unitId: 'idari', title: 'Başkan', headcount: 3, reportsToPositionId: null },
  )
  assert.equal(parseHeadcount(' 12 '), 12)
  assert.ok(Number.isNaN(parseHeadcount('1,5')))
  assert.ok(Number.isNaN(parseHeadcount('')))
  assert.equal(positionFormField('reportsToPositionId'), 'reportsTo')
  assert.equal(positionFormField('headcount'), 'headcount')
  assert.equal(positionFormField('version'), null)
})
