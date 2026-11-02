import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '@kampus/api-client/errors.ts'
import { createCommandSession, runCommand } from '@kampus/react-shared/commands.ts'
import {
  canSubmitCorrection,
  correctionCounts,
  correctionDay,
  correctionDirty,
  correctionFormSchema,
  correctionHistory,
  correctionMarks,
  correctionRows,
  correctorIds,
  FIRST_ENTRY_NOTE,
  formAfterSubmit,
  isSelectableDay,
  markUnselectedPresent,
  NOT_RECORDED,
  previousDay,
  sameStatuses,
  savedMessage,
  submitWithFreshState,
  UNKNOWN_ACTOR,
} from '../src/pages/academic/attendance-correction.ts'

// Yönetici yoklama düzeltmesi (IST-093, DOM-AKD-035) ekranının saf hesapları.

const today = '2026-11-02'
const students = [
  { id: 's1', name: 'Deniz Yılmaz' },
  { id: 's2', name: 'Ece Yılmaz' },
  { id: 's3', name: 'Can Demir' },
]

test('DOM-AKD-035 gerekçesiz ya da kısa gerekçeli düzeltme formdan geçmez', () => {
  for (const reason of ['', '   ', ' a ']) {
    const result = correctionFormSchema.safeParse({ reason })
    assert.equal(result.success, false, JSON.stringify(reason))
    assert.equal(result.error?.issues[0]?.path[0], 'reason')
    assert.equal(result.error?.issues[0]?.message, 'Düzeltme için gerekçe yazın.')
  }
  assert.equal(correctionFormSchema.safeParse({ reason: 'x'.repeat(501) }).success, false)
  assert.deepEqual(correctionFormSchema.parse({ reason: '  Veli rapor getirdi ' }), {
    reason: 'Veli rapor getirdi',
  })
})

test('gelecek tarih seçilemez: adresteki ileri gün bugüne, bozuk gün düne düşer', () => {
  assert.equal(isSelectableDay('2026-11-02', today), true, 'bugün seçilebilir')
  assert.equal(isSelectableDay('2026-10-15', today), true)
  assert.equal(isSelectableDay('2026-11-03', today), false, 'yarın seçilemez')
  assert.equal(isSelectableDay('2027-01-01', today), false)
  assert.equal(isSelectableDay('2026-02-30', today), false, 'takvimde olmayan gün')
  assert.equal(isSelectableDay('dün', today), false)

  assert.equal(correctionDay('2026-10-15', today), '2026-10-15')
  assert.equal(correctionDay('2026-11-03', today), today)
  assert.equal(correctionDay('2030-05-05', today), today)
  assert.equal(correctionDay(null, today), '2026-11-01', 'varsayılan dün')
  assert.equal(correctionDay('2026-02-30', today), '2026-11-01')
  assert.equal(previousDay('2026-03-01'), '2026-02-28')
  assert.equal(previousDay('2026-10-26'), '2026-10-25', 'yaz saati geçişinde kayma yok')
})

test('satırlar mevcut ve yeni durumu verir; kaydı olmayan öğrencide varsayılan durum yoktur', () => {
  const saved = [
    { studentId: 's1', status: 'absent' },
    { studentId: 's2', status: 'present' },
  ]
  const untouched = correctionRows(students, saved)
  assert.deepEqual(
    untouched.map((row) => [row.studentId, row.currentLabel, row.next, row.change]),
    [
      ['s1', 'Gelmedi', 'absent', 'same'],
      ['s2', 'Geldi', 'present', 'same'],
      ['s3', NOT_RECORDED, null, 'unselected'],
    ],
  )

  const edited = correctionRows(students, saved, { s1: 'excused', s2: 'present', s3: 'late' })
  assert.deepEqual(
    edited.map((row) => row.change),
    ['changed', 'same', 'new'],
    'kayıtlı durumla aynı seçim değişiklik sayılmaz',
  )
  assert.deepEqual(correctionCounts(edited), { changed: 1, added: 1, unselected: 0 })
  assert.deepEqual(correctionMarks(edited), { s1: 'excused', s2: 'present', s3: 'late' })
  assert.deepEqual(correctionCounts(untouched), { changed: 0, added: 0, unselected: 1 })
  assert.deepEqual(correctionMarks(untouched), { s1: 'absent', s2: 'present' }, 'seçilmeyen gitmez')
})

test('DOM-AKD-035 yeni satırlar seçilmeden kayıt kapalıdır; toplu Geldi yalnız seçilmeyeni doldurur', () => {
  const all = students.map((s) => ({ studentId: s.id, status: 'present' }))
  assert.equal(canSubmitCorrection(correctionRows(students, all)), false, 'değişiklik yok')
  assert.equal(canSubmitCorrection(correctionRows(students, all, { s2: 'late' })), true)
  assert.equal(canSubmitCorrection(correctionRows([], [])), false, 'öğrencisiz sınıf')

  // Yoklaması alınmamış gün: hiçbir satır varsayılan seçili gelmez, kayıt kapalıdır.
  const empty = correctionRows(students, [])
  assert.ok(empty.every((row) => row.change === 'unselected' && row.next === null))
  assert.equal(canSubmitCorrection(empty), false)

  // Bir tane eksik seçim bile kaydı kapalı tutar; son seçimle açılır.
  const partial = { s1: 'present', s2: 'absent' } as const
  assert.equal(canSubmitCorrection(correctionRows(students, [], partial)), false)
  assert.equal(canSubmitCorrection(correctionRows(students, [], { ...partial, s3: 'late' })), true)

  // Karışık gün: kayıtlı öğrenciye ve verilmiş seçime dokunulmaz, yalnız boş kalan Geldi olur.
  const mixed = [{ studentId: 's1', status: 'absent' }]
  const filled = markUnselectedPresent(correctionRows(students, mixed, { s2: 'late' }), {
    s2: 'late',
  })
  assert.deepEqual(filled, { s2: 'late', s3: 'present' })
  assert.equal(canSubmitCorrection(correctionRows(students, mixed, filled)), true)
  const everyone = markUnselectedPresent(empty, {})
  assert.deepEqual(everyone, { s1: 'present', s2: 'present', s3: 'present' })
  assert.equal(canSubmitCorrection(correctionRows(students, [], everyone)), true)
})

test('kirli form: seçim ya da gerekçe varsa gezinirken onay gerekir', () => {
  const saved = students.map((s) => ({ studentId: s.id, status: 'present' }))
  assert.equal(correctionDirty(correctionRows(students, saved), ''), false)
  assert.equal(correctionDirty(correctionRows(students, saved), '   '), false, 'boşluk kirli değil')
  assert.equal(correctionDirty(correctionRows(students, saved), 'Rapor'), true)
  assert.equal(correctionDirty(correctionRows(students, saved, { s1: 'late' }), ''), true)
  // Kayıtlı durumun aynısına geri dönmek kirli sayılmaz.
  assert.equal(correctionDirty(correctionRows(students, saved, { s1: 'present' }), ''), false)
  // Yeni gün: toplu işaret kirlidir; hiç dokunulmamış boş satırlar değildir.
  assert.equal(correctionDirty(correctionRows(students, []), ''), false)
  assert.equal(correctionDirty(correctionRows(students, [], { s1: 'present' }), ''), true)
})

test('DOM-AKD-035 ilk yoklamada gerekçe saklanmaz; toast gerçeği söyler', () => {
  assert.equal(FIRST_ENTRY_NOTE, 'İlk yoklamada gerekçe saklanmaz.')
  assert.equal(savedMessage({ changed: 2, added: 0 }), 'Yoklama düzeltildi.')
  const first = savedMessage({ changed: 0, added: 3 })
  assert.match(first, /Yoklama kaydedildi\./)
  assert.ok(first.includes(FIRST_ENTRY_NOTE))
  assert.ok(!first.includes('gerekçesiyle'))
  const mixed = savedMessage({ changed: 1, added: 1 })
  assert.match(mixed, /düzeltildi/)
  assert.match(mixed, /gerekçe saklanmadı/)
})

test('düzeltme geçmişi en yeniden eskiye; düzelten kişi addan, bilinmeyen kimlik etiketle', () => {
  const records = [
    {
      id: 'att-s1',
      studentId: 's1',
      corrections: [
        {
          previousStatus: 'present',
          status: 'absent',
          reason: 'İlk',
          by: 'u-admin',
          at: '2026-10-20T08:00:00.000Z',
        },
        {
          previousStatus: 'absent',
          status: 'excused',
          reason: 'Rapor',
          by: 'u-gone',
          at: '2026-10-21T08:00:00.000Z',
        },
      ],
    },
    { id: 'att-s2', studentId: 's2' },
    {
      id: 'att-s3',
      studentId: 's3',
      corrections: [
        {
          previousStatus: 'present',
          status: 'late',
          reason: '',
          by: 'u-teacher',
          at: '2026-10-20T09:00:00.000Z',
        },
      ],
    },
  ]
  const history = correctionHistory(
    records,
    new Map(students.map((s) => [s.id, s.name])),
    new Map([
      ['u-admin', 'Murat Yılmaz'],
      ['u-teacher', 'Selin Kaya'],
    ]),
  )
  assert.deepEqual(
    history.map((entry) => [entry.student, entry.previous, entry.next, entry.by, entry.reason]),
    [
      ['Deniz Yılmaz', 'Gelmedi', 'Mazeretli', UNKNOWN_ACTOR, 'Rapor'],
      ['Can Demir', 'Geldi', 'Geç geldi', 'Selin Kaya', ''],
      ['Deniz Yılmaz', 'Geldi', 'Gelmedi', 'Murat Yılmaz', 'İlk'],
    ],
  )
  assert.deepEqual(correctorIds(records).sort(), ['u-admin', 'u-gone', 'u-teacher'])
  assert.deepEqual(correctorIds([{ id: 'x', studentId: 's1' }]), [])
})

const conflict = () => new ApiError({ status: 409, code: 'version_conflict', message: 'x' })

test('409: çakışmada seçimler ve gerekçe kalır, başarıda temizlenir', async () => {
  const form = { edits: { s1: 'excused', s3: 'late' } as const, reason: 'Veli rapor getirdi' }
  // Gerçek komut akışı: sunucu 409 verir, tazeleme çalışır, sonuç `failed` döner.
  let refreshed = 0
  const steps = (execute: () => Promise<string>) => ({
    execute,
    version: () => 4,
    refresh: async () => {
      refreshed += 1
    },
  })
  const failed = await runCommand(
    createCommandSession(),
    steps(() => Promise.reject(conflict())),
    form,
  )
  assert.equal(failed.status, 'failed')
  assert.equal(refreshed, 1, 'çakışmada veri tazelenir')
  assert.deepEqual(formAfterSubmit(form, failed), form, 'form aynen kalır')

  const ok = await runCommand(
    createCommandSession(),
    steps(async () => 'tamam'),
    form,
  )
  assert.equal(ok.status, 'success')
  assert.deepEqual(formAfterSubmit(form, ok), { edits: {}, reason: '' })
  assert.deepEqual(formAfterSubmit(form, { status: 'busy' }), form)
})

test('gönderimden önce güncel sürüm ve yoklama okunur; eski ekran istek atmaz', async () => {
  const shown = [
    { studentId: 's1', status: 'present' },
    { studentId: 's2', status: 'absent' },
  ]
  const calls: string[] = []
  const deps = (fresh: typeof shown, version = 9) => ({
    refreshClassVersion: async () => {
      calls.push('sürüm')
      return version
    },
    refreshSaved: async () => {
      calls.push('yoklama')
      return fresh
    },
    send: async (classVersion: number) => {
      calls.push(`gönder:${classVersion}`)
      return 'tamam'
    },
  })

  // Değişmemiş: sürüm önce, yoklama sonra okunur; istek güncel sürümle gider (listedeki eski değil).
  const sent = await submitWithFreshState(shown, deps([...shown].reverse()))
  assert.deepEqual(sent, { kind: 'sent', outcome: 'tamam' })
  assert.deepEqual(calls, ['sürüm', 'yoklama', 'gönder:9'])

  // Başkası bu arada bir öğrenciyi değiştirmiş: kayıp güncelleme olmasın, istek atılmaz.
  calls.length = 0
  const stale = await submitWithFreshState(
    shown,
    deps([shown[0]!, { studentId: 's2', status: 'late' }]),
  )
  assert.deepEqual(stale, { kind: 'stale' })
  assert.deepEqual(calls, ['sürüm', 'yoklama'])

  // Yoklama sonradan alınmışsa ya da kayıt silinmişse de eski ekran sayılır.
  assert.deepEqual(await submitWithFreshState([], deps(shown)), { kind: 'stale' })
  assert.equal(sameStatuses(shown, shown.slice(0, 1)), false)

  // Okuma başarısızsa gönderilmez; neden korunur.
  const cause = new Error('ağ')
  const down = await submitWithFreshState(shown, {
    ...deps(shown),
    refreshSaved: () => Promise.reject(cause),
  })
  assert.deepEqual(down, { kind: 'unavailable', cause })
})
