import { randomUUID } from 'node:crypto'

import type { Locator, Page } from '@playwright/test'
import pg from 'pg'

import type { ApiClient } from './support/api.ts'
import { e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'

// Ödev ekranları (IST-095; docs/domain/akademik-olcme.md DOM-AKD-070…074) API'ye yazarak sınanır.
// Her test kendi kurumunu kurar (`tenant`): seed ile aynı kimlikler, ayrı kurum; öğretmen Selin Kaya
// (t1) 7-A (c1) Matematik'e atanmıştır, öğrenci Deniz Yılmaz (s1) 7-A'dadır. Kurumda başlangıçta
// ödev yoktur; kalıcılık her adımda `/api/v1/homework` ile doğrulanır.

const TEACHER_HOMEWORK = '/ogretmen/odevler'
const STUDENT_HOMEWORK = '/ogrenci/odevler'
const PARENT_HOMEWORK = '/veli/akademik-takip?sekme=odevler'

interface SubmissionView {
  id: string
  studentId: string
  note: string
  fileIds: string[]
  late: boolean
  score: number | null
  feedback: string
}

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

/** Kurulum: öğretmen 7-A Matematik'e üç gün sonra teslimli ödev verir (arayüzden geçmeden). */
async function assignHomework(teacher: ApiClient, title: string): Promise<HomeworkView> {
  const result = await teacher.post(
    '/api/v1/homework',
    {
      classId: 'c1',
      subjectId: 'math',
      title,
      description: 'Ders kitabı 42. sayfa.',
      dueDate: istanbulToUtc(istanbulDay(3, '17:00')),
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return (result.body as { data: HomeworkView }).data
}

async function submissionsOf(client: ApiClient, homeworkId: string): Promise<SubmissionView[]> {
  const result = await client.get(`/api/v1/homework/${homeworkId}`)
  expect(result.status).toBe(200)
  return (result.body as { data: { submissions: SubmissionView[] } }).data.submissions
}

/**
 * Dosya tarama işi (TODO(F3c2-scan)) yokken yüklenen dosya `pending` kalır; test kendi kurumunun
 * dosyalarını doğrudan `ready` yapar (taramadan geçmiş gibi).
 */
async function markFilesReady(institutionId: string): Promise<void> {
  const client = new pg.Client({ connectionString: e2e.databaseUrl })
  await client.connect()
  try {
    const result = await client.query(
      "update files set status = 'ready' where institution_id = $1 and status = 'pending'",
      [institutionId],
    )
    expect(result.rowCount).toBeGreaterThan(0)
  } finally {
    await client.end()
  }
}

const PDF = {
  name: 'cevaplar.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1'),
}

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

test.describe('Ödevler: öğrenci ve veli', () => {
  test('öğrenci notla ve dosyayla teslim eder; taranmamış dosya anlaşılır mesaj alır (DOM-AKD-072)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'ogrenci'] })
    const teacher = await api(school.user('ogretmen'))
    const homework = await assignHomework(teacher, 'Oran orantı çalışması')
    await loginAs(school.user('ogrenci'))

    await page.goto(STUDENT_HOMEWORK)
    const row = page.getByRole('table', { name: 'Ödevlerim' }).locator('tbody tr')
    await expect(row.filter({ hasText: homework.title })).toContainText('Bekliyor')
    await row.getByRole('button', { name: `${homework.title} ayrıntısını aç` }).click()
    const panel = panelOf(page, 'Ödev ayrıntısı')
    await expect(metric(panel, 'Teslim tarihi')).toHaveText('Henüz teslim edilmedi')

    // Boş teslim istemcide durur.
    const form = panel.getByRole('form', { name: 'Ödevi teslim et' })
    await form.getByRole('button', { name: 'Teslim et' }).click()
    await expect(form).toContainText('Teslim için açıklama yazın ya da dosya ekleyin.')

    await form.getByLabel('Açıklama').fill('Bütün soruları çözdüm.')
    await form.getByLabel('Dosya ekle').setInputFiles(PDF)
    const attached = form.getByRole('list', { name: 'Eklenen dosyalar' })
    await expect(attached.getByRole('listitem')).toHaveCount(1)
    await expect(attached).toContainText(PDF.name)

    // Dosya henüz taramada (`pending`): sunucu 422 `file_not_ready`, hiçbir kayıt yazılmaz.
    await form.getByRole('button', { name: 'Teslim et' }).click()
    await expect(form).toContainText('Dosyanız güvenlik taramasında, birazdan yeniden deneyin.')
    expect(await submissionsOf(teacher, homework.id)).toHaveLength(0)

    await markFilesReady(school.institutionId)
    await form.getByRole('button', { name: 'Teslim et' }).click()
    await expect(page.getByText('Ödev teslim edildi.')).toBeVisible()
    const [saved] = await submissionsOf(teacher, homework.id)
    expect(saved).toMatchObject({
      studentId: 's1',
      note: 'Bütün soruları çözdüm.',
      late: false,
      score: null,
    })
    expect(saved?.fileIds).toHaveLength(1)

    // Panel teslimi gösterir; puanlanmamış teslim yenilenebilir.
    await expect(panel.getByText('Teslim edildi', { exact: true })).toBeVisible()
    await expect(metric(panel, 'Teslim dosyası')).toHaveText(PDF.name)
    await expect(panel.getByRole('list', { name: 'Teslim dosyaları' })).toContainText(PDF.name)
    const again = panel.getByRole('form', { name: 'Ödevi teslim et' })
    await expect(again.getByLabel('Açıklama')).toHaveValue('Bütün soruları çözdüm.')
    await again.getByRole('button', { name: `${PDF.name} dosyasını kaldır` }).click()
    await again.getByLabel('Açıklama').fill('Dosyasız, yalnız açıklamayla.')
    await again.getByRole('button', { name: 'Teslimi güncelle' }).click()
    await expect(page.getByText('Teslimin güncellendi.')).toBeVisible()
    const [renewed] = await submissionsOf(teacher, homework.id)
    expect(renewed).toMatchObject({ id: saved?.id, note: 'Dosyasız, yalnız açıklamayla.' })
    expect(renewed?.fileIds).toHaveLength(0)
  })

  test('öğretmen puanlar; öğrenci puanı ve geri bildirimi kilitli teslimde, veli salt okur görür (DOM-AKD-073, DOM-AKD-074)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'ogrenci', 'veli'] })
    const teacher = await api(school.user('ogretmen'))
    const student = await api(school.user('ogrenci'))
    const homework = await assignHomework(teacher, 'Üslü sayılar')
    const submitted = await student.post(
      `/api/v1/homework/${homework.id}/submissions`,
      { note: 'Soruları defterime çözdüm.' },
      { 'idempotency-key': randomUUID() },
    )
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201)
    const feedback = 'Çözümler doğru; 7. soruda işlem sırasına dikkat.'

    // Öğretmen teslimi panelden değerlendirir.
    await loginAs(school.user('ogretmen'))
    await page.goto(`${TEACHER_HOMEWORK}?odev=${homework.id}`)
    const detail = panelOf(page, 'Ödev teslim durumu')
    await expect(metric(detail, 'Teslim eden')).toHaveText('1 / 1')
    await detail.getByRole('button', { name: 'Deniz Yılmaz teslimini değerlendir' }).click()
    const grade = panelOf(page, 'Teslimi değerlendir')
    await expect(grade).toContainText('Soruları defterime çözdüm.')
    await grade.getByLabel('Puan (0–100)').fill('85')
    await grade.getByLabel('Geri bildirim').fill(feedback)
    await grade.getByRole('button', { name: 'Değerlendir', exact: true }).click()
    await expect(page.getByText('Değerlendirme kaydedildi.')).toBeVisible()
    await expect(metric(panelOf(page, 'Ödev teslim durumu'), 'Değerlendirilen')).toHaveText('1')
    const [graded] = await submissionsOf(teacher, homework.id)
    expect(graded).toMatchObject({ score: 85, feedback })

    // Öğrenci: puan ve geri bildirim görünür, teslim kilitlidir (form yok).
    await loginAs(school.user('ogrenci'))
    await page.goto(`${STUDENT_HOMEWORK}?odev=${homework.id}`)
    const own = panelOf(page, 'Ödev ayrıntısı')
    await expect(metric(own, 'Not')).toHaveText('85')
    await expect(own.getByText('Değerlendirildi', { exact: true })).toBeVisible()
    await expect(own).toContainText(feedback)
    await expect(own).toContainText('değerlendirilmiş teslim değiştirilemez')
    await expect(own.getByRole('form', { name: 'Ödevi teslim et' })).toHaveCount(0)
    const graded409 = await student.post(
      `/api/v1/homework/${homework.id}/submissions`,
      { note: 'Değiştirmek istiyorum.' },
      { 'idempotency-key': randomUUID() },
    )
    expect(graded409.status).toBe(409)

    // Veli: listede durum ve puan, panelde geri bildirim; teslim formu ve düğmesi yok.
    await loginAs(school.user('veli'))
    await page.goto(`${PARENT_HOMEWORK}&cocuk=s1`)
    const row = page
      .getByRole('table', { name: 'Ödev durumu' })
      .locator('tbody tr')
      .filter({ hasText: homework.title })
    await expect(row).toContainText('Değerlendirildi')
    await expect(row).toContainText('85')
    await row.getByRole('button', { name: `${homework.title} ayrıntısını aç` }).click()
    const child = panelOf(page, 'Ödev ayrıntısı')
    await expect(metric(child, 'Not')).toHaveText('85')
    await expect(child).toContainText(feedback)
    await expect(child).toContainText('Soruları defterime çözdüm.')
    await expect(child.getByRole('form')).toHaveCount(0)
    await expect(child.getByRole('button', { name: /Teslim et|Teslimi güncelle/ })).toHaveCount(0)
  })
})
