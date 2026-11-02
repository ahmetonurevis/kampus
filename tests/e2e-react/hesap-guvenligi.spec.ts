import { createApiClient, type ApiClient } from './support/api.ts'
import { e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { accountMenuButton } from './support/ui.ts'

// IST-003: parola unutma bilgisi, parola değişimi ve oturum sonlandırma. Sıfırlama bağlantısının
// kendisi (belirteç, süre, oturum iptali) API testindedir (`apps/api/test/password-reset.test.ts`):
// e2e API'si bellek kutusunu dışarı açmaz, test için ayrı uç da açılmaz.

const NEW_PASSWORD = 'Yeni-Guvenlik-Parolasi-2026'

async function sessionUserId(client: ApiClient): Promise<string | null> {
  const result = await client.get('/api/v1/auth/get-session')
  const body = result.body as { user?: { id: string } } | null
  return body?.user?.id ?? null
}

test.describe('hesap güvenliği', () => {
  test('IST-003: parolamı unuttum her e-postada aynı bilgiyi verir', async ({ page }) => {
    await page.goto('/giris')
    await page.getByRole('link', { name: 'Parolamı unuttum' }).click()
    await expect(page).toHaveURL(/\/parolami-unuttum$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Parolamı unuttum' })).toBeVisible()

    await page.getByRole('button', { name: 'Sıfırlama bağlantısı gönder' }).click()
    await expect(page.getByLabel('E-posta')).toHaveAttribute('aria-invalid', 'true')

    await page.getByLabel('E-posta').fill('boyle-biri-yok@kampus.example')
    await page.getByRole('button', { name: 'Sıfırlama bağlantısı gönder' }).click()
    await expect(page.getByRole('status')).toContainText('kayıtlı bir hesap varsa')

    // Belirteçsiz sıfırlama sayfası yeni bağlantı ister.
    await page.goto('/parola-sifirla')
    await expect(page.getByRole('alert')).toContainText('Bağlantı eksik')
    await expect(page.getByRole('link', { name: 'Yeni bağlantı iste' })).toBeVisible()
  })

  test('IST-003: sıfırlama belirteci adres parçasında gelir, adresten silinir ve geçersizse reddedilir', async ({
    page,
  }) => {
    const apiRequests: string[] = []
    page.on('request', (request) => apiRequests.push(request.url()))
    await page.goto('/parola-sifirla#token=uydurma-belirtec-123')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Yeni parola belirleyin' }),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/parola-sifirla$/)

    await page.getByLabel('Yeni parola', { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel('Yeni parola (tekrar)').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Parolayı değiştir' }).click()
    await expect(page.getByRole('alert')).toContainText('süresi dolmuş veya geçersiz')
    // Parça sunucuya hiç gitmez: hiçbir istek adresinde belirteç yoktur.
    expect(apiRequests.filter((url) => url.includes('uydurma-belirtec-123'))).toEqual([])
  })

  test('IST-003: Güvenlik sayfasında oturum sonlandırılır ve parola diğer cihazlardan çıkışla değişir', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    const teacher = school.user('ogretmen')
    const phone = await createApiClient({ email: teacher.email }, { fresh: true })
    const tablet = await createApiClient({ email: teacher.email }, { fresh: true })
    try {
      const page = await loginAs(teacher)
      await page.goto('/ogretmen/dashboard')
      await accountMenuButton(page, teacher.name).click()
      await page.getByRole('menuitem', { name: 'Güvenlik' }).click()
      await expect(page).toHaveURL(/\/ogretmen\/guvenlik$/)
      await expect(page.getByRole('heading', { level: 1, name: 'Güvenlik' })).toBeVisible()

      const sessions = page.getByRole('list', { name: 'Açık oturumlar' }).getByRole('listitem')
      await expect(sessions).toHaveCount(3)
      await expect(sessions.filter({ hasText: 'Bu cihaz' })).toHaveCount(1)

      // Tek oturum sonlandırma: iki diğer oturumdan biri kapanır.
      await page
        .getByRole('button', { name: /^Oturumu sonlandır/ })
        .first()
        .click()
      await expect(sessions).toHaveCount(2)
      await expect
        .poll(async () => [await sessionUserId(phone), await sessionUserId(tablet)].filter(Boolean))
        .toHaveLength(1)

      // Parola değişimi: "diğer cihazlardan çıkış yap" varsayılan işaretli.
      await page.getByLabel('Mevcut parola').fill(e2e.password)
      await page.getByLabel('Yeni parola', { exact: true }).fill(NEW_PASSWORD)
      await page.getByLabel('Yeni parola (tekrar)').fill(`${NEW_PASSWORD}x`)
      await page.getByRole('button', { name: 'Parolayı değiştir' }).click()
      await expect(page.getByText('Parolalar eşleşmiyor.')).toBeVisible()
      await page.getByLabel('Yeni parola (tekrar)').fill(NEW_PASSWORD)
      await expect(
        page.getByRole('checkbox', { name: 'Diğer cihazlardan çıkış yap' }),
      ).toBeChecked()
      await page.getByRole('button', { name: 'Parolayı değiştir' }).click()
      await expect(page.getByText('diğer cihazlardaki oturumlar kapatıldı')).toBeVisible()

      await expect(sessions).toHaveCount(1)
      expect(await sessionUserId(phone)).toBeNull()
      expect(await sessionUserId(tablet)).toBeNull()

      // Bu cihazın oturumu sürer; yeni parola geçer, eski geçmez.
      await page.reload()
      await expect(page.getByRole('heading', { level: 1, name: 'Güvenlik' })).toBeVisible()
      const signIn = (password: string) =>
        phone.post('/api/v1/auth/sign-in/email', { email: teacher.email, password })
      expect((await signIn(e2e.password)).status).toBe(401)
      expect((await signIn(NEW_PASSWORD)).status).toBe(200)
    } finally {
      await phone.dispose()
      await tablet.dispose()
    }
  })
})
