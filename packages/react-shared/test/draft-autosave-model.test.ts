import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'node:test'
import {
  createDraftSaver,
  DRAFT_DELAY_MS,
  type DraftSaverOptions,
  type SaveResult,
} from '../src/draft-autosave-model.ts'

type Call = { revision: number | null; body: string }

/** Sunucu benzeşimi: her kayıt revizyonu bir artırır; `gate` ile kaydı elle bekletmek mümkündür. */
function setup(draft: DraftSaverOptions['draft'], initialBody = '') {
  const calls: Call[] = []
  let serverRevision = draft?.revision ?? 0
  let fail = false
  let release: (() => void) | null = null
  let hold = false
  const saver = createDraftSaver({
    draft,
    initialBody,
    submit: async (input): Promise<SaveResult> => {
      calls.push(input)
      if (hold) await new Promise<void>((resolve) => (release = resolve))
      if (fail) return { ok: false }
      serverRevision += 1
      return { ok: true, revision: serverRevision, savedAt: '2026-11-03T09:00:00.000Z' }
    },
  })
  return {
    saver,
    calls,
    /** Başka pencerenin kaydı sunucu revizyonunu ilerletir. */
    otherWindowSaved: (revision: number) => (serverRevision = revision),
    setFail: (value: boolean) => (fail = value),
    hold: () => (hold = true),
    release: () => {
      hold = false
      release?.()
    },
  }
}

const snap = (revision: number, body: string) => ({ revision, body, savedAt: null })

describe('taslak otomatik kaydı: sıra ve kısayol', () => {
  test('IST-047: ilk kayıt If-Match taşımaz, sonraki kayıt önceki revizyonu taşır', async () => {
    const { saver, calls } = setup(null)
    assert.equal(await saver.flush('First text.'), 1)
    assert.equal(await saver.flush('Second text.'), 2)
    assert.deepEqual(calls, [
      { revision: null, body: 'First text.' },
      { revision: 1, body: 'Second text.' },
    ])
  })

  test('IST-047: kayıtlı metin için istek atılmaz ve mevcut revizyon döner', async () => {
    const { saver, calls } = setup(snap(3, 'Saved.'))
    assert.equal(await saver.flush('Saved.'), 3)
    assert.equal(calls.length, 0)
  })

  test('IST-047: süren kaydı flush bekler; istekler sıralıdır ve çakışmaz', async () => {
    const t = setup(null)
    t.hold()
    const first = t.saver.save('One.')
    const flushed = t.saver.flush('Two.')
    await Promise.resolve()
    assert.equal(t.calls.length, 1)
    t.release()
    await first
    assert.equal(await flushed, 2)
    assert.deepEqual(
      t.calls.map((call) => call.revision),
      [null, 1],
    )
  })

  test('IST-047: kayıt hatasında flush null döner; teslim durur ve metin yeniden denenir', async () => {
    const t = setup(snap(1, 'Old.'))
    t.setFail(true)
    assert.equal(await t.saver.flush('New.'), null)
    t.setFail(false)
    assert.equal(await t.saver.flush('New.'), 2)
    assert.equal(t.calls.length, 2)
  })
})

describe('taslak otomatik kaydı: başka pencerenin revizyonu', () => {
  test('IST-047: bayat kayıtlı metin kısayolu kullanmaz; ekran sunucu metnine alınır', async () => {
    // A: X kaydedildi (rev 3). B: Y kaydetti (rev 4). A tazelenir.
    const t = setup(snap(3, 'X'))
    t.otherWindowSaved(4)
    const outcome = t.saver.sync(snap(4, 'Y'), 'X')
    assert.deepEqual(outcome, { kind: 'adopt', body: 'Y', savedAt: null })
    // Ekran Y'ye geçti; teslim edilen revizyon 4 ve metin Y'dir, istek atılmaz.
    assert.equal(await t.saver.flush('Y'), 4)
    assert.equal(t.calls.length, 0)
  })

  test('IST-047: ekran eski metinde kalsa bile revizyon eşleşmeden kısayol çalışmaz', async () => {
    const t = setup(snap(3, 'X'))
    t.otherWindowSaved(4)
    t.saver.sync(snap(4, 'Y'), 'X')
    // Ekran hâlâ X ise (adopt uygulanmadan flush) X, Y'nin üstüne yeni revizyon olarak yazılır.
    assert.equal(await t.saver.flush('X'), 5)
    assert.deepEqual(t.calls, [{ revision: 4, body: 'X' }])
  })

  test('IST-047: kaydedilmemiş değişiklik varsa çakışma; ilk basış kayıt atmadan uyarır', async () => {
    const t = setup(snap(3, 'X'))
    t.otherWindowSaved(4)
    assert.deepEqual(t.saver.sync(snap(4, 'Y'), 'X plus edit'), { kind: 'conflict' })
    assert.equal(t.saver.hasConflict(), true)
    assert.equal(await t.saver.flush('X plus edit'), null)
    assert.equal(t.calls.length, 0)
    assert.equal(t.saver.hasConflict(), false)
    // İkinci basış güncel revizyonla kaydeder ve o revizyonu teslim eder.
    assert.equal(await t.saver.flush('X plus edit'), 5)
    assert.deepEqual(t.calls, [{ revision: 4, body: 'X plus edit' }])
  })

  test('IST-047: 409 sonrası tazeleme çakışma sayılmaz; ikinci basış kaydeder', async () => {
    const t = setup(snap(3, 'X'))
    t.setFail(true)
    assert.equal(await t.saver.flush('X plus edit'), null) // 409: komut toast'ı gösterdi
    t.setFail(false)
    t.otherWindowSaved(4)
    assert.deepEqual(t.saver.sync(snap(4, 'Y'), 'X plus edit'), { kind: 'conflict' })
    assert.equal(t.saver.hasConflict(), false)
    assert.equal(await t.saver.flush('X plus edit'), 5)
  })

  test('IST-047: aynı revizyon ya da aynı metinli yeni revizyonda değişiklik yok', () => {
    const t = setup(snap(3, 'X'))
    assert.deepEqual(t.saver.sync(snap(3, 'X'), 'X'), { kind: 'none' })
    assert.deepEqual(t.saver.sync(snap(4, 'X'), 'X'), { kind: 'none' })
    assert.equal(t.saver.isDirty('X'), false)
  })

  test('IST-047: taslak yokken açılan ekranda başka pencere ilk kaydı yaptıysa metin alınır', () => {
    const t = setup(null, '')
    assert.deepEqual(t.saver.sync(snap(1, 'Other window.'), ''), {
      kind: 'adopt',
      body: 'Other window.',
      savedAt: null,
    })
  })
})

describe('taslak otomatik kaydı: kaydedilmiş metin (savedBody) güncel kalır', () => {
  test('IST-047: başarılı kayıttan sonra aynı metin kirli değildir ve yeniden kaydedilmez', async () => {
    const t = setup(snap(1, 'Old.'))
    assert.equal(t.saver.isDirty('New.'), true)
    assert.equal(await t.saver.save('New.'), true)
    assert.equal(t.saver.isDirty('New.'), false)
    assert.equal(t.saver.isDirty('Old.'), true)
    // Aynı metinle yeniden kayıt gereksiz revizyon üretmez; teslim bu revizyonu gönderir.
    assert.equal(await t.saver.flush('New.'), 2)
    assert.equal(t.calls.length, 1)
  })

  test('IST-047: kendi kaydının tazelenmesi (aynı revizyon) ekrandaki yeni yazıyı ezmez', async () => {
    const t = setup(snap(1, 'Old.'))
    await t.saver.save('New.')
    // Sorgu tazelendi: sunucu az önce kaydedilen revizyonu döndürür; öğrenci bu arada yazmaya devam etti.
    assert.deepEqual(t.saver.sync(snap(2, 'New.'), 'New. More'), { kind: 'none' })
    assert.equal(t.saver.hasConflict(), false)
    assert.equal(t.saver.isDirty('New. More'), true)
    assert.equal(await t.saver.flush('New. More'), 3)
    assert.deepEqual(t.calls.at(-1), { revision: 2, body: 'New. More' })
  })

  test('IST-047: boşluk farkı gerçek değişikliktir; kısayola takılmaz', async () => {
    const t = setup(snap(1, 'Text.'))
    assert.equal(t.saver.isDirty('Text. '), true)
    assert.equal(await t.saver.flush('Text. '), 2)
    assert.equal(t.calls.length, 1)
  })

  test('IST-047: başarısız kayıt metni kaydedilmiş saymaz; sonraki kayıt aynı revizyonla dener', async () => {
    const t = setup(snap(1, 'Old.'))
    t.setFail(true)
    assert.equal(await t.saver.save('New.'), false)
    assert.equal(t.saver.isDirty('New.'), true)
    assert.equal(t.saver.revision(), 1)
    t.setFail(false)
    assert.equal(await t.saver.save('New.'), true)
    assert.deepEqual(
      t.calls.map((call) => call.revision),
      [1, 1],
    )
  })

  test('IST-047: beklenmeyen istisna başarısız kayıt sayılır ve günlüğe yazılır', async (t) => {
    const logged = t.mock.method(console, 'error', () => undefined)
    const saver = createDraftSaver({
      draft: snap(1, 'Old.'),
      initialBody: '',
      submit: () => Promise.reject(new Error('network')),
    })
    assert.equal(await saver.flush('New.'), null)
    assert.equal(saver.isDirty('New.'), true)
    assert.equal(logged.mock.callCount(), 1)
  })
})

describe('taslak otomatik kaydı: zamanlayıcı', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
  afterEach(() => mock.timers.reset())

  /** Zamanlayıcının başlattığı kaydın sonuçlanmasını bekler (mikro görevler). */
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

  test('IST-047: kayıt son değişiklikten gecikme kadar sonra bir kez yapılır', async () => {
    const t = setup(snap(1, ''))
    t.saver.schedule('H')
    mock.timers.tick(DRAFT_DELAY_MS - 1)
    t.saver.schedule('He')
    mock.timers.tick(DRAFT_DELAY_MS - 1)
    assert.equal(t.calls.length, 0)
    assert.equal(t.saver.hasPending(), true)
    mock.timers.tick(1)
    await settle()
    assert.deepEqual(t.calls, [{ revision: 1, body: 'He' }])
    assert.equal(t.saver.hasPending(), false)
  })

  test('IST-047: kirli olmayan ya da boş metin için zamanlayıcı kurulmaz', () => {
    const t = setup(snap(1, 'Saved.'))
    t.saver.schedule('Saved.')
    assert.equal(t.saver.hasPending(), false)
    t.saver.schedule('   ')
    assert.equal(t.saver.hasPending(), false)
  })

  test('IST-047: iptal ve flush bekleyen otomatik kaydı düşürür; çift istek gitmez', async () => {
    const t = setup(snap(1, ''))
    t.saver.schedule('Draft.')
    t.saver.cancel()
    mock.timers.tick(DRAFT_DELAY_MS)
    await settle()
    assert.equal(t.calls.length, 0)
    t.saver.schedule('Draft.')
    assert.equal(await t.saver.flush('Draft.'), 2)
    mock.timers.tick(DRAFT_DELAY_MS)
    await settle()
    assert.equal(t.calls.length, 1)
  })

  test('IST-047: süren kayıt sırasında tetiklenen otomatik kayıt sırayı bekler ve yeni revizyonu taşır', async () => {
    const t = setup(snap(1, ''))
    t.hold()
    const first = t.saver.save('One.')
    t.saver.schedule('One. Two.')
    mock.timers.tick(DRAFT_DELAY_MS)
    await settle()
    assert.equal(t.calls.length, 1)
    t.release()
    await first
    await settle()
    assert.deepEqual(t.calls, [
      { revision: 1, body: 'One.' },
      { revision: 2, body: 'One. Two.' },
    ])
  })

  test('IST-047: çakışmada otomatik kayıt kurulmaz; başka pencerenin metninin üstüne yazılmaz', () => {
    const t = setup(snap(3, 'X'))
    t.saver.sync(snap(4, 'Y'), 'X plus edit')
    t.saver.schedule('X plus edit')
    assert.equal(t.saver.hasPending(), false)
  })

  test('IST-047: başarısız otomatik kayıttan sonra sonraki değişiklik yeniden dener', async () => {
    const t = setup(snap(1, ''))
    t.setFail(true)
    t.saver.schedule('Draft.')
    mock.timers.tick(DRAFT_DELAY_MS)
    await settle()
    t.setFail(false)
    t.saver.schedule('Draft. More')
    mock.timers.tick(DRAFT_DELAY_MS)
    await settle()
    assert.deepEqual(t.calls, [
      { revision: 1, body: 'Draft.' },
      { revision: 1, body: 'Draft. More' },
    ])
    assert.equal(t.saver.isDirty('Draft. More'), false)
  })

  test('IST-047: sürüm çakışması (If-Match 409) sonrası güncel revizyonla yeniden kaydedilir', async () => {
    // Sunucu 409 döndürür, komut taslağı tazeler; ikinci kayıt güncel revizyonu If-Match'e koyar.
    const t = setup(snap(3, 'X'))
    t.setFail(true)
    t.saver.schedule('X plus edit')
    mock.timers.tick(DRAFT_DELAY_MS)
    await settle()
    t.setFail(false)
    t.otherWindowSaved(4)
    t.saver.sync(snap(4, 'Y'), 'X plus edit')
    t.saver.schedule('X plus edit')
    mock.timers.tick(DRAFT_DELAY_MS)
    await settle()
    assert.deepEqual(
      t.calls.map((call) => call.revision),
      [3, 4],
    )
  })
})
