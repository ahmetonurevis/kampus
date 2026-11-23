import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { seedPackageTariff } from './support/finance-terms.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Kurumsal müşteri ekranı (IST-089; DOM-FIN-060, DOM-DIL-093). Kural dalları birim ve API
// testlerindedir (`tests/finance-corporate.test.ts`, `apps/api/test/finance-corporate.test.ts`);
// burada yöneticinin şirket ekleme, kursiyer bağlama ve toplu fatura kesme akışı var.

const ADMIN_URL = '/yonetici/finans?gorunum=kurumsal'
const COMPANY = 'Örnek Lojistik A.Ş.'
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

const customers = (page: Page) => page.getByRole('region', { name: 'Kurumsal müşteriler' })
const invoices = (page: Page) => page.getByRole('region', { name: 'Toplu faturalar' })
const panel = (page: Page) => page.getByRole('dialog', { name: 'Kurumsal müşteri' })

/** Kursiyerin taksitleri arayüzden geçmeden paket satışıyla açılır. */
async function sellPackage(client: ApiClient) {
  const made = await client.post('/api/v1/finance/packages', {
    kind: 'hours',
    name: '40 saatlik paket',
    lessonHours: 40,
    validityDays: 180,
  })
  expect(made.status, 'paket tanımı').toBe(201)
  const packageId = (made.body as { data: { id: string } }).data.id
  const body = { packageId, studentId: 's1', installmentCount: 2 }
  const quote = await client.post('/api/v1/finance/package-sales/quote', body)
  expect(quote.status, 'önizleme').toBe(200)
  const sale = await client.post(
    '/api/v1/finance/package-sales',
    {
      ...body,
      tariffId: (quote.body as { data: { tariffId: string } }).data.tariffId,
      firstDueDate: day(7),
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(sale.status, 'satış').toBe(201)
}

test.describe('IST-089: kurumsal müşteri ekranı', () => {
  test('DOM-FIN-060: yönetici şirket ekler, kursiyer bağlar ve toplu fatura keser', async ({
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({ type: 'language_school', roles: [], students: ['s1'] })
    await seedPackageTariff(school.institutionId)
    await sellPackage(await api(school.user('yonetici')))
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    await expect(customers(page).getByText('Henüz kurumsal müşteri yok.')).toBeVisible()

    await customers(page).getByRole('button', { name: 'Yeni şirket' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni şirket' })
    await form.getByLabel('Şirket unvanı').fill(COMPANY)
    await form.getByLabel('Vergi numarası').fill('1234567891')
    await form.getByLabel('Vergi dairesi').fill('Kadıköy')
    await form.getByLabel('Fatura adresi').fill('Moda Cad. No: 1 Kadıköy İstanbul')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    // Kontrol hanesi tutmayan VKN alan hatasıyla döner, kayıt yazılmaz.
    await expect(form.getByText('Vergi numarası geçersiz; hanelerini kontrol edin.')).toBeVisible()
    await form.getByLabel('Vergi numarası').fill('1234567890')
    await form.getByRole('button', { name: 'Kaydet' }).click()

    const detail = panel(page)
    await expect(detail.getByRole('heading', { name: COMPANY })).toBeVisible()
    await detail.getByRole('button', { name: 'Kursiyer bağla' }).click()
    const link = page.getByRole('dialog', { name: 'Kursiyer bağla' })
    await link.getByLabel('Kursiyer', { exact: true }).selectOption('s1')
    await link.getByLabel('Başlangıç günü').fill(day(-30))
    await link.getByRole('button', { name: 'Bağla' }).click()
    // Aydınlatma onayı olmadan bağ kurulmaz (DOM-DIL-093).
    await expect(
      link.getByText('Kursiyere işveren raporu aydınlatmasının yapıldığını onaylayın.'),
    ).toBeVisible()
    await link.getByRole('checkbox').check()
    await link.getByRole('button', { name: 'Bağla' }).click()
    await expect(link).toBeHidden()
    const employees = detail.getByRole('list', { name: 'Bağlı kursiyerler' })
    await expect(employees.getByRole('listitem')).toHaveCount(1)

    await detail.getByLabel('Dönem başlangıcı').fill(day(-30))
    await detail.getByLabel('Dönem bitişi').fill(day(300))
    const lines = detail.getByRole('list', { name: 'Faturalanacak taksitler' })
    await expect(lines.getByRole('listitem')).not.toHaveCount(0)
    await detail.getByRole('button', { name: 'Toplu fatura kes' }).click()
    await expect(page.getByText(/KF-\d{4}-0001 numaralı toplu fatura kesildi\./)).toBeVisible()
    // Aynı taksit ikinci faturaya girmez: önizleme boşalır, düğme kilitlenir.
    await expect(detail.getByText('Bu dönemde faturalanacak taksit yok.')).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Toplu fatura kes' })).toBeDisabled()
    await expect(detail.getByRole('list', { name: 'Kursiyer katılımı' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await expect(
      invoices(page)
        .getByText(/KF-\d{4}-0001/)
        .first(),
    ).toBeVisible()
    await expect(customers(page).getByText(COMPANY).first()).toBeVisible()
  })

  test('IST-089: sekme okulda görünmez, dil okulunda dar ekranda taşmaz', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    const schoolPage = await loginAs(school.user('yonetici'))
    await schoolPage.goto('/yonetici/finans')
    await expect(schoolPage.getByRole('button', { name: 'Taksitler', exact: true })).toBeVisible()
    await expect(
      schoolPage.getByRole('button', { name: 'Kurumsal müşteriler', exact: true }),
    ).toHaveCount(0)

    const language = await tenant({ type: 'language_school', roles: [] })
    const page = await loginAs(language.user('yonetici'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(ADMIN_URL)
    await expect(customers(page).getByText('Henüz kurumsal müşteri yok.')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
