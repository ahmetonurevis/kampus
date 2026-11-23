import pg from 'pg'

import { createApiClient, type ApiClient } from './support/api.ts'
import { e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { accountMenuButton } from './support/ui.ts'

// IST-003, IST-025: parola unutma bilgisi, parola değişimi ve oturum kapatma. Sıfırlama bağlantısının
// kendisi (belirteç, süre, oturum iptali) API testindedir (`apps/api/test/password-reset.test.ts`):
// e2e API'si bellek kutusunu dışarı açmaz, test için ayrı uç da açılmaz.

const NEW_PASSWORD = 'Yeni-Guvenlik-Parolasi-2026'

/**
 * Hesabın bütün oturumlarını taze olmaktan çıkarır (`freshAge` 15 dk): açılış anı bir saat geriye
 * alınır. Test kendi kurumunun hesabına doğrudan yazar (`odevler.spec.ts` `markFilesReady` gibi);
 * oturum süresi (`expiresAt`) değişmez, oturum geçerli kalır.
 */
async function ageSessions(email: string): Promise<void> {
  const client = new pg.Client({ connectionString: e2e.databaseUrl })
  await client.connect()
  try {
    const result = await client.query(
      "update sessions set created_at = now() - interval '1 hour' where user_id = (select id from users where email = $1)",
      [email],
    )
    expect(result.rowCount).toBeGreaterThan(0)
  } finally {
    await client.end()
  }
}

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

  test('IST-025: Oturumlarım diğer tüm oturumları onayla kapatır, bu oturum sürer', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['veli'] })
    const parent = school.user('veli')
    const phone = await createApiClient({ email: parent.email }, { fresh: true })
    const tablet = await createApiClient({ email: parent.email }, { fresh: true })
    try {
      const page = await loginAs(parent)
      await page.goto('/veli/guvenlik')
      const sessions = page.getByRole('list', { name: 'Oturumlarım' }).getByRole('listitem')
      await expect(sessions).toHaveCount(3)
      // IP adresi gösterilmez.
      await expect(page.getByRole('list', { name: 'Oturumlarım' })).not.toContainText(
        /\d+\.\d+\.\d+/,
      )

      await page.getByRole('button', { name: 'Diğer tüm oturumları kapat' }).click()
      const confirm = page.getByRole('alertdialog', { name: 'Diğer tüm oturumlar kapatılsın mı?' })
      await expect(confirm).toContainText('Bu cihaz dışındaki 2 oturum kapanır')
      await confirm.getByRole('button', { name: 'Diğer tüm oturumları kapat' }).click()
      await expect(page.getByText('Diğer cihazlardaki oturumlar kapatıldı.')).toBeVisible()
      await expect(sessions).toHaveCount(1)
      await expect(sessions.first().getByText('Bu oturum', { exact: true })).toBeVisible()
      expect(await sessionUserId(phone)).toBeNull()
      expect(await sessionUserId(tablet)).toBeNull()
      await expect(page.getByRole('button', { name: 'Diğer tüm oturumları kapat' })).toBeHidden()
    } finally {
      await phone.dispose()
      await tablet.dispose()
    }
  })

  test('IST-025: eski oturumda tek oturum kapatma parola penceresiyle doğrulanıp tamamlanır', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['veli'] })
    const parent = school.user('veli')
    const phone = await createApiClient({ email: parent.email }, { fresh: true })
    try {
      const page = await loginAs(parent)
      await page.goto('/veli/guvenlik')
      const sessions = page.getByRole('list', { name: 'Oturumlarım' }).getByRole('listitem')
      await expect(sessions).toHaveCount(2)

      // Liste açıldıktan sonra oturum eskir; kapatma ucu 403 SESSION_NOT_FRESH döndürür.
      await ageSessions(parent.email)
      await page.getByRole('button', { name: /^Bu oturumu kapat:/ }).click()
      const confirm = page.getByRole('alertdialog', { name: 'Bu oturum kapatılsın mı?' })
      await confirm.getByRole('button', { name: 'Bu oturumu kapat' }).click()

      // Parola penceresi onay penceresinin üstünde açılır ve odağı alır.
      const reauth = page.getByRole('dialog', { name: 'Parolanızı doğrulayın' })
      await expect(reauth).toBeVisible()
      // Onay penceresi altta açık kalır; üstteki modal onu erişilebilirlik ağacından gizler.
      await expect(
        page.getByRole('alertdialog', { name: 'Bu oturum kapatılsın mı?', includeHidden: true }),
      ).toBeVisible()
      await expect
        .poll(() => reauth.evaluate((dialog) => dialog.contains(document.activeElement)))
        .toBe(true)
      expect(await sessionUserId(phone)).not.toBeNull()

      await reauth.getByLabel('Parola').fill(e2e.password)
      await reauth.getByRole('button', { name: 'Doğrula ve devam et' }).click()
      await expect(page.getByText('Oturum kapatıldı.')).toBeVisible()
      await expect(reauth).toBeHidden()
      await expect(confirm).toBeHidden()
      await expect.poll(() => sessionUserId(phone)).toBeNull()
    } finally {
      await phone.dispose()
    }
  })

  test('IST-003: Güvenlik sayfasında oturum kapatılır ve parola diğer cihazlardan çıkışla değişir', async ({
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

      const sessions = page.getByRole('list', { name: 'Oturumlarım' }).getByRole('listitem')
      await expect(sessions).toHaveCount(3)
      await expect(
        sessions.filter({ has: page.getByText('Bu oturum', { exact: true }) }),
      ).toHaveCount(1)

      // IST-025: tek oturum onay penceresiyle kapanır; vazgeçince hiçbir oturum kapanmaz.
      const revokeOne = page.getByRole('button', { name: /^Bu oturumu kapat:/ }).first()
      await revokeOne.click()
      const confirm = page.getByRole('alertdialog', { name: 'Bu oturum kapatılsın mı?' })
      await confirm.getByRole('button', { name: 'Vazgeç' }).click()
      await expect(confirm).toBeHidden()
      await expect(sessions).toHaveCount(3)
      await revokeOne.click()
      await confirm.getByRole('button', { name: 'Bu oturumu kapat' }).click()
      await expect(page.getByText('Oturum kapatıldı.')).toBeVisible()
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
