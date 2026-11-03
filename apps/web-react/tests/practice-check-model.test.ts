import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  checkView,
  feedbackFor,
  shownFeedback,
  type ItemFeedback,
} from '../src/pages/tasks/practice-check-model.ts'

// OG-085 (IST-056; DOM-BEC-047): alıştırmada madde kontrolünün düğme ve sonuç metni.

const entry = (overrides: Partial<ItemFeedback> = {}): ItemFeedback => ({
  questionVersionId: 'qv-1',
  used: 1,
  remaining: 1,
  correct: false,
  correctParts: 0,
  parts: 1,
  locked: false,
  answerKey: null,
  ...overrides,
})

describe('alıştırma madde kontrolü', () => {
  test('DOM-BEC-047: yerel kontrol yanıtı yalnız ayrıntıdan yeniyse görünür; sorgu yenilenince ya da başka sekme kontrol edince sunucudaki feedback kazanır', () => {
    const local = [entry({ used: 2, remaining: 0, locked: true })]
    const server = [entry({ used: 1, remaining: 1 })]
    const checked = { rowVersion: 5, feedback: local }
    // Yanıt geldi, ayrıntı henüz eski sürümde: yerel yanıt görünür.
    assert.equal(shownFeedback({ rowVersion: 4, feedback: server }, checked), local)
    // Ayrıntı aynı sürüme yetişti: sunucudaki görünür.
    assert.equal(shownFeedback({ rowVersion: 5, feedback: server }, checked), server)
    // Başka sekme araya girdi (daha yeni sürüm): yerel durum eskimiştir.
    assert.equal(shownFeedback({ rowVersion: 7, feedback: server }, checked), server)
    // Yerel yanıt yoksa ayrıntı; değerlendirmede null kalır.
    assert.equal(shownFeedback({ rowVersion: 1, feedback: server }, null), server)
    assert.equal(shownFeedback({ rowVersion: 1, feedback: null }, null), null)
  })

  test('DOM-BEC-047: değerlendirmede ve velide geri bildirim yok; madde yoksa null', () => {
    assert.equal(feedbackFor(null, 'qv-1'), null)
    assert.equal(feedbackFor([entry()], 'qv-2'), null)
    assert.equal(feedbackFor([entry()], 'qv-1')?.used, 1)
  })

  test('DOM-BEC-047: kontrol edilmemiş madde cevaplanınca kontrol edilir; tam hak yazılır', () => {
    assert.deepEqual(checkView({ entry: null, answered: false, timeOver: false }), {
      canCheck: false,
      locked: false,
      remainingText: 'Kontrol hakkı: 2 / 2',
      result: null,
    })
    assert.equal(checkView({ entry: null, answered: true, timeOver: false }).canCheck, true)
    assert.equal(checkView({ entry: null, answered: true, timeOver: true }).canCheck, false)
  })

  test('DOM-BEC-047: yanlış ve hak varsa yeniden kontrol; çok maddeli soruda doğru madde sayısı', () => {
    const view = checkView({
      entry: entry({ parts: 3, correctParts: 2 }),
      answered: true,
      timeOver: false,
    })
    assert.equal(view.canCheck, true)
    assert.equal(view.remainingText, 'Kontrol hakkı: 1 / 2')
    assert.equal(view.result?.label, 'Yanlış')
    assert.equal(view.result?.tone, 'amber')
    assert.match(view.result?.detail ?? '', /3 maddeden 2 tanesi doğru/)
  })

  test('DOM-BEC-047: doğru ya da hak bitince kilit; düğme ve girdi kapanır', () => {
    const right = checkView({
      entry: entry({ correct: true, locked: true, correctParts: 1 }),
      answered: true,
      timeOver: false,
    })
    assert.deepEqual([right.canCheck, right.locked, right.result?.tone], [false, true, 'green'])
    const spent = checkView({
      entry: entry({ used: 2, remaining: 0, locked: true }),
      answered: true,
      timeOver: false,
    })
    assert.deepEqual(
      [spent.canCheck, spent.locked, spent.remainingText, spent.result?.tone],
      [false, true, 'Kontrol hakkı kalmadı', 'red'],
    )
    assert.match(spent.result?.detail ?? '', /hakkınız bitti/)
  })
})
