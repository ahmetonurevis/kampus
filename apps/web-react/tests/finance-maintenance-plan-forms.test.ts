import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MaintenancePlanDetail } from '@kampus/react-shared/use-finance-maintenance-plans.ts'
import {
  dueText,
  inspectionBody,
  inspectionDefaults,
  inspectionFormField,
  inspectionFormSchema,
  parsePeriod,
  planBody,
  planChanges,
  planDefaults,
  planFormField,
  planFormSchema,
  responsibleText,
  suggestedFor,
} from '../src/pages/finance/finance-maintenance-plan-forms.ts'

// ON-240 (DOM-FIN-092): periyodik bakım planı ve denetim form modeli.

const SUPPLIER = '6b0d3c1e-0a4e-4d8f-9a55-0b3e1c2d4f60'
const PLAN: MaintenancePlanDetail = {
  id: 'p-1',
  name: 'A blok asansörü',
  type: 'elevator',
  campusId: null,
  campusName: null,
  location: 'A blok giriş',
  asset: null,
  periodMonths: 12,
  isLegal: true,
  previousDoneDate: '2025-10-20',
  lastDoneDate: '2025-10-20',
  nextDueDate: '2026-10-20',
  dueStatus: 'due_soon',
  daysLeft: 14,
  responsible: { type: 'supplier', id: SUPPLIER, name: 'Beta Asansör Ltd.' },
  version: 3,
  inspections: [],
}

test('DOM-FIN-092: yeni plan formu türün önerisiyle açılır; gövde boşlukları null yapar (K-252)', () => {
  const values = { ...planDefaults(), name: ' Kazan ', location: 'Bodrum', type: 'boiler' as const }
  assert.deepEqual(planDefaults().periodMonths, '12')
  assert.deepEqual(suggestedFor('fire_extinguisher'), { periodMonths: '6', isLegal: true })
  assert.deepEqual(suggestedFor('other'), { periodMonths: '12', isLegal: false })
  assert.equal(planFormSchema.safeParse(values).success, true)
  assert.deepEqual(planBody(values), {
    name: 'Kazan',
    type: 'boiler',
    campusId: null,
    location: 'Bodrum',
    assetTagNumber: null,
    periodMonths: 12,
    isLegal: true,
    lastDoneDate: null,
    responsible: null,
  })
  assert.deepEqual(
    planBody({ ...values, responsibleType: 'staff', membershipId: 'm-1' }).responsible,
    { type: 'staff', membershipId: 'm-1' },
  )
})

test('DOM-FIN-092: plan formu doğrulaması; periyot, sorumlu seçimi ve etiket', () => {
  const base = { ...planDefaults(), name: 'Asansör', location: 'A blok' }
  for (const periodMonths of ['0', '61', '1,5', 'on'])
    assert.equal(planFormSchema.safeParse({ ...base, periodMonths }).success, false)
  assert.equal(parsePeriod(' 6 '), 6)
  assert.equal(parsePeriod('60'), 60)
  assert.equal(parsePeriod(''), null)
  const staff = planFormSchema.safeParse({ ...base, responsibleType: 'staff' })
  assert.deepEqual(staff.error?.issues[0]?.path, ['membershipId'])
  const supplier = planFormSchema.safeParse({ ...base, responsibleType: 'supplier' })
  assert.deepEqual(supplier.error?.issues[0]?.path, ['supplierId'])
  assert.equal(planFormSchema.safeParse({ ...base, assetTagNumber: 'DB-1!' }).success, false)
  assert.equal(planFormSchema.safeParse({ ...base, lastDoneDate: '2026-02-30' }).success, false)
})

test('DOM-FIN-092: düzeltmede yalnız değişen alanlar gider', () => {
  const values = planDefaults(PLAN)
  assert.equal(values.responsibleType, 'supplier')
  assert.equal(values.supplierId, SUPPLIER)
  assert.equal(values.lastDoneDate, '2025-10-20')
  assert.deepEqual(planChanges(values, PLAN), {})
  assert.deepEqual(planChanges({ ...values, periodMonths: '6', location: 'B blok' }, PLAN), {
    location: 'B blok',
    periodMonths: 6,
  })
  assert.deepEqual(planChanges({ ...values, responsibleType: '' }, PLAN), { responsible: null })
})

test('DOM-FIN-092: sunucu alan yolları form alanına çevrilir', () => {
  assert.equal(planFormField('membershipId'), 'membershipId')
  assert.equal(planFormField('responsible.supplierId'), 'supplierId')
  assert.equal(planFormField('responsible'), 'responsibleType')
  assert.equal(planFormField('responsible.type'), 'responsibleType')
  assert.equal(planFormField('assetTagNumber'), 'assetTagNumber')
  assert.equal(planFormField('institutionId'), undefined)
  assert.equal(inspectionFormField('doneDate'), 'doneDate')
  assert.equal(inspectionFormField('planId'), undefined)
})

test('DOM-FIN-092: denetim formu; uygunsuzlukta not zorunlu, sorumlunun adı önerilir (K-254)', () => {
  const defaults = inspectionDefaults('2026-10-06', PLAN.responsible)
  assert.equal(defaults.performedBy, 'Beta Asansör Ltd.')
  assert.equal(inspectionDefaults('2026-10-06', null).performedBy, '')
  const failed = inspectionFormSchema.safeParse({ ...defaults, result: 'fail', note: ' kısa ' })
  assert.deepEqual(failed.error?.issues[0]?.path, ['note'])
  assert.equal(
    inspectionFormSchema.safeParse({ ...defaults, result: 'partial', note: 'Kapı kilidi gevşek.' })
      .success,
    true,
  )
  assert.deepEqual(inspectionBody({ ...defaults, documentNumber: ' ', note: '' }), {
    doneDate: '2026-10-06',
    performedBy: 'Beta Asansör Ltd.',
    result: 'pass',
    documentNumber: null,
    note: null,
  })
})

test('DOM-FIN-092: takvim ve sorumlu metni', () => {
  assert.equal(dueText({ dueStatus: 'never', daysLeft: null }), 'Denetim kaydı yok')
  assert.equal(dueText({ dueStatus: 'due_soon', daysLeft: 0 }), 'Bugün')
  assert.equal(dueText({ dueStatus: 'overdue', daysLeft: -5 }), '5 gün gecikti')
  assert.equal(dueText({ dueStatus: 'ok', daysLeft: 40 }), '40 gün kaldı')
  assert.equal(responsibleText(null), '—')
  assert.equal(responsibleText(PLAN.responsible), 'Beta Asansör Ltd. (tedarikçi)')
  assert.equal(responsibleText({ type: 'staff', id: 'm', name: 'Selin Kaya' }), 'Selin Kaya')
  assert.equal(responsibleText({ type: 'staff', id: 'm', name: null }), 'Personel')
})
