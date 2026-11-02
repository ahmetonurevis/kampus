import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// IST-009, DOM-YTK-040: kurum modülü kapatınca menü kategorisi, doğrudan adres ve API ucu kapanır;
// açılınca üçü de geri gelir. Bütün uç ve sayfa taraması birim/API testlerindedir
// (`apps/api/test/module-inventory.test.ts`, `apps/web-react/tests/module-closing.test.ts`).

async function setModule(admin: ApiClient, moduleKey: string, enabled: boolean) {
  const settings = await admin.get('/api/v1/modules')
  expect(settings.status).toBe(200)
  const { version } = (settings.body as { data: { version: number } }).data
  const response = await admin.context.patch(`/api/v1/modules/${moduleKey}`, {
    data: { enabled },
    headers: { 'if-match': `"${version}"`, 'idempotency-key': randomUUID() },
  })
  expect(response.status()).toBe(200)
}

test('IST-009: öğrenme kapalıyken öğretmen menüsü, doğrudan adres ve API ucu kapanır, açılınca döner', async ({
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen'] })
  const admin = await api(school.user('yonetici'))
  const teacherApi = await api(school.user('ogretmen'))
  await setModule(admin, 'learning', false)

  const page = await loginAs(school.user('ogretmen'))
  const menu = page.getByRole('navigation', { name: 'Menü' })
  await page.goto('/ogretmen/odevler')
  // Kapalı modülün adresi uyarıyla ana sayfaya döner; boş kalan Öğrenme kategorisi gizlenir.
  await expect(page).toHaveURL(/\/ogretmen\/dashboard$/)
  await expect(page.getByText('Bu modül kurum ayarlarından kapatılmış.')).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Akademik' })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Öğrenme' })).toHaveCount(0)
  await expect(menu.getByRole('link', { name: 'Ödevler & Değerlendirme' })).toHaveCount(0)
  const denied = await teacherApi.get('/api/v1/task-assignments')
  expect(denied.status).toBe(403)
  expect((denied.body as { code: string }).code).toBe('module_disabled')

  await setModule(admin, 'learning', true)
  expect((await teacherApi.get('/api/v1/task-assignments')).status).toBe(200)
  await page.goto('/ogretmen/odevler')
  await expect(page).toHaveURL(/\/ogretmen\/odevler$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ödevler & Değerlendirme' }),
  ).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Öğrenme' })).toBeVisible()
})
