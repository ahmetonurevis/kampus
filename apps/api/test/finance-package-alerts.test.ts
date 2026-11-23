import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
import { records } from '../src/db/schema/records.ts'
import { packageAlertsJob } from '../src/jobs/finance-package-alerts.ts'
import type { JobDeps } from '../src/jobs/types.ts'
import { recordLessonPackageUsage } from '../src/services/finance-packages.ts'
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
import { tempStorage } from './support/files-sample.ts'

/**
 * Paket saat uyarıları (ON-084; IST-078, IST-114; DOM-FIN-058, DOM-DIL-051; K-248, K-249): sabah
 * taraması ve satış listesindeki uyarı süzgeci. İş doğrudan sabit `now` ile koşulur (`JOBS_ENABLED`
 * testte kapalı). FIXED_NOW 2026-10-06 09:00Z (İstanbul 12:00). Her test kendi dil okulunu kurar: s3
 * kursiyerdir, 40 saatlik paketin saat azaldı eşiği 8 saattir.
 */

type Json = ReturnType<typeof JSON.parse>
const SEED = createSeed(FIXED_NOW)
const YEAR = FIXED_NOW.getUTCFullYear()
const DAY = 86_400_000
const at = (days: number) => new Date(FIXED_NOW.getTime() + days * DAY)
const PACKAGES = '/api/v1/finance/packages'
const SALES = '/api/v1/finance/package-sales'
const balanceUrl = (studentId: string) => `/api/v1/finance/students/${studentId}/package-balance`

const CLASSES = ['c1', 'c3']
const STUDENTS = SEED.students.filter((item) => CLASSES.includes(item.classId))
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASSES.includes(item.id)),
  students: STUDENTS,
  parents: SEED.parents,
}

describe('K-248, K-249, K-250: paket saat uyarıları ve yoklama köprüsü', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let deps: JobDeps
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.4.0.1'
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
    store = await tempStorage()
    deps = { db, storage: store.storage, log: app.log }
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
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
  const get = (url: string, cookie: string) =>
    app.inject({
      method: 'GET',
      url,
      remoteAddress: clientIp,
      headers: { origin: TEST_ORIGIN, cookie },
    })
  const run = (institutionId: string, now = FIXED_NOW) =>
    packageAlertsJob.run(deps, { institutionId }, now)

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.4.${String((tenantCount += 1))}.1`
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

  /** Kurum, yayımlı tarife ve verilen süreli paketler; `sell` paketi s3'e satar. */
  async function ready(validities: readonly number[]) {
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
          amountCents: 50_000,
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
    const packageIds: string[] = []
    for (const validityDays of validities) {
      const made = await post(PACKAGES, a.admin, {
        kind: 'hours',
        name: `${String(validityDays)} günlük 40 saat`,
        lessonHours: 40,
        validityDays,
      })
      assert.equal(made.statusCode, 201, made.body)
      packageIds.push(made.json().data.id as string)
    }
    const sell = async (index: number, studentId = 's3') => {
      const response = await post(
        SALES,
        a.admin,
        {
          packageId: packageIds[index],
          studentId,
          installmentCount: 1,
          tariffId,
          firstDueDate: '2026-10-31',
        },
        { 'idempotency-key': randomUUID() },
      )
      assert.equal(response.statusCode, 201, response.body)
      return response.json().data as { id: string; version: number; alerts: string[] }
    }
    const setUsed = async (saleId: string, usedHours: number, version: number) => {
      const response = await post(
        `${SALES}/${saleId}/set-used-hours`,
        a.admin,
        { usedHours, reason: 'Devam çizelgesine göre' },
        { 'if-match': `"${String(version)}"` },
      )
      assert.equal(response.statusCode, 200, response.body)
    }
    return { ...a, sell, setUsed }
  }
  const notices = async (institutionId: string) =>
    (await loadRecords(db, institutionId, ['notifications']))
      .map((row) => row.data as Json)
      .map((data) => ({ kind: data.kind as string, subjectId: data.subject.id as string }))
      .sort((x, y) => x.kind.localeCompare(y.kind))

  test('IST-078: tarama saat azaldı, süre doluyor ve süre doldu bildirimini bir kez yazar', async () => {
    const a = await ready([180, 15, 1])
    const low = await a.sell(0)
    await a.setUsed(low.id, 35, low.version)
    const expiring = await a.sell(1)
    const expired = await a.sell(2)
    const quiet = await a.sell(0)

    // Beş gün sonra: düşük bakiye, 15 günlük paket 10 gün kaldı, 1 günlük paketin süresi doldu.
    const first = await run(a.id, at(5))
    assert.deepEqual(first, {
      sales: 4,
      notices: 3,
      created: 3,
      deduplicated: 0,
      skipped: null,
    })
    assert.deepEqual(await notices(a.id), [
      { kind: 'package_expired', subjectId: expired.id },
      { kind: 'package_expiring', subjectId: expiring.id },
      { kind: 'package_hours_low', subjectId: low.id },
    ])
    assert.ok(!(await notices(a.id)).some((item) => item.subjectId === quiet.id))
    // Kayıt yalnız satış kimliği taşır: saat, tutar, paket adı yoktur (DOM-ILT-023).
    for (const row of await loadRecords(db, a.id, ['notifications']))
      assert.deepEqual(Object.keys(row.data).sort(), [
        'audience',
        'createdAt',
        'id',
        'kind',
        'studentId',
        'subject',
      ])

    // Aynı gün ikinci tarama yazmaz.
    const again = await run(a.id, at(5))
    assert.equal(again.created, 0)
    assert.equal(again.deduplicated, 3)
    assert.equal((await notices(a.id)).length, 3)
  })

  test('DOM-DIL-051: eski süre dolumu topluca bildirilmez; sessiz saatte tarama hiçbir şey okumaz', async () => {
    const a = await ready([1])
    await a.sell(0)
    assert.equal((await run(a.id, at(9))).notices, 0)
    assert.deepEqual(await run(a.id, new Date('2026-10-06T19:00:00.000Z')), {
      sales: 0,
      notices: 0,
      created: 0,
      deduplicated: 0,
      skipped: 'quiet_hours',
    })
    assert.deepEqual(await notices(a.id), [])
  })

  test('DOM-FIN-040: ayrılmış (pasif) kursiyerin satışı taranmaz', async () => {
    const a = await ready([180])
    const sale = await a.sell(0)
    await a.setUsed(sale.id, 39, sale.version)
    await db
      .update(records)
      .set({ data: sql`${records.data} || '{"isActive": false}'::jsonb` })
      .where(
        and(
          eq(records.institutionId, a.id),
          eq(records.collection, 'students'),
          eq(records.id, 's3'),
        ),
      )
    assert.deepEqual(await run(a.id), {
      sales: 0,
      notices: 0,
      created: 0,
      deduplicated: 0,
      skipped: null,
    })
  })

  test('DOM-YTK-040, DOM-YTK-012: finans modülü kapalıysa ve dil okulu dışında tarama atlanır', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assert.equal((await run(closed.id)).skipped, 'module_disabled')
    const school = await institution({ type: 'school' })
    assert.equal((await run(school.id)).skipped, 'not_language_school')
    assert.equal((await run('test-yok')).skipped, 'institution_missing')
  })

  test('DOM-FIN-058: satış listesi uyarıyı taşır ve `alert` ile süzülür; aile de saat uyarısını görür', async () => {
    const a = await ready([180, 10])
    const low = await a.sell(0)
    await a.setUsed(low.id, 33, low.version)
    const expiring = await a.sell(1)
    assert.deepEqual(expiring.alerts, ['expiring'])
    await a.sell(0)

    const byAlert = async (cookie: string, alert: string) => {
      const response = await get(`${SALES}?alert=${alert}&pageSize=1`, cookie)
      assert.equal(response.statusCode, 200, response.body)
      const body = response.json()
      return {
        ids: (body.data as Json[]).map((item) => item.id as string),
        alerts: (body.data as Json[]).map((item) => item.alerts as string[]),
        total: body.meta.total as number,
      }
    }
    assert.deepEqual(await byAlert(a.admin, 'low_balance'), {
      ids: [low.id],
      alerts: [['low_balance']],
      total: 1,
    })
    assert.deepEqual(await byAlert(a.admin, 'expiring'), {
      ids: [expiring.id],
      alerts: [['expiring']],
      total: 1,
    })
    const all = await get(SALES, a.admin)
    assert.equal(all.json().meta.total, 3)

    const invalid = await get(`${SALES}?alert=bilinmeyen`, a.admin)
    assert.equal(invalid.statusCode, 400, invalid.body)

    const parent = await member(a.id, 'veli', [{ kind: 'child', recordId: 's3' }])
    assert.deepEqual((await byAlert(parent, 'low_balance')).ids, [low.id])
    const balance = await get(balanceUrl('s3'), parent)
    assert.equal(balance.statusCode, 200, balance.body)
    const rows = balance.json().data.sales as Json[]
    assert.deepEqual(rows.map((row) => (row.alerts as string[]).join(',')).sort(), [
      '',
      'expiring',
      'low_balance',
    ])

    // Kapsam dışı öğrenci süzgeçle de görünmez.
    const other = await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    assert.deepEqual(await byAlert(other, 'low_balance'), { ids: [], alerts: [], total: 0 })
  })
  const ctxOf = (institutionId: string) => ({
    db,
    institutionId,
    actor: { userId: 'test-user', role: 'yonetici' as const, membershipId: 'test-membership' },
    now: FIXED_NOW,
    log: app.log,
  })
  const groupLesson = (lessonHourId: string, hours: number, studentId = 's3') => ({
    studentId,
    courseId: null,
    lessonKind: 'group',
    lessonHourId,
    occurredDate: '2026-10-06',
    hours,
  })
  const balanceOf = async (cookie: string) => {
    const response = await get(balanceUrl('s3'), cookie)
    assert.equal(response.statusCode, 200, response.body)
    const data = response.json().data as Json
    return { used: data.usedHours as number, remaining: data.remainingHours as number }
  }

  test('IST-078, K-250: yoklamadan gelen ders saati bakiyeyi düşürür, elle girilen farka eklenmez, ikinci kez yazılmaz', async () => {
    const a = await ready([180])
    const sale = await a.sell(0)
    await a.setUsed(sale.id, 10, sale.version)

    assert.deepEqual(await recordLessonPackageUsage(ctxOf(a.id), groupLesson('test-lh-1', 2)), {
      saleId: sale.id,
      recorded: true,
    })
    assert.deepEqual(await balanceOf(a.admin), { used: 10, remaining: 30 })
    assert.deepEqual(await recordLessonPackageUsage(ctxOf(a.id), groupLesson('test-lh-1', 2)), {
      saleId: sale.id,
      recorded: false,
    })
    // Elle girilen fark (8) biter, sonraki ders toplamı artırır.
    await recordLessonPackageUsage(ctxOf(a.id), groupLesson('test-lh-2', 9))
    assert.deepEqual(await balanceOf(a.admin), { used: 11, remaining: 29 })
    // Fark değiştiği için sürüm arttı: eski `If-Match` ile elle giriş 409.
    const stale = await post(
      `${SALES}/${sale.id}/set-used-hours`,
      a.admin,
      { usedHours: 20, reason: 'Devam çizelgesine göre' },
      { 'if-match': `"${String(sale.version + 1)}"` },
    )
    assert.equal(stale.statusCode, 409, stale.body)
    // Kullanılan saat derslerden yazılanın altına inemez (K-21).
    const fresh = (await get(`${SALES}/${sale.id}`, a.admin)).json().data as Json
    const below = await post(
      `${SALES}/${sale.id}/set-used-hours`,
      a.admin,
      { usedHours: 10, reason: 'Devam çizelgesine göre' },
      { 'if-match': `"${String(fresh.version)}"` },
    )
    assert.equal(below.statusCode, 422, below.body)
    assert.equal(below.json().code, 'package_used_below_lessons')
  })

  test('K-250: uygun satış yoksa ders paketsiz sayılır, hiçbir hareket yazılmaz', async () => {
    const a = await ready([180])
    assert.deepEqual(await recordLessonPackageUsage(ctxOf(a.id), groupLesson('test-lh-1', 1)), {
      saleId: null,
      recorded: false,
    })
    await a.sell(0)
    const privateLesson = { ...groupLesson('test-lh-2', 1), lessonKind: 'private' }
    assert.deepEqual(await recordLessonPackageUsage(ctxOf(a.id), privateLesson), {
      saleId: null,
      recorded: false,
    })
    assert.deepEqual(await balanceOf(a.admin), { used: 0, remaining: 40 })
  })
})
