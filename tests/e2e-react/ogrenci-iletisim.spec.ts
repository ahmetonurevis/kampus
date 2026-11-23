import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { postCommand } from './support/commands.ts'
import { expect, test } from './support/fixtures.ts'

// OG-076: öğrenci duyuru ve mesaj duman testleri (DOM-ILT-001…004, DOM-ILT-014). Kurum teste
// özeldir (`tenant`: Selin Kaya öğretmen, Deniz Yılmaz öğrenci, Ayşe Yılmaz veli); veri API'den
// kurulur, sınanan davranış arayüzden yapılır.

const STUDENT_TITLE = 'E2E öğrenci duyurusu'
const PARENT_ONLY_TITLE = 'E2E yalnız veli duyurusu'
const ANNOUNCEMENT_TEXT = 'Cuma günü kütüphane okuma saati var; kitabınızı getirin.'
const FIRST_MESSAGE = 'Hocam, denklemlerde takıldığım adımı sormak istiyorum.'
const TEACHER_REPLY = 'Tabii, yarın dersten önce birlikte bakalım.'
const PARENT_CHAT = 'Deniz bu hafta ödevini zamanında teslim etti, teşekkürler.'

const publish = (client: ApiClient, title: string, roles: string[]) =>
  postCommand(client, '/api/v1/announcements', {
    title,
    text: ANNOUNCEMENT_TEXT,
    category: 'Etkinlik',
    target: { classIds: ['c1'], roles },
  })

const link = (page: Page, title: string) =>
  page.getByRole('button', { name: `${title} duyurusunu aç` })

test.describe('öğrenci: duyurular', () => {
  test('DOM-ILT-003: kendine yönelik duyuru okunmadı görünür, açınca okundu olur; veliye özel duyuru görünmez', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'],
      students: ['s1'],
    })
    const teacher = await api(school.user('ogretmen'))
    await publish(teacher, STUDENT_TITLE, ['ogrenci'])
    await publish(teacher, PARENT_ONLY_TITLE, ['veli'])

    const page = await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/duyurular')
    await expect(page.getByRole('heading', { name: 'Duyurular', level: 1 })).toBeVisible()
    const row = page.getByRole('row').filter({ has: link(page, STUDENT_TITLE) })
    await expect(row).toContainText('Etkinlik')
    await expect(row).toContainText('Okunmadı')
    // Rol kapsamı: yalnız velilere yönelik duyuru öğrenciye listelenmez.
    await expect(link(page, PARENT_ONLY_TITLE)).toHaveCount(0)
    // Öğrenci yayınlayamaz; okundu oranı yayınlayana özeldir.
    await expect(page.getByRole('button', { name: 'Yeni duyuru' })).toHaveCount(0)
    await expect(page.getByRole('columnheader', { name: 'Okundu' })).toHaveCount(0)

    await link(page, STUDENT_TITLE).click()
    const detail = page.getByRole('dialog', { name: 'Duyuru' })
    await expect(detail.getByText(ANNOUNCEMENT_TEXT)).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Geri çek' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await expect(row).toContainText('Yayında')

    // Okundu bilgisi sunucuda kalıcıdır: yenilemede okunmadı dönmez.
    await page.reload()
    await expect(row).toContainText('Yayında')
    await expect(row).not.toContainText('Okunmadı')
  })
})

test.describe('öğrenci: mesajlar', () => {
  test('DOM-ILT-014: öğrenci öğretmenine yazışma başlatır, yanıtı okunmamış rozetiyle görür; veli yazışması görünmez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'],
      students: ['s1'],
    })
    // Aynı öğretmenin s1 velisiyle yazışması: öğrenci bunu hiçbir yerde görmez.
    await postCommand(await api(school.user('ogretmen')), '/api/v1/conversations', {
      studentId: 's1',
      audience: 'parent',
      text: PARENT_CHAT,
    })

    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/mesajlar')
    await expect(page.getByRole('heading', { name: 'Mesajlar', level: 1 })).toBeVisible()
    await expect(page.getByText('Henüz yazışma yok')).toBeVisible()
    await expect(page.getByText(PARENT_CHAT)).toHaveCount(0)

    await page.getByRole('button', { name: 'Yeni yazışma' }).click()
    const panel = page.getByRole('dialog', { name: 'Yeni yazışma' })
    await panel.getByLabel('Öğretmen').selectOption({ label: 'Selin Kaya' })
    await panel.getByLabel('İlk mesajınız').fill(FIRST_MESSAGE)
    await panel.getByRole('button', { name: 'Yazışmayı başlat' }).click()
    await expect(panel).toBeHidden()
    const log = page.getByRole('log', { name: 'Mesaj akışı' })
    await expect(log.getByText(FIRST_MESSAGE)).toBeVisible()
    // DOM-ILT-014: özel nitelikli bilgi uyarısı yazma alanında sabittir.
    await expect(page.getByRole('note').filter({ hasText: 'Sağlık durumu' })).toBeVisible()

    // Öğretmen yanıtlar; öğrenci yenilemede okunmamış rozetini ve yanıtı görür.
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/mesajlar')
    await page.getByRole('button', { name: /^Deniz Yılmaz.*Öğrenci/ }).click()
    await page.getByLabel('Mesajınız').fill(TEACHER_REPLY)
    await page.getByRole('button', { name: 'Gönder' }).click()
    await expect(page.getByRole('log', { name: 'Mesaj akışı' })).toContainText(TEACHER_REPLY)

    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/mesajlar')
    const row = page.getByRole('button', { name: /Selin Kaya/ })
    await expect(row).toContainText('1 okunmamış mesaj')
    await expect(page.getByRole('list', { name: 'Yazışmalar' }).getByRole('listitem')).toHaveCount(
      1,
    )
    await row.click()
    await expect(page.getByRole('log', { name: 'Mesaj akışı' })).toContainText(TEACHER_REPLY)
    await expect(row).not.toContainText('okunmamış mesaj')
    await expect(page.getByText(PARENT_CHAT)).toHaveCount(0)
  })
})
