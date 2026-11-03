import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { markFilesReady } from './support/materials.ts'
import { expectOk, idempotent, type Json } from './support/reading-activity.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Dinleme etkinliği formu (OG-052; IST-045, DOM-BEC-005): öğretmen içerik havuzunda quiz'i dökümlü
// dinleme kaydına bağlar (bağlı içerik seçicisiyle kayıt ve sorular) ve onaya gönderir; dökümsüz
// (yalnız altyazılı) kayıt seçilince Türkçe alan hatası görünür ve gönderi kapanır. Kurulum
// öğretmenin API'siyle (kurum özgün içerik onaysız yayımlanır, DOM-KYN-031).

const TAGS = {
  subjectId: 'english',
  gradeLevels: [7],
  primarySkill: 'listening',
  cefrLevel: 'A2',
  outcomes: [{ outcomeId: 'DIN.7.1', outcomeSource: 'institution' }],
}
const LICENSE = { kind: 'institution_original' }
const TRANSCRIPT = 'Tom reads a book every evening. On Saturday he plays football with his sister.'
const CAPTIONS = 'WEBVTT\n\n00:00.000 --> 00:02.000\nTom reads.'

/** İçerikten tür tespitini geçen küçük MP3 (ID3 başlığı + çerçeve başı). */
const MP3 = Buffer.concat([
  Buffer.from('4944330300000000000a', 'hex'),
  Buffer.alloc(10),
  Buffer.from('fffb9064', 'hex'),
  Buffer.alloc(400),
])

const versioned = (version: number) => ({ ...idempotent(), 'if-match': `"${version}"` })

async function uploadAudio(teacher: ApiClient, institutionId: string, name: string) {
  const response = await teacher.context.fetch('/api/v1/files', {
    method: 'POST',
    multipart: {
      purpose: 'listening_audio',
      file: { name, mimeType: 'audio/mpeg', buffer: MP3 },
    },
    headers: idempotent(),
    failOnStatusCode: false,
  })
  const body = (await response.json()) as { data: { id: string } }
  expect(response.status(), JSON.stringify(body)).toBe(201)
  await markFilesReady(institutionId, { processing: true })
  return body.data.id
}

/** Taslak yazar ve yayımlar; kaynak ve sürüm kimliği döner. */
async function publish(teacher: ApiClient, body: Json) {
  const created = await expectOk(await teacher.post('/api/v1/resources', body, idempotent()))
  const draft = created.version as Json
  const published = await expectOk(
    await teacher.post(
      `/api/v1/resources/${created.resource.id}/versions/${draft.id}/publish`,
      {},
      versioned(draft.rowVersion),
    ),
    200,
  )
  return {
    resourceId: created.resource.id as string,
    versionId: (published.version as Json).id as string,
  }
}

async function recording(
  teacher: ApiClient,
  institutionId: string,
  title: string,
  transcript: string | null,
) {
  const fileId = await uploadAudio(teacher, institutionId, `${randomUUID()}.mp3`)
  return publish(teacher, {
    title,
    content: {
      type: 'audio',
      fileId,
      transcript,
      captionsVtt: transcript === null ? CAPTIONS : null,
    },
    fileIds: [fileId],
    license: LICENSE,
    tags: TAGS,
  })
}

const question = (title: string, stem: string) => ({
  title,
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem,
      options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `Option ${id}` })),
    },
  },
  answerKey: { questionType: 'multiple_choice', correctOptionId: 'a', explanation: 'Açıklama' },
  license: LICENSE,
  tags: TAGS,
})

async function setUp(teacher: ApiClient, institutionId: string) {
  const week = await recording(teacher, institutionId, "Tom's week", TRANSCRIPT)
  const captionsOnly = await recording(teacher, institutionId, 'Captions only', null)
  const reads = await publish(teacher, question('Tom ne okur', 'What does Tom read?'))
  const plays = await publish(teacher, question('Tom ne oynar', 'What does Tom play?'))
  return { week, captionsOnly, reads, plays }
}

async function quizDetail(teacher: ApiClient, title: string) {
  const list = await expectOk(
    await teacher.get('/api/v1/resources?page=1&pageSize=20&contentType=quiz'),
    200,
  )
  const quizId = (list as unknown as Json[]).find((item) => item.version.title === title)?.id
  return expectOk(await teacher.get(`/api/v1/resources/${quizId}`), 200)
}

/** Yeni quiz formunu açar, başlığı ve dinleme kaydını seçer. */
async function startQuiz(page: Page, title: string, recordingTitle: string) {
  await page.goto('/ogretmen/icerik-havuzu')
  await page.getByRole('button', { name: 'Yeni içerik' }).click()
  const form = page.getByRole('dialog', { name: 'Yeni içerik' })
  await form.getByLabel('İçerik türü').selectOption('quiz')
  await form.getByLabel('Başlık').fill(title)
  await form.getByRole('button', { name: 'Dinleme kaydı seç' }).click()
  const picker = page.getByRole('dialog', { name: 'Dinleme kaydı seç' })
  await picker.getByRole('button', { name: `${recordingTitle} seç` }).click()
  await expect(picker).toBeHidden()
  return form
}

/** Soruları ekler, etiket/lisans/beyanı doldurur ve taslağı kaydeder. */
async function finishQuiz(page: Page, form: ReturnType<Page['getByRole']>) {
  await form.getByRole('button', { name: 'Soru ekle' }).click()
  const picker = page.getByRole('dialog', { name: 'Soru ekle' })
  await picker.getByLabel('Tom ne okur').check()
  await picker.getByLabel('Tom ne oynar').check()
  await picker.getByRole('button', { name: 'Seçilenleri ekle (2)' }).click()
  await expect(picker).toBeHidden()
  await expect(
    form.getByRole('list', { name: 'Seçili sorular' }).getByRole('listitem'),
  ).toHaveCount(2)
  await form.getByLabel('Ders').selectOption({ label: 'İngilizce' })
  await form.getByLabel('7. sınıf', { exact: true }).check()
  await form.getByLabel('CEFR düzeyi').selectOption('A2')
  await form.getByRole('button', { name: 'Kazanım ekle' }).click()
  await form.getByLabel('1. kazanım kodu').fill('DIN.7.1')
  await form.getByLabel('Menşe ve lisans').selectOption('institution_original')
  await form.getByLabel(/Bu içeriği kullanma hakkım var/).check()
  await form.getByRole('button', { name: 'Taslağı kaydet' }).click()
}

/** `LINKED_CONTENT_MESSAGES.listening_transcript_required` (react-shared); ekranda aynı metin. */
const TRANSCRIPT_REQUIRED =
  'Dinleme kaydının dökümü yok; kayda döküm ekleyip yayımlayın ya da dökümlü bir kayıt seçin.'

test.describe('dinleme etkinliği formu', () => {
  test('IST-045, DOM-BEC-005: öğretmen dökümlü dinleme kaydı ve iki soruyla quiz kurar ve onaya gönderir; kaydın künyesi görünür', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    const teacher = await api(school.user('ogretmen'))
    const ids = await setUp(teacher, school.institutionId)
    const title = 'Tom dinleme etkinliği'

    await page.setViewportSize({ width: 1280, height: 900 })
    await loginAs(school.user('ogretmen'))
    const form = await startQuiz(page, title, "Tom's week")
    // Odak açan düğmeye döner; düğme artık "Kaydı değiştir".
    await expect(form.getByRole('button', { name: 'Kaydı değiştir' })).toBeFocused()
    const selected = form.getByRole('region', { name: 'Seçili dinleme kaydı' })
    await expect(selected).toContainText("Tom's week")
    await expect(selected).toContainText('A2 · 7. sınıf · Döküm var')
    await expect(form.getByText(TRANSCRIPT_REQUIRED, { exact: true })).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await finishQuiz(page, form)

    const panel = page.getByRole('dialog', { name: title })
    await expect(panel.getByRole('region', { name: 'İçerik önizlemesi' })).toContainText(
      '2 soru · dinleme kaydına bağlı',
    )
    await expect(panel.getByRole('region', { name: 'Yayım sorunları' })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Onaya gönder' }).click()
    await expect(panel.getByText('İncelemede').first()).toBeVisible()

    // Kalıcılık API'den: kayıt bağı ve sorular.
    const detail = await quizDetail(teacher, title)
    expect(detail.head.status).toBe('in_review')
    expect(detail.head.content.listeningVersionId).toBe(ids.week.versionId)
    expect(detail.head.content.passageVersionId).toBeNull()
    expect(
      (detail.head.content.items as Json[]).map((item) => item.questionVersionId).sort(),
    ).toEqual([ids.reads.versionId, ids.plays.versionId].sort())
  })

  test('DOM-BEC-005: dökümsüz kayıt seçilince Türkçe alan hatası; gönderi kapalı; düzenlemede kayıt değiştirilir, kaldırılınca bağ null yazılır ve sorular korunur', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    const teacher = await api(school.user('ogretmen'))
    const ids = await setUp(teacher, school.institutionId)
    const title = 'Altyazılı dinleme etkinliği'

    await loginAs(school.user('ogretmen'))
    const form = await startQuiz(page, title, 'Captions only')
    const selected = form.getByRole('region', { name: 'Seçili dinleme kaydı' })
    await expect(selected).toContainText('Döküm yok')
    const alert = form.getByRole('alert').filter({ hasText: TRANSCRIPT_REQUIRED })
    await expect(alert).toBeVisible()
    await expect(form.getByRole('button', { name: 'Kaydı değiştir' })).toHaveAccessibleDescription(
      TRANSCRIPT_REQUIRED,
    )
    // Taslak eksik kaydedilir; onaya gönderimi sunucu aynı nedenle kapatır.
    await finishQuiz(page, form)
    const panel = page.getByRole('dialog', { name: title })
    const submit = panel.getByRole('button', { name: 'Onaya gönder' })
    await expect(submit).toBeDisabled()
    await expect(submit).toHaveAccessibleDescription(TRANSCRIPT_REQUIRED)

    await panel.getByRole('button', { name: 'Düzenle' }).click()
    const edit = page.getByRole('dialog', { name: 'Taslağı düzenle' })
    const saved = edit.getByRole('region', { name: 'Seçili dinleme kaydı' })
    // Kayıtlı bağın künyesi sürümden okunur; hata alanın altındadır.
    await expect(saved).toContainText('Captions only')
    await expect(saved).toContainText('Döküm yok')
    await expect(edit.getByText(TRANSCRIPT_REQUIRED, { exact: true })).toBeVisible()
    await edit.getByRole('button', { name: 'Kaydı değiştir' }).click()
    const picker = page.getByRole('dialog', { name: 'Dinleme kaydı seç' })
    await expect(picker.getByRole('button', { name: 'Captions only seç' })).toBeDisabled()
    // Satır döküm durumunu seçmeden gösterir (OG-998).
    const rows = picker.getByRole('list', { name: 'Dinleme kayıtları' }).getByRole('listitem')
    await expect(rows.filter({ hasText: 'Captions only' })).toContainText('Döküm yok')
    await expect(rows.filter({ hasText: "Tom's week" })).toContainText('Döküm var')
    await picker.getByRole('button', { name: "Tom's week seç" }).click()
    await expect(saved).toContainText('Döküm var')
    await expect(edit.getByText(TRANSCRIPT_REQUIRED, { exact: true })).toHaveCount(0)
    await edit.getByLabel(/Bu içeriği kullanma hakkım var/).check()
    await edit.getByRole('button', { name: 'Değişiklikleri kaydet' }).click()
    await expect(edit).toBeHidden()
    await expect(submit).toBeEnabled()

    const detail = await quizDetail(teacher, title)
    expect(detail.head.content.listeningVersionId).toBe(ids.week.versionId)
    expect(detail.head.content.items).toHaveLength(2)

    // Kayıt kaldırılır: odak seçim düğmesine geçer; bağ kalıcı olarak `null` yazılır.
    await panel.getByRole('button', { name: 'Düzenle' }).click()
    await expect(saved).toContainText("Tom's week")
    await saved.getByRole('button', { name: 'Kaydı kaldır' }).click()
    await expect(edit.getByRole('button', { name: 'Dinleme kaydı seç' })).toBeFocused()
    await expect(saved).toHaveCount(0)
    await edit.getByLabel(/Bu içeriği kullanma hakkım var/).check()
    await edit.getByRole('button', { name: 'Değişiklikleri kaydet' }).click()
    await expect(edit).toBeHidden()
    await expect(panel.getByRole('region', { name: 'İçerik önizlemesi' })).not.toContainText(
      'dinleme kaydına bağlı',
    )
    // Yeniden açılan düzenleme sunucudaki hali okur: kayıt yok, sorular duruyor.
    await panel.getByRole('button', { name: 'Düzenle' }).click()
    await expect(edit.getByText('Dinleme kaydı seçilmedi.')).toBeVisible()
    await expect(
      edit.getByRole('list', { name: 'Seçili sorular' }).getByRole('listitem'),
    ).toHaveCount(2)
    const cleared = await quizDetail(teacher, title)
    expect(cleared.head.content.listeningVersionId).toBeNull()
    expect(cleared.head.content.items).toHaveLength(2)
  })
})
