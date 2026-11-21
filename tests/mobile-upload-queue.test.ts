import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../packages/api-client/src/errors.ts'
import {
  createCommandSession,
  runCommand,
  stableFingerprint,
} from '../packages/react-shared/src/commands.ts'
import {
  drainQueue,
  enqueue,
  isUploading,
  nextQueued,
  removeItem,
  retryItem,
  type QueueItem,
  type UploadResult,
} from '../apps/mobile/src/api/upload-queue.ts'
import type { AllowedMimeType } from '../packages/school-core/src/content/taxonomy.ts'
import { resolveMimeType } from '../apps/mobile/src/api/homework-submission.ts'

const entry = (key: string, state: QueueItem['state'] = 'queued'): QueueItem => ({
  key,
  state,
  fileId: null,
  message: null,
})
const states = (items: readonly QueueItem[]) => items.map((item) => `${item.key}:${item.state}`)

/** Bellekte kuyruk ve sahte yükleme; her yükleme çağrısının anahtarı `calls`a yazılır. */
function harness(results: Record<string, UploadResult[]> = {}) {
  const state = { items: [] as QueueItem[] }
  const calls: string[] = []
  const hooks: Record<string, () => void> = {}
  const io = {
    read: () => state.items,
    write: (next: QueueItem[]) => {
      state.items = next
    },
    active: () => true,
    upload: async (item: QueueItem): Promise<UploadResult> => {
      calls.push(item.key)
      hooks[item.key]?.()
      await Promise.resolve()
      return (
        results[item.key]?.shift() ?? { kind: 'done', fileId: `id-${item.key}`, scanning: false }
      )
    },
  }
  return { io, calls, hooks, state }
}

const network: UploadResult = { kind: 'failed', message: 'Bağlantı koptu.', retryable: true }
const rejected: UploadResult = { kind: 'failed', message: 'Dosya reddedildi.', retryable: false }

describe('OG-061 ödev dosyası yükleme kuyruğu (DOM-AKD-072, DOM-KYN-004)', () => {
  test('dosyalar sırayla yüklenir ve done olur', async () => {
    const h = harness()
    h.state.items = enqueue(h.state.items, [entry('a'), entry('b')])
    await drainQueue(h.io)
    assert.deepEqual(h.calls, ['a', 'b'])
    assert.deepEqual(states(h.state.items), ['a:done', 'b:done'])
    assert.deepEqual(
      h.state.items.map((item) => item.fileId),
      ['id-a', 'id-b'],
    )
  })

  test('a) ağ hatası kuyruğu durdurur; yeniden dene başarısız dosyayla kalanları da yükler', async () => {
    const h = harness({ a: [network] })
    h.state.items = enqueue(h.state.items, [entry('a'), entry('b'), entry('c')])
    await drainQueue(h.io)
    assert.deepEqual(states(h.state.items), ['a:failed', 'b:queued', 'c:queued'])
    assert.equal(isUploading(h.state.items), false)
    assert.equal(h.state.items[0]?.message, 'Bağlantı koptu.')
    h.state.items = retryItem(h.state.items, 'a')
    await drainQueue(h.io)
    assert.deepEqual(states(h.state.items), ['a:done', 'b:done', 'c:done'])
    // Başarısız dosya önce, sonra kalanlar sırayla yüklenir.
    assert.deepEqual(h.calls, ['a', 'a', 'b', 'c'])
  })

  test('a) kesin ret yalnız o dosyayı failed yapar, kuyruk sürer', async () => {
    const h = harness({ a: [rejected] })
    h.state.items = enqueue(h.state.items, [entry('a'), entry('b')])
    await drainQueue(h.io)
    assert.deepEqual(states(h.state.items), ['a:failed', 'b:done'])
  })

  test('a) yeniden dene yalnız başarısız dosyayı sıraya alır', () => {
    const items = [entry('a', 'failed'), entry('b', 'done'), entry('c', 'uploading')]
    assert.deepEqual(states(retryItem(items, 'a')), ['a:queued', 'b:done', 'c:uploading'])
    assert.deepEqual(states(retryItem(items, 'b')), ['a:failed', 'b:done', 'c:uploading'])
  })

  test('b) yükleme sürerken eklenen dosya sıraya girer ve işlenir', async () => {
    const h = harness()
    h.state.items = enqueue(h.state.items, [entry('a')])
    // `a` yüklenirken kullanıcı yeni dosya seçer ve döngü yeniden başlatılır.
    h.hooks.a = () => {
      assert.equal(isUploading(h.state.items), true)
      h.state.items = enqueue(h.state.items, [entry('b')])
      // İkinci çağrı sürmekte olan yüklemeyi görüp hemen döner; `b`yi birinci döngü işler.
      void drainQueue(h.io)
    }
    await drainQueue(h.io)
    assert.deepEqual(h.calls, ['a', 'b'])
    assert.deepEqual(states(h.state.items), ['a:done', 'b:done'])
  })

  test('b) aynı anahtarlı dosya yeniden eklenmez', () => {
    const items = enqueue([entry('a', 'done')], [entry('a'), entry('b')])
    assert.deepEqual(states(items), ['a:done', 'b:queued'])
  })

  test('c) kuyruktan kaldırılan dosya yüklenmez', async () => {
    const h = harness()
    h.state.items = enqueue(h.state.items, [entry('a'), entry('b'), entry('c')])
    h.hooks.a = () => {
      h.state.items = removeItem(h.state.items, 'b')
    }
    await drainQueue(h.io)
    assert.deepEqual(h.calls, ['a', 'c'])
    assert.deepEqual(states(h.state.items), ['a:done', 'c:done'])
  })

  test('c) yüklenmekte olan dosya kaldırılamaz', () => {
    const items = [entry('a', 'uploading'), entry('b')]
    assert.deepEqual(states(removeItem(items, 'a')), ['a:uploading', 'b:queued'])
    assert.deepEqual(states(removeItem(items, 'b')), ['a:uploading'])
    assert.equal(nextQueued(removeItem(items, 'b')), undefined)
  })

  test('pencere kapanınca (active false) sonuç yazılmaz ve kuyruk durur', async () => {
    const h = harness()
    h.state.items = enqueue(h.state.items, [entry('a'), entry('b')])
    let alive = true
    h.hooks.a = () => {
      alive = false
    }
    await drainQueue({ ...h.io, active: () => alive })
    assert.deepEqual(h.calls, ['a'])
    assert.equal(h.state.items[1]?.state, 'queued')
  })

  test('DOM-KYN-004 ağ hatasından sonra aynı dosya aynı Idempotency-Key ile gönderilir', async () => {
    const session = createCommandSession()
    const file = { uri: 'file:///a.pdf', name: 'a.pdf', size: 10 }
    const keys: string[] = []
    const run = (fail: ApiError | null) => {
      // Her denemede yeni sinyal: parmak izi dosyaya bağlıdır, sinyale değil.
      const input = { file, signal: new AbortController().signal }
      return runCommand(
        session,
        {
          execute: async (_variables: typeof input, headers) => {
            keys.push(headers['idempotency-key'])
            if (fail) throw fail
            return { ok: true }
          },
          refresh: async () => {},
        },
        input,
      )
    }
    assert.equal(
      stableFingerprint({ file, signal: new AbortController().signal }),
      stableFingerprint({ file, signal: new AbortController().signal }),
    )
    await run(new ApiError({ status: 0, code: 'network_error', message: '' }))
    await run(null)
    assert.equal(keys[0], keys[1])
    // Başarıdan sonraki yeni eylem yeni anahtardır; kesin ret anahtarı bırakır.
    await run(new ApiError({ status: 422, code: 'file_rejected', message: '' }))
    await run(null)
    assert.notEqual(keys[1], keys[2])
    assert.notEqual(keys[2], keys[3])
  })

  test('resolveMimeType daraltılmış tür döndürür', () => {
    const type: AllowedMimeType | null = resolveMimeType({ name: 'a.pdf', mimeType: null })
    assert.equal(type, 'application/pdf')
  })
})
