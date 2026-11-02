import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import { apiRequest, type ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Quiz ekranları (IST-095; docs/domain/akademik-olcme.md DOM-AKD-075…079) API'ye yazarak sınanır.
// Her test kendi kurumunu kurar (`tenant`): seed ile aynı kimlikler, ayrı kurum; kurumda başlangıçta
// quiz yoktur, soru bankası vardır (`collections: ['bank']`). Öğretmen Selin Kaya (t1) 7-A (c1)
// Matematik'e atanmıştır, 7-A Türkçe'si Ahmet Yıldırım'a (t2), öğrenci Deniz Yılmaz (s1) 7-A'dadır.
// Kalıcılık her adımda `/api/v1/quizzes` ile doğrulanır.

const TEACHER_QUIZZES = '/ogretmen/quiz-olustur'

interface QuizView {
  id: string
  version: number
  classId: string
  subjectId: string
  teacherId: string
  title: string
  duration: number
  dueDate: string | null
  questionIds: string[]
  questionCount: number
  status: 'open' | 'closed'
}

const panelOf = (page: Page, name: string) => page.getByRole('dialog', { name })
const bodyRows = (page: Page) =>
  page.getByRole('table', { name: 'Quiz listesi' }).locator('tbody tr')

async function quizzesOf(client: ApiClient, query = ''): Promise<QuizView[]> {
  const result = await client.get(`/api/v1/quizzes?pageSize=100${query}`)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return (result.body as { data: QuizView[] }).data
}

/** Kurulum: quizi arayüzden geçmeden hazırlar (başlıkta bankanın ilk üç matematik sorusu). */
async function prepareQuiz(
  client: ApiClient,
  title: string,
  classId = 'c1',
  questionIds = ['q-math-7-0', 'q-math-7-1', 'q-math-7-2'],
  subjectId = 'math',
): Promise<QuizView> {
  const result = await client.post(
    '/api/v1/quizzes',
    { classId, subjectId, title, duration: 15, questionIds },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return (result.body as { data: QuizView }).data
}

/** Bankadaki sorunun metni (formda onay kutusunun etiketi). */
async function questionText(client: ApiClient, id: string): Promise<string> {
  const result = await client.get(`/api/v1/collections/bank/${id}`)
  expect(result.status, id).toBe(200)
  return (result.body as { data: { record: { text: string } } }).data.record.text
}

test.describe('Quizler: öğretmen', () => {
  test('bankadan soru seçip quiz hazırlar; yalnız değişen alanı gönderir ve arşivler (DOM-AKD-075, DOM-AKD-076)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], collections: ['bank'] })
    const teacher = await api(school.user('ogretmen'))
    await loginAs(school.user('ogretmen'))
    const title = 'Rasyonel sayılar kısa sınavı'
    const picked = ['q-math-7-0', 'q-math-7-2']
    const texts = await Promise.all(picked.map((id) => questionText(teacher, id)))

    await page.goto(TEACHER_QUIZZES)
    await expect(page.getByText('0 quiz ·')).toBeVisible()
    await page.getByRole('button', { name: 'Quiz hazırla', exact: true }).click()
    const form = panelOf(page, 'Quiz hazırla')
    await form.getByLabel('Sınıf', { exact: true }).selectOption({ label: '7-A' })
    // Tek ders ataması olan sınıfta ders kendiliğinden seçilir.
    await expect(form.getByLabel('Ders', { exact: true })).toHaveValue('math')
    await form.getByLabel('Başlık').fill(title)
    await form.getByLabel('Süre (dakika)').fill('12')

    // Soru seçilmeden gönderim istemcide durur; sunucuya hiçbir şey gitmez.
    await form.getByRole('button', { name: 'Quizi hazırla' }).click()
    await expect(form.getByRole('alert')).toBeVisible()
    expect(await quizzesOf(teacher)).toHaveLength(0)

    for (const text of texts) await form.getByRole('checkbox', { name: text }).check()
    await expect(form).toContainText('2 / 50 soru seçili')
    await form.getByRole('button', { name: 'Quizi hazırla' }).click()
    await expect(page.getByText('Quiz hazırlandı.')).toBeVisible()
    await expect(panelOf(page, 'Quiz hazırla')).toHaveCount(0)

    const [created] = await quizzesOf(teacher)
    expect(created).toMatchObject({
      classId: 'c1',
      subjectId: 'math',
      teacherId: 't1',
      title,
      duration: 12,
      dueDate: null,
      questionIds: picked,
      status: 'open',
    })
    if (!created) return

    const row = bodyRows(page).filter({ hasText: title })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('7-A')
    await expect(row).toContainText('Açık')
    await expect(row.locator('td:nth-child(4)')).toHaveText('2')
    await row.getByRole('button', { name: `${title} sonuçlarını aç` }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]quiz=${created.id}`))
    const detail = panelOf(page, 'Quiz sonuçları')
    await expect(detail).toContainText(title)
    // Cevap anahtarı yalnız personele açılır.
    await expect(detail.getByRole('list', { name: 'Quiz soruları' })).toContainText('Doğru:')

    // Düzenle: yalnız başlık değişir; istekte yalnız o alan gider, sorular ve süre korunur.
    await detail.getByRole('button', { name: 'Düzenle' }).click()
    const edit = panelOf(page, 'Quizi düzenle')
    await expect(edit.getByLabel('Sınıf', { exact: true })).toBeDisabled()
    await expect(edit.getByLabel('Başlık')).toHaveValue(title)
    await expect(edit.getByLabel('Süre (dakika)')).toHaveValue('12')
    for (const text of texts) await expect(edit.getByRole('checkbox', { name: text })).toBeChecked()
    // Değişiklik yapmadan kaydetmek gönderim yapmaz.
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(edit).toContainText('Değişiklik yapmadınız.')
    expect((await quizzesOf(teacher))[0]?.version).toBe(created.version)

    const renamed = `${title} (gözden geçirilmiş)`
    await edit.getByLabel('Başlık').fill(renamed)
    const sent = page.waitForRequest(
      (request) => request.method() === 'PATCH' && request.url().endsWith(`/quizzes/${created.id}`),
    )
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    expect((await sent).postDataJSON()).toEqual({ title: renamed })
    await expect(page.getByText('Quiz güncellendi.')).toBeVisible()
    const [saved] = await quizzesOf(teacher)
    expect(saved).toMatchObject({
      id: created.id,
      version: created.version + 1,
      title: renamed,
      duration: 12,
      questionIds: picked,
    })

    // Arama başlıkta aksan ve harf duyarsızdır; ikinci quiz ve eşleşmeyen arama (IST-095).
    await prepareQuiz(teacher, 'Ondalık gösterim testi', 'c1', ['q-math-7-1', 'q-math-7-3'])
    await page.goto(TEACHER_QUIZZES)
    await expect(bodyRows(page)).toHaveCount(2)
    const search = page.getByLabel('Tabloda ara')
    await search.fill('ONDALIK')
    await expect(bodyRows(page)).toHaveCount(1)
    await expect(bodyRows(page)).toContainText('Ondalık gösterim testi')
    await search.fill('gözden geçirilmiş')
    await expect(bodyRows(page)).toHaveCount(1)
    await expect(bodyRows(page)).toContainText(renamed)
    await search.fill('olmayan bir başlık')
    await expect(page.getByText('Bu süzgeçlere uyan quiz yok.')).toBeVisible()
    await search.fill('')
    await expect(bodyRows(page)).toHaveCount(2)

    // Arşiv onay ister; denemesiz quiz listeden kalkar, kayıt artık okunmaz.
    await bodyRows(page)
      .filter({ hasText: renamed })
      .getByRole('button', { name: `${renamed} sonuçlarını aç` })
      .click()
    await panelOf(page, 'Quiz sonuçları').getByRole('button', { name: 'Arşivle' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Quizi arşivle' })
    await confirm.getByRole('button', { name: 'Arşivle' }).click()
    await expect(page.getByText(`${renamed} arşivlendi.`)).toBeVisible()
    await expect(panelOf(page, 'Quiz sonuçları')).toHaveCount(0)
    await expect(bodyRows(page).filter({ hasText: renamed })).toHaveCount(0)
    expect((await quizzesOf(teacher)).map((quiz) => quiz.title)).toEqual(['Ondalık gösterim testi'])
    expect((await teacher.get(`/api/v1/quizzes/${created.id}`)).status).toBe(404)
  })

  test('denemesi olan quizde sorular ve arşiv gerekçesiyle kapalıdır (DOM-AKD-076)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'ogrenci'], collections: ['bank'] })
    const teacher = await api(school.user('ogretmen'))
    const student = await api(school.user('ogrenci'))
    const quiz = await prepareQuiz(teacher, 'Çözülmeye başlanan quiz')
    await loginAs(school.user('ogretmen'))

    // Deneme başlamadan önce arşiv açıktır.
    await page.goto(`${TEACHER_QUIZZES}?quiz=${quiz.id}`)
    const detail = panelOf(page, 'Quiz sonuçları')
    await expect(detail.getByRole('button', { name: 'Arşivle' })).toBeEnabled()

    const started = await student.post(`/api/v1/quizzes/${quiz.id}/attempt`, undefined, {
      'idempotency-key': randomUUID(),
    })
    expect(started.status, JSON.stringify(started.body)).toBe(201)

    await page.goto(`${TEACHER_QUIZZES}?quiz=${quiz.id}`)
    const locked = panelOf(page, 'Quiz sonuçları')
    await expect(locked).toContainText('Çözüyor')
    const archive = locked.getByRole('button', { name: 'Arşivle' })
    await expect(archive).toBeDisabled()
    await expect(locked).toContainText('Bu quiz çözülmeye başlandı')

    // Sunucu da reddeder: arşiv 409, kayıt listede kalır.
    const current = (await quizzesOf(teacher))[0]
    const refused = await apiRequest(
      teacher.context,
      'DELETE',
      `/api/v1/quizzes/${quiz.id}`,
      undefined,
      {
        'idempotency-key': randomUUID(),
        'if-match': `"${current?.version}"`,
      },
    )
    expect(refused.status).toBe(409)
    expect(await quizzesOf(teacher)).toHaveLength(1)

    // Düzenleme formunda soru alanı kapalıdır; süre gibi alanlar düzenlenebilir.
    await locked.getByRole('button', { name: 'Düzenle' }).click()
    const edit = panelOf(page, 'Quizi düzenle')
    await expect(edit).toContainText('Bu quiz çözülmeye başlandı')
    const checkboxes = edit.getByRole('list', { name: 'Soru bankası' }).getByRole('checkbox')
    await expect(checkboxes.first()).toBeDisabled()
    expect(
      await checkboxes.evaluateAll((boxes) => boxes.every((box) => box.hasAttribute('disabled'))),
    ).toBe(true)
    await edit.getByLabel('Süre (dakika)').fill('25')
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Quiz güncellendi.')).toBeVisible()
    expect(await quizzesOf(teacher)).toMatchObject([
      { id: quiz.id, duration: 25, questionIds: quiz.questionIds },
    ])
  })

  test('başka öğretmenin quizinde adresle form açılmaz (DOM-AKD-076)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], collections: ['bank'] })
    const admin = await api(school.user('yonetici'))
    const teacher = await api(school.user('ogretmen'))
    // 7-A Türkçe dersi Ahmet Yıldırım'a (t2) atanmıştır; yönetici quizi onun adına hazırlar.
    const other = await prepareQuiz(
      admin,
      'Paragraf quizi',
      'c1',
      ['q-turkish-0', 'q-turkish-1'],
      'turkish',
    )
    expect(other.teacherId).toBe('t2')
    await loginAs(school.user('ogretmen'))

    await page.goto(`${TEACHER_QUIZZES}?quiz-form=${other.id}`)
    const edit = panelOf(page, 'Quizi düzenle')
    await expect(edit).toContainText('Bu işlem için yetkiniz yok.')
    await expect(edit.getByRole('form')).toHaveCount(0)
    await expect(edit.getByLabel('Başlık')).toHaveCount(0)

    // Sunucu da reddeder; quiz değişmez.
    const refused = await apiRequest(
      teacher.context,
      'PATCH',
      `/api/v1/quizzes/${other.id}`,
      { title: 'Ele geçirildi' },
      { 'idempotency-key': randomUUID(), 'if-match': `"${other.version}"` },
    )
    expect(refused.status).toBe(403)
    expect((await quizzesOf(admin))[0]?.title).toBe('Paragraf quizi')
  })
})
