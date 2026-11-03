import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { wordCountCheck } from '@kampus/school-core/skills/submission.ts'
import {
  liveWordCount,
  sameAsLastVersion,
  WORD_LIMIT_WARNING,
  wordLimitText,
} from '../src/pages/tasks/writing-model.ts'

describe('yazma editörü: canlı sözcük sayısı', () => {
  test('IST-047, DOM-BEC-046: sayaç sunucunun sayacıyla aynıdır ve sınırla birlikte yazılır', () => {
    const body = "I don't like well-known places in Ankara'da, 2026."
    const live = liveWordCount(body, { minWords: 5, maxWords: 60 })
    assert.equal(live.count, wordCountCheck(body, { minWords: null, maxWords: null }).count)
    assert.equal(live.count, 8)
    assert.equal(live.label, '8 sözcük · beklenen: 5–60 sözcük')
    assert.equal(live.warning, null)
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

  test('IST-047: son teslimle aynı metin (boşluklar dışında) yeni sürüm sayılmaz', () => {
    assert.equal(sameAsLastVersion(' My weekend. \n', 'My weekend.'), true)
    assert.equal(sameAsLastVersion('My weekend, revised.', 'My weekend.'), false)
    assert.equal(sameAsLastVersion('My weekend.', null), false)
    assert.equal(sameAsLastVersion('', '   '), false)
  })
})
