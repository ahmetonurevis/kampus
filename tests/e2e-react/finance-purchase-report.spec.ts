import { readFile } from 'node:fs/promises'

import { createApiClient, switchInstitutionApi, type ApiResult } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Satın alma raporu ekranı (ON-227; DOM-FIN-075, K-155…K-158). Kural dalları birim ve API
// testlerindedir (`tests/finance-purchase-report.test.ts`,
// `apps/api/test/finance-purchase-report.test.ts`); burada yönetici iki siparişin dökümünü tarih
// aralığı ve bütçe dönemiyle görür ve CSV indirir; ön büro sekmeyi görmez.

const ADMIN = '/yonetici/finans?gorunum=satin-alma-raporu'
const DESK = '/onburo/tahsilat-takip?gorunum=satin-alma-raporu'
const TCKN = '10000000146'

const ok = (result: ApiResult, status = 201) => {
  expect(result.status, JSON.stringify(result.body)).toBe(status)
  return (result.body as { data: Record<string, unknown> & { id: string; version: number } }).data
}
const ifMatch = (version: number) => ({ 'if-match': `"${String(version)}"` })
const dayFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/**
 * Bütçe dönemi ve satırı, şirket (Bilişim) ve şahıs (Hizmet) tedarikçi, ikisine birer sipariş:
 * Alfa 10 × 190,00 %20 (brüt 2.280,00), Ayla 1 × 500,00 %0.
 */
async function seedOrders(school: Tenant) {
  const api = await createApiClient({ email: school.user('yonetici').email }, { fresh: true })
  try {
    expect((await switchInstitutionApi(api, school.institutionId)).ok).toBe(true)
    const center = ok(
      await api.post('/api/v1/finance/cost-centers', {
        code: 'BT',
        name: 'Bilgi İşlem',
        type: 'unit',
      }),
    )
    const item = ok(
      await api.post('/api/v1/finance/budget-items', {
        code: 'G-200',
        name: 'Malzeme',
        kind: 'expense',
      }),
    )
    const period = ok(
      await api.post('/api/v1/finance/budget-periods', {
        name: 'Satın alma bütçesi',
        startDate: dayFromNow(-30),
        endDate: dayFromNow(300),
      }),
    )
    ok(
      await api.post(
        `/api/v1/finance/budget-periods/${period.id}/open`,
        undefined,
        ifMatch(period.version),
      ),
      200,
    )
    ok(
      await api.post(`/api/v1/finance/budget-periods/${period.id}/lines`, {
        costCenterId: center.id,
        itemId: item.id,
        amountCents: 1_000_000,
      }),
    )
    const alpha = ok(
      await api.post('/api/v1/finance/suppliers', {
        name: 'Alfa Bilişim A.Ş.',
        type: 'company',
        taxNumber: '1234567890',
        taxOffice: 'Kadıköy',
        categories: ['it'],
      }),
    )
    const person = ok(
      await api.post('/api/v1/finance/suppliers', {
        name: 'Ayla Örnek',
        type: 'individual',
        taxNumber: TCKN,
        taxOffice: 'Üsküdar',
        categories: ['services'],
      }),
    )
    for (const [supplier, quantity, price, vatRate] of [
      [alpha, 10, 19_000, 20],
      [person, 1, 50_000, 0],
    ] as const) {
      const request = ok(
        await api.post('/api/v1/finance/purchase-requests', {
          costCenterId: center.id,
          periodId: period.id,
          budgetItemId: item.id,
          justification: 'Satın alma raporu sınaması',
          items: [{ name: 'Kalem', quantity, unit: 'piece', estimatedUnitPriceCents: price }],
        }),
      )
      const url = `/api/v1/finance/purchase-requests/${request.id}`
      const submitted = ok(
        await api.post(`${url}/submit`, undefined, ifMatch(request.version)),
        200,
      )
      ok(await api.post(`${url}/approve`, {}, ifMatch(submitted.version)), 200)
      const [line] = request.items as { id: string }[]
      const board = ok(
        await api.post(`${url}/quotes`, {
          supplierId: supplier.id,
          deliveryDays: 5,
          validUntil: dayFromNow(30),
          items: [{ requestItemId: line?.id, unitPriceCents: price, vatRate }],
        }),
      )
      const [quote] = board.quotes as { id: string; version: number }[]
      ok(await api.post(`${url}/quotes/${quote?.id}/select`, {}, ifMatch(quote?.version ?? 0)), 200)
      ok(
        await api.post(
          '/api/v1/finance/purchase-orders',
          { quoteId: quote?.id },
          { 'idempotency-key': crypto.randomUUID() },
        ),
      )
    }
  } finally {
    await api.dispose()
  }
}

test.describe('DOM-FIN-075: satın alma raporu ekranı', () => {
  test('DOM-FIN-075: yönetici aralık ve bütçe dönemiyle dökümü görür, CSV indirir (K-155…K-158)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    await seedOrders(school)
    const page = await loginAs(school.user('yonetici'))

    await page.goto(ADMIN)
    const report = page.getByRole('region', { name: 'Satın alma raporu' })
    const summary = report.getByRole('definition').filter({ hasText: '2.780,00 ₺' })
    await expect(summary).toBeVisible()
    await expect(report.getByLabel('Satın alma özeti')).toContainText('380,00 ₺')
    const top = report.getByRole('table', { name: 'En çok harcama yapılan tedarikçiler' })
    await expect(
      top.getByRole('row', { name: /1\. Alfa Bilişim A\.Ş\..*2\.280,00 ₺/ }),
    ).toBeVisible()
    await expect(top.getByRole('row', { name: /2\. Ayla Örnek · Şahıs.*500,00 ₺/ })).toBeVisible()
    const categories = report.getByRole('table', { name: 'Tedarikçi kategorisine göre' })
    await expect(categories.getByRole('row', { name: /Bilişim/ })).toContainText('82,0')
    await expect(
      report.getByRole('table', { name: 'Maliyet merkezine göre' }).getByRole('row', {
        name: /BT · Bilgi İşlem/,
      }),
    ).toContainText('2.780,00 ₺')
    await expect(report.getByText(TCKN)).toHaveCount(0)

    const downloading = page.waitForEvent('download')
    await report.getByRole('button', { name: 'CSV indir' }).click()
    const csv = await readFile(await (await downloading).path(), 'utf8')
    expect(csv).toContain('"Tedarikçi";"Ayla Örnek";"";"Şahıs";"Hizmet";1;500,00;0,00;500,00')
    expect(csv).toContain('"Toplam";"";"";"";"";2;2400,00;380,00;2780,00')
    expect(csv).not.toContain(TCKN)

    await report.getByLabel('Kapsam').selectOption('period')
    await expect(report.getByRole('combobox', { name: /^Bütçe dönemi/ })).toHaveValue(/.+/)
    await expect(summary).toBeVisible()

    await report.getByLabel('Kapsam').selectOption('range')
    await report.getByLabel('Başlangıç günü').fill(dayFromNow(5))
    await report.getByLabel('Bitiş günü').fill(dayFromNow(-5))
    await expect(report.getByRole('alert')).toHaveText(
      'Başlangıç günü bitiş gününden sonra olamaz.',
    )
    await expect(report.getByRole('button', { name: 'CSV indir' })).toBeDisabled()

    await page.setViewportSize({ width: 390, height: 844 })
    await report.getByLabel('Başlangıç günü').fill(dayFromNow(-5))
    await report.getByLabel('Bitiş günü').fill(dayFromNow(1))
    await expect(report.getByRole('alert')).toHaveCount(0)
    await expect(summary).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('DOM-FIN-075: ön büro satın alma raporu sekmesini görmez, adres taksitlere düşer (K-155)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const desk = await loginAs(school.user('onburo'))
    await desk.setViewportSize({ width: 390, height: 844 })
    await desk.goto(DESK)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Satın alma raporu' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Satın alma raporu' })).toHaveCount(0)
    await expectNoHorizontalOverflow(desk)
  })
})
