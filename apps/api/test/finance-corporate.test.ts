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
import { insertLessonHourAttendances } from '../src/db/progression.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  corporateCustomers,
  corporateInvoiceLines,
  corporateInvoices,
} from '../src/db/schema/finance-corporate.ts'
import { languageGroupMembers } from '../src/db/schema/language-groups.ts'
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
 * Kurumsal müşteri, çalışan bağı, toplu fatura ve katılım özeti uçları (IST-089; DOM-FIN-060,
 * DOM-DIL-093). Her test kendi dil okulunu kurar; FIXED_NOW 2026-10-06. `s3` ve `OTHER` kursiyerdir,
 * her birinin Ekim ve Kasım vadeli birer taksiti vardır.
 */

const SEED = createSeed(FIXED_NOW)
const CUSTOMERS = '/api/v1/finance/corporate-customers'
const INVOICES = '/api/v1/finance/corporate-invoices'
const PERIOD = 'from=2026-10-01&to=2026-10-31'
const CLASSES = ['c1', 'c3']
const STUDENTS = SEED.students.filter((item) => CLASSES.includes(item.classId))
const OTHER = STUDENTS.find((item) => item.id !== 's3')?.id ?? ''
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASSES.includes(item.id)),
  students: STUDENTS,
  parents: SEED.parents,
}
const AMOUNT = 400_000
const CUSTOMER = {
  name: 'Örnek Lojistik A.Ş.',
  taxNumber: '1234567890',
  taxOffice: 'Kadıköy',
  billingAddress: 'Moda Cad. No: 1 Kadıköy İstanbul',
  contactName: 'İK Birimi',
  contactEmail: 'ik@example.com',
  contactPhone: '02161234567',
}
const invoiceRecord = (id: string, studentId: string, installment: number, dueDate: string) => ({
  collection: 'invoices' as const,
  id,
  data: {
    id,
    studentId,
    installment,
    amount: AMOUNT,
    dueDate,
    paidAt: null,
    method: null,
    reminderAt: null,
    feeKind: 'tuition',
  },
})

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('IST-089: kurumsal müşteri ve toplu fatura uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.89.0.1'
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
    target: App = app,
  ) {
    return target.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const get = (url: string, cookie: string | null, headers: Record<string, string> = {}) =>
    call('GET', url, cookie, undefined, headers)
  const csv = (url: string, cookie: string, target: App = app) =>
    call('GET', url, cookie, undefined, { accept: 'text/csv' }, target)
  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  async function ok(response: Response, status = 200): Promise<Json> {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.89.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, { type: 'language_school', ...overrides })
    await insertMissingRecords(
      db,
      created.id,
      [
        ...Object.entries(SAMPLE).flatMap(([collection, items]) =>
          (items ?? []).map((data) => {
            const name = collection as CollectionName
            const id = recordKey(name, data)
            if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
            return { collection: name, id, data }
          }),
        ),
        invoiceRecord('test-inv-s3-1', 's3', 1, '2026-10-15T09:00:00.000Z'),
        invoiceRecord('test-inv-s3-2', 's3', 2, '2026-11-15T09:00:00.000Z'),
        invoiceRecord('test-inv-o-1', OTHER, 1, '2026-10-20T09:00:00.000Z'),
        invoiceRecord('test-inv-o-2', OTHER, 2, '2026-11-20T09:00:00.000Z'),
      ],
      FIXED_NOW,
    )
    return { id: created.id, adminUser: created.admin, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  const createCustomer = async (t: Tenant, body: Json = CUSTOMER) =>
    ok(await call('POST', CUSTOMERS, t.admin, body), 201)
  const link = (t: Tenant, customerId: string, studentId: string, startsOn = '2026-09-01') =>
    call('POST', `${CUSTOMERS}/${customerId}/employees`, t.admin, {
      studentId,
      startsOn,
      noticeConfirmed: true,
    })
  const issue = (cookie: string, customerId: string, headers: Record<string, string> = key()) =>
    call('POST', INVOICES, cookie, { customerId, from: '2026-10-01', to: '2026-10-31' }, headers)

  /** Şirket, iki bağlı kursiyer. */
  async function ready() {
    const t = await institution()
    const customer = await createCustomer(t)
    const customerId = String(customer.id)
    await ok(await link(t, customerId, 's3'), 201)
    await ok(await link(t, customerId, OTHER), 201)
    return { ...t, customerId }
  }

  const rows = async (table: typeof corporateInvoices | typeof corporateCustomers, id: string) =>
    db.select().from(table).where(eq(table.institutionId, id))
  const audits = async (institutionId: string, action: string) =>
    db
      .select({ entityId: auditLog.entityId })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('kimliksiz istek 401', async () => {
    assertError(await get(CUSTOMERS, null), 401)
    assertError(await call('POST', INVOICES, null, {}), 401)
  })

  test('DOM-FIN-060: şirket eklenir, aranır, düzeltilir; vergi numarası tekil, geçersiz VKN 400', async () => {
    const t = await institution()
    const created = await createCustomer(t)
    assert.equal(created.activeEmployeeCount, 0)
    assert.equal(created.contactEmail, 'ik@example.com')
    assertError(
      await call('POST', CUSTOMERS, t.admin, { ...CUSTOMER, name: 'Başka' }),
      409,
      'corporate_tax_number_exists',
    )
    const before = await rows(corporateCustomers, t.id)
    const invalid = await call('POST', CUSTOMERS, t.admin, { ...CUSTOMER, taxNumber: '1234567891' })
    assertError(invalid, 400)
    assert.equal(invalid.json().issues[0].path[0], 'taxNumber')
    assertError(await call('POST', CUSTOMERS, t.admin, { ...CUSTOMER, institutionId: t.id }), 400)
    assert.deepEqual(await rows(corporateCustomers, t.id), before)

    const second = await createCustomer(t, {
      ...CUSTOMER,
      name: 'Deniz Yazılım',
      taxNumber: '10000000146',
    })
    const search = await call('GET', `${CUSTOMERS}?q=yazil`, t.admin)
    assert.deepEqual(
      search.json().data.map((item: Json) => item.id),
      [second.id],
    )
    assert.equal((await get(CUSTOMERS, t.admin)).json().meta.total, 2)

    const url = `${CUSTOMERS}/${String(created.id)}`
    assertError(await call('PATCH', url, t.admin, { taxOffice: 'Moda' }), 400, 'if_match_required')
    assertError(
      await call('PATCH', url, t.admin, { taxNumber: '10000000146' }, ifMatch(created.version)),
      409,
      'corporate_tax_number_exists',
    )
    const updated = await ok(
      await call('PATCH', url, t.admin, { taxOffice: 'Moda', contactPhone: null }, ifMatch(1)),
    )
    assert.deepEqual([updated.taxOffice, updated.contactPhone, updated.version], ['Moda', null, 2])
    assertError(
      await call('PATCH', url, t.admin, { taxOffice: 'Eski' }, ifMatch(1)),
      409,
      'version_conflict',
    )
  })

  test('DOM-FIN-052: öğretmen, veli ve öğrenci 403; ön büro yazar ama faturayı iptal edemez', async () => {
    const t = await ready()
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(CUSTOMERS, cookie), 403, 'forbidden')
      assertError(await call('POST', CUSTOMERS, cookie, CUSTOMER), 403, 'forbidden')
      assertError(await get(`${CUSTOMERS}/${t.customerId}/attendance-report`, cookie), 403)
      assertError(await get(INVOICES, cookie), 403, 'forbidden')
    }
    const desk = await member(t.id, 'onburo')
    await ok(
      await call('POST', CUSTOMERS, desk, {
        ...CUSTOMER,
        taxNumber: '0000000001',
        name: 'Ön büro',
      }),
      201,
    )
    const invoice = await ok(await issue(desk, t.customerId), 201)
    assertError(
      await call(
        'POST',
        `${INVOICES}/${String(invoice.id)}/cancel`,
        desk,
        { reason: 'Yanlış dönem' },
        ifMatch(invoice.version),
      ),
      403,
      'forbidden',
    )
  })

  test('DOM-YTK-040, DOM-YTK-012: finance kapalıysa 403; dil okulu dışında her rol 404', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(CUSTOMERS, closed.admin), 403, 'module_disabled')
    assertError(await issue(closed.admin, randomUUID()), 403, 'module_disabled')
    for (const type of INSTITUTION_TYPES.filter((item) => item !== 'language_school')) {
      const other = await institution({ type })
      assertError(await get(CUSTOMERS, other.admin), 404)
      assertError(await call('POST', CUSTOMERS, other.admin, CUSTOMER), 404)
      assertError(await get(INVOICES, other.admin), 404)
      assertError(await issue(other.admin, randomUUID()), 404)
    }
  })

  test('DOM-FIN-060, DOM-DIL-093: bağ aydınlatma ister, kursiyerin tek etkin bağı olur', async () => {
    const t = await institution()
    const customerId = String((await createCustomer(t)).id)
    const otherCustomer = String(
      (await createCustomer(t, { ...CUSTOMER, taxNumber: '0000000001' })).id,
    )
    const url = `${CUSTOMERS}/${customerId}/employees`
    assertError(await call('POST', url, t.admin, { studentId: 's3', startsOn: '2026-09-01' }), 400)
    assertError(await link(t, customerId, 'yok-boyle-kursiyer'), 404, 'not_found')
    const linked = await ok(await link(t, customerId, 's3'), 201)
    assert.equal(typeof linked.studentName, 'string')
    assertError(await link(t, otherCustomer, 's3'), 409, 'corporate_employee_linked')

    const endUrl = `${url}/${String(linked.id)}/end`
    assertError(
      await call('POST', endUrl, t.admin, { endsOn: '2026-08-31' }, ifMatch(linked.version)),
      422,
      'corporate_link_end_before_start',
    )
    const ended = await ok(
      await call('POST', endUrl, t.admin, { endsOn: '2026-10-10' }, ifMatch(linked.version)),
    )
    assert.equal(ended.endsOn, '2026-10-10')
    assertError(
      await call('POST', endUrl, t.admin, { endsOn: '2026-10-11' }, ifMatch(ended.version)),
      409,
      'corporate_link_ended',
    )
    assertError(await link(t, otherCustomer, 's3', '2026-10-10'), 422, 'corporate_link_overlaps')
    await ok(await link(t, otherCustomer, 's3', '2026-10-11'), 201)

    const list = await call('GET', `${url}?status=ended`, t.admin)
    assert.deepEqual(
      list.json().data.map((item: Json) => item.id),
      [linked.id],
    )
  })

  test('DOM-FIN-060: toplu fatura önizlemeyle aynı satırları keser, idempotent ve mükerrer değil', async () => {
    const t = await ready()
    const preview = await ok(await get(`${CUSTOMERS}/${t.customerId}/billable?${PERIOD}`, t.admin))
    assert.deepEqual(
      (preview.lines as Json[]).map((line) => line.invoiceId),
      ['test-inv-s3-1', 'test-inv-o-1'],
    )
    assert.equal(preview.totalCents, 2 * AMOUNT)
    assertError(
      await get(`${CUSTOMERS}/${t.customerId}/billable?from=2026-11-01&to=2026-10-01`, t.admin),
      422,
      'export_period_invalid',
    )

    assertError(await issue(t.admin, t.customerId, {}), 400, 'idempotency_key_required')
    const headers = key()
    const first = await issue(t.admin, t.customerId, headers)
    const invoice = await ok(first, 201)
    assert.equal(invoice.number, 'KF-2026-0001')
    assert.equal(invoice.totalCents, 2 * AMOUNT)
    assert.equal(invoice.customerName, CUSTOMER.name)
    assert.deepEqual(
      (invoice.lines as Json[]).map((line) => [line.invoiceId, line.status]),
      [
        ['test-inv-s3-1', 'open'],
        ['test-inv-o-1', 'open'],
      ],
    )
    const replay = await issue(t.admin, t.customerId, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())

    // Aynı taksit ikinci faturaya girmez.
    assertError(await issue(t.admin, t.customerId), 422, 'corporate_invoice_empty')
    const empty = await ok(await get(`${CUSTOMERS}/${t.customerId}/billable?${PERIOD}`, t.admin))
    assert.deepEqual(empty.lines, [])
    assert.equal((await rows(corporateInvoices, t.id)).length, 1)

    // Şirket kaydının düzeltmesi kesilmiş faturayı değiştirmez.
    await ok(
      await call(
        'PATCH',
        `${CUSTOMERS}/${t.customerId}`,
        t.admin,
        { name: 'Yeni Unvan' },
        ifMatch(1),
      ),
    )
    const detail = await ok(await get(`${INVOICES}/${String(invoice.id)}`, t.admin))
    assert.equal(detail.customerName, CUSTOMER.name)
  })

  test('DOM-FIN-060: satır durumu tahsilattan hesaplanır; döküm CSV denetime yazılır', async () => {
    const t = await ready()
    const invoice = await ok(await issue(t.admin, t.customerId), 201)
    await ok(
      await call(
        'POST',
        '/api/v1/payments',
        t.admin,
        { studentId: 's3', amountCents: AMOUNT / 2, method: 'Banka havalesi', reference: 'KF-001' },
        key(),
      ),
      201,
    )
    const url = `${INVOICES}/${String(invoice.id)}`
    const detail = await ok(await get(url, t.admin))
    assert.deepEqual(
      (detail.lines as Json[]).map((line) => line.status),
      ['partial', 'open'],
    )
    const file = await csv(url, t.admin)
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /text\/csv/)
    const lines = file.body.split('\r\n')
    assert.equal(lines.length, 4)
    assert.equal(lines[1]?.includes('"Kısmi ödendi"'), true)
    assert.equal(lines[3]?.includes('8000,00'), true)
    assert.deepEqual(await audits(t.id, 'finance.corporate_invoice_export'), [
      { entityId: String(invoice.id) },
    ])

    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(await csv(url, t.admin, later), 403, 'reauthentication_required')
    } finally {
      await later.close()
    }
  })

  test('DOM-FIN-060: iptal gerekçe ister, satırları serbest bırakır, numara boşta kalır', async () => {
    const t = await ready()
    const invoice = await ok(await issue(t.admin, t.customerId), 201)
    const url = `${INVOICES}/${String(invoice.id)}/cancel`
    assertError(
      await call('POST', url, t.admin, { reason: 'Yanlış dönem' }),
      400,
      'if_match_required',
    )
    assertError(await call('POST', url, t.admin, { reason: 'x' }, ifMatch(invoice.version)), 400)
    const cancelled = await ok(
      await call('POST', url, t.admin, { reason: 'Yanlış dönem' }, ifMatch(invoice.version)),
    )
    assert.equal(typeof cancelled.cancelledAt, 'string')
    assert.equal(cancelled.cancelReason, 'Yanlış dönem')
    assertError(
      await call('POST', url, t.admin, { reason: 'Yanlış dönem' }, ifMatch(cancelled.version)),
      409,
      'corporate_invoice_cancelled',
    )
    const active = await db
      .select()
      .from(corporateInvoiceLines)
      .where(eq(corporateInvoiceLines.institutionId, t.id))
    assert.equal(
      active.every((line) => line.archivedAt !== null),
      true,
    )
    const again = await ok(await issue(t.admin, t.customerId), 201)
    assert.equal(again.number, 'KF-2026-0002')
    const list = await call('GET', `${INVOICES}?status=cancelled`, t.admin)
    assert.deepEqual(
      list.json().data.map((item: Json) => item.id),
      [invoice.id],
    )
  })

  test('DOM-FIN-060: bağın dışında vadesi gelen taksit faturaya girmez', async () => {
    const t = await institution()
    const customerId = String((await createCustomer(t)).id)
    await ok(await link(t, customerId, 's3', '2026-10-16'), 201)
    const preview = await ok(
      await get(`${CUSTOMERS}/${customerId}/billable?from=2026-10-01&to=2026-11-30`, t.admin),
    )
    assert.deepEqual(
      (preview.lines as Json[]).map((line) => line.invoiceId),
      ['test-inv-s3-2'],
    )
  })

  test('DOM-FIN-060: etkin çalışanı olan şirket arşivlenmez; bağ bitince arşivlenir', async () => {
    const t = await institution()
    const customer = await createCustomer(t)
    const customerId = String(customer.id)
    const linked = await ok(await link(t, customerId, 's3'), 201)
    const url = `${CUSTOMERS}/${customerId}`
    assertError(
      await call('DELETE', url, t.admin, undefined, ifMatch(customer.version)),
      422,
      'corporate_customer_has_employees',
    )
    await ok(
      await call(
        'POST',
        `${url}/employees/${String(linked.id)}/end`,
        t.admin,
        { endsOn: '2026-10-05' },
        ifMatch(linked.version),
      ),
    )
    await ok(await call('DELETE', url, t.admin, undefined, ifMatch(customer.version)))
    assertError(await get(url, t.admin), 404)
    assert.equal((await get(CUSTOMERS, t.admin)).json().meta.total, 0)
  })

  test('DOM-DIL-093: katılım özeti yalnız etkin bağlı kursiyerin devamını ve kur sonucunu verir', async () => {
    const t = await ready()
    const teacher = await createMember(app, t.id, 'ogretmen')
    const course = await ok(
      await call(
        'POST',
        '/api/v1/courses',
        t.admin,
        {
          name: 'Genel İngilizce B1.1',
          level: 'B1',
          totalHours: 8,
          weeklyHours: 2,
          minLearners: 1,
          maxLearners: 12,
        },
        key(),
      ),
      201,
    )
    await ok(
      await call('POST', `/api/v1/courses/${String(course.id)}/activate`, t.admin, {}, ifMatch(1)),
    )
    const group = await ok(
      await call(
        'POST',
        '/api/v1/groups',
        t.admin,
        {
          courseId: course.id,
          name: 'B1 Akşam',
          ageBand: 'adult',
          teacherMembershipId: teacher.membershipId,
          delivery: 'in_person',
          room: 'A1',
          schedule: [
            { weekday: 1, startTime: '18:00' },
            { weekday: 3, startTime: '18:00' },
          ],
          startDate: '2026-10-12',
          capacity: 10,
        },
        key(),
      ),
      201,
    )
    const enrollmentId = randomUUID()
    const groupId = String(group.id)
    await db.insert(languageGroupMembers).values({
      institutionId: t.id,
      id: enrollmentId,
      groupId,
      studentId: 's3',
      status: 'active',
      joinedAt: FIXED_NOW,
    })
    await insertLessonHourAttendances(
      db,
      t.id,
      { id: enrollmentId, groupId, studentId: 's3' },
      [
        { lessonHourId: 'ders-1', status: 'present' },
        { lessonHourId: 'ders-2', status: 'late' },
        { lessonHourId: 'ders-3', status: 'absent', excused: true },
      ],
      { userId: teacher.id, at: FIXED_NOW },
    )
    // Bağı biten çalışan rapora girmez (K-49).
    const third = STUDENTS.find((item) => item.id !== 's3' && item.id !== OTHER)?.id ?? ''
    const endedCustomer = await link(t, t.customerId, third)
    const ended = await ok(endedCustomer, 201)
    await ok(
      await call(
        'POST',
        `${CUSTOMERS}/${t.customerId}/employees/${String(ended.id)}/end`,
        t.admin,
        { endsOn: '2026-10-05' },
        ifMatch(ended.version),
      ),
    )

    const url = `${CUSTOMERS}/${t.customerId}/attendance-report`
    const report = await ok(await get(url, t.admin))
    const employees = report.employees as Json[]
    assert.deepEqual(employees.map((item) => item.studentId).sort(), ['s3', OTHER].sort())
    const own = employees.find((item) => item.studentId === 's3')
    const [row] = (own?.enrollments ?? []) as Json[]
    assert.deepEqual(
      [row?.recordedHours, row?.attendedHours, row?.absentHours, row?.attendanceRatePermille],
      [3, 2, 1, 666],
    )
    assert.equal(row?.outcome, null)
    assert.equal(row?.courseName, 'Genel İngilizce B1.1')
    // İşverene özür, gerekçe ve puan gitmez.
    assert.equal(JSON.stringify(report).includes('excused'), false)
    assert.equal(JSON.stringify(report).includes('rationale'), false)
    assert.deepEqual(report.totals, {
      employeeCount: 2,
      enrollmentCount: 1,
      recordedHours: 3,
      attendedHours: 2,
      attendanceRatePermille: 666,
    })

    const file = await csv(url, t.admin)
    assert.equal(file.statusCode, 200, file.body)
    assert.equal(file.body.split('\r\n').length, 3)
    assert.equal(file.body.includes('"66,6"'), true)
    assert.deepEqual(await audits(t.id, 'finance.corporate_report_export'), [
      { entityId: t.customerId },
    ])
  })

  test('IST-002: başka kurumun şirketi, bağı ve faturası 404, listede yok, B değişmez', async () => {
    const a = await ready()
    const b = await ready()
    const bInvoice = await ok(await issue(b.admin, b.customerId), 201)
    const bLinks = (await get(`${CUSTOMERS}/${b.customerId}/employees`, b.admin)).json()
      .data as Json[]
    const bLink = bLinks[0] ?? {}
    const bCustomers = await rows(corporateCustomers, b.id)
    const bInvoices = await rows(corporateInvoices, b.id)
    const bCustomer = `${CUSTOMERS}/${b.customerId}`
    const bInvoiceUrl = `${INVOICES}/${String(bInvoice.id)}`

    assertError(await get(bCustomer, a.admin), 404)
    assertError(await call('PATCH', bCustomer, a.admin, { name: 'Ele geçirildi' }, ifMatch(1)), 404)
    assertError(await call('DELETE', bCustomer, a.admin, undefined, ifMatch(1)), 404)
    assertError(await get(`${bCustomer}/employees`, a.admin), 404)
    assertError(await link(a, b.customerId, 's3', '2027-01-01'), 404)
    assertError(
      await call(
        'POST',
        `${bCustomer}/employees/${String(bLink.id)}/end`,
        a.admin,
        { endsOn: '2026-10-10' },
        ifMatch(bLink.version),
      ),
      404,
    )
    assertError(await get(`${bCustomer}/billable?${PERIOD}`, a.admin), 404)
    assertError(await get(`${bCustomer}/attendance-report`, a.admin), 404)
    assertError(await get(bInvoiceUrl, a.admin), 404)
    assertError(
      await call('POST', `${bInvoiceUrl}/cancel`, a.admin, { reason: 'Başka kurum' }, ifMatch(1)),
      404,
    )
    assertError(await issue(a.admin, b.customerId), 404)
    // Gövdedeki `institutionId` etkisizdir: şema bilinmeyen alanı reddeder.
    const intruder = { ...CUSTOMER, taxNumber: '0000000001', institutionId: b.id }
    assertError(await call('POST', CUSTOMERS, a.admin, intruder), 400)
    assertError(
      await call(
        'POST',
        INVOICES,
        a.admin,
        {
          customerId: a.customerId,
          from: '2026-10-01',
          to: '2026-10-31',
          institutionId: b.id,
        },
        key(),
      ),
      400,
    )
    const list = (await get(CUSTOMERS, a.admin)).json().data as Json[]
    assert.deepEqual(
      list.map((item) => item.id),
      [a.customerId],
    )
    assert.deepEqual((await get(INVOICES, a.admin)).json().data, [])
    assert.deepEqual(await rows(corporateCustomers, b.id), bCustomers)
    assert.deepEqual(await rows(corporateInvoices, b.id), bInvoices)
  })
})
