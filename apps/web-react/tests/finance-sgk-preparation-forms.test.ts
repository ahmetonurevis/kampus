import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultSgkMonth,
  SGK_MISSING_DAY_DEFAULTS,
  sgkEmploymentDatesBody,
  sgkEmploymentDatesFormSchema,
  sgkFormField,
  sgkMissingDayBody,
  sgkMissingDayFormSchema,
  sgkMissingEntryText,
  sgkWarningText,
  sgkWarningTone,
  validSgkMonth,
} from '../src/pages/finance/finance-sgk-preparation-forms.ts'
import { sgkEntryExitCell } from '../src/lib/pdf/templates/finance-sgk-preparation.ts'

// SGK hazırlık listesi formları ve gösterimi (DOM-FIN-107; ON-203).

test('DOM-FIN-107: varsayılan ay bir önceki ay, geçersiz ay istek atmaz', () => {
  assert.equal(defaultSgkMonth('2026-11-17'), '2026-10')
  assert.equal(defaultSgkMonth('2026-01-03'), '2025-12')
  assert.equal(validSgkMonth('2026-10'), '2026-10')
  assert.equal(validSgkMonth(''), null)
  assert.equal(validSgkMonth('2026-13'), null)
})

test('DOM-FIN-107 K-353: eksik gün formu ve gövdesi', () => {
  const issues = (value: unknown) =>
    sgkMissingDayFormSchema.safeParse(value).error?.issues.map((issue) => issue.message)
  assert.deepEqual(issues({ ...SGK_MISSING_DAY_DEFAULTS, days: '0' }), [
    'Eksik gün sayısını 1 ile 30 arasında girin.',
  ])
  assert.deepEqual(issues({ ...SGK_MISSING_DAY_DEFAULTS, days: '31' }), [
    'Eksik gün sayısını 1 ile 30 arasında girin.',
  ])
  assert.equal(issues({ ...SGK_MISSING_DAY_DEFAULTS, days: '2', reasonCode: '12' })?.length, 1)
  const values = sgkMissingDayFormSchema.parse({ days: ' 3 ', reasonCode: '', note: '  ' })
  assert.deepEqual(sgkMissingDayBody('m-1', '2026-10', values), {
    membershipId: 'm-1',
    month: '2026-10',
    days: 3,
    reasonCode: null,
    note: null,
  })
  assert.deepEqual(
    sgkMissingDayBody('m-1', '2026-10', { days: '2', reasonCode: '21', note: ' İzin ' }),
    { membershipId: 'm-1', month: '2026-10', days: 2, reasonCode: '21', note: 'İzin' },
  )
})

test('DOM-FIN-107 K-352: giriş/çıkış formu ay içi ve sıra denetimi', () => {
  const schema = sgkEmploymentDatesFormSchema('2026-10')
  const issues = (value: unknown) =>
    schema.safeParse(value).error?.issues.map((issue) => issue.message)
  assert.deepEqual(issues({ entryDate: '', exitDate: '', note: '' }), [
    'Giriş ya da çıkış gününden en az birini girin.',
  ])
  assert.deepEqual(issues({ entryDate: '2026-11-01', exitDate: '', note: '' }), [
    'Gün seçilen ayın içinde olmalıdır.',
  ])
  assert.deepEqual(issues({ entryDate: '2026-10-20', exitDate: '2026-10-10', note: '' }), [
    'Çıkış günü giriş gününden önce olamaz.',
  ])
  assert.deepEqual(
    sgkEmploymentDatesBody('m-1', '2026-10', { entryDate: '', exitDate: '2026-10-20', note: '' }),
    { membershipId: 'm-1', month: '2026-10', entryDate: null, exitDate: '2026-10-20', note: null },
  )
})

test('DOM-FIN-107: gösterim yardımcıları', () => {
  assert.equal(sgkFormField('days', ['days', 'note'] as const), 'days')
  assert.equal(sgkFormField('membershipId', ['days', 'note'] as const), null)
  assert.equal(sgkMissingEntryText({ days: 2, reasonCode: null }), '2 gün · neden girilmemiş')
  assert.equal(sgkMissingEntryText({ days: 1, reasonCode: '01' }), '1 gün · 01 · İstirahat')
  assert.equal(sgkWarningTone('entry_in_month'), 'purple')
  assert.equal(sgkWarningTone('below_floor'), 'amber')
  assert.equal(sgkWarningText('missing_reason'), 'Eksik gün nedeni girilmemiş')
  const row = { entryDate: '2026-10-16', exitDate: null } as Parameters<typeof sgkEntryExitCell>[0]
  assert.equal(sgkEntryExitCell(row), 'G 16 Eki')
  assert.equal(
    sgkEntryExitCell({ ...row, entryDate: null } as Parameters<typeof sgkEntryExitCell>[0]),
    '—',
  )
})
