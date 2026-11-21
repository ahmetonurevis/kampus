import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { markFilesReady, pdf } from './support/materials.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Mazeret onayı ve özür belgesi (OG-044; DOM-ILT-053, Sabah kararları 71, 72): veli bildirime PDF
// ekler, yönetici Mazeret Bildirimleri sayfasında belgeyi açıp onaylar ya da gerekçeyle reddeder;
// veli yalnız durumu görür (Onay bekliyor / Onaylandı / Onaylanmadı), red gerekçesini görmez.
// İkinci karar 409 `absence_already_decided` olur. Kurum `tenant()` ile kurulur.

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

const dayFromToday = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

const ABSENCES_TABLE = 'Bildirim geçmişi'
const ADMIN_TABLE = 'Mazeret bildirimleri'
const REJECT_REASON = 'Rapor tarihi bildirilen günlerle uyuşmuyor.'

interface AbsenceItem {
  data: { record: Record<string, unknown>; version: number }
}

/** Veli bildirim formunu doldurur, belgeyi yükler ve gönderir (belge `ready` yapılınca). */
async function notifyWithDocument(
  page: Page,
  institutionId: string,
  document: ReturnType<typeof pdf>,
  days: number,
) {
  const day = dayFromToday(days)
  await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1')
  await page.getByRole('button', { name: 'Yeni bildirim' }).click()
  const form = page.getByRole('dialog', { name: 'İzin veya mazeret bildir' })
  await form.getByLabel('Başlangıç tarihi').fill(day)
  await form.getByLabel('Bitiş tarihi').fill(day)
  await form.getByLabel('Gerekçe').selectOption('health')
  await form.getByLabel('Özür belgesi', { exact: true }).setInputFiles(document)
  const attached = form.getByRole('list', { name: 'Eklenen belgeler' })
  await expect(attached.getByRole('listitem')).toHaveCount(1)
  await expect(attached).toContainText(document.name)
  await markFilesReady(institutionId)
  await form.getByRole('button', { name: 'Bildir' }).click()
  await expect(toast(page, 'Bildiriminiz kuruma iletildi.')).toBeVisible()
  await expect(form).toBeHidden()
}

async function onlyAbsence(client: ApiClient): Promise<{ id: string; version: number }> {
  const list = await client.get('/api/v1/collections/absences?pageSize=100')
  expect(list.status).toBe(200)
  const rows = (list.body as { data: { id: string; version: number }[] }).data
  expect(rows).toHaveLength(1)
  return rows[0] as { id: string; version: number }
}

test('DOM-ILT-053: veli belgeli bildirim yapar, yönetici belgeyi açıp onaylar, veli "Onaylandı" görür', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['yonetici', 'veli'] })
  const document = pdf('doktor-raporu.pdf')

  await loginAs(school.user('veli'))
  await notifyWithDocument(page, school.institutionId, document, 30)
  // Karar verilene kadar veli "Onay bekliyor" görür.
  const parentTable = page.getByRole('table', { name: ABSENCES_TABLE })
  await expect(parentTable.getByText('Onay bekliyor')).toBeVisible()
  await expect(parentTable.locator('tbody tr')).toHaveCount(1)

  const parent = await api(school.user('veli'))
  const created = await onlyAbsence(parent)
  const parentRead = (await parent.get(`/api/v1/collections/absences/${created.id}`)) as {
    status: number
    body: AbsenceItem
  }
  expect(parentRead.body.data.record).toMatchObject({ approvalStatus: 'pending' })
  const fileIds = parentRead.body.data.record.fileIds as string[]
  expect(fileIds).toHaveLength(1)

  // Yönetici: listede görür, panelde belgeyi açar, onay penceresiyle onaylar.
  await loginAs(school.user('yonetici'), { fresh: true })
  await page.goto('/yonetici/mazeret-bildirimleri')
  const adminRows = page.getByRole('table', { name: ADMIN_TABLE }).locator('tbody tr')
  await expect(adminRows).toHaveCount(1)
  await expect(adminRows.first()).toContainText('Deniz Yılmaz')
  await expect(adminRows.first()).toContainText('Onay bekliyor')
  await page.getByRole('combobox', { name: 'Onay durumu' }).selectOption('Onaylandı')
  await expect(page.getByText('Aramanızla eşleşen kayıt bulunamadı.')).toBeVisible()
  await page.getByRole('combobox', { name: 'Onay durumu' }).selectOption('all')
  await adminRows
    .first()
    .getByRole('button', { name: /Deniz Yılmaz/ })
    .click()

  const panel = page.getByRole('dialog', { name: 'Bildirim ayrıntısı' })
  await expect(panel).toContainText('Onay bekliyor')
  const files = panel.getByRole('list', { name: 'Özür belgeleri' })
  await expect(files.getByRole('listitem')).toHaveCount(1)
  await expect(files).toContainText(document.name)
  // PDF `attachment` olarak iner; imzalı bağlantı yanıtı doğrulanır.
  const [popup, link] = await Promise.all([
    page.waitForEvent('popup'),
    page.waitForResponse((response) => response.url().includes(`/api/v1/files/${fileIds[0]}/url`)),
    files.getByRole('button', { name: `${document.name} dosyasını aç`, exact: true }).click(),
  ])
  expect(link.status()).toBe(200)
  await popup.close()

  await panel.getByRole('button', { name: 'Onayla', exact: true }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Bildirimi onayla' })
  await expect(confirm).toContainText('Karar sonradan değiştirilemez.')
  await confirm.getByRole('button', { name: 'Onayla', exact: true }).click()
  await expect(toast(page, 'Bildirim onaylandı.')).toBeVisible()
  await expect(panel).toContainText('Onaylandı')
  await expect(panel.getByRole('button', { name: 'Onayla', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: /Reddet/ })).toHaveCount(0)

  // İkinci karar sunucuda 409 `absence_already_decided` olur.
  const admin = await api(school.user('yonetici'))
  const decided = (await admin.get(`/api/v1/collections/absences/${created.id}`)) as {
    body: AbsenceItem
  }
  expect(decided.body.data.record).toMatchObject({
    approvalStatus: 'approved',
    status: 'Onaylandı',
  })
  const second = await admin.post(
    `/api/v1/absences/${created.id}/approve`,
    {},
    { 'idempotency-key': randomUUID(), 'if-match': `"${decided.body.data.version}"` },
  )
  expect(second.status).toBe(409)
  expect(JSON.stringify(second.body)).toContain('absence_already_decided')

  // Veli kararı "Onaylandı" olarak görür.
  await loginAs(school.user('veli'), { fresh: true })
  await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1')
  await expect(
    page.getByRole('table', { name: ABSENCES_TABLE }).getByText('Onaylandı'),
  ).toBeVisible()
  await page
    .getByRole('table', { name: ABSENCES_TABLE })
    .getByRole('button', { name: 'Sağlık nedeniyle' })
    .click()
  const parentPanel = page.getByRole('dialog', { name: 'Bildirim ayrıntısı' })
  await expect(parentPanel).toContainText('Onaylandı')
  // Karar verilmiş bildirime belge eklenmez.
  await expect(parentPanel.getByRole('form', { name: 'Özür belgesi ekle' })).toHaveCount(0)
})

test('Sabah kararı 72: yönetici gerekçeyle reddeder, veli "Onaylanmadı" görür ama gerekçeyi görmez', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['yonetici', 'veli'] })
  await loginAs(school.user('veli'))
  // Belge zorunlu değildir: belgesiz bildirim de karara girer; belgeyi sonradan panelden ekler.
  const day = dayFromToday(35)
  await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1')
  await page.getByRole('button', { name: 'Yeni bildirim' }).click()
  const form = page.getByRole('dialog', { name: 'İzin veya mazeret bildir' })
  await form.getByLabel('Başlangıç tarihi').fill(day)
  await form.getByLabel('Bitiş tarihi').fill(day)
  await form.getByLabel('Gerekçe').selectOption('family')
  await form.getByRole('button', { name: 'Bildir' }).click()
  await expect(toast(page, 'Bildiriminiz kuruma iletildi.')).toBeVisible()

  await page
    .getByRole('table', { name: ABSENCES_TABLE })
    .getByRole('button', { name: 'Ailevi neden' })
    .click()
  const parentPanel = page.getByRole('dialog', { name: 'Bildirim ayrıntısı' })
  await expect(parentPanel.getByText('Belge eklenmedi.')).toBeVisible()
  const attach = parentPanel.getByRole('form', { name: 'Özür belgesi ekle' })
  const late = pdf('sonradan-eklenen.pdf')
  await attach.getByLabel('Özür belgesi', { exact: true }).setInputFiles(late)
  await expect(attach.getByRole('listitem')).toHaveCount(1)
  await markFilesReady(school.institutionId)
  await attach.getByRole('button', { name: 'Belgeleri ekle' }).click()
  await expect(toast(page, 'Belge bildirime eklendi.')).toBeVisible()
  const parentFiles = parentPanel.getByRole('list', { name: 'Özür belgeleri' })
  await expect(parentFiles.getByRole('listitem')).toHaveCount(1)
  await expect(parentFiles).toContainText(late.name)

  // Yönetici gerekçe yazmadan reddedemez; gerekçeyle reddeder.
  await loginAs(school.user('yonetici'), { fresh: true })
  await page.goto('/yonetici/mazeret-bildirimleri')
  const row = page.getByRole('table', { name: ADMIN_TABLE }).locator('tbody tr').first()
  await row.getByRole('button', { name: /Deniz Yılmaz/ }).click()
  const panel = page.getByRole('dialog', { name: 'Bildirim ayrıntısı' })
  await expect(panel.getByRole('list', { name: 'Özür belgeleri' })).toContainText(late.name)
  await panel.getByRole('button', { name: /Reddet/ }).click()
  const reject = panel.getByRole('form', { name: 'Bildirimi reddet' })
  await reject.getByRole('button', { name: 'Reddet', exact: true }).click()
  await expect(reject.getByText('Ret gerekçesini yazın.')).toBeVisible()
  await reject.getByLabel('Red gerekçesi').fill(REJECT_REASON)
  await reject.getByRole('button', { name: 'Reddet', exact: true }).click()
  await expect(toast(page, 'Bildirim reddedildi.')).toBeVisible()
  await expect(panel).toContainText('Reddedildi')
  await expect(panel).not.toContainText(REJECT_REASON)
  await expect(panel.getByRole('form', { name: 'Bildirimi reddet' })).toHaveCount(0)

  // Kayıt ve veli yanıtı gerekçeyi taşımaz; gerekçe yalnız denetim kaydındadır.
  const parent = await api(school.user('veli'))
  const created = await onlyAbsence(parent)
  const parentRead = await parent.get(`/api/v1/collections/absences/${created.id}`)
  expect(parentRead.status).toBe(200)
  expect(JSON.stringify(parentRead.body)).not.toContain(REJECT_REASON)
  expect(parentRead.body).toMatchObject({
    data: { record: { approvalStatus: 'rejected', status: 'Reddedildi' } },
  })
  expect(JSON.stringify(parentRead.body)).not.toContain('decidedBy')

  await loginAs(school.user('veli'), { fresh: true })
  await page.goto('/veli/devamsizlik-bildirimi?cocuk=s1')
  const table = page.getByRole('table', { name: ABSENCES_TABLE })
  await expect(table.getByText('Onaylanmadı')).toBeVisible()
  await expect(table.getByText('Reddedildi')).toHaveCount(0)
  await table.getByRole('button', { name: 'Ailevi neden' }).click()
  const finalPanel = page.getByRole('dialog', { name: 'Bildirim ayrıntısı' })
  await expect(finalPanel).toContainText('Onaylanmadı')
  await expect(finalPanel).not.toContainText(REJECT_REASON)
  await expect(page.locator('body')).not.toContainText(REJECT_REASON)
})

/** Veli API'den belgesiz bildirim açar (yönetici ekranı sınamaları için kurulum). */
async function notifyViaApi(parent: ApiClient, days: number) {
  const day = dayFromToday(days)
  const notice = await parent.post(
    '/api/v1/absences',
    { studentId: 's1', startDate: day, endDate: day, reasonCategory: 'official' },
    { 'idempotency-key': randomUUID() },
  )
  expect(notice.status, JSON.stringify(notice.body)).toBe(201)
}

test.describe('390 px genişlik', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('yönetici mazeret listesi ve paneli yatay taşmaz', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'veli'] })
    await notifyViaApi(await api(school.user('veli')), 40)
    await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/mazeret-bildirimleri')
    await expect(page.getByText('Deniz Yılmaz').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page
      .getByRole('button', { name: /Deniz Yılmaz/ })
      .first()
      .click()
    const panel = page.getByRole('dialog', { name: 'Bildirim ayrıntısı' })
    await expect(panel.getByRole('button', { name: 'Onayla', exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test('akademik modül kapanınca mazeret bildirimleri sayfası ve ucu kapanır', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['yonetici', 'veli'] })
  await notifyViaApi(await api(school.user('veli')), 41)
  const admin = await api(school.user('yonetici'))
  expect((await admin.get('/api/v1/collections/absences')).status).toBe(200)

  const settings = await admin.get('/api/v1/modules')
  const response = await admin.context.patch('/api/v1/modules/academic', {
    data: { enabled: false },
    headers: {
      'if-match': `"${(settings.body as { data: { version: number } }).data.version}"`,
      'idempotency-key': randomUUID(),
    },
  })
  expect(response.status()).toBe(200)

  await loginAs(school.user('yonetici'))
  await page.goto('/yonetici/mazeret-bildirimleri')
  await expect(page.getByText('Bu modül kurum ayarlarından kapatılmış.')).toBeVisible()
  await expect(page).toHaveURL(/\/yonetici\/dashboard/)
  await expect(page.getByRole('link', { name: 'Mazeret Bildirimleri' })).toHaveCount(0)
  expect((await admin.get('/api/v1/collections/absences')).status).toBe(403)
})
