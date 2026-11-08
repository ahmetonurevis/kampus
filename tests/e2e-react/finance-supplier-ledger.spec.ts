import { readFile } from 'node:fs/promises'

import { createApiClient, switchInstitutionApi, type ApiResult } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Tedarikçi carisi ve ödeme planı ekranı (ON-143; DOM-FIN-076). Kural dalları birim ve API
// testlerindedir (`tests/finance-supplier-ledger.test.ts`, `apps/api/test/finance-supplier-ledger.test.ts`);
// burada yönetici iki taksitli fatura girer, ilk taksiti öder, talimat dosyasını indirir ve cariyi
// görür; ön büro sekmeyi görmez.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'
const SUPPLIER_IBAN = 'TR330006100519786457841326'

const ok = (result: ApiResult, status = 201) => {
  expect(result.status, JSON.stringify(result.body)).toBe(status)
  return (result.body as { data: Record<string, unknown> & { id: string } }).data
}

/** IBAN'lı tedarikçi ve kurum banka hesabı API'den kurulur. */
async function seedSupplier(school: Tenant) {
  const api = await createApiClient({ email: school.user('yonetici').email }, { fresh: true })
  try {
    expect((await switchInstitutionApi(api, school.institutionId)).ok).toBe(true)
    ok(
      await api.post('/api/v1/finance/suppliers', {
        name: 'Alfa Bilişim A.Ş.',
        type: 'company',
        taxNumber: '1234567890',
        taxOffice: 'Kadıköy',
        categories: ['it'],
        iban: SUPPLIER_IBAN,
      }),
    )
    ok(
      await api.post(
        '/api/v1/bank-accounts',
        {
          bankName: 'Örnek Bankası',
          iban: 'TR320010009999901234567890',
          accountHolder: 'Akademi Özel Okulları',
        },
        { 'idempotency-key': crypto.randomUUID() },
      ),
    )
  } finally {
    await api.dispose()
  }
}

test.describe('DOM-FIN-076: tedarikçi carisi ekranı', () => {
  test('DOM-FIN-076: yönetici iki taksitli fatura girer, taksit öder, talimat dosyası indirir ve cariyi görür', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    await seedSupplier(school)
    const page = await loginAs(school.user('yonetici'))

    await page.goto(`${ADMIN}?gorunum=tedarikci-cari&cari=fatura`)
    const section = page.getByRole('region', { name: 'Tedarikçi carisi' })
    await expect(section.getByText('Henüz tedarikçi faturası yok.')).toBeVisible()
    await section.getByRole('button', { name: 'Fatura ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Tedarikçi faturası ekle' })
    await form.getByLabel('Tedarikçi', { exact: true }).selectOption({ label: 'Alfa Bilişim A.Ş.' })
    await form.getByLabel('Fatura numarası').fill('abc 2026 1')
    await form.getByLabel('Fatura tutarı (₺)').fill('1.200')
    await form.getByLabel('KDV tutarı (₺)').fill('200')
    await form.getByLabel('Vade', { exact: true }).selectOption({ label: 'Taksitli ödeme planı' })
    await form.getByLabel('Taksit sayısı').fill('2')
    await form.getByRole('button', { name: 'Eşit aylık taksitlere böl' }).click()
    await expect(form.getByText(/Taksit toplamı 1\.200,00 ₺ \/ fatura 1\.200,00 ₺/)).toBeVisible()
    await form.getByRole('button', { name: 'Faturayı kaydet' }).click()
    await expect(form).toBeHidden()

    const detail = page.getByRole('dialog', { name: 'Tedarikçi faturası' })
    await expect(detail.getByRole('heading', { name: 'Fatura ABC20261' })).toBeVisible()
    const installments = detail.getByRole('list', { name: 'Taksitler' })
    await expect(installments.getByRole('listitem')).toHaveCount(2)
    await installments.getByRole('button', { name: '1. taksite ödeme gir' }).click()
    const payment = page.getByRole('dialog', { name: 'Ödeme gir' })
    await expect(payment.getByLabel('Tutar (₺)')).toHaveValue('600,00')
    await payment.getByLabel('Yöntem').selectOption({ label: 'EFT' })
    await expect(payment.getByLabel('Kurum banka hesabı')).toHaveValue(/.+/)
    await payment.getByRole('button', { name: 'Ödemeyi kaydet' }).click()
    await expect(payment).toBeHidden()
    await expect(detail.getByText('Kısmen ödendi', { exact: true })).toBeVisible()
    await expect(
      detail.getByRole('list', { name: 'Ödemeler' }).getByText(/600,00 ₺ · EFT/),
    ).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Ödeme planını değiştir' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await section.getByRole('button', { name: 'Ödemeler ve talimat' }).click()
    await section
      .getByRole('checkbox', { name: /Alfa Bilişim A\.Ş\. 600,00 ₺ ödemesini talimata ekle/ })
      .check()
    const downloading = page.waitForEvent('download')
    await section.getByRole('button', { name: 'Talimat dosyası indir (1)' }).click()
    const file = await downloading
    const csv = await readFile(await file.path(), 'utf8')
    expect(csv).toContain(`"Alfa Bilişim A.Ş.";"${SUPPLIER_IBAN}";600,00;"TRY"`)
    expect(csv).toContain('Fatura ABC20261 ödemesi')
    await expect(section.getByText('Talimatı alındı', { exact: true })).toBeVisible()

    await section.getByRole('button', { name: 'Cari özet' }).click()
    const row = section.getByRole('row', { name: /Alfa Bilişim A\.Ş\./ })
    await expect(row.getByText('600,00 ₺').first()).toBeVisible()
    await row.getByRole('button', { name: 'Alfa Bilişim A.Ş. ekstresini aç' }).click()
    const statement = page.getByRole('dialog', { name: 'Tedarikçi ekstresi' })
    await expect(statement.getByText('TR********************1326')).toBeVisible()
    await expect(
      statement.getByRole('list', { name: 'Ekstre hareketleri' }).getByRole('listitem'),
    ).toHaveCount(2)
  })

  test('DOM-FIN-076: ön büro tedarikçi carisi sekmesini görmez; dar ekranda taşma yok (K-160)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const admin = await loginAs(school.user('yonetici'))
    await admin.setViewportSize({ width: 390, height: 844 })
    await admin.goto(`${ADMIN}?gorunum=tedarikci-cari`)
    await expect(
      admin
        .getByRole('region', { name: 'Tedarikçi carisi' })
        .getByText(/Henüz tedarikçi faturası yok/),
    ).toBeVisible()
    await expectNoHorizontalOverflow(admin)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=tedarikci-cari`)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Tedarikçi carisi' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Tedarikçi carisi' })).toHaveCount(0)
  })
})
