import { createApiClient, switchInstitutionApi, type ApiClient } from './support/api.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Kıdem ve ihbar hesaplayıcı (ON-205; DOM-FIN-094). Kural dalları birim ve API testlerindedir
// (`tests/finance-severance.test.ts`, `apps/api/test/finance-severance.test.ts`); burada yönetici
// formu doldurur, dökümü görür ve PDF'i indirir; ön büro sekmeyi görmez (K-272). ON-341: personel
// seçilince çıkış günündeki ücret tanımı forma dolar, kaynak sonuçta yazılır; net ücrette uyarı
// (K-345, K-346).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-094: kıdem ve ihbar hesaplayıcı', () => {
  test('DOM-FIN-094: yönetici hesaplar, dökümü görür ve PDF indirir; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=kidem-ihbar`)
    const section = page.getByRole('region', { name: 'Kıdem/ihbar hesaplayıcı' })
    await expect(
      section.getByText('Tahmini hesaptır; bordro ya da mali müşavir hesabı yerine geçmez.'),
    ).toBeVisible()
    const form = section.getByRole('form', { name: 'Kıdem ve ihbar hesabı' })
    await form.getByRole('button', { name: 'Hesapla' }).click()
    await expect(form.getByText('Çıkış nedenini seçin.')).toBeVisible()

    await form.getByLabel('İşe giriş günü').fill('2020-03-15')
    await form.getByLabel('Çıkış günü').fill('2025-09-30')
    await form.getByLabel('Son aylık brüt ücret (₺)').fill('50.000,00')
    await form.getByLabel('Düzenli yan ödemeler (₺/ay, isteğe bağlı)').fill('5.000,00')
    await form
      .getByLabel('Çıkış nedeni')
      .selectOption({ label: 'İşveren feshi (ahlak ve iyi niyete aykırılık dışında)' })
    await form.getByRole('button', { name: 'Hesapla' }).click()

    const result = section.getByRole('region', { name: 'Tahmini sonuç' })
    const table = result.getByRole('table', { name: 'Kıdem ve ihbar dökümü' })
    await expect(table.getByRole('row', { name: /Brüt tutar/ })).toContainText('299.143,43 ₺')
    await expect(table.getByRole('row', { name: /Net tutar/ })).toContainText('383.360,36 ₺')
    await expect(result.getByText('5 yıl 6 ay 16 gün')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await result.getByRole('button', { name: 'Kıdem ve ihbar tahmini PDF' }).click()
    const preview = page.getByRole('dialog', {
      name: 'Kıdem ve ihbar tazminatı tahmini · Önizleme',
    })
    const downloading = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toBe('kidem-ihbar-tahmini-2025-09-30.pdf')
    const text = await pdfText(file)
    for (const expected of ['KIDEM VE İHBAR TAHMİNİ', '299.143,43', 'bordro ya da mali müşavir'])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=kidem-ihbar`)
    await expect(desk.getByRole('table', { name: 'Taksit ve tahsilat listesi' })).toBeVisible()
    await expect(desk.getByRole('button', { name: 'Kıdem/ihbar hesaplayıcı' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Kıdem/ihbar hesaplayıcı' })).toHaveCount(0)
  })
})

/** Personelin kurum üyeliği (maskeli liste; ada göre). */
async function membershipOf(api: ApiClient, name: string): Promise<string> {
  const list = await api.get('/api/v1/finance/pay-rate-staff?pageSize=100')
  expect(list.ok, JSON.stringify(list.body)).toBe(true)
  const row = (list.body as { data: { membershipId: string; name: string }[] }).data.find(
    (item) => item.name === name,
  )
  if (!row) throw new Error(`Personel bulunamadı: ${name}`)
  return row.membershipId
}

async function payRate(api: ApiClient, body: Record<string, unknown>) {
  const result = await api.post('/api/v1/finance/pay-rates', body)
  expect(result.status, JSON.stringify(result.body)).toBe(201)
}

test.describe('DOM-FIN-094: kıdem hesaplayıcısında ücret önerisi (ON-341)', () => {
  test('DOM-FIN-094: personel seçilince geçerli ücret ve nakdi yan hak forma dolar, kaynak sonuçta; net ücrette uyarı (K-345, K-346)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacherName = school.user('ogretmen').name
    const deskName = school.user('onburo').name
    const api = await createApiClient({ email: school.user('yonetici').email }, { fresh: true })
    try {
      expect((await switchInstitutionApi(api, school.institutionId)).ok).toBe(true)
      const teacher = await membershipOf(api, teacherName)
      const desk = await membershipOf(api, deskName)
      await payRate(api, {
        component: 'wage',
        membershipId: teacher,
        rateType: 'monthly_gross',
        amountCents: 6_000_000,
        startDate: '2025-01-01',
      })
      await payRate(api, {
        component: 'benefit',
        membershipId: teacher,
        rateType: 'transport',
        benefitForm: 'cash',
        taxable: true,
        amountCents: 250_000,
        startDate: '2025-01-01',
      })
      await payRate(api, {
        component: 'benefit',
        membershipId: teacher,
        rateType: 'meal',
        benefitForm: 'in_kind',
        taxable: false,
        amountCents: 400_000,
        startDate: '2025-01-01',
      })
      await payRate(api, {
        component: 'wage',
        membershipId: desk,
        rateType: 'monthly_net',
        amountCents: 4_000_000,
        startDate: '2025-01-01',
      })

      const page = await loginAs(school.user('yonetici'))
      await page.goto(`${ADMIN}?gorunum=kidem-ihbar`)
      const section = page.getByRole('region', { name: 'Kıdem/ihbar hesaplayıcı' })
      const form = section.getByRole('form', { name: 'Kıdem ve ihbar hesabı' })
      const gross = form.getByLabel('Son aylık brüt ücret (₺)')
      const benefits = form.getByLabel('Düzenli yan ödemeler (₺/ay, isteğe bağlı)')
      // Çıkış günü varsayılan bugündür (İstanbul); tanımlar 2025'ten beri yürürlükte.
      await form.getByLabel('Personel (isteğe bağlı)').selectOption(teacher)
      const status = form.getByRole('status', { name: 'Ücret önerisi' })
      await expect(status).toContainText('Öneri dolduruldu: Aylık brüt 60.000,00 ₺')
      await expect(status).toContainText('Yemek ayni olduğu için hariç')
      await expect(gross).toHaveValue('60000,00')
      await expect(benefits).toHaveValue('2500,00')

      await form.getByLabel('İşe giriş günü').fill('2020-03-15')
      await form
        .getByLabel('Çıkış nedeni')
        .selectOption({ label: 'İşveren feshi (ahlak ve iyi niyete aykırılık dışında)' })
      await form.getByRole('button', { name: 'Hesapla' }).click()
      const result = section.getByRole('region', { name: 'Tahmini sonuç' })
      await expect(result.getByText('62.500,00 ₺', { exact: true })).toBeVisible()
      await expect(
        result.getByText(/^Ücret tanımı: Aylık brüt, 1 Ocak 2025 başlangıçlı/),
      ).toBeVisible()
      await expect(result.getByText(/^1 nakdi yan hak .*1 ayni yan hak hariç$/)).toBeVisible()
      await expect(result.getByText(/^Platformun bordro parametresi, /)).toBeVisible()

      // Öneri değiştirilebilir; sonuç değişikliği yazar.
      await gross.fill('61.000,00')
      await form.getByRole('button', { name: 'Hesapla' }).click()
      await expect(result.getByText('63.500,00 ₺', { exact: true })).toBeVisible()
      await expect(result.getByText(/öneri değiştirildi$/)).toBeVisible()

      // Net tanımlı ücrette öneri yapılmaz; elle girilen değer korunur.
      await form.getByLabel('Personel (isteğe bağlı)').selectOption(desk)
      await expect(status).toContainText('net tanımlı')
      await expect(gross).toHaveValue('61.000,00')
      await expectNoHorizontalOverflow(page)
    } finally {
      await api.dispose()
    }
  })
})
