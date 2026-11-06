import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { recordKey, type CollectionName } from '../../src/db/collections.ts'
import { insertMissingRecords, loadRecords } from '../../src/db/records.ts'
import { feeTariffs } from '../../src/db/schema/fee-tariffs.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Toplu yenilemenin eşzamanlılığı (IST-105, ON-086): gerçek bağlantı havuzunda öğrenci başına ayrı
 * transaction, kurum kilidi ve satır anahtarı öğrenciyi iki kez planlamaz, kontenjanı aşmaz.
 */

const SEED = createSeed(FIXED_NOW)
const YEAR = 2027
const BASE = '/api/v1/finance/renewals'
const STUDENTS = Array.from({ length: 6 }, (_, index) => `test-pg-s${String(index)}`)
const seedStudent = SEED.students.find((item) => item.id === 's3')

describe('PostgreSQL 16: toplu yenileme', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app?.close()
    await close?.()
  })

  async function setup(capacity: number) {
    const created = await createInstitution(app)
    const target = { ...SEED.classes.find((item) => item.id === 'c1'), capacity }
    const samples: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
      branches: SEED.branches,
      teachers: SEED.teachers,
      classes: [...SEED.classes.filter((item) => item.id === 'c3'), target],
      parents: SEED.parents,
      students: STUDENTS.map((id) => ({
        ...seedStudent,
        id,
        name: `Test ${id}`,
        parentId: `test-parent-${id}`,
      })),
    }
    await insertMissingRecords(
      db,
      created.id,
      Object.entries(samples).flatMap(([collection, items]) =>
        (items ?? []).map((data) => {
          const name = collection as CollectionName
          const id = recordKey(name, data)
          if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
          return { collection: name, id, data }
        }),
      ),
      FIXED_NOW,
    )
    const tariffId = randomUUID()
    await db.insert(feeTariffs).values({
      institutionId: created.id,
      id: tariffId,
      academicYear: YEAR,
      versionNumber: 1,
      status: 'published',
      items: [
        {
          kind: 'tuition',
          level: null,
          amountCents: 3_000_000,
          unit: 'year',
          vatBasisPoints: 1000,
          vatEffectiveDate: '2026-01-01',
          announcedAmountCents: 3_000_000,
        },
      ],
      discounts: [],
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
    const admin = await signInAs(app, created.admin)
    const indexed = await post(`${BASE}/price-indexes`, admin, {
      academicYear: YEAR,
      ppiBasisPoints: 4_000,
      cpiBasisPoints: 3_000,
      source: 'TÜİK bülteni 53607',
      bulletinDate: '2026-02-03',
    })
    assert.equal(indexed.statusCode, 201, indexed.body)
    return { id: created.id, admin, tariffId }
  }

  const post = (url: string, cookie: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', cookie, ...headers },
      payload: JSON.stringify(body),
    })

  const planBody = (tariffId: string, students: readonly string[] = STUDENTS) => ({
    academicYear: YEAR,
    installmentCount: 3,
    firstDueDate: '2026-11-15',
    tariffId,
    rows: students.map((studentId) => ({ studentId, targetClassId: 'c1' })),
  })

  test('IST-105: aynı anahtarla koşut iki toplu onay her öğrenciyi bir kez planlar', async () => {
    const a = await setup(50)
    const headers = { 'idempotency-key': randomUUID() }
    const responses = await Promise.all([
      post(`${BASE}/bulk-plan`, a.admin, planBody(a.tariffId), headers),
      post(`${BASE}/bulk-plan`, a.admin, planBody(a.tariffId), headers),
    ])
    // Biten rapor saklanır; aynı anda biten ikinci istek 409 `idempotency_in_progress` alabilir.
    const statuses = responses.map((response) => response.statusCode)
    assert.ok(statuses.includes(200), String(statuses))
    for (const status of statuses) assert.ok([200, 409].includes(status), String(status))
    const renewals = await loadRecords(db, a.id, ['renewals'])
    assert.equal(renewals.length, STUDENTS.length)
    assert.equal(new Set(renewals.map((row) => row.data.studentId)).size, STUDENTS.length)
    const contracts = await loadRecords(db, a.id, ['contracts'])
    assert.equal(contracts.length, STUDENTS.length)
  })

  test('IST-105: farklı anahtarlı koşut iki toplu onay kontenjanı aşmaz, satırlar raporlanır', async () => {
    const a = await setup(2)
    const responses = await Promise.all([
      post(`${BASE}/bulk-plan`, a.admin, planBody(a.tariffId, STUDENTS.slice(0, 3)), {
        'idempotency-key': randomUUID(),
      }),
      post(`${BASE}/bulk-plan`, a.admin, planBody(a.tariffId, STUDENTS.slice(3)), {
        'idempotency-key': randomUUID(),
      }),
    ])
    const planned = responses.flatMap((response) => {
      assert.equal(response.statusCode, 200, response.body)
      return (response.json().data.rows as { outcome: string; problem: { code: string } | null }[])
        .filter((row) => row.outcome === 'planned')
        .map(() => 1)
    })
    assert.equal(planned.length, 2)
    const failures = responses.flatMap((response) =>
      (response.json().data.rows as { outcome: string; problem: { code: string } | null }[])
        .filter((row) => row.outcome !== 'planned')
        .map((row) => row.problem?.code),
    )
    assert.deepEqual([...new Set(failures)], ['class_capacity_full'])
    assert.equal((await loadRecords(db, a.id, ['renewals'])).length, 2)
  })

  test('IST-105: toplu onay sürerken kurumun öteki yazmaları öğrenci arasında ilerler', async () => {
    const a = await setup(50)
    const bulk = post(`${BASE}/bulk-plan`, a.admin, planBody(a.tariffId), {
      'idempotency-key': randomUUID(),
    })
    const index = await post(`${BASE}/price-indexes`, a.admin, {
      academicYear: YEAR + 1,
      ppiBasisPoints: 4_000,
      cpiBasisPoints: 3_000,
      source: 'TÜİK bülteni 53607',
      bulletinDate: '2026-02-03',
    })
    assert.equal(index.statusCode, 201, index.body)
    assert.equal((await bulk).json().data.summary.planned, STUDENTS.length)
  })
})
