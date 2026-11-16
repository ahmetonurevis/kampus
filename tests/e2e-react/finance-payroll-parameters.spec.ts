import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Bordro parametreleri (ON-197; DOM-FIN-100). Kural dalları birim ve API testlerindedir
// (`tests/finance-payroll-parameters.test.ts`, `apps/api/test/finance-payroll-parameters.test.ts`);
// burada yönetici 2026 tablosunu görür, yıl ortası kurum dönemi ekler, dilim hatasını görür ve
// dönemi arşivler; ön büro tabloyu okur, yazamaz (K-309).

const ADMIN = '/yonetici/finans?gorunum=bordro-parametreleri'
const DESK = '/onburo/tahsilat-takip?gorunum=bordro-parametreleri'

test.describe('DOM-FIN-100: bordro parametreleri', () => {
  test('DOM-FIN-100: yönetici yıl ortası dönem ekler ve arşivler; ön büro yalnız okur', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN)
    const section = page.getByRole('region', { name: 'Bordro parametreleri' })
    await section.getByLabel('Yıl').selectOption('2026')
    const january = section.getByRole('region', { name: /^1 Ocak 2026 – / })
    await expect(january.getByText('Platform varsayılanı')).toBeVisible()
    await expect(january.getByRole('row', { name: /Net asgari ücret/ })).toContainText(
      '28.075,50 ₺',
    )
    await expect(january.getByRole('row', { name: /Brüt asgari ücret/ })).toContainText(
      'Doğrulanmalı',
    )
    await expectNoHorizontalOverflow(page)

    await section.getByRole('button', { name: 'Yeni dönem' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni dönem ekle' })
    await dialog.getByLabel('Yürürlük ayı').fill('2026-07')
    await dialog.getByLabel('Brüt asgari ücret (₺)').fill('36.000,00')
    await dialog.getByLabel('2. dilim oranı (%)').fill('10')
    await dialog.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      dialog.getByText(
        'Dilim oranı bir önceki dilimin oranından büyük olmalıdır (artan oranlı tarife).',
      ),
    ).toBeVisible()
    await dialog.getByLabel('2. dilim oranı (%)').fill('20')
    await dialog.getByLabel('Kaynak').fill('Kurum mali müşaviri yazısı')
    await dialog.getByRole('button', { name: 'Kaydet' }).click()
    await expect(dialog).toBeHidden()

    const july = section.getByRole('region', { name: '1 Temmuz 2026 – 31 Aralık 2026' })
    await expect(july.getByText('Kurum değeri')).toBeVisible()
    await expect(july.getByRole('row', { name: /Net asgari ücret/ })).toContainText('30.600,00 ₺')
    await expect(
      section.getByRole('region', { name: '1 Ocak 2026 – 30 Haziran 2026' }),
    ).toBeVisible()

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK)
    const deskSection = desk.getByRole('region', { name: 'Bordro parametreleri' })
    await deskSection.getByLabel('Yıl').selectOption('2026')
    await expect(
      deskSection.getByRole('region', { name: '1 Temmuz 2026 – 31 Aralık 2026' }),
    ).toBeVisible()
    await expect(deskSection.getByRole('button', { name: 'Yeni dönem' })).toHaveCount(0)
    await expect(deskSection.getByRole('button', { name: /arşivle$/ })).toHaveCount(0)

    // `loginAs` aynı sekmede oturumu değiştirir; arşiv için yönetici yeniden girer.
    const admin = await loginAs(school.user('yonetici'))
    await admin.goto(ADMIN)
    const adminSection = admin.getByRole('region', { name: 'Bordro parametreleri' })
    await adminSection.getByLabel('Yıl').selectOption('2026')
    await adminSection
      .getByRole('button', { name: '1 Temmuz 2026 – 31 Aralık 2026 arşivle' })
      .click()
    const confirm = admin.getByRole('dialog', { name: 'Parametre setini arşivle' })
    await confirm.getByRole('button', { name: 'Arşivle' }).click()
    await expect(confirm).toBeHidden()
    await expect(
      adminSection.getByRole('region', { name: '1 Temmuz 2026 – 31 Aralık 2026' }),
    ).toHaveCount(0)
    await expect(
      adminSection.getByRole('region', { name: '1 Ocak 2026 – 31 Aralık 2026' }),
    ).toBeVisible()
  })
})
