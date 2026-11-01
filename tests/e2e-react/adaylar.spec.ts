import { randomUUID } from 'node:crypto'

import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

/** Aday ekranları (ön büro): liste, yeni aday, aday kartı, görüşme (DOM-KAY-001…009, -030…-033). */

const LIST_URL = '/onburo/adaylar'
const uniquePhone = () => `0555${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`
const futureDay = () => new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)

test.describe('Aday ekranları', () => {
  test('DOM-KAY-009: ön büro aday ekler; aydınlatma ve veli zorunlu; kart açılır ve listede görünür', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await page.getByRole('button', { name: 'Yeni aday ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni aday öğrenci' })
    const name = `Test Aday ${randomUUID().slice(0, 6)}`

    await form.getByRole('button', { name: 'Adayı kaydet' }).click()
    await expect(form.getByText('Aydınlatma metni gösterilmeden aday kaydedilemez.')).toBeVisible()
    await expect(form.getByText('18 yaş altı aday için veli adını girin.')).toBeVisible()

    await form.getByLabel('Ad soyad').fill(name)
    await form.getByLabel('Telefon', { exact: true }).fill(uniquePhone())
    await form.getByLabel('Kampüs').selectOption({ index: 1 })
    await form.getByLabel('İlgilendiği program').fill('7. Sınıf · Ortaokul')
    await form.getByLabel('Veli adı soyadı').fill('Test Veli')
    await form.getByLabel('Aydınlatma metni adaya gösterildi').check()
    await form.getByRole('button', { name: 'Adayı kaydet' }).click()

    await expect(page.getByText('Yeni aday kaydı oluşturuldu.')).toBeVisible()
    const card = page.getByRole('dialog', { name: 'Aday kartı' })
    await expect(card.getByRole('heading', { name })).toBeVisible()
    await expect(card).toContainText('Yeni aday')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('table', { name: 'Aday listesi' })).toContainText(name)
  })

  test('DOM-KAY-031: telefonu paylaşan farklı addaki aday için kardeş seçimi açılır', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    const phone = uniquePhone()
    const add = async (name: string) => {
      await page.getByRole('button', { name: 'Yeni aday ekle' }).click()
      const form = page.getByRole('dialog', { name: 'Yeni aday öğrenci' })
      await form.getByLabel('Ad soyad').fill(name)
      await form.getByLabel('Telefon', { exact: true }).fill(phone)
      await form.getByLabel('Kampüs').selectOption({ index: 1 })
      await form.getByLabel('İlgilendiği program').fill('7. Sınıf')
      await form.getByLabel('Veli adı soyadı').fill('Test Veli')
      await form.getByLabel('Aydınlatma metni adaya gösterildi').check()
      await form.getByRole('button', { name: 'Adayı kaydet' }).click()
      return form
    }
    await add('Test Birinci')
    await expect(page.getByRole('dialog', { name: 'Aday kartı' })).toBeVisible()
    await page.keyboard.press('Escape')

    const form = await add('Test Ikinci')
    const sibling = form.getByLabel('Kardeş aday')
    await expect(sibling).toBeVisible()
    await sibling.selectOption({ label: 'Test Birinci' })
    await form.getByRole('button', { name: 'Adayı kaydet' }).click()
    await expect(page.getByRole('dialog', { name: 'Aday kartı' })).toContainText('Test Ikinci')
  })

  test('DOM-KAY-030, -032, -033: kartta not, aşama, görüşme; vazgeçme neden ister, kapalı aday yazılmaz', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], collections: ['prospects'] })
    await loginAs(school.user('onburo'))
    await page.goto(`${LIST_URL}?asama=${encodeURIComponent('Yeni aday')}`)
    const table = page.getByRole('table', { name: 'Aday listesi' })
    await expect(table).toContainText('Yeni aday')
    await page
      .getByRole('button', { name: /kartını aç/ })
      .first()
      .click()
    const card = page.getByRole('dialog', { name: 'Aday kartı' })

    await card.getByLabel('Görüşme notu').fill('Burs koşullarını sordu.')
    await card.getByRole('button', { name: 'Notu kaydet' }).click()
    await expect(page.getByText('Görüşme notu eklendi.')).toBeVisible()
    await expect(card).toContainText('Burs koşullarını sordu.')

    await card.getByLabel('Tarih').fill(futureDay())
    await card.getByLabel('Görüşme odası').fill('Oda 1')
    await card.getByRole('button', { name: 'Görüşmeyi planla' }).click()
    await expect(page.getByText('Tanışma görüşmesi planlandı.')).toBeVisible()
    await expect(card).toContainText('Görüşme planlandı')
    await expect(card).toContainText('Oda 1')

    await card.getByLabel('Yeni aşama').selectOption('Vazgeçti')
    await card.getByRole('button', { name: 'Aşamayı güncelle' }).click()
    await expect(card.getByText('Vazgeçme nedenini seçin.')).toBeVisible()
    await card.getByLabel('Vazgeçme nedeni').selectOption({ label: 'Fiyat' })
    await card.getByRole('button', { name: 'Aşamayı güncelle' }).click()
    await expect(page.getByText('Aday aşaması güncellendi.')).toBeVisible()
    await expect(card).toContainText('Vazgeçme nedeni: Fiyat')
    await expect(card.getByRole('button', { name: 'Notu kaydet' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Görüşmeyi planla' })).toHaveCount(0)
    await expect(card.getByRole('link', { name: 'Kesin kayda dönüştür' })).toHaveCount(0)
  })

  test('DOM-KAY-033: görüşme sayfası planlı görüşmeyi listeler, kart açılır', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], collections: ['prospects'] })
    await loginAs(school.user('onburo'))
    await page.goto(`${LIST_URL}?asama=${encodeURIComponent('Yeni aday')}`)
    await page
      .getByRole('button', { name: /kartını aç/ })
      .first()
      .click()
    const card = page.getByRole('dialog', { name: 'Aday kartı' })
    const name = await card.getByRole('heading', { level: 3 }).first().innerText()
    await card.getByLabel('Tarih').fill(futureDay())
    await card.getByLabel('Görüşme odası').fill('Oda 9')
    await card.getByRole('button', { name: 'Görüşmeyi planla' }).click()
    await expect(page.getByText('Tanışma görüşmesi planlandı.')).toBeVisible()

    await page.goto('/onburo/deneme-dersi-takvimi')
    await expect(page.getByRole('main')).toContainText('Oda 9')
    await page.getByRole('button', { name: `${name} kartını aç` }).click()
    await expect(page.getByRole('dialog', { name: 'Aday kartı' })).toContainText(name)
  })

  test('320 ve 390 px genişlikte aday sayfaları yatay taşmaz', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], collections: ['prospects'] })
    await loginAs(school.user('onburo'))
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto(LIST_URL)
      await expect(page.getByRole('heading', { name: 'Aday listesi' })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await page.goto('/onburo/deneme-dersi-takvimi')
      await expect(page.getByRole('heading', { name: 'Yaklaşan görüşmeler' })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }
  })
})
