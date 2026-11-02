import { randomUUID } from 'node:crypto'

import type { Locator, Page } from '@playwright/test'
import pg from 'pg'

import { apiRequest, type ApiClient } from './support/api.ts'
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

// --- OG-047 inceleme bulguları -----------------------------------------------

/** Başka bir kullanıcının (ya da sekmenin) ödevi güncellemesi: taze sürümle, arayüzden geçmeden. */
async function patchHomework(client: ApiClient, id: string, body: Record<string, unknown>) {
  const current = await client.get(`/api/v1/homework/${id}`)
  const version = (current.body as { data: HomeworkView }).data.version
  const result = await apiRequest(client.context, 'PATCH', `/api/v1/homework/${id}`, body, {
    'idempotency-key': randomUUID(),
    'if-match': `"${version}"`,
  })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
}

async function homeworkOf(client: ApiClient, id: string): Promise<HomeworkView> {
  const result = await client.get(`/api/v1/homework/${id}`)
  expect(result.status).toBe(200)
  return (result.body as { data: HomeworkView }).data
}

test.describe('Ödevler: eşzamanlı düzenleme ve yetki', () => {
  test('ayrı alanda başkasının değişikliği ezilmez, aynı alanda iki değer gösterilir, 409 girdiyi korur (DOM-AKD-071)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    const teacher = await api(school.user('ogretmen'))
    const homework = await assignHomework(teacher, 'Eşzamanlı düzenleme')
    await loginAs(school.user('ogretmen'))
    const editUrl = `${TEACHER_HOMEWORK}?odev-form=${homework.id}`
    const form = panelOf(page, 'Ödevi düzenle')

    // 1) Ayrı alan: B başlığı değiştirdi, A yalnız açıklamayı düzenledi; başlık B'de kalır.
    await page.goto(editUrl)
    await expect(form.getByLabel('Başlık')).toHaveValue(homework.title)
    await patchHomework(teacher, homework.id, { title: 'B başlığı' })
    await form.getByLabel('Açıklama').fill('A açıklaması')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Ödev güncellendi.')).toBeVisible()
    await expect(form).toHaveCount(0)
    expect(await homeworkOf(teacher, homework.id)).toMatchObject({
      title: 'B başlığı',
      description: 'A açıklaması',
    })

    // 2) Aynı alan: iki değer gösterilir, hiçbir şey gönderilmez; yeniden Kaydet onaydır.
    await page.goto(editUrl)
    await expect(form.getByLabel('Açıklama')).toHaveValue('A açıklaması')
    await form.getByLabel('Açıklama').fill('A ikinci açıklama')
    await patchHomework(teacher, homework.id, { description: 'B ikinci açıklama' })
    await form.getByRole('button', { name: 'Kaydet' }).click()
    const overlap = form.getByRole('alert').filter({ hasText: 'başkası tarafından da' })
    await expect(overlap).toContainText(
      'Açıklama: kayıtlı değer B ikinci açıklama, sizin girdiğiniz A ikinci açıklama',
    )
    await expect(form.getByLabel('Açıklama')).toHaveValue('A ikinci açıklama')
    expect((await homeworkOf(teacher, homework.id)).description).toBe('B ikinci açıklama')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toHaveCount(0)
    expect(await homeworkOf(teacher, homework.id)).toMatchObject({
      title: 'B başlığı',
      description: 'A ikinci açıklama',
    })

    // 3) Okuma ile yazma arasında değişiklik (gerçek 409): uyarı çıkar, girdi korunur, yeniden
    // kaydetmek başkasının geç teslim değişikliğini ezmeden yazar.
    await page.goto(editUrl)
    await expect(form.getByLabel('Başlık')).toHaveValue('B başlığı')
    await form.getByLabel('Başlık').fill('A başlığı')
    let raced = false
    await page.route(`**/api/v1/homework/${homework.id}`, async (route) => {
      if (route.request().method() === 'PATCH' && !raced) {
        raced = true
        await patchHomework(teacher, homework.id, { allowLate: false })
      }
      await route.continue()
    })
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      form.getByRole('alert').filter({ hasText: 'başka biri tarafından değişti' }),
    ).toBeVisible()
    await expect(form.getByLabel('Başlık')).toHaveValue('A başlığı')
    expect((await homeworkOf(teacher, homework.id)).title).toBe('B başlığı')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toHaveCount(0)
    expect(await homeworkOf(teacher, homework.id)).toMatchObject({
      title: 'A başlığı',
      allowLate: false,
    })
  })

  test('öğretmen başka öğretmenin ödevinde adresle form ya da puanlama açamaz (DOM-AKD-070, 071, 073)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'ogrenci'] })
    const admin = await api(school.user('yonetici'))
    const student = await api(school.user('ogrenci'))
    // 7-A Türkçe dersi Ahmet Yıldırım'a (t2) atanmıştır; yönetici ödevi onun adına verir.
    const created = await admin.post(
      '/api/v1/homework',
      {
        classId: 'c1',
        subjectId: 'turkish',
        title: 'Paragraf soruları',
        description: 'Deneme kitabı 10. sayfa.',
        dueDate: istanbulToUtc(istanbulDay(3, '17:00')),
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const homework = (created.body as { data: HomeworkView }).data
    expect(homework.teacherId).toBe('t2')
    const submitted = await student.post(
      `/api/v1/homework/${homework.id}/submissions`,
      { note: 'Çözdüm.' },
      { 'idempotency-key': randomUUID() },
    )
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201)
    const submissionId = (submitted.body as { data: { id: string } }).data.id

    await loginAs(school.user('ogretmen'))
    await page.goto(`${TEACHER_HOMEWORK}?odev-form=${homework.id}`)
    const edit = panelOf(page, 'Ödevi düzenle')
    await expect(edit).toContainText('Bu işlem için yetkiniz yok.')
    await expect(edit.getByRole('form')).toHaveCount(0)
    await expect(edit.getByLabel('Başlık')).toHaveCount(0)

    await page.goto(`${TEACHER_HOMEWORK}?odev=${homework.id}&teslim=${submissionId}`)
    const grade = panelOf(page, 'Teslimi değerlendir')
    await expect(grade).toContainText('Bu işlem için yetkiniz yok.')
    await expect(grade.getByRole('form')).toHaveCount(0)
    await expect(grade.getByLabel('Puan (0–100)')).toHaveCount(0)
    expect((await homeworkOf(admin, homework.id)).title).toBe('Paragraf soruları')
  })

  test('kirli ödev formu kapatılırken onay ister; devam etmek girdiyi korur (DOM-AKD-070)', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    await loginAs(school.user('ogretmen'))
    await page.goto(TEACHER_HOMEWORK)
    await page.getByRole('button', { name: 'Ödev ver', exact: true }).click()
    const form = panelOf(page, 'Ödev ver')
    await form.getByLabel('Başlık').fill('Yarım kalan ödev')
    await form.getByRole('button', { name: 'Vazgeç' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Kaydedilmemiş değişiklikler var' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Düzenlemeye devam et' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(form.getByLabel('Başlık')).toHaveValue('Yarım kalan ödev')
    await form.getByRole('button', { name: 'Vazgeç' }).click()
    await page
      .getByRole('alertdialog', { name: 'Kaydedilmemiş değişiklikler var' })
      .getByRole('button', { name: 'Değişiklikleri at' })
      .click()
    await expect(panelOf(page, 'Ödev ver')).toHaveCount(0)
  })
})

test.describe('Ödevler: öğrenci teslim formu', () => {
  test('en çok 5 dosya eklenir, aynı dosya yinelenmez, fazlası tek uyarıyla bildirilir (DOM-AKD-072)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'ogrenci'] })
    const teacher = await api(school.user('ogretmen'))
    const homework = await assignHomework(teacher, 'Dosya sınırı')
    await loginAs(school.user('ogrenci'))
    await page.goto(`${STUDENT_HOMEWORK}?odev=${homework.id}`)
    const form = panelOf(page, 'Ödev ayrıntısı').getByRole('form', { name: 'Ödevi teslim et' })
    const attached = form.getByRole('list', { name: 'Eklenen dosyalar' })
    const picker = form.getByLabel('Dosya ekle')
    const file = (name: string) => ({
      name,
      mimeType: PDF.mimeType,
      buffer: Buffer.from(`${PDF.buffer.toString('latin1')}% ${name}\n`, 'latin1'),
    })

    // Aynı dosya iki kez seçilirse bir kez eklenir.
    await picker.setInputFiles([file('a.pdf'), file('a.pdf')])
    await expect(attached.getByRole('listitem')).toHaveCount(1)
    await expect(form.getByText('Dosya yükleniyor…')).toHaveCount(0)

    // Dört yer kalmışken beş dosya seçilir: dördü eklenir, fazlası tek uyarıyla bildirilir.
    await picker.setInputFiles([
      file('b.pdf'),
      file('c.pdf'),
      file('d.pdf'),
      file('e.pdf'),
      file('f.pdf'),
    ])
    await expect(attached.getByRole('listitem')).toHaveCount(5)
    await expect(form).toContainText('En fazla 5 dosya ekleyebilirsiniz; 1 dosya eklenmedi.')
    await expect(picker).toBeDisabled()

    // Kaldırınca yeniden yer açılır.
    await attached.getByRole('button', { name: 'a.pdf dosyasını kaldır' }).click()
    await expect(attached.getByRole('listitem')).toHaveCount(4)
    await expect(picker).toBeEnabled()
  })

  test('yazarken son teslim geçse de form sökülmez; kararı sunucu verir (DOM-AKD-072)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'ogrenci'] })
    const teacher = await api(school.user('ogretmen'))
    const homework = await assignHomework(teacher, 'Süre dolarken yazılan ödev')
    await patchHomework(teacher, homework.id, { allowLate: false })
    await page.clock.install()
    await loginAs(school.user('ogrenci'))
    await page.goto(`${STUDENT_HOMEWORK}?odev=${homework.id}`)
    const panel = panelOf(page, 'Ödev ayrıntısı')
    const form = panel.getByRole('form', { name: 'Ödevi teslim et' })
    await form.getByLabel('Açıklama').fill('Yarım yazdığım cevap.')

    // İstemci saati son teslimi geçti (sunucu saati geçmedi): form yerinde kalır, uyarı görünür.
    await page.clock.fastForward(96 * 3_600_000)
    await expect(form.getByRole('alert').filter({ hasText: 'Teslim süresi doldu' })).toBeVisible()
    await expect(form.getByLabel('Açıklama')).toHaveValue('Yarım yazdığım cevap.')

    // Karar sunucudadır: süre gerçekte dolmadığı için teslim kabul edilir.
    await form.getByRole('button', { name: 'Teslim et' }).click()
    await expect(page.getByText('Ödev teslim edildi.')).toBeVisible()
    const [saved] = await submissionsOf(teacher, homework.id)
    expect(saved).toMatchObject({ note: 'Yarım yazdığım cevap.' })
  })
})
