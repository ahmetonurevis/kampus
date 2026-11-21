import { randomUUID } from 'node:crypto'

import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Servis seferi ve biniş-iniş (ON-145; DOM-FIN-149; IST-144). Kural dalları birim ve API
// testlerindedir (`tests/finance-transport-trips.test.ts`, `apps/api/test/finance-transport-trips.test.ts`);
// burada rehber ön büro 390 px ekranda seferi başlatır, öğrenciyi bindi/gelmedi işaretler, binen
// öğrencinin inişi işaretlenmeden sefer kapanmaz (K-504), iniş işaretlenince kapanır (K-502).
// Araç, güzergâh ve atamalar API'den kurulur.

const DESK = '/onburo/tahsilat-takip'
const TRANSPORT = '/api/v1/finance/transport'

test.describe('DOM-FIN-149: servis seferleri', () => {
  test('DOM-FIN-149: rehber dar ekranda işaretler; araçta öğrenci varken sefer kapanmaz (K-502, K-504)', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1', 's2'] })
    const admin = await api(school.user('yonetici'), { fresh: true })
    const created = (path: string, body: unknown) =>
      admin.post(path, body, { 'idempotency-key': randomUUID() })
    const hosts = await admin.get('/api/v1/finance/visitor-hosts?pageSize=100')
    expect(hosts.status).toBe(200)
    const guide = (hosts.body as { data: { membershipId: string; role: string }[] }).data.find(
      (host) => host.role === 'onburo',
    )
    expect(guide).toBeDefined()
    const vehicle = await created(`${TRANSPORT}/vehicles`, {
      plate: '34 KMP 145',
      capacity: 10,
      driverName: 'Ali Sürücü',
      driverPhone: '05321234567',
      guideMembershipId: guide?.membershipId,
    })
    expect(vehicle.status).toBe(201)
    const route = await created(`${TRANSPORT}/routes`, {
      name: 'Moda hattı',
      direction: 'morning',
      vehicleId: (vehicle.body as { data: { id: string } }).data.id,
      stops: [
        { name: 'Moda', time: '07:10' },
        { name: 'Bahariye', time: '07:25' },
      ],
    })
    expect(route.status).toBe(201)
    const routeData = (route.body as { data: { id: string; stops: { id: string }[] } }).data
    for (const [studentId, stop] of [
      ['s1', routeData.stops[1]],
      ['s2', routeData.stops[0]],
    ] as const) {
      const assigned = await created(`${TRANSPORT}/routes/${routeData.id}/assignments`, {
        studentId,
        stopId: stop?.id,
      })
      expect(assigned.status).toBe(201)
    }

    const page = await loginAs(school.user('onburo'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${DESK}?gorunum=servis&servis_sekme=seferler`)
    const section = page.getByRole('region', { name: 'Servis' })
    const trips = section.getByRole('list', { name: 'Günün seferleri' })
    await expect(trips).toContainText('2 öğrenci atanmış')
    await section.getByRole('button', { name: 'Moda hattı seferini başlat' }).click()

    const panel = page.getByRole('dialog', { name: 'Sefer' })
    const roster = panel.getByRole('list', { name: 'İşaretleme listesi' })
    await expect(roster).toContainText('1. Moda · 07:10')
    await expect(roster).toContainText('2. Bahariye · 07:25')
    await panel.getByRole('button', { name: 'Deniz Yılmaz: Bindi' }).click()
    await expect(panel.getByRole('listitem', { name: 'Deniz Yılmaz' })).toContainText('Bindi')
    await expect(panel.getByRole('button', { name: 'Deniz Yılmaz: Bindi' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await panel.getByRole('button', { name: 'Ece Yılmaz: Gelmedi' }).click()
    await expect(panel.getByText('1 bindi · 0 indi · 1 gelmedi')).toBeVisible()
    await expect(panel.getByRole('alert')).toContainText('1 öğrencinin inişi işaretlenmedi')
    await expectNoHorizontalOverflow(page)

    await panel.getByRole('button', { name: 'Seferi kapat' }).click()
    await expect(
      page.getByText('kontrol edip inişlerini işaretleyin.', { exact: false }),
    ).toBeVisible()
    await expect(panel.getByText('Sürüyor')).toBeVisible()

    await panel.getByRole('button', { name: 'Deniz Yılmaz: İndi' }).click()
    await expect(panel.getByText('1 bindi · 1 indi · 1 gelmedi')).toBeVisible()
    await panel.getByRole('button', { name: 'Seferi kapat' }).click()
    await expect(panel.getByText('Kapandı')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Seferi kapat' })).toHaveCount(0)

    await expect
      .poll(async () => {
        const list = await admin.get(`${TRANSPORT}/trips`)
        return (list.body as { data: { trip: { status: string } | null }[] }).data[0]?.trip?.status
      })
      .toBe('closed')
  })
})
