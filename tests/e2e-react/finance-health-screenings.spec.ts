import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Okul sağlığı taramaları (ON-163; DOM-FIN-153). Kural dalları birim ve API testlerindedir
// (`tests/finance-health-screenings.test.ts`, `apps/api/test/finance-health-screenings.test.ts`);
// burada ön büro dar ekranda boy-kilo taraması açar, sınıf tablosundan sonucu girer (BKİ sunucuda,
// eşik işareti kendiliğinden; K-514), raporda küçük grubun gizlendiğini görür (K-516) ve yayımlar;
// veli çocuğunun sonucunu ve "gönderilecek" bildirimini okur (K-515).

const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-153: sağlık taramaları', () => {
  test('DOM-FIN-153: tarama açılır, sonuç tablodan girilir, yayımlanınca veli görür (K-514, K-515, K-516)', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo', 'veli'], students: ['s1'], childIds: ['s1'] })
    const desk = await api(school.user('onburo'))
    const classes = await desk.context.get('/api/v1/finance/health-screening-classes?pageSize=100')
    expect(classes.status()).toBe(200)
    const target = (
      (await classes.json()) as { data: { name: string; studentCount: number }[] }
    ).data.find((row) => row.studentCount > 0)
    expect(target).toBeDefined()

    const page = await loginAs(school.user('onburo'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${DESK}?gorunum=saglik-taramalari`)
    const section = page.getByRole('region', { name: 'Sağlık taramaları' })
    await expect(section.getByText('Henüz sağlık taraması yok.')).toBeVisible()

    await section.getByRole('button', { name: 'Yeni tarama' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni sağlık taraması' })
    const form = dialog.getByRole('form', { name: 'Yeni sağlık taraması' })
    await form.getByLabel(`${target?.name ?? ''} (${String(target?.studentCount ?? 0)})`).check()
    await form.getByLabel('Ad ve kurumu').fill('ASM hemşiresi')
    await form.getByLabel('BKİ alt eşiği (isteğe bağlı)').fill('14')
    await form.getByRole('button', { name: 'Taramayı aç' }).click()
    await expect(dialog).toBeHidden()

    const results = section.getByRole('table', { name: 'Tarama sonuçları' })
    await results.getByLabel(/ durum$/).selectOption({ label: 'Tarandı' })
    await results.getByLabel(/ boy$/).fill('150')
    await results.getByLabel(/ kilo$/).fill('30')
    await expect(results.getByLabel(/ ileri değerlendirme önerilir$/)).toBeChecked()
    await section.getByRole('button', { name: 'Değişiklikleri kaydet (1)' }).click()
    await expect(results).toContainText('150 cm · 30 kg · BKİ 13,3')
    await expect(section.getByRole('button', { name: 'Değişiklik yok' })).toBeDisabled()
    await expect(section.getByRole('table', { name: 'Sınıf raporu' })).toContainText(
      'Gizli (küçük grup)',
    )
    await expectNoHorizontalOverflow(page)

    await section.getByRole('button', { name: 'Veliye yayımla' }).click()
    const confirm = page.getByRole('dialog', { name: 'Tarama yayımlansın mı?' })
    await confirm.getByRole('button', { name: 'Yayımla', exact: true }).click()
    await expect(confirm).toBeHidden()
    await expect(section.getByText('Tarama yayımlandı; sonuçlar değişmez.')).toBeVisible()
    await expect(results.getByLabel(/ boy$/)).toBeDisabled()

    const guardian = await api(school.user('veli'))
    const mine = await guardian.context.get('/api/v1/finance/health-screening-results')
    expect(mine.status()).toBe(200)
    const body = (await mine.json()) as {
      data: {
        measurement: { bmi?: number } | null
        referralRecommended: boolean
        notificationStatus: string | null
      }[]
    }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.measurement?.bmi).toBe(13.3)
    expect(body.data[0]?.referralRecommended).toBe(true)
    expect(body.data[0]?.notificationStatus).toBe('pending')
  })
})
