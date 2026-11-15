import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertScholarshipAward } from '../src/db/finance-scholarships.ts'
import { findRecord, insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { scholarshipFundAllocations } from '../src/db/schema/finance-scholarship-funds.ts'
import {
  scholarshipAwards,
  scholarshipTerminations,
} from '../src/db/schema/finance-scholarships.ts'
import { invoices } from '../src/db/schema/invoices.ts'
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
import { checkFinanceMirrorAfterEach } from './support/finance-mirror.ts'
import {
  contractTerms,
  insertTestScholarshipProgram,
  insertTestTariff,
  TEST_SCHOLARSHIP_PROGRAM_ID,
} from './support/finance-terms.ts'

/**
 * Burs kesmesi ve gerçek dışı beyanla iptal ile geri isteme uçları (DOM-FIN-025; IST-105; ON-283;
 * K-264…K-267). Her test kendi kurumunu kurar: öğrenci, veli, 100.000 ₺ ilanlı, 30.000 ₺ burslu
 * sözleşme ve dört eşit öğrenim taksiti (17.500 ₺; burs payı 7.500 ₺). Saat 2026-10-06.
 */

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const SID = STUDENT?.id ?? ''
const FIRST_NAME = STUDENT?.name.split(' ')[0] ?? ''
const CONTRACT_ID = 'test-burs-contract'
const SHARE = 750_000
const TUITION = 1_750_000
const DUES = ['2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15']
const AWARDS = '/api/v1/finance/scholarship-awards'
const TERMINATE = {
  reason: 'discipline',
  note: 'Disiplin kurulu kararı, 2026/7.',
  effectiveDate: '2026-11-01',
  confirmedCents: 2 * SHARE,
}
const REVOKE_TOTAL = 3 * SHARE + SHARE + 10_356
const REVOKE = { note: 'Gelir belgesi gerçeğe aykırı çıktı.', confirmedCents: REVOKE_TOTAL }

describe('ON-283: burs kesme ve geri isteme uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  // ON-046e: her testten sonra taksit ve sözleşme aynası kaynakla aynıdır.
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(STUDENT)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    assert.ok(STUDENT)
    await insertTestTariff(db, created.id)
    await insertTestScholarshipProgram(db, created.id)
    const awardId = randomUUID()
    await insertScholarshipAward(db, created.id, {
      id: awardId,
      programId: TEST_SCHOLARSHIP_PROGRAM_ID,
      studentId: SID,
      academicYear: 2026,
      amountCents: 4 * SHARE,
      awardedByUserId: 'u-test',
      now: FIXED_NOW,
    })
    const invoiceIds = DUES.map((_, index) => `test-burs-inv-${String(index + 1)}`)
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'classes' as const,
          id: 'c1',
          data: { ...SEED.classes.find((item) => item.id === 'c1') },
        },
        { collection: 'students' as const, id: SID, data: { ...STUDENT } },
        {
          collection: 'parents' as const,
          id: STUDENT.parentId,
          data: { id: STUDENT.parentId, name: 'Test Ödeyici Veli', studentIds: [SID] },
        },
        {
          collection: 'contracts' as const,
          id: CONTRACT_ID,
          data: {
            id: CONTRACT_ID,
            studentId: SID,
            date: '2026-09-01T09:00:00.000Z',
            amount: 4 * TUITION,
            title: 'Özel okul eğitim sözleşmesi',
            invoiceIds,
            academicYear: 2026,
            ...contractTerms({ grossCents: 10_000_000, netCents: 4 * TUITION }),
            scholarship: { programId: TEST_SCHOLARSHIP_PROGRAM_ID, amountCents: 4 * SHARE },
          },
        },
        ...DUES.map((due, index) => ({
          collection: 'invoices' as const,
          id: invoiceIds[index] ?? '',
          data: {
            id: invoiceIds[index],
            studentId: SID,
            installment: index + 1,
            amount: TUITION,
            dueDate: `${due}T09:00:00.000Z`,
            paidAt: null,
            method: null,
            reminderAt: null,
            feeKind: 'tuition',
            academicYear: 2026,
          },
        })),
      ],
      FIXED_NOW,
    )
    return { ...created, awardId, cookie: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function member(institutionId: string, role: Role) {
    const links = role === 'veli' ? [{ kind: 'child' as const, recordId: SID }] : []
    return signInAs(app, await createMember(app, institutionId, role, links))
  }
  const call = (
    method: 'GET' | 'POST',
    target: string,
    cookie: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url: target,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  const versioned = (version: number, key = randomUUID()) => ({
    'if-match': `"${String(version)}"`,
    'idempotency-key': key,
  })
  function expectError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  async function ok(response: Response, status = 200): Promise<Json> {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  const quote = (t: Tenant, body: unknown, cookie = t.cookie) =>
    call('POST', `${AWARDS}/${t.awardId}/end-quote`, cookie, body)
  const end = (t: Tenant, kind: string, body: unknown, version = 1, cookie = t.cookie) =>
    call('POST', `${AWARDS}/${t.awardId}/${kind}`, cookie, body, versioned(version))
  const invoiceRows = (institutionId: string) =>
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.institutionId, institutionId), eq(invoices.studentId, SID)))
  const endRows = (institutionId: string) =>
    db
      .select()
      .from(scholarshipTerminations)
      .where(eq(scholarshipTerminations.institutionId, institutionId))
  async function contractIds(institutionId: string) {
    const row = await findRecord(db, institutionId, 'contracts', CONTRACT_ID)
    return (row?.data.invoiceIds ?? []) as string[]
  }
  const awardList = async (cookie: string) =>
    (await call('GET', AWARDS, cookie)).json().data as Json[]

  test('DOM-FIN-052: oturumsuz 401; yalnız yönetici; modül kapalı 403; taze oturum ister', async () => {
    const a = await institution()
    expectError(await quote(a, { kind: 'revoke' }, ''), 401)
    expectError(await call('POST', `${AWARDS}/${a.awardId}/revoke`, null, REVOKE), 401)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(a.id, role)
      expectError(await quote(a, { kind: 'revoke' }, cookie), 403, 'forbidden')
      expectError(await end(a, 'terminate', TERMINATE, 1, cookie), 403, 'forbidden')
      expectError(await call('GET', `${AWARDS}/${a.awardId}/ends`, cookie), 403, 'forbidden')
    }
    const closed = await institution({ enabledModules: { finance: false } })
    expectError(await quote(closed, { kind: 'revoke' }), 403, 'module_disabled')
    // 16 dakika sonra aynı oturum eski sayılır (freshAge 15 dk; oturum gerçek saatle açılır).
    const later = await buildTestApp(db, {
      clock: () => new Date(Date.now() + 16 * 60 * 1000),
    })
    try {
      const stale = await later.inject({
        method: 'POST',
        url: `${AWARDS}/${a.awardId}/terminate`,
        headers: {
          origin: TEST_ORIGIN,
          cookie: a.cookie,
          'content-type': 'application/json',
          ...versioned(1),
        },
        payload: JSON.stringify(TERMINATE),
      })
      expectError(stale, 403, 'reauthentication_required')
    } finally {
      await later.close()
    }
    assert.deepEqual(await endRows(a.id), [])
  })

  test('DOM-FIN-025, K-265: kesme ileriye etkilidir; yeni taksitler yazılır, atama sürümü artar, denetim ve bildirim düşer', async () => {
    const a = await institution()
    const parent = await member(a.id, 'veli')
    const preview = await ok(await quote(a, { kind: 'terminate', effectiveDate: '2026-11-01' }))
    assert.equal(preview.totalCents, 2 * SHARE)
    assert.equal(preview.keptCents, 2 * SHARE)
    assert.deepEqual(preview.reinstated, [
      { dueDate: '2026-11-15', amountCents: SHARE },
      { dueDate: '2026-12-15', amountCents: SHARE },
    ])
    const before = await invoiceRows(a.id)

    // If-Match ve Idempotency-Key zorunlu; bayat önizleme ve eski sürüm yazmaz.
    const noMatch = await call('POST', `${AWARDS}/${a.awardId}/terminate`, a.cookie, TERMINATE, {
      'idempotency-key': randomUUID(),
    })
    expectError(noMatch, 400, 'if_match_required')
    expectError(
      await call('POST', `${AWARDS}/${a.awardId}/terminate`, a.cookie, TERMINATE, {
        'if-match': '"1"',
      }),
      400,
    )
    expectError(
      await end(a, 'terminate', { ...TERMINATE, confirmedCents: 1 }),
      409,
      'scholarship_end_changed',
    )
    expectError(await end(a, 'terminate', TERMINATE, 7), 409, 'version_conflict')
    expectError(await end(a, 'terminate', { ...TERMINATE, reason: 'bilinmeyen' }), 400)
    expectError(
      await end(a, 'terminate', { ...TERMINATE, effectiveDate: '2026-10-01' }),
      422,
      'scholarship_end_date_past',
    )
    assert.equal((await invoiceRows(a.id)).length, before.length)
    assert.deepEqual(await endRows(a.id), [])

    const key = randomUUID()
    const done = await call(
      'POST',
      `${AWARDS}/${a.awardId}/terminate`,
      a.cookie,
      TERMINATE,
      versioned(1, key),
    )
    const data = await ok(done, 201)
    assert.equal(data.kind, 'terminate')
    assert.equal(data.reinstatedCents, 2 * SHARE)
    assert.equal(data.note, undefined)
    const created = (data.invoiceIds as string[]).sort()
    const rows = (await invoiceRows(a.id)).filter((row) => created.includes(row.id))
    assert.deepEqual(
      rows
        .map((row) => [row.installment, row.amountCents, row.dueDate, row.contractId, row.feeKind])
        .sort(),
      [
        [5, SHARE, '2026-11-15', CONTRACT_ID, 'tuition'],
        [6, SHARE, '2026-12-15', CONTRACT_ID, 'tuition'],
      ],
    )
    assert.deepEqual((await contractIds(a.id)).slice(-2).sort(), created)
    const replay = await call(
      'POST',
      `${AWARDS}/${a.awardId}/terminate`,
      a.cookie,
      TERMINATE,
      versioned(1, key),
    )
    assert.equal(replay.statusCode, 201, replay.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await invoiceRows(a.id)).length, before.length + 2)

    const [award] = await db
      .select({ version: scholarshipAwards.version })
      .from(scholarshipAwards)
      .where(eq(scholarshipAwards.id, a.awardId))
    assert.equal(award?.version, 2)
    const listed = (await awardList(a.cookie)).find((item) => item.id === a.awardId)
    assert.equal(listed?.endStatus, 'terminated')
    assert.equal(listed?.endedOn, '2026-11-01')
    expectError(
      await end(a, 'terminate', { ...TERMINATE, effectiveDate: '2026-11-02' }, 2),
      409,
      'scholarship_already_terminated',
    )

    const audit = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'scholarship.terminate')))
    assert.ok(audit.length >= 1)
    assert.ok(!JSON.stringify(audit).includes(TERMINATE.note))

    const notices = (await call('GET', '/api/v1/notifications', parent)).json().data as Json[]
    assert.deepEqual(
      notices
        .filter((item) => item.kind === 'scholarship_ended')
        .map((item) => [item.audience, item.title, item.subject]),
      [
        [
          'parent',
          `${FIRST_NAME} için burs kararı alındı; ayrıntı için kurumla görüşün.`,
          { type: 'scholarship_awards', id: a.awardId },
        ],
      ],
    )
    const ends = await ok(await call('GET', `${AWARDS}/${a.awardId}/ends`, a.cookie))
    assert.equal(ends.programName, 'Test başarı bursu')
    assert.deepEqual(
      (ends.ends as Json[]).map((item) => [item.kind, item.note]),
      [['terminate', TERMINATE.note]],
    )
  })

  test('DOM-FIN-025, K-266: gerçek dışı beyanda uygulanan pay kanuni faiziyle sözleşme dışı alacak olur', async () => {
    const a = await institution()
    const preview = await ok(await quote(a, { kind: 'revoke' }))
    assert.equal(preview.principalCents, SHARE)
    assert.equal(preview.interestCents, 10_356)
    assert.equal(preview.reinstatedCents, 3 * SHARE)
    assert.equal(preview.clawbackDueDate, '2026-11-05')
    assert.equal(preview.totalCents, REVOKE_TOTAL)
    const data = await ok(await end(a, 'revoke', REVOKE), 201)
    assert.equal(data.reason, 'false_declaration')
    const created = data.invoiceIds as string[]
    const rows = (await invoiceRows(a.id)).filter((row) => created.includes(row.id))
    const standalone = rows.filter((row) => row.contractId === null)
    assert.deepEqual(standalone.map((row) => [row.amountCents, row.dueDate]).sort(), [
      [10_356, '2026-11-05'],
      [SHARE, '2026-11-05'],
    ])
    assert.equal(rows.filter((row) => row.contractId === CONTRACT_ID).length, 3)
    const listed = (await awardList(a.cookie)).find((item) => item.id === a.awardId)
    assert.equal(listed?.endStatus, 'revoked')
    expectError(await quote(a, { kind: 'revoke' }), 409, 'scholarship_already_revoked')
    const [row] = await endRows(a.id)
    assert.equal(row?.principalCents, SHARE)
    assert.equal(row?.interestCents, 10_356)
  })

  test('DOM-FIN-068, K-119: kesmede fon payı kalan bursa iner, en yeni atama bırakılır', async () => {
    const a = await institution()
    // Aynı fondan bir bursa tek atama olur (K-96); iki fon, en yenisi bırakılır.
    for (const name of ['Mezunlar Fonu', 'Veli Derneği Fonu']) {
      const fund = await ok(
        await call(
          'POST',
          '/api/v1/finance/scholarship-funds',
          a.cookie,
          { name, donorKind: 'organization', donorName: 'Test Derneği' },
          { 'idempotency-key': randomUUID() },
        ),
        201,
      )
      const fundId = String((fund.fund as Json).id)
      await ok(
        await call(
          'POST',
          `/api/v1/finance/scholarship-funds/${fundId}/donations`,
          a.cookie,
          { amountCents: 1_000_000, donatedOn: '2026-10-01', channel: 'bank_transfer' },
          { 'idempotency-key': randomUUID() },
        ),
        201,
      )
      await ok(
        await call(
          'POST',
          `/api/v1/finance/scholarship-funds/${fundId}/allocations`,
          a.cookie,
          { awardId: a.awardId, amountCents: 1_000_000 },
          { 'idempotency-key': randomUUID() },
        ),
        201,
      )
    }
    await ok(await end(a, 'terminate', TERMINATE), 201)
    const allocations = await db
      .select()
      .from(scholarshipFundAllocations)
      .where(eq(scholarshipFundAllocations.institutionId, a.id))
    assert.equal(allocations.filter((row) => row.cancelledAt === null).length, 1)
    assert.match(
      allocations.find((row) => row.cancelledAt !== null)?.cancelReason ?? '',
      /Burs kesildi/,
    )
  })

  test('DOM-FIN-010, K-265: bursu kesilen onaylı sözleşmeye ek protokol yapılmaz', async () => {
    const a = await institution()
    const contract = (target: string) => `/api/v1/finance/contracts/${CONTRACT_ID}/${target}`
    const version = async () => (await findRecord(db, a.id, 'contracts', CONTRACT_ID))?.version ?? 0
    await ok(
      await call(
        'POST',
        contract('signatory'),
        a.cookie,
        { name: 'Test Kurucu', role: 'founder' },
        versioned(await version()),
      ),
    )
    await ok(
      await call(
        'POST',
        contract('approve'),
        a.cookie,
        { accepted: true },
        versioned(await version()),
      ),
    )
    await ok(await end(a, 'terminate', TERMINATE), 201)
    expectError(
      await call(
        'POST',
        contract('amendments'),
        a.cookie,
        { reason: 'Plan değişti.', installmentCount: 2, firstDueDate: '2026-11-20' },
        versioned(await version()),
      ),
      409,
      'contract_scholarship_ended',
    )
  })

  test('DOM-YTK-025: başka kurumun ataması 404; kurum A değişmez, gövdedeki kurum kimliği etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const foreign = { ...b, awardId: a.awardId }
    expectError(await quote(foreign, { kind: 'revoke' }), 404)
    expectError(await end(foreign, 'revoke', REVOKE), 404)
    expectError(await end(foreign, 'terminate', TERMINATE), 404)
    expectError(await call('GET', `${AWARDS}/${a.awardId}/ends`, b.cookie), 404)
    expectError(await end(b, 'revoke', { ...REVOKE, institutionId: a.id }), 400)
    assert.deepEqual(await endRows(a.id), [])
    assert.equal((await invoiceRows(a.id)).length, DUES.length)
    expectError(
      await quote(a, { kind: 'terminate', effectiveDate: '2027-09-01' }),
      422,
      'scholarship_end_date_out_of_year',
    )
  })
})
