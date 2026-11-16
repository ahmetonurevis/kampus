import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { istanbulDay } from './support/commands.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Paydaş ve sponsor kaydı (ON-262; DOM-FIN-102). Kural dalları birim ve API testlerindedir
// (`tests/finance-stakeholders.test.ts`, `apps/api/test/finance-stakeholders.test.ts`); burada
// yönetici Genel Bakış kartından yenilemesi yaklaşan anlaşmaya gider (K-319), arayüzden paydaş ve
// taslak anlaşma açıp yürürlüğe alır (K-316, K-318), anlaşmaları CSV indirir; ön büro sekmeyi
// görmez (K-317).

const STAKEHOLDERS = '/api/v1/finance/stakeholders'
const AGREEMENTS = '/api/v1/finance/stakeholder-agreements'

test.describe('DOM-FIN-102: paydaşlar ve sponsorlar ekranı', () => {
  test('DOM-FIN-102: pano kartı ve bitiş süzgeci; paydaş ve anlaşma açılır, yürürlüğe alınır, CSV', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    const admin = await api(school.user('yonetici'))
    const created = await admin.post(
      STAKEHOLDERS,
      {
        name: 'Mavi Holding',
        type: 'sponsor',
        contactName: 'Deniz Kara',
        contactPhone: '05321234512',
        contactEmail: 'deniz@mavi.com.tr',
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(created.status).toBe(201)
    const stakeholderId = (created.body as { data: { id: string } }).data.id
    const opened = await admin.post(
      `${STAKEHOLDERS}/${stakeholderId}/agreements`,
      {
        subject: 'Bahar şenliği sponsorluğu',
        startDate: istanbulDay(-30),
        endDate: istanbulDay(10),
        contributionType: 'cash',
        contributionAmountCents: 15_000_000,
        benefits: ['logo'],
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(opened.status).toBe(201)
    const draft = (opened.body as { data: { id: string; version: number } }).data
    const activated = await admin.context.post(`${AGREEMENTS}/${draft.id}/activate`, {
      headers: { 'if-match': `"${String(draft.version)}"` },
    })
    expect(activated.status()).toBe(200)

    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/dashboard')
    const card = page.getByRole('region', { name: 'Sponsor anlaşmaları' })
    await expect(card.getByText('1 anlaşmanın yenileme zamanı geldi')).toBeVisible()
    await expect(card.getByRole('listitem').first()).toContainText('Bahar şenliği sponsorluğu')
    await expect(card.getByRole('listitem').first()).toContainText('10 gün kaldı')
    await card.getByRole('link', { name: 'Tümünü gör' }).click()

    const agreements = page.getByRole('region', { name: 'İş birliği ve sponsorluk anlaşmaları' })
    const row = agreements.getByRole('row', { name: /Bahar şenliği sponsorluğu/ })
    await expect(row).toContainText('Yürürlükte')
    await expect(row).toContainText('Yenileme yaklaşıyor')
    const stakeholders = page.getByRole('region', { name: 'Paydaşlar ve sponsorlar' })
    const mavi = stakeholders.getByRole('row', { name: /Mavi Holding/ })
    await expect(mavi).toContainText('0532 *** ** 12')
    await expect(mavi).toContainText('1 yenileme yaklaşıyor')

    await stakeholders.getByRole('button', { name: 'Yeni paydaş' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni paydaş' })
    await form.getByLabel('Kurum adı').fill('Ege Üniversitesi')
    await form.getByLabel('Tür').selectOption({ label: 'Üniversite' })
    await form.getByLabel('VKN (isteğe bağlı)').fill('1111111115')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByText(/Vergi kimlik numarası geçersiz/)).toBeVisible()
    await form.getByLabel('VKN (isteğe bağlı)').fill('1111111114')
    await form.getByLabel('Etiketler (isteğe bağlı)').fill('Bilim Şenliği, staj')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toBeHidden()

    const panel = page.getByRole('dialog', { name: 'Paydaş' })
    await expect(panel.getByRole('heading', { name: 'Ege Üniversitesi' })).toBeVisible()
    await expect(panel.getByText('bilim şenliği, staj')).toBeVisible()
    await panel.getByRole('button', { name: 'Yeni anlaşma' }).click()
    const deal = page.getByRole('dialog', { name: 'Yeni anlaşma' })
    await deal.getByLabel('Konu').fill('Robotik yaz okulu iş birliği')
    await deal.getByLabel('Katkı türü').selectOption({ label: 'Hizmet' })
    await deal.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      deal.getByText('Ayni ya da hizmet katkısını en az 3 karakterle açıklayın.'),
    ).toBeVisible()
    await deal.getByLabel('Katkı açıklaması').fill('Robotik eğitmenliği')
    await deal.getByLabel('Etkinlik adı').check()
    await deal.getByRole('button', { name: 'Kaydet' }).click()
    await expect(deal).toBeHidden()

    const detail = page.getByRole('dialog', { name: 'Anlaşma' })
    await expect(
      detail.getByRole('heading', { name: 'Robotik yaz okulu iş birliği' }),
    ).toBeVisible()
    await expect(detail.getByText('Taslak', { exact: true })).toBeVisible()
    await detail.getByRole('button', { name: 'Yürürlüğe al' }).click()
    await expect(detail.getByText('Yürürlükte', { exact: true })).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Feshet' })).toBeVisible()

    await expect
      .poll(async () => {
        const listed = await admin.get(`${AGREEMENTS}?status=active`)
        return (listed.body as { meta: { total: number } }).meta.total
      })
      .toBe(2)

    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    const downloading = page.waitForEvent('download')
    await agreements.getByRole('button', { name: 'CSV indir' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toBe('paydas-anlasmalari.csv')
    const csv = await readFile(await file.path(), 'utf8')
    expect(csv.charCodeAt(0), 'UTF-8 BOM').toBe(0xfeff)
    expect(csv).toContain('"Mavi Holding";"Sponsor";"Bahar şenliği sponsorluğu"')
    expect(csv).not.toContain('Robotik')
  })

  test('DOM-FIN-102: ön büro sekmeyi görmez; yöneticide 390 px taşma yok', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const desk = await loginAs(school.user('onburo'))
    await desk.goto('/onburo/tahsilat-takip?gorunum=paydas')
    await expect(desk.getByRole('button', { name: 'Taksitler', exact: true })).toBeVisible()
    await expect(desk.getByRole('button', { name: /Paydaşlar ve sponsorlar/ })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Paydaşlar ve sponsorlar' })).toHaveCount(0)

    const admin = await loginAs(school.user('yonetici'))
    await admin.setViewportSize({ width: 390, height: 844 })
    await admin.goto('/yonetici/finans?gorunum=paydas')
    await expect(admin.getByRole('region', { name: 'Paydaşlar ve sponsorlar' })).toBeVisible()
    await expectNoHorizontalOverflow(admin)
  })
})
