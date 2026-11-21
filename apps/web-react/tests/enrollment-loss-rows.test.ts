import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  lossInstitutionRows,
  lossReasonRows,
  OTHER_INSTITUTIONS,
  UNSPECIFIED,
} from '../src/pages/management/enrollment-loss-rows.ts'

const BREAKDOWN = {
  total: 8,
  reasons: [
    { reason: 'other_school' as const, count: 6 },
    { reason: null, count: 2 },
  ],
  institutions: [{ name: 'Rakip Koleji', count: 4 }],
  otherInstitutions: 1,
  unnamed: 3,
}

test('IST-117: neden satırları etiketli, nedensiz kayıt Belirtilmemiş, pay vazgeçen adaya göre', () => {
  assert.deepEqual(lossReasonRows(BREAKDOWN), [
    { label: 'Başka okul', count: 6, share: 75 },
    { label: UNSPECIFIED, count: 2, share: 25 },
  ])
})

test('IST-117: kurum satırları; sınır dışı ve kurumu yazılmamış adaylar sonda toplu', () => {
  assert.deepEqual(lossInstitutionRows(BREAKDOWN), [
    { label: 'Rakip Koleji', count: 4, share: 50 },
    { label: OTHER_INSTITUTIONS, count: 1, share: 13 },
    { label: UNSPECIFIED, count: 3, share: 38 },
  ])
})

test('IST-117: boş kırılımda satır yok, sıfıra bölme yok', () => {
  const empty = { total: 0, reasons: [], institutions: [], otherInstitutions: 0, unnamed: 0 }
  assert.deepEqual(lossReasonRows(empty), [])
  assert.deepEqual(lossInstitutionRows(empty), [])
})
