import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertScholarshipAward, insertScholarshipProgram } from '../src/db/finance-scholarships.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  scholarshipFundAllocations,
  scholarshipFundDonations,
  scholarshipFunds,
} from '../src/db/schema/finance-scholarship-funds.ts'
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
 * Burs fonu uçları (DOM-FIN-068; ON-259). Her test kendi kurumunu kurar; FIXED_NOW 2026-10-06.
 * Kurumda `s1` (Deniz Yılmaz) ve `s3` için 2026 yılında birer burs ataması (10.000 TL) vardır.
 */

const SEED = createSeed(FIXED_NOW)
const FUNDS = '/api/v1/finance/scholarship-funds'
const CLASSES = ['c1', 'c3']
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASSES.includes(item.id)),
  students: SEED.students.filter((item) => ['s1', 's3'].includes(item.id)),
  parents: SEED.parents,
}
const AWARD_CENTS = 1_000_000
const FUND = {
  name: 'Mezunlar Burs Fonu',
  description: '2010 mezunlarının katkısıyla.',
  donorKind: 'organization',
  donorName: 'Mezunlar Derneği',
}
const DONATION = { amountCents: 1_500_000, donatedOn: '2026-10-01', channel: 'bank_transfer' }

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-068: burs fonu uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.68.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST',
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
    clientIp = `10.68.${String((tenantCount += 1))}.1`
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
    const programId = randomUUID()
    await insertScholarshipProgram(db, created.id, {
      id: programId,
      academicYear: 2026,
      name: 'Başarı Bursu',
      conditions: 'Sınav puanı 90 ve üstü.',
      terminationConditions: 'Disiplin cezası.',
      durationNote: 'Bir yıl',
      percentBasisPoints: null,
      amountCents: AWARD_CENTS,
      capacity: 5,
      now: FIXED_NOW,
    })
    const awards: Record<string, string> = {}
    for (const studentId of ['s1', 's3']) {
      const id = randomUUID()
      await insertScholarshipAward(db, created.id, {
        id,
        programId,
        studentId,
        academicYear: 2026,
        amountCents: AWARD_CENTS,
        awardedByUserId: 'test',
        now: FIXED_NOW,
      })
      awards[studentId] = id
    }
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      awardS1: awards.s1 ?? '',
      awardS3: awards.s3 ?? '',
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  const createFund = async (t: Tenant, body: Json = FUND) =>
    (await ok(await call('POST', FUNDS, t.admin, body), 201)).fund as Json
  const donate = (
    cookie: string,
    fundId: unknown,
    body: Json = DONATION,
    headers: Record<string, string> = key(),
  ) => call('POST', `${FUNDS}/${String(fundId)}/donations`, cookie, body, headers)
  const allocate = (
    cookie: string,
    fundId: unknown,
    awardId: string,
    amountCents: number,
    headers: Record<string, string> = key(),
  ) =>
    call(
      'POST',
      `${FUNDS}/${String(fundId)}/allocations`,
      cookie,
      { awardId, amountCents },
      headers,
    )
  const report = async (cookie: string, fundId: unknown) =>
    ok(await get(`${FUNDS}/${String(fundId)}/report`, cookie))
  const fundRows = (institutionId: string) =>
    db.select().from(scholarshipFunds).where(eq(scholarshipFunds.institutionId, institutionId))
  const donationRows = (institutionId: string) =>
    db
      .select()
      .from(scholarshipFundDonations)
      .where(eq(scholarshipFundDonations.institutionId, institutionId))
  const allocationRows = (institutionId: string) =>
    db
      .select()
      .from(scholarshipFundAllocations)
      .where(eq(scholarshipFundAllocations.institutionId, institutionId))
  const audits = (institutionId: string, action: string) =>
    db
      .select({ entityId: auditLog.entityId, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('DOM-FIN-068: oturumsuz 401; yazma yalnız yönetici, okuma ön büroda da; diğer roller 403; modül kapalı 403', async () => {
    assertError(await get(FUNDS, null), 401)
    assertError(await call('POST', FUNDS, null, FUND), 401)
    const t = await institution()
    const fund = await createFund(t)
    const desk = await member(t.id, 'onburo')
    assert.equal((await get(FUNDS, desk)).statusCode, 200)
    assert.equal((await get(`${FUNDS}/${String(fund.id)}/report`, desk)).statusCode, 200)
    assertError(await call('POST', FUNDS, desk, FUND), 403, 'forbidden')
    assertError(await donate(desk, fund.id), 403, 'forbidden')
    assertError(await allocate(desk, fund.id, t.awardS1, 100), 403, 'forbidden')
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(FUNDS, cookie), 403, 'forbidden')
      assertError(await get(`${FUNDS}/${String(fund.id)}/report`, cookie), 403, 'forbidden')
      assertError(await donate(cookie, fund.id), 403, 'forbidden')
    }
    assert.equal((await donationRows(t.id)).length, 0)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(FUNDS, closed.admin), 403, 'module_disabled')
    assertError(await call('POST', FUNDS, closed.admin, FUND), 403, 'module_disabled')
  })

  test('DOM-FIN-068: fon açılır; geçersiz gövde 400 ve kayıt yazılmaz; aynı ad 409; anonimde ad saklanmaz (K-95)', async () => {
    const t = await institution()
    const made = await call('POST', FUNDS, t.admin, FUND)
    assert.equal(made.statusCode, 201, made.body)
    const fund = made.json().data.fund as Json
    assert.equal(made.headers.location, `${FUNDS}/${String(fund.id)}/report`)
    assert.deepEqual(
      [fund.status, fund.balanceCents, fund.donorName, fund.donationCount],
      ['active', 0, 'Mezunlar Derneği', 0],
    )
    for (const bad of [
      { ...FUND, name: 'x' },
      { ...FUND, donorName: undefined },
      { ...FUND, donorKind: 'anonymous' },
      { ...FUND, institutionId: 'baska' },
      { ...FUND, donorPhone: '05550000000' },
    ])
      assertError(await call('POST', FUNDS, t.admin, bad), 400)
    assertError(
      await call('POST', FUNDS, t.admin, { ...FUND, name: 'MEZUNLAR burs fonu' }),
      409,
      'scholarship_fund_exists',
    )
    const anonymous = await createFund(t, { name: 'Anonim Fon', donorKind: 'anonymous' })
    assert.equal(anonymous.donorName, null)
    const rows = await fundRows(t.id)
    assert.equal(rows.length, 2)
    assert.equal(rows.find((row) => row.id === anonymous.id)?.donorName, null)
    const created = await audits(t.id, 'scholarship_fund.create')
    assert.equal(created.length, 2)
    // Denetime değer değil alan adı yazılır.
    assert.equal(JSON.stringify(created).includes('Mezunlar Derneği'), false)
  })

  test('DOM-FIN-068: bağış Idempotency-Key ister, aynı anahtar ilk yanıtı tekrarlar; gelecek gün 422, kayıt değişmez', async () => {
    const t = await institution()
    const fund = await createFund(t)
    assertError(await donate(t.admin, fund.id, DONATION, {}), 400, 'idempotency_key_required')
    assertError(
      await donate(t.admin, fund.id, { ...DONATION, donatedOn: '2026-10-07' }),
      422,
      'scholarship_fund_date_future',
    )
    for (const bad of [
      { ...DONATION, amountCents: 0 },
      { ...DONATION, amountCents: 12.5 },
      { ...DONATION, channel: 'check' },
    ])
      assertError(await donate(t.admin, fund.id, bad), 400)
    assert.equal((await donationRows(t.id)).length, 0)

    const headers = key()
    const first = await donate(t.admin, fund.id, DONATION, headers)
    assert.equal(first.statusCode, 201, first.body)
    const again = await donate(t.admin, fund.id, DONATION, headers)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    assert.equal((await donationRows(t.id)).length, 1)
    const data = first.json().data as { fund: Json; movements: Json[] }
    assert.deepEqual(
      [data.fund.donatedCents, data.fund.balanceCents, data.movements.length],
      [1_500_000, 1_500_000, 1],
    )
    assert.deepEqual(
      [data.movements[0]?.kind, data.movements[0]?.channel, data.movements[0]?.balanceAfterCents],
      ['donation', 'bank_transfer', 1_500_000],
    )
  })

  test('DOM-FIN-068: atama bakiyeyi ve bursun karşılanmamış kısmını aşamaz; aynı fondan ikinci atama 409 (K-96)', async () => {
    const t = await institution()
    const fund = await createFund(t)
    const other = await createFund(t, { ...FUND, name: 'Vakıf Fonu' })
    await ok(await donate(t.admin, fund.id, { ...DONATION, amountCents: 800_000 }), 201)
    await ok(await donate(t.admin, other.id, { ...DONATION, amountCents: 900_000 }), 201)

    assertError(
      await allocate(t.admin, fund.id, t.awardS1, 800_001),
      422,
      'scholarship_fund_insufficient',
    )
    assertError(await allocate(t.admin, fund.id, randomUUID(), 100), 404, 'not_found')
    assertError(await allocate(t.admin, fund.id, 'x', 100), 400)
    assertError(
      await allocate(t.admin, fund.id, t.awardS1, 100, {}),
      400,
      'idempotency_key_required',
    )
    assert.equal((await allocationRows(t.id)).length, 0)

    const allocated = await ok(await allocate(t.admin, fund.id, t.awardS1, 600_000), 201)
    assert.equal((allocated.fund as Json).balanceCents, 200_000)
    assertError(
      await allocate(t.admin, fund.id, t.awardS1, 100_000),
      409,
      'scholarship_fund_allocation_exists',
    )
    // Burs 10.000 TL; 6.000 TL karşılandı. Öteki fondan en çok 4.000 TL.
    assertError(
      await allocate(t.admin, other.id, t.awardS1, 400_001),
      422,
      'scholarship_fund_exceeds_award',
    )
    await ok(await allocate(t.admin, other.id, t.awardS1, 400_000), 201)
    const rows = await allocationRows(t.id)
    assert.equal(rows.length, 2)
    assert.deepEqual(
      rows.map((row) => [row.studentId, row.academicYear, row.allocatedOn]),
      [
        ['s1', 2026, '2026-10-06'],
        ['s1', 2026, '2026-10-06'],
      ],
    )
  })

  test('DOM-FIN-068: raporda öğrenci adı yalnız yöneticiye döner (K-98)', async () => {
    const t = await institution()
    const fund = await createFund(t)
    await ok(await donate(t.admin, fund.id), 201)
    await ok(await allocate(t.admin, fund.id, t.awardS1, 500_000), 201)
    const admin = (await report(t.admin, fund.id)).movements as Json[]
    assert.deepEqual(
      admin.map((row) => [row.kind, row.studentName, row.effectCents, row.balanceAfterCents]),
      [
        ['donation', null, 1_500_000, 1_500_000],
        ['allocation', 'Deniz Yılmaz', -500_000, 1_000_000],
      ],
    )
    const desk = await member(t.id, 'onburo')
    const deskRows = (await report(desk, fund.id)).movements as Json[]
    assert.equal(
      deskRows.every((row) => row.studentName === null),
      true,
    )
  })

  test('DOM-FIN-068, K-98: ön büro raporunda öğrenciyi tanıtan alanlar boştur; tutar ve yıl kalır', async () => {
    const t = await institution()
    const fund = await createFund(t)
    await ok(await donate(t.admin, fund.id), 201)
    const allocated = await ok(await allocate(t.admin, fund.id, t.awardS1, 500_000), 201)
    const allocation = (allocated.movements as Json[]).find(
      (row) => row.kind === 'allocation',
    ) as Json
    await ok(
      await call(
        'POST',
        `${FUNDS}/${String(fund.id)}/allocations/${String(allocation.id)}/cancel`,
        t.admin,
        { reason: 'Deniz Yılmaz bursu yanlış fondan karşılandı' },
        { ...key(), ...ifMatch(allocation.version) },
      ),
    )
    const pick = (row: Json) => [
      row.kind,
      row.studentId,
      row.awardId,
      row.studentName,
      row.cancelReason,
      row.academicYear,
      row.amountCents,
    ]
    const adminRow = ((await report(t.admin, fund.id)).movements as Json[]).find(
      (row) => row.kind === 'allocation',
    ) as Json
    assert.deepEqual(pick(adminRow), [
      'allocation',
      's1',
      t.awardS1,
      'Deniz Yılmaz',
      'Deniz Yılmaz bursu yanlış fondan karşılandı',
      2026,
      500_000,
    ])
    const desk = await member(t.id, 'onburo')
    const deskRow = ((await report(desk, fund.id)).movements as Json[]).find(
      (row) => row.kind === 'allocation',
    ) as Json
    assert.deepEqual(pick(deskRow), ['allocation', null, null, null, null, 2026, 500_000])
    assert.notEqual(deskRow.cancelledAt, null)
  })

  test('DOM-FIN-068: atama iptali bakiyeyi geri verir; bağış iptali bakiyeyi eksiye düşüremez; iptal sürüm ve gerekçe ister (K-97)', async () => {
    const t = await institution()
    const fund = await createFund(t)
    const donated = await ok(
      await donate(t.admin, fund.id, { ...DONATION, amountCents: 500_000 }),
      201,
    )
    const donation = (donated.movements as Json[])[0] as Json
    const allocated = await ok(await allocate(t.admin, fund.id, t.awardS1, 300_000), 201)
    const allocation = (allocated.movements as Json[]).find(
      (row) => row.kind === 'allocation',
    ) as Json
    const donationCancel = `${FUNDS}/${String(fund.id)}/donations/${String(donation.id)}/cancel`
    const allocationCancel = `${FUNDS}/${String(fund.id)}/allocations/${String(allocation.id)}/cancel`
    const reason = { reason: 'Yanlış giriş yapıldı' }

    assertError(
      await call('POST', donationCancel, t.admin, reason, {
        ...key(),
        ...ifMatch(donation.version),
      }),
      422,
      'scholarship_fund_donation_in_use',
    )
    assertError(
      await call('POST', allocationCancel, t.admin, reason, key()),
      400,
      'if_match_required',
    )
    assertError(
      await call(
        'POST',
        allocationCancel,
        t.admin,
        { reason: 'kısa' },
        {
          ...key(),
          ...ifMatch(allocation.version),
        },
      ),
      400,
    )
    assertError(
      await call('POST', allocationCancel, t.admin, reason, { ...key(), ...ifMatch(99) }),
      409,
      'version_conflict',
    )
    assert.equal((await allocationRows(t.id))[0]?.cancelledAt, null)

    const undone = await ok(
      await call('POST', allocationCancel, t.admin, reason, {
        ...key(),
        ...ifMatch(allocation.version),
      }),
    )
    assert.equal((undone.fund as Json).balanceCents, 500_000)
    assertError(
      await call('POST', allocationCancel, t.admin, reason, {
        ...key(),
        ...ifMatch(Number(allocation.version) + 1),
      }),
      409,
      'scholarship_fund_allocation_cancelled',
    )
    // İptal edilen atama burs kapsamından düşer: aynı fondan yeniden atanabilir.
    const again = await ok(await allocate(t.admin, fund.id, t.awardS1, 100_000), 201)
    const second = (again.movements as Json[]).find(
      (row) => row.kind === 'allocation' && row.cancelledAt === null,
    ) as Json
    const cancelled = await ok(
      await call(
        'POST',
        `${FUNDS}/${String(fund.id)}/allocations/${String(second.id)}/cancel`,
        t.admin,
        reason,
        { ...key(), ...ifMatch(second.version) },
      ),
    )
    assert.equal((cancelled.fund as Json).balanceCents, 500_000)
    const gone = await ok(
      await call('POST', donationCancel, t.admin, reason, {
        ...key(),
        ...ifMatch(donation.version),
      }),
    )
    assert.deepEqual([(gone.fund as Json).balanceCents, (gone.fund as Json).donationCount], [0, 0])
    const stored = (await donationRows(t.id))[0]
    assert.equal(stored?.cancelReason, 'Yanlış giriş yapıldı')
    assert.equal((await audits(t.id, 'scholarship_fund.donation_cancel')).length, 1)
    assert.equal(
      JSON.stringify(await audits(t.id, 'scholarship_fund.donation_cancel')).includes('Yanlış'),
      false,
    )
  })

  test('DOM-FIN-068: fon yalnız sıfır bakiyede kapanır; kapalı fona bağış ve atama yapılmaz, rapor kalır', async () => {
    const t = await institution()
    const fund = await createFund(t)
    const closeUrl = `${FUNDS}/${String(fund.id)}/close`
    await ok(await donate(t.admin, fund.id, { ...DONATION, amountCents: 200_000 }), 201)
    assertError(
      await call('POST', closeUrl, t.admin, undefined, ifMatch(fund.version)),
      422,
      'scholarship_fund_balance_not_zero',
    )
    assertError(await call('POST', closeUrl, t.admin, undefined, {}), 400, 'if_match_required')
    await ok(await allocate(t.admin, fund.id, t.awardS3, 200_000), 201)
    assertError(
      await call('POST', closeUrl, t.admin, undefined, ifMatch(99)),
      409,
      'version_conflict',
    )
    const closed = await ok(await call('POST', closeUrl, t.admin, undefined, ifMatch(fund.version)))
    assert.equal((closed.fund as Json).status, 'closed')
    assertError(await donate(t.admin, fund.id), 422, 'scholarship_fund_closed')
    assertError(await allocate(t.admin, fund.id, t.awardS1, 1), 422, 'scholarship_fund_closed')
    assertError(
      await call('POST', closeUrl, t.admin, undefined, ifMatch(Number(fund.version) + 1)),
      409,
      'scholarship_fund_already_closed',
    )
    assert.equal(((await report(t.admin, fund.id)).movements as Json[]).length, 2)
    // Kapalı fonun adı yeniden kullanılabilir.
    await createFund(t)
  })

  test('DOM-FIN-068, K-97: kapalı fonda atama elle iptal edilmez; bakiye sıfır kalır, kayıt değişmez', async () => {
    const t = await institution()
    const fund = await createFund(t)
    await ok(await donate(t.admin, fund.id, { ...DONATION, amountCents: 100_000 }), 201)
    const allocated = await ok(await allocate(t.admin, fund.id, t.awardS1, 100_000), 201)
    const allocation = (allocated.movements as Json[]).find(
      (row) => row.kind === 'allocation',
    ) as Json
    await ok(
      await call(
        'POST',
        `${FUNDS}/${String(fund.id)}/close`,
        t.admin,
        undefined,
        ifMatch(fund.version),
      ),
    )
    const before = await allocationRows(t.id)
    assertError(
      await call(
        'POST',
        `${FUNDS}/${String(fund.id)}/allocations/${String(allocation.id)}/cancel`,
        t.admin,
        { reason: 'Burs yanlış öğrenciye bağlandı' },
        { ...key(), ...ifMatch(allocation.version) },
      ),
      422,
      'scholarship_fund_closed',
    )
    assert.deepEqual(await allocationRows(t.id), before)
    const after = (await report(t.admin, fund.id)).fund as Json
    assert.deepEqual([after.status, after.balanceCents], ['closed', 0])
    assert.equal((await audits(t.id, 'scholarship_fund.allocation_cancel')).length, 0)
  })

  test('DOM-FIN-068: liste arar, süzer ve sayfalar; toplamlar fon başınadır', async () => {
    const t = await institution()
    const first = await createFund(t)
    await createFund(t, { name: 'Şükran Fonu', donorKind: 'person', donorName: 'Ayşe Öztürk' })
    await createFund(t, { name: 'Anonim Fon', donorKind: 'anonymous' })
    await ok(await donate(t.admin, first.id), 201)
    const page = await get(`${FUNDS}?page=1&pageSize=2`, t.admin)
    assert.equal(page.statusCode, 200, page.body)
    assert.equal(page.json().meta.total, 3)
    assert.equal(page.json().data.length, 2)
    const search = await get(`${FUNDS}?q=sukran`, t.admin)
    assert.deepEqual(
      (search.json().data as Json[]).map((row) => row.name),
      ['Şükran Fonu'],
    )
    const byDonor = await get(`${FUNDS}?q=${encodeURIComponent('öztürk')}`, t.admin)
    assert.equal(byDonor.json().meta.total, 1)
    const mezun = (await get(`${FUNDS}?q=mezun`, t.admin)).json().data as Json[]
    assert.deepEqual(
      mezun.map((row) => [row.donatedCents, row.balanceCents, row.donationCount]),
      [[1_500_000, 1_500_000, 1]],
    )
    assert.equal((await get(`${FUNDS}?status=closed`, t.admin)).json().meta.total, 0)
    assertError(await get(`${FUNDS}?status=arsiv`, t.admin), 400)
    assertError(await get(`${FUNDS}?sort=name`, t.admin), 400)
  })

  test('DOM-FIN-068: rapor CSV taze oturum ister, denetime yazılır, formül kaçışlıdır (K-99)', async () => {
    const t = await institution()
    const fund = await createFund(t)
    await ok(await donate(t.admin, fund.id, { ...DONATION, note: '=HYPERLINK("x")' }), 201)
    await ok(await allocate(t.admin, fund.id, t.awardS1, 500_000), 201)
    const url = `${FUNDS}/${String(fund.id)}/report`
    const file = await call('GET', url, t.admin, undefined, { accept: 'text/csv' })
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /text\/csv/)
    const lines = file.body.replace('\uFEFF', '').split('\r\n')
    assert.equal(lines.length, 1 + 2 + 3)
    assert.match(lines[2] ?? '', /"Deniz Yılmaz";2026;-5000,00;10000,00$/)
    assert.match(lines.at(-1) ?? '', /"Bakiye";"";"";"";10000,00;""$/)
    assert.deepEqual(
      (await audits(t.id, 'finance.scholarship_fund_export')).map((row) => row.entityId),
      [String(fund.id)],
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

  test('DOM-FIN-068: başka kurumun fonu, bağışı, ataması ve bursu 404; listede yok; B değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const bFund = await createFund(b)
    const bDonated = await ok(await donate(b.admin, bFund.id), 201)
    const bDonation = (bDonated.movements as Json[])[0] as Json
    const bAllocated = await ok(await allocate(b.admin, bFund.id, b.awardS1, 100_000), 201)
    const bAllocation = (bAllocated.movements as Json[]).find(
      (row) => row.kind === 'allocation',
    ) as Json
    const aFund = await createFund(a, { ...FUND, name: 'A Fonu' })
    await ok(await donate(a.admin, aFund.id), 201)
    const before = {
      funds: await fundRows(b.id),
      donations: await donationRows(b.id),
      allocations: await allocationRows(b.id),
    }
    const bUrl = `${FUNDS}/${String(bFund.id)}`
    const reason = { reason: 'Başka kurum denemesi' }

    assertError(await get(`${bUrl}/report`, a.admin), 404)
    assertError(await donate(a.admin, bFund.id), 404)
    assertError(await allocate(a.admin, bFund.id, b.awardS1, 100), 404)
    assertError(
      await call('POST', `${bUrl}/close`, a.admin, undefined, ifMatch(bFund.version)),
      404,
    )
    assertError(
      await call('POST', `${bUrl}/donations/${String(bDonation.id)}/cancel`, a.admin, reason, {
        ...key(),
        ...ifMatch(bDonation.version),
      }),
      404,
    )
    assertError(
      await call('POST', `${bUrl}/allocations/${String(bAllocation.id)}/cancel`, a.admin, reason, {
        ...key(),
        ...ifMatch(bAllocation.version),
      }),
      404,
    )
    // A'nın fonuyla B'nin bursu karşılanamaz.
    assertError(await allocate(a.admin, aFund.id, b.awardS1, 100), 404, 'not_found')
    // Gövdedeki institutionId etkisizdir: şema reddeder, hiçbir kurumda kayıt açılmaz.
    assertError(
      await call('POST', FUNDS, a.admin, { ...FUND, name: 'Sızma', institutionId: b.id }),
      400,
    )
    const list = (await get(FUNDS, a.admin)).json().data as Json[]
    assert.deepEqual(
      list.map((row) => row.name),
      ['A Fonu'],
    )
    assert.deepEqual(await fundRows(b.id), before.funds)
    assert.deepEqual(await donationRows(b.id), before.donations)
    assert.deepEqual(await allocationRows(b.id), before.allocations)
  })
})
