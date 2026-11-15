import { readFile } from 'node:fs/promises'

import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Periyodik bakım planı (ON-240; DOM-FIN-092). Kural dalları birim ve API testlerindedir
// (`tests/finance-maintenance-plans.test.ts`, `apps/api/test/finance-maintenance-plans.test.ts`);
// burada yönetici Genel Bakış kartından geciken plana gider, sekme rozetini görür, türün önerdiği
// periyotla plan açar (K-252), uygunsuz denetim kaydeder ve tek adımda arıza talebi açar (K-254),
// planları CSV indirir (K-255); ön büro yalnız okur.

const DESK = '/onburo/tahsilat-takip'
const PLANS = '/api/v1/finance/maintenance-plans'

// Sunucu saatinden bağımsız olarak gecikmiş kalan son denetim günü.
const LONG_AGO = `${String(new Date().getFullYear() - 3)}-01-15`

test.describe('DOM-FIN-092: periyodik bakım ekranı', () => {
  test('DOM-FIN-092: pano kartı ve rozet; plan açılır, uygunsuz denetimden arıza talebi, CSV', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    const admin = await api(school.user('yonetici'))
    const boiler = await admin.post(PLANS, {
      name: 'Kazan dairesi',
      type: 'boiler',
      location: 'Bodrum kat',
      lastDoneDate: LONG_AGO,
    })
    expect(boiler.status).toBe(201)

    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/dashboard')
    const card = page.getByRole('region', { name: 'Periyodik bakım' })
    await expect(card.getByText('1 denetim gecikti, yaklaşıyor ya da hiç yapılmadı')).toBeVisible()
    await expect(card.getByRole('listitem').first()).toContainText('Kazan dairesi')
    await expect(card.getByRole('listitem').first()).toContainText('Gecikti')
    await card.getByRole('link', { name: 'Tümünü gör' }).click()

    await expect(page.getByRole('button', { name: /Periyodik bakım\s*1/ })).toBeVisible()
    const section = page.getByRole('region', { name: 'Periyodik bakım' })
    await expect(section.getByRole('row', { name: /Kazan dairesi/ })).toContainText('Gecikti')

    await section.getByRole('button', { name: 'Plan ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Bakım planı ekle' })
    await expect(form.getByLabel('Periyot (ay)')).toHaveValue('12')
    await form.getByLabel('Tür').selectOption({ label: 'Yangın söndürücü' })
    await expect(form.getByLabel('Periyot (ay)')).toHaveValue('6')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByText(/Adı en az 3 karakterle/)).toBeVisible()
    await form.getByLabel('Ad').fill('Söndürücüler')
    await form.getByLabel('Yer').fill('Zemin kat koridoru')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toBeHidden()

    const panel = page.getByRole('dialog', { name: 'Bakım planı' })
    await expect(panel.getByRole('heading', { name: 'Söndürücüler' })).toBeVisible()
    await expect(panel.getByText('Denetim kaydı yok', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Periyodik bakım\s*2/ })).toBeVisible()

    const inspection = panel.getByRole('form', { name: 'Denetim kaydet' })
    await inspection.getByLabel('Denetimi yapan').fill('Beta Yangın Ltd.')
    await inspection.getByLabel('Sonuç').selectOption({ label: 'Uygunsuz' })
    await inspection.getByRole('button', { name: 'Denetimi kaydet' }).click()
    await expect(inspection.getByText('Uygunsuzluğu en az 5 karakterle açıklayın.')).toBeVisible()
    await inspection.getByLabel('Uygunsuzluk notu').fill('İki söndürücünün basıncı düşük.')
    await inspection.getByLabel('Belge no (isteğe bağlı)').fill('YS-117')
    await inspection.getByRole('button', { name: 'Denetimi kaydet' }).click()

    const records = panel.getByRole('list', { name: 'Denetim kayıtları' })
    await expect(records.getByRole('listitem')).toHaveCount(1)
    await expect(panel.getByText('Zamanında', { exact: true })).toBeVisible()
    await records.getByRole('button', { name: /için arıza talebi aç/ }).click()
    await expect(records.getByRole('link', { name: 'AT-0001' })).toBeVisible()
    await expect(records.getByRole('button', { name: /için arıza talebi aç/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Periyodik bakım\s*1/ })).toBeVisible()

    await expect
      .poll(async () => {
        const listed = await admin.get('/api/v1/finance/maintenance-requests')
        return (listed.body as { data: unknown[] }).data
      })
      .toEqual([
        expect.objectContaining({
          number: 'AT-0001',
          title: 'Denetim uygunsuzluğu: Söndürücüler',
          priority: 'urgent',
          location: 'Zemin kat koridoru',
        }),
      ])

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    const downloading = page.waitForEvent('download')
    await section.getByRole('button', { name: 'CSV indir' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toBe('bakim-plani.csv')
    const csv = await readFile(await file.path(), 'utf8')
    expect(csv.charCodeAt(0), 'UTF-8 BOM').toBe(0xfeff)
    expect(csv).toContain('"Kazan dairesi";"Kazan ve kalorifer";"Evet"')
  })

  test('DOM-FIN-092: ön büro planları okur, yazma düğmeleri yoktur; 390 px taşma yok', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const admin = await api(school.user('yonetici'))
    const created = await admin.post(PLANS, {
      name: 'A blok asansörü',
      type: 'elevator',
      location: 'A blok giriş',
      lastDoneDate: LONG_AGO,
    })
    expect(created.status).toBe(201)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=bakim-plani`)
    const section = desk.getByRole('region', { name: 'Periyodik bakım' })
    await expect(section.getByRole('row', { name: /A blok asansörü/ })).toContainText('Gecikti')
    await expect(section.getByRole('button', { name: 'Plan ekle' })).toHaveCount(0)
    await section.getByRole('button', { name: 'A blok asansörü ayrıntısını aç' }).click()
    const panel = desk.getByRole('dialog', { name: 'Bakım planı' })
    await expect(panel.getByRole('heading', { name: 'A blok asansörü' })).toBeVisible()
    await expect(panel.getByText('Henüz denetim kaydı yok.')).toBeVisible()
    await expect(panel.getByRole('form', { name: 'Denetim kaydet' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Düzelt' })).toHaveCount(0)
    await desk.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(desk)
  })
})
