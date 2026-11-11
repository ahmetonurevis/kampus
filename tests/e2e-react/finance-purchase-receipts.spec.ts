import { createApiClient, switchInstitutionApi, type ApiResult } from './support/api.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Mal kabul ekranı (ON-226; DOM-FIN-074). Kural dalları birim ve API testlerindedir
// (`tests/finance-purchase-receipts.test.ts`, `apps/api/test/finance-purchase-receipts.test.ts`);
// burada yönetici kısmi kabul (ret nedeniyle) kaydeder ve iptal eder, ön büro kalanı teslim alır ve
// siparişi tamamlar ama kabulü iptal edemez. Kabulün tutanak PDF'i (ON-337) indirilip metni okunur.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

const ok = (result: ApiResult, status = 201) => {
  expect(result.status, JSON.stringify(result.body)).toBe(status)
  return (result.body as { data: Record<string, unknown> & { id: string; version: number } }).data
}
const ifMatch = (version: number) => ({ 'if-match': `"${String(version)}"` })
const dayFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/** Bütçe, tedarikçi, onaylı talep (10 klavye, 3 fare), seçili teklif ve gönderilmiş sipariş API'den kurulur. */
async function seedSentOrder(school: Tenant) {
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
        name: 'Beta Teknoloji Ltd.',
        type: 'company',
        taxNumber: '1111111114',
        taxOffice: 'Kadıköy',
        categories: ['it'],
      }),
    )
    const request = ok(
      await api.post('/api/v1/finance/purchase-requests', {
        costCenterId: center.id,
        periodId: period.id,
        budgetItemId: item.id,
        justification: 'Bilgisayar laboratuvarı için yedek parça',
        items: [
          { name: 'Klavye', quantity: 10, unit: 'piece', estimatedUnitPriceCents: 25_000 },
          { name: 'Fare', quantity: 3, unit: 'piece', estimatedUnitPriceCents: 15_000 },
        ],
      }),
    )
    const url = `/api/v1/finance/purchase-requests/${request.id}`
    const submitted = ok(await api.post(`${url}/submit`, undefined, ifMatch(request.version)), 200)
    ok(await api.post(`${url}/approve`, {}, ifMatch(submitted.version)), 200)
    const [keyboard, mouse] = request.items as { id: string }[]
    const board = ok(
      await api.post(`${url}/quotes`, {
        supplierId: supplier.id,
        deliveryDays: 5,
        validUntil: dayFromNow(30),
        items: [
          { requestItemId: keyboard?.id, unitPriceCents: 19_000, vatRate: 20 },
          { requestItemId: mouse?.id, unitPriceCents: 12_000, vatRate: 20 },
        ],
      }),
    )
    const quote = (board.quotes as { id: string; version: number }[])[0]
    ok(
      await api.post(`${url}/quotes/${String(quote?.id)}/select`, {}, ifMatch(quote?.version ?? 0)),
      200,
    )
    const order = ok(
      await api.post(
        '/api/v1/finance/purchase-orders',
        { quoteId: quote?.id },
        { 'idempotency-key': crypto.randomUUID() },
      ),
    )
    ok(
      await api.post(
        `/api/v1/finance/purchase-orders/${order.id}/send`,
        undefined,
        ifMatch(order.version),
      ),
      200,
    )
    return order.id
  } finally {
    await api.dispose()
  }
}

test.describe('DOM-FIN-074: mal kabul ekranı', () => {
  test('DOM-FIN-074: yönetici kısmi kabul kaydeder, sipariş kısmen teslim olur; kabulü gerekçeyle iptal eder', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    const orderId = await seedSentOrder(school)
    const page = await loginAs(school.user('yonetici'))

    await page.goto(`${ADMIN}?gorunum=siparis&siparis=${orderId}`)
    const order = page.getByRole('dialog', { name: 'Sipariş ayrıntısı' })
    const receiving = order.getByRole('region', { name: 'Mal kabul' })
    await expect(receiving.getByText('Henüz mal kabul yok.')).toBeVisible()

    await receiving.getByRole('button', { name: 'Mal kabul kaydet' }).click()
    const form = page.getByRole('dialog', { name: 'Mal kabul kaydet' })
    await form.getByRole('button', { name: 'Kabulü kaydet' }).click()
    await expect(form.getByText('Teslim alan personeli yazın.')).toBeVisible()
    await expect(
      form.getByText('En az bir kalem için kabul edilen ya da reddedilen miktarı girin.'),
    ).toBeVisible()
    await form.getByLabel('Teslim alan').fill('Hasan Usta')
    await form.getByLabel('Muayene notu (isteğe bağlı)').fill('Kutular hasarlı geldi')
    await form.getByLabel('Klavye kabul edilen').fill('6')
    await form.getByLabel('Klavye reddedilen').fill('2')
    await form.getByLabel('Klavye ret nedeni').fill('Tuşları kırık')
    await form.getByRole('button', { name: 'Kabulü kaydet' }).click()
    await expect(form).toBeHidden()

    await expect(order.getByText('Kısmen teslim alındı', { exact: true })).toBeVisible()
    const progress = receiving.getByRole('table', { name: 'Kalem teslim durumu' })
    await expect(progress.getByRole('row', { name: /Klavye/ })).toContainText('10 adet624')
    await expect(receiving.getByText('1.140,00 ₺').first()).toBeVisible()
    const history = receiving.getByRole('list', { name: 'Kabul geçmişi' })
    await expect(history).toContainText('teslim alan Hasan Usta')
    await expect(history).toContainText('2 ret (Tuşları kırık)')
    await expect(history).toContainText('Muayene notu: Kutular hasarlı geldi')
    // Teslim alınmaya başlanan sipariş iptal edilmez.
    await expect(order.getByRole('button', { name: 'Siparişi iptal et' })).toHaveCount(0)

    // Tutanak PDF'i (ON-337): kabul satırındaki düğme önizlemeyi açar, indirme aynı belgeyi verir.
    await history.getByRole('button', { name: /^Tutanak PDF/ }).click()
    const preview = page.getByRole('dialog', { name: 'Mal kabul tutanağı · Önizleme' })
    const downloading = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toMatch(/^mal-kabul-tutanagi-SA-\d{4}-\d+-MK1\.pdf$/)
    const text = await pdfText(download)
    for (const part of ['MAL KABUL TUTANAĞI', 'Beta Teknoloji Ltd.', 'Hasan Usta', 'Tuşları kırık'])
      expect(text).toContain(part)
    expect(text).toContain('1111111114')
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    await history.getByRole('button', { name: /kabulünü iptal et/ }).click()
    const cancel = page.getByRole('dialog', { name: 'Mal kabulü iptal et' })
    await cancel.getByLabel('İptal gerekçesi').fill('Yanlış siparişe girildi')
    await cancel.getByRole('button', { name: 'İptal et' }).click()
    await expect(cancel).toBeHidden()
    await expect(history.getByText('İptal edildi', { exact: true })).toBeVisible()
    await expect(order.getByText('Gönderildi', { exact: true }).first()).toBeVisible()
    await expect(progress.getByRole('row', { name: /Klavye/ })).toContainText('10 adet0010')
  })

  test('DOM-FIN-074: ön büro kalanı teslim alır, sipariş tamamlanır; iptal düğmesi yok, dar ekranda taşma yok', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const orderId = await seedSentOrder(school)
    const desk = await loginAs(school.user('onburo'))
    await desk.setViewportSize({ width: 390, height: 844 })

    await desk.goto(`${DESK}?gorunum=siparis&siparis=${orderId}`)
    const order = desk.getByRole('dialog', { name: 'Sipariş ayrıntısı' })
    const receiving = order.getByRole('region', { name: 'Mal kabul' })
    await receiving.getByRole('button', { name: 'Mal kabul kaydet' }).click()
    const form = desk.getByRole('dialog', { name: 'Mal kabul kaydet' })
    await form.getByLabel('Teslim alan').fill('Depo Sorumlusu')
    await form.getByLabel('Klavye kabul edilen').fill('11')
    await form.getByRole('button', { name: 'Kabulü kaydet' }).click()
    await expect(form.getByText('Kabul edilen miktar kalanı aşamaz (kalan 10).')).toBeVisible()
    await form.getByLabel('Klavye kabul edilen').fill('10')
    await form.getByLabel('Fare kabul edilen').fill('3')
    await expectNoHorizontalOverflow(desk)
    await form.getByRole('button', { name: 'Kabulü kaydet' }).click()
    await expect(form).toBeHidden()

    await expect(order.getByText('Tamamlandı', { exact: true })).toBeVisible()
    await expect(receiving.getByRole('button', { name: 'Mal kabul kaydet' })).toHaveCount(0)
    await expect(receiving.getByRole('button', { name: /kabulünü iptal et/ })).toHaveCount(0)
    await expect(receiving.getByText('2.260,00 ₺').first()).toBeVisible()
    await expectNoHorizontalOverflow(desk)
  })
})
