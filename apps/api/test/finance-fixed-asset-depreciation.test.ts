import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { DEPRECIATION_REPORT_NOTE } from '@kampus/school-core/lib/finance-fixed-asset-depreciation.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { fixedAssets } from '../src/db/schema/finance-fixed-assets.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Amortisman ön hesabı (DOM-FIN-088; ON-238, IST-142). Demirbaş kaydında faydalı ömür ve yöntem,
 * ayrıntıda yıllık tablo, yıl seçimli kurum raporu ve CSV. Yönetim raporudur: hiçbir uç defter
 * kaydı yazmaz. Her test kendi kurumunu kurar. FIXED_NOW 2026-10-06.
 */

const ASSETS = '/api/v1/finance/fixed-assets'
const REPORT = `${ASSETS}/depreciation-report`
const LAPTOP = {
  name: 'Dizüstü bilgisayar',
  category: 'it',
  location: 'Öğretmenler odası',
  acquisitionValueCents: 4_000_000,
  acquisitionDate: '2024-03-15',
}
const DESK = {
  name: 'Öğretmen masası',
  category: 'furniture',
  location: 'Öğretmenler odası',
  acquisitionValueCents: 1_000_000,
  acquisitionDate: '2025-09-01',
  depreciationMethod: 'declining',
}
const BUS = {
  name: 'Okul servisi',
  category: 'vehicle',
  location: 'Otopark',
  acquisitionValueCents: 150_000_000,
  acquisitionDate: '2026-02-10',
  usefulLifeYears: 8,
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
type Row = { year: number; depreciationCents: number; netCents: number; disposedCents: number }

describe('DOM-FIN-088: amortisman ön hesabı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.88.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const get = (url: string, cookie: string | null, headers: Record<string, string> = {}) =>
    call('GET', url, cookie, undefined, headers)
  const csv = { accept: 'text/csv' }
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.88.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const create = async (t: Tenant, body: Json) => ok(await call('POST', ASSETS, t.admin, body), 201)
  const rowsOf = (institutionId: string) =>
    db.select().from(fixedAssets).where(eq(fixedAssets.institutionId, institutionId))
  const exports = (institutionId: string) =>
    db
      .select({ entityId: auditLog.entityId, actorRole: auditLog.actorRole })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institutionId),
          eq(auditLog.action, 'finance.fixed_asset_depreciation_export'),
        ),
      )

  test('kimliksiz istek 401', async () => {
    assertError(await get(REPORT, null), 401)
    assertError(await get(REPORT, null, csv), 401)
  })

  test('DOM-FIN-088: ön büro, öğretmen, veli ve öğrenci raporu göremez 403; modül kapalıyken 403 (K-189)', async () => {
    const t = await institution()
    await create(t, LAPTOP)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(REPORT, cookie), 403)
      assertError(await get(REPORT, cookie, csv), 403)
    }
    assert.equal((await exports(t.id)).length, 0)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(REPORT, closed.admin), 403, 'module_disabled')
    assertError(await get(REPORT, closed.admin, csv), 403, 'module_disabled')
  })

  test('DOM-FIN-088: kayıtta ömür boşsa kategori önerisi, yöntem normal; ayrıntıda yıllık tablo (K-224, K-225)', async () => {
    const t = await institution()
    const laptop = await create(t, LAPTOP)
    assert.equal(laptop.usefulLifeYears, 4)
    assert.equal(laptop.depreciationMethod, 'normal')
    const depreciation = laptop.depreciation as { rateBasisPoints: number; rows: Row[] }
    assert.equal(depreciation.rateBasisPoints, 2_500)
    assert.deepEqual(
      depreciation.rows.map((row) => [row.year, row.depreciationCents, row.netCents]),
      [
        [2024, 1_000_000, 3_000_000],
        [2025, 1_000_000, 2_000_000],
        [2026, 1_000_000, 1_000_000],
        [2027, 1_000_000, 0],
      ],
    )
    const bus = await create(t, BUS)
    assert.equal(bus.usefulLifeYears, 8)
    const desk = await create(t, DESK)
    assert.equal(desk.usefulLifeYears, 5)
    assert.equal(desk.depreciationMethod, 'declining')
    const detail = ok(await get(`${ASSETS}/${String(desk.id)}`, t.admin))
    assert.deepEqual(
      (detail.depreciation as { rows: Row[] }).rows.map((row) => row.depreciationCents),
      [400_000, 240_000, 144_000, 86_400, 129_600],
    )
    const list = (await get(ASSETS, t.admin)).json() as { data: Json[] }
    assert.deepEqual(
      list.data.map((row) => [row.usefulLifeYears, row.depreciationMethod]),
      [
        [4, 'normal'],
        [8, 'normal'],
        [5, 'declining'],
      ],
    )
    const [row] = (await rowsOf(t.id)).filter((item) => item.id === laptop.id)
    assert.equal(row?.usefulLifeYears, 4)
    assert.equal(row?.depreciationMethod, 'normal')
  })

  test('DOM-FIN-088: geçersiz ömür ve yöntem 400; düzeltmede ömür ve yöntem değişir, kategori değişince ömür kendiliğinden değişmez', async () => {
    const t = await institution()
    for (const body of [
      { ...LAPTOP, usefulLifeYears: 0 },
      { ...LAPTOP, usefulLifeYears: 51 },
      { ...LAPTOP, usefulLifeYears: 2.5 },
      { ...LAPTOP, depreciationMethod: 'sum_of_years' },
    ])
      assertError(await call('POST', ASSETS, t.admin, body), 400, 'validation_failed')
    assert.equal((await rowsOf(t.id)).length, 0)
    const laptop = await create(t, LAPTOP)
    const url = `${ASSETS}/${String(laptop.id)}`
    assertError(
      await call('PATCH', url, t.admin, { usefulLifeYears: null }, ifMatch(laptop.version)),
      400,
    )
    const changed = ok(
      await call(
        'PATCH',
        url,
        t.admin,
        { usefulLifeYears: 2, depreciationMethod: 'declining' },
        ifMatch(laptop.version),
      ),
    )
    assert.equal(changed.usefulLifeYears, 2)
    assert.equal(changed.depreciationMethod, 'declining')
    assert.deepEqual(
      (changed.depreciation as { rows: Row[] }).rows.map((row) => row.depreciationCents),
      [2_000_000, 2_000_000],
    )
    const recategorized = ok(
      await call('PATCH', url, t.admin, { category: 'kitchen' }, ifMatch(changed.version)),
    )
    assert.equal(recategorized.usefulLifeYears, 2)
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'fixed_asset.update')))
    assert.ok(JSON.stringify(audits).includes('usefulLifeYears'))
  })

  test('DOM-FIN-088: hurdaya ayrılan demirbaşta ayrılma yılından sonra satır yok, kalan değer düşer (K-226)', async () => {
    const t = await institution()
    const laptop = await create(t, LAPTOP)
    const scrapped = ok(
      await call(
        'POST',
        `${ASSETS}/${String(laptop.id)}/scrap`,
        t.admin,
        { reason: 'Anakart yandı', scrapDate: '2025-06-01' },
        ifMatch(laptop.version),
      ),
    )
    const rows = (scrapped.depreciation as { rows: Row[] }).rows
    assert.deepEqual(
      rows.map((row) => [row.year, row.depreciationCents, row.disposedCents]),
      [
        [2024, 1_000_000, 0],
        [2025, 1_000_000, 2_000_000],
      ],
    )
    const report2026 = ok(await get(`${REPORT}?year=2026`, t.admin))
    assert.equal((report2026.totals as Json).assetCount, 0)
    const report2025 = ok(await get(`${REPORT}?year=2025`, t.admin))
    assert.deepEqual(report2025.totals, {
      assetCount: 1,
      heldCount: 0,
      disposedCount: 1,
      costCents: 0,
      openingNetCents: 3_000_000,
      additionsCents: 0,
      depreciationCents: 1_000_000,
      disposedCents: 2_000_000,
      accumulatedCents: 0,
      closingNetCents: 0,
    })
  })

  test('DOM-FIN-088: yıl raporu kurum toplamı ve kategori kırılımı verir; yıl boşsa bu yıl; kayıt değişmez', async () => {
    const t = await institution()
    await create(t, LAPTOP)
    await create(t, DESK)
    await create(t, BUS)
    const before = await rowsOf(t.id)
    const report = ok(await get(REPORT, t.admin))
    assert.equal(report.year, 2026)
    assert.equal(report.firstYear, 2024)
    assert.equal('assets' in report, false)
    assert.deepEqual(report.totals, {
      assetCount: 3,
      heldCount: 3,
      disposedCount: 0,
      costCents: 155_000_000,
      openingNetCents: 2_000_000 + 600_000,
      additionsCents: 150_000_000,
      depreciationCents: 1_000_000 + 240_000 + 18_750_000,
      disposedCents: 0,
      accumulatedCents: 3_000_000 + 640_000 + 18_750_000,
      closingNetCents: 155_000_000 - (3_000_000 + 640_000 + 18_750_000),
    })
    assert.deepEqual(
      (report.categories as Json[]).map((row) => [row.category, row.depreciationCents]),
      [
        ['furniture', 240_000],
        ['it', 1_000_000],
        ['vehicle', 18_750_000],
      ],
    )
    const earlier = ok(await get(`${REPORT}?year=2024`, t.admin))
    assert.equal((earlier.totals as Json).assetCount, 1)
    assert.equal((earlier.totals as Json).additionsCents, 4_000_000)
    const future = ok(await get(`${REPORT}?year=2030`, t.admin))
    assert.equal((future.totals as Json).depreciationCents, 18_750_000)
    for (const query of ['?year=1899', '?year=2101', '?year=abc', '?other=1'])
      assertError(await get(`${REPORT}${query}`, t.admin), 400, 'validation_failed')
    // Salt okur: demirbaş satırları ve sürümleri aynı, defter ya da denetim kaydı yazılmaz.
    assert.deepEqual(await rowsOf(t.id), before)
    assert.equal((await exports(t.id)).length, 0)
  })

  test('DOM-FIN-088: CSV not satırıyla iner, denetime yazılır; geçersiz yılda dosya ve kayıt yok (K-227, IST-142)', async () => {
    const t = await institution()
    await create(t, { ...LAPTOP, name: '=Dizüstü' })
    const file = await get(`${REPORT}?year=2025`, t.admin, csv)
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /text\/csv/)
    assert.match(String(file.headers['content-disposition']), /amortisman-on-hesabi-2025\.csv/)
    assert.ok(file.body.startsWith('﻿'))
    const lines = file.body.replace('﻿', '').split('\r\n')
    assert.equal(lines[0], `"Amortisman ön hesabı 2025";"${DEPRECIATION_REPORT_NOTE}"`)
    assert.match(lines[2] ?? '', /^"Demirbaş";"DB-2026-0001";"'=Dizüstü";"Bilgisayar ve bilişim"/)
    assert.ok((lines[2] ?? '').endsWith(';40000,00;30000,00;0,00;10000,00;0,00;20000,00;20000,00'))
    assert.match(lines.at(-1) ?? '', /^"Toplam";"";"1 demirbaş"/)
    assert.deepEqual(await exports(t.id), [
      { entityId: 'fixed-asset-depreciation:2025', actorRole: 'yonetici' },
    ])
    assertError(await get(`${REPORT}?year=1800`, t.admin, csv), 400)
    assert.equal((await exports(t.id)).length, 1)
  })

  test('DOM-FIN-088: başka kurumun demirbaşı raporda ve CSV dosyasında yok', async () => {
    const a = await institution()
    const b = await institution()
    await create(b, LAPTOP)
    const report = ok(await get(`${REPORT}?year=2026`, a.admin))
    assert.equal((report.totals as Json).assetCount, 0)
    assert.equal(report.firstYear, null)
    assert.deepEqual(report.categories, [])
    const file = await get(`${REPORT}?year=2026`, a.admin, csv)
    assert.equal(file.body.includes(LAPTOP.name), false)
    assert.equal((await exports(b.id)).length, 0)
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.version, 1)
  })
})
