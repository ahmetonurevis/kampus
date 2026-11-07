import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { PracticeGradebook } from '@kampus/react-shared/practice-gradebook.ts'
import {
  formatScore,
  GRADEBOOK_COLUMNS,
  gradebookRows,
  gradebookSummary,
  isGradebookView,
  unitLabel,
} from '../src/pages/tasks/practice-gradebook-model.ts'

// OG-085 (IST-056; DOM-BEC-048): alıştırma not defterinin kırılım satırları ve özeti.

const tally = (earned: number, possible: number, percent: number, items = 2) => ({
  items,
  earned,
  possible,
  percent,
})

const deniz = {
  sets: 2,
  overall: tally(5, 8, 63, 4),
  units: [{ number: 3, title: 'Daily routines', sets: 1, ...tally(1, 4, 25) }],
  skills: [
    { skill: 'reading' as const, ...tally(2, 2, 100) },
    { skill: 'listening' as const, ...tally(3, 6, 50) },
  ],
  outcomes: [{ outcomeSource: 'platform' as const, outcomeId: 'ENG.9.3', ...tally(3, 6, 50) }],
}

const book: PracticeGradebook = {
  assignments: [],
  learners: [
    { learnerId: 's-1', learnerName: 'Deniz Yılmaz', ...deniz },
    { learnerId: 's-3', learnerName: null, ...deniz, units: [] },
  ],
  totals: { ...deniz, sets: 3, overall: tally(9.5, 12, 79, 6) },
  truncated: false,
}

describe('alıştırma not defteri modeli', () => {
  test('DOM-BEC-048: genel kırılım kursiyer başına bir satır; adı gelmeyen kursiyer "Siz"', () => {
    assert.deepEqual(gradebookRows(book, 'genel'), [
      {
        id: 's-1:genel',
        learner: 'Deniz Yılmaz',
        group: 'Bütün alıştırmalar',
        sets: 2,
        score: '5 / 8',
        percent: 63,
        percentText: '%63',
      },
      {
        id: 's-3:genel',
        learner: 'Siz',
        group: 'Bütün alıştırmalar',
        sets: 2,
        score: '5 / 8',
        percent: 63,
        percentText: '%63',
      },
    ])
  })

  test('DOM-BEC-048: ünite, beceri ve kazanım kırılımı; ünitesiz kursiyerde ünite satırı yok', () => {
    assert.deepEqual(
      gradebookRows(book, 'unite').map((row) => [row.id, row.group, row.sets]),
      [['s-1:u3', 'Ünite 3 · Daily routines', 1]],
    )
    assert.deepEqual(
      gradebookRows(book, 'beceri')
        .filter((row) => row.learner === 'Deniz Yılmaz')
        .map((row) => [row.group, row.sets, row.percentText]),
      [
        ['Okuma', null, '%100'],
        ['Dinleme', null, '%50'],
      ],
    )
    assert.deepEqual(
      gradebookRows(book, 'kazanim').map((row) => row.id),
      ['s-1:platform:ENG.9.3', 's-3:platform:ENG.9.3'],
    )
  })

  test('DOM-BEC-048: sınıf geneli özeti ve CSV sütunları; ondalık puan virgüllü', () => {
    assert.deepEqual(gradebookSummary(book, 'genel'), [
      { key: 'genel', group: 'Bütün alıştırmalar', text: '%79 (9,5 / 12)' },
    ])
    assert.equal(formatScore(2.25), '2,25')
    assert.equal(formatScore(3), '3')
    assert.equal(unitLabel({ number: 4, title: null }), 'Ünite 4')
    assert.deepEqual(
      GRADEBOOK_COLUMNS.map((column) => column.key),
      ['learner', 'group', 'sets', 'score', 'percent'],
    )
    assert.equal(isGradebookView('beceri'), true)
    assert.equal(isGradebookView('not'), false)
  })
})
