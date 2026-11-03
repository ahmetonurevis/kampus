import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  listeningPhase,
  RECORDING_CLOSED_NOTE,
  reviewRefusal,
  transcriptVisible,
  type ListeningPhaseInput,
} from '../src/pages/tasks/listening-model.ts'

// Dinleme bölümünün durumu (OG-052; IST-045, DOM-BEC-005): denemede hak sayılır, bağlantı
// geçerliyken oynatıcı açık kalır ve yeniden bağlanma yeni istek atmaz; hak bitince oynatıcı
// kilitlenir. Sonuç ekranında kayıt sayılmadan çalınır; öğrenciye görev açıkken açılmaz.

const NOW = Date.parse('2026-11-03T10:00:00.000Z')
const LIVE = { url: 'https://cdn.test/a', expiresAt: '2026-11-03T10:05:00.000Z' }
const EXPIRED = { url: 'https://cdn.test/a', expiresAt: '2026-11-03T09:59:00.000Z' }

const input = (overrides: Partial<ListeningPhaseInput> = {}): ListeningPhaseInput => ({
  mode: 'attempt',
  allowance: { limit: 2, used: 0, remaining: 2 },
  link: null,
  exhausted: false,
  refusal: null,
  audioPlaying: false,
  now: NOW,
  ...overrides,
})

describe('dinleme bölümü: süren deneme', () => {
  test('DOM-BEC-005: hakkı olan öğrenci kaydı dinlemeye başlar', () => {
    assert.deepEqual(listeningPhase(input()), { kind: 'idle' })
  })

  test('DOM-BEC-005: geçerli bağlantıda oynatıcı açık kalır (aynı pencere, yeni istek yok)', () => {
    assert.deepEqual(
      listeningPhase(input({ link: LIVE, allowance: { limit: 1, used: 1, remaining: 0 } })),
      { kind: 'playing', url: LIVE.url },
    )
  })

  test('DOM-BEC-005: kayıt çalarken bağlantı bitimine yaklaşılsa ya da geçse de oynatıcı kaldırılmaz', () => {
    const spent = { limit: 1, used: 1, remaining: 0 }
    const closing = { url: LIVE.url, expiresAt: new Date(NOW + 4_000).toISOString() }
    for (const link of [closing, EXPIRED])
      for (const allowance of [spent, { limit: 2, used: 1, remaining: 1 }])
        assert.deepEqual(listeningPhase(input({ link, allowance, audioPlaying: true })), {
          kind: 'playing',
          url: link.url,
        })
    assert.deepEqual(
      listeningPhase(input({ mode: 'review', allowance: null, link: closing, audioPlaying: true })),
      { kind: 'playing', url: closing.url },
    )
  })

  test('DOM-BEC-005: duraklatılmış oynatıcı bağlantı bitimine 5 sn kala kapanır', () => {
    const closing = { url: LIVE.url, expiresAt: new Date(NOW + 4_000).toISOString() }
    assert.deepEqual(
      listeningPhase(input({ link: closing, allowance: { limit: 1, used: 1, remaining: 0 } })),
      { kind: 'locked' },
    )
    assert.deepEqual(
      listeningPhase(input({ link: closing, allowance: { limit: 2, used: 1, remaining: 1 } })),
      { kind: 'idle' },
    )
  })

  test('DOM-BEC-005: hak kaldıysa süresi dolan bağlantıdan sonra yeniden dinlenir', () => {
    assert.deepEqual(
      listeningPhase(input({ link: EXPIRED, allowance: { limit: 2, used: 1, remaining: 1 } })),
      { kind: 'idle' },
    )
  })

  test('DOM-BEC-005: sayfa yenilenince hak bitmiş görünse de süren dinleme sürdürülebilir', () => {
    assert.deepEqual(listeningPhase(input({ allowance: { limit: 1, used: 1, remaining: 0 } })), {
      kind: 'resume',
    })
  })

  test('DOM-BEC-005: sunucu hakkın bittiğini söyleyince ya da kendi penceresi kapanınca oynatıcı kilitlenir', () => {
    const spent = { limit: 1, used: 1, remaining: 0 }
    assert.deepEqual(listeningPhase(input({ allowance: spent, exhausted: true })), {
      kind: 'locked',
    })
    assert.deepEqual(listeningPhase(input({ allowance: spent, link: EXPIRED })), {
      kind: 'locked',
    })
    // Sınırsız hakta da sunucunun reddi kilitler.
    assert.deepEqual(listeningPhase(input({ allowance: null, exhausted: true })), {
      kind: 'locked',
    })
  })

  test('DOM-BEC-005: sınırsız hakta oynatıcı hiç kilitlenmez', () => {
    assert.deepEqual(listeningPhase(input({ allowance: null })), { kind: 'idle' })
    assert.deepEqual(listeningPhase(input({ allowance: null, link: EXPIRED })), { kind: 'idle' })
  })
})

describe('dinleme bölümü: sonuç ekranı', () => {
  test('DOM-BEC-005: sonuç ekranında sayaç yok, kayıt sayılmadan çalınır', () => {
    assert.deepEqual(listeningPhase(input({ mode: 'review', allowance: null })), { kind: 'idle' })
    assert.deepEqual(listeningPhase(input({ mode: 'review', allowance: null, link: LIVE })), {
      kind: 'playing',
      url: LIVE.url,
    })
  })

  test('DOM-BEC-005: kuralın ya da sunucunun kapattığı kayıt sakin notla gösterilir', () => {
    assert.deepEqual(listeningPhase(input({ mode: 'review', refusal: RECORDING_CLOSED_NOTE })), {
      kind: 'unavailable',
      message: RECORDING_CLOSED_NOTE,
    })
  })

  test('DOM-BEC-005: personel ve veli kaydı her zaman dinler', () => {
    const closed = { transcriptShown: false }
    const limited = { limit: 1, media: [] }
    assert.equal(reviewRefusal('staff', closed, limited), null)
    assert.equal(reviewRefusal('parent', closed, limited), null)
  })

  test('DOM-BEC-005: öğrenci sınırlı hakta görev kapanana kadar kaydı sonuç ekranında açamaz', () => {
    const limited = { limit: 1, media: [] }
    assert.equal(
      reviewRefusal('learner', { transcriptShown: false }, limited),
      RECORDING_CLOSED_NOTE,
    )
    // Görev kapandı (döküm açık) ya da hak sınırsız: açılır.
    assert.equal(reviewRefusal('learner', { transcriptShown: true }, limited), null)
    assert.equal(reviewRefusal('learner', { transcriptShown: false }, null), null)
  })
})

describe('döküm (DOM-BEC-005)', () => {
  test('DOM-BEC-005: döküm yalnız açıkken ve metin varken gösterilir', () => {
    assert.equal(transcriptVisible({ transcriptShown: true, transcript: 'Tom reads.' }), true)
    assert.equal(transcriptVisible({ transcriptShown: false, transcript: null }), false)
    assert.equal(transcriptVisible({ transcriptShown: true, transcript: '  ' }), false)
    assert.equal(transcriptVisible({ transcriptShown: true, transcript: null }), false)
  })
})
