import { randomUUID } from 'node:crypto'

import { dayKey } from '../../packages/school-core/src/lib/format.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Günlük ilaç çizelgesi (ON-161; DOM-FIN-152). Durum, gecikme payı, zincir ve kural dalları birim
// ve API testlerindedir (`tests/finance-infirmary-schedule.test.ts`,
// `apps/api/test/finance-infirmary-schedule.test.ts`); burada yönetici dar ekranda "Bugünkü
// ilaçlar"ı erişim gerekçesiyle açar (DOM-FIN-156), bir dozu gerekçeyle atlar (K-512), diğerini
// verir ve uygulamayı gerekçeyle iptal eder; iptal edilen kayıt görünür kalır, doz yeniden
// verilebilir (K-513). Veli atlanan dozu gerekçesiyle API'den okur. Saatler gerçek saate göre
// durum değiştirebildiğinden durum rozeti burada doğrulanmaz.

const ADMIN = '/yonetici/finans?gorunum=revir'

test.describe('DOM-FIN-152: ilaç çizelgesi', () => {
  test('DOM-FIN-152: doz atlanır, verilir ve yönetici uygulamayı iptal eder; veli gerekçeyi görür (K-511, K-512, K-513)', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'veli'], students: ['s1'], childIds: ['s1'] })
    const guardian = await api(school.user('veli'))
    const admin = await api(school.user('yonetici'))
    const today = dayKey(new Date())
    const created = await guardian.context.post('/api/v1/finance/infirmary/medication-consents', {
      data: {
        studentId: 's1',
        medicationName: 'Parol şurup',
        dose: '5 ml',
        times: ['08:00', '16:00'],
        startDate: today,
        endDate: today,
      },
      headers: { 'idempotency-key': randomUUID() },
    })
    expect(created.status()).toBe(201)
    const consent = (await created.json()) as { data: { id: string; version: number } }
    const approved = await admin.context.post(
      `/api/v1/finance/infirmary/medication-consents/${consent.data.id}/approve`,
      {
        data: {},
        headers: {
          'idempotency-key': randomUUID(),
          'if-match': `"${String(consent.data.version)}"`,
        },
      },
    )
    expect(approved.status()).toBe(200)

    const page = await loginAs(school.user('yonetici'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(ADMIN)
    const section = page.getByRole('region', { name: 'Revir' })
    await section.getByRole('button', { name: 'Gerekçe seç' }).click()
    const reason = page
      .getByRole('dialog', { name: 'Sağlık bilgisine erişim gerekçesi' })
      .getByRole('form', { name: 'Erişim gerekçesi' })
    await reason.getByLabel('Erişim gerekçesi').selectOption({ label: 'Diğer' })
    await reason.getByLabel('Açıklama').fill('Günlük ilaç turu')
    await reason.getByRole('button', { name: 'Bilgiyi aç' }).click()
    const list = section.getByRole('list', { name: 'Bugünkü ilaçlar' })
    await expect(list).toContainText('Parol şurup')

    await section.getByRole('button', { name: /08:00 dozunu atla/ }).click()
    const skipDialog = page.getByRole('dialog', { name: 'Dozu atla' })
    await skipDialog.getByLabel('Gerekçe').selectOption({ label: 'Öğrenci reddetti' })
    await skipDialog.getByRole('button', { name: 'Atlandı olarak kaydet' }).click()
    await expect(skipDialog).toBeHidden()
    await expect(list).toContainText('Atlandı · Öğrenci reddetti')
    await expect(section.getByRole('button', { name: /08:00 dozunu atla/ })).toHaveCount(0)

    const give = section.getByRole('button', { name: /16:00 dozunu verildi olarak kaydet/ })
    await give.click()
    await expect(give).toHaveCount(0)
    await section.getByRole('button', { name: /16:00 kaydını düzelt/ }).click()
    const correction = page
      .getByRole('dialog', { name: 'Uygulamayı düzelt' })
      .getByRole('form', { name: 'Kaydı düzelt' })
    await correction.getByLabel('İşlem').selectOption({ label: 'İptal' })
    await correction.getByLabel('Düzeltme gerekçesi').fill('Yanlış öğrenciye yazıldı')
    await correction.getByRole('button', { name: 'Kaydı iptal et' }).click()
    await expect(page.getByRole('dialog', { name: 'Uygulamayı düzelt' })).toBeHidden()
    await expect(section.getByRole('list', { name: /16:00 iptal edilen kayıtlar/ })).toContainText(
      'İptal: Verildi',
    )
    await expect(give).toBeVisible()
    await expectNoHorizontalOverflow(page)

    const doses = await guardian.context.get('/api/v1/finance/infirmary/my-medication-doses')
    expect(doses.status()).toBe(200)
    const body = (await doses.json()) as { data: { kind: string; skipReason: string | null }[] }
    expect(body.data.map((row) => `${row.kind} ${String(row.skipReason)}`)).toEqual([
      'skip refused',
    ])
  })
})
