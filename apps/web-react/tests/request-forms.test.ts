import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  ABSENCE_REASON_CATEGORIES,
  ABSENCE_REASON_LABELS,
  notifyAbsenceSchema,
  openRequestSchema,
} from '@kampus/school-core/lib/requests.ts'
import {
  ABSENCE_REASON_OPTIONS,
  focusFirstError,
  openRequestDefaults,
  statusOptions,
  unitOptions,
  updateDefaults,
  updateFormSchema,
  updateRequestBody,
} from '../src/pages/requests/request-forms.ts'
import { requestRow } from '../src/pages/requests/request-rows.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')

test('DOM-ILT-080: yeni talep varsayılanı geçerli bir tür taşır, konu ve açıklama boşken reddedilir', () => {
  const defaults = openRequestDefaults('s1')
  assert.deepEqual(defaults, { studentId: 's1', category: 'Talep', title: '', text: '' })
  const empty = openRequestSchema.safeParse(defaults)
  assert.equal(empty.success, false)
  assert.equal(
    openRequestSchema.safeParse({ ...defaults, title: 'Servis', text: 'Durak değişikliği' })
      .success,
    true,
  )
})

test('DOM-ILT-053: gerekçe seçenekleri yalnız kategoridir, etiketler core tablosundan gelir', () => {
  assert.deepEqual(
    ABSENCE_REASON_OPTIONS.map((option) => [option.value, option.label]),
    ABSENCE_REASON_CATEGORIES.map((value) => [value, ABSENCE_REASON_LABELS[value]]),
  )
  assert.equal(ABSENCE_REASON_OPTIONS.length, 4)
  const base = { studentId: 's1', startDate: '2026-11-02', endDate: '2026-11-02' }
  assert.equal(notifyAbsenceSchema.safeParse({ ...base, reasonCategory: 'health' }).success, true)
  // Serbest açıklama kabul edilmez (KVKK md. 6); gerekçe seçilmezse alan mesajı döner.
  assert.equal(
    notifyAbsenceSchema.safeParse({ ...base, reasonCategory: 'health', reason: 'tanı' }).success,
    false,
  )
  const missing = notifyAbsenceSchema.safeParse({ ...base, reasonCategory: '' })
  assert.equal(missing.success, false)
  assert.equal(missing.error?.issues[0]?.message, 'Gerekçe kategorisini seçin.')
})

test('DOM-ILT-080: güncelleme yalnız değişen alanları gönderir', () => {
  const record = { status: 'Yeni', assignedTo: 'Ön büro' }
  const values = { ...updateDefaults(record), status: 'İnceleniyor' as const }
  assert.deepEqual(updateRequestBody(record, values), {
    ok: true,
    body: { status: 'İnceleniyor' },
  })
  assert.deepEqual(
    updateRequestBody(record, {
      status: 'Yeni',
      assignedTo: 'Finans birimi',
      reply: '  Bilgi verildi.  ',
    }),
    { ok: true, body: { assignedTo: 'Finans birimi', reply: 'Bilgi verildi.' } },
  )
})

test('DOM-ILT-080: değişiklik yoksa istek atılmaz; çözülmüş talep durum açılmadan değişmez', () => {
  const record = { status: 'İnceleniyor', assignedTo: 'Ön büro' }
  const none = updateRequestBody(record, updateDefaults(record))
  assert.equal(none.ok, false)
  if (!none.ok) assert.equal(none.field, 'reply')

  const resolved = { status: 'Çözüldü', assignedTo: 'Ön büro' }
  const blocked = updateRequestBody(resolved, { ...updateDefaults(resolved), reply: 'Teşekkürler' })
  assert.equal(blocked.ok, false)
  if (!blocked.ok) {
    assert.equal(blocked.field, 'status')
    assert.match(blocked.message, /İnceleniyor/)
  }
  // Çözülmüş talep önce incelemeye alınınca yanıt yazılabilir.
  assert.equal(
    updateRequestBody(resolved, {
      status: 'İnceleniyor',
      assignedTo: 'Ön büro',
      reply: 'Yeniden bakıyoruz.',
    }).ok,
    true,
  )
})

test('DOM-ILT-080: ele alınmış talep "Yeni" durumuna döndürülemez, seçenek sunulmaz', () => {
  assert.deepEqual(statusOptions('Yeni'), ['Yeni', 'İnceleniyor', 'Çözüldü'])
  assert.deepEqual(statusOptions('İnceleniyor'), ['İnceleniyor', 'Çözüldü'])
  assert.deepEqual(statusOptions('Çözüldü'), ['İnceleniyor', 'Çözüldü'])
})

test('DOM-ILT-080: listede olmayan mevcut durum ve birim seçenek olarak görünür, dokunulmazsa gönderilmez', () => {
  const record = { status: 'Beklemede', assignedTo: 'Eski birim' }
  assert.equal(statusOptions('Beklemede')[0], 'Beklemede')
  assert.equal(unitOptions('Eski birim')[0], 'Eski birim')
  assert.deepEqual(unitOptions('Ön büro'), [
    'Ön büro',
    'Akademik koordinatör',
    'Finans birimi',
    'Şube müdürü',
  ])
  const defaults = updateDefaults(record)
  assert.deepEqual(defaults, { status: 'Beklemede', assignedTo: 'Eski birim', reply: '' })
  // Yalnız yanıt yazıldı: durum ve birim fark hesabına girmez.
  assert.deepEqual(updateRequestBody(record, { ...defaults, reply: 'Bilgi verildi.' }), {
    ok: true,
    body: { reply: 'Bilgi verildi.' },
  })
  // Hiçbir şeye dokunulmadıysa istek atılmaz.
  assert.equal(updateRequestBody(record, defaults).ok, false)
  // Listedeki değere geçmek serbesttir; listede olmayan yeni bir değer reddedilir.
  assert.deepEqual(updateRequestBody(record, { ...defaults, assignedTo: 'Finans birimi' }), {
    ok: true,
    body: { assignedTo: 'Finans birimi' },
  })
  const invalid = updateRequestBody(record, { ...defaults, assignedTo: 'Kantin' })
  assert.equal(invalid.ok, false)
  if (!invalid.ok) assert.equal(invalid.field, 'assignedTo')
})

test('sunucu alan hatasında yalnız ilk hatalı alan odak alır; form düzeyi hata sırayı tüketmez', () => {
  const calls: Array<[string, boolean | undefined]> = []
  const setError = focusFirstError<string>((name, _error, options) => {
    calls.push([name, options?.shouldFocus])
  })
  const error = { type: 'x', message: 'Hata' }
  setError('root.server', error)
  setError('endDate', error)
  setError('startDate', error)
  assert.deepEqual(calls, [
    ['root.server', false],
    ['endDate', true],
    ['startDate', false],
  ])
})

test('güncelleme formu: yanıt boş olabilir, doluysa en az iki karakter ister', () => {
  const base = { status: 'Yeni', assignedTo: 'Ön büro' }
  assert.equal(updateFormSchema.safeParse({ ...base, reply: '' }).success, true)
  assert.equal(updateFormSchema.safeParse({ ...base, reply: ' a ' }).success, false)
  assert.equal(updateFormSchema.safeParse({ ...base, reply: 'Tamam' }).success, true)
  assert.equal(updateFormSchema.safeParse({ ...base, assignedTo: '' }).success, false)
})

test('DOM-ILT-080: talep satırı yanıtları rol etiketiyle ve sırasıyla taşır', () => {
  const [first] = createSeed(NOW).requests
  assert.ok(first)
  const wrap = (record: typeof first) => ({
    id: record.id,
    version: 2,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    archivedAt: null,
    record,
  })
  assert.deepEqual(requestRow(wrap(first)).replies, [])
  const row = requestRow(
    wrap({
      ...first,
      replies: [
        {
          id: 'r1',
          text: 'Servis firmasıyla görüştük.',
          at: '2026-10-14T09:00:00.000Z',
          by: { role: 'onburo', userId: 'u1' },
        },
        {
          id: 'r2',
          text: 'Güzergâh güncellendi.',
          at: '2026-10-15T09:00:00.000Z',
          by: { role: 'yonetici', userId: 'u2' },
        },
      ],
    }),
  )
  assert.deepEqual(
    row.replies.map((reply) => [reply.id, reply.by]),
    [
      ['r1', 'Ön büro'],
      ['r2', 'Yönetici'],
    ],
  )
})
