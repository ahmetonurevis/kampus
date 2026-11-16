import { readFile } from 'node:fs/promises'

import { istanbulDay, seedPaidRefund } from './support/finance-refund-invoices.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// İade belgeleri ekranı (ON-266; DOM-FIN-096, K-292…K-295). Kural dalları (pencere, tutar
// sınırları, tekillik, kurumlar arası 404) birim ve API testlerindedir
// (`tests/finance-refund-invoices.test.ts`, `apps/api/test/finance-refund-invoices.test.ts`); burada
// yöneticinin ayrılış satırından kısmi iade faturası hazırlayıp gönderildi işlemesi ve ön büronun
// sekmeyi görmemesi var.

const STUDENT = 'Deniz Yılmaz'

test.describe('ON-266: iade belgeleri ekranı', () => {
  test('DOM-FIN-096: yönetici ödenmiş iadeden kısmi iade faturası hazırlar, CSV alır ve gönderildi işler', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s1'] })
    await seedPaidRefund({
      institutionId: school.institutionId,
      studentId: 's1',
      refundCents: 550_000,
    })
    const year = istanbulDay().slice(0, 4)
    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/finans?gorunum=ayrilis')

    await page
      .getByRole('button', { name: `${STUDENT} iadesi için iade faturası ya da iptal isteği` })
      .click()
    const section = page.getByRole('region', { name: 'İade belgeleri' })
    await expect(section.getByText(`Seçili iade: ${STUDENT}`)).toBeVisible()
    await section.getByRole('button', { name: 'Belge hazırla' }).click()

    const form = page.getByRole('dialog', { name: 'İade belgesi hazırla' })
    await form.getByLabel('Asıl fatura no').fill(`kmp${year}000000012`)
    await form.getByLabel('Asıl fatura tutarı (KDV dahil, ₺)').fill('11.000,00')
    await expect(form.getByText(/Öneri: İade faturası/)).toBeVisible()
    await form.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(form).toBeHidden()

    await expect(section.getByRole('cell', { name: STUDENT, exact: true })).toBeVisible()
    await expect(section.getByText('Taslak', { exact: true })).toBeVisible()
    await expect(section.getByRole('cell', { name: '5.500,00 ₺', exact: true })).toBeVisible()
    await section
      .getByRole('button', { name: `${STUDENT} belgesini gönderime hazır işaretle` })
      .click()
    await expect(section.getByText('Gönderime hazır', { exact: true })).toBeVisible()

    const downloading = page.waitForEvent('download')
    await section.getByRole('button', { name: 'CSV indir' }).click()
    const download = await downloading
    const csv = await readFile(await download.path(), 'utf8')
    expect(csv).toContain(`"KMP${year}000000012"`)
    expect(csv).toContain('"İade faturası";"Gönderime hazır"')

    await section.getByRole('button', { name: `${STUDENT} belgesinin sonucunu işle` }).click()
    const result = page.getByRole('dialog', { name: 'Sonucu işle' })
    await result.getByLabel('İade faturası no').fill(`KMP${year}000000040`)
    await result.getByRole('button', { name: 'Gönderildi olarak kaydet' }).click()
    await expect(result).toBeHidden()
    await expect(section.getByText('Gönderildi', { exact: true })).toBeVisible()
    await expect(section.getByText(`KMP${year}000000040`)).toBeVisible()
    await expect(section.getByRole('button', { name: 'Belge hazırla' })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  })

  test('K-295: ön büro iade belgeleri sekmesini görmez', async ({ loginAs, tenant }) => {
    const school = await tenant({ roles: ['onburo'] })
    const page = await loginAs(school.user('onburo'))
    await page.goto('/onburo/tahsilat-takip?gorunum=iade-belgesi')
    await expect(page.getByRole('button', { name: 'Ayrılış ve iade' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'İade belgeleri' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'İade belgeleri' })).toHaveCount(0)
  })
})
