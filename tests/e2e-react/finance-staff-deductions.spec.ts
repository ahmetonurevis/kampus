import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Avans ve kesintiler (ON-199; DOM-FIN-101). Kural dalları birim ve API testlerindedir
// (`tests/finance-staff-deductions.test.ts`, `apps/api/test/finance-staff-deductions.test.ts`);
// burada yönetici öğretmenin kesintilerini açar, formdan avans verir (taksit planını görür), ay için
// kesinti listesini net ücretle hesaplar (avans, sonra icra; K-315) ve ön büro sekmeyi görmez.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'
/** Bugün (Europe/Istanbul günü); sunucu "bugünden sonra olamaz" kuralını bu güne uygular. */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())

test.describe('DOM-FIN-101: avans ve kesintiler', () => {
  test('DOM-FIN-101: yönetici avans verir, taksit planını ve ay kesinti listesini görür; ön büro sekmeyi görmez', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const admin = await api(school.user('yonetici'))
    const people = await admin.get(
      '/api/v1/finance/staff-deductions?q=' + encodeURIComponent(teacher),
    )
    const membershipId =
      (people.body as { data: { membershipId: string; name: string }[] }).data.find(
        (person) => person.name === teacher,
      )?.membershipId ?? ''
    const icra = await admin.post('/api/v1/finance/staff-garnishments', {
      membershipId,
      office: 'İstanbul 12. İcra Dairesi',
      fileNumber: '2026/1234',
      claimCents: 5_000_000,
      receivedDate: today(),
    })
    expect(icra.status).toBe(201)

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=avans-kesinti`)
    const section = page.getByRole('region', { name: 'Avans ve kesintiler' })
    await section.getByRole('button', { name: `${teacher} kesintilerini aç` }).click()
    const panel = page.getByRole('dialog', { name: 'Avans ve kesintiler' })
    await expect(
      panel.getByRole('list', { name: 'İcra kesintileri' }).getByText('Kesiliyor'),
    ).toBeVisible()

    await panel.getByRole('button', { name: 'Yeni avans' }).click()
    const form = panel.getByRole('form', { name: 'Yeni avans' })
    await form.getByLabel('Avans tutarı (₺)').fill('0')
    await form.getByRole('button', { name: 'Avansı kaydet' }).click()
    await expect(form.getByText('Tutarı 1.234,56 biçiminde, sıfırdan büyük girin.')).toBeVisible()
    await form.getByLabel('Avans tutarı (₺)').fill('3.000,00')
    await form.getByLabel('Taksit sayısı').fill('3')
    await form.getByRole('button', { name: 'Avansı kaydet' }).click()
    await expect(form).toBeHidden()
    const advances = panel.getByRole('list', { name: 'Avanslar' })
    await expect(advances.getByText('Mahsup ediliyor')).toBeVisible()
    await expect(
      advances.getByRole('table', { name: 'Taksit planı' }).getByRole('row'),
    ).toHaveCount(4)

    const preview = panel.getByRole('form', { name: 'Ay için kesinti listesi' })
    await preview.getByLabel('Net ücret (₺, isteğe bağlı)').fill('20.000,00')
    await preview.getByRole('button', { name: 'Kesintileri hesapla' }).click()
    const table = panel.getByRole('table', { name: /kesintileri$/ })
    await expect(table.getByRole('row', { name: /Avans taksiti/ })).toContainText('1.000,00 ₺')
    await expect(table.getByRole('row', { name: /İcra kesintisi/ })).toContainText('5.000,00 ₺')
    await expect(panel.getByText(/Toplam kesinti 6\.000,00 ₺/)).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    await expect
      .poll(async () => {
        const detail = await admin.get(`/api/v1/finance/staff-deductions/${membershipId}`)
        return (detail.body as { data: { advances: { amountCents: number }[] } }).data.advances
      })
      .toEqual([expect.objectContaining({ amountCents: 300_000, installmentCount: 3 })])

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=avans-kesinti`)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Avans ve kesintiler' })).toHaveCount(0)
  })
})
