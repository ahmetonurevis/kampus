import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
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

/**
 * Sözleşme onay isteği ve onay tamamlandı bildirimleri (ON-044; IST-092; docs/domain/finans.md
 * DOM-FIN-010, DOM-FIN-052; docs/domain/iletisim-ve-veli.md DOM-ILT-023). İstek imza yetkilisi
 * işlenince, onay bildirimi ödeyici onayıyla aynı transaction'da yazılır; kitle sözleşmenin
 * ödeyicisidir. Her test kendi kurumunu kurar: öğrenci, veli, sözleşme ve iki taksit.
 */

type Json = ReturnType<typeof JSON.parse>
const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const SID = STUDENT?.id ?? ''
const FIRST_NAME = STUDENT?.name.split(' ')[0] ?? ''
const CONTRACT_ID = 'test-contract'
const NET = 10_000_000
const SIGNATORY = { name: 'Murat Kurucu', role: 'founder' }
const ACCEPT = { accepted: true }
const AMEND = {
  reason: 'Plan yeniden düzenlendi.',
  installmentCount: 3,
  firstDueDate: '2026-11-15',
}
const REQUESTED = 'contract_approval_requested'
const APPROVED = 'contract_approved'
const url = (id: string, verb: string) => `/api/v1/finance/contracts/${id}/${verb}`
const invoice = (id: string, installment: number) => ({
  id,
  studentId: SID,
  installment,
  amount: NET / 2,
  dueDate: `2026-1${String(installment)}-15T09:00:00.000Z`,
  paidAt: null,
  method: null,
  reminderAt: null,
  feeKind: 'tuition',
})

describe('sözleşme onayı bildirimleri', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const logs: string[] = []
  const key = () => `test-cn-${String(++serial).padStart(5, '0')}`

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
          data: { id: STUDENT.parentId, name: 'Test Ödeyici Veli', studentIds: [SID] },
        },
        {
          collection: 'contracts' as const,
          id: CONTRACT_ID,
          data: {
            id: CONTRACT_ID,
            studentId: SID,
            date: '2026-09-01T09:00:00.000Z',
            amount: NET,
            title: 'Özel okul eğitim sözleşmesi',
            invoiceIds: ['test-inv-1', 'test-inv-2'],
            academicYear: 2026,
            grossCents: NET,
            netCents: NET,
            discounts: [],
            extras: [],
            payer: 'guardian',
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
  const version = async (institutionId: string, id = CONTRACT_ID) => {
    const row = await findRecord(db, institutionId, 'contracts', id)
    assert.ok(row)
    return row.version
  }
  const post = (target: string, cookie: string, body: unknown, ifMatch: number, keyValue = key()) =>
    app.inject({
      method: 'POST',
      url: target,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'if-match': `"${String(ifMatch)}"`,
        'idempotency-key': keyValue,
      },
      payload: JSON.stringify(body),
    })
  async function sign(t: { id: string; cookie: string }, id = CONTRACT_ID) {
    const response = await post(url(id, 'signatory'), t.cookie, SIGNATORY, await version(t.id, id))
    assert.equal(response.statusCode, 200, response.body)
  }
  async function approve(t: { id: string; cookie: string }, id = CONTRACT_ID) {
    const response = await post(url(id, 'approve'), t.cookie, ACCEPT, await version(t.id, id))
    assert.equal(response.statusCode, 200, response.body)
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
  /** `notify`'ın denetim satırını düşürür: bildirim yazıldıktan sonra işlem geri alınır. */
  async function withFailingNotify(institutionId: string, action: () => Promise<void>) {
    await db.execute(sql`
      create function test_fail_contract_notice() returns trigger language plpgsql as $$
      begin raise exception 'test failure'; end $$`)
    await db.execute(
      sql.raw(`
      create trigger test_fail_contract_notice before insert on audit_log for each row
      when (new.action = 'notification.create' and new.institution_id = '${institutionId}')
      execute function test_fail_contract_notice()`),
    )
    try {
      await action()
    } finally {
      await db.execute(sql`drop trigger test_fail_contract_notice on audit_log`)
      await db.execute(sql`drop function test_fail_contract_notice()`)
    }
  }

  test('IST-092, DOM-FIN-010, DOM-ILT-023: imza yetkilisi işlenince ödeyici veliye onay isteği, onayda onay bildirimi gider; veri yalnız sözleşme kimliğidir', async () => {
    const a = await institution()
    const parent = await member(a.id, 'veli')
    const learner = await member(a.id, 'ogrenci')
    const from = logs.length

    await sign(a)
    assert.deepEqual(await seen(parent.cookie, REQUESTED), [
      {
        audience: 'parent',
        subject: { type: 'contracts', id: CONTRACT_ID },
        title: `${FIRST_NAME} için sözleşme onayınızı bekliyor.`,
      },
    ])
    assert.deepEqual(await seen(learner.cookie, REQUESTED), [])
    assert.deepEqual(await stored(a.id, APPROVED), [])
    const [row] = await stored(a.id, REQUESTED)
    assert.ok(row)
    assert.deepEqual(Object.keys(row).sort(), [
      'audience',
      'createdAt',
      'id',
      'kind',
      'studentId',
      'subject',
    ])
    assert.ok(!JSON.stringify(row).includes(SIGNATORY.name))

    await approve(a)
    assert.deepEqual(await seen(parent.cookie, APPROVED), [
      {
        audience: 'parent',
        subject: { type: 'contracts', id: CONTRACT_ID },
        title: `${FIRST_NAME} için sözleşme onaylandı.`,
      },
    ])
    assert.deepEqual(await seen(learner.cookie, APPROVED), [])
    const text = logs.slice(from).join('')
    // Tutar yalnız tam sayı olarak aranır; süre gibi alanlar aynı rakam dizisini rastlantıyla
    // içerebilir (#40).
    const amount = new RegExp(`(?<![\\d.])${String(NET)}(?![\\d.])`)
    assert.ok(!text.includes(SIGNATORY.name) && !amount.test(text))
  })

  test('IST-092: imza yetkilisi düzeltmesi ve aynı Idempotency-Key ikinci onay isteği yazmaz; ek protokol yeni sürüm olarak yeni istek alır', async () => {
    const a = await institution()
    const parent = await member(a.id, 'veli')
    const sharedKey = key()
    const first = await post(
      url(CONTRACT_ID, 'signatory'),
      a.cookie,
      SIGNATORY,
      await version(a.id),
      sharedKey,
    )
    assert.equal(first.statusCode, 200, first.body)
    const replay = await post(url(CONTRACT_ID, 'signatory'), a.cookie, SIGNATORY, 1, sharedKey)
    assert.equal(replay.statusCode, 200, replay.body)
    const corrected = await post(
      url(CONTRACT_ID, 'signatory'),
      a.cookie,
      { ...SIGNATORY, role: 'founder_representative' },
      await version(a.id),
    )
    assert.equal(corrected.statusCode, 200, corrected.body)
    assert.equal((await stored(a.id, REQUESTED)).length, 1)

    await approve(a)
    // Onaylanmış sözleşmeye ikinci onay reddedilir, ikinci onay bildirimi yazılmaz.
    const again = await post(url(CONTRACT_ID, 'approve'), a.cookie, ACCEPT, await version(a.id))
    assert.equal(again.statusCode, 409, again.body)
    assert.equal((await stored(a.id, APPROVED)).length, 1)

    const amended = await post(url(CONTRACT_ID, 'amendments'), a.cookie, AMEND, await version(a.id))
    assert.equal(amended.statusCode, 201, amended.body)
    const amendmentId = amended.json().data.entity.id as string
    assert.notEqual(amendmentId, CONTRACT_ID)
    // Taslak ek protokol imzasızdır: onaylanamadığı için henüz istek yok.
    assert.equal((await stored(a.id, REQUESTED)).length, 1)
    await sign(a, amendmentId)
    await approve(a, amendmentId)
    assert.deepEqual(
      (await seen(parent.cookie, REQUESTED)).map((item) => item.subject.id).sort(),
      [amendmentId, CONTRACT_ID].sort(),
    )
    assert.deepEqual(
      (await seen(parent.cookie, APPROVED)).map((item) => item.subject.id).sort(),
      [amendmentId, CONTRACT_ID].sort(),
    )
  })

  test('DOM-FIN-052: yetişkin kursiyer kendi ödeyicisiyse bildirim kendisine gider, veliye gitmez', async () => {
    const a = await institution({ type: 'language_school' }, { payer: 'student' })
    await db.transaction((tx) =>
      insertStudentIdentity(tx, a.id, {
        studentId: SID,
        academicYear: 2026,
        kind: 'foreign',
        number: 'TEST-KIMLIK-CN-1',
        birthDate: '2000-01-01',
        now: FIXED_NOW,
      }),
    )
    const parent = await member(a.id, 'veli')
    const learner = await member(a.id, 'ogrenci')
    await sign(a)
    await approve(a)
    assert.deepEqual(await seen(parent.cookie, REQUESTED), [])
    assert.deepEqual(await seen(parent.cookie, APPROVED), [])
    assert.deepEqual(
      (await seen(learner.cookie, REQUESTED)).map((item) => item.title),
      ['Sözleşmen onayını bekliyor.'],
    )
    assert.deepEqual(
      (await seen(learner.cookie, APPROVED)).map((item) => item.title),
      ['Sözleşmen onaylandı.'],
    )
  })

  test('DOM-KAY-012, DOM-FIN-052: kitleyi yaş değil ödeyici seçer; reşit kursiyerin veli ödeyicili sözleşmesi veliye gider', async () => {
    const a = await institution({ type: 'language_school' }, { payer: 'guardian' })
    await db.transaction((tx) =>
      insertStudentIdentity(tx, a.id, {
        studentId: SID,
        academicYear: 2026,
        kind: 'foreign',
        number: 'TEST-KIMLIK-CN-2',
        birthDate: '2000-01-01',
        now: FIXED_NOW,
      }),
    )
    const parent = await member(a.id, 'veli')
    const learner = await member(a.id, 'ogrenci')
    await sign(a)
    assert.equal((await seen(parent.cookie, REQUESTED)).length, 1)
    assert.deepEqual(await seen(learner.cookie, REQUESTED), [])
  })

  test('DOM-YTK-040: iletişim modülü kapalıyken imza ve onay sürer, bildirim yazılmaz; finans kapalıyken uç 403', async () => {
    const silent = await institution({ enabledModules: { communication: false } })
    await sign(silent)
    await approve(silent)
    assert.deepEqual(await stored(silent.id, REQUESTED), [])
    assert.deepEqual(await stored(silent.id, APPROVED), [])

    const closed = await institution({ enabledModules: { finance: false } })
    const response = await post(
      url(CONTRACT_ID, 'signatory'),
      closed.cookie,
      SIGNATORY,
      await version(closed.id),
    )
    assert.equal(response.statusCode, 403, response.body)
    assert.equal(response.json().code, 'module_disabled')
    assert.deepEqual(await stored(closed.id, REQUESTED), [])
  })

  test('DOM-YTK-001: başka kurumun yöneticisi imza ve onay işleyemez, iki kurumda da bildirim yazılmaz', async () => {
    const a = await institution()
    const b = await createInstitution(app)
    const cookieB = await signInAs(app, b.admin)
    const signature = await post(url(CONTRACT_ID, 'signatory'), cookieB, SIGNATORY, 1)
    assert.equal(signature.statusCode, 404, signature.body)
    await sign(a)
    const approval = await post(url(CONTRACT_ID, 'approve'), cookieB, ACCEPT, await version(a.id))
    assert.equal(approval.statusCode, 404, approval.body)
    assert.equal((await stored(a.id, REQUESTED)).length, 1)
    assert.deepEqual(await stored(a.id, APPROVED), [])
    assert.deepEqual(await stored(b.id, REQUESTED), [])
  })

  test('DOM-FIN-010: reddedilen onay bildirim yazmaz; bildirim yazımı düşerse imza da onay da geri alınır', async () => {
    const a = await institution()
    const unsigned = await post(url(CONTRACT_ID, 'approve'), a.cookie, ACCEPT, await version(a.id))
    assert.equal(unsigned.statusCode, 422, unsigned.body)
    assert.equal(unsigned.json().code, 'contract_signatory_required')
    assert.deepEqual(await stored(a.id, APPROVED), [])

    await withFailingNotify(a.id, async () => {
      const failed = await post(
        url(CONTRACT_ID, 'signatory'),
        a.cookie,
        SIGNATORY,
        await version(a.id),
      )
      assert.equal(failed.statusCode, 500, failed.body)
    })
    assert.deepEqual(await stored(a.id, REQUESTED), [])
    const row = await findRecord(db, a.id, 'contracts', CONTRACT_ID)
    assert.equal(row?.data.signatory, undefined)

    await sign(a)
    await withFailingNotify(a.id, async () => {
      const failed = await post(url(CONTRACT_ID, 'approve'), a.cookie, ACCEPT, await version(a.id))
      assert.equal(failed.statusCode, 500, failed.body)
    })
    assert.deepEqual(await stored(a.id, APPROVED), [])
    assert.equal((await findRecord(db, a.id, 'contracts', CONTRACT_ID))?.data.approval, undefined)
  })
})
