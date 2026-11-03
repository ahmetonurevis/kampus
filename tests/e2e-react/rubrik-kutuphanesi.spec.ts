import type { Locator, Page } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// OG-083 (IST-048; DOM-BEC-020, DOM-BEC-022): öğretmen rubrik kütüphanesinde analitik yazma
// rubriği oluşturur, yayımlar, yeni sürüm açar ve yayındaki sürümü arşivler. Şema, ağırlık ve
// eşleme dalları birim testindedir (`apps/web-react/tests/rubric-library-model.test.ts`); yetki,
// kurum ve sürüm kuralları API testindedir (`apps/api/test/rubrics.test.ts`).

const TITLE = 'Paragraf yazma rubriği'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function toast(page: Page, text: string) {
  return page.locator('[data-sonner-toast]').filter({ hasText: text })
}

/** Kriterin CEFR ölçeğini ve altı bant tanımını doldurur. */
async function fillCriterion(criterion: Locator, label: string) {
  await criterion.getByLabel('CEFR ölçeği').fill('Overall written production')
  for (const band of [0, 1, 2, 3, 4, 5])
    await criterion.getByLabel(new RegExp(`^Bant ${band} ·`)).fill(`${label}: bant ${band} tanımı`)
}

test('IST-048, DOM-BEC-022: öğretmen rubrik oluşturur, yayımlar, yeni sürüm açar ve yayındakini arşivler', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen'] })
  await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/rubrik-kutuphanesi')
  await expect(page.getByRole('heading', { name: 'Rubrik Kütüphanesi', level: 1 })).toBeVisible()
  await expect(page.getByText('Henüz rubrik yok. Yeni rubrik ekleyerek başlayın.')).toBeVisible()

  // Oluşturma: boş gönderim core hatalarını alanlara yazar, istek gitmez.
  await page.getByRole('button', { name: 'Yeni rubrik', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Yeni rubrik' })
  await create.getByRole('button', { name: 'Taslağı kaydet' }).click()
  await expect(create.getByText('Başlık en az 3 karakter olmalıdır.')).toBeVisible()

  await create.getByLabel('Başlık', { exact: true }).fill(TITLE)
  await fillCriterion(create.getByRole('group', { name: 'Kriter 1' }), 'Görev')
  await fillCriterion(create.getByRole('group', { name: 'Kriter 2' }), 'Tutarlılık')
  await create.getByRole('group', { name: 'Kriter 1' }).getByLabel('Ağırlık').fill('2')
  await create.getByRole('button', { name: 'Taslağı kaydet' }).click()
  await expect(toast(page, 'Rubrik taslağı kaydedildi.')).toBeVisible()
  await expect(create).toBeHidden()

  // Kaydedilen rubriğin ayrıntısı sağ panelde: kriter × bant tablosu, ağırlık payı, eşleme.
  const panel = page.getByRole('dialog', { name: TITLE })
  await expect(panel.getByRole('definition').filter({ hasText: /^v1$/ })).toBeVisible()
  const summary = panel.getByRole('table', { name: 'v1 kriterleri ve ağırlıkları' })
  await expect(
    summary.getByRole('row', { name: /Görevin yerine getirilmesi 2 %67 CEFR B1/ }),
  ).toBeVisible()
  await expect(
    panel
      .getByRole('table', { name: 'Görevin yerine getirilmesi bantları' })
      .getByRole('row', { name: /Bant 3 · Hedef seviyede Görev: bant 3 tanımı/ }),
  ).toBeVisible()

  // Yayım: onay penceresi, sonra durum yayında; açık taslak kalmaz, yeni sürüm açılabilir.
  await panel.getByRole('button', { name: 'Yayınla', exact: true }).click()
  const confirmPublish = page.getByRole('alertdialog', { name: 'Rubriği yayınla' })
  await confirmPublish.getByRole('button', { name: 'Yayınla', exact: true }).click()
  await expect(toast(page, 'v1 yayımlandı')).toBeVisible()
  await expect(confirmPublish).toBeHidden()
  await expect(panel.getByRole('button', { name: 'Yeni sürüm aç' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Yayınla', exact: true })).toHaveCount(0)

  // Yeni sürüm: v1 içeriğiyle başlar; ağırlık değiştirilip taslak olarak kaydedilir.
  await panel.getByRole('button', { name: 'Yeni sürüm aç' }).click()
  const next = page.getByRole('dialog', { name: 'Yeni sürüm' })
  await expect(next.getByLabel('Başlık', { exact: true })).toHaveValue(TITLE)
  await expect(next.getByRole('group', { name: 'Kriter 1' }).getByLabel(/^Bant 5 ·/)).toHaveValue(
    'Görev: bant 5 tanımı',
  )
  await next.getByRole('group', { name: 'Kriter 1' }).getByLabel('Ağırlık').fill('3')
  await next.getByRole('button', { name: 'Taslağı kaydet' }).click()
  await expect(toast(page, 'v2 taslağı açıldı.')).toBeVisible()
  await expect(next).toBeHidden()
  const history = panel.getByRole('region', { name: 'Sürüm geçmişi' })
  await expect(history.getByRole('listitem')).toHaveCount(2)
  await expect(panel.getByRole('button', { name: 'Yayınla', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Yeni sürüm aç' })).toHaveCount(0)

  // Arşiv: yayındaki v1 arşivlenir; v2 taslağı kalır.
  await panel.getByRole('button', { name: 'Arşivle', exact: true }).click()
  const confirmArchive = page.getByRole('alertdialog', { name: 'Rubriği arşivle' })
  await confirmArchive.getByRole('button', { name: 'Arşivle', exact: true }).click()
  await expect(toast(page, 'v1 arşivlendi')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Arşivle', exact: true })).toHaveCount(0)
  // Onaydan sonra odak panelde kalır (açan düğme kayboldu).
  await expect(
    panel.getByRole('group', { name: 'Rubrik işlemleri' }).locator('xpath=..'),
  ).toBeFocused()

  // Kalıcılık API'den: v1 arşivde, v2 taslak ve ağırlık 3.
  const teacher = await api(school.user('ogretmen'))
  const list = (await teacher.get('/api/v1/rubrics')).body as { data: Json[] }
  expect(list.data).toHaveLength(1)
  const rubricId = list.data[0]?.rubric.id as string
  const detail = (await teacher.get(`/api/v1/rubrics/${rubricId}`)).body as { data: Json }
  expect(detail.data.versions.map((v: Json) => [v.versionNumber, v.status])).toEqual([
    [1, 'archived'],
    [2, 'draft'],
  ])
  expect(detail.data.versions[1].criteria[0].weight).toBe(3)

  // Liste baş sürümü gösterir; arama ve durum süzgeci sunucuda.
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(page).not.toHaveURL(/rubrik=/)
  const rows = page.getByRole('table', { name: 'Rubrik kütüphanesi' }).locator('tbody tr')
  await expectEveryRow(rows, [TITLE, 'v2', 'Taslak'])
  await page.getByRole('searchbox').fill('paragraf yazma')
  await expectEveryRow(rows, [TITLE])
  await expectNoHorizontalOverflow(page)
})
