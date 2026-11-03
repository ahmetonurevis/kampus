import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { LearningOutcomeRow } from '@kampus/react-shared/use-learning-outcomes.ts'
import type { OutcomeRef } from '@kampus/school-core/content/outcomes.ts'
import {
  appendOutcomes,
  OUTCOME_COPY,
  OUTCOME_PICKER_PAGE_SIZE,
  outcomeCapacity,
  outcomeMeta,
  outcomePickerDefaults,
  outcomePickerQuery,
  outcomePickerRows,
  OUTCOMES_MAX,
  selectedOutcomesQuery,
  selectedOutcomeViews,
} from '../src/pages/content/outcome-picker-model.ts'

// Kazanım seçicisi (OG-067; DOM-KYN-011, IST-030): katalog sorgusu, satırlar, ekleme sınırı ve
// seçili kazanımın (arşivli dahil) görünümü.

function row(overrides: Partial<LearningOutcomeRow> = {}): LearningOutcomeRow {
  return {
    source: 'platform',
    code: 'MAT.7.1.1',
    name: 'Sayılar ve işlemler',
    subjectId: 'math',
    gradeLevel: 7,
    programVersion: 'ornek-2025',
    archivedAt: null,
    rowVersion: 1,
    ...overrides,
  }
}
const platform = (code: string): OutcomeRef => ({ outcomeId: code, outcomeSource: 'platform' })
const own = (code: string): OutcomeRef => ({ outcomeId: code, outcomeSource: 'institution' })

describe('kazanım seçici sorgusu', () => {
  test('DOM-KYN-011: boş süzgeç gönderilmez; arama kırpılır, düzey sayıya çevrilir', () => {
    assert.deepEqual(outcomePickerQuery({ q: '  ', subject: '', level: '', page: 1 }), {
      page: 1,
      pageSize: OUTCOME_PICKER_PAGE_SIZE,
    })
    assert.deepEqual(outcomePickerQuery({ q: ' sayı ', subject: 'math', level: '7', page: 2 }), {
      page: 2,
      pageSize: OUTCOME_PICKER_PAGE_SIZE,
      q: 'sayı',
      subject: 'math',
      level: 7,
    })
  })

  test('DOM-KYN-011: varsayılan süzgeç formun dersi ve ilk sınıf düzeyidir', () => {
    assert.deepEqual(outcomePickerDefaults({ subjectId: 'math', gradeLevels: [8, 7] }), {
      subject: 'math',
      level: '8',
    })
    assert.deepEqual(outcomePickerDefaults({ subjectId: null, gradeLevels: [] }), {
      subject: '',
      level: '',
    })
  })
})

describe('kazanım seçici satırları ve ekleme', () => {
  test('DOM-KYN-011: satır kod, ad ve künye taşır; formda seçili olan "Zaten seçili" olur', () => {
    const rows = outcomePickerRows(
      [row(), row({ source: 'institution', code: 'KUR.7.1', name: 'Kurum kazanımı' })],
      [platform('MAT.7.1.1'), own('BASKA.1')],
    )
    assert.deepEqual(
      rows.map((r) => [r.key, r.code, r.disabledReason]),
      [
        ['platform:MAT.7.1.1', 'MAT.7.1.1', OUTCOME_COPY.alreadySelected],
        ['institution:KUR.7.1', 'KUR.7.1', null],
      ],
    )
    assert.equal(rows[0]?.meta, 'Matematik · 7. sınıf · Öğretim programı')
    assert.equal(
      outcomeMeta(row({ source: 'institution', subjectId: 'bilinmez' })),
      'bilinmez · 7. sınıf · Kurum kazanımı',
    )
    // Aynı kod farklı kaynakta ayrı kazanımdır.
    assert.equal(outcomePickerRows([row()], [own('MAT.7.1.1')])[0]?.disabledReason, null)
  })

  test('DOM-KYN-011: ekleme yineleneni düşürür ve 20 kazanım sınırını aşmaz', () => {
    assert.deepEqual(
      appendOutcomes([platform('A')], [platform('A'), platform('B'), platform('B'), own('A')]),
      [platform('B'), own('A')],
    )
    const nineteen = Array.from({ length: OUTCOMES_MAX - 1 }, (_, i) => platform(`K${String(i)}`))
    assert.equal(outcomeCapacity(nineteen), 1)
    assert.deepEqual(appendOutcomes(nineteen, [platform('X'), platform('Y')]), [platform('X')])
    assert.equal(outcomeCapacity([...nineteen, platform('X'), platform('Y')]), 0)
  })
})

describe('seçili kazanımların görünümü', () => {
  test('DOM-KYN-011: kodlar sıralı ve tekil sorulur; seçim yoksa sorgu yok', () => {
    assert.equal(selectedOutcomesQuery([]), null)
    assert.equal(selectedOutcomesQuery([platform('')]), null)
    assert.deepEqual(
      selectedOutcomesQuery([own('KUR.1'), platform('MAT.7.1.1'), platform('KUR.1')]),
      {
        codes: 'KUR.1,MAT.7.1.1',
        page: 1,
        pageSize: 100,
      },
    )
  })

  test('DOM-KYN-011: arşivli kod içerikte etiketle görünür; katalogda olmayan ve yüklenen ayrılır', () => {
    const selected = [platform('MAT.7.1.1'), own('KUR.7.2'), own('ESKI.1')]
    assert.deepEqual(
      selectedOutcomeViews(selected, undefined).map((v) => v.state),
      ['loading', 'loading', 'loading'],
    )
    const views = selectedOutcomeViews(selected, [
      row(),
      row({
        source: 'institution',
        code: 'KUR.7.2',
        name: 'Eski kurum kazanımı',
        archivedAt: '2026-10-01T00:00:00.000Z',
      }),
      // Aynı kod platformda: kurum bağlantısını çözmez.
      row({ code: 'ESKI.1' }),
    ])
    assert.deepEqual(views, [
      {
        code: 'MAT.7.1.1',
        name: 'Sayılar ve işlemler',
        source: 'Öğretim programı',
        state: 'active',
      },
      { code: 'KUR.7.2', name: 'Eski kurum kazanımı', source: 'Kurum kazanımı', state: 'archived' },
      { code: 'ESKI.1', name: null, source: 'Kurum kazanımı', state: 'missing' },
    ])
  })
})
