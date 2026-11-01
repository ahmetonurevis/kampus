import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
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
})
