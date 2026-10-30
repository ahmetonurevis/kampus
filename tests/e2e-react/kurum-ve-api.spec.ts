import { institutions } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { accountMenuButton, switchInstitutionThroughMenu } from './support/ui.ts'

interface MeBody {
  data: { user: { name: string }; activeInstitution: { id: string; name: string } | null }
}

test.describe('API yardımcıları ve kurum değiştirme', () => {
  test('oturumsuz API isteği 401 döner', async ({ api }) => {
    const client = await api(null)
    expect((await client.get('/api/v1/me')).status).toBe(401)
  })

  test('önbellekteki rol oturumu /me ile kendi kurumunu döner', async ({ api }) => {
    const client = await api('ogretmen')
    const me = await client.get('/api/v1/me')
    expect(me.status).toBe(200)
    const body = me.body as MeBody
    expect(body.data.user.name).toBe('Selin Kaya')
    expect(body.data.activeInstitution?.name).toBe(institutions.akademi)
  })

  test('çok kurumlu yönetici avatar menüsünden kurum değiştirir', async ({
    page,
    loginAs,
    api,
  }) => {
    // Kurum etkin oturumda saklanır: paylaşılan önbellek oturumu değil, kendi oturumumuz.
    await loginAs('yonetici', { fresh: true })
    // Genel Bakış açılışta 11 eşzamanlı istek atar; tarayıcının 6 bağlantı sınırında kurum değişimi
    // isteği bunların arkasında bekler (yükte 8 sn'yi aşıyordu). Testin konusu panel değil kurum
    // değişimi olduğundan hafif bir sayfadan başlanır.
    await page.goto('/yonetici/ayarlar')
    await switchInstitutionThroughMenu(page, 'Murat Yılmaz', institutions.kampusDil)

    // Kurum değişimi ekranda bitene kadar beklenir: değişim sürerken menü maddeleri devre dışıdır
    // ve eski kurum işaretli görünür. Menü yalnız yan çubuk yeni kurumu gösterince açılır.
    await expect(page.getByRole('complementary', { name: 'Ana gezinme' })).toContainText(
      institutions.kampusDil,
    )

    // Değişiklik sunucuda kalıcıdır: aynı çerezle /me yeni kurumu verir.
    await expect
      .poll(async () => {
        const response = await page.context().request.get('/api/v1/me')
        return ((await response.json()) as MeBody).data.activeInstitution?.name
      })
      .toBe(institutions.kampusDil)

    await accountMenuButton(page, 'Murat Yılmaz').click()
    await expect(
      page.getByRole('menuitemradio', { name: new RegExp(institutions.kampusDil) }),
    ).toBeChecked()

    // Paylaşılan yönetici oturumu etkilenmedi.
    const shared = await api('yonetici')
    const sharedMe = (await shared.get('/api/v1/me')).body as MeBody
    expect(sharedMe.data.activeInstitution?.name).toBe(institutions.akademi)
  })
})
