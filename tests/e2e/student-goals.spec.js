import { test, expect } from '@playwright/test'
import { restoreSnapshot } from '../../packages/school-core/src/lib/demo-persistence.ts'
const stored = async (page) =>
  restoreSnapshot(await page.evaluate(() => localStorage.getItem('kampus-private-school-v1')))
async function save(page) {
  const count = await page.getByRole('dialog').count()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByRole('button', { name: 'Kontrol et', exact: true }).click()
  await dialog.getByRole('button', { name: 'Onayla ve kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(count - 1)
}

test('Öğrenci hedefi yönetici onaylar; veli yorum yazar, öğrenci adımı tamamlar', async ({
  page,
}) => {
  await page.goto('/ogrenci/hedef-plani')
  await page.getByRole('button', { name: 'Hedef belirle', exact: true }).click()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByLabel('Hedef kapsamı', { exact: true }).selectOption({ label: 'Fen Bilimleri' })
  await dialog.getByLabel('Hedef başlığı', { exact: true }).fill('Fen netini yükseltmek')
  await dialog.getByLabel('Hedef net', { exact: true }).fill('18')
  await dialog
    .getByLabel('Hedefin nedeni / öğrenci notu', { exact: true })
    .fill('Deneylerde daha emin olmak istiyorum.')
  await save(page)
  let goal = (await stored(page)).studentGoals.find((g) => g.title === 'Fen netini yükseltmek')
  expect(goal.status).toBe('Onay bekliyor')

  await page.goto('/yonetici/hedef-plani')
  await page.getByRole('button', { name: 'Fen netini yükseltmek', exact: true }).click()
  await page.getByRole('button', { name: 'Hedefi değerlendir', exact: true }).click()
  await page.getByLabel('Geri bildirim (reddetmede zorunlu)', { exact: true }).fill('Uygun hedef.')
  await save(page)
  goal = (await stored(page)).studentGoals.find((g) => g.title === 'Fen netini yükseltmek')
  expect(goal.status).toBe('Aktif')

  await page.goto('/veli/hedef-plani')
  await page.getByRole('button', { name: 'Fen netini yükseltmek', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Uygun hedef.')
  await expect(page.getByRole('button', { name: 'Hedefi kapat', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Yorum ekle', exact: true }).click()
  await page.getByLabel('Yorumunuz', { exact: true }).fill('Evde birlikte çalışacağız.')
  await save(page)
  goal = (await stored(page)).studentGoals.find((g) => g.title === 'Fen netini yükseltmek')
  expect(goal.comments.at(-1)).toMatchObject({ actor: 'veli', text: 'Evde birlikte çalışacağız.' })

  await page.goto('/ogrenci/hedef-plani')
  await page.getByRole('button', { name: /Matematik netimi/ }).click()
  await page.getByRole('button', { name: /Haftalık deneme sorusu çözümü.*tamamla/ }).click()
  await save(page)
  const math = (await stored(page)).studentGoals.find((g) => g.id === 'goal-s1-math')
  expect(math.steps.every((s) => s.done)).toBe(true)
})

test('Hedef modülü kapatılınca menü ve doğrudan sayfa erişimi kapanır', async ({ page }) => {
  await page.goto('/yonetici/hedef-plani')
  await expect(page.getByRole('heading', { name: 'Hedef & Gelişim Planı', level: 1 })).toBeVisible()
  await page.goto('/yonetici/ayarlar')
  await page.getByRole('switch', { name: 'Hedef & Gelişim Planı', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Hedef & Gelişim Planı' })).toHaveCount(0)
  await page.goto('/yonetici/hedef-plani')
  await expect(page.getByRole('heading', { name: 'Hedef & Gelişim Planı', level: 1 })).toHaveCount(
    0,
  )
})
