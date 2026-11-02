import type { Locator, Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// Öğrenme okuma ekranları: öğretmen (ödevler, materyaller, quizler), öğrenci (Ödevlerim,
// Materyaller, Quiz & Testler) ve veli (Akademik Takip → ödev durumu, quiz sonuçları). Hiçbir
// test kayıt yazmaz; paylaşılan rol oturumları salt okunurdur. Seed: Akademi Özel Okulları, öğretmen
// Selin Kaya (kampüs b1'in 8 sınıfı), öğrenci Deniz Yılmaz (7-A, c1), veli Ayşe Yılmaz (Deniz c1 ve
// Ece c2). Beklenen değerler API'den bağımsız olarak testte hesaplanır; seed tarihleri göreli
// olduğundan gecikme/bekleme ayrımına değil toplamlara ve teslim kayıtlarına dayanılır.

const TEACHER_HOMEWORK = '/ogretmen/odevler'
const TEACHER_MATERIALS = '/ogretmen/materyal-yukle'
const TEACHER_QUIZZES = '/ogretmen/quiz-olustur'
const STUDENT_HOMEWORK = '/ogrenci/odevler'
const STUDENT_MATERIALS = '/ogrenci/materyaller'
const STUDENT_QUIZZES = '/ogrenci/soru-coz'
const PARENT_TRACKING = '/veli/akademik-takip'
const NOT_FOUND = 'Kayıt bulunamadı'

type Row<T> = { id: string; record: T }
type Homework = { id: string; title: string; classId: string; dueDate: string }
type Submission = { homeworkId: string; studentId: string; score: number | null }
type Quiz = {
  id: string
  title: string
  classId: string
  subjectId: string
  questionIds: string[]
}
type Attempt = { quizId: string; studentId: string; score: number; correct: number; total: number }
type Question = { id: string; answer: number }

const resultCount = (page: Page) => page.locator('.result-count')
const tableOf = (page: Page, name: string) => page.getByRole('table', { name })
const bodyRows = (page: Page, name: string) => tableOf(page, name).locator('tbody tr')
const panelOf = (page: Page, name: string) => page.getByRole('dialog', { name })

/** Koleksiyonun bütün kayıtları (100'lük sayfalarla). */
async function all<T>(client: ApiClient, path: string): Promise<Row<T>[]> {
  const rows: Row<T>[] = []
  for (let pageNumber = 1; ; pageNumber += 1) {
    const joiner = path.includes('?') ? '&' : '?'
    const result = await client.get(`${path}${joiner}page=${pageNumber}&pageSize=100`)
    expect(result.status, path).toBe(200)
    const body = result.body as { data: Row<T>[]; meta: { total: number } }
    rows.push(...body.data)
    if (rows.length >= body.meta.total || body.data.length === 0) return rows
  }
}

async function total(client: ApiClient, path: string): Promise<number> {
  const joiner = path.includes('?') ? '&' : '?'
  const result = await client.get(`${path}${joiner}page=1&pageSize=1`)
  expect(result.status, path).toBe(200)
  return (result.body as { meta: { total: number } }).meta.total
}

/** Başlık hücresindeki ödev düğmesinin bulunduğu satır. */
const rowOf = (page: Page, table: string, title: string): Locator =>
  bodyRows(page, table).filter({ hasText: title })

/** Ayrıntı panelindeki etiket/değer çifti ("Teslim dosyası" → dosya adı). */
async function factOf(panel: Locator, label: string): Promise<string> {
  const text = await panel
    .locator('dt', { hasText: label })
    .locator('xpath=following-sibling::dd[1]')
    .innerText()
  return text.trim()
}

const metric = (panel: Locator, label: string) =>
  panel.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]')

test.describe('Öğrenme: öğretmen', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('ogretmen')
  })

  test('ödev listesi yalnız kendi sınıflarını gösterir; sınıf filtresi sunucuda süzer', async ({
    page,
    api,
  }) => {
    const teacher = await api('ogretmen')
    const admin = await api('yonetici')
    const ownClasses = await all<{ name: string }>(teacher, '/api/v1/collections/classes')
    const everyClass = await all<{ name: string }>(admin, '/api/v1/collections/classes')
    const foreign = everyClass.filter((row) => !ownClasses.some((own) => own.id === row.id))
    expect(foreign.length, 'başka kampüsün sınıfları').toBeGreaterThan(0)

    await page.goto(TEACHER_HOMEWORK)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ödevler & Değerlendirme' }),
    ).toBeVisible()
    const ownTotal = await total(teacher, '/api/v1/homework')
    expect(ownTotal, 'yönetici daha fazlasını görür').toBeLessThan(
      await total(admin, '/api/v1/homework'),
    )
    await expect(page.getByText(`${ownTotal} ödev · Sınıflarınızın ödevleri`)).toBeVisible()

    // Sınıf seçeneklerinde yalnız kendi sınıfları var; başka kampüsün sınıfı yok.
    const classSelect = page.getByLabel('Sınıf', { exact: true })
    await expect(classSelect.locator('option')).toHaveCount(ownClasses.length + 1)
    for (const other of foreign.slice(0, 3))
      await expect(classSelect.locator('option', { hasText: other.record.name })).toHaveCount(0)

    // 7-A (c1) seçilince adreste durur ve sayı API'nin o sınıf sayısıyla eşleşir.
    await classSelect.selectOption('c1')
    await expect(page).toHaveURL(/[?&]sinif=c1/)
    const c1Total = await total(teacher, '/api/v1/homework?classId=c1')
    await expect(page.getByText(`${c1Total} ödev · `)).toBeVisible()
    await expect(resultCount(page)).toContainText(`/ ${c1Total} kayıt`)
    const classCells = bodyRows(page, 'Ödev ve teslim listesi').locator('td:nth-child(2)')
    await expectEveryRow(classCells, '7-A', true)
  })

  test('ders filtresi listeyi o derse daraltır', async ({ page, api }) => {
    const teacher = await api('ogretmen')
    await page.goto(TEACHER_HOMEWORK)
    await page.getByLabel('Ders', { exact: true }).selectOption('math')
    await expect(page).toHaveURL(/[?&]ders=math/)
    const mathTotal = await total(teacher, '/api/v1/homework?subjectId=math')
    await expect(resultCount(page)).toContainText(`/ ${mathTotal} kayıt`)
    const subjectCells = bodyRows(page, 'Ödev ve teslim listesi').locator('td:nth-child(3)')
    await expectEveryRow(subjectCells, 'Matematik', true)
  })

  test('teslim durumu paneli teslim eden, geciken ve bekleyen sayılarını gösterir', async ({
    page,
    api,
  }) => {
    const teacher = await api('ogretmen')
    const detail = await teacher.get('/api/v1/homework/hw2')
    expect(detail.status).toBe(200)
    const submissions = (detail.body as { data: { submissions: Submission[] } }).data.submissions
    const classStudents = await total(teacher, '/api/v1/collections/students?classId=c1')
    const delivered = submissions.length
    expect(delivered, 'seed: hw2 teslimleri var').toBeGreaterThan(0)

    await page.goto(`${TEACHER_HOMEWORK}?odev=hw2`)
    const panel = panelOf(page, 'Ödev teslim durumu')
    await expect(metric(panel, 'Teslim eden')).toHaveText(`${delivered} / ${classStudents}`)
    const late = Number(await metric(panel, 'Geciken').innerText())
    const pending = Number(await metric(panel, 'Bekleyen').innerText())
    expect(late + pending, 'teslim etmeyenler geciken veya bekleyendir').toBe(
      classStudents - delivered,
    )
    const evaluated = submissions.filter((row) => row.score !== null).length
    await expect(metric(panel, 'Değerlendirilen')).toHaveText(String(evaluated))
    await expect(
      panel.getByRole('list', { name: 'Öğrenci teslim durumu' }).getByRole('listitem'),
    ).toHaveCount(classStudents)

    // Satırdan açılır ve kapanınca liste yerinde kalır.
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(page).not.toHaveURL(/odev=/)
  })

  test('başka sınıfın ödevi ve quizi uçta 404, panelde "bulunamadı" görünümüdür', async ({
    page,
    api,
  }) => {
    const teacher = await api('ogretmen')
    const admin = await api('yonetici')
    const ownClasses = new Set(
      (await all<unknown>(teacher, '/api/v1/collections/classes')).map((row) => row.id),
    )
    const homework = (await all<Homework>(admin, '/api/v1/collections/homework')).find(
      (row) => !ownClasses.has(row.record.classId),
    )
    const quiz = (await all<Quiz>(admin, '/api/v1/collections/quizzes')).find(
      (row) => !ownClasses.has(row.record.classId),
    )
    expect(homework && quiz, 'başka kampüsün ödevi ve quizi').toBeTruthy()

    expect((await teacher.get(`/api/v1/homework/${homework?.id}`)).status).toBe(404)
    await page.goto(`${TEACHER_HOMEWORK}?odev=${homework?.id}`)
    await expect(panelOf(page, 'Ödev teslim durumu')).toContainText(NOT_FOUND)

    expect((await teacher.get(`/api/v1/collections/quizzes/${quiz?.id}`)).status).toBe(404)
    await page.goto(`${TEACHER_QUIZZES}?quiz=${quiz?.id}`)
    await expect(panelOf(page, 'Quiz sonuçları')).toContainText(NOT_FOUND)
  })

  test('materyal listesi yalnız öğretmenin paylaştıklarını gösterir ve içerik özeti açar', async ({
    page,
    api,
  }) => {
    const teacher = await api('ogretmen')
    const own = await all<{ id: string }>(teacher, '/api/v1/collections/teachers')
    const teacherId = own[0]?.id
    expect(teacherId).toBeTruthy()
    const mine = await total(teacher, `/api/v1/collections/materials?teacherId=${teacherId}`)
    const everything = await total(teacher, '/api/v1/collections/materials')
    expect(mine).toBeLessThan(everything)

    await page.goto(TEACHER_MATERIALS)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Materyal Kütüphanesi' }),
    ).toBeVisible()
    await expect(resultCount(page)).toContainText(`/ ${mine} kayıt`)

    await page
      .getByRole('button', { name: /özetini aç$/ })
      .first()
      .click()
    const panel = panelOf(page, 'Materyal özeti')
    await expect(panel).toContainText('İçerik')
    await expect(panel).toContainText('Dosya')
  })

  test('quiz listesi soru sayısını ve sınıf ortalamasını cevaplardan hesaplar', async ({
    page,
    api,
  }) => {
    const teacher = await api('ogretmen')
    // Çözülmüş ilk quiz: 7-A'nın denemelerinden quiz bulunur.
    const solved = await all<Attempt>(teacher, '/api/v1/collections/quizAttempts?classId=c1')
    const quizId = solved[0]?.record.quizId
    expect(quizId, 'seed: 7-A quizleri çözülmüş').toBeTruthy()
    const quiz = (await all<Quiz>(teacher, '/api/v1/collections/quizzes?classId=c1')).find(
      (row) => row.id === quizId,
    )
    expect(quiz).toBeTruthy()
    if (!quiz) return
    const attempts = await all<Attempt & { answers: Record<string, number> }>(
      teacher,
      `/api/v1/collections/quizAttempts?quizId=${quiz.id}`,
    )
    const bank = await all<Question>(
      teacher,
      `/api/v1/collections/bank?subjectId=${quiz.record.subjectId}`,
    )
    const key = new Map(bank.map((row) => [row.id, row.record.answer]))
    expect(attempts.length, 'seed: quiz çözülmüş').toBeGreaterThan(0)
    // Bağımsız hesap: doğru sayısı / soru sayısı, yüzde; sınıf ortalaması yuvarlanmış ortalama.
    const scores = attempts.map((row) => {
      const correct = quiz.record.questionIds.filter(
        (id) => key.get(id) === row.record.answers[id],
      ).length
      return Math.round((correct / quiz.record.questionIds.length) * 100)
    })
    const expected = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)

    await page.goto(TEACHER_QUIZZES)
    await page.getByLabel('Tabloda ara').fill(quiz.record.title)
    const row = rowOf(page, 'Quiz listesi', quiz.record.title)
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(`%${expected}`)
    await expect(row.locator('td:nth-child(4)')).toHaveText(String(quiz.record.questionIds.length))
    await expect(row.locator('td:nth-child(6)')).toHaveText(String(attempts.length))

    await row.getByRole('button', { name: `${quiz.record.title} sonuçlarını aç` }).click()
    const panel = panelOf(page, 'Quiz sonuçları')
    await expect(metric(panel, 'Sınıf ortalaması')).toHaveText(`%${expected}`)
  })
})

test.describe('Öğrenme: öğrenci', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('ogrenci')
  })

  test('Ödevlerim yalnız kendi sınıfının ödevlerini ve kendi teslim durumunu gösterir', async ({
    page,
    api,
  }) => {
    const student = await api('ogrenci')
    const admin = await api('yonetici')
    const mine = await all<Submission>(student, '/api/v1/collections/submissions')
    expect(mine.length).toBeGreaterThan(0)
    for (const row of mine) expect(row.record.studentId).toBe('s1')
    const everyone = await total(admin, '/api/v1/collections/submissions?classId=c1')
    expect(everyone, 'sınıf arkadaşlarının teslimleri var ama görünmez').toBeGreaterThan(
      mine.length,
    )

    const homework = await all<Homework>(student, '/api/v1/collections/homework')
    for (const row of homework) expect(row.record.classId).toBe('c1')
    await page.goto(STUDENT_HOMEWORK)
    await expect(page.getByRole('heading', { level: 1, name: 'Ödevlerim' })).toBeVisible()
    await expect(page.getByText(`${homework.length} ödev`).first()).toBeVisible()

    // Teslim edilen ödev (core homeworkStatus): not yoksa "Teslim edildi", varsa "Değerlendirildi".
    const delivered = mine.find((row) => row.record.score === null)
    const graded = mine.find((row) => row.record.score !== null)
    expect(delivered && graded).toBeTruthy()
    const titleOf = (id: string) => homework.find((row) => row.id === id)?.record.title ?? ''
    await page.getByLabel('Tabloda ara').fill(titleOf(delivered?.record.homeworkId ?? ''))
    await expect(bodyRows(page, 'Ödevlerim').first()).toContainText('Teslim edildi')
    await page.getByLabel('Tabloda ara').fill(titleOf(graded?.record.homeworkId ?? ''))
    await expect(bodyRows(page, 'Ödevlerim').first()).toContainText('Değerlendirildi')
  })

  test('ödev ayrıntısı kendi teslimini gösterir; teslim etmediği ödevde teslim yoktur', async ({
    page,
    api,
  }) => {
    const student = await api('ogrenci')
    const mine = await all<Submission>(student, '/api/v1/collections/submissions')
    const homework = await all<Homework>(student, '/api/v1/collections/homework')
    const submitted = new Set(mine.map((row) => row.record.homeworkId))
    const open = homework.find((row) => !submitted.has(row.id))
    const graded = mine.find((row) => row.record.score !== null)
    expect(open && graded, 'seed: teslim edilmemiş ve notlanmış ödev').toBeTruthy()

    await page.goto(`${STUDENT_HOMEWORK}?odev=${graded?.record.homeworkId}`)
    const panel = panelOf(page, 'Ödev ayrıntısı')
    await expect(panel).toContainText('Deniz-')
    await expect(panel.getByText('Değerlendirildi')).toBeVisible()
    expect(await factOf(panel, 'Not')).toBe(String(graded?.record.score))

    await page.goto(`${STUDENT_HOMEWORK}?odev=${open?.id}`)
    const pending = panelOf(page, 'Ödev ayrıntısı')
    await expect(pending).toContainText('Henüz teslim edilmedi')
    expect(await factOf(pending, 'Teslim dosyası')).toBe('—')
  })

  test('kapsam dışı ödev, quiz ve materyal adresi "bulunamadı" görünümüne düşer', async ({
    page,
    api,
  }) => {
    const student = await api('ogrenci')
    const admin = await api('yonetici')
    const homework = (await all<Homework>(admin, '/api/v1/collections/homework')).find(
      (row) => row.record.classId !== 'c1',
    )
    const quiz = (await all<Quiz>(admin, '/api/v1/collections/quizzes')).find(
      (row) => row.record.classId !== 'c1',
    )
    const material = (await all<{ level: string }>(admin, '/api/v1/collections/materials')).find(
      (row) => row.record.level !== '7. Sınıf',
    )
    expect(homework && quiz && material).toBeTruthy()
    for (const [collection, row] of [
      ['homework', homework],
      ['quizzes', quiz],
      ['materials', material],
    ] as const)
      expect((await student.get(`/api/v1/collections/${collection}/${row?.id}`)).status).toBe(404)

    await page.goto(`${STUDENT_HOMEWORK}?odev=${homework?.id}`)
    await expect(panelOf(page, 'Ödev ayrıntısı')).toContainText(NOT_FOUND)
    await page.goto(`${STUDENT_QUIZZES}?quiz=${quiz?.id}`)
    await expect(panelOf(page, 'Quiz sonucu')).toContainText(NOT_FOUND)
    await page.goto(`${STUDENT_MATERIALS}?materyal=${material?.id}`)
    await expect(panelOf(page, 'Materyal özeti')).toContainText(NOT_FOUND)
  })

  test("Quizlerim puanı core'un cevaplardan hesapladığı sonuçtan gösterir", async ({
    page,
    api,
  }) => {
    const student = await api('ogrenci')
    const attempts = await all<Attempt>(student, '/api/v1/collections/quizAttempts')
    const quizzes = await all<Quiz>(student, '/api/v1/collections/quizzes')
    expect(attempts.length).toBeGreaterThan(0)
    for (const row of attempts) expect(row.record.studentId).toBe('s1')
    const attempt = attempts[0]
    const quiz = quizzes.find((row) => row.id === attempt?.record.quizId)
    expect(attempt && quiz).toBeTruthy()
    if (!attempt || !quiz) return

    await page.goto(STUDENT_QUIZZES)
    await expect(page.getByRole('heading', { level: 1, name: 'Quiz & Testler' })).toBeVisible()
    await expect(page.getByText(`${quizzes.length} quiz`).first()).toBeVisible()
    await page.getByLabel('Tabloda ara').fill(quiz.record.title)
    const row = rowOf(page, 'Quizlerim', quiz.record.title)
    await expect(row).toContainText('Çözüldü')
    await expect(row).toContainText(`%${attempt.record.score}`)

    await row.getByRole('button', { name: `${quiz.record.title} sonucunu aç` }).click()
    const panel = panelOf(page, 'Quiz sonucu')
    await expect(metric(panel, 'Puan')).toHaveText(`%${attempt.record.score}`)
    await expect(metric(panel, 'Doğru / soru')).toHaveText(
      `${attempt.record.correct} / ${attempt.record.total}`,
    )
  })

  test('Materyaller yalnız öğrencinin düzeyindekileri listeler', async ({ page, api }) => {
    const student = await api('ogrenci')
    const materials = await all<{ level: string }>(student, '/api/v1/collections/materials')
    for (const row of materials) expect(row.record.level).toBe('7. Sınıf')
    await page.goto(STUDENT_MATERIALS)
    await expect(page.getByRole('heading', { level: 1, name: 'Materyaller' })).toBeVisible()
    await expect(page.getByText(`${materials.length} materyal`).first()).toBeVisible()
    await expect(resultCount(page)).toContainText(`/ ${materials.length} kayıt`)
  })
})

test.describe('Öğrenme: veli', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('veli')
  })

  test('seçili çocuğun ödev durumu yalnız o çocuğun sınıfı ve teslimleriyle görünür', async ({
    page,
    api,
  }) => {
    const parent = await api('veli')
    const students = await all<{ name: string; classId: string }>(
      parent,
      '/api/v1/collections/students',
    )
    const child = students[0]
    const sibling = students[1]
    expect(child && sibling, 'veli iki çocuk').toBeTruthy()
    if (!child || !sibling) return
    expect(child.record.classId).not.toBe(sibling.record.classId)

    // Veli iki sınıfın ödevlerini okur; ekran yalnız seçili çocuğunkini gösterir.
    const everything = await total(parent, '/api/v1/collections/homework')
    const childHomework = await all<Homework>(
      parent,
      `/api/v1/collections/homework?classId=${child.record.classId}`,
    )
    expect(childHomework.length).toBeLessThan(everything)
    const submissions = await all<Submission>(
      parent,
      `/api/v1/collections/submissions?studentId=${child.id}`,
    )

    await page.goto(`${PARENT_TRACKING}?sekme=odevler`)
    await expect(page.getByRole('heading', { level: 1, name: 'Akademik Takip' })).toBeVisible()
    const summary = page.getByRole('region', { name: 'Öğrenci özeti' })
    await expect(summary).toContainText(child.record.name)
    await expect(page.getByText(`${childHomework.length} ödev`).first()).toBeVisible()
    await expect(resultCount(page)).toContainText(`/ ${childHomework.length} kayıt`)

    // İlk sayfadaki her satırın durumu çocuğun kendi teslim kaydına uyar.
    const delivered = new Set(submissions.map((row) => row.record.homeworkId))
    const rows = bodyRows(page, 'Ödev durumu')
    await expect(rows.first()).toBeVisible()
    for (const row of await rows.all()) {
      const title = (await row.locator('td:nth-child(1)').innerText()).trim()
      const status = (await row.locator('td:nth-child(4)').innerText()).trim()
      const record = childHomework.find((item) => item.record.title === title)
      expect(record, title).toBeTruthy()
      const wasDelivered = delivered.has(record?.id ?? '')
      expect(['Teslim edildi', 'Değerlendirildi'].includes(status), `${title}: ${status}`).toBe(
        wasDelivered,
      )
    }
  })

  test('çocuk değişince ödev ve quiz listesi seçili çocuğa göre değişir', async ({ page, api }) => {
    const parent = await api('veli')
    const students = await all<{ name: string; classId: string }>(
      parent,
      '/api/v1/collections/students',
    )
    const deniz = students.find((row) => row.record.name === 'Deniz Yılmaz')
    const ece = students.find((row) => row.record.name === 'Ece Yılmaz')
    expect(deniz && ece, 'veli iki çocuk').toBeTruthy()
    if (!deniz || !ece) return
    const lists = async (child: typeof deniz) => ({
      homework: await all<Homework>(
        parent,
        `/api/v1/collections/homework?classId=${child.record.classId}`,
      ),
      quizzes: await all<Quiz>(
        parent,
        `/api/v1/collections/quizzes?classId=${child.record.classId}`,
      ),
    })
    const first = await lists(deniz)
    const second = await lists(ece)
    const ids = (rows: Row<unknown>[]) => rows.map((row) => row.id).join()
    expect(ids(first.homework), 'iki sınıfın ödevleri ayrıdır').not.toBe(ids(second.homework))
    expect(ids(first.quizzes), 'iki sınıfın quizleri ayrıdır').not.toBe(ids(second.quizzes))

    // Ödev durumu: Deniz'den Ece'ye geçince başlıklar ve sayı değişir.
    await page.goto(`${PARENT_TRACKING}?sekme=odevler&cocuk=${deniz.id}`)
    await expect(page.getByLabel('Çocuk seç')).toHaveValue(deniz.id)
    await expect(resultCount(page)).toContainText(`/ ${first.homework.length} kayıt`)
    await page.getByLabel('Tabloda ara').fill(first.homework[0]?.record.title ?? '')
    await expect(bodyRows(page, 'Ödev durumu').first()).toContainText(
      first.homework[0]?.record.title ?? '',
    )

    await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
    await expect(page).toHaveURL(new RegExp(`[?&]cocuk=${ece.id}`))
    await expect(page).toHaveURL(/[?&]sekme=odevler/)
    await expect(page.getByRole('region', { name: 'Öğrenci özeti' })).toContainText('Ece Yılmaz')
    await expect(page.getByText(`${second.homework.length} ödev`).first()).toBeVisible()
    await page.getByLabel('Tabloda ara').fill('')
    await expect(resultCount(page)).toContainText(`/ ${second.homework.length} kayıt`)
    await expect(rowOf(page, 'Ödev durumu', first.homework[0]?.record.title ?? '')).toHaveCount(0)

    // Quiz sonuçları: aynı çocuk seçimi sekmeye taşınır ve liste Ece'nin sınıfına aittir.
    await page.getByRole('button', { name: 'Quiz sonuçları', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]cocuk=${ece.id}`))
    await expect(page.getByText(`${second.quizzes.length} quiz`).first()).toBeVisible()
    await expect(resultCount(page)).toContainText(`/ ${second.quizzes.length} kayıt`)
    await page.getByLabel('Çocuk seç').selectOption({ label: 'Deniz Yılmaz' })
    await expect(page.getByText(`${first.quizzes.length} quiz`).first()).toBeVisible()
    await expect(resultCount(page)).toContainText(`/ ${first.quizzes.length} kayıt`)
  })

  test('quiz sonuçları sekmesi çocuğun denemelerinden puanı gösterir', async ({ page, api }) => {
    const parent = await api('veli')
    const attempts = await all<Attempt>(parent, '/api/v1/collections/quizAttempts?studentId=s1')
    const quizzes = await all<Quiz>(parent, '/api/v1/collections/quizzes?classId=c1')
    const attempt = attempts[0]
    const quiz = quizzes.find((row) => row.id === attempt?.record.quizId)
    expect(attempt && quiz).toBeTruthy()
    if (!attempt || !quiz) return

    await page.goto(`${PARENT_TRACKING}?sekme=quizler`)
    await expect(page.getByText(`${quizzes.length} quiz`).first()).toBeVisible()
    await page.getByLabel('Tabloda ara').fill(quiz.record.title)
    const row = rowOf(page, 'Quiz sonuçları', quiz.record.title)
    await expect(row).toContainText('Çözüldü')
    await expect(row).toContainText(`%${attempt.record.score}`)
  })

  test('çocukların sınıfları dışındaki ödev adresi "bulunamadı" görünümüne düşer', async ({
    page,
    api,
  }) => {
    const parent = await api('veli')
    const admin = await api('yonetici')
    const children = await all<{ classId: string }>(parent, '/api/v1/collections/students')
    const classes = new Set(children.map((row) => row.record.classId))
    const foreign = (await all<Homework>(admin, '/api/v1/collections/homework')).find(
      (row) => !classes.has(row.record.classId),
    )
    expect(foreign, 'başka sınıfın ödevi').toBeTruthy()
    expect((await parent.get(`/api/v1/collections/homework/${foreign?.id}`)).status).toBe(404)

    await page.goto(`${PARENT_TRACKING}?sekme=odevler&odev=${foreign?.id}`)
    await expect(panelOf(page, 'Ödev ayrıntısı')).toContainText(NOT_FOUND)
  })

  test('sekme değişince panel parametresi adresten temizlenir', async ({ page }) => {
    await page.goto(`${PARENT_TRACKING}?sekme=odevler&odev=hw2`)
    await expect(panelOf(page, 'Ödev ayrıntısı')).toContainText('Teslim')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Quiz sonuçları', exact: true }).click()
    await expect(page).toHaveURL(/sekme=quizler/)
    await expect(page).not.toHaveURL(/odev=/)
  })
})

test.describe('Öğrenme: dar ekran', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  const screens = [
    ['ogretmen', TEACHER_HOMEWORK],
    ['ogretmen', TEACHER_MATERIALS],
    ['ogretmen', TEACHER_QUIZZES],
    ['ogrenci', STUDENT_HOMEWORK],
    ['ogrenci', STUDENT_MATERIALS],
    ['ogrenci', STUDENT_QUIZZES],
    ['veli', `${PARENT_TRACKING}?sekme=odevler`],
    ['veli', `${PARENT_TRACKING}?sekme=quizler`],
  ] as const

  for (const [role, path] of screens)
    test(`${path} 390 px'te yatay taşmaz`, async ({ page, loginAs }) => {
      await loginAs(role)
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.locator('.data-table')).toBeVisible()
      await expectNoHorizontalOverflow(page)
    })
})
