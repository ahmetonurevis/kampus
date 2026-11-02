import { randomUUID } from 'node:crypto'

import { expect, test } from './support/fixtures.ts'
import {
  answerAll,
  breakdownOf,
  PASSAGE_TITLE,
  passageOf,
  QUESTIONS,
  SECRET_EXPLANATION,
  setUp,
  startAttempt,
  submitAttempt,
} from './support/reading-activity.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Personelin deneme görünümü (OG-983; DOM-BEC-006, DOM-BEC-045, DOM-YTK-028): öğrenci okuma
// etkinliğini teslim eder; sınıfın öğretmeni atama panelinde denemeyi (durum, puan, teslim zamanı)
// görür ve `?deneme=` penceresinde okuma metnini, öğrencinin cevaplarını, madde sonuçlarını ve alt
// beceri dökümünü okur. Değerlendirme kapanmadığı için doğru cevap ve çözüm personele de gelmez.
// Kapsam dışı ya da olmayan deneme "Deneme bulunamadı" (API 404). Kurulum `support/reading-activity.ts`.

/** Seed'de 7-A'nın İngilizcesini başka öğretmen verir; t1 de versin ki atamayı görsün. */
const TEACHES_ENGLISH = [
  {
    collection: 'assignments' as const,
    data: { id: 'assign-c1-english-t1', classId: 'c1', subjectId: 'english', teacherId: 't1' },
  },
]
const DENIZ = 'Deniz Yılmaz'

test.describe('personel deneme görünümü', () => {
  test('OG-983, DOM-BEC-006, DOM-BEC-045: öğretmen teslim edilen okuma denemesinde cevapları, madde sonuçlarını ve alt beceri dökümünü görür', async ({
    page,
    context,
    loginAs,
    tenant,
    api,
  }) => {
    const { school, assignmentId } = await setUp(
      tenant,
      api,
      'Feribot okuma sınavı',
      { kind: 'evaluation', maxAttempts: 1 },
      { roles: ['ogretmen'], records: TEACHES_ENGLISH },
    )
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAs(school.user('ogrenci'))
    await startAttempt(page, assignmentId)
    await answerAll(page, ["Ann's trip to work.", 'By bus.', 'She enjoys it.'])
    await submitAttempt(page)
    await expect(page.getByLabel('Puan 100 üzerinden 75')).toBeVisible()
    // Değerlendirme kapanmadı: öğrenci yalnız toplamı görür.
    await expect(breakdownOf(page)).toHaveCount(0)

    await context.clearCookies()
    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/odevler?sekme=gorevler&gorev=${assignmentId}`)
    const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
    const attempts = panel.getByRole('list', { name: 'Denemeler' })
    await expect(attempts.getByRole('listitem')).toHaveCount(1)
    await expect(attempts.getByText(DENIZ, { exact: true })).toBeVisible()
    await expect(attempts.getByText('Teslim edildi', { exact: true })).toBeVisible()
    await expect(attempts.getByText('Puan 75 / 100', { exact: true })).toBeVisible()

    const open = attempts.getByRole('button', { name: `${DENIZ}, 1. deneme ayrıntısını aç` })
    await open.click()
    await expect(page).toHaveURL(/[?&]deneme=/)
    const review = page.getByRole('dialog', { name: 'Deneme ayrıntısı' })
    // Okuma metni pencerede, öğrencinin çözme ekranındaki bileşenle.
    await expect(passageOf(page)).toBeVisible()
    await expect(review.getByRole('heading', { name: PASSAGE_TITLE })).toBeVisible()
    await expect(review.getByText(DENIZ, { exact: true })).toBeVisible()
    await expect(review.getByLabel('Puan 100 üzerinden 75')).toBeVisible()

    // Soru soru: öğrencinin cevabı, madde sonucu ve puanı; anahtar kapanışa kadar gelmez.
    const items = review.getByRole('list', { name: 'Soru soru sonuç' }).getByRole('listitem')
    await expect(items).toHaveCount(QUESTIONS.length)
    await expect(items.nth(0)).toContainText("Öğrencinin cevabı: Ann's trip to work.")
    await expect(items.nth(0).getByText('Doğru', { exact: true })).toBeVisible()
    await expect(items.nth(0).getByText('1 / 1 puan', { exact: true })).toBeVisible()
    await expect(items.nth(1)).toContainText('Öğrencinin cevabı: By bus.')
    await expect(items.nth(1).getByText('Yanlış', { exact: true })).toBeVisible()
    await expect(items.nth(1).getByText('0 / 1 puan', { exact: true })).toBeVisible()
    await expect(items.nth(2).getByText('2 / 2 puan', { exact: true })).toBeVisible()
    await expect(review.getByText('Doğru cevap:', { exact: true })).toHaveCount(0)
    await expect(review).not.toContainText(SECRET_EXPLANATION)

    // Alt beceri dökümü öğrencinin sonuç ekranındaki bileşendir.
    const breakdown = review.getByRole('table', { name: 'Alt beceri dökümü' })
    const row = (label: string) => breakdown.locator('tbody tr').filter({ hasText: label })
    await expect(breakdown.locator('tbody tr')).toHaveCount(3)
    await expect(row('Ana fikir')).toContainText('%100')
    await expect(row('Ayrıntı')).toContainText('0 / 1')
    await expect(row('Çıkarım')).toContainText('2 / 2')

    // Geri/ileri pencereyi kapatıp açar; panel yerinde kalır. Kapatınca odak açan düğmeye döner.
    await page.goBack()
    await expect(review).toHaveCount(0)
    await expect(panel).toBeVisible()
    await page.goForward()
    await expect(review).toBeVisible()
    await review.getByRole('button', { name: 'Pencereyi kapat' }).click()
    await expect(review).toHaveCount(0)
    await expect(open).toBeFocused()

    // Adres paylaşılabilir: yenilenince pencere panelin üstünde açılır (erişilebilirlik ağacında
    // üstteki pencere görünür); kapatınca panel yerinde kalır.
    await open.click()
    await expect(page).toHaveURL(/[?&]deneme=/)
    await page.reload()
    await expect(review.getByRole('list', { name: 'Soru soru sonuç' })).toBeVisible()
    await review.getByRole('button', { name: 'Pencereyi kapat' }).click()
    await expect(review).toHaveCount(0)
    await expect(panel).toBeVisible()
    await open.click()

    // Dar ekranda pencere taşmaz.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(breakdown).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  // Kapsam dışı ve başka kurumun denemesi API'de 404'tür (task-attempts API testleri); ekran aynı
  // 404'ü bu iletiyle karşılar.
  test('OG-983, DOM-YTK-028: bulunamayan deneme "Deneme bulunamadı" der', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], classes: ['c1'] })
    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/odevler?sekme=gorevler&deneme=${randomUUID()}`)
    const review = page.getByRole('dialog', { name: 'Deneme ayrıntısı' })
    await expect(review.getByRole('heading', { name: 'Deneme bulunamadı.' })).toBeVisible()
  })
})
