import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant, TenantOptions } from './support/tenant.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// Şikayet & Talep (veli), Şikayet & Talepler (ön büro) ve İzin & Mazeret (veli). Bu sayfalar yalnız
// okur: core'da ve API'de `requests`/`absences` yazan komut yok (TODO(api-request-write),
// TODO(api-absence-write)); talep açma, durum değiştirme, yanıt ve izin bildirme senaryoları uç
// gelince eklenir. Seed talepleri: req1 (Deniz, İnceleniyor), req2 (Ece, Yeni), req3 (s3, Çözüldü).
// Okuma testleri seed kurumunu kullanır; izin kayıtları seed'de olmadığından `tenant` ile kurulur.

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

    // Eksik uç dürüstçe söylenir; çalışmayan düğme çizilmez.
    await expect(page.getByRole('note')).toContainText('yeni talep gönderme hazırlanıyor')
    await expect(
      page.getByRole('button', { name: /talep gönder|yeni talep|bildirimi gönder/i }),
    ).toHaveCount(0)

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
    await expect(page.getByRole('note')).toContainText('yanıt yazma hazırlanıyor')

    await page.getByLabel('Talep durumu').selectOption('Çözüldü')
    await expect(page).toHaveURL(/[?&]durum=%C3%87%C3%B6z%C3%BCld%C3%BC|[?&]durum=Çözüldü/)
    await expectEveryRow(rowsOf(page, FRONT_OFFICE_TABLE), OTHER_REQUEST)
    await expect(rowsOf(page, FRONT_OFFICE_TABLE)).toHaveCount(1)

    await page.getByLabel('Talep durumu').selectOption('all')
    await page.getByLabel('Bildirim türü').selectOption('Şikayet')
    await expectEveryRow(rowsOf(page, FRONT_OFFICE_TABLE), ECE_REQUEST)

    await links(page, FRONT_OFFICE_TABLE).filter({ hasText: ECE_REQUEST }).click()
    const panel = page.getByRole('dialog', { name: 'Talep ayrıntısı' })
    await expect(panel.getByText('Akademik koordinatör')).toBeVisible()
    await expect(panel.getByText('Yeni', { exact: true })).toBeVisible()
    // Ön büro yalnız okur: durum güncelleme formu çizilmez.
    await expect(panel.getByRole('button', { name: /güncelle|yanıt/i })).toHaveCount(0)
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
    await expect(page.getByRole('note')).toContainText('izin ve mazeret bildirimi hazırlanıyor')

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
