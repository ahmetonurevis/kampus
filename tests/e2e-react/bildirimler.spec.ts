import type { Page } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Bildirim zili (IST-065, DOM-ILT-020, -073): üst çubukta okunmamış sayısı rozeti, popover'da son
// bildirimler, okundu ve "Tümünü okundu işaretle". Kurum teste özeldir (`tenant`); bildirimler
// olayı üreten akışı (rubrik puanı) kurmadan, depoda doğrudan kayıt olarak konur. Öğrenci Deniz
// Yılmaz (s1) ve velisi Ayşe Yılmaz'ın çocukları s1/s2.

const FEEDBACK_TITLE = 'Görevine öğretmen geri bildirimi geldi.'
const DAY = 24 * 3_600_000

function notification(id: string, audience: 'student' | 'parent', ageDays: number) {
  return {
    collection: 'notifications' as const,
    data: {
      id,
      kind: 'feedback_released',
      audience,
      studentId: 's1',
      subject: { type: 'task_submission', id: `sub-${id}` },
      createdAt: new Date(Date.now() - ageDays * DAY).toISOString(),
    },
  }
}

const SEEDED = [
  notification('n-1', 'student', 1),
  notification('n-2', 'student', 2),
  notification('n-3', 'student', 3),
  notification('n-4', 'parent', 1),
]

const bell = (page: Page, name: string | RegExp) => page.getByRole('button', { name })
const popover = (page: Page) => page.getByRole('dialog', { name: 'Bildirimler' })

test.describe('bildirim zili', () => {
  test('IST-065: öğrenci rozeti görür, bildirimi açınca okundu olur ve ilgili sayfaya gider', async ({
    page,
    tenant,
    loginAs,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogrenci'],
      students: ['s1'],
      records: SEEDED,
    })
    await loginAs(school.user('ogrenci'), { fresh: true })
    await page.goto('/ogrenci/dashboard')

    // Yalnız öğrencinin kitlesi: üç bildirim (veliye giden dördüncüsü görünmez).
    const trigger = bell(page, 'Bildirimler, 3 okunmamış')
    await expect(trigger).toBeVisible()
    await expect(page.getByTestId('notification-badge')).toHaveText('3')
    await trigger.click()
    const list = popover(page)
    await expect(list.getByRole('listitem')).toHaveCount(3)

    await list
      .getByRole('link', { name: new RegExp(FEEDBACK_TITLE) })
      .first()
      .click()
    await expect(page).toHaveURL(/\/ogrenci\/odevler/)
    await expect(bell(page, 'Bildirimler, 2 okunmamış')).toBeVisible()
    await expect(page.getByTestId('notification-badge')).toHaveText('2')
  })

  test('IST-065: tümünü okundu işaretleyince rozet kalkar; Esc kapatır ve odak zile döner', async ({
    page,
    tenant,
    loginAs,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogrenci'],
      students: ['s1'],
      records: SEEDED,
    })
    await loginAs(school.user('ogrenci'), { fresh: true })
    await page.goto('/ogrenci/dashboard')

    const trigger = bell(page, 'Bildirimler, 3 okunmamış')
    // Klavye: zil Tab ile odaklanır, Enter açar.
    await trigger.focus()
    await page.keyboard.press('Enter')
    const list = popover(page)
    await expect(list).toBeVisible()
    await list.getByRole('button', { name: 'Tümünü okundu işaretle' }).click()

    await expect(bell(page, 'Bildirimler')).toBeVisible()
    await expect(page.getByTestId('notification-badge')).toHaveCount(0)
    await expect(list.getByRole('button', { name: 'Tümünü okundu işaretle' })).toBeDisabled()
    // Okunmamış süzgeci boş durumu gösterir.
    await list.getByRole('button', { name: 'Okunmamış' }).click()
    await expect(list.getByText('Okunmamış bildirim yok.')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
    await expect(bell(page, 'Bildirimler')).toBeFocused()
  })

  test('DOM-ILT-073: veli kendi kitlesinin bildirimini görür; okuması öğrencininkini etkilemez', async ({
    page,
    tenant,
    loginAs,
    api,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogrenci', 'veli'],
      students: ['s1', 's2'],
      records: SEEDED,
    })
    await loginAs(school.user('veli'), { fresh: true })
    await page.goto('/veli/dashboard')

    const trigger = bell(page, 'Bildirimler, 1 okunmamış')
    await expect(trigger).toBeVisible()
    await trigger.click()
    const list = popover(page)
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect(list.getByText(/için öğretmen geri bildirimi geldi\./)).toBeVisible()
    // Veli sayfasında hedef: akademik takip.
    await list.getByRole('link', { name: /için öğretmen geri bildirimi geldi\./ }).click()
    await expect(page).toHaveURL(/\/veli\/akademik-takip/)
    await expect(bell(page, 'Bildirimler')).toBeVisible()

    // Öğrencinin sayısı değişmedi (okundu kullanıcıya özeldir).
    const student = await api(school.user('ogrenci'), { fresh: true })
    const response = await student.context.fetch('/api/v1/notifications/unread-count')
    expect(((await response.json()) as { data: { unread: number } }).data.unread).toBe(3)
  })

  test('IST-065: dar ekranda popover taşmaz ve dokunma hedefi yeterlidir', async ({
    page,
    tenant,
    loginAs,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogrenci'],
      students: ['s1'],
      records: SEEDED,
    })
    await page.setViewportSize({ width: 390, height: 800 })
    await loginAs(school.user('ogrenci'), { fresh: true })
    await page.goto('/ogrenci/dashboard')
    const trigger = bell(page, 'Bildirimler, 3 okunmamış')
    const box = await trigger.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    await trigger.click()
    await expect(popover(page).getByRole('listitem')).toHaveCount(3)
    await expectNoHorizontalOverflow(page)
  })
})
