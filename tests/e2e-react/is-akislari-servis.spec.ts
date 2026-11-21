import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Okul servisi: yönetici kendi kurumunda güzergâhını (kapasite 1) açar ve öğrenci atar; ikinci
// atama kontenjan kuralıyla reddedilir. Kadıköy kampüsü öğrencileri: s5 (Elif Şahin, 9-A) ve s6
// (Mert Aydın, 10-A). Veli okuma testi tohum kurumunda route-b1'i okur.

interface Row<T> {
  id: string
  version: number
  record: T
}
interface RouteRecord {
  title: string
  capacity: number
}
interface AssignmentRecord {
  studentId: string
  routeId: string
  stop: string
}

async function listOf<T>(client: ApiClient, collection: string): Promise<Row<T>[]> {
  const result = await client.get(`/api/v1/collections/${collection}?pageSize=100`)
  expect(result.status).toBe(200)
  return (result.body as { data: Row<T>[] }).data
}

test.describe('okul servisi', () => {
  test('yönetici güzergâh açar, öğrenci atar; kontenjan dolunca reddedilir', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s5', 's6'],
      collections: ['transportRoutes', 'transportAssignments'],
    })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    const title = `E2E hat ${randomUUID().slice(0, 8)}`
    await page.goto('/yonetici/okul-servisi')
    await expect(page.getByRole('heading', { name: 'Okul Servisi', level: 2 })).toBeVisible()
    await page.getByRole('button', { name: 'Güzergâh ekle' }).click()
    const route = page.getByRole('dialog', { name: 'Güzergâh ekle' })
    await route.getByLabel('Güzergâh adı').fill(title)
    await route.getByLabel('Kampüs').selectOption({ label: 'Kadıköy Kampüsü' })
    await route.getByLabel('Araç plakası').fill('34 E2E 01')
    await route.getByLabel('Sürücü adı').fill('Test Sürücü')
    await route.getByLabel('Sürücü telefonu').fill('05551234567')
    await route.getByLabel('Öğrenci kapasitesi').fill('1')
    await route.getByLabel('Duraklar').fill('Moda, Kampüs')
    await route.getByRole('button', { name: 'Kontrol et' }).click()
    await route.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(route).toBeHidden()
    await expect
      .poll(async () =>
        (await listOf<RouteRecord>(client, 'transportRoutes')).some(
          (r) => r.record.title === title,
        ),
      )
      .toBe(true)
    const routeId =
      (await listOf<RouteRecord>(client, 'transportRoutes')).find((r) => r.record.title === title)
        ?.id ?? ''

    async function assign(student: string) {
      // Başarılı işlemden sonra ayrıntı paneli açık kalır; yalnız kapalıysa kayıt açılır.
      const detail = page.getByRole('dialog', { name: title })
      if (!(await detail.isVisible())) {
        await page.getByLabel('Tabloda ara').fill(title)
        await page.getByRole('button', { name: title }).click()
      }
      await detail.getByRole('button', { name: 'Bu servise öğrenci ata' }).click()
      const form = page.getByRole('dialog', { name: 'Servise öğrenci ata' })
      await form.getByLabel('Öğrenci', { exact: true }).selectOption({ label: student })
      await form.getByLabel('Biniş durağı').selectOption({ label: 'Moda' })
      await form.getByRole('button', { name: 'Kontrol et' }).click()
      await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
      return form
    }

    const first = await assign('Elif Şahin · 9-A')
    await expect(first).toBeHidden()
    await expect
      .poll(async () =>
        (await listOf<AssignmentRecord>(client, 'transportAssignments')).find(
          (a) => a.record.studentId === 's5',
        ),
      )
      .toMatchObject({ record: { routeId, stop: 'Moda' } })

    const second = await assign('Mert Aydın · 10-A')
    await expect(page.getByText('Servis kontenjanı dolu.')).toBeVisible()
    await expect(second).toBeVisible()
    const assignments = await listOf<AssignmentRecord>(client, 'transportAssignments')
    expect(assignments.some((a) => a.record.studentId === 's6')).toBe(false)
  })

  test('veli yalnız seçili çocuğunun servis atamasını görür', async ({ loginAs }) => {
    const page = await loginAs('veli')
    await page.goto('/veli/okul-servisi?cocuk=s1')
    await expect(page.getByText('Seçili çocuğunuzun kayıtları')).toBeVisible()
    await page.getByRole('button', { name: 'Moda – Kadıköy' }).click()
    const detail = page.getByRole('dialog', { name: 'Moda – Kadıköy' })
    await expect(detail.getByText('Deniz Yılmaz · Moda')).toBeVisible()
    await expect(detail.getByText('Ece Yılmaz')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Beşiktaş kampüs hattı' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Güzergâh ekle' })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'Güzergâhı düzenle' })).toHaveCount(0)
  })
})
