import type { Page } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Gezi ve etkinlik ücretleri ekranı (ON-142; DOM-FIN-098, K-300…K-303). Kural dalları (geç iptal
// kesintisi, kısmi ödeme, kurum iptalinde iade, iade ödemesi, kurumlar arası 404) birim ve API
// testlerindedir (`tests/finance-paid-activities.test.ts`, `apps/api/test/finance-paid-activities.test.ts`);
// burada yöneticinin tanım, katılım, katılım iptali ve kurum iptali akışı ile ön büronun görünümü var.
// Form günleri varsayılan olarak bugündür (Europe/Istanbul): iptal son iptal gününde, tam iade.

const ADMIN_URL = '/yonetici/finans?gorunum=gezi-etkinlik'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=gezi-etkinlik'
const STUDENT = 'Deniz Yılmaz'
const ACTIVITY = 'Test müze gezisi'

const region = (page: Page, name: string | RegExp) => page.getByRole('region', { name })

test.describe('ON-142: gezi ve etkinlik ücretleri ekranı', () => {
  test('DOM-FIN-098: yönetici etkinliği tanımlar, öğrenciyi yazar, katılımı ve etkinliği iptal eder', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)

    const activities = region(page, 'Gezi ve etkinlik ücretleri')
    await activities.getByRole('button', { name: 'Etkinlik tanımla' }).click()
    const form = page.getByRole('dialog', { name: 'Ücretli gezi ya da etkinlik' })
    await form.getByLabel('Ad', { exact: true }).fill(ACTIVITY)
    await form.getByLabel('Kişi başı ücret (₺)').fill('750')
    await form.getByLabel('Kontenjan').fill('10')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toBeHidden()
    await expect(activities.getByRole('cell', { name: ACTIVITY, exact: true })).toBeVisible()
    await expect(activities.getByText('0 / 10')).toBeVisible()

    await activities.getByRole('button', { name: `${ACTIVITY} katılımcıları` }).click()
    const participants = region(page, `${ACTIVITY} · katılımcılar`)
    await participants.getByRole('button', { name: 'Katılımcı ekle' }).click()
    const join = page.getByRole('dialog', { name: 'Katılımcı ekle' })
    await join.getByLabel('Öğrenci', { exact: true }).selectOption({ label: STUDENT })
    await join.getByRole('button', { name: 'Yaz' }).click()
    await expect(join).toBeHidden()
    await expect(participants.getByRole('cell', { name: STUDENT, exact: true })).toBeVisible()
    await expect(participants.getByText('Ödenmedi')).toBeVisible()
    await expect(participants.getByText(/750,00 ₺$/)).toBeVisible()
    await expect(activities.getByText('1 / 10')).toBeVisible()

    await participants.getByRole('button', { name: `${STUDENT} katılımını iptal et` }).click()
    const cancel = page.getByRole('dialog', { name: 'Katılımı iptal et' })
    await expect(cancel.getByText(/tam iade yapılır/)).toBeVisible()
    await cancel.getByRole('button', { name: 'Katılımı iptal et' }).click()
    await expect(cancel).toBeHidden()
    await expect(participants.getByText('İade yok')).toBeVisible()
    await expect(activities.getByText('0 / 10')).toBeVisible()

    await activities.getByRole('button', { name: `${ACTIVITY} etkinliğini iptal et` }).click()
    const stop = page.getByRole('dialog', { name: 'Etkinliği iptal et' })
    await stop.getByLabel('Gerekçe').fill('Müze bakım nedeniyle kapalı')
    await stop.getByRole('button', { name: 'İptal et' }).click()
    await expect(stop).toBeHidden()
    await expect(activities.getByText('İptal edildi')).toBeVisible()
    await expect(participants.getByRole('button', { name: 'Katılımcı ekle' })).toHaveCount(0)
  })

  test('K-300: ön büro listeyi görür, etkinlik tanımlayamaz; dar ekranda taşma yok', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    const desk = await loginAs(school.user('onburo'))
    await desk.setViewportSize({ width: 390, height: 844 })
    await desk.goto(DESK_URL)
    await expect(
      desk.getByRole('heading', { name: 'Gezi ve etkinlik ücretleri', level: 2 }),
    ).toBeVisible()
    await expect(desk.getByText('Henüz ücretli gezi ya da etkinlik yok.')).toBeVisible()
    await expect(desk.getByRole('button', { name: 'Etkinlik tanımla' })).toHaveCount(0)
    await expectNoHorizontalOverflow(desk)
  })
})
