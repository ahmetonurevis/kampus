import { randomUUID } from 'node:crypto'

import type { Page, Request } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import type { Tenant, TenantOptions, TenantUser } from './support/tenant.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Yönetici yazma ekranları (DOM-YTK-001): kampüs, sınıf ve öğretmen ekle/düzenle/arşivle/geri al.
// Yazan her test kendi kurumunu kurar (`tenant`: seed ile aynı kimlikler: kampüsler b1–b3, 7-A c1
// Kadıköy 10 öğrenci kontenjan 24, 7-B c9 Beşiktaş). Kalıcılık her testte API sorgusuyla doğrulanır.
// Hata gösterimi: alana bağlanan hata yalnız alanın altında, bağlanmayan yalnız toast'tadır.

const COLLECTIONS = '/api/v1/collections'
const CLASSES_URL = '/yonetici/subeler'
const STAFF_URL = '/yonetici/personel'

interface Row<T> {
  id: string
  version: number
  record: T
}
interface BranchRecord {
  id: string
  name: string
  address: string
  isActive: boolean
}
interface ClassRecord {
  id: string
  name: string
  grade: number
  section: string
  branchId: string
  room: string
  capacity: number
  teacherId: string
  isActive: boolean
}
interface TeacherRecord {
  id: string
  name: string
  email: string
  branchId: string
  isActive: boolean
}
interface StudentRecord {
  id: string
  classId: string
  isActive: boolean
}
interface AssignmentRecord {
  classId: string
  subjectId: string
  teacherId: string
}

async function list<T>(client: ApiClient, path: string): Promise<Row<T>[]> {
  const result = await client.get(`${COLLECTIONS}/${path}`)
  expect(result.status, path).toBe(200)
  return (result.body as { data: Row<T>[] }).data
}

const branches = (client: ApiClient) => list<BranchRecord>(client, 'branches?pageSize=100')
const classes = (client: ApiClient) => list<ClassRecord>(client, 'classes?pageSize=100')
const teachers = (client: ApiClient) => list<TeacherRecord>(client, 'teachers?pageSize=100')

async function rowOf<T extends { id: string }>(
  rows: Promise<Row<T>[]>,
  id: string,
): Promise<Row<T>> {
  const row = (await rows).find((item) => item.id === id)
  expect(row, id).toBeDefined()
  return row!
}

async function patchBranch(client: ApiClient, id: string, version: number, address: string) {
  const current = await rowOf(branches(client), id)
  const response = await client.context.fetch(`/api/v1/branches/${id}`, {
    method: 'PATCH',
    data: { name: current.record.name, address },
    headers: { 'if-match': `"${version}"`, 'idempotency-key': randomUUID() },
    failOnStatusCode: false,
  })
  expect(response.status(), 'API düzeltmesi').toBe(200)
}

/** Sayfadan çıkan yazma isteklerini sayar (çift gönderim denetimi). */
function recordPosts(page: Page, path: RegExp): Request[] {
  const requests: Request[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && path.test(new URL(request.url()).pathname))
      requests.push(request)
  })
  return requests
}

// Sonner toast'ı rol taşımaz; metniyle aranır. Olumsuz denetimler yalnız hata metnine bakar.
const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

interface Fixtures {
  page: Page
  loginAs: (principal: TenantUser) => Promise<Page>
  tenant: (options: TenantOptions) => Promise<Tenant>
}

/** Kendi kurumunda yönetici olarak girer ve sayfayı açar. */
async function openAs({ page, loginAs, tenant }: Fixtures, url: string) {
  const school = await tenant({ roles: ['yonetici'], classes: ['c1'] })
  await loginAs(school.user('yonetici'))
  await page.goto(url)
  return school
}

test.describe('yönetici: kampüs yazma', () => {
  test('kampüs eklenir ve düzenlenir; çift tıklama tek istek, aynı ad alan altında hata verir', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await openAs({ page, loginAs, tenant }, CLASSES_URL)
    const client = await api(school.user('yonetici'))
    expect(await branches(client)).toHaveLength(3)
    const posts = recordPosts(page, /\/api\/v1\/branches$/)

    const addButton = page.getByRole('button', { name: 'Kampüs ekle' })
    await addButton.click()
    const panel = page.getByRole('dialog', { name: 'Kampüs ekle' })
    await expect(panel).toBeVisible()
    await expect(page).toHaveURL(/[?&]kampus-form=yeni/)
    await panel.getByLabel('Kampüs adı').fill('Çamlıca Kampüsü')
    await panel.getByLabel('Adres').fill('Çamlıca Mah. 5, Üsküdar')
    await panel.getByRole('button', { name: 'Kaydet' }).dblclick()
    await expect(toast(page, 'Kampüs eklendi.')).toBeVisible()
    await expect(panel).toBeHidden()
    expect(posts).toHaveLength(1)
    expect(posts[0]?.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
    const stored = await branches(client)
    expect(stored).toHaveLength(4)
    const created = stored.find((row) => row.record.name === 'Çamlıca Kampüsü')!
    expect(created.record.address).toBe('Çamlıca Mah. 5, Üsküdar')
    await expect(
      page
        .getByRole('list', { name: 'Kampüsler' })
        .getByRole('heading', { name: 'Çamlıca Kampüsü' }),
    ).toBeVisible()

    // Aynı ad: hata yalnız alanın altında, toast yok; kayıt değişmez, form açık kalır.
    await addButton.click()
    await panel.getByLabel('Kampüs adı').fill('Çamlıca Kampüsü')
    await panel.getByLabel('Adres').fill('Başka bir adres')
    await panel.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.locator('#kampus-ad-hata')).toContainText('aktif bir kampüs zaten var')
    await expect(page.getByLabel('Kampüs adı')).toBeFocused()
    await expect(toast(page, /aktif bir kampüs/)).toHaveCount(0)
    await expect(panel).toBeVisible()
    expect(await branches(client)).toHaveLength(4)
    await panel.getByRole('button', { name: 'Vazgeç' }).click()
    await expect(panel).toBeHidden()

    // Düzenleme: değerler dolu gelir; geri/ileri formu kapatır ve açar.
    await page.getByRole('button', { name: 'Çamlıca Kampüsü düzenle' }).click()
    const edit = page.getByRole('dialog', { name: 'Kampüsü düzenle' })
    await expect(edit.getByLabel('Kampüs adı')).toHaveValue('Çamlıca Kampüsü')
    await page.goBack()
    await expect(edit).toBeHidden()
    await page.goForward()
    await expect(edit).toBeVisible()
    await edit.getByLabel('Adres').fill('Yeni adres 12, Üsküdar')
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(toast(page, 'Kampüs güncellendi.')).toBeVisible()
    const updated = await rowOf(branches(client), created.id)
    expect(updated.record.address).toBe('Yeni adres 12, Üsküdar')
    expect(updated.version).toBe(created.version + 1)
  })

  test('pencere kapanınca odak tetikleyiciye döner (Escape ve Vazgeç)', async ({
    page,
    loginAs,
    tenant,
  }) => {
    await openAs({ page, loginAs, tenant }, CLASSES_URL)
    const addButton = page.getByRole('button', { name: 'Kampüs ekle' })
    await addButton.click()
    await expect(page.getByRole('dialog', { name: 'Kampüs ekle' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Kampüs ekle' })).toBeHidden()
    await expect(addButton).toBeFocused()

    const editButton = page.getByRole('button', { name: 'Kadıköy Kampüsü düzenle' })
    await editButton.click()
    await expect(page.getByRole('dialog', { name: 'Kampüsü düzenle' })).toBeVisible()
    await page.getByRole('button', { name: 'Vazgeç' }).click()
    await expect(page.getByRole('dialog', { name: 'Kampüsü düzenle' })).toBeHidden()
    await expect(editButton).toBeFocused()

    const addClass = page.getByRole('button', { name: 'Sınıf ekle' })
    await addClass.click()
    await expect(page.getByRole('dialog', { name: 'Sınıf ekle' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Sınıf ekle' })).toBeHidden()
    await expect(addClass).toBeFocused()
  })

  test('409 sürüm çakışmasında kayıt gönderilmez; güncel kayıt yüklenince kaydedilir', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await openAs({ page, loginAs, tenant }, CLASSES_URL)
    const client = await api(school.user('yonetici'))
    const before = await rowOf(branches(client), 'b3')

    await page.getByRole('button', { name: 'Ataşehir Kampüsü düzenle' }).click()
    const panel = page.getByRole('dialog', { name: 'Kampüsü düzenle' })
    await expect(panel.getByLabel('Kampüs adı')).toHaveValue('Ataşehir Kampüsü')
    // Form açıkken başka biri kaydı değiştirir.
    await patchBranch(client, 'b3', before.version, 'Başkasının adresi')

    await panel.getByLabel('Adres').fill('Benim adresim')
    await panel.getByRole('button', { name: 'Kaydet' }).click()
    const notice = panel
      .getByRole('alert')
      .filter({ hasText: 'Kayıt başka biri tarafından değişti' })
    await expect(notice).toBeVisible()
    // Mesaj yalnız form içinde: ikinci bir toast yok.
    await expect(toast(page, 'Kayıt başka biri tarafından değişti')).toHaveCount(0)
    expect((await rowOf(branches(client), 'b3')).record.address).toBe('Başkasının adresi')
    await expect(panel.getByRole('button', { name: 'Kaydet' })).toBeDisabled()

    await notice.getByRole('button', { name: 'Güncel kaydı yükle' }).click()
    await expect(panel.getByLabel('Adres')).toHaveValue('Başkasının adresi')
    await expect(notice).toBeHidden()
    await panel.getByLabel('Adres').fill('Benim adresim')
    await panel.getByRole('button', { name: 'Kaydet' }).click()
    await expect(toast(page, 'Kampüs güncellendi.')).toBeVisible()
    expect((await rowOf(branches(client), 'b3')).record.address).toBe('Benim adresim')
  })
})

test.describe('yönetici: sınıf yazma', () => {
  test('sınıf açılır; atamalar kaydedilir ve kontenjan sınırı aşılırsa alan altında hata çıkar', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await openAs({ page, loginAs, tenant }, CLASSES_URL)
    const client = await api(school.user('yonetici'))
    const before = await classes(client)

    await page.getByRole('button', { name: 'Sınıf ekle' }).click()
    const modal = page.getByRole('dialog', { name: 'Sınıf ekle' })
    await expect(modal).toBeVisible()
    await modal.getByLabel('Sınıf düzeyi').selectOption('7')
    await modal.getByLabel('Şube harfi').fill('D')
    await modal.getByLabel('Kampüs').selectOption({ label: 'Kadıköy Kampüsü' })
    await modal.getByLabel('Kontenjan').fill('41')
    await modal.getByLabel('Derslik').fill('901')
    await modal.getByRole('button', { name: 'Devam et' }).click()
    // Sınır dışı kontenjan istemcide durdurulur; adım değişmez, istek atılmaz.
    await expect(page.locator('#sinif-kontenjan-hata')).toBeVisible()
    expect(await classes(client)).toHaveLength(before.length)

    await modal.getByLabel('Kontenjan').fill('22')
    await modal.getByRole('button', { name: 'Devam et' }).click()
    await expect(modal.getByRole('heading', { name: 'Ders ve öğretmen atamaları' })).toBeVisible()
    await modal.getByRole('button', { name: 'Devam et' }).click()
    await expect(
      modal.getByRole('heading', { name: 'Kaydetmeden önce kontrol edin' }),
    ).toBeVisible()
    await expect(modal.getByText('7-D')).toBeVisible()
    await modal.getByRole('button', { name: 'Kaydet' }).click()
    await expect(toast(page, 'Sınıf eklendi.')).toBeVisible()
    await expect(modal).toBeHidden()

    const stored = await classes(client)
    expect(stored).toHaveLength(before.length + 1)
    const created = stored.find((row) => row.record.name === '7-D')!
    expect(created.record).toMatchObject({ branchId: 'b1', room: '901', capacity: 22, grade: 7 })
    const assignments = await list<AssignmentRecord>(
      client,
      `assignments?pageSize=100&classId=${created.id}`,
    )
    expect(assignments.length).toBeGreaterThan(5)
    expect(assignments.every((row) => row.record.classId === created.id)).toBe(true)

    // Aynı derslik: iş kuralı hatası yalnız derslik alanının altında, form 1. adıma döner.
    await page.getByRole('button', { name: 'Sınıf ekle' }).click()
    await modal.getByLabel('Sınıf düzeyi').selectOption('7')
    await modal.getByLabel('Şube harfi').fill('E')
    await modal.getByLabel('Kampüs').selectOption({ label: 'Kadıköy Kampüsü' })
    await modal.getByLabel('Kontenjan').fill('20')
    await modal.getByLabel('Derslik').fill('901')
    await modal.getByRole('button', { name: 'Devam et' }).click()
    await modal.getByRole('button', { name: 'Devam et' }).click()
    await modal.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.locator('#sinif-derslik-hata')).toBeVisible()
    await expect(toast(page, /derslik/i)).toHaveCount(0)
    await expect(modal.getByRole('heading', { name: 'Sınıf bilgileri' })).toBeVisible()
    expect(await classes(client)).toHaveLength(before.length + 1)
  })

  test('kontenjan öğrenci sayısının altına çekilemez; hata alan altında, sınıf değişmez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await openAs({ page, loginAs, tenant }, CLASSES_URL)
    const client = await api(school.user('yonetici'))
    const students = await list<StudentRecord>(client, 'students?pageSize=100')
    const count = students.filter(
      (row) => row.record.classId === 'c1' && row.record.isActive,
    ).length
    expect(count).toBeGreaterThan(3)
    const before = await rowOf(classes(client), 'c1')

    await page.getByRole('button', { name: '7-A düzenle' }).click()
    const modal = page.getByRole('dialog', { name: 'Sınıfı düzenle' })
    await expect(modal.getByLabel('Kontenjan')).toHaveValue(String(before.record.capacity))
    await modal.getByLabel('Kontenjan').fill(String(count - 2))
    await modal.getByRole('button', { name: 'Devam et' }).click()
    await modal.getByRole('button', { name: 'Devam et' }).click()
    await modal.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.locator('#sinif-kontenjan-hata')).toContainText('öğrenci')
    await expect(modal.getByRole('heading', { name: 'Sınıf bilgileri' })).toBeVisible()
    await expect(toast(page, /kontenjan/i)).toHaveCount(0)
    const after = await rowOf(classes(client), 'c1')
    expect(after.record.capacity).toBe(before.record.capacity)
    expect(after.version).toBe(before.version)
  })

  test('sınıf arşivlenir (hedefsiz reddedilir, hedefle öğrenciler aktarılır) ve geri alınır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await openAs({ page, loginAs, tenant }, CLASSES_URL)
    const client = await api(school.user('yonetici'))
    const students = (await list<StudentRecord>(client, 'students?pageSize=100')).filter(
      (row) => row.record.classId === 'c1',
    )
    expect(students.length).toBeGreaterThan(3)

    await page.getByLabel('Tabloda ara').fill('7-A')
    await page.getByRole('button', { name: '7-A arşivle' }).click()
    const dialog = page.getByRole('dialog', { name: 'Kaydı arşivle' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Arşivlemeyi tamamla' }).click()
    await expect(page.locator('#arsiv-hedef-hata')).toBeVisible()
    await expect(toast(page, /arşivlendi/)).toHaveCount(0)
    expect((await rowOf(classes(client), 'c1')).record.isActive).toBe(true)

    await dialog.getByLabel('Aktarım hedefi').selectOption('c9')
    await dialog.getByRole('button', { name: 'Arşivlemeyi tamamla' }).click()
    await expect(
      toast(page, `${students.length} öğrenci`).filter({ hasText: 'hedefine aktarıldı' }),
    ).toBeVisible()
    await expect(dialog).toBeHidden()
    expect((await rowOf(classes(client), 'c1')).record.isActive).toBe(false)
    const moved = await list<StudentRecord>(client, 'students?pageSize=100')
    for (const student of students)
      expect(moved.find((row) => row.id === student.id)?.record.classId, student.id).toBe('c9')

    // Arşiv sekmesinden geri al; aktarılan öğrenciler geri taşınmaz.
    await page
      .getByRole('toolbar', { name: 'Kayıt durumu' })
      .getByRole('button', { name: 'Arşiv' })
      .click()
    await page.getByRole('button', { name: '7-A geri al' }).click()
    await expect(toast(page, '7-A yeniden etkinleştirildi')).toBeVisible()
    expect((await rowOf(classes(client), 'c1')).record.isActive).toBe(true)
    const afterRestore = await list<StudentRecord>(client, 'students?pageSize=100')
    expect(afterRestore.find((row) => row.id === students[0]!.id)?.record.classId).toBe('c9')
  })
})

test.describe('yönetici: öğretmen yazma', () => {
  test('öğretmen eklenir; aynı e-posta alanın altında hata verir ve kayıt eklenmez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await openAs({ page, loginAs, tenant }, STAFF_URL)
    const client = await api(school.user('yonetici'))
    const before = await teachers(client)

    await page.getByRole('button', { name: 'Öğretmen ekle' }).click()
    const panel = page.getByRole('dialog', { name: 'Öğretmen ekle' })
    await expect(panel).toBeVisible()
    await panel.getByLabel('Ad soyad').fill('Ayhan Demirtaş')
    await panel.getByLabel('E-posta').fill('ayhan.demirtas@kampus.example')
    await panel.getByLabel('Telefon').fill('05551002030')
    await panel.getByLabel('Branş').selectOption({ label: 'Fizik' })
    await panel.getByLabel('Kampüs').selectOption({ label: 'Kadıköy Kampüsü' })
    await panel.getByRole('button', { name: 'Kaydet' }).click()
    await expect(toast(page, 'Öğretmen eklendi.')).toBeVisible()
    const stored = await teachers(client)
    expect(stored).toHaveLength(before.length + 1)
    expect(
      stored.find((row) => row.record.email === 'ayhan.demirtas@kampus.example')?.record,
    ).toMatchObject({ name: 'Ayhan Demirtaş', branchId: 'b1', isActive: true })

    await page.getByRole('button', { name: 'Öğretmen ekle' }).click()
    await panel.getByLabel('Ad soyad').fill('Başka Kişi')
    await panel.getByLabel('E-posta').fill('ogretmen1@kampus.example')
    await panel.getByLabel('Telefon').fill('05551002031')
    await panel.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.locator('#ogretmen-eposta-hata')).toBeVisible()
    await expect(toast(page, /e-posta/i)).toHaveCount(0)
    await expect(panel).toBeVisible()
    expect(await teachers(client)).toHaveLength(before.length + 1)
  })
})

test.describe('yetki ve yerleşim', () => {
  test('ön büro yönetim sayfalarında düzenleme düğmesi görmez, API yazmayı reddeder', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'onburo'], classes: ['c1'] })
    await loginAs(school.user('onburo'))
    const client = await api(school.user('onburo'))
    const manager = await api(school.user('yonetici'))
    const before = (await branches(manager)).length

    await page.goto('/onburo/subeler')
    await expect(page.getByRole('button', { name: 'Kampüs ekle' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Sınıf ekle' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /düzenle$/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /arşivle$/ })).toHaveCount(0)

    const response = await client.context.fetch('/api/v1/branches', {
      method: 'POST',
      data: { name: 'Yetkisiz Kampüs', address: 'Adres 1' },
      headers: { 'idempotency-key': randomUUID() },
      failOnStatusCode: false,
    })
    expect(response.status()).toBe(403)
    expect(await branches(manager)).toHaveLength(before)
  })

  test('dar ekranda formlar taşmaz', async ({ page, loginAs, tenant }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openAs({ page, loginAs, tenant }, CLASSES_URL)
    await page.getByRole('button', { name: 'Kampüs ekle' }).click()
    await expect(page.getByRole('dialog', { name: 'Kampüs ekle' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Sınıf ekle' }).click()
    await expect(page.getByRole('dialog', { name: 'Sınıf ekle' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
