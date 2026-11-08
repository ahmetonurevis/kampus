import assert from 'node:assert/strict'
import test from 'node:test'

import {
  centerTypeLabel,
  consolidationNotes,
  costNotes,
  defaultPeriodId,
  perStudentLabel,
  shareLabel,
  studentCountLabel,
} from '../src/pages/finance/finance-cost-report-model.ts'

const plain = (text: string) => text.replaceAll(' ', ' ')

test('DOM-FIN-065: varsayılan dönem ilk açık dönemdir, yoksa listenin ilki', () => {
  assert.equal(defaultPeriodId(undefined), null)
  assert.equal(defaultPeriodId([]), null)
  assert.equal(
    defaultPeriodId([
      { id: 'd', status: 'draft' },
      { id: 'o', status: 'open' },
    ]),
    'o',
  )
  assert.equal(defaultPeriodId([{ id: 'c', status: 'closed' }]), 'c')
})

test('DOM-FIN-065: küçük grup ve boş değer etiketleri', () => {
  assert.equal(perStudentLabel(1_000, true), 'Küçük grup')
  assert.equal(perStudentLabel(null, false), '—')
  assert.equal(plain(perStudentLabel(123_456, false)), '1.234,56 ₺')
  assert.equal(shareLabel(null), '—')
  assert.equal(shareLabel(6_122), '%61,22')
  assert.equal(centerTypeLabel('unit', true), 'Birim · paylaştırıldı')
  assert.equal(centerTypeLabel('campus', false), 'Kampüs')
  assert.equal(studentCountLabel(null), '—')
})

test('DOM-FIN-065: açıklamalar anahtarı, eşiği ve paylaştırılamayan tutarı yazar', () => {
  const notes = costNotes({
    key: 'equal',
    minGroupSize: 5,
    totals: { unallocatedCents: 50_000, studentsWithoutCampus: 2 },
  })
  assert.match(notes[0] ?? '', /eşit/)
  assert.ok(notes.some((note) => note.startsWith('5 öğrenciden küçük')))
  assert.ok(notes.some((note) => plain(note).includes('500,00 ₺ ortak gider')))
  assert.ok(notes.some((note) => note.startsWith('2 öğrencinin')))
  assert.equal(
    costNotes({
      key: 'students',
      minGroupSize: 5,
      totals: { unallocatedCents: 0, studentsWithoutCampus: 0 },
    }).length,
    4,
  )
  assert.equal(consolidationNotes({ minGroupSize: 5 }).length, 4)
})
