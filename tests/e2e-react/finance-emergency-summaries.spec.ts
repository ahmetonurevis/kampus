import { randomUUID } from 'node:crypto'

import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Acil durum özeti (ON-165; DOM-FIN-155). Kural dalları birim ve API testlerindedir
// (`tests/finance-emergency-summaries.test.ts`, `apps/api/test/finance-emergency-summaries.test.ts`);
// burada yönetici dar ekranda API'den açılmış özeti gerekçe seçerek açar ve onaylar (onaydan önce
// kartta görünmez; K-520, DOM-FIN-156); kart okuması gerekçe sormaz,
// ön büro sınıf kartını açar ve sınıf PDF'ini indirir (K-521, K-522).

const ADMIN = '/yonetici/finans?gorunum=acil-durum-ozetleri'
const DESK = '/onburo/tahsilat-takip?gorunum=acil-durum-ozetleri'
const ACTION = 'Arı sokmasında adrenalin kalem çantada; 112 ara.'

type ClassRow = { classId: string; className: string; summaryCount: number }

test.describe('DOM-FIN-155: acil durum özeti', () => {
  test('DOM-FIN-155: yönetici onaylar, ön büro sınıf kartını açar ve PDF indirir (K-520…K-522)', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    const admin = await api(school.user('yonetici'))
    const created = await admin.context.post('/api/v1/finance/emergency-summaries', {
      data: { studentId: 's1', actionText: ACTION },
      headers: { 'idempotency-key': randomUUID() },
    })
    expect(created.status()).toBe(201)
    const pending = await admin.context.get('/api/v1/finance/emergency-summaries/students/s1')
    expect(pending.status()).toBe(404)

    const page = await loginAs(school.user('yonetici'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(ADMIN)
    const section = page.getByRole('region', { name: 'Acil durum özetleri' })
    await section.getByRole('button', { name: /acil durum özetini aç/ }).click()
    // Yönetim ayrıntısı taslak ve profil talimatı taşır: erişim gerekçesi sorulur (DOM-FIN-156).
    const reason = page
      .getByRole('dialog', { name: 'Sağlık bilgisine erişim gerekçesi' })
      .getByRole('form', { name: 'Erişim gerekçesi' })
    await reason.getByLabel('Erişim gerekçesi').selectOption({ label: 'Veli görüşmesi' })
    await reason.getByRole('button', { name: 'Bilgiyi aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Acil durum özeti' })
    await expect(panel.getByText(ACTION)).toBeVisible()
    await panel.getByRole('button', { name: 'Onayla ve yayınla' }).click()
    await expect(panel.getByText('Yayında', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Onayla ve yayınla' })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)

    const classes = await admin.context.get('/api/v1/finance/emergency-summaries/classes')
    const rows = ((await classes.json()) as { data: ClassRow[] }).data
    const target = rows.find((row) => row.summaryCount === 1)
    expect(target).toBeDefined()
    if (target === undefined) return

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK)
    const deskSection = desk.getByRole('region', { name: 'Acil durum özetleri' })
    await expect(deskSection.getByRole('heading', { name: 'Özetler' })).toHaveCount(0)
    await deskSection.getByLabel('Sınıf', { exact: true }).selectOption(target.classId)
    await deskSection.getByRole('button', { name: 'Kartları göster' }).click()
    const cards = deskSection.getByRole('list', { name: `${target.className} acil durum kartları` })
    await expect(cards).toContainText(ACTION)
    const downloading = desk.waitForEvent('download')
    await deskSection.getByRole('button', { name: 'Sınıf PDF’i' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toMatch(/^acil-durum-ozetleri-ACL-\d{8}-/)
  })
})
