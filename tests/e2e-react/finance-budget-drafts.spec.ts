import { readFile } from 'node:fs/promises'

import { money } from '../../packages/school-core/src/lib/format.ts'
import type { ApiResult } from './support/api.ts'
import { istanbulDay } from './support/commands.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Bütçe hazırlama ve onay (ON-243; DOM-FIN-093). Kural dalları (revizyon, ret, yeni revizyon,
// kapsam) birim ve API testlerindedir (`tests/finance-budget-drafts.test.ts`,
// `apps/api/test/finance-budget-drafts.test.ts`); burada yönetici birim sorumlusunu atar (K-257),
// ön büro sorumlu taslağı önceki dönemin yanında hazırlar ve gönderir, yönetici onaylar ve
// karşılaştırma CSV'sini indirir; onaylı tutar bütçe satırına yazılır (K-258).

const ADMIN = '/yonetici/finans?gorunum=butce-taslak'
const DESK = '/onburo/tahsilat-takip?gorunum=butce-taslak'
const PREVIOUS_PLAN = 900_000
const DRAFT = 1_200_000

const created = (result: ApiResult) => {
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return (result.body as { data: { id: string; version: number } }).data
}

test('DOM-FIN-093: sorumlu taslak hazırlayıp gönderir, yönetici onaylar ve karşılaştırmayı indirir', async ({
  api,
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: ['onburo'] })
  const deskName = school.user('onburo').name
  const admin = await api(school.user('yonetici'))
  const unit = created(
    await admin.post('/api/v1/finance/cost-centers', {
      code: 'BT',
      name: 'Bilgi işlem',
      type: 'unit',
    }),
  )
  const item = created(
    await admin.post('/api/v1/finance/budget-items', {
      code: 'P-100',
      name: 'Personel',
      kind: 'expense',
    }),
  )
  const last = created(
    await admin.post('/api/v1/finance/budget-periods', {
      name: 'Geçen dönem',
      startDate: istanbulDay(-400),
      endDate: istanbulDay(-40),
    }),
  )
  created(
    await admin.post(`/api/v1/finance/budget-periods/${last.id}/lines`, {
      costCenterId: unit.id,
      itemId: item.id,
      amountCents: PREVIOUS_PLAN,
    }),
  )
  const opened = await admin.post(`/api/v1/finance/budget-periods/${last.id}/open`, undefined, {
    'if-match': `"${String(last.version)}"`,
  })
  expect(opened.status).toBe(200)
  const closed = await admin.post(`/api/v1/finance/budget-periods/${last.id}/close`, undefined, {
    'if-match': `"${String((opened.body as { data: { version: number } }).data.version)}"`,
  })
  expect(closed.status).toBe(200)
  const period = created(
    await admin.post('/api/v1/finance/budget-periods', {
      name: 'Gelecek dönem',
      startDate: istanbulDay(-20),
      endDate: istanbulDay(300),
    }),
  )

  // Yönetici birim sorumlusunu atar.
  const page = await loginAs(school.user('yonetici'))
  await page.goto(ADMIN)
  const owners = page.getByRole('region', { name: 'Bütçe sorumluları' })
  await owners
    .getByLabel('BT · Bilgi işlem sorumlusu', { exact: true })
    .selectOption({ label: `${deskName} · Ön büro` })
  await owners.getByRole('button', { name: 'BT · Bilgi işlem sorumlusunu kaydet' }).click()
  await expect(owners.getByText(deskName, { exact: true })).toBeVisible()

  // Ön büro sorumlu taslağı açar; önceki dönemin planı satırın yanında görünür. `loginAs` aynı
  // sayfanın oturumunu değiştirir.
  const desk = await loginAs(school.user('onburo'))
  await desk.goto(DESK)
  const deskSection = desk.getByRole('region', { name: 'Bütçe taslakları' })
  await expect(deskSection.getByText('Henüz bütçe taslağı yok.')).toBeVisible()
  await deskSection.getByRole('button', { name: 'Yeni taslak' }).click()
  const createForm = desk.getByRole('dialog', { name: 'Yeni bütçe taslağı' })
  await createForm.getByLabel('Bütçe dönemi').selectOption({ label: 'Gelecek dönem' })
  await createForm.getByLabel('Birim').selectOption({ label: 'BT · Bilgi işlem' })
  await createForm.getByRole('button', { name: 'Taslak aç' }).click()
  const deskPanel = desk.getByRole('dialog', { name: 'Bütçe taslağı' })
  const editor = deskPanel.getByRole('form', { name: 'Taslak kalemleri' })
  await editor.getByRole('button', { name: 'Kalem ekle' }).click()
  await editor
    .getByLabel('1. kalem', { exact: true })
    .selectOption({ label: 'P-100 · Personel (Gider)' })
  await editor.getByLabel('1. kalem tutarı (₺)').fill('12.000,00')
  await expect(editor.getByText(`Önceki plan: ${money(PREVIOUS_PLAN)}`)).toBeVisible()
  // Yeni kalem gerekçesiz gönderilemez (K-257).
  await editor.getByRole('button', { name: 'Kaydet ve onaya gönder' }).click()
  await expect(
    editor.getByText('Yeni ya da onaylı tutarı değişen kalemin gerekçesini yazın.'),
  ).toBeVisible()
  await editor.getByLabel('1. kalem gerekçesi').fill('İki yeni teknisyen')
  await editor.getByRole('button', { name: 'Kaydet ve onaya gönder' }).click()
  await expect(deskPanel.getByText('Onay bekliyor', { exact: true })).toBeVisible()
  await expect(deskPanel.getByRole('form', { name: 'Taslak kalemleri' })).toHaveCount(0)
  await expect(deskPanel.getByRole('button', { name: 'Onayla' })).toHaveCount(0)

  // Yönetici onaylar; geçmişte sürüm ve değişen kalem, karşılaştırma CSV'si.
  await loginAs(school.user('yonetici'))
  await page.goto(ADMIN)
  const list = page.getByRole('region', { name: 'Bütçe taslakları' })
  await list.getByRole('button', { name: 'BT · Bilgi işlem taslağını aç' }).click()
  const panel = page.getByRole('dialog', { name: 'Bütçe taslağı' })
  await panel.getByRole('button', { name: 'Onayla' }).click()
  await expect(panel.getByText('Onaylandı', { exact: true }).first()).toBeVisible()
  const history = panel.getByRole('list', { name: 'Revizyon geçmişi' })
  await expect(history.getByText('Onaya gönderildi · 1. sürüm')).toBeVisible()
  await expect(history.getByText(`P-100 · Personel: — → ${money(DRAFT)}`)).toBeVisible()
  const downloading = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'CSV indir' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('butce-taslagi-Gelecek-dönem-BT.csv')
  const csv = await readFile(await download.path(), 'utf8')
  expect(csv).toContain('"Kalem kodu";"Kalem";"Tür";"Önceki dönem planı (₺)"')
  expect(csv).toContain(
    '"P-100";"Personel";"Gider";9000,00;0,00;12000,00;12000,00;12000,00;"İki yeni teknisyen"',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalOverflow(page)

  await expect
    .poll(async () => {
      const lines = await admin.get(`/api/v1/finance/budget-periods/${period.id}/lines`)
      return (lines.body as { data: { itemId: string; amountCents: number }[] }).data.map(
        (line) => [line.itemId, line.amountCents],
      )
    })
    .toEqual([[item.id, DRAFT]])
})
