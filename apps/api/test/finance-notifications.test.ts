import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { payments } from '../src/db/schema/payments.ts'
import { studentWithdrawals } from '../src/db/schema/withdrawals.ts'
import { insertStudentIdentity } from '../src/db/student-identities.ts'
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
import { contractTerms, insertTestTariff } from './support/finance-terms.ts'

/**
 * Tahsilat alındı ve iade ödendi bildirimleri (ON-027; IST-106, IST-110; docs/domain/finans.md
 * DOM-FIN-030, DOM-FIN-041; docs/domain/iletisim-ve-veli.md DOM-ILT-023, DOM-ILT-074). Bildirim
 * işlemle aynı transaction'dadır; görünürlük bildirim listesi ucundan doğrulanır. Her test kendi
 * kurumunu kurar: öğrenci, sözleşme (net 100.000 ₺) ve iki taksit. FIXED_NOW 2026-10-06.
 */

type Json = ReturnType<typeof JSON.parse>
const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const SID = STUDENT?.id ?? ''
const FIRST_NAME = STUDENT?.name.split(' ')[0] ?? ''
const PARENT_NAME = 'Test Ödeyici Veli'
const NET = 10_000_000
const REFERENCE = 'TR-BILDIRIM-1'
const IBAN = 'TR330006100519786457841326'
const REFUND = { paidDate: '2026-10-05', iban: IBAN, accountHolder: PARENT_NAME }
const WITHDRAW = {
  withdrawalDate: '2026-10-01',
  termStartDate: '2026-09-07',
  attendedUnits: 18,
  totalUnits: 180,
  reason: 'relocation',
  targetSchool: 'Test Okulu',
}
const invoice = (id: string, installment: number) => ({
  id,
  studentId: SID,
  installment,
  amount: NET / 2,
  dueDate: '2026-09-15T09:00:00.000Z',
  paidAt: null,
  method: null,
  reminderAt: null,
  feeKind: 'tuition',
})

describe('tahsilat ve iade bildirimleri', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const logs: string[] = []
  const key = () => `test-fn-${String(++serial).padStart(5, '0')}`

  before(async () => {
    assert.ok(STUDENT)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { logs, clock: () => FIXED_NOW })
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
    await insertTestTariff(db, created.id)
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'classes' as const,
          id: 'c1',
          data: { ...SEED.classes.find((item) => item.id === 'c1') },
        },
        { collection: 'students' as const, id: SID, data: { ...STUDENT } },
        {
          collection: 'parents' as const,
          id: STUDENT.parentId,
          data: { id: STUDENT.parentId, name: PARENT_NAME, studentIds: [SID] },
        },
        {
          collection: 'contracts' as const,
          id: 'test-contract',
          data: {
            id: 'test-contract',
            studentId: SID,
            date: '2026-01-01T09:00:00.000Z',
            amount: NET,
            title: 'Sözleşme',
            invoiceIds: ['test-inv-1', 'test-inv-2'],
            ...contractTerms({ grossCents: NET, netCents: NET }),
            ...contractExtra,
          },
        },
        { collection: 'invoices' as const, id: 'test-inv-1', data: invoice('test-inv-1', 1) },
        { collection: 'invoices' as const, id: 'test-inv-2', data: invoice('test-inv-2', 2) },
      ],
      FIXED_NOW,
    )
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role) {
    const links =
      role === 'ogrenci'
        ? [{ kind: 'student' as const, recordId: SID }]
        : role === 'veli'
          ? [{ kind: 'child' as const, recordId: SID }]
          : []
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  function post(url: string, cookie: string, body: unknown, headers: Record<string, string> = {}) {
    return app.inject({
      method: 'POST',
      url,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        ...headers,
      },
      payload: JSON.stringify(body),
    })
  }
  const pay = (
    cookie: string,
    amountCents = NET / 2,
    reference = REFERENCE,
    idempotencyKey = key(),
  ) =>
    post(
      '/api/v1/payments',
      cookie,
      { studentId: SID, amountCents, method: 'Banka havalesi', reference },
      { 'idempotency-key': idempotencyKey },
    )
  const withdraw = (cookie: string) =>
    post(`/api/v1/students/${SID}/withdraw`, cookie, WITHDRAW, { 'idempotency-key': key() })
  const payRefund = (
    cookie: string,
    id: string,
    version: number,
    body: unknown = REFUND,
    idempotencyKey = key(),
  ) =>
    post(`/api/v1/withdrawals/${id}/pay-refund`, cookie, body, {
      'if-match': `"${String(version)}"`,
      'idempotency-key': idempotencyKey,
    })
  /** Ödenmiş ve ayrılmış öğrenci; iade ödenmeye hazır ayrılış. */
  async function withdrawn(cookie: string) {
    const paid = await pay(cookie)
    assert.equal(paid.statusCode, 201, paid.body)
    const response = await withdraw(cookie)
    assert.equal(response.statusCode, 201, response.body)
    const { id, version, refundCents } = response.json().data
    assert.ok(refundCents > 0)
    return { id: id as string, version: version as number }
  }
  async function seen(cookie: string, kind: string) {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { origin: TEST_ORIGIN, cookie },
    })
    assert.equal(response.statusCode, 200, response.body)
    return (response.json().data as Json[])
      .filter((item) => item.kind === kind)
      .map((item) => ({
        audience: item.audience as string,
        subject: item.subject as { type: string; id: string },
        title: item.title as string,
      }))
  }
  const stored = async (institutionId: string, kind: string) =>
    (await loadRecords(db, institutionId, ['notifications']))
      .map((row) => row.data)
      .filter((data) => data.kind === kind)
  async function setBond(adminCookie: string, membershipId: string, body: Record<string, unknown>) {
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/students/${SID}/guardians`,
      headers: { origin: TEST_ORIGIN, cookie: adminCookie },
    })
    assert.equal(list.statusCode, 200, list.body)
    const bond = (list.json().data as Json[]).find((item) => item.membershipId === membershipId)
    assert.ok(bond)
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/students/${SID}/guardians/${String(bond.id)}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie: adminCookie,
        'content-type': 'application/json',
        'if-match': `"${String(bond.rowVersion)}"`,
      },
      payload: JSON.stringify(body),
    })
    assert.equal(response.statusCode, 200, response.body)
  }
  /** `notify`'ın son yazımını (denetim satırı) düşürür: bildirim yazıldıktan sonra işlem geri alınır. */
  async function withFailingNotify(institutionId: string, action: () => Promise<void>) {
    await db.execute(sql`
      create function test_fail_notification_audit() returns trigger language plpgsql as $$
      begin raise exception 'test failure'; end $$`)
    await db.execute(
      sql.raw(`
      create trigger test_fail_notification_audit before insert on audit_log for each row
      when (new.action = 'notification.create' and new.institution_id = '${institutionId}')
      execute function test_fail_notification_audit()`),
    )
    try {
      await action()
    } finally {
      await db.execute(sql`drop trigger test_fail_notification_audit on audit_log`)
      await db.execute(sql`drop function test_fail_notification_audit()`)
    }
  }

  describe('tahsilat alındı (IST-106)', () => {
    test('IST-106, DOM-ILT-023: tahsilat kaydı veliye bildirim yazar; tutar, yöntem ve referans bildirimde ve logda yoktur', async () => {
      const a = await institution()
      const parent = await member(a.id, 'veli')
      const learner = await member(a.id, 'ogrenci')
      const teacher = await member(a.id, 'ogretmen')
      const from = logs.length

      const response = await pay(a.cookie)
      assert.equal(response.statusCode, 201, response.body)
      const { id } = response.json().data

      assert.deepEqual(await seen(parent.cookie, 'payment_received'), [
        {
          audience: 'parent',
          subject: { type: 'payments', id },
          title: `${FIRST_NAME} için ödeme alındı.`,
        },
      ])
      // 18 yaş altı öğrenciye ve personele gitmez.
      assert.deepEqual(await seen(learner.cookie, 'payment_received'), [])
      assert.deepEqual(await seen(teacher.cookie, 'payment_received'), [])
      assert.deepEqual(await seen(a.cookie, 'payment_received'), [])

      const [row] = await stored(a.id, 'payment_received')
      assert.ok(row)
      assert.deepEqual(Object.keys(row).sort(), [
        'audience',
        'createdAt',
        'id',
        'kind',
        'studentId',
        'subject',
      ])
      assert.ok(!JSON.stringify(row).includes(REFERENCE))
      assert.ok(!logs.slice(from).join('').includes(REFERENCE))

      const audits = await db
        .select({ actor: auditLog.actorUserId, entityId: auditLog.entityId })
        .from(auditLog)
        .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'notification.create')))
      assert.deepEqual(audits, [{ actor: a.admin.id, entityId: id }])
    })

    test('DOM-FIN-031: aynı Idempotency-Key ikinci bildirim yazmaz; ayrı tahsilat ayrı bildirimdir; iptal bildirim üretmez', async () => {
      const a = await institution()
      const parent = await member(a.id, 'veli')
      const sharedKey = key()
      const first = await pay(a.cookie, 1_000, 'TR-BILDIRIM-2', sharedKey)
      assert.equal(first.statusCode, 201, first.body)
      const replay = await pay(a.cookie, 1_000, 'TR-BILDIRIM-2', sharedKey)
      assert.equal(replay.json().data.id, first.json().data.id)
      assert.equal((await seen(parent.cookie, 'payment_received')).length, 1)

      const second = await pay(a.cookie, 2_000, 'TR-BILDIRIM-3')
      assert.equal(second.statusCode, 201, second.body)
      assert.equal((await seen(parent.cookie, 'payment_received')).length, 2)

      const { id, version } = second.json().data
      const reversed = await post(
        `/api/v1/payments/${String(id)}/reverse`,
        a.cookie,
        { reason: 'Yanlış öğrenciye girildi' },
        { 'if-match': `"${String(version)}"`, 'idempotency-key': key() },
      )
      assert.equal(reversed.statusCode, 200, reversed.body)
      assert.equal((await stored(a.id, 'payment_received')).length, 2)
    })

    test('DOM-YTK-040: iletişim modülü kapalıyken tahsilat yazılır, bildirim yazılmaz; finans kapalıyken ikisi de yok', async () => {
      const silent = await institution({ enabledModules: { communication: false } })
      const response = await pay(silent.cookie)
      assert.equal(response.statusCode, 201, response.body)
      assert.deepEqual(await stored(silent.id, 'payment_received'), [])

      const closed = await institution({ enabledModules: { finance: false } })
      const rejected = await pay(closed.cookie)
      assert.equal(rejected.statusCode, 403)
      assert.equal(rejected.json().code, 'module_disabled')
      assert.deepEqual(await stored(closed.id, 'payment_received'), [])
    })

    test('DOM-YTK-001: başka kurumun öğrencisine tahsilat yazılmaz, o kurumun velisine bildirim gitmez', async () => {
      const a = await institution()
      const b = await createInstitution(app)
      const cookieB = await signInAs(app, b.admin)
      const parentA = await member(a.id, 'veli')
      const rejected = await pay(cookieB)
      assert.notEqual(rejected.statusCode, 201)
      assert.deepEqual(await stored(a.id, 'payment_received'), [])
      assert.deepEqual(await stored(b.id, 'payment_received'), [])
      assert.deepEqual(await seen(parentA.cookie, 'payment_received'), [])
    })

    test('DOM-FIN-031: reddedilen tahsilat bildirim yazmaz; işlem geri alınırsa tahsilat da bildirim de kalmaz', async () => {
      const a = await institution()
      const invalid = await post(
        '/api/v1/payments',
        a.cookie,
        { studentId: SID, amountCents: -1, method: 'Banka havalesi', reference: 'TR-X' },
        { 'idempotency-key': key() },
      )
      assert.equal(invalid.statusCode, 400, invalid.body)
      const cash = await post(
        '/api/v1/payments',
        a.cookie,
        { studentId: SID, amountCents: 1_000, method: 'Nakit' },
        { 'idempotency-key': key() },
      )
      assert.equal(cash.statusCode, 422, cash.body)
      assert.deepEqual(await stored(a.id, 'payment_received'), [])

      await withFailingNotify(a.id, async () => {
        const failed = await pay(a.cookie)
        assert.equal(failed.statusCode, 500, failed.body)
      })
      assert.deepEqual(await stored(a.id, 'payment_received'), [])
      const rows = await db.select().from(payments).where(eq(payments.institutionId, a.id))
      assert.deepEqual(rows, [])
      const retried = await pay(a.cookie)
      assert.equal(retried.statusCode, 201, retried.body)
      assert.equal((await stored(a.id, 'payment_received')).length, 1)
    })

    test('DOM-ILT-074: iletişim kısıtlı veli tahsilat bildirimini görmez; ödeyici görür', async () => {
      const a = await institution()
      const payer = await member(a.id, 'veli')
      const restricted = await member(a.id, 'veli')
      await setBond(a.cookie, payer.membershipId, { isPayer: true })
      await setBond(a.cookie, restricted.membershipId, {
        custody: 'none',
        contactRestricted: true,
      })
      assert.equal((await pay(a.cookie)).statusCode, 201)
      assert.equal((await seen(payer.cookie, 'payment_received')).length, 1)
      assert.deepEqual(await seen(restricted.cookie, 'payment_received'), [])
    })

    test('DOM-FIN-052: yetişkin kursiyerin tahsilat bildirimi kendisine gider, veliye gitmez', async () => {
      const a = await institution({ type: 'language_school' })
      await insertMissingRecords(
        db,
        a.id,
        [{ collection: 'prospects', id: 'p-1', data: { id: 'p-1', studentId: SID, minor: false } }],
        FIXED_NOW,
      )
      const parent = await member(a.id, 'veli')
      const learner = await member(a.id, 'ogrenci')
      const response = await pay(a.cookie)
      assert.equal(response.statusCode, 201, response.body)
      assert.deepEqual(await seen(parent.cookie, 'payment_received'), [])
      assert.deepEqual(
        (await seen(learner.cookie, 'payment_received')).map((item) => item.title),
        ['Ödemen alındı.'],
      )
    })
  })

  describe('iade ödendi (IST-110)', () => {
    test('IST-110, DOM-ILT-023: iade ödemesi ayrılan öğrencinin velisine bildirim yazar; ayrılış yazmaz; tutar ve IBAN bildirimde ve logda yoktur', async () => {
      const a = await institution()
      const parent = await member(a.id, 'veli')
      const learner = await member(a.id, 'ogrenci')
      const { id, version } = await withdrawn(a.cookie)
      assert.deepEqual(await stored(a.id, 'refund_paid'), [])
      const from = logs.length

      const paid = await payRefund(a.cookie, id, version)
      assert.equal(paid.statusCode, 200, paid.body)

      assert.deepEqual(await seen(parent.cookie, 'refund_paid'), [
        {
          audience: 'parent',
          subject: { type: 'student_withdrawals', id },
          title: `${FIRST_NAME} için iade ödendi.`,
        },
      ])
      assert.deepEqual(await seen(learner.cookie, 'refund_paid'), [])
      const [row] = await stored(a.id, 'refund_paid')
      assert.ok(row)
      assert.deepEqual(Object.keys(row).sort(), [
        'audience',
        'createdAt',
        'id',
        'kind',
        'studentId',
        'subject',
      ])
      const text = JSON.stringify(row)
      assert.ok(!text.includes(IBAN) && !text.includes(PARENT_NAME))
      assert.ok(!logs.slice(from).join('').includes(IBAN))
    })

    test('DOM-FIN-041: ikinci iade ödemesi ve aynı Idempotency-Key ikinci bildirim yazmaz', async () => {
      const a = await institution()
      const { id, version } = await withdrawn(a.cookie)
      const sharedKey = key()
      const paid = await payRefund(a.cookie, id, version, REFUND, sharedKey)
      assert.equal(paid.statusCode, 200, paid.body)
      const replay = await payRefund(a.cookie, id, version, REFUND, sharedKey)
      assert.equal(replay.statusCode, 200, replay.body)
      const second = await payRefund(a.cookie, id, paid.json().data.version)
      assert.equal(second.statusCode, 409, second.body)
      assert.equal(second.json().code, 'refund_already_paid')
      assert.equal((await stored(a.id, 'refund_paid')).length, 1)
    })

    test('DOM-YTK-040: iletişim modülü kapalıyken iade ödenir, bildirim yazılmaz', async () => {
      const a = await institution({ enabledModules: { communication: false } })
      const { id, version } = await withdrawn(a.cookie)
      const paid = await payRefund(a.cookie, id, version)
      assert.equal(paid.statusCode, 200, paid.body)
      assert.deepEqual(await stored(a.id, 'refund_paid'), [])
    })

    test('DOM-YTK-001: başka kurumun yöneticisi iadeyi ödeyemez, bildirim yazılmaz', async () => {
      const a = await institution()
      const b = await createInstitution(app)
      const cookieB = await signInAs(app, b.admin)
      const { id, version } = await withdrawn(a.cookie)
      const foreign = await payRefund(cookieB, id, version)
      assert.equal(foreign.statusCode, 404, foreign.body)
      assert.deepEqual(await stored(a.id, 'refund_paid'), [])
      assert.deepEqual(await stored(b.id, 'refund_paid'), [])
    })

    test('DOM-FIN-041: reddedilen iade bildirim yazmaz; işlem geri alınırsa iade ödenmemiş kalır, bildirim yazılmaz', async () => {
      const a = await institution()
      const { id, version } = await withdrawn(a.cookie)
      const mismatch = await payRefund(a.cookie, id, version, {
        ...REFUND,
        accountHolder: 'Başka Kişi',
      })
      assert.equal(mismatch.statusCode, 422, mismatch.body)
      assert.deepEqual(await stored(a.id, 'refund_paid'), [])

      await withFailingNotify(a.id, async () => {
        const failed = await payRefund(a.cookie, id, version)
        assert.equal(failed.statusCode, 500, failed.body)
      })
      assert.deepEqual(await stored(a.id, 'refund_paid'), [])
      const [row] = await db
        .select({
          paidDate: studentWithdrawals.refundPaidDate,
          iban: studentWithdrawals.refundIban,
        })
        .from(studentWithdrawals)
        .where(eq(studentWithdrawals.id, id))
      assert.deepEqual(row, { paidDate: null, iban: null })

      const retried = await payRefund(a.cookie, id, version)
      assert.equal(retried.statusCode, 200, retried.body)
      assert.equal((await stored(a.id, 'refund_paid')).length, 1)
    })

    test('DOM-ILT-074: iletişim kısıtlı veli iade bildirimini görmez; ödeyici görür', async () => {
      const a = await institution()
      const payer = await member(a.id, 'veli')
      const restricted = await member(a.id, 'veli')
      await setBond(a.cookie, payer.membershipId, { isPayer: true })
      await setBond(a.cookie, restricted.membershipId, {
        custody: 'none',
        contactRestricted: true,
      })
      const { id, version } = await withdrawn(a.cookie)
      assert.equal((await payRefund(a.cookie, id, version)).statusCode, 200)
      assert.equal((await seen(payer.cookie, 'refund_paid')).length, 1)
      assert.deepEqual(await seen(restricted.cookie, 'refund_paid'), [])
    })

    test('DOM-FIN-052: ayrılmış yetişkin kursiyerin iade bildirimi kendisine gider; arşivlenen kimlik yaşı değiştirmez', async () => {
      const a = await institution({ type: 'language_school' }, { payer: 'student' })
      await db.transaction((tx) =>
        insertStudentIdentity(tx, a.id, {
          studentId: SID,
          academicYear: 2026,
          kind: 'foreign',
          number: 'TEST-KIMLIK-1',
          birthDate: '2000-01-01',
          now: FIXED_NOW,
        }),
      )
      const parent = await member(a.id, 'veli')
      const learner = await member(a.id, 'ogrenci')
      const { id, version } = await withdrawn(a.cookie)
      const paid = await payRefund(a.cookie, id, version, {
        ...REFUND,
        accountHolder: STUDENT?.name,
      })
      assert.equal(paid.statusCode, 200, paid.body)
      assert.deepEqual(await seen(parent.cookie, 'refund_paid'), [])
      assert.deepEqual(
        (await seen(learner.cookie, 'refund_paid')).map((item) => item.title),
        ['İaden ödendi.'],
      )
    })
  })
})
