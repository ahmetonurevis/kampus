import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Download, Page } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Öğrenci belgesi (ON-049, DOM-KAY-027): yönetici ve ön büro Kayıt İşlemleri'nden belgeyi açar ve
// indirir; okulda "öğrenci", dil okulunda "kursiyer" terimi. Rol, kapsam, ayrılan/mezun reddi ve
// yanıt alanları API testindedir (`apps/api/test/enrollment-certificates.test.ts`), şablon metni
// birim testindedir (`apps/web-react/tests/enrollment-certificate-pdf.test.ts`).

const STUDENT = { id: 's1', name: 'Deniz Yılmaz', number: '2026001' }

/** İndirilen gerçek PDF'in metni; pdfjs yalnız web paketinin bağımlılığıdır. */
async function pdfText(download: Download): Promise<string> {
  const web = createRequire(resolve('apps/web-react/package.json'))
  const { getDocument } = (await import(
    pathToFileURL(web.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
  )) as typeof import('pdfjs-dist')
  const data = new Uint8Array(await readFile(await download.path()))
  const document = await getDocument({ data, useSystemFonts: true }).promise
  const lines: string[] = []
  for (let index = 1; index <= document.numPages; index += 1) {
    const content = await (await document.getPage(index)).getTextContent()
    lines.push(...content.items.flatMap((item) => ('str' in item ? [item.str] : [])))
  }
  return lines.join(' ')
}

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
