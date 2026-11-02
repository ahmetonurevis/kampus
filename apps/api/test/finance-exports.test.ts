import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
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

/** Muhasebe dışa aktarımı (IST-111). Her test kendi kurumunu kurar. FIXED_NOW 2026-10-06. */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const NET = 10_000_000
const invoice = (id: string, installment: number, dueDate: string) => ({
  id,
  studentId: STUDENT?.id,
  installment,
  amount: NET / 2,
  dueDate,
  paidAt: null,
  method: null,
  reminderAt: null,
  feeKind: 'tuition',
})
const PERIOD = 'from=2026-10-01&to=2026-10-31'

describe('muhasebe dışa aktarımı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-fx-${String(++serial).padStart(5, '0')}` })

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
        {
          collection: 'invoices',
          id: 'test-inv-1',
          data: invoice('test-inv-1', 1, '2026-10-15T09:00:00.000Z'),
        },
        {
          collection: 'invoices',
          id: 'test-inv-2',
          data: invoice('test-inv-2', 2, '2026-11-15T09:00:00.000Z'),
        },
      ],
      FIXED_NOW,
    )
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  const member = async (id: string, role: Role) =>
    signInAs(app, await createMember(app, id, role, []))
  const get = (cookie: string | null, url: string, target: App = app) =>
    target.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  const exportCsv = (cookie: string | null, kind: string, query = PERIOD) =>
    get(cookie, `/api/v1/finance/exports?kind=${kind}&${query}`)
  const summary = (cookie: string | null, query = PERIOD) =>
    get(cookie, `/api/v1/finance/summary?${query}`)
  const overview = (cookie: string | null, query = '', target: App = app) =>
    get(cookie, `/api/v1/finance/overview${query === '' ? '' : `?${query}`}`, target)
  const pay = (cookie: string, amountCents: number, reference: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', cookie, ...key() },
      payload: JSON.stringify({
        studentId: STUDENT?.id,
        amountCents,
        method: 'Banka havalesi',
        reference,
      }),
    })
  const reverse = (cookie: string, id: string, version: number) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/payments/${id}/reverse`,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        cookie,
        'if-match': `"${String(version)}"`,
        ...key(),
      },
      payload: JSON.stringify({ reason: 'Yanlış öğrenciye girildi' }),
    })
  function assertError(
    response: Awaited<ReturnType<typeof get>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  /** Dosyanın son sütunundaki tutarların kuruş toplamı. */
  const fileTotal = (body: string) =>
    body
      .replace('\uFEFF', '')
      .split('\r\n')
      .slice(1)
      .map((line) => line.split(';').at(-1) ?? '')
      .reduce((total, cell) => total + Math.round(Number(cell.replace(',', '.')) * 100), 0)

  test('guvenlik-kvkk: oturumsuz 401; dosya yalnız yönetici, özet yönetici ve ön büro; modül kapalı 403', async () => {
    assertError(await exportCsv(null, 'payments'), 401)
    assertError(await summary(null), 401)
    const a = await institution()
    const desk = await member(a.id, 'onburo')
    assert.equal((await summary(desk)).statusCode, 200)
    assertError(await exportCsv(desk, 'payments'), 403, 'forbidden')
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
      const cookie = await member(a.id, role)
      assertError(await summary(cookie), 403, 'forbidden')
      assertError(await exportCsv(cookie, 'payments'), 403, 'forbidden')
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await summary(closed.cookie), 403, 'module_disabled')
    assertError(await exportCsv(closed.cookie, 'payments'), 403, 'module_disabled')
  })

  test('guvenlik-kvkk: eski oturumla dosya 403 reauthentication_required; özet açık', async () => {
    const a = await institution()
    const later = await buildTestApp(db, {
      clock: () => new Date(Date.now() + 16 * 60 * 1000),
    })
    try {
      assertError(
        await get(a.cookie, `/api/v1/finance/exports?kind=payments&${PERIOD}`, later),
        403,
        'reauthentication_required',
      )
      assert.equal(
        (await get(a.cookie, `/api/v1/finance/summary?${PERIOD}`, later)).statusCode,
        200,
      )
    } finally {
      await later.close()
    }
  })

  test('IST-111: dosya toplamı dönem toplamına eşittir; biçim, BOM ve dosya adı doğru', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, 123_456, 'TR-E1')).statusCode, 201)
    assert.equal((await pay(a.cookie, 700_001, 'TR-E2')).statusCode, 201)
    const totals = (await summary(a.cookie)).json().data
    assert.equal(totals.payments.count, 2)
    assert.equal(totals.payments.totalCents, 123_456 + 700_001)

    const file = await exportCsv(a.cookie, 'payments')
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /^text\/csv/)
    assert.equal(
      file.headers['content-disposition'],
      'attachment; filename="payments-2026-10-01-2026-10-31.csv"',
    )
    assert.equal(file.body.startsWith('\uFEFF"Tarih";"Hareket"'), true)
    assert.equal(file.body.includes('TR-E1'), true)
    assert.equal(file.body.includes(STUDENT?.name ?? 'yok'), true)
    assert.equal(fileTotal(file.body), totals.payments.totalCents)

    const invoices = await exportCsv(a.cookie, 'invoices')
    assert.equal(invoices.statusCode, 200, invoices.body)
    // Dönemde yalnız ilk taksit var: tutar sondan ikinci sütun.
    assert.equal(totals.invoices.count, 1)
    assert.equal(totals.invoices.totalCents, NET / 2)
    assert.equal(invoices.body.includes('"Kısmi"') || invoices.body.includes('"Ödendi"'), true)
  })

  test('DOM-FIN-033: iptal eksi satırdır, toplam düşer', async () => {
    const a = await institution()
    const created = await pay(a.cookie, 5_000, 'TR-R1')
    const { id, version } = created.json().data
    assert.equal((await reverse(a.cookie, id, version)).statusCode, 200)
    const totals = (await summary(a.cookie)).json().data
    assert.equal(totals.payments.count, 2)
    assert.equal(totals.payments.totalCents, 0)
    const file = await exportCsv(a.cookie, 'payments')
    assert.equal(file.body.includes('"Tahsilat iptali"'), true)
    assert.equal(file.body.includes(';-50,00'), true)
    assert.equal(fileTotal(file.body), 0)
  })

  test('DOM-YTK-053: her aktarım denetime düşer, dönem ve tür taşır, tutar taşımaz; özet düşmez', async () => {
    const a = await institution()
    await pay(a.cookie, 5_000, 'TR-A1')
    await summary(a.cookie)
    assert.equal((await exportCsv(a.cookie, 'refunds')).statusCode, 200)
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'finance.export')))
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.entityId, 'refunds:2026-10-01:2026-10-31')
    assert.equal(JSON.stringify(rows[0]).includes('TR-A1'), false)
  })

  test('IST-111: geçersiz dönem ve tür reddedilir; bilinmeyen parametre 400', async () => {
    const a = await institution()
    assertError(
      await summary(a.cookie, 'from=2026-11-01&to=2026-10-01'),
      422,
      'export_period_invalid',
    )
    assertError(
      await summary(a.cookie, 'from=2025-01-01&to=2026-10-01'),
      422,
      'export_period_too_long',
    )
    assertError(await summary(a.cookie, 'from=2026-02-30&to=2026-03-01'), 400, 'validation_failed')
    assertError(await summary(a.cookie, `${PERIOD}&x=1`), 400)
    assertError(await exportCsv(a.cookie, 'serbest'), 400, 'validation_failed')
    assertError(await get(a.cookie, `/api/v1/finance/exports?${PERIOD}`), 400, 'validation_failed')
  })

  test('DOM-YTK-001: başka kurumun satırı dosyada ve toplamda yok', async () => {
    const a = await institution()
    const b = await institution()
    assert.equal((await pay(b.cookie, 5_000, 'TR-B1')).statusCode, 201)
    const empty = await exportCsv(a.cookie, 'payments')
    assert.equal(empty.statusCode, 200)
    assert.equal(empty.body.includes('TR-B1'), false)
    assert.equal(fileTotal(empty.body), 0)
    assert.equal((await summary(a.cookie)).json().data.payments.totalCents, 0)
    const own = (await summary(b.cookie)).json().data
    assert.equal(own.payments.totalCents, 5_000)
  })

  test('guvenlik-kvkk: dosya kullanıcı başına dakikada 10 istekle sınırlıdır', async () => {
    const a = await institution()
    for (let index = 0; index < 10; index += 1)
      assert.equal((await exportCsv(a.cookie, 'refunds')).statusCode, 200)
    assertError(await exportCsv(a.cookie, 'refunds'), 429, 'rate_limited')
    const other = await member(a.id, 'yonetici')
    assert.equal((await exportCsv(other, 'refunds')).statusCode, 200)
  })

  test('guvenlik-kvkk: çerez başlığı değiştirilerek hız sınırı aşılamaz', async () => {
    const a = await institution()
    for (let index = 0; index < 10; index += 1)
      assert.equal((await exportCsv(a.cookie, 'refunds')).statusCode, 200)
    assertError(await exportCsv(`${a.cookie}; x=1`, 'refunds'), 429, 'rate_limited')
  })

  test('DOM-FIN-030: kurum geneli toplamlar kısmi ödemeyi sayar; iptal düşer', async () => {
    assertError(await get(null, '/api/v1/finance/totals'), 401)
    const a = await institution()
    const url = '/api/v1/finance/totals'
    const desk = await member(a.id, 'onburo')
    assert.equal((await get(desk, url)).statusCode, 200)
    assertError(await get(await member(a.id, 'veli'), url), 403, 'forbidden')

    const created = await pay(a.cookie, 1_250, 'TR-T1')
    assert.equal(created.statusCode, 201, created.body)
    const partial = (await get(a.cookie, url)).json().data
    assert.equal(partial.totalCents, NET)
    assert.equal(partial.paidCents, 1_250)
    assert.equal(partial.remainingCents, NET - 1_250)
    const { id, version } = created.json().data
    assert.equal((await reverse(a.cookie, id, version)).statusCode, 200)
    assert.equal((await get(a.cookie, url)).json().data.paidCents, 0)

    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(closed.cookie, url), 403, 'module_disabled')
  })

  test('DOM-FIN-030: taksit okuması ödenen kısmi tutarı taşır; iptalde düşer', async () => {
    const a = await institution()
    const url = '/api/v1/collections/invoices/test-inv-1'
    assert.equal((await get(a.cookie, url)).json().data.record.paidCents, undefined)
    const created = await pay(a.cookie, 1_250, 'TR-K1')
    assert.equal((await get(a.cookie, url)).json().data.record.paidCents, 1_250)
    const list = (await get(a.cookie, '/api/v1/collections/invoices?pageSize=10')).json().data
    const row = list.find((item: { id: string }) => item.id === 'test-inv-1')
    assert.equal(row.record.paidCents, 1_250)
    const { id, version } = created.json().data
    await reverse(a.cookie, id, version)
    assert.equal((await get(a.cookie, url)).json().data.record.paidCents, undefined)
  })

  // --- Finans özeti (IST-116, IST-121) ---------------------------------------------------------

  test('IST-116: özet oturumsuz 401; yönetici ve ön büro okur, diğer roller 403; modül kapalı 403', async () => {
    assertError(await overview(null), 401)
    const a = await institution()
    assert.equal((await overview(a.cookie)).statusCode, 200)
    assert.equal((await overview(await member(a.id, 'onburo'))).statusCode, 200)
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const)
      assertError(await overview(await member(a.id, role)), 403, 'forbidden')
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await overview(closed.cookie), 403, 'module_disabled')
  })

  test('IST-116: dönem verilmezse son altı ay; tek uç 400, ters dönem ve bir yılı aşan dönem 422', async () => {
    const a = await institution()
    const defaulted = await overview(a.cookie)
    assert.equal(defaulted.statusCode, 200, defaulted.body)
    const data = defaulted.json().data
    assert.equal(data.from, '2026-05-01')
    assert.equal(data.to, '2026-10-06')
    assert.equal(data.months.length, 6)
    assertError(await overview(a.cookie, 'from=2026-01-01'), 400)
    assertError(await overview(a.cookie, 'to=2026-01-01'), 400)
    assertError(await overview(a.cookie, 'bilinmeyen=1'), 400)
    assertError(
      await overview(a.cookie, 'from=2026-10-31&to=2026-10-01'),
      422,
      'export_period_invalid',
    )
    assertError(
      await overview(a.cookie, 'from=2025-01-01&to=2026-10-01'),
      422,
      'export_period_too_long',
    )
  })

  test('IST-116, IST-121, DOM-FIN-033: kısmi ödeme ve iptal özete yansır; açık ve gecikmiş tutar finans toplamlarıyla aynıdır', async () => {
    const a = await institution()
    const paid = await pay(a.cookie, 1_000_000, 'TR-OZET-1')
    assert.equal(paid.statusCode, 201, paid.body)
    const query = 'from=2026-10-01&to=2026-12-31'
    const first = (await overview(a.cookie, query)).json().data
    assert.equal(first.collectedCents, 1_000_000)
    assert.equal(first.openCents, NET - 1_000_000)
    // FIXED_NOW 6 Ekim: vadesi gelmiş taksit yok.
    assert.equal(first.overdueCents, 0)
    assert.deepEqual(first.overdueStudents, [])
    assert.deepEqual(
      first.months.map((month: { month: string; dueCents: number }) => [
        month.month,
        month.dueCents,
      ]),
      [
        ['2026-10', NET / 2],
        ['2026-11', NET / 2],
        ['2026-12', 0],
      ],
    )
    // 1 Aralık: iki taksit de vadesini geçti; kısmi ödemenin kalanı gecikmiş sayılır.
    const later = await buildTestApp(db, { clock: () => new Date('2026-12-01T09:00:00.000Z') })
    try {
      const data = (await overview(a.cookie, query, later)).json().data
      assert.equal(data.overdueCents, NET - 1_000_000)
      assert.deepEqual(data.overdueStudents, [
        {
          studentId: STUDENT?.id,
          overdueCents: NET - 1_000_000,
          oldestDueDate: '2026-10-15',
        },
      ])
      const totals = (await get(a.cookie, '/api/v1/finance/totals', later)).json().data
      assert.equal(data.openCents, totals.remainingCents)
      assert.equal(data.overdueCents, totals.overdueCents)
    } finally {
      await later.close()
    }
    // İptal tahsilatı düşürür, açık tutarı geri getirir; özet muhasebe toplamıyla aynı kalır.
    const reversed = await reverse(a.cookie, paid.json().data.id, 1)
    assert.equal(reversed.statusCode, 200, reversed.body)
    const after_ = (await overview(a.cookie, query)).json().data
    assert.equal(after_.collectedCents, 0)
    assert.equal(after_.openCents, NET)
    assert.equal(
      (await summary(a.cookie, query)).json().data.payments.totalCents,
      after_.collectedCents,
    )
  })

  // --- Öğrenci bakiyesi (DOM-FIN-052) ----------------------------------------------------------

  const balance = (cookie: string | null, studentId: string, target: App = app) =>
    get(cookie, `/api/v1/finance/students/${studentId}/balance`, target)
  const linked = async (id: string, role: Role, kind: 'child' | 'student', recordId: string) =>
    signInAs(app, await createMember(app, id, role, [{ kind, recordId }]))
  /** Kurumda başka bir öğrenci ve taksiti: velinin ve öğrencinin kapsamı dışında. */
  async function otherStudent(id: string) {
    const other = SEED.students.find((item) => item.classId === 'c1' && item.id !== STUDENT?.id)
    assert.ok(other)
    await insertMissingRecords(
      db,
      id,
      [{ collection: 'students', id: other.id, data: { ...other } }],
      FIXED_NOW,
    )
    return other.id
  }

  test('DOM-FIN-052: bakiye kısmi ödemeyi sayar; yönetici, ön büro, bağlı veli ve öğrencinin kendisi okur', async () => {
    const a = await institution()
    const studentId = String(STUDENT?.id)
    assert.equal((await pay(a.cookie, 1_000_000, 'TR-BAKIYE-1')).statusCode, 201)
    const expected = {
      studentId,
      totalCents: NET,
      paidCents: 1_000_000,
      openCents: NET - 1_000_000,
      overdueCents: 0,
      overdueCount: 0,
      nextDue: { date: '2026-10-15', amountCents: NET / 2 - 1_000_000 },
    }
    for (const cookie of [
      a.cookie,
      await member(a.id, 'onburo'),
      await linked(a.id, 'veli', 'child', studentId),
      await linked(a.id, 'ogrenci', 'student', studentId),
    ]) {
      const read = await balance(cookie, studentId)
      assert.equal(read.statusCode, 200, read.body)
      assert.deepEqual(read.json().data, expected)
    }
    // 1 Aralık: iki taksit de gecikti; kurum toplamıyla aynı kural.
    const later = await buildTestApp(db, { clock: () => new Date('2026-12-01T09:00:00.000Z') })
    try {
      const late = (await balance(a.cookie, studentId, later)).json().data
      assert.equal(late.overdueCents, NET - 1_000_000)
      assert.equal(late.overdueCount, 2)
      assert.equal(late.nextDue, null)
      const totals = (await get(a.cookie, '/api/v1/finance/totals', later)).json().data
      assert.equal(late.openCents, totals.remainingCents)
      assert.equal(late.overdueCents, totals.overdueCents)
    } finally {
      await later.close()
    }
  })

  test('DOM-FIN-052: oturumsuz 401, öğretmen 403, modül kapalı 403; başka çocuk ve olmayan öğrenci 404', async () => {
    const a = await institution()
    const studentId = String(STUDENT?.id)
    const other = await otherStudent(a.id)
    assertError(await balance(null, studentId), 401)
    assertError(await balance(await member(a.id, 'ogretmen'), studentId), 403, 'forbidden')
    const parent = await linked(a.id, 'veli', 'child', studentId)
    assertError(await balance(parent, other), 404, 'not_found')
    const pupil = await linked(a.id, 'ogrenci', 'student', studentId)
    assertError(await balance(pupil, other), 404, 'not_found')
    assertError(await balance(a.cookie, 'ogrenci-yok'), 404, 'not_found')
    // Taksiti olmayan öğrenci yöneticiye sıfır bakiye döner.
    const empty = await balance(a.cookie, other)
    assert.equal(empty.statusCode, 200, empty.body)
    assert.equal(empty.json().data.totalCents, 0)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await balance(closed.cookie, studentId), 403, 'module_disabled')
  })

  test('DOM-ILT-070, DOM-ILT-074: iletişim kısıtlı ya da velayeti olmayan veli çocuğun bakiyesini göremez', async () => {
    const a = await institution()
    const studentId = String(STUDENT?.id)
    const parent = await linked(a.id, 'veli', 'child', studentId)
    assert.equal((await balance(parent, studentId)).statusCode, 200)
    for (const bond of [
      { custody: 'none', contactRestricted: true },
      { custody: 'none', contactRestricted: false },
    ] as const) {
      await db
        .update(studentGuardians)
        .set(bond)
        .where(
          and(eq(studentGuardians.institutionId, a.id), eq(studentGuardians.studentId, studentId)),
        )
      assertError(await balance(parent, studentId), 404, 'not_found')
    }
  })
})
