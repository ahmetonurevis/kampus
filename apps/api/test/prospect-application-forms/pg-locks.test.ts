import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { and, count, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { APPLICATION_DAILY_PROSPECT_LIMIT } from '@kampus/school-core/lib/prospect-application-form.ts'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { updateApplicationFormRow } from '../../src/db/prospect-application-forms.ts'
import { insertMissingRecords, loadRecords, lockInstitution } from '../../src/db/records.ts'
import { auditLog } from '../../src/db/schema/audit-log.ts'
import { MESSAGES } from '../../src/errors.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  nextIp,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * Ön başvuru formunun kilit davranışı (ON-133; IST-145). PGlite tek bağlantılı olduğu için kilit
 * bekleyen gönderim, kilit zaman aşımı ve eşzamanlı tavan yalnız burada sınanır.
 */

const SEED = createSeed(FIXED_NOW)
const SETTINGS = '/api/v1/prospects/application-form'
const PUBLIC = '/api/v1/prospects/application-forms'
const NEW_KEY = 'b'.repeat(32)

describe('PostgreSQL 16: ön başvuru formu kilidi (ON-133)', { skip: PG_SKIP }, () => {
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

  /** `pg_locks` küme genelidir; paralel koşan öteki dosyaların beklemesi burada sayılmaz. */
  async function untilLockWait() {
    for (let attempt = 0; ; attempt += 1) {
      const [waiting] = await db
        .select({ n: count() })
        .from(sql`pg_locks`)
        .where(
          sql`locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())`,
        )
      if ((waiting?.n ?? 0) >= 1) return
      assert.ok(attempt < 200, 'gönderim kurum kilidini beklemedi')
      await delay(10)
    }
  }

  async function adminCall(
    method: 'PATCH' | 'POST',
    url: string,
    cookie: string,
    body?: Record<string, unknown>,
    version?: number,
    extra: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: nextIp(),
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...extra,
        ...(version === undefined ? {} : { 'if-match': `"${version}"` }),
      },
      ...(body === undefined ? {} : { payload: body }),
    })
  }

  /** Kurum, kampüsler, yayımlı aydınlatma ve açık form. */
  async function world() {
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
      FIXED_NOW,
    )
    const admin = await signInAs(app, institution.admin)
    const notice = await adminCall(
      'POST',
      '/api/v1/privacy-notices',
      admin,
      { kind: 'notice', audience: 'aday', title: 'Aday aydınlatması', body: 'Metin.' },
      undefined,
      { 'idempotency-key': randomUUID() },
    )
    assert.equal(notice.statusCode, 201, notice.body)
    const created = await adminCall('POST', `${SETTINGS}/rotate-key`, admin)
    assert.equal(created.statusCode, 200, created.body)
    const first = created.json<{ data: { version: number } }>().data
    const opened = await adminCall('PATCH', SETTINGS, admin, { enabled: true }, first.version)
    assert.equal(opened.statusCode, 200, opened.body)
    const form = opened.json<{ data: { formKey: string; version: number } }>().data
    return { institution, form }
  }

  const submit = (formKey: string, phone = '05329998877') =>
    app.inject({
      method: 'POST',
      url: `${PUBLIC}/${formKey}/submissions`,
      remoteAddress: nextIp(),
      headers: { origin: TEST_ORIGIN },
      payload: {
        name: 'Form Aday',
        phone,
        branchId: 'b1',
        interest: '7. sınıf',
        guardianName: 'Form Veli',
        privacyNoticeVersion: '1',
      },
    })

  const prospectCount = async (institutionId: string) =>
    (await loadRecords(db, institutionId, ['prospects'])).length

  test('kilitte beklerken anahtar yenilenirse gönderim 404 alır, aday ve denetim yazılmaz', async () => {
    const { institution, form } = await world()
    let pending: ReturnType<typeof submit> | undefined
    await db.transaction(async (tx) => {
      await lockInstitution(tx, institution.id)
      pending = submit(form.formKey)
      await untilLockWait()
      const rotated = await updateApplicationFormRow(
        tx,
        institution.id,
        form.version,
        { formKey: NEW_KEY },
        FIXED_NOW,
      )
      assert.ok(rotated)
    })
    const response = await pending
    assert.equal(response?.statusCode, 404, response?.body)
    assert.equal(response?.json<{ code: string }>().code, 'not_found')
    assert.equal(await prospectCount(institution.id), 0)
  })

  test('kilitte beklerken form kapanırsa gönderim 404 alır, aday yazılmaz', async () => {
    const { institution, form } = await world()
    let pending: ReturnType<typeof submit> | undefined
    await db.transaction(async (tx) => {
      await lockInstitution(tx, institution.id)
      pending = submit(form.formKey)
      await untilLockWait()
      const closed = await updateApplicationFormRow(
        tx,
        institution.id,
        form.version,
        { enabled: false },
        FIXED_NOW,
      )
      assert.ok(closed)
    })
    const response = await pending
    assert.equal(response?.statusCode, 404, response?.body)
    assert.equal(await prospectCount(institution.id), 0)
  })

  test('kilit uzun sürerse gönderim sınırlı bekler: 409 conflict ve Türkçe ileti, kayıt değişmez', async () => {
    const { institution, form } = await world()
    await db.transaction(async (tx) => {
      await lockInstitution(tx, institution.id)
      const response = await submit(form.formKey)
      assert.equal(response.statusCode, 409, response.body)
      const error = response.json<{ code: string; message: string }>()
      assert.equal(error.code, 'conflict')
      assert.equal(error.message, MESSAGES.conflict)
    })
    assert.equal(await prospectCount(institution.id), 0)
    assert.equal((await submit(form.formKey)).statusCode, 202)
    assert.equal(await prospectCount(institution.id), 1)
  })

  test('IST-145: tavana bir yer kaldığında eşzamanlı gönderimlerden yalnız biri aday açar', async () => {
    const { institution, form } = await world()
    await db.insert(auditLog).values(
      Array.from({ length: APPLICATION_DAILY_PROSPECT_LIMIT - 1 }, (_, index) => ({
        institutionId: institution.id,
        actorRole: 'system',
        action: 'prospect.application',
        entityType: 'prospects',
        entityId: `pr-seeded-${index}`,
        createdAt: FIXED_NOW,
      })),
    )
    const phones = Array.from({ length: 6 }, (_, index) => `0532999000${index}`)
    const responses = await Promise.all(phones.map((phone) => submit(form.formKey, phone)))
    for (const response of responses) assert.equal(response.statusCode, 202, response.body)
    assert.equal(await prospectCount(institution.id), 1)
    const [written] = await db
      .select({ n: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institution.id),
          eq(auditLog.action, 'prospect.application'),
        ),
      )
    assert.equal(written?.n, APPLICATION_DAILY_PROSPECT_LIMIT)
  })
})
