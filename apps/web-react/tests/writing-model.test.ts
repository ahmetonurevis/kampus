import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  chooseCompareVersion,
  defaultComparePair,
  findVersion,
  liveWordCount,
  resolveComparePair,
  resubmissionRoundText,
  type SubmissionVersion,
  versionFacts,
  versionOptionLabel,
  WORD_LIMIT_WARNING,
  wordDifference,
  wordLimitText,
} from '../src/pages/tasks/writing-model.ts'

describe('yazma editörü: canlı sözcük sayısı', () => {
  test('IST-047, DOM-BEC-046: sayaç sözcükleri sabit beklenen değerle sayar ve sınırla birlikte yazılır', () => {
    const body = "I don't like well-known places in Ankara'da, 2026."
    const live = liveWordCount(body, { minWords: 5, maxWords: 60 })
    // Sabit beklenen değer: tırnaklı ve tireli sözcükler tek sözcük, "2026." de bir sözcüktür.
    assert.equal(live.count, 8)
    assert.equal(live.label, '8 sözcük · beklenen: 5–60 sözcük')
    assert.equal(live.warning, null)
    assert.equal(
      liveWordCount('Hello, world! It is fine.', { minWords: null, maxWords: null }).count,
      5,
    )
  })

  test('IST-047: sınır yoksa yalnız sayı; tek sınır kendi metniyle', () => {
    assert.equal(
      liveWordCount('One two three', { minWords: null, maxWords: null }).label,
      '3 sözcük',
    )
    assert.equal(wordLimitText({ minWords: 150, maxWords: null }), 'en az 150 sözcük')
    assert.equal(wordLimitText({ minWords: null, maxWords: 80 }), 'en çok 80 sözcük')
    assert.equal(wordLimitText({ minWords: null, maxWords: null }), null)
  })

  test('DOM-BEC-046: sınır dışı metin uyarıdır, engel değildir; boş metinde uyarı yok', () => {
    const limits = { minWords: 10, maxWords: 12 }
    assert.equal(liveWordCount('Too short text.', limits).warning, WORD_LIMIT_WARNING)
    assert.equal(
      liveWordCount(
        'one two three four five six seven eight nine ten eleven twelve thirteen',
        limits,
      ).warning,
      WORD_LIMIT_WARNING,
    )
    assert.match(WORD_LIMIT_WARNING, /Yine de gönderebilirsiniz/)
    assert.equal(liveWordCount('   ', limits).warning, null)
    assert.equal(liveWordCount('   ', limits).label, '0 sözcük · beklenen: 10–12 sözcük')
  })
})

const version = (
  number: number,
  overrides: Partial<SubmissionVersion> = {},
): SubmissionVersion => ({
  id: `tv-${number}`,
  number,
  submittedAt: `2026-10-0${number}T09:30:00.000Z`,
  late: false,
  wordCount: { count: 100 + number * 10, status: 'ok', warning: null },
  body: `Version ${number} text.`,
  files: [],
  score: null,
  grading: null,
  appealDeadline: null,
  appeal: null,
  resubmissionRequest: null,
  ...overrides,
})

describe('öğretmen: iki sürümü yan yana karşılaştırma', () => {
  test('IST-047: varsayılan son iki sürümdür; tek sürümde karşılaştırma yoktur', () => {
    assert.equal(defaultComparePair([]), null)
    assert.equal(defaultComparePair([version(1)]), null)
    assert.equal(resolveComparePair([version(1)], { left: 1, right: 2 }), null)
    // Sıra API'nin sırasından bağımsız: sol eski, sağ yeni.
    assert.deepEqual(defaultComparePair([version(3), version(1), version(2)]), {
      left: 2,
      right: 3,
    })
  })

  test('IST-047: geçerli seçim korunur; bilinmeyen ya da aynı sürüm varsayılana döner', () => {
    const versions = [version(1), version(2), version(3)]
    assert.deepEqual(resolveComparePair(versions, null), { left: 2, right: 3 })
    assert.deepEqual(resolveComparePair(versions, { left: 1, right: 3 }), { left: 1, right: 3 })
    assert.deepEqual(resolveComparePair(versions, { left: 1, right: 9 }), { left: 2, right: 3 })
    assert.deepEqual(resolveComparePair(versions, { left: 2, right: 2 }), { left: 2, right: 3 })
    // Yeni sürüm gelince öğretmenin seçimi değişmez.
    assert.deepEqual(resolveComparePair([...versions, version(4)], { left: 1, right: 3 }), {
      left: 1,
      right: 3,
    })
  })

  test('IST-047: diğer sütundaki sürüm seçilirse sütunlar yer değiştirir', () => {
    const pair = { left: 2, right: 3 }
    assert.deepEqual(chooseCompareVersion(pair, 'left', 1), { left: 1, right: 3 })
    assert.deepEqual(chooseCompareVersion(pair, 'right', 1), { left: 2, right: 1 })
    assert.deepEqual(chooseCompareVersion(pair, 'left', 3), { left: 3, right: 2 })
    assert.deepEqual(chooseCompareVersion(pair, 'right', 2), { left: 3, right: 2 })
    assert.equal(findVersion([version(1), version(2)], 2)?.id, 'tv-2')
    assert.equal(findVersion([version(1)], 5), null)
  })

  test('DOM-BEC-040, DOM-BEC-044: sürüm satırları gönderim, sözcük ve yeniden teslim turunu Europe/Istanbul saatiyle verir', () => {
    const request = {
      requestedAt: '2026-10-02T21:15:00.000Z',
      dueAt: '2026-10-05T20:59:00.000Z',
    }
    assert.deepEqual(versionFacts(version(1, { resubmissionRequest: request })), [
      { label: 'Gönderildi', value: '1 Eki 2026 12:30' },
      { label: 'Sözcük', value: '110' },
      { label: 'Yeniden teslim istendi', value: '3 Eki 2026 00:15' },
      { label: 'Yeniden teslim son tarihi', value: '5 Eki 2026 23:59' },
    ])
    assert.equal(
      resubmissionRoundText(request),
      'Yeniden teslim istendi: 3 Eki 2026 00:15 · Son tarih: 5 Eki 2026 23:59',
    )
    // İstenmeyen ve sözcük sayısı olmayan sürümde yalnız gönderim satırı.
    assert.deepEqual(
      versionFacts(version(2, { wordCount: null })).map((fact) => fact.label),
      ['Gönderildi'],
    )
  })

  test('DOM-BEC-044, IST-047: geç sürüm seçenekte belirtilir; sözcük farkı soldan sağa yazılır', () => {
    assert.equal(versionOptionLabel(version(2, { late: true })), 'Sürüm 2 (geç)')
    assert.equal(versionOptionLabel(version(1)), 'Sürüm 1')
    assert.equal(wordDifference(version(1), version(3)), 'Sürüm 1 → Sürüm 3: +20 sözcük')
    assert.equal(wordDifference(version(3), version(1)), 'Sürüm 3 → Sürüm 1: −20 sözcük')
    assert.equal(
      wordDifference(version(1), version(2, { wordCount: version(1).wordCount })),
      'Sürüm 1 → Sürüm 2: sözcük sayısı aynı',
    )
    assert.equal(wordDifference(version(1, { wordCount: null }), version(2)), null)
  })
})
