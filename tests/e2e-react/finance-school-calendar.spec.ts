import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Okul etkinlik takvimi (ON-090; DOM-FIN-163; IST-099). Kural dalları birim ve API testlerindedir
// (`tests/finance-school-calendar.test.ts`, `apps/api/test/finance-school-calendar.test.ts`); burada
// yönetici bugüne bir sınıf veli toplantısı ekler (taslak), ay ızgarasında açar, yayımlar, liste
// görünümünde görür ve gerekçeyle iptal eder (K-544).

const ADMIN = '/yonetici/finans'

test.describe('DOM-FIN-163: okul takvimi', () => {
  test('DOM-FIN-163: yönetici etkinlik ekler, yayımlar, listede görür ve iptal eder (K-544)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s1'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=okul-takvimi`)
    const calendar = page.getByRole('region', { name: 'Okul takvimi', exact: true })
    await expect(calendar.getByRole('table', { name: /^Okul takvimi: / })).toBeVisible()
    await calendar.getByRole('button', { name: 'Etkinlik ekle', exact: true }).click()

    const form = page.getByRole('dialog', { name: 'Etkinlik ekle' })
    await form.getByLabel('Başlık').fill('7-A veli toplantısı')
    await form.getByLabel('Tür').selectOption({ label: 'Veli toplantısı' })
    await form.getByLabel('Başlangıç saati').fill('18:00')
    await form.getByLabel('Bitiş saati').fill('17:00')
    await form.getByLabel('Yer').fill('Konferans salonu')
    await form.getByRole('button', { name: 'Taslak olarak kaydet' }).click()
    await expect(form.getByText('Bitiş saati başlangıç saatinden sonra olmalı.')).toBeVisible()
    await form.getByLabel('Bitiş saati').fill('19:30')
    await form.getByLabel('Hedef kitle').selectOption({ label: 'Sınıf' })
    await form.getByRole('checkbox', { name: '7-A' }).click()
    await form.getByRole('button', { name: 'Taslak olarak kaydet' }).click()
    await expect(form).toBeHidden()

    const details = page.getByRole('dialog', { name: '7-A veli toplantısı' })
    await expect(details.getByText('Taslak', { exact: true })).toBeVisible()
    await expect(details).toContainText('Sınıf: 7-A')
    await details.getByRole('button', { name: 'Yayımla' }).click()
    await expect(details.getByText('Yayımlandı', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(details).toBeHidden()

    await expect(
      calendar.getByRole('button', { name: '7-A veli toplantısı, Veli toplantısı, Yayımlandı' }),
    ).toBeVisible()

    await calendar.getByRole('button', { name: 'Liste', exact: true }).click()
    const table = calendar.getByRole('table', { name: 'Okul takvimi etkinlikleri' })
    const row = table.getByRole('row', { name: /7-A veli toplantısı/ })
    await expect(row).toContainText('18:00–19:30')
    await expect(row).toContainText('Yayımlandı')
    await row.getByRole('button', { name: '7-A veli toplantısı etkinliğini aç' }).click()
    await details.getByRole('button', { name: 'İptal et' }).click()
    const cancel = page.getByRole('dialog', { name: 'Etkinliği iptal et' })
    await cancel.getByLabel('İptal gerekçesi').fill('Salon tadilatı nedeniyle ertelendi.')
    await cancel.getByRole('button', { name: 'Etkinliği iptal et' }).click()
    await expect(cancel).toBeHidden()
    await expect(details.getByText('İptal edildi', { exact: true })).toBeVisible()
    await expect(details).toContainText('Salon tadilatı nedeniyle ertelendi.')
    await page.keyboard.press('Escape')
    await expect(row).toContainText('İptal edildi')

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
