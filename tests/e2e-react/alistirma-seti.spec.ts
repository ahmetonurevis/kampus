import { expect, test } from './support/fixtures.ts'
import { assignTask, QUIZ_QUESTIONS, seedQuiz, userIdOf } from './support/tasks.ts'

// Ünite alıştırma seti (OG-085; IST-056, DOM-BEC-041, 047, 048): öğrenci alıştırmada soru başına
// "Kontrol et" ile anında geri bildirim alır (madde başına 2 hak; doğru ya da hak bitince kilit,
// yalnız o sorunun cevabı açılır), öğretmen sonucu Ödevler & Değerlendirme sayfasının "Alıştırma
// not defteri" sekmesinde görür, veli alıştırma puanını görmez. İçerik doğrudan veritabanına,
// atama API'den yazılır; 1. soru yanlışlanıp kilitlenir (0/1), 2. soru doğrulanır (3/4 = %75).

const TASK = 'Ünite 3 okuma alıştırması'
const DENIZ = 'Deniz Yılmaz'

/** Seed'de 7-A'nın İngilizcesini başka öğretmen verir; t1 de verir ki atamayı görebilsin. */
const TEACHES_ENGLISH = [
  {
    collection: 'assignments' as const,
    data: { id: 'assign-c1-english-t1', classId: 'c1', subjectId: 'english', teacherId: 't1' },
  },
]

test('OG-085, DOM-BEC-041, 047, 048: öğrenci alıştırmada soruyu kontrol eder (hak düşer, hak bitince kilitlenir, yalnız o sorunun cevabı görünür); öğretmen not defterinde sonucu görür; veli puanı görmez', async ({
  page,
  context,
  loginAs,
  tenant,
  api,
}) => {
  const school = await tenant({
    roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'],
    classes: ['c1'],
    records: TEACHES_ENGLISH,
  })
  const admin = await api(school.user('yonetici'))
  const quiz = await seedQuiz(school.institutionId, await userIdOf(admin), TASK)
  const assignmentId = await assignTask(admin, {
    resourceVersionId: quiz,
    studentIds: ['s1'],
    settings: { attempts: { kind: 'practice' } },
  })

  // Öğrenci: alıştırmayı başlatır.
  await loginAs(school.user('ogrenci'))
  await page.goto('/ogrenci/soru-coz')
  await page.getByRole('button', { name: `${TASK} ayrıntısını aç` }).click()
  await page
    .getByRole('dialog', { name: 'Görev ayrıntısı' })
    .getByRole('button', { name: 'Göreve başla' })
    .click()
  await expect(page).toHaveURL(new RegExp(`coz=${assignmentId}`))
  await page.getByRole('button', { name: 'Denemeyi başlat' }).click()
  await expect(page.getByText(QUIZ_QUESTIONS[0])).toBeVisible()

  const result = page.getByRole('status', { name: 'Kontrol sonucu' })
  const check = page.getByRole('button', { name: 'Kontrol et' })
  await expect(check).toBeDisabled()
  await expect(page.getByText('Kontrol hakkı: 2 / 2')).toBeVisible()

  // 1. soru, ilk yanlış cevap: hak 2'den 1'e düşer; cevap anahtarı henüz açılmaz.
  await page.getByLabel('In Paris.').check()
  await check.click()
  await expect(result).toContainText('Yanlış')
  await expect(result).toContainText('yeniden kontrol edebilirsiniz')
  await expect(page.getByText('Kontrol hakkı: 1 / 2')).toBeVisible()
  await expect(page.getByText('Doğru cevap:')).toHaveCount(0)
  await expect(page.getByText('GIZLI-ACIKLAMA')).toHaveCount(0)

  // İkinci yanlış cevap hakkı bitirir: cevap kilitlenir, yalnız bu sorunun doğrusu açılır.
  await page.getByLabel('In Rome.').check()
  await check.click()
  await expect(result).toContainText('Kontrol hakkınız bitti')
  await expect(page.getByText('Kontrol hakkı kalmadı')).toBeVisible()
  await expect(check).toBeDisabled()
  await expect(page.getByLabel('In London.')).toBeDisabled()
  await expect(result.getByText('In London.')).toBeVisible()
  await expect(page.getByText('GIZLI-ACIKLAMA')).toBeVisible()

  // 2. soruda başka sorunun cevabı görünmez; doğru cevap kilitler ve kendi hakkı ayrıdır (2 / 2).
  await page.getByRole('button', { name: 'Sonraki' }).click()
  await expect(page.getByText(QUIZ_QUESTIONS[1])).toBeVisible()
  await expect(page.getByText('Doğru cevap:')).toHaveCount(0)
  await expect(page.getByText('GIZLI-ACIKLAMA')).toHaveCount(0)
  await expect(page.getByText('Kontrol hakkı: 2 / 2')).toBeVisible()
  await page.getByLabel('In Paris.').check()
  await check.click()
  await expect(result).toContainText('Doğru')
  await expect(result).toContainText('bu soru kilitlendi')
  await expect(page.getByLabel('In Paris.')).toBeDisabled()

  // Kilitli ilk sorunun cevabı geri dönüşte de değişmez.
  await page.getByRole('button', { name: '1. soruya git' }).click()
  await expect(page.getByLabel('In Rome.')).toBeChecked()
  await expect(page.getByLabel('In Rome.')).toBeDisabled()

  await page.getByRole('button', { name: 'Denemeyi teslim et' }).first().click()
  const confirm = page.getByRole('dialog', { name: 'Deneme teslim edilsin mi?' })
  await confirm.getByRole('button', { name: 'Teslim et' }).click()
  await expect(page.getByRole('heading', { name: '1. deneme sonucu' })).toBeVisible()
  await expect(page.getByLabel('Puan 100 üzerinden 75')).toBeVisible()

  // Öğretmen: not defterinde öğrenciyi ve yüzdeyi görür.
  await context.clearCookies()
  await loginAs(school.user('ogretmen'), { fresh: true })
  await page.goto('/ogretmen/odevler?sekme=alistirma')
  await expect(page.getByRole('heading', { name: 'Alıştırma not defteri', level: 2 })).toBeVisible()
  const book = page.getByRole('table', { name: 'Alıştırma not defteri' })
  const row = book.locator('tbody tr').filter({ hasText: DENIZ })
  await expect(row).toBeVisible()
  await expect(row).toContainText('%75')

  // Veli: görev satırında ve panelde puan yok; deneme tamamlandı ama sonuç kapalı.
  await context.clearCookies()
  await loginAs(school.user('veli'), { fresh: true })
  await page.goto('/veli/akademik-takip?cocuk=s1&sekme=gorevler')
  const parentRow = page
    .getByRole('table', { name: 'Beceri görevleri' })
    .locator('tbody tr')
    .filter({ hasText: TASK })
  await expect(parentRow).toBeVisible()
  await expect(parentRow).not.toContainText('/ 100')
  await page.getByRole('button', { name: `${TASK} ayrıntısını aç` }).click()
  const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
  await expect(panel.getByRole('heading', { name: TASK })).toBeVisible()
  await expect(panel.getByLabel(/Puan 100 üzerinden/)).toHaveCount(0)
  await expect(panel).not.toContainText('puan')
  await expect(panel).not.toContainText('Doğru cevap:')

  // Veli not defteri ucunu da okuyamaz (DOM-BEC-048).
  const parentApi = await api(school.user('veli'), { fresh: true })
  expect((await parentApi.get('/api/v1/practice-gradebook')).status).toBe(403)
})
