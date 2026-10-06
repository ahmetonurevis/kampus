import { test, expect } from '@playwright/test'
import { restoreSnapshot } from '../../apps/web/src/lib/demo-persistence.js'

test('Öğrenci özeti listeyi korur; bağlantı, geri/ileri ve odak birlikte çalışır', async ({
  page,
}) => {
  await page.goto('/ogretmen/siniflarim')
  await page.getByLabel('Tabloda ara').fill('Deniz')
  const trigger = page
    .locator('.data-table')
    .getByRole('button', { name: 'Deniz Yılmaz', exact: true })
  await trigger.click()
  const drawer = page.getByRole('dialog', { name: 'Öğrenci özeti' })
  await expect(drawer).toContainText('Deniz Yılmaz')
  await expect(drawer).toContainText('Son ödevler')
  await expect(page).toHaveURL(/ogrenci=s1/)
  await expect(drawer.getByRole('button', { name: 'Pencereyi kapat' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(drawer.getByRole('link', { name: 'Tam öğrenci profilini aç' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(drawer.getByRole('button', { name: 'Pencereyi kapat' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(page.getByLabel('Tabloda ara')).toHaveValue('Deniz')
  await page.goForward()
  await expect(drawer).toBeVisible()
  await page.reload()
  await expect(drawer).toContainText('Deniz Yılmaz')
  await drawer.getByRole('link', { name: 'Tam öğrenci profilini aç' }).click()
  await expect(page).toHaveURL(/\/ogretmen\/ogrenci\/s1$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Taksit panelinde PDF kapandığında odak döner; başka çocuğun kaydı gösterilmez', async ({
  page,
}) => {
  await page.goto('/veli/finans')
  await page.getByRole('button', { name: 'Deniz Yılmaz 1. taksit detayını aç' }).click()
  const drawer = page.getByRole('dialog', { name: 'Taksit detayı', exact: true })
  await expect(drawer).toContainText('24.500,00 ₺')
  const preview = drawer.getByRole('button', { name: 'Dekontu görüntüle' })
  await preview.click()
  await expect(
    page.getByRole('dialog', { name: /Önizleme/ }).locator('.pdf-viewport'),
  ).toHaveAttribute('aria-busy', 'false')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(preview).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const trigger = page.getByRole('button', { name: 'Deniz Yılmaz 1. taksit detayını aç' })
  await trigger.click()
  await preview.click()
  await expect(page.getByRole('dialog', { name: /Önizleme/ })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  const snapshot = restoreSnapshot(
    await page.evaluate(() => localStorage.getItem('kampus-private-school-v1')),
  )
  const otherInvoice = snapshot.invoices.find((invoice) => invoice.studentId === 's2')
  await page.goto(`/veli/finans?detay=${otherInvoice.id}`)
  await expect(drawer).toContainText('Görüntüleyebileceğiniz bir taksit kaydı bulunamadı.')
  await expect(drawer).not.toContainText('Ece Yılmaz')
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/veli\/finans$/)
  const unpaid = snapshot.invoices.find((invoice) => invoice.studentId === 's1' && !invoice.paidAt)
  await page.goto(`/yonetici/finans?detay=${unpaid.id}`)
  await drawer.getByRole('button', { name: 'Tahsil et', exact: true }).click()
  const paymentForm = page.getByRole('dialog', { name: 'Tahsilat kaydet', exact: true })
  await paymentForm.getByLabel('Ödeme yöntemi').selectOption('Nakit')
  await paymentForm.getByRole('button', { name: 'Tahsilatı kaydet' }).click()
  await expect(paymentForm).toHaveCount(0)
  await expect(drawer).toContainText('Ödendi')
  await expect(drawer).toContainText('Nakit')
  await expect(drawer.getByRole('button', { name: 'Tahsil et', exact: true })).toHaveCount(0)
})

test('Sınıf özeti içinden geniş düzenleme açılır; iptal özeti ve listeyi korur', async ({
  page,
}) => {
  await page.goto('/yonetici/subeler')
  await page.getByLabel('Tabloda ara').fill('7-A')
  await page
    .locator('.data-table')
    .getByRole('button', { name: '7-A', exact: true })
    .first()
    .click()
  const drawer = page.getByRole('dialog', { name: 'Sınıf özeti', exact: true })
  await expect(drawer).toContainText('Ders ve öğretmen atamaları')
  await expect(drawer).toContainText('Deniz Yılmaz')
  await drawer.getByRole('button', { name: 'Sınıfı düzenle' }).click()
  await expect(page.getByRole('dialog', { name: 'Sınıf düzenle' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(drawer.getByRole('button', { name: 'Sınıfı düzenle' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Tabloda ara')).toHaveValue('7-A')
})

test('Alt çizgili seçimler klavyeyle değişir; mobil aralık ve masaüstü sayfalar eşleşir', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-15T09:00:00.000Z'))
  await page.goto('/yonetici/subeler')
  const tabs = page.getByRole('group', { name: 'Kayıt durumu' })
  await tabs.getByRole('button', { name: 'Aktif kayıtlar' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.getByRole('button', { name: 'Arşiv', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.keyboard.press('Home')
  await expect(tabs.getByRole('button', { name: 'Aktif kayıtlar' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/yonetici/finans')
  await expect(page.locator('.page-number')).toHaveCount(0)
  await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
  await expect(page.locator('.result-count')).toContainText('9–16')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.locator('.pagination [aria-current]')).toHaveText('2')
  await page.getByLabel('Ödeme durumu').selectOption('Gecikmiş')
  await expect(page.locator('tbody tr')).toHaveCount(8)
  await expect(page.locator('tbody tr')).toContainText(Array(8).fill('Gecikmiş'))
})
