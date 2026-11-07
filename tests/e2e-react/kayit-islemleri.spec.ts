import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { seedCarriedOverTariff } from './support/finance-terms.ts'
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

/** İlanlı koşullar (DOM-FIN-013): peşin ve 2–12 taksit. */
const PAYMENT_TERMS = [
  {
    kind: 'upfront',
    minInstallments: 1,
    maxInstallments: 1,
    discountPercentBasisPoints: null,
    discountAmountCents: null,
  },
  {
    kind: 'installment',
    minInstallments: 2,
    maxInstallments: 12,
    discountPercentBasisPoints: null,
    discountAmountCents: null,
  },
]
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

const CONSENT_LABEL = 'Fotoğraf ve video: kurum içi platform ve sınıf panosu'

/** Yalnız fotoğraf/video amacının metni yayımlanır; öteki amaçlar "metni yok" kalır. */
async function publishConsentText(admin: ApiClient) {
  const result = await admin.post(
    '/api/v1/privacy-notices',
    {
      kind: 'consent_text',
      purpose: 'photo_video_sharing',
      title: 'Fotoğraf ve video kullanımı rızası',
      body: 'Çocuğumun fotoğraf ve videolarının kurum içi platformda paylaşılmasını onaylıyorum.',
      requiresReconsent: false,
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status).toBe(201)
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

  test('DOM-FIN-002, K-11: süresinde ilan yoksa önceki yılın tarifesiyle kayıt yapılır; form, önizleme ve sonuç bunu söyler', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const name = 'Ece Taşınan'
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect('e2e-kyt-tasinan', name)],
    })
    // Geçen eğitim yılının ilan dönemi her gün bitmiştir; karar gerçek saate bağlı değildir.
    const academicYear = new Date().getFullYear() - 1
    const tariffYear = academicYear - 1
    await seedCarriedOverTariff({
      institutionId: school.institutionId,
      academicYear,
      tariffYear,
      amountCents: 12_000_000,
    })
    await loginAs(school.user('onburo'))
    const client = await api(school.user('onburo'))
    await page.goto(`${LIST_URL}?aday=e2e-kyt-tasinan`)

    const note = `önceki yılın (${String(tariffYear)}–${String(tariffYear + 1)}) tarifesi uygulanır`
    await expect(page.getByRole('note').filter({ hasText: note })).toBeVisible()
    const proceed = page.getByRole('button', { name: 'Devam et' })
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill('2013-03-01')
    await page.getByLabel('Veli adı soyadı').fill('Test Taşınan Velisi')
    await page.getByLabel('Veli telefonu').fill('05559990078')
    await proceed.click()

    const preview = page.getByRole('region', { name: 'Ödeme planı önizlemesi' })
    await expect(
      preview.getByText(`${String(tariffYear)}–${String(tariffYear + 1)} (önceki yıl)`),
    ).toBeVisible()
    await expect(preview.getByText('120.000,00')).toHaveCount(2)
    await proceed.click()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(page.getByRole('heading', { name: `${name} kaydedildi` })).toBeVisible()
    await expect(page.getByRole('note').filter({ hasText: note })).toBeVisible()

    const saved = await prospectOf(client, 'e2e-kyt-tasinan')
    const contracts = await list<{ academicYear: number; tariffId?: string }>(
      client,
      `contracts?pageSize=100&studentId=${String(saved.record.studentId)}`,
    )
    expect(contracts).toHaveLength(1)
    // Sözleşme hedef yılındadır, tarifesi önceki yılındır.
    expect(contracts[0]?.record.academicYear).toBe(academicYear)
    const tariffs = await client.get(`/api/v1/fee-tariffs?academicYear=${String(tariffYear)}`)
    const tariffId = (tariffs.body as { data: { id: string }[] }).data[0]?.id
    expect(contracts[0]?.record.tariffId).toBe(tariffId)
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

  test('DOM-FIN-025: yönetici kesin kayıtta burs seçer; önizlemede net düşer, atama listeye yazılır; ön büroya seçenek çıkmaz', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const name = 'Burslu Aday'
    const school = await tenant({
      roles: ['yonetici', 'onburo'],
      records: [prospect('e2e-kyt-burs', name), prospect('e2e-kyt-burs2', 'Ön Büro Adayı')],
    })
    const admin = await api(school.user('yonetici'))
    const post = async (url: string, data: unknown, version?: number) => {
      const response = await admin.context.post(url, {
        data,
        headers: version === undefined ? {} : { 'if-match': `"${String(version)}"` },
      })
      expect(response.status(), url).toBeLessThan(300)
      return ((await response.json()) as { data: { id: string; version: number } }).data
    }
    const academicYear = new Date().getFullYear()
    const draft = await post('/api/v1/fee-tariffs', {
      academicYear,
      items: [
        {
          kind: 'tuition',
          level: null,
          amountCents: 10_000_000,
          unit: 'year',
          vatBasisPoints: 1000,
          vatEffectiveDate: `${String(academicYear)}-01-01`,
          announcedAmountCents: 10_000_000,
        },
      ],
      paymentTerms: PAYMENT_TERMS,
    })
    await post(
      `/api/v1/fee-tariffs/${draft.id}/publish`,
      { announcedDate: `${String(academicYear)}-01-02`, mebbisRecordedDate: null },
      draft.version,
    )
    const program = await post('/api/v1/finance/scholarship-programs', {
      academicYear,
      name: 'Başarı Bursu',
      conditions: 'Sınav puanı 90 ve üstü.',
      terminationConditions: 'Disiplin cezası alan öğrencinin bursu kesilir.',
      durationNote: 'Bir eğitim yılı',
      percentBasisPoints: 6000,
      capacity: 2,
    })
    await post(
      `/api/v1/finance/scholarship-programs/${program.id}/notify`,
      { notifiedDate: `${String(academicYear)}-01-03` },
      program.version,
    )

    // Ön büro: burs seçeneği yok (DOM-FIN-052).
    await loginAs(school.user('onburo'))
    await page.goto(`${LIST_URL}?aday=e2e-kyt-burs2`)
    const proceed = page.getByRole('button', { name: 'Devam et' })
    const toFeeStep = async (identity: string) => {
      await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
      await proceed.click()
      await page.getByLabel('Kimlik numarası').fill(identity)
      await page.getByLabel('Doğum tarihi').fill('2013-03-01')
      await page.getByLabel('Veli adı soyadı').fill('Test Kayıt Velisi')
      await page.getByLabel('Veli telefonu').fill('05559990088')
      await proceed.click()
    }
    await toFeeStep('10000000146')
    await expect(page.getByLabel('Taksit sayısı')).toBeVisible()
    await expect(page.getByLabel('Burs programı (isteğe bağlı)')).toHaveCount(0)

    // Yönetici: %60 burs indirim tavanına girmez, net 40.000 ₺ olur.
    await page.context().clearCookies()
    await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/kayit-islemleri?aday=e2e-kyt-burs')
    await toFeeStep('10000000146')
    await page.getByLabel('Taksit sayısı').selectOption('2')
    await page.getByLabel('Burs programı (isteğe bağlı)').selectOption(program.id)
    await expect(page.getByText(/Burs · Başarı Bursu/)).toBeVisible()
    await expect(page.getByText(/-60\.000,00/)).toBeVisible()
    await proceed.click()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(toast(page, 'Kesin kayıt, sözleşme ve taksit planı oluşturuldu.')).toBeVisible()

    const saved = await prospectOf(admin, 'e2e-kyt-burs')
    const invoices = await list<{ amount: number }>(
      admin,
      `invoices?pageSize=100&studentId=${String(saved.record.studentId)}`,
    )
    expect(invoices.reduce((sum, row) => sum + row.record.amount, 0)).toBe(4_000_000)

    // Atama finans ekranındaki listede; MEBBİS günü bir kez işlenir.
    await page.goto('/yonetici/finans?gorunum=burs')
    const awards = page.getByRole('table', { name: 'Burs atamaları' })
    await expect(awards).toContainText(name)
    await expect(awards).toContainText('İşlenmedi')
    await expect(page.getByRole('table', { name: 'Burs programları' })).toContainText('1 / 2')
    await page.getByRole('button', { name: `${name} bursunun MEBBİS gününü işle` }).click()
    await page
      .getByRole('dialog', { name: "MEBBİS'e işlendi" })
      .getByRole('button', { name: 'Kaydet' })
      .click()
    await expect(toast(page, "MEBBİS'e işlendiği kaydedildi.")).toBeVisible()
    await expect(awards).not.toContainText('İşlenmedi')
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

  test('ON-125, DOM-KAY-012: aday değişince önceki adayın kimlik no, doğum tarihi ve veli bilgisi formda kalmaz', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [
        prospect('e2e-kyt-onceki', 'Önceki Aday', { guardianName: 'Önceki Velisi' }),
        prospect('e2e-kyt-sonraki', 'Sonraki Aday', {
          phone: '05551230125',
          guardianName: 'Sonraki Velisi',
        }),
      ],
    })
    await loginAs(school.user('onburo'))
    const proceed = page.getByRole('button', { name: 'Devam et' })
    const identity = page.getByLabel('Kimlik numarası')
    const birthDate = page.getByLabel('Doğum tarihi')

    await page.goto(`${LIST_URL}?aday=e2e-kyt-onceki`)
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()
    await page.getByLabel('Kimlik türü').selectOption('foreign')
    await identity.fill('YK1250001')
    await birthDate.fill('2013-03-01')
    await page.getByLabel('Veli adı soyadı').fill('Önceki Velisi Düzeltilmiş')
    await page.getByLabel('Yakınlık derecesi').selectOption('father')
    await page.getByRole('button', { name: 'Geri' }).click()

    await page.getByLabel('Aday öğrenci').selectOption('e2e-kyt-sonraki')
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()
    // KVKK: önceki adayın kimliği, doğum tarihi ve yakınlığı yeni adayın formuna taşınmaz; veli
    // adı ve telefonu yeni adaydan dolar.
    await expect(identity).toHaveValue('')
    await expect(page.getByLabel('Kimlik türü')).toHaveValue('tc')
    await expect(birthDate).toHaveValue('')
    await expect(page.getByLabel('Yakınlık derecesi')).toHaveValue('mother')
    await expect(page.getByLabel('Veli adı soyadı')).toHaveValue('Sonraki Velisi')
    await expect(page.getByLabel('Veli telefonu')).toHaveValue('05551230125')
  })

  test('ON-126, DOM-KAY-012: kurs adayının yaş grubu doğum tarihiyle uyuşmazsa alanda uyarı çıkar, sonraki adıma geçilmez', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const year = new Date().getUTCFullYear()
    const school = await tenant({
      type: 'language_school',
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [
        prospect('e2e-kyt-yasgrubu', 'Yaş Grubu Adayı', {
          interest: 'A2 İngilizce',
          minor: true,
          guardianName: 'Yaş Grubu Velisi',
        }),
      ],
    })
    await loginAs(school.user('onburo'))
    const proceed = page.getByRole('button', { name: 'Devam et' })
    const birthDate = page.getByLabel('Doğum tarihi')
    const warning = page.getByText('Aday kaydında 18 yaş altı seçili, doğum tarihi ise 18 yaş')

    await page.goto(`${LIST_URL}?aday=e2e-kyt-yasgrubu`)
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await birthDate.fill(`${year - 15}-01-15`)
    await expect(warning).toHaveCount(0)
    // 18 yaş altı seçilmiş adaya yetişkin doğum tarihi: uyarı gönderimden önce alanda görünür.
    await birthDate.fill(`${year - 25}-01-15`)
    await expect(warning).toBeVisible()
    await expect(birthDate).toHaveAttribute('aria-invalid', 'true')
    await proceed.click()
    await expect(birthDate).toBeFocused()
    await expect(page.getByLabel('Taksit sayısı')).toHaveCount(0)

    await birthDate.fill(`${year - 15}-01-15`)
    await expect(warning).toHaveCount(0)
    await expect(birthDate).not.toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Veli adı soyadı')).toHaveValue('Yaş Grubu Velisi')
  })

  test('IST-017, DOM-YTK-057: ön büro rıza almaz, form kilitlenmez; kayıttan sonra beklenen rıza ve yeri yazılır', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const name = 'Rıza Adayı'
    const school = await tenant({
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [
        prospect('e2e-kyt-riza', name, {
          privacyNotice: { version: 'aydinlatma-2026-1', shownAt: at(-1, 9) },
        }),
      ],
    })
    await publishConsentText(await api(school.user('yonetici')))
    await loginAs(school.user('onburo'))
    const client = await api(school.user('onburo'))
    await page.goto(`${LIST_URL}?aday=e2e-kyt-riza`)
    const proceed = page.getByRole('button', { name: 'Devam et' })
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill('2013-03-01')
    await page.getByLabel('Veli adı soyadı').fill('Rıza Velisi')
    await page.getByLabel('Veli telefonu').fill('05559990071')
    await proceed.click()
    await proceed.click()

    // Kontrol: rıza seçeneği yok, form rızayı beklemez; adayın aydınlatma sürümü görünür.
    await expect(page.getByRole('note').filter({ hasText: 'kaydı engellemez' })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Onaylıyorum' })).toHaveCount(0)
    await expect(page.getByText(/aydinlatma-2026-1/)).toBeVisible()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(page.getByRole('heading', { name: `${name} kaydedildi` })).toBeVisible()

    const notice = page.getByRole('region', { name: 'Açık rıza durumu' })
    await expect(notice.getByRole('listitem').filter({ hasText: CONSENT_LABEL })).toBeVisible()
    await expect(notice).toContainText('velayet sahibi veli kendi hesabından verir')
    await expect(notice).toContainText('Ayarlar, Rızalarım')
    // Öteki amaçların metni yayımlanmadı; beklenmez, ayrı söylenir.
    await expect(notice).toContainText('Rıza metni henüz yayımlanmadığı için')
    await expect(notice).toContainText('Konuşma görevi ses kaydı')
    await expect(notice).toContainText('Rıza vermek zorunlu değildir')
    await expect(page.getByRole('button', { name: `${name} sözleşmesini görüntüle` })).toBeVisible()

    const saved = await prospectOf(client, 'e2e-kyt-riza')
    const consents = await client.get(
      `/api/v1/consents?studentId=${String(saved.record.studentId)}&status=all`,
    )
    expect(consents.status).toBe(200)
    expect((consents.body as { data: unknown[] }).data).toEqual([])
  })

  test('DOM-YTK-057: 18 yaşını doldurmuş kursiyerde rızayı kendisinin vereceği yazılır', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const name = 'Reşit Kursiyer'
    const school = await tenant({
      type: 'language_school',
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [prospect('e2e-kyt-rizay', name, { interest: 'B1 İngilizce', minor: false })],
    })
    await publishConsentText(await api(school.user('yonetici')))
    await loginAs(school.user('onburo'))
    await page.goto(`${LIST_URL}?aday=e2e-kyt-rizay`)
    const proceed = page.getByRole('button', { name: 'Devam et' })
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill(`${new Date().getUTCFullYear() - 25}-01-15`)
    await proceed.click()
    await page.getByLabel('Paket ders saati').fill('20')
    await proceed.click()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(page.getByRole('heading', { name: `${name} kaydedildi` })).toBeVisible()

    const notice = page.getByRole('region', { name: 'Açık rıza durumu' })
    await expect(notice).toContainText('rızayı kendisi verir')
    await expect(notice).not.toContainText('velayet sahibi veli')
  })

  // ON-290 (kullanıcı kararı 2026-11-03, K-05): veli hesabını personel kesin kayıttan açar; veli
  // kaydı ve öğrenci seçili gelir. Uç `POST /institution-members/guardian-invitations` (DOM-YTK-071).
  test('ON-290, DOM-YTK-071: ön büro kesin kayıttan veli hesabı açar, davet listede görünür, iptal edilir; aynı e-posta 409', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const name = 'Hesap Adayı'
    const email = 'e2e-kyt-veli@kampus.example'
    const school = await tenant({
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [prospect('e2e-kyt-veli', name)],
    })
    await publishConsentText(await api(school.user('yonetici')))
    await loginAs(school.user('onburo'))
    await page.goto(`${LIST_URL}?aday=e2e-kyt-veli`)
    const proceed = page.getByRole('button', { name: 'Devam et' })
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill('2013-03-01')
    await page.getByLabel('Veli adı soyadı').fill('Hesap Velisi')
    await page.getByLabel('Veli telefonu').fill('05559990072')
    await proceed.click()
    await proceed.click()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(page.getByRole('heading', { name: `${name} kaydedildi` })).toBeVisible()
    const notice = page.getByRole('region', { name: 'Açık rıza durumu' })
    await expect(notice).toContainText('veli rıza veremez')

    // Veli kaydı ve öğrenci seçili, ad ve e-posta veli kaydından dolu gelir.
    await page.getByRole('button', { name: 'Veli hesabı aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Veli hesabı aç' })
    await expect(panel.getByLabel('Veli adı soyadı')).toHaveValue('Hesap Velisi')
    await expect(panel.getByLabel('Veli e-postası')).toHaveValue(email)
    await expect(panel.getByRole('checkbox', { name: `${name} (bu kayıt)` })).toBeChecked()
    await panel.getByRole('button', { name: 'Veli hesabı aç' }).click()
    await expect(toast(page, 'Hesap Velisi için veli hesabı daveti gönderildi.')).toBeVisible()
    await expect(panel).toHaveCount(0)

    const invitations = page.getByRole('region', { name: 'Bekleyen veli davetleri' })
    await expect(invitations.getByText(email, { exact: false })).toBeVisible()
    await expect(invitations.getByText(name, { exact: false })).toBeVisible()
    await expect(notice).toContainText('Veli hesabı açıldı')

    await invitations.getByRole('button', { name: 'Hesap Velisi veli davetini iptal et' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Veli davetini iptal et' })
    await dialog.getByRole('button', { name: 'Daveti iptal et' }).click()
    await expect(toast(page, 'Hesap Velisi veli daveti iptal edildi.')).toBeVisible()
    await expect(invitations).toHaveCount(0)
    const client = await api(school.user('onburo'))
    const pending = await client.get('/api/v1/institution-members/guardian-invitations')
    expect(pending.status).toBe(200)
    expect((pending.body as { data: unknown[] }).data).toEqual([])

    // İptal davetle açılan hesabı silmez: aday ayrıntısından aynı e-postayla yeni hesap açılmaz.
    await page.goto(detailUrl('e2e-kyt-veli'))
    await page.getByRole('button', { name: 'Veli hesabı aç' }).click()
    await expect(panel.getByLabel('Veli e-postası')).toHaveValue(email)
    await panel.getByRole('button', { name: 'Veli hesabı aç' }).click()
    await expect(panel.getByText('Bu e-posta adresiyle kurumda zaten bir hesap var')).toBeVisible()
    await expect(panel.getByLabel('Veli e-postası')).toHaveAttribute('aria-invalid', 'true')
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

  // ON-035: Vue `Crm.vue` kesin kayıt formunun klavye ve adım davranışı (`goToStep`, alan hatası
  // odağı) ile başarı ekranının bağlantıları. Tutar tarifeden geldiği için Vue'nun "hatalı tutar"
  // adımı yoktur (DOM-FIN-002); geri dönüşte korunması beklenen bilgi kimlik, veli ve taksittir.
  test('ON-035: hatalı alan odak alır, adım değişince adım başlığı odaklanır, Geri girilen bilgiyi korur', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const name = 'Lale Ekin'
    const school = await tenant({
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [prospect('e2e-kyt-odak', name)],
    })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    const proceed = page.getByRole('button', { name: 'Devam et' })
    const candidate = page.getByLabel('Aday öğrenci')
    await proceed.click()
    await expect(candidate).toBeFocused()
    await expect(candidate).toHaveAttribute('aria-invalid', 'true')

    await candidate.selectOption('e2e-kyt-odak')
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()
    await expect(page.getByRole('heading', { name: 'Kimlik ve veli bilgileri' })).toBeFocused()
    await proceed.click()
    await expect(page.getByLabel('Kimlik numarası')).toBeFocused()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill('2013-03-01')
    await page.getByLabel('Veli adı soyadı').fill('Odak Velisi')
    await page.getByLabel('Veli telefonu').fill('05559990081')
    await proceed.click()
    await expect(page.getByRole('heading', { name: 'Ücret ve taksit planı' })).toBeFocused()
    await page.getByLabel('Taksit sayısı').selectOption('4')

    await page.getByRole('button', { name: 'Geri' }).click()
    await expect(page.getByRole('heading', { name: 'Kimlik ve veli bilgileri' })).toBeFocused()
    await expect(page.getByLabel('Kimlik numarası')).toHaveValue('10000000146')
    await expect(page.getByLabel('Veli adı soyadı')).toHaveValue('Odak Velisi')
    // Adım göstergesinden ilk adıma dönülür; seçimler korunur.
    await page.getByRole('button', { name: 'Aday ve sınıf' }).click()
    await expect(page.getByRole('heading', { name: 'Aday ve sınıf seçimi' })).toBeFocused()
    await expect(candidate).toHaveValue('e2e-kyt-odak')
    await proceed.click()
    await proceed.click()
    await expect(page.getByLabel('Taksit sayısı')).toHaveValue('4')
    await proceed.click()
    await expect(
      page.getByRole('heading', { name: 'Kaydı tamamlamadan önce kontrol edin' }),
    ).toBeFocused()
    await expect(page.getByText('4 taksit', { exact: false })).toBeVisible()
  })

  test('ON-035, DOM-KAY-035: başarıdan sonra ön büro Tahsilat Takibi\'ne gider; "Yeni kayıt" formu ve adresi temizler', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const name = 'Ece Tunç'
    const school = await tenant({
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [prospect('e2e-kyt-son', name), prospect('e2e-kyt-son2', 'Sıradaki Aday')],
    })
    await loginAs(school.user('onburo'))
    await enrollThroughForm(page, 'e2e-kyt-son', '05559990082')
    await expect(page.getByRole('heading', { name: `${name} kaydedildi` })).toBeVisible()

    await page.getByRole('button', { name: 'Yeni kayıt' }).click()
    await expect(page).not.toHaveURL(/aday=/)
    await expect(page.getByLabel('Aday öğrenci')).toHaveValue('')
    await expect(
      page.getByLabel('Aday öğrenci').getByRole('option', { name: new RegExp(name) }),
    ).toHaveCount(0)

    await enrollThroughForm(page, 'e2e-kyt-son2', '05559990083', false)
    await page.getByRole('link', { name: 'Ödeme planını görüntüle' }).click()
    await expect(page).toHaveURL(/\/onburo\/tahsilat-takip/)
    await expect(page.getByRole('heading', { name: 'Tahsilat Takibi', level: 1 })).toBeVisible()
  })

  test('ON-035: yönetici kesin kayıttan sonra "Ödeme planını görüntüle" ile Finans & Tahsilat\'a gider', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['yonetici'],
      tariffYears: ['current'],
      records: [prospect('e2e-kyt-yon', 'Yönetici Adayı')],
    })
    await loginAs(school.user('yonetici'))
    await enrollThroughForm(page, 'e2e-kyt-yon', '05559990084', true, '/yonetici/kayit-islemleri')
    await page.getByRole('link', { name: 'Ödeme planını görüntüle' }).click()
    await expect(page).toHaveURL(/\/yonetici\/finans/)
    await expect(page.getByRole('heading', { name: 'Finans & Tahsilat', level: 1 })).toBeVisible()
  })
})

// ON-038: kural core ve API testlerindedir; burada form açıkken başka biri aynı sınıfı ya da aynı
// kimliği kullanınca sunucunun reddinin, indirim tavanında önizlemenin iletisinin ekranda nereye
// döndüğü kanıtlanır.
test.describe('Kayıt İşlemleri: ret iletileri', () => {
  test('DOM-FIN-021, discount_cap_exceeded: %50 tavanını aşan indirim seçimi ücret adımında durur; biri kalkınca önizleme gelir', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect('e2e-kyt-tavan', 'Tavan Adayı')],
    })
    const admin = await api(school.user('yonetici'))
    const academicYear = new Date().getFullYear()
    const draft = await admin.post(
      '/api/v1/fee-tariffs',
      {
        academicYear,
        items: [
          {
            kind: 'tuition',
            level: null,
            amountCents: 10_000_000,
            unit: 'year',
            vatBasisPoints: 1000,
            vatEffectiveDate: `${String(academicYear)}-01-01`,
            announcedAmountCents: 10_000_000,
          },
        ],
        discounts: [
          { kind: 'early_registration', percentBasisPoints: 3000, amountCents: null },
          { kind: 'early_payment', percentBasisPoints: 3000, amountCents: null },
        ],
        paymentTerms: PAYMENT_TERMS,
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const { id, version } = (draft.body as { data: { id: string; version: number } }).data
    const published = await admin.post(
      `/api/v1/fee-tariffs/${id}/publish`,
      { announcedDate: `${String(academicYear)}-01-02`, mebbisRecordedDate: null },
      { 'idempotency-key': randomUUID(), 'if-match': `"${String(version)}"` },
    )
    expect(published.status, JSON.stringify(published.body)).toBe(200)

    await loginAs(school.user('onburo'))
    await page.goto(`${LIST_URL}?aday=e2e-kyt-tavan`)
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    const proceed = page.getByRole('button', { name: 'Devam et' })
    await proceed.click()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill('2013-03-01')
    await page.getByLabel('Veli adı soyadı').fill('Tavan Velisi')
    await page.getByLabel('Veli telefonu').fill('05559990093')
    await proceed.click()

    await page.getByLabel('Erken kayıt').check()
    await page.getByLabel('Peşin ödeme').check()
    // Peşin indirimi yalnız peşin koşulunda geçer (DOM-FIN-013).
    await proceed.click()
    await expect(page.getByRole('alert')).toHaveText(
      'Peşin ödeme indirimi yalnız peşin koşuluyla uygulanır.',
    )
    await page.getByLabel('Taksit sayısı').selectOption('1')
    await proceed.click()
    await expect(page.getByRole('alert')).toHaveText(
      "Toplam indirim ilan ücretinin %50'sini aşamaz.",
    )
    await expect(page.getByRole('heading', { name: 'Ücret ve taksit planı' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ödeme planı önizlemesi' })).toHaveCount(0)

    await page.getByLabel('Peşin ödeme').uncheck()
    await expect(page.getByRole('heading', { name: 'Ödeme planı önizlemesi' })).toBeVisible()
    await expect(page.getByText(/-30\.000,00/)).toBeVisible()
    await proceed.click()
    await expect(
      page.getByRole('heading', { name: 'Kaydı tamamlamadan önce kontrol edin' }),
    ).toBeVisible()
  })

  test('DOM-FIN-013: kesin kayıt yalnız ilanlı taksit sayılarını sunar; koşul özette ve sözleşmede görünür', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect('e2e-kyt-kosul', 'Koşul Adayı')],
    })
    const admin = await api(school.user('yonetici'))
    const academicYear = new Date().getFullYear()
    const draft = await admin.post(
      '/api/v1/fee-tariffs',
      {
        academicYear,
        items: [
          {
            kind: 'tuition',
            level: null,
            amountCents: 10_000_000,
            unit: 'year',
            vatBasisPoints: 1000,
            vatEffectiveDate: `${String(academicYear)}-01-01`,
            announcedAmountCents: 10_000_000,
          },
        ],
        paymentTerms: [
          {
            kind: 'installment',
            minInstallments: 2,
            maxInstallments: 4,
            discountPercentBasisPoints: 300,
            discountAmountCents: null,
          },
        ],
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const { id, version } = (draft.body as { data: { id: string; version: number } }).data
    const published = await admin.post(
      `/api/v1/fee-tariffs/${id}/publish`,
      { announcedDate: `${String(academicYear)}-01-02`, mebbisRecordedDate: null },
      { 'idempotency-key': randomUUID(), 'if-match': `"${String(version)}"` },
    )
    expect(published.status, JSON.stringify(published.body)).toBe(200)

    await loginAs(school.user('onburo'))
    await page.goto(`${LIST_URL}?aday=e2e-kyt-kosul`)
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    const proceed = page.getByRole('button', { name: 'Devam et' })
    await proceed.click()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill('2013-03-01')
    await page.getByLabel('Veli adı soyadı').fill('Koşul Velisi')
    await page.getByLabel('Veli telefonu').fill('05559990094')
    await proceed.click()

    const count = page.getByLabel('Taksit sayısı')
    await expect(count.getByRole('option')).toHaveText([
      'Süreli · 2 taksit · %3 indirim',
      'Süreli · 3 taksit · %3 indirim',
      'Süreli · 4 taksit · %3 indirim',
    ])
    await expect(count).toHaveValue('4')
    const preview = page.getByRole('region', { name: 'Ödeme planı önizlemesi' })
    await expect(preview.getByText('Süreli · 4 taksit · %3 indirim')).toBeVisible()
    await expect(preview.getByText(/-3\.000,00/)).toBeVisible()
    await proceed.click()
    await expect(page.getByText('Ödeme koşulu').first()).toBeVisible()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(page.getByText('Kesin kayıt, sözleşme ve taksit planı oluşturuldu.')).toBeVisible()
    const contracts = await admin.get('/api/v1/collections/contracts?pageSize=100')
    const rows = (contracts.body as { data: { record: { paymentTerm?: unknown } }[] }).data
    expect(rows.map((row) => row.record.paymentTerm).filter(Boolean)).toEqual([
      {
        kind: 'installment',
        minInstallments: 2,
        maxInstallments: 4,
        discountPercentBasisPoints: 300,
        discountAmountCents: null,
        installmentCount: 4,
      },
    ])
  })

  test('DOM-KAY-010, class_capacity_full: dolu sınıf seçilemez; form açıkken dolan sınıfta sınıf adımına dönülür, ileti alanda', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [
        prospect('e2e-kyt-kont-a', 'Kontenjan Adayı'),
        prospect('e2e-kyt-kont-b', 'Önce Gelen Aday'),
        classRecord('e2e-kont', 'K'),
        classRecord('e2e-dolu', 'D'),
        studentRecord('e2e-dolu-ogr', 'e2e-dolu'),
      ],
    })
    await loginAs(school.user('onburo'))
    const admin = await api(school.user('yonetici'))
    await page.goto(`${LIST_URL}?aday=e2e-kyt-kont-a`)
    const classes = page.getByLabel('Sınıf', { exact: true })
    await expect(classes.getByRole('option', { name: '7-D (1/1)' })).toBeDisabled()
    await expect(classes.getByRole('option', { name: '7-K (0/1)' })).toBeEnabled()
    await classes.selectOption('e2e-kont')
    await fillToReview(page, '10000000146', '05559990091')

    // Form açıkken başka bir kullanıcı son yeri doldurdu.
    await enrollThroughApi(admin, 'e2e-kyt-kont-b', { classId: 'e2e-kont' })
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()

    await expect(page.getByRole('heading', { name: 'Aday ve sınıf seçimi' })).toBeVisible()
    await expect(classes).toHaveAttribute('aria-invalid', 'true')
    await expect(classes).toBeFocused()
    await expect(page.getByText('Seçilen sınıfın kontenjanı dolu.')).toBeVisible()
    await expect(toast(page, 'Seçilen sınıfın kontenjanı dolu.')).toHaveCount(0)
    // Doluluk tazelenir: sınıf artık seçilemez.
    await expect(classes.getByRole('option', { name: '7-K (1/1)' })).toBeDisabled()
    expect((await prospectOf(admin, 'e2e-kyt-kont-a')).record.studentId).toBeNull()
  })

  test('DOM-KAY-012, student_identity_duplicate: aktif kayıtta kullanılan kimlik numarası kimlik adımına döner, ileti alanda', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      tariffYears: ['current'],
      records: [
        prospect('e2e-kyt-kimlik-a', 'İkinci Başvuru'),
        prospect('e2e-kyt-kimlik-b', 'Kayıtlı Öğrenci'),
      ],
    })
    const admin = await api(school.user('yonetici'))
    await enrollThroughApi(admin, 'e2e-kyt-kimlik-b', {
      identity: { kind: 'tc', number: '10000000214', birthDate: '2013-03-01' },
    })
    await loginAs(school.user('onburo'))
    await page.goto(`${LIST_URL}?aday=e2e-kyt-kimlik-a`)
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await fillToReview(page, '10000000214', '05559990092')
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()

    await expect(page.getByRole('heading', { name: 'Kimlik ve veli bilgileri' })).toBeVisible()
    const identity = page.getByLabel('Kimlik numarası')
    await expect(identity).toHaveAttribute('aria-invalid', 'true')
    await expect(identity).toBeFocused()
    await expect(page.getByText('Bu kimlik numarasıyla aktif bir kayıt var.')).toBeVisible()
    expect((await prospectOf(admin, 'e2e-kyt-kimlik-a')).record.studentId).toBeNull()
  })
})

/** Kadıköy (b1) kampüsünde tek kişilik 7. sınıf şubesi. */
function classRecord(id: string, section: string) {
  return {
    collection: 'classes' as const,
    data: {
      id,
      name: `7-${section}`,
      grade: 7,
      section,
      level: '7. Sınıf',
      branchId: 'b1',
      teacherId: 't1',
      capacity: 1,
      room: `K-${section}`,
      isActive: true,
      deletedAt: null,
    },
  }
}

function studentRecord(id: string, classId: string) {
  return {
    collection: 'students' as const,
    data: {
      id,
      name: 'Dolu Sınıf Öğrencisi',
      classId,
      parentId: 'p1',
      email: `${id}@kampus.example`,
      phone: '05550109999',
      joinedAt: new Date(Date.now() - 30 * DAY).toISOString(),
      isActive: true,
      progress: 0,
      number: '2026999',
    },
  }
}

/** Sınıf seçilmiş ilk adımdan kontrol adımına: T.C. kimlik, yeni veli, varsayılan taksit. */
async function fillToReview(page: Page, identity: string, guardianPhone: string) {
  const proceed = page.getByRole('button', { name: 'Devam et' })
  await proceed.click()
  await page.getByLabel('Kimlik numarası').fill(identity)
  await page.getByLabel('Doğum tarihi').fill('2013-03-01')
  await page.getByLabel('Veli adı soyadı').fill('Ret Senaryosu Velisi')
  await page.getByLabel('Veli telefonu').fill(guardianPhone)
  await proceed.click()
  await proceed.click()
  await expect(
    page.getByRole('heading', { name: 'Kaydı tamamlamadan önce kontrol edin' }),
  ).toBeVisible()
}

/** Başka bir kullanıcının arayüzden geçmeden yaptığı kesin kayıt (yayındaki tarifeyle). */
async function enrollThroughApi(
  client: ApiClient,
  prospectId: string,
  overrides: Partial<ReturnType<typeof enrollBody>>,
) {
  const tariffs = await client.get('/api/v1/fee-tariffs?pageSize=100')
  expect(tariffs.status).toBe(200)
  const published = (tariffs.body as { data: { id: string; status: string }[] }).data.find(
    (row) => row.status === 'published',
  )
  expect(published).toBeDefined()
  const current = await prospectOf(client, prospectId)
  const result = await client.post(
    `/api/v1/prospects/${prospectId}/enroll`,
    {
      ...enrollBody(),
      tariffId: published!.id,
      identity: { kind: 'tc', number: '10000000382', birthDate: '2013-03-01' },
      ...overrides,
    },
    { 'idempotency-key': randomUUID(), 'if-match': `"${current.version}"` },
  )
  expect(result.status, JSON.stringify(result.body)).toBe(201)
}

test.describe('kayıt dondurma', () => {
  const FREEZE_URL = '/yonetici/kayit-islemleri'
  const section = (page: Page) => page.getByRole('region', { name: 'Kayıt dondurma' })
  const dayAfter = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10)

  test('DOM-DIL-052, DOM-KAY-026: talep, yönetici onayı, dondurulmuş durum ve dönüş', async ({
    page,
    tenant,
    loginAs,
    api,
  }) => {
    const school = await tenant({ type: 'language_school', roles: ['onburo'], students: ['s1'] })
    await loginAs(school.user('yonetici'))
    await page.goto(FREEZE_URL)

    const area = section(page)
    await area.getByRole('button', { name: 'Dondurma talebi aç' }).click()
    const form = page.getByRole('dialog', { name: 'Dondurma talebi aç' })
    await form.getByLabel('Kursiyer').selectOption('s1')
    await form.getByLabel('Dondurma nedeni').selectOption('relocation')
    await form.getByLabel('Planlanan dönüş').fill(dayAfter(60))
    await form.getByRole('button', { name: 'Talebi aç' }).click()
    await expect(toast(page, 'Dondurma talebi açıldı.')).toBeVisible()
    await expect(form).toBeHidden()
    await expect(area.getByText('Onay bekliyor')).toBeVisible()

    await area.getByRole('button', { name: /dondurmasını onayla$/ }).click()
    const decision = page.getByRole('dialog', { name: 'Dondurmayı onayla' })
    await expect(decision.getByRole('textbox')).toHaveCount(0)
    await decision.getByRole('button', { name: 'Onayla' }).click()
    await expect(toast(page, 'Dondurma onaylandı.')).toBeVisible()
    await expect(area.getByText('Dondurulmuş')).toBeVisible()

    // Durum öğrenci kaydından türetilir; dondurma ayrılış değildir.
    const admin = await api(school.user('yonetici'))
    const student = await admin.get('/api/v1/collections/students/s1')
    expect(student.status).toBe(200)
    const record = (student.body as { data: { record: { isActive: boolean; frozenAt?: string } } })
      .data.record
    expect(record.isActive).toBe(true)
    expect(record.frozenAt).toBeTruthy()

    await area.getByRole('button', { name: /dönüşünü işle$/ }).click()
    const back = page.getByRole('dialog', { name: 'Dönüşü işle' })
    await back.getByRole('button', { name: 'Dönüşü işle' }).click()
    await expect(toast(page, 'Dönüş işlendi. Kursiyer yeniden aktif.')).toBeVisible()
    await expect(area.getByText('Sona erdi')).toBeVisible()
  })

  test('DOM-DIL-052: ön büro talep açar ama karar veremez; yanlış tarih alanda gösterilir', async ({
    page,
    tenant,
    loginAs,
  }) => {
    const school = await tenant({ type: 'language_school', roles: ['onburo'], students: ['s1'] })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    const area = section(page)
    await area.getByRole('button', { name: 'Dondurma talebi aç' }).click()
    const form = page.getByRole('dialog', { name: 'Dondurma talebi aç' })
    await form.getByLabel('Kursiyer').selectOption('s1')
    await form.getByLabel('Başlangıç').fill(dayAfter(30))
    await form.getByLabel('Planlanan dönüş').fill(dayAfter(10))
    await form.getByRole('button', { name: 'Talebi aç' }).click()
    await expect(form.getByText('Dönüş tarihi başlangıçtan sonra olmalıdır.')).toBeVisible()
    await form.getByLabel('Planlanan dönüş').fill(dayAfter(60))
    await form.getByRole('button', { name: 'Talebi aç' }).click()
    await expect(toast(page, 'Dondurma talebi açıldı.')).toBeVisible()
    await expect(area.getByText('Onay bekliyor')).toBeVisible()
    await expect(area.getByRole('button', { name: /dondurmasını onayla$/ })).toHaveCount(0)
  })

  test('DOM-KAY-024, K-20: talep formu yalnız kategori alır, serbest metin alanı yoktur', async ({
    page,
    tenant,
    loginAs,
  }) => {
    const school = await tenant({ type: 'language_school', roles: ['onburo'], students: ['s1'] })
    await loginAs(school.user('yonetici'))
    await page.goto(FREEZE_URL)
    const area = section(page)
    await area.getByRole('button', { name: 'Dondurma talebi aç' }).click()
    const form = page.getByRole('dialog', { name: 'Dondurma talebi aç' })
    const reason = form.getByLabel('Dondurma nedeni')
    await expect(reason.getByRole('option', { name: 'Belgeli neden' })).toHaveCount(1)
    await expect(reason.getByRole('option', { name: 'Sağlık' })).toHaveCount(0)
    // Tarih alanları dışında metin yazılacak denetim yoktur.
    await expect(form.locator('textarea, input:not([type]), input[type="text"]')).toHaveCount(0)
    await expect(form.getByText('tanı ya da sağlık ayrıntısı istenmez')).toBeVisible()

    await form.getByLabel('Kursiyer').selectOption('s1')
    await reason.selectOption('documented')
    await form.getByLabel('Planlanan dönüş').fill(dayAfter(60))
    await form.getByRole('button', { name: 'Talebi aç' }).click()
    await expect(toast(page, 'Dondurma talebi açıldı.')).toBeVisible()
    await expect(area.getByRole('cell', { name: 'Belgeli neden' })).toBeVisible()

    await area.getByRole('button', { name: /dondurma ayrıntısı$/ }).click()
    const detail = page.getByRole('dialog', { name: 'Dondurma ayrıntısı' })
    await expect(detail.getByText('Belgeli neden')).toBeVisible()
    await expect(detail.getByText('Gerekçe')).toHaveCount(0)
  })

  test('DOM-DIL-052: okulda kayıt dondurma bölümü yoktur', async ({ page, tenant, loginAs }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await expect(page.getByRole('heading', { name: 'Kayıt İşlemleri' })).toBeVisible()
    await expect(section(page)).toHaveCount(0)
  })

  test('DOM-DIL-052: bölüm 390 px genişlikte yatay taşmaz', async ({ page, tenant, loginAs }) => {
    const school = await tenant({ type: 'language_school', roles: ['onburo'], students: ['s1'] })
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await expect(section(page)).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

/** Aynı kurumda iki öğrenci aynı kimlikle kaydedilemez; veli telefonuna göre geçerli T.C. no. */
const TC_NUMBERS: Readonly<Record<string, string>> = {
  '05559990082': '10000000214',
  '05559990083': '10000000382',
  '05559990084': '10000000450',
}

/** Adayı formdan kaydeder: ilk sınıf, T.C. kimlik, yeni veli, varsayılan taksit. */
async function enrollThroughForm(
  page: Page,
  prospectId: string,
  guardianPhone: string,
  open = true,
  url = LIST_URL,
) {
  if (open) await page.goto(`${url}?aday=${prospectId}`)
  else await page.getByLabel('Aday öğrenci').selectOption(prospectId)
  const proceed = page.getByRole('button', { name: 'Devam et' })
  await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
  await proceed.click()
  await page.getByLabel('Kimlik numarası').fill(TC_NUMBERS[guardianPhone] ?? '10000000146')
  await page.getByLabel('Doğum tarihi').fill('2013-03-01')
  await page.getByLabel('Veli adı soyadı').fill('Son Adım Velisi')
  await page.getByLabel('Veli telefonu').fill(guardianPhone)
  await proceed.click()
  await proceed.click()
  await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
  await expect(toast(page, 'Kesin kayıt, sözleşme ve taksit planı oluşturuldu.')).toBeVisible()
}
