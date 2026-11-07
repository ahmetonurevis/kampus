import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { INSTITUTION_TYPES } from '@kampus/school-core/modules/collection-modules.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
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

/**
 * Paket saat bakiyesi ve kullanılan saat raporu uçları (IST-114; DOM-FIN-058, DOM-DIL-051, K-21).
 * Her test kendi dil okulunu kurar: s3 kursiyerdir, saat ücreti 500 ₺, 40 saatlik paket 20.000 ₺.
 */

const SEED = createSeed(FIXED_NOW)
const YEAR = FIXED_NOW.getUTCFullYear()
const PACKAGES = '/api/v1/finance/packages'
const SALES = '/api/v1/finance/package-sales'
const REPORT = '/api/v1/finance/package-report'
const PERIOD = 'from=2026-10-01&to=2026-12-31'
const balanceUrl = (studentId: string) => `/api/v1/finance/students/${studentId}/package-balance`
const HOURLY = 50_000
const HOURS_BODY = { kind: 'hours', name: '40 saatlik paket', lessonHours: 40, validityDays: 180 }

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

describe('IST-114: paket saat bakiyesi ve kullanılan saat raporu uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let tenantCount = 0
  let clientIp = '10.1.0.1'
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  type Headers = Record<string, string>
  const post = (url: string, cookie: string, body: unknown, headers: Headers = {}) =>
    app.inject({
      method: 'POST',
      url,
      remoteAddress: clientIp,
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', cookie, ...headers },
      payload: JSON.stringify(body),
    })
  const get = (url: string, cookie: string | null, headers: Headers = {}, target: App = app) =>
    target.inject({
      method: 'GET',
      url,
      remoteAddress: clientIp,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }), ...headers },
    })
  const csv = (url: string, cookie: string, target: App = app) =>
    get(url, cookie, { accept: 'text/csv' }, target)
  const key = () => ({ 'idempotency-key': randomUUID() })
  function assertError(
    response: Awaited<ReturnType<typeof get>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.1.${String((tenantCount += 1))}.1`
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

  async function ready(packageBody: Record<string, unknown> = HOURS_BODY) {
    const a = await institution()
    const tariffId = randomUUID()
    await db.insert(feeTariffs).values({
      institutionId: a.id,
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
          vatBasisPoints: 1000,
          vatEffectiveDate: '2026-01-01',
        },
      ],
      discounts: [],
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
    const made = await post(PACKAGES, a.admin, packageBody)
    assert.equal(made.statusCode, 201, made.body)
    const packageId = made.json().data.id as string
    const sell = async (studentId = 's3') => {
      const body = {
        packageId,
        studentId,
        installmentCount: 2,
        tariffId,
        firstDueDate: '2026-10-31',
      }
      const response = await post(SALES, a.admin, body, key())
      assert.equal(response.statusCode, 201, response.body)
      return response.json().data as { id: string; netCents: number; version: number }
    }
    return { ...a, packageId, sell }
  }
  const ctxOf = (institutionId: string) => ({
    db,
    institutionId,
    actor: { userId: 'test-user', role: 'yonetici' as const, membershipId: 'test-membership' },
    now,
    log: app.log,
  })
  const lesson = (institutionId: string, saleId: string, hours: number, occurredDate: string) =>
    recordPackageHours(ctxOf(institutionId), saleId, {
      kind: 'consumed',
      hours,
      occurredDate,
      sourceType: 'lesson',
      sourceId: `test-ders-${randomUUID()}`,
    })
  const setUsed = async (cookie: string, saleId: string, usedHours: number, version: number) => {
    const response = await post(
      `${SALES}/${saleId}/set-used-hours`,
      cookie,
      { usedHours, reason: 'Devam çizelgesine göre' },
      { 'if-match': `"${String(version)}"` },
    )
    assert.equal(response.statusCode, 200, response.body)
  }
  const exportAudits = (institutionId: string) =>
    db
      .select({ entityId: auditLog.entityId, actorRole: auditLog.actorRole })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institutionId),
          eq(auditLog.action, 'finance.package_report_export'),
        ),
      )

  test('DOM-YTK-001: iki uç da oturumsuz 401', async () => {
    assertError(await get(balanceUrl('s3'), null), 401)
    assertError(await get(`${REPORT}?${PERIOD}`, null), 401)
  })

  test('DOM-FIN-052: rapor yalnız yönetici; bakiyeyi öğretmen okuyamaz', async () => {
    const a = await ready()
    const teacher = await member(a.id, 'ogretmen')
    const desk = await member(a.id, 'onburo')
    const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: 's3' }])
    const student = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's3' }])
    assertError(await get(balanceUrl('s3'), teacher), 403, 'forbidden')
    for (const cookie of [teacher, desk, parent, student]) {
      assertError(await get(`${REPORT}?${PERIOD}`, cookie), 403, 'forbidden')
      assertError(await csv(`${REPORT}?${PERIOD}`, cookie), 403, 'forbidden')
    }
    assert.deepEqual(await exportAudits(a.id), [])
  })

  test('DOM-YTK-040, DOM-YTK-012: finance kapalıysa 403; dil okulu dışında her rol 404', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(balanceUrl('s3'), closed.admin), 403, 'module_disabled')
    assertError(await get(`${REPORT}?${PERIOD}`, closed.admin), 403, 'module_disabled')
    for (const type of INSTITUTION_TYPES.filter((item) => item !== 'language_school')) {
      const other = await institution({ type })
      assertError(await get(balanceUrl('s3'), other.admin), 404)
      assertError(await get(`${REPORT}?${PERIOD}`, other.admin), 404)
    }
  })

  test('IST-114: 400 bilinmeyen ya da eksik parametre, 422 ters ya da bir yıldan uzun dönem', async () => {
    const a = await ready()
    assertError(await get(`${REPORT}?${PERIOD}&bilinmeyen=1`, a.admin), 400)
    assertError(await get(`${REPORT}?from=2026-10-01`, a.admin), 400)
    assertError(await get(`${REPORT}?from=2026-13-01&to=2026-12-31`, a.admin), 400)
    assertError(await get(`${REPORT}?${PERIOD}&pageSize=101`, a.admin), 400)
    assertError(await get(`${REPORT}?${PERIOD}&institutionId=x`, a.admin), 400)
    assertError(
      await get(`${REPORT}?from=2026-12-01&to=2026-11-01`, a.admin),
      422,
      'export_period_invalid',
    )
    assertError(
      await get(`${REPORT}?from=2025-01-01&to=2026-01-02`, a.admin),
      422,
      'export_period_too_long',
    )
    assert.deepEqual(await exportAudits(a.id), [])
  })

  test('IST-114, DOM-DIL-051: bakiye satılan, kullanılan ve kalan saati verir; personel tutarı da görür', async () => {
    const a = await ready()
    const sale = await a.sell()
    await lesson(a.id, sale.id, 4, '2026-10-06')
    await setUsed(a.admin, sale.id, 10, 1)
    const desk = await member(a.id, 'onburo')
    for (const cookie of [a.admin, desk]) {
      const response = await get(balanceUrl('s3'), cookie)
      assert.equal(response.statusCode, 200, response.body)
      const { data } = response.json()
      assert.equal(data.purchasedHours, 40)
      assert.equal(data.usedHours, 10)
      assert.equal(data.remainingHours, 30)
      assert.equal(data.expiredHours, 0)
      assert.equal(data.usedHoursRecorded, true)
      assert.equal(data.sales[0].status, 'active')
      assert.deepEqual(data.amounts, {
        netCents: 2_000_000,
        recognizedCents: 500_000,
        returnedCents: 0,
        deferredCents: 1_500_000,
      })
      assert.deepEqual(data.sales[0].amounts, data.amounts)
    }
    // Paketi olmayan öğrenci boş bakiyedir; kurumda olmayan öğrenci 404.
    const empty = (await get(balanceUrl(OTHER_STUDENT), a.admin)).json().data
    assert.equal(empty.purchasedHours, 0)
    assert.deepEqual(empty.sales, [])
    assertError(await get(balanceUrl('ogrenci-yok'), a.admin), 404)
  })

  test('DOM-FIN-052, K-04: veli bağlı çocuğunu, öğrenci kendisini yalnız saatle görür; kapsam dışı 404', async () => {
    const a = await ready()
    await a.sell()
    await a.sell(OTHER_STUDENT)
    const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: 's3' }])
    const student = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's3' }])
    for (const cookie of [parent, student]) {
      const response = await get(balanceUrl('s3'), cookie)
      assert.equal(response.statusCode, 200, response.body)
      const { data } = response.json()
      assert.equal(data.purchasedHours, 40)
      assert.equal(data.sales.length, 1)
      assert.equal('amounts' in data, false)
      assert.equal('amounts' in data.sales[0], false)
      assert.equal(response.body.includes('Cents'), false)
      assertError(await get(balanceUrl(OTHER_STUDENT), cookie), 404)
    }
  })

  test('DOM-DIL-051, H-19: süresi dolan saat silinmez; bakiye ve rapor süresi dolan saati ayrı verir', async () => {
    const a = await ready()
    const sale = await a.sell()
    await setUsed(a.admin, sale.id, 6, 1)
    now = new Date('2027-05-01T09:00:00.000Z')
    try {
      const { data } = (await get(balanceUrl('s3'), a.admin)).json()
      assert.equal(data.sales[0].status, 'expired')
      assert.equal(data.sales[0].expiresDate, '2027-04-04')
      assert.equal(data.expiredHours, 34)
      assert.equal(data.remainingHours, 34)
      assert.equal(data.amounts.deferredCents, 1_700_000)
      const report = (await get(`${REPORT}?from=2027-04-01&to=2027-04-30`, a.admin)).json().data
      assert.equal(report.totals.expiredHours, 34)
      assert.equal(report.totals.recognizedCents, 0)
      assert.equal(report.totals.closingDeferredCents, 1_700_000)
      assert.deepEqual(
        report.months.map((month: { month: string; expiredHours: number }) => [
          month.month,
          month.expiredHours,
        ]),
        [['2027-04', 34]],
      )
    } finally {
      now = FIXED_NOW
    }
  })

  test('DOM-DIL-051: sıfır bakiyede kalan ve ertelenmiş gelir sıfırdır, tanınan gelir net ücrettir', async () => {
    const a = await ready()
    const sale = await a.sell()
    await setUsed(a.admin, sale.id, 40, 1)
    const { data } = (await get(balanceUrl('s3'), a.admin)).json()
    assert.equal(data.remainingHours, 0)
    assert.equal(data.sales[0].status, 'depleted')
    assert.equal(data.amounts.recognizedCents, sale.netCents)
    assert.equal(data.amounts.deferredCents, 0)
    const report = (await get(`${REPORT}?${PERIOD}`, a.admin)).json().data
    assert.equal(report.totals.closingHours, 0)
    assert.equal(report.totals.recognizedCents, sale.netCents)
  })

  test('IST-114: rapor toplamları satış kayıtlarına ve bakiyelere eşittir; satırlar sayfalı', async () => {
    const a = await ready()
    const first = await a.sell()
    const second = await a.sell(OTHER_STUDENT)
    await lesson(a.id, first.id, 3, '2026-10-06')
    await setUsed(a.admin, second.id, 8, 1)
    await setUsed(a.admin, second.id, 5, 2)
    const response = await get(`${REPORT}?${PERIOD}&page=1&pageSize=1`, a.admin)
    assert.equal(response.statusCode, 200, response.body)
    const { data, meta } = response.json()
    assert.deepEqual(meta, { page: 1, pageSize: 1, total: 2 })
    assert.equal(data.lines.length, 1)
    assert.equal(typeof data.lines[0].studentName, 'string')
    const page2 = (await get(`${REPORT}?${PERIOD}&page=2&pageSize=1`, a.admin)).json().data
    assert.deepEqual(page2.totals, data.totals)
    const listed = (await get(SALES, a.admin)).json().data as {
      netCents: number
      purchasedHours: number
      consumedHours: number
      remainingHours: number
    }[]
    const sum = (pick: (row: (typeof listed)[number]) => number) =>
      listed.reduce((total, row) => total + pick(row), 0)
    assert.equal(data.totals.saleCount, 2)
    assert.equal(
      data.totals.soldCents,
      sum((row) => row.netCents),
    )
    assert.equal(
      data.totals.soldHours,
      sum((row) => row.purchasedHours),
    )
    assert.equal(
      data.totals.usedHours,
      sum((row) => row.consumedHours),
    )
    assert.equal(
      data.totals.closingHours,
      sum((row) => row.remainingHours),
    )
    assert.equal(
      data.totals.openingHours + data.totals.soldHours - data.totals.usedHours,
      data.totals.closingHours,
    )
    assert.equal(
      data.totals.soldCents - data.totals.recognizedCents,
      data.totals.closingDeferredCents,
    )
    const months = data.months as { usedHours: number; recognizedCents: number }[]
    assert.equal(
      months.reduce((total, month) => total + month.usedHours, 0),
      data.totals.usedHours,
    )
    assert.equal(
      months.reduce((total, month) => total + month.recognizedCents, 0),
      data.totals.recognizedCents,
    )
    const balances = await Promise.all(
      ['s3', OTHER_STUDENT].map(async (id) => (await get(balanceUrl(id), a.admin)).json().data),
    )
    assert.equal(
      balances.reduce((total, balance) => total + balance.amounts.deferredCents, 0),
      data.totals.closingDeferredCents,
    )
  })

  test('IST-114: CSV bütün satırları formül kaçışıyla verir, denetime yazılır', async () => {
    const a = await ready({ ...HOURS_BODY, name: '=TOPLA(1;2)' })
    await a.sell()
    await a.sell(OTHER_STUDENT)
    const response = await csv(`${REPORT}?${PERIOD}&page=1&pageSize=1`, a.admin)
    assert.equal(response.statusCode, 200, response.body)
    assert.match(String(response.headers['content-type']), /^text\/csv/)
    assert.match(String(response.headers['content-disposition']), /package-report-2026-10-01/)
    assert.equal(response.body.startsWith('﻿"Öğrenci";"Paket"'), true)
    const rows = response.body.split('\r\n')
    assert.equal(rows.length, 3)
    assert.equal(rows[1]?.includes(`"'=TOPLA(1;2)"`), true)
    assert.equal(rows[1]?.endsWith(';20000,00'), true)
    assert.deepEqual(await exportAudits(a.id), [
      { entityId: 'package-report:2026-10-01:2026-12-31', actorRole: 'yonetici' },
    ])
  })

  test('guvenlik-kvkk: eski oturumla CSV 403 reauthentication_required; JSON açık; CSV 10/dk', async () => {
    const a = await ready()
    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(
        await csv(`${REPORT}?${PERIOD}`, a.admin, later),
        403,
        'reauthentication_required',
      )
      assert.equal((await get(`${REPORT}?${PERIOD}`, a.admin, {}, later)).statusCode, 200)
    } finally {
      await later.close()
    }
    for (let index = 0; index < 10; index += 1)
      assert.equal((await csv(`${REPORT}?${PERIOD}`, a.admin)).statusCode, 200)
    assertError(await csv(`${REPORT}?${PERIOD}`, a.admin), 429)
    assert.equal((await get(`${REPORT}?${PERIOD}`, a.admin)).statusCode, 200)
  })

  test('IST-002: başka kurumun satışı bakiyeye ve rapora girmez, B değişmez; olmayan öğrenci 404', async () => {
    const a = await ready()
    const b = await ready()
    const bSale = await b.sell()
    await setUsed(b.admin, bSale.id, 7, 1)
    const before = (await get(balanceUrl('s3'), b.admin)).json()
    const own = (await get(balanceUrl('s3'), a.admin)).json().data
    assert.deepEqual(own.sales, [])
    assert.equal(own.purchasedHours, 0)
    assertError(await get(balanceUrl(randomUUID()), a.admin), 404)
    const report = (await get(`${REPORT}?${PERIOD}`, a.admin)).json()
    assert.deepEqual(report.data.lines, [])
    assert.equal(report.data.totals.soldHours, 0)
    assert.equal(report.meta.total, 0)
    assert.deepEqual((await get(balanceUrl('s3'), b.admin)).json(), before)
  })
})
