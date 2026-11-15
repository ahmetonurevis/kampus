import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// e-Okul öğrenci listesi aktarımı (ON-062, IST-134; DOM-KAY-042): Kayıt İşlemleri içindeki bölüm.
// Dosya seçilir, sütunlar önerilir, satırlar sınıflanır (hiçbir şey yazılmaz); seçilen satırlar
// onayla yazılır. Kural dalları birim ve API testlerindedir; burada akışın ekranda çalıştığı
// doğrulanır.

const URL = '/onburo/kayit-islemleri'
const HEADER =
  'S.No;Okul No;T.C. Kimlik No;Adı;Soyadı;Cinsiyeti;Sınıfı/Şubesi;Doğum Tarihi;Veli Adı Soyadı;Veli Cep Telefonu'

const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

async function students(client: ApiClient) {
  const result = await client.get('/api/v1/collections/students?pageSize=100')
  expect(result.status).toBe(200)
  return (result.body as { data: { record: { name: string; number?: string } }[] }).data.map(
    (item) => item.record,
  )
}

test.describe('e-Okul aktarımı', () => {
  test('DOM-KAY-042: ön büro listeyi önizler, hatalı satırı indirir, seçilen satırları aktarır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    await loginAs(school.user('onburo'))
    const client = await api(school.user('onburo'))
    const before = (await students(client)).length
    await page.goto(URL)
    await page.getByRole('button', { name: 'e-Okul listesini aktar' }).click()
    const dialog = page.getByRole('dialog', { name: 'e-Okul listesini aktar' })

    await dialog.getByLabel('e-Okul öğrenci listesi').setInputFiles({
      name: 'eokul.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'ÖRNEK ORTAOKULU;;;;;;;;;',
          HEADER,
          '1;2026001;10000000146;DENİZ;YILMAZ;Erkek;7. Sınıf / A Şubesi;14.03.2013;;',
          '2;2026901;10000000078;ECE;AKTARIM;Kız;7. Sınıf / A Şubesi;02.09.2013;AYLA AKTARIM;05551112401',
          '3;2026902;10000000214;CAN;AKTARIM;Erkek;11. Sınıf / Z Şubesi;02.09.2010;AYLA AKTARIM;05551112401',
        ].join('\n'),
      ),
    })
    await dialog.getByRole('button', { name: 'Önizle' }).click()

    await expect(dialog.getByRole('group', { name: 'Sütun eşleme' })).toBeVisible()
    await expect(dialog.getByLabel('T.C. kimlik no')).toHaveValue('2')
    const table = dialog.getByRole('table', { name: 'e-Okul aktarım önizlemesi' })
    await expect(table.getByText('Kimlik eklenecek')).toBeVisible()
    await expect(table.getByText('Ece Aktarım')).toBeVisible()
    await expect(table.getByText(/Bu sınıf ve şube kurumda yok/)).toBeVisible()
    await expect(table.getByText('10000000078')).toHaveCount(0)
    await expect(dialog.getByRole('status').filter({ hasText: 'öğrenci satırı' })).toContainText(
      '1 yeni · 1 güncellenecek · 1 hatalı · 2 satır seçili',
    )
    expect((await students(client)).length).toBe(before)

    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Hatalı satırları indir (CSV)' }).click()
    expect((await download).suggestedFilename()).toBe('e-okul-hatali-satirlar.csv')

    await dialog.getByRole('button', { name: '2 satırı aktar' }).click()
    await expect(toast(page, '1 yeni öğrenci açıldı, 1 öğrenci güncellendi.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect
      .poll(async () =>
        (await students(client))
          .filter((item) => item.name === 'Ece Aktarım')
          .map((item) => item.number),
      )
      .toEqual(['2026901'])
    await expectNoHorizontalOverflow(page)
  })
})
