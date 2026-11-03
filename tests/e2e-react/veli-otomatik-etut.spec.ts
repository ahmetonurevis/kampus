import type { ApiClient } from './support/api.ts'
import { istanbulDay } from './support/commands.ts'
import { expect, test } from './support/fixtures.ts'
import { evaluatedRecords, tutorSession, TUTORING_DATA } from './support/tutoring.ts'

// OG-076: veli otomatik etüt duman testi. Etüt yöneticinin planından doğar (optik analizdeki
// eksik kazanımlar); veli yalnız seçili çocuğunun etütlerini salt okunur görür. Kurum teste özeldir
// (`tenant`): Deniz (s1) ve Ece (s2) aynı velinin çocuklarıdır, etüt yalnız Deniz'e planlanır.

const SESSIONS = '/api/v1/collections/tutorSessions?pageSize=100'
const MATH = /Matematik · /i
const WRITE_ACTIONS = ['Etüt planla', 'Yoklama al / güncelle', 'Etüdü iptal et']

async function sessionsOf(client: ApiClient): Promise<{ record: { studentIds: string[] } }[]> {
  const result = await client.get(SESSIONS)
  expect(result.status).toBe(200)
  return (result.body as { data: { record: { studentIds: string[] } }[] }).data
}

test.describe('veli: otomatik etüt', () => {
  test('yönetici planı onaylar; veli seçili çocuğun etüdünü salt okunur görür, kardeşinde etüt görünmez', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'veli'],
      students: ['s1'],
      collections: TUTORING_DATA,
      records: evaluatedRecords(new Date()),
    })
    const admin = await api(school.user('yonetici'))
    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/otomatik-etut')
    await page.getByRole('button', { name: 'Etüt planla' }).click()
    await page.getByLabel('Deneme', { exact: true }).selectOption('exam-7-1')
    await page.getByLabel('Başarı eşiği (%)').fill('100')
    await page.getByLabel('Bitiş tarihi').fill(istanbulDay(14))
    await page.getByRole('button', { name: 'Etüt planını önizle', exact: true }).click()
    await page.getByRole('button', { name: 'Onayla ve etütleri oluştur', exact: true }).click()
    await expect(page.getByText(/\d+ etüt oluşturuldu\./).first()).toBeVisible()
    await expect.poll(async () => (await sessionsOf(admin)).length).toBeGreaterThan(0)

    // Veli Deniz'in etüdünü görür; ekran yalnız okunur (planlama, yoklama ve iptal yok).
    await loginAs(school.user('veli'))
    await page.goto('/veli/otomatik-etut?cocuk=s1')
    await expect(page.getByRole('heading', { name: 'Otomatik Etüt', level: 1 })).toBeVisible()
    const first = page.getByRole('button', { name: MATH }).first()
    await expect(first).toBeVisible()
    for (const name of WRITE_ACTIONS)
      await expect(page.getByRole('button', { name })).toHaveCount(0)
    await first.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Deniz Yılmaz')
    await expect(dialog).toContainText('Planlandı')
    for (const name of WRITE_ACTIONS)
      await expect(dialog.getByRole('button', { name })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Rol kapsamı: seçili çocuk Ece'ye geçince Deniz'in etüdü görünmez.
    await page.goto('/veli/otomatik-etut?cocuk=s2')
    await expect(page.getByRole('heading', { name: 'Otomatik Etüt', level: 1 })).toBeVisible()
    await expect(page.getByText('Henüz etüt yok.')).toBeVisible()
    await expect(page.getByRole('button', { name: MATH })).toHaveCount(0)

    // Kalıcılık: sayfa yenilenince etüt sunucudan yeniden gelir.
    await page.goto('/veli/otomatik-etut?cocuk=s1')
    await expect(page.getByRole('button', { name: MATH }).first()).toBeVisible()
  })

  test('veli geçmiş etüdün yoklama sonucunu görür; yoklama kaydı yönetici içindir', async ({
    loginAs,
    tenant,
  }) => {
    const past = tutorSession('tutor-e2e-veli-past', new Date(Date.now() - 2 * 86_400_000))
    const school = await tenant({
      roles: ['yonetici', 'veli'],
      students: ['s1'],
      collections: TUTORING_DATA,
      records: [past],
    })
    // Yönetici yoklamayı alır; veli sonucu görür.
    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/otomatik-etut')
    await page.getByRole('button', { name: 'Matematik · Denklemler', exact: true }).click()
    const adminDialog = page.getByRole('dialog')
    await adminDialog.getByRole('button', { name: 'Yoklama al / güncelle', exact: true }).click()
    await adminDialog
      .getByRole('combobox', { name: 'Deniz Yılmaz', exact: true })
      .selectOption('Geldi')
    await adminDialog.getByRole('button', { name: 'Yoklamayı kaydet', exact: true }).click()
    await expect(adminDialog).toContainText('Tamamlandı')

    await loginAs(school.user('veli'))
    await page.goto('/veli/otomatik-etut?cocuk=s1')
    await page.getByRole('button', { name: 'Matematik · Denklemler', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Tamamlandı')
    await expect(dialog).toContainText('Geldi')
    await expect(dialog.getByRole('button', { name: 'Yoklama al / güncelle' })).toHaveCount(0)
  })
})
