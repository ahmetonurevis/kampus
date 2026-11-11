import type { Page } from '@playwright/test'

import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Öğrenci belgesi (ON-049, ON-304, DOM-KAY-027): yönetici ve ön büro Kayıt İşlemleri'nden, veli
// Sözleşmeler'den, öğrenci Ödemelerim'den belgeyi açar ve indirir (K-32); okulda "öğrenci", dil
// okulunda "kursiyer" terimi. Rol, kapsam, ayrılan/mezun reddi ve
// yanıt alanları API testindedir (`apps/api/test/enrollment-certificates.test.ts`), şablon metni
// birim testindedir (`apps/web-react/tests/enrollment-certificate-pdf.test.ts`).

const STUDENT = { id: 's1', name: 'Deniz Yılmaz', number: '2026001' }

async function openPage(page: Page, role: 'onburo' | 'yonetici') {
  await page.goto(`/${role}/kayit-islemleri`)
  return page.getByRole('region', { name: /belgesi$/ })
}

test('ON-049 DOM-KAY-027: ön büro öğrenci belgesini açar ve indirir; PDF kurum belgesidir, denetime yazılır', async ({
  api,
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: ['onburo'], students: [STUDENT.id] })
  const page = await loginAs(school.user('onburo'))
  const pdfCode: string[] = []
  page.on('request', (request) => {
    if (/jspdf/i.test(request.url())) pdfCode.push(request.url())
  })
  const section = await openPage(page, 'onburo')
  await expect(section.getByRole('heading', { name: 'Öğrenci belgesi' })).toBeVisible()
  await section.getByRole('searchbox').fill(STUDENT.name)
  const open = section.getByRole('button', { name: `${STUDENT.name} öğrenci belgesi` })
  await expect(open).toBeVisible()
  expect(pdfCode, 'jsPDF tıklamadan önce yüklenmez').toEqual([])

  await open.click()
  const preview = page.getByRole('dialog', { name: 'Öğrenci belgesi · Önizleme' })
  await expect(preview.getByRole('img', { name: 'Öğrenci belgesi, sayfa 1' })).toBeVisible()
  const downloading = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
  const file = await downloading
  expect(file.suggestedFilename()).toMatch(/^ogrenci-belgesi-[0-9a-f]{8}\.pdf$/)

  const text = await pdfText(file)
  for (const expected of [
    'ÖĞRENCİ BELGESİ',
    STUDENT.name,
    STUDENT.number,
    'Belge kimliği',
    'Bilgilendirme amaçlıdır',
    'e-Okul',
  ])
    expect(text, expected).toContain(expected)
  expect(text).not.toMatch(/T\.C\.|mühür|imza/i)

  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()
  await expect(open).toBeFocused()

  const admin = await api(school.user('yonetici'))
  const audit = await admin.get('/api/v1/audit-events?entityType=students&pageSize=100')
  expect(audit.status).toBe(200)
  const events = (audit.body as { data: { action: string; entityId: string }[] }).data
  expect(
    events.some(
      (event) => event.action === 'enrollment_certificate.issue' && event.entityId === STUDENT.id,
    ),
  ).toBe(true)
})

test('ON-049 DOM-KAY-027: dil okulunda yönetici kursiyer belgesini açar, 390 px taşma yok', async ({
  loginAs,
  tenant,
}) => {
  const school = await tenant({ type: 'language_school', roles: [], students: [STUDENT.id] })
  const page = await loginAs(school.user('yonetici'))
  await page.setViewportSize({ width: 390, height: 844 })
  const section = await openPage(page, 'yonetici')
  await expect(section.getByRole('heading', { name: 'Kursiyer belgesi' })).toBeVisible()
  await expect(section.getByText('Okul numarası')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await section
    .getByRole('button', { name: /kursiyer belgesi$/ })
    .first()
    .click()
  const preview = page.getByRole('dialog', { name: 'Kursiyer belgesi · Önizleme' })
  await expect(preview.getByRole('img', { name: 'Kursiyer belgesi, sayfa 1' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('ON-049 DOM-KAY-024: liste açıkken ayrılan öğrencide sunucunun Türkçe iletisi gösterilir', async ({
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: ['onburo'], students: [STUDENT.id] })
  const page = await loginAs(school.user('onburo'))
  const message = 'Bu belge yalnız kaydı aktif olan kişiye düzenlenir; kayıt durumu: Ayrıldı.'
  await page.route('**/enrollment-certificate', (route) =>
    route.fulfill({
      status: 422,
      json: { code: 'enrollment_certificate_inactive', message, requestId: 'test' },
    }),
  )
  const section = await openPage(page, 'onburo')
  await section.getByRole('searchbox').fill(STUDENT.name)
  await section.getByRole('button', { name: `${STUDENT.name} öğrenci belgesi` }).click()
  const preview = page.getByRole('dialog', { name: 'Öğrenci belgesi · Önizleme' })
  await expect(preview.getByRole('alert')).toContainText(message)
  await expect(preview.getByRole('button', { name: 'Yeniden dene' })).toBeVisible()
})

/** Aile düğmesini açar, PDF'i indirir ve indirilen dosyanın metnini döner. */
async function downloadFamilyCertificate(page: Page, title: string) {
  const open = page.getByRole('region', { name: title }).getByRole('button', { name: title })
  await open.click()
  const preview = page.getByRole('dialog', { name: `${title} · Önizleme` })
  await expect(preview.getByRole('img', { name: `${title}, sayfa 1` })).toBeVisible()
  const downloading = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
  const text = await pdfText(await downloading)
  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()
  await expect(open).toBeFocused()
  return text
}

/** Denetim satırlarının aktör rolleri; yalnız bu öğrencinin belge düzenlemeleri. */
async function issuedRoles(
  admin: { get: (url: string) => Promise<{ status: number; body: unknown }> },
  studentId: string,
) {
  const audit = await admin.get('/api/v1/audit-events?entityType=students&pageSize=100')
  expect(audit.status).toBe(200)
  const events = (
    audit.body as { data: { action: string; entityId: string; actor: { role: string } }[] }
  ).data
  return events
    .filter(
      (event) => event.action === 'enrollment_certificate.issue' && event.entityId === studentId,
    )
    .map((event) => event.actor.role)
}

test('ON-304 K-32 DOM-KAY-027: veli seçili çocuğun belgesini indirir, denetime veli olarak yazılır', async ({
  api,
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: ['veli'], childIds: ['s1', 's2'] })
  const page = await loginAs(school.user('veli'))
  await page.goto('/veli/sozlesmeler?cocuk=s2')
  const second = await downloadFamilyCertificate(page, 'Öğrenci belgesi')
  expect(second).toContain('Ece Yılmaz')
  expect(second).not.toContain(STUDENT.name)

  await page.getByLabel('Çocuk seç').selectOption({ label: STUDENT.name })
  await expect(page).toHaveURL(/[?&]cocuk=s1/)
  const first = await downloadFamilyCertificate(page, 'Öğrenci belgesi')
  expect(first).toContain(STUDENT.name)

  const admin = await api(school.user('yonetici'))
  expect(await issuedRoles(admin, 's1')).toEqual(['veli'])
  expect(await issuedRoles(admin, 's2')).toEqual(['veli'])
})

test('ON-304 K-32 DOM-KAY-027: öğrenci kendi belgesini telefonda da indirir, ücret verisi okunmaz', async ({
  api,
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogrenci'] })
  const page = await loginAs(school.user('ogrenci'))
  const reads: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/collections/invoices')) reads.push(request.url())
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/ogrenci/odemelerim')
  await expect(page.getByRole('heading', { name: 'Ödemeler telefonda gösterilmez' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  const text = await downloadFamilyCertificate(page, 'Öğrenci belgesi')
  expect(text).toContain(STUDENT.name)
  expect(text).toContain(STUDENT.number)
  expect(reads).toEqual([])

  const admin = await api(school.user('yonetici'))
  expect(await issuedRoles(admin, STUDENT.id)).toEqual(['ogrenci'])
})

test('ON-304 K-32 DOM-KAY-027: dil okulunda veli düğmesi kursiyer belgesi adını taşır', async ({
  loginAs,
  tenant,
}) => {
  const school = await tenant({ type: 'language_school', roles: ['veli'], childIds: ['s1'] })
  const page = await loginAs(school.user('veli'))
  await page.goto('/veli/sozlesmeler')
  const title = 'Kursiyer belgesi'
  await page.getByRole('region', { name: title }).getByRole('button', { name: title }).click()
  await expect(
    page.getByRole('dialog', { name: `${title} · Önizleme` }).getByRole('img', {
      name: `${title}, sayfa 1`,
    }),
  ).toBeVisible()
})
