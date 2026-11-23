import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertScholarshipAward, insertScholarshipProgram } from '../src/db/finance-scholarships.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
import { scholarshipFundAllocations } from '../src/db/schema/finance-scholarship-funds.ts'
import { scholarshipAwards } from '../src/db/schema/finance-scholarships.ts'
import {
  buildTestApp,
  createInstitution,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

/**
 * Burs ataması arşivlenince fondan karşılanan payın kendiliğinden iptali (DOM-FIN-068; ON-330,
 * K-117…K-119). Her test kendi kurumunu kurar: s3'ün 2026 sözleşmesi ve 2026 bursu vardır; 2027
 * yenilemesi %25 bursla planlanır (30.000 ₺ ilan → 7.500 ₺ burs), ayrılış yenilemeyi iptal eder.
 */

const SEED = createSeed(FIXED_NOW)
const YEAR = 2026
const NEXT_YEAR = 2027
const RENEWALS = '/api/v1/finance/renewals'
const FUNDS = '/api/v1/finance/scholarship-funds'
const ANNOUNCED_CENTS = 3_000_000
const NEXT_AWARD_CENTS = 750_000
const CURRENT_AWARD_CENTS = 400_000
const CLASSES = ['c1', 'c3']
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASSES.includes(item.id)),
  students: SEED.students.filter((item) => CLASSES.includes(item.classId)),
  parents: SEED.parents,
  contracts: [
    {
      id: 'test-contract-s3',
      studentId: 's3',
      date: FIXED_NOW.toISOString(),
      amount: 2_000_000,
      title: 'Özel okul eğitim sözleşmesi',
      academicYear: YEAR,
    },
  ],
}
const INDEX = {
  academicYear: NEXT_YEAR,
  ppiBasisPoints: 4_000,
  cpiBasisPoints: 3_000,
  source: 'TÜİK bülteni 53607',
  bulletinDate: '2026-02-03',
}
const QUOTE = {
  studentId: 's3',
  targetClassId: 'c1',
  academicYear: NEXT_YEAR,
  installmentCount: 4,
}
const WITHDRAW = {
  withdrawalDate: '2026-10-01',
  termStartDate: '2026-09-07',
  attendedUnits: 18,
  totalUnits: 180,
  reason: 'relocation',
  targetSchool: 'Test Okulu',
}
const FUND = {
  name: 'Mezunlar Burs Fonu',
  donorKind: 'organization',
  donorName: 'Mezunlar Derneği',
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-068, ON-330: burs ataması arşivlenince fon payı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  type Headers = Record<string, string>
  const key = () => ({ 'idempotency-key': randomUUID() })
  const post = (url: string, cookie: string, body?: unknown, headers: Headers = key()) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  const get = (url: string, cookie: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })
  async function ok(response: Response, status = 200): Promise<Json> {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }

  /** Kurum, 2027 tarifesi ve endeksi, s3'ün 2026 bursu ve 2027 burslu yenilemesi. */
  async function institution() {
    const created = await createInstitution(app)
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
    const admin = await signInAs(app, created.admin)
    await db.insert(feeTariffs).values({
      institutionId: created.id,
      id: randomUUID(),
      academicYear: NEXT_YEAR,
      versionNumber: 1,
      status: 'published',
      items: [
        {
          kind: 'tuition',
          level: null,
          amountCents: ANNOUNCED_CENTS,
          unit: 'year',
          vatBasisPoints: 1000,
          vatEffectiveDate: '2026-01-01',
          announcedAmountCents: ANNOUNCED_CENTS,
        },
      ],
      discounts: [],
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
    await ok(await post(`${RENEWALS}/price-indexes`, admin, INDEX), 201)

    const currentProgram = randomUUID()
    await insertScholarshipProgram(db, created.id, {
      id: currentProgram,
      academicYear: YEAR,
      name: 'Başarı Bursu 2026',
      conditions: 'Sınav puanı 90 ve üstü.',
      terminationConditions: 'Disiplin cezası.',
      durationNote: 'Bir yıl',
      percentBasisPoints: null,
      amountCents: CURRENT_AWARD_CENTS,
      capacity: 5,
      now: FIXED_NOW,
    })
    const currentAward = randomUUID()
    await insertScholarshipAward(db, created.id, {
      id: currentAward,
      programId: currentProgram,
      studentId: 's3',
      academicYear: YEAR,
      amountCents: CURRENT_AWARD_CENTS,
      awardedByUserId: 'test',
      now: FIXED_NOW,
    })

    const program = await ok(
      await post('/api/v1/finance/scholarship-programs', admin, {
        academicYear: NEXT_YEAR,
        name: 'Başarı Bursu 2027',
        conditions: 'Sınav puanı 90 ve üstü.',
        terminationConditions: 'Disiplin cezası alan öğrencinin bursu kesilir.',
        durationNote: 'Bir eğitim yılı',
        percentBasisPoints: 2_500,
        capacity: 1,
      }),
      201,
    )
    await ok(
      await post(
        `/api/v1/finance/scholarship-programs/${String(program.id)}/notify`,
        admin,
        { notifiedDate: '2026-09-01' },
        { 'if-match': '"1"' },
      ),
    )
    const quote = await ok(
      await post(`${RENEWALS}/quote`, admin, {
        ...QUOTE,
        scholarshipProgramId: program.id,
      }),
    )
    await ok(
      await post(RENEWALS, admin, {
        ...QUOTE,
        scholarshipProgramId: program.id,
        mode: 'renew',
        tariffId: quote.tariffId,
        firstDueDate: '2026-11-15',
      }),
      201,
    )
    const [nextAward] = await db
      .select({ id: scholarshipAwards.id, amountCents: scholarshipAwards.amountCents })
      .from(scholarshipAwards)
      .where(
        and(
          eq(scholarshipAwards.institutionId, created.id),
          eq(scholarshipAwards.academicYear, NEXT_YEAR),
        ),
      )
    assert.equal(nextAward?.amountCents, NEXT_AWARD_CENTS)
    return {
      id: created.id,
      admin,
      currentAward,
      nextAward: nextAward.id,
      programId: String(program.id),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  /** Fon açar, bağış girer; kimliğini döndürür. */
  async function fund(t: Tenant, name: string, donationCents: number) {
    const made = await ok(await post(FUNDS, t.admin, { ...FUND, name }), 201)
    const id = String((made.fund as Json).id)
    await ok(
      await post(`${FUNDS}/${id}/donations`, t.admin, {
        amountCents: donationCents,
        donatedOn: '2026-10-01',
        channel: 'bank_transfer',
      }),
      201,
    )
    return id
  }
  const allocate = async (t: Tenant, fundId: string, awardId: string, amountCents: number) =>
    ok(await post(`${FUNDS}/${fundId}/allocations`, t.admin, { awardId, amountCents }), 201)
  const fundOf = async (t: Tenant, fundId: string) =>
    (await ok(await get(`${FUNDS}/${fundId}/report`, t.admin))).fund as Json
  const allocationRows = (institutionId: string) =>
    db
      .select()
      .from(scholarshipFundAllocations)
      .where(eq(scholarshipFundAllocations.institutionId, institutionId))
      .orderBy(scholarshipFundAllocations.amountCents)
  const awardRow = async (institutionId: string, id: string) =>
    (
      await db
        .select({ archivedAt: scholarshipAwards.archivedAt, version: scholarshipAwards.version })
        .from(scholarshipAwards)
        .where(
          and(eq(scholarshipAwards.institutionId, institutionId), eq(scholarshipAwards.id, id)),
        )
    )[0]
  const audits = (institutionId: string, action: string) =>
    db
      .select({ entityId: auditLog.entityId, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const withdraw = (t: Tenant, body: Json = WITHDRAW) =>
    post('/api/v1/students/s3/withdraw', t.admin, body)

  test('DOM-FIN-068, K-117: ayrılışla iptal edilen yenilemenin bursu arşivlenir, fon payı aynı işlemde bakiyeye döner', async () => {
    const t = await institution()
    const fundId = await fund(t, 'Mezunlar Burs Fonu', 1_500_000)
    await allocate(t, fundId, t.nextAward, 600_000)
    await allocate(t, fundId, t.currentAward, 300_000)
    assert.equal((await fundOf(t, fundId)).balanceCents, 600_000)

    await ok(await withdraw(t), 201)

    // Yürürlüğe girmeyecek 2027 bursunun payı döner; okunan 2026 bursunun payı kalır.
    const after = await fundOf(t, fundId)
    assert.deepEqual(
      [after.balanceCents, after.allocatedCents, after.allocationCount],
      [1_200_000, 300_000, 1],
    )
    const [current, next] = await allocationRows(t.id)
    assert.equal(current?.awardId, t.currentAward)
    assert.equal(current?.cancelledAt, null)
    assert.equal(next?.awardId, t.nextAward)
    assert.equal(next?.cancelledAt?.toISOString(), FIXED_NOW.toISOString())
    assert.match(next?.cancelReason ?? '', /Burs ataması arşivlendi/)
    assert.equal(next?.version, 2)
    assert.equal(
      (await awardRow(t.id, t.nextAward))?.archivedAt?.toISOString(),
      FIXED_NOW.toISOString(),
    )
    assert.equal((await awardRow(t.id, t.currentAward))?.archivedAt, null)

    // Denetime alan adları düşer; gerekçe metni yazılmaz.
    const released = await audits(t.id, 'scholarship_fund.allocation_release')
    assert.deepEqual(
      released.map((row) => row.entityId),
      [next?.id],
    )
    assert.equal(JSON.stringify(released).includes('arşivlendi'), false)
    assert.deepEqual(
      (await audits(t.id, 'scholarship.award_archive')).map((row) => row.entityId),
      [t.nextAward],
    )
    // Arşivli bursa yeniden atama yapılamaz; boşalan kontenjan yeni bursa açılır.
    assert.equal(
      (
        await post(`${FUNDS}/${fundId}/allocations`, t.admin, {
          awardId: t.nextAward,
          amountCents: 100,
        })
      ).statusCode,
      404,
    )
    const programs = await ok(
      await get(`/api/v1/finance/scholarship-programs?academicYear=${String(NEXT_YEAR)}`, t.admin),
    )
    assert.equal(((programs as unknown as Json[])[0] as Json | undefined)?.awardedCount, 0)
  })

  test('DOM-FIN-068, K-118: kapalı fondaki pay iptal edilmez; açık fondaki pay döner, kapalı fon sıfırda kalır', async () => {
    const t = await institution()
    const open = await fund(t, 'Açık Fon', 1_000_000)
    const closing = await fund(t, 'Kapanan Fon', 250_000)
    await allocate(t, open, t.nextAward, 500_000)
    const closed = await allocate(t, closing, t.nextAward, 250_000)
    await ok(
      await post(`${FUNDS}/${closing}/close`, t.admin, undefined, {
        ...key(),
        'if-match': `"${String((closed.fund as Json).version)}"`,
      }),
    )

    await ok(await withdraw(t), 201)

    assert.equal((await fundOf(t, open)).balanceCents, 1_000_000)
    const frozen = await fundOf(t, closing)
    assert.deepEqual([frozen.status, frozen.balanceCents, frozen.allocationCount], ['closed', 0, 1])
    const rows = await allocationRows(t.id)
    assert.deepEqual(
      rows.map((row) => [row.amountCents, row.cancelledAt === null]),
      [
        [250_000, true],
        [500_000, false],
      ],
    )
  })

  test('DOM-FIN-068: ayrılış reddedilirse burs ve fon payı değişmez', async () => {
    const t = await institution()
    const fundId = await fund(t, 'Mezunlar Burs Fonu', 1_000_000)
    await allocate(t, fundId, t.nextAward, 600_000)
    const before = {
      allocations: await allocationRows(t.id),
      award: await awardRow(t.id, t.nextAward),
    }
    const rejected = await withdraw(t, { ...WITHDRAW, reason: 'health' })
    assert.equal(rejected.statusCode, 400, rejected.body)
    assert.deepEqual(
      { allocations: await allocationRows(t.id), award: await awardRow(t.id, t.nextAward) },
      before,
    )
    assert.equal((await fundOf(t, fundId)).balanceCents, 400_000)
  })
})
