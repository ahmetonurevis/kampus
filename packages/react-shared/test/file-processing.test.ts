import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { ApiError } from '@kampus/api-client/errors.ts'

import {
  FILE_MISSING_MESSAGE,
  FILE_POLL_INTERVAL_MS,
  FILE_POLL_MAX_INTERVAL_MS,
  FILE_REJECTED_MESSAGE,
  FILE_WAIT_LIMIT_MS,
  createWaitDeadlines,
  fileAttachField,
  fileBlocksAttach,
  fileProcessing,
  filePollInterval,
  pauseWaitClock,
  queryReads,
  resumeWaitClock,
  startWaitClock,
  waitRemainingMs,
} from '../src/files.ts'

// Yüklenen dosyanın işlenmesini bekleme (ADR 0003 karar 8, 10; DOM-BEC-054; IST-027, IST-051;
// OG-987): istemci dosya `ready` olana kadar `GET /files/:id` ile yoklar; taramada reddedilen
// dosyada yükleyen 422 `file_rejected` alır; silinmiş ya da bulunmayan dosya (bağlanmamış dosyanın
// 24 saatlik temizliği, ses dönüşümünün reddettiği kayıt) 404 döner.

const error = (status: number, code = 'x') => new ApiError({ status, code, message: 'İleti.' })

describe('dosya işlenme durumu', () => {
  test('DOM-BEC-054: işlenen ve taranan dosya beklenir, yoklama sürer', () => {
    assert.equal(fileProcessing({ status: 'processing' }, null), 'processing')
    assert.equal(filePollInterval({ status: 'processing' }, null), FILE_POLL_INTERVAL_MS)
    // İlk yanıt gelmeden de beklenir.
    assert.equal(fileProcessing(undefined, null), 'processing')
  })

  test('IST-027: tarayıcısız ortamda (pending) yoklama yapılmaz, dosya bağlamayı kilitlemez', () => {
    assert.equal(fileProcessing({ status: 'pending' }, null), 'pending')
    assert.equal(fileProcessing({ status: 'pending' }, null, true), 'pending')
    assert.equal(filePollInterval({ status: 'pending' }, null), false)
    assert.equal(fileBlocksAttach('pending'), false)
  })

  test('DOM-BEC-054: hazır dosyada yoklama durur', () => {
    assert.equal(fileProcessing({ status: 'ready' }, null), 'ready')
    assert.equal(filePollInterval({ status: 'ready' }, null), false)
  })

  test('IST-027: taramada reddedilen dosya (422 file_rejected) red sayılır, yoklama durur', () => {
    assert.equal(fileProcessing(undefined, error(422, 'file_rejected')), 'rejected')
    assert.equal(filePollInterval(undefined, error(422, 'file_rejected')), false)
    assert.equal(fileProcessing(undefined, error(422, 'file_rejected'), true), 'rejected')
  })

  test('DOM-BEC-054: reddedilen dosya (durum) red sayılır, yoklama durur', () => {
    assert.equal(fileProcessing({ status: 'rejected' }, null), 'rejected')
    assert.equal(filePollInterval({ status: 'rejected' }, null), false)
  })

  test('IST-027: 404 ve silinmiş dosya ayrı ve nötr durumdur (tarama reddi değil), yoklama durur', () => {
    assert.equal(fileProcessing(undefined, error(404, 'not_found')), 'missing')
    assert.equal(fileProcessing({ status: 'deleted' }, null), 'missing')
    assert.equal(filePollInterval(undefined, error(404, 'not_found')), false)
    assert.equal(fileProcessing(undefined, error(404, 'not_found'), true), 'missing')
    assert.equal(fileBlocksAttach('missing'), true)
    assert.equal(FILE_MISSING_MESSAGE, 'Dosya artık bulunamadı. Yeniden yükleyin.')
    assert.doesNotMatch(FILE_MISSING_MESSAGE, /tarama/)
  })

  test('IST-027: hız sınırı (429) beklemeyi bitirmez, yoklama geri çekilerek sürer', () => {
    const throttled = error(429, 'rate_limited')
    assert.equal(fileProcessing(undefined, throttled), 'processing')
    assert.equal(fileProcessing({ status: 'processing' }, throttled), 'processing')
    assert.equal(fileBlocksAttach(fileProcessing(undefined, throttled)), true)
    assert.equal(filePollInterval(undefined, throttled, false, 1), FILE_POLL_INTERVAL_MS)
    assert.equal(filePollInterval(undefined, throttled, false, 4), 5063)
    // Süre dolarsa süren hız sınırı da `timed_out` olur.
    assert.equal(fileProcessing(undefined, throttled, true), 'timed_out')
  })

  test('IST-051: 401 yoklamayı bitirir; girişe yönlendirme oturum katmanındadır', () => {
    assert.equal(fileProcessing(undefined, error(401, 'unauthenticated')), 'failed')
    assert.equal(filePollInterval(undefined, error(401, 'unauthenticated')), false)
  })

  test('IST-051: yetki ve modül hatası beklemeyi bitirir; ağ ve sunucu hatası beklemeyi bozmaz', () => {
    assert.equal(fileProcessing(undefined, error(403, 'module_disabled')), 'failed')
    assert.equal(filePollInterval(undefined, error(403, 'module_disabled')), false)
    assert.equal(fileProcessing(undefined, error(503)), 'processing')
    assert.equal(fileProcessing(undefined, new TypeError('ağ')), 'processing')
    assert.equal(filePollInterval(undefined, error(500)), FILE_POLL_INTERVAL_MS)
  })

  test('IST-051: bekleme üst süresi dolunca yoklama durur ve durum timed_out olur', () => {
    assert.equal(FILE_WAIT_LIMIT_MS, 120_000)
    assert.equal(fileProcessing({ status: 'processing' }, null, false), 'processing')
    assert.equal(fileProcessing({ status: 'processing' }, null, true), 'timed_out')
    assert.equal(filePollInterval({ status: 'processing' }, null, true), false)
    // Ağ ve sunucu hatası sürerken de süre dolunca beklemeyi bırakır.
    assert.equal(fileProcessing(undefined, error(503), true), 'timed_out')
    assert.equal(filePollInterval(undefined, new TypeError('ağ'), true), false)
  })

  test('IST-051: süre dolmuş olsa da kesin sonuç korunur (hazır, ret, yetki)', () => {
    assert.equal(fileProcessing({ status: 'ready' }, null, true), 'ready')
    assert.equal(fileProcessing({ status: 'rejected' }, null, true), 'rejected')
    assert.equal(fileProcessing(undefined, error(422, 'file_rejected'), true), 'rejected')
    assert.equal(fileProcessing(undefined, error(403, 'module_disabled'), true), 'failed')
  })
})

describe('yoklama aralığı ve bekleme saati', () => {
  test('IST-027: aralık her okumada geri çekilir ve üst sınırı geçmez', () => {
    const processing = { status: 'processing' } as const
    const intervals = [0, 1, 2, 3, 4, 5, 6, 10, 50].map((attempt) =>
      filePollInterval(processing, null, false, attempt),
    )
    assert.deepEqual(intervals.slice(0, 6), [1500, 1500, 2250, 3375, 5063, 7594])
    assert.equal(intervals[6], FILE_POLL_MAX_INTERVAL_MS)
    assert.equal(intervals.at(-1), FILE_POLL_MAX_INTERVAL_MS)
    for (let i = 1; i < intervals.length; i += 1)
      assert.ok((intervals[i] as number) >= (intervals[i - 1] as number))
  })

  test('IST-027: üst süre yalnız sekme görünürken işler', () => {
    let clock = startWaitClock(0, true)
    assert.equal(waitRemainingMs(clock, 30_000), 90_000)
    // Sekme 30. saniyede gizlenir; gizliyken geçen 10 dakika sayılmaz.
    clock = pauseWaitClock(clock, 30_000)
    assert.equal(waitRemainingMs(clock, 630_000), 90_000)
    // Görününce kaldığı yerden sürer, 90 saniye sonra dolar.
    clock = resumeWaitClock(clock, 630_000)
    assert.equal(waitRemainingMs(clock, 700_000), 20_000)
    assert.equal(waitRemainingMs(clock, 720_000), 0)
    assert.equal(waitRemainingMs(clock, 900_000), 0)
  })

  test('IST-027: gizli sekmede başlayan bekleme görününce işlemeye başlar; çift olay saati bozmaz', () => {
    let clock = startWaitClock(1_000, false)
    assert.equal(waitRemainingMs(clock, 500_000), FILE_WAIT_LIMIT_MS)
    clock = resumeWaitClock(clock, 500_000)
    assert.equal(resumeWaitClock(clock, 510_000), clock)
    clock = pauseWaitClock(clock, 520_000)
    assert.equal(pauseWaitClock(clock, 530_000), clock)
    assert.equal(waitRemainingMs(clock, 999_000), 100_000)
  })

  test('IST-027: işlenen, süresi dolan ve reddedilen dosya gönderimi kilitler', () => {
    assert.equal(fileBlocksAttach('processing'), true)
    assert.equal(fileBlocksAttach('timed_out'), true)
    assert.equal(fileBlocksAttach('rejected'), true)
    assert.equal(fileBlocksAttach('ready'), false)
    assert.equal(fileBlocksAttach('failed'), false)
  })
})

/**
 * Sahte ortam: elle ilerleyen saat, görünürlük ve zamanlayıcılar. `advance` saati ilerletir ve
 * zamanı gelen zamanlayıcıyı çalıştırır; `pending` kurulu zamanlayıcı sayısıdır.
 */
function fakeEnv(visible = true) {
  let now = 0
  let shown = visible
  let nextTimer = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const listeners = new Set<(visible: boolean) => void>()
  const published: (readonly string[])[] = []
  const deadlines = createWaitDeadlines({
    now: () => now,
    visible: () => shown,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setTimer: (run, ms) => {
      const id = nextTimer++
      timers.set(id, { at: now + ms, run })
      return id
    },
    clearTimer: (timer) => timers.delete(timer as number),
    onExpired: (ids) => published.push(ids),
  })
  return {
    deadlines,
    published,
    listeners,
    pending: () => timers.size,
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].run()
      }
      now = target
    },
    setVisible(next: boolean) {
      shown = next
      for (const listener of listeners) listener(next)
    },
  }
}

describe('bekleme üst süresi denetçisi (useWaitDeadlines)', () => {
  test('IST-027: süre dolunca kimlik süresi dolmuş olarak yayımlanır', () => {
    const env = fakeEnv()
    env.deadlines.sync(['a', 'b'])
    assert.deepEqual(env.deadlines.expired(), [])
    assert.equal(env.pending(), 1)
    env.advance(FILE_WAIT_LIMIT_MS - 1)
    assert.deepEqual(env.deadlines.expired(), [])
    env.advance(1)
    assert.deepEqual(env.deadlines.expired(), ['a', 'b'])
    assert.deepEqual(env.published, [['a', 'b']])
    // Süresi dolan için yeni zamanlayıcı kurulmaz.
    assert.equal(env.pending(), 0)
  })

  test('IST-027: sekme gizliyken süre işlemez ve zamanlayıcı kurulmaz', () => {
    const env = fakeEnv()
    env.deadlines.sync(['a'])
    env.advance(30_000)
    env.setVisible(false)
    assert.equal(env.pending(), 0)
    env.advance(10 * 60_000)
    assert.deepEqual(env.deadlines.expired(), [])
    env.setVisible(true)
    env.advance(FILE_WAIT_LIMIT_MS - 30_000 - 1)
    assert.deepEqual(env.deadlines.expired(), [])
    env.advance(1)
    assert.deepEqual(env.deadlines.expired(), ['a'])
  })

  test('IST-027: gizli sekmede başlayan bekleme görününce işlemeye başlar', () => {
    const env = fakeEnv(false)
    env.deadlines.sync(['a'])
    assert.equal(env.pending(), 0)
    env.advance(FILE_WAIT_LIMIT_MS * 3)
    assert.deepEqual(env.deadlines.expired(), [])
    env.setVisible(true)
    env.advance(FILE_WAIT_LIMIT_MS)
    assert.deepEqual(env.deadlines.expired(), ['a'])
  })

  test('IST-051: restart süresi dolan kimliğin saatini baştan başlatır', () => {
    const env = fakeEnv()
    env.deadlines.sync(['a', 'b'])
    env.advance(FILE_WAIT_LIMIT_MS)
    assert.deepEqual(env.deadlines.expired(), ['a', 'b'])
    env.deadlines.restart('a')
    assert.deepEqual(env.deadlines.expired(), ['b'])
    env.advance(FILE_WAIT_LIMIT_MS - 1)
    assert.deepEqual(env.deadlines.expired(), ['b'])
    env.advance(1)
    assert.deepEqual(env.deadlines.expired(), ['a', 'b'])
    // İzlenmeyen kimliğin yeniden başlatılması saat açmaz.
    env.deadlines.restart('yok')
    assert.deepEqual(env.deadlines.expired(), ['a', 'b'])
  })

  test('IST-027: listeden çıkan kimliğin saati silinir; geri gelince yeniden başlar', () => {
    const env = fakeEnv()
    env.deadlines.sync(['a'])
    env.advance(FILE_WAIT_LIMIT_MS)
    assert.deepEqual(env.deadlines.expired(), ['a'])
    env.deadlines.sync([])
    assert.deepEqual(env.deadlines.expired(), [])
    env.deadlines.sync(['a'])
    assert.deepEqual(env.deadlines.expired(), [])
    env.advance(FILE_WAIT_LIMIT_MS)
    assert.deepEqual(env.deadlines.expired(), ['a'])
  })

  test('IST-027: dispose zamanlayıcıyı ve görünürlük aboneliğini bırakır', () => {
    const env = fakeEnv()
    env.deadlines.sync(['a'])
    assert.equal(env.listeners.size, 1)
    assert.equal(env.pending(), 1)
    env.deadlines.dispose()
    assert.equal(env.listeners.size, 0)
    assert.equal(env.pending(), 0)
    // Yeniden bağlanınca (Strict Mode) tek abonelikle sürer.
    env.deadlines.sync(['a'])
    env.deadlines.sync(['a'])
    assert.equal(env.listeners.size, 1)
    assert.equal(env.pending(), 1)
    // Kalkan kanca artık yayımlamaz; görünürlük olayı da ulaşmaz.
    env.deadlines.dispose()
    env.setVisible(false)
    env.setVisible(true)
    env.advance(FILE_WAIT_LIMIT_MS * 2)
    assert.equal(env.pending(), 0)
    assert.deepEqual(env.published, [])
  })

  test("IST-051: yeniden denemede geri çekilme sayacı sıfırlanır, aralık 1,5 sn'den başlar", () => {
    const env = fakeEnv()
    const processing = { status: 'processing' } as const
    env.deadlines.sync(['a'])
    // İlk soruşta (okuma yokken) taban kurulur; sonraki okumalar sayılır.
    assert.equal(env.deadlines.attempt('a', 0), 0)
    const before = [1, 2, 3, 4, 5, 6, 7].map((reads) =>
      filePollInterval(processing, null, false, env.deadlines.attempt('a', reads)),
    )
    assert.equal(before.at(-1), FILE_POLL_MAX_INTERVAL_MS)
    env.deadlines.restart('a')
    // Önbellekteki sayaç (7) birikse de aralık baştan başlar.
    assert.equal(env.deadlines.attempt('a', 7), 0)
    assert.equal(
      filePollInterval(processing, null, false, env.deadlines.attempt('a', 8)),
      FILE_POLL_INTERVAL_MS,
    )
    assert.equal(filePollInterval(processing, null, false, env.deadlines.attempt('a', 9)), 2250)
  })

  test('IST-051: yeniden izlenen kimlik (konuşma kaydı "Yeniden gönder") birikmiş sayaçla başlamaz', () => {
    const env = fakeEnv()
    env.deadlines.sync(['a'])
    env.deadlines.attempt('a', 0)
    assert.equal(env.deadlines.attempt('a', 12), 12)
    env.deadlines.sync([])
    env.deadlines.sync(['a'])
    assert.equal(env.deadlines.attempt('a', 12), 0)
    assert.equal(env.deadlines.attempt('a', 13), 1)
    assert.equal(queryReads({ dataUpdateCount: 3, errorUpdateCount: 2 }), 5)
  })
})

describe('dosya bağlama hatası alanı', () => {
  test('IST-027: 422 file_not_ready ve file_rejected dosya alanına yazılır, diğerleri sorulur', () => {
    const fieldFor = fileAttachField('fileIds', (e) => (e.code === 'x' ? 'note' : undefined))
    assert.equal(fieldFor(error(422, 'file_not_ready')), 'fileIds')
    assert.equal(fieldFor(error(422, 'file_rejected')), 'fileIds')
    assert.equal(fieldFor(error(422, 'x')), 'note')
    assert.equal(fieldFor(error(409, 'file_already_attached')), undefined)
    assert.equal(fileAttachField('files')(error(422, 'file_rejected')), 'files')
    assert.match(FILE_REJECTED_MESSAGE, /güvenlik taramasından geçmedi/)
  })
})
