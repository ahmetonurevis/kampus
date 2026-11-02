import type { Locator, Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Ödev ekranları (IST-095; docs/domain/akademik-olcme.md DOM-AKD-070…074) API'ye yazarak sınanır.
// Her test kendi kurumunu kurar (`tenant`): seed ile aynı kimlikler, ayrı kurum; öğretmen Selin Kaya
// (t1) 7-A (c1) Matematik'e atanmıştır, öğrenci Deniz Yılmaz (s1) 7-A'dadır. Kurumda başlangıçta
// ödev yoktur; kalıcılık her adımda `/api/v1/homework` ile doğrulanır.

const TEACHER_HOMEWORK = '/ogretmen/odevler'

interface HomeworkView {
  id: string
  version: number
  classId: string
  subjectId: string
  teacherId: string
  title: string
  description: string
  dueDate: string
  allowLate: boolean
}

const panelOf = (page: Page, name: string) => page.getByRole('dialog', { name })
const bodyRows = (page: Page) =>
  page.getByRole('table', { name: 'Ödev ve teslim listesi' }).locator('tbody tr')
const metric = (panel: Locator, label: string) =>
  panel.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]')

/** Bugünden `days` gün sonrası (Europe/Istanbul), `datetime-local` biçiminde saatle. */
function istanbulDay(days: number, time: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
    new Date(Date.now() + days * 86_400_000),
  )
  return `${day}T${time}`
}

/** Türkiye saati (UTC+3, yaz saati yok) → ISO UTC an. */
const istanbulToUtc = (local: string) => new Date(`${local}:00+03:00`).toISOString()

async function homeworkList(client: ApiClient): Promise<HomeworkView[]> {
  const result = await client.get('/api/v1/homework?page=1&pageSize=100')
  expect(result.status).toBe(200)
  return (result.body as { data: HomeworkView[] }).data
}

test.describe('Ödevler: öğretmen', () => {
  test('ödev verir, panelde görür, düzenler ve teslimsiz ödevi arşivler (DOM-AKD-070, DOM-AKD-071)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'ogrenci', 'veli'] })
    const teacher = await api(school.user('ogretmen'))
    await loginAs(school.user('ogretmen'))
    const due = istanbulDay(3, '17:00')
    const title = 'Kesirlerle işlemler'

    await page.goto(TEACHER_HOMEWORK)
    await expect(page.getByText('0 ödev · Sınıflarınızın ödevleri')).toBeVisible()
    await page.getByRole('button', { name: 'Ödev ver', exact: true }).click()
    const form = panelOf(page, 'Ödev ver')
    await form.getByLabel('Sınıf', { exact: true }).selectOption({ label: '7-A' })
    // Tek ders ataması olan sınıfta ders kendiliğinden seçilir.
    await expect(form.getByLabel('Ders', { exact: true })).toHaveValue('math')
    await form.getByLabel('Başlık').fill(title)
    await form.getByLabel('Açıklama').fill('Ders kitabı 42. sayfa, 1-10 arası sorular.')
    await form.getByLabel('Son teslim', { exact: true }).fill(due)
    await form.getByRole('button', { name: 'Ödevi ver' }).click()
    await expect(page.getByText('Ödev verildi.')).toBeVisible()
    await expect(panelOf(page, 'Ödev ver')).toHaveCount(0)

    const [created] = await homeworkList(teacher)
    expect(created).toMatchObject({
      classId: 'c1',
      subjectId: 'math',
      teacherId: 't1',
      title,
      dueDate: istanbulToUtc(due),
      allowLate: true,
    })
    if (!created) return

    // Liste satırından panel açılır; teslimsiz ödevde teslim eden 0'dır.
    const row = bodyRows(page).filter({ hasText: title })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('7-A')
    await expect(row).toContainText('Açık')
    await row.getByRole('button', { name: `${title} teslim durumunu aç` }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]odev=${created.id}`))
    const detail = panelOf(page, 'Ödev teslim durumu')
    await expect(detail).toContainText(title)
    await expect(metric(detail, 'Teslim eden')).toHaveText(/^0 \/ \d+$/)
    await expect(metric(detail, 'Geç teslim')).toHaveText('Kabul edilir')

    // Düzenle: başlık ve geç teslim değişir; sınıf ve ders kilitlidir.
    await detail.getByRole('button', { name: 'Düzenle' }).click()
    const edit = panelOf(page, 'Ödevi düzenle')
    await expect(edit.getByLabel('Sınıf', { exact: true })).toBeDisabled()
    await expect(edit.getByLabel('Başlık')).toHaveValue(title)
    await expect(edit.getByLabel('Son teslim', { exact: true })).toHaveValue(due)
    await edit.getByLabel('Başlık').fill(`${title} (gözden geçirilmiş)`)
    await edit.getByText('Son teslimden sonra geç teslim kabul edilsin').click()
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Ödev güncellendi.')).toBeVisible()
    const updated = panelOf(page, 'Ödev teslim durumu')
    await expect(updated).toContainText(`${title} (gözden geçirilmiş)`)
    await expect(metric(updated, 'Geç teslim')).toHaveText('Kabul edilmez')
    const [saved] = await homeworkList(teacher)
    expect(saved).toMatchObject({
      id: created.id,
      version: created.version + 1,
      title: `${title} (gözden geçirilmiş)`,
      allowLate: false,
    })

    // Arşiv onay ister; teslimsiz ödev listeden kalkar, kayıt artık okunmaz.
    await updated.getByRole('button', { name: 'Arşivle' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Ödevi arşivle' })
    await confirm.getByRole('button', { name: 'Arşivle' }).click()
    await expect(page.getByText(`${title} (gözden geçirilmiş) arşivlendi.`)).toBeVisible()
    await expect(panelOf(page, 'Ödev teslim durumu')).toHaveCount(0)
    await expect(bodyRows(page).filter({ hasText: title })).toHaveCount(0)
    expect(await homeworkList(teacher)).toHaveLength(0)
  })
})
