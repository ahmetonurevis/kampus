import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant, TenantOptions, TenantUser } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Kayıt İşlemleri (`/onburo/kayit-islemleri`): tarifeli, adımlı kesin kayıt formu (`EnrollmentPage`).
// Tutar girilmez, yayımlanmış tarifeden hesaplanır; aday detayındaki "Kesin kayda dönüştür" formu
// aday seçili açar (DOM-KAY-001, DOM-KAY-011…013, DOM-KAY-035, DOM-FIN-002, DOM-FIN-011).
// Uç: `POST /prospects/:id/enroll` (`crm` + `finance`, If-Match, Idempotency-Key).
// Her test kendi kurumunu kurar; adaylar kurulum kaydıyla gelir.

type Make = (options: TenantOptions) => Promise<Tenant>

interface Fixtures {
  page: Page
  loginAs: (principal: TenantUser) => Promise<Page>
  api: (principal: TenantUser) => Promise<ApiClient>
  tenant: Make
}

const DAY = 86_400_000
const at = (days: number, hour: number) => {
  const base = new Date(Date.now() + days * DAY)
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour),
  ).toISOString()
}

const LIST_URL = '/onburo/kayit-islemleri'
const detailUrl = (id: string) => `/onburo/aday/${id}`
const MODULES_MESSAGE = 'Kesin kayıt için aday (CRM) ve finans modüllerinin açık olması gerekir.'

const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

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

const lesson = (id: string, date: string) => ({
  collection: 'schedule' as const,
  data: {
    id,
    classId: 'c1',
    teacherId: 't1',
    subjectId: 'math',
    date,
    duration: 40,
    title: 'Speaking',
    room: '101',
  },
})

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

/** Yetki ve modül sınırını sınar; gövde doğrulamadan önce reddedilir. */
const enrollBody = () => ({
  classId: 'c1',
  tariffId: 'tarife',
  installmentCount: 1,
  firstDueDate: at(10, 9).slice(0, 10),
  identity: { kind: 'tc', number: '10000000146', birthDate: '2013-03-01' },
  guardian: { name: 'Deneme Velisi', phone: '05559990070', relationship: 'mother' },
})

test.describe('Kayıt İşlemleri', () => {
  test('DOM-FIN-002: yayımlanmış tarife yokken kayıt formu açılmaz', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({ roles: ['onburo'], records: [prospect('e2e-kyt-yok', 'Ali')] })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await expect(
      page.getByRole('heading', { name: 'Yayımlanmış ücret tarifesi yok' }),
    ).toBeVisible()
    await expect(page.getByLabel('Aday öğrenci')).toHaveCount(0)
  })

  test('DOM-KAY-035: aday seçicide yalnız açık aşamadaki adaylar var; kapalı ve kayıtlı aday yok', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      tariffYears: ['current'],
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
    const choice = page.getByLabel('Aday öğrenci')
    await expect(choice.getByRole('option', { name: /Aylin Acar/ })).toHaveCount(1)
    await expect(choice.getByRole('option', { name: /Burak Bulut/ })).toHaveCount(1)
    await expect(choice.getByRole('option', { name: /Ceren Can/ })).toHaveCount(0)
    await expect(choice.getByRole('option', { name: /Deniz Demir/ })).toHaveCount(0)
  })

  test('DOM-KAY-035, DOM-FIN-011: yönetici tarifeyi yayımlar, ön büro aday detayından adım adım kaydeder', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const name = 'Mina Kaya'
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect('e2e-kyt-ok', name)],
    })
    await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/finans?gorunum=tarife')
    await page.getByRole('button', { name: 'Yeni tarife' }).click()
    const editor = page.getByRole('dialog', { name: 'Yeni tarife' })
    await editor.getByLabel('Tutar (₺)', { exact: true }).fill('100.000,01')
    await editor.getByLabel('MEBBİS onaylı tutar (₺)').fill('100.000,01')
    await editor.getByRole('button', { name: 'İndirim ekle' }).click()
    await editor.getByLabel('Değer').fill('10')
    await editor.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(page.getByText('Tarife kaydedildi.')).toBeVisible()
    await page.getByRole('button', { name: /tarifesini yayımla/ }).click()
    const publish = page.getByRole('dialog', { name: 'Tarifeyi yayımla' })
    await publish.getByRole('button', { name: 'Tarifeyi yayımla' }).click()
    await expect(page.getByText('Tarife yayımlandı.')).toBeVisible()

    await loginAs(school.user('onburo'))
    const client = await api(school.user('onburo'))
    await page.goto(detailUrl('e2e-kyt-ok'))
    await page.getByRole('link', { name: 'Kesin kayda dönüştür' }).click()

    await expect(page).toHaveURL(/kayit-islemleri\?aday=e2e-kyt-ok/)
    await expect(page.getByLabel('Aday öğrenci')).toHaveValue('e2e-kyt-ok')
    const proceed = page.getByRole('button', { name: 'Devam et' })
    await proceed.click()
    await expect(page.getByLabel('Sınıf', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    // Yalnız adayın kampüsünün sınıfları, doluluğuyla listelenir.
    await expect(page.getByLabel('Sınıf', { exact: true }).getByRole('option').nth(1)).toHaveText(
      /\(\d+\/\d+\)/,
    )
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()

    await page.getByLabel('Kimlik numarası').fill('10000000147')
    await proceed.click()
    await expect(page.getByText('Geçerli bir T.C. kimlik numarası girin.')).toBeVisible()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill('2013-03-01')
    await page.getByLabel('Veli adı soyadı').fill('Test Kayıt Velisi')
    await page.getByLabel('Veli telefonu').fill('05559990077')
    await proceed.click()

    await page.getByLabel('Taksit sayısı').selectOption('3')
    await page.getByLabel('Kardeş').check()
    await expect(page.getByRole('heading', { name: 'Ödeme planı önizlemesi' })).toBeVisible()
    await expect(page.getByText(/-10\.000,00/)).toBeVisible()
    await proceed.click()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    // Kardeş indirimi mevcut veliye bağlı aktif öğrenci ister; yeni velide sunucu reddeder.
    await expect(
      page.getByText('Kardeş indirimi için aynı veliye bağlı aktif bir öğrenci gerekir.'),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Geri' }).click()
    await page.getByLabel('Kardeş').uncheck()
    await proceed.click()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(toast(page, 'Kesin kayıt, sözleşme ve taksit planı oluşturuldu.')).toBeVisible()
    await expect(page.getByRole('heading', { name: `${name} kaydedildi` })).toBeVisible()
    await expect(page.getByRole('button', { name: `${name} sözleşmesini görüntüle` })).toBeVisible()

    const saved = await prospectOf(client, 'e2e-kyt-ok')
    expect(saved.record.stage).toBe('Kayıt oldu')
    const studentId = saved.record.studentId
    expect(studentId).toBeTruthy()
    const invoices = await list<{ amount: number }>(
      client,
      `invoices?pageSize=100&studentId=${String(studentId)}`,
    )
    expect(invoices).toHaveLength(3)
    expect(invoices.reduce((sum, row) => sum + row.record.amount, 0)).toBe(10_000_001)
    // Kimlik numarası genel okumada dönmez (DOM-KAY-012).
    expect(JSON.stringify(invoices)).not.toContain('10000000146')

    await page.goto(LIST_URL)
    await expect(
      page.getByLabel('Aday öğrenci').getByRole('option', { name: new RegExp(name) }),
    ).toHaveCount(0)
    await page.goto(detailUrl('e2e-kyt-ok'))
    await expect(page.getByRole('button', { name: 'Kesin kayda dönüştür' })).toBeDisabled()
  })

  test('class_campus_mismatch: başka kampüsün sınıfı "tüm kampüsler" ve açık onay kutusuyla seçilir; onaysız sonraki adıma geçilmez', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const name = 'Kaan Kara'
    const school = await tenant({
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [prospect('e2e-kyt-kampus', name)],
    })
    await loginAs(school.user('onburo'))
    const client = await api(school.user('onburo'))
    await page.goto(`${LIST_URL}?aday=e2e-kyt-kampus`)
    const classes = page.getByLabel('Sınıf', { exact: true })
    // Varsayılan liste yalnız adayın kampüsüdür; başka kampüsün sınıfı yoktur.
    await expect(classes.getByRole('option', { name: /Beşiktaş Kampüsü/ })).toHaveCount(0)
    await page.getByLabel('Tüm kampüslerin sınıflarını göster').check()
    const other = classes
      .locator('option:not([disabled])', { hasText: '· Beşiktaş Kampüsü' })
      .first()
    const classId = (await other.getAttribute('value')) ?? ''
    expect(classId).not.toBe('')
    const confirm = page.getByLabel('Başka kampüsün sınıfını bilerek seçiyorum')
    await expect(confirm).toHaveCount(0)
    await classes.selectOption(classId)
    await expect(confirm).not.toBeChecked()
    const proceed = page.getByRole('button', { name: 'Devam et' })
    await proceed.click()
    await expect(
      page.getByText('Seçilen sınıf adayın kampüsünde değil; devam etmek için onay kutusunu'),
    ).toBeVisible()
    await expect(confirm).toBeFocused()
    await expect(confirm).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Kimlik numarası')).toHaveCount(0)

    await confirm.check()
    await proceed.click()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill('2013-03-01')
    await page.getByLabel('Veli adı soyadı').fill('Kampüs Velisi')
    await page.getByLabel('Veli telefonu').fill('05559990079')
    await proceed.click()
    await page.getByLabel('Taksit sayısı').selectOption('2')
    await proceed.click()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(page.getByRole('heading', { name: `${name} kaydedildi` })).toBeVisible()

    const saved = await prospectOf(client, 'e2e-kyt-kampus')
    const students = await list<{ classId: string }>(client, 'students?pageSize=100')
    expect(students.find((row) => row.id === saved.record.studentId)?.record.classId).toBe(classId)
  })

  test('DOM-DIL-030, DOM-FIN-006: dil okulunda deneme dersi veli onayı ister, kayıt ders saatiyle hesaplanır', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const name = 'Kuzey Aday'
    const school = await tenant({
      type: 'language_school',
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [
        prospect('e2e-kyt-dil', name, {
          phone: '05551112233',
          interest: 'A2 İngilizce',
          minor: true,
          guardianName: 'Kuzey Velisi',
        }),
        lesson('e2e-kyt-ders', at(3, 10)),
      ],
    })
    await loginAs(school.user('onburo'))
    const client = await api(school.user('onburo'))
    await page.goto(detailUrl('e2e-kyt-dil'))

    await page.getByRole('button', { name: 'Deneme dersi planla' }).click()
    const panel = page.getByRole('dialog', { name: 'Deneme dersi planla' })
    await panel.getByLabel('Deneme dersi', { exact: true }).selectOption({ index: 1 })
    await panel.getByRole('button', { name: 'Planla' }).click()
    await expect(
      panel.getByText('18 yaş altı adayın deneme dersi için veli onayı gerekir.'),
    ).toBeVisible()
    await panel.getByLabel('Velinin deneme dersi için onay verdiğini kaydediyorum').check()
    await panel.getByRole('button', { name: 'Planla' }).click()
    await expect(toast(page, 'Deneme dersi planlandı.')).toBeVisible()
    await expect(panel).toBeHidden()

    await page.getByRole('link', { name: 'Kesin kayda dönüştür' }).click()
    await expect(page).toHaveURL(/kayit-islemleri\?aday=e2e-kyt-dil/)
    const proceed = page.getByRole('button', { name: 'Devam et' })
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill('2013-03-01')
    // Veli adı adaydan dolar.
    await expect(page.getByLabel('Veli adı soyadı')).toHaveValue('Kuzey Velisi')
    await page.getByLabel('Veli telefonu').fill('05559990078')
    await proceed.click()
    await page.getByLabel('Paket ders saati').fill('40')
    await page.getByLabel('Taksit sayısı').selectOption('2')
    await proceed.click()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(page.getByRole('heading', { name: `${name} kaydedildi` })).toBeVisible()

    const saved = await prospectOf(client, 'e2e-kyt-dil')
    const invoices = await list<{ amount: number }>(
      client,
      `invoices?pageSize=100&studentId=${String(saved.record.studentId)}`,
    )
    // Ders saati başına 500 ₺ × 40 saat.
    expect(invoices.reduce((sum, row) => sum + row.record.amount, 0)).toBe(2_000_000)
  })

  test('DOM-KAY-012: dil okulunda yetişkin kursiyer "kendisi" ile kaydolur; 15 yaşında "kendisi" seçeneği yok', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const name = 'Yetişkin Kursiyer'
    const year = new Date().getUTCFullYear()
    const school = await tenant({
      type: 'language_school',
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [
        prospect('e2e-kyt-yetiskin', name, { interest: 'B1 İngilizce', minor: false }),
        prospect('e2e-kyt-genc', 'Genç Kursiyer', {
          interest: 'A2 İngilizce',
          minor: true,
          guardianName: 'Genç Velisi',
        }),
      ],
    })
    await loginAs(school.user('onburo'))
    const client = await api(school.user('onburo'))
    const proceed = page.getByRole('button', { name: 'Devam et' })
    const guardian = page.getByLabel('Veli ve ödeyici')

    await page.goto(`${LIST_URL}?aday=e2e-kyt-genc`)
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()
    await page.getByLabel('Doğum tarihi').fill(`${year - 15}-01-15`)
    await expect(guardian).toHaveValue('new')
    await expect(guardian.getByRole('option', { name: /Kursiyerin kendisi/ })).toHaveCount(0)

    await page.goto(`${LIST_URL}?aday=e2e-kyt-yetiskin`)
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    // Varsayılan "Yeni veli" doğum tarihi yetişkini gösterince "kendisi"ne döner.
    await expect(guardian).toHaveValue('new')
    await page.getByLabel('Doğum tarihi').fill(`${year - 25}-01-15`)
    await expect(guardian).toHaveValue('self')
    await expect(guardian.getByRole('option', { name: 'Yeni veli' })).toHaveCount(0)
    await expect(page.getByLabel('Veli adı soyadı')).toHaveCount(0)
    await page.getByLabel('Kursiyer telefonu (isteğe bağlı)').fill('123')
    await proceed.click()
    await expect(page.getByText('Telefonu 05XXXXXXXXX biçiminde girin.')).toBeVisible()
    await page.getByLabel('Kursiyer telefonu (isteğe bağlı)').fill('05551234567')
    await proceed.click()
    await page.getByLabel('Paket ders saati').fill('20')
    await proceed.click()
    await expect(page.getByText('Kursiyerin kendisi', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(page.getByRole('heading', { name: `${name} kaydedildi` })).toBeVisible()

    const saved = await prospectOf(client, 'e2e-kyt-yetiskin')
    expect(saved.record.stage).toBe('Kayıt oldu')
  })

  test('DOM-YTK-040: finans modülü kapalıyken aday detayında kesin kayıt devre dışıdır, nedeni yazılır; API 403 verir', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [prospect('e2e-kyt-mod', 'Mert Mutlu')],
    })
    const admin = await api(school.user('yonetici'))
    await closeModule(admin, 'finance')
    await loginAs(school.user('onburo'))
    await page.goto(detailUrl('e2e-kyt-mod'))
    const convert = page.getByRole('button', { name: 'Kesin kayda dönüştür' })
    await expect(convert).toBeDisabled()
    await expect(convert).toHaveAttribute('title', /finans modüllerinin açık olması gerekir/)
    await expect(convert).toHaveAccessibleDescription(/finans modüllerinin açık olması gerekir/)
    await expect(page.getByRole('alert').filter({ hasText: MODULES_MESSAGE })).toBeVisible()

    const current = await prospectOf(admin, 'e2e-kyt-mod')
    const direct = await admin.post('/api/v1/prospects/e2e-kyt-mod/enroll', enrollBody(), {
      'idempotency-key': randomUUID(),
      'if-match': `"${current.version}"`,
    })
    expect(direct.status).toBe(403)
    expect((direct.body as { code: string }).code).toBe('module_disabled')
  })

  test('DOM-KAY-035: vazgeçen adayda kesin kayıt başlatılamaz', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect('e2e-kyt-vaz', 'Vedat Vural', { stage: 'Vazgeçti' })],
    })
    await loginAs(school.user('onburo'))
    await page.goto(detailUrl('e2e-kyt-vaz'))
    await expect(page.getByRole('button', { name: 'Kesin kayda dönüştür' })).toBeDisabled()
  })

  test('DOM-KAY-001: öğretmen, veli ve öğrenci Kayıt İşlemleri sayfasını açamaz; API 403 verir', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo', 'ogretmen', 'ogrenci', 'veli'],
      tariffYears: ['current'],
      records: [prospect('e2e-kyt-yetki', 'Yetkisiz Aday')],
    })
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      await loginAs(school.user(role))
      await page.goto(LIST_URL)
      await expect(page).toHaveURL(new RegExp(`/${role}/dashboard`))
      await expect(page.getByText('Yetkisiz Aday')).toHaveCount(0)
      const denied = await (
        await api(school.user(role))
      ).post('/api/v1/prospects/e2e-kyt-yetki/enroll', enrollBody(), {
        'idempotency-key': randomUUID(),
        'if-match': '"1"',
      })
      expect(denied.status).toBe(403)
    }
    const saved = await prospectOf(await api(school.user('onburo')), 'e2e-kyt-yetki')
    expect(saved.record.studentId).toBeNull()
  })

  test('320 ve 390 px genişlikte kayıt formu yatay taşmaz', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [prospect('e2e-kyt-dar', 'Dar Ekran')],
    })
    await loginAs(school.user('onburo'))
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto(`${LIST_URL}?aday=e2e-kyt-dar`)
      await expect(page.getByLabel('Aday öğrenci')).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }
  })
})
