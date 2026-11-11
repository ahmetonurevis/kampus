import { expect, test } from './support/fixtures.ts'
import { answerAll, setUp, startAttempt, submitAttempt } from './support/reading-activity.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Yöneticinin beceri görevleri sayfası (OG-993; DOM-YTK-028): menüde ÖĞRENME kategorisinde
// "Beceri Görevleri", adres `/yonetici/odevler`. Kurumun bütün görevleri listelenir; ayrıntı
// panelinde otomatik puanlı görevin denemeleri görünür; yönetici görev atayabildiği için
// "Yeni görev" düğmesi vardır. Kurulum `support/reading-activity.ts` (UI'dan değil API'den).

const TITLE = 'Feribot okuma sınavı'
const DENIZ = 'Deniz Yılmaz'

test.describe('yönetici beceri görevleri', () => {
  test('OG-993, DOM-YTK-028: yönetici menüden görev listesini ve denemeleri görür, görev atayabilir', async ({
    page,
    context,
    loginAs,
    tenant,
    api,
  }) => {
    const { school, assignmentId } = await setUp(
      tenant,
      api,
      TITLE,
      { kind: 'evaluation', maxAttempts: 1 },
      { roles: ['yonetici'] },
    )
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAs(school.user('ogrenci'))
    await startAttempt(page, assignmentId)
    await answerAll(page, ["Ann's trip to work.", 'By bus.', 'She enjoys it.'])
    await submitAttempt(page)

    await context.clearCookies()
    await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/dashboard')
    const menu = page.getByRole('navigation', { name: 'Menü' })
    const group = menu.getByRole('button', { name: /öğrenme/i })
    if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
    await menu.getByRole('link', { name: 'Beceri Görevleri' }).click()
    await expect(page).toHaveURL(/\/yonetici\/odevler$/)
    await expect(page.getByRole('heading', { name: 'Beceri Görevleri', level: 1 })).toBeVisible()
    await expect(page.getByText('Kurumdaki bütün sınıfların görevleri')).toBeVisible()
    // Görev atamak yönetici yetkisindedir (API `yonetici` yazar).
    await expect(page.getByRole('button', { name: 'Yeni görev' })).toBeVisible()

    const row = page.getByRole('table', { name: 'Görev atamaları' }).locator('tbody tr')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(TITLE)
    await expect(row).toContainText('7-A')
    await expect(row).toContainText('Otomatik puanlanır')
    await row.getByRole('button', { name: `${TITLE} görev ayrıntısı`, exact: true }).click()

    // Deneme listesi yöneticide de görünür.
    const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
    const attempts = panel.getByRole('list', { name: 'Denemeler' })
    await expect(attempts.getByRole('listitem')).toHaveCount(1)
    await expect(attempts.getByText(DENIZ, { exact: true })).toBeVisible()
    await expect(attempts.getByText('Puan 75 / 100', { exact: true })).toBeVisible()
    // Yönetici başkasının atamasını da değiştirebilir (son teslimi uzatma).
    await expect(panel.getByRole('button', { name: 'Son teslimi kaydet' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('OG-993: yönetici dışındaki rol bu adresi açamaz', async ({ page, loginAs, tenant }) => {
    const school = await tenant({ roles: ['ogretmen'], classes: ['c1'] })
    await loginAs(school.user('ogretmen'))
    await page.goto('/yonetici/odevler')
    await expect(page).not.toHaveURL(/\/yonetici\/odevler/)
  })
})
