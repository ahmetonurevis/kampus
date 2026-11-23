import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'

// Ayarlar → Kullanıcı & Yetkiler → "Toplu aktar" (IST-007, DOM-YTK-070): yönetici CSV dosyasını
// önizler, hatalı satırı görür, içeriği düzeltip personeli aktarır. Kendi kurumunu kurar
// (`tenant`); yönetici yeni oturumla girer (aktarım taze oturum ister).

const USERS_URL = '/yonetici/ayarlar?sekme=kullanicilar'
const usersTable = (page: Page) => page.getByRole('table', { name: 'Kurum kullanıcıları' })

test.describe('toplu personel aktarımı (IST-007)', () => {
  test('IST-007: yönetici hatalı satırı önizlemede görür, düzeltip 3 personeli aktarır ve listede görür', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'] })
    const page = await loginAs(school.user('yonetici'), { fresh: true })
    const tag = randomUUID().slice(0, 8)
    const emails = [
      `ayla-${tag}@kampus.example`,
      `kerem-${tag}@kampus.example`,
      `nil-${tag}@kampus.example`,
    ]
    const lines = (third: string) =>
      [
        'ad;e-posta;rol',
        `Ayla Demir;${emails[0]};Öğretmen`,
        `Kerem Uçar;${emails[1]};Ön büro`,
        third,
      ].join('\n')

    await page.goto(USERS_URL)
    await expect(page.getByText('1 kullanıcı')).toBeVisible()
    await page.getByRole('button', { name: 'Toplu aktar' }).click()
    const dialog = page.getByRole('dialog', { name: 'Personeli toplu aktar' })
    await expect(dialog.getByRole('button', { name: "Örnek CSV'yi indir" })).toBeVisible()

    // Hatalı dosya: üçüncü satırda e-posta geçersiz, rol personel rolü değil.
    await dialog.getByLabel('CSV dosyası').setInputFiles({
      name: 'personel.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(lines('Nil Su;nil-bozuk;veli')),
    })
    await expect(dialog.getByLabel('Dosya içeriği')).toHaveValue(/Nil Su;nil-bozuk;veli/)
    await dialog.getByRole('button', { name: 'Önizle' }).click()
    const preview = dialog.getByRole('table', { name: 'Aktarım önizlemesi' })
    await expect(dialog.getByRole('status').filter({ hasText: '1 satırda 2 hata' })).toBeVisible()
    await expect(preview.getByText('E-posta: Geçerli bir e-posta adresi girin.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '3 personeli aktar' })).toBeDisabled()

    // Düzeltme: içerik değişince önizleme kalkar; yeniden önizlenip onaylanır.
    await dialog.getByLabel('Dosya içeriği').fill(lines(`Nil Su;${emails[2]};Yönetici`))
    await expect(preview).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Önizle' }).click()
    await expect(
      dialog.getByRole('status').filter({ hasText: '3 personel davet edilecek' }),
    ).toBeVisible()
    await dialog.getByRole('button', { name: '3 personeli aktar' }).click()
    await expect(page.getByText('3 personel davet edildi.')).toBeVisible()
    await expect(dialog).toHaveCount(0)

    await expect(page.getByText('4 kullanıcı')).toBeVisible()
    for (const email of emails) await expect(usersTable(page).getByText(email)).toBeVisible()
    await expect(
      page
        .getByRole('region', { name: 'Bekleyen davetler' })
        .getByText(emails[2] ?? '', { exact: false }),
    ).toBeVisible()
  })
})
