import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { loadFinanceRecords } from '../src/db/finance-mirror-store.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
import { idempotencyKeys } from '../src/db/schema/idempotency-keys.ts'
import { scholarshipAwards } from '../src/db/schema/finance-scholarships.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
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

/**
 * Yeni yılın toplu yenileme uçları (IST-105, ON-086; DOM-FIN-005, -013, -020…-025; DOM-KAY-025).
 * Her test kendi kurumunu kurar: c3 (6-A) öğrencileri 7-A'ya (c1) yenilenir; test-rows ile eklenenler
 * aynı sınıftadır, velileri ayrıdır.
 */

const SEED = createSeed(FIXED_NOW)
const YEAR = 2027
const BASE = '/api/v1/finance/renewals'
const CANDIDATES = `${BASE}/candidates`
const PREVIEW = `${BASE}/bulk-preview`
const PLAN = `${BASE}/bulk-plan`
const INDEXES = `${BASE}/price-indexes`
/** Baz 20.000 ₺; ÜFE %40 + TÜFE %30 → %35 + 5 puan: tavan 28.000 ₺. İlan 30.000 ₺. */
const BASE_CENTS = 2_000_000
const CEILING_CENTS = 2_800_000
const ANNOUNCED_CENTS = 3_000_000
const INDEX = {
  academicYear: YEAR,
  ppiBasisPoints: 4_000,
  cpiBasisPoints: 3_000,
  source: 'TÜİK bülteni 53607',
  bulletinDate: '2026-02-03',
}
const FIRST_DUE = '2026-11-15'
const S3 = { studentId: 's3', targetClassId: 'c1' }
const CLASSES = ['c1', 'c3']
const seedStudent = SEED.students.find((item) => item.id === 's3')
const ROWS = (...ids: readonly string[]) =>
  ids.map((studentId) => ({ studentId, targetClassId: 'c1' }))

const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASSES.includes(item.id)),
  students: SEED.students.filter((item) => item.id === 's3'),
  parents: SEED.parents,
  contracts: [
    {
      id: 'test-contract-s3',
      studentId: 's3',
      date: FIXED_NOW.toISOString(),
      amount: BASE_CENTS,
      title: 'Özel okul eğitim sözleşmesi',
      academicYear: 2026,
    },
  ],
}

describe('IST-105: yeni yılın toplu yenileme uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
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
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  const member = async (id: string, role: Role, links: readonly MembershipLinkInput[] = []) =>
    signInAs(app, await createMember(app, id, role, links))

  async function publish(institutionId: string) {
    const id = randomUUID()
    await db.insert(feeTariffs).values({
      institutionId,
      id,
      academicYear: YEAR,
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
      discounts: [
        { kind: 'early_payment', percentBasisPoints: 1_000, amountCents: null },
        { kind: 'sibling', percentBasisPoints: 1_000, amountCents: null },
      ],
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
    return id
  }

  type Headers = Record<string, string>
  const post = (url: string, cookie: string | null, body: unknown, headers: Headers = {}) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      payload: JSON.stringify(body),
    })
  const get = (url: string, cookie: string | null) =>
    app.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  const key = () => ({ 'idempotency-key': randomUUID() })
  function assertError(
    response: Awaited<ReturnType<typeof get>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const listOf = (extra = '') => `${CANDIDATES}?academicYear=${String(YEAR)}${extra}`
  const previewBody = (rows: readonly object[], extra: object = {}) => ({
    academicYear: YEAR,
    installmentCount: 3,
    firstDueDate: FIRST_DUE,
    rows,
    ...extra,
  })

  async function ready() {
    const a = await institution()
    const tariffId = await publish(a.id)
    const made = await post(INDEXES, a.admin, INDEX)
    assert.equal(made.statusCode, 201, made.body)
    const planBody = (rows: readonly object[], extra: object = {}) => ({
      ...previewBody(rows, extra),
      tariffId,
    })
    return { ...a, tariffId, planBody }
  }

  /** s3 ile aynı sınıfta, velisi ayrı öğrenciler. */
  async function addStudents(institutionId: string, ...ids: readonly string[]) {
    await insertMissingRecords(
      db,
      institutionId,
      ids.map((id) => ({
        collection: 'students' as const,
        id,
        data: { ...seedStudent, id, name: `Test ${id}`, parentId: `test-parent-${id}` },
      })),
      FIXED_NOW,
    )
  }
  async function addDebt(institutionId: string, studentId: string, amount = 150_000) {
    await insertMissingRecords(
      db,
      institutionId,
      [
        {
          collection: 'invoices',
          id: `test-debt-${studentId}`,
          data: {
            id: `test-debt-${studentId}`,
            studentId,
            installment: 1,
            amount,
            dueDate: '2026-06-15T09:00:00.000Z',
            feeKind: 'tuition',
            academicYear: 2026,
            paidAt: null,
            method: null,
            reminderAt: null,
            createdAt: FIXED_NOW.toISOString(),
            updatedAt: FIXED_NOW.toISOString(),
          },
        },
      ],
      FIXED_NOW,
    )
  }
  const counts = async (institutionId: string) => {
    const [renewals, contracts, invoices] = await Promise.all(
      (['renewals', 'contracts', 'invoices'] as const).map(
        async (collection) => (await loadRecords(db, institutionId, [collection])).length,
      ),
    )
    const audit = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.institutionId, institutionId))
    return { renewals, contracts, invoices, audit: audit.length }
  }

  test('DOM-YTK-001: oturumsuz 401; liste ve önizleme yönetici ve ön büro, toplu onay yalnız yönetici; öteki roller 403', async () => {
    assertError(await get(listOf(), null), 401)
    assertError(await post(PREVIEW, null, previewBody([S3])), 401)
    assertError(await post(PLAN, null, {}, key()), 401)
    const a = await ready()
    const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: 's3' }])
    for (const cookie of [await member(a.id, 'ogretmen'), await member(a.id, 'ogrenci'), parent]) {
      assertError(await get(listOf(), cookie), 403, 'forbidden')
      assertError(await post(PREVIEW, cookie, previewBody([S3])), 403, 'forbidden')
      assertError(await post(PLAN, cookie, a.planBody([S3]), key()), 403, 'forbidden')
    }
    const desk = await member(a.id, 'onburo')
    assert.equal((await get(listOf(), desk)).statusCode, 200)
    assert.equal((await post(PREVIEW, desk, previewBody([S3]))).statusCode, 200)
    const before = await counts(a.id)
    assertError(await post(PLAN, desk, a.planBody([S3]), key()), 403, 'forbidden')
    assert.deepEqual(await counts(a.id), before)
  })

  test('DOM-YTK-040, DOM-YTK-012: finance ya da renewal kapalıysa 403, yenileme türde yoksa 404', async () => {
    const closings: Record<string, boolean>[] = [{ finance: false }, { renewal: false }]
    for (const enabledModules of closings) {
      const closed = await institution({ enabledModules })
      assertError(await get(listOf(), closed.admin), 403, 'module_disabled')
      assertError(await post(PREVIEW, closed.admin, previewBody([S3])), 403, 'module_disabled')
      assertError(await post(PLAN, closed.admin, {}, key()), 403, 'module_disabled')
    }
    const language = await institution({ type: 'language_school' })
    assertError(await get(listOf(), language.admin), 404)
    assertError(await post(PREVIEW, language.admin, previewBody([S3])), 404)
    assertError(await post(PLAN, language.admin, {}, key()), 404)
  })

  test('IST-002: başka kurumun öğrencisi listede yok, önizleme ve onayda not_found, B değişmez; gövdedeki institutionId reddedilir', async () => {
    const a = await ready()
    const b = await ready()
    await addStudents(b.id, 'test-b-ogrenci')
    const before = await counts(b.id)
    const listed = (await get(listOf(), a.admin)).json()
    assert.deepEqual(
      listed.data.map((row: { studentId: string }) => row.studentId),
      ['s3'],
    )
    const preview = await post(PREVIEW, a.admin, previewBody(ROWS('test-b-ogrenci')))
    assert.equal(preview.statusCode, 200, preview.body)
    const [row] = preview.json().data.rows
    assert.equal(row.outcome, 'failed')
    assert.equal(row.problem.code, 'not_found')
    assert.equal(row.studentName, null)
    const plan = await post(PLAN, a.admin, a.planBody(ROWS('test-b-ogrenci')), key())
    assert.equal(plan.statusCode, 200, plan.body)
    assert.deepEqual(plan.json().data.summary, { planned: 0, skipped: 0, failed: 1 })
    assert.equal(plan.json().data.rows[0].problem.code, 'not_found')
    assert.equal(plan.json().data.rows[0].studentName, null)
    assert.deepEqual(await counts(b.id), before)
    assertError(await post(PREVIEW, a.admin, previewBody([S3], { institutionId: b.id })), 400)
    assertError(await post(PLAN, a.admin, a.planBody([S3], { institutionId: b.id }), key()), 400)
    assert.deepEqual(await counts(b.id), before)
  })

  test("IST-105: liste sayfalıdır; sınıf, önceki sözleşme, ilan, tavan, önerilen ücret ve durum gelir; süzgeçler SQL'dedir", async () => {
    const a = await ready()
    await addStudents(a.id, 'test-s1', 'test-s2')
    await insertMissingRecords(
      db,
      a.id,
      [
        {
          collection: 'students',
          id: 'test-pasif',
          data: { ...seedStudent, id: 'test-pasif', name: 'Pasif Öğrenci', isActive: false },
        },
        {
          collection: 'classes',
          id: 'test-c12',
          data: { ...SEED.classes.find((c) => c.id === 'c1'), id: 'test-c12', grade: 12 },
        },
        {
          collection: 'students',
          id: 'test-son',
          data: { ...seedStudent, id: 'test-son', name: 'Son Sınıf', classId: 'test-c12' },
        },
      ],
      FIXED_NOW,
    )
    const before = await counts(a.id)
    const all = (await get(listOf('&pageSize=2'), a.admin)).json()
    assert.equal(all.meta.total, 3, 'pasif ve son düzey öğrenci yenilenecekler listesinde yok')
    assert.equal(all.data.length, 2)
    const second = (await get(listOf('&pageSize=2&page=2'), a.admin)).json()
    assert.equal(second.data.length, 1)
    const zeynep = (await get(listOf('&q=zeynep'), a.admin)).json()
    assert.equal(zeynep.meta.total, 1)
    const [row] = zeynep.data
    assert.equal(row.studentId, 's3')
    assert.equal(row.className, '6-A')
    assert.equal(row.targetClassId, 'c1')
    assert.equal(row.targetClassName, '7-A')
    assert.deepEqual(row.previousContract, { academicYear: 2026, tuitionCents: BASE_CENTS })
    assert.equal(row.announcedCents, ANNOUNCED_CENTS)
    assert.equal(row.ceiling.ceilingCents, CEILING_CENTS)
    assert.equal(row.suggestedTuitionCents, CEILING_CENTS)
    assert.equal(row.planStatus, 'not_planned')
    assert.equal((await get(listOf('&classId=c1'), a.admin)).json().meta.total, 0)
    assert.equal((await get(listOf('&classId=c3'), a.admin)).json().meta.total, 3)
    assert.deepEqual(await counts(a.id), before)

    const planned = await post(PLAN, a.admin, a.planBody([S3]), key())
    assert.equal(planned.json().data.summary.planned, 1, planned.body)
    assert.equal((await get(listOf('&planStatus=not_planned'), a.admin)).json().meta.total, 2)
    const done = (await get(listOf('&planStatus=planned'), a.admin)).json()
    assert.equal(done.meta.total, 1)
    assert.equal(done.data[0].studentId, 's3')
    assert.ok(done.data[0].renewalId)
    assert.equal(done.data[0].renewalNetCents, CEILING_CENTS)
    assert.equal((await get(listOf('&planStatus=completed'), a.admin)).json().meta.total, 0)

    assertError(await get(`${CANDIDATES}?academicYear=2026`, a.admin), 422, 'renewal_year_invalid')
    assertError(await get(CANDIDATES, a.admin), 400)
    assertError(await get(listOf('&bilinmeyen=1'), a.admin), 400)
    assertError(await get(listOf('&planStatus=x'), a.admin), 400)
    assertError(await get(listOf('&pageSize=101'), a.admin), 400)
  })

  test('DOM-FIN-005: oran girilmemişse liste satırı nedenini söyler, önizleme ve onay satırı reddeder', async () => {
    const a = await institution()
    const tariffId = await publish(a.id)
    const listed = (await get(listOf(), a.admin)).json()
    assert.equal(listed.data[0].problem.code, 'price_index_missing')
    assert.equal(listed.data[0].suggestedTuitionCents, null)
    const preview = await post(PREVIEW, a.admin, previewBody([S3]))
    assert.equal(preview.json().data.rows[0].problem.code, 'price_index_missing')
    const plan = await post(PLAN, a.admin, { ...previewBody([S3]), tariffId }, key())
    assert.equal(plan.json().data.rows[0].problem.code, 'price_index_missing')
    assert.equal((await loadRecords(db, a.id, ['renewals'])).length, 0)
  })

  test('IST-105: önizleme hiçbir şey yazmaz; ücret tek öğrenci önizlemesiyle aynıdır, taksit toplamı neti tutar', async () => {
    const a = await ready()
    const before = await counts(a.id)
    const preview = await post(PREVIEW, a.admin, previewBody([S3]))
    assert.equal(preview.statusCode, 200, preview.body)
    const data = preview.json().data
    assert.deepEqual(data.summary, { ready: 1, skipped: 0, failed: 0 })
    assert.equal(data.tariff.id, a.tariffId)
    const [row] = data.rows
    assert.equal(row.studentName, 'Zeynep Demir')
    assert.equal(row.targetClassName, '7-A')
    const single = await post(`${BASE}/quote`, a.admin, {
      ...S3,
      academicYear: YEAR,
      installmentCount: 3,
    })
    assert.deepEqual(row.price, single.json().data)
    assert.notEqual(row.price.netCents % 3, 0)
    assert.equal(
      row.price.installments.reduce((sum: number, value: number) => sum + value, 0),
      row.price.netCents,
    )
    assert.deepEqual(await counts(a.id), before)
    assert.equal((await loadRecords(db, a.id, ['renewals'])).length, 0)
  })

  test('DOM-KAY-025: doğrulama hatası 400 ve kayıt değişmez: anahtarsız, üst sınır aşımı, yinelenen öğrenci, debtApproved', async () => {
    const a = await ready()
    await addDebt(a.id, 's3')
    const before = await counts(a.id)
    assertError(await post(PLAN, a.admin, a.planBody([S3])), 400, 'idempotency_key_required')
    assertError(await post(PLAN, a.admin, a.planBody([S3]), { 'idempotency-key': 'x' }), 400)
    assertError(await post(PLAN, a.admin, a.planBody([S3]), { ...key(), 'if-match': '"1"' }), 400)
    assertError(await post(PLAN, a.admin, a.planBody([]), key()), 400)
    assertError(await post(PLAN, a.admin, a.planBody([S3, S3]), key()), 400)
    assertError(await post(PLAN, a.admin, previewBody([S3]), key()), 400)
    const tooMany = ROWS(...Array.from({ length: 101 }, (_, index) => `test-${String(index)}`))
    assertError(await post(PLAN, a.admin, a.planBody(tooMany), key()), 400)
    assertError(await post(PREVIEW, a.admin, previewBody(tooMany)), 400)
    assertError(await post(PLAN, a.admin, a.planBody([S3], { debtApproved: true }), key()), 400)
    assertError(await post(PREVIEW, a.admin, previewBody([S3], { debtApproved: true })), 400)
    assertError(await post(PLAN, a.admin, a.planBody([S3], { installmentCount: 13 }), key()), 400)
    assert.deepEqual(await counts(a.id), before)
  })

  test('DOM-FIN-012, IST-105: onay sözleşme ve kendi taksitlerini yazar; taksit toplamı nete kuruşu kuruşuna eşittir; sınıf değişmez', async () => {
    const a = await ready()
    await addStudents(a.id, 'test-s1')
    const made = await post(PLAN, a.admin, a.planBody(ROWS('s3', 'test-s1')), key())
    assert.equal(made.statusCode, 200, made.body)
    const data = made.json().data
    assert.deepEqual(data.summary, { planned: 2, skipped: 0, failed: 0 })
    // s3'ün neti tavandır (28.000 ₺): 3'e tam bölünmez, kuruş artığı dağıtılır.
    assert.notEqual(data.rows[0].netCents % 3, 0)
    for (const row of data.rows) {
      assert.equal(row.outcome, 'planned')
      assert.equal(
        row.installments.reduce((sum: number, value: number) => sum + value, 0),
        row.netCents,
      )
      const invoices = await loadFinanceRecords(db, a.id, 'invoices', {
        match: [{ kind: 'equals', field: 'contractId', values: [row.contractId] }],
      })
      assert.equal(invoices.length, 3)
      assert.equal(
        invoices.reduce((sum, invoice) => sum + Number(invoice.data.amount), 0),
        row.netCents,
      )
      const [contract] = await loadFinanceRecords(db, a.id, 'contracts', { ids: [row.contractId] })
      assert.equal(contract?.data.netCents, row.netCents)
      assert.deepEqual(
        [...(contract?.data.invoiceIds as string[])].sort(),
        invoices.map((invoice) => invoice.id).sort(),
      )
    }
    assert.equal((await findRecord(db, a.id, 'students', 's3'))?.data.classId, 'c3')
    const audit = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'renewal.plan')))
    assert.equal(audit.length, 2, 'her öğrencinin kendi denetim satırı vardır')
  })

  test('DOM-KAY-025: borçlu öğrenci atlanır, "yönetici onayı gerekir" der, öteki öğrenci planlanır; otomatik onay yok, tek öğrenci yolunda karar verilebilir', async () => {
    const a = await ready()
    await addStudents(a.id, 'test-s1')
    await addDebt(a.id, 's3')
    const listed = (await get(listOf('&q=zeynep'), a.admin)).json()
    assert.equal(listed.data[0].outstandingTuitionCents, 150_000)
    const preview = await post(PREVIEW, a.admin, previewBody(ROWS('s3', 'test-s1')))
    const [debtor, clean] = preview.json().data.rows
    assert.equal(debtor.outcome, 'skipped')
    assert.equal(debtor.problem.code, 'renewal_debt_unapproved')
    assert.match(debtor.problem.message, /yönetici onayı gerekir/)
    assert.equal(debtor.price.outstandingTuitionCents, 150_000)
    assert.equal(clean.outcome, 'ready')

    const made = await post(PLAN, a.admin, a.planBody(ROWS('s3', 'test-s1')), key())
    assert.equal(made.statusCode, 200, made.body)
    const data = made.json().data
    assert.deepEqual(data.summary, { planned: 1, skipped: 1, failed: 0 })
    assert.equal(data.rows[0].outcome, 'skipped')
    assert.equal(data.rows[0].problem.code, 'renewal_debt_unapproved')
    assert.match(data.rows[0].problem.message, /yönetici onayı gerekir/)
    assert.equal(data.rows[0].renewalId, null)
    const renewals = await loadRecords(db, a.id, ['renewals'])
    assert.deepEqual(
      renewals.map((row) => row.data.studentId),
      ['test-s1'],
      'borçlu öğrencide kayıt açılmaz',
    )
    const single = await post(
      BASE,
      a.admin,
      {
        ...S3,
        academicYear: YEAR,
        installmentCount: 3,
        mode: 'renew',
        tariffId: a.tariffId,
        firstDueDate: FIRST_DUE,
        debtApproved: true,
      },
      key(),
    )
    assert.equal(single.statusCode, 201, single.body)
  })

  test('IST-105: kısmi başarı satır satır raporlanır; birinin hatası diğerini geri almaz, hatalı satır kayıt bırakmaz', async () => {
    const a = await ready()
    await addStudents(a.id, 'test-s1', 'test-s2', 'test-s3')
    await insertMissingRecords(
      db,
      a.id,
      [
        {
          collection: 'classes',
          id: 'test-dar',
          data: {
            ...SEED.classes.find((c) => c.id === 'c1'),
            id: 'test-dar',
            name: '7-Z',
            capacity: 1,
          },
        },
      ],
      FIXED_NOW,
    )
    const rows = [
      { studentId: 'test-s1', targetClassId: 'test-dar' },
      { studentId: 'test-s2', targetClassId: 'test-dar' },
      { studentId: 'test-yok', targetClassId: 'c1' },
      { studentId: 'test-s3', targetClassId: 'c3' },
      S3,
    ]
    const preview = (await post(PREVIEW, a.admin, previewBody(rows))).json().data
    const plan = await post(PLAN, a.admin, a.planBody(rows), key())
    assert.equal(plan.statusCode, 200, plan.body)
    const data = plan.json().data
    assert.deepEqual(
      data.rows.map((row: { outcome: string; problem: { code: string } | null }) => [
        row.outcome,
        row.problem?.code ?? null,
      ]),
      [
        ['planned', null],
        ['failed', 'class_capacity_full'],
        ['failed', 'not_found'],
        ['failed', 'new_class_level_invalid'],
        ['planned', null],
      ],
    )
    assert.deepEqual(data.summary, { planned: 2, skipped: 0, failed: 3 })
    assert.deepEqual(
      preview.rows.map((row: { outcome: string }) => row.outcome),
      ['ready', 'failed', 'failed', 'failed', 'ready'],
      'önizleme onayla aynı sonucu verir',
    )
    const renewals = await loadRecords(db, a.id, ['renewals'])
    assert.deepEqual(renewals.map((row) => row.data.studentId).sort(), ['s3', 'test-s1'])
    const contracts = await loadFinanceRecords(db, a.id, 'contracts', {
      match: [{ kind: 'equals', field: 'studentId', values: ['test-s2', 'test-s3', 'test-yok'] }],
    })
    assert.equal(contracts.length, 0, 'hatalı satırın sözleşmesi yok')
  })

  test('IST-105: aynı anahtar ilk raporu tekrarlar, yeni kayıt yazmaz; farklı gövde 422; yeni anahtar planlananı atlar', async () => {
    const a = await ready()
    await addStudents(a.id, 'test-s1')
    const body = a.planBody(ROWS('s3', 'test-s1'))
    const headers = key()
    const first = await post(PLAN, a.admin, body, headers)
    assert.equal(first.statusCode, 200, first.body)
    const after = await counts(a.id)
    const again = await post(PLAN, a.admin, body, headers)
    assert.equal(again.statusCode, 200, again.body)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    assert.deepEqual(await counts(a.id), after)
    assertError(
      await post(PLAN, a.admin, a.planBody(ROWS('s3')), headers),
      422,
      'idempotency_key_reused',
    )
    const fresh = await post(PLAN, a.admin, body, key())
    assert.deepEqual(fresh.json().data.summary, { planned: 0, skipped: 2, failed: 0 })
    assert.equal(fresh.json().data.rows[0].problem.code, 'renewal_already_exists')
    assert.deepEqual(await counts(a.id), after)
  })

  test('IST-105: yarıda kalan istek aynı anahtarla yeniden gönderilince planlananı yinelemez, kalanı planlar', async () => {
    const a = await ready()
    await addStudents(a.id, 'test-s1')
    const body = a.planBody(ROWS('s3', 'test-s1'))
    const headers = key()
    const first = await post(PLAN, a.admin, body, headers)
    assert.equal(first.json().data.summary.planned, 2, first.body)
    // İstek rapor saklanmadan kesilmiş gibi: satır anahtarları kalır, yalnız raporun anahtarı silinir.
    await db
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.institutionId, a.id),
          eq(idempotencyKeys.key, headers['idempotency-key']),
        ),
      )
    const after = await counts(a.id)
    const retried = await post(PLAN, a.admin, body, headers)
    assert.equal(retried.statusCode, 200, retried.body)
    assert.equal(retried.headers['idempotent-replayed'], undefined)
    assert.deepEqual(retried.json().data, first.json().data, 'aynı kayıtlar raporlanır')
    assert.deepEqual(await counts(a.id), after)
  })

  test('DOM-FIN-025: burs bildirilmiş programdan atanır, kontenjan satırlar arasında sayılır; atama aynı işlemdedir', async () => {
    const a = await ready()
    await addStudents(a.id, 'test-s1')
    const program = await post('/api/v1/finance/scholarship-programs', a.admin, {
      academicYear: YEAR,
      name: 'Başarı Bursu',
      conditions: 'Sınav puanı 90 ve üstü.',
      terminationConditions: 'Disiplin cezası alan öğrencinin bursu kesilir.',
      durationNote: 'Bir eğitim yılı',
      percentBasisPoints: 2_500,
      capacity: 1,
    })
    assert.equal(program.statusCode, 201, program.body)
    const programId = program.json().data.id as string
    const notified = await post(
      `/api/v1/finance/scholarship-programs/${programId}/notify`,
      a.admin,
      { notifiedDate: '2026-09-01' },
      { 'if-match': '"1"' },
    )
    assert.equal(notified.statusCode, 200, notified.body)
    const rows = ROWS('s3', 'test-s1')
    const withProgram = { scholarshipProgramId: programId }
    const preview = await post(PREVIEW, a.admin, previewBody(rows, withProgram))
    assert.deepEqual(
      preview.json().data.rows.map((row: { outcome: string }) => row.outcome),
      ['ready', 'failed'],
    )
    const desk = await member(a.id, 'onburo')
    const deskPreview = await post(PREVIEW, desk, previewBody(rows, withProgram))
    assert.equal(deskPreview.json().data.rows[0].problem.code, 'scholarship_approval_required')
    const made = await post(PLAN, a.admin, a.planBody(rows, withProgram), key())
    assert.equal(made.statusCode, 200, made.body)
    const data = made.json().data
    assert.deepEqual(data.summary, { planned: 1, skipped: 0, failed: 1 })
    assert.equal(data.rows[1].problem.code, 'scholarship_capacity_full')
    // %25 ilan ücretinden (30.000 ₺): 7.500 ₺; net tavandan düşer.
    assert.equal(data.rows[0].netCents, CEILING_CENTS - 750_000)
    const awards = await db
      .select({
        studentId: scholarshipAwards.studentId,
        amountCents: scholarshipAwards.amountCents,
      })
      .from(scholarshipAwards)
      .where(eq(scholarshipAwards.institutionId, a.id))
    assert.deepEqual(awards, [{ studentId: 's3', amountCents: 750_000 }])
  })

  /** s3'ün aynı veliye bağlı kardeşi; sözleşmesi verilen yılda ve ücrette. */
  async function addSibling(institutionId: string, academicYear: number, amount: number) {
    await insertMissingRecords(
      db,
      institutionId,
      [
        {
          collection: 'students',
          id: 'test-kardes',
          data: {
            ...seedStudent,
            id: 'test-kardes',
            name: 'Test Kardeş',
            parentId: seedStudent?.parentId,
          },
        },
        {
          collection: 'contracts',
          id: 'test-contract-kardes',
          data: {
            id: 'test-contract-kardes',
            studentId: 'test-kardes',
            date: FIXED_NOW.toISOString(),
            amount,
            title: 'Özel okul eğitim sözleşmesi',
            academicYear,
          },
        },
      ],
      FIXED_NOW,
    )
  }
  const siblingQuote = (a: { admin: string }) =>
    post(`${BASE}/quote`, a.admin, {
      ...S3,
      academicYear: YEAR,
      installmentCount: 3,
      discounts: ['sibling'],
    })

  test('DOM-FIN-022, K-22: kardeşin bu yıl kaydı yoksa yenilemede indirim yok; önizleme ve onay aynı kararı verir', async () => {
    const a = await ready()
    await addSibling(a.id, YEAR - 1, ANNOUNCED_CENTS * 2)
    assertError(await siblingQuote(a), 422, 'sibling_discount_ineligible')
    const rows = ROWS('s3', 'test-kardes')
    const preview = await post(PREVIEW, a.admin, previewBody(rows, { discounts: ['sibling'] }))
    assert.deepEqual(
      preview
        .json()
        .data.rows.map((row: { problem: { code: string } | null }) => row.problem?.code),
      ['sibling_discount_ineligible', 'sibling_discount_ineligible'],
    )
    const before = await counts(a.id)
    const made = await post(PLAN, a.admin, a.planBody(rows, { discounts: ['sibling'] }), key())
    assert.deepEqual(made.json().data.summary, { planned: 0, skipped: 0, failed: 2 })
    assert.deepEqual(await counts(a.id), before)
  })

  test('DOM-FIN-022, K-22: kardeş bu yıl kayıtlı ve ücreti yüksekse indirim uygulanır; kardeşi olmayan satır reddedilir', async () => {
    const a = await ready()
    await addStudents(a.id, 'test-yalniz')
    await addSibling(a.id, YEAR, ANNOUNCED_CENTS * 2)
    const single = await siblingQuote(a)
    assert.equal(single.statusCode, 200, single.body)
    const rows = ROWS('s3', 'test-yalniz')
    const preview = await post(PREVIEW, a.admin, previewBody(rows, { discounts: ['sibling'] }))
    const previewed = preview.json().data.rows
    assert.deepEqual(previewed[0].price, single.json().data)
    assert.deepEqual(
      previewed.map((row: { outcome: string; problem: { code: string } | null }) => [
        row.outcome,
        row.problem?.code ?? null,
      ]),
      [
        ['ready', null],
        ['failed', 'sibling_discount_ineligible'],
      ],
    )
    const made = await post(PLAN, a.admin, a.planBody(rows, { discounts: ['sibling'] }), key())
    assert.deepEqual(made.json().data.summary, { planned: 1, skipped: 0, failed: 1 })
    assert.equal(made.json().data.rows[1].problem.code, 'sibling_discount_ineligible')
  })

  test('DOM-FIN-022, K-22: bu yıl kayıtlı kardeşin ücreti düşükse çocuk ilk çocuktur, indirim almaz', async () => {
    const a = await ready()
    await addSibling(a.id, YEAR, BASE_CENTS / 2)
    assertError(await siblingQuote(a), 422, 'sibling_discount_ineligible')
    const made = await post(
      PLAN,
      a.admin,
      a.planBody(ROWS('s3'), { discounts: ['sibling'] }),
      key(),
    )
    assert.equal(made.json().data.rows[0].problem.code, 'sibling_discount_ineligible')
  })

  test('DOM-FIN-022, K-22: kardeşin planı bu yılın kaydıdır; sonra düşük ücretli çocuk indirim alır', async () => {
    const a = await ready()
    await addSibling(a.id, YEAR - 1, BASE_CENTS)
    const elder = await post(PLAN, a.admin, a.planBody(ROWS('test-kardes')), key())
    assert.deepEqual(elder.json().data.summary, { planned: 1, skipped: 0, failed: 0 })
    // İkisi de tavana kalır (28.000 ₺): eşit ücrette kaydı önce olan s3 ilk çocuktur.
    assertError(await siblingQuote(a), 422, 'sibling_discount_ineligible')
    const lower = await post(`${BASE}/quote`, a.admin, {
      ...S3,
      academicYear: YEAR,
      installmentCount: 3,
      tuitionCents: CEILING_CENTS - 1,
      discounts: ['sibling'],
    })
    assert.equal(lower.statusCode, 200, lower.body)
  })

  test('DOM-FIN-023, K-22: kardeş indirimli çocuğun tavan istisnası kardeşin yenileme yılındaki kaydına bakar', async () => {
    const a = await ready()
    // s3'ün kardeşi bu yıl kardeş indirimli; s3'ün yalnız bu yılın (2026) sözleşmesi var.
    await insertMissingRecords(
      db,
      a.id,
      [
        {
          collection: 'students',
          id: 'test-indirimli',
          data: { ...seedStudent, id: 'test-indirimli', name: 'Test İndirimli' },
        },
        {
          collection: 'contracts',
          id: 'test-contract-indirimli',
          data: {
            id: 'test-contract-indirimli',
            studentId: 'test-indirimli',
            date: FIXED_NOW.toISOString(),
            amount: BASE_CENTS - 200_000,
            title: 'Özel okul eğitim sözleşmesi',
            academicYear: 2026,
            // Tarife grubu tamdır ve var olan tarifeye bağlıdır; öteki kayıt tablo aynasına girmez.
            tariffId: a.tariffId,
            tariffVersion: 1,
            grossCents: BASE_CENTS,
            netCents: BASE_CENTS - 200_000,
            discounts: [{ kind: 'sibling', amountCents: 200_000 }],
            extras: [],
            approvedByUserId: 'test',
            payer: 'guardian',
          },
        },
      ],
      FIXED_NOW,
    )
    // Kardeş indirimi seçilmese de velinin öteki öğrencilerinin sözleşmeleri okunur.
    const lossOf = async () => {
      const quote = await post(`${BASE}/quote`, a.admin, {
        studentId: 'test-indirimli',
        targetClassId: 'c1',
        academicYear: YEAR,
        installmentCount: 3,
      })
      assert.equal(quote.statusCode, 200, quote.body)
      const list = (await get(listOf(), a.admin)).json()
      const line = list.data.find(
        (item: { studentId: string }) => item.studentId === 'test-indirimli',
      )
      assert.deepEqual(line.ceiling.discountLoss, quote.json().data.ceiling.discountLoss)
      return quote.json().data.ceiling.discountLoss
    }
    assert.match((await lossOf())?.reason ?? '', /Kardeş indirimi koşulu kalktı/)
    const elder = await post(PLAN, a.admin, a.planBody(ROWS('s3')), key())
    assert.deepEqual(elder.json().data.summary, { planned: 1, skipped: 0, failed: 0 })
    assert.equal(await lossOf(), null)
  })

  test('DOM-FIN-013: ilanda olmayan taksit sayısı satırda reddedilir; ödeme koşulu sözleşmeye yazılır', async () => {
    const a = await institution()
    const id = randomUUID()
    await db.insert(feeTariffs).values({
      institutionId: a.id,
      id,
      academicYear: YEAR,
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
      discounts: [{ kind: 'early_payment', percentBasisPoints: 1_000, amountCents: null }],
      paymentTerms: [
        {
          kind: 'upfront',
          minInstallments: 1,
          maxInstallments: 1,
          discountPercentBasisPoints: null,
          discountAmountCents: null,
        },
      ],
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
    await post(INDEXES, a.admin, INDEX)
    const wrong = await post(PLAN, a.admin, { ...previewBody([S3]), tariffId: id }, key())
    assert.equal(wrong.json().data.rows[0].problem.code, 'payment_term_not_in_tariff')
    const made = await post(
      PLAN,
      a.admin,
      {
        ...previewBody([S3], { installmentCount: 1, discounts: ['early_payment'] }),
        tariffId: id,
      },
      key(),
    )
    assert.equal(made.statusCode, 200, made.body)
    const [row] = made.json().data.rows
    assert.equal(row.outcome, 'planned', made.body)
    assert.deepEqual(row.installments, [row.netCents])
    const [contract] = await loadFinanceRecords(db, a.id, 'contracts', { ids: [row.contractId] })
    assert.equal((contract?.data.paymentTerm as { kind: string }).kind, 'upfront')
  })

  test('DOM-FIN-002: tarife değiştiyse satır tariff_changed olur, kayıt yazılmaz', async () => {
    const a = await ready()
    const before = await counts(a.id)
    const made = await post(PLAN, a.admin, { ...previewBody([S3]), tariffId: 'test-eski' }, key())
    assert.equal(made.statusCode, 200, made.body)
    assert.equal(made.json().data.rows[0].outcome, 'failed')
    assert.equal(made.json().data.rows[0].problem.code, 'tariff_changed')
    assert.deepEqual((await counts(a.id)).renewals, before.renewals)
  })
})
