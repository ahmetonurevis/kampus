import { randomUUID } from 'node:crypto'

import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Yemekhane alerji uyarısı (ON-151; DOM-FIN-162). Kural dalları birim ve API testlerindedir
// (`tests/finance-meal-allergy-checks.test.ts`, `apps/api/test/finance-meal-allergy-checks.test.ts`);
// burada yönetici API'den öğrencinin alerjisini yazar ve bugünün öğle menüsünü yayımlar, ön büro dar
// ekranda önerilen gerekçeyi onaylar, sınıfın listesini açar: yemek ve alerjen, eşlenemeyen alerji
// elle kontrol olarak görünür; "uyarı görüldü, alternatif verildi" işaretlenir (K-541…K-543).

const DESK = '/onburo/tahsilat-takip?gorunum=yemekhane-alerji'

/** Europe/Istanbul bugünü ve haftasının pazartesisi. */
function istanbulWeek() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())
  const date = new Date(`${today}T12:00:00.000Z`)
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  date.setUTCDate(date.getUTCDate() - (weekday - 1))
  return { today, weekStart: date.toISOString().slice(0, 10) }
}

test.describe('DOM-FIN-162: yemekhane alerji uyarısı', () => {
  test('DOM-FIN-162: ön büro sınıfın alerji listesini açar ve uyarıyı işaretler (K-541…K-543)', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    const admin = await api(school.user('yonetici'))
    const profile = await admin.context.patch('/api/v1/students/s1/health-profile', {
      data: {
        allergies: [
          { name: 'Süt', severity: 'severe' },
          { name: 'Kivi', severity: 'mild' },
        ],
        legalBasis: 'explicit_consent',
        version: 1,
      },
    })
    expect(profile.status()).toBe(200)
    const { today, weekStart } = istanbulWeek()
    const created = await admin.context.post('/api/v1/finance/meal-menus', {
      data: { weekStart },
      headers: { 'idempotency-key': randomUUID() },
    })
    expect(created.status()).toBe(201)
    const menu = ((await created.json()) as { data: { id: string; version: number } }).data
    const filled = await admin.context.patch(`/api/v1/finance/meal-menus/${menu.id}`, {
      data: {
        slots: [
          {
            menuDate: today,
            mealKind: 'lunch',
            items: [
              { name: 'Mercimek çorbası', allergens: ['celery'], nutrition: null },
              { name: 'Sütlü pilav', allergens: ['milk'], nutrition: null },
            ],
          },
        ],
      },
      headers: { 'if-match': `"${String(menu.version)}"` },
    })
    expect(filled.status()).toBe(200)
    const version = ((await filled.json()) as { data: { version: number } }).data.version
    const published = await admin.context.post(`/api/v1/finance/meal-menus/${menu.id}/publish`, {
      headers: { 'if-match': `"${String(version)}"` },
    })
    expect(published.status()).toBe(200)

    const page = await loginAs(school.user('onburo'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(DESK)
    const section = page.getByRole('region', { name: 'Yemekhane alerji uyarısı' })
    await section.getByRole('button', { name: 'Gerekçe seç' }).click()
    // Gerekçe ekranın amacıyla ön seçilidir; görevli onaylar (DOM-FIN-156).
    const reason = page
      .getByRole('dialog', { name: 'Sağlık bilgisine erişim gerekçesi' })
      .getByRole('form', { name: 'Erişim gerekçesi' })
    await expect(reason.getByLabel('Açıklama')).toHaveValue('Yemek servisinde alerji kontrolü')
    await reason.getByRole('button', { name: 'Bilgiyi aç' }).click()

    await section.getByLabel('Sınıf ya da düzey').selectOption({ label: '7-A' })
    await section.getByRole('button', { name: 'Listeyi göster' }).click()
    const deniz = section
      .getByRole('list', { name: 'Alerji uyarıları' })
      .getByRole('listitem', { name: 'Deniz Yılmaz alerji uyarısı' })
    await expect(deniz.getByRole('list', { name: 'Deniz Yılmaz yemek uyarıları' })).toHaveText(
      'Sütlü pilav: Süt',
    )
    await expect(deniz.getByRole('list', { name: 'Deniz Yılmaz elle kontrol' })).toContainText(
      'Kivi (hafif) — menüyle karşılaştırılamadı, elle kontrol',
    )
    await expect(deniz.getByText('Ağır (anafilaksi riski)')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await deniz
      .getByRole('button', { name: 'Deniz Yılmaz için uyarı görüldü, alternatif verildi' })
      .click()
    await expect(
      deniz.getByText(/^Uyarı görüldü, alternatif verildi · \d{2}:\d{2} · /),
    ).toBeVisible()
    await expect(deniz.getByRole('button')).toHaveCount(0)
  })
})
