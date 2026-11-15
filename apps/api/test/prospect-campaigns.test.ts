import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { RecordData } from '../src/db/collections.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { campaignCodes } from '../src/db/schema/prospect-campaigns.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  nextIp,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Kampanya kodu uçları, adaya kod bağı ve kayıt hunisinin kampanya kırılımı (DOM-KAY-041; IST-117,
 * ON-134). Her test kendi kurumunu kurar. FIXED_NOW 2026-10-06 (Europe/Istanbul 12:00).
 */

const CAMPAIGNS = '/api/v1/prospects/campaign-codes'
const FUNNEL = '/api/v1/prospects/funnel/campaigns'
const PROSPECTS = '/api/v1/prospects'
const SEED = createSeed(FIXED_NOW)
const CAMPAIGN = {
  code: 'yaz26',
  name: 'Yaz okulu sosyal medya ilanı',
  channel: 'social_media',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  costCents: 300_000,
}
const PROSPECT = {
  name: 'Kampanya Aday',
  phone: '05559990101',
  branchId: 'b1',
  interest: '7. Sınıf · Ortaokul',
  source: 'Sosyal medya',
  guardianName: 'Kampanya Veli',
  privacyNoticeVersion: 'aydinlatma-2026-1',
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-KAY-041: kampanya kodu ve huni kırılımı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: nextIp(),
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
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  const key = () => ({ 'idempotency-key': `test-cmp-${String(++serial).padStart(5, '0')}` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
      FIXED_NOW,
    )
    return { id: created.id, adminId: created.admin.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const create = async (t: Tenant, body: Json = CAMPAIGN) =>
    ok(await call('POST', CAMPAIGNS, t.admin, body), 201)
  const rowsOf = (institutionId: string) =>
    db.select().from(campaignCodes).where(eq(campaignCodes.institutionId, institutionId))
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${CAMPAIGNS}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const prospectsOf = (institutionId: string) => loadRecords(db, institutionId, ['prospects'])
  const createProspect = (cookie: string, body: Json) =>
    call('POST', PROSPECTS, cookie, { ...PROSPECT, ...body }, key())

  test('kimliksiz istek 401', async () => {
    assertError(await get(CAMPAIGNS, null), 401)
    assertError(await call('POST', CAMPAIGNS, null, CAMPAIGN), 401)
    assertError(await get(`${CAMPAIGNS}/${randomUUID()}`, null), 401)
    assertError(await call('PATCH', `${CAMPAIGNS}/${randomUUID()}`, null, { name: 'X' }), 401)
    assertError(await call('DELETE', `${CAMPAIGNS}/${randomUUID()}`, null), 401)
    assertError(await get(FUNNEL, null), 401)
  })

  test('DOM-KAY-041, K-291: öğretmen, veli, öğrenci 403; ön büro yönetir; crm kapalıyken 403', async () => {
    const t = await institution()
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(CAMPAIGNS, cookie), 403)
      assertError(await call('POST', CAMPAIGNS, cookie, CAMPAIGN), 403)
      assertError(await get(FUNNEL, cookie), 403)
    }
    assert.equal((await rowsOf(t.id)).length, 0)
    const front = await member(t.id, 'onburo')
    const saved = ok(await call('POST', CAMPAIGNS, front, CAMPAIGN), 201)
    ok(
      await call(
        'PATCH',
        `${CAMPAIGNS}/${String(saved.id)}`,
        front,
        { name: 'Ön büro düzeltti' },
        ifMatch(saved.version),
      ),
    )
    assert.equal((await listOf(front)).meta.total, 1)
    ok(await get(FUNNEL, front))

    const closed = await institution({ enabledModules: { crm: false } })
    assertError(await get(CAMPAIGNS, closed.admin), 403, 'module_disabled')
    assertError(await call('POST', CAMPAIGNS, closed.admin, CAMPAIGN), 403, 'module_disabled')
    assertError(await get(FUNNEL, closed.admin), 403, 'module_disabled')
    assert.equal((await rowsOf(closed.id)).length, 0)
  })

  test('DOM-KAY-041: kampanya kaydedilir; kod büyük harfle, durum bugüne göre; denetime alan adı yazılır', async () => {
    const t = await institution()
    const response = await call('POST', CAMPAIGNS, t.admin, CAMPAIGN)
    const saved = ok(response, 201)
    assert.equal(response.headers.location, `${CAMPAIGNS}/${String(saved.id)}`)
    assert.equal(saved.code, 'YAZ26')
    assert.equal(saved.status, 'usable')
    assert.equal(saved.costCents, 300_000)
    assert.equal(saved.isActive, true)
    const detail = ok(await get(`${CAMPAIGNS}/${String(saved.id)}`, t.admin))
    assert.equal(detail.name, CAMPAIGN.name)
    await create(t, {
      ...CAMPAIGN,
      code: 'FUAR-27',
      name: 'Eğitim fuarı standı',
      channel: 'fair',
      startDate: '2027-01-01',
      endDate: '2027-01-31',
      costCents: null,
    })
    await create(t, { ...CAMPAIGN, code: 'ESKI25', startDate: '2025-01-01', endDate: '2025-02-01' })
    const list = await listOf(t.admin)
    assert.deepEqual(
      list.data.map((row) => [row.code, row.status]),
      [
        ['FUAR-27', 'not_started'],
        ['YAZ26', 'usable'],
        ['ESKI25', 'ended'],
      ],
    )
    assert.deepEqual(
      (await listOf(t.admin, '?status=usable')).data.map((row) => row.code),
      ['YAZ26'],
    )
    assert.equal((await listOf(t.admin, '?channel=fair')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?q=fuar')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?q=sosyal')).meta.total, 2)
    assertError(await get(`${CAMPAIGNS}?sort=code`, t.admin), 400)
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'campaign.create')))
    assert.equal(audits.length, 3)
  })

  test('DOM-KAY-041: biçimsiz kod, ters günler ve bilinmeyen alan 400; kayıt yazılmaz', async () => {
    const t = await institution()
    for (const body of [
      { ...CAMPAIGN, code: 'AB' },
      { ...CAMPAIGN, code: 'KIŞ26' },
      { ...CAMPAIGN, endDate: '2026-09-30' },
      { ...CAMPAIGN, costCents: -5 },
      { ...CAMPAIGN, channel: 'tv' },
      { ...CAMPAIGN, institutionId: t.id },
    ])
      assertError(await call('POST', CAMPAIGNS, t.admin, body), 400, 'validation_failed')
    assert.equal((await rowsOf(t.id)).length, 0)
  })

  test('DOM-KAY-041, K-288: kod kurumda arşivliler dahil tekil (409); başka kurumda serbest', async () => {
    const t = await institution()
    const saved = await create(t)
    assertError(
      await call('POST', CAMPAIGNS, t.admin, { ...CAMPAIGN, code: ' Yaz26 ' }),
      409,
      'campaign_code_exists',
    )
    ok(
      await call(
        'DELETE',
        `${CAMPAIGNS}/${String(saved.id)}`,
        t.admin,
        undefined,
        ifMatch(saved.version),
      ),
    )
    assertError(await call('POST', CAMPAIGNS, t.admin, CAMPAIGN), 409, 'campaign_code_exists')
    assert.equal((await rowsOf(t.id)).length, 1)
    const other = await institution()
    await create(other)
  })

  test('DOM-KAY-041: düzeltme If-Match ister; kod değişmez; birleşik günler 422; pasifleştirme ve arşiv', async () => {
    const t = await institution()
    const saved = await create(t)
    const url = `${CAMPAIGNS}/${String(saved.id)}`
    assertError(await call('PATCH', url, t.admin, { name: 'Yeni ad' }), 400, 'if_match_required')
    assertError(
      await call('PATCH', url, t.admin, { name: 'Yeni ad' }, ifMatch(Number(saved.version) + 3)),
      409,
      'version_conflict',
    )
    assertError(await call('PATCH', url, t.admin, { code: 'YENI26' }, ifMatch(saved.version)), 400)
    assertError(
      await call('PATCH', url, t.admin, { endDate: '2026-09-01' }, ifMatch(saved.version)),
      422,
      'campaign_dates_invalid',
    )
    const [unchangedRow] = await rowsOf(t.id)
    assert.equal(unchangedRow?.version, 1)
    assert.equal(unchangedRow?.endDate, '2026-10-31')
    const updated = ok(
      await call(
        'PATCH',
        url,
        t.admin,
        { isActive: false, costCents: null },
        ifMatch(saved.version),
      ),
    )
    assert.equal(updated.status, 'inactive')
    assert.equal(updated.costCents, null)
    assert.equal(updated.version, 2)
    assert.equal((await listOf(t.admin, '?status=inactive')).meta.total, 1)
    assertError(await call('DELETE', url, t.admin, undefined, ifMatch(1)), 409, 'version_conflict')
    ok(await call('DELETE', url, t.admin, undefined, ifMatch(2)))
    assertError(await get(url, t.admin), 404)
    assert.equal((await listOf(t.admin)).meta.total, 0)
  })

  test('DOM-KAY-041: kodla açılan aday kampanyaya bağlanır; kaynak serbest kalır', async () => {
    const t = await institution()
    const saved = await create(t)
    const response = await createProspect(t.admin, {
      campaignCode: 'yaz26',
      source: 'Kampüs ziyareti',
    })
    assert.equal(response.statusCode, 201, response.body)
    const [stored] = await prospectsOf(t.id)
    assert.equal(stored?.data.campaignId, saved.id)
    assert.equal(stored?.data.campaignCode, 'YAZ26')
    assert.equal(stored?.data.source, 'Kampüs ziyareti')
  })

  test('DOM-KAY-041: bulunmayan, pasif, bitmiş, başlamamış, arşivli ya da başka kurumun kodu 422; aday açılmaz', async () => {
    const t = await institution()
    const other = await institution()
    await create(other, { ...CAMPAIGN, code: 'BASKA26' })
    await create(t, { ...CAMPAIGN, code: 'PASIF26', isActive: false })
    await create(t, {
      ...CAMPAIGN,
      code: 'BITTI26',
      startDate: '2026-09-01',
      endDate: '2026-10-05',
    })
    await create(t, { ...CAMPAIGN, code: 'SONRA26', startDate: '2026-10-07' })
    const archived = await create(t, { ...CAMPAIGN, code: 'ARSIV26' })
    ok(
      await call(
        'DELETE',
        `${CAMPAIGNS}/${String(archived.id)}`,
        t.admin,
        undefined,
        ifMatch(archived.version),
      ),
    )
    for (const [code, error] of [
      ['YOK26', 'campaign_code_not_found'],
      ['BASKA26', 'campaign_code_not_found'],
      ['ARSIV26', 'campaign_code_not_found'],
      ['PASIF26', 'campaign_code_inactive'],
      ['BITTI26', 'campaign_code_ended'],
      ['SONRA26', 'campaign_code_not_started'],
    ] as const) {
      const response = await createProspect(t.admin, { campaignCode: code })
      assertError(response, 422, error)
      assert.deepEqual(response.json().issues?.[0]?.path, ['campaignCode'])
    }
    assertError(await createProspect(t.admin, { campaignCode: 'Ş!' }), 400, 'validation_failed')
    assert.equal((await prospectsOf(t.id)).length, 0)
  })

  async function seedProspects(t: Tenant, campaignId: string, otherId: string) {
    const prospect = (
      id: string,
      overrides: RecordData,
    ): { collection: 'prospects'; id: string; data: RecordData } => ({
      collection: 'prospects',
      id,
      data: {
        id,
        name: `Aday ${id}`,
        phone: '05559990001',
        email: '',
        source: 'Sosyal medya',
        stage: 'Yeni aday',
        studentId: null,
        trialAt: null,
        notes: [],
        createdAt: '2026-10-03T08:00:00.000Z',
        ...overrides,
      },
    })
    await insertMissingRecords(
      db,
      t.id,
      [
        prospect('cp1', { campaignId, campaignCode: 'YAZ26' }),
        prospect('cp2', { campaignId, campaignCode: 'YAZ26', stage: 'Teklif verildi' }),
        prospect('cp3', {
          campaignId,
          campaignCode: 'YAZ26',
          stage: 'Vazgeçti',
          offeredAt: '2026-10-04T08:00:00.000Z',
        }),
        prospect('cp4', {
          campaignId,
          campaignCode: 'YAZ26',
          stage: 'Kayıt oldu',
          studentId: 's1',
        }),
        prospect('cp5', {
          campaignId: otherId,
          campaignCode: 'FUAR26',
          createdAt: '2026-09-20T08:00:00.000Z',
        }),
        prospect('cp6', {}),
      ],
      FIXED_NOW,
    )
  }

  test('DOM-KAY-041, IST-117: kırılım kampanya başına birikimli sayı, dönüşüm ve birim maliyet verir; kimlik taşımaz', async () => {
    const t = await institution()
    const yaz = await create(t)
    const fuar = await create(t, {
      ...CAMPAIGN,
      code: 'FUAR26',
      channel: 'fair',
      startDate: '2026-09-15',
      endDate: '2026-09-30',
      costCents: null,
    })
    await seedProspects(t, String(yaz.id), String(fuar.id))
    const all = ok(await get(FUNNEL, t.admin))
    assert.deepEqual(all.total, {
      prospects: 6,
      meetings: 3,
      offers: 3,
      enrolled: 1,
      conversionRate: 16.7,
    })
    assert.deepEqual(all.uncoded, {
      prospects: 1,
      meetings: 0,
      offers: 0,
      enrolled: 0,
      conversionRate: 0,
    })
    const rows = all.rows as (Json & { campaign: Json })[]
    assert.deepEqual(
      rows.map((row) => [row.campaign.code, row.prospects, row.meetings, row.offers, row.enrolled]),
      [
        ['YAZ26', 4, 3, 3, 1],
        ['FUAR26', 1, 0, 0, 0],
      ],
    )
    assert.equal(rows[0]?.conversionRate, 25)
    assert.equal(rows[0]?.costPerProspectCents, 75_000)
    assert.equal(rows[0]?.costPerEnrollmentCents, 300_000)
    for (const id of ['cp1', 'cp4', 's1', 'Aday'])
      assert.equal(JSON.stringify(all).includes(id), false)

    // Ekim aralığı FUAR26'yı dışlar, YAZ26'nın bütün günlerini kapsar.
    const october = ok(await get(`${FUNNEL}?dateFrom=2026-10-01&dateTo=2026-10-31`, t.admin))
    const octoberRows = october.rows as (Json & { campaign: Json })[]
    assert.deepEqual(
      octoberRows.map((row) => row.campaign.code),
      ['YAZ26'],
    )
    assert.equal(octoberRows[0]?.costPartial, false)
    // Kısmi aralık birim maliyet vermez.
    const partial = ok(await get(`${FUNNEL}?dateFrom=2026-10-03&dateTo=2026-10-31`, t.admin))
    const partialRow = (partial.rows as Json[])[0]
    assert.equal(partialRow?.costPartial, true)
    assert.equal(partialRow?.costPerProspectCents, null)

    assertError(await get(`${FUNNEL}?dateFrom=2026-10-31&dateTo=2026-10-01`, t.admin), 400)
    assertError(await get(`${FUNNEL}?campaign=YAZ26`, t.admin), 400)
  })

  test('DOM-KAY-041: kırılım CSV olarak iner (BOM, ayırıcı, ondalık virgül)', async () => {
    const t = await institution()
    const yaz = await create(t)
    await seedProspects(t, String(yaz.id), randomUUID())
    const response = await get(FUNNEL, t.admin, { accept: 'text/csv' })
    assert.equal(response.statusCode, 200, response.body)
    assert.match(String(response.headers['content-type']), /text\/csv/)
    assert.match(String(response.headers['content-disposition']), /kampanya-hunisi-/)
    const lines = response.body
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\r\n')
    assert.equal(
      lines[1],
      '"YAZ26";"Yaz okulu sosyal medya ilanı";"Sosyal medya";"2026-10-01";"2026-10-31";4;3;3;1;25;3000,00;750,00;3000,00',
    )
    assert.equal(lines.at(-1), '"Toplam";"";"";"";"";6;3;3;1;16,7;;;')
  })

  test('DOM-KAY-041: başka kurumun kampanyası 404 ve B değişmez; listede ve kırılımda yok; gövdedeki institutionId 400', async () => {
    const a = await institution()
    const b = await institution()
    const bCampaign = await create(b)
    await seedProspects(b, String(bCampaign.id), randomUUID())
    const bUrl = `${CAMPAIGNS}/${String(bCampaign.id)}`
    assertError(await get(bUrl, a.admin), 404)
    assertError(
      await call('PATCH', bUrl, a.admin, { name: 'Sızma' }, ifMatch(bCampaign.version)),
      404,
    )
    assertError(await call('DELETE', bUrl, a.admin, undefined, ifMatch(bCampaign.version)), 404)
    assert.equal((await listOf(a.admin)).meta.total, 0)
    const funnel = ok(await get(FUNNEL, a.admin))
    assert.deepEqual(funnel.rows, [])
    assert.equal((funnel.total as Json).prospects, 0)
    assertError(await call('POST', CAMPAIGNS, a.admin, { ...CAMPAIGN, institutionId: b.id }), 400)
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.name, CAMPAIGN.name)
    assert.equal(bRow?.version, 1)
    assert.equal(bRow?.archivedAt, null)
  })

  test('DOM-KAY-041: Idempotency-Key ile yinelenen kayıt aynı yanıtı döner, tek satır yazılır', async () => {
    const t = await institution()
    const headers = { 'idempotency-key': randomUUID() }
    const first = await call('POST', CAMPAIGNS, t.admin, CAMPAIGN, headers)
    const second = await call('POST', CAMPAIGNS, t.admin, CAMPAIGN, headers)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.id)).length, 1)
  })
})
