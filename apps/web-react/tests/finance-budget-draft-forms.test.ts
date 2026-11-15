import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createDraftFormSchema,
  fileSlug,
  linesBody,
  linesDefaults,
  linesFormField,
  linesFormSchema,
  noteBody,
  ownerText,
  reasonFormSchema,
} from '../src/pages/finance/finance-budget-draft-forms.ts'

// ON-243 (DOM-FIN-093): bütçe taslağı formlarının dönüşümleri ve sunucu alan yolları.

const ITEM = '33333333-3333-4333-8333-333333333333'

test('DOM-FIN-093: satırlar kuruştan form metnine ve geri; boş gerekçe null', () => {
  const values = linesDefaults({
    lines: [
      {
        id: 'l1',
        itemId: ITEM,
        itemCode: 'P-100',
        itemName: 'Personel',
        itemKind: 'expense',
        itemActive: true,
        amountCents: 123_456,
        justification: null,
      },
    ],
  })
  assert.deepEqual(values.lines, [{ itemId: ITEM, amount: '1234,56', justification: '' }])
  assert.deepEqual(
    linesBody({ lines: [{ itemId: ITEM, amount: '1.234,56', justification: '  Zam ' }] }),
    { lines: [{ itemId: ITEM, amountCents: 123_456, justification: 'Zam' }] },
  )
  assert.deepEqual(linesBody({ lines: [{ itemId: ITEM, amount: '0', justification: ' ' }] }), {
    lines: [{ itemId: ITEM, amountCents: 0, justification: null }],
  })
})

test('DOM-FIN-093: form doğrulaması kalem, tutar ve tekil kalem ister', () => {
  const parse = (lines: { itemId: string; amount: string; justification: string }[]) =>
    linesFormSchema.safeParse({ lines })
  assert.equal(parse([{ itemId: ITEM, amount: '10', justification: '' }]).success, true)
  assert.equal(parse([{ itemId: '', amount: '10', justification: '' }]).success, false)
  assert.equal(parse([{ itemId: ITEM, amount: '-5', justification: '' }]).success, false)
  const duplicate = parse([
    { itemId: ITEM, amount: '1', justification: '' },
    { itemId: ITEM, amount: '2', justification: '' },
  ])
  assert.equal(duplicate.success, false)
  assert.deepEqual(duplicate.error?.issues[0]?.path, ['lines', 1, 'itemId'])
  assert.equal(createDraftFormSchema.safeParse({ periodId: '', costCenterId: 'x' }).success, false)
  assert.equal(reasonFormSchema.safeParse({ reason: 'kısa' }).success, false)
  assert.deepEqual(noteBody({ note: '  ' }), { note: null })
})

test('DOM-FIN-093: sunucu alan yolu satır alanına çevrilir', () => {
  assert.equal(linesFormField('lines.2.amountCents'), 'lines.2.amount')
  assert.equal(linesFormField('lines.0.justification'), 'lines.0.justification')
  assert.equal(linesFormField('lines.1.itemId'), 'lines.1.itemId')
  assert.equal(linesFormField('lines'), 'lines')
  assert.equal(linesFormField('lines.3'), 'lines')
  assert.equal(linesFormField('periodId'), undefined)
})

test('DOM-FIN-093: sorumlu metni ve dosya adı parçası', () => {
  assert.equal(ownerText(null), 'Sorumlu yok (yönetici hazırlar)')
  assert.equal(ownerText({ name: 'Selin Kaya' }), 'Selin Kaya')
  assert.equal(ownerText({ name: null }), 'Personel')
  assert.equal(fileSlug(' 2026–2027 Bütçe / KAD '), '2026-2027-Bütçe-KAD')
})
