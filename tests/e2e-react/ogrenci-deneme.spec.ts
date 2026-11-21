import { randomUUID } from 'node:crypto'

import { expect, test } from './support/fixtures.ts'
import { createExam, EXAM_COLLECTIONS, resultsOf } from './support/exams.ts'

// OG-076: deneme sınavları öğrenci ve öğretmen duman testleri (DOM-YTK-028). Tohum: Deniz Yılmaz
// (7-A, s1) 7. sınıf denemelerinin sonuçlarına sahiptir; 5., 8. ve 12. sınıf denemeleri başka
// düzeylerindir. Yalnız okunan testler seed kurumunu, yazanlar kendi kurumunu kullanır.

const EXAM_1 = '7. Sınıf Hazırlık Denemesi 1'
const EXAM_2 = '7. Sınıf Hazırlık Denemesi 2'
const OTHER_GRADES = ['5. Sınıf Gelişim Denemesi', 'LGS Hazırlık Denemesi', 'YKS Hazırlık Denemesi']
const WRITE_ACTIONS = ['Deneme oluştur', 'Sonuç gir', 'CSV sonuç aktar']
const WEAK_TOPIC = 'Sayılar ve işlemler'

test.describe('öğrenci: deneme sınavları', () => {
  test('DOM-YTK-028: öğrenci kendi düzeyindeki denemeleri ve netlerini görür; başka düzey ve yazma işlemi yoktur', async ({
    loginAs,
  }) => {
    const page = await loginAs('ogrenci')
    await page.goto('/ogrenci/deneme-sinavlari')
    await expect(page.getByRole('heading', { name: 'Deneme Sınavları', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: EXAM_1 })).toBeVisible()
    await expect(page.getByRole('button', { name: EXAM_2 })).toBeVisible()
    for (const title of OTHER_GRADES)
      await expect(page.getByRole('button', { name: title })).toHaveCount(0)
    for (const name of WRITE_ACTIONS)
      await expect(page.getByRole('button', { name })).toHaveCount(0)

    // Net sonuç kayıtlarından hesaplanır (doğru − yanlış / 4, üç ders): deneme 1 toplam 29,25 net.
    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: EXAM_1 }) })
    await expect(row).toContainText('Sonuç girildi')
    await expect(row).toContainText('Deniz Yılmaz: 29,25 net')
    await expect(row).not.toContainText('Ece Yılmaz')

    await page.getByRole('button', { name: EXAM_1 }).click()
    const detail = page.getByRole('dialog', { name: EXAM_1 })
    await expect(
      detail.getByText(`Deniz Yılmaz · Matematik: 10 doğru / 5 yanlış / 5 boş · 8,75 net`),
    ).toBeVisible()
    await expect(detail.getByText('Denemeler arası gelişim')).toBeVisible()
    await expect(detail.getByText('Hazırlık Denemesi 2: 39 net')).toBeVisible()
    for (const name of WRITE_ACTIONS)
      await expect(detail.getByRole('button', { name })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()

    // Arama süzer; temizlenince liste geri gelir.
    await page.getByLabel('Tabloda ara').fill('Denemesi 2')
    await expect(page.getByRole('button', { name: EXAM_1 })).toHaveCount(0)
    await expect(page.getByRole('button', { name: EXAM_2 })).toBeVisible()
  })

  test('DOM-YTK-028: öğrenci eksik konudan çalışma planı açar; plan onay bekler ve çalışma planında görünür', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'ogrenci'],
      students: ['s1'],
      collections: [...EXAM_COLLECTIONS, 'studyTasks'],
    })
    const page = await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/deneme-sinavlari')
    await page.getByRole('button', { name: EXAM_1 }).click()
    await page
      .getByRole('dialog', { name: EXAM_1 })
      .getByRole('button', { name: 'Deniz Yılmaz · Matematik çalışma planı' })
      .click()
    const form = page.getByRole('dialog', { name: 'Çalışma görevi ekle' })
    // Eksik konu ve başlık denemeden gelir; öğrenci yönergeyi yazar.
    await expect(form.getByLabel('Çalışılacak konular')).toHaveValue(WEAK_TOPIC)
    await expect(form.getByLabel('Görev başlığı')).toHaveValue('Matematik konu tekrarı')
    const title = `E2E eksik konu ${randomUUID().slice(0, 8)}`
    await form.getByLabel('Görev başlığı').fill(title)
    await form.getByLabel('Çalışma yönergesi').fill('Konu anlatımını oku, on soru çöz.')
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()

    const client = await api(school.user('yonetici'))
    await expect
      .poll(async () => {
        const result = await client.get('/api/v1/collections/studyTasks?pageSize=100')
        const rows = (result.body as { data: { record: Record<string, unknown> }[] }).data
        return rows.find((row) => row.record.title === title)?.record
      })
      .toMatchObject({ studentId: 's1', topic: WEAK_TOPIC, status: 'Onay bekliyor' })

    await page.goto('/ogrenci/calisma-plani')
    await page.getByLabel('Tabloda ara').fill(title)
    await expect(page.getByRole('button', { name: title })).toBeVisible()
  })
})

test.describe('öğretmen: deneme sınavları', () => {
  test('DOM-YTK-028: öğretmen sınıfının denemesini ve netini görür; kendi denemesine sonuç girer', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen'],
      students: ['s1'],
      collections: EXAM_COLLECTIONS,
    })
    const client = await api(school.user('ogretmen'))
    const title = `E2E öğretmen denemesi ${randomUUID().slice(0, 8)}`
    const examId = await createExam(client, title)

    const page = await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/deneme-sinavlari')
    await expect(page.getByRole('heading', { name: 'Deneme Sınavları', level: 1 })).toBeVisible()
    const seeded = page.getByRole('row').filter({ has: page.getByRole('button', { name: EXAM_1 }) })
    await expect(seeded).toContainText('Deniz Yılmaz: 29,25 net')
    // Kapsam dışı düzey: öğretmenin sınıflarında olmayan YKS denemesi listelenmez.
    await expect(page.getByRole('button', { name: 'YKS Hazırlık Denemesi' })).toHaveCount(0)

    await page.getByLabel('Tabloda ara').fill(title)
    await page.getByRole('button', { name: title }).click()
    await page
      .getByRole('dialog', { name: title })
      .getByRole('button', { name: 'Sonuç gir' })
      .click()
    const form = page.getByRole('dialog', { name: 'Ders sonucu gir' })
    await expect(form.getByLabel('Deneme')).toHaveValue(examId)
    await form.getByLabel('Öğrenci', { exact: true }).selectOption({ label: 'Deniz Yılmaz' })
    await form.getByLabel('Doğru').fill('14')
    await form.getByLabel('Yanlış').fill('4')
    await form.getByLabel('Boş').fill('2')
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()
    await expect
      .poll(async () => (await resultsOf(client, examId))[0]?.record)
      .toMatchObject({ studentId: 's1', correct: 14, wrong: 4, blank: 2 })

    // Kalıcılık: sayfa temiz adresle yeniden açılır, net sunucudan gelir.
    await page.goto('/ogretmen/deneme-sinavlari')
    await page.getByLabel('Tabloda ara').fill(title)
    await expect(
      page.getByRole('row').filter({ has: page.getByRole('button', { name: title }) }),
    ).toContainText('Deniz Yılmaz: 13 net')
  })
})
