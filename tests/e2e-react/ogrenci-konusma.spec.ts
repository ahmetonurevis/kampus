import type { Page } from '@playwright/test'

import type { ApiClient, Principal } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { grantSpeakingConsent, useFakeMicrophone } from './support/speaking.ts'
import { assignTask, seedSpeakingHomework, seedSpeakingRubric, userIdOf } from './support/tasks.ts'
import type { Tenant, TenantOptions } from './support/tenant.ts'

// Konuşma görevi (IST-051; DOM-BEC-050, 051, 052, 054): öğrenci tarayıcıda ses kaydeder, dinler,
// gönderir; dosya sunucuda işlenir (`processing` → `ready`) ve teslim görünür. Ses rızası yoksa
// kayıt düğmesi hiç çıkmaz, görev yüz yüze değerlendirilir. Sahte mikrofon ve ffmpeg denetimi
// `support/speaking.ts`'tedir.

useFakeMicrophone('konusma')

const MAIN_TITLE = 'Sevdiğim yer'

interface Setup {
  tenant: Tenant
  admin: ApiClient
  assignmentId: string
  /** `second` doluysa aynı öğrenciye atanmış ikinci konuşma görevinin ataması. */
  secondAssignmentId: string | null
}

const SECOND_TITLE = 'Hayalimdeki tatil'

/** Kurum, konuşma görevi ve ataması; `consent` doluysa veli s1 için ses kaydı rızası verir. */
async function speakingSchool(
  tenantFactory: (options: TenantOptions) => Promise<Tenant>,
  api: (principal: Principal | null) => Promise<ApiClient>,
  options: { consent: boolean; second?: boolean },
): Promise<Setup> {
  const tenant = await tenantFactory({ roles: ['yonetici', 'veli', 'ogrenci'], students: ['s1'] })
  const admin = await api(tenant.user('yonetici'))
  if (options.consent) await grantSpeakingConsent(tenant, admin, api)
  const ownerId = await userIdOf(admin)
  const rubricVersionId = await seedSpeakingRubric(tenant.institutionId, ownerId)
  const settings = {
    submission: {
      submissionKind: 'audio',
      maxVersions: 3,
      speakingAttempts: 2,
      preparationSeconds: 3,
      speakingSeconds: 10,
    },
    rubricVersionId,
  }
  const homework = await seedSpeakingHomework(tenant.institutionId, ownerId, MAIN_TITLE)
  const assignmentId = await assignTask(admin, { resourceVersionId: homework, settings })
  let secondAssignmentId: string | null = null
  if (options.second) {
    const other = await seedSpeakingHomework(tenant.institutionId, ownerId, SECOND_TITLE)
    secondAssignmentId = await assignTask(admin, { resourceVersionId: other, settings })
  }
  return { tenant, admin, assignmentId, secondAssignmentId }
}

/** Ödevlerim listesinden görevin ayrıntı panelini açıp `Kayda başla` ile çalışma alanına girer. */
async function openSpeakingTask(page: Page, title: string) {
  await page.getByRole('button', { name: `${title} ayrıntısını aç` }).click()
  await page
    .getByRole('dialog', { name: 'Görev ayrıntısı' })
    .getByRole('button', { name: 'Kayda başla' })
    .click()
}

const recorder = (page: Page) => page.getByRole('region', { name: 'Ses kaydı' })

test.describe('öğrenci konuşma görevi', () => {
  test('IST-051, DOM-BEC-050, 052: öğrenci kaydeder, dinler ve gönderir; dosya işlenir ve teslim görünür', async ({
    page,
    context,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await speakingSchool(tenant, api, { consent: true })
    await context.grantPermissions(['microphone'])
    await loginAs(school.tenant.user('ogrenci'))
    await page.goto('/ogrenci/odevler')
    await page.getByRole('button', { name: `${MAIN_TITLE} ayrıntısını aç` }).click()
    await page
      .getByRole('dialog', { name: 'Görev ayrıntısı' })
      .getByRole('button', { name: 'Kayda başla' })
      .click()
    await expect(page).toHaveURL(new RegExp(`yaz=${school.assignmentId}`))

    // Aydınlatma ve sınırlar kayıttan önce görünür; kayıt rıza geçerli olduğundan açıktır.
    await expect(page.getByRole('note').filter({ hasText: 'puanlanması' })).toBeVisible()
    await expect(page.getByText('en çok 10 saniye')).toBeVisible()
    await expect(page.getByText('Kalan deneme:').locator('..')).toContainText('2')
    const box = recorder(page)
    await expect(box).toBeVisible()

    // Hazırlık süresi atlanır; kayıt sürerken saat işler, en az iki saniye kaydedilir.
    await box.getByRole('button', { name: 'Hazırlığa başla' }).click()
    await box.getByRole('button', { name: 'Hazırım, kayda başla' }).click()
    await expect(box.getByText('Kaydediliyor')).toBeVisible()
    await expect(box.getByRole('timer')).toContainText(/00:0[2-9] \/ 00:10/)
    await box.getByRole('button', { name: 'Kaydı bitir' }).click()

    // Göndermeden önce dinlenir; ilk kayıt gönderilir.
    const player = box.getByLabel(/Kaydınızı dinleyin/)
    await expect(player).toBeVisible()
    await expect(
      box.getByText('Kayıt tamamlandı. Göndermeden önce dinleyebilirsiniz.'),
    ).toBeVisible()
    await box.getByRole('button', { name: 'Kaydı gönder' }).click()

    // Dosya arka planda işlenir; istemci bekler, `ready` olunca teslim kendiliğinden yapılır.
    await expect(box.getByText('Kaydınız teslim edildi.')).toBeVisible({ timeout: 25_000 })
    const versions = page.getByRole('list', { name: 'Gönderilen sürümler' })
    await expect(versions.getByRole('heading', { name: '1. sürüm' })).toBeVisible()
    // Hak 2 iken bir kayıt teslim edildi: yeni kayıt yapılabilir.
    await expect(box.getByRole('button', { name: 'Yeni kayıt yap' })).toBeVisible()

    // Sunucuda tek teslim ve tek sürüm var.
    const list = await school.admin.get(
      `/api/v1/task-submissions?assignmentId=${school.assignmentId}&page=1&pageSize=20`,
    )
    expect(list.status).toBe(200)
    const submissions = (list.body as { data: { id: string }[] }).data
    expect(submissions).toHaveLength(1)
    const detail = await school.admin.get(`/api/v1/task-submissions/${submissions[0]?.id}`)
    const body = (detail.body as { data: { versions: unknown[] } }).data
    expect(body.versions).toHaveLength(1)
  })

  test('DOM-BEC-050: ses kaydı rızası yokken kayıt düğmesi çıkmaz, görev yüz yüze değerlendirilir', async ({
    page,
    context,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await speakingSchool(tenant, api, { consent: false })
    await context.grantPermissions(['microphone'])
    await loginAs(school.tenant.user('ogrenci'))
    await page.goto(`/ogrenci/odevler?yaz=${school.assignmentId}`)

    await expect(page.getByRole('heading', { name: MAIN_TITLE }).first()).toBeVisible()
    await expect(
      page.getByText(
        'Ses kaydı için gerekli onay bulunmuyor; bu görev öğretmeninizle yüz yüze değerlendirilecek.',
      ),
    ).toBeVisible()
    await expect(page.getByText(/veliniz Ayarlar sayfasındaki Rızalarım/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Kayda başla|Hazırlığa başla/ })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Ses kaydı' })).toHaveCount(0)

    // Teslim açılmamıştır. Rızasız yüklemenin 403 `consent_required` alması ve nesnenin
    // yazılmaması API'de sınanır (apps/api/test/files.test.ts, DOM-BEC-050); burada
    // öğrenci için kayıt düğmesinin hiç çıkmadığı ve sunucuda teslim bulunmadığı doğrulanır.
    const list = await school.admin.get(
      `/api/v1/task-submissions?assignmentId=${school.assignmentId}&page=1&pageSize=20`,
    )
    expect((list.body as { data: unknown[] }).data).toHaveLength(0)
  })

  test('IST-051, DOM-BEC-054: başka göreve geçince önceki görevin kaydı taşınmaz', async ({
    page,
    context,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await speakingSchool(tenant, api, { consent: true, second: true })
    await context.grantPermissions(['microphone'])
    await loginAs(school.tenant.user('ogrenci'))
    // İkinci görev önce açılıp kapatılır: verisi önbellekte kalır, sonradan geçişte yükleme
    // ekranı çıkmaz ve bileşen sökülmeden aynı ekranda yeniden kullanılır.
    await page.goto('/ogrenci/odevler')
    await openSpeakingTask(page, SECOND_TITLE)
    await expect(page.getByRole('heading', { name: SECOND_TITLE }).first()).toBeVisible()
    await expect(recorder(page)).toBeVisible()
    await page.getByRole('button', { name: 'Listeye dön' }).click()
    await page.getByRole('dialog', { name: 'Görev ayrıntısı' }).press('Escape')
    await expect(page.getByRole('dialog', { name: 'Görev ayrıntısı' })).toHaveCount(0)
    await openSpeakingTask(page, MAIN_TITLE)
    const box = recorder(page)
    await box.getByRole('button', { name: 'Hazırlığa başla' }).click()
    await box.getByRole('button', { name: 'Hazırım, kayda başla' }).click()
    await expect(box.getByRole('timer')).toContainText(/00:0[2-9] \/ 00:10/)
    await box.getByRole('button', { name: 'Kaydı bitir' }).click()
    await expect(box.getByLabel(/Kaydınızı dinleyin/)).toBeVisible()

    // Liste ekranına uğramadan ikinci göreve geçilir (geçmiş girdisi/derin bağlantı; `popstate`
    // yönlendiriciye sayfa içi geçiş olarak ulaşır): ikinci görevde ilk görevin kaydı, dinleyicisi
    // ve gönder düğmesi bulunmaz.
    await page.evaluate((id) => {
      window.history.pushState({}, '', `/ogrenci/odevler?yaz=${id}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, school.secondAssignmentId)
    await expect(page).toHaveURL(new RegExp(`yaz=${school.secondAssignmentId}`))
    await expect(page.getByRole('heading', { name: SECOND_TITLE }).first()).toBeVisible()
    await expect(box.getByRole('button', { name: 'Hazırlığa başla' })).toBeVisible()
    await expect(box.getByLabel(/Kaydınızı dinleyin/)).toHaveCount(0)
    await expect(box.getByRole('button', { name: 'Kaydı gönder' })).toHaveCount(0)
  })
})
