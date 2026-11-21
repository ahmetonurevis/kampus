import { randomUUID } from 'node:crypto'

import { createApiClient, switchInstitutionApi, type ApiResult } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Servis aracı ve personeli belgeleri (ON-147; DOM-FIN-147; K-496…K-498). Kural dalları birim ve
// API testlerindedir (`tests/finance-transport-documents.test.ts`,
// `apps/api/test/finance-transport-documents.test.ts`); burada yönetici süresi geçmiş muayeneli
// aracı "uygun değil" görür (sekme rozeti, uygunluk listesi, güzergâh "Belge" sütunu), yeni muayene
// belgesini formdan kaydeder ve araç uygun olur (yalnız eksik sürücü belgesi uyarısı kalır).

const ADMIN = '/yonetici/finans'
const PLATE = '34 KMP 147'

/** Europe/Istanbul günü + `offset` gün (`YYYY-MM-DD`). */
function istanbulDay(offset = 0): string {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })
  return new Date(Date.parse(`${today}T00:00:00.000Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

const created = (result: ApiResult) => {
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return (result.body as { data: { id: string } }).data
}

/** Araç, güzergâh ve dört araç belgesi API'den: muayene dün bitti, trafik sigortası 10 gün sonra. */
async function seedVehicle(school: Tenant) {
  const api = await createApiClient({ email: school.user('yonetici').email }, { fresh: true })
  const post = (path: string, body: unknown) =>
    api.post(path, body, { 'idempotency-key': randomUUID() })
  try {
    expect((await switchInstitutionApi(api, school.institutionId)).ok).toBe(true)
    const vehicle = created(
      await post('/api/v1/finance/transport/vehicles', {
        plate: PLATE,
        capacity: 12,
        driverName: 'Ali Sürücü',
        driverPhone: '05321234567',
      }),
    )
    created(
      await post('/api/v1/finance/transport/routes', {
        name: 'Moda hattı',
        direction: 'morning',
        vehicleId: vehicle.id,
        stops: [{ name: 'Moda', time: '07:10' }],
      }),
    )
    const ends = {
      inspection: istanbulDay(-1),
      traffic_insurance: istanbulDay(10),
      seat_insurance: istanbulDay(300),
      school_bus_permit: istanbulDay(300),
    }
    for (const [documentType, endDate] of Object.entries(ends))
      created(
        await post('/api/v1/finance/transport/documents', {
          subject: 'vehicle',
          vehicleId: vehicle.id,
          documentType,
          startDate: istanbulDay(-400),
          endDate,
        }),
      )
  } finally {
    await api.dispose()
  }
}

test.describe('DOM-FIN-147: servis belgeleri', () => {
  test('DOM-FIN-147: süresi geçmiş muayene aracı uygun değil yapar, yeni belge düzeltir (K-496, K-498)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    await seedVehicle(school)
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=servis&servis_sekme=belgeler`)
    const section = page.getByRole('region', { name: 'Servis' })
    const documentsTab = section.getByRole('button', { name: /^Belgeler/ })
    await expect(documentsTab).toContainText('2')
    const fitness = section.getByRole('list', { name: 'Araç uygunluğu' })
    await expect(fitness).toContainText('Uygun değil: Araç muayenesi')
    await expect(section.getByRole('table', { name: 'Servis belgeleri' })).toContainText(
      'Süresi geçti',
    )

    await section.getByRole('button', { name: 'Güzergâhlar', exact: true }).click()
    await expect(section.getByRole('row', { name: /Moda hattı/ })).toContainText('Uygun değil')

    await documentsTab.click()
    await section.getByRole('button', { name: 'Belge ekle' }).click()
    const dialog = page.getByRole('dialog', { name: 'Servis belgesi ekle' })
    const form = dialog.getByRole('form', { name: 'Servis belgesi' })
    await form.getByLabel('Araç').selectOption({ label: PLATE })
    await form.getByLabel('Belge türü').selectOption({ label: 'Araç muayenesi' })
    await form.getByLabel('Belge ya da poliçe no (isteğe bağlı)').fill('MUA-2026')
    await form.getByLabel('Geçerlilik bitişi').fill(istanbulDay(365))
    await form.getByRole('button', { name: 'Belgeyi kaydet' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Belge kaydedildi; önceki belgenin yerine geçti.')).toBeVisible()
    await expect(fitness).toContainText('Eksik belge')
    await expect(fitness).not.toContainText('Uygun değil')
    await expect(documentsTab).toContainText('1')
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
