import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { documentData } from '@kampus/school-core/lib/document-data.ts'
import type { RenewalPricing } from '@kampus/school-core/lib/renewal-ceiling.ts'
import { contractDocument } from '../src/lib/pdf/templates/contract.ts'
import {
  ceilingRows,
  rateSourceLines,
  type RenewalContractContext,
} from '../src/lib/pdf/templates/renewal-contract.ts'
import { allTexts, measurer, texts } from './support/pdf-measurer.ts'

const NOW = '2026-10-06T09:00:00.000Z'
const OPTIONS = { institution: 'Akademi Özel Okulları', generatedAt: new Date(NOW) }

const RATES = [{ academicYear: 2027, ppiBasisPoints: 3000, cpiBasisPoints: 4000 }]
// Baz 200.000 ₺; (30 + 40) / 2 + 5 = %40 → tavan 280.000 ₺.
const APPLIED: RenewalPricing['ceiling'] = {
  status: 'applied',
  baseCents: 20_000_000,
  baseSource: 'contract',
  baseYear: 2026,
  rates: RATES,
  extraBasisPoints: 500,
  ceilingCents: 28_000_000,
  discountLoss: null,
}

/** Tarifeli yenilemenin sözleşmesi: ilan 300.000 ₺, tavanla 280.000 ₺, kardeş indirimi, burs, ek hizmet. */
function fixture(ceiling: RenewalPricing['ceiling'] = APPLIED) {
  const state = createSeed(new Date(NOW))
  const contract = state.contracts[0]!
  const invoices = state.invoices.filter((item) => item.studentId === contract.studentId)
  for (const item of invoices) item.paidAt = null
  const pricing: RenewalPricing = {
    tariffId: 'tariff-renewal-pdf',
    tariffVersion: 3,
    announcedCents: 30_000_000,
    ceiling,
    discounts: [{ kind: 'sibling', amountCents: 3_000_000 }],
    extras: [{ kind: 'meal', amountCents: 1_500_000 }],
    scholarship: { programId: 'program-renewal-pdf', amountCents: 5_000_000 },
  }
  Object.assign(contract, {
    academicYear: 2027,
    title: '2027–2028 eğitim sözleşmesi',
    invoiceIds: invoices.map((item) => item.id),
    tariffId: pricing.tariffId,
    tariffVersion: pricing.tariffVersion,
    grossCents: 28_000_000,
    netCents: 20_000_000,
    discounts: pricing.discounts,
    extras: pricing.extras,
    scholarship: pricing.scholarship,
    payer: 'guardian',
  })
  state.renewals = []
  const renewal: RenewalContractContext = {
    academicYear: 2027,
    status: 'Planlandı',
    fromClassName: '6-A',
    targetClassName: '7-A',
    pricing,
  }
  return { state, contract, renewal }
}

type Fixture = ReturnType<typeof fixture>
const render = ({ state, contract }: Fixture, renewal?: RenewalContractContext) =>
  contractDocument(
    measurer,
    documentData(state, 'contract', contract.id),
    renewal ? { ...OPTIONS, renewal } : OPTIONS,
  )

const pageOf = (document: ReturnType<typeof render>, text: string) =>
  document.pages.findIndex((page) => texts(page).includes(text))

test('IST-100: yenileme sözleşmesi metin sayfasını büyütmez; dönem geçişi Ek 1, ücret kararı Ek 2', () => {
  const setup = fixture()
  const document = render(setup, setup.renewal)
  // Yenileme kaydından açılmayan belge (Sözleşmeler sekmesi) ek bölüm yazmaz.
  const plain = render(setup)
  assert.equal(pageOf(document, 'Ek 1 / Ödeme planı'), pageOf(plain, 'Ek 1 / Ödeme planı'))
  // Ek 2 ödeme planından sonra yeni sayfada başlar.
  assert.equal(pageOf(document, 'Ek 2 / Yenileme ücret kararı'), plain.pages.length)
  assert.equal(allTexts(plain).includes('Ek 2 / Yenileme ücret kararı'), false)
  assert.ok(allTexts(plain).includes('EĞİTİM SÖZLEŞMESİ'))

  const first = texts(document.pages[0]!)
  assert.ok(first.includes('YENİLEME SÖZLEŞMESİ'))
  // Sürüm ve onay durumu sözleşmenin kendisinden (DOM-FIN-051).
  assert.ok(first.some((text) => text.includes('Sürüm 1 · Kurum imzası bekleniyor')))
  assert.ok(first.includes('Öğrenim ücreti (ilan ve tavana göre)'))
  assert.ok(first.includes('280.000,00 ₺'))

  const plan = texts(document.pages[pageOf(document, 'Ek 1 / Ödeme planı')]!)
  assert.ok(plan.some((text) => text.includes('6-A → 7-A · 2027–2028')))
  assert.ok(plan.some((text) => text.includes('geçmiş not, yoklama ve tahsilat korunur')))
  assert.ok(plan.some((text) => text.includes("Ek 2'dedir")))

  const appendix = texts(document.pages[plain.pages.length]!)
  assert.ok(appendix.includes('Ek 2 / Yenileme ücret kararı'))
  assert.ok(appendix.includes('Önceki sınıf'))
  assert.ok(appendix.includes('2027–2028 · 7-A'))
})

test('DOM-FIN-005: Ek 2 ilanı, tavanın bazını, yıl oranlarını, ara tavanı ve en yüksek ücreti gösterir', () => {
  const setup = fixture()
  const all = allTexts(render(setup, setup.renewal))
  for (const text of [
    '300.000,00 ₺',
    'Son sözleşmenin indirimsiz ücreti',
    '2026–2027',
    '%30',
    '%40',
    'İlan ve tavanın küçüğü',
  ])
    assert.ok(
      all.some((item) => item.includes(text)),
      text,
    )
  assert.deepEqual(ceilingRows(APPLIED as Extract<typeof APPLIED, { status: 'applied' }>), [
    ['2027–2028', '%30', '%40', '%40', '280.000,00 ₺'],
  ])
  assert.ok(all.some((text) => text.includes('kurumun TÜİK bülteninden girdiği')))
  assert.ok(all.some((text) => text.includes('Burs indirim değildir')))
})

test('DOM-FIN-005: oranın kaynağı profildeki bültendir; plandan sonra düzeltilen oran belirtilir', () => {
  const applied = APPLIED as Extract<typeof APPLIED, { status: 'applied' }>
  const entry = {
    ...RATES[0]!,
    source: 'TÜİK Enflasyon Bülteni',
    bulletinDate: '2027-01-05',
  }
  const [same] = rateSourceLines(applied, [entry])
  assert.ok(same!.startsWith('2027–2028: TÜİK Enflasyon Bülteni'))
  const [changed] = rateSourceLines(applied, [{ ...entry, cpiBasisPoints: 4100 }])
  assert.ok(changed!.includes('plandan sonra düzeltildi'))
  const [missing] = rateSourceLines(applied, [])
  assert.ok(missing!.includes('kaynak kaydı bulunamadı'))
})

test('DOM-FIN-023: kardeş indirimi kalkınca Ek 2 gerekçeyi ve kayıt yılı bazını yazar', () => {
  const reason =
    'Kardeş indirimi koşulu kalktı. Ücret, kayıt yılındaki indirimsiz ücrete her öğrenim yılı için artış oranı uygulanarak hesaplandı; cari yıl sözleşmesi değişmez.'
  const setup = fixture({
    ...APPLIED,
    baseSource: 'enrollment_contract',
    baseYear: 2025,
    rates: [{ academicYear: 2026, ppiBasisPoints: 3000, cpiBasisPoints: 4000 }, ...RATES],
    ceilingCents: 39_200_000,
    discountLoss: { kinds: ['sibling'], reason },
  })
  const all = allTexts(render(setup, setup.renewal))
  assert.ok(all.includes('İndirim değişikliği'))
  assert.ok(all.includes('Kardeş'))
  assert.ok(all.includes('Kayıt yılı sözleşmesinin indirimsiz ücreti'))
  assert.ok(all.some((text) => text.includes('Kardeş indirimi koşulu kalktı.')))
  // İki yılın oranı sırayla: 200.000 → 280.000 → 392.000 ₺.
  assert.ok(all.includes('392.000,00 ₺'))
})

test('DOM-FIN-005: kademe başı ve bazsız yenilemede tavan uygulanmaz, ilan sınırdır', () => {
  const entry = fixture({ status: 'entry_grade' })
  const entryTexts = allTexts(render(entry, entry.renewal))
  assert.ok(entryTexts.some((text) => text.includes('kademenin başlangıç sınıfıdır')))
  assert.ok(entryTexts.includes('İlan ücreti'))
  const noBase = fixture({ status: 'no_base' })
  assert.ok(
    allTexts(render(noBase, noBase.renewal)).some((text) =>
      text.includes('Artış tavanının bazı bulunamadı'),
    ),
  )
})

test('IST-100: ücret kararı olmayan (köprüyle açılmış) yenileme iki sayfada kalır ve nedenini yazar', () => {
  const setup = fixture()
  // Köprü sözleşmesi tarife kopyası taşımaz; metin sayfası tek sayfada kalır.
  for (const key of ['grossCents', 'netCents', 'discounts', 'extras', 'scholarship', 'tariffId'])
    Reflect.deleteProperty(setup.contract, key)
  const document = render(setup, { ...setup.renewal, pricing: null, status: 'Tamamlandı' })
  assert.equal(document.pages.length, 2)
  const plan = texts(document.pages[1]!)
  assert.ok(plan.includes('Ek 1 / Ödeme planı'))
  assert.ok(plan.some((text) => text.includes('Dönem geçişi uygulandı')))
  assert.ok(plan.some((text) => text.includes('ilan ve artış tavanı kararı kayıtta yok')))
  assert.equal(allTexts(document).includes('Ek 2 / Yenileme ücret kararı'), false)
})

test('IST-100: iptal edilen yenilemenin sözleşmesi yeni dönemde uygulanmadığını yazar', () => {
  const setup = fixture()
  const all = allTexts(render(setup, { ...setup.renewal, status: 'İptal' }))
  assert.ok(all.some((text) => text.includes('Yenileme planı iptal edildi')))
})
