import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { documentData } from '@kampus/school-core/lib/document-data.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { paymentPlanDocument } from '../src/lib/pdf/templates/payment-plan.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const OPTIONS = { institution: 'Akademi Özel Okulları', generatedAt: NOW }
const planOf = () => documentData(createSeed(NOW), 'payment-plan', 's1')

test('IST-105: taahhütname taahhüt cümlesi ve veli imzası taşır', () => {
  const data = planOf()
  const all = allTexts(paymentPlanDocument(measurer, data, OPTIONS))
  assert.ok(all.includes('Yukarıdaki taksitleri vade tarihlerinde ödemeyi taahhüt ederim.'))
  assert.ok(all.includes(`Veli · ${data.parent?.name ?? ''}`))
})

test('IST-105: velisi olmayan kursiyerde taahhüdü ödeyen verir', () => {
  const data = planOf()
  const all = allTexts(paymentPlanDocument(measurer, { ...data, parent: undefined }, OPTIONS))
  assert.ok(all.includes(`Ödeyen · ${data.student.name}`))
})

test('DOM-FIN-051: kısmi ödeme verilince tahsil edilen ve kalan ondan hesaplanır', () => {
  const data = planOf()
  const collectedCents = data.paid + 1_234
  const all = allTexts(paymentPlanDocument(measurer, data, { ...OPTIONS, collectedCents }))
  assert.ok(all.includes(money(collectedCents)))
  assert.ok(all.includes(money(data.total - collectedCents)))
  const fallback = allTexts(paymentPlanDocument(measurer, data, OPTIONS))
  assert.ok(fallback.includes(money(data.total - data.paid)))
})
