import test from 'node:test'
import assert from 'node:assert/strict'
import { createDraftRepository, draftKey } from '../apps/mobile/src/model/drafts.js'
import { contentTitle } from '../apps/mobile/src/model/presentation.js'
import { appendMessage, conversationFor } from '../apps/mobile/src/model/messaging.js'
import { createSeed } from '../packages/school-core/src/data/seed.js'

function memoryStorage() {
  const records = new Map()
  return {
    records,
    getItem: async (key) => records.get(key) || null,
    setItem: async (key, value) => {
      records.set(key, value)
    },
    removeItem: async (key) => {
      records.delete(key)
    },
  }
}
test('Taslak: rol, çocuk, kayıt, sınıf/gün ve veri sıfırlama kapsamları ayrıdır', async () => {
  const storage = memoryStorage(),
    repository = createDraftRepository(storage)
  const data = { createdAt: '2026-09-28T06:00:00Z' },
    parent = { role: 'veli', childId: 's1' }
  const key = draftKey(data, parent, 'message', 'conv1')
  const keys = [
    key,
    draftKey(data, { ...parent, childId: 's2' }, 'message', 'conv1'),
    draftKey(data, { role: 'ogrenci' }, 'message', 'conv1'),
    draftKey(data, parent, 'message', 'conv2'),
    draftKey({ createdAt: '2026-09-29T06:00:00Z' }, parent, 'message', 'conv1'),
    draftKey(data, { role: 'ogretmen' }, 'attendance', 'c1:2026-09-28'),
    draftKey(data, { role: 'ogretmen' }, 'attendance', 'c1:2026-09-29'),
  ]
  assert.equal(new Set(keys).size, keys.length)
  await repository.write(key, { text: 'Deniz için görüşme taslağı' })
  assert.deepEqual(await createDraftRepository(storage).read(key), {
    text: 'Deniz için görüşme taslağı',
  })
  for (const other of keys.slice(1)) assert.equal(await repository.read(other), null)
})
test('Taslak: ardışık yazma ve silme yarışında eski çalışma geri gelmez', async () => {
  const storage = memoryStorage(),
    writes = []
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  const repository = createDraftRepository({
    ...storage,
    setItem: async (key, raw) => {
      writes.push(JSON.parse(raw).value)
      if (writes.length === 1) await blocked
      await storage.setItem(key, raw)
    },
  })
  const first = repository.write('key', { text: 'ilk' })
  const second = repository.write('key', { text: 'son' })
  const clear = repository.clear('key')
  release()
  await Promise.all([first, second, clear])
  assert.deepEqual(writes, [{ text: 'ilk' }, { text: 'son' }])
  assert.equal(await repository.read('key'), null)
})
test('Taslak: kayıt hatası bildirilir, önceki sağlam kopya korunur ve yeniden kaydetme çalışır', async () => {
  const storage = memoryStorage()
  let fails = false
  const repository = createDraftRepository({
    ...storage,
    setItem: (key, raw) =>
      fails ? Promise.reject(new Error('Depolama dolu')) : storage.setItem(key, raw),
  })
  await repository.write('key', { marks: { s1: 'present' } })
  fails = true
  await assert.rejects(repository.write('key', { marks: { s1: 'excused' } }), /Depolama/)
  assert.deepEqual(await repository.read('key'), { marks: { s1: 'present' } })
  fails = false
  await repository.write('key', { marks: { s1: 'excused' } })
  assert.deepEqual(await repository.read('key'), { marks: { s1: 'excused' } })
})
test('Taslak: gönderilmiş kayda ait eski sürüm kullanılmaz; bozuk taslak sessizce ezilmez', async () => {
  const storage = memoryStorage(),
    repository = createDraftRepository(storage)
  await repository.write('key', { answer: 'Gönderilmemiş yanıt' }, 'v1')
  assert.equal(await repository.read('key', 'v2'), null)
  storage.records.set('key', '{bozuk')
  await assert.rejects(repository.read('key'))
  assert.equal(storage.records.get('key'), '{bozuk')
  await repository.clear('key')
  assert.equal(await repository.read('key'), null)
})
test('Mobil mesaj: öğretmen/veli/öğrenci ve modül kapsamı doğrulanır', () => {
  const state = createSeed(),
    parent = { role: 'veli', childId: 's1' }
  assert.equal(conversationFor(state, parent, 'conv1'), null)
  assert.equal(conversationFor(state, { ...parent, childId: 's2' }, 'conv2'), null)
  assert.throws(
    () => appendMessage(state, parent, 'conv1', 'Yanlış konuşma', () => 'id'),
    /erişilemiyor/,
  )
  assert.throws(() => appendMessage(state, parent, 'conv2', '', () => 'id'))
  appendMessage(state, parent, 'conv2', 'Deniz için görüşme rica ediyorum.', () => 'new-msg')
  const message = state.conversations.find((c) => c.id === 'conv2').messages.at(-1)
  assert.equal(message.sender, 'parent')
  assert.equal(conversationFor(state, { role: 'ogretmen' }, 'conv2').messages.at(-1).id, 'new-msg')
  state.modules.communication = false
  assert.equal(conversationFor(state, parent, 'conv2'), null)
  assert.throws(() => appendMessage(state, parent, 'conv2', 'Kapalı modül', () => 'id'))
})
test('Görünüm başlığı: yalnızca yinelenen ders öneki temizlenir, gerçek başlık korunur', () => {
  assert.equal(contentTitle('Matematik · Denklemler', 'Matematik'), 'Denklemler')
  assert.equal(contentTitle('İNGİLİZCE: Okuma', 'İngilizce'), 'Okuma')
  assert.equal(contentTitle('Matematiksel düşünme', 'Matematik'), 'Matematiksel düşünme')
  assert.equal(contentTitle('Matematik', 'Matematik'), 'Matematik')
  assert.equal(contentTitle('Fen · Hücre', 'Matematik'), 'Fen · Hücre')
})
