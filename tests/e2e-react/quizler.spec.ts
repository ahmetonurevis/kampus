import { randomUUID } from 'node:crypto'

import type { Locator, Page } from '@playwright/test'

import { createSeed } from '../../packages/school-core/src/data/seed.ts'

import { apiRequest, type ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Quiz ekranları (IST-095; docs/domain/akademik-olcme.md DOM-AKD-075…079) API'ye yazarak sınanır.
// Her test kendi kurumunu kurar (`tenant`): seed ile aynı kimlikler, ayrı kurum; kurumda başlangıçta
// quiz yoktur, soru bankası vardır (`collections: ['bank']`). Öğretmen Selin Kaya (t1) 7-A (c1)
// Matematik'e atanmıştır, 7-A Türkçe'si Ahmet Yıldırım'a (t2), öğrenci Deniz Yılmaz (s1) 7-A'dadır.
// Öğrenci (Deniz, s1) ve veli (Ayşe; Deniz c1, Ece c2) testleri son tarihi geçmiş quiz ve süresi
// işleyen deneme gibi API'den kurulamayan durumları `records` ile doğrudan veritabanına koyar.
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
/** Özet metriğinin değeri ("Puan" → "%67"). */
const metric = (panel: Locator, label: string) =>
  panel.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]')
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

// --- Öğrenci ve veli (DOM-AKD-077, DOM-AKD-078) ------------------------------------------------

const STUDENT_QUIZZES = '/ogrenci/soru-coz'
const PARENT_TRACKING = '/veli/akademik-takip'
const MATH = ['q-math-7-0', 'q-math-7-1', 'q-math-7-2']
const SEED_BANK = createSeed(new Date()).bank

/** Seed bankasındaki soru (metin, şıklar, anahtar); beklenen değerler testte hesaplanır. */
function bankQuestion(id: string) {
  const question = SEED_BANK.find((item) => item.id === id)
  if (!question) throw new Error(`Seed sorusu yok: ${id}`)
  return question
}

/** Doğrudan veritabanına konan quiz (son tarihi geçmiş quiz API'den hazırlanamaz). */
function quizRecord(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    collection: 'quizzes' as const,
    data: {
      id,
      classId: 'c1',
      subjectId: 'math',
      subject: 'Matematik',
      teacherId: 't1',
      title,
      questionIds: MATH,
      duration: 15,
      createdAt: new Date().toISOString(),
      ...extra,
    },
  }
}

/** Deneme kaydı (Deniz, s1); `status: 'started'` süresi işleyen denemedir. */
function attemptRecord(id: string, quizId: string, extra: Record<string, unknown> = {}) {
  return {
    collection: 'quizAttempts' as const,
    data: {
      id,
      quizId,
      studentId: 's1',
      answers: {},
      score: 0,
      correct: 0,
      total: MATH.length,
      topicScores: [],
      date: new Date().toISOString(),
      ...extra,
    },
  }
}

/** Süresi işleyen deneme: `seconds` saniye sonra biter. */
function runningAttempt(id: string, quizId: string, seconds: number) {
  const now = Date.now()
  return attemptRecord(id, quizId, {
    status: 'started',
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + seconds * 1000).toISOString(),
  })
}

const questionGroup = (page: Page, index: number, id: string) =>
  page.getByRole('group', { name: `${index + 1}. ${bankQuestion(id).text}` })

/** Sorunun `position` sıradaki şıkkını işaretler. */
async function choose(page: Page, index: number, id: string, position: number) {
  const option = bankQuestion(id).options[position] ?? ''
  await questionGroup(page, index, id).getByRole('radio', { name: option, exact: true }).check()
}

const isSubmit = (quizId: string) => (request: { method: () => string; url: () => string }) =>
  request.method() === 'POST' && request.url().endsWith(`/quizzes/${quizId}/attempt/submit`)

interface PersonalAttempt {
  status: string
  expiresAt: string | null
  answers?: Record<string, number>
  result: { score: number; correctCount: number; total: number; topicScores?: unknown[] } | null
}

async function attemptsOf(client: ApiClient, quizId: string): Promise<PersonalAttempt[]> {
  const result = await client.get(`/api/v1/quizzes/${quizId}`)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return (result.body as { data: { attempts: PersonalAttempt[] } }).data.attempts
}

test.describe('Quizler: öğrenci ve veli', () => {
  test('öğrenci quizi başlatır, yenilemede aynı denemeden devam eder, gönderir; ikinci gönderim engellenir (DOM-AKD-077, DOM-AKD-078)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'ogrenci'], collections: ['bank'] })
    const teacher = await api(school.user('ogretmen'))
    const student = await api(school.user('ogrenci'))
    const title = 'Dört işlem kısa quizi'
    const quiz = await prepareQuiz(teacher, title, 'c1', MATH)
    const keys = MATH.map((id) => bankQuestion(id).answer)
    await loginAs(school.user('ogrenci'))

    await page.goto(STUDENT_QUIZZES)
    const row = page
      .getByRole('table', { name: 'Quizlerim' })
      .locator('tbody tr', { hasText: title })
    await expect(row).toContainText('Henüz çözülmedi')
    await row.getByRole('button', { name: `${title} sonucunu aç` }).click()
    const panel = panelOf(page, 'Quiz sonucu')
    await panel.getByRole('button', { name: 'Quizi başlat' }).click()
    const started = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url().endsWith(`/quizzes/${quiz.id}/attempt`),
    )
    await page
      .getByRole('alertdialog', { name: 'Quiz başlatılsın mı?' })
      .getByRole('button', { name: 'Başlat' })
      .click()
    expect((await started).headers()['idempotency-key']).toBeTruthy()
    await expect(page).toHaveURL(new RegExp(`[?&]quiz-coz=${quiz.id}`))
    await expect(page.getByRole('timer', { name: 'Kalan süre' })).toContainText('Kalan süre')
    const [first] = await attemptsOf(student, quiz.id)
    expect(first?.status).toBe('in_progress')

    // Kirli ekrandan çıkarken onay sorulur; vazgeçince ekran ve seçim yerinde kalır.
    await choose(page, 0, 'q-math-7-0', keys[0] ?? 0)
    await page.getByRole('button', { name: 'Quizlere dön' }).click()
    const discard = page.getByRole('alertdialog', { name: 'Quizden çıkılsın mı?' })
    await expect(discard).toContainText('Süre işlemeye devam eder')
    await discard.getByRole('button', { name: 'Çözmeye devam et' }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]quiz-coz=${quiz.id}`))

    // Yenileme yeni deneme başlatmaz: aynı deneme ve bitiş anı GET'ten gelir; cevaplar bellektedir.
    await page.reload()
    await expect(
      questionGroup(page, 0, 'q-math-7-0').getByRole('radio', { checked: true }),
    ).toHaveCount(0)
    expect(await attemptsOf(student, quiz.id)).toMatchObject([
      { status: 'in_progress', expiresAt: first?.expiresAt },
    ])

    await choose(page, 0, 'q-math-7-0', keys[0] ?? 0)
    await choose(page, 1, 'q-math-7-1', keys[1] ?? 0)
    await expect(page.getByRole('progressbar', { name: 'Cevaplanan sorular' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    )
    let submits = 0
    page.on('request', (request) => {
      if (isSubmit(quiz.id)(request)) submits += 1
    })
    await page.getByRole('button', { name: 'Cevapları gönder' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Cevaplar gönderilsin mi?' })
    await expect(confirm).toContainText('3 sorudan 2 tanesini cevapladın')
    const sent = page.waitForRequest(isSubmit(quiz.id))
    await confirm.getByRole('button', { name: 'Gönder' }).dblclick()
    const request = await sent
    // Gövde yalnız cevaplardır; puanı sunucu hesaplar. Boş soru gönderilmez.
    expect(request.postDataJSON()).toEqual({
      answers: { 'q-math-7-0': keys[0], 'q-math-7-1': keys[1] },
    })
    expect(request.headers()['idempotency-key']).toBeTruthy()
    await expect(page.getByText('Cevapların gönderildi.')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`[?&]quiz=${quiz.id}`))
    expect(submits).toBe(1)

    // Son tarih yok: inceleme açılmaz, yalnız puan ve doğru sayısı görünür.
    const result = panelOf(page, 'Quiz sonucu')
    await expect(metric(result, 'Puan')).toHaveText('%67')
    await expect(metric(result, 'Doğru / soru')).toHaveText('2 / 3')
    await expect(result).toContainText('son tarihi geçince')
    await expect(result.getByRole('list', { name: 'Quiz cevapları' })).toHaveCount(0)
    expect(await attemptsOf(student, quiz.id)).toMatchObject([
      { status: 'completed', result: { score: 67, correctCount: 2, total: 3 } },
    ])
    const [saved] = await attemptsOf(student, quiz.id)
    expect(saved?.answers).toBeUndefined()
    expect(saved?.result?.topicScores).toBeUndefined()

    // İkinci gönderim: ekran çözme formunu açmaz, sunucu 409 verir; sonuç değişmez.
    await page.goto(`${STUDENT_QUIZZES}?quiz-coz=${quiz.id}`)
    await expect(page.getByText('Bu quizi tamamladın; cevapların gönderildi.')).toBeVisible()
    await expect(page.getByRole('radio')).toHaveCount(0)
    const again = await student.post(
      `/api/v1/quizzes/${quiz.id}/attempt/submit`,
      { answers: { 'q-math-7-2': keys[2] } },
      { 'idempotency-key': randomUUID() },
    )
    expect(again.status).toBe(409)
    expect((again.body as { code: string }).code).toBe('quiz_already_submitted')
    expect((await attemptsOf(student, quiz.id))[0]?.result?.score).toBe(67)
  })

  test('süre dolunca cevaplar bir kez kendiliğinden gönderilir (DOM-AKD-077)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const quizId = 'quiz-e2e-auto'
    const school = await tenant({
      roles: ['ogrenci'],
      collections: ['bank'],
      records: [
        quizRecord(quizId, 'Süresi biten quiz'),
        runningAttempt('attempt-e2e-auto', quizId, 15),
      ],
    })
    const student = await api(school.user('ogrenci'))
    await loginAs(school.user('ogrenci'))
    let submits = 0
    page.on('request', (request) => {
      if (isSubmit(quizId)(request)) submits += 1
    })

    await page.goto(`${STUDENT_QUIZZES}?quiz-coz=${quizId}`)
    const key = bankQuestion('q-math-7-0').answer
    await choose(page, 0, 'q-math-7-0', key)
    const sent = await page.waitForRequest(isSubmit(quizId), { timeout: 25_000 })
    expect(sent.postDataJSON()).toEqual({ answers: { 'q-math-7-0': key } })
    await expect(page.getByText('Süre doldu; cevapların gönderildi.')).toBeVisible()
    const result = panelOf(page, 'Quiz sonucu')
    await expect(metric(result, 'Doğru / soru')).toHaveText('1 / 3')
    expect(submits).toBe(1)
    expect(await attemptsOf(student, quizId)).toMatchObject([
      { status: 'completed', result: { score: 33, correctCount: 1, total: 3 } },
    ])
  })

  test('süre bitiminde gönderim 503 alırsa cevaplar kaybolmaz, aynı anahtarla kendiliğinden yeniden denenir (DOM-AKD-077)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const quizId = 'quiz-e2e-retry'
    const school = await tenant({
      roles: ['ogrenci'],
      collections: ['bank'],
      records: [
        quizRecord(quizId, 'Yeniden denenen quiz'),
        runningAttempt('attempt-e2e-retry', quizId, 5),
      ],
    })
    const student = await api(school.user('ogrenci'))
    await loginAs(school.user('ogrenci'))
    const keys: (string | undefined)[] = []
    let calls = 0
    await page.route(`**/api/v1/quizzes/${quizId}/attempt/submit`, (route) => {
      keys.push(route.request().headers()['idempotency-key'])
      calls += 1
      // İlk gönderim sunucuya ulaşmadan 503 alır; ikincisi gerçek uca gider.
      return calls === 1
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'unavailable', message: 'Sunucu şu an yanıt vermiyor.' }),
          })
        : route.continue()
    })

    await page.goto(`${STUDENT_QUIZZES}?quiz-coz=${quizId}`)
    const key = bankQuestion('q-math-7-0').answer
    await choose(page, 0, 'q-math-7-0', key)
    await expect(page.getByText('cevapların yeniden gönderiliyor')).toBeVisible({ timeout: 15_000 })
    // Cevaplar ekranda durur (alan kilitli ama işaretli).
    await expect(
      questionGroup(page, 0, 'q-math-7-0').getByRole('radio', { checked: true }),
    ).toHaveCount(1)
    await expect(page.getByText('Süre doldu; cevapların gönderildi.')).toBeVisible({
      timeout: 15_000,
    })
    expect(calls).toBe(2)
    expect(keys[1]).toBe(keys[0])
    expect(keys[0]).toBeTruthy()
    expect(await attemptsOf(student, quizId)).toMatchObject([
      { status: 'completed', result: { correctCount: 1, total: 3 } },
    ])
  })

  test('süre bitiminde yeniden denemeler de başarısızsa "Yeniden gönder" onaysız çalışır, cevaplar korunur (DOM-AKD-077)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const quizId = 'quiz-e2e-resend'
    const school = await tenant({
      roles: ['ogrenci'],
      collections: ['bank'],
      records: [
        quizRecord(quizId, 'Yeniden gönderilen quiz'),
        runningAttempt('attempt-e2e-resend', quizId, 3),
      ],
    })
    const student = await api(school.user('ogrenci'))
    await loginAs(school.user('ogrenci'))
    const keys: (string | undefined)[] = []
    await page.route(`**/api/v1/quizzes/${quizId}/attempt/submit`, (route) => {
      keys.push(route.request().headers()['idempotency-key'])
      // İlk dört istek (ilk deneme + üç yeniden deneme) ağ hatası alır.
      return keys.length <= 4 ? route.abort('failed') : route.continue()
    })

    await page.goto(`${STUDENT_QUIZZES}?quiz-coz=${quizId}`)
    const key = bankQuestion('q-math-7-0').answer
    await choose(page, 0, 'q-math-7-0', key)
    const resend = page.getByRole('button', { name: 'Yeniden gönder' })
    await expect(page.getByRole('alert')).toContainText('Yeniden gönder', { timeout: 30_000 })
    await expect(resend).toBeEnabled()
    expect(keys).toHaveLength(4)
    expect(new Set(keys).size).toBe(1)
    await expect(
      questionGroup(page, 0, 'q-math-7-0').getByRole('radio', { checked: true }),
    ).toHaveCount(1)
    // Süre dolduktan sonra onay penceresi açılmaz; cevaplar doğrudan gönderilir.
    await resend.click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.getByText('Cevapların gönderildi.')).toBeVisible()
    expect(keys).toHaveLength(5)
    expect(keys[4]).toBe(keys[0])
    expect(await attemptsOf(student, quizId)).toMatchObject([
      { status: 'completed', result: { correctCount: 1, total: 3 } },
    ])
  })

  test('elle gönderim 503 alırsa onay penceresinde yeniden denenir; aynı anahtar, tek sonuç (DOM-AKD-077)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const quizId = 'quiz-e2e-manual'
    const school = await tenant({
      roles: ['ogrenci'],
      collections: ['bank'],
      records: [
        quizRecord(quizId, 'Elle gönderilen quiz'),
        runningAttempt('attempt-e2e-manual', quizId, 600),
      ],
    })
    const student = await api(school.user('ogrenci'))
    await loginAs(school.user('ogrenci'))
    const keys: (string | undefined)[] = []
    await page.route(`**/api/v1/quizzes/${quizId}/attempt/submit`, (route) => {
      keys.push(route.request().headers()['idempotency-key'])
      return keys.length === 1
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'unavailable', message: 'Sunucu şu an yanıt vermiyor.' }),
          })
        : route.continue()
    })

    await page.goto(`${STUDENT_QUIZZES}?quiz-coz=${quizId}`)
    const key = bankQuestion('q-math-7-0').answer
    await choose(page, 0, 'q-math-7-0', key)
    await page.getByRole('button', { name: 'Cevapları gönder' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Cevaplar gönderilsin mi?' })
    await confirm.getByRole('button', { name: 'Gönder' }).click()
    await expect(page.getByText('Sunucu şu an yanıt vermiyor.')).toBeVisible()
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Gönder' }).click()
    await expect(page.getByText('Cevapların gönderildi.')).toBeVisible()
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
    expect(await attemptsOf(student, quizId)).toMatchObject([
      { status: 'completed', result: { correctCount: 1, total: 3 } },
    ])
  })

  test('elle gönderim sürerken süre dolarsa tek istek gider (DOM-AKD-077)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const quizId = 'quiz-e2e-both'
    const school = await tenant({
      roles: ['ogrenci'],
      collections: ['bank'],
      records: [
        quizRecord(quizId, 'Çift tetiklenen quiz'),
        runningAttempt('attempt-e2e-both', quizId, 8),
      ],
    })
    const student = await api(school.user('ogrenci'))
    await loginAs(school.user('ogrenci'))
    let submits = 0
    // Yanıt süre bittikten sonra (ağ payı içinde) döner: sayaç gönderim sürerken tetiklenir.
    await page.route(`**/api/v1/quizzes/${quizId}/attempt/submit`, async (route) => {
      submits += 1
      await new Promise((resolve) => setTimeout(resolve, 9000))
      await route.continue()
    })

    await page.goto(`${STUDENT_QUIZZES}?quiz-coz=${quizId}`)
    const key = bankQuestion('q-math-7-0').answer
    await choose(page, 0, 'q-math-7-0', key)
    await page.getByRole('button', { name: 'Cevapları gönder' }).click()
    await page
      .getByRole('alertdialog', { name: 'Cevaplar gönderilsin mi?' })
      .getByRole('button', { name: 'Gönder' })
      .click()
    await expect(page.getByText('Cevapların gönderildi.')).toBeVisible({ timeout: 20_000 })
    expect(submits).toBe(1)
    expect(await attemptsOf(student, quizId)).toMatchObject([
      { status: 'completed', result: { correctCount: 1, total: 3 } },
    ])
  })

  test('sayaç cihaz saatiyle değil sunucu saatiyle işler (DOM-AKD-077)', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const quizId = 'quiz-e2e-skew'
    const school = await tenant({
      roles: ['ogrenci'],
      collections: ['bank'],
      records: [
        quizRecord(quizId, 'Saat farkı quizi'),
        runningAttempt('attempt-e2e-skew', quizId, 600),
      ],
    })
    await loginAs(school.user('ogrenci'))
    // Cihaz saati 10 dakika geri: düzeltme olmasa sayaç 20 dakikaya yakın görünürdü.
    await page.addInitScript(() => {
      const real = Date.now.bind(Date)
      Date.now = () => real() - 600_000
    })
    await page.goto(`${STUDENT_QUIZZES}?quiz-coz=${quizId}`)
    const timer = page.getByRole('timer', { name: 'Kalan süre' })
    await expect(timer).toContainText(/Kalan süre (09:[0-5]\d|10:00)/)
  })

  test('sayfa yenileme ve sekme kapatma cevap varken tarayıcı uyarısı açar, cevap yokken açmaz (DOM-AKD-077)', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const quizId = 'quiz-e2e-unload'
    const school = await tenant({
      roles: ['ogrenci'],
      collections: ['bank'],
      records: [
        quizRecord(quizId, 'Kapatma uyarılı quiz'),
        runningAttempt('attempt-e2e-unload', quizId, 600),
      ],
    })
    await loginAs(school.user('ogrenci'))
    await page.goto(`${STUDENT_QUIZZES}?quiz-coz=${quizId}`)
    await expect(page.getByRole('timer', { name: 'Kalan süre' })).toBeVisible()
    // Cevap yok: uyarı yok; sayfa kapanış denemesi sessizce ilerler.
    const beforeAnswer = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(beforeAnswer).toBe(false)

    await choose(page, 0, 'q-math-7-0', 1)
    const afterAnswer = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(afterAnswer).toBe(true)
  })

  test('süresi geçmiş gönderim ve başka yerden gönderilmiş deneme ekranı bozmaz (DOM-AKD-077)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const late = 'quiz-e2e-late'
    const twice = 'quiz-e2e-twice'
    const school = await tenant({
      roles: ['ogrenci'],
      collections: ['bank'],
      records: [
        quizRecord(late, 'Geç gönderilen quiz'),
        runningAttempt('attempt-e2e-late', late, 600),
        quizRecord(twice, 'İki kez gönderilen quiz'),
        runningAttempt('attempt-e2e-twice', twice, 600),
      ],
    })
    const student = await api(school.user('ogrenci'))
    await loginAs(school.user('ogrenci'))

    // 422: sunucu süre ve ağ payı geçti der (saat beklemeden yanıt taklit edilir).
    await page.route(`**/api/v1/quizzes/${late}/attempt/submit`, (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'quiz_time_expired',
          message: 'Quizin süresi doldu; cevaplar kaydedilmedi.',
        }),
      }),
    )
    await page.goto(`${STUDENT_QUIZZES}?quiz-coz=${late}`)
    await choose(page, 0, 'q-math-7-0', 1)
    await page.getByRole('button', { name: 'Cevapları gönder' }).click()
    await page
      .getByRole('alertdialog', { name: 'Cevaplar gönderilsin mi?' })
      .getByRole('button', { name: 'Gönder' })
      .click()
    await expect(page.getByText('Quizin süresi doldu; cevapların kaydedilmedi.')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Geç gönderilen quiz' })).toBeVisible()
    await expect(page.getByRole('radio')).toHaveCount(0)
    // Ekrandan çıkış onay istemez (cevaplar zaten gönderilemedi).
    await page.getByRole('button', { name: 'Sonucu gör' }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]quiz=${late}`))

    // 409: cevaplar başka bir sekmeden gönderildi; ekran sonuç görünümüne geçer.
    await page.goto(`${STUDENT_QUIZZES}?quiz-coz=${twice}`)
    await choose(page, 0, 'q-math-7-0', 2)
    const elsewhere = await student.post(
      `/api/v1/quizzes/${twice}/attempt/submit`,
      { answers: {} },
      { 'idempotency-key': randomUUID() },
    )
    expect(elsewhere.status).toBe(200)
    await page.getByRole('button', { name: 'Cevapları gönder' }).click()
    await page
      .getByRole('alertdialog', { name: 'Cevaplar gönderilsin mi?' })
      .getByRole('button', { name: 'Gönder' })
      .click()
    await expect(page.getByText('Bu quizin cevapları zaten gönderildi.')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`[?&]quiz=${twice}`))
    await expect(metric(panelOf(page, 'Quiz sonucu'), 'Puan')).toHaveText('%0')
  })

  test('son tarih geçince öğrenci ve veli cevapları ve konu puanlarını görür, anahtarı görmez; başka sınıfın quizi açılmaz (DOM-AKD-078, DOM-AKD-079)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const closed = 'quiz-e2e-closed'
    const other = 'quiz-e2e-other'
    const title = 'Geçen haftanın quizi'
    const [q0, q1, q2] = MATH.map(bankQuestion)
    if (!q0 || !q1 || !q2) throw new Error('seed soruları')
    const wrong = (q1.answer + 1) % q1.options.length
    const school = await tenant({
      roles: ['ogrenci', 'veli'],
      collections: ['bank'],
      records: [
        quizRecord(closed, title, { dueDate: new Date(Date.now() - 86_400_000).toISOString() }),
        attemptRecord('attempt-e2e-closed', closed, {
          answers: { [q0.id]: q0.answer, [q1.id]: wrong },
        }),
        // Ece'nin (c2) sınıfının quizi: Deniz görmez.
        quizRecord(other, 'Başka sınıfın quizi', { classId: 'c2' }),
      ],
    })
    const student = await api(school.user('ogrenci'))
    const parent = await api(school.user('veli'))

    const expectReview = async (panel: Locator) => {
      await expect(metric(panel, 'Puan')).toHaveText('%33')
      await expect(metric(panel, 'Doğru / soru')).toHaveText('1 / 3')
      await expect(panel.getByText('Konu bazında başarı')).toBeVisible()
      await expect(panel).toContainText(q0.topic)
      const answers = panel.getByRole('list', { name: 'Quiz cevapları' })
      await expect(answers.getByRole('listitem')).toHaveCount(3)
      await expect(answers.getByRole('listitem').nth(0)).toContainText(
        `Verilen cevap: A) ${q0.options[q0.answer]}`,
      )
      await expect(answers.getByRole('listitem').nth(1)).toContainText(
        `Verilen cevap: ${String.fromCharCode(65 + wrong)}) ${q1.options[wrong]}`,
      )
      await expect(answers.getByRole('listitem').nth(2)).toContainText('Boş bırakıldı')
      // Doğru şık ve çözüm hiç görünmez.
      await expect(panel).not.toContainText('Doğru:')
      for (const question of [q0, q1, q2])
        await expect(panel).not.toContainText(question.explanation)
      await expect(panel.getByRole('button', { name: 'Quizi başlat' })).toHaveCount(0)
    }

    // API: öğrenci ve veli yanıtında anahtar yoktur.
    for (const client of [student, parent]) {
      const detail = await client.get(`/api/v1/quizzes/${closed}`)
      expect(detail.status).toBe(200)
      expect(JSON.stringify(detail.body)).not.toContain('answerKey')
    }

    await loginAs(school.user('ogrenci'))
    await page.goto(`${STUDENT_QUIZZES}?quiz=${closed}`)
    await expectReview(panelOf(page, 'Quiz sonucu'))

    // Başka sınıfın quizi: çözme ekranı çizilmez, deneme başlamaz.
    expect((await student.get(`/api/v1/quizzes/${other}`)).status).toBe(404)
    await page.goto(`${STUDENT_QUIZZES}?quiz-coz=${other}`)
    await expect(page.getByText('Quiz bulunamadı.')).toBeVisible()
    await expect(page.getByRole('radio')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cevapları gönder' })).toHaveCount(0)

    // Veli: seçili çocuğun (Deniz) sonucu aynı kuralla; başlatma yok.
    await loginAs(school.user('veli'))
    await page.goto(`${PARENT_TRACKING}?sekme=quizler&cocuk=s1`)
    const row = page
      .getByRole('table', { name: 'Quiz sonuçları' })
      .locator('tbody tr', { hasText: title })
    await expect(row).toContainText('Çözüldü')
    await expect(row).toContainText('%33')
    await row.getByRole('button', { name: `${title} sonucunu aç` }).click()
    await expectReview(panelOf(page, 'Quiz sonucu'))
  })
})
