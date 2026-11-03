import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  attemptExtraTimeLabel,
  defaultExtraTimeForm,
  EXTRA_TIME_REASON_OPTIONS,
  extraTimeFieldFor,
  extraTimeFormFor,
  extraTimeFormSchema,
} from '../src/pages/tasks/extra-time-model.ts'

// Bireysel ek süre formu ve öğrenci gösterimi (DOM-BEC-043, OG-248).

const message = (values: unknown, path: string) =>
  extraTimeFormSchema.safeParse(values).error?.issues.find((issue) => issue.path.join('.') === path)
    ?.message

describe('ek süre formu (DOM-BEC-043)', () => {
  test('DOM-BEC-043: boş form her alanda Türkçe mesaj verir', () => {
    const empty = defaultExtraTimeForm()
    assert.equal(message(empty, 'learnerId'), 'Bir kursiyer seçin.')
    assert.equal(message(empty, 'minutes'), 'Ek süreyi dakika olarak girin.')
    assert.equal(message(empty, 'reason'), 'Ek süre gerekçesini seçin.')
  })

  test('DOM-BEC-043: 1–300 dakika dışı ve kesirli süre reddedilir', () => {
    const form = (minutes: number) => ({ learnerId: 'l-1', reason: 'accommodation', minutes })
    assert.equal(message(form(0), 'minutes'), 'Ek süre en az 1 dakika olmalıdır.')
    assert.equal(message(form(301), 'minutes'), 'Ek süre en fazla 300 dakika olabilir.')
    assert.equal(message(form(7.5), 'minutes'), 'Ek süre tam dakika olmalıdır.')
    for (const minutes of [1, 15, 300]) {
      assert.equal(extraTimeFormSchema.safeParse(form(minutes)).success, true, String(minutes))
    }
  })

  test('DOM-BEC-043: serbest metin gerekçe kabul edilmez, kategoriler core ile aynıdır', () => {
    const result = extraTimeFormSchema.safeParse({
      learnerId: 'l-1',
      minutes: 10,
      reason: 'disleksi raporu',
    })
    assert.equal(result.success, false)
    assert.deepEqual(
      EXTRA_TIME_REASON_OPTIONS.map((option) => option.value),
      ['accommodation', 'technical_issue', 'other'],
    )
  })

  test('DOM-BEC-043: değiştirme formu güncel değerle ve sabit kursiyerle açılır', () => {
    assert.deepEqual(extraTimeFormFor('l-1', { minutes: 20, reason: 'technical_issue' }), {
      learnerId: 'l-1',
      minutes: 20,
      reason: 'technical_issue',
    })
  })

  test('DOM-BEC-043: sunucu hata yolu alana, bilinmeyen yol form düzeyine gider', () => {
    assert.equal(extraTimeFieldFor('minutes'), 'minutes')
    assert.equal(extraTimeFieldFor('reason'), 'reason')
    assert.equal(extraTimeFieldFor('learnerId'), 'learnerId')
    assert.equal(extraTimeFieldFor('submittedAt'), 'root.server')
  })
})

describe('öğrencinin ek süre gösterimi (DOM-BEC-043)', () => {
  test('DOM-BEC-043: yalnız dakika gösterilir; ek süre yoksa etiket yoktur', () => {
    assert.equal(attemptExtraTimeLabel(15), 'Ek süre: 15 dk')
    assert.equal(attemptExtraTimeLabel(0), null)
    // Gerekçe kategorisi öğrenci etiketinde hiçbir koşulda geçmez.
    for (const option of EXTRA_TIME_REASON_OPTIONS) {
      assert.equal(attemptExtraTimeLabel(30)?.includes(option.label), false)
    }
  })
})
