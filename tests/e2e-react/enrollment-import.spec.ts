import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Pilot verisi aktarımı (ON-060, ON-061, IST-007): Kayıt İşlemleri ve Finans içindeki bölüm. Dosya
// seçilir, sunucuda önizlenir (hiçbir şey yazılmaz), onayla yazılır; ikinci yükleme atlanır. Kural
// dalları birim ve API testlerindedir; burada akışın ekranda çalıştığı doğrulanır.

const ENROLLMENT_URL = '/yonetici/kayit-islemleri'
const FINANCE_URL = '/yonetici/finans'
const STUDENT_HEADER = 'öğrenci adı;sınıf;kimlik no;doğum tarihi;veli adı;veli telefonu;yakınlık'

const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const csv = (name: string, lines: readonly string[]) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(lines.join('\n')),
})

async function records<T>(client: ApiClient, collection: string) {
  const result = await client.get(`/api/v1/collections/${collection}?pageSize=100`)
  expect(result.status).toBe(200)
  return (result.body as { data: { record: T }[] }).data.map((item) => item.record)
}

test.describe('Pilot aktarımı', () => {
  test('ON-060, DOM-KAY-013: önizleme hatayı gösterir ve yazmaz; onay kardeşleri tek veliye bağlar, ikinci yükleme atlanır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    const before = (await records(client, 'students')).length
    await page.goto(ENROLLMENT_URL)
    await page.getByRole('button', { name: 'Öğrenci ve veli aktar' }).click()
    const dialog = page.getByRole('dialog', { name: 'Öğrenci ve veli aktar' })

    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Örnek şablonu indir' }).click()
    expect((await download).suggestedFilename()).toBe('ogrenci-veli-aktarim-ornegi.csv')

    const file = dialog.getByLabel('Aktarım dosyası')
    await file.setInputFiles(
      csv('hatali.csv', [
        STUDENT_HEADER,
        'Ece Aktarım;c1;11111111111;2013-03-14;Ayla Aktarım;05551112201;Anne',
      ]),
    )
    await dialog.getByRole('button', { name: 'Önizle' }).click()
    const table = dialog.getByRole('table', { name: 'Aktarım önizlemesi' })
    await expect(table.getByText('Geçerli bir T.C. kimlik numarası girin.')).toBeVisible()
    await expect(dialog.getByRole('alert')).toContainText('Hiçbir kayıt aktarılmadı')
    await expect(dialog.getByRole('button', { name: /öğrenci aktar$/ })).toBeDisabled()

    const good = csv('ogrenciler.csv', [
      STUDENT_HEADER,
      'Ece Aktarım;c1;10000000146;14.03.2013;Ayla Aktarım;05551112201;Anne',
      'Can Aktarım;c1;10000000078;02.09.2015;Ayla Aktarım;05551112201;Anne',
    ])
    await file.setInputFiles(good)
    await dialog.getByRole('button', { name: 'Önizle' }).click()
    await expect(table.getByText('*******0146')).toBeVisible()
    await expect(table.getByText('10000000146')).toHaveCount(0)
    await expect(table.getByText(/satırıyla aynı/)).toBeVisible()
    await expect(dialog.getByRole('status').filter({ hasText: ' satır · ' })).toContainText(
      '1 yeni veli',
    )
    expect((await records(client, 'students')).length).toBe(before)

    await dialog.getByRole('button', { name: '2 öğrenci aktar' }).click()
    await expect(toast(page, '2 öğrenci aktarıldı.')).toBeVisible()
    await expect(dialog).toBeHidden()
    const students = await records<{ name: string; parentId: string }>(client, 'students')
    const imported = students.filter((item) => item.name.endsWith('Aktarım'))
    expect(imported.length).toBe(2)
    expect(new Set(imported.map((item) => item.parentId)).size).toBe(1)

    await page.getByRole('button', { name: 'Öğrenci ve veli aktar' }).click()
    await dialog.getByLabel('Aktarım dosyası').setInputFiles(good)
    await dialog.getByRole('button', { name: 'Önizle' }).click()
    await expect(dialog.getByRole('status').filter({ hasText: ' satır · ' })).toContainText(
      '2 zaten kayıtlı, atlanacak',
    )
    await expect(dialog.getByRole('button', { name: '0 öğrenci aktar' })).toBeDisabled()
    await expectNoHorizontalOverflow(page)
  })

  test('IST-007: ön büro aktarım bölümünü görmez', async ({ page, loginAs, tenant }) => {
    const school = await tenant({ roles: ['onburo'] })
    await loginAs(school.user('onburo'))
    await page.goto('/onburo/kayit-islemleri')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Öğrenci ve veli aktar' })).toHaveCount(0)
  })

  test('ON-061, DOM-FIN-011, DOM-FIN-014: önizleme ₺ gösterir, onay taksiti yazar, ikinci yükleme atlanır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    const students = await client.post(
      '/api/v1/prospects/student-imports',
      {
        dryRun: false,
        fileBase64: Buffer.from(
          [
            STUDENT_HEADER,
            'Ece Taksit;c1;10000000146;14.03.2013;Ayla Taksit;05551112301;Anne',
          ].join('\n'),
        ).toString('base64'),
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(students.status).toBe(201)

    const file = csv('taksitler.csv', [
      'kimlik no;taksit no;tutar;vade;ödeme tarihi;ödeme yöntemi',
      '10000000146;71;12.500,00;15.09.2025;14.09.2025;Nakit',
      '10000000146;72;12500.00;15.10.2025;;',
    ])
    await page.goto(FINANCE_URL)
    await page.getByRole('button', { name: 'Taksit aktar' }).click()
    const dialog = page.getByRole('dialog', { name: 'Taksit aktar' })
    await dialog.getByLabel('Aktarım dosyası').setInputFiles(file)
    await dialog.getByRole('button', { name: 'Önizle' }).click()
    await expect(dialog.getByRole('status').filter({ hasText: ' satır · ' })).toContainText(
      '2 taksit yazılacak',
    )
    await expect(dialog.getByRole('status').filter({ hasText: ' satır · ' })).toContainText(
      '25.000,00',
    )
    const preview = dialog.getByRole('table', { name: 'Aktarım önizlemesi' })
    await expect(preview).toContainText('Ece Taksit')
    await expect(preview).toContainText('12.500,00 ₺')
    await expect(preview).toContainText('Açılış aktarımı')

    await dialog.getByRole('button', { name: '2 taksit aktar' }).click()
    await expect(toast(page, '2 taksit aktarıldı.')).toBeVisible()
    const invoices = await records<{ installment: number; paidAt: string | null }>(
      client,
      'invoices',
    )
    const imported = invoices.filter((item) => item.installment >= 71)
    expect(imported.length).toBe(2)
    expect(imported.filter((item) => item.paidAt !== null).length).toBe(1)
    const payments = await client.get('/api/v1/payments')
    expect((payments.body as { data: unknown[] }).data).toEqual([])
    await expect(page.getByRole('cell', { name: 'Açılış aktarımı', exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Ece Taksit 71. taksit dekontunu görüntüle' }),
    ).toHaveCount(0)

    await page.getByRole('button', { name: 'Taksit aktar' }).click()
    await dialog.getByLabel('Aktarım dosyası').setInputFiles(file)
    await dialog.getByRole('button', { name: 'Önizle' }).click()
    await expect(dialog.getByRole('status').filter({ hasText: ' satır · ' })).toContainText(
      '2 zaten kayıtlı, atlanacak',
    )
    await expect(dialog.getByRole('button', { name: '0 taksit aktar' })).toBeDisabled()
  })
})
