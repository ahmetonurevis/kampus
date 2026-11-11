import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Download, Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { istanbulDay } from './support/commands.ts'
import { expect, test } from './support/fixtures.ts'
import { evaluatedRecords, tutorSession, TUTORING_DATA } from './support/tutoring.ts'
import { expectEveryRow } from './support/ui.ts'

// Optik değerlendirme ve otomatik etüt. Veri yazan testler kendi kurumunu `tenant()` ile kurar.
// Optik önizleme ve kayıt sunucudadır (`/assessment/evaluate[/preview]`); dosya tarayıcıda çözülür.

const OPTICAL_DATA = ['mockExams', 'mockResults', 'opticalProfiles', 'opticalEvaluations'] as const
const HEADER = 'student;booklet;answers'
const GOOD_ROW = '2026001;A;BBBDABCDABCD'
const EVALUATIONS = '/api/v1/collections/opticalEvaluations?pageSize=100'
const PROFILES = '/api/v1/collections/opticalProfiles?pageSize=100'

async function recordsOf(client: ApiClient, path: string): Promise<unknown[]> {
  const result = await client.get(path)
  expect(result.status).toBe(200)
  return (result.body as { data: unknown[] }).data
}

/** exam-8-1 (matematik, Türkçe, fen) için altı sorudan oluşan geçerli cevap anahtarı. */
const KEY_8 = [
  'booklet;question;subjectId;topic;answer',
  'A;1;math;Denklemler;B',
  'A;2;math;Oran orantı;C',
  'A;3;turkish;Sözcükte anlam;A',
  'A;4;turkish;Paragraf;D',
  'A;5;science;Hücre;A',
  'A;6;science;Madde;B',
].join('\n')

/** İndirilen CSV: dosya adı, UTF-8 BOM'u ve satırlar (BOM'suz, CRLF'e göre bölünmüş). */
async function readCsv(download: Download): Promise<{ name: string; lines: string[] }> {
  const text = await readFile(await download.path(), 'utf8')
  expect(text.charCodeAt(0), 'UTF-8 BOM').toBe(0xfeff)
  return {
    name: download.suggestedFilename(),
    lines: text
      .slice(1)
      .split('\r\n')
      .filter((line) => line !== ''),
  }
}

async function downloadBy(page: Page, button: string): Promise<{ name: string; lines: string[] }> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  return readCsv(await pending)
}

test.describe('optik değerlendirme', () => {
  test('yönetici dosya yükler, önizler, kaydeder; sonuç kayıtlı listede görünür', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: OPTICAL_DATA,
    })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await page.goto('/yonetici/optik-degerlendirme')
    await expect(page.getByRole('heading', { name: 'Optik Değerlendirme', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Okuyucu profilleri' })).toBeVisible()

    await page.getByLabel('Optik cevap dosyası', { exact: true }).setInputFiles({
      name: 'cevaplar.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(`${HEADER}\n${GOOD_ROW}\n`, 'utf8'),
    })
    await expect(page.getByText(/UTF-8 olarak okundu/)).toBeVisible()
    await page.getByRole('button', { name: 'Sonuçları önizle', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Değerlendirme önizlemesi', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '1 öğrenci' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Deniz Yılmaz' }).first()).toBeVisible()
    // Önizleme yazmaz.
    expect(await recordsOf(client, EVALUATIONS)).toHaveLength(0)

    await page.getByRole('button', { name: 'Onayla ve sonuçları kaydet', exact: true }).click()
    await expect(page.getByText(/\d+ sonuç kaydedildi\./).first()).toBeVisible()
    await expect.poll(async () => (await recordsOf(client, EVALUATIONS)).length).toBe(3)

    const saved = page.getByRole('region', { name: 'Kayıtlı değerlendirmeler' })
    await expectEveryRow(saved.getByRole('row').filter({ hasText: 'Deniz Yılmaz' }), [
      'Deniz Yılmaz',
      'Güncel',
    ])
    await expect(
      page.getByRole('heading', { name: 'Değerlendirme önizlemesi', exact: true }),
    ).toHaveCount(0)
  })

  test('sonuç ve cevap anahtarı CSV indirilir; anahtar başlığı içe aktarma biçimindedir', async ({
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
    await page.getByLabel('Optik dosya içeriği', { exact: true }).fill(`${HEADER}\n${GOOD_ROW}\n`)
    await page.getByRole('button', { name: 'Sonuçları önizle', exact: true }).click()
    await page.getByRole('button', { name: 'Onayla ve sonuçları kaydet', exact: true }).click()
    const saved = page.getByRole('region', { name: 'Kayıtlı değerlendirmeler' })
    await expect(saved.getByRole('row').filter({ hasText: 'Deniz Yılmaz' }).first()).toBeVisible()

    // Tüm sonuçlar: başlık Vue ile aynı, her satır bir ders sonucu.
    const all = await downloadBy(page, 'Sonuçları CSV indir')
    expect(all.name).toBe('optik-sonuclar.csv')
    expect(all.lines[0]).toBe(
      '"Öğrenci";"Deneme";"Ders";"Kitapçık";"Doğru";"Yanlış";"Boş";"Çoklu işaret";"İptal soru";"Net";"Durum";"Açıklama"',
    )
    expect(all.lines).toHaveLength(4)
    expect(all.lines.slice(1).every((line) => line.startsWith('"Deniz Yılmaz";'))).toBe(true)

    // Süzülmüş sonuç: aramaya uyan satırlar, görünen sayfa değil.
    await saved.getByLabel('Tabloda ara').fill('Matematik')
    const filtered = await downloadBy(page, 'Sonuçları CSV indir')
    expect(filtered.lines).toHaveLength(2)
    expect(filtered.lines[1]).toContain('"Matematik"')

    // Cevap anahtarı şablonu: ham alan adları, içe aktarma başlığıyla aynı.
    const key = await downloadBy(page, 'Cevap anahtarını indir')
    expect(key.name).toBe('optik-cevap-anahtari.csv')
    expect(key.lines[0]).toBe('"booklet";"question";"subjectId";"topic";"answer"')
    expect(key.lines.length).toBeGreaterThan(1)
    expect(key.lines[1]).toMatch(/^"A";1;"[a-z-]+";".+";"[A-E-]"$/)
  })

  test('kayıtlı değerlendirme ayrıntı paneli kazanım ve soru satırlarını gösterir; URL ile açılır', async ({
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
    await page.getByLabel('Optik dosya içeriği', { exact: true }).fill(`${HEADER}\n${GOOD_ROW}\n`)
    await page.getByRole('button', { name: 'Sonuçları önizle', exact: true }).click()
    await page.getByRole('button', { name: 'Onayla ve sonuçları kaydet', exact: true }).click()
    const saved = page.getByRole('region', { name: 'Kayıtlı değerlendirmeler' })
    await expect(saved.getByRole('row').filter({ hasText: 'Deniz Yılmaz' }).first()).toBeVisible()

    // Kayıttaki matematik: A kitapçığı, 4 soru (Denklemler); cevaplar B,B,B,D, anahtar A,B,C,D:
    // sonuç yanlış, doğru, yanlış, doğru (4 sorudan 2 doğru = %50).
    await saved.getByRole('button', { name: 'Deniz Yılmaz · Matematik ayrıntısını aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Deniz Yılmaz · Matematik' })
    await expect(panel).toBeVisible()
    await expect(page).toHaveURL(/degerlendirme=/)
    const url = page.url()
    await expect(panel.getByText('Güncel', { exact: true })).toBeVisible()
    await expect(panel.getByText('Kitapçık', { exact: true })).toBeVisible()
    await expect(panel.getByText('Net', { exact: true })).toBeVisible()

    const topics = panel.getByRole('table', { name: 'Kazanım başarıları' })
    const topicRow = topics.getByRole('row').filter({ hasText: 'Denklemler' })
    await expect(topicRow).toHaveCount(1)
    await expect(topicRow.getByRole('cell')).toContainText([
      'Denklemler',
      '2',
      '2',
      '0',
      '4',
      '%50',
    ])
    const questions = panel.getByRole('table', { name: 'Soru ayrıntıları' })
    const questionRows = questions.getByRole('row').filter({ hasText: 'Denklemler' })
    await expect(questionRows).toHaveCount(4)
    for (const [index, outcome] of ['Yanlış', 'Doğru', 'Yanlış', 'Doğru'].entries())
      await expect(questionRows.nth(index)).toContainText(outcome)

    // Bağlantıyla doğrudan açılır; Escape kapatır ve parametreyi siler.
    await page.goto(url)
    await expect(page.getByRole('dialog', { name: 'Deniz Yılmaz · Matematik' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).not.toHaveURL(/degerlendirme=/)
  })

  test('anahtar revizyonu sonrası ayrıntı paneli eski analizi nedeniyle gösterir', async ({
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
    await page.getByLabel('Optik dosya içeriği', { exact: true }).fill(`${HEADER}\n${GOOD_ROW}\n`)
    await page.getByRole('button', { name: 'Sonuçları önizle', exact: true }).click()
    await page.getByRole('button', { name: 'Onayla ve sonuçları kaydet', exact: true }).click()
    const saved = page.getByRole('region', { name: 'Kayıtlı değerlendirmeler' })
    await expect(saved.getByRole('row').filter({ hasText: 'Deniz Yılmaz' }).first()).toBeVisible()

    // Anahtar içeriği değişir (ilk sorunun cevabı): revizyon artar, kayıtlı analizler eskir.
    const profiles = page.getByRole('region', { name: 'Okuyucu profilleri' })
    await profiles.getByRole('button', { name: /profilini düzenle/ }).click()
    const edit = page.getByRole('dialog', { name: 'Optik profili düzenle' })
    const key = edit.getByLabel('Cevap anahtarı (CSV)')
    const csv = await key.inputValue()
    await key.fill(csv.replace('A;1;math;Denklemler;A', 'A;1;math;Denklemler;B'))
    await edit.getByRole('button', { name: 'Profili kaydet', exact: true }).click()
    await expect(edit).toHaveCount(0)

    await saved.getByRole('button', { name: 'Deniz Yılmaz · Matematik ayrıntısını aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Deniz Yılmaz · Matematik' })
    await expect(panel.getByText('Eski analiz', { exact: true })).toBeVisible()
    await expect(panel).toContainText('Cevap anahtarı değişti')
    await expect(panel.getByText('Güncel', { exact: true })).toHaveCount(0)
    // Ayrıntı kayıtlı analizden gösterilmeye devam eder.
    await expect(
      panel
        .getByRole('table', { name: 'Soru ayrıntıları' })
        .getByRole('row')
        .filter({ hasText: 'Denklemler' }),
    ).toHaveCount(4)
  })

  test('geçersiz veya başka kuruma ait değerlendirme bağlantısı kayıt göstermez', async ({
    loginAs,
    api,
    tenant,
  }) => {
    // Başka kurumun analizi: kimlik, kayıt anahtarıdır; bu kurumda bu kayıt yoktur.
    const other = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: ['mockExams', 'opticalProfiles'],
      records: evaluatedRecords(new Date()),
    })
    const otherEvaluations = (await recordsOf(await api(other.user('yonetici')), EVALUATIONS)) as {
      record: { id: string }
    }[]
    const foreignId = otherEvaluations[0]?.record.id
    expect(foreignId).toBeTruthy()

    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: OPTICAL_DATA,
    })
    const page = await loginAs(school.user('yonetici'))
    for (const id of ['yok-boyle-bir-kayit', foreignId as string]) {
      await page.goto(`/yonetici/optik-degerlendirme?degerlendirme=${encodeURIComponent(id)}`)
      const panel = page.getByRole('dialog', { name: 'Analiz bulunamadı' })
      await expect(panel).toBeVisible()
      await expect(panel).toContainText('rol kapsamında bulunamadı')
      await expect(panel.getByRole('table')).toHaveCount(0)
      await expect(panel).not.toContainText('Deniz Yılmaz')
    }
  })

  test('öğretmen başka branşın analizini bağlantıyla da açamaz', async ({
    loginAs,
    api,
    tenant,
  }) => {
    // t1 matematik öğretmenidir; s1'in Türkçe analizi sunucuda ona okunmaz (UI bulunamadı der).
    const school = await tenant({
      roles: ['yonetici', 'ogretmen'],
      students: ['s1'],
      collections: ['mockExams', 'opticalProfiles'],
      records: evaluatedRecords(new Date()),
    })
    const all = (await recordsOf(await api(school.user('yonetici')), EVALUATIONS)) as {
      record: { id: string; subjectId: string }
    }[]
    const turkish = all.find((item) => item.record.subjectId === 'turkish')
    const math = all.find((item) => item.record.subjectId === 'math')
    expect(turkish && math).toBeTruthy()

    const page = await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/optik-degerlendirme?degerlendirme=${turkish?.record.id}`)
    const hidden = page.getByRole('dialog', { name: 'Analiz bulunamadı' })
    await expect(hidden).toBeVisible()
    await expect(hidden).not.toContainText('Türkçe')

    // Kendi branşının analizi aynı bağlantı biçimiyle açılır (kapsam sunucudadır, UI gizlemez).
    await page.goto(`/ogretmen/optik-degerlendirme?degerlendirme=${math?.record.id}`)
    const own = page.getByRole('dialog', { name: 'Deniz Yılmaz · Matematik' })
    await expect(own).toBeVisible()
    await expect(own.getByRole('table', { name: 'Soru ayrıntıları' })).toBeVisible()
  })

  test('panel kapanınca odak satıra döner; geri ve ileri paneli kapatıp açar', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: ['mockExams', 'opticalProfiles'],
      records: evaluatedRecords(new Date()),
    })
    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/optik-degerlendirme')
    const saved = page.getByRole('region', { name: 'Kayıtlı değerlendirmeler' })
    const trigger = saved.getByRole('button', { name: 'Deniz Yılmaz · Matematik ayrıntısını aç' })
    await trigger.click()
    const panel = page.getByRole('dialog', { name: 'Deniz Yılmaz · Matematik' })
    await expect(panel).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).not.toHaveURL(/degerlendirme=/)
    await expect(trigger).toBeFocused()

    // Geri/ileri: panel URL'dedir.
    await trigger.click()
    await expect(panel).toBeVisible()
    await expect(page).toHaveURL(/degerlendirme=/)
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).not.toHaveURL(/degerlendirme=/)
    await page.goForward()
    await expect(panel).toBeVisible()
    await expect(page).toHaveURL(/degerlendirme=/)

    // Kapat düğmesi de odağı satıra döndürür.
    await panel.getByRole('button', { name: 'Pencereyi kapat' }).first().click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('hatalı satır alan mesajıyla satır numarasını gösterir ve hiçbir şey kaydetmez', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: OPTICAL_DATA,
    })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await page.goto('/yonetici/optik-degerlendirme')

    const content = page.getByLabel('Optik dosya içeriği', { exact: true })
    const preview = page.getByRole('button', { name: 'Sonuçları önizle', exact: true })

    // Eşleşmeyen öğrenci numarası: ileti satır numarasıyla alanın altında.
    await content.fill(`${HEADER}\n9999999;A;BBBDABCDABCD\n`)
    await preview.click()
    await expect(content).toHaveAccessibleDescription(
      /2\. satırdaki öğrenci tekil eşleşmedi: 9999999/,
    )
    await expect(content).toHaveAttribute('aria-invalid', 'true')

    // Cevap sayısı anahtarla uyuşmuyor: yine satır numarası.
    await content.fill(`${HEADER}\n${GOOD_ROW}\n2026002;A;BBB\n`)
    await preview.click()
    await expect(content).toHaveAccessibleDescription(/3\. satır/)
    await expect(
      page.getByRole('heading', { name: 'Değerlendirme önizlemesi', exact: true }),
    ).toHaveCount(0)
    expect(await recordsOf(client, EVALUATIONS)).toHaveLength(0)
  })

  test('Windows-1254 dosya bozulmadan okunur; desteklenmeyen tür ve 1 MB üstü dosya reddedilir', async ({
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
    const upload = page.getByLabel('Optik cevap dosyası', { exact: true })
    const content = page.getByLabel('Optik dosya içeriği', { exact: true })

    // ş, ğ, ı Windows-1254'te tek bayttır (0xFE, 0xF0, 0xFD) ve geçerli UTF-8 değildir.
    await upload.setInputFiles({
      name: 'eski.dat',
      mimeType: 'text/plain',
      buffer: Buffer.from([0x41, 0x3b, 0xfe, 0xf0, 0xfd]),
    })
    await expect(content).toHaveValue('A;şğı')
    await expect(upload).toHaveAccessibleDescription(/Windows-1254 \(Türkçe\) olarak okundu/)

    await upload.setInputFiles({
      name: 'cevaplar.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4', 'utf8'),
    })
    await expect(upload).toHaveAccessibleDescription(
      /En fazla 1 MB boyutunda CSV, DAT veya TXT dosyası seçin\.$/,
    )

    // 1 MB üstü dosya sunucuya gönderilmeden alan hatasıyla reddedilir.
    let sent = false
    page.on('request', (request) => {
      if (request.url().includes('/assessment/evaluate')) sent = true
    })
    await upload.setInputFiles({
      name: 'buyuk.csv',
      mimeType: 'text/csv',
      buffer: Buffer.alloc(1024 * 1024 + 1, 'a'),
    })
    await expect(upload).toHaveAccessibleDescription(/Dosya en fazla 1 MB olabilir\.$/)
    expect(sent).toBe(false)
  })

  test('önizlemeden sonra veri değişirse kayıt reddedilir; yeniden önizleyince kaydedilir', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: OPTICAL_DATA,
    })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await page.goto('/yonetici/optik-degerlendirme')
    await page.getByLabel('Optik dosya içeriği', { exact: true }).fill(`${HEADER}\n${GOOD_ROW}\n`)
    await page.getByRole('button', { name: 'Sonuçları önizle', exact: true }).click()
    const confirm = page.getByRole('button', { name: 'Onayla ve sonuçları kaydet', exact: true })
    await expect(confirm).toBeVisible()

    // Başka biri cevap anahtarını değiştirir: önizlemedeki netler artık geçerli değildir.
    const [stored] = await recordsOf(client, PROFILES)
    const profile = (stored as { record: Record<string, unknown> }).record
    const flipped = String(profile.keyCsv)
      .split('\n')
      .map((line, index) => {
        const cells = line.split(';')
        const answer = cells[4]
        return index === 0 || !answer
          ? line
          : [...cells.slice(0, 4), answer === 'A' ? 'B' : 'A'].join(';')
      })
      .join('\n')
    const changed = await client.post(`/api/v1/assessment/profile/${String(profile.id)}`, {
      examId: profile.examId,
      title: profile.title,
      format: profile.format,
      identifier: profile.identifier,
      headerLines: profile.headerLines,
      studentStart: profile.studentStart,
      studentLength: profile.studentLength,
      bookletStart: profile.bookletStart,
      bookletLength: profile.bookletLength,
      answersStart: profile.answersStart,
      answersLength: profile.answersLength,
      keyCsv: flipped,
    })
    expect(changed.status).toBe(200)
    const before = (await recordsOf(client, EVALUATIONS)).length

    await confirm.click()
    const alert = page.locator('main').getByRole('alert').filter({ hasText: 'Veri değişti' })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('yeniden önizleyip')
    expect(await recordsOf(client, EVALUATIONS)).toHaveLength(before)

    // Yeni önizleme gelene kadar eski (bayat) önizleme onaylanamaz: yük altında düğme eski özetle
    // yeniden görünüp ikinci bir 409'a yol açıyordu. Yanıt geciktirilerek durum belirlenimli olur.
    await page.route('**/api/v1/assessment/evaluate/preview', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })
    await alert.getByRole('button', { name: 'Yeniden önizle', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Onayla ve sonuçları kaydet' })).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: '1 öğrenci' })).toBeVisible()
    await page.getByRole('button', { name: 'Onayla ve sonuçları kaydet', exact: true }).click()
    await expect(page.getByText(/\d+ sonuç kaydedildi\./).first()).toBeVisible()
    // Aynı sınav/öğrenci/ders güncellenir, çoğalmaz (anahtar değişince eski analiz da eskir).
    await expect.poll(async () => (await recordsOf(client, EVALUATIONS)).length).toBe(3)
  })

  test('yönetici profil ekler ve düzenler; hatalı anahtar satır numarasıyla bildirilir', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: OPTICAL_DATA,
    })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await page.goto('/yonetici/optik-degerlendirme')
    await page.getByRole('button', { name: 'Profil ekle', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Optik profil ekle' })
    await dialog.getByLabel('Profil adı').fill('LGS profili')
    await dialog.getByLabel('Deneme', { exact: true }).selectOption('exam-8-1')

    // Bilinmeyen ders kodu: satır numarası anahtar alanının altında.
    const key = dialog.getByLabel('Cevap anahtarı (CSV)')
    await key.fill(KEY_8.replace('A;3;turkish', 'A;3;bilinmeyen'))
    await dialog.getByRole('button', { name: 'Profili kaydet', exact: true }).click()
    await expect(key).toHaveAccessibleDescription(/\. satır/)
    expect(await recordsOf(client, PROFILES)).toHaveLength(1)

    await key.fill(KEY_8)
    await dialog.getByRole('button', { name: 'Profili kaydet', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const profiles = page.getByRole('region', { name: 'Okuyucu profilleri' })
    await expect(profiles.getByRole('cell', { name: 'LGS profili', exact: true })).toBeVisible()
    await expect.poll(async () => (await recordsOf(client, PROFILES)).length).toBe(2)

    // Düzenleme: ad değişir, sınav değişmez.
    await profiles.getByRole('button', { name: 'LGS profili profilini düzenle' }).click()
    const edit = page.getByRole('dialog', { name: 'Optik profili düzenle' })
    await edit.getByLabel('Profil adı').fill('LGS profili (revize)')
    await edit.getByRole('button', { name: 'Profili kaydet', exact: true }).click()
    await expect(edit).toHaveCount(0)
    await expect(
      profiles.getByRole('cell', { name: 'LGS profili (revize)', exact: true }),
    ).toBeVisible()
  })

  test('öğretmen dosyayı değerlendirir ama profil formunu görmez', async ({ loginAs, tenant }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen'],
      students: ['s1'],
      collections: OPTICAL_DATA,
    })
    const page = await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/optik-degerlendirme')
    await expect(page.getByRole('heading', { name: 'Okuyucu profilleri' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Cevap dosyasını değerlendir' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Profil ekle' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /profilini düzenle/ })).toHaveCount(0)
  })
})

// --- Otomatik etüt ---------------------------------------------------------------------------
// Optik analizi kaydeden API ucu yoktur; etüt planının girdisi olan analiz çekirdek kuralıyla
// üretilip kurumun veritabanına konur (tenant `records`). Plan, iptal ve yoklama gerçek uçlardan
// geçer. Ders programı/randevu/etkinlik konmaz: çakışma kaynağı boştur. Plan önizlemesi ve onayı
// sunucudadır (`/assessment/plan[/preview]`); uygunluk saati `/assessment/slot[-remove]` ile.

const SESSIONS = '/api/v1/collections/tutorSessions?pageSize=100'

interface SessionRow {
  id: string
  version: number
  record: { status: string; attendance: Record<string, string>; cancelReason?: string }
}

async function sessionsOf(client: ApiClient): Promise<SessionRow[]> {
  const result = await client.get(SESSIONS)
  expect(result.status).toBe(200)
  return (result.body as { data: SessionRow[] }).data
}

async function slotsOf(client: ApiClient): Promise<{ id: string; record: { duration: number } }[]> {
  const result = await client.get('/api/v1/collections/availability?pageSize=100')
  expect(result.status).toBe(200)
  return (result.body as { data: { id: string; record: { duration: number } }[] }).data
}

/** Sunucunun şu anki plan önizlemesindeki `expectedPlan` (başka bir istemcinin onayı için). */
async function expectedPlanOf(client: ApiClient): Promise<string> {
  const result = await client.post('/api/v1/assessment/plan/preview', {
    examId: 'exam-7-1',
    threshold: 100,
    fromDate: istanbulDay(0),
    toDate: istanbulDay(14),
    duration: 30,
    maxGroupSize: 6,
    branchId: '',
    subjectId: '',
  })
  expect(result.status).toBe(200)
  return (result.body as { data: { expectedPlan: string } }).data.expectedPlan
}

async function openPlanForm(page: Page) {
  await page.goto('/yonetici/otomatik-etut')
  await page.getByRole('button', { name: 'Etüt planla' }).click()
  await page.getByLabel('Deneme', { exact: true }).selectOption('exam-7-1')
  await page.getByLabel('Başarı eşiği (%)').fill('100')
  await page.getByLabel('Bitiş tarihi').fill(istanbulDay(14))
}

test.describe('otomatik etüt', () => {
  test('yönetici planı önizler ve onaylar; öğrenci kendi etüdünü salt okunur görür', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogrenci'],
      students: ['s1'],
      collections: TUTORING_DATA,
      records: evaluatedRecords(new Date()),
    })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await openPlanForm(page)

    await page.getByRole('button', { name: 'Etüt planını önizle', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Etüt planı önizlemesi', exact: true }),
    ).toBeVisible()
    // Önizleme saf işlemdir: sunucuda hiç etüt yoktur.
    expect(await sessionsOf(client)).toHaveLength(0)

    await page.getByRole('button', { name: 'Onayla ve etütleri oluştur', exact: true }).click()
    await expect(page.getByText(/\d+ etüt oluşturuldu\./).first()).toBeVisible()
    await expect.poll(async () => (await sessionsOf(client)).length).toBeGreaterThan(0)

    const student = await loginAs(school.user('ogrenci'))
    await student.goto('/ogrenci/otomatik-etut')
    await expect(student.getByRole('heading', { name: 'Otomatik Etüt', level: 1 })).toBeVisible()
    const first = student.getByRole('button', { name: /Matematik · /i }).first()
    await expect(first).toBeVisible()
    await expect(student.getByRole('button', { name: 'Etüt planla' })).toHaveCount(0)
    await first.click()
    const dialog = student.getByRole('dialog')
    await expect(dialog).toContainText('Deniz Yılmaz')
    for (const name of ['Yoklama al / güncelle', 'Etüdü iptal et'])
      await expect(dialog.getByRole('button', { name })).toHaveCount(0)
  })

  test('etüt listesi ve plan önizlemesi CSV indirilir; öğrenci yalnız kendi etütlerini indirir', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogrenci'],
      students: ['s1'],
      collections: TUTORING_DATA,
      records: evaluatedRecords(new Date()),
    })
    const page = await loginAs(school.user('yonetici'))
    await openPlanForm(page)
    await page.getByRole('button', { name: 'Etüt planını önizle', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Etüt planı önizlemesi', exact: true }),
    ).toBeVisible()
    const preview = await downloadBy(page, 'Önizlemeyi CSV indir')
    expect(preview.name).toBe('etut-onizleme.csv')
    expect(preview.lines[0]).toBe(
      '"Etüt / Kazanım";"Öğretmen";"Kampüs";"Tarih";"Derslik";"Öğrenciler";"Durum";"Açıklama"',
    )
    expect(preview.lines.length).toBeGreaterThan(1)
    expect(preview.lines[1]).toContain('"Planlanabilir')
    expect(preview.lines[1]).toContain('Deniz Yılmaz')

    await page.getByRole('button', { name: 'Onayla ve etütleri oluştur', exact: true }).click()
    await expect(page.getByText(/\d+ etüt oluşturuldu\./).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Matematik · /i }).first()).toBeVisible()

    const list = await downloadBy(page, 'Etüt listesini CSV indir')
    expect(list.name).toBe('etut-plani.csv')
    expect(list.lines[0]).toBe(
      '"Etüt / Kazanım";"Öğretmen";"Kampüs";"Tarih";"Derslik";"Öğrenciler";"Durum"',
    )
    expect(list.lines.length).toBeGreaterThan(1)
    expect(list.lines[1]).toContain('"Planlandı"')

    // Veri kapsamı ekranla aynıdır: öğrenci kendi etütlerini indirir.
    const student = await loginAs(school.user('ogrenci'))
    await student.goto('/ogrenci/otomatik-etut')
    await expect(student.getByRole('button', { name: /Matematik · /i }).first()).toBeVisible()
    const own = await downloadBy(student, 'Etüt listesini CSV indir')
    expect(own.lines.length).toBe(list.lines.length)
    expect(own.lines.slice(1).every((line) => line.includes('Deniz Yılmaz'))).toBe(true)
  })

  test('onay sırasında plan değişirse fark gösterilir ve çift etüt oluşmaz', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: TUTORING_DATA,
      records: evaluatedRecords(new Date()),
    })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await openPlanForm(page)
    await page.getByRole('button', { name: 'Etüt planını önizle', exact: true }).click()
    const confirm = page.getByRole('button', { name: 'Onayla ve etütleri oluştur', exact: true })
    await expect(confirm).toBeEnabled()

    // Önizlemeden sonra başka biri aynı planı onaylar: sunucu planı artık farklı hesaplar.
    const created = await client.post(
      '/api/v1/assessment/plan',
      {
        examId: 'exam-7-1',
        threshold: 100,
        fromDate: istanbulDay(0),
        toDate: istanbulDay(14),
        duration: 30,
        maxGroupSize: 6,
        branchId: '',
        subjectId: '',
        expectedPlan: await expectedPlanOf(client),
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(created.status).toBe(200)
    const before = (await sessionsOf(client)).length
    expect(before).toBeGreaterThan(0)

    await confirm.click()
    const alert = page.locator('main').getByRole('alert').filter({ hasText: 'Plan değişmiş' })
    await expect(alert).toBeVisible()
    // Önizlemedeki etütler artık planda yok (zaten etütte); fark listelenir, hiçbir etüt eklenmez.
    await expect(alert.getByRole('heading', { name: 'Kalkan etütler' })).toBeVisible()
    expect(await sessionsOf(client)).toHaveLength(before)

    // Yeniden önizleme güncel planı gösterir; yapılacak etüt kalmadığından onaylanamaz.
    await alert.getByRole('button', { name: 'Planı yeniden önizle', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Etüt planı önizlemesi', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Zaten etütte olan kazanımlar' })).toBeVisible()
    await expect(confirm).toBeDisabled()
    expect(await sessionsOf(client)).toHaveLength(before)
  })

  test('yerleşemeyen gruplar nedeniyle gösterilir', async ({ loginAs, tenant }) => {
    // Uygunluk saati kaydı yok: hiçbir grup yerleşemez ve neden yazılır.
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: ['mockExams', 'opticalProfiles'],
      records: evaluatedRecords(new Date()),
    })
    const page = await loginAs(school.user('yonetici'))
    await openPlanForm(page)
    await page.getByRole('button', { name: 'Etüt planını önizle', exact: true }).click()
    const unresolved = page.getByRole('region', { name: 'Yerleşemeyen gruplar' })
    await expect(unresolved).toBeVisible()
    await expectEveryRow(unresolved.locator('tbody td:last-child'), 'uygunluk saati yok')
    await expect(
      page.getByRole('button', { name: 'Onayla ve etütleri oluştur', exact: true }),
    ).toBeDisabled()
  })

  test('plan formu hatalarını alanda gösterir; yazma yetkisi olmayan rol uygunluk saatini görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogrenci'],
      students: ['s1'],
      collections: TUTORING_DATA,
    })
    const page = await loginAs(school.user('yonetici'))
    await openPlanForm(page)
    await page.getByLabel('Başarı eşiği (%)').fill('0')
    await page.getByRole('button', { name: 'Etüt planını önizle', exact: true }).click()
    await expect(page.getByLabel('Başarı eşiği (%)')).toHaveAccessibleDescription(/\S/)
    await expect(
      page.getByRole('heading', { name: 'Etüt planı önizlemesi', exact: true }),
    ).toHaveCount(0)

    const student = await loginAs(school.user('ogrenci'))
    await student.goto('/ogrenci/otomatik-etut')
    await expect(student.getByRole('heading', { name: 'Otomatik Etüt', level: 1 })).toBeVisible()
    await expect(student.getByRole('heading', { name: 'Öğretmen uygunluk saatleri' })).toHaveCount(
      0,
    )
    await expect(student.getByRole('form', { name: 'Uygunluk saati ekle' })).toHaveCount(0)
  })

  test('yönetici uygunluk saati ekler ve onayla kaldırır; geçmiş saat reddedilir', async ({
    loginAs,
    api,
    tenant,
  }) => {
    // Uygunluk kaydı konmaz: liste boş başlar, yalnız bu testin saatleri görünür.
    const school = await tenant({ roles: ['yonetici'] })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await page.goto('/yonetici/otomatik-etut')
    const form = page.getByRole('form', { name: 'Uygunluk saati ekle' })
    await expect(form).toBeVisible()
    expect(await slotsOf(client)).toHaveLength(0)

    // Geçmiş saat sunucu kuralıyla reddedilir ve tarih alanında görünür.
    await form.getByLabel('Başlangıç (tarih ve saat)').fill(`${istanbulDay(-2)}T10:00`)
    await form.getByRole('button', { name: 'Uygunluk saati ekle', exact: true }).click()
    await expect(form.getByText('Uygunluk saati gelecekte olmalıdır.')).toBeVisible()
    expect(await slotsOf(client)).toHaveLength(0)

    await form.getByLabel('Başlangıç (tarih ve saat)').fill(`${istanbulDay(20)}T14:20`)
    await form.getByLabel('Süre (dakika)').fill('45')
    await form.getByRole('button', { name: 'Uygunluk saati ekle', exact: true }).click()
    await expect(page.getByText('Uygunluk saati eklendi.').first()).toBeVisible()
    await expect.poll(async () => (await slotsOf(client)).length).toBe(1)
    expect((await slotsOf(client))[0]?.record.duration).toBe(45)

    // Aynı aralıkla çakışan saat eklenmez.
    await form.getByLabel('Başlangıç (tarih ve saat)').fill(`${istanbulDay(20)}T14:30`)
    await form.getByRole('button', { name: 'Uygunluk saati ekle', exact: true }).click()
    await expect(form.getByText(/çakış/i).first()).toBeVisible()
    expect(await slotsOf(client)).toHaveLength(1)

    await page.getByRole('button', { name: /14:20 uygunluk saatini kaldır$/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Uygunluk saatini kaldır' })
    await dialog.getByRole('button', { name: 'Vazgeç', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(await slotsOf(client)).toHaveLength(1)

    await page.getByRole('button', { name: /14:20 uygunluk saatini kaldır$/ }).click()
    await page
      .getByRole('dialog', { name: 'Uygunluk saatini kaldır' })
      .getByRole('button', { name: 'Saati kaldır', exact: true })
      .click()
    await expect(page.getByText('Uygunluk saati kaldırıldı.').first()).toBeVisible()
    await expect.poll(async () => (await slotsOf(client)).length).toBe(0)
  })

  test('öğretmen yalnız kendi uygunluk saatini ekler', async ({ loginAs, api, tenant }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    const page = await loginAs(school.user('ogretmen'))
    const client = await api(school.user('ogretmen'))
    await page.goto('/ogretmen/otomatik-etut')
    const form = page.getByRole('form', { name: 'Uygunluk saati ekle' })
    await expect(form).toBeVisible()
    expect(await slotsOf(client)).toHaveLength(0)
    // Öğretmen seçici görmez: saat kendi adına eklenir.
    await expect(form.getByLabel('Öğretmen', { exact: true })).toHaveCount(0)
    await form.getByLabel('Başlangıç (tarih ve saat)').fill(`${istanbulDay(21)}T09:20`)
    await form.getByRole('button', { name: 'Uygunluk saati ekle', exact: true }).click()
    await expect(page.getByText('Uygunluk saati eklendi.').first()).toBeVisible()
    await expect.poll(async () => (await slotsOf(client)).length).toBe(1)
    await expect(page.getByRole('button', { name: /09:20 uygunluk saatini kaldır$/ })).toHaveCount(
      1,
    )
  })

  test('yönetici geçmiş etüdün yoklamasını alır; tamamlanan etüt iptal edilemez', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const past = tutorSession('tutor-e2e-past', new Date(Date.now() - 2 * 86_400_000))
    const school = await tenant({ roles: ['yonetici'], students: ['s1'], records: [past] })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await page.goto('/yonetici/otomatik-etut')
    await page.getByRole('button', { name: 'Matematik · Denklemler', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Yoklama al / güncelle', exact: true }).click()
    await dialog.getByRole('combobox', { name: 'Deniz Yılmaz', exact: true }).selectOption('İzinli')
    await dialog.getByRole('button', { name: 'Yoklamayı kaydet', exact: true }).click()
    await expect(dialog).toContainText('Tamamlandı')
    await expect(dialog).toContainText('İzinli')
    await expect(dialog.getByRole('button', { name: 'Etüdü iptal et' })).toHaveCount(0)
    await expect
      .poll(async () => (await sessionsOf(client))[0]?.record)
      .toMatchObject({ status: 'Tamamlandı', attendance: { s1: 'İzinli' } })
  })

  test('iptal gerekçesi zorunludur ve iptal edilen etüt geçmişte kalır', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const future = tutorSession('tutor-e2e-future', new Date(Date.now() + 3 * 86_400_000))
    const school = await tenant({ roles: ['yonetici'], students: ['s1'], records: [future] })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await page.goto('/yonetici/otomatik-etut')
    await page.getByRole('button', { name: 'Matematik · Denklemler', exact: true }).click()
    const dialog = page.getByRole('dialog')
    // Gelecek etütte yoklama açılmaz.
    await expect(dialog.getByRole('button', { name: 'Yoklama al / güncelle' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Etüdü iptal et', exact: true }).click()
    await dialog.getByRole('button', { name: 'İptali onayla', exact: true }).click()
    await expect(dialog.getByText('İptal nedenini girin.')).toBeVisible()
    expect((await sessionsOf(client))[0]?.record.status).toBe('Planlandı')

    await dialog.getByLabel('İptal nedeni').fill('Öğretmen izinli')
    await dialog.getByRole('button', { name: 'İptali onayla', exact: true }).click()
    await expect(dialog).toContainText('Öğretmen izinli')
    await expect
      .poll(async () => (await sessionsOf(client))[0]?.record)
      .toMatchObject({ status: 'İptal', cancelReason: 'Öğretmen izinli' })
  })

  test('boş etüt listesi arama yokken "Henüz etüt yok" der; aranınca temizleme düğmesi çıkar', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'], students: ['s1'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/otomatik-etut')
    // Sayfada uygunluk saatleri tablosu da var; denetim yalnız etüt listesinde.
    const sessions = page.getByRole('region', { name: 'Etütler', exact: true })
    const clear = sessions.getByRole('button', { name: 'Aramayı ve filtreleri temizle' })
    await expect(sessions.getByText('Henüz etüt yok.')).toBeVisible()
    await expect(clear).toHaveCount(0)

    await sessions.getByLabel('Tabloda ara').fill('zzzz-yok')
    await expect(sessions.getByText('Aramanızla eşleşen kayıt bulunamadı.')).toBeVisible()
    await clear.first().click()
    await expect(sessions.getByText('Henüz etüt yok.')).toBeVisible()
    await expect(clear).toHaveCount(0)
  })

  test('dil okulunda optik ve etüt adresleri kullanıma kapalı der', async ({ loginAs }) => {
    const page = await loginAs({ email: 'ozan.er@kampus.example' })
    for (const path of ['optik-degerlendirme', 'otomatik-etut']) {
      await page.goto(`/ogretmen/${path}`)
      await expect(page.getByRole('heading', { name: 'Modül kullanıma kapalı' })).toBeVisible()
    }
  })
})
