import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertScholarshipAward } from '../src/db/finance-scholarships.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { feeTariffs, priceIndexRates } from '../src/db/schema/fee-tariffs.ts'
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

/**
 * Tarifeye bağlı kayıt yenileme uçları (IST-100; DOM-FIN-002, -005, -023, -025; DOM-KAY-020, -021).
 * Her test kendi kurumunu kurar: s3 (6-A, c3) 2026 sözleşmesiyle 7-A'ya (c1) yenilenir.
 */

const SEED = createSeed(FIXED_NOW)
const YEAR = 2027
const BASE = '/api/v1/finance/renewals'
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
const QUOTE = { studentId: 's3', targetClassId: 'c1', academicYear: YEAR, installmentCount: 4 }

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
      amount: BASE_CENTS,
      title: 'Özel okul eğitim sözleşmesi',
      academicYear: 2026,
      grossCents: BASE_CENTS,
    },
  ],
}

describe('IST-100: kayıt yenileme uçları', () => {
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

  async function publish(institutionId: string, academicYear = YEAR) {
    await db.insert(feeTariffs).values({
      institutionId,
      id: randomUUID(),
      academicYear,
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
        {
          kind: 'meal',
          level: null,
          amountCents: 500_000,
          unit: 'year',
          vatBasisPoints: 1000,
          vatEffectiveDate: '2026-01-01',
          announcedAmountCents: null,
        },
      ],
      discounts: [{ kind: 'early_payment', percentBasisPoints: 1_000, amountCents: null }],
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
  }

  type Headers = Record<string, string>
  const send = (
    method: 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body: unknown,
    headers: Headers = {},
  ) =>
    app.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      payload: JSON.stringify(body),
    })
  const post = (url: string, cookie: string | null, body: unknown, headers: Headers = {}) =>
    send('POST', url, cookie, body, headers)
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

  /** Önizlemenin tarifesiyle plan gövdesi. */
  async function planBody(cookie: string, extra: Record<string, unknown> = {}) {
    const quote = await post(`${BASE}/quote`, cookie, { ...QUOTE, ...extra })
    assert.equal(quote.statusCode, 200, quote.body)
    return {
      ...QUOTE,
      ...extra,
      mode: 'renew',
      tariffId: quote.json().data.tariffId as string,
      firstDueDate: '2026-11-15',
    }
  }
  const count = async (institutionId: string, collection: CollectionName) =>
    (await loadRecords(db, institutionId, [collection])).length

  async function ready() {
    const a = await institution()
    await publish(a.id)
    const made = await post(INDEXES, a.admin, INDEX)
    assert.equal(made.statusCode, 201, made.body)
    return a
  }

  test('DOM-YTK-001: oturumsuz 401; yazma yönetici ve ön büro, liste veli de; öğretmen ve öğrenci 403', async () => {
    assertError(await get(BASE, null), 401)
    assertError(await post(`${BASE}/quote`, null, QUOTE), 401)
    assertError(await post(BASE, null, {}, key()), 401)
    assertError(await get(INDEXES, null), 401)
    const a = await ready()
    for (const role of ['ogretmen', 'ogrenci'] as const) {
      const cookie = await member(a.id, role)
      assertError(await get(BASE, cookie), 403, 'forbidden')
      assertError(await post(`${BASE}/quote`, cookie, QUOTE), 403, 'forbidden')
    }
    const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: 's3' }])
    assertError(await post(`${BASE}/quote`, parent, QUOTE), 403, 'forbidden')
    assertError(await post(BASE, parent, await planBody(a.admin), key()), 403, 'forbidden')
    assertError(await get(INDEXES, parent), 403, 'forbidden')
    const desk = await member(a.id, 'onburo')
    assertError(await post(INDEXES, desk, { ...INDEX, academicYear: 2028 }), 403, 'forbidden')
    assert.equal((await get(INDEXES, desk)).statusCode, 200)
  })

  test('DOM-YTK-040, DOM-YTK-012: finance ya da renewal kapalıysa 403, dil okulunda 404', async () => {
    const closings: Record<string, boolean>[] = [{ finance: false }, { renewal: false }]
    for (const enabledModules of closings) {
      const closed = await institution({ enabledModules })
      assertError(await get(BASE, closed.admin), 403, 'module_disabled')
      assertError(await post(`${BASE}/quote`, closed.admin, QUOTE), 403, 'module_disabled')
      assertError(await post(BASE, closed.admin, {}, key()), 403, 'module_disabled')
      assertError(await post(INDEXES, closed.admin, INDEX), 403, 'module_disabled')
    }
    const language = await institution({ type: 'language_school' })
    assertError(await get(BASE, language.admin), 404)
  })

  test('DOM-FIN-005: ÜFE/TÜFE oranı bir kez girilir, If-Match ile düzeltilir; biçim hatası 400 ve satır değişmez', async () => {
    const a = await institution()
    const made = await post(INDEXES, a.admin, INDEX)
    assert.equal(made.statusCode, 201, made.body)
    assert.equal(made.headers.location, `${INDEXES}/${String(YEAR)}`)
    assert.equal(made.json().data.version, 1)
    assertError(await post(INDEXES, a.admin, INDEX), 409, 'price_index_exists')
    assertError(
      await post(INDEXES, a.admin, { ...INDEX, academicYear: 2028, bulletinDate: '2026-12-01' }),
      422,
      'price_index_date_future',
    )
    assertError(await post(INDEXES, a.admin, { ...INDEX, academicYear: 2028, source: 'x' }), 400)
    const url = `${INDEXES}/${String(YEAR)}`
    assertError(await send('PATCH', url, a.admin, { ppiBasisPoints: 1 }), 400, 'if_match_required')
    assertError(
      await send('PATCH', url, a.admin, { ppiBasisPoints: 1 }, { 'if-match': '"9"' }),
      409,
      'version_conflict',
    )
    assertError(
      await send('PATCH', `${INDEXES}/2030`, a.admin, { ppiBasisPoints: 1 }, { 'if-match': '"1"' }),
      404,
    )
    const fixed = await send(
      'PATCH',
      url,
      a.admin,
      { ppiBasisPoints: 4_100 },
      { 'if-match': '"1"' },
    )
    assert.equal(fixed.statusCode, 200, fixed.body)
    assert.equal(fixed.json().data.ppiBasisPoints, 4_100)
    assert.equal(fixed.json().data.version, 2)
    const listed = (await get(INDEXES, a.admin)).json()
    assert.equal(listed.meta.total, 1)
    const audit = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.entityType, 'price_index_rates')))
    assert.deepEqual(audit.map((row) => row.action).sort(), [
      'price_index.create',
      'price_index.update',
    ])
  })

  test('DOM-FIN-005: önizleme tavanı hesaplar, kayıt yazmaz; oran yoksa 422 price_index_missing', async () => {
    const a = await institution()
    await publish(a.id)
    assertError(await post(`${BASE}/quote`, a.admin, QUOTE), 422, 'price_index_missing')
    await post(INDEXES, a.admin, INDEX)
    const before = await count(a.id, 'renewals')
    const quote = await post(`${BASE}/quote`, a.admin, { ...QUOTE, discounts: ['early_payment'] })
    assert.equal(quote.statusCode, 200, quote.body)
    const data = quote.json().data
    assert.equal(data.announcedCents, ANNOUNCED_CENTS)
    assert.equal(data.ceiling.status, 'applied')
    assert.equal(data.ceiling.baseCents, BASE_CENTS)
    assert.equal(data.ceiling.ceilingCents, CEILING_CENTS)
    assert.equal(data.tuitionCents, CEILING_CENTS)
    assert.equal(data.discountCents, 300_000)
    assert.equal(data.netCents, 2_500_000)
    assert.deepEqual(data.installments, [625_000, 625_000, 625_000, 625_000])
    assert.equal(await count(a.id, 'renewals'), before)
  })

  test('DOM-FIN-002: hedef yılın tarifesi yoksa 422 tariff_not_published', async () => {
    const a = await institution()
    await publish(a.id, 2026)
    await post(INDEXES, a.admin, INDEX)
    assertError(await post(`${BASE}/quote`, a.admin, QUOTE), 422, 'tariff_not_published')
  })

  test('DOM-FIN-005: tavanı aşan plan 422 ve kayıt değişmez; Idempotency-Key zorunlu, gövde 400', async () => {
    const a = await ready()
    const body = await planBody(a.admin)
    const before = await loadRecords(db, a.id, ['renewals', 'contracts', 'invoices'])
    assertError(await post(BASE, a.admin, body), 400, 'idempotency_key_required')
    assertError(
      await post(BASE, a.admin, { ...body, tuitionCents: CEILING_CENTS + 1 }, key()),
      422,
      'renewal_above_ceiling',
    )
    assertError(
      await post(BASE, a.admin, { ...body, tuitionCents: ANNOUNCED_CENTS + 1 }, key()),
      422,
      'renewal_above_tariff',
    )
    assertError(await post(BASE, a.admin, { ...body, installmentCount: 13 }, key()), 400)
    assertError(await post(BASE, a.admin, { ...body, tariffId: randomUUID() }, key()), 409)
    assertError(
      await post(BASE, a.admin, body, { ...key(), 'if-match': '"1"' }),
      400,
      'if_match_not_supported',
    )
    assert.deepEqual(await loadRecords(db, a.id, ['renewals', 'contracts', 'invoices']), before)
  })

  test('DOM-KAY-020, DOM-FIN-012: plan sözleşme ve kendi taksitlerini yazar, sınıf değişmez; tekrarlanan anahtar ilk yanıtı döner, ikinci plan 409', async () => {
    const a = await ready()
    const body = await planBody(a.admin, { extras: ['meal'] })
    const headers = key()
    const invoicesBefore = await count(a.id, 'invoices')
    const made = await post(BASE, a.admin, body, headers)
    assert.equal(made.statusCode, 201, made.body)
    const { entity, contractId } = made.json().data
    assert.equal(made.headers.location, `${BASE}/${entity.id as string}`)
    const replay = await post(BASE, a.admin, body, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), made.json())
    assert.equal(await count(a.id, 'invoices'), invoicesBefore + 5)
    assertError(await post(BASE, a.admin, body, key()), 409, 'renewal_already_exists')

    const student = await findRecord(db, a.id, 'students', 's3')
    assert.equal(student?.data.classId, 'c3')
    const contract = await findRecord(db, a.id, 'contracts', contractId)
    assert.equal(contract?.data.grossCents, CEILING_CENTS)
    assert.equal(contract?.data.academicYear, YEAR)

    const detail = await get(`${BASE}/${entity.id as string}`, a.admin)
    assert.equal(detail.statusCode, 200, detail.body)
    const data = detail.json().data
    assert.equal(data.studentName, SEED.students.find((s) => s.id === 's3')?.name)
    assert.equal(data.fromClassName, '6-A')
    assert.equal(data.targetClassName, '7-A')
    assert.equal(data.netCents, CEILING_CENTS)
    assert.equal(data.pricing.ceiling.ceilingCents, CEILING_CENTS)
    assert.deepEqual(
      data.invoices.map((item: { installment: number; feeKind: string }) => [
        item.installment,
        item.feeKind,
      ]),
      [
        [1, 'tuition'],
        [2, 'tuition'],
        [3, 'tuition'],
        [4, 'tuition'],
        [5, 'meal'],
      ],
    )

    const list = (await get(`${BASE}?q=${encodeURIComponent(data.studentName)}`, a.admin)).json()
    assert.equal(list.meta.total, 1)
    assert.equal(list.data[0].id, entity.id)
    assert.equal((await get(`${BASE}?status=İptal`, a.admin)).json().meta.total, 0)
  })

  test('DOM-FIN-025: burs bildirilmiş programdan atanır, atama aynı işlemde yazılır; ön büro burs atayamaz', async () => {
    const a = await ready()
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
    const body = { ...(await planBody(a.admin)), scholarshipProgramId: programId }
    assertError(await post(BASE, a.admin, body, key()), 422, 'scholarship_program_not_notified')
    await post(
      `/api/v1/finance/scholarship-programs/${programId}/notify`,
      a.admin,
      { notifiedDate: '2026-09-01' },
      { 'if-match': '"1"' },
    )
    const desk = await member(a.id, 'onburo')
    assertError(await post(BASE, desk, body, key()), 422, 'scholarship_approval_required')
    const made = await post(BASE, a.admin, body, key())
    assert.equal(made.statusCode, 201, made.body)
    const awards = await db
      .select({ amountCents: scholarshipAwards.amountCents, year: scholarshipAwards.academicYear })
      .from(scholarshipAwards)
      .where(eq(scholarshipAwards.institutionId, a.id))
    // %25 ilan ücretinden (30.000 ₺): 7.500 ₺.
    assert.deepEqual(awards, [{ amountCents: 750_000, year: YEAR }])
  })

  /** Bildirilmiş burs programı açar; kimliğini döndürür. */
  async function notifiedProgram(cookie: string, academicYear: number, capacity: number) {
    const program = await post('/api/v1/finance/scholarship-programs', cookie, {
      academicYear,
      name: `Başarı Bursu ${String(academicYear)}`,
      conditions: 'Sınav puanı 90 ve üstü.',
      terminationConditions: 'Disiplin cezası alan öğrencinin bursu kesilir.',
      durationNote: 'Bir eğitim yılı',
      percentBasisPoints: 2_500,
      capacity,
    })
    assert.equal(program.statusCode, 201, program.body)
    const programId = program.json().data.id as string
    const notified = await post(
      `/api/v1/finance/scholarship-programs/${programId}/notify`,
      cookie,
      { notifiedDate: '2026-09-01' },
      { 'if-match': '"1"' },
    )
    assert.equal(notified.statusCode, 200, notified.body)
    return programId
  }
  /** Öğrencinin daha önce yazılmış ataması (ör. iptal edilen yenilemeden kalan). */
  const existingAward = (institutionId: string, programId: string, academicYear: number) =>
    insertScholarshipAward(db, institutionId, {
      id: randomUUID(),
      programId,
      studentId: 's3',
      academicYear,
      amountCents: 100_000,
      awardedByUserId: 'test',
      now: FIXED_NOW,
    })
  const awardRows = (institutionId: string) =>
    db
      .select({ id: scholarshipAwards.id, year: scholarshipAwards.academicYear })
      .from(scholarshipAwards)
      .where(eq(scholarshipAwards.institutionId, institutionId))
      .orderBy(scholarshipAwards.academicYear)

  test('DOM-FIN-025: öğrenciye aynı yılda ikinci burs 409 scholarship_already_awarded; kayıt değişmez', async () => {
    const a = await ready()
    const programId = await notifiedProgram(a.admin, YEAR, 2)
    await existingAward(a.id, programId, YEAR)
    const before = {
      renewals: await count(a.id, 'renewals'),
      contracts: await count(a.id, 'contracts'),
      invoices: await count(a.id, 'invoices'),
      awards: await awardRows(a.id),
    }
    const body = { ...(await planBody(a.admin)), scholarshipProgramId: programId }
    assertError(await post(BASE, a.admin, body, key()), 409, 'scholarship_already_awarded')
    // Önizleme de aynı kuralı uygular; plan yazılmadan önce görülür.
    assertError(
      await post(`${BASE}/quote`, a.admin, { ...QUOTE, scholarshipProgramId: programId }),
      409,
      'scholarship_already_awarded',
    )
    assert.deepEqual(
      {
        renewals: await count(a.id, 'renewals'),
        contracts: await count(a.id, 'contracts'),
        invoices: await count(a.id, 'invoices'),
        awards: await awardRows(a.id),
      },
      before,
    )
  })

  test('DOM-FIN-025: önceki yılın bursu yenileme yılındaki atamayı engellemez', async () => {
    const a = await ready()
    const previousId = await notifiedProgram(a.admin, YEAR - 1, 1)
    const programId = await notifiedProgram(a.admin, YEAR, 1)
    await existingAward(a.id, previousId, YEAR - 1)
    const body = { ...(await planBody(a.admin)), scholarshipProgramId: programId }
    const made = await post(BASE, a.admin, body, key())
    assert.equal(made.statusCode, 201, made.body)
    assert.deepEqual(
      (await awardRows(a.id)).map((row) => row.year),
      [YEAR - 1, YEAR],
    )
  })

  test('DOM-KAY-020: sınıf geçişi ayrı uçla uygulanır; ikinci kez 409', async () => {
    const a = await ready()
    const made = await post(BASE, a.admin, await planBody(a.admin), key())
    const id = made.json().data.entity.id as string
    const activated = await post(`${BASE}/${id}/activate`, a.admin, {})
    assert.equal(activated.statusCode, 200, activated.body)
    assert.equal((await findRecord(db, a.id, 'students', 's3'))?.data.classId, 'c1')
    assertError(await post(`${BASE}/${id}/activate`, a.admin, {}), 409)
    assertError(await post(`${BASE}/olmayan/activate`, a.admin, {}), 404)
  })

  test('DOM-YTK-002: veli yalnız bağlı çocuğunun yenilemesini görür', async () => {
    const a = await ready()
    const made = await post(BASE, a.admin, await planBody(a.admin), key())
    const id = made.json().data.entity.id as string
    const own = await member(a.id, 'veli', [{ kind: 'child', recordId: 's3' }])
    const other = SEED.students.find((s) => s.classId === 'c1')
    assert.ok(other)
    const stranger = await member(a.id, 'veli', [{ kind: 'child', recordId: other.id }])
    assert.equal((await get(BASE, own)).json().meta.total, 1)
    assert.equal((await get(`${BASE}/${id}`, own)).statusCode, 200)
    assert.equal((await get(BASE, stranger)).json().meta.total, 0)
    assertError(await get(`${BASE}/${id}`, stranger), 404)
  })

  test('IST-002: başka kurumun yenilemesi okuma ve geçişte 404, B değişmez; listede yok; gövdedeki institutionId reddedilir', async () => {
    const a = await ready()
    const b = await ready()
    const made = await post(BASE, b.admin, await planBody(b.admin), key())
    const id = made.json().data.entity.id as string
    const before = await findRecord(db, b.id, 'renewals', id)
    assertError(await get(`${BASE}/${id}`, a.admin), 404)
    assertError(await post(`${BASE}/${id}/activate`, a.admin, {}), 404)
    assert.deepEqual(await findRecord(db, b.id, 'renewals', id), before)
    assert.equal((await findRecord(db, b.id, 'students', 's3'))?.data.classId, 'c3')
    assert.equal((await get(BASE, a.admin)).json().meta.total, 0)
    assert.equal((await get(INDEXES, a.admin)).json().meta.total, 1)
    assertError(
      await post(BASE, a.admin, { ...(await planBody(a.admin)), institutionId: b.id }, key()),
      400,
    )
    assertError(await post(INDEXES, a.admin, { ...INDEX, institutionId: b.id }), 400)
    // Yalnız B'de bulunan öğrenci ve oran yılı A'dan önizlenemez, planlanamaz, düzeltilemez.
    const only = SEED.students.find((s) => s.id === 's3')
    await insertMissingRecords(
      db,
      b.id,
      [{ collection: 'students', id: 'test-b-ogrenci', data: { ...only, id: 'test-b-ogrenci' } }],
      FIXED_NOW,
    )
    await post(INDEXES, b.admin, { ...INDEX, academicYear: 2028 })
    const foreign = { ...QUOTE, studentId: 'test-b-ogrenci' }
    assertError(await post(`${BASE}/quote`, a.admin, foreign), 404)
    assertError(
      await post(
        BASE,
        a.admin,
        { ...(await planBody(a.admin)), studentId: 'test-b-ogrenci' },
        key(),
      ),
      404,
    )
    assertError(
      await send('PATCH', `${INDEXES}/2028`, a.admin, { ppiBasisPoints: 1 }, { 'if-match': '"1"' }),
      404,
    )
    assert.equal(await count(a.id, 'renewals'), 0)
    const rates = await db
      .select({ year: priceIndexRates.academicYear })
      .from(priceIndexRates)
      .where(eq(priceIndexRates.institutionId, b.id))
    assert.deepEqual(rates.map((row) => row.year).sort(), [YEAR, 2028])
    const unchanged = await get(INDEXES, b.admin)
    assert.ok(
      unchanged.json().data.every((row: { version: number }) => row.version === 1),
      unchanged.body,
    )
  })
})
