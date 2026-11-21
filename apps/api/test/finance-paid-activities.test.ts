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
  paidActivities,
  paidActivityParticipants,
} from '../src/db/schema/finance-paid-activities.ts'
import { invoices } from '../src/db/schema/invoices.ts'
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
import {
  insertRefundBankAccount,
  insertTestTariff,
  TEST_REFUND_BANK_ACCOUNT_ID,
} from './support/finance-terms.ts'

/**
 * Gezi ve etkinlik ücreti uçları (DOM-FIN-098; ON-142; K-300…K-303). Her test kendi kurumunu kurar:
 * bir öğrenci ve velisi, ikinci bir öğrenci. FIXED_NOW 2026-10-06 (İstanbul günü de aynı).
 */

const SEED = createSeed(FIXED_NOW)
const [STUDENT, OTHER] = SEED.students.filter((item) => item.classId === 'c1')
const STUDENT_ID = STUDENT?.id ?? ''
const OTHER_ID = OTHER?.id ?? ''
const PARENT_NAME = 'Test Etkinlik Velisi'
const BASE = '/api/v1/finance/paid-activities'
const PARTICIPANTS = '/api/v1/finance/paid-activity-participants'
const IBAN = 'TR330006100519786457841326'
const TODAY = '2026-10-06'
const FEE = 150_000

/** Son iptal günü geçmemiş etkinlik (süresinde iptal). */
const EARLY = {
  name: 'Test Kapadokya gezisi',
  kind: 'trip',
  activityDate: '2026-10-20',
  feeCents: FEE,
  joinDeadline: '2026-10-15',
  cancelDeadline: '2026-10-10',
  capacity: 2,
  lateRefundRule: 'percent',
  lateRefundPercent: 50,
  lateCostCents: null,
}
/** Son iptal günü geçmiş etkinlik (geç iptal: ücretin %50'si iade). */
const LATE = {
  ...EARLY,
  name: 'Test tiyatro etkinliği',
  kind: 'event',
  cancelDeadline: '2026-10-05',
}

describe('gezi ve etkinlik ücreti uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const logs: string[] = []
  const key = () => ({ 'idempotency-key': `test-pa-${String(++serial).padStart(5, '0')}` })
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(STUDENT && OTHER)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW, logs })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function send(
    method: 'GET' | 'POST' | 'PATCH',
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
  const version = (value: number) => ({ 'if-match': `"${String(value)}"` })
  function assertError(response: Awaited<ReturnType<typeof send>>, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertTestTariff(db, created.id)
    await insertRefundBankAccount(db, created.id)
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'classes',
          id: 'c1',
          data: { ...SEED.classes.find((item) => item.id === 'c1') },
        },
        { collection: 'students', id: STUDENT_ID, data: { ...STUDENT } },
        { collection: 'students', id: OTHER_ID, data: { ...OTHER } },
        {
          collection: 'parents',
          id: STUDENT?.parentId ?? '',
          data: { id: STUDENT?.parentId, name: PARENT_NAME, studentIds: [STUDENT_ID] },
        },
      ],
      FIXED_NOW,
    )
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role, []))

  type Activity = { id: string; version: number; participantCount: number; status: string }
  type Participant = {
    id: string
    version: number
    invoiceId: string
    status: string
    paymentStatus: string
    collectedCents: number
    retainedCents: number | null
    refundCents: number
    refundStatus: string
    closedInvoiceId: string | null
    debtInvoiceId: string | null
  }
  const create = async (cookie: string, body: unknown = EARLY) => {
    const response = await send('POST', BASE, cookie, body)
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as Activity
  }
  const join = (cookie: string | null, activityId: string, studentId = STUDENT_ID) =>
    send('POST', `${BASE}/${activityId}/participants`, cookie, { studentId }, key())
  const joined = async (cookie: string, activityId: string, studentId = STUDENT_ID) => {
    const response = await join(cookie, activityId, studentId)
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as Participant
  }
  const cancelParticipant = (cookie: string | null, participant: { id: string; version: number }) =>
    send('POST', `${PARTICIPANTS}/${participant.id}/cancel`, cookie, undefined, {
      ...version(participant.version),
      ...key(),
    })
  const pay = async (cookie: string, invoiceId: string, amountCents: number) => {
    const response = await send(
      'POST',
      '/api/v1/payments',
      cookie,
      {
        studentId: STUDENT_ID,
        invoiceId,
        amountCents,
        method: 'Banka havalesi',
        reference: `TR-PA-${String(++serial)}`,
        bankAccountId: TEST_REFUND_BANK_ACCOUNT_ID,
      },
      key(),
    )
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as { id: string; version: number }
  }
  const invoiceRows = (institutionId: string) =>
    db
      .select({
        id: invoices.id,
        feeKind: invoices.feeKind,
        amountCents: invoices.amountCents,
        dueDate: invoices.dueDate,
        contractId: invoices.contractId,
        archivedAt: invoices.archivedAt,
      })
      .from(invoices)
      .where(eq(invoices.institutionId, institutionId))
  const rowsOf = async (institutionId: string) => ({
    activities: await db
      .select()
      .from(paidActivities)
      .where(eq(paidActivities.institutionId, institutionId)),
    participants: await db
      .select()
      .from(paidActivityParticipants)
      .where(eq(paidActivityParticipants.institutionId, institutionId)),
    invoices: await invoiceRows(institutionId),
  })

  test('DOM-FIN-098: oturumsuz 401, öğretmen 403, ön büro tanımlayamaz ve iade ödeyemez, modül kapalı 403', async () => {
    const t = await institution()
    const activity = await create(t.cookie)
    assertError(await send('GET', BASE, null), 401)
    assertError(await send('POST', BASE, null, EARLY), 401)
    assertError(await join(null, activity.id), 401)
    const teacher = await member(t.id, 'ogretmen')
    assertError(await send('GET', BASE, teacher), 403)
    assertError(await join(teacher, activity.id), 403)
    const front = await member(t.id, 'onburo')
    assert.equal((await send('GET', BASE, front)).statusCode, 200)
    assertError(await send('POST', BASE, front, EARLY), 403)
    assertError(
      await send(
        'POST',
        `${BASE}/${activity.id}/cancel`,
        front,
        { reason: 'Test iptali' },
        {
          ...version(activity.version),
          ...key(),
        },
      ),
      403,
    )
    // Ön büro katılım yazar ve iptal eder; iadeyi yönetici öder (K-300, K-303).
    const participant = await joined(front, activity.id)
    const cancelled = await cancelParticipant(front, participant)
    assert.equal(cancelled.statusCode, 200, cancelled.body)
    assertError(
      await send(
        'POST',
        `${PARTICIPANTS}/${participant.id}/pay-refund`,
        front,
        {
          paidDate: TODAY,
          iban: IBAN,
          accountHolder: PARENT_NAME,
          bankAccountId: TEST_REFUND_BANK_ACCOUNT_ID,
        },
        { ...version(2), ...key() },
      ),
      403,
    )
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await send('POST', BASE, closed.cookie, EARLY), 403, 'module_disabled')
    assertError(await send('GET', BASE, closed.cookie), 403, 'module_disabled')
  })

  test('DOM-FIN-098, K-300: tanım, liste, ayrıntı ve düzeltme; geçersiz gövde 400 ve 422, kayıt değişmez', async () => {
    const t = await institution()
    const before = await rowsOf(t.id)
    assertError(await send('POST', BASE, t.cookie, { ...EARLY, joinDeadline: '2026-10-21' }), 400)
    assertError(await send('POST', BASE, t.cookie, { ...EARLY, lateRefundPercent: null }), 400)
    assertError(
      await send('POST', BASE, t.cookie, {
        ...EARLY,
        activityDate: '2026-10-01',
        joinDeadline: '2026-10-01',
        cancelDeadline: '2026-10-01',
      }),
      422,
      'paid_activity_date_past',
    )
    assert.deepEqual(await rowsOf(t.id), before)

    const created = await send('POST', BASE, t.cookie, { ...EARLY, externalRef: 'gezi-plani-1' })
    assert.equal(created.statusCode, 201, created.body)
    const activity = created.json().data as Activity & { externalRef: string; feeCents: number }
    assert.equal(created.headers.location, `${BASE}/${activity.id}`)
    assert.equal(activity.externalRef, 'gezi-plani-1')
    assert.equal(activity.participantCount, 0)
    const list = await send('GET', `${BASE}?status=open`, t.cookie)
    assert.equal(list.json().meta.total, 1)
    assert.equal((await send('GET', `${BASE}/${activity.id}`, t.cookie)).json().data.feeCents, FEE)

    const patched = await send(
      'PATCH',
      `${BASE}/${activity.id}`,
      t.cookie,
      { capacity: 5, name: 'Test Kapadokya gezisi (2 gün)' },
      version(activity.version),
    )
    assert.equal(patched.statusCode, 200, patched.body)
    assert.equal(patched.json().data.capacity, 5)
    assertError(
      await send('PATCH', `${BASE}/${activity.id}`, t.cookie, { capacity: 6 }, version(1)),
      409,
    )
    assertError(
      await send('PATCH', `${BASE}/${activity.id}`, t.cookie, { feeCents: 1 }, version(2)),
      400,
    )
    const [audit] = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'paid_activity.update')))
    assert.deepEqual(audit?.changes, { fields: ['name', 'capacity'] })
  })

  test('DOM-FIN-098, K-301: katılım sözleşmesiz etkinlik taksiti açar; mükerrer ve kapalı katılım reddedilir', async () => {
    const t = await institution()
    const activity = await create(t.cookie, { ...EARLY, capacity: 1 })
    assertError(
      await send('POST', `${BASE}/${activity.id}/participants`, t.cookie, {
        studentId: STUDENT_ID,
      }),
      400,
      'idempotency_key_required',
    )
    const headers = key()
    const first = await send(
      'POST',
      `${BASE}/${activity.id}/participants`,
      t.cookie,
      { studentId: STUDENT_ID },
      headers,
    )
    assert.equal(first.statusCode, 201, first.body)
    const participant = first.json().data as Participant
    assert.equal(participant.paymentStatus, 'unpaid')
    // Aynı anahtarla tekrar ikinci taksit açmaz.
    const replay = await send(
      'POST',
      `${BASE}/${activity.id}/participants`,
      t.cookie,
      { studentId: STUDENT_ID },
      headers,
    )
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const rows = await invoiceRows(t.id)
    assert.equal(rows.length, 1)
    assert.deepEqual(
      { ...rows[0], archivedAt: undefined },
      {
        id: participant.invoiceId,
        feeKind: 'activity',
        amountCents: FEE,
        dueDate: '2026-10-15',
        contractId: null,
        archivedAt: undefined,
      },
    )
    // Veli ekranının okuduğu taksit listesi kalemi gösterir.
    const listed = await send('GET', '/api/v1/collections/invoices?pageSize=100', t.cookie)
    assert.equal(listed.statusCode, 200, listed.body)
    assert.ok(JSON.stringify(listed.json()).includes(participant.invoiceId))

    const before = await rowsOf(t.id)
    assertError(await join(t.cookie, activity.id), 409, 'paid_activity_participant_exists')
    assertError(
      await join(t.cookie, activity.id, 'test-yok'),
      422,
      'paid_activity_student_not_found',
    )
    const closedJoin = await create(t.cookie, {
      ...EARLY,
      joinDeadline: '2026-10-05',
      cancelDeadline: '2026-10-05',
    })
    assertError(await join(t.cookie, closedJoin.id), 422, 'paid_activity_join_closed')
    const after = await rowsOf(t.id)
    assert.deepEqual(after.participants, before.participants)
    assert.deepEqual(after.invoices, before.invoices)
  })

  test('DOM-FIN-098, K-302: süresinde iptalde ödenmemiş taksit kapanır; yeniden katılım açılır', async () => {
    const t = await institution()
    const activity = await create(t.cookie)
    const participant = await joined(t.cookie, activity.id)
    assertError(
      await send(
        'POST',
        `${PARTICIPANTS}/${participant.id}/cancel`,
        t.cookie,
        undefined,
        version(1),
      ),
      400,
      'idempotency_key_required',
    )
    const response = await cancelParticipant(t.cookie, participant)
    assert.equal(response.statusCode, 200, response.body)
    const cancelled = response.json().data as Participant
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.refundCents, 0)
    assert.equal(cancelled.refundStatus, 'none')
    assert.equal(cancelled.closedInvoiceId, participant.invoiceId)
    const [invoice] = await invoiceRows(t.id)
    assert.ok(invoice?.archivedAt)
    assertError(
      await cancelParticipant(t.cookie, cancelled),
      409,
      'paid_activity_participation_cancelled',
    )
    const again = await joined(t.cookie, activity.id)
    assert.notEqual(again.invoiceId, participant.invoiceId)
  })

  test('DOM-FIN-098, K-302, K-303: geç iptalde oran kadar iade; iade gün sonuna girer, tahsilat iptali 409', async () => {
    const t = await institution()
    const activity = await create(t.cookie, LATE)
    const participant = await joined(t.cookie, activity.id)
    const payment = await pay(t.cookie, participant.invoiceId, FEE)
    const listed = await send('GET', `${BASE}/${activity.id}/participants`, t.cookie)
    assert.equal(listed.json().data[0].paymentStatus, 'paid')
    const reread = listed.json().data[0] as Participant
    const response = await cancelParticipant(t.cookie, reread)
    assert.equal(response.statusCode, 200, response.body)
    const cancelled = response.json().data as Participant
    assert.equal(cancelled.retainedCents, FEE / 2)
    assert.equal(cancelled.refundCents, FEE / 2)
    assert.equal(cancelled.refundStatus, 'pending')
    assert.equal(cancelled.closedInvoiceId, null)
    assert.equal((await send('GET', BASE, t.cookie)).json().data[0].pendingRefundCount, 1)

    assertError(
      await send(
        'POST',
        `/api/v1/payments/${payment.id}/reverse`,
        t.cookie,
        { reason: 'Test tahsilat iptali' },
        { ...version(payment.version), ...key() },
      ),
      409,
      'payment_activity_cancelled',
    )

    const refund = (body: unknown, at = cancelled.version) =>
      send('POST', `${PARTICIPANTS}/${cancelled.id}/pay-refund`, t.cookie, body, {
        ...version(at),
        ...key(),
      })
    const BODY = {
      paidDate: TODAY,
      iban: IBAN,
      accountHolder: PARENT_NAME,
      bankAccountId: TEST_REFUND_BANK_ACCOUNT_ID,
    }
    assertError(
      await refund({ ...BODY, accountHolder: 'Başka Kişi' }),
      422,
      'refund_holder_mismatch',
    )
    assertError(
      await refund({ ...BODY, paidDate: '2026-10-05' }),
      422,
      'paid_activity_refund_before_cancel',
    )
    const paid = await refund(BODY)
    assert.equal(paid.statusCode, 200, paid.body)
    assert.equal(paid.json().data.refundStatus, 'paid')
    assert.equal(paid.json().data.maskedIban, 'TR** **** 1326')
    assert.equal(paid.json().data.refundAccountHolder, PARENT_NAME)
    assertError(await refund(BODY, cancelled.version + 1), 409, 'refund_already_paid')
    assert.ok(!logs.some((line) => line.includes(IBAN)))

    const day = await send('GET', `/api/v1/finance/day-closings/${TODAY}`, t.cookie)
    assert.equal(day.statusCode, 200, day.body)
    const line = day
      .json()
      .data.refunds.find(
        (item: { paidActivityParticipantId: string | null }) =>
          item.paidActivityParticipantId === cancelled.id,
      )
    assert.equal(line?.amountCents, FEE / 2)
    assert.equal(line?.withdrawalId, null)
    assert.equal(line?.freeTuitionAwardId, null)
  })

  test('DOM-FIN-098, K-302: geç iptalde kısmi ödeme kesintiden azsa fark yeni taksit olur', async () => {
    const t = await institution()
    const activity = await create(t.cookie, LATE)
    const participant = await joined(t.cookie, activity.id)
    await pay(t.cookie, participant.invoiceId, 30_000)
    const reread = (await send('GET', `${BASE}/${activity.id}/participants`, t.cookie)).json()
      .data[0] as Participant
    assert.equal(reread.paymentStatus, 'partial')
    const cancelled = (await cancelParticipant(t.cookie, reread)).json().data as Participant
    assert.equal(cancelled.refundCents, 0)
    assert.ok(cancelled.debtInvoiceId)
    const rows = await invoiceRows(t.id)
    const debt = rows.find((row) => row.id === cancelled.debtInvoiceId)
    assert.equal(debt?.amountCents, FEE / 2 - 30_000)
    assert.equal(debt?.feeKind, 'activity')
    assert.equal(debt?.dueDate, TODAY)
    assert.ok(rows.find((row) => row.id === participant.invoiceId)?.archivedAt)
  })

  test('DOM-FIN-098, K-302: kurum iptali bütün katılımlara tam iade; iptal edilen etkinliğe katılım yazılmaz', async () => {
    const t = await institution()
    const activity = await create(t.cookie, LATE)
    const paidOne = await joined(t.cookie, activity.id)
    await joined(t.cookie, activity.id, OTHER_ID)
    await pay(t.cookie, paidOne.invoiceId, 100_000)
    const cancel = (body: unknown, headers: Record<string, string>) =>
      send('POST', `${BASE}/${activity.id}/cancel`, t.cookie, body, headers)
    const before = await rowsOf(t.id)
    assertError(await cancel({ reason: 'kısa' }, { ...version(activity.version), ...key() }), 400)
    assertError(await cancel({ reason: 'Hava muhalefeti' }, version(activity.version)), 400)
    assert.deepEqual(await rowsOf(t.id), before)
    const response = await cancel(
      { reason: 'Hava muhalefeti nedeniyle', institutionId: 'x' },
      { ...version(activity.version), ...key() },
    )
    assertError(response, 400)
    const ok = await cancel(
      { reason: 'Hava muhalefeti nedeniyle' },
      { ...version(activity.version), ...key() },
    )
    assert.equal(ok.statusCode, 200, ok.body)
    assert.equal(ok.json().data.status, 'cancelled')
    assert.equal(ok.json().data.participantCount, 0)
    const participants = (await send('GET', `${BASE}/${activity.id}/participants`, t.cookie)).json()
      .data as (Participant & { studentId: string; cancelKind: string })[]
    assert.equal(participants.length, 2)
    for (const item of participants) {
      assert.equal(item.cancelKind, 'activity')
      assert.equal(item.retainedCents, 0)
      assert.equal(item.refundCents, item.studentId === STUDENT_ID ? 100_000 : 0)
      assert.equal(item.debtInvoiceId, null)
    }
    assert.ok((await invoiceRows(t.id)).every((row) => row.archivedAt !== null))
    assertError(await join(t.cookie, activity.id), 409, 'paid_activity_cancelled')
    assertError(
      await cancel({ reason: 'Hava muhalefeti nedeniyle' }, { ...version(2), ...key() }),
      409,
      'paid_activity_cancelled',
    )
  })

  test('DOM-FIN-098: başka kurumun etkinliği ve katılımı 404, B değişmez; listede B yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bActivity = await create(b.cookie)
    const bParticipant = await joined(b.cookie, bActivity.id)
    const bRows = await rowsOf(b.id)
    const list = await send('GET', BASE, a.cookie)
    assert.equal(list.json().meta.total, 0)
    assertError(await send('GET', `${BASE}/${bActivity.id}`, a.cookie), 404)
    assertError(
      await send('PATCH', `${BASE}/${bActivity.id}`, a.cookie, { capacity: 9 }, version(1)),
      404,
    )
    assertError(
      await send(
        'POST',
        `${BASE}/${bActivity.id}/cancel`,
        a.cookie,
        { reason: 'Başka kurum iptali' },
        {
          ...version(1),
          ...key(),
        },
      ),
      404,
    )
    assertError(await send('GET', `${BASE}/${bActivity.id}/participants`, a.cookie), 404)
    assertError(await join(a.cookie, bActivity.id), 404)
    assertError(await cancelParticipant(a.cookie, bParticipant), 404)
    assertError(
      await send(
        'POST',
        `${PARTICIPANTS}/${bParticipant.id}/pay-refund`,
        a.cookie,
        {
          paidDate: TODAY,
          iban: IBAN,
          accountHolder: PARENT_NAME,
          bankAccountId: TEST_REFUND_BANK_ACCOUNT_ID,
        },
        { ...version(1), ...key() },
      ),
      404,
    )
    assert.deepEqual(await rowsOf(b.id), bRows)
    // Gövdedeki kurum kimliği şemada yoktur: 400, kayıt yazılmaz.
    assertError(await send('POST', BASE, a.cookie, { ...EARLY, institutionId: b.id }), 400)
    assert.deepEqual(await rowsOf(b.id), bRows)
  })
})
