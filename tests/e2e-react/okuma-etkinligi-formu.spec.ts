import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { BODY, expectOk, GLOSSARY, idempotent, type Json } from './support/reading-activity.ts'
import { expectNoHorizontalOverflow, pickOutcome } from './support/ui.ts'

// Okuma etkinliği formu (OG-984; IST-042, DOM-BEC-006, DOM-KYN-013): öğretmen içerik havuzunda
// okuma parçasına bağlı quiz'i formdan kurar (bağlı içerik seçicisiyle parça ve sorular), sıralar ve
// onaya gönderir; düzenlemede parçayı değiştirir. Kurulum öğretmenin API'siyle (kendi kapsamlı,
// kurum özgün içerik onaysız yayımlanır, DOM-KYN-031); parça sözlükçesi bağdan etkilenmez.

const TAGS = {
  subjectId: 'english',
  gradeLevels: [7],
  primarySkill: 'reading',
  cefrLevel: 'A2',
  outcomes: [{ outcomeId: 'ENG.7.1.1', outcomeSource: 'platform' }],
}
const LICENSE = { kind: 'institution_original' }
const SECOND_BODY =
  'The harbour wakes up early. Fishermen bring their boats back before the sun is high, and the ' +
  'market fills with voices and the smell of the sea.'

const versioned = (version: number) => ({ ...idempotent(), 'if-match': `"${version}"` })

/** Taslak yazar; `publish` ise yayımlar. Kaynak ve sürüm kimliği döner. */
async function write(teacher: ApiClient, body: Json, publish = true) {
  const created = await expectOk(await teacher.post('/api/v1/resources', body, idempotent()))
  const draft = created.version as Json
  if (!publish) return { resourceId: created.resource.id as string, versionId: draft.id as string }
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

const passage = (title: string, body: string, glossary: readonly Json[]) => ({
  title,
  content: { type: 'reading_passage', body, glossary },
  license: LICENSE,
  tags: TAGS,
})

const question = (title: string, stem: string, subskill: string) => ({
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
  tags: { ...TAGS, subskill },
})

async function setUp(teacher: ApiClient) {
  const ferry = await write(teacher, passage("Ann's ferry", BODY, GLOSSARY))
  const harbour = await write(
    teacher,
    passage('Harbour morning', SECOND_BODY, [{ term: 'harbour', meaning: 'Liman.' }]),
  )
  const draftPassage = await write(
    teacher,
    passage('Unfinished lighthouse', SECOND_BODY, []),
    false,
  )
  const main = await write(
    teacher,
    question('Feribot ana fikir', 'What is the text about?', 'main_idea'),
  )
  const detail = await write(
    teacher,
    question('Feribot ayrıntı', 'How does Ann go to work?', 'detail'),
  )
  const draftQuestion = await write(
    teacher,
    question('Feribot taslak soru', 'Is it raining?', 'inference'),
    false,
  )
  return { ferry, harbour, draftPassage, main, detail, draftQuestion }
}

async function glossaryOf(teacher: ApiClient, resourceId: string) {
  const detail = await expectOk(await teacher.get(`/api/v1/resources/${resourceId}`), 200)
  return (detail.head as Json).content.glossary as Json[]
}

const formOf = (page: Page) => page.getByRole('dialog', { name: 'Yeni içerik' })

test.describe('okuma etkinliği formu', () => {
  test('IST-042, DOM-BEC-006: öğretmen parça ve iki soruyla quiz kurar, sıralar ve onaya gönderir; alt beceri görünür, taslak içerik seçilemez', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    const teacher = await api(school.user('ogretmen'))
    const ids = await setUp(teacher)
    const title = 'Feribot okuma etkinliği'

    await page.setViewportSize({ width: 1280, height: 900 })
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/icerik-havuzu')
    await page.getByRole('button', { name: 'Yeni içerik' }).click()
    const form = formOf(page)
    await form.getByLabel('İçerik türü').selectOption('quiz')
    await form.getByLabel('Başlık').fill(title)

    // Parça seçici: iç içe pencere; arama ve CEFR süzgeci, taslak parça kapalı.
    await form.getByRole('button', { name: 'Okuma parçası seç' }).click()
    const passages = page.getByRole('dialog', { name: 'Okuma parçası seç' })
    await expect(passages.getByRole('button', { name: 'Unfinished lighthouse seç' })).toBeDisabled()
    await passages.getByLabel('CEFR düzeyi').selectOption('A2')
    await passages.getByRole('searchbox', { name: 'Okuma parçası ara' }).fill('ferry')
    await expect(passages.getByRole('button', { name: 'Harbour morning seç' })).toHaveCount(0)
    await passages.getByRole('button', { name: "Ann's ferry seç" }).click()
    await expect(passages).toBeHidden()
    // Odak açan düğmeye döner; düğme artık "Parçayı değiştir".
    await expect(form.getByRole('button', { name: 'Parçayı değiştir' })).toBeFocused()
    await expect(form.getByRole('region', { name: 'Seçili okuma parçası' })).toContainText(
      "Ann's ferry",
    )

    // Soru seçici: çoklu seçim; alt beceri satırda, taslak soru kapalı.
    await form.getByRole('button', { name: 'Soru ekle' }).click()
    const picker = page.getByRole('dialog', { name: 'Soru ekle' })
    await expect(picker.getByLabel('Feribot taslak soru')).toBeDisabled()
    await picker.getByLabel('Feribot ana fikir').check()
    await picker.getByLabel('Feribot ayrıntı').check()
    await picker.getByRole('button', { name: 'Seçilenleri ekle (2)' }).click()
    await expect(picker).toBeHidden()

    const list = form.getByRole('list', { name: 'Seçili sorular' })
    await expect(list.getByRole('listitem')).toHaveCount(2)
    await expect(list.getByRole('listitem').nth(0)).toContainText('Ana fikir')
    // Sıra düğmeyle değişir; odak taşınan satırda kalır.
    await list.getByRole('button', { name: '2. soruyu yukarı taşı' }).click()
    await expect(list.getByRole('listitem').nth(0)).toContainText('Feribot ayrıntı')
    await expect(list.getByRole('listitem').nth(0)).toContainText('Ayrıntı')
    await expect(list.getByRole('button', { name: '1. soruyu aşağı taşı' })).toBeFocused()
    await form.getByLabel('1. sorunun puanı').fill('2')

    await form.getByLabel('Ders').selectOption({ label: 'İngilizce' })
    await form.getByLabel('7. sınıf', { exact: true }).check()
    await form.getByLabel('CEFR düzeyi').selectOption('A2')
    await pickOutcome(form, 'ENG.7.1.1')
    await form.getByLabel('Menşe ve lisans').selectOption('institution_original')
    await form.getByLabel(/Bu içeriği kullanma hakkım var/).check()
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await form.getByRole('button', { name: 'Taslağı kaydet' }).click()

    const panel = page.getByRole('dialog', { name: title })
    await expect(panel.getByRole('region', { name: 'İçerik önizlemesi' })).toContainText(
      '2 soru · okuma parçasına bağlı',
    )
    await expect(panel.getByRole('region', { name: 'Yayım sorunları' })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Onaya gönder' }).click()
    await expect(panel.getByText('İncelemede').first()).toBeVisible()

    // Kalıcılık API'den: parça bağı, sıra ve puan; parça sözlükçesi değişmedi.
    const items = await expectOk(
      await teacher.get('/api/v1/resources?page=1&pageSize=20&contentType=quiz'),
      200,
    )
    const quizId = (items as unknown as Json[]).find((item) => item.version.title === title)?.id
    const detail = await expectOk(await teacher.get(`/api/v1/resources/${quizId}`), 200)
    expect(detail.head.status).toBe('in_review')
    expect(detail.head.content.passageVersionId).toBe(ids.ferry.versionId)
    expect(detail.head.content.items).toEqual([
      { questionVersionId: ids.detail.versionId, points: 2 },
      { questionVersionId: ids.main.versionId, points: 1 },
    ])
    expect(await glossaryOf(teacher, ids.ferry.resourceId)).toEqual([
      { ...GLOSSARY[0] },
      { ...GLOSSARY[1], example: null },
    ])
  })

  test('DOM-BEC-006: taslak parçaya bağlı etkinlikte gönderi Türkçe nedenle kapalı; düzenlemede parça değiştirilir, sorular ve sözlükçe korunur', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    const teacher = await api(school.user('ogretmen'))
    const ids = await setUp(teacher)
    const title = 'Deniz feneri etkinliği'
    const items = [
      { questionVersionId: ids.main.versionId, points: 1 },
      { questionVersionId: ids.detail.versionId, points: 3 },
    ]
    await write(
      teacher,
      {
        title,
        content: { type: 'quiz', items, passageVersionId: ids.draftPassage.versionId },
        license: LICENSE,
        tags: TAGS,
      },
      false,
    )

    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/icerik-havuzu')
    await page.getByRole('button', { name: title, exact: true }).click()
    const panel = page.getByRole('dialog', { name: title })
    const notPublished =
      'Okuma parçası yayında değil; önce parçayı yayımlayın ya da yayındaki bir parça seçin.'
    const submit = panel.getByRole('button', { name: 'Onaya gönder' })
    await expect(submit).toBeDisabled()
    await expect(submit).toHaveAccessibleDescription(notPublished)

    await panel.getByRole('button', { name: 'Düzenle' }).click()
    const form = page.getByRole('dialog', { name: 'Taslağı düzenle' })
    const selected = form.getByRole('region', { name: 'Seçili okuma parçası' })
    // Kayıtlı bağın özeti listeden çözülür; sunucu uyarısı parça alanındadır.
    await expect(selected).toContainText('Unfinished lighthouse')
    await expect(form.getByText(notPublished, { exact: true })).toBeVisible()
    const list = form.getByRole('list', { name: 'Seçili sorular' })
    await expect(list.getByRole('listitem').nth(0)).toContainText('Feribot ana fikir')
    await expect(form.getByLabel('2. sorunun puanı')).toHaveValue('3')

    await form.getByRole('button', { name: 'Parçayı değiştir' }).click()
    const passages = page.getByRole('dialog', { name: 'Okuma parçası seç' })
    await expect(passages.getByRole('button', { name: 'Unfinished lighthouse seç' })).toBeDisabled()
    await passages.getByRole('button', { name: 'Harbour morning seç' }).click()
    await expect(selected).toContainText('Harbour morning')
    // Uyarı kayıtlı parçanındı; parça değişince kalkar.
    await expect(form.getByText(notPublished, { exact: true })).toHaveCount(0)
    await form.getByLabel(/Bu içeriği kullanma hakkım var/).check()
    await form.getByRole('button', { name: 'Değişiklikleri kaydet' }).click()
    await expect(form).toBeHidden()

    await expect(submit).toBeEnabled()
    await expect(panel.getByRole('region', { name: 'Yayım sorunları' })).toHaveCount(0)

    const list2 = await expectOk(
      await teacher.get('/api/v1/resources?page=1&pageSize=20&contentType=quiz'),
      200,
    )
    const quizId = (list2 as unknown as Json[]).find((item) => item.version.title === title)?.id
    const detail = await expectOk(await teacher.get(`/api/v1/resources/${quizId}`), 200)
    expect(detail.head.content.passageVersionId).toBe(ids.harbour.versionId)
    expect(detail.head.content.items).toEqual(items)
    // Bağ değişikliği parçalara yazmaz: iki parçanın sözlükçesi aynen durur.
    expect(await glossaryOf(teacher, ids.harbour.resourceId)).toEqual([
      { term: 'harbour', meaning: 'Liman.', example: null },
    ])
    expect(await glossaryOf(teacher, ids.ferry.resourceId)).toHaveLength(GLOSSARY.length)
  })
})
