import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant, TenantOptions, TenantUser } from './support/tenant.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// Şikayet & Talep (veli), Şikayet & Talepler (ön büro) ve İzin & Mazeret (veli): okuma ve yazma.
// Yazma uçları `POST /requests`, `PATCH /requests/:id`, `POST /absences`; veli yeni talep ve izin
// bildirimi formlarını sağ panelde açar, ön büro talep panelinde durum/birim/yanıt yazar.
// Seed izin kayıtları kategorisi olmayan eski biçimdedir (tür + açıklama). Seed talepleri: req1
// (Deniz, İnceleniyor), req2 (Ece, Yeni), req3 (s3, Çözüldü). Okuma testleri seed kurumunu
// kullanır; veri yazan testler ve izin kayıtları `tenant` ile kendi kurumunu kurar.

const REQUESTS_TABLE = 'Taleplerim'
const FRONT_OFFICE_TABLE = 'Şikayet ve talepler'
const ABSENCES_TABLE = 'Bildirim geçmişi'
const DENIZ_REQUEST = 'Okul servisi güzergâhı'
const ECE_REQUEST = 'Sınıfın havalandırılması'
const OTHER_REQUEST = 'Materyal desteği'
const DENIZ_REASON = 'Doktor kontrolü için izin.'
const ECE_REASON = 'Ailevi nedenle seyahat.'
const OTHER_REASON = 'Başka öğrencinin mazereti.'

const rowsOf = (page: Page, table: string) =>
  page.getByRole('table', { name: table }).locator('tbody tr')
const links = (page: Page, table: string) =>
  page.getByRole('table', { name: table }).getByRole('button')

function absenceRecord(id: string, studentId: string, reason: string, startDate: string) {
  return {
    collection: 'absences' as const,
    data: {
      id,
      studentId,
      startDate,
      endDate: startDate,
      category: 'Sağlık',
      reason,
      status: 'İletildi',
      date: '2026-10-20T08:00:00.000Z',
    },
  }
}

async function absenceTenant(tenant: (options: TenantOptions) => Promise<Tenant>) {
  return tenant({
    roles: ['yonetici', 'onburo', 'veli'],
    students: ['s3'],
    collections: ['requests'],
    records: [
      absenceRecord('e2e-absence-s1', 's1', DENIZ_REASON, '2026-11-10'),
      absenceRecord('e2e-absence-s2', 's2', ECE_REASON, '2026-11-11'),
      absenceRecord('e2e-absence-s3', 's3', OTHER_REASON, '2026-11-12'),
    ],
  })
}

interface ModuleSettings {
  data: { version: number }
}

/** Yönetici adına modülü kapatır (kurum ayarının sürümü okunur, `If-Match` ile gönderilir). */
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

test.describe('veli: şikayet ve talep', () => {
  test('veli seçili çocuğun taleplerini görür; başka öğrencinin talebi görünmez', async ({
    page,
    loginAs,
    api,
  }) => {
    await loginAs('veli')
    await page.goto('/veli/sikayet-talep?cocuk=s1')
    await expect(page.getByRole('heading', { name: 'Şikayet & Talep', level: 1 })).toBeVisible()
    await expectEveryRow(rowsOf(page, REQUESTS_TABLE), DENIZ_REQUEST)
    await expect(page.getByText(ECE_REQUEST)).toHaveCount(0)
    await expect(page.getByText(OTHER_REQUEST)).toHaveCount(0)

    await expect(page.getByRole('button', { name: 'Yeni talep' })).toBeVisible()

    await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
    await expect(page).toHaveURL(/[?&]cocuk=s2/)
    await expectEveryRow(rowsOf(page, REQUESTS_TABLE), ECE_REQUEST)
    await expect(page.getByText(DENIZ_REQUEST)).toHaveCount(0)

    // Sunucu da kapsamı daraltır: başka öğrencinin talebi listede yok, tek kayıt ucu 404.
    const parent = await api('veli')
    const list = await parent.get('/api/v1/collections/requests?pageSize=100')
    expect(list.status).toBe(200)
    const ids = (list.body as { data: { id: string }[] }).data.map((row) => row.id).sort()
    expect(ids).toEqual(['req1', 'req2'])
    expect((await parent.get('/api/v1/collections/requests/req3')).status).toBe(404)
  })

  test('satırdan sağ panel açılır, geri düğmesi kapatır; başkasının kaydı bulunamadı der', async ({
    page,
    loginAs,
  }) => {
    await loginAs('veli')
    await page.goto('/veli/sikayet-talep?cocuk=s1')
    await links(page, REQUESTS_TABLE).filter({ hasText: DENIZ_REQUEST }).click()
    const panel = page.getByRole('dialog', { name: 'Talep ayrıntısı' })
    await expect(panel.getByText('Servis durağının evimize daha yakın')).toBeVisible()
    await expect(panel.getByText('İnceleniyor')).toBeVisible()
    await expect(panel.getByText('Ön büro', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/[?&]talep=req1/)

    await page.goBack()
    await expect(panel).toBeHidden()
    // Panel kapanınca odak tetikleyen satıra döner.
    await expect(links(page, REQUESTS_TABLE).filter({ hasText: DENIZ_REQUEST })).toBeFocused()

    await page.goto('/veli/sikayet-talep?cocuk=s1&talep=req3')
    await expect(
      page.getByRole('dialog', { name: 'Talep ayrıntısı' }).getByText('Kayıt bulunamadı'),
    ).toBeVisible()
  })

  test('veli listede durumu süzer ve filtre adreste kalır', async ({ page, loginAs }) => {
    await loginAs('veli')
    await page.goto('/veli/sikayet-talep?cocuk=s1')
    await expectEveryRow(rowsOf(page, REQUESTS_TABLE), DENIZ_REQUEST)
    await page.getByLabel('Talep durumu').selectOption('Yeni')
    await expect(page).toHaveURL(/[?&]durum=Yeni/)
    await expect(page.getByText('Henüz talep göndermediniz.')).toHaveCount(0)
    await expect(page.getByText('Aramanızla eşleşen kayıt bulunamadı.')).toBeVisible()
    await expect(page.getByText(DENIZ_REQUEST)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' })).toBeVisible()
    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).click()
    await expectEveryRow(rowsOf(page, REQUESTS_TABLE), DENIZ_REQUEST)
  })
})

test.describe('ön büro: şikayet ve talepler', () => {
  test('ön büro bütün talepleri görür, durum ve türe göre süzer, ayrıntıyı açar', async ({
    page,
    loginAs,
  }) => {
    await loginAs('onburo')
    await page.goto('/onburo/talepler')
    await expect(page.getByRole('heading', { name: 'Şikayet & Talepler', level: 1 })).toBeVisible()
    await expect(rowsOf(page, FRONT_OFFICE_TABLE)).toHaveCount(3)

    await page.getByLabel('Talep durumu').selectOption('Çözüldü')
    await expect(page).toHaveURL(/[?&]durum=%C3%87%C3%B6z%C3%BCld%C3%BC|[?&]durum=Çözüldü/)
    await expectEveryRow(rowsOf(page, FRONT_OFFICE_TABLE), OTHER_REQUEST)
    await expect(rowsOf(page, FRONT_OFFICE_TABLE)).toHaveCount(1)

    await page.getByLabel('Talep durumu').selectOption('all')
    await page.getByLabel('Bildirim türü').selectOption('Şikayet')
    await expectEveryRow(rowsOf(page, FRONT_OFFICE_TABLE), ECE_REQUEST)

    await links(page, FRONT_OFFICE_TABLE).filter({ hasText: ECE_REQUEST }).click()
    const panel = page.getByRole('dialog', { name: 'Talep ayrıntısı' })
    await expect(panel.locator('dd', { hasText: 'Akademik koordinatör' })).toBeVisible()
    await expect(panel.getByLabel('Durum')).toHaveValue('Yeni')
    // Ön büro talebi güncelleyebilir; yeni talep açma düğmesi yalnız velidedir.
    await expect(panel.getByRole('form', { name: 'Talebi güncelle' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Yeni talep' })).toHaveCount(0)
  })

  test('ön büro izin ve mazeret kayıtlarını okuyamaz (DOM-ILT-053)', async ({ api }) => {
    const frontOffice = await api('onburo')
    expect((await frontOffice.get('/api/v1/collections/absences')).status).toBe(403)
  })
})

test.describe('veli: izin ve mazeret', () => {
  test('veli seçili çocuğun bildirim geçmişini görür; başka öğrencinin bildirimi görünmez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await absenceTenant(tenant)
    await loginAs(school.user('veli'))
    await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1')
    await expect(page.getByRole('heading', { name: 'İzin & Mazeret', level: 1 })).toBeVisible()
    await expectEveryRow(rowsOf(page, ABSENCES_TABLE), DENIZ_REASON)
    await expect(page.getByText(ECE_REASON)).toHaveCount(0)
    await expect(page.getByText(OTHER_REASON)).toHaveCount(0)

    await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
    await expectEveryRow(rowsOf(page, ABSENCES_TABLE), ECE_REASON)

    const parent = await api(school.user('veli'))
    const list = await parent.get('/api/v1/collections/absences?pageSize=100')
    expect(list.status).toBe(200)
    const ids = (list.body as { data: { id: string }[] }).data.map((row) => row.id).sort()
    expect(ids).toEqual(['e2e-absence-s1', 'e2e-absence-s2'])
    expect((await parent.get('/api/v1/collections/absences/e2e-absence-s3')).status).toBe(404)
  })

  test('satırdan sağ panel açılır; başkasının kaydı bulunamadı der; kayıt yoksa boş durum', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await absenceTenant(tenant)
    await loginAs(school.user('veli'))
    await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1')
    await links(page, ABSENCES_TABLE).filter({ hasText: 'Sağlık' }).click()
    const panel = page.getByRole('dialog', { name: 'Bildirim ayrıntısı' })
    await expect(panel.getByText(DENIZ_REASON)).toBeVisible()
    await expect(panel.getByText('10 Kas 2026')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1&bildirim=e2e-absence-s3')
    await expect(page.getByRole('dialog', { name: 'Bildirim ayrıntısı' })).toContainText(
      'Kayıt bulunamadı',
    )
  })

  test('bildirimi olmayan kurumda dürüst boş durum gösterilir', async ({ page, loginAs }) => {
    await loginAs('veli')
    await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1')
    await expect(page.getByText('Henüz izin bildirimi yok.')).toBeVisible()
  })
})

test.describe('modül kapalıyken', () => {
  test('iletişim modülü kapanınca talep sayfası ve ucu kapanır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'onburo', 'veli'],
      collections: ['requests'],
    })
    const admin = await api(school.user('yonetici'))
    const parent = await api(school.user('veli'))
    expect((await parent.get('/api/v1/collections/requests')).status).toBe(200)

    await closeModule(admin, 'communication')
    await loginAs(school.user('veli'))
    await page.goto('/veli/sikayet-talep?cocuk=s1')
    await expect(page.getByText('Bu modül kurum ayarlarından kapatılmış.')).toBeVisible()
    await expect(page).toHaveURL(/\/veli\/dashboard/)
    expect((await parent.get('/api/v1/collections/requests')).status).toBe(403)
  })

  test('akademik modül kapanınca izin sayfası ve ucu kapanır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await absenceTenant(tenant)
    const admin = await api(school.user('yonetici'))
    const parent = await api(school.user('veli'))
    expect((await parent.get('/api/v1/collections/absences')).status).toBe(200)

    await closeModule(admin, 'academic')
    await loginAs(school.user('veli'))
    await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1')
    await expect(page.getByText('Bu modül kurum ayarlarından kapatılmış.')).toBeVisible()
    await expect(page).toHaveURL(/\/veli\/dashboard/)
    expect((await parent.get('/api/v1/collections/absences')).status).toBe(403)
  })
})

test.describe('390 px genişlik', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('veli talep ve izin sayfaları ile paneller yatay taşmaz', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await absenceTenant(tenant)
    await loginAs(school.user('veli'))
    await page.goto('/veli/sikayet-talep?cocuk=s1')
    await expect(page.getByText(DENIZ_REQUEST).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByText(DENIZ_REQUEST).first().click()
    await expect(page.getByRole('dialog', { name: 'Talep ayrıntısı' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1')
    await expect(page.getByText('Sağlık').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByText('Sağlık').first().click()
    await expect(page.getByRole('dialog', { name: 'Bildirim ayrıntısı' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('ön büro talep listesi yatay taşmaz', async ({ page, loginAs }) => {
    await loginAs('onburo')
    await page.goto('/onburo/talepler')
    await expect(page.getByText(DENIZ_REQUEST).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

// --- Yazma ---------------------------------------------------------------------------------------

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

interface RequestRow {
  id: string
  version: number
  record: {
    title: string
    status: string
    assignedTo: string
    replies?: { text: string }[]
  }
}

async function requestRows(client: ApiClient): Promise<RequestRow[]> {
  const result = await client.get('/api/v1/collections/requests?pageSize=100')
  expect(result.status).toBe(200)
  return (result.body as { data: RequestRow[] }).data
}

const requestNamed = async (client: ApiClient, title: string) => {
  const row = (await requestRows(client)).find((item) => item.record.title === title)
  expect(row, title).toBeDefined()
  return row as RequestRow
}

const requestById = async (client: ApiClient, id: string) => {
  const row = (await requestRows(client)).find((item) => item.id === id)
  expect(row, id).toBeDefined()
  return row as RequestRow
}

interface Fixtures {
  page: Page
  loginAs: (principal: TenantUser) => Promise<Page>
  api: (principal: TenantUser) => Promise<ApiClient>
  tenant: (options: TenantOptions) => Promise<Tenant>
}

/** Kendi kurumu: veli (Deniz s1, Ece s2), ön büro ve yönetici; seed talepleri req1/req2. */
const writeTenant = (tenant: (options: TenantOptions) => Promise<Tenant>) =>
  tenant({ roles: ['yonetici', 'onburo', 'veli'], collections: ['requests'] })

/** Bugünden `days` gün sonrası (`YYYY-MM-DD`); e2e gerçek saati kullanır. */
const dayFromToday = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

const commandHeaders = () => ({ 'idempotency-key': randomUUID() })

test.describe('talep yazma', () => {
  test('veli talep açar; ön büro görür, inceler, yanıtlar, çözer; veli yanıtı görür (DOM-ILT-080)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await writeTenant(tenant)
    const title = 'E2E servis durağı talebi'
    const text = 'Durağın evimize daha yakın olmasını rica ederiz.'

    // Veli: yeni talep sağ panelde açılır.
    await loginAs(school.user('veli'))
    await page.goto('/veli/sikayet-talep?cocuk=s1')
    await page.getByRole('button', { name: 'Yeni talep' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni talep' })
    await expect(form.getByLabel('Öğrenci')).toHaveValue('s1')
    await form.getByRole('button', { name: 'Talebi gönder' }).click()
    // Boş form: Türkçe alan hataları, istek atılmaz.
    await expect(form.getByText('Konuyu yazın.')).toBeVisible()
    await expect(form.getByText('En az iki karakter girin.')).toBeVisible()

    await form.getByLabel('Bildirim türü').selectOption('Öneri')
    await form.getByLabel('Konu').fill(title)
    await form.getByLabel('Açıklama').fill(text)
    await form.getByRole('button', { name: 'Talebi gönder' }).click()
    await expect(toast(page, 'Talebiniz ön büroya iletildi.')).toBeVisible()
    await expect(form).toBeHidden()
    await expect(links(page, REQUESTS_TABLE).filter({ hasText: title })).toBeVisible()

    const parent = await api(school.user('veli'))
    const created = await requestNamed(parent, title)
    expect(created.record).toMatchObject({ status: 'Yeni', assignedTo: 'Ön büro' })

    // Ön büro: talebi görür, incelemeye alır ve ilgili birimi değiştirir.
    await page.context().clearCookies()
    await loginAs(school.user('onburo'))
    await page.goto('/onburo/talepler')
    await links(page, FRONT_OFFICE_TABLE).filter({ hasText: title }).click()
    const panel = page.getByRole('dialog', { name: 'Talep ayrıntısı' })
    const update = panel.getByRole('form', { name: 'Talebi güncelle' })
    await expect(panel.getByText(text)).toBeVisible()
    // Ele alınmamış talepte tüm durumlar sunulur; boş güncelleme istek atmaz.
    await expect(update.getByLabel('Durum').locator('option')).toHaveText([
      'Yeni',
      'İnceleniyor',
      'Çözüldü',
    ])
    await update.getByRole('button', { name: 'Kaydet' }).click()
    await expect(update.getByText(/Değişiklik yok/)).toBeVisible()
    expect((await requestNamed(parent, title)).version).toBe(created.version)

    await update.getByLabel('Durum').selectOption('İnceleniyor')
    await update.getByLabel('İlgili birim').selectOption('Akademik koordinatör')
    await update.getByRole('button', { name: 'Kaydet' }).click()
    await expect(toast(page, 'Talep güncellendi.')).toBeVisible()
    await expect
      .poll(async () => (await requestNamed(parent, title)).record)
      .toMatchObject({ status: 'İnceleniyor', assignedTo: 'Akademik koordinatör' })
    // İncelemedeki talep "Yeni"ye döndürülemez: seçenek yoktur.
    await expect(update.getByLabel('Durum').locator('option')).toHaveText([
      'İnceleniyor',
      'Çözüldü',
    ])

    // Yanıt yazar ve çözer.
    const reply = 'Durak değişikliği için servis firmasıyla görüşüldü.'
    await update.getByLabel('Yanıt').fill(reply)
    await update.getByLabel('Durum').selectOption('Çözüldü')
    await update.getByRole('button', { name: 'Kaydet' }).click()
    await expect(panel.getByText(reply)).toBeVisible()
    await expect(update.getByLabel('Yanıt')).toHaveValue('')
    await expect
      .poll(async () => (await requestNamed(parent, title)).record)
      .toMatchObject({ status: 'Çözüldü', replies: [{ text: reply }] })

    // Çözülen talepte durumu açmadan yanıt yazılamaz: hata durum alanının altında, toast yok.
    await update.getByLabel('Yanıt').fill('Ek not.')
    await update.getByRole('button', { name: 'Kaydet' }).click()
    await expect(update.getByText(/önce durumu "İnceleniyor" yapın/)).toBeVisible()
    await expect(toast(page, /önce durumu/)).toHaveCount(0)

    // Veli yanıtı talepte görür; güncelleme formu yoktur.
    await page.context().clearCookies()
    await loginAs(school.user('veli'))
    await page.goto('/veli/sikayet-talep?cocuk=s1')
    await links(page, REQUESTS_TABLE).filter({ hasText: title }).click()
    const detail = page.getByRole('dialog', { name: 'Talep ayrıntısı' })
    await expect(detail.getByText(reply)).toBeVisible()
    await expect(detail.getByText('Çözüldü', { exact: true })).toBeVisible()
    await expect(detail.getByRole('form', { name: 'Talebi güncelle' })).toHaveCount(0)
  })

  test('başka biri talebi değiştirdiyse Türkçe uyarı çıkar, kayıt tazelenir, yanıt korunur', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await writeTenant(tenant)
    const frontOffice = await api(school.user('onburo'))
    const before = await requestById(frontOffice, 'req2')
    expect(before.record.status).toBe('Yeni')

    await loginAs(school.user('onburo'))
    await page.goto('/onburo/talepler?talep=req2')
    const panel = page.getByRole('dialog', { name: 'Talep ayrıntısı' })
    const update = panel.getByRole('form', { name: 'Talebi güncelle' })
    await expect(update.getByLabel('Durum')).toHaveValue('Yeni')

    // Form açıkken başka bir ön büro kullanıcısı talebi incelemeye alır.
    const other = await frontOffice.context.patch('/api/v1/requests/req2', {
      data: { status: 'İnceleniyor' },
      headers: { ...commandHeaders(), 'if-match': `"${before.version}"` },
    })
    expect(other.status()).toBe(200)

    await update.getByLabel('Yanıt').fill('İnceliyoruz, bilgi vereceğiz.')
    await update.getByRole('button', { name: 'Kaydet' }).click()
    await expect(toast(page, 'Talep başka biri tarafından güncellendi')).toBeVisible()
    // Talep tazelendi: durum güncel, yazılan yanıt korundu ve hiçbir şey ezilmedi.
    await expect(update.getByLabel('Durum')).toHaveValue('İnceleniyor')
    await expect(update.getByLabel('Yanıt')).toHaveValue('İnceliyoruz, bilgi vereceğiz.')
    expect((await requestById(frontOffice, 'req2')).record.replies ?? []).toHaveLength(0)

    await update.getByRole('button', { name: 'Kaydet' }).click()
    await expect(toast(page, 'Talep güncellendi.')).toBeVisible()
    await expect
      .poll(async () => (await requestById(frontOffice, 'req2')).record.replies?.length)
      .toBe(1)
  })

  /**
   * Ön büro A formu açıkken B birimi değiştirir; A'nın sorgusu 30 sn eskidikten sonra odak dönüşüyle
   * sessizce tazelenir (`If-Match` sürümü sorgudan taze gelir, form eski değeri tutar). B'nin değişikliği
   * 409 olmadan geri alınmamalıdır.
   */
  async function openStaleRequest({ page, loginAs, api, tenant }: Fixtures, typeReply: boolean) {
    const school = await writeTenant(tenant)
    const other = await api(school.user('onburo'))
    const before = await requestById(other, 'req2')
    expect(before.record.assignedTo).toBe('Akademik koordinatör')

    await page.clock.install()
    await loginAs(school.user('onburo'))
    await page.goto('/onburo/talepler?talep=req2')
    const panel = page.getByRole('dialog', { name: 'Talep ayrıntısı' })
    const update = panel.getByRole('form', { name: 'Talebi güncelle' })
    await expect(update.getByLabel('İlgili birim')).toHaveValue('Akademik koordinatör')
    if (typeReply) await update.getByLabel('Yanıt').fill('Yalnız yanıt yazıyorum.')

    // B: ilgili birimi değiştirir.
    const changed = await other.context.patch('/api/v1/requests/req2', {
      data: { assignedTo: 'Finans birimi' },
      headers: { ...commandHeaders(), 'if-match': `"${before.version}"` },
    })
    expect(changed.status()).toBe(200)

    // A sekmeye döner: sorgu bayat sayılır ve arkadan tazelenir.
    const refetched = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/collections/requests/req2') &&
        response.request().method() === 'GET',
    )
    await page.clock.fastForward(60_000)
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
    await refetched
    await expect(panel.locator('dd', { hasText: 'Finans birimi' })).toBeVisible()
    return { panel, update, other }
  }

  test('sorgu arkadan tazelense de kirlenmemiş form yeni kayda geçer ve B’nin değişikliği korunur', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const { update, other } = await openStaleRequest({ page, loginAs, api, tenant }, false)
    await expect(update.getByLabel('İlgili birim')).toHaveValue('Finans birimi')
    await update.getByLabel('Yanıt').fill('Finans birimine yönlendirildi.')
    await update.getByRole('button', { name: 'Kaydet' }).click()
    await expect(toast(page, 'Talep güncellendi.')).toBeVisible()
    const row = await requestById(other, 'req2')
    expect(row.record.assignedTo).toBe('Finans birimi')
    expect(row.record.replies).toHaveLength(1)
  })

  test('DOM-ILT-080: kirli form eski sürümle gider, sunucu 409 verir ve B’nin birim değişikliği geri alınmaz', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const { update, other } = await openStaleRequest({ page, loginAs, api, tenant }, true)
    // Form eski değeri tutar; sessizce yeni değere geçmez.
    await expect(update.getByLabel('İlgili birim')).toHaveValue('Akademik koordinatör')
    await update.getByRole('button', { name: 'Kaydet' }).click()
    await expect(toast(page, 'Talep başka biri tarafından güncellendi')).toBeVisible()
    // Hiçbir şey ezilmedi: birim B'nin değeri, yanıt yazılmadı.
    const row = await requestById(other, 'req2')
    expect(row.record.assignedTo).toBe('Finans birimi')
    expect(row.record.replies ?? []).toHaveLength(0)
    // Form güncel kayda döndü, yazılan yanıt korundu; yeniden gönderim yeni sürümle geçer.
    await expect(update.getByLabel('İlgili birim')).toHaveValue('Finans birimi')
    await expect(update.getByLabel('Yanıt')).toHaveValue('Yalnız yanıt yazıyorum.')
    await update.getByRole('button', { name: 'Kaydet' }).click()
    await expect(toast(page, 'Talep güncellendi.')).toBeVisible()
    const after = await requestById(other, 'req2')
    expect(after.record.assignedTo).toBe('Finans birimi')
    expect(after.record.replies).toHaveLength(1)
  })

  test('yetkisiz roller formu görmez ve uçlar kapalıdır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await writeTenant(tenant)
    await loginAs(school.user('onburo'))
    await page.goto('/onburo/talepler')
    await expect(page.getByRole('heading', { name: 'Şikayet & Talepler', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /yeni talep/i })).toHaveCount(0)

    // Veli talebi okur ama güncelleme formu çizilmez.
    await page.context().clearCookies()
    await loginAs(school.user('veli'))
    await page.goto('/veli/sikayet-talep?cocuk=s1&talep=req1')
    const panel = page.getByRole('dialog', { name: 'Talep ayrıntısı' })
    await expect(panel.getByText('Servis durağının evimize daha yakın')).toBeVisible()
    await expect(panel.getByRole('form', { name: 'Talebi güncelle' })).toHaveCount(0)

    const parent = await api(school.user('veli'))
    const denied = await parent.context.patch('/api/v1/requests/req1', {
      data: { status: 'Çözüldü' },
      headers: { ...commandHeaders(), 'if-match': '"1"' },
    })
    expect(denied.status()).toBe(403)
    const frontOffice = await api(school.user('onburo'))
    const opened = await frontOffice.post(
      '/api/v1/requests',
      { studentId: 's1', category: 'Talep', title: 'Yetkisiz', text: 'Yetkisiz talep.' },
      commandHeaders(),
    )
    expect(opened.status).toBe(403)
    // Ön büro izin bildirimi de açamaz (DOM-ILT-053).
    const day = dayFromToday(30)
    const notice = await frontOffice.post(
      '/api/v1/absences',
      { studentId: 's1', startDate: day, endDate: day, reasonCategory: 'other' },
      commandHeaders(),
    )
    expect(notice.status).toBe(403)
  })
})

test.describe('izin ve mazeret yazma', () => {
  test('veli izin bildirir; gerekçe yalnız kategoridir ve listede görünür (DOM-ILT-053)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await writeTenant(tenant)
    const start = dayFromToday(30)
    const end = dayFromToday(31)
    await loginAs(school.user('veli'))
    await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1')
    await page.getByRole('button', { name: 'Yeni bildirim' }).click()
    const form = page.getByRole('dialog', { name: 'İzin veya mazeret bildir' })
    await expect(form.getByLabel('Öğrenci')).toHaveValue('s1')
    await expect(form.getByLabel('Gerekçe').locator('option')).toHaveText([
      'Seçin',
      'Sağlık nedeniyle',
      'Ailevi neden',
      'Resmi işlem',
      'Diğer',
    ])
    // Öğrenci seçimi yalnız velinin kendi çocuklarını listeler (Ayşe Yılmaz: Deniz ve Ece).
    await expect(form.getByLabel('Öğrenci').locator('option')).toHaveText([
      'Deniz Yılmaz',
      'Ece Yılmaz',
    ])
    // KVKK: serbest açıklama alanı yoktur.
    await expect(form.locator('textarea')).toHaveCount(0)
    await expect(form.getByLabel(/açıklama|neden|not/i)).toHaveCount(0)

    await form.getByRole('button', { name: 'Bildir' }).click()
    await expect(form.getByText('Gerekçe kategorisini seçin.')).toBeVisible()
    await expect(form.getByText('Geçerli bir tarih seçin.').first()).toBeVisible()

    await form.getByLabel('Başlangıç tarihi').fill(start)
    await form.getByLabel('Bitiş tarihi').fill(end)
    await form.getByLabel('Gerekçe').selectOption('health')
    await form.getByRole('button', { name: 'Bildir' }).click()
    await expect(toast(page, 'Bildiriminiz kuruma iletildi.')).toBeVisible()
    await expect(form).toBeHidden()
    await expect(links(page, ABSENCES_TABLE).filter({ hasText: 'Sağlık nedeniyle' })).toBeVisible()

    const parent = await api(school.user('veli'))
    const list = await parent.get('/api/v1/collections/absences?pageSize=100')
    const rows = (list.body as { data: { record: Record<string, unknown> }[] }).data
    expect(rows).toHaveLength(1)
    expect(rows[0]?.record).toMatchObject({
      studentId: 's1',
      startDate: start,
      endDate: end,
      reasonCategory: 'health',
      status: 'İletildi',
    })
    expect(rows[0]?.record).not.toHaveProperty('reason')
  })

  test('geç mazeret ve örtüşen bildirim hatası tarih alanının altında görünür, toast çıkmaz', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await writeTenant(tenant)
    const parent = await api(school.user('veli'))
    const start = dayFromToday(40)
    const first = await parent.post(
      '/api/v1/absences',
      { studentId: 's1', startDate: start, endDate: start, reasonCategory: 'family' },
      commandHeaders(),
    )
    expect(first.status).toBe(201)

    await loginAs(school.user('veli'))
    await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1')
    await page.getByRole('button', { name: 'Yeni bildirim' }).click()
    const form = page.getByRole('dialog', { name: 'İzin veya mazeret bildir' })

    // Geç mazeret: pencere (3 veya 5 iş günü) çoktan kapanmıştır.
    await form.getByLabel('Başlangıç tarihi').fill('2025-01-06')
    await form.getByLabel('Bitiş tarihi').fill('2025-01-07')
    await form.getByLabel('Gerekçe').selectOption('official')
    await form.getByRole('button', { name: 'Bildir' }).click()
    await expect(form.getByText(/iş günü içinde bildirilebilir/)).toBeVisible()
    await expect(form.getByLabel('Bitiş tarihi')).toHaveAttribute('aria-invalid', 'true')
    await expect(toast(page, /iş günü/)).toHaveCount(0)

    // Örtüşme: başlangıç alanının altında.
    await form.getByLabel('Başlangıç tarihi').fill(start)
    await form.getByLabel('Bitiş tarihi').fill(start)
    await form.getByRole('button', { name: 'Bildir' }).click()
    await expect(form.getByText('Bu tarih aralığında zaten bir bildirim var.')).toBeVisible()
    await expect(form.getByLabel('Başlangıç tarihi')).toHaveAttribute('aria-invalid', 'true')
    await expect(toast(page, /zaten bir bildirim/)).toHaveCount(0)

    // Hiçbiri kaydedilmedi.
    const list = await parent.get('/api/v1/collections/absences?pageSize=100')
    expect((list.body as { data: unknown[] }).data).toHaveLength(1)
  })

  test('formlar 390 px genişlikte yatay taşmaz', async ({ page, loginAs, tenant }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const school = await writeTenant(tenant)
    await loginAs(school.user('veli'))
    await page.goto('/veli/sikayet-talep?cocuk=s1')
    await page.getByRole('button', { name: 'Yeni talep' }).click()
    await expect(page.getByRole('dialog', { name: 'Yeni talep' }).getByLabel('Konu')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1')
    await page.getByRole('button', { name: 'Yeni bildirim' }).click()
    await expect(
      page.getByRole('dialog', { name: 'İzin veya mazeret bildir' }).getByLabel('Gerekçe'),
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
