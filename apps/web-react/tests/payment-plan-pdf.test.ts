import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { documentData } from '@kampus/school-core/lib/document-data.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { INSTITUTION_TYPES } from '@kampus/school-core/modules/collection-modules.ts'
import { paymentPlanDocument } from '../src/lib/pdf/templates/payment-plan.ts'
import { allTexts, measurer, texts } from './support/pdf-measurer.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const OPTIONS = { institution: 'Akademi Özel Okulları', generatedAt: NOW }
const COMMITMENT = 'Ödenmemiş taksitleri vade tarihlerinde ödemeyi taahhüt ederim.'
const planOf = () => documentData(createSeed(NOW), 'payment-plan', 's1')

test('IST-105: taahhütname taahhüt cümlesi ve veli imzası taşır', () => {
  const data = planOf()
  const all = allTexts(paymentPlanDocument(measurer, data, OPTIONS))
  assert.ok(all.includes(COMMITMENT))
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

const planWithInstallments = (count: number) => {
  const seed = createSeed(NOW)
  const template = seed.invoices.find((item) => item.studentId === 's1')!
  seed.invoices = Array.from({ length: count }, (_, index) => ({
    ...template,
    id: `inv-${String(index)}`,
    installment: index + 1,
  }))
  return documentData(seed, 'payment-plan', 's1')
}

test('IST-105: taahhüt ve imza 8 taksitli planda tek sayfada kalır', () => {
  const document = paymentPlanDocument(measurer, planWithInstallments(8), OPTIONS)
  assert.equal(document.pages.length, 1)
})

test('IST-105: taksit sayısı ne olursa olsun taahhüt ile imza aynı sayfadadır', () => {
  for (let count = 1; count <= 40; count += 1) {
    const data = planWithInstallments(count)
    const { pages } = paymentPlanDocument(measurer, data, OPTIONS)
    const signature = `Veli · ${data.parent?.name ?? ''}`
    const page = pages.find((item) => texts(item).includes(COMMITMENT))
    assert.ok(page, `${String(count)} taksitte taahhüt cümlesi yok`)
    assert.ok(texts(page).includes(signature), `${String(count)} taksitte imza ayrı sayfada`)
  }
})

test('ADR 0008, DOM-KAY-012: dil okulunda taahhütname "kursiyer" der; okulda ve tür yokken "öğrenci"', () => {
  const data = planOf()
  for (const options of [OPTIONS, { ...OPTIONS, institutionType: 'school' as const }]) {
    const school = allTexts(paymentPlanDocument(measurer, data, options))
    assert.ok(school.includes('Öğrenci'))
    assert.ok(school.includes('Okul numarası / Sınıf'))
    assert.equal(school.includes('Kursiyer'), false)
  }
  for (const institutionType of INSTITUTION_TYPES.filter((type) => type !== 'school')) {
    const all = allTexts(paymentPlanDocument(measurer, data, { ...OPTIONS, institutionType }))
    assert.ok(all.includes('Kursiyer'), institutionType)
    assert.ok(all.includes('Kursiyer numarası / Sınıf'), institutionType)
    assert.equal(all.includes('Öğrenci'), false, institutionType)
    assert.equal(all.includes('Okul numarası / Sınıf'), false, institutionType)
  }
})
