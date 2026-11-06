import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { insertMissingRecords } from '../../src/db/records.ts'
import { feeTariffs } from '../../src/db/schema/fee-tariffs.ts'
import { studentServices } from '../../src/db/schema/finance-student-services.ts'
import { invoices } from '../../src/db/schema/invoices.ts'
import { databaseErrorInfo } from '../../src/errors.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Ek hizmet aboneliğinin eşzamanlılığı (DOM-FIN-003; ON-087): aynı öğrenci ve türe eşzamanlı iki
 * yazılma tek abonelik ve tek taksit bırakır; kurum kilidi atlansa da kısmi benzersiz indeks ikinci
 * açık aboneliği durdurur.
 */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const YEAR = 2026

describe('PostgreSQL 16: ek hizmet aboneliği eşzamanlılığı', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution() {
    const created = await createInstitution(app, {})
    assert.ok(STUDENT)
    const tariffId = randomUUID()
    await db.insert(feeTariffs).values({
      institutionId: created.id,
      id: tariffId,
      academicYear: YEAR,
      versionNumber: 1,
      status: 'published',
      items: [
        {
          kind: 'transport',
          level: null,
          amountCents: 4_000_000,
          unit: 'year',
          vatBasisPoints: 1000,
          vatEffectiveDate: '2026-01-01',
          announcedAmountCents: null,
        },
      ],
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'classes',
          id: 'c1',
          data: { ...SEED.classes.find((item) => item.id === 'c1') },
        },
        { collection: 'students', id: STUDENT.id, data: { ...STUDENT } },
      ],
      FIXED_NOW,
    )
    return { id: created.id, tariffId, cookie: await signInAs(app, created.admin) }
  }

  const subscribe = (cookie: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/finance/student-services',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        cookie,
        'idempotency-key': `test-pg-svc-${randomUUID()}`,
      },
      payload: JSON.stringify({
        studentId: STUDENT?.id,
        kind: 'transport',
        academicYear: YEAR,
        startDate: '2026-09-15',
      }),
    })

  test('DOM-FIN-003: aynı öğrenci ve türe eşzamanlı iki yazılma: biri 201, öteki 409; tek taksit', async () => {
    const a = await institution()
    const responses = await Promise.all([subscribe(a.cookie), subscribe(a.cookie)])
    assert.deepEqual(responses.map((item) => item.statusCode).sort(), [201, 409])
    const loser = responses.find((item) => item.statusCode === 409)
    assert.equal(loser?.json().code, 'student_service_open')
    const services = await db
      .select({ id: studentServices.id })
      .from(studentServices)
      .where(eq(studentServices.institutionId, a.id))
    assert.equal(services.length, 1)
    const lines = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.institutionId, a.id))
    assert.equal(lines.length, 1)
  })

  test('DOM-FIN-003: kurum kilidi atlansa da kısmi benzersiz indeks ikinci açık aboneliği reddeder', async () => {
    const a = await institution()
    assert.ok(STUDENT)
    const row = () => ({
      institutionId: a.id,
      id: randomUUID(),
      studentId: STUDENT?.id ?? '',
      kind: 'transport',
      academicYear: YEAR,
      tariffId: a.tariffId,
      tariffVersion: 1,
      unit: 'year',
      amountCents: 4_000_000,
      tariffAmountCents: 4_000_000,
      startDate: '2026-09-15',
      createdByUserId: 'test',
    })
    const settled = await Promise.allSettled([
      db.insert(studentServices).values(row()),
      db.insert(studentServices).values(row()),
    ])
    assert.deepEqual(settled.map((item) => item.status).sort(), ['fulfilled', 'rejected'])
    const reason: unknown = settled.find((item) => item.status === 'rejected')?.reason
    assert.equal(databaseErrorInfo(reason)?.code, '23505')
    assert.equal(databaseErrorInfo(reason)?.constraint, 'student_services_student_kind_open_key')
  })
})
