import { createApiClient, switchInstitutionApi, type ApiResult } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant } from './support/tenant.ts'

// Tedarikçi faturası üçlü eşleştirmesi (ON-277; DOM-FIN-095). Kural dalları birim ve API
// testlerindedir (`tests/finance-invoice-matching.test.ts`, `apps/api/test/finance-invoice-matching.test.ts`);
// burada yönetici sipariş kalemleriyle fatura girer, miktar farkını görür, ödeme uyarısını ve
// gerekçeli fark onayını yapar, faturayı "Eşleşmeyen faturalar" sekmesinde ve siparişte görür.

const ADMIN = '/yonetici/finans'

const ok = (result: ApiResult, status = 201) => {
  expect(result.status, JSON.stringify(result.body)).toBe(status)
  return (result.body as { data: Record<string, unknown> & { id: string; version: number } }).data
}
const ifMatch = (version: number) => ({ 'if-match': `"${String(version)}"` })
const dayFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/** Tedarikçi, bütçe, 10 × 190,00 %20 gönderilmiş sipariş ve 5 adedin mal kabulü API'den kurulur. */
async function seedOrder(school: Tenant) {
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
    const supplier = ok(
      await api.post('/api/v1/finance/suppliers', {
        name: 'Alfa Bilişim A.Ş.',
        type: 'company',
        taxNumber: '1234567890',
        taxOffice: 'Kadıköy',
        categories: ['it'],
      }),
    )
    const request = ok(
      await api.post('/api/v1/finance/purchase-requests', {
        costCenterId: center.id,
        periodId: period.id,
        budgetItemId: item.id,
        justification: 'Fatura eşleştirme sınaması',
        items: [{ name: 'Klavye', quantity: 10, unit: 'piece', estimatedUnitPriceCents: 19_000 }],
      }),
    )
    const url = `/api/v1/finance/purchase-requests/${request.id}`
    const submitted = ok(await api.post(`${url}/submit`, undefined, ifMatch(request.version)), 200)
    ok(await api.post(`${url}/approve`, {}, ifMatch(submitted.version)), 200)
    const [line] = request.items as { id: string }[]
    const board = ok(
      await api.post(`${url}/quotes`, {
        supplierId: supplier.id,
        deliveryDays: 5,
        validUntil: dayFromNow(30),
        items: [{ requestItemId: line?.id, unitPriceCents: 19_000, vatRate: 20 }],
      }),
    )
    const [quote] = board.quotes as { id: string; version: number }[]
    ok(await api.post(`${url}/quotes/${quote?.id}/select`, {}, ifMatch(quote?.version ?? 0)), 200)
    const order = ok(
      await api.post(
        '/api/v1/finance/purchase-orders',
        { quoteId: quote?.id },
        { 'idempotency-key': crypto.randomUUID() },
      ),
    )
    const orderUrl = `/api/v1/finance/purchase-orders/${order.id}`
    const sent = ok(await api.post(`${orderUrl}/send`, undefined, ifMatch(order.version)), 200)
    const [orderItem] = sent.items as { id: string }[]
    ok(
      await api.post(
        `${orderUrl}/receipts`,
        {
          receiptDate: dayFromNow(0),
          receivedBy: 'Hasan Usta',
          lines: [{ orderItemId: orderItem?.id, acceptedQuantity: 5 }],
        },
        { 'idempotency-key': crypto.randomUUID() },
      ),
    )
    return { orderNumber: String(sent.number) }
  } finally {
    await api.dispose()
  }
}

test.describe('DOM-FIN-095: tedarikçi faturası üçlü eşleştirmesi', () => {
  test('DOM-FIN-095: kabul edilenden fazla faturalanan kalem miktar farkıdır; fark gerekçeyle onaylanır (K-280…K-283)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    const { orderNumber } = await seedOrder(school)
    const page = await loginAs(school.user('yonetici'))

    await page.goto(`${ADMIN}?gorunum=tedarikci-cari&cari=fatura`)
    const section = page.getByRole('region', { name: 'Tedarikçi carisi' })
    await section.getByRole('button', { name: 'Fatura ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Tedarikçi faturası ekle' })
    await form.getByLabel('Tedarikçi', { exact: true }).selectOption({ label: 'Alfa Bilişim A.Ş.' })
    await form.getByLabel('Fatura numarası').fill('ALF-8')
    await form.getByLabel('Tutar', { exact: true }).selectOption({ label: 'KDV hariç' })
    await form.getByLabel('Fatura tutarı (₺)').fill('1.520')
    await form.getByLabel('KDV tutarı (₺)').fill('304')
    await form.getByLabel('Sipariş (isteğe bağlı)').selectOption({ index: 1 })
    await form.getByRole('button', { name: 'Sipariş kalemlerini getir' }).click()
    await expect(form.getByLabel('1. kalem miktarı')).toHaveValue('10')
    await form.getByLabel('1. kalem miktarı').fill('8')
    await expect(
      form.getByText(/Kalem toplamı 1\.520,00 ₺ \/ fatura KDV hariç 1\.520,00 ₺/),
    ).toBeVisible()
    await form.getByLabel('Vade günü').fill(dayFromNow(30))
    await form.getByRole('button', { name: 'Faturayı kaydet' }).click()
    await expect(form).toBeHidden()

    const detail = page.getByRole('dialog', { name: 'Tedarikçi faturası' })
    const matching = detail.getByRole('region', { name: 'Sipariş ve mal kabul eşleştirmesi' })
    await expect(matching.getByText('Miktar farkı', { exact: true }).first()).toBeVisible()
    await expect(matching.getByText('3 fazla')).toBeVisible()
    await detail.getByRole('button', { name: '1. taksite ödeme gir' }).click()
    const payment = page.getByRole('dialog', { name: 'Ödeme gir' })
    await expect(payment.getByRole('alert')).toContainText('eşleşmiyor')
    await payment.getByRole('button', { name: 'Vazgeç' }).click()
    await matching.getByRole('button', { name: 'Farkı onayla' }).click()
    const approve = page.getByRole('dialog', { name: 'Eşleştirme farkını onayla' })
    await approve.getByLabel('Onay gerekçesi').fill('Kalan üç adet bu hafta teslim edilecek')
    await approve.getByRole('button', { name: 'Farkı onayla' }).click()
    await expect(approve).toBeHidden()
    await expect(matching.getByText('Fark onaylandı', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    await section.getByRole('button', { name: 'Eşleşmeyen faturalar' }).click()
    const row = section.getByRole('row', { name: /ALF-8/ })
    await expect(row.getByText(orderNumber)).toBeVisible()
    await expect(row.getByText('Onaylandı', { exact: true })).toBeVisible()
  })
})
