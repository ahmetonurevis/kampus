import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Ayarlar → Eğitim yılı (IST-011; DOM-YTK-063…066). Yazan test kendi kurumunu kurar (`tenant`):
// kurum etkin yılla (dönemsiz) açılır. Başlangıç yılı etkin yıldan iki yıl sonra seçilir; böylece
// 60 günlük erken etkinleştirme kuralı (DOM-YTK-065) gerçek tarihten bağımsız olarak çalışır.

interface YearBody {
  startYear: number
  name: string
  isActive: boolean
  status: string
  startDate: string
  endDate: string
  terms: { name: string; startDate: string; endDate: string }[]
}

async function yearsOf(client: ApiClient): Promise<YearBody[]> {
  const result = await client.get('/api/v1/academic-years')
  expect(result.status).toBe(200)
  return (result.body as { data: YearBody[] }).data
}

const name = (startYear: number) => `${startYear}–${startYear + 1}`

async function fillTerm(page: Page, term: { name: string; start: string; end: string }) {
  const panel = page.getByRole('dialog', { name: 'Dönem ekle' })
  await panel.getByLabel('Dönem adı').fill(term.name)
  await panel.getByLabel('Başlangıç günü').fill(term.start)
  await panel.getByLabel('Bitiş günü').fill(term.end)
  return panel
}

test('yönetici yıl oluşturur, dönem ekler, örtüşmede Türkçe hata görür, etkinleştirmede onay çıkar', async ({
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['yonetici'] })
  const admin = await api(school.user('yonetici'))
  const initial = await yearsOf(admin)
  const current = initial.find((year) => year.isActive)
  expect(current, 'kurum etkin yılla açılır').toBeDefined()
  const target = (current?.startYear ?? 0) + 2
  const next = name(target)

  const page = await loginAs(school.user('yonetici'))
  await page.goto('/yonetici/ayarlar?sekme=egitim-yili')
  await expect(page.getByRole('heading', { name: 'Eğitim yılı ve dönemler' })).toBeVisible()
  const currentBlock = page.getByRole('article', { name: name(current?.startYear ?? 0) })
  await expect(currentBlock.getByText('Etkin yıl')).toBeVisible()
  await expect(currentBlock.getByText('Bu yılda dönem tanımlı değil.')).toBeVisible()

  // Oluşturma: sağ panel, başlangıç yılı değişince günler varsayılan aralığa döner.
  await page.getByRole('button', { name: 'Eğitim yılı oluştur' }).click()
  const create = page.getByRole('dialog', { name: 'Eğitim yılı oluştur' })
  await create.getByLabel('Başlangıç yılı').fill(String(target))
  await expect(create.getByLabel('Başlangıç günü')).toHaveValue(`${target}-09-01`)
  await expect(create.getByLabel('Bitiş günü')).toHaveValue(`${target + 1}-08-31`)
  await expect(create.getByText('1 Eylül')).toBeVisible()
  // Boş başlangıç yılı Türkçe alan hatasıdır; istek atılmaz.
  await create.getByLabel('Başlangıç yılı').fill('')
  await create.getByRole('button', { name: 'Yılı oluştur' }).click()
  await expect(create.getByText('Başlangıç yılını yazın (ör. 2027).')).toBeVisible()
  expect(await yearsOf(admin)).toHaveLength(1)
  await create.getByLabel('Başlangıç yılı').fill(String(target))
  await create.getByRole('button', { name: 'Yılı oluştur' }).click()
  await expect(page.getByText(`${next} eğitim yılı oluşturuldu.`)).toBeVisible()
  await expect(create).toHaveCount(0)

  const block = page.getByRole('article', { name: next })
  await expect(block.getByText('Planlandı')).toBeVisible()
  await expect(block.getByText('Bu yılda dönem tanımlı değil.')).toBeVisible()

  // Dönem ekleme.
  const addButton = block.getByRole('button', { name: `${next} yılına dönem ekle` })
  await addButton.click()
  let panel = await fillTerm(page, {
    name: '1. Dönem',
    start: `${target}-09-14`,
    end: `${target + 1}-01-22`,
  })
  await panel.getByRole('button', { name: 'Kaydet' }).click()
  await expect(page.getByText('Dönem eklendi: 1. Dönem.')).toBeVisible()
  await expect(block.getByRole('table', { name: `${next} dönemleri` })).toContainText('1. Dönem')

  // Örtüşen dönem: Türkçe hata başlangıç gününün altında, panel açık kalır, kayıt eklenmez.
  await addButton.click()
  panel = await fillTerm(page, {
    name: 'Çakışan',
    start: `${target + 1}-01-10`,
    end: `${target + 1}-03-01`,
  })
  await panel.getByRole('button', { name: 'Kaydet' }).click()
  await expect(
    panel.getByText('Dönem, yılın başka bir dönemiyle çakışıyor. Tarihleri değiştirin.'),
  ).toBeVisible()
  await expect(panel.getByLabel('Başlangıç günü')).toBeFocused()
  await expect(page.getByRole('dialog', { name: 'Dönem ekle' })).toBeVisible()
  expect((await yearsOf(admin)).find((year) => year.startYear === target)?.terms).toHaveLength(1)

  // Aynı ad (Türkçe büyük/küçük harf duyarsız) alan altında bildirilir.
  await panel.getByLabel('Dönem adı').fill('1. dönem')
  await panel.getByLabel('Başlangıç günü').fill(`${target + 1}-02-08`)
  await panel.getByLabel('Bitiş günü').fill(`${target + 1}-06-18`)
  await panel.getByRole('button', { name: 'Kaydet' }).click()
  await expect(
    panel.getByText('Bu yılda aynı adlı bir dönem var. Farklı bir ad yazın.'),
  ).toBeVisible()

  await panel.getByLabel('Dönem adı').fill('2. Dönem')
  await panel.getByRole('button', { name: 'Kaydet' }).click()
  await expect(page.getByText('Dönem eklendi: 2. Dönem.')).toBeVisible()
  const table = block.getByRole('table', { name: `${next} dönemleri` })
  await expect(table.getByRole('row')).toHaveCount(3)

  // Etkinleştirme onaydan geçer; geri alınamaz uyarısı ve kapanacak yıl adı yazılır.
  await block.getByRole('button', { name: `${next} yılını etkinleştir` }).click()
  const confirm = page.getByRole('dialog', { name: `${next} eğitim yılını etkinleştir` })
  await expect(
    confirm.getByText(`${name(current?.startYear ?? 0)} eğitim yılı kapanacak`).first(),
  ).toBeVisible()
  await expect(confirm.getByText(/geri alınamaz/).first()).toBeVisible()
  await expect(confirm.getByText(/en erken .* günü etkinleştirilebilir/)).toBeVisible()
  // Başlangıçtan 60 günden önce: sunucu reddeder, Türkçe mesaj çıkar, hiçbir kayıt değişmez.
  await confirm.getByRole('button', { name: 'Etkinleştir' }).click()
  await expect(
    page.getByText(/başlangıç gününden en çok 60 gün önce etkinleştirilebilir/),
  ).toBeVisible()
  await confirm.getByRole('button', { name: 'Vazgeç' }).click()
  await expect(confirm).toHaveCount(0)
  const after = await yearsOf(admin)
  expect(after.find((year) => year.startYear === target)?.status).toBe('planned')
  expect(after.find((year) => year.startYear === current?.startYear)?.isActive).toBe(true)

  await expectNoHorizontalOverflow(page)
})

test('yönetici yılı ve dönemi düzenler, başka yöneticinin değişikliğinde çakışma uyarısı görür, dönemi kaldırır', async ({
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['yonetici'] })
  const admin = await api(school.user('yonetici'))
  const current = (await yearsOf(admin)).find((year) => year.isActive)
  const target = (current?.startYear ?? 0) + 2
  const label = name(target)
  const created = await admin.context.post('/api/v1/academic-years', {
    data: {
      startYear: target,
      terms: [{ name: 'Güz', startDate: `${target}-09-14`, endDate: `${target + 1}-01-22` }],
    },
    headers: { 'idempotency-key': randomUUID() },
  })
  expect(created.status()).toBe(201)

  const page = await loginAs(school.user('yonetici'))
  await page.goto('/yonetici/ayarlar?sekme=egitim-yili')
  const block = page.getByRole('article', { name: label })

  // Yıl tarihleri: Europe/Istanbul gösterimi ve YYYY-AA-GG gönderimi.
  await block.getByRole('button', { name: `${label} yılını düzenle` }).click()
  const edit = page.getByRole('dialog', { name: 'Eğitim yılını düzenle' })
  await edit.getByLabel('Bitiş günü').fill(`${target + 1}-08-30`)
  await expect(edit.getByText('30 Ağustos')).toBeVisible()
  await edit.getByRole('button', { name: 'Kaydet' }).click()
  await expect(page.getByText(`${label} eğitim yılı güncellendi.`)).toBeVisible()
  await expect(block.getByText(`1 Eyl ${target} – 30 Ağu ${target + 1}`)).toBeVisible()
  const saved = (await yearsOf(admin)).find((year) => year.startYear === target)
  expect(saved?.endDate).toBe(`${target + 1}-08-30`)

  // Dönemin dışına taşan yıl aralığı alanın altında Türkçe bildirilir.
  await block.getByRole('button', { name: `${label} yılını düzenle` }).click()
  await edit.getByLabel('Bitiş günü').fill(`${target + 1}-01-01`)
  await edit.getByRole('button', { name: 'Kaydet' }).click()
  await expect(
    edit.getByText('Dönem, eğitim yılının başlangıç ve bitiş günleri arasında olmalı.'),
  ).toBeVisible()
  await edit.getByRole('button', { name: 'Vazgeç' }).click()
  await expect(edit).toHaveCount(0)

  // Başka yönetici yılı değiştirir (sürüm artar): kayıt güncel hâl yüklenene dek gönderilmez.
  await block.getByRole('button', { name: 'Dönemi düzenle: Güz' }).click()
  const term = page.getByRole('dialog', { name: 'Dönemi düzenle' })
  await term.getByLabel('Dönem adı').fill('Birinci dönem')
  const version = (await admin.get('/api/v1/academic-years')).body as {
    data: { startYear: number; rowVersion: number }[]
  }
  const other = await admin.context.patch(`/api/v1/academic-years/${target}`, {
    data: { endDate: `${target + 1}-08-29` },
    headers: {
      'if-match': `"${version.data.find((year) => year.startYear === target)?.rowVersion}"`,
      'idempotency-key': randomUUID(),
    },
  })
  expect(other.status()).toBe(200)
  await term.getByRole('button', { name: 'Kaydet' }).click()
  await expect(term.getByRole('button', { name: 'Güncel kaydı yükle' })).toBeVisible()
  expect((await yearsOf(admin)).find((year) => year.startYear === target)?.terms[0]?.name).toBe(
    'Güz',
  )
  await term.getByRole('button', { name: 'Güncel kaydı yükle' }).click()
  await expect(term.getByLabel('Dönem adı')).toHaveValue('Güz')
  await term.getByLabel('Dönem adı').fill('Birinci dönem')
  await term.getByRole('button', { name: 'Kaydet' }).click()
  await expect(page.getByText('Dönem güncellendi: Birinci dönem.')).toBeVisible()

  // Kaldırma onaydan geçer; vazgeçmek hiçbir şeyi değiştirmez.
  await block.getByRole('button', { name: 'Dönemi kaldır: Birinci dönem' }).click()
  const confirm = page.getByRole('dialog', { name: 'Dönemi kaldır: Birinci dönem' })
  await confirm.getByRole('button', { name: 'Vazgeç' }).click()
  await expect(confirm).toHaveCount(0)
  expect((await yearsOf(admin)).find((year) => year.startYear === target)?.terms).toHaveLength(1)
  await block.getByRole('button', { name: 'Dönemi kaldır: Birinci dönem' }).click()
  await confirm.getByRole('button', { name: 'Dönemi kaldır' }).click()
  await expect(page.getByText('Dönem kaldırıldı: Birinci dönem.')).toBeVisible()
  await expect(block.getByText('Bu yılda dönem tanımlı değil.')).toBeVisible()
  expect((await yearsOf(admin)).find((year) => year.startYear === target)?.terms).toHaveLength(0)
})
