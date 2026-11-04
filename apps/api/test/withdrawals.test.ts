import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { idempotencyKeys } from '../src/db/schema/idempotency-keys.ts'
import { studentWithdrawals } from '../src/db/schema/withdrawals.ts'
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
 * Ayrılış ve iade uçları (ADR 0006 karar 10; DOM-FIN-040, -041; DOM-KAY-024; IST-110). Her test
 * kendi kurumunu kurar: bir öğrenci, sözleşme (net 100.000 ₺) ve iki taksit. FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const PARENT_NAME = 'Test Ödeyici Veli'
const NET = 10_000_000
const invoice = (id: string, installment: number) => ({
  id,
  studentId: STUDENT?.id,
  installment,
  amount: NET / 2,
  dueDate: '2026-09-15T09:00:00.000Z',
  paidAt: null,
  method: null,
  reminderAt: null,
  feeKind: 'tuition',
})
const QUOTE = {
  withdrawalDate: '2026-10-01',
  termStartDate: '2026-09-07',
  attendedUnits: 18,
  totalUnits: 180,
}
const WITHDRAW = { ...QUOTE, reason: 'relocation', targetSchool: 'Test Okulu' }
const IBAN = 'TR330006100519786457841326'
const REFUND = { paidDate: '2026-10-05', iban: IBAN, accountHolder: PARENT_NAME }

describe('ayrılış ve iade uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-wd-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    assert.ok(STUDENT)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(
    overrides: Partial<InstitutionOverrides> = {},
    contractExtra: Record<string, unknown> = {},
  ) {
    const created = await createInstitution(app, overrides)
    assert.ok(STUDENT)
    const rows = [
      {
        collection: 'classes' as const,
        id: 'c1',
        data: { ...SEED.classes.find((item) => item.id === 'c1') },
      },
      { collection: 'students' as const, id: STUDENT.id, data: { ...STUDENT } },
      {
        collection: 'parents' as const,
        id: STUDENT.parentId,
        data: { id: STUDENT.parentId, name: PARENT_NAME, studentIds: [STUDENT.id] },
      },
      {
        collection: 'contracts' as const,
        id: 'test-contract',
        data: {
          id: 'test-contract',
          studentId: STUDENT.id,
          date: '2026-01-01T09:00:00.000Z',
          amount: NET,
          netCents: NET,
          title: 'Sözleşme',
          invoiceIds: ['test-inv-1', 'test-inv-2'],
          payer: 'guardian',
          ...contractExtra,
        },
      },
      { collection: 'invoices' as const, id: 'test-inv-1', data: invoice('test-inv-1', 1) },
      { collection: 'invoices' as const, id: 'test-inv-2', data: invoice('test-inv-2', 2) },
    ]
    await insertMissingRecords(db, created.id, rows, FIXED_NOW)
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  const member = async (id: string, role: Role) =>
    signInAs(app, await createMember(app, id, role, []))
  function send(
    method: 'GET' | 'POST',
    url: string,
    cookie: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
    target: App = app,
  ) {
    return target.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }
  const studentUrl = () => `/api/v1/students/${STUDENT?.id ?? ''}`
  const quote = (cookie: string | null, body: unknown = QUOTE) =>
    send('POST', `${studentUrl()}/withdrawal-quote`, cookie, body)
  const withdraw = (cookie: string | null, body: unknown = WITHDRAW, headers = key()) =>
    send('POST', `${studentUrl()}/withdraw`, cookie, body, headers)
  const payRefund = (cookie: string | null, id: string, version: number, body: unknown = REFUND) =>
    send('POST', `/api/v1/withdrawals/${id}/pay-refund`, cookie, body, {
      'if-match': `"${String(version)}"`,
      ...key(),
    })
  const pay = (cookie: string, amountCents: number, reference: string) =>
    send(
      'POST',
      '/api/v1/payments',
      cookie,
      { studentId: STUDENT?.id, amountCents, method: 'Banka havalesi', reference },
      key(),
    )
  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  async function untouched(institutionId: string) {
    assert.equal(
      (await findRecord(db, institutionId, 'students', STUDENT?.id ?? ''))?.data.isActive,
      true,
    )
    assert.equal((await loadRecords(db, institutionId, ['invoices'])).length, 2)
    const rows = await db
      .select()
      .from(studentWithdrawals)
      .where(eq(studentWithdrawals.institutionId, institutionId))
    assert.equal(rows.length, 0)
  }

  test('DOM-FIN-052: oturumsuz 401; önizleme yönetici ve ön büro, onay yalnız yönetici; modül kapalı 403', async () => {
    assertError(await quote(null), 401)
    assertError(await withdraw(null), 401)
    assertError(await send('GET', '/api/v1/withdrawals', null), 401)
    assertError(await payRefund(null, '00000000-0000-4000-8000-000000000000', 1), 401)
    const a = await institution()
    const desk = await member(a.id, 'onburo')
    assert.equal((await quote(desk)).statusCode, 200)
    assertError(await withdraw(desk), 403, 'forbidden')
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
      const cookie = await member(a.id, role)
      assertError(await quote(cookie), 403, 'forbidden')
      assertError(await withdraw(cookie), 403, 'forbidden')
      assertError(await send('GET', '/api/v1/withdrawals', cookie), 403, 'forbidden')
    }
    await untouched(a.id)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await quote(closed.cookie), 403, 'module_disabled')
    assertError(await withdraw(closed.cookie), 403, 'module_disabled')
    await untouched(closed.id)
  })

  test('guvenlik-kvkk: eski oturumla ayrılış ve iade ödemesi 403 reauthentication_required', async () => {
    const a = await institution()
    const later = await buildTestApp(db, {
      clock: () => new Date(Date.now() + 16 * 60 * 1000),
    })
    try {
      assertError(
        await send('POST', `${studentUrl()}/withdraw`, a.cookie, WITHDRAW, key(), later),
        403,
        'reauthentication_required',
      )
      assertError(
        await send(
          'POST',
          '/api/v1/withdrawals/00000000-0000-4000-8000-000000000000/pay-refund',
          a.cookie,
          REFUND,
          { 'if-match': '"1"', ...key() },
          later,
        ),
        403,
        'reauthentication_required',
      )
      assert.equal(
        (await send('POST', `${studentUrl()}/withdrawal-quote`, a.cookie, QUOTE, {}, later))
          .statusCode,
        200,
      )
    } finally {
      await later.close()
    }
    await untouched(a.id)
  })

  test('DOM-FIN-025: bursluya ödediğinden fazlası çıkmaz; bursu olmayanda borç kalır', async () => {
    const plain = await institution()
    const normal = (await quote(plain.cookie)).json().data.breakdown
    assert.equal(normal.scholarshipExempt, false)
    assert.ok(normal.debtCents > 0)

    const a = await institution(
      {},
      { scholarship: { programId: 'test-program', amountCents: 100_000 } },
    )
    const read = await quote(a.cookie)
    assert.equal(read.statusCode, 200, read.body)
    const { breakdown } = read.json().data
    assert.equal(breakdown.scholarshipExempt, true)
    assert.equal(breakdown.entitledCents, 0)
    assert.equal(breakdown.debtCents, 0)
  })

  test('DOM-FIN-040: önizleme hesabı döndürür, hiçbir kayıt yazmaz', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, NET / 2, 'TR-Q1')).statusCode, 201)
    const response = await quote(a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    const { breakdown, contractId } = response.json().data
    assert.equal(contractId, 'test-contract')
    assert.equal(breakdown.baseCents, NET)
    assert.equal(breakdown.deductionCents, 1_000_000)
    assert.equal(breakdown.usageCents, 1_000_000)
    assert.equal(breakdown.entitledCents, 2_000_000)
    assert.equal(breakdown.paidCents, 5_000_000)
    assert.equal(breakdown.refundCents, 3_000_000)
    assert.equal((await findRecord(db, a.id, 'students', STUDENT?.id ?? ''))?.data.isActive, true)
    assertError(
      await quote(a.cookie, { ...QUOTE, attendedUnits: 181 }),
      422,
      'attended_exceeds_total',
    )
    assertError(await quote(a.cookie, { ...QUOTE, x: 1 }), 400, 'validation_failed')
  })

  test('DOM-FIN-041, DOM-KAY-024: ayrılış tek işlemde yazılır; 201, Location, döküm, denetim kaydı', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, NET / 2, 'TR-W1')).statusCode, 201)
    const response = await withdraw(a.cookie)
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data
    assert.equal(response.headers.location, `/api/v1/withdrawals/${String(data.id)}`)
    assert.equal(data.refundCents, 3_000_000)
    assert.equal(data.debtCents, 0)
    assert.equal(data.refundDueDate, '2026-11-01')
    assert.equal(data.refundStatus, 'pending')
    assert.equal(data.breakdown.deductionBasisPoints, 1_000)
    assert.equal((await findRecord(db, a.id, 'students', STUDENT?.id ?? ''))?.data.isActive, false)
    const open = await loadRecords(db, a.id, ['invoices'])
    assert.deepEqual(
      open.map((row) => row.id),
      ['test-inv-1'],
    )
    assertError(await withdraw(a.cookie), 409, 'student_already_withdrawn')

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'student.withdraw')))
    assert.equal(audits.length, 1)
    assert.equal(JSON.stringify(audits[0]).includes('3000000'), false)
    assert.equal(JSON.stringify(audits[0]).includes('Test Okulu'), false)
  })

  test('DOM-FIN-040: ödenen azsa iade sıfır, kalan borç tek taksit olur', async () => {
    const a = await institution()
    const response = await withdraw(a.cookie)
    assert.equal(response.statusCode, 201, response.body)
    assert.equal(response.json().data.refundCents, 0)
    assert.equal(response.json().data.debtCents, 2_000_000)
    assert.equal(response.json().data.refundStatus, 'none')
    const rows = await loadRecords(db, a.id, ['invoices'])
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.data.amount, 2_000_000)
    assert.equal(rows[0]?.data.paidAt, null)
    const contract = await findRecord(db, a.id, 'contracts', 'test-contract')
    assert.deepEqual(contract?.data.invoiceIds, [rows[0]?.id])
    assertError(
      await payRefund(a.cookie, response.json().data.id, response.json().data.version),
      409,
      'refund_not_due',
    )
  })

  test('DOM-FIN-031: aynı Idempotency-Key ikinci ayrılış yazmaz, ilk yanıtı döner', async () => {
    const a = await institution()
    const headers = key()
    const first = await withdraw(a.cookie, WITHDRAW, headers)
    assert.equal(first.statusCode, 201, first.body)
    const second = await withdraw(a.cookie, WITHDRAW, headers)
    assert.equal(second.statusCode, 201, second.body)
    assert.deepEqual(second.json(), first.json())
    assert.equal(second.headers['idempotent-replayed'], 'true')
  })

  test('DOM-FIN-041: iade ödemesi yazılır, IBAN maskeli döner, ikinci ödeme ve yanlış ödeyici reddedilir', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, NET / 2, 'TR-R1')).statusCode, 201)
    const { id, version } = (await withdraw(a.cookie)).json().data
    assertError(await payRefund(a.cookie, id, version + 1), 409, 'version_conflict')
    assertError(
      await payRefund(a.cookie, id, version, { ...REFUND, accountHolder: 'Başka Kişi' }),
      422,
      'refund_holder_mismatch',
    )
    assertError(
      await payRefund(a.cookie, id, version, { ...REFUND, iban: 'TR1' }),
      400,
      'validation_failed',
    )
    const missing = await send(
      'POST',
      `/api/v1/withdrawals/${String(id)}/pay-refund`,
      a.cookie,
      REFUND,
      key(),
    )
    assertError(missing, 400, 'if_match_required')

    const paid = await payRefund(a.cookie, id, version)
    assert.equal(paid.statusCode, 200, paid.body)
    assert.equal(paid.json().data.refundStatus, 'paid')
    assert.equal(paid.json().data.refundPaidDate, REFUND.paidDate)
    assert.equal(paid.json().data.maskedIban, 'TR** **** 1326')
    assert.equal(paid.body.includes(IBAN), false)
    assertError(await payRefund(a.cookie, id, paid.json().data.version), 409, 'refund_already_paid')
    const detail = await send('GET', `/api/v1/withdrawals/${String(id)}`, a.cookie)
    assert.equal(detail.body.includes(IBAN), false)
    assert.equal(detail.json().data.refundCents, 3_000_000)
  })

  test('DOM-FIN-040: liste sayfalıdır, iade durumuyla süzülür, bilinmeyen parametre 400', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, NET / 2, 'TR-L1')).statusCode, 201)
    assert.equal((await withdraw(a.cookie)).statusCode, 201)
    const desk = await member(a.id, 'onburo')
    const pending = await send('GET', '/api/v1/withdrawals?refundStatus=pending', desk)
    assert.equal(pending.statusCode, 200, pending.body)
    assert.equal(pending.json().meta.total, 1)
    assert.equal(pending.json().data[0].studentName, STUDENT?.name)
    for (const status of ['paid', 'none']) {
      const other = await send('GET', `/api/v1/withdrawals?refundStatus=${status}`, desk)
      assert.equal(other.json().meta.total, 0)
    }
    assertError(await send('GET', '/api/v1/withdrawals?x=1', desk), 400)
  })

  test('DOM-YTK-001: başka kurumun öğrencisi ve ayrılışı 404; öteki kurum değişmez', async () => {
    const a = await createInstitution(app, {})
    const aCookie = await signInAs(app, a.admin)
    const b = await institution()
    assert.equal((await pay(b.cookie, NET / 2, 'TR-X1')).statusCode, 201)
    assertError(await quote(aCookie), 404)
    assertError(await withdraw(aCookie), 404)
    assert.equal((await findRecord(db, b.id, 'students', STUDENT?.id ?? ''))?.data.isActive, true)
    const { id, version } = (await withdraw(b.cookie)).json().data
    assertError(await send('GET', `/api/v1/withdrawals/${String(id)}`, aCookie), 404)
    assertError(await payRefund(aCookie, id, version), 404)
    assert.equal((await send('GET', '/api/v1/withdrawals', aCookie)).json().meta.total, 0)
    const row = await send('GET', `/api/v1/withdrawals/${String(id)}`, b.cookie)
    assert.equal(row.json().data.refundStatus, 'pending')
  })

  test('DOM-FIN-041: ayrılıştan sonra tahsilat iptali 409; taksit ve iade değişmez', async () => {
    const a = await institution()
    const paid = await pay(a.cookie, NET / 2, 'TR-Z1')
    assert.equal(paid.statusCode, 201, paid.body)
    const { id, version } = paid.json().data
    const withdrawn = await withdraw(a.cookie)
    assert.equal(withdrawn.statusCode, 201, withdrawn.body)
    const before = await findRecord(db, a.id, 'invoices', 'test-inv-1')
    const reversal = await send(
      'POST',
      `/api/v1/payments/${String(id)}/reverse`,
      a.cookie,
      { reason: 'Yanlış öğrenciye girildi' },
      { 'if-match': `"${String(version)}"`, ...key() },
    )
    assertError(reversal, 409, 'payment_student_withdrawn')
    const after = await findRecord(db, a.id, 'invoices', 'test-inv-1')
    assert.deepEqual(after?.data, before?.data)
    const row = await send(
      'GET',
      `/api/v1/withdrawals/${String(withdrawn.json().data.id)}`,
      a.cookie,
    )
    assert.equal(row.json().data.refundCents, withdrawn.json().data.refundCents)
  })

  test('DOM-FIN-041, guvenlik-kvkk: iade idempotency kaydında IBAN ve hesap sahibi yok; tekrar aynı yanıtı verir', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, NET / 2, 'TR-K1')).statusCode, 201)
    const { id, version } = (await withdraw(a.cookie)).json().data
    const headers = { 'if-match': `"${String(version)}"`, ...key() }
    const url = `/api/v1/withdrawals/${String(id)}/pay-refund`
    const first = await send('POST', url, a.cookie, REFUND, headers)
    assert.equal(first.statusCode, 200, first.body)
    assert.equal(first.json().data.maskedIban, 'TR** **** 1326')
    assert.equal(first.json().data.refundAccountHolder, PARENT_NAME)

    const stored = await db
      .select({ body: idempotencyKeys.responseBody })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.institutionId, a.id),
          eq(idempotencyKeys.key, headers['idempotency-key']),
        ),
      )
    assert.equal(stored.length, 1)
    const text = JSON.stringify(stored[0]?.body)
    for (const secret of [IBAN, '1326', PARENT_NAME, 'maskedIban', 'refundAccountHolder'])
      assert.equal(text.includes(secret), false, secret)
    assert.equal(text.includes(String(id)), true)

    const replay = await send('POST', url, a.cookie, REFUND, headers)
    assert.equal(replay.statusCode, 200, replay.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())
  })

  test('DOM-FIN-041, DOM-FIN-033: ayrılıştan sonra kalan borca alınan tahsilat iptal edilir, ayrılış öncesi edilemez', async () => {
    const a = await institution()
    const early = await pay(a.cookie, 1_000_000, 'TR-D1')
    assert.equal(early.statusCode, 201, early.body)
    const withdrawn = await withdraw(a.cookie)
    assert.equal(withdrawn.statusCode, 201, withdrawn.body)
    assert.equal(withdrawn.json().data.debtCents, 1_000_000)
    const reverse = (payment: { id: string; version: number }) =>
      send(
        'POST',
        `/api/v1/payments/${payment.id}/reverse`,
        a.cookie,
        { reason: 'Yanlış tutar girildi' },
        { 'if-match': `"${String(payment.version)}"`, ...key() },
      )
    assertError(await reverse(early.json().data), 409, 'payment_student_withdrawn')

    const late = await pay(a.cookie, 1_000_000, 'TR-D2')
    assert.equal(late.statusCode, 201, late.body)
    const [debt] = await loadRecords(db, a.id, ['invoices'])
    assert.equal(debt?.data.amount, 1_000_000)
    assert.notEqual(debt?.data.paidAt, null)
    const reversed = await reverse(late.json().data)
    assert.equal(reversed.statusCode, 200, reversed.body)
    const reopened = await findRecord(db, a.id, 'invoices', debt?.id ?? '')
    assert.equal(reopened?.data.paidAt, null)
    const row = await send(
      'GET',
      `/api/v1/withdrawals/${String(withdrawn.json().data.id)}`,
      a.cookie,
    )
    assert.equal(row.json().data.debtCents, 1_000_000)
  })
})
