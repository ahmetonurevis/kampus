import { randomUUID } from 'node:crypto'

import type { Locator, Page } from '@playwright/test'

import { apiRequest, type ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// İzin formu ekranları (IST-067; docs/domain/iletisim-ve-veli.md DOM-ILT-030, -031, -036…039) API'ye
// yazarak sınanır. Her test kendi kurumunu kurar (`tenant`); öğretmen Selin Kaya (t1) 7-A (c1)
// sınıfının rehber öğretmenidir, kurumda başlangıçta izin formu yoktur. Kalıcılık her adımda
// `/api/v1/permission-forms` ile doğrulanır.

const STAFF_PAGE = '/ogretmen/izin-formlari'
const ADMIN_PAGE = '/yonetici/izin-formlari'

interface FormView {
  id: string
  version: number
  topic: string
  title: string
  description: string
  deadline: string
  classIds?: string[]
  studentIds: string[]
  teacherId?: string | null
  status: 'open' | 'closed'
  closedAt: string | null
  counts: { pending: number; approved: number; rejected: number; total: number }
}

const panelOf = (page: Page, name: string) => page.getByRole('dialog', { name })
const bodyRows = (page: Page) =>
  page.getByRole('table', { name: 'İzin formu listesi' }).locator('tbody tr')
const metric = (panel: Locator, label: string) =>
  panel.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]')

/** Bugünden `days` gün sonrası (Europe/Istanbul), `YYYY-MM-DD`. */
const istanbulDay = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
    new Date(Date.now() + days * 86_400_000),
  )

/** Kurulum: öğretmen ya da yönetici 7-A'ya izin formu açar (arayüzden geçmeden). */
async function openForm(
  client: ApiClient,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<FormView> {
  const result = await client.post(
    '/api/v1/permission-forms',
    {
      topic: 'trip',
      title,
      description: 'Servisle gidilir, öğle yemeği okuldan.',
      deadline: istanbulDay(7),
      classIds: ['c1'],
      ...extra,
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return (result.body as { data: FormView }).data
}

async function formsOf(client: ApiClient): Promise<FormView[]> {
  const result = await client.get('/api/v1/permission-forms?page=1&pageSize=100')
  expect(result.status).toBe(200)
  return (result.body as { data: FormView[] }).data
}

async function formOf(client: ApiClient, id: string): Promise<FormView> {
  const result = await client.get(`/api/v1/permission-forms/${id}`)
  expect(result.status).toBe(200)
  return (result.body as { data: FormView }).data
}

/** Başka kullanıcının yazması: sürümlü düzenleme (`If-Match`). */
async function patchForm(client: ApiClient, form: FormView, body: Record<string, unknown>) {
  const result = await apiRequest(
    client.context,
    'PATCH',
    `/api/v1/permission-forms/${form.id}`,
    body,
    { 'idempotency-key': randomUUID(), 'if-match': `"${form.version}"` },
  )
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return (result.body as { data: FormView }).data
}

test.describe('İzin formları: rehber öğretmen ve yönetici', () => {
  test('öğretmen form açar, durumunu izler, düzenler ve kapatır (DOM-ILT-036, DOM-ILT-038)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'veli'], classes: ['c1'] })
    const teacher = await api(school.user('ogretmen'))
    await loginAs(school.user('ogretmen'))
    const title = 'Müze gezisi izni'

    await page.goto(STAFF_PAGE)
    await expect(page.getByText('0 form · Velilerin onayı')).toBeVisible()
    await page.getByRole('button', { name: 'İzin formu aç', exact: true }).click()
    const form = panelOf(page, 'İzin formu aç')

    // Boş gönderim istemcide durur, hiçbir kayıt yazılmaz.
    await form.getByRole('button', { name: 'Formu aç' }).click()
    await expect(form).toContainText('Konu türünü seçin.')
    await expect(form).toContainText('Form başlığını yazın.')
    await expect(form).toContainText('Son günü seçin.')
    await expect(form).toContainText('En az bir sınıf ya da öğrenci seçin.')
    expect(await formsOf(teacher)).toHaveLength(0)

    await form.getByLabel('Konu', { exact: true }).selectOption({ label: 'Gezi' })
    await form.getByLabel('Başlık').fill(title)
    await form.getByLabel('Açıklama').fill('Servisle gidilir, öğle yemeği okuldan.')
    await form.getByLabel('Son gün', { exact: true }).fill(istanbulDay(7))
    await form.getByRole('checkbox', { name: '7-A' }).click()
    await form.getByRole('button', { name: 'Formu aç' }).click()
    await expect(page.getByText('İzin formu açıldı; veliler bilgilendirildi.')).toBeVisible()
    await expect(panelOf(page, 'İzin formu aç')).toHaveCount(0)

    const [created] = await formsOf(teacher)
    expect(created).toMatchObject({
      topic: 'trip',
      title,
      deadline: istanbulDay(7),
      classIds: ['c1'],
      teacherId: 't1',
      status: 'open',
    })
    if (!created) return
    expect(created.studentIds.length).toBeGreaterThan(1)
    expect(created.counts.pending).toBe(created.studentIds.length)

    // Liste satırı: konu, durum ve karar özeti; öğrenci bazlı durum panelde.
    const row = bodyRows(page).filter({ hasText: title })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Gezi')
    await expect(row).toContainText('Açık')
    await expect(row).toContainText(`0 onay · 0 ret · ${created.counts.pending} bekliyor`)
    await row.getByRole('button', { name: `${title} ayrıntısını aç` }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]izin=${created.id}`))
    const detail = panelOf(page, 'İzin formu ayrıntısı')
    await expect(metric(detail, 'Bekleyen')).toHaveText(String(created.counts.pending))
    await expect(metric(detail, 'Öğrenci')).toHaveText(String(created.studentIds.length))
    const students = detail.getByRole('list', { name: 'Öğrenci izin durumu' })
    await expect(students.getByRole('listitem')).toHaveCount(created.studentIds.length)
    await expect(students.getByRole('listitem').first()).toContainText('Bekliyor')

    // Düzenle: konu kilitli, başlık değişir; yalnız başlık gider.
    await detail.getByRole('button', { name: 'Düzenle' }).click()
    const edit = panelOf(page, 'İzin formunu düzenle')
    await expect(edit.getByLabel('Konu', { exact: true })).toBeDisabled()
    await expect(edit.getByLabel('Başlık')).toHaveValue(title)
    await expect(edit.getByRole('checkbox', { name: '7-A' })).toBeChecked()
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(edit).toContainText('Değişiklik yapmadınız.')
    await edit.getByLabel('Başlık').fill(`${title} (güncel)`)
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('İzin formu güncellendi.')).toBeVisible()
    const updated = panelOf(page, 'İzin formu ayrıntısı')
    await expect(updated).toContainText(`${title} (güncel)`)
    const [saved] = await formsOf(teacher)
    expect(saved).toMatchObject({
      id: created.id,
      version: created.version + 1,
      title: `${title} (güncel)`,
      description: created.description,
      deadline: created.deadline,
    })

    // Kapat: onay ister; kapatılan form düzenlenmez ve yeniden açılmaz, kayıt korunur.
    await updated.getByRole('button', { name: 'Formu kapat' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Formu kapat' })
    await confirm.getByRole('button', { name: 'Formu kapat' }).click()
    await expect(page.getByText(`${title} (güncel) kapatıldı.`)).toBeVisible()
    await expect(updated.getByRole('button', { name: 'Düzenle' })).toBeDisabled()
    await expect(updated.getByRole('button', { name: 'Formu kapat' })).toBeDisabled()
    await expect(updated).toContainText('Kapatılmış form düzenlenemez')
    const [closed] = await formsOf(teacher)
    expect(closed?.status).toBe('closed')
    expect(closed?.closedAt).not.toBeNull()
    // Açık panel arkadaki listeyi erişilebilirlik ağacından gizler; liste kontrolü kapatınca.
    await updated.getByRole('button', { name: 'Pencereyi kapat' }).click()
    await expect(bodyRows(page).filter({ hasText: title })).toContainText('Kapalı')
  })

  test('karar vermemiş formu arşivler; yönetici öğretmenin formunu görür ve yönetir (DOM-ILT-038)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen'], classes: ['c1'] })
    const teacher = await api(school.user('ogretmen'))
    const admin = await api(school.user('yonetici'))
    const created = await openForm(teacher, 'Kulüp tanıtım izni', { topic: 'club' })
    await loginAs(school.user('yonetici'), { fresh: true })

    await page.goto(ADMIN_PAGE)
    const row = bodyRows(page).filter({ hasText: created.title })
    await expect(row).toContainText('Kulüp')
    await row.getByRole('button', { name: `${created.title} ayrıntısını aç` }).click()
    const detail = panelOf(page, 'İzin formu ayrıntısı')
    await expect(detail.getByRole('button', { name: 'Arşivle' })).toBeEnabled()
    await detail.getByRole('button', { name: 'Arşivle' }).click()
    await page
      .getByRole('alertdialog', { name: 'Formu arşivle' })
      .getByRole('button', { name: 'Arşivle' })
      .click()
    await expect(page.getByText(`${created.title} arşivlendi.`)).toBeVisible()
    await expect(panelOf(page, 'İzin formu ayrıntısı')).toHaveCount(0)
    await expect(bodyRows(page).filter({ hasText: created.title })).toHaveCount(0)
    expect(await formsOf(admin)).toHaveLength(0)
  })

  test('kararı olan form arşivlenemez, hedeften sınıf çıkarılamaz (DOM-ILT-034, DOM-ILT-038)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'veli'], classes: ['c1'] })
    const admin = await api(school.user('yonetici'))
    const parent = await api(school.user('veli'), { fresh: true })
    const created = await openForm(admin, 'Tiyatro gezisi izni', {
      classIds: ['c1', 'c2'],
      topic: 'event',
    })
    const decided = await parent.post(
      `/api/v1/permission-forms/${created.id}/decisions`,
      { studentId: 's1', decision: 'approved' },
      { 'idempotency-key': randomUUID() },
    )
    expect(decided.status, JSON.stringify(decided.body)).toBe(201)
    await loginAs(school.user('yonetici'), { fresh: true })

    await page.goto(`${ADMIN_PAGE}?izin=${created.id}`)
    const detail = panelOf(page, 'İzin formu ayrıntısı')
    await expect(metric(detail, 'Onay')).toHaveText('1')
    await expect(detail.getByRole('button', { name: 'Arşivle' })).toBeDisabled()
    await expect(detail).toContainText('Karar verilmiş form arşivlenemez')
    // Karar geçmişi yöneticiye görünür.
    await expect(detail.getByRole('list', { name: 'Karar geçmişi' })).toContainText('Veli onayladı')

    await detail.getByRole('button', { name: 'Düzenle' }).click()
    const edit = panelOf(page, 'İzin formunu düzenle')
    await expect(edit).toContainText('hedeften sınıf ya da öğrenci çıkarılamaz')
    await edit.getByRole('checkbox', { name: /^5-A$/ }).click()
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(edit).toContainText(
      'Karar verilmiş formun hedefinden sınıf ya da öğrenci çıkarılamaz.',
    )
    expect((await formOf(admin, created.id)).version).toBe(created.version)
  })

  test('düzenleme başkasının değişikliğini ezmez; aynı alan çakışırsa iki değer gösterilir (sessiz ezme yok)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen'], classes: ['c1'] })
    const teacher = await api(school.user('ogretmen'))
    const admin = await api(school.user('yonetici'))
    const created = await openForm(teacher, 'Doğa yürüyüşü izni')
    await loginAs(school.user('ogretmen'), { fresh: true })

    await page.goto(`${STAFF_PAGE}?izin-form=${created.id}`)
    const edit = panelOf(page, 'İzin formunu düzenle')
    await expect(edit.getByLabel('Başlık')).toHaveValue(created.title)

    // Yönetici formu bu arada değiştirir: açıklama ve başlık.
    const theirs = await patchForm(admin, created, {
      description: 'Yönetici açıklaması: yer değişti.',
      title: 'Yöneticinin başlığı',
    })

    // Öğretmen yalnız başlığı değiştirir: aynı alanı iki taraf değiştirdi, uyarı çıkar, kayıt yazılmaz.
    await edit.getByLabel('Başlık').fill('Öğretmenin başlığı')
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(edit).toContainText('Başlık: kayıtlı değer Yöneticinin başlığı')
    await expect(edit).toContainText('sizin girdiğiniz Öğretmenin başlığı')
    expect((await formOf(teacher, created.id)).title).toBe('Yöneticinin başlığı')

    // Yeniden kaydetmek kullanıcının değerini yazar; dokunulmayan açıklama eski değere dönmez.
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('İzin formu güncellendi.')).toBeVisible()
    const saved = await formOf(teacher, created.id)
    expect(saved).toMatchObject({
      title: 'Öğretmenin başlığı',
      description: 'Yönetici açıklaması: yer değişti.',
      version: theirs.version + 1,
    })
  })

  test('kapatılmış formun düzenleme adresi form çizmez', async ({ page, loginAs, api, tenant }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen', 'veli'], classes: ['c1'] })
    const teacher = await api(school.user('ogretmen'))
    const created = await openForm(teacher, 'Kapanacak form')
    const closed = await teacher.post(`/api/v1/permission-forms/${created.id}/close`, undefined, {
      'idempotency-key': randomUUID(),
      'if-match': `"${created.version}"`,
    })
    expect(closed.status, JSON.stringify(closed.body)).toBe(200)
    await loginAs(school.user('ogretmen'), { fresh: true })
    await page.goto(`${STAFF_PAGE}?izin-form=${created.id}`)
    const panel = panelOf(page, 'İzin formunu düzenle')
    await expect(panel).toContainText('Kapatılmış form değiştirilemez')
    await expect(panel.getByRole('button', { name: 'Kaydet' })).toHaveCount(0)
  })
})
