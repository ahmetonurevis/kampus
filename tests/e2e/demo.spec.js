import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { restoreSnapshot } from '../../apps/web/src/lib/demo-persistence.js'
import { navigation } from '../../apps/web/src/modules/navigation.js'

const stored = async (page) =>
  restoreSnapshot(await page.evaluate(() => localStorage.getItem('kampus-private-school-v1')))
test('Giriş ve beş rol arasında geçiş', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Kampüs’e hoş geldiniz.' })).toBeVisible()
  await page.getByRole('button', { name: 'Demoyu keşfet' }).click()
  await expect(page).toHaveURL(/yonetici\/dashboard/)
  for (const role of Object.keys(navigation)) {
    await page.getByLabel('Rol değiştir').selectOption(role)
    await expect(page).toHaveURL(new RegExp(`${role}/dashboard`))
    await expect(page.locator('main h1')).toBeVisible()
  }
})
for (const [role, pages] of Object.entries(navigation))
  test(`${role}: tüm sayfalar masaüstünde ve mobilde açılır`, async ({ page }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const routes = pages.map((p) => `/${role}/${p.path}`)
    if (role === 'onburo') routes.push('/onburo/aday/pr1')
    if (role === 'ogretmen') routes.push('/ogretmen/ogrenci/s1')
    for (const path of routes) {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(path)
      await expect(page.locator('main h1')).toBeVisible()
      await expect(page.locator('vite-error-overlay')).toHaveCount(0)
      await expect(
        page.getByText('Bir hata oluştu. Lütfen sayfayı yenileyip tekrar deneyin.'),
      ).toHaveCount(0)
      await page.setViewportSize({ width: 390, height: 844 })
      await expect
        .poll(
          () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          { message: `${path} yatay taşma` },
        )
        .toBe(true)
    }
    expect(errors).toEqual([])
  })
test('Aday, görüşme notu, kesin kayıt, PDF ve finans bağlantısı', async ({ page }) => {
  await page.goto('/onburo/adaylar')
  await page.getByRole('button', { name: 'Yeni aday ekle' }).click()
  await page.getByLabel('Ad soyad', { exact: true }).fill('Test Öğrenci')
  await page.getByLabel('Telefon', { exact: true }).fill('05550109999')
  await page.getByLabel('E-posta', { exact: true }).fill('demo@example.com')
  await page.getByRole('button', { name: 'Adayı kaydet' }).click()
  await expect(page.locator('main h1')).toHaveText('Test Öğrenci')
  await page
    .getByLabel('Görüşme notu', { exact: true })
    .fill('Öğrenci 7. sınıf okul programıyla ilgileniyor.')
  await page.getByRole('button', { name: 'Notu kaydet' }).click()
  await expect(
    page.getByText('Öğrenci 7. sınıf okul programıyla ilgileniyor.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Kesin kayda dönüştür' }).click()
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
  await expect(page.getByText('Test Öğrenci, aramıza hoş geldin!')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Sözleşmeyi görüntüle' }).click()
  await page.getByRole('button', { name: 'PDF’yi indir', exact: true }).click()
  const download = await downloadPromise
  expect((await readFile(await download.path())).subarray(0, 4).toString()).toBe('%PDF')
  const s = await stored(page),
    student = s.students.find((s) => s.name === 'Test Öğrenci')
  expect(s.invoices.filter((i) => i.studentId === student.id)).toHaveLength(8)
  expect(s.students).toHaveLength(241)
  await page.reload()
  await page.goto('/yonetici/dashboard')
  await expect(
    page.locator('.stat-card').filter({ hasText: 'Aktif öğrenci' }).locator('.stat-middle strong'),
  ).toHaveText('241')
})
test('Yoklama öğrenci ve veliye yansır, tekrar kayıt çoğalmaz', async ({ page }) => {
  await page.goto('/ogretmen/yoklama')
  const row = page.locator('.attendance-row').filter({ hasText: 'Deniz Yılmaz' })
  await row.getByRole('button', { name: 'Gelmedi', exact: true }).click()
  await page.getByRole('button', { name: 'Yoklamayı kaydet' }).click()
  const first = (await stored(page)).attendance.length
  await page.getByRole('button', { name: 'Yoklamayı kaydet' }).click()
  expect((await stored(page)).attendance.length).toBe(first)
  await page.goto('/ogrenci/devamsizlik')
  await expect(page.locator('tbody tr').first()).toContainText('Gelmedi')
  await page.goto('/veli/dashboard')
  await expect(page.locator('.stat-card').filter({ hasText: 'Devamsızlık' })).toContainText(
    '9 ders',
  )
})
test('Ödev oluşturma, öğrenci teslimi ve öğretmen değerlendirmesi', async ({ page }) => {
  await page.goto('/ogretmen/odevler')
  await page.getByRole('button', { name: 'Ödev ata', exact: true }).click()
  await page.getByLabel('Ödev başlığı').fill('Demo çalışma ödevi')
  await page
    .getByLabel('Açıklama', { exact: true })
    .fill('Beş denklem kurup çözüm adımlarını gösterin.')
  await page
    .getByLabel('Son teslim tarihi')
    .fill(new Date(Date.now() + 86400000 * 4).toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Ödevi paylaş' }).click()
  await page.goto('/ogrenci/odevler')
  await page
    .locator('.homework-card')
    .filter({ hasText: 'Demo çalışma ödevi' })
    .getByRole('button', { name: 'Ödevi teslim et' })
    .click()
  await page.getByLabel('Ödev dosyası').setInputFiles({
    name: 'calisma.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF demo'),
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Ödevi teslim et' }).click()
  await expect(
    page.locator('.homework-card').filter({ hasText: 'Demo çalışma ödevi' }),
  ).toContainText('Teslim edildi')
  await page.goto('/ogretmen/odevler')
  await page.getByLabel('Tabloda ara').fill('Demo çalışma ödevi')
  await page
    .locator('tbody tr')
    .filter({ hasText: 'Demo çalışma ödevi' })
    .getByRole('button', { name: 'Değerlendir' })
    .click()
  await page.getByLabel('Puan (0–100)').fill('93')
  await page
    .getByLabel('Öğrenciye geri bildirim')
    .fill('Çok iyi bir çalışma, işlem sırasını doğru uyguladın.')
  await page.getByRole('button', { name: 'Değerlendirmeyi paylaş' }).click()
  await page.goto('/ogrenci/odevler')
  const card = page.locator('.homework-card').filter({ hasText: 'Demo çalışma ödevi' })
  await expect(card).toContainText('93/100')
  await expect(card).toContainText('Çok iyi bir çalışma')
})
test('Soru gönderme ve öğretmenin yanıtı aynı kayıtta görünür', async ({ page }) => {
  await page.goto('/ogrenci/soru-sor')
  await page.getByRole('button', { name: 'Yeni soru sor' }).click()
  await page.getByLabel('Konu başlığı').fill('Demo denklem sorusu')
  await page
    .getByLabel('Sorun', { exact: true })
    .fill('Denklemin iki tarafına neden aynı işlemi uyguluyoruz?')
  await page.getByRole('button', { name: 'Soruyu gönder' }).click()
  await page.goto('/ogretmen/sorular')
  await page
    .locator('.question-card')
    .filter({ hasText: 'Demo denklem sorusu' })
    .getByRole('button', { name: 'Yanıtla', exact: true })
    .click()
  await page
    .getByLabel('Yanıtınız')
    .fill('Eşitliği korumak için iki tarafa da aynı işlem uygulanır.')
  await page.getByRole('button', { name: 'Yanıtı gönder' }).click()
  await page.goto('/ogrenci/soru-sor')
  await expect(
    page.locator('.question-card').filter({ hasText: 'Demo denklem sorusu' }),
  ).toContainText('Eşitliği korumak')
})
test('Quiz eksik cevapla bitmez; puan ve konu analizi kaydedilir', async ({ page }) => {
  await page.goto('/ogrenci/soru-coz')
  await page.getByRole('button', { name: 'Quize başla' }).first().click()
  for (let i = 0; i < 9; i++)
    await page.getByRole('button', { name: 'Sonraki', exact: true }).click()
  await page.getByRole('button', { name: 'Quizi bitir' }).click()
  await expect(page.getByText('Lütfen tüm soruları yanıtlayın.')).toBeVisible()
  const state = await stored(page),
    quiz = state.quizzes[0]
  for (let i = 0; i < 10; i++) {
    await page.getByRole('button', { name: `${i + 1}. soruya git`, exact: true }).click()
    const q = state.bank.find((q) => q.id === quiz.questionIds[i])
    await page.locator('.quiz-options label').nth(q.answer).click()
  }
  await page.getByRole('button', { name: 'Quizi bitir' }).click()
  await expect(page.locator('.quiz-result h2')).toHaveText('100/100')
  expect((await stored(page)).quizAttempts.at(-1).score).toBe(100)
  await page.goto('/ogrenci/notlarim')
  await expect(page.locator('tbody tr').first()).toContainText('Matematik · 7-A kazanım testi')
})
test('Başarısız ve başarılı ödeme; tekrar tahsilat engeli ve dekont', async ({ page }) => {
  await page.goto('/veli/odeme-yap')
  await page.getByLabel('Kart üzerindeki ad', { exact: true }).fill('Ayşe Yılmaz')
  await page.getByLabel('Banka yanıtı').selectOption('failure')
  await page.getByRole('checkbox').check()
  const before = (await stored(page)).invoices.filter((i) => i.paidAt).length
  await page.getByRole('button', { name: /Ödemeye devam et/ }).click()
  await page.getByRole('button', { name: 'Demo işlemini onayla' }).click()
  await expect(page.getByText(/Demo banka işlemi reddetti/)).toBeVisible()
  expect((await stored(page)).invoices.filter((i) => i.paidAt)).toHaveLength(before)
  await page.getByLabel('Banka yanıtı').selectOption('success')
  await page.getByRole('button', { name: /Ödemeye devam et/ }).click()
  await page.getByRole('button', { name: 'Demo işlemini onayla' }).click()
  await expect(page.getByRole('heading', { name: 'Ödemeniz tamamlandı.' })).toBeVisible()
  expect((await stored(page)).invoices.filter((i) => i.paidAt)).toHaveLength(before + 1)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Dekontu görüntüle' }).click()
  await page.getByRole('button', { name: 'PDF’yi indir', exact: true }).click()
  expect((await downloadPromise).suggestedFilename()).toMatch(/dekont-.*\.pdf/)
  await page.goto('/onburo/tahsilat-takip')
  await page.getByLabel('Tabloda ara').fill('Deniz Yılmaz')
  await expect(page.locator('tbody tr').filter({ hasText: 'Ödendi' })).toHaveCount(4)
})
test('Çocuk seçimi finans ve akademik verileri değiştirir', async ({ page }) => {
  await page.goto('/veli/finans')
  await page.getByLabel('Çocuk seç', { exact: true }).selectOption('s2')
  await expect(page.locator('tbody')).toContainText('Ece Yılmaz')
  await expect(page.locator('tbody')).not.toContainText('Deniz Yılmaz')
  await page.getByRole('button', { name: 'Akademik', exact: true }).click()
  await page.locator('.sidebar').getByRole('link', { name: 'Akademik Takip', exact: true }).click()
  await expect(page.locator('.student-summary h2')).toHaveText('Ece Yılmaz')
})
test('Öğrenci mesajı öğretmenin aynı konuşmasında görünür', async ({ page }) => {
  await page.goto('/ogrenci/mesajlar')
  await page
    .getByLabel('Mesajınız', { exact: true })
    .fill('Demo matematik etüdü için teşekkürler hocam.')
  await page.getByRole('button', { name: 'Mesajı gönder' }).click()
  await page.goto('/ogretmen/randevular')
  await page.getByRole('button', { name: 'Mesajlar', exact: true }).click()
  await expect(page.locator('.chat-messages')).toContainText(
    'Demo matematik etüdü için teşekkürler hocam.',
  )
})
test('Randevu talebi, öğretmen onayı ve dolu saatin kapanması', async ({ page }) => {
  await page.goto('/ogrenci/randevu-talep')
  await page
    .locator('.slot-card')
    .filter({ hasText: 'Müsait' })
    .getByRole('button', { name: 'Bu saati seç' })
    .first()
    .click()
  await page.getByLabel('Görüşme konusu').fill('Demo sınav öncesi tekrar yapmak istiyorum.')
  await page.getByRole('button', { name: 'Talebi gönder' }).click()
  await page.goto('/ogretmen/randevular')
  const row = page
    .locator('tbody tr')
    .filter({ hasText: 'Demo sınav öncesi tekrar yapmak istiyorum.' })
  await row.getByRole('button', { name: 'Onayla', exact: true }).click()
  await expect(row).toContainText('Onaylandı')
  await page.goto('/ogrenci/randevu-talep')
  await expect(
    page.locator('tbody tr').filter({ hasText: 'Demo sınav öncesi tekrar yapmak istiyorum.' }),
  ).toContainText('Onaylandı')
})
test('Modül kapatma hem menüyü hem doğrudan bağlantıyı kapatır', async ({ page }) => {
  await page.goto('/yonetici/ayarlar')
  await page.getByRole('switch', { name: 'Finans & Tahsilat' }).click()
  await expect(page.locator('nav').getByRole('link', { name: 'Finans & Tahsilat' })).toHaveCount(0)
  await page.goto('/veli/odeme-yap')
  await expect(page).toHaveURL(/veli\/dashboard/)
  await expect(page.getByText('Güncel bakiye', { exact: true })).toHaveCount(0)
  await page.goto('/yonetici/ayarlar')
  await page.getByRole('switch', { name: 'Finans & Tahsilat' }).click()
  await page.goto('/veli/odeme-yap')
  await expect(page).toHaveURL(/veli\/odeme-yap/)
})
test('Mobil menü, koyu tema ve kalıcılık', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/yonetici/dashboard')
  await page.getByRole('button', { name: 'Menüyü aç' }).click()
  await page.getByRole('button', { name: 'Yönetim', exact: true }).click()
  await page.getByRole('link', { name: 'Finans & Tahsilat' }).click()
  await expect(page).toHaveURL(/yonetici\/finans/)
  await expect(page.locator('.sidebar')).not.toHaveClass(/open/)
  await page.getByRole('button', { name: 'Koyu temaya geç' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
})

test('Öğretmenin paylaştığı quiz ve materyal öğrenciye ulaşır', async ({ page }) => {
  await page.goto('/ogretmen/quiz-olustur')
  await page.getByLabel('Quiz başlığı').fill('Yeni sınıf quizi')
  await page.locator('.bank-question').first().getByRole('checkbox').check()
  await page.getByLabel('Soru konusu').selectOption('Denklemler')
  await page.locator('.bank-question').first().getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Quiz oluştur ve paylaş' }).click()
  await page.goto('/ogrenci/soru-coz')
  await expect(page.locator('.quiz-card').filter({ hasText: 'Yeni sınıf quizi' })).toBeVisible()
  await page.goto('/ogretmen/materyal-yukle')
  await page.getByRole('button', { name: 'Materyal yükle', exact: true }).click()
  await page.getByLabel('Materyal başlığı').fill('Yeni çalışma notları')
  await page
    .getByRole('dialog')
    .locator('input[type=file]')
    .setInputFiles({
      name: 'notlar.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF demo'),
    })
  await page.getByRole('button', { name: 'Kütüphaneye ekle' }).click()
  await page.goto('/ogrenci/materyaller')
  await page.getByLabel('Materyal ara').fill('Yeni çalışma notları')
  await expect(page.locator('.document-card')).toContainText('Yeni çalışma notları')
})

test('Veli talebi ön büroya, mazereti ilgili birime ulaşır', async ({ page }) => {
  await page.goto('/veli/sikayet-talep')
  await page.getByRole('button', { name: 'Yeni bildirim' }).click()
  await page.getByLabel('Konu', { exact: true }).fill('Demo ek fen etüdü')
  await page
    .getByLabel('Açıklama', { exact: true })
    .fill('Hafta sonu ek fen etüdü için bilgi rica ediyorum.')
  await page.getByRole('button', { name: 'Bildirimi gönder' }).click()
  await page.goto('/onburo/talepler')
  await page
    .locator('tbody tr')
    .filter({ hasText: 'Demo ek fen etüdü' })
    .getByRole('button', { name: 'İncele & yönlendir' })
    .click()
  await page.getByLabel('İlgili birim').selectOption('Akademik koordinatör')
  await page.getByLabel('Talep durumu', { exact: true }).selectOption('Çözüldü')
  await page.getByRole('button', { name: 'Güncelle ve yönlendir' }).click()
  await page.goto('/veli/sikayet-talep')
  await expect(page.locator('tbody tr').filter({ hasText: 'Demo ek fen etüdü' })).toContainText(
    'Çözüldü',
  )
  await page.goto('/veli/devamsizlik-bildirimi')
  await page
    .getByLabel('Açıklama', { exact: true })
    .fill('Kontrol randevusu nedeniyle izin rica ediyoruz.')
  await page.getByRole('button', { name: 'Bildirimi gönder' }).click()
  await expect(page.locator('.absence-entry')).toContainText('Kontrol randevusu')
  await page.goto('/onburo/talepler')
  await expect(page.locator('tbody tr').filter({ hasText: 'İzin bildirimi' })).toContainText(
    'Akademik koordinatör',
  )
})

test('Açık iki rol sekmesinde değişiklikler senkronize edilir', async ({ page, context }) => {
  await page.goto('/ogrenci/mesajlar')
  const teacherPage = await context.newPage()
  await teacherPage.goto('/ogretmen/randevular')
  await teacherPage.getByRole('button', { name: 'Mesajlar', exact: true }).click()
  await page
    .getByLabel('Mesajınız', { exact: true })
    .fill('Aynı anda açık sekmeler için senkronizasyon mesajı.')
  await page.getByRole('button', { name: 'Mesajı gönder' }).click()
  await expect(teacherPage.locator('.chat-messages')).toContainText(
    'Aynı anda açık sekmeler için senkronizasyon mesajı.',
  )
})

test('Bildirim tercihleri ve izleme ilerlemesi yenilemeden sonra korunur', async ({ page }) => {
  await page.goto('/ogrenci/ayarlar')
  await page.getByRole('switch', { name: 'SMS bildirimleri' }).click()
  await page.getByRole('button', { name: 'Tercihleri kaydet' }).click()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'SMS bildirimleri' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await page.goto('/ogrenci/videolar')
  await page.locator('.video-card').nth(1).click()
  const video = page.locator('video')
  await expect.poll(() => video.evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(1)
  await video.evaluate(async (v) => {
    await v.play()
  })
  await expect.poll(() => video.evaluate((v) => v.currentTime)).toBeGreaterThan(0.2)
  await video.evaluate((v) => {
    v.pause()
    v.currentTime = v.duration * 0.75
  })
  await expect
    .poll(
      async () =>
        (await stored(page)).videoProgress.find((v) => v.videoId === 'v2' && v.studentId === 's1')
          .progress,
    )
    .toBe(75)
  await page.getByRole('button', { name: 'Pencereyi kapat' }).click()
  await page.reload()
  await expect(page.locator('.video-card').nth(1)).toContainText('%75 izlendi')
})

test('Yönetici kampüs ekler, düzenler, arşivler ve geri alır', async ({ page }) => {
  await page.goto('/yonetici/subeler')
  await page.getByRole('button', { name: 'Kampüs ekle', exact: true }).click()
  await page.getByLabel('Kampüs adı').fill('Çamlıca Kampüsü')
  await page
    .getByLabel('Adres', { exact: true })
    .fill('Çamlıca Mahallesi, Okul Sokak No: 12 İstanbul')
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  let card = page.locator('.campus-card').filter({ hasText: 'Çamlıca Kampüsü' })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Çamlıca Kampüsü düzenle' }).click()
  await page.getByLabel('Kampüs adı').fill('Üsküdar Kampüsü')
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  card = page.locator('.campus-card').filter({ hasText: 'Üsküdar Kampüsü' })
  await card.getByRole('button', { name: 'Üsküdar Kampüsü arşivle' }).click()
  await page.getByRole('button', { name: 'Arşivlemeyi tamamla' }).click()
  await expect(card).toHaveCount(0)
  await page.getByRole('button', { name: 'Arşiv', exact: true }).click()
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Yeniden etkinleştir' }).click()
  await page.getByRole('button', { name: 'Aktif kayıtlar' }).click()
  await expect(card).toBeVisible()
  await page.reload()
  await expect(card).toBeVisible()
})
test('Yönetici sınıf açar, branş atar; öğretmen sınıfı görür ve güvenli öğrenci aktarımı yapılır', async ({
  page,
}) => {
  await page.goto('/yonetici/subeler')
  await page.getByRole('button', { name: 'Sınıf ekle', exact: true }).click()
  await page.getByLabel('Şube harfi').fill('D')
  await page.getByLabel('Derslik', { exact: true }).fill('401')
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const cls = (await stored(page)).classes.find((c) => c.name === '7-D')
  expect(cls).toBeTruthy()
  await page.goto('/ogretmen/siniflarim')
  await page.getByLabel('Sınıf seç', { exact: true }).selectOption(cls.id)
  await expect(page.locator('main')).toContainText('7-D')
  await page.goto('/yonetici/subeler')
  await page.getByLabel('Tabloda ara').fill('7-A')
  await page.getByRole('button', { name: '7-A arşivle', exact: true }).click()
  await page.getByRole('button', { name: 'Arşivlemeyi tamamla' }).click()
  await expect(
    page.getByText('Öğrenciler için aynı düzeyde aktif bir sınıf seçin.', { exact: true }),
  ).toBeVisible()
  await page.getByLabel('Aktarım hedefi').selectOption(cls.id)
  await page.getByRole('button', { name: 'Arşivlemeyi tamamla' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await stored(page)).students.find((s) => s.id === 's1').classId).toBe(cls.id)
  await page.goto('/veli/akademik-takip')
  await expect(page.locator('.student-summary')).toContainText('7-D')
})
test('Yönetici öğretmen oluşturur, iletişimini günceller ve arşivler', async ({ page }) => {
  await page.goto('/yonetici/personel')
  await page.getByRole('button', { name: 'Öğretmen ekle', exact: true }).click()
  await page.getByLabel('Ad soyad', { exact: true }).fill('Çağla Öğretmen')
  await page.getByLabel('E-posta', { exact: true }).fill('cagla@example.com')
  await page.getByLabel('Telefon', { exact: true }).fill('05554443322')
  await page.getByLabel('Branş', { exact: true }).selectOption('science')
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  await page.getByLabel('Tabloda ara').fill('Çağla Öğretmen')
  await expect(page.locator('tbody')).toContainText('Fen Bilimleri')
  await page.getByRole('button', { name: 'Çağla Öğretmen düzenle' }).click()
  await page.getByLabel('Telefon', { exact: true }).fill('05554443300')
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  expect((await stored(page)).teachers.find((t) => t.name === 'Çağla Öğretmen').phone).toBe(
    '05554443300',
  )
  await page.getByRole('button', { name: 'Çağla Öğretmen arşivle' }).click()
  await page.getByRole('button', { name: 'Arşivlemeyi tamamla' }).click()
  await expect(page.locator('tbody')).not.toContainText('Çağla Öğretmen')
  await page.getByRole('button', { name: 'Arşiv', exact: true }).click()
  await expect(page.locator('tbody')).toContainText('Çağla Öğretmen')
})
test('Analiz dersi filtresi ve materyal PDF indirme', async ({ page }) => {
  await page.goto('/ogrenci/sinav-analizi')
  await page.getByLabel('Analiz dersi').selectOption('math')
  await expect(page.getByRole('heading', { name: 'Matematik · Konu analizi' })).toBeVisible()
  await expect(page.locator('.topic-bars')).toContainText('Denklemler')
  await page.goto('/ogrenci/materyaller')
  await page.getByLabel('Materyal dersi').selectOption('science')
  await page.getByLabel('Materyal seviyesi').selectOption('7. Sınıf')
  await expect(page.locator('.document-card')).toHaveCount(1)
  await expect(page.locator('.document-card')).toContainText('Fen Bilimleri')
  const downloadPromise = page.waitForEvent('download')
  await page.locator('.document-card button').click()
  await page.getByRole('button', { name: 'PDF’yi indir', exact: true }).click()
  expect((await readFile(await (await downloadPromise).path())).subarray(0, 4).toString()).toBe(
    '%PDF',
  )
})
test('Fen öğretmenine soru ve mesaj gönderme (ders seçimi)', async ({ page }) => {
  await page.goto('/ogrenci/soru-sor')
  await page.getByRole('button', { name: 'Yeni soru sor' }).click()
  await page.getByLabel('Ders ve öğretmen').selectOption('science')
  await page.getByLabel('Konu başlığı').fill('Kloroplastın görevi')
  await page
    .getByLabel('Sorun', { exact: true })
    .fill('Hayvan hücresinde kloroplast neden bulunmaz?')
  await page.getByRole('button', { name: 'Soruyu gönder' }).click()
  const question = (await stored(page)).questions.find((q) => q.title === 'Kloroplastın görevi')
  expect(question.teacherId).toBe('t3')
  await page.goto('/ogrenci/mesajlar')
  await page.getByLabel('Branş öğretmeni', { exact: true }).selectOption('t3')
  await page.getByLabel('Mesajınız', { exact: true }).fill('Fen deneyi için teşekkürler hocam.')
  await page.getByRole('button', { name: 'Mesajı gönder' }).click()
  const saved = await stored(page)
  const science = saved.conversations.find((c) => c.teacherId === 't3' && c.audience === 'student')
  expect(
    saved.conversationMessages.filter((m) => m.conversationId === science.id).at(-1).text,
  ).toContain('Fen deneyi')
})
test('İki video gerçekten oynatılır', async ({ page }) => {
  await page.goto('/ogrenci/videolar')
  await expect(page.locator('.video-card')).toHaveCount(2)
  for (let i = 0; i < 2; i++) {
    await page.locator('.video-card').nth(i).click()
    const video = page.locator('video')
    await expect.poll(() => video.evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(1)
    expect(await video.evaluate((v) => v.duration)).toBeGreaterThan(50)
    await video.evaluate(async (v) => {
      v.currentTime = 0
      await v.play()
    })
    await expect.poll(() => video.evaluate((v) => v.currentTime)).toBeGreaterThan(0.3)
    await expect(page.locator('track')).toHaveAttribute('srclang', 'tr')
    await page.getByRole('button', { name: 'Pencereyi kapat' }).click()
  }
})
