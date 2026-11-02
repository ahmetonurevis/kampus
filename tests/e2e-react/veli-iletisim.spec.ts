import { expect, test } from './support/fixtures.ts'

// Veli iletişim bilgisi (DOM-YTK-055): öğretmen sınıf özetinde velinin telefonunu ve e-postasını
// maskeli görür, "Göster" ile tam değeri açar. Kurum teste özeldir (`tenant`): Selin Kaya (t1)
// 7-A'nın (c1) sınıf rehber öğretmenidir, Deniz Yılmaz (s1) 7-A öğrencisidir. Velinin iletişim
// bilgisi seed'de olmadığından teste özel veli kaydı eklenir.

const PHONE = '05321234512'
const EMAIL = 'kerem.yilmaz@example.com'
const PARENT = {
  id: 'p-kv1',
  name: 'Kerem Yılmaz',
  studentIds: ['s1'],
  phone: PHONE,
  email: EMAIL,
}
const SUBJECT = 'Kerem Yılmaz (Deniz Yılmaz velisi)'

test.describe('veli iletişimi', () => {
  test('DOM-YTK-055: öğretmen sınıf özetinde maskeli görür, klavyeyle açar; açılış denetim kaydına değersiz düşer', async ({
    page,
    tenant,
    loginAs,
    api,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen'],
      students: ['s1'],
      records: [{ collection: 'parents', data: PARENT }],
    })
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/siniflarim?sinif=c1')
    const dialog = page.getByRole('dialog', { name: 'Sınıf özeti' })
    const contacts = dialog.getByRole('list', { name: 'Veli iletişim bilgileri' })
    await expect(contacts.getByText('0532 *** ** 12')).toBeVisible()
    await expect(contacts.getByText('k***@example.com')).toBeVisible()
    await expect(contacts.getByText(PHONE)).toHaveCount(0)

    // Klavye: düğmeye odaklanıp Enter; aynı düğme "Gizle" olur ve odak yerinde kalır.
    // İstek yanıtı tutulur: düğme meşgulken de odak düğmede kalmalı (`disabled` odağı düşürür).
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/api/v1/parents/*/reveal-contact', async (route) => {
      await held
      await route.continue()
    })
    const show = contacts.getByRole('button', { name: `${SUBJECT} telefonunu göster` })
    await show.focus()
    await page.keyboard.press('Enter')
    await expect(show).toHaveAttribute('aria-busy', 'true')
    await expect(show).toBeFocused()
    release()
    await expect(contacts.getByText(PHONE)).toBeVisible()
    const hide = contacts.getByRole('button', { name: `${SUBJECT} telefonunu gizle` })
    await expect(hide).toBeFocused()
    // E-posta ayrı açılır; telefon açılışı onu açmaz.
    await expect(contacts.getByText(EMAIL)).toHaveCount(0)

    // Açılan değer adrese ve kalıcı depoya düşmez (yalnız bellekte).
    expect(page.url()).not.toContain(PHONE)
    const stored = await page.evaluate(() =>
      JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
    )
    expect(stored).not.toContain(PHONE)

    await page.keyboard.press('Enter')
    await expect(contacts.getByText('0532 *** ** 12')).toBeVisible()
    await expect(contacts.getByText(PHONE)).toHaveCount(0)

    // Denetim kaydı: kim, hangi velinin hangi alanı; değer yok.
    const admin = await api(school.user('yonetici'))
    const audit = await admin.get('/api/v1/audit-events?entityType=parents&pageSize=100')
    expect(audit.status).toBe(200)
    const body = JSON.stringify(audit.body)
    expect(body).toContain('parent_contact.reveal')
    expect(body).toContain('p-kv1')
    expect(body).not.toContain(PHONE)
  })
})
