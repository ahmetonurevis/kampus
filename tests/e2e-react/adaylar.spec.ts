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

  test('DOM-FIN-002: yayımlanmış tarife yokken kayıt formu açılmaz', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], collections: ['prospects'] })
    await loginAs(school.user('onburo'))
    await page.goto('/onburo/kayit-islemleri')
    await expect(
      page.getByRole('heading', { name: 'Yayımlanmış ücret tarifesi yok' }),
    ).toBeVisible()
    await expect(page.getByLabel('Aday öğrenci')).toHaveCount(0)
  })

  test('DOM-KAY-035, DOM-FIN-011: yönetici tarifeyi yayımlar, ön büro adayı adım adım kaydeder', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], collections: ['prospects'] })
    await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/finans?gorunum=tarife')
    await page.getByRole('button', { name: 'Yeni tarife' }).click()
    const editor = page.getByRole('dialog', { name: 'Yeni tarife' })
    await editor.getByLabel('Tutar (₺)', { exact: true }).fill('100.000,01')
    await editor.getByLabel('MEBBİS onaylı tutar (₺)').fill('100.000,01')
    await editor.getByRole('button', { name: 'İndirim ekle' }).click()
    await editor.getByLabel('Değer').fill('10')
    await editor.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(page.getByText('Tarife kaydedildi.')).toBeVisible()
    await page.getByRole('button', { name: /tarifesini yayımla/ }).click()
    const publish = page.getByRole('dialog', { name: 'Tarifeyi yayımla' })
    await publish.getByRole('button', { name: 'Tarifeyi yayımla' }).click()
    await expect(page.getByText('Tarife yayımlandı.')).toBeVisible()

    await loginAs(school.user('onburo'))
    const client = await api(school.user('onburo'))
    await page.goto(`${LIST_URL}?asama=${encodeURIComponent('Yeni aday')}`)
    await page
      .getByRole('button', { name: /kartını aç/ })
      .first()
      .click()
    const card = page.getByRole('dialog', { name: 'Aday kartı' })
    const name = await card.getByRole('heading', { level: 3 }).first().innerText()
    await card.getByRole('link', { name: 'Kesin kayda dönüştür' }).click()

    await expect(page).toHaveURL(/kayit-islemleri\?aday=/)
    const proceed = page.getByRole('button', { name: 'Devam et' })
    await proceed.click()
    await expect(page.getByLabel('Sınıf')).toHaveAttribute('aria-invalid', 'true')
    // Yalnız adayın kampüsünün sınıfları, doluluğuyla listelenir.
    await expect(page.getByLabel('Sınıf').getByRole('option').nth(1)).toHaveText(/\(\d+\/\d+\)/)
    await page.getByLabel('Sınıf').selectOption({ index: 1 })
    await proceed.click()

    await page.getByLabel('Kimlik numarası').fill('10000000147')
    await proceed.click()
    await expect(page.getByText('Geçerli bir T.C. kimlik numarası girin.')).toBeVisible()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill('2013-03-01')
    await page.getByLabel('Veli adı soyadı').fill('Test Kayıt Velisi')
    await page.getByLabel('Veli telefonu').fill('05559990077')
    await proceed.click()

    await page.getByLabel('Taksit sayısı').selectOption('3')
    await page.getByLabel('Kardeş').check()
    await expect(page.getByRole('heading', { name: 'Ödeme planı önizlemesi' })).toBeVisible()
    await expect(page.getByText(/-10\.000,00/)).toBeVisible()
    await proceed.click()
    await expect(
      page.getByText('Kardeş indirimi için aynı veliye bağlı aktif bir öğrenci gerekir.'),
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(
      page.getByText('Kardeş indirimi için aynı veliye bağlı aktif bir öğrenci gerekir.'),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Geri' }).click()
    await page.getByLabel('Kardeş').uncheck()
    await proceed.click()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(page.getByRole('heading', { name: `${name} kaydedildi` })).toBeVisible()
    await expect(page.getByRole('button', { name: `${name} sözleşmesini görüntüle` })).toBeVisible()

    const invoices = (await client.get('/api/v1/collections/invoices?pageSize=100')).body as {
      data: { record: { amount: number; studentId: string } }[]
    }
    const mine = invoices.data.filter((row) => row.record.amount > 3_000_000)
    expect(mine.reduce((sum, row) => sum + row.record.amount, 0)).toBe(10_000_001)
    const body = JSON.stringify(invoices)
    expect(body).not.toContain('10000000146')
    await page.goto('/onburo/kayit-islemleri')
    await expect(
      page.getByLabel('Aday öğrenci').getByRole('option', { name: new RegExp(name) }),
    ).toHaveCount(0)
  })

  test('DOM-DIL-030, DOM-FIN-006: dil okulunda deneme dersi veli onayı ister, kayıt ders saatiyle hesaplanır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const name = 'Kuzey Aday'
    const school = await tenant({
      type: 'language_school',
      roles: ['onburo'],
      collections: ['schedule'],
      tariffYears: ['current'],
      records: [
        {
          collection: 'prospects',
          data: {
            id: 'aday-dil-1',
            name,
            phone: '05551112233',
            email: '',
            interest: 'A2 İngilizce',
            source: 'Web sitesi',
            branchId: 'b1',
            stage: 'Yeni aday',
            minor: true,
            guardianName: 'Kuzey Velisi',
            studentId: null,
            createdAt: new Date().toISOString(),
            trialAt: null,
            notes: [],
          },
        },
      ],
    })
    await loginAs(school.user('onburo'))
    const client = await api(school.user('onburo'))
    await page.goto(LIST_URL)
    await page.getByRole('button', { name: `${name} kartını aç` }).click()
    const card = page.getByRole('dialog', { name: 'Aday kartı' })

    const lesson = card.getByLabel('Ders', { exact: true })
    await expect(lesson.getByRole('option').nth(1)).toBeAttached()
    await lesson.selectOption({ index: 1 })
    await card.getByRole('button', { name: 'Deneme dersini planla' }).click()
    await expect(card.getByText('18 yaş altı adayın deneme dersi için veli onayı')).toBeVisible()
    await card.getByRole('checkbox', { name: /Veli, deneme dersine/ }).click()
    await card.getByRole('button', { name: 'Deneme dersini planla' }).click()
    await expect(page.getByText('Deneme dersi planlandı.')).toBeVisible()
    await expect(card.getByText('Planlanmış deneme dersi yok.')).toHaveCount(0)

    await card.getByRole('link', { name: 'Kesin kayda dönüştür' }).click()
    await expect(page).toHaveURL(/kayit-islemleri\?aday=/)
    const proceed = page.getByRole('button', { name: 'Devam et' })
    await page.getByLabel('Sınıf').selectOption({ index: 1 })
    await proceed.click()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill('2013-03-01')
    await page.getByLabel('Veli adı soyadı').fill('Kuzey Velisi')
    await page.getByLabel('Veli telefonu').fill('05559990078')
    await proceed.click()
    await page.getByLabel('Paket ders saati').fill('40')
    await page.getByLabel('Taksit sayısı').selectOption('2')
    await proceed.click()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(page.getByRole('heading', { name: `${name} kaydedildi` })).toBeVisible()

    const invoices = (await client.get('/api/v1/collections/invoices?pageSize=100')).body as {
      data: { record: { amount: number; feeKind?: string } }[]
    }
    const total = invoices.data.reduce((sum, row) => sum + row.record.amount, 0)
    expect(total).toBe(2_000_000)
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
      await expect(
        page.getByRole('heading', { name: /Yaklaşan görüşmeler|Planlı görüşme yok/ }),
      ).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await page.goto('/onburo/kayit-islemleri')
      await expect(
        page.getByRole('heading', { name: 'Yayımlanmış ücret tarifesi yok' }),
      ).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }
  })
})
