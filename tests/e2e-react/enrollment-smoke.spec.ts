import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import {
  expectMenuWithout,
  istanbulDay,
  sweepPages,
  tableRow,
  toast,
  watchConsole,
} from './support/enrollment-finance-smoke.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// ON-047: kayıt duman testleri. Her rol kendi kayıt sayfalarını açar, temel liste yüklenir;
// kritik iki akış (aday ekle → kesin kayıt, yenileme planı) bir kez uçtan uca ilerler. Konsol
// hatası ve yatay taşma yoktur. Kural dalları burada yinelenmez: adaylar, kayit-islemleri ve
// is-akislari-yenileme spec'lerindedir. Tarama testleri seed kurumunu yalnız okur; yazan akışlar
// kendi kurumunu kurar (`tenant`).

/** Seed adayı pr1 (Alara Güven, Kadıköy, "Yeni aday"). */
const SEED_PROSPECT = { id: 'pr1', name: 'Alara Güven' }
const ENROLLMENT_LINKS = [
  'Aday Öğrenciler',
  'Tanışma Görüşmeleri',
  'Kayıt İşlemleri',
  'Kayıt Yenileme',
  'Kayıt Raporları',
]

/**
 * Kesin kayıt formu ya da (seed kurumunda yayımlanmış tarife yokken) formun yerini alan boş durum
 * (DOM-FIN-002). Form akışı aşağıda tarifeli kendi kurumunda sınanır.
 */
const enrollmentReady = (page: Page) =>
  page
    .getByLabel('Aday öğrenci')
    .or(page.getByRole('heading', { name: 'Yayımlanmış ücret tarifesi yok' }))

interface Item<T> {
  id: string
  record: T
}
async function list<T>(client: ApiClient, path: string): Promise<Item<T>[]> {
  const result = await client.get(`/api/v1/${path}`)
  expect(result.status, path).toBe(200)
  return (result.body as { data: Item<T>[] }).data
}

test.describe('ON-047 kayıt duman: sayfalar', () => {
  test('ön büro aday, görüşme, kesin kayıt ve yenileme sayfalarını açar', async ({
    page,
    loginAs,
  }) => {
    const errors = watchConsole(page)
    await loginAs('onburo')
    await sweepPages(page, [
      {
        path: '/onburo/adaylar',
        heading: 'Aday Öğrenciler',
        ready: (p) => tableRow(p, 'Aday öğrenciler'),
      },
      {
        path: `/onburo/aday/${SEED_PROSPECT.id}`,
        heading: SEED_PROSPECT.name,
        ready: (p) => p.getByRole('link', { name: 'Kesin kayda dönüştür' }),
      },
      {
        path: '/onburo/deneme-dersi-takvimi',
        heading: 'Tanışma Görüşmeleri',
        ready: (p) => tableRow(p, 'Planlanan görüşmeler'),
      },
      {
        path: '/onburo/kayit-islemleri',
        heading: 'Kayıt İşlemleri',
        ready: enrollmentReady,
      },
      {
        path: '/onburo/kayit-yenileme',
        heading: 'Kayıt Yenileme',
        ready: (p) => tableRow(p, 'Kayıt Yenileme'),
      },
    ])
    expect(errors).toEqual([])
  })

  test('yönetici kesin kayıt, yenileme, kayıt raporu ve aday detayını açar', async ({
    page,
    loginAs,
  }) => {
    const errors = watchConsole(page)
    await loginAs('yonetici')
    await sweepPages(page, [
      {
        path: '/yonetici/kayit-islemleri',
        heading: 'Kayıt İşlemleri',
        ready: enrollmentReady,
      },
      {
        path: '/yonetici/kayit-yenileme',
        heading: 'Kayıt Yenileme',
        ready: (p) => tableRow(p, 'Kayıt Yenileme'),
      },
      {
        path: '/yonetici/kayit-raporlari',
        heading: 'Kayıt Raporları',
        ready: (p) => tableRow(p, 'Kanal bazlı dönüşüm'),
      },
      {
        path: `/yonetici/aday/${SEED_PROSPECT.id}`,
        heading: SEED_PROSPECT.name,
        ready: (p) => p.getByRole('link', { name: 'Kesin kayda dönüştür' }),
      },
    ])
    expect(errors).toEqual([])
  })

  test('veli yenileme sayfasını açar; öğretmen ve öğrenci menüsünde kayıt sayfası yoktur', async ({
    page,
    loginAs,
  }) => {
    const errors = watchConsole(page)
    await loginAs('veli')
    await sweepPages(page, [
      {
        path: '/veli/kayit-yenileme?cocuk=s1',
        heading: 'Kayıt Yenileme',
        ready: (p) => p.getByText('Seçili çocuğunuzun kayıtları'),
      },
    ])
    for (const role of ['ogretmen', 'ogrenci'] as const) {
      await loginAs(role)
      await page.goto(`/${role}/dashboard`)
      await expectMenuWithout(page, ENROLLMENT_LINKS)
      await expectNoHorizontalOverflow(page)
    }
    expect(errors).toEqual([])
  })
})

test.describe('ON-047 kayıt duman: akışlar', () => {
  test('DOM-KAY-003, DOM-KAY-035: ön büro aday ekler ve kesin kayda dönüştürür; taksitler oluşur', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], tariffYears: ['current'] })
    const errors = watchConsole(page)
    await loginAs(school.user('onburo'))
    const client = await api(school.user('onburo'))
    const name = 'Duman Kayıt Adayı'

    await page.goto('/onburo/adaylar')
    await page.getByRole('button', { name: 'Yeni aday ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni aday ekle' })
    await form.getByLabel('Aday adı soyadı').fill(name)
    await form.getByLabel('Veli adı soyadı').fill('Duman Velisi')
    await form.getByLabel('Veli telefonu').fill('0555 047 00 01')
    await form.getByLabel('İlgilendiği program').fill('7. Sınıf · Ortaokul')
    await form.getByLabel('Aydınlatma metni adaya gösterildi').check()
    await form.getByRole('button', { name: 'Adayı ekle' }).click()
    await expect(toast(page, 'Aday eklendi.')).toBeVisible()
    await expect(form).toBeHidden()

    await page.getByRole('link', { name, exact: true }).click()
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
    await page.getByRole('link', { name: 'Kesin kayda dönüştür' }).click()
    await expect(page).toHaveURL(/kayit-islemleri\?aday=/)
    const proceed = page.getByRole('button', { name: 'Devam et' })
    await page.getByLabel('Sınıf', { exact: true }).selectOption({ index: 1 })
    await proceed.click()
    await page.getByLabel('Kimlik numarası').fill('10000000146')
    await page.getByLabel('Doğum tarihi').fill('2013-03-01')
    await page.getByLabel('Veli adı soyadı').fill('Duman Velisi')
    await page.getByLabel('Veli telefonu').fill('05550470001')
    await proceed.click()
    await page.getByLabel('Taksit sayısı').selectOption('3')
    await expect(page.getByRole('heading', { name: 'Ödeme planı önizlemesi' })).toBeVisible()
    await proceed.click()
    await page.getByRole('button', { name: 'Kaydı tamamla' }).click()
    await expect(toast(page, 'Kesin kayıt, sözleşme ve taksit planı oluşturuldu.')).toBeVisible()
    await expect(page.getByRole('heading', { name: `${name} kaydedildi` })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    const prospects = await list<{ name: string; stage: string; studentId: string | null }>(
      client,
      'collections/prospects?pageSize=100',
    )
    const saved = prospects.find((item) => item.record.name === name)?.record
    expect(saved?.stage).toBe('Kayıt oldu')
    expect(saved?.studentId).toBeTruthy()
    const invoices = await list(
      client,
      `collections/invoices?pageSize=100&studentId=${String(saved?.studentId)}`,
    )
    expect(invoices).toHaveLength(3)
    expect(errors).toEqual([])
  })

  test('IST-100: yönetici yeni dönem kaydını planlar; yenileme listede, sınıf değişmez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    // s4 (Arda Çelik, 8-A → 9-A) kademe başlangıcına geçer: artış tavanı oranı gerekmez.
    const school = await tenant({
      roles: [],
      students: ['s4'],
      collections: ['renewals'],
      tariffYears: ['current', 'next'],
    })
    const errors = watchConsole(page)
    await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))

    await page.goto('/yonetici/kayit-yenileme')
    await page.getByRole('button', { name: 'Kayıt yenile' }).click()
    const form = page.getByRole('dialog', { name: 'Kayıt yenile' })
    await form.getByLabel('Öğrenci', { exact: true }).selectOption({ label: 'Arda Çelik · 8-A' })
    await form.getByLabel('Yeni sınıf').selectOption({ label: '9-A · Kadıköy Kampüsü' })
    await form.getByLabel('Taksit sayısı').fill('8')
    await form.getByLabel('İlk taksit tarihi').fill(istanbulDay(30))
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await expect(
      form.getByRole('region', { name: 'Yeni dönem ödeme özeti' }).getByText('8 taksit'),
    ).toBeVisible()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()
    await expect(tableRow(page, 'Kayıt Yenileme', 'Arda Çelik')).toContainText('Planlandı')
    await expectNoHorizontalOverflow(page)

    await expect
      .poll(async () => {
        const result = await client.get('/api/v1/finance/renewals?studentId=s4')
        return (result.body as { data: { status: string }[] }).data[0]?.status
      })
      .toBe('Planlandı')
    const student = await client.get('/api/v1/collections/students/s4')
    expect((student.body as { data: { record: { classId: string } } }).data.record.classId).toBe(
      'c4',
    )
    expect(errors).toEqual([])
  })
})
