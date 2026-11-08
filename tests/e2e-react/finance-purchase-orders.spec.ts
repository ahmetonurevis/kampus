import { createApiClient, switchInstitutionApi, type ApiResult } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Teklif karşılaştırması ve satın alma siparişi ekranları (ON-224, ON-225; DOM-FIN-072,
// DOM-FIN-073). Kural dalları birim ve API testlerindedir (`tests/finance-purchase-quotes.test.ts`,
// `tests/finance-purchase-orders.test.ts`, `apps/api/test/finance-purchase-orders.test.ts`); burada
// yönetici teklif girer, en düşük olmayanı gerekçeyle seçer, sipariş açar ve gönderildi işaretler;
// ön büro teklif girer ama seçemez.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

const ok = (result: ApiResult, status = 201) => {
  expect(result.status, JSON.stringify(result.body)).toBe(status)
  return (result.body as { data: Record<string, unknown> & { id: string; version: number } }).data
}
const ifMatch = (version: number) => ({ 'if-match': `"${String(version)}"` })
/** Bugünden 30 gün sonrası (`YYYY-MM-DD`); geçerlilik günü geçmişte olamaz. */
const dayFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
const validUntil = () => dayFromNow(30)

/** Bütçe, iki tedarikçi, onaylı tek kalemli talep ve Beta'nın ucuz teklifi API'den kurulur. */
async function seedApprovedRequest(school: Tenant) {
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
        // Bugünü kapsayan, 366 günü aşmayan dönem.
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
    const supplier = (name: string, taxNumber: string) =>
      api.post('/api/v1/finance/suppliers', {
        name,
        type: 'company',
        taxNumber,
        taxOffice: 'Kadıköy',
        categories: ['it'],
      })
    ok(await supplier('Alfa Bilişim A.Ş.', '1234567890'))
    const beta = ok(await supplier('Beta Teknoloji Ltd.', '1111111114'))
    const request = ok(
      await api.post('/api/v1/finance/purchase-requests', {
        costCenterId: center.id,
        periodId: period.id,
        budgetItemId: item.id,
        justification: 'Bilgisayar laboratuvarı için klavye',
        items: [{ name: 'Klavye', quantity: 10, unit: 'piece', estimatedUnitPriceCents: 25_000 }],
      }),
    )
    const url = `/api/v1/finance/purchase-requests/${request.id}`
    const submitted = ok(await api.post(`${url}/submit`, undefined, ifMatch(request.version)), 200)
    ok(await api.post(`${url}/approve`, {}, ifMatch(submitted.version)), 200)
    const [line] = request.items as { id: string }[]
    ok(
      await api.post(`${url}/quotes`, {
        supplierId: beta.id,
        deliveryDays: 10,
        validUntil: validUntil(),
        items: [{ requestItemId: line?.id, unitPriceCents: 19_000, vatRate: 20 }],
      }),
    )
    return request.id
  } finally {
    await api.dispose()
  }
}

test.describe('DOM-FIN-072, DOM-FIN-073: teklif karşılaştırması ve sipariş ekranı', () => {
  test('DOM-FIN-072, DOM-FIN-073: yönetici teklif girer, en düşük olmayanı gerekçeyle seçer, sipariş açar ve gönderildi işaretler', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    const requestId = await seedApprovedRequest(school)
    const page = await loginAs(school.user('yonetici'))

    await page.goto(`${ADMIN}?gorunum=satin-alma&talep=${requestId}`)
    const panel = page.getByRole('dialog', { name: 'Satın alma talebi' })
    const quotes = panel.getByRole('region', { name: 'Teklifler' })
    await expect(quotes.getByRole('columnheader', { name: /Beta Teknoloji/ })).toBeVisible()

    await quotes.getByRole('button', { name: 'Teklif ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Teklif ekle' })
    await form.getByLabel('Tedarikçi').selectOption({ label: 'Alfa Bilişim A.Ş.' })
    await form.getByLabel('Teslim süresi (gün)').fill('3')
    await form.getByLabel('Geçerlilik tarihi').fill(validUntil())
    await form.getByLabel('Klavye birim fiyatı (₺, KDV hariç)').fill('200,00')
    await expect(form.getByText(/Toplam 2\.400,00 ₺/)).toBeVisible()
    await form.getByRole('button', { name: 'Teklifi kaydet' }).click()
    await expect(form).toBeHidden()

    const table = quotes.getByRole('table', { name: 'Teklif karşılaştırması' })
    const totals = table.getByRole('row', { name: /Toplam \(KDV dahil\)/ })
    await expect(totals.getByRole('cell', { name: /2\.280,00 ₺\s*En düşük/ })).toBeVisible()
    await expect(totals.getByRole('cell', { name: /2\.400,00 ₺/ })).toBeVisible()

    await quotes.getByRole('button', { name: 'Alfa Bilişim A.Ş. teklifini seç' }).click()
    const selection = page.getByRole('dialog', { name: 'Teklifi seç' })
    await selection.getByRole('button', { name: 'Seç' }).click()
    await expect(
      selection.getByText('En düşük teklif seçilmediği için gerekçeyi en az 10 karakterle yazın.'),
    ).toBeVisible()
    await selection.getByLabel('Seçim gerekçesi').fill('Teslim süresi üç gün, yerel servis var')
    await selection.getByRole('button', { name: 'Seç' }).click()
    await expect(selection).toBeHidden()
    await expect(quotes.getByText('Seçim gerekçesi:')).toBeVisible()

    await quotes.getByRole('button', { name: 'Sipariş aç' }).click()
    const orderForm = page.getByRole('dialog', { name: 'Sipariş aç' })
    await orderForm.getByLabel('Sipariş notu (isteğe bağlı)').fill('Teslimat okul deposuna')
    await orderForm.getByRole('button', { name: 'Siparişi aç' }).click()
    await expect(orderForm).toBeHidden()
    const year = new Date().getFullYear()
    const number = `SA-${String(year)}-0001`
    await expect(quotes.getByRole('link', { name: number })).toBeVisible()
    await expect(quotes.getByRole('button', { name: 'Teklif ekle' })).toHaveCount(0)

    await quotes.getByRole('link', { name: number }).click()
    const order = page.getByRole('dialog', { name: 'Sipariş ayrıntısı' })
    await expect(order.getByRole('heading', { name: number })).toBeVisible()
    await expect(order.getByText('Taslak', { exact: true })).toBeVisible()
    await expect(order.getByText('2.400,00 ₺').first()).toBeVisible()
    await order.getByRole('button', { name: 'Sipariş PDF' }).click()
    const pdf = page.getByRole('dialog', { name: 'Satın alma siparişi · Önizleme' })
    await expect(pdf).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(pdf).toBeHidden()
    await order.getByRole('button', { name: 'Gönderildi işaretle' }).click()
    await expect(order.getByText('Gönderildi', { exact: true }).first()).toBeVisible()
    await expect(order.getByRole('button', { name: 'Gönderildi işaretle' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    const orders = page.getByRole('region', { name: 'Satın alma siparişleri' })
    await expect(
      orders
        .getByRole('row', { name: new RegExp(number) })
        .getByText('Gönderildi', { exact: true }),
    ).toBeVisible()
  })

  test('DOM-FIN-072: ön büro teklif girer ama seçemez, sipariş açamaz; dar ekranda taşma yok', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const requestId = await seedApprovedRequest(school)
    const desk = await loginAs(school.user('onburo'))
    await desk.setViewportSize({ width: 390, height: 844 })

    await desk.goto(`${DESK}?gorunum=satin-alma&talep=${requestId}`)
    const quotes = desk
      .getByRole('dialog', { name: 'Satın alma talebi' })
      .getByRole('region', { name: 'Teklifler' })
    await expect(quotes.getByRole('columnheader', { name: /Beta Teknoloji/ })).toBeVisible()
    await expect(quotes.getByRole('button', { name: /teklifini seç/ })).toHaveCount(0)
    await expect(quotes.getByRole('button', { name: 'Sipariş aç' })).toHaveCount(0)
    await quotes.getByRole('button', { name: 'Teklif ekle' }).click()
    const form = desk.getByRole('dialog', { name: 'Teklif ekle' })
    await form.getByLabel('Tedarikçi').selectOption({ label: 'Alfa Bilişim A.Ş.' })
    await form.getByLabel('Geçerlilik tarihi').fill(validUntil())
    await form.getByLabel('Klavye birim fiyatı (₺, KDV hariç)').fill('180,00')
    await form.getByRole('button', { name: 'Teklifi kaydet' }).click()
    await expect(form).toBeHidden()
    await expect(
      quotes.getByRole('button', { name: 'Alfa Bilişim A.Ş. teklifini düzenle' }),
    ).toBeVisible()
    await expect(
      quotes.getByRole('button', { name: 'Beta Teknoloji Ltd. teklifini düzenle' }),
    ).toHaveCount(0)
    await expectNoHorizontalOverflow(desk)

    await desk.goto(`${DESK}?gorunum=siparis`)
    const orders = desk.getByRole('region', { name: 'Satın alma siparişleri' })
    await expect(orders.getByText(/Henüz sipariş yok/)).toBeVisible()
    await expectNoHorizontalOverflow(desk)
  })
})
