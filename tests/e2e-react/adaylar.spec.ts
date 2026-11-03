import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant, TenantOptions, TenantUser } from './support/tenant.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// CRM aday ekranları: Aday Öğrenciler (`/onburo/adaylar`), aday detayı (`/:rol/aday/:id`) ve
// Tanışma Görüşmeleri (`/onburo/deneme-dersi-takvimi`); DOM-KAY-005, -007, -009, -030…034,
// DOM-DIL-030. Yazma uçları `POST /prospects`, `/prospects/:id/{stage,notes,meeting,trial-lesson}`.
// Her test kendi kurumunu kurar; adaylar ve dersler kurulum kaydıyla gelir (UI'dan kurulum yok).
// Saat dilimi sabit: 10:00Z İstanbul'da 13:00'tür.

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
/** `days` gün sonrasının İstanbul günü (`YYYY-MM-DD`); tarih alanına yazılır. */
const istanbulDay = (days: number) =>
  new Date(Date.now() + days * DAY + 3 * 3_600_000).toISOString().slice(0, 10)

const LIST_URL = '/onburo/adaylar'
const MEETINGS_URL = '/onburo/deneme-dersi-takvimi'
const detailUrl = (role: string, id: string) => `/${role}/aday/${id}`
const MODULE_CLOSED = 'Bu modül kurum ayarlarından kapatılmış.'
const NOTE_NOTICE = 'Sağlık, engellilik veya aileye ait özel bilgileri aday notuna yazmayın.'
const SAME_MESSAGE =
  'Bu telefon veya e-postayla açık bir aday kaydı var; yeni temas için mevcut karta not ekleyin.'
const SHARED_MESSAGE =
  'Bu telefon veya e-posta başka bir açık adayda kayıtlı; kardeş adaysa kardeşini seçin.'
const CONFLICT_MESSAGE =
  'Bu kampüste seçilen saatte aynı oda veya görevli için başka bir görüşme var.'

const tableOf = (page: Page, name: string) => page.getByRole('table', { name, exact: true })
const bodyRows = (page: Page, name: string) => tableOf(page, name).locator('tbody tr')
const resultCount = (page: Page) => page.locator('.result-count')
const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

interface ProspectData {
  id: string
  name: string
  phone: string
  stage?: string
  source?: string
  interest?: string
  branchId?: string
  createdAt?: string
  trialAt?: string | null
  meeting?: object
  trialLesson?: object
  minor?: boolean
  guardianName?: string
  notes?: object[]
  lostReason?: string
}

/** Kurulum kaydı; seed'deki aday biçimi (`notes` dizisi, kampüs b1). */
const prospect = (data: ProspectData) => ({
  collection: 'prospects' as const,
  data: {
    email: `${data.id}@kampus.example`,
    branchId: 'b1',
    interest: '7. Sınıf · Ortaokul',
    source: 'Web sitesi',
    stage: 'Yeni aday',
    studentId: null,
    createdAt: at(-1, 9),
    trialAt: null,
    notes: [],
    ...data,
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

interface ProspectItem {
  id: string
  version: number
  record: { name: string; stage: string; siblingOfId?: string; notes: { text: string }[] }
}

async function prospectsOf(client: ApiClient): Promise<ProspectItem[]> {
  const result = await client.get('/api/v1/collections/prospects?pageSize=100')
  expect(result.status).toBe(200)
  return (result.body as { data: ProspectItem[] }).data
}

interface ModuleSettings {
  data: { version: number }
}
async function closeModule(client: ApiClient, moduleKey: string) {
  const settings = await client.get('/api/v1/modules')
  expect(settings.status).toBe(200)
  const response = await client.context.patch(`/api/v1/modules/${moduleKey}`, {
    data: { enabled: false },
    headers: {
      'if-match': `"${(settings.body as ModuleSettings).data.version}"`,
      'idempotency-key': randomUUID(),
    },
  })
  expect(response.status()).toBe(200)
}

/** İki aşama ve iki kaynak karışık 11 aday: 7 Yeni aday + 4 Teklif verildi; tek indeks Telefon. */
const listRecords = () =>
  Array.from({ length: 11 }, (_, index) => {
    const n = index + 1
    return prospect({
      id: `e2e-pr-${String(n).padStart(2, '0')}`,
      name: `Aday ${String(n).padStart(2, '0')}`,
      phone: `0555030${String(n).padStart(4, '0')}`,
      stage: n <= 7 ? 'Yeni aday' : 'Teklif verildi',
      source: n % 2 === 1 ? 'Telefon' : 'Web sitesi',
      createdAt: at(-n, 9),
    })
  })

test.describe('Aday Öğrenciler listesi', () => {
  test('liste aşama ve kaynakla süzülür, sayfalanır; süzgeç adreste kalır (DOM-KAY-007)', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({ roles: ['onburo'], records: listRecords() })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await expect(page.getByRole('heading', { name: 'Aday Öğrenciler', level: 1 })).toBeVisible()
    await expect(resultCount(page)).toContainText('1–8 / 11 kayıt')
    await expect(bodyRows(page, 'Aday öğrenciler')).toHaveCount(8)

    await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
    await expect(page).toHaveURL(/[?&]sayfa=2/)
    await expect(resultCount(page)).toContainText('9–11 / 11 kayıt')
    await expect(bodyRows(page, 'Aday öğrenciler')).toHaveCount(3)

    // Süzgeç değişince sayfa sıfırlanır.
    await page.getByRole('button', { name: 'Filtreler' }).click()
    await page.getByLabel('Aşama', { exact: true }).selectOption('Teklif verildi')
    await expect(page).toHaveURL(/asama=/)
    await expect(page).not.toHaveURL(/sayfa=/)
    await expect(resultCount(page)).toContainText('1–4 / 4 kayıt')
    await expectEveryRow(bodyRows(page, 'Aday öğrenciler'), 'Teklif verildi')

    await page.getByLabel('Kaynak', { exact: true }).selectOption('Telefon')
    await expect(page).toHaveURL(/kaynak=/)
    await expect(resultCount(page)).toContainText('1–2 / 2 kayıt')
    await expectEveryRow(bodyRows(page, 'Aday öğrenciler'), ['Teklif verildi', 'Telefon'])
    await expect(bodyRows(page, 'Aday öğrenciler').filter({ hasText: 'Aday 09' })).toHaveCount(1)
    await expect(bodyRows(page, 'Aday öğrenciler').filter({ hasText: 'Aday 11' })).toHaveCount(1)

    // Adres yenilenince süzgeçler korunur.
    await page.reload()
    await expect(resultCount(page)).toContainText('1–2 / 2 kayıt')
  })

  test('aday adı detay sayfasını açar ve listeye dönüş bağlantısı vardır', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({ roles: ['onburo'], records: listRecords() })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await page.getByRole('link', { name: 'Aday 03', exact: true }).click()
    await expect(page).toHaveURL(/\/onburo\/aday\/e2e-pr-03$/)
    await expect(page.getByRole('heading', { name: 'Aday 03', level: 1 })).toBeVisible()
    await page.getByRole('link', { name: 'Aday listesine dön' }).click()
    await expect(page).toHaveURL(/\/onburo\/adaylar/)
  })
})

test.describe('aday ekleme', () => {
  test('ön büro aday ekler; eksik aydınlatma onayı sorulur, kayıt listeye düşer (DOM-KAY-003, DOM-KAY-009)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({ roles: ['onburo'] })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await expect(page.getByText('Henüz aday kaydı yok.')).toBeVisible()

    await page.getByRole('button', { name: 'Yeni aday ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni aday ekle' })
    await form.getByLabel('Aday adı soyadı').fill('Zeynep Arda')
    // Okul adayı her zaman 18 yaş altıdır: veli adı ve veli telefonu istenir.
    await form.getByLabel('Veli adı soyadı').fill('Hülya Arda')
    await form.getByLabel('Veli telefonu').fill('0555 030 90 01')
    await form.getByLabel('İlgilendiği program').fill('6. Sınıf · Ortaokul')
    await form.getByRole('button', { name: 'Adayı ekle' }).click()
    await expect(
      form.getByText('Aydınlatma metninin adaya gösterildiğini onaylayın.'),
    ).toBeVisible()

    await form.getByLabel('Aydınlatma metni adaya gösterildi').check()
    await form.getByRole('button', { name: 'Adayı ekle' }).click()
    await expect(toast(page, 'Aday eklendi.')).toBeVisible()
    await expect(form).toBeHidden()
    await expect(bodyRows(page, 'Aday öğrenciler')).toHaveCount(1)
    await expect(bodyRows(page, 'Aday öğrenciler').first()).toContainText('Zeynep Arda')
    await expect(bodyRows(page, 'Aday öğrenciler').first()).toContainText('Yeni aday')

    const saved = (await prospectsOf(await api(school.user('onburo')))).map((item) => item.record)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ name: 'Zeynep Arda', stage: 'Yeni aday' })
  })

  test('aynı telefon ve adla ikinci kayıt reddedilir; ileti eşleşen adayı göstermez (DOM-KAY-002)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect({ id: 'e2e-pr-mina', name: 'Mina Kaya', phone: '05550300001' })],
    })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await page.getByRole('button', { name: 'Yeni aday ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni aday ekle' })
    await form.getByLabel('Aday adı soyadı').fill('mina  KAYA')
    await form.getByLabel('Veli adı soyadı').fill('Ayten Kaya')
    await form.getByLabel('Veli telefonu').fill('05550300001')
    await form.getByLabel('İlgilendiği program').fill('7. Sınıf · Ortaokul')
    await form.getByLabel('Aydınlatma metni adaya gösterildi').check()
    await form.getByRole('button', { name: 'Adayı ekle' }).click()

    await expect(form.getByText(SAME_MESSAGE)).toBeVisible()
    await expect(form.getByLabel('Veli telefonu')).toBeFocused()
    await expect(form.getByLabel('Veli telefonu')).toHaveAttribute('aria-invalid', 'true')
    await expect(form.getByText('Mina Kaya')).toHaveCount(0)
    await expect(form.getByLabel('Kardeş aday')).toHaveCount(0)
    expect(await prospectsOf(await api(school.user('onburo')))).toHaveLength(1)
  })

  test('iletişimi paylaşan farklı adlı aday reddedilince kardeş seçici açılır; ön büro kardeşi kendisi seçer (DOM-KAY-031)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect({ id: 'e2e-pr-mina', name: 'Mina Kaya', phone: '05550300001' })],
    })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await page.getByRole('button', { name: 'Yeni aday ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni aday ekle' })
    await form.getByLabel('Aday adı soyadı').fill('Efe Kaya')
    await form.getByLabel('Veli adı soyadı').fill('Ayten Kaya')
    await form.getByLabel('Veli telefonu').fill('05550300001')
    await form.getByLabel('İlgilendiği program').fill('5. Sınıf · Ortaokul')
    await form.getByLabel('Aydınlatma metni adaya gösterildi').check()
    await form.getByRole('button', { name: 'Adayı ekle' }).click()

    // İleti eşleşen adı söylemez; seçici açılır ve seçim ön büroya bırakılır.
    const sibling = form.getByLabel('Kardeş aday')
    await expect(sibling).toBeVisible()
    await expect(form.getByText(SHARED_MESSAGE)).toBeVisible()
    await expect(sibling.locator('option').filter({ hasText: 'Mina Kaya' })).toHaveCount(1)

    await form.getByRole('button', { name: 'Adayı ekle' }).click()
    await expect(form.getByText(SHARED_MESSAGE)).toBeVisible()

    await sibling.selectOption({ label: 'Mina Kaya · Yeni aday' })
    await form.getByRole('button', { name: 'Adayı ekle' }).click()
    await expect(toast(page, 'Aday eklendi.')).toBeVisible()

    const saved = await prospectsOf(await api(school.user('onburo')))
    const mina = saved.find((item) => item.record.name === 'Mina Kaya')
    const efe = saved.find((item) => item.record.name === 'Efe Kaya')
    expect(efe?.record.siblingOfId).toBe(mina?.id)
  })
})

test.describe('aday detayı', () => {
  test('aşama yalnız geçerli hedeflere değişir; vazgeçmede neden istenir, vazgeçen yeniden açılır (DOM-KAY-005, DOM-KAY-030)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect({ id: 'e2e-pr-stage', name: 'Mert Aksoy', phone: '05550300010' })],
    })
    await loginAs(school.user('onburo'))
    await page.goto(detailUrl('onburo', 'e2e-pr-stage'))
    const stage = page.getByLabel('Kayıt aşaması')
    // Yeni aday: geri dönüş, planlama ve kesin kayıt aşamaları sunulmaz.
    await expect(stage.locator('option')).toHaveText([
      'Yeni aşamayı seçin',
      'İletişime geçildi',
      'Teklif verildi',
      'Vazgeçti',
    ])
    // Okul kurumunda deneme dersi yoktur.
    await expect(page.getByRole('button', { name: 'Deneme dersi planla' })).toHaveCount(0)

    await stage.selectOption('Teklif verildi')
    await page.getByRole('button', { name: 'Aşamayı güncelle' }).click()
    await expect(toast(page, 'Aday aşaması güncellendi.')).toBeVisible()
    await expect(page.getByLabel('Aday bilgileri').getByText('Teklif verildi')).toBeVisible()
    await expect(stage.locator('option')).toHaveText(['Yeni aşamayı seçin', 'Vazgeçti'])

    await stage.selectOption('Vazgeçti')
    await page.getByRole('button', { name: 'Aşamayı güncelle' }).click()
    await expect(page.getByText('Vazgeçme nedenini seçin.')).toBeVisible()
    await page.getByLabel('Vazgeçme nedeni').selectOption({ label: 'Fiyat' })
    await page.getByRole('button', { name: 'Aşamayı güncelle' }).click()
    await expect(page.getByLabel('Aday bilgileri').getByText('Vazgeçti')).toBeVisible()
    // Kapalı adaya görüşme ve not eklenmez (DOM-KAY-032).
    await expect(page.getByRole('button', { name: 'Tanışma görüşmesi planla' })).toBeDisabled()
    await expect(page.getByText('Kapalı adaya not eklenmez.')).toBeVisible()
    await expect(page.getByLabel('Görüşme notu', { exact: true })).toHaveCount(0)
    await expect(stage.locator('option')).toHaveText(['Yeni aşamayı seçin', 'İletişime geçildi'])

    await stage.selectOption('İletişime geçildi')
    await page.getByRole('button', { name: 'Aşamayı güncelle' }).click()
    await expect(page.getByLabel('Aday bilgileri').getByText('İletişime geçildi')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tanışma görüşmesi planla' })).toBeEnabled()

    const saved = (await prospectsOf(await api(school.user('onburo')))).map((item) => item.record)
    expect(saved[0]?.stage).toBe('İletişime geçildi')
  })

  test('not eklenir; özel nitelikli veri uyarısı görünür, boş not reddedilir (DOM-KAY-032)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect({ id: 'e2e-pr-note', name: 'Nehir Işık', phone: '05550300020' })],
    })
    await loginAs(school.user('onburo'))
    await page.goto(detailUrl('onburo', 'e2e-pr-note'))
    await expect(page.getByText(NOTE_NOTICE)).toBeVisible()
    await expect(page.getByText('0 görüşme')).toBeVisible()

    await page.getByRole('button', { name: 'Notu kaydet' }).click()
    await expect(page.getByLabel('Görüşme notu', { exact: true })).toBeFocused()
    await expect(toast(page, 'Not eklendi.')).toHaveCount(0)

    await page.getByLabel('Görüşme notu', { exact: true }).fill('Veli kampüsü gezmek istiyor.')
    await page.getByRole('button', { name: 'Notu kaydet' }).click()
    await expect(toast(page, 'Not eklendi.')).toBeVisible()
    await expect(page.getByText('1 görüşme')).toBeVisible()
    await expect(page.getByText('Veli kampüsü gezmek istiyor.')).toBeVisible()
    await expect(page.getByLabel('Görüşme notu', { exact: true })).toHaveValue('')

    const saved = await prospectsOf(await api(school.user('onburo')))
    expect(saved[0]?.record.notes.map((note) => note.text)).toEqual([
      'Veli kampüsü gezmek istiyor.',
    ])
  })

  test('ön büro öğretmensiz görüşme planlar; geçmiş an ve aynı oda çakışması alan hatası verir (DOM-KAY-033)', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [
        prospect({ id: 'e2e-pr-m1', name: 'Mira Demir', phone: '05550300031' }),
        prospect({ id: 'e2e-pr-m2', name: 'Nil Soylu', phone: '05550300032' }),
      ],
    })
    await loginAs(school.user('onburo'))
    await page.goto(detailUrl('onburo', 'e2e-pr-m1'))
    await page.getByRole('button', { name: 'Tanışma görüşmesi planla' }).click()
    const panel = page.getByRole('dialog', { name: 'Tanışma görüşmesi planla' })
    // Öğretmen listesi ön büroya kapalıdır: seçim yalnız yöneticide.
    await expect(panel.getByLabel('Görevli öğretmen (isteğe bağlı)')).toHaveCount(0)

    await panel.getByLabel('Görüşme günü').fill(istanbulDay(-2))
    await panel.getByLabel('Başlangıç saati').fill('10:00')
    await panel.getByLabel('Görüşme odası').fill('Oda 7')
    await panel.getByRole('button', { name: 'Planla' }).click()
    await expect(panel.getByText('Gelecek bir tarih ve saat seçin.')).toBeVisible()

    await panel.getByLabel('Görüşme günü').fill(istanbulDay(5))
    await panel.getByRole('button', { name: 'Planla' }).click()
    await expect(toast(page, 'Tanışma görüşmesi planlandı.')).toBeVisible()
    await expect(panel).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Tanışma görüşmesi planlandı' })).toBeVisible()
    await expect(page.getByLabel('Aday bilgileri').getByText('Görüşme planlandı')).toBeVisible()

    // Başka aday aynı gün, saat ve odayı isteyince çakışma tarih alanında görünür.
    await page.goto(detailUrl('onburo', 'e2e-pr-m2'))
    await page.getByRole('button', { name: 'Tanışma görüşmesi planla' }).click()
    await panel.getByLabel('Görüşme günü').fill(istanbulDay(5))
    await panel.getByLabel('Başlangıç saati').fill('10:00')
    await panel.getByLabel('Görüşme odası').fill('oda 7')
    await panel.getByRole('button', { name: 'Planla' }).click()
    await expect(panel.getByText(CONFLICT_MESSAGE)).toBeVisible()
    await panel.getByLabel('Başlangıç saati').fill('11:00')
    await panel.getByRole('button', { name: 'Planla' }).click()
    await expect(toast(page, 'Tanışma görüşmesi planlandı.')).toBeVisible()
  })

  test('yönetici görüşmeye görevli öğretmen seçebilir; aday detayı yönetici adresinde açılır', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['yonetici'],
      records: [prospect({ id: 'e2e-pr-y1', name: 'Selin Uçar', phone: '05550300041' })],
    })
    await loginAs(school.user('yonetici'))
    await page.goto(detailUrl('yonetici', 'e2e-pr-y1'))
    await expect(page.getByRole('heading', { name: 'Selin Uçar', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Tanışma görüşmesi planla' }).click()
    const panel = page.getByRole('dialog', { name: 'Tanışma görüşmesi planla' })
    const teacher = panel.getByLabel('Görevli öğretmen (isteğe bağlı)')
    await expect(teacher).toBeVisible()
    await panel.getByLabel('Görüşme günü').fill(istanbulDay(6))
    await panel.getByLabel('Görüşme odası').fill('Rehberlik odası')
    await teacher.selectOption({ index: 1 })
    await panel.getByRole('button', { name: 'Planla' }).click()
    await expect(toast(page, 'Tanışma görüşmesi planlandı.')).toBeVisible()
  })
})

test.describe('aday bilgisi düzeltme', () => {
  test('ön büro adayın bilgisini sağ panelde düzeltir; mükerrer telefon alan hatası verir, kart güncellenir (DOM-KAY-003)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [
        prospect({ id: 'e2e-pr-d1', name: 'Düzeltilecek Aday', phone: '05550300071' }),
        prospect({
          id: 'e2e-pr-d2',
          name: 'Düzeltilecek Aday',
          phone: '05550300072',
          stage: 'İletişime geçildi',
        }),
      ],
    })
    await loginAs(school.user('onburo'))
    await page.goto(detailUrl('onburo', 'e2e-pr-d1'))
    await expect(page.getByRole('heading', { name: 'Düzeltilecek Aday', level: 1 })).toBeVisible()
    // 18 yaş altı adayın telefonu ve e-postası velinindir (DOM-KAY-003): kartta ve panelde söylenir.
    await expect(page.getByText('Veli telefonu', { exact: true })).toBeVisible()
    await expect(page.getByText('Veli e-postası', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Bilgileri düzenle' }).click()
    const panel = page.getByRole('dialog', { name: 'Aday bilgilerini düzenle' })
    const phone = panel.getByLabel('Veli telefonu')
    await expect(panel.getByLabel('Veli e-postası (isteğe bağlı)')).toBeVisible()
    await expect(phone).toHaveValue('05550300071')
    // Değişiklik yapmadan kaydetmek istek atmaz.
    await panel.getByRole('button', { name: 'Kaydet' }).click()
    await expect(panel.getByText('Değişiklik yapılmadı.')).toBeVisible()
    // Aynı ad ve başka adayın telefonu mükerrerdir; hata telefon alanında görünür.
    await phone.fill('05550300072')
    await panel.getByRole('button', { name: 'Kaydet' }).click()
    await expect(panel.getByText(SAME_MESSAGE)).toBeVisible()
    // Geçerli düzeltme kaydedilir, panel kapanır, kart yeni değeri gösterir.
    await phone.fill('0555 030 00 99')
    await panel.getByLabel('İlgilendiği program').fill('B2 konuşma kursu')
    await panel.getByRole('button', { name: 'Kaydet' }).click()
    await expect(toast(page, 'Aday bilgileri güncellendi.')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Aday bilgilerini düzenle' })).toHaveCount(0)
    await expect(page.getByText('05550300099')).toBeVisible()
    const client = await api(school.user('onburo'))
    await expect
      .poll(async () => {
        const item = (await prospectsOf(client)).find((entry) => entry.id === 'e2e-pr-d1')
        return (item?.record as { interest?: string }).interest
      })
      .toBe('B2 konuşma kursu')
  })
})

test.describe('ticari ileti onayı', () => {
  test('ön büro kanal onayını kaydeder ve tek tıkla geri alır; değişiklikler geçmişte görünür (DOM-KAY-004)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect({ id: 'e2e-pr-o1', name: 'Onay Adayı', phone: '05550300061' })],
    })
    await loginAs(school.user('onburo'))
    await page.goto(detailUrl('onburo', 'e2e-pr-o1'))
    await expect(page.getByRole('heading', { name: 'Onay Adayı', level: 1 })).toBeVisible()
    const panel = page.getByRole('region', { name: 'Ticari ileti onayı' })
    const sms = panel.getByRole('listitem').filter({ hasText: 'SMS' })
    await expect(sms.getByText('Onay yok')).toBeVisible()
    await panel.getByRole('button', { name: 'SMS onayını kaydet' }).click()
    await expect(toast(page, 'SMS onayı kaydedildi.')).toBeVisible()
    await expect(sms.getByText('Onay var')).toBeVisible()
    await panel.getByRole('button', { name: 'SMS onayını geri al' }).click()
    await expect(toast(page, 'SMS onayı geri alındı.')).toBeVisible()
    await expect(sms.getByText('Onay yok')).toBeVisible()
    await expect(panel.getByText('SMS onayı geri alındı ·', { exact: false })).toBeVisible()
    await expect(panel.getByText('SMS onayı verildi ·', { exact: false })).toBeVisible()
    // Sunucuda güncel karar geri alınmış, geçmiş iki olay.
    const client = await api(school.user('onburo'))
    await expect
      .poll(async () => {
        const item = (await prospectsOf(client)).find((entry) => entry.id === 'e2e-pr-o1')
        return JSON.stringify(
          (item?.record as { marketingConsentHistory?: unknown[] }).marketingConsentHistory?.length,
        )
      })
      .toBe('2')
  })
})

test.describe('aşama geri alma', () => {
  test('yönetici yanlışlıkla ileri alınan aşamayı gerekçeyle geri alır; görüşmesiz adayda Görüşme planlandı sunulmaz (DOM-KAY-030)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['yonetici'],
      records: [
        prospect({
          id: 'e2e-pr-g1',
          name: 'Geri Alınan Aday',
          phone: '05550300051',
          stage: 'Teklif verildi',
        }),
      ],
    })
    await loginAs(school.user('yonetici'))
    await page.goto(detailUrl('yonetici', 'e2e-pr-g1'))
    await expect(page.getByRole('heading', { name: 'Geri Alınan Aday', level: 1 })).toBeVisible()
    const form = page.getByRole('form', { name: 'Aşamayı geri al' })
    const stage = form.getByLabel('Geri alınacak aşama')
    await expect(stage.locator('option')).toHaveText([
      'Aşamayı seçin',
      'Yeni aday',
      'İletişime geçildi',
    ])
    // Gerekçesiz gönderim alan hatası verir; aşama değişmez.
    await stage.selectOption('İletişime geçildi')
    await form.getByRole('button', { name: 'Aşamayı geri al' }).click()
    await expect(form.getByText('Gerekçe en az 2 karakter olmalıdır.')).toBeVisible()
    await form.getByLabel('Gerekçe').fill('Teklif yanlışlıkla işaretlendi.')
    await form.getByRole('button', { name: 'Aşamayı geri al' }).click()
    await expect(toast(page, 'Aday aşaması geri alındı.')).toBeVisible()
    const client = await api(school.user('yonetici'))
    await expect
      .poll(
        async () =>
          (await prospectsOf(client)).find((item) => item.id === 'e2e-pr-g1')?.record.stage,
      )
      .toBe('İletişime geçildi')
  })

  test('ön büro aşamayı geri alamaz: aday detayında geri alma formu yoktur', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [
        prospect({
          id: 'e2e-pr-g2',
          name: 'Ön Büro Adayı',
          phone: '05550300052',
          stage: 'Teklif verildi',
        }),
      ],
    })
    await loginAs(school.user('onburo'))
    await page.goto(detailUrl('onburo', 'e2e-pr-g2'))
    await expect(page.getByRole('heading', { name: 'Ön Büro Adayı', level: 1 })).toBeVisible()
    await expect(page.getByRole('form', { name: 'Aşamayı değiştir' })).toBeVisible()
    await expect(page.getByRole('form', { name: 'Aşamayı geri al' })).toHaveCount(0)
  })
})

test.describe('Tanışma Görüşmeleri', () => {
  test('açık adayların görüşmeleri yaklaşan önce listelenir; kapalı aday ve görüşmesiz aday yoktur (DOM-KAY-033)', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const meeting = (date: string) => ({
      date,
      duration: 30,
      room: 'Oda 3',
      teacherId: null,
      scheduledAt: at(-5, 9),
      by: { role: 'onburo', userId: 'u-onburo' },
    })
    const school = await tenant({
      roles: ['onburo'],
      records: [
        prospect({
          id: 'e2e-pr-soon',
          name: 'Yakın Aday',
          phone: '05550300051',
          stage: 'Görüşme planlandı',
          trialAt: at(2, 10),
          meeting: meeting(at(2, 10)),
        }),
        prospect({
          id: 'e2e-pr-far',
          name: 'Uzak Aday',
          phone: '05550300052',
          stage: 'Görüşme planlandı',
          trialAt: at(9, 10),
          meeting: meeting(at(9, 10)),
        }),
        prospect({
          id: 'e2e-pr-past',
          name: 'Geçmiş Aday',
          phone: '05550300053',
          stage: 'Görüşme planlandı',
          trialAt: at(-3, 10),
          meeting: meeting(at(-3, 10)),
        }),
        prospect({
          id: 'e2e-pr-lost',
          name: 'Vazgeçen Aday',
          phone: '05550300054',
          stage: 'Vazgeçti',
          trialAt: at(3, 10),
          meeting: meeting(at(3, 10)),
        }),
        prospect({ id: 'e2e-pr-none', name: 'Görüşmesiz Aday', phone: '05550300055' }),
      ],
    })
    await loginAs(school.user('onburo'))
    await page.goto(MEETINGS_URL)
    await expect(page.getByRole('heading', { name: 'Tanışma Görüşmeleri', level: 1 })).toBeVisible()
    const rows = bodyRows(page, 'Planlanan görüşmeler')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Yakın Aday')
    await expect(rows.nth(0)).toContainText('13:00 – 13:30')
    await expect(rows.nth(0)).toContainText('Oda 3')
    await expect(rows.nth(1)).toContainText('Uzak Aday')
    await expect(rows.nth(2)).toContainText('Geçmiş Aday')
    await expect(page.getByText('Vazgeçen Aday')).toHaveCount(0)
    await expect(page.getByText('Görüşmesiz Aday')).toHaveCount(0)

    await page.getByRole('link', { name: 'Yakın Aday adayını aç' }).click()
    await expect(page).toHaveURL(/\/onburo\/aday\/e2e-pr-soon$/)
    await expect(page.getByRole('heading', { name: 'Tanışma görüşmesi planlandı' })).toBeVisible()
  })

  test('görüşme yoksa boş durum planlamayı düğmeye ve aday detayına yönlendirir', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({ roles: ['onburo'] })
    await loginAs(school.user('onburo'))
    await page.goto(MEETINGS_URL)
    await expect(
      page.getByText(
        'Planlanmış görüşme yok. “Tanışma görüşmesi planla” ile ya da aday detayından planlayın.',
      ),
    ).toBeVisible()
  })
})

test.describe('erişim', () => {
  test('modül kapalıyken menü, doğrudan adresler ve API kapanır (DOM-KAY-007)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect({ id: 'e2e-pr-closed', name: 'Kapalı Aday', phone: '05550300060' })],
    })
    const admin = await api(school.user('yonetici'))
    await closeModule(admin, 'crm')
    await loginAs(school.user('onburo'))

    await page.goto(LIST_URL)
    await expect(page.getByText(MODULE_CLOSED)).toBeVisible()
    await expect(page).toHaveURL(/\/onburo\/dashboard/)
    await expect(page.getByRole('link', { name: 'Aday Öğrenciler' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Tanışma Görüşmeleri' })).toHaveCount(0)

    await page.goto(detailUrl('onburo', 'e2e-pr-closed'))
    await expect(page).toHaveURL(/\/onburo\/dashboard/)
    await page.goto(MEETINGS_URL)
    await expect(page).toHaveURL(/\/onburo\/dashboard/)
    expect((await admin.get('/api/v1/collections/prospects')).status).toBe(403)
  })

  test('öğretmen, veli ve öğrenci aday detayını açamaz; kendi ana sayfasına döner; API 403 verir', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo', 'ogretmen', 'ogrenci', 'veli'],
      records: [prospect({ id: 'e2e-pr-guard', name: 'Korumalı Aday', phone: '05550300070' })],
    })
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      await loginAs(school.user(role))
      await page.goto(detailUrl(role, 'e2e-pr-guard'))
      await expect(page).toHaveURL(new RegExp(`/${role}/dashboard`))
      await expect(page.getByText('Korumalı Aday')).toHaveCount(0)
      // Başka rolün adresi de kendi ana sayfasına yönlenir.
      await page.goto(detailUrl('onburo', 'e2e-pr-guard'))
      await expect(page).toHaveURL(new RegExp(`/${role}/dashboard`))
      expect(
        (await (await api(school.user(role))).get('/api/v1/collections/prospects')).status,
      ).toBe(403)
    }
  })
})

test.describe('dil okulu deneme dersi', () => {
  test('deneme dersi gelecek bir derse planlanır; 18 yaş altında veli onayı istenir; liste grubu gösterir (DOM-DIL-030, DOM-KAY-034)', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      type: 'language_school',
      roles: ['onburo'],
      records: [
        prospect({
          id: 'e2e-pr-trial',
          name: 'Deniz Akın',
          phone: '05550300080',
          interest: 'B1 genel İngilizce',
          minor: true,
          guardianName: 'Aylin Akın',
        }),
        lesson('e2e-lesson-1', at(3, 10)),
        lesson('e2e-lesson-past', at(-3, 10)),
      ],
    })
    await loginAs(school.user('onburo'))
    await page.goto(detailUrl('onburo', 'e2e-pr-trial'))
    await page.getByRole('button', { name: 'Deneme dersi planla' }).click()
    const panel = page.getByRole('dialog', { name: 'Deneme dersi planla' })
    const choice = panel.getByLabel('Deneme dersi', { exact: true })
    // Yalnız gelecekteki ders seçilebilir; geçmiş ders listede yoktur.
    await expect(choice.locator('option')).toHaveCount(2)
    await choice.selectOption({ index: 1 })
    await panel.getByRole('button', { name: 'Planla' }).click()
    await expect(
      panel.getByText('18 yaş altı adayın deneme dersi için veli onayı gerekir.'),
    ).toBeVisible()

    await panel.getByLabel('Velinin deneme dersi için onay verdiğini kaydediyorum').check()
    await panel.getByRole('button', { name: 'Planla' }).click()
    await expect(toast(page, 'Deneme dersi planlandı.')).toBeVisible()
    await expect(panel).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Deneme dersi planlandı' })).toBeVisible()
    await expect(page.getByText('13:00 – 13:40 · 7-A')).toBeVisible()

    await page.goto(MEETINGS_URL)
    const rows = bodyRows(page, 'Planlanan görüşmeler')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Deniz Akın')
    await expect(rows.first()).toContainText('Deneme dersi')
    await expect(rows.first()).toContainText('7-A')
  })
})

test.describe('inceleme bulguları', () => {
  test('başka kurumun aday adresi "Kayıt bulunamadı" gösterir; kapsam dışı kayıt sızmaz (DOM-KAY-007)', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const own = await tenant({ roles: ['onburo'], records: [] })
    const other = await tenant({
      roles: ['onburo'],
      records: [prospect({ id: 'e2e-pr-baska', name: 'Başka Kurum Adayı', phone: '05550300090' })],
    })
    expect(other.institutionId).not.toBe(own.institutionId)
    await loginAs(own.user('onburo'))
    await page.goto(detailUrl('onburo', 'e2e-pr-baska'))
    await expect(page.getByText('Kayıt bulunamadı.')).toBeVisible()
    await expect(page.getByText('Başka Kurum Adayı')).toHaveCount(0)
  })

  test('vazgeçen aday yeniden açılırken iletişim paylaşılıyorsa kardeş seçici açılır; aşama adı kurum diliyle yazılır (DOM-KAY-030, DOM-KAY-031)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [
        prospect({
          id: 'e2e-pr-lost',
          name: 'Mina Kaya',
          phone: '05550300100',
          stage: 'Vazgeçti',
          lostReason: 'price',
        }),
        prospect({ id: 'e2e-pr-open', name: 'Nehir Kaya', phone: '05550300100' }),
      ],
    })
    await loginAs(school.user('onburo'))
    await page.goto(detailUrl('onburo', 'e2e-pr-lost'))
    await page.getByLabel('Kayıt aşaması').selectOption('İletişime geçildi')
    await page.getByRole('button', { name: 'Aşamayı güncelle' }).click()

    // `prospect_contact_shared`: eşleşen aday söylenmez, seçici açılır.
    const sibling = page.getByLabel('Kardeş aday')
    await expect(sibling).toBeVisible()
    await expect(page.getByText(SHARED_MESSAGE)).toBeVisible()
    await expect(
      sibling.locator('option').filter({ hasText: 'Nehir Kaya · Yeni aday' }),
    ).toHaveCount(1)

    await sibling.selectOption({ label: 'Nehir Kaya · Yeni aday' })
    await page.getByRole('button', { name: 'Aşamayı güncelle' }).click()
    await expect(toast(page, 'Aday aşaması güncellendi.')).toBeVisible()
    const saved = await prospectsOf(await api(school.user('onburo')))
    const reopened = saved.find((item) => item.id === 'e2e-pr-lost')
    expect(reopened?.record.stage).toBe('İletişime geçildi')
    expect(reopened?.record.siblingOfId).toBe('e2e-pr-open')
  })

  test('kart bu arada başka biri tarafından değişince aşama güncellemesi uyarı verir ve kart yenilenir (If-Match 409)', async ({
    page,
    loginAs,
    api,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [prospect({ id: 'e2e-pr-race', name: 'Rana Işık', phone: '05550300110' })],
    })
    await loginAs(school.user('onburo'))
    await page.goto(detailUrl('onburo', 'e2e-pr-race'))
    await expect(page.getByRole('heading', { name: 'Rana Işık', level: 1 })).toBeVisible()

    // Başka bir oturum aynı karta not ekler; sayfadaki sürüm eskir.
    const other = await api(school.user('onburo'))
    const [current] = await prospectsOf(other)
    const note = 'Başka oturumdan eklenen not.'
    const added = await other.post(
      '/api/v1/prospects/e2e-pr-race/notes',
      { text: note },
      { 'idempotency-key': randomUUID(), 'if-match': `"${current?.version}"` },
    )
    expect(added.status).toBe(201)

    await page.getByLabel('Kayıt aşaması').selectOption('Teklif verildi')
    await page.getByRole('button', { name: 'Aşamayı güncelle' }).click()
    await expect(
      page.getByText('Aday kartı başka biri tarafından güncellendi.').first(),
    ).toBeVisible()
    // Kart yenilenir: araya giren not görünür ve aşama değişmemiştir.
    await expect(page.getByText(note)).toBeVisible()
    const [after] = await prospectsOf(other)
    expect(after?.record.stage).toBe('Yeni aday')
  })

  test('KVKK: telefonla arama adrese yazılmaz; süzgeç ve sayfa adreste kalır', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({ roles: ['onburo'], records: listRecords() })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await page.getByPlaceholder('Listede ara...').fill('05550300003')
    await expect(resultCount(page)).toContainText('1–1 / 1 kayıt')
    await expect(bodyRows(page, 'Aday öğrenciler').filter({ hasText: 'Aday 03' })).toHaveCount(1)
    // Adres güncellemesi bekletilmeden kontrol edilir: numara ve `q` parametresi yok.
    await page.waitForTimeout(500)
    expect(page.url()).not.toContain('05550300003')
    expect(new URL(page.url()).searchParams.has('q')).toBe(false)

    await page.getByRole('button', { name: 'Filtreler', exact: true }).click()
    await page.getByLabel('Aşama', { exact: true }).selectOption('Yeni aday')
    await expect(page).toHaveURL(/asama=/)
    expect(page.url()).not.toContain('05550300003')
    await expect(resultCount(page)).toContainText('1–1 / 1 kayıt')
  })
})

test.describe('390 px genişlik', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('aday listesi, detayı ve görüşme listesi yatay taşmaz', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({ roles: ['onburo'], records: listRecords() })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await expect(page.getByRole('heading', { name: 'Aday Öğrenciler', level: 1 })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.goto(detailUrl('onburo', 'e2e-pr-01'))
    await expect(page.getByRole('heading', { name: 'Aday 01', level: 1 })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.goto(MEETINGS_URL)
    await expect(page.getByRole('heading', { name: 'Tanışma Görüşmeleri', level: 1 })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

// ON-035: Vue `Crm.vue` eşitliği. Aday listesinin aşama sekmeleri ("Aday aşaması" LineTabs, kurum
// geneli sayılar), kayıt tarihi aralığı, detaydan dönüşte liste durumu; Tanışma Görüşmeleri'nin
// haftalık takvimi (`WeekCalendar`) ve sayfadan aday seçerek planlama.

/** Kurulum kaydındaki tanışma görüşmesi (seed biçimi). */
const meetingOf = (date: string, room = 'Oda 3') => ({
  date,
  duration: 30,
  room,
  teacherId: null,
  scheduledAt: at(-5, 9),
  by: { role: 'onburo', userId: 'u-onburo' },
})
/** Kaydın İstanbul günü; 09:00Z ve 10:00Z kayıtlar aynı UTC günündedir. */
const dayOf = (iso: string) => iso.slice(0, 10)

test.describe('Vue eşitliği: aday listesi (ON-035)', () => {
  test('ON-035, DOM-KAY-007: aşama sekmeleri sayılarıyla listeyi süzer; kayıt tarihi aralığı sunucuda süzer, CSV süzülmüş sonucu verir', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({ roles: ['onburo'], records: listRecords() })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    const tabs = page.getByRole('group', { name: 'Aday aşaması' })
    const all = tabs.getByRole('button', { name: /^Tüm adaylar/ })
    const offered = tabs.getByRole('button', { name: /^Teklif verildi/ })
    await expect(all).toContainText('11')
    await expect(offered).toContainText('4')
    await expect(tabs.getByRole('button', { name: /^Vazgeçti/ })).toContainText('0')

    await offered.click()
    await expect(offered).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(/asama=/)
    await expect(resultCount(page)).toContainText('1–4 / 4 kayıt')
    await expectEveryRow(bodyRows(page, 'Aday öğrenciler'), 'Teklif verildi')
    await all.click()
    await expect(page).not.toHaveURL(/asama=/)
    await expect(resultCount(page)).toContainText('1–8 / 11 kayıt')

    await page.getByRole('button', { name: 'Filtreler', exact: true }).click()
    await page.getByLabel('Kayıt tarihi başlangıç').fill(dayOf(at(-3, 9)))
    await page.getByLabel('Kayıt tarihi bitiş').fill(dayOf(at(-1, 9)))
    await expect(resultCount(page)).toContainText('1–3 / 3 kayıt')
    await expect(bodyRows(page, 'Aday öğrenciler').filter({ hasText: 'Aday 04' })).toHaveCount(0)

    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Listeyi indir' }).click()
    const csv = await readFile(await (await downloading).path(), 'utf8')
    for (const name of ['Aday 01', 'Aday 02', 'Aday 03']) expect(csv).toContain(name)
    expect(csv).not.toContain('Aday 04')
  })

  test('ON-035: detaydan geri dönünce kampüs süzgeci, sıralama ve sayfa korunur', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({ roles: ['onburo'], records: listRecords() })
    await loginAs(school.user('onburo'))
    await page.goto(LIST_URL)
    await page.getByLabel('Kampüs filtresi').selectOption('b1')
    await expect(page).toHaveURL(/kampus=b1/)
    const header = tableOf(page, 'Aday öğrenciler').getByRole('columnheader', {
      name: /Aday öğrenci/,
    })
    await header.getByRole('button').click()
    await expect(header).toHaveAttribute('aria-sort', 'ascending')
    await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
    await expect(resultCount(page)).toContainText('9–11 / 11 kayıt')
    await expect(bodyRows(page, 'Aday öğrenciler').first()).toContainText('Aday 09')

    await page.getByRole('link', { name: 'Aday 09', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Aday 09', level: 1 })).toBeVisible()
    await page.goBack()
    await expect(resultCount(page)).toContainText('9–11 / 11 kayıt')
    await expect(header).toHaveAttribute('aria-sort', 'ascending')
    await expect(page.getByLabel('Kampüs filtresi')).toHaveValue('b1')
    await expect(bodyRows(page, 'Aday öğrenciler').first()).toContainText('Aday 09')
  })
})

test.describe('Vue eşitliği: Tanışma Görüşmeleri (ON-035)', () => {
  test('ON-035, DOM-KAY-033: haftalık takvim görüşmeyi kendi gününde gösterir, haftalar arasında gezilir; kapalı aday yoktur', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [
        prospect({
          id: 'e2e-pr-hafta',
          name: 'Takvim Aday',
          phone: '05550300091',
          stage: 'Görüşme planlandı',
          trialAt: at(9, 10),
          meeting: meetingOf(at(9, 10)),
        }),
        prospect({
          id: 'e2e-pr-sonraki',
          name: 'Sonraki Hafta Aday',
          phone: '05550300092',
          stage: 'Görüşme planlandı',
          trialAt: at(16, 10),
          meeting: meetingOf(at(16, 10)),
        }),
        prospect({
          id: 'e2e-pr-vazgecen',
          name: 'Vazgeçen Takvim',
          phone: '05550300093',
          stage: 'Vazgeçti',
          trialAt: at(9, 11),
          meeting: meetingOf(at(9, 11), 'Oda 4'),
        }),
      ],
    })
    await loginAs(school.user('onburo'))
    await page.goto(MEETINGS_URL)
    await page
      .getByRole('group', { name: 'Görünüm' })
      .getByRole('button', { name: 'Haftalık takvim' })
      .click()
    await expect(page).toHaveURL(/gorunum=hafta/)

    await page.goto(`${MEETINGS_URL}?gorunum=hafta&hafta=${dayOf(at(9, 10))}`)
    const calendar = page.getByRole('list', { name: 'Haftalık görüşme takvimi' })
    await expect(calendar).toContainText('Takvim Aday')
    await expect(calendar).toContainText('13:00 – 13:30')
    await expect(calendar).not.toContainText('Sonraki Hafta Aday')
    await expect(calendar).not.toContainText('Vazgeçen Takvim')

    await page.getByRole('button', { name: 'Sonraki hafta' }).click()
    await expect(calendar).toContainText('Sonraki Hafta Aday')
    await expect(calendar).not.toContainText('Takvim Aday')
    await page.getByRole('button', { name: 'Önceki hafta' }).click()
    await expect(calendar).toContainText('Takvim Aday')

    await calendar.getByRole('link', { name: 'Takvim Aday' }).click()
    await expect(page).toHaveURL(/\/onburo\/aday\/e2e-pr-hafta$/)
    await page.goBack()
    await expect(calendar).toContainText('Takvim Aday')
  })

  test('ON-035, DOM-KAY-033: sayfadan açık aday seçilerek görüşme planlanır; kapalı aday seçilemez', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    const school = await tenant({
      roles: ['onburo'],
      records: [
        prospect({ id: 'e2e-pr-plan', name: 'Plan Aday', phone: '05550300094' }),
        prospect({
          id: 'e2e-pr-plan-x',
          name: 'Kapalı Plan',
          phone: '05550300095',
          stage: 'Vazgeçti',
          lostReason: 'Başka okul',
        }),
      ],
    })
    await loginAs(school.user('onburo'))
    await page.goto(MEETINGS_URL)
    await page.getByRole('button', { name: 'Tanışma görüşmesi planla' }).click()
    await expect(page).toHaveURL(/planlama=gorusme/)
    const panel = page.getByRole('dialog', { name: 'Tanışma görüşmesi planla' })
    const choice = panel.getByLabel('Aday', { exact: true })
    await expect(choice.getByRole('option', { name: /Kapalı Plan/ })).toHaveCount(0)
    await expect(panel.getByLabel('Görüşme günü')).toHaveCount(0)
    await choice.selectOption('e2e-pr-plan')
    await panel.getByLabel('Görüşme günü').fill(dayOf(at(4, 10)))
    await panel.getByLabel('Başlangıç saati').fill('15:00')
    await panel.getByLabel('Görüşme odası').fill('Oda 9')
    await panel.getByRole('button', { name: 'Planla' }).click()
    await expect(toast(page, 'Tanışma görüşmesi planlandı.')).toBeVisible()
    await expect(panel).toBeHidden()
    const rows = bodyRows(page, 'Planlanan görüşmeler')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Plan Aday')
    await expect(rows.first()).toContainText('15:00 – 15:30')
  })
})

test.describe('Vue eşitliği: ön büro panosu aday sayaçları (ON-035)', () => {
  test('ON-035, DOM-KAY-033: "Bugünkü tanışma görüşmesi" açık adayların bugünkü görüşmelerini, "Toplam kesin kayıt" kayıt olanları sayar', async ({
    page,
    loginAs,
    tenant,
  }: Fixtures) => {
    // İstanbul günü; 09:00Z o gün 12:00'dir (görüşme geçmiş olabilir, yine bugündür).
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
      new Date(),
    )
    const todayAt = `${today}T09:00:00.000Z`
    const school = await tenant({
      roles: ['onburo'],
      records: [
        prospect({
          id: 'e2e-pr-bugun-1',
          name: 'Bugün Bir',
          phone: '05550300101',
          stage: 'Görüşme planlandı',
          trialAt: todayAt,
          meeting: meetingOf(todayAt),
        }),
        prospect({
          id: 'e2e-pr-bugun-2',
          name: 'Bugün İki',
          phone: '05550300102',
          stage: 'Görüşme planlandı',
          trialAt: todayAt,
          meeting: meetingOf(todayAt, 'Oda 5'),
        }),
        prospect({
          id: 'e2e-pr-bugun-x',
          name: 'Bugün Vazgeçen',
          phone: '05550300103',
          stage: 'Vazgeçti',
          trialAt: todayAt,
          meeting: meetingOf(todayAt, 'Oda 6'),
        }),
        prospect({
          id: 'e2e-pr-ileri',
          name: 'İleri Aday',
          phone: '05550300104',
          stage: 'Görüşme planlandı',
          trialAt: at(3, 10),
          meeting: meetingOf(at(3, 10)),
        }),
        prospect({
          id: 'e2e-pr-kayitli',
          name: 'Kayıtlı Aday',
          phone: '05550300105',
          stage: 'Kayıt oldu',
        }),
      ],
    })
    await loginAs(school.user('onburo'))
    await page.goto('/onburo/dashboard')
    const card = (name: string) => page.getByRole('article', { name, exact: true })
    await expect
      .poll(() => card('Bugünkü tanışma görüşmesi').locator('.stat-value').innerText())
      .toBe('2')
    await expect.poll(() => card('Toplam kesin kayıt').locator('.stat-value').innerText()).toBe('1')
    await expect(card('Toplam kesin kayıt')).toContainText('5 adaydan %20 kesin kayıt')

    await card('Bugünkü tanışma görüşmesi').getByRole('link').click()
    await expect(page).toHaveURL(/\/onburo\/deneme-dersi-takvimi\?gorunum=hafta/)
    const calendar = page.getByRole('list', { name: 'Haftalık görüşme takvimi' })
    await expect(calendar).toContainText('Bugün Bir')
    await expect(calendar).not.toContainText('Bugün Vazgeçen')

    await page.goto('/onburo/dashboard')
    await card('Toplam kesin kayıt').getByRole('link').click()
    await expect(page).toHaveURL(/\/onburo\/adaylar\?asama=/)
    await expect(resultCount(page)).toContainText('1–1 / 1 kayıt')
  })
})
