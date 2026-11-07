import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { INSTITUTION_TYPES } from '@kampus/school-core/modules/collection-modules.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { loadFinanceRecords } from '../src/db/finance-mirror-store.ts'
import { findRecord, insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
import {
  lessonPackageHourEntries,
  lessonPackages,
  lessonPackageSales,
} from '../src/db/schema/finance-packages.ts'
import { recordPackageHours } from '../src/services/finance-packages.ts'
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
import { contractTerms } from './support/finance-terms.ts'

/**
 * Dil okulu paket ve ders saati satışı uçları (IST-078; DOM-DIL-006, -050, -051; DOM-FIN-002, -010).
 * Her test kendi kurumunu kurar: s3 kursiyerdir, saat ücreti 500 ₺, kırtasiye 750 ₺.
 */

const SEED = createSeed(FIXED_NOW)
const YEAR = FIXED_NOW.getUTCFullYear()
const PACKAGES = '/api/v1/finance/packages'
const SALES = '/api/v1/finance/package-sales'
const HOURLY = 50_000
const HOURS_BODY = { kind: 'hours', name: '40 saatlik paket', lessonHours: 40, validityDays: 180 }
const COURSE_BODY = {
  name: 'Genel İngilizce B1',
  level: 'B1',
  totalHours: 96,
  weeklyHours: 6,
  minLearners: 4,
  maxLearners: 12,
}

const CLASSES = ['c1', 'c3']
const STUDENTS = SEED.students.filter((item) => CLASSES.includes(item.classId))
const OTHER_STUDENT = STUDENTS.find((item) => item.id !== 's3')?.id ?? ''
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASSES.includes(item.id)),
  students: STUDENTS,
  parents: SEED.parents,
}

describe('IST-078: paket ve ders saati satışı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let tenantCount = 0
  let clientIp = '10.0.0.1'
  // Uygulama logu (debug düzeyi): serbest metin gerekçe hiçbir satıra girmez (guvenlik-kvkk).
  const logs: string[] = []
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now, logs })
  })
  after(async () => {
    await app.close()
    await close()
  })

  type Headers = Record<string, string>
  type Method = 'POST' | 'PATCH' | 'DELETE'
  const send = (
    method: Method,
    url: string,
    cookie: string | null,
    body?: unknown,
    headers: Headers = {},
  ) =>
    app.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  const post = (url: string, cookie: string | null, body: unknown, headers: Headers = {}) =>
    send('POST', url, cookie, body, headers)
  const get = (url: string, cookie: string | null) =>
    app.inject({
      method: 'GET',
      url,
      remoteAddress: clientIp,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  const key = () => ({ 'idempotency-key': randomUUID() })
  const version = (value: number) => ({ 'if-match': `"${String(value)}"` })
  function assertError(
    response: Awaited<ReturnType<typeof get>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    // Genel hız sınırı (dakikada 300, IP başına) dosyanın bütününe değil her kuruma düşsün.
    clientIp = `10.0.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, { type: 'language_school', ...overrides })
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
    const tariffId = randomUUID()
    const vat = { vatBasisPoints: 1000, vatEffectiveDate: '2026-01-01' }
    await db.insert(feeTariffs).values({
      institutionId,
      id: tariffId,
      academicYear: YEAR,
      versionNumber: 1,
      status: 'published',
      items: [
        {
          kind: 'tuition',
          level: null,
          amountCents: HOURLY,
          unit: 'lesson_hour',
          announcedAmountCents: null,
          ...vat,
        },
        {
          kind: 'stationery',
          level: null,
          amountCents: 75_000,
          unit: 'item',
          announcedAmountCents: null,
          ...vat,
        },
      ],
      discounts: [{ kind: 'early_payment', percentBasisPoints: 1_000, amountCents: null }],
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
    return tariffId
  }

  async function ready() {
    const a = await institution()
    const tariffId = await publish(a.id)
    const made = await post(PACKAGES, a.admin, HOURS_BODY)
    assert.equal(made.statusCode, 201, made.body)
    const packageId = made.json().data.id as string
    const sale = {
      packageId,
      studentId: 's3',
      installmentCount: 4,
      tariffId,
      firstDueDate: '2026-10-31',
    }
    const quote = { packageId, studentId: 's3', installmentCount: 4 }
    return { ...a, tariffId, packageId, sale, quote }
  }
  async function sold(a: Awaited<ReturnType<typeof ready>>) {
    const response = await post(SALES, a.admin, a.sale, key())
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as { id: string; contractId: string; version: number }
  }
  async function activeCourse(cookie: string) {
    const made = await post('/api/v1/courses', cookie, COURSE_BODY, key())
    assert.equal(made.statusCode, 201, made.body)
    const id = made.json().data.id as string
    const active = await post(`/api/v1/courses/${id}/activate`, cookie, {}, version(1))
    assert.equal(active.statusCode, 200, active.body)
    return id
  }
  const packageRows = (institutionId: string) =>
    db.select().from(lessonPackages).where(eq(lessonPackages.institutionId, institutionId))
  const saleRows = (institutionId: string) =>
    db.select().from(lessonPackageSales).where(eq(lessonPackageSales.institutionId, institutionId))
  const financeCounts = async (institutionId: string) => ({
    contracts: (await loadFinanceRecords(db, institutionId, 'contracts')).length,
    invoices: (await loadFinanceRecords(db, institutionId, 'invoices')).length,
    sales: (await saleRows(institutionId)).length,
  })
  const NONE = { contracts: 0, invoices: 0, sales: 0 }
  const ctxOf = (institutionId: string) => ({
    db,
    institutionId,
    actor: { userId: 'test-user', role: 'yonetici' as const, membershipId: 'test-membership' },
    now,
    log: app.log,
  })

  test('DOM-FIN-013: önizleme ve satış ilanlı ödeme koşuluna bağlıdır, koşul sözleşmeye kopyalanır', async () => {
    const a = await ready()
    await db
      .update(feeTariffs)
      .set({
        paymentTerms: [
          {
            kind: 'installment',
            minInstallments: 2,
            maxInstallments: 4,
            discountPercentBasisPoints: 300,
            discountAmountCents: null,
          },
        ],
      })
      .where(eq(feeTariffs.id, a.tariffId))
    const quote = await post(`${SALES}/quote`, a.admin, a.quote)
    assert.equal(quote.statusCode, 200, quote.body)
    const price = quote.json().data
    assert.equal(price.paymentTerm.installmentCount, 4)
    assert.deepEqual(price.discounts, [{ kind: 'payment_term', amountCents: 60_000 }])
    assertError(
      await post(`${SALES}/quote`, a.admin, { ...a.quote, installmentCount: 6 }),
      422,
      'payment_term_not_in_tariff',
    )
    const made = await sold(a)
    const contract = await get(`/api/v1/collections/contracts/${made.contractId}`, a.admin)
    assert.equal(contract.statusCode, 200, contract.body)
    assert.equal(contract.json().data.record.paymentTerm.installmentCount, 4)
  })

  test('DOM-YTK-001: her uç oturumsuz 401', async () => {
    const id = randomUUID()
    assertError(await get(PACKAGES, null), 401)
    assertError(await post(PACKAGES, null, HOURS_BODY), 401)
    assertError(await get(`${PACKAGES}/${id}`, null), 401)
    assertError(
      await send('PATCH', `${PACKAGES}/${id}`, null, { name: 'Yeni ad' }, version(1)),
      401,
    )
    assertError(await send('DELETE', `${PACKAGES}/${id}`, null, undefined, version(1)), 401)
    assertError(await post(`${SALES}/quote`, null, {}), 401)
    assertError(await post(SALES, null, {}, key()), 401)
    assertError(await get(SALES, null), 401)
    assertError(await get(`${SALES}/${id}`, null), 401)
    assertError(await post(`${SALES}/${id}/extend`, null, {}, version(1)), 401)
    assertError(await post(`${SALES}/${id}/set-used-hours`, null, {}, version(1)), 401)
  })

  test('DOM-FIN-052: tanım yönetici, satış ön büro da; öğretmen hiçbirine, veli ve öğrenci yazmaya erişemez; satır değişmez', async () => {
    const a = await ready()
    const made = await sold(a)
    const item = `${PACKAGES}/${a.packageId}`
    const sale = `${SALES}/${made.id}`
    const before = await packageRows(a.id)
    const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: 's3' }])
    const student = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's3' }])
    const teacher = await member(a.id, 'ogretmen')
    for (const cookie of [teacher, parent, student]) {
      assertError(await get(PACKAGES, cookie), 403, 'forbidden')
      assertError(await get(item, cookie), 403, 'forbidden')
      assertError(await post(PACKAGES, cookie, { ...HOURS_BODY, name: 'Başka' }), 403, 'forbidden')
      assertError(await send('PATCH', item, cookie, { name: 'Yeni' }, version(1)), 403, 'forbidden')
      assertError(await send('DELETE', item, cookie, undefined, version(1)), 403, 'forbidden')
      assertError(await post(`${SALES}/quote`, cookie, a.quote), 403, 'forbidden')
      assertError(await post(SALES, cookie, a.sale, key()), 403, 'forbidden')
      assertError(
        await post(
          `${sale}/extend`,
          cookie,
          { expiresDate: '2028-01-01', reason: 'Talep' },
          version(1),
        ),
        403,
        'forbidden',
      )
      assertError(
        await post(
          `${sale}/set-used-hours`,
          cookie,
          { usedHours: 2, reason: 'Devam çizelgesi' },
          version(1),
        ),
        403,
        'forbidden',
      )
    }
    assertError(await get(SALES, teacher), 403, 'forbidden')
    assertError(await get(sale, teacher), 403, 'forbidden')
    const desk = await member(a.id, 'onburo')
    assertError(await post(PACKAGES, desk, { ...HOURS_BODY, name: 'Başka' }), 403, 'forbidden')
    assertError(await send('PATCH', item, desk, { name: 'Yeni' }, version(1)), 403, 'forbidden')
    assertError(await send('DELETE', item, desk, undefined, version(1)), 403, 'forbidden')
    assert.equal((await get(PACKAGES, desk)).statusCode, 200)
    assert.equal((await post(`${SALES}/quote`, desk, a.quote)).statusCode, 200)
    assert.equal((await post(SALES, desk, a.sale, key())).statusCode, 201)
    assert.deepEqual(await packageRows(a.id), before)
  })

  test('DOM-YTK-040, DOM-YTK-012: finance kapalıysa 403; dil okulu dışında her rol 404', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(PACKAGES, closed.admin), 403, 'module_disabled')
    assertError(await post(PACKAGES, closed.admin, HOURS_BODY), 403, 'module_disabled')
    assertError(await post(SALES, closed.admin, {}, key()), 403, 'module_disabled')
    assertError(await get(SALES, closed.admin), 403, 'module_disabled')
    assertError(
      await post(`${SALES}/${randomUUID()}/set-used-hours`, closed.admin, {}, version(1)),
      403,
      'module_disabled',
    )
    for (const type of INSTITUTION_TYPES.filter((item) => item !== 'language_school')) {
      const other = await institution({ type })
      const teacher = await member(other.id, 'ogretmen')
      for (const cookie of [other.admin, teacher]) {
        assertError(await get(PACKAGES, cookie), 404)
        assertError(await post(PACKAGES, cookie, HOURS_BODY), 404)
        assertError(await post(`${SALES}/quote`, cookie, {}), 404)
        assertError(await post(SALES, cookie, {}, key()), 404)
        assertError(await get(SALES, cookie), 404)
        assertError(
          await post(`${SALES}/${randomUUID()}/set-used-hours`, cookie, {}, version(1)),
          404,
        )
      }
      assert.equal((await packageRows(other.id)).length, 0)
    }
  })

  test('DOM-DIL-050: paket tanımlanır, düzeltilir, arşivlenir; denetime alan adları yazılır', async () => {
    const a = await institution()
    const made = await post(PACKAGES, a.admin, HOURS_BODY)
    assert.equal(made.statusCode, 201, made.body)
    const data = made.json().data
    assert.equal(made.headers.location, `${PACKAGES}/${String(data.id)}`)
    assert.equal(data.kind, 'hours')
    assert.equal(data.lessonHours, 40)
    assert.equal(data.hourlyCents, null)
    assert.equal(data.validityDays, 180)
    assert.equal(data.version, 1)
    const url = `${PACKAGES}/${String(data.id)}`
    assert.equal((await get(url, a.admin)).json().data.name, HOURS_BODY.name)
    assertError(await post(PACKAGES, a.admin, HOURS_BODY), 409, 'package_name_exists')
    assertError(
      await post(PACKAGES, a.admin, {
        ...HOURS_BODY,
        name: HOURS_BODY.name.toLocaleUpperCase('tr-TR'),
      }),
      409,
      'package_name_exists',
    )
    const before = await packageRows(a.id)
    assertError(await send('PATCH', url, a.admin, { lessonHours: 50 }), 400, 'if_match_required')
    assertError(await send('PATCH', url, a.admin, { lessonHours: 0 }, version(1)), 400)
    assertError(
      await send('PATCH', url, a.admin, { lessonHours: 50 }, version(9)),
      409,
      'version_conflict',
    )
    assertError(await post(PACKAGES, a.admin, { kind: 'hours', name: 'Saatsiz' }), 400)
    assertError(await post(PACKAGES, a.admin, { kind: 'course', name: 'Kursuz kur' }), 400)
    assertError(
      await post(PACKAGES, a.admin, { ...HOURS_BODY, name: 'Başka', hourlyCents: -1 }),
      400,
    )
    assert.deepEqual(await packageRows(a.id), before)
    const fixed = await send(
      'PATCH',
      url,
      a.admin,
      { lessonHours: 50, hourlyCents: 40_000 },
      version(1),
    )
    assert.equal(fixed.statusCode, 200, fixed.body)
    assert.equal(fixed.json().data.lessonHours, 50)
    assert.equal(fixed.json().data.version, 2)
    assertError(await send('DELETE', url, a.admin), 400, 'if_match_required')
    assertError(await send('DELETE', url, a.admin, undefined, version(1)), 409, 'version_conflict')
    const archiveHeaders = { ...key(), ...version(2) }
    const archived = await send('DELETE', url, a.admin, undefined, archiveHeaders)
    assert.equal(archived.statusCode, 200, archived.body)
    assert.deepEqual(archived.json().data, { id: data.id })
    const archivedAgain = await send('DELETE', url, a.admin, undefined, archiveHeaders)
    assert.equal(archivedAgain.headers['idempotent-replayed'], 'true')
    assert.deepEqual(archivedAgain.json(), archived.json())
    assertError(await get(url, a.admin), 404)
    assertError(await send('PATCH', url, a.admin, { lessonHours: 60 }, version(3)), 404)
    assertError(await send('DELETE', url, a.admin, undefined, version(3)), 404)
    assert.equal((await get(PACKAGES, a.admin)).json().meta.total, 0)
    // Arşivli paketin adı yeniden kullanılabilir.
    assert.equal((await post(PACKAGES, a.admin, HOURS_BODY)).statusCode, 201)
    const audit = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.entityType, 'lesson_packages')))
    assert.deepEqual(audit.map((row) => row.action).sort(), [
      'package.archive',
      'package.create',
      'package.create',
      'package.update',
    ])
    assert.equal(JSON.stringify(audit).includes('40 saatlik'), false)
  })

  test('DOM-DIL-050: liste ada göre, q ve kind ile süzülür; bilinmeyen parametre 400', async () => {
    const a = await institution()
    await post(PACKAGES, a.admin, { kind: 'private', name: 'Özel ders 10', lessonHours: 10 })
    await post(PACKAGES, a.admin, HOURS_BODY)
    const listed = (await get(PACKAGES, a.admin)).json()
    assert.equal(listed.meta.total, 2)
    assert.equal(listed.data[0].name, HOURS_BODY.name)
    const kind = (await get(`${PACKAGES}?kind=private`, a.admin)).json()
    assert.equal(kind.meta.total, 1)
    assert.equal(kind.data[0].kind, 'private')
    const search = (await get(`${PACKAGES}?q=${encodeURIComponent('ozel')}`, a.admin)).json()
    assert.equal(search.meta.total, 1)
    assertError(await get(`${PACKAGES}?bilinmeyen=1`, a.admin), 400)
    assertError(await get(`${PACKAGES}?pageSize=101`, a.admin), 400)
  })

  test('DOM-DIL-006: kur ücreti paketi saat ve seviyeyi kurdan alır; kur etkin değilse satılmaz', async () => {
    const a = await institution()
    const tariffId = await publish(a.id)
    const draft = await post(
      '/api/v1/courses',
      a.admin,
      { ...COURSE_BODY, name: 'Taslak kur' },
      key(),
    )
    const draftId = draft.json().data.id as string
    const pending = await post(PACKAGES, a.admin, {
      kind: 'course',
      name: 'Taslak kur ücreti',
      courseId: draftId,
    })
    assert.equal(pending.statusCode, 201, pending.body)
    assertError(
      await post(`${SALES}/quote`, a.admin, {
        packageId: pending.json().data.id,
        studentId: 's3',
        installmentCount: 1,
      }),
      422,
      'package_course_inactive',
    )
    const courseId = await activeCourse(a.admin)
    const made = await post(PACKAGES, a.admin, { kind: 'course', name: 'B1 kur ücreti', courseId })
    assert.equal(made.statusCode, 201, made.body)
    const packageId = made.json().data.id as string
    assert.equal(made.json().data.lessonHours, null)
    const response = await post(
      SALES,
      a.admin,
      { packageId, studentId: 's3', installmentCount: 1, tariffId, firstDueDate: '2026-10-31' },
      key(),
    )
    assert.equal(response.statusCode, 201, response.body)
    const sale = response.json().data
    assert.equal(sale.purchasedHours, 96)
    assert.equal(sale.level, 'B1')
    assert.equal(sale.courseId, courseId)
    assert.equal(sale.grossCents, 96 * HOURLY)
    assert.equal(sale.expiresDate, null)
    assertError(
      await post(PACKAGES, a.admin, { kind: 'course', name: 'Yok', courseId: randomUUID() }),
      404,
    )
    assert.equal((await packageRows(a.id)).length, 2)
  })

  test('DOM-DIL-050: önizleme fiyatı hesaplar, hiçbir kayıt yazmaz', async () => {
    const a = await ready()
    const quote = await post(`${SALES}/quote`, a.admin, {
      ...a.quote,
      discounts: ['early_payment'],
      extras: ['stationery'],
    })
    assert.equal(quote.statusCode, 200, quote.body)
    const data = quote.json().data
    assert.equal(data.tariffId, a.tariffId)
    assert.equal(data.purchasedHours, 40)
    assert.equal(data.grossCents, 40 * HOURLY)
    assert.equal(data.discountCents, 200_000)
    assert.equal(data.netCents, 1_800_000)
    assert.deepEqual(data.extras, [{ kind: 'stationery', amountCents: 75_000 }])
    assert.deepEqual(data.installments, [450_000, 450_000, 450_000, 450_000])
    assert.equal(data.expiresDate, '2027-04-04')
    assert.deepEqual(await financeCounts(a.id), NONE)
    assertError(await post(`${SALES}/quote`, a.admin, { ...a.quote, installmentCount: 0 }), 400)
    assertError(await post(`${SALES}/quote`, a.admin, { ...a.quote, studentId: 'yok' }), 404)
    assertError(await post(`${SALES}/quote`, a.admin, { ...a.quote, packageId: randomUUID() }), 404)
  })

  test('IST-078, DOM-FIN-010: satış, sözleşme ve taksitleri tablolara tek işlemde yazar', async () => {
    const a = await ready()
    const response = await post(
      SALES,
      a.admin,
      { ...a.sale, discounts: ['early_payment'], extras: ['stationery'] },
      key(),
    )
    assert.equal(response.statusCode, 201, response.body)
    const sale = response.json().data
    assert.equal(response.headers.location, `${SALES}/${String(sale.id)}`)
    assert.equal(sale.purchasedHours, 40)
    assert.equal(sale.remainingHours, 40)
    assert.equal(sale.consumedHours, 0)
    assert.equal(sale.status, 'active')
    assert.equal(sale.expiresDate, '2027-04-04')
    assert.equal(sale.netCents, 1_800_000)
    const contracts = await loadFinanceRecords(db, a.id, 'contracts')
    assert.equal(contracts.length, 1)
    assert.equal(contracts[0]?.id, sale.contractId)
    assert.equal(contracts[0]?.data.amount, 1_875_000)
    assert.equal(contracts[0]?.data.tariffId, a.tariffId)
    const invoices = await loadFinanceRecords(db, a.id, 'invoices')
    assert.deepEqual(
      invoices.map((row) => row.data.amount).sort(),
      [450_000, 450_000, 450_000, 450_000, 75_000].sort(),
    )
    assert.equal(
      invoices.every((row) => row.data.contractId === sale.contractId),
      true,
    )
    const detail = (await get(`${SALES}/${String(sale.id)}`, a.admin)).json().data
    assert.equal(detail.studentName, SEED.students.find((item) => item.id === 's3')?.name)
    assert.deepEqual(
      detail.invoices.map((row: { installment: number; feeKind: string }) => [
        row.installment,
        row.feeKind,
      ]),
      [
        [1, 'tuition'],
        [2, 'tuition'],
        [3, 'tuition'],
        [4, 'tuition'],
        [5, 'stationery'],
      ],
    )
    const audit = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.entityId, String(sale.id))))
    assert.deepEqual(
      audit.map((row) => row.action),
      ['package.sell'],
    )
    // Paket değişse de satış satırı kopyadır (DOM-DIL-006).
    await send(
      'PATCH',
      `${PACKAGES}/${a.packageId}`,
      a.admin,
      { lessonHours: 80, name: 'Yeni ad' },
      version(1),
    )
    const copy = (await get(`${SALES}/${String(sale.id)}`, a.admin)).json().data
    assert.equal(copy.purchasedHours, 40)
    assert.equal(copy.packageName, HOURS_BODY.name)
  })

  test('IST-078: satış satırı yazılamazsa sözleşme ve taksit de geri alınır', async () => {
    const a = await ready()
    const name = 'Dusecek paket'
    const made = await post(PACKAGES, a.admin, { ...HOURS_BODY, name })
    const packageId = made.json().data.id as string
    await db.execute(
      sql`alter table lesson_package_sales add constraint test_sale_fail check (package_name <> 'Dusecek paket')`,
    )
    try {
      const response = await post(SALES, a.admin, { ...a.sale, packageId }, key())
      assert.equal(response.statusCode >= 400, true, response.body)
      assert.deepEqual(await financeCounts(a.id), NONE)
    } finally {
      await db.execute(sql`alter table lesson_package_sales drop constraint test_sale_fail`)
    }
  })

  test('IST-078: mükerrer istek aynı yanıtı döner, ikinci satış açmaz; anahtar zorunludur', async () => {
    const a = await ready()
    assertError(await post(SALES, a.admin, a.sale), 400, 'idempotency_key_required')
    const headers = key()
    const first = await post(SALES, a.admin, a.sale, headers)
    assert.equal(first.statusCode, 201, first.body)
    const replay = await post(SALES, a.admin, a.sale, headers)
    assert.equal(replay.statusCode, 201, replay.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())
    assert.equal(replay.headers.location, first.headers.location)
    assert.deepEqual(await financeCounts(a.id), { contracts: 1, invoices: 4, sales: 1 })
    assertError(
      await post(SALES, a.admin, { ...a.sale, installmentCount: 2 }, headers),
      422,
      'idempotency_key_reused',
    )
    assert.deepEqual(await financeCounts(a.id), { contracts: 1, invoices: 4, sales: 1 })
    // Anahtarla paket tanımı da tekrarlanmaz.
    const packageKey = key()
    const body = { ...HOURS_BODY, name: 'Tekrar paketi' }
    const created = await post(PACKAGES, a.admin, body, packageKey)
    const again = await post(PACKAGES, a.admin, body, packageKey)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), created.json())
    assert.equal((await packageRows(a.id)).length, 2)
  })

  test('DOM-FIN-002, DOM-DIL-050: reddedilen satış hiçbir kayıt yazmaz', async () => {
    const a = await ready()
    const invalid: Record<string, unknown>[] = [
      { ...a.sale, installmentCount: 13 },
      { ...a.sale, firstDueDate: '2026-02-30' },
      { ...a.sale, packageId: 'kimlik' },
      { ...a.sale, amountCents: 1 },
      { ...a.sale, discounts: ['serbest'] },
    ]
    for (const body of invalid) assertError(await post(SALES, a.admin, body, key()), 400)
    assertError(
      await post(SALES, a.admin, { ...a.sale, tariffId: randomUUID() }, key()),
      409,
      'tariff_changed',
    )
    assertError(
      await post(SALES, a.admin, { ...a.sale, discounts: ['corporate'] }, key()),
      422,
      'discount_not_in_tariff',
    )
    assertError(
      await post(SALES, a.admin, { ...a.sale, extras: ['meal'] }, key()),
      422,
      'extra_not_in_tariff',
    )
    assertError(await post(SALES, a.admin, { ...a.sale, studentId: 'yok' }, key()), 404)
    const above = await post(PACKAGES, a.admin, {
      ...HOURS_BODY,
      name: 'İlan üstü',
      hourlyCents: HOURLY + 1,
    })
    assertError(
      await post(SALES, a.admin, { ...a.sale, packageId: above.json().data.id }, key()),
      422,
      'package_above_tariff',
    )
    const low = await post(PACKAGES, a.admin, {
      ...HOURS_BODY,
      name: 'Yarı fiyatın altı',
      hourlyCents: HOURLY / 2 - 1,
    })
    assertError(
      await post(SALES, a.admin, { ...a.sale, packageId: low.json().data.id }, key()),
      422,
      'discount_cap_exceeded',
    )
    // Arşivli paket satılmaz.
    await send('DELETE', `${PACKAGES}/${a.packageId}`, a.admin, undefined, version(1))
    assertError(await post(SALES, a.admin, a.sale, key()), 404)
    assert.deepEqual(await financeCounts(a.id), NONE)
    const noTariff = await institution()
    const made = await post(PACKAGES, noTariff.admin, HOURS_BODY)
    assertError(
      await post(`${SALES}/quote`, noTariff.admin, {
        packageId: made.json().data.id,
        studentId: 's3',
        installmentCount: 1,
      }),
      422,
      'tariff_not_published',
    )
  })

  test('DOM-FIN-052: veli bağlı çocuğunu, öğrenci kendisini görür; kapsam dışı 404 ve listede yok', async () => {
    const a = await ready()
    const own = await sold(a)
    const foreign = await post(SALES, a.admin, { ...a.sale, studentId: OTHER_STUDENT }, key())
    assert.equal(foreign.statusCode, 201, foreign.body)
    const foreignId = foreign.json().data.id as string
    const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: 's3' }])
    const student = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's3' }])
    for (const cookie of [parent, student]) {
      const listed = (await get(SALES, cookie)).json()
      assert.deepEqual(
        listed.data.map((row: { id: string }) => row.id),
        [own.id],
      )
      assert.equal(listed.meta.total, 1)
      assert.equal((await get(`${SALES}/${own.id}`, cookie)).statusCode, 200)
      assertError(await get(`${SALES}/${foreignId}`, cookie), 404)
      assert.equal((await get(`${SALES}?studentId=${OTHER_STUDENT}`, cookie)).json().meta.total, 0)
    }
    assert.equal((await get(SALES, a.admin)).json().meta.total, 2)
    assert.equal((await get(`${SALES}?studentId=s3`, a.admin)).json().meta.total, 1)
    assert.equal((await get(`${SALES}?packageId=${a.packageId}`, a.admin)).json().meta.total, 2)
    assertError(await get(`${SALES}?bilinmeyen=1`, a.admin), 400)
  })

  test('K-40, K-41, DOM-FIN-058: veli ve öğrenci satış listesinde ve ayrıntısında tutar ve iç kimlik anahtarı yok; personelde var', async () => {
    const a = await ready()
    const own = await sold(a)
    const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: 's3' }])
    const student = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's3' }])
    const desk = await member(a.id, 'onburo')
    const amountKeys = [
      'hourlyCents',
      'grossCents',
      'netCents',
      'discounts',
      'discountCents',
      'installments',
      'invoices',
    ]
    const idKeys = [
      'version',
      'packageId',
      'courseId',
      'studentId',
      'contractId',
      'tariffId',
      'tariffVersion',
    ]
    const hourKeys = ['purchasedHours', 'consumedHours', 'remainingHours', 'expiresDate', 'status']
    for (const cookie of [parent, student]) {
      const listed = await get(SALES, cookie)
      assert.equal(listed.statusCode, 200, listed.body)
      const detail = await get(`${SALES}/${own.id}`, cookie)
      assert.equal(detail.statusCode, 200, detail.body)
      for (const row of [listed.json().data[0], detail.json().data]) {
        for (const amountKey of amountKeys) assert.equal(amountKey in row, false, amountKey)
        for (const idKey of idKeys) assert.equal(idKey in row, false, idKey)
        for (const hourKey of hourKeys) assert.equal(hourKey in row, true, hourKey)
        assert.equal(row.id, own.id)
        assert.equal(row.kind, HOURS_BODY.kind)
        assert.equal(row.packageName, HOURS_BODY.name)
        assert.equal(row.purchasedHours, 40)
        assert.equal(row.status, 'active')
      }
    }
    for (const cookie of [a.admin, desk]) {
      const listed = (await get(SALES, cookie)).json().data[0]
      const detail = (await get(`${SALES}/${own.id}`, cookie)).json().data
      for (const row of [listed, detail]) {
        assert.equal(row.hourlyCents, HOURLY)
        assert.equal(row.grossCents, 40 * HOURLY)
        assert.equal(typeof row.netCents, 'number')
        for (const idKey of idKeys) assert.equal(idKey in row, true, idKey)
        assert.equal(row.studentId, 's3')
        assert.equal(row.contractId, own.contractId)
        assert.equal(typeof row.tariffId, 'string')
        assert.equal(typeof row.tariffVersion, 'number')
      }
      assert.equal(detail.invoices.length, 4)
      assert.equal(typeof detail.invoices[0].amountCents, 'number')
    }
  })

  test('DOM-DIL-051, H-19: süre dolunca saat silinmez; uzatma If-Match ve gerekçe ister, denetime yazılır', async () => {
    const a = await ready()
    const sale = await sold(a)
    const url = `${SALES}/${sale.id}`
    const extend = `${url}/extend`
    const body = { expiresDate: '2028-01-01', reason: 'Kursiyerin talebi' }
    const row = await saleRows(a.id)
    assertError(await post(extend, a.admin, body), 400, 'if_match_required')
    assertError(await post(extend, a.admin, { expiresDate: '2028-01-01' }, version(1)), 400)
    assertError(await post(extend, a.admin, { ...body, reason: ' ' }, version(1)), 400)
    assertError(await post(extend, a.admin, body, version(5)), 409, 'version_conflict')
    assertError(
      await post(extend, a.admin, { ...body, expiresDate: '2027-04-04' }, version(1)),
      422,
      'package_extension_not_later',
    )
    assertError(await post(`${SALES}/${randomUUID()}/extend`, a.admin, body, version(1)), 404)
    assert.deepEqual(await saleRows(a.id), row)
    now = new Date('2027-05-01T09:00:00.000Z')
    try {
      const expired = (await get(url, a.admin)).json().data
      assert.equal(expired.status, 'expired')
      assert.equal(expired.remainingHours, 40)
      const consumed = recordPackageHours(ctxOf(a.id), sale.id, {
        kind: 'consumed',
        hours: 2,
        occurredDate: '2027-05-01',
        sourceType: 'lesson',
        sourceId: 'test-ders-sure',
      })
      await assert.rejects(consumed, { code: 'package_expired' })
      const headers = key()
      const extended = await post(extend, a.admin, body, { ...headers, ...version(1) })
      assert.equal(extended.statusCode, 200, extended.body)
      assert.equal(extended.json().data.expiresDate, '2028-01-01')
      assert.equal(extended.json().data.status, 'active')
      assert.equal(extended.json().data.version, 2)
      const replay = await post(extend, a.admin, body, { ...headers, ...version(1) })
      assert.equal(replay.headers['idempotent-replayed'], 'true')
      assert.deepEqual(replay.json(), extended.json())
      const audit = await db
        .select({ action: auditLog.action, reason: auditLog.reason, changes: auditLog.changes })
        .from(auditLog)
        .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'package.extend')))
      assert.deepEqual(audit, [
        { action: 'package.extend', reason: body.reason, changes: { fields: ['expiresDate'] } },
      ])
    } finally {
      now = FIXED_NOW
    }
    const openEnded = await post(PACKAGES, a.admin, {
      ...HOURS_BODY,
      name: 'Süresiz paket',
      validityDays: null,
    })
    const open = await post(
      SALES,
      a.admin,
      { ...a.sale, packageId: openEnded.json().data.id },
      key(),
    )
    assert.equal(open.json().data.expiresDate, null)
    assertError(
      await post(`${SALES}/${String(open.json().data.id)}/extend`, a.admin, body, version(1)),
      422,
      'package_no_expiry',
    )
  })

  test('DOM-DIL-051, IST-078: bakiye saat hareketlerinden hesaplanır, sıfırın altına inmez, aynı ders iki kez düşmez', async () => {
    const a = await ready()
    const sale = await sold(a)
    const url = `${SALES}/${sale.id}`
    const lesson = (hours: number, sourceId: string) => ({
      kind: 'consumed',
      hours,
      occurredDate: '2026-10-06',
      sourceType: 'lesson',
      sourceId,
    })
    const ctx = ctxOf(a.id)
    assert.deepEqual(await recordPackageHours(ctx, sale.id, lesson(38, 'test-ders-1')), {
      recorded: true,
    })
    // Yoklama yeniden işlenince saat iki kez düşmez.
    assert.deepEqual(await recordPackageHours(ctx, sale.id, lesson(38, 'test-ders-1')), {
      recorded: false,
    })
    await assert.rejects(recordPackageHours(ctx, sale.id, lesson(3, 'test-ders-2')), {
      code: 'package_balance_insufficient',
    })
    const middle = (await get(url, a.admin)).json().data
    assert.equal(middle.consumedHours, 38)
    assert.equal(middle.remainingHours, 2)
    assert.equal(middle.status, 'active')
    await recordPackageHours(ctx, sale.id, lesson(1, 'test-ders-3'))
    await recordPackageHours(ctx, sale.id, {
      kind: 'refunded',
      hours: 1,
      occurredDate: '2026-10-06',
      sourceType: 'withdrawal',
      sourceId: 'test-ayrilis-1',
    })
    const done = (await get(url, a.admin)).json().data
    assert.equal(done.consumedHours, 39)
    assert.equal(done.refundedHours, 1)
    assert.equal(done.remainingHours, 0)
    assert.equal(done.status, 'depleted')
    const listed = (await get(SALES, a.admin)).json().data[0]
    assert.equal(listed.remainingHours, 0)
    assertError(
      await post(
        `${url}/extend`,
        a.admin,
        { expiresDate: '2028-01-01', reason: 'Talep' },
        version(1),
      ),
      422,
      'package_depleted',
    )
    await assert.rejects(recordPackageHours(ctx, randomUUID(), lesson(1, 'test-ders-4')), {
      statusCode: 404,
    })
  })

  describe('K-21, DOM-DIL-051: kullanılan saat elle girilir', () => {
    const USED = { usedHours: 12, reason: 'Devam çizelgesine göre' }
    const usedUrl = (saleId: string) => `${SALES}/${saleId}/set-used-hours`
    const hours = (institutionId: string) =>
      db
        .select({
          kind: lessonPackageHourEntries.kind,
          hours: lessonPackageHourEntries.hours,
          sourceType: lessonPackageHourEntries.sourceType,
          sourceId: lessonPackageHourEntries.sourceId,
          archivedAt: lessonPackageHourEntries.archivedAt,
          recordedByUserId: lessonPackageHourEntries.recordedByUserId,
        })
        .from(lessonPackageHourEntries)
        .where(eq(lessonPackageHourEntries.institutionId, institutionId))
        .orderBy(lessonPackageHourEntries.hours)
    const audits = (institutionId: string) =>
      db
        .select({
          action: auditLog.action,
          entityId: auditLog.entityId,
          reason: auditLog.reason,
          changes: auditLog.changes,
          actorRole: auditLog.actorRole,
        })
        .from(auditLog)
        .where(
          and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, 'package.used_hours')),
        )

    test('yönetici ve ön büro girer; bakiye düşer, sürüm artar, denetime gerekçeyle yazılır; gerekçe loglanmaz', async () => {
      const a = await ready()
      const sale = await sold(a)
      const desk = await member(a.id, 'onburo')
      assert.equal((await get(`${SALES}/${sale.id}`, a.admin)).json().data.usedHoursRecorded, false)
      const from = logs.length
      const entered = await post(usedUrl(sale.id), desk, USED, version(1))
      assert.equal(entered.statusCode, 200, entered.body)
      assert.ok(logs.length > from, 'istek logu yok')
      assert.equal(logs.slice(from).join('\n').includes(USED.reason), false)
      const { data } = entered.json()
      assert.equal(data.consumedHours, 12)
      assert.equal(data.remainingHours, 28)
      assert.equal(data.usedHoursRecorded, true)
      assert.equal(data.version, 2)
      assert.equal(JSON.stringify(entered.json()).includes(USED.reason), false)
      const detail = (await get(`${SALES}/${sale.id}`, a.admin)).json().data
      assert.equal(detail.consumedHours, 12)
      assert.equal((await get(SALES, a.admin)).json().data[0].consumedHours, 12)
      assert.deepEqual(await audits(a.id), [
        {
          action: 'package.used_hours',
          entityId: sale.id,
          reason: USED.reason,
          changes: { fields: ['usedHours'] },
          actorRole: 'onburo',
        },
      ])

      const raised = await post(usedUrl(sale.id), a.admin, { ...USED, usedHours: 20 }, version(2))
      assert.equal(raised.json().data.consumedHours, 20)
      assert.equal(raised.json().data.version, 3)
    })

    test('azaltma gerekçeyle yapılır; eski değer arşivli harekette kalır, tek etkin satır olur', async () => {
      const a = await ready()
      const sale = await sold(a)
      await post(usedUrl(sale.id), a.admin, USED, version(1))
      const lowered = await post(
        usedUrl(sale.id),
        a.admin,
        { usedHours: 5, reason: 'Yanlış girildi, düzeltildi' },
        version(2),
      )
      assert.equal(lowered.statusCode, 200, lowered.body)
      assert.equal(lowered.json().data.consumedHours, 5)
      assert.equal(lowered.json().data.remainingHours, 35)
      const rows = await hours(a.id)
      assert.deepEqual(
        rows.map((row) => [row.hours, row.sourceType, row.sourceId, row.archivedAt !== null]),
        [
          [5, 'manual', sale.id, false],
          [12, 'manual', sale.id, true],
        ],
      )
      assert.equal(
        (await audits(a.id)).filter((row) => row.reason === 'Yanlış girildi, düzeltildi').length,
        1,
      )
    })

    test('400 ve kayıt değişmemesi: gerekçesiz, eksi, kurumlu gövde; If-Match yok', async () => {
      const a = await ready()
      const sale = await sold(a)
      const rows = await saleRows(a.id)
      assertError(await post(usedUrl(sale.id), a.admin, USED), 400, 'if_match_required')
      for (const body of [
        { usedHours: 2 },
        { usedHours: 2, reason: ' ' },
        { usedHours: -1, reason: 'Gerekçe' },
        { usedHours: 1.5, reason: 'Gerekçe' },
        { usedHours: 2, reason: 'x'.repeat(501) },
        { ...USED, institutionId: 'baska' },
      ])
        assertError(await post(usedUrl(sale.id), a.admin, body, version(1)), 400)
      assert.deepEqual(await saleRows(a.id), rows)
      assert.deepEqual(await hours(a.id), [])
      assert.deepEqual(await audits(a.id), [])
    })

    test('422: alınan saati aşamaz; sürüm tutmazsa 409; kayıt değişmez', async () => {
      const a = await ready()
      const sale = await sold(a)
      const rows = await saleRows(a.id)
      assertError(
        await post(usedUrl(sale.id), a.admin, { ...USED, usedHours: 41 }, version(1)),
        422,
        'package_used_exceeds_purchased',
      )
      assertError(await post(usedUrl(sale.id), a.admin, USED, version(9)), 409, 'version_conflict')
      assert.deepEqual(await saleRows(a.id), rows)
      assert.deepEqual(await hours(a.id), [])
      assert.deepEqual(await audits(a.id), [])
    })

    test('mükerrer: aynı anahtar aynı yanıt, eski sürüm 409, aynı değer 422; satır yinelenmez', async () => {
      const a = await ready()
      const sale = await sold(a)
      const headers = { ...key(), ...version(1) }
      const first = await post(usedUrl(sale.id), a.admin, USED, headers)
      assert.equal(first.statusCode, 200, first.body)
      const replay = await post(usedUrl(sale.id), a.admin, USED, headers)
      assert.equal(replay.headers['idempotent-replayed'], 'true')
      assert.deepEqual(replay.json(), first.json())
      assertError(await post(usedUrl(sale.id), a.admin, USED, version(1)), 409, 'version_conflict')
      assertError(
        await post(usedUrl(sale.id), a.admin, USED, version(2)),
        422,
        'package_used_hours_unchanged',
      )
      assert.equal((await hours(a.id)).length, 1)
      assert.equal((await audits(a.id)).length, 1)
    })

    test('sıfır girişi kullanılmadı bilgisidir; süresi dolan pakete de girilir', async () => {
      const a = await ready()
      const sale = await sold(a)
      const zero = await post(usedUrl(sale.id), a.admin, { ...USED, usedHours: 0 }, version(1))
      assert.equal(zero.statusCode, 200, zero.body)
      assert.equal(zero.json().data.usedHoursRecorded, true)
      assert.equal(zero.json().data.remainingHours, 40)
      now = new Date('2027-05-01T09:00:00.000Z')
      try {
        const late = await post(usedUrl(sale.id), a.admin, USED, version(2))
        assert.equal(late.statusCode, 200, late.body)
        assert.equal(late.json().data.status, 'expired')
        assert.equal(late.json().data.consumedHours, 12)
      } finally {
        now = FIXED_NOW
      }
    })

    test('yoklamadan gelen saat toplamın parçasıdır, onun altına inilemez', async () => {
      const a = await ready()
      const sale = await sold(a)
      await recordPackageHours(ctxOf(a.id), sale.id, {
        kind: 'consumed',
        hours: 8,
        occurredDate: '2026-10-01',
        sourceType: 'lesson',
        sourceId: 'test-ders-elle',
      })
      assertError(
        await post(usedUrl(sale.id), a.admin, { ...USED, usedHours: 7 }, version(1)),
        422,
        'package_used_below_lessons',
      )
      const set = await post(usedUrl(sale.id), a.admin, USED, version(1))
      assert.equal(set.json().data.consumedHours, 12)
    })

    test('IST-002: başka kurumun satışında kullanılan saat 404, B değişmez', async () => {
      const a = await ready()
      const b = await ready()
      const bSale = await sold(b)
      const rows = await saleRows(b.id)
      assertError(await post(usedUrl(bSale.id), a.admin, USED, version(1)), 404)
      assertError(await post(usedUrl(randomUUID()), a.admin, USED, version(1)), 404)
      assert.deepEqual(await saleRows(b.id), rows)
      assert.deepEqual(await hours(b.id), [])
      assert.deepEqual(await audits(a.id), [])
    })
  })

  test('IST-002: başka kurumun paketi ve satışı 404, B değişmez; listede yok; gövdedeki institutionId reddedilir', async () => {
    const a = await ready()
    const b = await ready()
    const bSale = await sold(b)
    const bPackage = `${PACKAGES}/${b.packageId}`
    const bSaleUrl = `${SALES}/${bSale.id}`
    const beforePackages = await packageRows(b.id)
    const beforeSales = await saleRows(b.id)
    assertError(await get(bPackage, a.admin), 404)
    assertError(await send('PATCH', bPackage, a.admin, { name: 'Ele geçirilen' }, version(1)), 404)
    assertError(await send('DELETE', bPackage, a.admin, undefined, version(1)), 404)
    assertError(await get(bSaleUrl, a.admin), 404)
    assertError(
      await post(
        `${bSaleUrl}/extend`,
        a.admin,
        { expiresDate: '2028-01-01', reason: 'Başka kurum' },
        version(1),
      ),
      404,
    )
    await assert.rejects(
      recordPackageHours(ctxOf(a.id), bSale.id, {
        kind: 'consumed',
        hours: 1,
        occurredDate: '2026-10-06',
        sourceType: 'lesson',
        sourceId: 'test-b-ders',
      }),
      { statusCode: 404 },
    )
    // B'nin paketi A'dan önizlenemez, satılamaz; A'nın listesinde B kaydı yoktur.
    assertError(await post(`${SALES}/quote`, a.admin, { ...a.quote, packageId: b.packageId }), 404)
    assertError(await post(SALES, a.admin, { ...a.sale, packageId: b.packageId }, key()), 404)
    assert.deepEqual(await financeCounts(a.id), NONE)
    const listed = (await get(PACKAGES, a.admin)).json()
    assert.deepEqual(
      listed.data.map((row: { id: string }) => row.id),
      [a.packageId],
    )
    assert.equal((await get(SALES, a.admin)).json().meta.total, 0)
    assert.equal((await get(`${SALES}?packageId=${b.packageId}`, a.admin)).json().meta.total, 0)
    assert.equal((await get(`${SALES}?studentId=s3`, a.admin)).json().meta.total, 0)
    // Gövdedeki kurum kimliği reddedilir; B'nin kuru A'nın paketine bağlanamaz.
    assertError(
      await post(PACKAGES, a.admin, { ...HOURS_BODY, name: 'Yeni', institutionId: b.id }),
      400,
    )
    assertError(await post(`${SALES}/quote`, a.admin, { ...a.quote, institutionId: b.id }), 400)
    assertError(await post(SALES, a.admin, { ...a.sale, institutionId: b.id }, key()), 400)
    const bCourse = await activeCourse(b.admin)
    assertError(
      await post(PACKAGES, a.admin, { kind: 'course', name: 'B kuru', courseId: bCourse }),
      404,
    )
    // B'nin tarifesi A'da yoktur: A'nın satışında tarife tutmaz.
    assertError(
      await post(SALES, a.admin, { ...a.sale, tariffId: b.tariffId }, key()),
      409,
      'tariff_changed',
    )
    assert.deepEqual(await packageRows(b.id), beforePackages)
    assert.deepEqual(await saleRows(b.id), beforeSales)
    assert.deepEqual(await financeCounts(a.id), NONE)
  })

  describe('DOM-FIN-040, K-06: ayrılış paket satışını hesaba alır', () => {
    const WITHDRAW = {
      withdrawalDate: '2026-10-06',
      termStartDate: '2026-09-07',
      attendedUnits: 18,
      totalUnits: 180,
    }
    const TUITION_NET = 10_000_000
    const PACKAGE_NET = 40 * HOURLY

    /** Paket satışı ve 10 saat tüketim; `tuition` ile ayrıca öğrenim sözleşmesi (net 100.000 ₺). */
    async function withPackage(options: { tuition: boolean }) {
      const a = await ready()
      if (options.tuition)
        await insertMissingRecords(
          db,
          a.id,
          [
            {
              collection: 'contracts',
              id: 'test-tuition',
              data: {
                id: 'test-tuition',
                studentId: 's3',
                date: '2026-01-01T09:00:00.000Z',
                amount: TUITION_NET,
                title: 'Öğrenim sözleşmesi',
                invoiceIds: ['test-tuition-1'],
                ...contractTerms({ grossCents: TUITION_NET, netCents: TUITION_NET }),
                tariffId: a.tariffId,
                payer: 'student',
              },
            },
            {
              collection: 'invoices',
              id: 'test-tuition-1',
              data: {
                id: 'test-tuition-1',
                studentId: 's3',
                installment: 1,
                amount: TUITION_NET,
                dueDate: '2026-09-15T09:00:00.000Z',
                paidAt: null,
                method: null,
                reminderAt: null,
                feeKind: 'tuition',
              },
            },
          ],
          FIXED_NOW,
        )
      const sale = await sold(a)
      await recordPackageHours(ctxOf(a.id), sale.id, {
        kind: 'consumed',
        hours: 10,
        occurredDate: '2026-10-01',
        sourceType: 'lesson',
        sourceId: 'test-ders-ayrilis',
      })
      return { ...a, sale }
    }
    const pay = (cookie: string, amountCents: number) =>
      post(
        '/api/v1/payments',
        cookie,
        { studentId: 's3', amountCents, method: 'Banka havalesi', reference: randomUUID() },
        key(),
      )
    const quote = (cookie: string, body: unknown = WITHDRAW) =>
      post('/api/v1/students/s3/withdrawal-quote', cookie, body)
    const DEPARTURE = { ...WITHDRAW, reason: 'relocation', targetSchool: null }
    /** Yönetici önizlemede gördüğü iade tutarını onaylar (K-21). */
    async function approval(cookie: string) {
      const response = await quote(cookie)
      assert.equal(response.statusCode, 200, response.body)
      return response.json().data.breakdown.refundCents as number
    }
    const withdraw = async (cookie: string, headers: Headers = key()) =>
      post(
        '/api/v1/students/s3/withdraw',
        cookie,
        { ...DEPARTURE, approvedRefundCents: await approval(cookie) },
        headers,
      )
    const hourRows = (institutionId: string) =>
      db
        .select()
        .from(lessonPackageHourEntries)
        .where(eq(lessonPackageHourEntries.institutionId, institutionId))

    test('önizleme sözleşme başına döküm ve toplam döndürür, hiçbir kayıt yazmaz', async () => {
      const a = await withPackage({ tuition: true })
      const response = await quote(a.admin)
      assert.equal(response.statusCode, 200, response.body)
      const { contractId, breakdown } = response.json().data
      assert.equal(contractId, a.sale.contractId)
      assert.deepEqual(
        breakdown.contracts.map((line: { contractId: string }) => line.contractId),
        ['test-tuition', a.sale.contractId],
      )
      const [tuition, pack] = breakdown.contracts
      assert.equal(tuition.packageSaleId, undefined)
      assert.equal(tuition.attendedUnits, 18)
      assert.equal(tuition.entitledCents, 2_000_000)
      assert.equal(pack.packageSaleId, a.sale.id)
      assert.equal(pack.attendedUnits, 10)
      assert.equal(pack.totalUnits, 40)
      assert.equal(pack.returnedHours, 30)
      assert.equal(pack.deductionCents, PACKAGE_NET / 10)
      assert.equal(pack.usageCents, 10 * HOURLY)
      assert.equal(breakdown.baseCents, TUITION_NET + PACKAGE_NET)
      assert.equal(breakdown.debtCents, 2_000_000 + PACKAGE_NET / 10 + 10 * HOURLY)
      assert.equal((await hourRows(a.id)).length, 1)
      assert.equal((await findRecord(db, a.id, 'students', 's3'))?.data.isActive, true)
    })

    test('ödenmemişse iki sözleşmenin açık taksiti iptal olur, tek borç taksiti kalır', async () => {
      const a = await withPackage({ tuition: true })
      const response = await withdraw(a.admin)
      assert.equal(response.statusCode, 201, response.body)
      const { data } = response.json()
      assert.equal(data.contractId, a.sale.contractId)
      assert.equal(data.debtCents, 2_000_000 + PACKAGE_NET / 10 + 10 * HOURLY)
      assert.equal(data.refundCents, 0)
      const invoices = await loadFinanceRecords(db, a.id, 'invoices')
      assert.equal(invoices.length, 1)
      assert.equal(invoices[0]?.data.amount, data.debtCents)
      assert.equal(invoices[0]?.data.contractId, a.sale.contractId)
      const contracts = await loadFinanceRecords(db, a.id, 'contracts')
      const ids = (id: string) => contracts.find((row) => row.id === id)?.data.invoiceIds
      assert.deepEqual(ids('test-tuition'), [])
      assert.deepEqual(ids(a.sale.contractId), [invoices[0]?.id])
    })

    test('ayrılış kalan saati iade yazar, bakiye sıfırlanır; tekrar ve sonraki ders saat düşmez', async () => {
      const a = await withPackage({ tuition: false })
      const headers = key()
      const first = await withdraw(a.admin, headers)
      assert.equal(first.statusCode, 201, first.body)
      const withdrawalId = first.json().data.id as string
      const refunded = (await hourRows(a.id)).filter((row) => row.kind === 'refunded')
      assert.equal(refunded.length, 1)
      assert.equal(refunded[0]?.hours, 30)
      assert.equal(refunded[0]?.sourceType, 'withdrawal')
      assert.equal(refunded[0]?.sourceId, withdrawalId)
      assert.equal(refunded[0]?.occurredDate, WITHDRAW.withdrawalDate)
      const detail = (await get(`${SALES}/${a.sale.id}`, a.admin)).json().data
      assert.equal(detail.consumedHours, 10)
      assert.equal(detail.refundedHours, 30)
      assert.equal(detail.remainingHours, 0)
      assert.equal(detail.status, 'depleted')
      const replay = await withdraw(a.admin, headers)
      assert.equal(replay.headers['idempotent-replayed'], 'true')
      assert.equal((await hourRows(a.id)).length, 2)
      await assert.rejects(
        recordPackageHours(ctxOf(a.id), a.sale.id, {
          kind: 'consumed',
          hours: 1,
          occurredDate: '2026-10-06',
          sourceType: 'lesson',
          sourceId: 'test-ders-sonra',
        }),
        { code: 'package_balance_insufficient' },
      )
      const audits = await db
        .select({ changes: auditLog.changes })
        .from(auditLog)
        .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'package.hours')))
      assert.equal(audits.length, 2)
    })

    test('yalnız paketi olan kursiyerde girilen birim hesabı değiştirmez', async () => {
      const a = await withPackage({ tuition: false })
      const read = async (attendedUnits: number) =>
        (await quote(a.admin, { ...WITHDRAW, attendedUnits })).json().data.breakdown
      const few = await read(1)
      const many = await read(90)
      assert.equal(few.usageCents, 10 * HOURLY)
      assert.equal(many.usageCents, 10 * HOURLY)
      assert.equal(few.debtCents, many.debtCents)
    })

    test('reddedilen ayrılış saat hareketi ve kayıt yazmaz', async () => {
      const a = await withPackage({ tuition: true })
      const rejected = await post(
        '/api/v1/students/s3/withdraw',
        a.admin,
        { ...WITHDRAW, attendedUnits: 181, reason: 'relocation', targetSchool: null },
        key(),
      )
      assertError(rejected, 422, 'attended_exceeds_total')
      assert.equal((await hourRows(a.id)).length, 1)
      assert.equal((await loadFinanceRecords(db, a.id, 'invoices')).length, 5)
      assert.equal((await findRecord(db, a.id, 'students', 's3'))?.data.isActive, true)
    })

    test('DOM-FIN-041, K-12: iade iki sözleşmeden netleşir; hesap sahibi kararla seçilen ödeyicidir', async () => {
      const a = await withPackage({ tuition: true })
      const paid = await pay(a.admin, TUITION_NET + PACKAGE_NET)
      assert.equal(paid.statusCode, 201, paid.body)
      // Öğrenim sözleşmesinin ödeyicisi kursiyer, paketinki veli: iade kararı yöneticinindir (K-12).
      assertError(await withdraw(a.admin), 422, 'withdrawal_payer_decision_required')
      const withdrawn = await post(
        '/api/v1/students/s3/withdraw',
        a.admin,
        {
          ...DEPARTURE,
          approvedRefundCents: await approval(a.admin),
          payerDecision: { payer: 'student', reason: 'Ödemeyi kursiyer yaptı' },
        },
        key(),
      )
      assert.equal(withdrawn.statusCode, 201, withdrawn.body)
      const { id, version: rowVersion, refundCents, breakdown } = withdrawn.json().data
      assert.equal(breakdown.contracts[0].balanceCents, TUITION_NET - 2_000_000)
      assert.equal(
        breakdown.contracts[1].balanceCents,
        PACKAGE_NET - PACKAGE_NET / 10 - 10 * HOURLY,
      )
      assert.equal(
        refundCents,
        breakdown.contracts[0].balanceCents + breakdown.contracts[1].balanceCents,
      )
      const student = await findRecord(db, a.id, 'students', 's3')
      const refund = (accountHolder: unknown) =>
        post(
          `/api/v1/withdrawals/${String(id)}/pay-refund`,
          a.admin,
          { paidDate: '2026-10-06', iban: 'TR330006100519786457841326', accountHolder },
          { ...key(), ...version(rowVersion as number) },
        )
      assertError(await refund('Başka Kişi'), 422, 'refund_holder_mismatch')
      const done = await refund(student?.data.name)
      assert.equal(done.statusCode, 200, done.body)
      assert.equal(done.json().data.refundStatus, 'paid')
    })

    test('K-21: ön büro hesabı görür ama paket içeren ayrılışı tamamlayamaz, kayıt değişmez', async () => {
      const a = await withPackage({ tuition: false })
      const desk = await member(a.id, 'onburo')
      const refundCents = await approval(desk)
      const rows = await hourRows(a.id)
      assertError(
        await post(
          '/api/v1/students/s3/withdraw',
          desk,
          { ...DEPARTURE, approvedRefundCents: refundCents },
          key(),
        ),
        403,
      )
      assert.deepEqual(await hourRows(a.id), rows)
      assert.equal((await findRecord(db, a.id, 'students', 's3'))?.data.isActive, true)
    })

    test('K-21: yönetici tutarı görüp onaylamadan paketli ayrılış yazılmaz; tutar değiştiyse 409', async () => {
      const a = await withPackage({ tuition: false })
      const url = '/api/v1/students/s3/withdraw'
      assert.equal((await pay(a.admin, PACKAGE_NET)).statusCode, 201)
      const before = await approval(a.admin)
      assertError(
        await post(url, a.admin, DEPARTURE, key()),
        422,
        'withdrawal_refund_approval_required',
      )
      // Önizlemeden sonra saat girilir: tutar düşer, eski onay geçmez.
      const entered = await post(
        `${SALES}/${a.sale.id}/set-used-hours`,
        a.admin,
        { usedHours: 20, reason: 'Devam çizelgesine göre' },
        version(a.sale.version),
      )
      assert.equal(entered.statusCode, 200, entered.body)
      assertError(
        await post(url, a.admin, { ...DEPARTURE, approvedRefundCents: before }, key()),
        409,
        'withdrawal_refund_changed',
      )
      assert.equal((await findRecord(db, a.id, 'students', 's3'))?.data.isActive, true)
      const after = await approval(a.admin)
      assert.equal(after, before - 10 * HOURLY)
      const done = await post(url, a.admin, { ...DEPARTURE, approvedRefundCents: after }, key())
      assert.equal(done.statusCode, 201, done.body)
      const { breakdown, refundCents } = done.json().data
      assert.equal(refundCents, after)
      assert.equal(breakdown.refundApprovedCents, after)
      const audit = await db
        .select({ changes: auditLog.changes })
        .from(auditLog)
        .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'student.withdraw')))
      assert.ok(audit[0]?.changes?.fields?.includes('refundApprovedCents'))
    })

    test('K-21: elle girilen saat iadeyi düşürür; girilmeden önce önizleme uyarı alanı taşır', async () => {
      const a = await ready()
      const sale = await sold(a)
      assert.equal((await pay(a.admin, PACKAGE_NET)).statusCode, 201)
      const line = async () =>
        (await quote(a.admin))
          .json()
          .data.breakdown.contracts.find(
            (item: { packageSaleId?: string }) => item.packageSaleId === sale.id,
          )
      const missing = await line()
      assert.equal(missing.usedHoursMissing, true)
      assert.equal(missing.usageCents, 0)
      assert.equal(missing.balanceCents, PACKAGE_NET - PACKAGE_NET / 10)
      await post(
        `${SALES}/${sale.id}/set-used-hours`,
        a.admin,
        { usedHours: 30, reason: 'Devam çizelgesine göre' },
        version(1),
      )
      const entered = await line()
      assert.equal(entered.usedHoursMissing, undefined)
      assert.equal(entered.attendedUnits, 30)
      assert.equal(entered.usageCents, 30 * HOURLY)
      assert.equal(entered.balanceCents, PACKAGE_NET - PACKAGE_NET / 10 - 30 * HOURLY)
      assert.equal(entered.returnedHours, 10)
    })

    test('K-21, DOM-FIN-041: ayrılıştan sonra kullanılan saat değişmez; önceki gün girişi hesaba girer', async () => {
      const a = await ready()
      const sale = await sold(a)
      // Geriye dönük ayrılış: giriş bugünün tarihini taşır ama ayrılış hesabından düşmez.
      now = new Date('2026-10-20T09:00:00.000Z')
      try {
        const set = await post(
          `${SALES}/${sale.id}/set-used-hours`,
          a.admin,
          { usedHours: 9, reason: 'Devam çizelgesine göre' },
          version(1),
        )
        assert.equal(set.statusCode, 200, set.body)
        const line = (await quote(a.admin)).json().data.breakdown.contracts[0]
        assert.equal(line.attendedUnits, 9)
        const done = await withdraw(a.admin)
        assert.equal(done.statusCode, 201, done.body)
        assertError(
          await post(
            `${SALES}/${sale.id}/set-used-hours`,
            a.admin,
            { usedHours: 3, reason: 'Sonradan düzeltme' },
            version(2),
          ),
          422,
          'package_sale_closed',
        )
      } finally {
        now = FIXED_NOW
      }
    })

    test('DOM-YTK-001: başka kurumun satışı hesaba girmez', async () => {
      const a = await withPackage({ tuition: false })
      const b = await ready()
      assertError(await quote(b.admin), 422, 'withdrawal_contract_missing')
      assert.equal((await hourRows(b.id)).length, 0)
      assert.equal((await hourRows(a.id)).length, 1)
    })
  })
})
