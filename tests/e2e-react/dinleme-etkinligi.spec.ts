import { randomUUID } from 'node:crypto'

import { expect, test } from './support/fixtures.ts'
import {
  assignListening,
  expectOk,
  fileUrlResponse,
  hasFfmpeg,
  QUESTION,
  QUIZ_TITLE,
  RECORDING_TITLE,
  recordingOf,
  setUp,
  TEACHES_ENGLISH,
  TRANSCRIPT,
  publishListeningQuiz,
  publishQuestion,
  publishQuiz,
  publishRecording,
  type Json,
} from './support/listening-activity.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Dinleme etkinliği (OG-052; IST-045, DOM-BEC-005): dinleme kaydına bağlı quiz. Öğrenci denemede
// kaydı soruların üstünde dinler; bağlantı denemenin kimliğiyle istenir ve hak sayılır. Bir dinleme
// bir bağlantı ömrüdür: sayfa yenilenince aynı pencerede yeni istek sayılmaz; pencere kapanınca hak
// bitmişse oynatıcı kilitlenir. Değerlendirme kapanmadan döküm kursiyere gösterilmez; personel
// dökümü hep görür ve kaydı sayılmadan dinler. Kurulum `support/listening-activity.ts` (öğretmen
// API'si); ses dönüşümü `ffmpeg` ister: yoksa yerelde atlanır, CI'da açık hatayla durur.

test.skip(!hasFfmpeg && !process.env.CI, 'ffmpeg/ffprobe PATH üzerinde yok: ses dönüşümü denenemez')
test.beforeEach(() => {
  if (!hasFfmpeg && process.env.CI)
    throw new Error('CI ortamında ffmpeg/ffprobe kurulu olmalı (checks.yml e2e-react işi).')
})

const PLAIN_QUIZ_TITLE = 'Kayıtsız okuma sınavı'

type Listening = { limit: number; media: { fileId: string; used: number; remaining: number }[] }

test.describe('dinleme etkinliği', () => {
  test('IST-045, DOM-BEC-005: öğrenci 1 haklı kaydı dinler; yenilemede hak yeniden sayılmaz, pencere kapanınca oynatıcı kilitlenir', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const { school, assignmentId, student } = await setUp(tenant, api, { listeningPlays: 1 })
    await page.clock.install()
    await page.setViewportSize({ width: 1280, height: 900 })
    await loginAs(school.user('ogrenci'))
    await page.goto(`/ogrenci/soru-coz?coz=${assignmentId}`)
    await page.getByRole('button', { name: 'Denemeyi başlat' }).click()

    // Kayıt soruların üstünde: başlık, seviye, sakin sayaç; değerlendirmede döküm yok.
    const recording = recordingOf(page)
    await expect(recording.getByRole('heading', { name: RECORDING_TITLE })).toBeVisible()
    await expect(recording.getByText('CEFR A2', { exact: true })).toBeVisible()
    await expect(recording.getByText('1 dinleme hakkınız var.')).toBeVisible()
    await expect(recording.getByRole('button', { name: 'Dökümü göster' })).toHaveCount(0)
    await expect(page.getByRole('main')).not.toContainText(TRANSCRIPT)
    await expect(recording.getByRole('list', { name: 'Kaynak gösterimi' })).toContainText(
      'Kampüs yazarları',
    )
    const question = page.getByText(QUESTION.stem, { exact: true })
    await expect(question).toBeVisible()
    const [recordingBox, questionBox] = await Promise.all([
      recording.boundingBox(),
      question.boundingBox(),
    ])
    expect(recordingBox && questionBox && questionBox.y > recordingBox.y).toBe(true)

    // Dinle: bağlantı denemenin kimliğiyle istenir ve hak sayılır.
    const first = fileUrlResponse(page)
    await recording.getByRole('button', { name: 'Kaydı dinle' }).click()
    const counted = await first
    expect(counted.url()).toContain('attemptId=')
    expect(((await counted.json()) as { data: Json }).data.listening).toMatchObject({
      limit: 1,
      used: 1,
      remaining: 0,
      counted: true,
    })
    const audio = recording.locator('audio')
    await expect(audio).toHaveAttribute('src', /.+/)
    await expect(audio).toHaveAttribute('aria-label', `Dinleme kaydı: ${RECORDING_TITLE}`)
    await expect(recording.getByText('Dinleme hakkınız doldu.')).toBeVisible()

    // Sayfa yenilenince süren dinleme sürdürülür; aynı pencerede hak yeniden sayılmaz.
    await page.reload()
    await expect(recording.getByText('Dinleme hakkınız doldu.')).toBeVisible()
    const resumed = fileUrlResponse(page)
    await recording.getByRole('button', { name: 'Dinlemeyi sürdür' }).click()
    expect(((await (await resumed).json()) as { data: Json }).data.listening).toMatchObject({
      used: 1,
      remaining: 0,
      counted: false,
    })
    await expect(audio).toHaveAttribute('src', /.+/)
    const attempts = await expectOk(
      await student.get(`/api/v1/task-attempts?assignmentId=${assignmentId}&page=1&pageSize=20`),
      200,
    )
    const attemptId = (attempts as unknown as { id: string }[])[0]?.id
    const detail = await expectOk(await student.get(`/api/v1/task-attempts/${attemptId}`), 200)
    expect((detail.listening as Listening).media[0]).toMatchObject({ used: 1, remaining: 0 })

    // Bağlantının ömrü (en az 5 dk) dolunca hak bitmiş oynatıcı kilitlenir; düğme kalmaz.
    await page.clock.fastForward('20:00')
    await expect(
      recording.getByText('Dinleme hakkınız doldu; kayıt bu denemede yeniden açılmaz.'),
    ).toBeVisible()
    await expect(audio).toHaveCount(0)
    await expect(recording.getByRole('button')).toHaveCount(0)

    // Dar ekranda taşma yok.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(recording).toBeVisible()
    await expectNoHorizontalOverflow(page)

    // Teslimden sonra sonuç ekranı; görev açıkken kayıt sonuçta açılmaz, döküm yok.
    await page.getByRole('radio', { name: 'He reads.', exact: true }).check()
    await expect(page.getByText('Cevaplarınız kaydedildi.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Denemeyi teslim et' }).first().click()
    await page
      .getByRole('dialog', { name: 'Deneme teslim edilsin mi?' })
      .getByRole('button', { name: 'Teslim et' })
      .click()
    await expect(page.getByRole('heading', { name: '1. deneme sonucu' })).toBeVisible()
    await expect(page.getByLabel('Puan 100 üzerinden 100')).toBeVisible()
    const result = recordingOf(page)
    await expect(
      result.getByText('Kayıt, görev kapanınca burada yeniden dinlenebilir.'),
    ).toBeVisible()
    await expect(result.getByRole('button', { name: 'Kaydı dinle' })).toHaveCount(0)
    await expect(page.getByRole('main')).not.toContainText(TRANSCRIPT)
  })

  test('IST-045, DOM-BEC-005: öğretmen deneme ayrıntısında kaydı ve dökümü görür, kayıt sayılmadan çalınır', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const { school, assignmentId, student } = await setUp(tenant, api, { listeningPlays: 2 })
    const started = await expectOk(
      await student.post(
        `/api/v1/task-assignments/${assignmentId}/attempts`,
        {},
        { 'idempotency-key': randomUUID() },
      ),
    )
    const answers = Object.fromEntries(
      (started.questions as { questionVersionId: string }[]).map((item) => [
        item.questionVersionId,
        { questionType: 'multiple_choice', optionId: 'a' },
      ]),
    )
    await expectOk(
      await student.post(
        `/api/v1/task-attempts/${started.id}/submit`,
        { answers },
        { 'idempotency-key': randomUUID(), 'if-match': `"${started.rowVersion}"` },
      ),
      200,
    )

    await page.setViewportSize({ width: 1280, height: 900 })
    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/odevler?sekme=gorevler&deneme=${started.id}`)
    const review = page.getByRole('dialog', { name: 'Deneme ayrıntısı' })
    const recording = review.getByRole('region', { name: RECORDING_TITLE, exact: true })
    await expect(recording.getByRole('heading', { name: RECORDING_TITLE })).toBeVisible()
    // Personelde sayaç yok; döküm katlanır bölümde.
    await expect(recording.getByText(/dinleme hakk/)).toHaveCount(0)
    await expect(recording.getByText(TRANSCRIPT)).toHaveCount(0)
    await recording.getByRole('button', { name: 'Dökümü göster' }).click()
    await expect(recording.getByText(TRANSCRIPT)).toBeVisible()
    await expect(recording.getByRole('button', { name: 'Dökümü gizle' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    const link = fileUrlResponse(page)
    await recording.getByRole('button', { name: 'Kaydı dinle' }).click()
    const response = await link
    expect(response.url()).not.toContain('attemptId=')
    expect(((await response.json()) as { data: Json }).data.listening).toBeNull()
    const audio = recording.locator('audio')
    await expect(audio).toHaveAttribute('src', /.+/)
    // Altyazı Blob adresiyle bağlanır.
    await expect(audio.locator('track[kind="captions"]')).toHaveAttribute('src', /^blob:/)
    // <audio> altyazıyı çizmez: döküm açıkken etkin satır oynatıcının altında okunur.
    await expect(recording.getByRole('status', { name: 'Altyazı' })).toHaveAttribute(
      'aria-live',
      'polite',
    )

    // Öğretmenin dinlemesi öğrencinin hakkından düşmez.
    const detail = await expectOk(await student.get(`/api/v1/task-attempts/${started.id}`), 200)
    expect((detail.listening as Listening).media[0]).toMatchObject({ used: 0, remaining: 2 })
  })

  test('IST-045, DOM-BEC-005: atama formunda dinleme hakkı yalnız kayda bağlı içerikte seçilir', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({
      classes: ['c1'],
      roles: ['ogretmen'],
      records: TEACHES_ENGLISH,
    })
    const teacher = await api(school.user('ogretmen'))
    await publishListeningQuiz(teacher)
    // Kaydı olmayan quiz: dinleme hakkı sayılmaz, alan gösterilmez.
    await publishQuiz(teacher, PLAIN_QUIZ_TITLE, await publishQuestion(teacher), null)

    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/odevler?sekme=gorevler')
    await page.getByRole('button', { name: 'Yeni görev' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni görev ata' })
    await expect(dialog.getByLabel('Dinleme hakkı')).toHaveCount(0)
    await dialog.getByLabel('Görev türü').selectOption('quiz')
    const content = dialog.getByLabel('İçerik', { exact: true })
    const plays = dialog.getByLabel('Dinleme hakkı')
    const assignButton = dialog.getByRole('button', { name: 'Görevi ata' })
    await content.selectOption({ label: PLAIN_QUIZ_TITLE })
    await expect(assignButton).toBeEnabled()
    await expect(plays).toHaveCount(0)

    // Kaynak değişince alan yeni içeriğe göre güncellenir; seçim içerik değişse de korunur.
    await content.selectOption({ label: QUIZ_TITLE })
    await expect(plays).toHaveValue('2')
    await plays.selectOption('1')
    await content.selectOption({ label: PLAIN_QUIZ_TITLE })
    await expect(plays).toHaveCount(0)
    await expect(assignButton).toBeEnabled()
    await content.selectOption({ label: QUIZ_TITLE })
    await expect(plays).toHaveValue('1')
    await dialog.getByLabel('7-A', { exact: true }).check()
    await dialog.getByLabel('Son teslim', { exact: true }).fill('2099-01-15T18:00')
    await dialog.getByRole('button', { name: 'Görevi ata' }).click()
    const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
    await expect(panel.getByRole('heading', { name: QUIZ_TITLE })).toBeVisible()

    // Kalıcılık API'den: hak atamaya 1 olarak sabitlendi.
    const list = await expectOk(
      await teacher.get('/api/v1/task-assignments?page=1&pageSize=20'),
      200,
    )
    const saved = (list as unknown as { title: string; listeningPlays: number | null }[]).find(
      (item) => item.title === QUIZ_TITLE,
    )
    expect(saved?.listeningPlays).toBe(1)
  })

  test('IST-045, DOM-BEC-005 (Sabah kararı 56): sınırsız görevin sonucundan dinleme, aynı kaydı bağlayan sınırlı görevin süren denemesinde reddedilir; hak yanmaz', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({
      classes: ['c1'],
      roles: ['ogretmen', 'ogrenci'],
      records: TEACHES_ENGLISH,
    })
    const teacher = await api(school.user('ogretmen'))
    const student = await api(school.user('ogrenci'))
    const recordingVersionId = await publishRecording(teacher)
    const questionVersionId = await publishQuestion(teacher)
    const unlimitedQuiz = await publishQuiz(
      teacher,
      QUIZ_TITLE,
      questionVersionId,
      recordingVersionId,
    )
    const limitedQuiz = await publishQuiz(
      teacher,
      'Tom tekrar sınavı',
      questionVersionId,
      recordingVersionId,
    )
    const unlimited = await assignListening(teacher, unlimitedQuiz, null)
    const limited = await assignListening(teacher, limitedQuiz, 2)

    // A (sınırsız) teslim edildi; B (sınırlı) sürüyor.
    const finished = await expectOk(
      await student.post(
        `/api/v1/task-assignments/${unlimited}/attempts`,
        {},
        { 'idempotency-key': randomUUID() },
      ),
    )
    await expectOk(
      await student.post(
        `/api/v1/task-attempts/${finished.id}/submit`,
        {},
        { 'idempotency-key': randomUUID(), 'if-match': `"${finished.rowVersion}"` },
      ),
      200,
    )
    const running = await expectOk(
      await student.post(
        `/api/v1/task-assignments/${limited}/attempts`,
        {},
        { 'idempotency-key': randomUUID() },
      ),
    )

    await page.setViewportSize({ width: 1280, height: 900 })
    await loginAs(school.user('ogrenci'))
    await page.goto(`/ogrenci/soru-coz?coz=${unlimited}`)
    await expect(page.getByRole('heading', { name: '1. deneme sonucu' })).toBeVisible()
    const result = recordingOf(page)
    const refused = fileUrlResponse(page)
    await result.getByRole('button', { name: 'Kaydı dinle' }).click()
    const response = await refused
    expect(response.url()).not.toContain('attemptId=')
    expect(response.status()).toBe(422)
    await expect(
      result.getByText(
        'Bu kayıt süren bir denemenizde sınırlı; dinlemeyi o denemenin ekranından açın.',
      ),
    ).toBeVisible()
    await expect(result.locator('audio')).toHaveCount(0)

    // B'nin hakkı yanmadı.
    const detail = await expectOk(await student.get(`/api/v1/task-attempts/${running.id}`), 200)
    expect((detail.listening as Listening).media[0]).toMatchObject({ used: 0, remaining: 2 })

    // Geçici ret notun altında "Yeniden dene" bırakır (OG-998). B teslim edilince yeniden deneme
    // sunucuya yeniden sorar; sınırlı görev hâlâ açık olduğundan kalıcı ret gelir, düğme kalkar.
    const retry = result.getByRole('button', { name: 'Yeniden dene' })
    await expect(retry).toBeVisible()
    await expectOk(
      await student.post(
        `/api/v1/task-attempts/${running.id}/submit`,
        {},
        { 'idempotency-key': randomUUID(), 'if-match': `"${running.rowVersion}"` },
      ),
      200,
    )
    const again = fileUrlResponse(page)
    await retry.click()
    expect((await again).status()).toBe(422)
    await expect(
      result.getByText('Kayıt, görev açıkken yalnız denemenin içinde dinlenebilir.'),
    ).toBeVisible()
    await expect(retry).toHaveCount(0)
  })
})
