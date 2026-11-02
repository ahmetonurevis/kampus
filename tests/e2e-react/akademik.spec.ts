import { readFile } from 'node:fs/promises'

import type { Download, Page } from '@playwright/test'

import { dayKey } from '../../packages/school-core/src/lib/format.ts'
import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// Akademik okuma ekranları: öğretmen (Selin Kaya), öğrenci (Deniz Yılmaz), veli (Ayşe Yılmaz;
// çocukları Deniz ve Ece). Paylaşılan oturumlar salt okunurdur; hiçbir test kayıt yazmaz. Seed
// tarihleri koşu anına göredir; bu yüzden beklenen sayılar sabit yazılmaz, API'den okunur
// (kapsamı sunucu uygular) ve ekranla karşılaştırılır. Seed: Selin 8 sınıfa (24 sınıfın 8'i,
// sınıf başına 10 öğrenci) bakar; Deniz 7-A, Ece 5-A sınıfındadır.

const NOT_FOUND = /Kayıt bulunamadı/
const COLLECTIONS = '/api/v1/collections'
/** Selin'in kapsamı dışındaki sınıf (7-B) ve başka öğrencinin (s5) notu; yönetici görür. */
const FOREIGN_CLASS = 'c9'
const FOREIGN_GRADE = 'g-s5-0-1'

interface CollectionPage {
  data: { id: string; record: Record<string, unknown> }[]
  meta: { total: number }
}

async function listAll(client: ApiClient, collection: string, query = '') {
  const records: Record<string, unknown>[] = []
  for (let page = 1; ; page++) {
    const result = await client.get(
      `${COLLECTIONS}/${collection}?pageSize=100&page=${page}${query}`,
    )
    expect(result.status, `${collection} sayfa ${page}`).toBe(200)
    const body = result.body as CollectionPage
    records.push(...body.data.map((row) => row.record))
    if (records.length >= body.meta.total || body.data.length === 0) return records
  }
}

const num = (record: Record<string, unknown>, key: string) => Number(record[key])
const rounded = (values: number[]) =>
  Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
const tally = (records: Record<string, unknown>[], status: string) =>
  records.filter((record) => record.status === status).length

const tableOf = (page: Page, name: string) => page.getByRole('table', { name, exact: true })
const bodyRows = (page: Page, name: string) => tableOf(page, name).locator('tbody tr')
const resultCount = (page: Page) => page.locator('.result-count')
/** Özet kartı (`dl` içinde `dt` + `dd` çifti taşıyan kutu). */
const stat = (page: Page, group: string, label: string) =>
  page
    .getByLabel(group, { exact: true })
    .locator('div')
    .filter({ has: page.getByText(label, { exact: true }) })

async function downloadList(page: Page): Promise<string[][]> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Listeyi indir' }).click()
  const download: Download = await pending
  const text = await readFile(await download.path(), 'utf8')
  expect(text.charCodeAt(0), 'UTF-8 BOM').toBe(0xfeff)
  return text
    .slice(1)
    .split('\r\n')
    .map((line) => line.split(';').map((cell) => cell.replace(/^"|"$/g, '')))
}

test.describe('öğretmen: Sınıflarım, not listesi, yoklama geçmişi', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('ogretmen')
  })

  test('yalnız kendi sınıflarını listeler; başka sınıf listede ve ucunda yoktur', async ({
    page,
    api,
  }) => {
    await page.goto('/ogretmen/siniflarim')
    await expect(page.getByRole('heading', { level: 1, name: 'Sınıflarım' })).toBeVisible()
    await expect(page.getByText('8 kayıt · Ders verdiğiniz ve danışmanı olduğunuz')).toBeVisible()
    await expect(bodyRows(page, 'Sınıflarım')).toHaveCount(8)
    await expect(resultCount(page)).toContainText('1–8 / 8 kayıt')

    const table = tableOf(page, 'Sınıflarım')
    await expect(table.getByRole('button', { name: /^\d+-A$/ })).toHaveCount(8)
    await expect(table.getByRole('button', { name: /^\d+-[BC]$/ })).toHaveCount(0)
    await expect(table.getByText('Sınıf danışmanı').first()).toBeVisible()

    // Kapsamı sunucu uygular: yönetici yabancı sınıfı görür, öğretmen 404 alır.
    const teacher = await api('ogretmen')
    const admin = await api('yonetici')
    expect((await admin.get(`${COLLECTIONS}/classes/${FOREIGN_CLASS}`)).status).toBe(200)
    expect((await teacher.get(`${COLLECTIONS}/classes/${FOREIGN_CLASS}`)).status).toBe(404)
  })

  test('sınıf özeti URLde açılır; geri kapatır, ileri açar; sınıf düzeyi sayfayı sıfırlar', async ({
    page,
  }) => {
    await page.goto('/ogretmen/siniflarim')
    await page.getByRole('button', { name: 'Filtreler' }).click()
    await page.getByLabel('Sınıf düzeyi').selectOption({ label: '7. Sınıf' })
    await expect(page).toHaveURL(/[?&]duzey=7/)
    await expect(resultCount(page)).toContainText('1–1 / 1 kayıt')

    await tableOf(page, 'Sınıflarım').getByRole('button', { name: '7-A', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Sınıf özeti' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: '7-A' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Öğrenciler', exact: true })).toBeVisible()
    await expect(page).toHaveURL(/[?&]sinif=c1/)

    await page.goBack()
    await expect(dialog).toBeHidden()
    // Liste bağlamı (filtre) geri gidişte korunur.
    await expect(page).toHaveURL(/[?&]duzey=7/)
    await page.goForward()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page).not.toHaveURL(/[?&]sinif=/)
  })

  test('kapsam dışı sınıf ve not adresi "bulunamadı" görünümüne düşer', async ({ page, api }) => {
    await page.goto(`/ogretmen/siniflarim?sinif=${FOREIGN_CLASS}`)
    const classDialog = page.getByRole('dialog', { name: 'Sınıf özeti' })
    await expect(classDialog.getByText(NOT_FOUND)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(classDialog).toBeHidden()

    await page.goto(`/ogretmen/siniflarim?sekme=notlar&not=${FOREIGN_GRADE}`)
    const gradeDialog = page.getByRole('dialog', { name: 'Not ayrıntısı' })
    await expect(gradeDialog.getByText(NOT_FOUND)).toBeVisible()

    const admin = await api('yonetici')
    const teacher = await api('ogretmen')
    expect((await admin.get(`${COLLECTIONS}/grades/${FOREIGN_GRADE}`)).status).toBe(200)
    expect((await teacher.get(`${COLLECTIONS}/grades/${FOREIGN_GRADE}`)).status).toBe(404)
  })

  test('not listesi sınıf ve ders filtresiyle süzülür; satır paneli geri ve ileriyle gezilir', async ({
    page,
    api,
  }) => {
    const teacher = await api('ogretmen')
    const students = await listAll(teacher, 'students')
    const classStudents = new Set(
      students.filter((student) => student.classId === 'c1').map((student) => String(student.name)),
    )
    expect(classStudents.size).toBe(10)
    const grades = (await teacher.get(`${COLLECTIONS}/grades?pageSize=1`)).body as CollectionPage
    // Sınıf süzgeci sunucuda `classId` ile uygulanır (öğrencinin güncel sınıfı).
    const classGrades = (await teacher.get(`${COLLECTIONS}/grades?pageSize=1&classId=c1`))
      .body as CollectionPage
    expect(classGrades.meta.total).toBeGreaterThan(0)
    expect(classGrades.meta.total).toBeLessThan(grades.meta.total)

    await page.goto('/ogretmen/siniflarim?sekme=notlar')
    const table = 'Not listesi'
    await expect(resultCount(page)).toContainText(`/ ${grades.meta.total} kayıt`)
    await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
    await expect(page).toHaveURL(/[?&]not-sayfa=2/)

    await page.getByLabel('Not sınıfı').selectOption({ label: '7-A' })
    await expect(page).toHaveURL(/[?&]not-sinif=c1/)
    await expect(page).not.toHaveURL(/[?&]not-sayfa=/)
    await expect(resultCount(page)).toContainText(`/ ${classGrades.meta.total} kayıt`)
    await expect(page.getByText(/ilk 20 öğrenciyle sınırlıdır/)).toHaveCount(0)
    for (const row of await bodyRows(page, table).all())
      expect(classStudents.has((await row.locator('strong').first().innerText()).trim())).toBe(true)

    await page.getByLabel('Not dersi').selectOption({ label: 'Matematik' })
    await expect(page).toHaveURL(/[?&]not-ders=/)
    await expect(bodyRows(page, table).first()).toBeVisible()
    await expectEveryRow(bodyRows(page, table), 'Matematik')

    const first = bodyRows(page, table).first()
    await first.getByRole('button').first().click()
    const dialog = page.getByRole('dialog', { name: 'Not ayrıntısı' })
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/[?&]not=/)
    await page.goBack()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/[?&]not-sinif=c1/)
    await page.goForward()
    await expect(dialog).toBeVisible()
  })

  test('yoklama geçmişi sınıf ve tarihle süzülür; CSV tüm filtrelenmiş sonucu içerir', async ({
    page,
    api,
  }) => {
    const teacher = await api('ogretmen')
    const c1 = await listAll(teacher, 'attendance', '&classId=c1')
    const day = String(c1[0]?.date).slice(0, 10)
    const onDay = await listAll(teacher, 'attendance', `&classId=c1&dateFrom=${day}&dateTo=${day}`)
    expect(onDay.length).toBeGreaterThan(0)
    expect(onDay.length).toBeLessThan(c1.length)

    await page.goto('/ogretmen/yoklama')
    await expect(page.getByRole('heading', { level: 1, name: 'Yoklama' })).toBeVisible()
    await expect(bodyRows(page, 'Yoklama geçmişi')).toHaveCount(8)

    await page.getByLabel('Yoklama sınıfı').selectOption({ label: '7-A' })
    await expect(page).toHaveURL(/[?&]sinif=c1/)
    await expect(resultCount(page)).toContainText(`/ ${c1.length} kayıt`)
    await expectEveryRow(bodyRows(page, 'Yoklama geçmişi'), '7-A')

    // Görünen yalnız ilk sayfadır; dosya filtrelenmiş sınıfın bütün kayıtlarıdır.
    const all = await downloadList(page)
    expect(all[0]).toEqual(['Öğrenci', 'Sınıf', 'Ders tarihi', 'Katılım', 'Not'])
    expect(all).toHaveLength(1 + c1.length)

    await page.getByLabel('Yoklama başlangıç tarihi').fill(day)
    await page.getByLabel('Yoklama bitiş tarihi').fill(day)
    await expect(page).toHaveURL(new RegExp(`[?&]baslangic=${day}`))
    await expect(page).toHaveURL(new RegExp(`[?&]bitis=${day}`))
    await expect(resultCount(page)).toContainText(`/ ${onDay.length} kayıt`)
    const filtered = await downloadList(page)
    expect(filtered).toHaveLength(1 + onDay.length)
    for (const row of filtered.slice(1)) expect(row[1]).toBe('7-A')

    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).first().click()
    await expect(page).not.toHaveURL(/[?&](sinif|baslangic|bitis)=/)
  })

  test('yoklama tarih aralığı adresi doğrudan açılır ve sunucuda süzer', async ({ page, api }) => {
    const teacher = await api('ogretmen')
    const all = await listAll(teacher, 'attendance')
    const day = String(all[0]?.date).slice(0, 10)
    const onDay = await listAll(teacher, 'attendance', `&dateFrom=${day}&dateTo=${day}`)
    expect(onDay.length).toBeGreaterThan(0)
    expect(onDay.length).toBeLessThan(all.length)

    await page.goto(`/ogretmen/yoklama?baslangic=${day}&bitis=${day}`)
    await expect(page.getByLabel('Yoklama başlangıç tarihi')).toHaveValue(day)
    await expect(page.getByLabel('Yoklama bitiş tarihi')).toHaveValue(day)
    await expect(resultCount(page)).toContainText(`/ ${onDay.length} kayıt`)
    await expect(bodyRows(page, 'Yoklama geçmişi')).toHaveCount(Math.min(8, onDay.length))
    // Tarih süzgeci serbest aramayı kapatmaz.
    await expect(page.getByLabel('Tabloda ara')).toBeVisible()
  })

  test('yoklama kaydı paneli geri ve ileriyle gezilir', async ({ page }) => {
    await page.goto('/ogretmen/yoklama')
    await expect(bodyRows(page, 'Yoklama geçmişi')).toHaveCount(8)
    await bodyRows(page, 'Yoklama geçmişi').first().getByRole('button').first().click()
    const dialog = page.getByRole('dialog', { name: 'Yoklama ayrıntısı' })
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/[?&]kayit=/)
    await page.goBack()
    await expect(dialog).toBeHidden()
    await page.goForward()
    await expect(dialog).toBeVisible()
  })
})

test.describe('öğrenci: Notlarım, Devamsızlığım, Ders Programım', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('ogrenci')
  })

  test('yalnız kendi notlarını görür; ortalamalar kayıtlardan hesaplanır', async ({
    page,
    api,
  }) => {
    const client = await api('ogrenci')
    const grades = await listAll(client, 'grades')
    expect(grades.length).toBeGreaterThan(0)
    expect(new Set(grades.map((grade) => grade.studentId))).toEqual(new Set(['s1']))
    const math = grades.filter((grade) => grade.subject === 'Matematik').map((g) => num(g, 'score'))

    await page.goto('/ogrenci/notlarim')
    await expect(page.getByRole('heading', { level: 1, name: 'Notlarım' })).toBeVisible()
    await expect(stat(page, 'Not özeti', 'Genel ortalama')).toContainText(
      `${rounded(grades.map((grade) => num(grade, 'score')))}/100`,
    )
    await expect(stat(page, 'Not özeti', 'Genel ortalama')).toContainText(
      `${grades.length} değerlendirme`,
    )
    await expect(stat(page, 'Not özeti', 'Matematik')).toContainText(`${rounded(math)}/100`)
    await expect(resultCount(page)).toContainText(`/ ${grades.length} kayıt`)
    // Öğrenci görünümünde öğrenci sütunu ve sınıf filtresi yoktur.
    await expect(
      tableOf(page, 'Notlarım').getByRole('columnheader', { name: 'Öğrenci' }),
    ).toHaveCount(0)
    await expect(page.getByLabel('Not sınıfı')).toHaveCount(0)

    await page.getByLabel('Not dersi').selectOption({ label: 'Matematik' })
    await expect(page).toHaveURL(/[?&]ders=/)
    await expect(resultCount(page)).toContainText(`/ ${math.length} kayıt`)
    await expectEveryRow(bodyRows(page, 'Notlarım'), 'Matematik')
  })

  test('başka öğrencinin notu adresle açılamaz', async ({ page, api }) => {
    await page.goto('/ogrenci/notlarim?not=g-s2-0-0')
    await expect(
      page.getByRole('dialog', { name: 'Not ayrıntısı' }).getByText(NOT_FOUND),
    ).toBeVisible()
    const client = await api('ogrenci')
    expect((await client.get(`${COLLECTIONS}/grades/g-s2-0-0`)).status).toBe(404)
  })

  test('devamsızlık özeti ve durum filtresi kayıtlarla tutarlıdır', async ({ page, api }) => {
    const client = await api('ogrenci')
    const records = await listAll(client, 'attendance')
    expect(new Set(records.map((record) => record.studentId))).toEqual(new Set(['s1']))
    const absent = tally(records, 'absent')
    expect(absent).toBeGreaterThan(0)

    await page.goto('/ogrenci/devamsizlik')
    await expect(page.getByRole('heading', { level: 1, name: 'Devamsızlığım' })).toBeVisible()
    await expect(stat(page, 'Devam özeti', 'Katıldığı ders')).toContainText(
      String(tally(records, 'present')),
    )
    await expect(stat(page, 'Devam özeti', 'Devamsızlık')).toContainText(String(absent))
    await expect(stat(page, 'Devam özeti', 'Geç katılım')).toContainText(
      String(tally(records, 'late')),
    )
    await expect(resultCount(page)).toContainText(`/ ${records.length} kayıt`)

    await page.getByLabel('Katılım durumu').selectOption({ label: 'Gelmedi' })
    await expect(page).toHaveURL(/[?&]durum=absent/)
    await expect(resultCount(page)).toContainText(`/ ${absent} kayıt`)
    await expectEveryRow(bodyRows(page, 'Devamsızlığım'), 'Gelmedi')
  })

  test('ders programı yalnız kendi sınıfının derslerini gösterir; hafta adreste tutulur', async ({
    page,
  }) => {
    await page.goto('/ogrenci/ders-programi')
    await expect(page.getByRole('heading', { level: 1, name: 'Ders Programım' })).toBeVisible()
    const program = page.getByRole('list', { name: 'Haftalık ders programı' })
    const lessons = program.getByRole('button', { name: /dk/ })
    await expect(lessons.first()).toBeVisible()
    // 7-A sınıfı Derslik 101'dedir.
    await expectEveryRow(lessons, 'Derslik 101')
    await expect(page.getByRole('button', { name: 'Bu hafta' })).toBeDisabled()

    await page.getByRole('button', { name: 'Sonraki hafta' }).click()
    await expect(page).toHaveURL(/[?&]hafta=\d{4}-\d{2}-\d{2}/)
    await expect(page.getByRole('button', { name: 'Bu hafta' })).toBeEnabled()
    await page.getByRole('button', { name: 'Bu hafta' }).click()
    await expect(page).not.toHaveURL(/[?&]hafta=/)

    await lessons.first().click()
    await expect(page.getByRole('dialog', { name: 'Ders ayrıntısı' })).toBeVisible()
    await expect(page).toHaveURL(/[?&]ders=/)
    await page.goBack()
    await expect(page.getByRole('dialog', { name: 'Ders ayrıntısı' })).toBeHidden()
  })
})

test.describe('veli: Çocuklarım ve Akademik Takip', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('veli')
  })

  test('çocuk değişince liste değişir ve ?cocuk= adreste kalır', async ({ page, api }) => {
    const client = await api('veli')
    const grades = {
      s1: await listAll(client, 'grades', '&studentId=s1'),
      s2: await listAll(client, 'grades', '&studentId=s2'),
    }
    const attendance = {
      s1: await listAll(client, 'attendance', '&studentId=s1'),
      s2: await listAll(client, 'attendance', '&studentId=s2'),
    }
    const average = (id: 's1' | 's2') =>
      `${rounded(grades[id].map((grade) => num(grade, 'score')))}/100`
    expect(average('s1')).not.toBe(average('s2'))
    expect(tally(attendance.s1, 'absent')).not.toBe(tally(attendance.s2, 'absent'))

    await page.goto('/veli/akademik-takip')
    // İlk çocuk adrese tamamlanır.
    await expect(page).toHaveURL(/[?&]cocuk=s1/)
    const summary = page.getByLabel('Öğrenci özeti', { exact: true })
    await expect(summary).toContainText('Deniz Yılmaz')
    await expect(summary).toContainText('7-A')
    await expect(stat(page, 'Not özeti', 'Genel ortalama')).toContainText(average('s1'))

    await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
    await expect(page).toHaveURL(/[?&]cocuk=s2/)
    await expect(summary).toContainText('Ece Yılmaz')
    await expect(summary).toContainText('5-A')
    await expect(summary).not.toContainText('Deniz')
    await expect(stat(page, 'Not özeti', 'Genel ortalama')).toContainText(average('s2'))

    // Sekme değişince çocuk adreste korunur; devamsızlık seçili çocuğa aittir.
    const tabs = page.getByRole('toolbar', { name: 'Akademik takip bölümleri' })
    await tabs.getByRole('button', { name: 'Devamsızlık' }).click()
    await expect(page).toHaveURL(/[?&]cocuk=s2/)
    await expect(page).toHaveURL(/[?&]sekme=devamsizlik/)
    await expect(stat(page, 'Devam özeti', 'Devamsızlık')).toContainText(
      String(tally(attendance.s2, 'absent')),
    )
    await page.getByLabel('Çocuk seç').selectOption({ label: 'Deniz Yılmaz' })
    await expect(page).toHaveURL(/[?&]cocuk=s1/)
    await expect(page).toHaveURL(/[?&]sekme=devamsizlik/)
    await expect(stat(page, 'Devam özeti', 'Devamsızlık')).toContainText(
      String(tally(attendance.s1, 'absent')),
    )

    // Yenileme seçimi korur; adres çocuğu doğrudan seçer.
    await page.goto('/veli/akademik-takip?cocuk=s2')
    await expect(page.getByLabel('Çocuk seç')).toHaveValue('s2')
    await expect(summary).toContainText('Ece Yılmaz')
  })

  test('Çocuklarım kartı çocuğu seçip akademik takibi açar', async ({ page }) => {
    await page.goto('/veli/cocuk-secici')
    await expect(page.getByRole('heading', { level: 1, name: 'Çocuklarım' })).toBeVisible()
    const cards = page.getByRole('list', { name: 'Çocuklarım' }).getByRole('listitem')
    await expect(cards).toHaveCount(2)
    await expect(cards.first().getByRole('heading', { level: 2 })).toHaveText('Deniz Yılmaz')
    await expect(cards.nth(1).getByRole('heading', { level: 2 })).toHaveText('Ece Yılmaz')

    await page.getByRole('link', { name: 'Ece Yılmaz akademik takibini aç' }).click()
    await expect(page).toHaveURL(/\/veli\/akademik-takip\?cocuk=s2/)
    await expect(page.getByLabel('Öğrenci özeti', { exact: true })).toContainText('Ece Yılmaz')
  })

  test('çocuğu olmayan öğrencinin notu adresle açılamaz', async ({ page, api }) => {
    await page.goto(`/veli/akademik-takip?cocuk=s1&not=${FOREIGN_GRADE}`)
    await expect(
      page.getByRole('dialog', { name: 'Not ayrıntısı' }).getByText(NOT_FOUND),
    ).toBeVisible()
    const client = await api('veli')
    expect((await client.get(`${COLLECTIONS}/grades/${FOREIGN_GRADE}`)).status).toBe(404)
  })
})

/** Gün anahtarının (YYYY-AA-GG) ait olduğu haftanın pazartesisi. */
function mondayOf(key: string): string {
  const day = new Date(`${key}T12:00:00.000Z`)
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day.toISOString().slice(0, 10)
}

test.describe('ders programı: iptal edilen dersler görünmez', () => {
  for (const [role, path] of [
    ['ogrenci', '/ogrenci/ders-programi'],
    ['ogretmen', '/ogretmen/ders-programi'],
  ] as const) {
    test(`${role}: iptal günü programda boş görünür, diğer günler korunur`, async ({
      page,
      loginAs,
    }) => {
      await loginAs(role)
      const monday = (target: Page) =>
        target
          .getByRole('list', { name: 'Haftalık ders programı' })
          .getByRole('listitem')
          .filter({ has: target.getByRole('heading', { level: 3, name: /Pazartesi/ }) })

      await page.goto(path)
      await expect(monday(page).getByRole('button', { name: /dk/ }).first()).toBeVisible()
      const others = page
        .getByRole('list', { name: 'Haftalık ders programı' })
        .getByRole('button', { name: /dk/ })
      const before = await others.count()
      const mondayCount = await monday(page).getByRole('button', { name: /dk/ }).count()
      expect(before).toBeGreaterThan(mondayCount)

      // Sunucu iptal edilen dersi programda döndürmez (`cancelled=false`); ekran da iptal
      // durumundaki dersi göstermez. Yanıtta ekranın gösterdiği haftanın pazartesisindeki bütün
      // dersler iptal edilmiş gibi işaretlenir (seed iptal ders içermez). Gün İstanbul saatine
      // göre hesaplanır: seed haftası UTC pazartesisinden başlar, bu yüzden pazartesi 00.00–03.00
      // arasında yanıtın en erken günü önceki haftadadır.
      const shownMonday = mondayOf(dayKey())
      await page.route(/\/api\/v1\/lessons\?/, async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as { data: { date: string; status: string }[] }
        for (const lesson of body.data)
          if (dayKey(lesson.date) === shownMonday) lesson.status = 'cancelled'
        await route.fulfill({ response, json: body })
      })
      await page.reload()
      await expect(monday(page).getByText('Ders yok.')).toBeVisible()
      await expect(monday(page).getByRole('button', { name: /dk/ })).toHaveCount(0)
      await expect(others).toHaveCount(before - mondayCount)
    })
  }
})

test.describe('akademik ekranlar: 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('öğretmen sayfalarında yatay taşma yok', async ({ page, loginAs }) => {
    await loginAs('ogretmen')
    await page.goto('/ogretmen/siniflarim')
    await expect(page.getByRole('article')).toHaveCount(8)
    await expectNoHorizontalOverflow(page)
    await page.getByText('Diğer bilgiler').first().click()
    await expectNoHorizontalOverflow(page)

    await page.goto('/ogretmen/siniflarim?sekme=notlar')
    await expect(page.getByRole('article').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto('/ogretmen/yoklama')
    await expect(page.getByRole('article').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto('/ogretmen/ders-programi')
    await expect(page.getByRole('list', { name: 'Haftalık ders programı' })).toBeVisible()
    await expect(page.getByRole('button', { name: /dk/ }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('öğrenci sayfalarında yatay taşma yok', async ({ page, loginAs }) => {
    await loginAs('ogrenci')
    for (const path of ['/ogrenci/notlarim', '/ogrenci/devamsizlik']) {
      await page.goto(path)
      await expect(page.getByRole('article').first()).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }
    await page.goto('/ogrenci/ders-programi')
    await expect(page.getByRole('button', { name: /dk/ }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('veli sayfalarında yatay taşma yok', async ({ page, loginAs }) => {
    await loginAs('veli')
    await page.goto('/veli/cocuk-secici')
    await expect(page.getByRole('list', { name: 'Çocuklarım' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto('/veli/akademik-takip')
    await expect(page.getByRole('article').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    const tabs = page.getByRole('toolbar', { name: 'Akademik takip bölümleri' })
    await tabs.getByRole('button', { name: 'Devamsızlık' }).click()
    await expect(page.getByRole('article').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await tabs.getByRole('button', { name: 'Ders programı' }).click()
    await expect(page.getByRole('button', { name: /dk/ }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
