import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type {
  EokulImportResult,
  EokulImportRowResult,
} from '@kampus/react-shared/enrollment-eokul-imports.ts'
import {
  defaultEokulSelection,
  EOKUL_LEGACY_MESSAGE,
  eokulChangeText,
  eokulErrorRows,
  eokulFileProblem,
  eokulSummary,
  eokulTableRow,
  mappingBody,
  mappingValues,
  withEokulIssues,
} from '../src/pages/crm/enrollment-eokul-import-model.ts'

// e-Okul aktarımı penceresinin saf modeli (ON-062, IST-134; DOM-KAY-042).

const row = (extra: Partial<EokulImportRowResult> = {}): EokulImportRowResult => ({
  line: 3,
  status: 'new',
  schoolNumber: '201',
  name: 'Can Demir',
  className: '9/A',
  classLabel: '9-A',
  identityMasked: '*******1234',
  guardianName: 'Ayla Demir',
  guardianPhoneMasked: '0532 *** ** 01',
  guardianMatch: 'new',
  changes: [],
  issues: [],
  notices: [],
  ...extra,
})

const mapping = {
  schoolNumber: 1,
  identityNumber: 2,
  fullName: null,
  firstName: 3,
  lastName: 4,
  className: 6,
  grade: null,
  section: null,
  birthDate: 7,
  guardianName: 8,
  guardianPhone: 9,
  relationship: null,
}

describe('e-Okul aktarım penceresi (IST-134)', () => {
  test('DOM-KAY-042: eski .xls yönlendirmeyle, büyük ve tanınmayan dosya reddedilir', () => {
    assert.equal(eokulFileProblem({ name: 'liste.xls', size: 10 }), EOKUL_LEGACY_MESSAGE)
    assert.equal(eokulFileProblem({ name: 'liste.xlsx', size: 10 }), null)
    assert.equal(eokulFileProblem({ name: 'liste.CSV', size: 10 }), null)
    assert.notEqual(eokulFileProblem({ name: 'liste.pdf', size: 10 }), null)
    assert.notEqual(eokulFileProblem({ name: 'liste.csv', size: 6 * 1024 * 1024 }), null)
    assert.notEqual(eokulFileProblem({ name: 'liste.csv', size: 0 }), null)
  })

  test('DOM-KAY-042: satır, değişiklik metni ve seçilebilirlik', () => {
    const update = eokulTableRow(
      row({
        status: 'update',
        className: '9/B',
        classLabel: '9-B',
        changes: [
          { field: 'class', before: '9-A', after: '9-B' },
          { field: 'identity', before: null, after: null },
        ],
      }),
    )
    assert.equal(update.status, 'Güncellenecek')
    assert.equal(update.classLabel, '9/B → 9-B')
    assert.equal(update.changeText, 'Sınıf: 9-A → 9-B · Kimlik eklenecek')
    assert.equal(update.selectable, true)
    assert.equal(
      eokulChangeText({ field: 'schoolNumber', before: null, after: '101' }),
      'Okul no: — → 101',
    )
    assert.equal(eokulTableRow(row({ status: 'unchanged' })).selectable, false)
    const rows = [
      eokulTableRow(row()),
      eokulTableRow(row({ line: 4, status: 'unchanged' })),
      eokulTableRow(
        row({
          line: 5,
          status: 'invalid',
          issues: [{ line: 5, field: 'className', code: 'class_not_found', message: 'Sınıf yok.' }],
        }),
      ),
    ]
    assert.deepEqual([...defaultEokulSelection(rows)], [3])
  })

  test('IST-134: onayın satır hatası satırı hatalı ve seçilemez yapar; hatalı satır CSV maskeli', () => {
    const rows = withEokulIssues(
      [eokulTableRow(row()), eokulTableRow(row({ line: 4 }))],
      [{ line: 4, field: 'className', code: 'class_capacity_full', message: 'Kontenjan dolu.' }],
    )
    assert.equal(rows[1]?.status, 'Hatalı')
    assert.equal(rows[1]?.selectable, false)
    assert.deepEqual(eokulErrorRows(rows), [
      {
        line: 4,
        schoolNumber: '201',
        name: 'Can Demir',
        classLabel: '9/A → 9-A',
        identity: '*******1234',
        problems: 'Kontenjan dolu.',
      },
    ])
  })

  test('IST-134: eşleme form değerlerine ve gövdeye gidip gelir; özet sayıları yazar', () => {
    const values = mappingValues(mapping)
    assert.equal(values.identityNumber, '2')
    assert.equal(values.fullName, '')
    assert.deepEqual(mappingBody(values), mapping)
    const result = {
      rowCount: 4,
      newCount: 1,
      updateCount: 1,
      unchangedCount: 1,
      invalidCount: 1,
    } as EokulImportResult
    assert.equal(
      eokulSummary(result),
      '4 öğrenci satırı · 1 yeni · 1 güncellenecek · 1 değişiklik yok · 1 hatalı',
    )
  })
})
