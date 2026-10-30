import { randomUUID } from 'node:crypto'

import type { Locator, Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant, TenantOptions, TenantUser } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Randevu ekranları: öğrenci "Etüt Randevusu" (`randevu-talep`), veli "Randevu & Mesajlar" sayfasının
// Randevular sekmesi ve öğretmen "Etüt & Görüşmeler" (`randevular`); DOM-ILT-100…105. Yazma uçları
// `POST /appointments`, `PATCH /appointments/:id`, saatler `GET /appointments/slots`. Her test kendi
// kurumunu kurar; uygunluk saatleri ve randevular API ya da kurulum kaydıyla hazırlanır (kurulum
// UI'dan yapılmaz). Saat dilimi sabit: 10:00Z İstanbul'da 13:00'tür.

type Make = (options: TenantOptions) => Promise<Tenant>

interface Fixtures {
  page: Page
  loginAs: (principal: TenantUser) => Promise<Page>
  api: (principal: TenantUser) => Promise<ApiClient>
  tenant: Make
}

const DAY = 86_400_000
/** Bugünden `days` gün sonra, UTC `hour`:00. Test kurulumunda hesaplanır; gelecekte kalır. */
const at = (days: number, hour: number) => {
  const base = new Date(Date.now() + days * DAY)
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour),
  ).toISOString()
}

const NOTE = 'Denklem kurma problemlerini tekrar etmek istiyorum.'
const REASON = 'O gün okul gezisi nedeniyle müsait değilim.'
const CHANGED = 'Randevu başka biri tarafından güncellendi. Güncel hâlini yükleyip yeniden deneyin.'
const HIDDEN_CONFLICT = 'Bu saat uygun değil.'
const STUDENT_TABLE = 'Randevularım'
const TEACHER_TABLE = 'Talepler ve randevular'

const slot = (id: string, teacherId: string, date: string) => ({
  collection: 'availability' as const,
  data: { id, teacherId, date, duration: 30 },
})

/**
 * Beş rollü kurum. Öğretmen t1 (Selin Kaya) iki çocuğun sınıfına da girer; Nilüfer Tan yalnız
 * Ece'nin sınıfına (c2) atanmıştır, böylece veli çocuklar arasında geçince saat listesi değişir.
 * t1 saatleri: `slot-a` 13:00, `slot-b` 14:00 (üç gün sonra), `slot-held` dört gün sonra 15:00 ve
 * başka bir velinin bekleyen talebi tutar ("Dolu"). Nilüfer'in `slot-c2` saati üç gün sonra 13:00.
 */
const appointmentTenant = (tenant: Make) =>
  tenant({
    roles: ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'],
    records: [
      {
        collection: 'teachers',
        data: {
          id: 'e2e-t-c2',
          name: 'Nilüfer Tan',
          subjectId: 'math',
          subject: 'Matematik',
          branchId: 'b1',
          email: 'e2e-nilufer.tan@kampus.example',
          phone: '05551000098',
          attendanceRate: 100,
          homeworkRate: 100,
          isActive: true,
          deletedAt: null,
        },
      },
      {
        collection: 'assignments',
        data: { id: 'e2e-assign-c2', classId: 'c2', subjectId: 'math', teacherId: 'e2e-t-c2' },
      },
      slot('slot-a', 't1', at(3, 10)),
      slot('slot-b', 't1', at(3, 11)),
      slot('slot-held', 't1', at(4, 12)),
      slot('slot-c2', 'e2e-t-c2', at(3, 10)),
      {
        collection: 'appointments',
        data: {
          id: 'e2e-apt-held',
          studentId: 's2',
          teacherId: 't1',
          date: at(4, 12),
          duration: 30,
          slotId: 'slot-held',
          type: 'Veli görüşmesi',
          note: 'Başka bir velinin görüşmesi.',
          status: 'Bekliyor',
          requestedBy: { role: 'veli', userId: 'e2e-baska-veli' },
          createdAt: new Date().toISOString(),
        },
      },
    ],
  })

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const rowButton = (page: Page, who: string, hour: string) =>
  page.getByRole('button', { name: new RegExp(`${who} ile .*${hour} randevusunu aç`) })
const radio = (scope: Locator, time: string) => scope.getByRole('radio', { name: new RegExp(time) })

interface AppointmentItem {
  id: string
  version: number
  record: {
    studentId: string
    teacherId: string
    slotId?: string
    type: string
    note: string
    status: string
    requestedBy?: { role: string }
    history?: { status: string; reason?: string }[]
  }
}

async function appointmentById(client: ApiClient, id: string): Promise<AppointmentItem> {
  const result = await client.get(`/api/v1/collections/appointments/${id}`)
  expect(result.status).toBe(200)
  return (result.body as { data: AppointmentItem }).data
}

/** Kullanıcı adına randevu talep eder; yeni randevunun kimliğini döndürür. */
async function book(
  client: ApiClient,
  body: { studentId: string; slotId: string; type?: string; note?: string },
): Promise<string> {
  const result = await client.post(
    '/api/v1/appointments',
    { note: NOTE, ...body },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status).toBe(201)
  return (result.body as { data: { entity: { id: string } } }).data.entity.id
}

/** Durum değişikliği; randevunun okunan sürümü `If-Match` olarak gider. */
async function change(client: ApiClient, id: string, body: { status: string; reason?: string }) {
  const current = await appointmentById(client, id)
  const response = await client.context.patch(`/api/v1/appointments/${id}`, {
    data: body,
    headers: { 'idempotency-key': randomUUID(), 'if-match': `"${current.version}"` },
  })
  expect(response.status()).toBe(200)
}

const SLOT_A = { studentId: 's1', slotId: 'slot-a', type: 'Bireysel etüt' }
const SLOT_B = { studentId: 's1', slotId: 'slot-b', type: 'Bireysel etüt' }

test.describe('öğrenci randevu talebi', () => {
  test('öğrenci alınabilir saatlerden talep açar; Dolu saat seçilemez ve nedeni yazmaz (DOM-ILT-100, DOM-ILT-105)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await appointmentTenant(tenant)
    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/randevu-talep')
    await expect(page.getByRole('heading', { name: 'Etüt Randevusu', level: 1 })).toBeVisible()
    await expect(page.getByText('Henüz randevu talebiniz yok.')).toBeVisible()

    await page.getByRole('button', { name: 'Randevu talep et' }).click()
    const form = page.getByRole('dialog', { name: 'Randevu talep et' })
    // Öğrencinin türleri: veli görüşmesi seçilemez (DOM-ILT-100).
    await expect(form.getByLabel('Görüşme türü').locator('option')).toHaveText([
      'Bireysel etüt',
      'Akademik danışmanlık',
    ])
    // Alınabilir saatler: yalnız öğrencinin sınıfına ders veren öğretmenin saatleri; Nilüfer c2'dedir.
    await expect(radio(form, '13:00 – 13:30')).toBeEnabled()
    await expect(radio(form, '14:00 – 14:30')).toBeEnabled()
    await expect(form.getByText('Nilüfer Tan')).toHaveCount(0)
    // Başka velinin bekleyen talebi saati tutar: "Dolu", seçilemez; nedeni (kim, hangi konu) yazmaz.
    const busy = radio(form, '15:00 – 15:30')
    await expect(busy).toBeDisabled()
    await expect(form.getByText('Dolu', { exact: true })).toHaveCount(1)
    await expect(form.getByText('Başka bir velinin')).toHaveCount(0)

    await form.getByRole('button', { name: 'Talebi gönder' }).click()
    await expect(form.getByText('Müsait bir görüşme saati seçin.')).toBeVisible()
    await expect(form.getByText('Görüşme konusunu yazın.')).toBeVisible()
    await expect(toast(page, /./)).toHaveCount(0)

    await radio(form, '13:00 – 13:30').check()
    await form.getByLabel('Görüşme konusu').fill(NOTE)
    await form.getByRole('button', { name: 'Talebi gönder' }).click()
    await expect(toast(page, 'Randevu talebiniz öğretmene iletildi.')).toBeVisible()
    await expect(form).toBeHidden()
    const row = page
      .getByRole('table', { name: STUDENT_TABLE })
      .getByRole('row')
      .filter({ hasText: 'Selin Kaya' })
    await expect(row).toContainText('Bekliyor')
    await expect(row).toContainText('Bireysel etüt')
    await expect(page.getByText('1 randevu · 1 onay bekliyor')).toBeVisible()
    // Bekleyen talep programda değildir (DOM-ILT-104).
    await expect(page.getByRole('heading', { name: 'Yaklaşan randevular' })).toHaveCount(0)

    const student = await api(school.user('ogrenci'))
    const list = await student.get('/api/v1/collections/appointments?pageSize=100')
    const saved = (list.body as { data: AppointmentItem[] }).data
    expect(saved).toHaveLength(1)
    expect(saved[0]?.record).toMatchObject({
      studentId: 's1',
      teacherId: 't1',
      slotId: 'slot-a',
      type: 'Bireysel etüt',
      note: NOTE,
      status: 'Bekliyor',
      requestedBy: { role: 'ogrenci' },
    })

    // Alınan saat artık Dolu: talep saati tutar.
    await page.getByRole('button', { name: 'Randevu talep et' }).click()
    await expect(
      radio(page.getByRole('dialog', { name: 'Randevu talep et' }), '13:00'),
    ).toBeDisabled()
  })

  test('saat başkasına geçtiyse 409 çakışmasında ileti genel kalır: saat alanında görünür, toast çıkmaz, konu korunur ve liste tazelenir (DOM-ILT-101, DOM-ILT-073)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await appointmentTenant(tenant)
    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/randevu-talep?randevu-form=yeni')
    const form = page.getByRole('dialog', { name: 'Randevu talep et' })
    await expect(radio(form, '14:00 – 14:30')).toBeEnabled()

    // Panel açıkken veli aynı öğretmenin aynı saatini çocuğu için alır; öğrenci o görüşmeyi göremez.
    const parent = await api(school.user('veli'))
    await book(parent, { studentId: 's1', slotId: 'slot-b', type: 'Veli görüşmesi' })

    await radio(form, '14:00 – 14:30').check()
    await form.getByLabel('Görüşme konusu').fill(NOTE)
    await form.getByRole('button', { name: 'Talebi gönder' }).click()
    // Hata tek yerde: saat alanının altında; toast çıkmaz.
    await expect(form.getByRole('alert').filter({ hasText: HIDDEN_CONFLICT })).toBeVisible()
    await expect(toast(page, HIDDEN_CONFLICT)).toHaveCount(0)
    await expect(toast(page, /./)).toHaveCount(0)
    // Liste tazelendi: saat Dolu, seçim kalktı, yazılan konu yerinde.
    await expect(radio(form, '14:00 – 14:30')).toBeDisabled()
    await expect(radio(form, '14:00 – 14:30')).not.toBeChecked()
    await expect(form.getByLabel('Görüşme konusu')).toHaveValue(NOTE)

    const student = await api(school.user('ogrenci'))
    const list = await student.get('/api/v1/collections/appointments?pageSize=100')
    expect((list.body as { data: unknown[] }).data).toHaveLength(0)
  })
})

test.describe('veli randevular sekmesi', () => {
  test('veli iki çocuk arasında geçer: liste ve alınabilir saatler çocuğa göre gelir (DOM-ILT-103, DOM-ILT-105)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await appointmentTenant(tenant)
    const parent = await api(school.user('veli'))
    await book(parent, { studentId: 's1', slotId: 'slot-a', type: 'Veli görüşmesi' })
    await book(parent, { studentId: 's2', slotId: 'slot-c2', type: 'Akademik danışmanlık' })

    await loginAs(school.user('veli'))
    await page.goto('/veli/randevu-mesaj?sekme=randevular&cocuk=s1')
    await expect(page.getByRole('heading', { name: 'Randevu & Mesajlar', level: 1 })).toBeVisible()
    const table = page.getByRole('table', { name: STUDENT_TABLE })
    await expect(page.getByText('1 randevu · 1 onay bekliyor')).toBeVisible()
    await expect(table.getByRole('row').filter({ hasText: 'Selin Kaya' })).toContainText(
      'Veli görüşmesi',
    )
    await expect(table.getByText('Nilüfer Tan')).toHaveCount(0)

    await page.getByRole('button', { name: 'Randevu talep et' }).click()
    const form = page.getByRole('dialog', { name: 'Randevu talep et' })
    await expect(form.getByText('Deniz Yılmaz')).toBeVisible()
    await expect(form.getByLabel('Görüşme türü').locator('option')).toHaveText([
      'Veli görüşmesi',
      'Akademik danışmanlık',
    ])
    await expect(radio(form, '14:00 – 14:30')).toBeEnabled()
    // Deniz'in öğretmenleri arasında Nilüfer Tan yoktur; kendi talebi saati tuttuğu için Dolu.
    await expect(form.getByText('Nilüfer Tan')).toHaveCount(0)
    await expect(radio(form, '13:00 – 13:30')).toBeDisabled()
    await form.getByRole('button', { name: 'Vazgeç' }).click()
    await expect(form).toBeHidden()

    await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
    await expect(page).toHaveURL(/[?&]cocuk=s2/)
    await expect(table.getByRole('row').filter({ hasText: 'Nilüfer Tan' })).toContainText(
      'Akademik danışmanlık',
    )
    await expect(table.getByText('Selin Kaya')).toHaveCount(0)

    await page.getByRole('button', { name: 'Randevu talep et' }).click()
    await expect(form.getByText('Ece Yılmaz')).toBeVisible()
    // Ece'nin sınıfına Nilüfer Tan da girer: onun saati listededir ve kendi talebi nedeniyle Dolu.
    await expect(form.getByText('Nilüfer Tan')).toBeVisible()
    await expect(radio(form, '13:00 – 13:30Dolu Nilüfer')).toBeDisabled()
    await radio(form, '14:00 – 14:30').check()
    await form.getByLabel('Görüşme konusu').fill('Ödev takibini konuşmak istiyoruz.')
    await form.getByRole('button', { name: 'Talebi gönder' }).click()
    await expect(toast(page, 'Randevu talebiniz öğretmene iletildi.')).toBeVisible()
    await expect(page.getByText('2 randevu · 2 onay bekliyor')).toBeVisible()

    const list = await parent.get('/api/v1/collections/appointments?pageSize=100')
    const saved = (list.body as { data: AppointmentItem[] }).data
    expect(saved.map((item) => [item.record.studentId, item.record.slotId]).sort()).toEqual([
      ['s1', 'slot-a'],
      ['s2', 'slot-b'],
      ['s2', 'slot-c2'],
    ])

    // Deniz'e dönünce yalnız onun randevusu görünür.
    await page.getByLabel('Çocuk seç').selectOption({ label: 'Deniz Yılmaz' })
    await expect(page.getByText('1 randevu · 1 onay bekliyor')).toBeVisible()
  })

  test('veli kendi talebini geri çeker; başka velinin ve açanı bilinmeyen görüşme ona görünmez (DOM-ILT-102, DOM-ILT-103)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await appointmentTenant(tenant)
    const parent = await api(school.user('veli'))
    const id = await book(parent, { studentId: 's1', slotId: 'slot-a', type: 'Veli görüşmesi' })

    await loginAs(school.user('veli'))
    await page.goto(`/veli/randevu-mesaj?sekme=randevular&cocuk=s1&randevu=${id}`)
    const panel = page.getByRole('dialog', { name: 'Randevu ayrıntısı' })
    await expect(panel.getByText(NOTE)).toBeVisible()
    await panel.getByRole('button', { name: 'Talebi geri çek' }).click()
    await page
      .getByRole('dialog', { name: 'Talebi geri çek' })
      .getByRole('button', { name: 'Evet, geri çek' })
      .click()
    await expect(toast(page, 'Randevu talebiniz geri çekildi.')).toBeVisible()
    await expect(panel.getByText('Geri çekildi', { exact: true }).first()).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Talebi geri çek' })).toHaveCount(0)
    expect((await appointmentById(parent, id)).record.status).toBe('Geri çekildi')

    // Başka velinin bekleyen görüşmesi (e2e-apt-held, Ece için) liste ve adresle görünmez.
    await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
    await expect(page.getByText('0 randevu · 0 onay bekliyor')).toBeVisible()
    await page.goto('/veli/randevu-mesaj?sekme=randevular&cocuk=s2&randevu=e2e-apt-held')
    await expect(
      page.getByRole('dialog', { name: 'Randevu ayrıntısı' }).getByText(/Kayıt bulunamadı/),
    ).toBeVisible()
  })
})

test.describe('öğretmen onay, red ve iptal', () => {
  test('öğretmen talebi onaylar, ikincisini gerekçeyle reddeder, onaylı randevuyu gerekçeyle iptal eder; öğrenci gerekçeyi görür (DOM-ILT-102, DOM-ILT-104)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await appointmentTenant(tenant)
    const student = await api(school.user('ogrenci'))
    const first = await book(student, SLOT_A)
    const second = await book(student, SLOT_B)

    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/randevular')
    await expect(page.getByRole('heading', { name: 'Etüt & Görüşmeler', level: 1 })).toBeVisible()
    // Öğretmenin üç talebi var: Deniz'in ikisi ve Ece için başka velinin açtığı `e2e-apt-held`.
    await expect(page.getByText('3 randevu · 3 yanıt bekliyor')).toBeVisible()
    const table = page.getByRole('table', { name: TEACHER_TABLE })
    await expect(table.getByRole('row').filter({ hasText: 'Deniz Yılmaz' })).toHaveCount(2)
    // Programda henüz onaylı randevu yok: bekleyen talep programda görünmez (DOM-ILT-104).
    await expect(page.getByRole('heading', { name: 'Yaklaşan randevular' })).toHaveCount(0)

    // Onay.
    await rowButton(page, 'Deniz Yılmaz', '13:00').click()
    const panel = page.getByRole('dialog', { name: 'Randevu ayrıntısı' })
    await expect(panel.getByText(NOTE)).toBeVisible()
    await expect(panel.getByText('Talep açıldı · Öğrenci')).toBeVisible()
    await panel.getByRole('button', { name: 'Onayla' }).click()
    await expect(toast(page, 'Randevu onaylandı.')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Randevuyu iptal et' })).toBeVisible()
    await expect(panel.getByText('Onaylandı · Öğretmen')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Onayla' })).toHaveCount(0)
    expect((await appointmentById(student, first)).record.status).toBe('Onaylandı')
    // Onaylı randevu programa girer.
    await expect(page.getByRole('heading', { name: 'Yaklaşan randevular' })).toBeVisible()

    // Red: gerekçesiz gönderim istek atmaz.
    await panel.getByRole('button', { name: 'Pencereyi kapat' }).click()
    await rowButton(page, 'Deniz Yılmaz', '14:00').click()
    const rejectPanel = page.getByRole('dialog', { name: 'Randevu ayrıntısı' })
    await rejectPanel.getByRole('button', { name: 'Reddet' }).click()
    await expect(rejectPanel.getByText('Red gerekçesini yazın.')).toBeVisible()
    expect((await appointmentById(student, second)).record.status).toBe('Bekliyor')
    await rejectPanel.getByLabel('Red gerekçesi').fill(REASON)
    await rejectPanel.getByRole('button', { name: 'Reddet' }).click()
    await expect(toast(page, 'Randevu talebi reddedildi.')).toBeVisible()
    await expect(rejectPanel.getByText(REASON)).toBeVisible()
    await expect(rejectPanel.getByText(/Sonuçlanmış randevu değiştirilemez/)).toBeVisible()
    const rejected = (await appointmentById(student, second)).record
    expect(rejected.status).toBe('Reddedildi')
    expect(rejected.history?.at(-1)).toMatchObject({ status: 'Reddedildi', reason: REASON })
    // Reddedilen talep programda yoktur: programda tek kayıt (onaylı) kalır.
    await rejectPanel.getByRole('button', { name: 'Pencereyi kapat' }).click()
    const upcoming = page.getByRole('region', { name: 'Yaklaşan randevular' })
    await expect(upcoming.getByRole('listitem')).toHaveCount(1)

    // İptal: onaylı randevu gerekçeyle iptal edilir.
    await rowButton(page, 'Deniz Yılmaz', '13:00').click()
    const cancelPanel = page.getByRole('dialog', { name: 'Randevu ayrıntısı' })
    await cancelPanel.getByRole('button', { name: 'Randevuyu iptal et' }).click()
    await expect(cancelPanel.getByText('İptal gerekçesini yazın.')).toBeVisible()
    await expect(toast(page, /./)).toHaveCount(0)
    await cancelPanel.getByLabel('İptal gerekçesi').fill('Toplantı çıktı, yeni saat önereceğim.')
    await cancelPanel.getByRole('button', { name: 'Randevuyu iptal et' }).click()
    await expect(toast(page, 'Randevu iptal edildi.')).toBeVisible()
    await expect(cancelPanel.getByText('Toplantı çıktı, yeni saat önereceğim.')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Yaklaşan randevular' })).toHaveCount(0)
    expect((await appointmentById(student, first)).record.status).toBe('İptal')

    // Öğrenci red gerekçesini geçmişte okur.
    await page.context().clearCookies()
    await loginAs(school.user('ogrenci'))
    await page.goto(`/ogrenci/randevu-talep?randevu=${second}`)
    const detail = page.getByRole('dialog', { name: 'Randevu ayrıntısı' })
    await expect(detail.getByText('Reddedildi · Öğretmen')).toBeVisible()
    await expect(detail.getByText(REASON)).toBeVisible()
    await expect(detail.getByRole('button', { name: /Onayla|Reddet|iptal/ })).toHaveCount(0)
  })

  test('öğrenci bekleyen talebini onayla geri çeker, onaylı randevusunu gerekçeyle iptal eder; saat yeniden alınabilir olur (DOM-ILT-102, DOM-ILT-104)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await appointmentTenant(tenant)
    const student = await api(school.user('ogrenci'))
    const teacher = await api(school.user('ogretmen'))
    const pending = await book(student, SLOT_A)
    const approved = await book(student, SLOT_B)
    await change(teacher, approved, { status: 'Onaylandı' })

    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/randevu-talep')
    // Yalnız onaylı randevu programda görünür.
    const upcoming = page.getByRole('region', { name: 'Yaklaşan randevular' })
    await expect(upcoming.getByRole('listitem')).toHaveCount(1)
    await expect(upcoming).toContainText('14:00')

    await rowButton(page, 'Selin Kaya', '13:00').click()
    const panel = page.getByRole('dialog', { name: 'Randevu ayrıntısı' })
    await panel.getByRole('button', { name: 'Talebi geri çek' }).click()
    const confirm = page.getByRole('dialog', { name: 'Talebi geri çek' })
    await expect(confirm.getByText(/Bu işlem geri alınamaz/)).toBeVisible()
    await confirm.getByRole('button', { name: 'Vazgeç' }).click()
    await expect(confirm).toBeHidden()
    expect((await appointmentById(student, pending)).record.status).toBe('Bekliyor')
    await panel.getByRole('button', { name: 'Talebi geri çek' }).click()
    await confirm.getByRole('button', { name: 'Evet, geri çek' }).click()
    await expect(toast(page, 'Randevu talebiniz geri çekildi.')).toBeVisible()
    await expect(panel.getByText(/Sonuçlanmış randevu değiştirilemez/)).toBeVisible()
    expect((await appointmentById(student, pending)).record.status).toBe('Geri çekildi')

    await panel.getByRole('button', { name: 'Pencereyi kapat' }).click()
    await rowButton(page, 'Selin Kaya', '14:00').click()
    await panel.getByRole('button', { name: 'Randevuyu iptal et' }).click()
    await expect(panel.getByText('İptal gerekçesini yazın.')).toBeVisible()
    await panel.getByLabel('İptal gerekçesi').fill('Sağlık nedeniyle gelemeyeceğim.')
    await panel.getByRole('button', { name: 'Randevuyu iptal et' }).click()
    await expect(toast(page, 'Randevu iptal edildi.')).toBeVisible()
    const cancelled = (await appointmentById(student, approved)).record
    expect(cancelled.status).toBe('İptal')
    expect(cancelled.history?.at(-1)).toMatchObject({ status: 'İptal' })
    await panel.getByRole('button', { name: 'Pencereyi kapat' }).click()
    await expect(page.getByRole('region', { name: 'Yaklaşan randevular' })).toHaveCount(0)

    // Kapanan randevular saati serbest bırakır (DOM-ILT-104): iki saat de yeniden alınabilir.
    await page.getByRole('button', { name: 'Randevu talep et' }).click()
    const form = page.getByRole('dialog', { name: 'Randevu talep et' })
    await expect(radio(form, '13:00 – 13:30')).toBeEnabled()
    await expect(radio(form, '14:00 – 14:30')).toBeEnabled()
  })
})

test.describe('sürüm çakışması', () => {
  /**
   * Öğretmen bekleyen talebin panelini açar; başka oturum (öğrenci) talebi geri çekip sürümü
   * artırır. Öğretmenin sorgusu 30 sn eskidikten sonra odak dönüşüyle arkadan tazelenir (W16b deseni).
   */
  async function openStale({ page, loginAs, api, tenant }: Fixtures, typeBefore: boolean) {
    const school = await appointmentTenant(tenant)
    const student = await api(school.user('ogrenci'))
    const id = await book(student, SLOT_A)

    await page.clock.install()
    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/randevular?randevu=${id}`)
    const panel = page.getByRole('dialog', { name: 'Randevu ayrıntısı' })
    const actions = panel.getByRole('form', { name: 'Randevu işlemleri' })
    await expect(actions).toBeVisible()
    if (typeBefore) await actions.getByLabel('Red gerekçesi').fill(REASON)

    await change(student, id, { status: 'Geri çekildi' })
    const refetched = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/v1/collections/appointments/${id}`) &&
        response.request().method() === 'GET',
    )
    await page.clock.fastForward(60_000)
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
    await refetched
    await expect(panel.getByText('Geri çekildi · Öğrenci')).toBeVisible()
    return { panel, actions, student, id }
  }

  test('kirli form eski sürümle gider: 409 uyarısı çıkar, yazılan gerekçe korunur ve randevu değişmez (DOM-ILT-102)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const { panel, actions, student, id } = await openStale({ page, loginAs, api, tenant }, true)
    // Form kirli olduğu için sessizce yeni sürüme geçmedi; gerekçe yerinde.
    await expect(actions.getByLabel('Red gerekçesi')).toHaveValue(REASON)
    await actions.getByRole('button', { name: 'Reddet' }).click()
    await expect(toast(page, CHANGED)).toBeVisible()
    // Randevu güncel hâliyle yeniden okundu; işlem artık yapılamaz ama metin kaybolmaz.
    await expect(
      panel.getByText(/Randevunun durumu bu arada değişti \(Geri çekildi\)/),
    ).toBeVisible()
    const kept = panel.getByLabel('Yazdığınız gerekçe (gönderilmedi)')
    await expect(kept).toHaveValue(REASON)
    await expect(kept).not.toBeEditable()
    await expect(panel.getByRole('button', { name: 'Reddet' })).toHaveCount(0)
    // Hiçbir şey ezilmedi: randevu öğrencinin geri çekmesiyle kaldı, gerekçe kaydedilmedi.
    const saved = (await appointmentById(student, id)).record
    expect(saved.status).toBe('Geri çekildi')
    expect(saved.history?.map((event) => event.status)).toEqual(['Bekliyor', 'Geri çekildi'])
  })

  test('temiz form arkadan gelen yeni sürüme sessizce geçer: uyarı çıkmaz, işlem düğmeleri kalkar (DOM-ILT-102)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const { panel, actions } = await openStale({ page, loginAs, api, tenant }, false)
    await expect(actions).toHaveCount(0)
    await expect(panel.getByText(/Sonuçlanmış randevu değiştirilemez/)).toBeVisible()
    await expect(panel.getByRole('button', { name: /Onayla|Reddet/ })).toHaveCount(0)
    await expect(toast(page, /./)).toHaveCount(0)
  })
})

test.describe('kapsam dışı randevu adresi', () => {
  test('kapsam dışı randevu `?randevu=` ile açılamaz: "bulunamadı" görünür, içerik sızmaz (DOM-ILT-103)', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const secret = 'Gizli görüşme notu.'
    const otherSecret = 'Başka öğretmenin gizli notu.'
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'],
      records: [
        {
          collection: 'appointments',
          data: {
            id: 'e2e-apt-baska-veli',
            studentId: 's1',
            teacherId: 't1',
            date: at(5, 10),
            duration: 30,
            type: 'Veli görüşmesi',
            note: secret,
            status: 'Bekliyor',
            requestedBy: { role: 'veli', userId: 'e2e-baska-veli' },
            createdAt: new Date().toISOString(),
          },
        },
        {
          collection: 'appointments',
          data: {
            id: 'e2e-apt-baska-ogretmen',
            studentId: 's1',
            teacherId: 'e2e-t-baska',
            date: at(5, 11),
            duration: 30,
            type: 'Bireysel etüt',
            note: otherSecret,
            status: 'Bekliyor',
            requestedBy: { role: 'ogrenci', userId: 'e2e-ogrenci' },
            createdAt: new Date().toISOString(),
          },
        },
      ],
    })
    const missing = (page: Page) =>
      page.getByRole('dialog', { name: 'Randevu ayrıntısı' }).getByText(/Kayıt bulunamadı/)

    // Öğrenci: velinin açtığı görüşme ona görünmez (DOM-ILT-103).
    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/randevu-talep?randevu=e2e-apt-baska-veli')
    await expect(missing(page)).toBeVisible()
    await expect(page.getByText(secret)).toHaveCount(0)
    // Listede yalnız öğrencinin kendi talebi (başka öğretmenle) vardır; velinin görüşmesi sayılmaz.
    await expect(page.getByText('1 randevu · 1 onay bekliyor')).toBeVisible()
    await expect(page.getByText(otherSecret)).toBeVisible()

    // Öğretmen: başka öğretmenin randevusu görünmez.
    await page.context().clearCookies()
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/randevular?randevu=e2e-apt-baska-ogretmen')
    await expect(missing(page)).toBeVisible()
    await expect(page.getByText(otherSecret)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Onayla|Reddet/ })).toHaveCount(0)
  })
})

test.describe('dar ekran', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('öğrenci, veli ve öğretmen randevu sayfaları, paneller ve form yatay taşmaz', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await appointmentTenant(tenant)
    const student = await api(school.user('ogrenci'))
    const id = await book(student, SLOT_A)
    await change(await api(school.user('ogretmen')), id, { status: 'Onaylandı' })

    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/randevu-talep')
    await expect(page.getByText('Selin Kaya').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.goto(`/ogrenci/randevu-talep?randevu=${id}`)
    await expect(page.getByRole('dialog', { name: 'Randevu ayrıntısı' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.goto('/ogrenci/randevu-talep?randevu-form=yeni')
    const form = page.getByRole('dialog', { name: 'Randevu talep et' })
    await expect(radio(form, '14:00 – 14:30')).toBeEnabled()
    await expectNoHorizontalOverflow(page)

    await page.context().clearCookies()
    await loginAs(school.user('veli'))
    await page.goto('/veli/randevu-mesaj?sekme=randevular&cocuk=s1')
    await expect(page.getByText('Selin Kaya').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.context().clearCookies()
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/randevular')
    await expect(page.getByText('Deniz Yılmaz').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.goto(`/ogretmen/randevular?randevu=${id}`)
    await expect(
      page.getByRole('dialog', { name: 'Randevu ayrıntısı' }).getByRole('form', {
        name: 'Randevu işlemleri',
      }),
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
