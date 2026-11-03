import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ABSENCE_DOCUMENT_LIMIT,
  absenceActions,
  addAbsenceDocument,
  documentIds,
  rejectFormSchema,
} from '../src/pages/requests/absence-forms.ts'

const file = (id: string) => ({ id, name: `${id}.pdf` })

test('DOM-ILT-053: belge sınırı çekirdek sınırıdır (en çok 3)', () => {
  assert.equal(ABSENCE_DOCUMENT_LIMIT, 3)
})

test('Sabah kararı 71: karar yalnız yöneticide ve yalnız karar bekleyen bildirimdedir', () => {
  const pending = { approval: 'pending' as const, fileIds: [] }
  assert.equal(absenceActions(pending, 'admin').decide, true)
  assert.equal(absenceActions(pending, 'teacher').decide, false)
  assert.equal(absenceActions(pending, 'parent').decide, false)
  for (const approval of ['approved', 'rejected'] as const)
    assert.equal(absenceActions({ approval, fileIds: [] }, 'admin').decide, false)
})

test('DOM-ILT-053: belgeyi yalnız veli, karar verilmeden ve yer varsa ekler', () => {
  const pending = { approval: 'pending' as const, fileIds: ['f1'] }
  assert.deepEqual(absenceActions(pending, 'parent'), { decide: false, attach: true, remaining: 2 })
  assert.equal(absenceActions(pending, 'admin').attach, false)
  assert.equal(absenceActions(pending, 'teacher').attach, false)
  assert.equal(
    absenceActions({ approval: 'pending', fileIds: ['a', 'b', 'c'] }, 'parent').attach,
    false,
  )
  assert.equal(
    absenceActions({ approval: 'pending', fileIds: ['a', 'b', 'c'] }, 'parent').remaining,
    0,
  )
  for (const approval of ['approved', 'rejected'] as const)
    assert.equal(absenceActions({ approval, fileIds: [] }, 'parent').attach, false)
})

test('addAbsenceDocument: aynı belge iki kez eklenmez ve liste sınırda kalır', () => {
  const one = addAbsenceDocument([], file('a'))
  assert.deepEqual(addAbsenceDocument(one, file('a')), one)
  const full = [file('a'), file('b'), file('c')]
  assert.equal(addAbsenceDocument(full, file('d')).length, 3)
  assert.equal(addAbsenceDocument([file('a')], file('b'), 1).length, 1)
})

test('documentIds: belge yoksa alan gönderilmez (belge zorunlu değildir)', () => {
  assert.equal(documentIds([]), undefined)
  assert.deepEqual(documentIds([file('a'), file('b')]), ['a', 'b'])
})

test('Sabah kararı 72: red gerekçesi 2-500 karakter, Türkçe iletiyle doğrulanır', () => {
  const empty = rejectFormSchema.safeParse({ reason: '   ' })
  assert.equal(empty.success, false)
  assert.equal(empty.error?.issues[0]?.message, 'Ret gerekçesini yazın.')
  assert.equal(rejectFormSchema.safeParse({ reason: 'x' }).success, false)
  assert.deepEqual(rejectFormSchema.parse({ reason: '  Belge okunaklı değil.  ' }), {
    reason: 'Belge okunaklı değil.',
  })
  const long = rejectFormSchema.safeParse({ reason: 'a'.repeat(501) })
  assert.equal(long.success, false)
  assert.equal(long.error?.issues[0]?.message, 'Gerekçe en fazla 500 karakter olabilir.')
})
