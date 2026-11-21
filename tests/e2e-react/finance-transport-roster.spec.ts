import { randomUUID } from 'node:crypto'

import { createSeed } from '../../packages/school-core/src/data/seed.ts'

import type { ApiClient } from './support/api.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Servis listesi PDF'i (ON-148; DOM-FIN-148; IST-028). Kural dalları birim ve API testlerindedir
// (`tests/finance-transport-roster.test.ts`, `apps/api/test/finance-transport-roster.test.ts`);
// burada güzergâh satırındaki "Listeyi indir" amaç seçimiyle PDF indirir: yönetici tam telefonlu
// sürücü listesini dar ekranda alır, ön büro yalnız maskeli kurum içi listeyi görür (K-499…K-501).

const ADMIN = '/yonetici/finans?gorunum=servis'
const DESK = '/onburo/tahsilat-takip?gorunum=servis'
const SEED = createSeed(new Date())
const CLASS = SEED.classes[0]
const PARENT_PHONE = '05321234512'

const records = [
  {
    collection: 'students' as const,
    data: {
      id: 'e2e-s-servis',
      name: 'Servis Öğrencisi',
      classId: CLASS?.id ?? 'c1',
      parentId: 'e2e-p-servis',
      isActive: true,
    },
  },
  {
    collection: 'parents' as const,
    data: {
      id: 'e2e-p-servis',
      name: 'Servis Velisi',
      phone: PARENT_PHONE,
      relationship: 'mother',
      studentIds: ['e2e-s-servis'],
    },
  },
]

async function routeWithStudent(client: ApiClient) {
  const key = () => ({ 'idempotency-key': randomUUID() })
  const vehicle = await client.post(
    '/api/v1/finance/transport/vehicles',
    { plate: '34 SRV 148', capacity: 12, driverName: 'Ali Sürücü', driverPhone: '05329998867' },
    key(),
  )
  expect(vehicle.status).toBe(201)
  const route = await client.post(
    '/api/v1/finance/transport/routes',
    {
      name: 'Moda hattı',
      direction: 'morning',
      vehicleId: (vehicle.body as { data: { id: string } }).data.id,
      stops: [
        { name: 'Moda', time: '07:10' },
        { name: 'Bahariye', time: '07:25' },
      ],
    },
    key(),
  )
  expect(route.status).toBe(201)
  const created = (route.body as { data: { id: string; stops: { id: string }[] } }).data
  const assigned = await client.post(
    `/api/v1/finance/transport/routes/${created.id}/assignments`,
    { studentId: 'e2e-s-servis', stopId: created.stops[1]?.id },
    key(),
  )
  expect(assigned.status).toBe(201)
}

test.describe('DOM-FIN-148: servis listesi PDF', () => {
  test('DOM-FIN-148: yönetici sürücüye verilecek listeyi dar ekranda indirir (K-500)', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [], records })
    await routeWithStudent(await api(school.user('yonetici')))
    const page = await loginAs(school.user('yonetici'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(ADMIN)
    const section = page.getByRole('region', { name: 'Servis' })
    await section.getByRole('button', { name: 'Moda hattı servis listesini indir' }).click()
    const dialog = page.getByRole('dialog', { name: 'Servis listesini indir' })
    await expect(dialog.getByRole('radio')).toHaveCount(2)
    await expectNoHorizontalOverflow(page)
    await dialog.getByLabel(/Sürücüye verilecek liste/).check()
    const downloading = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'PDF indir' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toMatch(/^servis-listesi-SRV-\d{8}-[0-9A-F]{8}\.pdf$/)
    await expect(dialog).toBeHidden()
    const text = await pdfText(file)
    for (const expected of [
      'SERVİS LİSTESİ',
      '34 SRV 148',
      'Ali Sürücü',
      '0532 *** ** 67',
      '2. Bahariye · 07:25',
      'Servis Öğrencisi',
      'Servis Velisi',
      PARENT_PHONE,
      'Servis sorumlusu',
    ])
      expect(text, expected).toContain(expected)
    expect(text).not.toContain('05329998867')
  })

  test('DOM-FIN-148: ön büro yalnız maskeli kurum içi listeyi indirir (K-500, IST-028)', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], records })
    await routeWithStudent(await api(school.user('onburo')))
    const page = await loginAs(school.user('onburo'))
    await page.goto(DESK)
    const section = page.getByRole('region', { name: 'Servis' })
    await section.getByRole('button', { name: 'Moda hattı servis listesini indir' }).click()
    const dialog = page.getByRole('dialog', { name: 'Servis listesini indir' })
    await expect(dialog.getByRole('radio')).toHaveCount(1)
    await expect(dialog.getByLabel(/Sürücüye verilecek liste/)).toHaveCount(0)
    await expect(dialog.getByText('Tam telefonlu sürücü listesini yalnız yönetici')).toBeVisible()
    const downloading = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'PDF indir' }).click()
    const text = await pdfText(await downloading)
    expect(text).toContain('0532 *** ** 12')
    expect(text).toContain('Kurum içi')
    expect(text).not.toContain(PARENT_PHONE)
  })
})
