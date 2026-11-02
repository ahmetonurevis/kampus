import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  afterCorrection,
  correctionCounts,
  correctionDay,
  correctionFormSchema,
  correctionHistory,
  correctionMarks,
  correctionRows,
  correctorIds,
  hasCorrection,
  isSelectableDay,
  NOT_RECORDED,
  previousDay,
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

test('satırlar mevcut ve yeni durumu verir; değişen ve ilk kez yazılacak öğrenci ayrılır', () => {
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
      ['s3', NOT_RECORDED, 'present', 'new'],
    ],
  )

  const edited = correctionRows(students, saved, { s1: 'excused', s2: 'present' })
  assert.equal(edited[0]?.change, 'changed')
  assert.equal(edited[1]?.change, 'same', 'kayıtlı durumla aynı seçim değişiklik sayılmaz')
  assert.deepEqual(correctionCounts(edited), { changed: 1, added: 1 })
  assert.deepEqual(correctionMarks(edited), { s1: 'excused', s2: 'present', s3: 'present' })
})

test('değişiklik yoksa gönderilecek bir şey yoktur; yoklama alınmamış gün ilk kaydı yazar', () => {
  const all = students.map((s) => ({ studentId: s.id, status: 'present' }))
  assert.equal(hasCorrection(correctionRows(students, all)), false)
  assert.equal(hasCorrection(correctionRows(students, all, { s2: 'late' })), true)
  const empty = correctionRows(students, [])
  assert.ok(empty.every((row) => row.change === 'new' && row.current === null))
  assert.equal(hasCorrection(empty), true)
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

test('409 işlenir: çakışmada seçimler ve gerekçe kalır, başarıda temizlenir', () => {
  assert.deepEqual(afterCorrection({ status: 'success' }), { clearEdits: true, clearReason: true })
  assert.deepEqual(afterCorrection({ status: 'failed' }), {
    clearEdits: false,
    clearReason: false,
  })
  assert.deepEqual(afterCorrection({ status: 'busy' }), { clearEdits: false, clearReason: false })
})
