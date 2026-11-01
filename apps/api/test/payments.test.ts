import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { findRecord, insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { paymentAllocations, payments } from '../src/db/schema/payments.ts'
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
 * Tahsilat uçları (ADR 0006; docs/domain/finans.md DOM-FIN-030…033, DOM-FIN-052). Her test kendi
 * kurumunu kurar: 7-A, s1 öğrencisi ve üç açık taksit. FIXED_NOW 2026-10-06 09:00Z.
 */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const OTHER = SEED.students.filter((item) => item.classId === 'c1')[1]
const INVOICES = [1, 2, 3].map((installment) => ({
  id: `test-inv-${String(installment)}`,
  studentId: STUDENT?.id,
  installment,
  amount: 10_000,
  dueDate: `2026-1${String(installment - 1)}-15T09:00:00.000Z`,
  paidAt: null,
  method: null,
  reminderAt: null,
}))
const BANK = { method: 'Banka havalesi', reference: 'TR-0001' }

describe('tahsilat uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-pay-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    assert.ok(STUDENT)
    assert.ok(OTHER)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    const row = (collection: 'classes' | 'students' | 'invoices', data: { id: string }) => ({
      collection,
      id: data.id,
      data: { ...data },
    })
    await insertMissingRecords(
      db,
      created.id,
      [
        ...SEED.classes.filter((item) => item.id === 'c1').map((item) => row('classes', item)),
        ...[STUDENT, OTHER].flatMap((item) => (item ? [row('students', item)] : [])),
        ...INVOICES.map((item) => row('invoices', item)),
      ],
      FIXED_NOW,
    )
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role, recordId = STUDENT?.id ?? '') {
    const links =
      role === 'ogrenci'
        ? [{ kind: 'student' as const, recordId }]
        : role === 'veli'
          ? [{ kind: 'child' as const, recordId }]
          : role === 'ogretmen'
            ? [{ kind: 'teacher' as const, recordId: 't1' }]
            : []
    const user = await createMember(app, institutionId, role, links)
    return signInAs(app, user)
  }
  function send(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
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
  const record = (cookie: string | null, body: unknown, headers: Record<string, string> = key()) =>
    send('POST', '/api/v1/payments', cookie, body, headers)
  const payment = (amountCents: number, extra: Record<string, unknown> = {}) => ({
    studentId: STUDENT?.id,
    amountCents,
    ...BANK,
    ...extra,
  })
  const ifMatch = (version: number) => ({ 'if-match': `"${String(version)}"` })
  const reverse = (cookie: string | null, id: string, version: number, body: unknown = REASON) =>
    send('POST', `/api/v1/payments/${id}/reverse`, cookie, body, { ...ifMatch(version), ...key() })
  const REASON = { reason: 'Yanlış öğrenciye girildi' }

  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const invoice = async (institutionId: string, id: string) =>
    (await findRecord(db, institutionId, 'invoices', id))?.data
  const paymentRows = (institutionId: string) =>
    db.select().from(payments).where(eq(payments.institutionId, institutionId))
  const allocationRows = (institutionId: string) =>
    db.select().from(paymentAllocations).where(eq(paymentAllocations.institutionId, institutionId))
  async function nothingWritten(institutionId: string) {
    assert.equal((await paymentRows(institutionId)).length, 0)
    assert.equal((await allocationRows(institutionId)).length, 0)
    for (const item of INVOICES) assert.equal((await invoice(institutionId, item.id))?.paidAt, null)
  }

  // --- Kimlik, rol, modül ----------------------------------------------------------------------

  const ACCOUNT = {
    bankName: 'Örnek Bankası',
    iban: 'TR33 0006 1005 1978 6457 8413 26',
    accountHolder: 'Akademi Özel Okulları',
  }
  const addAccount = (cookie: string | null, body: unknown = ACCOUNT) =>
    send('POST', '/api/v1/bank-accounts', cookie, body, key())

  test('DOM-FIN-032: banka hesabı yönetici ekler ve arşivler; kurum dışına ve role kapalı', async () => {
    const a = await institution()
    const b = await institution()
    assertError(await addAccount(null), 401)
    assertError(await addAccount(await member(a.id, 'onburo')), 403)
    assertError(await addAccount(a.adminCookie, { ...ACCOUNT, iban: 'TR00' }), 400)
    const created = await addAccount(a.adminCookie, { ...ACCOUNT, institutionId: b.id })
    assertError(created, 400)
    const added = await addAccount(a.adminCookie)
    assert.equal(added.statusCode, 201, added.body)
    const account = added.json().data
    assert.equal(account.iban, 'TR330006100519786457841326')
    assertError(await addAccount(a.adminCookie), 409, 'bank_account_exists')

    const seenByOther = await send('GET', '/api/v1/bank-accounts', b.adminCookie)
    assert.deepEqual(seenByOther.json().data, [])
    const url = `/api/v1/bank-accounts/${String(account.id)}`
    const remove = (cookie: string, version: number) =>
      send('DELETE', url, cookie, undefined, { ...ifMatch(version), ...key() })
    assertError(await remove(b.adminCookie, account.version), 404)
    assertError(await remove(a.adminCookie, account.version + 5), 409, 'version_conflict')
    assert.equal((await remove(a.adminCookie, account.version)).statusCode, 200)
    const listed = await send('GET', '/api/v1/bank-accounts', a.adminCookie)
    assert.deepEqual(listed.json().data, [])
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'bank_account.archive')))
    assert.equal(audits.length, 1)
  })

  test('DOM-FIN-032: hesap tanımlıysa tahsilat hesaba bağlanır; arşivli hesap seçilemez, geçmişte görünür', async () => {
    const a = await institution()
    const b = await institution()
    const foreign = (await addAccount(b.adminCookie)).json().data
    const account = (await addAccount(a.adminCookie)).json().data
    assertError(await record(a.adminCookie, payment(1_000)), 422, 'bank_account_required')
    assertError(
      await record(a.adminCookie, payment(1_000, { bankAccountId: foreign.id })),
      422,
      'bank_account_invalid',
    )
    await nothingWritten(a.id)
    const paid = await record(a.adminCookie, payment(1_000, { bankAccountId: account.id }))
    assert.equal(paid.statusCode, 201, paid.body)
    assert.equal(paid.json().data.bankAccountLabel, 'Örnek Bankası · 1326')

    await send('DELETE', `/api/v1/bank-accounts/${String(account.id)}`, a.adminCookie, undefined, {
      ...ifMatch(account.version),
      ...key(),
    })
    assertError(
      await record(
        a.adminCookie,
        payment(1_000, { reference: 'TR-0002', bankAccountId: account.id }),
      ),
      422,
      'bank_account_invalid',
    )
    const read = await send('GET', `/api/v1/payments/${String(paid.json().data.id)}`, a.adminCookie)
    assert.equal(read.json().data.bankAccountLabel, 'Örnek Bankası · 1326')
  })

  test('DOM-FIN-032: MEBBİS işareti personelde; veli görmez, iptal edilende değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const paid = (await record(a.adminCookie, payment(1_000))).json().data
    const url = `/api/v1/payments/${String(paid.id)}/mebbis-record`
    const mark = (cookie: string | null, version: number, recorded = true) =>
      send('POST', url, cookie, { recorded }, { ...ifMatch(version), ...key() })

    assertError(await mark(null, paid.version), 401)
    assertError(await mark(await member(a.id, 'veli'), paid.version), 403)
    assertError(await mark(b.adminCookie, paid.version), 404)
    assertError(await mark(a.adminCookie, paid.version + 5), 409, 'version_conflict')
    const pending = await send('GET', '/api/v1/payments?mebbis=pending', a.adminCookie)
    assert.equal(pending.json().meta.total, 1)

    const marked = await mark(await member(a.id, 'onburo'), paid.version)
    assert.equal(marked.statusCode, 200, marked.body)
    assert.equal(marked.json().data.mebbisRecordedAt, FIXED_NOW.toISOString())
    const none = await send('GET', '/api/v1/payments?mebbis=pending', a.adminCookie)
    assert.equal(none.json().meta.total, 0)
    const parent = await send(
      'GET',
      `/api/v1/payments/${String(paid.id)}`,
      await member(a.id, 'veli'),
    )
    assert.equal(parent.json().data.mebbisRecordedAt, null)

    const cleared = await mark(a.adminCookie, marked.json().data.version, false)
    assert.equal(cleared.json().data.mebbisRecordedAt, null)
    const reversed = await reverse(a.adminCookie, paid.id, cleared.json().data.version)
    assert.equal(reversed.statusCode, 200, reversed.body)
    assertError(
      await mark(a.adminCookie, reversed.json().data.version),
      409,
      'payment_already_reversed',
    )
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'payment.mebbis')))
    assert.equal(audits.length, 2)
  })

  test('DOM-FIN-052: oturumsuz 401; öğretmen okuyamaz, veli ve öğrenci kaydedemez; ön büro iptal edemez', async () => {
    assertError(await record(null, payment(100)), 401)
    assertError(await send('GET', '/api/v1/payments', null), 401)
    assertError(await send('GET', '/api/v1/payment-settings', null), 401)
    const a = await institution()
    const teacher = await member(a.id, 'ogretmen')
    assertError(await send('GET', '/api/v1/payments', teacher), 403, 'forbidden')
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const)
      assertError(await record(await member(a.id, role), payment(100)), 403, 'forbidden')
    await nothingWritten(a.id)
    const created = await record(a.adminCookie, payment(100))
    assert.equal(created.statusCode, 201, created.body)
    const desk = await member(a.id, 'onburo')
    assertError(await reverse(desk, created.json().data.id, 1), 403, 'forbidden')
    assertError(
      await send(
        'PATCH',
        '/api/v1/payment-settings',
        desk,
        { cashPaymentsEnabled: true },
        {
          ...ifMatch(1),
          ...key(),
        },
      ),
      403,
      'forbidden',
    )
  })

  test('DOM-YTK-040: finance modülü kapalıyken tahsilat uçları 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { finance: false } })
    assertError(await record(a.adminCookie, payment(100)), 403, 'module_disabled')
    assertError(await send('GET', '/api/v1/payments', a.adminCookie), 403, 'module_disabled')
    assertError(
      await send('GET', '/api/v1/payment-settings', a.adminCookie),
      403,
      'module_disabled',
    )
    await nothingWritten(a.id)
  })

  // --- Kayıt ------------------------------------------------------------------------------------

  test('DOM-FIN-030, DOM-FIN-050: kısmi ödeme ayrı kayıttır; 201, Location, ardışık dekont, taksit açık kalır', async () => {
    const a = await institution()
    const cookie = await member(a.id, 'onburo')
    const first = await record(cookie, payment(4_000))
    assert.equal(first.statusCode, 201, first.body)
    const data = first.json().data
    assert.equal(first.headers.location, `/api/v1/payments/${String(data.id)}`)
    assert.equal(data.receiptYear, 2026)
    assert.equal(data.receiptNumber, 1)
    assert.equal(data.creditCents, 0)
    assert.deepEqual(data.allocations, [{ invoiceId: 'test-inv-1', amountCents: 4_000 }])
    assert.equal((await invoice(a.id, 'test-inv-1'))?.paidAt, null)

    const second = await record(cookie, payment(6_000, { reference: 'TR-0002' }))
    assert.equal(second.statusCode, 201, second.body)
    assert.equal(second.json().data.receiptNumber, 2)
    assert.ok((await invoice(a.id, 'test-inv-1'))?.paidAt)
    assert.equal((await invoice(a.id, 'test-inv-1'))?.method, 'Banka havalesi')
  })

  test('DOM-FIN-030: mahsup en eski vadeden başlar, fazlası iade alacağı olur', async () => {
    const a = await institution()
    const response = await record(a.adminCookie, payment(35_000))
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data
    assert.equal(data.creditCents, 5_000)
    assert.equal(data.allocations.length, 3)
    for (const item of INVOICES) assert.ok((await invoice(a.id, item.id))?.paidAt)
    assertError(
      await record(a.adminCookie, payment(100, { reference: 'TR-0002' })),
      409,
      'no_open_installments',
    )
  })

  test('DOM-FIN-031: aynı Idempotency-Key ikinci tahsilat açmaz, ilk yanıtı döner', async () => {
    const a = await institution()
    const headers = key()
    const first = await record(a.adminCookie, payment(1_000), headers)
    assert.equal(first.statusCode, 201, first.body)
    const second = await record(a.adminCookie, payment(1_000), headers)
    assert.equal(second.statusCode, 201, second.body)
    assert.deepEqual(second.json(), first.json())
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal((await paymentRows(a.id)).length, 1)
  })

  test('DOM-FIN-031: kullanılmış referans 409; referanssız banka tahsilatı 422; kayıt yazılmaz', async () => {
    const a = await institution()
    assertError(
      await record(a.adminCookie, {
        studentId: STUDENT?.id,
        amountCents: 100,
        method: BANK.method,
      }),
      422,
      'payment_reference_required',
    )
    await nothingWritten(a.id)
    assert.equal((await record(a.adminCookie, payment(100))).statusCode, 201)
    assertError(await record(a.adminCookie, payment(200)), 409, 'payment_reference_used')
    assert.equal((await paymentRows(a.id)).length, 1)
  })

  test('kimlik, başlık ve gövde doğrulanır; gövdedeki institutionId reddedilir', async () => {
    const a = await institution()
    assertError(await record(a.adminCookie, payment(100), {}), 400, 'idempotency_key_required')
    assertError(
      await record(a.adminCookie, payment(100), { ...key(), ...ifMatch(1) }),
      400,
      'if_match_not_supported',
    )
    for (const body of [
      payment(0),
      payment(10.5),
      payment(100, { institutionId: a.id }),
      payment(100, { method: 'Çek' }),
    ])
      assertError(await record(a.adminCookie, body), 400, 'validation_failed')
    assertError(
      await record(a.adminCookie, payment(100, { paidDate: '2026-10-07' })),
      422,
      'payment_date_in_future',
    )
    assertError(await record(a.adminCookie, payment(100, { studentId: 'yok' })), 404)
    await nothingWritten(a.id)
  })

  test('DOM-FIN-053: denetim kaydı alan adlarını taşır, tutar ve referans taşımaz', async () => {
    const a = await institution()
    const response = await record(a.adminCookie, payment(10_000))
    assert.equal(response.statusCode, 201, response.body)
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'payment.record')))
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.entityId, response.json().data.id)
    assert.equal(JSON.stringify(rows[0]).includes(BANK.reference), false)
    assert.equal(JSON.stringify(rows[0]).includes('10000'), false)
  })

  // --- Nakit ayarı ------------------------------------------------------------------------------

  test('DOM-FIN-032: nakit varsayılan kapalı; yönetici açınca kabul edilir, kapatınca reddedilir', async () => {
    const a = await institution()
    const cash = { studentId: STUDENT?.id, amountCents: 100, method: 'Nakit' }
    assertError(await record(a.adminCookie, cash), 422, 'cash_payment_disabled')
    const read = await send('GET', '/api/v1/payment-settings', a.adminCookie)
    assert.equal(read.statusCode, 200, read.body)
    assert.equal(read.json().data.cashPaymentsEnabled, false)
    const version = read.json().data.version as number

    const change = (enabled: boolean, expected: number) =>
      send(
        'PATCH',
        '/api/v1/payment-settings',
        a.adminCookie,
        { cashPaymentsEnabled: enabled },
        {
          ...ifMatch(expected),
          ...key(),
        },
      )
    assertError(await change(true, version + 5), 409, 'version_conflict')
    const opened = await change(true, version)
    assert.equal(opened.statusCode, 200, opened.body)
    assert.equal(opened.json().data.cashPaymentsEnabled, true)
    const paid = await record(a.adminCookie, cash)
    assert.equal(paid.statusCode, 201, paid.body)
    assert.equal(paid.json().data.reference, null)

    const closed = await change(false, opened.json().data.version)
    assert.equal(closed.statusCode, 200, closed.body)
    assertError(await record(a.adminCookie, cash), 422, 'cash_payment_disabled')
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'payment.settings')))
    assert.equal(audits.length, 2)
  })

  // --- İptal ------------------------------------------------------------------------------------

  test('DOM-FIN-033: iptal gerekçeyle yazılır, taksit açılır, referans yeniden kullanılır; ikinci iptal 409', async () => {
    const a = await institution()
    const created = await record(a.adminCookie, payment(10_000))
    const { id, version } = created.json().data
    assert.ok((await invoice(a.id, 'test-inv-1'))?.paidAt)

    assertError(await reverse(a.adminCookie, id, version + 1), 409, 'version_conflict')
    assertError(await reverse(a.adminCookie, id, version, { reason: 'kısa' }), 400)
    const missingIfMatch = await send(
      'POST',
      `/api/v1/payments/${String(id)}/reverse`,
      a.adminCookie,
      REASON,
      key(),
    )
    assertError(missingIfMatch, 400, 'if_match_required')

    const reversed = await reverse(a.adminCookie, id, version)
    assert.equal(reversed.statusCode, 200, reversed.body)
    assert.ok(reversed.json().data.reversedAt)
    assert.equal(reversed.json().data.reversalReason, REASON.reason)
    assert.equal((await invoice(a.id, 'test-inv-1'))?.paidAt, null)
    assert.equal((await paymentRows(a.id)).length, 1)

    const again = await reverse(a.adminCookie, id, reversed.json().data.version)
    assertError(again, 409, 'payment_already_reversed')

    // İptal edilen tutar yeni tahsilatta açık sayılır; doğru kayıt aynı referansla girilir.
    const corrected = await record(a.adminCookie, payment(10_000))
    assert.equal(corrected.statusCode, 201, corrected.body)
    assert.deepEqual(corrected.json().data.allocations, [
      { invoiceId: 'test-inv-1', amountCents: 10_000 },
    ])
    assert.equal(corrected.json().data.receiptNumber, 2)
  })

  // --- Okuma ve kapsam --------------------------------------------------------------------------

  test('DOM-FIN-052: veli ve öğrenci yalnız kapsamındaki tahsilatı görür, iptal gerekçesi gizlidir', async () => {
    const a = await institution()
    const created = await record(a.adminCookie, payment(10_000))
    const { id, version } = created.json().data
    await reverse(a.adminCookie, id, version)

    for (const role of ['veli', 'ogrenci'] as const) {
      const own = await member(a.id, role)
      const list = await send('GET', '/api/v1/payments', own)
      assert.equal(list.statusCode, 200, list.body)
      assert.equal(list.json().meta.total, 1)
      assert.equal(list.json().data[0].reversalReason, null)
      const detail = await send('GET', `/api/v1/payments/${String(id)}`, own)
      assert.equal(detail.statusCode, 200, detail.body)
      assert.equal(detail.json().data.reversalReason, null)

      const foreign = await member(a.id, role, OTHER?.id)
      const empty = await send('GET', '/api/v1/payments', foreign)
      assert.equal(empty.json().meta.total, 0)
      assertError(await send('GET', `/api/v1/payments/${String(id)}`, foreign), 404)
    }
    const staff = await send('GET', `/api/v1/payments/${String(id)}`, a.adminCookie)
    assert.equal(staff.json().data.reversalReason, REASON.reason)
  })

  test('liste sayfalıdır, studentId süzer, bilinmeyen parametre 400', async () => {
    const a = await institution()
    for (const [index, amount] of [1_000, 2_000, 3_000].entries())
      await record(a.adminCookie, payment(amount, { reference: `TR-L${String(index)}` }))
    const page = await send('GET', '/api/v1/payments?page=2&pageSize=2', a.adminCookie)
    assert.equal(page.statusCode, 200, page.body)
    assert.equal(page.json().meta.total, 3)
    assert.equal(page.json().data.length, 1)
    const none = await send('GET', `/api/v1/payments?studentId=${OTHER?.id ?? ''}`, a.adminCookie)
    assert.equal(none.json().meta.total, 0)
    assertError(await send('GET', '/api/v1/payments?x=1', a.adminCookie), 400)
  })

  test('DOM-YTK-001: başka kurumun öğrencisi ve tahsilatı 404; öteki kurum değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const created = await record(b.adminCookie, payment(10_000))
    const { id, version } = created.json().data
    assertError(await send('GET', `/api/v1/payments/${String(id)}`, a.adminCookie), 404)
    assertError(await reverse(a.adminCookie, id, version), 404)
    assert.equal((await send('GET', '/api/v1/payments', a.adminCookie)).json().meta.total, 0)
    assert.equal((await paymentRows(b.id))[0]?.reversedAt, null)
    assert.ok((await invoice(b.id, 'test-inv-1'))?.paidAt)
  })

  test('liste öğrenci adı döner; q ad ve referansta Türkçe duyarsız arar, başka kurum eşleşmez', async () => {
    const a = await institution()
    const created = await record(a.adminCookie, payment(1_000, { reference: 'TR-ARAMA-1' }))
    assert.equal(created.statusCode, 201, created.body)
    const name = STUDENT?.name ?? ''
    const list = await send('GET', '/api/v1/payments', a.adminCookie)
    assert.equal(list.json().data[0].studentName, name)
    const detail = await send(
      'GET',
      `/api/v1/payments/${String(created.json().data.id)}`,
      a.adminCookie,
    )
    assert.equal(detail.json().data.studentName, name)

    const total = async (q: string) =>
      (await send('GET', `/api/v1/payments?q=${encodeURIComponent(q)}`, a.adminCookie)).json().meta
        .total
    assert.equal(await total('tr-arama'), 1)
    assert.equal(await total(name.toLocaleUpperCase('tr').slice(0, 4)), 1)
    assert.equal(await total('olmayan-kayit'), 0)
    assertError(await send('GET', '/api/v1/payments?q=a', a.adminCookie), 400)

    const b = await institution()
    const other = await send('GET', '/api/v1/payments?q=tr-arama', b.adminCookie)
    assert.equal(other.json().meta.total, 0)
  })
})
