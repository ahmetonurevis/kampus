import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  donationCampaigns,
  donations,
  donationSettings,
  donors,
} from '../src/db/schema/finance-donations.ts'
import { bankAccounts } from '../src/db/schema/payments.ts'
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
 * Bağış kampanyası, bağışçı ve makbuz uçları (DOM-FIN-097; ON-258). Her test kendi kurumunu kurar;
 * FIXED_NOW 2026-10-06 (İstanbul). Kurumda `s1` (Deniz Yılmaz) öğrencisi ve bir banka hesabı vardır.
 */

const SEED = createSeed(FIXED_NOW)
const CAMPAIGNS = '/api/v1/finance/donation-campaigns'
const DONATIONS = '/api/v1/finance/donations'
const DONORS = '/api/v1/finance/donors'
const SETTINGS = '/api/v1/finance/donation-settings'
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => item.id === 'c1'),
  students: SEED.students.filter((item) => item.id === 's1'),
  parents: SEED.parents,
}
const CAMPAIGN = {
  name: 'Kütüphane Kampanyası',
  purpose: 'Okul kütüphanesinin yenilenmesi.',
  targetCents: 10_000_000,
  startsOn: '2026-09-01',
  endsOn: '2026-12-31',
}
const PERSON_TCKN = '10000000146'
const PERSON = { kind: 'person', name: 'Ayşe Yılmaz', identityNumber: PERSON_TCKN }
const CASH = {
  donorId: null,
  kind: 'cash',
  donatedOn: '2026-10-01',
  amountCents: 250_000,
  method: 'cash',
}
const NOTICE = 'Bu bağış GVK md. 89 kapsamında beyan edilen gelirden indirilebilir.'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-097: bağış kampanyası, bağışçı ve makbuz uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.97.0.1'

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
    target: App = app,
  ) {
    return target.inject({
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
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  async function ok(response: Response, status = 200): Promise<Json> {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.97.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      Object.entries(SAMPLE).flatMap(([collection, items]) =>
        (items ?? []).map((data) => {
          const name = collection as CollectionName
          const id = recordKey(name, data)
          if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
          return { collection: name, id, data }
        }),
      ),
      FIXED_NOW,
    )
    const bankAccountId = randomUUID()
    await db.insert(bankAccounts).values({
      institutionId: created.id,
      id: bankAccountId,
      bankName: 'Ziraat Bankası',
      iban: 'TR330006100519786457841326',
      accountHolder: 'Akademi Özel Okulları',
    })
    return { id: created.id, admin: await signInAs(app, created.admin), bankAccountId }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  const createCampaign = async (t: Tenant, body: Json = CAMPAIGN) =>
    ok(await call('POST', CAMPAIGNS, t.admin, body), 201)
  const transition = (cookie: string, campaign: Json, verb: 'open' | 'close') =>
    call(
      'POST',
      `${CAMPAIGNS}/${String(campaign.id)}/${verb}`,
      cookie,
      undefined,
      ifMatch(campaign.version),
    )
  async function openCampaign(t: Tenant, body: Json = CAMPAIGN) {
    const draft = await createCampaign(t, body)
    return ok(await transition(t.admin, draft, 'open'))
  }
  const donate = (
    cookie: string,
    campaignId: unknown,
    body: Json = CASH,
    headers: Record<string, string> = key(),
  ) => call('POST', `${CAMPAIGNS}/${String(campaignId)}/donations`, cookie, body, headers)
  const createDonor = async (t: Tenant, body: Json = PERSON) =>
    ok(await call('POST', DONORS, t.admin, body), 201)
  const cancel = (cookie: string, donation: Json, reason = 'Yanlış tutar girildi') =>
    call(
      'POST',
      `${DONATIONS}/${String(donation.id)}/cancel`,
      cookie,
      { reason },
      {
        ...key(),
        ...ifMatch(donation.version),
      },
    )
  const campaignRows = (institutionId: string) =>
    db.select().from(donationCampaigns).where(eq(donationCampaigns.institutionId, institutionId))
  const donationRows = (institutionId: string) =>
    db.select().from(donations).where(eq(donations.institutionId, institutionId))
  const donorRows = (institutionId: string) =>
    db.select().from(donors).where(eq(donors.institutionId, institutionId))
  const audits = (institutionId: string, action: string) =>
    db
      .select({ entityId: auditLog.entityId, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('DOM-FIN-097: oturumsuz 401; yalnız yönetici, diğer roller 403; modül kapalı 403 (K-299)', async () => {
    assertError(await get(CAMPAIGNS, null), 401)
    assertError(await call('POST', DONORS, null, PERSON), 401)
    const t = await institution()
    const campaign = await openCampaign(t)
    for (const role of ['onburo', 'ogretmen', 'ogrenci', 'veli'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(CAMPAIGNS, cookie), 403, 'forbidden')
      assertError(await get(DONORS, cookie), 403, 'forbidden')
      assertError(await get(SETTINGS, cookie), 403, 'forbidden')
      assertError(await call('POST', CAMPAIGNS, cookie, CAMPAIGN), 403, 'forbidden')
      assertError(await donate(cookie, campaign.id), 403, 'forbidden')
    }
    assert.equal((await donationRows(t.id)).length, 0)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(CAMPAIGNS, closed.admin), 403, 'module_disabled')
    assertError(await call('POST', DONORS, closed.admin, PERSON), 403, 'module_disabled')
  })

  test('DOM-FIN-097: kampanya taslak açılır; geçersiz gövde 400 ve kayıt yazılmaz; aynı ad 409 (K-296)', async () => {
    const t = await institution()
    const made = await call('POST', CAMPAIGNS, t.admin, {
      ...CAMPAIGN,
      bankAccountId: t.bankAccountId,
    })
    assert.equal(made.statusCode, 201, made.body)
    const campaign = made.json().data as Json
    assert.equal(made.headers.location, `${CAMPAIGNS}/${String(campaign.id)}`)
    assert.deepEqual(
      [campaign.status, campaign.collectedCents, campaign.percent, campaign.bankAccountLabel],
      ['draft', 0, 0, 'Ziraat Bankası · 1326'],
    )
    for (const bad of [
      { ...CAMPAIGN, name: 'x' },
      { ...CAMPAIGN, targetCents: 0 },
      { ...CAMPAIGN, endsOn: '2026-08-31' },
      { ...CAMPAIGN, institutionId: 'baska' },
      { ...CAMPAIGN, bankAccountId: 'x' },
    ])
      assertError(await call('POST', CAMPAIGNS, t.admin, bad), 400)
    assertError(
      await call('POST', CAMPAIGNS, t.admin, { ...CAMPAIGN, name: 'KÜTÜPHANE kampanyası' }),
      409,
      'donation_campaign_exists',
    )
    assertError(
      await call('POST', CAMPAIGNS, t.admin, {
        ...CAMPAIGN,
        name: 'Başka',
        bankAccountId: randomUUID(),
      }),
      404,
      'not_found',
    )
    assert.equal((await campaignRows(t.id)).length, 1)
    const created = await audits(t.id, 'donation_campaign.create')
    assert.equal(created.length, 1)
    assert.equal(JSON.stringify(created).includes('Kütüphane'), false)
  })

  test('DOM-FIN-097: kampanya taslak → açık → kapandı; düzeltme bağış günlerini dışarıda bırakamaz (K-296)', async () => {
    const t = await institution()
    const draft = await createCampaign(t)
    assertError(await donate(t.admin, draft.id), 422, 'donation_campaign_not_open')
    assertError(await transition(t.admin, draft, 'close'), 409, 'donation_campaign_not_open')
    assertError(
      await call('POST', `${CAMPAIGNS}/${String(draft.id)}/open`, t.admin),
      400,
      'if_match_required',
    )
    const ended = await createCampaign(t, {
      ...CAMPAIGN,
      name: 'Eski',
      startsOn: '2026-01-01',
      endsOn: '2026-06-30',
    })
    assertError(await transition(t.admin, ended, 'open'), 422, 'donation_campaign_ended')
    const opened = await ok(await transition(t.admin, draft, 'open'))
    assert.equal(opened.status, 'open')
    assertError(await transition(t.admin, opened, 'open'), 409, 'donation_campaign_not_draft')
    await ok(await donate(t.admin, opened.id, { ...CASH, donatedOn: '2026-09-15' }), 201)

    const url = `${CAMPAIGNS}/${String(opened.id)}`
    assertError(
      await call('PATCH', url, t.admin, { startsOn: '2026-09-20' }, ifMatch(opened.version)),
      422,
      'donation_campaign_dates_conflict',
    )
    assertError(
      await call('PATCH', url, t.admin, { targetCents: 1 }, ifMatch(1)),
      409,
      'version_conflict',
    )
    assertError(await call('PATCH', url, t.admin, {}, ifMatch(opened.version)), 400)
    const patched = await ok(
      await call(
        'PATCH',
        url,
        t.admin,
        { targetCents: 500_000, endsOn: '2027-01-31' },
        ifMatch(opened.version),
      ),
    )
    assert.deepEqual(
      [
        patched.targetCents,
        patched.endsOn,
        patched.collectedCents,
        patched.percent,
        patched.remainingCents,
      ],
      [500_000, '2027-01-31', 250_000, 50, 250_000],
    )
    const closedCampaign = await ok(await transition(t.admin, patched, 'close'))
    assert.equal(closedCampaign.status, 'closed')
    assertError(await donate(t.admin, opened.id), 422, 'donation_campaign_not_open')
    assertError(
      await call('PATCH', url, t.admin, { targetCents: 1 }, ifMatch(closedCampaign.version)),
      422,
      'donation_campaign_closed',
    )
    assertError(
      await transition(t.admin, closedCampaign, 'open'),
      409,
      'donation_campaign_not_draft',
    )
    const row = (await campaignRows(t.id)).find((item) => item.id === opened.id)
    assert.notEqual(row?.closedAt, null)
  })

  test('DOM-FIN-097: bağışçı kimlik numarası denetlenir, tekildir ve listede maskelidir; veli/mezun bağı (K-298)', async () => {
    const t = await institution()
    for (const bad of [
      { ...PERSON, identityNumber: '10000000147' },
      { kind: 'organization', name: 'Vakıf', identityNumber: '1234567891' },
      { ...PERSON, phone: '5551234567' },
      { ...PERSON, link: { studentId: 's1' } },
    ])
      assertError(await call('POST', DONORS, t.admin, bad), 400)
    const donor = await createDonor(t, {
      ...PERSON,
      phone: '05551234567',
      email: 'ayse@example.com',
      link: { studentId: 's1', relation: 'parent' },
    })
    assert.deepEqual(
      [donor.maskedIdentityNumber, donor.link],
      ['*******0146', { studentId: 's1', relation: 'parent', studentName: 'Deniz Yılmaz' }],
    )
    assert.equal(JSON.stringify(donor).includes(PERSON_TCKN), false)
    assertError(
      await call('POST', DONORS, t.admin, { ...PERSON, name: 'İkinci' }),
      409,
      'donor_identity_exists',
    )
    assertError(
      await call('POST', DONORS, t.admin, {
        kind: 'person',
        name: 'Ali',
        link: { studentId: 'yok', relation: 'alumnus' },
      }),
      404,
    )
    const org = await createDonor(t, {
      kind: 'organization',
      name: 'Mezunlar Derneği',
      identityNumber: '1234567890',
    })
    assert.equal(org.maskedIdentityNumber, '******7890')
    assert.equal((await donorRows(t.id)).length, 2)

    const list = (await get(`${DONORS}?q=0146`, t.admin)).json().data as Json[]
    assert.deepEqual(
      list.map((row) => row.name),
      ['Ayşe Yılmaz'],
    )
    const url = `${DONORS}/${String(donor.id)}`
    assertError(
      await call('PATCH', url, t.admin, { identityNumber: '1234567890' }, ifMatch(donor.version)),
      422,
      'donor_identity_invalid',
    )
    const patched = await ok(
      await call('PATCH', url, t.admin, { phone: null, link: null }, ifMatch(donor.version)),
    )
    assert.deepEqual([patched.phone, patched.link, patched.email], [null, null, 'ayse@example.com'])
    assert.equal(JSON.stringify(await audits(t.id, 'donor.create')).includes('Ayşe'), false)
  })

  test('DOM-FIN-097: bağış Idempotency-Key ister, aynı anahtar ilk yanıtı tekrarlar; makbuz numarası yılda sıralıdır (K-297)', async () => {
    const t = await institution()
    const campaign = await openCampaign(t)
    assertError(await donate(t.admin, campaign.id, CASH, {}), 400, 'idempotency_key_required')
    for (const bad of [
      { ...CASH, amountCents: 0 },
      { ...CASH, method: undefined },
      { ...CASH, donorId: undefined },
      { ...CASH, kind: 'in_kind' },
      { ...CASH, bankAccountId: t.bankAccountId },
      {
        donorId: null,
        kind: 'in_kind',
        donatedOn: '2026-10-01',
        description: 'Kitap',
        method: 'cash',
      },
    ])
      assertError(await donate(t.admin, campaign.id, bad), 400)
    assertError(
      await donate(t.admin, campaign.id, { ...CASH, donatedOn: '2026-10-07' }),
      422,
      'donation_date_future',
    )
    assertError(
      await donate(t.admin, campaign.id, { ...CASH, donatedOn: '2026-08-31' }),
      422,
      'donation_date_outside_campaign',
    )
    assertError(
      await donate(t.admin, campaign.id, { ...CASH, method: 'bank_transfer' }),
      422,
      'donation_bank_account_required',
    )
    assertError(await donate(t.admin, campaign.id, { ...CASH, donorId: randomUUID() }), 404)
    assert.equal((await donationRows(t.id)).length, 0)

    const headers = key()
    const first = await donate(t.admin, campaign.id, CASH, headers)
    assert.equal(first.statusCode, 201, first.body)
    const again = await donate(t.admin, campaign.id, CASH, headers)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    const donor = await createDonor(t)
    const second = await ok(
      await donate(t.admin, campaign.id, {
        ...CASH,
        donorId: donor.id,
        method: 'bank_transfer',
        bankAccountId: t.bankAccountId,
        reference: 'DK-1',
      }),
      201,
    )
    const inKind = await ok(
      await donate(t.admin, campaign.id, {
        donorId: donor.id,
        kind: 'in_kind',
        donatedOn: '2026-10-02',
        description: '120 adet hikâye kitabı',
        declaredValueCents: 600_000,
      }),
      201,
    )
    const firstData = first.json().data as Json
    assert.deepEqual(
      [firstData.receiptNumber, second.receiptNumber, inKind.receiptNumber],
      [1, 2, 3],
    )
    assert.deepEqual(
      [firstData.donorName, second.donorName, second.maskedIdentityNumber, second.bankAccountLabel],
      [null, 'Ayşe Yılmaz', '*******0146', 'Ziraat Bankası · 1326'],
    )
    const totals = await ok(await get(`${CAMPAIGNS}/${String(campaign.id)}`, t.admin))
    // Ayni bağış hedefe sayılmaz (K-297).
    assert.deepEqual(
      [
        totals.collectedCents,
        totals.inKindDeclaredCents,
        totals.donationCount,
        totals.inKindCount,
        totals.percent,
      ],
      [500_000, 600_000, 3, 1, 5],
    )
    const rows = await donationRows(t.id)
    assert.deepEqual(rows.map((row) => [row.receiptYear, row.receiptNumber]).sort(), [
      [2026, 1],
      [2026, 2],
      [2026, 3],
    ])
    assert.equal(JSON.stringify(await audits(t.id, 'donation.record')).includes(PERSON_TCKN), false)
  })

  test('DOM-FIN-097: havale kampanyanın hesabını alır; başka kurumun hesabı ve bağışçısı 404', async () => {
    const t = await institution()
    const other = await institution()
    const otherDonor = await createDonor(other)
    const campaign = await openCampaign(t, { ...CAMPAIGN, bankAccountId: t.bankAccountId })
    const transfer = await ok(
      await donate(t.admin, campaign.id, { ...CASH, method: 'bank_transfer' }),
      201,
    )
    assert.equal(transfer.bankAccountId, t.bankAccountId)
    assertError(
      await donate(t.admin, campaign.id, {
        ...CASH,
        method: 'bank_transfer',
        bankAccountId: other.bankAccountId,
      }),
      404,
    )
    assertError(await donate(t.admin, campaign.id, { ...CASH, donorId: otherDonor.id }), 404)
    assert.equal((await donationRows(t.id)).length, 1)
  })

  test('DOM-FIN-097: iptal gerekçe ve sürüm ister, numara yeniden kullanılmaz; kapanmış kampanyada da yapılır (K-297)', async () => {
    const t = await institution()
    const campaign = await openCampaign(t)
    const donation = await ok(await donate(t.admin, campaign.id), 201)
    assertError(await cancel(t.admin, donation, 'kısa'), 400)
    assertError(
      await call(
        'POST',
        `${DONATIONS}/${String(donation.id)}/cancel`,
        t.admin,
        { reason: 'Yanlış tutar girildi' },
        key(),
      ),
      400,
      'if_match_required',
    )
    assertError(
      await call(
        'POST',
        `${DONATIONS}/${String(donation.id)}/cancel`,
        t.admin,
        { reason: 'Yanlış tutar girildi' },
        ifMatch(donation.version),
      ),
      400,
      'idempotency_key_required',
    )
    const current = await ok(await get(`${CAMPAIGNS}/${String(campaign.id)}`, t.admin))
    await ok(await transition(t.admin, current, 'close'))
    const cancelled = await ok(await cancel(t.admin, donation))
    assert.deepEqual([cancelled.cancelReason, cancelled.receiptNumber], ['Yanlış tutar girildi', 1])
    assertError(await cancel(t.admin, cancelled), 409, 'donation_cancelled')
    assertError(await cancel(t.admin, donation), 409, 'version_conflict')
    const totals = await ok(await get(`${CAMPAIGNS}/${String(campaign.id)}`, t.admin))
    assert.deepEqual([totals.collectedCents, totals.donationCount], [0, 0])

    const next = await openCampaign(t, { ...CAMPAIGN, name: 'Spor Salonu' })
    const fresh = await ok(await donate(t.admin, next.id), 201)
    assert.equal(fresh.receiptNumber, 2)
    const list = (await get(`${CAMPAIGNS}/${String(campaign.id)}/donations`, t.admin)).json()
    assert.deepEqual([list.meta.total, (list.data as Json[])[0]?.cancelledAt !== null], [1, true])
  })

  test('DOM-FIN-097: makbuz tam kimlik numarasını verir ve denetlenir; vergi ibaresi ayarla ve anonimde yok (K-298, K-299)', async () => {
    const t = await institution()
    const campaign = await openCampaign(t)
    const donor = await createDonor(t)
    const before = await ok(await donate(t.admin, campaign.id, { ...CASH, donorId: donor.id }), 201)

    const settings = await ok(await get(SETTINGS, t.admin))
    assert.deepEqual(settings, { taxNoticeEnabled: false, taxNoticeText: null, version: 1 })
    assertError(
      await call(
        'PATCH',
        SETTINGS,
        t.admin,
        { taxNoticeEnabled: true, taxNoticeText: 'kısa' },
        ifMatch(1),
      ),
      400,
    )
    assertError(
      await call('PATCH', SETTINGS, t.admin, { taxNoticeEnabled: true, taxNoticeText: NOTICE }),
      400,
      'if_match_required',
    )
    const saved = await ok(
      await call(
        'PATCH',
        SETTINGS,
        t.admin,
        { taxNoticeEnabled: true, taxNoticeText: NOTICE },
        ifMatch(1),
      ),
    )
    assert.equal(saved.version, 2)
    assertError(
      await call(
        'PATCH',
        SETTINGS,
        t.admin,
        { taxNoticeEnabled: false, taxNoticeText: null },
        ifMatch(1),
      ),
      409,
      'version_conflict',
    )
    const named = await ok(await donate(t.admin, campaign.id, { ...CASH, donorId: donor.id }), 201)
    const anonymous = await ok(await donate(t.admin, campaign.id), 201)
    assert.deepEqual(
      [before.hasTaxNotice, named.hasTaxNotice, anonymous.hasTaxNotice],
      [false, true, false],
    )

    const receipt = await ok(await get(`${DONATIONS}/${String(named.id)}/receipt`, t.admin))
    assert.deepEqual(
      [
        receipt.identityNumber,
        receipt.taxNotice,
        (receipt.campaign as Json).name,
        receipt.donorName,
      ],
      [PERSON_TCKN, NOTICE, CAMPAIGN.name, 'Ayşe Yılmaz'],
    )
    const old = await ok(await get(`${DONATIONS}/${String(before.id)}/receipt`, t.admin))
    assert.equal(old.taxNotice, null)
    const reads = await audits(t.id, 'finance.donation_receipt')
    assert.deepEqual(
      reads.map((row) => row.entityId).sort(),
      [String(before.id), String(named.id)].sort(),
    )
    assert.equal(JSON.stringify(reads).includes(PERSON_TCKN), false)
    // Bağışçı düzeltmesi kesilmiş makbuzu değiştirmez.
    await ok(
      await call(
        'PATCH',
        `${DONORS}/${String(donor.id)}`,
        t.admin,
        { name: 'Ayşe Kaya' },
        ifMatch(donor.version),
      ),
    )
    const kept = await ok(await get(`${DONATIONS}/${String(named.id)}/receipt`, t.admin))
    assert.equal(kept.donorName, 'Ayşe Yılmaz')
    assert.equal(
      (await db.select().from(donationSettings).where(eq(donationSettings.institutionId, t.id)))
        .length,
      1,
    )
  })

  test('DOM-FIN-097: bağış CSV taze oturum ister, denetime yazılır, kimlik maskeli ve formül kaçışlıdır (K-298)', async () => {
    const t = await institution()
    const campaign = await openCampaign(t)
    const donor = await createDonor(t, { ...PERSON, name: '=HYPERLINK("x")' })
    await ok(await donate(t.admin, campaign.id, { ...CASH, donorId: donor.id }), 201)
    await ok(await donate(t.admin, campaign.id, { ...CASH, amountCents: 100_000 }), 201)
    const url = `${CAMPAIGNS}/${String(campaign.id)}/donations`
    const file = await call('GET', url, t.admin, undefined, { accept: 'text/csv' })
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /text\/csv/)
    const lines = file.body.replace('\uFEFF', '').split('\r\n')
    assert.equal(lines.length, 1 + 2 + 1)
    assert.equal(file.body.includes(PERSON_TCKN), false)
    assert.match(file.body, /"'=HYPERLINK\(""x""\)";"\*\*\*\*\*\*\*0146"/)
    assert.match(lines.at(-1) ?? '', /"Toplam nakdi bağış".*3500,00/)
    assert.deepEqual(
      (await audits(t.id, 'finance.donation_export')).map((row) => row.entityId),
      [String(campaign.id)],
    )
    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(
        await call('GET', url, t.admin, undefined, { accept: 'text/csv' }, later),
        403,
        'reauthentication_required',
      )
    } finally {
      await later.close()
    }
  })

  test('DOM-FIN-097: başka kurumun kampanyası, bağışı ve bağışçısı 404; listede yok; B değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const bCampaign = await openCampaign(b)
    await ok(
      await call(
        'PATCH',
        SETTINGS,
        b.admin,
        { taxNoticeEnabled: true, taxNoticeText: NOTICE },
        ifMatch(1),
      ),
    )
    const bDonor = await createDonor(b)
    const bDonation = await ok(
      await donate(b.admin, bCampaign.id, { ...CASH, donorId: bDonor.id }),
      201,
    )
    const aCampaign = await openCampaign(a, { ...CAMPAIGN, name: 'A Kampanyası' })
    const before = {
      campaigns: await campaignRows(b.id),
      donations: await donationRows(b.id),
      donors: await donorRows(b.id),
    }
    const bUrl = `${CAMPAIGNS}/${String(bCampaign.id)}`

    assertError(await get(bUrl, a.admin), 404)
    assertError(
      await call('PATCH', bUrl, a.admin, { targetCents: 1 }, ifMatch(bCampaign.version)),
      404,
    )
    assertError(await transition(a.admin, bCampaign, 'close'), 404)
    assertError(
      await call('POST', `${bUrl}/open`, a.admin, undefined, ifMatch(bCampaign.version)),
      404,
    )
    assertError(await get(`${bUrl}/donations`, a.admin), 404)
    assertError(await donate(a.admin, bCampaign.id), 404)
    assertError(await cancel(a.admin, bDonation), 404)
    assertError(await get(`${DONATIONS}/${String(bDonation.id)}/receipt`, a.admin), 404)
    assertError(
      await call(
        'PATCH',
        `${DONORS}/${String(bDonor.id)}`,
        a.admin,
        { name: 'Sızma' },
        ifMatch(bDonor.version),
      ),
      404,
    )
    // A'nın kampanyasına B'nin bağışçısı ve banka hesabı bağlanamaz.
    assertError(await donate(a.admin, aCampaign.id, { ...CASH, donorId: bDonor.id }), 404)
    assertError(
      await call('POST', CAMPAIGNS, a.admin, {
        ...CAMPAIGN,
        name: 'Sızma',
        bankAccountId: b.bankAccountId,
      }),
      404,
    )
    // Gövdedeki institutionId etkisizdir: şema reddeder, hiçbir kurumda kayıt açılmaz.
    assertError(await call('POST', DONORS, a.admin, { ...PERSON, institutionId: b.id }), 400)
    // Kimlik numarası tekilliği kurum içindir: A aynı numarayla bağışçı açabilir.
    await createDonor(a)
    const campaigns = (await get(CAMPAIGNS, a.admin)).json().data as Json[]
    assert.deepEqual(
      campaigns.map((row) => row.name),
      ['A Kampanyası'],
    )
    const donorList = (await get(DONORS, a.admin)).json().data as Json[]
    assert.equal(
      donorList.some((row) => row.id === bDonor.id),
      false,
    )
    assert.deepEqual(await campaignRows(b.id), before.campaigns)
    assert.deepEqual(await donationRows(b.id), before.donations)
    assert.deepEqual(await donorRows(b.id), before.donors)
    // Ayar kurumun kendisinindir: A, B'nin ibaresini görmez; A'nın değişikliği B'ye yazılmaz.
    assert.deepEqual(await ok(await get(SETTINGS, a.admin)), {
      taxNoticeEnabled: false,
      taxNoticeText: null,
      version: 1,
    })
    await ok(
      await call(
        'PATCH',
        SETTINGS,
        a.admin,
        { taxNoticeEnabled: false, taxNoticeText: null },
        ifMatch(1),
      ),
    )
    assert.deepEqual(await ok(await get(SETTINGS, b.admin)), {
      taxNoticeEnabled: true,
      taxNoticeText: NOTICE,
      version: 2,
    })
    assert.equal(
      (await get(`${DONATIONS}/${String(bDonation.id)}/receipt`, b.admin)).statusCode,
      200,
    )
  })

  test('DOM-FIN-097: liste sayfalı, durum süzgeci ve bilinmeyen parametre 400', async () => {
    const t = await institution()
    await openCampaign(t)
    await createCampaign(t, { ...CAMPAIGN, name: 'Taslak Kampanya' })
    const open = (await get(`${CAMPAIGNS}?status=open`, t.admin)).json()
    assert.deepEqual([open.meta.total, (open.data as Json[])[0]?.name], [1, CAMPAIGN.name])
    const all = (await get(`${CAMPAIGNS}?pageSize=1&page=2`, t.admin)).json()
    assert.deepEqual([all.meta.total, (all.data as Json[])[0]?.status], [2, 'draft'])
    const search = (await get(`${CAMPAIGNS}?q=kutuphane`, t.admin)).json()
    assert.equal(search.meta.total, 1)
    assertError(await get(`${CAMPAIGNS}?sort=name`, t.admin), 400)
    assertError(await get(`${DONORS}?status=open`, t.admin), 400)
  })
})
