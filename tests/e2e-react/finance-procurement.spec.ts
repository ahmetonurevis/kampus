import type { Page } from '@playwright/test'

import { createApiClient, switchInstitutionApi, type ApiResult } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Tedarikçi ve satın alma talebi ekranları (ON-221, ON-222; DOM-FIN-070, DOM-FIN-071). Kural dalları
// birim ve API testlerindedir (`tests/finance-suppliers.test.ts`,
// `tests/finance-purchase-requests.test.ts`, `apps/api/test/finance-*.test.ts`); burada yönetici
// tedarikçi ekler ve talebi açıp onaylar, ön büro talep açar ama onaylayamaz; bütçeyi aşan talep
// gönderimde ve onayda uyarıdan sonra açık onayla geçer (ON-245).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'
const TCKN = '10000000146'
const IBAN = 'TR33 0006 1005 1978 6457 8413 26'

const created = (result: ApiResult) => {
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return (result.body as { data: { id: string; version: number } }).data
}

/** Birim merkezi, gider kalemi ve 10.000 TL planlı açık bütçe dönemi API'den kurulur. */
async function seedBudget(school: Tenant) {
  const api = await createApiClient({ email: school.user('yonetici').email }, { fresh: true })
  try {
    expect((await switchInstitutionApi(api, school.institutionId)).ok).toBe(true)
    const center = created(
      await api.post('/api/v1/finance/cost-centers', {
        code: 'BT',
        name: 'Bilgi İşlem',
        type: 'unit',
      }),
    )
    const item = created(
      await api.post('/api/v1/finance/budget-items', {
        code: 'G-200',
        name: 'Malzeme',
        kind: 'expense',
      }),
    )
    const period = created(
      await api.post('/api/v1/finance/budget-periods', {
        name: 'Satın alma bütçesi',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      }),
    )
    const opened = await api.post(`/api/v1/finance/budget-periods/${period.id}/open`, undefined, {
      'if-match': `"${String(period.version)}"`,
    })
    expect(opened.status, JSON.stringify(opened.body)).toBe(200)
    created(
      await api.post(`/api/v1/finance/budget-periods/${period.id}/lines`, {
        costCenterId: center.id,
        itemId: item.id,
        amountCents: 1_000_000,
      }),
    )
  } finally {
    await api.dispose()
  }
}

async function fillRequest(
  page: Page,
  item: string,
  { quantity = '4', price = '500,00', total = '2.000,00 ₺' } = {},
) {
  await page.getByRole('button', { name: 'Yeni talep' }).click()
  const form = page.getByRole('dialog', { name: 'Yeni satın alma talebi' })
  await form.getByLabel('Talep eden birim').selectOption({ label: 'BT · Bilgi İşlem' })
  await form.getByLabel('Bütçe dönemi').selectOption({ index: 1 })
  await form.getByLabel('Gider kalemi').selectOption({ label: 'G-200 · Malzeme' })
  await form.getByLabel('Gerekçe').fill('Bilgisayar laboratuvarı için yedek parça')
  await form.getByLabel('1. kalem adı').fill(item)
  await form.getByLabel('Miktar').fill(quantity)
  await form.getByLabel('Tahmini birim fiyat (₺)').fill(price)
  await expect(form.getByText(`Tahmini toplam: ${total}`)).toBeVisible()
  return form
}

test.describe('DOM-FIN-070, DOM-FIN-071: tedarikçi ve satın alma talebi ekranı', () => {
  test('DOM-FIN-070, DOM-FIN-071: yönetici şahıs tedarikçi ekler, talebi açar, gönderir ve onaylar', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    await seedBudget(school)
    const page = await loginAs(school.user('yonetici'))

    await page.goto(`${ADMIN}?gorunum=tedarikci`)
    const suppliers = page.getByRole('region', { name: 'Tedarikçiler' })
    await expect(suppliers.getByText('Henüz tedarikçi yok.')).toBeVisible()
    await suppliers.getByRole('button', { name: 'Yeni tedarikçi' }).click()
    const supplierForm = page.getByRole('dialog', { name: 'Yeni tedarikçi' })
    await supplierForm.getByLabel('Unvan').fill('Ali Usta Tesisat')
    await supplierForm.getByLabel('Tür').selectOption({ label: 'Şahıs' })
    await supplierForm.getByLabel('Vergi numarası').fill('10000000147')
    await supplierForm.getByLabel('Vergi dairesi').fill('Üsküdar')
    await supplierForm.getByLabel('Bakım ve onarım').check()
    await supplierForm.getByLabel('IBAN (isteğe bağlı)').fill(IBAN)
    await supplierForm.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      supplierForm.getByText('Şahısta 11 haneli geçerli bir T.C. kimlik numarası girin.'),
    ).toBeVisible()
    await supplierForm.getByLabel('Vergi numarası').fill(TCKN)
    await supplierForm.getByRole('button', { name: 'Kaydet' }).click()
    await expect(supplierForm).toBeHidden()
    const supplierPanel = page.getByRole('dialog', { name: 'Tedarikçi' })
    await expect(supplierPanel.getByText(`Üsküdar / ${TCKN}`)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(suppliers.getByRole('cell', { name: 'Üsküdar / *******0146' })).toBeVisible()

    await page.goto(`${ADMIN}?gorunum=satin-alma`)
    const requests = page.getByRole('region', { name: 'Satın alma talepleri' })
    await expect(requests.getByText('Henüz satın alma talebi yok.')).toBeVisible()
    const form = await fillRequest(page, 'Klavye')
    await form.getByLabel('Önerilen tedarikçi (isteğe bağlı)').selectOption({
      label: 'Ali Usta Tesisat',
    })
    await form.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(form).toBeHidden()

    const panel = page.getByRole('dialog', { name: 'Satın alma talebi' })
    await expect(panel.getByRole('heading', { name: 'ST-0001' })).toBeVisible()
    await expect(panel.getByText('Taslak', { exact: true })).toBeVisible()
    await expect(panel.getByText('10.000,00 ₺').first()).toBeVisible()
    await panel.getByRole('button', { name: 'Onaya gönder' }).click()
    await expect(panel.getByText('Gönderildi', { exact: true }).first()).toBeVisible()
    await panel.getByRole('button', { name: 'Onayla' }).click()
    const decision = page.getByRole('dialog', { name: 'Talebi onayla' })
    await decision.getByLabel('Onay notu (isteğe bağlı)').fill('Uygun')
    await decision.getByRole('button', { name: 'Onayla' }).click()
    await expect(decision).toBeHidden()
    await expect(panel.getByText('Onaylandı', { exact: true }).first()).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Talebi iptal et' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(
      requests.getByRole('row', { name: /ST-0001/ }).getByText('Onaylandı', { exact: true }),
    ).toBeVisible()
  })

  test('DOM-FIN-071, ON-245: bütçeyi aşan talep formda işaretlenir; gönderim ve onay uyarıdan sonra açık onayla geçer', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    await seedBudget(school)
    const page = await loginAs(school.user('yonetici'))

    await page.goto(`${ADMIN}?gorunum=satin-alma`)
    const form = await fillRequest(page, 'Sunucu', {
      quantity: '3',
      price: '4.000,00',
      total: '12.000,00 ₺',
    })
    const formBudget = form.getByRole('region', { name: 'Bütçe durumu' })
    await expect(formBudget.getByText('Bu talep bütçe kalanını 2.000,00 ₺ aşıyor.')).toBeVisible()
    await form.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(form).toBeHidden()

    const panel = page.getByRole('dialog', { name: 'Satın alma talebi' })
    await expect(panel.getByRole('heading', { name: 'ST-0001' })).toBeVisible()
    await panel.getByRole('button', { name: 'Onaya gönder' }).click()
    await expect(panel.getByRole('alert')).toContainText('2.000,00 ₺ aşıyor')
    await expect(panel.getByText('Taslak', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Aşımı onaylayarak gönder' }).click()
    await expect(panel.getByText('Gönderildi', { exact: true }).first()).toBeVisible()

    await panel.getByRole('button', { name: 'Onayla' }).click()
    const decision = page.getByRole('dialog', { name: 'Talebi onayla' })
    const decisionBudget = decision.getByRole('region', { name: 'Bütçe durumu' })
    await expect(decisionBudget.getByText('Aşım', { exact: true })).toBeVisible()
    await expect(
      decisionBudget.getByText('Bu talep bütçe kalanını 2.000,00 ₺ aşıyor.'),
    ).toBeVisible()
    await decision.getByRole('button', { name: 'Onayla' }).click()
    await expect(decision.getByRole('alert')).toContainText('açıkça onaylayın')
    await decision.getByRole('button', { name: 'Aşımı onaylayarak onayla' }).click()
    await expect(decision).toBeHidden()
    await expect(panel.getByText('Onaylandı', { exact: true }).first()).toBeVisible()
  })

  test('DOM-FIN-071: ön büro talep açar ve gönderir, onaylayamaz; tedarikçiyi salt okur; dar ekranda taşma yok', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    await seedBudget(school)
    const desk = await loginAs(school.user('onburo'))
    await desk.setViewportSize({ width: 390, height: 844 })

    await desk.goto(`${DESK}?gorunum=tedarikci`)
    const suppliers = desk.getByRole('region', { name: 'Tedarikçiler' })
    await expect(suppliers.getByText('Henüz tedarikçi yok.')).toBeVisible()
    await expect(suppliers.getByRole('button', { name: 'Yeni tedarikçi' })).toHaveCount(0)

    await desk.goto(`${DESK}?gorunum=satin-alma`)
    const form = await fillRequest(desk, 'Toner')
    await form.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(form).toBeHidden()
    const panel = desk.getByRole('dialog', { name: 'Satın alma talebi' })
    await panel.getByRole('button', { name: 'Onaya gönder' }).click()
    await expect(panel.getByText('Gönderildi', { exact: true }).first()).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Onayla' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Talebi iptal et' })).toBeVisible()
    await expectNoHorizontalOverflow(desk)
  })
})
