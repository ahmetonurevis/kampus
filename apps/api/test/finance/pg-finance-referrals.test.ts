import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { recordKey, type CollectionName } from '../../src/db/collections.ts'
import { loadFinanceRecords } from '../../src/db/finance-mirror-store.ts'
import { insertReferralReward, markReferralRewardUsed } from '../../src/db/finance-referrals.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../../src/db/records.ts'
import { feeTariffs, priceIndexRates } from '../../src/db/schema/fee-tariffs.ts'
import { referralRewards } from '../../src/db/schema/finance-referrals.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * PostgreSQL 16: referans hakkının tek kullanımı (DOM-FIN-024; ON-139). Aynı hakkı eşzamanlı isteyen
 * kesin kayıt ve yenileme kurum kilidinde sıraya girer: biri 201, öteki 409 alır, kaybedenin hiçbir
 * kaydı yazılmaz. Kilit atlansa bile depo yalnız `available` satırı işaretler.
 */

const SEED = createSeed(FIXED_NOW)
const CLASSES = ['c1', 'c3']
const REFERRER = 's3'
const REFERRER_PARENT = 'p3'
const YEAR = 2026
const NEXT_YEAR = 2027
const TUITION = {
  kind: 'tuition',
  level: null,
  amountCents: 3_000_000,
  unit: 'year',
  vatBasisPoints: 1000,
  vatEffectiveDate: '2026-01-01',
  announcedAmountCents: 3_000_000,
}

describe('PostgreSQL 16: referans hakkının tek kullanımı', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const post = (url: string, cookie: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        ...headers,
      },
      payload: JSON.stringify(body),
    })

  async function publish(institutionId: string, academicYear: number) {
    const id = randomUUID()
    await db.insert(feeTariffs).values({
      institutionId,
      id,
      academicYear,
      versionNumber: 1,
      status: 'published',
      items: [TUITION] as never,
      discounts: [{ kind: 'referral', percentBasisPoints: 1_000, amountCents: null }] as never,
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
    return id
  }

  /** Kullanılabilir hakkı olan kurum: s3'ün velisi p3 hak sahibidir. */
  async function institution() {
    const created = await createInstitution(app)
    const base = SEED.prospects[0]
    const sample: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
      branches: SEED.branches,
      teachers: SEED.teachers,
      classes: SEED.classes.filter((item) => CLASSES.includes(item.id)),
      students: SEED.students.filter((item) => CLASSES.includes(item.classId)),
      parents: SEED.parents,
      prospects: [{ ...base, id: 'pr-sib', phone: '05559990003', notes: [] }],
      contracts: [
        {
          id: 'test-contract-s3',
          studentId: REFERRER,
          date: FIXED_NOW.toISOString(),
          amount: 2_000_000,
          title: 'Özel okul eğitim sözleşmesi',
          academicYear: YEAR,
        },
      ],
    }
    await insertMissingRecords(
      db,
      created.id,
      Object.entries(sample).flatMap(([collection, items]) =>
        (items ?? []).map((data) => {
          const name = collection as CollectionName
          const id = recordKey(name, data)
          if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
          return { collection: name, id, data }
        }),
      ),
      FIXED_NOW,
    )
    const tariffId = await publish(created.id, YEAR)
    const nextTariffId = await publish(created.id, NEXT_YEAR)
    await db.insert(priceIndexRates).values({
      institutionId: created.id,
      academicYear: NEXT_YEAR,
      ppiBasisPoints: 4_000,
      cpiBasisPoints: 3_000,
      source: 'TÜİK bülteni 53607',
      bulletinDate: '2026-02-03',
    })
    const rewardId = randomUUID()
    await insertReferralReward(db, created.id, {
      id: rewardId,
      prospectId: 'pr-geçmiş',
      referrerStudentId: REFERRER,
      referrerParentId: REFERRER_PARENT,
      referredStudentId: 's-geçmiş',
      academicYear: YEAR,
      tariffId,
      percentBasisPoints: 1_000,
      amountCents: null,
      now: FIXED_NOW,
    })
    await db
      .update(referralRewards)
      .set({ status: 'available', earnedAt: FIXED_NOW })
      .where(eq(referralRewards.id, rewardId))
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      tariffId,
      nextTariffId,
      rewardId,
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const renew = (t: Tenant, headers: Record<string, string> = {}) =>
    post(
      '/api/v1/finance/renewals',
      t.admin,
      {
        mode: 'renew',
        studentId: REFERRER,
        targetClassId: 'c1',
        academicYear: NEXT_YEAR,
        installmentCount: 4,
        tariffId: t.nextTariffId,
        firstDueDate: '2027-09-15',
        discounts: ['referral'],
        referralRewardId: t.rewardId,
      },
      headers,
    )
  async function enroll(t: Tenant) {
    const prospect = await findRecord(db, t.id, 'prospects', 'pr-sib')
    assert.ok(prospect)
    return post(
      '/api/v1/prospects/pr-sib/enroll',
      t.admin,
      {
        tariffId: t.tariffId,
        classId: 'c1',
        installmentCount: 3,
        firstDueDate: '2026-11-15',
        identity: { kind: 'tc', number: '10000000146', birthDate: '2013-03-01' },
        guardian: { existingParentId: REFERRER_PARENT },
        discounts: ['referral'],
        referralRewardId: t.rewardId,
      },
      { 'if-match': `"${String(prospect.version)}"` },
    )
  }

  test('DOM-FIN-024: aynı hakkı eşzamanlı isteyen kayıt ve yenilemeden biri 201, öteki 409; hak tek sefer işaretlenir', async () => {
    const t = await institution()
    const contractsBefore = (await loadFinanceRecords(db, t.id, 'contracts')).length
    const [enrolled, renewed] = await Promise.all([enroll(t), renew(t)])
    assert.deepEqual(
      [enrolled.statusCode, renewed.statusCode].sort(),
      [201, 409],
      `${enrolled.body} ${renewed.body}`,
    )
    const loser = enrolled.statusCode === 409 ? enrolled : renewed
    assert.equal(loser.json().code, 'referral_reward_used')
    const rows = await db
      .select()
      .from(referralRewards)
      .where(eq(referralRewards.institutionId, t.id))
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.status, 'used')
    assert.equal(rows[0]?.version, 2)
    // Kaybedenin sözleşmesi, yenilemesi ve öğrencisi yazılmadı.
    assert.equal((await loadFinanceRecords(db, t.id, 'contracts')).length, contractsBefore + 1)
    const renewals = await loadRecords(db, t.id, ['renewals'])
    const prospect = await findRecord(db, t.id, 'prospects', 'pr-sib')
    assert.equal(renewals.length === 0, enrolled.statusCode === 201)
    assert.equal(prospect?.data.stage === 'Kayıt oldu', enrolled.statusCode === 201)
  })

  test('DOM-FIN-024: aynı Idempotency-Key ile eşzamanlı iki yenileme tek sözleşme açar, hak bir kez işaretlenir', async () => {
    const t = await institution()
    const headers = { 'idempotency-key': randomUUID() }
    const responses = await Promise.all([renew(t, headers), renew(t, headers)])
    // Biri sürerken gelen ikincisi 409 `idempotency_in_progress` olabilir; iki sözleşme olmaz.
    assert.ok(responses.some((item) => item.statusCode === 201))
    for (const item of responses)
      assert.ok(
        item.statusCode === 201 || item.json().code === 'idempotency_in_progress',
        item.body,
      )
    assert.equal((await loadRecords(db, t.id, ['renewals'])).length, 1)
    const [row] = await db
      .select()
      .from(referralRewards)
      .where(eq(referralRewards.institutionId, t.id))
    assert.equal(row?.status, 'used')
    assert.equal(row?.version, 2)
  })

  test('DOM-FIN-024: kurum kilidi atlansa da depo ikinci kullanımı işaretlemez', async () => {
    const t = await institution()
    const mark = (contractId: string) =>
      db.transaction((tx) =>
        markReferralRewardUsed(tx, t.id, {
          id: t.rewardId,
          contractId,
          studentId: REFERRER,
          amountCents: 300_000,
          userId: 'test',
          now: FIXED_NOW,
        }),
      )
    const results = await Promise.all([mark('c-a'), mark('c-b')])
    assert.deepEqual([...results].sort(), [false, true])
    const [row] = await db
      .select()
      .from(referralRewards)
      .where(eq(referralRewards.institutionId, t.id))
    assert.equal(row?.version, 2)
  })
})
