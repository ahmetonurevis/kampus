import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant, TenantOptions, TenantUser } from './support/tenant.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// Kayıt İşlemleri (`/onburo/kayit-islemleri`) ve kesin kayıt formu: açık adaylar listelenir, form
// sağ panelde açılır; aday detayındaki "Kesin kayda dönüştür" aynı formdur (DOM-KAY-001,
// DOM-KAY-011, DOM-KAY-035). Uç: `POST /prospects/:id/enroll` (`crm` + `finance`, If-Match).
// Her test kendi kurumunu kurar; adaylar ve dolu sınıf kurulum kaydıyla gelir.

type Make = (options: TenantOptions) => Promise<Tenant>

interface Fixtures {
  page: Page
  loginAs: (principal: TenantUser) => Promise<Page>
  api: (principal: TenantUser) => Promise<ApiClient>
  tenant: Make
}

const DAY = 86_400_000
const istanbulDay = (days: number) =>
  new Date(Date.now() + days * DAY + 3 * 3_600_000).toISOString().slice(0, 10)

const LIST_URL = '/onburo/kayit-islemleri'
const FRACTION_MESSAGE = 'Kuruşlu tutar girilemez; tutarı tam lira olarak yazın.'
const RANGE_MESSAGE = 'Tutar 100 ile 1.000.000 ₺ arasında olmalıdır.'
const MODULES_MESSAGE = 'Kesin kayıt için aday (CRM) ve finans modüllerinin açık olması gerekir.'

const table = (page: Page) => page.getByRole('table', { name: 'Kesin kayda hazır adaylar' })
const bodyRows = (page: Page) => table(page).locator('tbody tr')
const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const enrollDialog = (page: Page) => page.getByRole('dialog', { name: 'Kesin kayıt' })

let sequence = 0
const prospect = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  collection: 'prospects' as const,
  data: {
    id,
    name,
    phone: `0555040${String(++sequence).padStart(4, '0')}`,
    email: `${id}@kampus.example`,
    branchId: 'b1',
    interest: '7. Sınıf · Ortaokul',
    source: 'Web sitesi',
    stage: 'Yeni aday',
    studentId: null,
    createdAt: new Date(Date.now() - DAY).toISOString(),
    trialAt: null,
    notes: [],
    ...extra,
  },
})

/** Kontenjanı 1 olan ve tek öğrencisiyle dolu sınıf (Kadıköy). */
const fullClassRecords = () => [
  {
    collection: 'classes' as const,
    data: {
      id: 'e2e-dolu',
      name: 'Dolu Sınıf',
      grade: 7,
      section: 'D',
      level: '7. Sınıf',
      branchId: 'b1',
      teacherId: 't1',
      capacity: 1,
      room: '999',
      isActive: true,
      deletedAt: null,
    },
  },
  {
    collection: 'students' as const,
    data: {
      id: 'e2e-dolu-ogr',
      name: 'Dolu Öğrenci',
      classId: 'e2e-dolu',
      parentId: 'p1',
      email: 'dolu@kampus.example',
      phone: '05550409999',
      joinedAt: new Date(Date.now() - 30 * DAY).toISOString(),
      isActive: true,
      progress: 50,
      number: '2026999',
    },
  },
]

interface Item<T> {
  id: string
  version: number
  record: T
}
async function list<T>(client: ApiClient, path: string): Promise<Item<T>[]> {
  const result = await client.get(`/api/v1/collections/${path}`)
  expect(result.status).toBe(200)
  return (result.body as { data: Item<T>[] }).data
}
const prospectOf = async (client: ApiClient, id: string) => {
  const found = (
    await list<{ stage: string; studentId: string | null }>(client, 'prospects?pageSize=100')
  ).find((item) => item.id === id)
  expect(found).toBeDefined()
  return found!
}

async function closeModule(client: ApiClient, moduleKey: string) {
  const settings = await client.get('/api/v1/modules')
  expect(settings.status).toBe(200)
  const response = await client.context.patch(`/api/v1/modules/${moduleKey}`, {
    data: { enabled: false },
    headers: {
      'if-match': `"${(settings.body as { data: { version: number } }).data.version}"`,
      'idempotency-key': randomUUID(),
    },
  })
  expect(response.status()).toBe(200)
}

/** Paneldeki formu doldurur; `classId` boşsa sınıf seçilmez. */
async function fillForm(
  dialog: ReturnType<typeof enrollDialog>,
  values: { classId?: string; total: string; count?: string; startDate?: string },
) {
  if (values.classId) await dialog.getByLabel('Sınıf', { exact: true }).selectOption(values.classId)
  await dialog.getByLabel('Toplam eğitim bedeli (₺)').fill(values.total)
  if (values.count) await dialog.getByLabel('Taksit sayısı').selectOption(values.count)
  await dialog.getByLabel('İlk vade').fill(values.startDate ?? istanbulDay(30))
}

test.describe('Kayıt İşlemleri listesi', () => {
  test('yalnız açık aşamadaki adaylar listelenir; kapalı aday ve kayıt olan görünmez (DOM-KAY-035)', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [
        prospect('e2e-kyt-a', 'Aylin Acar'),
        prospect('e2e-kyt-b', 'Burak Bulut', { stage: 'Teklif verildi' }),
        prospect('e2e-kyt-c', 'Ceren Can', { stage: 'Vazgeçti' }),
        prospect('e2e-kyt-d', 'Deniz Demir', { stage: 'Kayıt oldu', studentId: 's1' }),
      ],
    })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await expect(page.getByRole('heading', { name: 'Kayıt İşlemleri', level: 1 })).toBeVisible()
    await expect(bodyRows(page)).toHaveCount(2)
    await expect(bodyRows(page).filter({ hasText: 'Aylin Acar' })).toHaveCount(1)
    await expect(bodyRows(page).filter({ hasText: 'Burak Bulut' })).toHaveCount(1)
    await expect(page.getByText('Ceren Can')).toHaveCount(0)
    await expect(page.getByText('Deniz Demir')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Aylin Acar için kesin kayıt' })).toBeEnabled()

    await page.getByRole('button', { name: 'Filtreler' }).click()
    await page.getByLabel('Aşama', { exact: true }).selectOption('Teklif verildi')
    await expectEveryRow(bodyRows(page), 'Burak Bulut')
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('kesin kayıt', () => {
  test('kesin kayıt öğrenci, taksit ve sözleşme yazar; aday "Kayıt oldu" olur, ikinci deneme engellenir (DOM-KAY-001, DOM-KAY-011, DOM-KAY-035)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect('e2e-kyt-ok', 'Mina Kaya')],
    })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await page.getByRole('button', { name: 'Mina Kaya için kesin kayıt' }).click()
    const dialog = enrollDialog(page)
    await expect(dialog.getByText('Kadıköy Kampüsü · 7. Sınıf · Ortaokul')).toBeVisible()
    await fillForm(dialog, { classId: 'c1', total: '24.000', count: '6' })
    await expect(
      dialog.getByText('6 taksit · ilk taksit 4.000,00 ₺, son taksit 4.000,00 ₺'),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Kesin kaydı tamamla' }).click()

    await expect(toast(page, 'Kesin kayıt, sözleşme ve taksit planı oluşturuldu.')).toBeVisible()
    await expect(dialog.getByText('Mina Kaya öğrenci olarak kaydedildi')).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Ödeme planını aç' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Kapat', exact: true }).first().click()
    // Aday artık açık değildir: liste yenilenir ve satır kalkar.
    await expect(page.getByText('Mina Kaya')).toHaveCount(0)

    const client = await api(school.user('onburo'))
    const saved = await prospectOf(client, 'e2e-kyt-ok')
    expect(saved.record.stage).toBe('Kayıt oldu')
    const studentId = saved.record.studentId
    expect(studentId).toBeTruthy()
    const student = await client.get(`/api/v1/collections/students/${studentId}`)
    expect(student.status).toBe(200)
    expect(
      (student.body as { data: Item<{ name: string; classId: string }> }).data.record,
    ).toMatchObject({ name: 'Mina Kaya', classId: 'c1' })
    const invoices = await list<{ amount: number; studentId: string }>(
      client,
      `invoices?pageSize=100&studentId=${studentId}`,
    )
    expect(invoices).toHaveLength(6)
    expect(invoices.reduce((sum, item) => sum + item.record.amount, 0)).toBe(2_400_000)

    // İkinci deneme: aynı aday yeniden kayda alınamaz (DOM-KAY-035).
    const again = await client.post(
      '/api/v1/prospects/e2e-kyt-ok/enroll',
      { classId: 'c1', totalCents: 2_400_000, count: 6, startDate: istanbulDay(30) },
      { 'idempotency-key': randomUUID(), 'if-match': `"${saved.version}"` },
    )
    expect(again.status).toBe(409)
    expect((again.body as { code: string }).code).toBe('prospect_already_enrolled')
    await page.goto(`/onburo/aday/e2e-kyt-ok`)
    await expect(page.getByRole('button', { name: 'Kesin kayda dönüştür' })).toBeDisabled()
  })

  test('kuruşlu ve sınır dışı tutar formda engellenir; kayıt yazılmaz (DOM-KAY-035)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect('e2e-kyt-tutar', 'Tuna Tan')],
    })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await page.getByRole('button', { name: 'Tuna Tan için kesin kayıt' }).click()
    const dialog = enrollDialog(page)
    const submit = dialog.getByRole('button', { name: 'Kesin kaydı tamamla' })

    await fillForm(dialog, { classId: 'c1', total: '12500,50' })
    await submit.click()
    await expect(dialog.getByText(FRACTION_MESSAGE)).toBeVisible()
    await dialog.getByLabel('Toplam eğitim bedeli (₺)').fill('50')
    await submit.click()
    await expect(dialog.getByText(RANGE_MESSAGE)).toBeVisible()
    await dialog.getByLabel('Toplam eğitim bedeli (₺)').fill('2.000.000')
    await submit.click()
    await expect(dialog.getByText(RANGE_MESSAGE)).toBeVisible()

    const client = await api(school.user('onburo'))
    expect((await prospectOf(client, 'e2e-kyt-tutar')).record.stage).toBe('Yeni aday')

    // Sunucu da kuruşlu tutarı alana bağlı hatayla reddeder.
    const direct = await client.post(
      '/api/v1/prospects/e2e-kyt-tutar/enroll',
      { classId: 'c1', totalCents: 1_250_050, count: 3, startDate: istanbulDay(30) },
      {
        'idempotency-key': randomUUID(),
        'if-match': `"${(await prospectOf(client, 'e2e-kyt-tutar')).version}"`,
      },
    )
    expect(direct.status).toBe(422)
    expect((direct.body as { code: string }).code).toBe('amount_not_whole_lira')
    expect((await prospectOf(client, 'e2e-kyt-tutar')).record.studentId).toBeNull()
  })

  test('sınıf seçici adayın kampüsünü gösterir, "tüm kampüsler" genişletir; dolu sınıf alan hatası verir (DOM-KAY-035)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect('e2e-kyt-dolu', 'Dilara Dal'), ...fullClassRecords()],
    })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await page.getByRole('button', { name: 'Dilara Dal için kesin kayıt' }).click()
    const dialog = enrollDialog(page)
    const classes = dialog.getByLabel('Sınıf', { exact: true })
    await expect(classes.locator('option').filter({ hasText: 'Beşiktaş Kampüsü' })).toHaveCount(0)
    await expect(
      classes.locator('option').filter({ hasText: 'Dolu Sınıf · Kadıköy Kampüsü · 1/1 · Dolu' }),
    ).toHaveCount(1)

    await dialog.getByLabel('Tüm kampüslerin sınıflarını göster').check()
    await expect(
      classes.locator('option').filter({ hasText: 'Beşiktaş Kampüsü' }).first(),
    ).toBeAttached()
    await dialog.getByLabel('Tüm kampüslerin sınıflarını göster').uncheck()

    await fillForm(dialog, { classId: 'e2e-dolu', total: '18000', count: '3' })
    await dialog.getByRole('button', { name: 'Kesin kaydı tamamla' }).click()
    await expect(dialog.getByText('Seçilen sınıfın kontenjanı dolu.')).toBeVisible()

    const client = await api(school.user('onburo'))
    const saved = await prospectOf(client, 'e2e-kyt-dolu')
    expect(saved.record.stage).toBe('Yeni aday')
    expect(saved.record.studentId).toBeNull()
  })

  test('araya giren kayıt: aday başka yerde kayda alınmışsa anlaşılır ileti verilir ve form kullanılamaz olur (DOM-KAY-035)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect('e2e-kyt-yaris', 'Yaren Yıldız')],
    })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await page.getByRole('button', { name: 'Yaren Yıldız için kesin kayıt' }).click()
    const dialog = enrollDialog(page)
    await fillForm(dialog, { classId: 'c1', total: '9000' })

    // Panel açıkken başka bir oturum adayı kayda alır.
    const client = await api(school.user('onburo'))
    const current = await prospectOf(client, 'e2e-kyt-yaris')
    const first = await client.post(
      '/api/v1/prospects/e2e-kyt-yaris/enroll',
      { classId: 'c1', totalCents: 900_000, count: 1, startDate: istanbulDay(10) },
      { 'idempotency-key': randomUUID(), 'if-match': `"${current.version}"` },
    )
    expect(first.status).toBe(201)

    await dialog.getByRole('button', { name: 'Kesin kaydı tamamla' }).click()
    // Sürüm tutmaz ya da aday artık kapalıdır; kart tazelenir ve form kullanılamaz olur.
    await expect(dialog.getByText('Bu adayın kesin kaydı zaten tamamlanmış.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Kesin kaydı tamamla' })).toBeDisabled()
    const students = await list<{ name: string }>(client, 'students?pageSize=100')
    expect(students.filter((item) => item.record.name === 'Yaren Yıldız')).toHaveLength(1)
  })

  test('finans modülü kapalıyken işlem devre dışıdır ve nedeni yazılır; API 403 verir (DOM-YTK-040)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect('e2e-kyt-mod', 'Mert Mutlu')],
    })
    const admin = await api(school.user('yonetici'))
    await closeModule(admin, 'finance')
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await expect(page.getByText(MODULES_MESSAGE)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mert Mutlu için kesin kayıt' })).toBeDisabled()

    await page.goto('/onburo/aday/e2e-kyt-mod')
    await expect(page.getByRole('button', { name: 'Kesin kayda dönüştür' })).toBeEnabled()
    await page.getByRole('button', { name: 'Kesin kayda dönüştür' }).click()
    const dialog = enrollDialog(page)
    await expect(dialog.getByText(MODULES_MESSAGE)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Kesin kaydı tamamla' })).toBeDisabled()

    const current = await prospectOf(admin, 'e2e-kyt-mod')
    const direct = await admin.post(
      '/api/v1/prospects/e2e-kyt-mod/enroll',
      { classId: 'c1', totalCents: 900_000, count: 1, startDate: istanbulDay(10) },
      { 'idempotency-key': randomUUID(), 'if-match': `"${current.version}"` },
    )
    expect(direct.status).toBe(403)
  })
})

test.describe('aday detayından kesin kayıt', () => {
  test('detaydaki "Kesin kayda dönüştür" aynı formu açar; yönetici kaydı tamamlar (DOM-KAY-001)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect('e2e-kyt-detay', 'Defne Demir', { stage: 'Teklif verildi' })],
    })
    await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/aday/e2e-kyt-detay')
    await page.getByRole('button', { name: 'Kesin kayda dönüştür' }).click()
    await expect(page).toHaveURL(/[?&]kayit=e2e-kyt-detay/)
    const dialog = enrollDialog(page)
    await fillForm(dialog, { classId: 'c1', total: '30000', count: '10' })
    await dialog.getByRole('button', { name: 'Kesin kaydı tamamla' }).click()
    await expect(toast(page, 'Kesin kayıt, sözleşme ve taksit planı oluşturuldu.')).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Öğrenci özetini aç' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Kapat', exact: true }).first().click()
    await expect(page.getByText('Kayıt oldu').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Kesin kayda dönüştür' })).toBeDisabled()

    const saved = await prospectOf(await api(school.user('onburo')), 'e2e-kyt-detay')
    expect(saved.record.stage).toBe('Kayıt oldu')
  })

  test('vazgeçen adayda kesin kayıt başlatılamaz (DOM-KAY-035)', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect('e2e-kyt-vaz', 'Vedat Vural', { stage: 'Vazgeçti' })],
    })
    await loginAs(school.user('onburo'))
    await page.goto('/onburo/aday/e2e-kyt-vaz')
    await expect(page.getByRole('button', { name: 'Kesin kayda dönüştür' })).toBeDisabled()
  })
})

test.describe('erişim', () => {
  test('öğretmen, veli ve öğrenci Kayıt İşlemleri sayfasını açamaz; API 403 verir (DOM-KAY-001)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo', 'ogretmen', 'ogrenci', 'veli'],
      records: [prospect('e2e-kyt-yetki', 'Yetkisiz Aday')],
    })
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      await loginAs(school.user(role))
      await page.goto(LIST_URL)
      await expect(page).toHaveURL(new RegExp(`/${role}/dashboard`))
      await expect(page.getByText('Yetkisiz Aday')).toHaveCount(0)
      const denied = await (
        await api(school.user(role))
      ).post(
        '/api/v1/prospects/e2e-kyt-yetki/enroll',
        { classId: 'c1', totalCents: 900_000, count: 1, startDate: istanbulDay(10) },
        { 'idempotency-key': randomUUID(), 'if-match': '"1"' },
      )
      expect(denied.status).toBe(403)
    }
    const saved = await prospectOf(await api(school.user('onburo')), 'e2e-kyt-yetki')
    expect(saved.record.studentId).toBeNull()
  })
})
