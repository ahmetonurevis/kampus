import { wordCount } from '../../packages/school-core/src/content/resource.ts'

import { expect, test } from './support/fixtures.ts'
import {
  answerAll,
  BODY,
  breakdownOf,
  expectOk,
  GLOSSARY,
  glossaryOf,
  PASSAGE_TITLE,
  passageOf,
  QUESTIONS,
  SECRET_EXPLANATION,
  setUp,
  startAttempt,
  submitAttempt,
} from './support/reading-activity.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Okuma-anlama etkinliği (OG-051; IST-042; DOM-BEC-006, DOM-BEC-045, DOM-KYN-002, DOM-KYN-024):
// okuma parçasına bağlı quiz; kurulum `support/reading-activity.ts` (yönetici API'si). Öğrenci
// metni, kelime sayısını, seviyeyi, kaynak gösterimini ve sözlükçeyi görür, soru başında alt
// beceriyi okur, cevaplar ve teslim eder. Alt beceri dökümü madde sonuçlarıyla aynı anda açılır:
// alıştırmada teslimde görünür, değerlendirmede kapanışa kadar hiç çizilmez.

test.describe('okuma-anlama etkinliği', () => {
  test('IST-042, DOM-BEC-006: alıştırmada öğrenci metni, kelime sayısını ve sözlükçeyi görür; teslimde alt beceri dökümü açılır', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const { school, assignmentId } = await setUp(tenant, api, 'Feribot okuma alıştırması', {
      kind: 'practice',
    })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAs(school.user('ogrenci'))
    await startAttempt(page, assignmentId)

    // Parça: başlık, seviye, sistemin saydığı kelime sayısı (DOM-KYN-002), kaynak gösterimi.
    const passage = passageOf(page)
    await expect(passage.getByRole('heading', { name: PASSAGE_TITLE })).toBeVisible()
    await expect(passage.getByText('CEFR A2', { exact: true })).toBeVisible()
    await expect(passage.getByText(`${wordCount(BODY)} kelime`, { exact: true })).toBeVisible()
    await expect(passage.getByText(/Every morning she takes the ferry/)).toBeVisible()
    await expect(passage.getByRole('region', { name: 'Kaynak gösterimi' })).toContainText(
      'Kampüs yazarları',
    )
    // Sözlükçe terim + anlam + örnek.
    const glossary = glossaryOf(page)
    await expect(glossary.getByRole('term')).toHaveCount(GLOSSARY.length)
    await expect(glossary.getByText('ferry', { exact: true })).toBeVisible()
    await expect(glossary.getByText(GLOSSARY[0].meaning, { exact: true })).toBeVisible()
    await expect(glossary.getByText(GLOSSARY[0].example, { exact: true })).toBeVisible()
    await expect(glossary.getByText(GLOSSARY[1].meaning, { exact: true })).toBeVisible()
    // Başlık sırası: metin başlığı h2 (deneme başlığıyla kardeş), sözlükçe başlığı h3.
    await expect(passage.getByRole('heading', { level: 2, name: PASSAGE_TITLE })).toBeVisible()
    await expect(glossary.getByRole('heading', { level: 3, name: 'Sözlükçe' })).toBeVisible()
    // Metin kutuya sığıyorsa bölge Tab durağı olmaz; alçak pencerede kayar ve odaklanır.
    await expect(passage).not.toHaveAttribute('tabindex')
    const question = page.getByText(QUESTIONS[0].stem, { exact: true })
    const [textBox, questionBox] = await Promise.all([
      passage.boundingBox(),
      question.boundingBox(),
    ])
    expect(textBox && questionBox && questionBox.x >= textBox.x + textBox.width).toBe(true)
    await page.setViewportSize({ width: 1280, height: 360 })
    await expect(passage).toHaveAttribute('tabindex', '0')
    await passage.focus()
    await expect(passage).toBeFocused()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(passage).not.toHaveAttribute('tabindex')

    // Soru başında alt beceri etiketi; çözümde doğru cevap ve açıklama yok.
    await expect(page.getByText('Ana fikir', { exact: true })).toBeVisible()
    await answerAll(page, ["Ann's trip to work.", 'By bus.', 'She enjoys it.'])
    await expect(page.getByRole('main')).not.toContainText(SECRET_EXPLANATION)
    await submitAttempt(page)

    // 3 / 4 puan; döküm yalnız etiketli alt becerilerle ve gerçek madde puanlarıyla.
    await expect(page.getByLabel('Puan 100 üzerinden 75')).toBeVisible()
    const breakdown = breakdownOf(page)
    await expect(breakdown.locator('tbody tr')).toHaveCount(3)
    const row = (label: string) => breakdown.locator('tbody tr').filter({ hasText: label })
    await expect(row('Ana fikir')).toContainText('1 / 1')
    await expect(row('Ana fikir')).toContainText('%100')
    await expect(row('Ayrıntı')).toContainText('0 / 1')
    await expect(row('Ayrıntı')).toContainText('%0')
    await expect(row('Çıkarım')).toContainText('2 / 2')
    await expect(row('Kelime bilgisi')).toHaveCount(0)

    // Dar ekranda döküm görünürken taşma yok; tablo kayarsa kapsayıcı klavyeyle odaklanır.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await expect(breakdown).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }
    const scroller = page.getByRole('region', { name: 'Alt beceri dökümü (kaydırılabilir)' })
    if ((await scroller.count()) > 0) {
      await scroller.focus()
      await expect(scroller).toBeFocused()
    }
  })

  test('DOM-BEC-045, DOM-BEC-006: değerlendirmede döküm kapanışa kadar çizilmez; dar ekranda metin soruların üstünde, taşma yok', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const { school, assignmentId, student } = await setUp(
      tenant,
      api,
      'Feribot okuma değerlendirmesi',
      { kind: 'evaluation', maxAttempts: 1 },
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(school.user('ogrenci'))
    await startAttempt(page, assignmentId)

    const passage = passageOf(page)
    const question = page.getByText(QUESTIONS[0].stem, { exact: true })
    const [textBox, questionBox] = await Promise.all([
      passage.boundingBox(),
      question.boundingBox(),
    ])
    expect(textBox && questionBox && questionBox.y >= textBox.y + textBox.height).toBe(true)
    await expect(glossaryOf(page).getByText('gull', { exact: true })).toBeVisible()
    // Dar ekranda sayfa kayar, metin bölgesi gereksiz Tab durağı olmaz.
    await expect(passage).not.toHaveAttribute('tabindex')
    await expectNoHorizontalOverflow(page)

    await answerAll(page, ["Ann's trip to work.", 'By ferry.', 'She is bored.'])
    await submitAttempt(page)
    await expect(page.getByLabel('Puan 100 üzerinden 50')).toBeVisible()
    await expect(breakdownOf(page)).toHaveCount(0)
    await expect(page.getByText('Alt beceri', { exact: false })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)

    // Sunucu da dökümü açmaz (istemciye güvenilmez).
    const attempts = await expectOk(
      await student.get(`/api/v1/task-attempts?assignmentId=${assignmentId}&page=1&pageSize=20`),
      200,
    )
    const attemptId = (attempts as unknown as { id: string }[])[0]?.id
    const detail = await expectOk(await student.get(`/api/v1/task-attempts/${attemptId}`), 200)
    expect(detail.result.subskills).toBeNull()
    expect(detail.result.items).toBeNull()
  })

  test('DOM-BEC-006: içerik havuzunda okuma parçasına sözlükçe yazılır; şema hatası alanın altında görünür', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({ roles: [] })
    const admin = await api(school.user('yonetici'))
    const title = 'Sözlükçeli feribot parçası'
    await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/icerik-havuzu')
    await page.getByRole('button', { name: 'Yeni içerik' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni içerik' })
    await dialog.getByLabel('Başlık').fill(title)
    await dialog.getByLabel('Okuma metni').fill(BODY)
    const glossary = dialog.getByRole('group', { name: 'Sözlükçe' })
    // Alt beceri yalnız soruda seçilir; okuma parçası formunda alan yoktur.
    await expect(dialog.getByLabel('Alt beceri')).toHaveCount(0)

    await glossary.getByRole('button', { name: 'Kelime ekle' }).click()
    await glossary.getByRole('button', { name: 'Kelime ekle' }).click()
    await glossary.getByLabel('1. kelime', { exact: true }).fill('Ferry')
    await glossary.getByLabel('1. kelimenin anlamı').fill(GLOSSARY[0].meaning)
    await glossary.getByLabel('1. örnek cümle (isteğe bağlı)').fill(GLOSSARY[0].example)
    await glossary.getByLabel('2. kelime', { exact: true }).fill('ferry')
    await dialog.getByLabel('Ders').selectOption({ label: 'İngilizce' })
    await dialog.getByLabel('7. sınıf', { exact: true }).check()
    await dialog.getByLabel('CEFR düzeyi').selectOption('A2')
    await dialog.getByLabel('Menşe ve lisans').selectOption('institution_original')
    await dialog.getByLabel(/Bu içeriği kullanma hakkım var/).check()
    await dialog.getByRole('button', { name: 'Taslağı kaydet' }).click()

    // Core `glossaryEntrySchema`: boş anlam alanın altında, yinelenen kelime listenin altında.
    await expect(glossary.getByText('Anlamını yazın.', { exact: true })).toBeVisible()
    await expect(glossary.getByLabel('2. kelimenin anlamı')).toHaveAttribute('aria-invalid', 'true')
    await glossary.getByLabel('2. kelime', { exact: true }).fill(GLOSSARY[1].term)
    await glossary.getByLabel('2. kelimenin anlamı').fill(GLOSSARY[1].meaning)
    await glossary.getByRole('button', { name: 'Kelime ekle' }).click()
    await glossary.getByLabel('3. kelime', { exact: true }).fill('ferry')
    await glossary.getByLabel('3. kelimenin anlamı').fill('feribot')
    await dialog.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(
      glossary.getByText('Aynı kelime sözlükçede bir kez yer alır.', { exact: true }),
    ).toBeVisible()
    await glossary.getByRole('button', { name: '3. kelimeyi sil' }).click()
    // Silinen satırın düğmesi kalkınca odak önceki satırın kelime alanına gider (body'ye düşmez).
    await expect(glossary.getByLabel('2. kelime', { exact: true })).toBeFocused()
    await dialog.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(page.getByRole('dialog', { name: title })).toBeVisible()

    // Kalıcılık API'den: sıra yazarınki, boş örnek cümle `null`.
    const list = await expectOk(await admin.get('/api/v1/resources?page=1&pageSize=20'), 200)
    const id = (list as unknown as { id: string; version: { title: string } }[]).find(
      (item) => item.version.title === title,
    )?.id
    const detail = await expectOk(await admin.get(`/api/v1/resources/${id}`), 200)
    expect(detail.head.content.glossary).toEqual([
      { term: 'Ferry', meaning: GLOSSARY[0].meaning, example: GLOSSARY[0].example },
      { term: GLOSSARY[1].term, meaning: GLOSSARY[1].meaning, example: null },
    ])
  })
})
