import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import { apiRequest, type ApiClient } from './support/api.ts'
import {
  expectMenuWithout,
  sweepPages,
  tableRow,
  toast,
  watchConsole,
  type SmokePage,
} from './support/enrollment-finance-smoke.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// ON-048: finans duman testleri. Her rol kendi finans sayfalarını (yönetici ve ön büroda yedi
// görünümün hepsi) açar, temel liste yüklenir; kritik akışlar (taksit tahsilatı → dekont, cari
// ekstre, tarife yayımı, sözleşme onayı) bir kez uçtan uca ilerler. Konsol hatası ve yatay taşma
// yoktur. Kural dalları burada yinelenmez: finans, odemeler-aile ve contract-approval
// spec'lerindedir. Taramalar seed kurumunu yalnız okur; yazan akışlar kendi kurumunu kurar.

const INVOICES = 'Taksit ve tahsilat listesi'
const table = (name: string) => (page: Page) => page.getByRole('table', { name, exact: true })

/** Yönetici ve ön büronun ortak Finans sayfası; görünümler `?gorunum=` ile açılır. */
function financeViews(path: string, heading: string): SmokePage[] {
  const view = (param: string, ready: SmokePage['ready']): SmokePage => ({
    path: param ? `${path}?gorunum=${param}` : path,
    heading,
    ready,
  })
  return [
    view('', (page) => tableRow(page, INVOICES, 'Ödendi')),
    view('tahsilatlar', table('Tahsilat geçmişi')),
    view('sozlesmeler', (page) => tableRow(page, 'Sözleşmeler')),
    view('tarife', table('Ücret tarifeleri')),
    view('burs', table('Burs programları')),
    view('ayrilis', table('Ayrılış ve iade kayıtları')),
    view('aktarim', (page) => page.getByRole('heading', { name: 'Muhasebe aktarımı' })),
  ]
}

const FINANCE_LINKS = [
  'Finans & Tahsilat',
  'Tahsilat Takibi',
  'Finans & Ödeme Planı',
  'Ödeme Yap',
  'Dekontlar',
  'Sözleşmeler',
  'Ödemelerim',
]

async function invoiceOf(client: ApiClient, id: string) {
  const result = await client.get(`/api/v1/collections/invoices/${id}`)
  expect(result.status, id).toBe(200)
  return (result.body as { data: { record: { paidAt: string | null; method: string | null } } })
    .data.record
}

test.describe('ON-048 finans duman: sayfalar', () => {
  test('yönetici Finans & Tahsilat görünümlerinin hepsini açar', async ({ page, loginAs }) => {
    const errors = watchConsole(page)
    await loginAs('yonetici')
    await sweepPages(page, financeViews('/yonetici/finans', 'Finans & Tahsilat'))
    expect(errors).toEqual([])
  })

  test('ön büro Tahsilat Takibi görünümlerinin hepsini açar', async ({ page, loginAs }) => {
    const errors = watchConsole(page)
    await loginAs('onburo')
    await sweepPages(page, financeViews('/onburo/tahsilat-takip', 'Tahsilat Takibi'))
    expect(errors).toEqual([])
  })

  test('veli finans, ödeme, dekont ve sözleşme sayfalarını açar', async ({ page, loginAs }) => {
    const errors = watchConsole(page)
    await loginAs('veli')
    await sweepPages(page, [
      {
        path: '/veli/finans?cocuk=s1',
        heading: 'Finans & Ödeme Planı',
        ready: (p) => tableRow(p, 'Taksit listesi', 'Ödendi'),
      },
      {
        path: '/veli/odeme-yap?cocuk=s1',
        heading: 'Ödeme Yap',
        ready: (p) => p.getByRole('heading', { name: 'Ödemeler okulda kaydedilir' }),
      },
      {
        path: '/veli/dekontlar?cocuk=s1',
        heading: 'Dekontlar',
        ready: (p) => tableRow(p, 'Ödeme dekontları', 'Ödendi'),
      },
      {
        path: '/veli/sozlesmeler?cocuk=s1',
        heading: 'Sözleşmeler',
        ready: (p) => p.getByRole('heading', { name: 'Özel okul eğitim sözleşmesi' }),
      },
    ])
    expect(errors).toEqual([])
  })

  test('öğrenci Ödemelerim sayfasını açar; öğretmen menüsünde finans yoktur', async ({
    page,
    loginAs,
  }) => {
    const errors = watchConsole(page)
    await loginAs('ogrenci')
    await sweepPages(page, [
      {
        path: '/ogrenci/odemelerim',
        heading: 'Ödemelerim',
        ready: (p) => tableRow(p, 'Ödemelerim', 'Ödendi'),
      },
    ])
    await loginAs('ogretmen')
    await page.goto('/ogretmen/dashboard')
    await expectMenuWithout(page, FINANCE_LINKS)
    await expectNoHorizontalOverflow(page)
    expect(errors).toEqual([])
  })

  test('IST-107: yönetici taksit panelinden cari ekstreyi açar', async ({ page, loginAs }) => {
    const errors = watchConsole(page)
    await loginAs('yonetici')
    await page.goto('/yonetici/finans')
    await page.getByLabel('Tabloda ara').fill('Deniz Yılmaz')
    await tableRow(page, INVOICES, '1. taksit')
      .getByRole('button', { name: 'Deniz Yılmaz 1. taksit detayını aç' })
      .click()
    const detail = page.getByRole('dialog', { name: 'Taksit detayı' })
    await detail.getByRole('button', { name: 'Cari ekstre' }).click()
    const preview = page.getByRole('dialog', { name: 'Cari ekstre · Önizleme' })
    await expect(preview.getByText('cari-ekstre-s1.pdf')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    expect(errors).toEqual([])
  })
})

test.describe('ON-048 finans duman: akışlar', () => {
  test('DOM-FIN-030, DOM-FIN-050: yönetici taksidi tahsil eder, dekont PDF açılır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s10'] })
    const errors = watchConsole(page)
    await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))

    await page.goto('/yonetici/finans')
    await page.getByLabel('Tabloda ara').fill('Emir Kaya')
    const row = tableRow(page, INVOICES, '6. taksit')
    await row.getByRole('button', { name: 'Emir Kaya 6. taksiti tahsil et' }).click()
    const dialog = page.getByRole('dialog', { name: 'Tahsilat kaydet' })
    await dialog.getByLabel('Ödeme yöntemi').selectOption('Banka havalesi')
    await dialog.getByLabel('İşlem referansı').fill(`E2E-${randomUUID()}`)
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()
    await expect(toast(page, 'Tahsilat kaydedildi.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('Ödendi')
    expect(await invoiceOf(client, 'inv-s10-5')).toMatchObject({ method: 'Banka havalesi' })

    await page.goto('/yonetici/finans?gorunum=tahsilatlar')
    await tableRow(page, 'Tahsilat geçmişi', 'Emir Kaya')
      .getByRole('button', { name: /numaralı dekontu görüntüle/ })
      .click()
    const receipt = page.getByRole('dialog', { name: /Tahsilat dekontu/ })
    await expect(receipt.getByText(/\.pdf$/)).toBeVisible()
    await expectNoHorizontalOverflow(page)
    expect(errors).toEqual([])
  })

  test('DOM-FIN-002: yönetici tarife taslağı açar ve yayımlar; ön büro yayındaki tarifeyi görür', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const errors = watchConsole(page)
    await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/finans?gorunum=tarife')
    await page.getByRole('button', { name: 'Yeni tarife' }).click()
    const editor = page.getByRole('dialog', { name: 'Yeni tarife' })
    await editor.getByLabel('Tutar (₺)', { exact: true }).fill('250.000,00')
    await editor.getByLabel('MEBBİS onaylı tutar (₺)').fill('250.000,00')
    await editor.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(toast(page, 'Tarife kaydedildi.')).toBeVisible()
    await page.getByRole('button', { name: /tarifesini yayımla/ }).click()
    await page
      .getByRole('dialog', { name: 'Tarifeyi yayımla' })
      .getByRole('button', { name: 'Tarifeyi yayımla' })
      .click()
    await expect(toast(page, 'Tarife yayımlandı.')).toBeVisible()
    await expect(tableRow(page, 'Ücret tarifeleri', 'Yayında')).toBeVisible()

    await loginAs(school.user('onburo'))
    await page.goto('/onburo/tahsilat-takip?gorunum=tarife')
    await expect(tableRow(page, 'Ücret tarifeleri', 'Yayında')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    expect(errors).toEqual([])
  })

  test('DOM-FIN-010: yönetici imza yetkilisini işler, ödeyici veli sözleşmeyi onaylar', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['veli'], childIds: ['s1'] })
    const admin = await api(school.user('yonetici'))
    // Veli hesabı öğrencinin ödeyicisi yapılır (DOM-ILT-074); kurulum API'den.
    const guardians = await admin.get('/api/v1/students/s1/guardians')
    expect(guardians.status).toBe(200)
    const link = (
      guardians.body as { data: { id: string; membershipId: string | null; rowVersion?: number }[] }
    ).data.find((item) => item.membershipId !== null)
    expect(link).toBeDefined()
    const payer = await apiRequest(
      admin.context,
      'PATCH',
      `/api/v1/students/s1/guardians/${String(link?.id)}`,
      { isPayer: true },
      { 'if-match': `"${String(link?.rowVersion ?? 1)}"` },
    )
    expect(payer.status, JSON.stringify(payer.body)).toBe(200)
    const errors = watchConsole(page)

    await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/finans?gorunum=sozlesmeler')
    await tableRow(page, 'Sözleşmeler', 'Deniz Yılmaz')
      .getByRole('button', { name: 'Deniz Yılmaz Sürüm 1 sözleşme ayrıntısını aç' })
      .click()
    const panel = page.getByRole('dialog', { name: 'Sözleşme ayrıntısı' })
    await panel.getByRole('button', { name: 'İmza yetkilisini işle' }).click()
    const form = panel.getByRole('form', { name: 'İmza yetkilisi' })
    await form.getByLabel('Ad soyad').fill('Duman Kurucu')
    await form.getByLabel('Sıfat').selectOption({ label: 'Kurucu temsilcisi' })
    await form.getByRole('button', { name: 'İmza yetkilisini kaydet' }).click()
    await expect(toast(page, 'İmza yetkilisi işlendi.')).toBeVisible()
    await expect(panel).toContainText('Ödeyici onayı bekleniyor')

    await loginAs(school.user('veli'))
    await page.goto('/veli/sozlesmeler?cocuk=s1')
    await page.getByRole('button', { name: /Sürüm 1 incele ve onayla/ }).click()
    const approval = page.getByRole('dialog', { name: 'Sözleşme onayı' })
    await approval
      .getByLabel('Sözleşmeyi ve ödeme planını okudum, ödeyici olarak onaylıyorum')
      .check()
    await approval.getByRole('button', { name: 'Sözleşmeyi onayla' }).click()
    await expect(toast(page, 'Sözleşme onaylandı.')).toBeVisible()
    await expect(approval).toBeHidden()
    await expect(page.getByRole('list', { name: 'Belgeler' })).toContainText('Onaylandı')
    await expectNoHorizontalOverflow(page)

    const contract = await admin.get('/api/v1/collections/contracts/contract-s1')
    expect(
      (contract.body as { data: { record: { approval?: { method: string } } } }).data.record
        .approval?.method,
    ).toBe('electronic')
    expect(errors).toEqual([])
  })
})
