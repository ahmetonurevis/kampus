import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant, TenantOptions } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Öğretmenime Sor (öğrenci `soru-sor`) ve Soru Kuyruğu (öğretmen `sorular`): okuma ve yazma
// (DOM-ILT-090…093). Yazma uçları `POST /questions`, `POST /questions/:id/answers`,
// `PATCH /questions/:id`. Öğrenci Deniz (s1, 7-A) matematik sorusunu dersin öğretmeni Selin
// Kaya'ya (t1) sorar. Her test kendi kurumunu kurar ve soruları API ile hazırlar (kurulum UI'dan
// yapılmaz); soru tablosu bilerek boştur.

const STUDENT_TABLE = 'Sorularım'
const TEACHER_TABLE = 'Gelen sorular'
const TEXT = 'Üçgenin alanını bulurken yüksekliği hangi kenara göre alacağız?'
const ANSWER = 'Yüksekliği seçtiğiniz tabana dik olacak biçimde alın.'
const REASSIGNED = 'Bu sınıfın dersine artık girmediğiniz için ek yanıt yazamazsınız.'

type Make = (options: TenantOptions) => Promise<Tenant>

/** Beş rollü kendi kurumu; ders öğretmeni t1, yedek matematik öğretmeni ek kayıttır. */
const questionTenant = (tenant: Make) =>
  tenant({
    roles: ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'],
    records: [
      {
        collection: 'teachers',
        data: {
          id: 'e2e-t-math2',
          name: 'Mert Özkan',
          subjectId: 'math',
          subject: 'Matematik',
          branchId: 'b1',
          email: 'e2e-mert.ozkan@kampus.example',
          phone: '05551000099',
          attendanceRate: 100,
          homeworkRate: 100,
          isActive: true,
          deletedAt: null,
        },
      },
    ],
  })

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const titleButton = (page: Page, title: string) =>
  page.getByRole('button', { name: `${title} sorusunu aç` })
const withTitle = (page: Page, table: string, title: string) =>
  page.getByRole('table', { name: table }).getByRole('row').filter({ hasText: title })

interface QuestionItem {
  id: string
  version: number
  record: {
    title: string
    topic?: string
    teacherId: string
    answer: string
    answeredAt: string | null
    withdrawnAt?: string
    followUps?: { text: string }[]
  }
}

async function questionById(client: ApiClient, id: string): Promise<QuestionItem> {
  const list = await client.get('/api/v1/collections/questions?pageSize=100')
  expect(list.status).toBe(200)
  const item = (list.body as { data: QuestionItem[] }).data.find((row) => row.id === id)
  expect(item, id).toBeDefined()
  return item as QuestionItem
}

async function questionTitled(client: ApiClient, title: string): Promise<QuestionItem> {
  const list = await client.get('/api/v1/collections/questions?pageSize=100')
  const item = (list.body as { data: QuestionItem[] }).data.find(
    (row) => row.record.title === title,
  )
  expect(item, title).toBeDefined()
  return item as QuestionItem
}

/** Öğrenci adına soru gönderir; yeni sorunun kimliğini döndürür. */
async function ask(student: ApiClient, title: string): Promise<string> {
  const result = await student.post(
    '/api/v1/questions',
    { subjectId: 'math', teacherId: 't1', title, text: TEXT },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status).toBe(201)
  return (result.body as { data: { entity: { id: string } } }).data.entity.id
}

/** Öğretmen adına yanıt veya ek yanıt yazar (soru sürümü `If-Match` olarak gider). */
async function answer(teacher: ApiClient, id: string, text: string) {
  const current = await questionById(teacher, id)
  const response = await teacher.context.post(`/api/v1/questions/${id}/answers`, {
    data: { text },
    headers: { 'idempotency-key': randomUUID(), 'if-match': `"${current.version}"` },
  })
  expect(response.status()).toBe(201)
}

test.describe('soru gönderme ve yanıtlama', () => {
  test('öğrenci soru gönderir; öğretmen kuyrukta görür ve yanıtlar; öğrenci yanıtı görür (DOM-ILT-090, DOM-ILT-092)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await questionTenant(tenant)
    const title = 'E2E üçgenlerde alan'

    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/soru-sor')
    await expect(page.getByRole('heading', { name: 'Öğretmenime Sor', level: 1 })).toBeVisible()
    await expect(page.getByText('Henüz soru sormadınız.')).toBeVisible()
    await page.getByRole('button', { name: 'Yeni soru' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni soru' })
    // DOM-ILT-014: özel nitelikli bilgi uyarısı formda görünür.
    await expect(
      form.getByText(/Sağlık durumu, ilaç veya ailenize ait özel bilgileri/),
    ).toBeVisible()

    // Ders seçenekleri yalnız kendi sınıfının dersleridir; öğretmen dersten çözülür.
    const subjects = form.getByLabel('Ders').locator('option')
    await expect(subjects).toContainText(['Ders seçin', 'Matematik'])
    await expect(subjects.filter({ hasText: 'Müzik' })).toHaveCount(1)
    await form.getByRole('button', { name: 'Soruyu gönder' }).click()
    await expect(form.getByText('Bir ders seçin.')).toBeVisible()
    await expect(form.getByText('Konu başlığını yazın.')).toBeVisible()
    await expect(form.getByText('Sorunuzu en az 10 karakterle açıklayın.')).toBeVisible()
    await expect(toast(page, /./)).toHaveCount(0)

    await form.getByLabel('Ders').selectOption({ label: 'Matematik' })
    await expect(form.getByLabel('Öğretmen')).toHaveValue('t1')
    await expect(form.getByLabel('Öğretmen').locator('option:checked')).toHaveText('Selin Kaya')
    await form.getByLabel('Kazanım (isteğe bağlı)').selectOption('Geometri')
    await form.getByLabel('Konu başlığı').fill(title)
    await form.getByLabel('Sorunuz').fill(TEXT)
    await form.getByRole('button', { name: 'Soruyu gönder' }).click()
    await expect(toast(page, 'Sorunuz öğretmeninize iletildi.')).toBeVisible()
    await expect(form).toBeHidden()
    await expect(titleButton(page, title)).toBeVisible()
    await expect(withTitle(page, STUDENT_TABLE, title)).toContainText('Yanıt bekliyor')
    await expect(withTitle(page, STUDENT_TABLE, title)).toContainText('Selin Kaya')

    const student = await api(school.user('ogrenci'))
    const created = await questionTitled(student, title)
    expect(created.record).toMatchObject({ teacherId: 't1', topic: 'Geometri', answer: '' })

    // Öğretmen: kuyrukta bekleyen olarak görür ve yanıtlar.
    await page.context().clearCookies()
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/sorular')
    await expect(page.getByRole('heading', { name: 'Soru Kuyruğu', level: 1 })).toBeVisible()
    await expect(withTitle(page, TEACHER_TABLE, title)).toContainText('Deniz Yılmaz')
    await expect(withTitle(page, TEACHER_TABLE, title)).toContainText('Yanıt bekliyor')
    await expect(page.getByText('1 soru · 1 yanıt bekliyor')).toBeVisible()
    await titleButton(page, title).click()
    const panel = page.getByRole('dialog', { name: 'Soru ayrıntısı' })
    await expect(panel.getByText(TEXT)).toBeVisible()
    await expect(panel.getByText('Geometri')).toBeVisible()
    const reply = panel.getByRole('form', { name: 'Soruyu yanıtla' })
    await reply.getByRole('button', { name: 'Yanıtı gönder' }).click()
    await expect(reply.getByText('Yanıtı yazın.')).toBeVisible()
    await reply.getByLabel('Yanıtınız').fill(ANSWER)
    await reply.getByRole('button', { name: 'Yanıtı gönder' }).click()
    await expect(toast(page, 'Yanıtınız öğrenciye iletildi.')).toBeVisible()
    await expect(panel.getByText(ANSWER)).toBeVisible()
    await expect(panel.getByText('Yanıtlandı', { exact: true })).toBeVisible()
    await expect(panel.getByRole('form', { name: 'Ek yanıt yaz' })).toBeVisible()
    await expect(page.getByText('1 soru · 0 yanıt bekliyor')).toBeVisible()

    const teacher = await api(school.user('ogretmen'))
    expect((await questionById(teacher, created.id)).record).toMatchObject({ answer: ANSWER })

    // Öğrenci yanıtı görür; yanıtlanmış soru geri çekilemez.
    await page.context().clearCookies()
    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/soru-sor')
    await expect(withTitle(page, STUDENT_TABLE, title)).toContainText('Yanıtlandı')
    await expect(withTitle(page, STUDENT_TABLE, title)).toContainText(ANSWER)
    await titleButton(page, title).click()
    const detail = page.getByRole('dialog', { name: 'Soru ayrıntısı' })
    await expect(detail.getByText(ANSWER)).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Soruyu geri çek' })).toHaveCount(0)
  })

  test('öğrenci yanıtsız soruyu onayla geri çeker; geri çekilen soru bekleyenlerde görünmez (DOM-ILT-091)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await questionTenant(tenant)
    const student = await api(school.user('ogrenci'))
    const title = 'E2E geri çekilecek soru'
    const id = await ask(student, title)
    const waiting = 'E2E bekleyen soru'
    await ask(student, waiting)

    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/soru-sor')
    await titleButton(page, title).click()
    const panel = page.getByRole('dialog', { name: 'Soru ayrıntısı' })
    await panel.getByRole('button', { name: 'Soruyu geri çek' }).click()
    // Onay sorulur; vazgeçince soru yerinde kalır.
    const confirm = page.getByRole('dialog', { name: 'Soruyu geri çek' })
    await expect(confirm.getByText(/Bu işlem geri alınamaz/)).toBeVisible()
    await confirm.getByRole('button', { name: 'Vazgeç' }).click()
    await expect(confirm).toBeHidden()
    expect((await questionById(student, id)).record.withdrawnAt).toBeUndefined()

    await panel.getByRole('button', { name: 'Soruyu geri çek' }).click()
    await page
      .getByRole('dialog', { name: 'Soruyu geri çek' })
      .getByRole('button', { name: 'Evet, geri çek' })
      .click()
    await expect(toast(page, 'Soru geri çekildi.')).toBeVisible()
    await expect(panel.getByText('Geri çekildi', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Soruyu geri çek' })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Pencereyi kapat' }).click()
    await expect(withTitle(page, STUDENT_TABLE, title)).toContainText('Geri çekildi')
    expect((await questionById(student, id)).record.withdrawnAt).toBeTruthy()

    // Öğretmen: geri çekilen soru bekleyenlerde değildir, yanıt yazılamaz.
    await page.context().clearCookies()
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/sorular')
    await expect(withTitle(page, TEACHER_TABLE, title)).toContainText('Geri çekildi')
    await expect(page.getByText('2 soru · 1 yanıt bekliyor')).toBeVisible()
    await page.getByRole('button', { name: 'Filtreler' }).click()
    await page.getByLabel('Durum', { exact: true }).selectOption('Yanıt bekliyor')
    await expect(titleButton(page, waiting)).toBeVisible()
    await expect(titleButton(page, title)).toHaveCount(0)
    await page.getByLabel('Durum', { exact: true }).selectOption('Geri çekildi')
    await expect(titleButton(page, waiting)).toHaveCount(0)
    await titleButton(page, title).click()
    const detail = page.getByRole('dialog', { name: 'Soru ayrıntısı' })
    await expect(detail.getByText('Öğrenci bu soruyu geri çekti; yanıt yazılamaz.')).toBeVisible()
    await expect(detail.getByRole('form')).toHaveCount(0)

    // Sunucu da yanıtı reddeder (409 question_withdrawn); soru değişmez.
    const teacher = await api(school.user('ogretmen'))
    const current = await questionById(teacher, id)
    const rejected = await teacher.context.post(`/api/v1/questions/${id}/answers`, {
      data: { text: ANSWER },
      headers: { 'idempotency-key': randomUUID(), 'if-match': `"${current.version}"` },
    })
    expect(rejected.status()).toBe(409)
    expect((await questionById(teacher, id)).version).toBe(current.version)
  })

  test('ek yanıt yazılır; verilen yanıt değişmez ve düzenleme düğmesi yoktur (DOM-ILT-092)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await questionTenant(tenant)
    const student = await api(school.user('ogrenci'))
    const teacher = await api(school.user('ogretmen'))
    const title = 'E2E ek yanıt sorusu'
    const id = await ask(student, title)
    await answer(teacher, id, ANSWER)
    const followUp = 'Ek not: yüksekliği çizerken cetvel kullanın.'

    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/sorular?soru=${id}`)
    const panel = page.getByRole('dialog', { name: 'Soru ayrıntısı' })
    await expect(panel.getByText(ANSWER)).toBeVisible()
    await expect(panel.getByRole('button', { name: /düzenle|değiştir/i })).toHaveCount(0)
    const form = panel.getByRole('form', { name: 'Ek yanıt yaz' })
    await form.getByLabel('Ek yanıt').fill(followUp)
    await form.getByRole('button', { name: 'Ek yanıtı gönder' }).click()
    await expect(toast(page, 'Ek yanıtınız gönderildi.')).toBeVisible()
    await expect(panel.getByText(followUp)).toBeVisible()
    await expect(form.getByLabel('Ek yanıt')).toHaveValue('')

    const saved = (await questionById(teacher, id)).record
    expect(saved.answer).toBe(ANSWER)
    expect(saved.followUps?.map((entry) => entry.text)).toEqual([followUp])

    // Öğrenci yanıtı ve ek yanıtı sırayla görür.
    await page.context().clearCookies()
    await loginAs(school.user('ogrenci'))
    await page.goto(`/ogrenci/soru-sor?soru=${id}`)
    const detail = page.getByRole('dialog', { name: 'Soru ayrıntısı' })
    await expect(detail.getByText(ANSWER)).toBeVisible()
    await expect(detail.getByText(followUp)).toBeVisible()
    await expect(detail.getByRole('listitem').filter({ hasText: 'Ek yanıt' })).toHaveCount(1)
  })

  test('dersten alınan öğretmen ek yanıt yazamaz; Türkçe mesaj görünür, yanıt kaydedilmez (DOM-ILT-092)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await questionTenant(tenant)
    const student = await api(school.user('ogrenci'))
    const teacher = await api(school.user('ogretmen'))
    const admin = await api(school.user('yonetici'))
    const id = await ask(student, 'E2E devredilen ders sorusu')
    await answer(teacher, id, ANSWER)

    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/sorular?soru=${id}`)
    const form = page
      .getByRole('dialog', { name: 'Soru ayrıntısı' })
      .getByRole('form', { name: 'Ek yanıt yaz' })
    await expect(form).toBeVisible()

    // Form açıkken yönetici matematik dersini başka öğretmene verir.
    const classes = await admin.get('/api/v1/collections/classes/c1')
    const version = (classes.body as { data: { version: number } }).data.version
    const moved = await admin.context.patch('/api/v1/classes/c1', {
      data: { subjectTeachers: { math: 'e2e-t-math2' } },
      headers: { 'idempotency-key': randomUUID(), 'if-match': `"${version}"` },
    })
    expect(moved.status()).toBe(200)

    await form.getByLabel('Ek yanıt').fill('Bu ek yanıt kaydedilmemeli.')
    await form.getByRole('button', { name: 'Ek yanıtı gönder' }).click()
    await expect(toast(page, REASSIGNED)).toBeVisible()
    // Hata tek yerde görünür: alan altında ikinci bir kopyası yoktur; yazılan metin korunur.
    await expect(page.getByText(REASSIGNED)).toHaveCount(1)
    await expect(form.getByLabel('Ek yanıt')).toHaveValue('Bu ek yanıt kaydedilmemeli.')
    expect((await questionById(teacher, id)).record.followUps ?? []).toHaveLength(0)
  })

  test('başka biri soruyu değiştirdiyse Türkçe uyarı çıkar, yazılan yanıt korunur', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await questionTenant(tenant)
    const student = await api(school.user('ogrenci'))
    const id = await ask(student, 'E2E çakışan soru')

    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/sorular?soru=${id}`)
    const panel = page.getByRole('dialog', { name: 'Soru ayrıntısı' })
    const form = panel.getByRole('form', { name: 'Soruyu yanıtla' })
    await form.getByLabel('Yanıtınız').fill('Bu yanıt çakışmaya düşecek.')

    // Form açıkken öğrenci soruyu geri çeker (sürüm değişir).
    const current = await questionById(student, id)
    const withdrawn = await student.context.patch(`/api/v1/questions/${id}`, {
      data: { withdrawn: true },
      headers: { 'idempotency-key': randomUUID(), 'if-match': `"${current.version}"` },
    })
    expect(withdrawn.status()).toBe(200)

    await form.getByRole('button', { name: 'Yanıtı gönder' }).click()
    await expect(
      toast(page, 'Soru bu arada güncellendi. Güncel hâlini yükleyip yeniden deneyin.'),
    ).toBeVisible()
    await expect(panel.getByText('Öğrenci bu soruyu geri çekti; yanıt yazılamaz.')).toBeVisible()
    expect((await questionById(student, id)).record.answer).toBe('')
  })
})

test.describe('soru formu doğrulaması', () => {
  test('boş veya çok uzun metinde alan hatası çıkar, toast çıkmaz ve istek atılmaz', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await questionTenant(tenant)
    const student = await api(school.user('ogrenci'))
    const id = await ask(student, 'E2E doğrulama sorusu')
    const before = await questionById(student, id)

    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/soru-sor')
    await page.getByRole('button', { name: 'Yeni soru' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni soru' })
    await form.getByLabel('Ders').selectOption({ label: 'Matematik' })
    await form.getByLabel('Konu başlığı').fill('b'.repeat(121))
    await form.getByLabel('Sorunuz').fill('c'.repeat(2001))
    await form.getByRole('button', { name: 'Soruyu gönder' }).click()
    await expect(form.getByText('Konu başlığı en fazla 120 karakter olabilir.')).toBeVisible()
    await expect(form.getByText('En fazla 2000 karakter yazabilirsiniz.')).toBeVisible()
    await expect(toast(page, /./)).toHaveCount(0)
    await form.getByLabel('Sorunuz').fill('kısa')
    await form.getByRole('button', { name: 'Soruyu gönder' }).click()
    await expect(form.getByText('Sorunuzu en az 10 karakterle açıklayın.')).toBeVisible()
    await expect(toast(page, /./)).toHaveCount(0)
    const list = await student.get('/api/v1/collections/questions?pageSize=100')
    expect((list.body as { data: unknown[] }).data).toHaveLength(1)

    // Öğretmen yanıt formu: boş ve 2000 karakteri aşan yanıt alan hatasıdır.
    await page.context().clearCookies()
    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/sorular?soru=${id}`)
    const reply = page
      .getByRole('dialog', { name: 'Soru ayrıntısı' })
      .getByRole('form', { name: 'Soruyu yanıtla' })
    await reply.getByRole('button', { name: 'Yanıtı gönder' }).click()
    await expect(reply.getByText('Yanıtı yazın.')).toBeVisible()
    await reply.getByLabel('Yanıtınız').fill('d'.repeat(2001))
    await reply.getByRole('button', { name: 'Yanıtı gönder' }).click()
    await expect(reply.getByText('En fazla 2000 karakter yazabilirsiniz.')).toBeVisible()
    await expect(toast(page, /./)).toHaveCount(0)
    const teacher = await api(school.user('ogretmen'))
    expect((await questionById(teacher, id)).version).toBe(before.version)
  })
})

test.describe('rol kapsamı', () => {
  test('veli ve ön büro menüde soru ekranı görmez; doğrudan adres kapalı, yazma uçları 403', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await questionTenant(tenant)
    const student = await api(school.user('ogrenci'))
    const id = await ask(student, 'E2E kapsam sorusu')

    for (const role of ['veli', 'onburo'] as const) {
      await page.context().clearCookies()
      await loginAs(school.user(role))
      await page.goto(`/${role}/dashboard`)
      const menu = page.getByRole('navigation', { name: 'Menü' })
      await expect(menu).toBeVisible()
      await expect(menu.getByRole('link', { name: /Öğretmenime Sor|Soru Kuyruğu/ })).toHaveCount(0)
      for (const path of ['ogrenci/soru-sor', 'ogretmen/sorular']) {
        await page.goto(`/${path}`)
        await expect(page).toHaveURL(new RegExp(`/${role}/dashboard(\\?.*)?$`))
      }
      await page.goto(`/${role}/soru-sor`)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Bu sayfa kampüste bulunamadı.' }),
      ).toBeVisible()

      const client = await api(school.user(role))
      const ask = await client.post(
        '/api/v1/questions',
        { subjectId: 'math', teacherId: 't1', title: 'Yetkisiz soru', text: TEXT },
        { 'idempotency-key': randomUUID() },
      )
      expect(ask.status).toBe(403)
      const withdrawn = await client.context.patch(`/api/v1/questions/${id}`, {
        data: { withdrawn: true },
        headers: { 'idempotency-key': randomUUID(), 'if-match': '"1"' },
      })
      expect(withdrawn.status()).toBe(403)
    }
    // Ön büro soru kayıtlarını okuyamaz; soru değişmemiştir.
    const frontOffice = await api(school.user('onburo'))
    expect((await frontOffice.get('/api/v1/collections/questions')).status).toBe(403)
    expect((await questionById(student, id)).record.withdrawnAt).toBeUndefined()
  })

  test('öğrenci yalnız kendi, öğretmen yalnız kendisine atanan soruları okur; kapsam dışı kayıt 404 (DOM-ILT-093)', async ({
    api,
    tenant,
  }) => {
    // Seed soruları s1 (Deniz) ve s2 (Ece) için kurumda vardır; öğretmen t1, ders atamasına göre.
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'],
      collections: ['questions'],
      records: [
        {
          collection: 'questions',
          data: {
            id: 'e2e-q-turkish',
            studentId: 's1',
            teacherId: 't2',
            subjectId: 'turkish',
            title: 'Türkçe sorusu',
            text: 'Paragrafta ana fikir nasıl bulunur?',
            createdAt: '2026-10-29T08:00:00.000Z',
            answeredAt: null,
            answer: '',
            fileName: null,
          },
        },
      ],
    })
    const admin = await api(school.user('yonetici'))
    const all = (
      (await admin.get('/api/v1/collections/questions?pageSize=100')).body as {
        data: (QuestionItem & { record: { studentId: string } })[]
      }
    ).data
    const others = all.find((item) => item.record.studentId === 's2')
    const foreignTeacher = all.find(
      (item) => item.record.studentId === 's1' && item.record.teacherId !== 't1',
    )
    const own = all.find((item) => item.record.studentId === 's1' && item.record.teacherId === 't1')
    expect(others, 's2 sorusu').toBeDefined()
    expect(foreignTeacher, 'başka öğretmenin sorusu').toBeDefined()
    expect(own, 't1 sorusu').toBeDefined()

    const student = await api(school.user('ogrenci'))
    const mine = (await student.get('/api/v1/collections/questions?pageSize=100')).body as {
      data: { record: { studentId: string } }[]
    }
    expect(mine.data.length).toBeGreaterThan(0)
    expect(mine.data.every((item) => item.record.studentId === 's1')).toBe(true)
    expect((await student.get(`/api/v1/collections/questions/${others?.id}`)).status).toBe(404)

    const teacher = await api(school.user('ogretmen'))
    const queue = (await teacher.get('/api/v1/collections/questions?pageSize=100')).body as {
      data: { record: { teacherId: string } }[]
    }
    expect(queue.data.length).toBeGreaterThan(0)
    expect(queue.data.every((item) => item.record.teacherId === 't1')).toBe(true)
    expect((await teacher.get(`/api/v1/collections/questions/${own?.id}`)).status).toBe(200)
    expect((await teacher.get(`/api/v1/collections/questions/${foreignTeacher?.id}`)).status).toBe(
      404,
    )
    // Başka öğretmenin sorusuna yanıt da 404'tür ve soru değişmez.
    const rejected = await teacher.context.post(`/api/v1/questions/${foreignTeacher?.id}/answers`, {
      data: { text: ANSWER },
      headers: { 'idempotency-key': randomUUID(), 'if-match': `"${foreignTeacher?.version}"` },
    })
    expect(rejected.status()).toBe(404)
    expect((await questionById(admin, foreignTeacher?.id ?? '')).version).toBe(
      foreignTeacher?.version,
    )
  })
})

test.describe('dar ekran', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('öğrenci ve öğretmen soru sayfaları, panel ve form yatay taşmaz', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await questionTenant(tenant)
    const student = await api(school.user('ogrenci'))
    const title = 'E2E dar ekran sorusu'
    const id = await ask(student, title)

    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/soru-sor')
    await expect(page.getByText(title).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByText(title).first().click()
    await expect(page.getByRole('dialog', { name: 'Soru ayrıntısı' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.goto('/ogrenci/soru-sor?soru-form=yeni')
    await expect(page.getByRole('dialog', { name: 'Yeni soru' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.context().clearCookies()
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/sorular')
    await expect(page.getByText(title).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.goto(`/ogretmen/sorular?soru=${id}`)
    await expect(
      page.getByRole('dialog', { name: 'Soru ayrıntısı' }).getByRole('form', {
        name: 'Soruyu yanıtla',
      }),
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
