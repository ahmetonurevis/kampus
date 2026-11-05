import { expect, test } from './support/fixtures.ts'

// ON-117, DOM-KAY-012: kesin kayıttan sonra veli bilgisini düzeltme (aday detayı, kayıtlı aday).
test.describe('veli bilgisi düzeltme', () => {
  test('ön büro kayıtlı adayın velisinin telefonunu ve e-postasını düzeltir; değişiklik kalıcıdır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['onburo'],
      students: ['s1'],
      collections: ['prospects', 'parents'],
    })
    await loginAs(school.user('onburo'))
    await page.goto('/onburo/aday/pr15')
    await page.getByRole('button', { name: 'Veli bilgisini düzelt' }).click()
    const form = page.getByRole('form', { name: 'Veli bilgisini düzelt' })
    await form.getByLabel('Telefon').fill('5551112233')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByText('Telefonu 05XXXXXXXXX biçiminde girin.')).toBeVisible()
    await form.getByLabel('Telefon').fill('05551112233')
    await form.getByLabel('E-posta (isteğe bağlı)').fill('Veli.Yeni@example.com')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Veli bilgisi güncellendi.')).toBeVisible()

    const admin = await api(school.user('yonetici'))
    const stored = await admin.get('/api/v1/collections/parents/p1')
    expect(stored.status).toBe(200)
    const record = (stored.body as { data: { record: { phone?: string; email?: string } } }).data
      .record
    expect(record.phone).toBe('05551112233')
    expect(record.email).toBe('veli.yeni@example.com')

    await page.getByRole('button', { name: 'Veli bilgisini düzelt' }).click()
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByText('Veli bilgisinde değişiklik yok.')).toBeVisible()
  })
})
