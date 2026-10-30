import { expect, test } from './support/fixtures.ts'

// Optik değerlendirme ve otomatik etüt. Veri yazan testler kendi kurumunu `tenant()` ile kurar.
// Optik ön kontrol saf işlemdir (core `previewOptical`, istemcide); kaydetme ucu API'de yoktur
// (TODO(api-optical-evaluate)), bu yüzden test ön kontrolü ve kilitli kaydı doğrular.

const OPTICAL_DATA = ['mockExams', 'mockResults', 'opticalProfiles', 'opticalEvaluations'] as const
const HEADER = 'student;booklet;answers'

test.describe('optik değerlendirme', () => {
  test('yönetici dosya yükler; ön kontrol hatası satır numarasıyla çıkar, düzgün dosya önizlenir', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: OPTICAL_DATA,
    })
    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/optik-degerlendirme')
    await expect(page.getByRole('heading', { name: 'Optik Değerlendirme', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Okuyucu profilleri' })).toBeVisible()

    const upload = page.getByLabel('Optik cevap dosyası', { exact: true })
    const content = page.getByLabel('Optik dosya içeriği', { exact: true })
    const preview = page.getByRole('button', { name: 'Sonuçları önizle', exact: true })

    // Eşleşmeyen öğrenci numarası: hata satır numarasıyla, hiçbir sonuç gösterilmeden.
    await upload.setInputFiles({
      name: 'cevaplar.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`${HEADER}\n9999999;A;BBBDABCDABCD\n`, 'utf8'),
    })
    await expect(content).toHaveValue(/9999999/)
    await preview.click()
    await expect(page.getByRole('alert')).toContainText(
      '2. satırdaki öğrenci tekil eşleşmedi: 9999999',
    )
    await expect(
      page.getByRole('heading', { name: 'Değerlendirme önizlemesi', exact: true }),
    ).toHaveCount(0)

    // Cevap sayısı anahtarla uyuşmuyor: yine satır numarası.
    await content.fill(`${HEADER}\n2026001;A;BBB\n`)
    await preview.click()
    await expect(page.getByRole('alert')).toContainText('2. satırda 12 cevap bekleniyor')

    // Düzgün dosya: önizleme açılır, kayıt ucu olmadığı için onay kilitli kalır.
    await upload.setInputFiles({
      name: 'cevaplar.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(`${HEADER}\n2026001;A;BBBDABCDABCD\n`, 'utf8'),
    })
    await preview.click()
    await expect(
      page.getByRole('heading', { name: 'Değerlendirme önizlemesi', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '1 öğrenci' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Deniz Yılmaz' }).first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Onayla ve sonuçları kaydet', exact: true }),
    ).toBeDisabled()
  })

  test('desteklenmeyen dosya türü reddedilir', async ({ loginAs, tenant }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: OPTICAL_DATA,
    })
    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/optik-degerlendirme')
    await page.getByLabel('Optik cevap dosyası', { exact: true }).setInputFiles({
      name: 'cevaplar.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4', 'utf8'),
    })
    await expect(
      page.getByText('En fazla 1 MB boyutunda CSV, DAT veya TXT dosyası seçin.'),
    ).toBeVisible()
    await expect(page.getByLabel('Optik dosya içeriği', { exact: true })).toHaveValue('')
  })
})
