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
} from './support/app.ts'
import { checkFinanceMirrorAfterEach } from './support/finance-mirror.ts'
import { insertRefundBankAccount, insertTestTariff } from './support/finance-terms.ts'

/**
 * Gezi katılımcı yönetimi uçları (DOM-FIN-112; ON-156; K-369…K-371): yedek listesi ve otomatik
 * geçiş, veli izni (elle ve dijital izin formundan), toplu katılım ve katılım listesi. Her test
 * kendi kurumunu kurar: 7-A sınıfı (c1), öğrencileri ve velileri. FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const C1 = SEED.students.filter((item) => item.classId === 'c1')
const [FIRST, SECOND, THIRD] = C1
const FIRST_ID = FIRST?.id ?? ''
const SECOND_ID = SECOND?.id ?? ''
const THIRD_ID = THIRD?.id ?? ''
const BASE = '/api/v1/finance/paid-activities'
const PARTICIPANTS = '/api/v1/finance/paid-activity-participants'
const FEE = 90_000
const PHONE = '0532 111 22 34'

const ACTIVITY = {
  name: 'Test Efes gezisi',
  kind: 'trip',
  activityDate: '2026-10-20',
  feeCents: FEE,
  joinDeadline: '2026-10-15',
  cancelDeadline: '2026-10-10',
  capacity: 1,
  lateRefundRule: 'percent',
  lateRefundPercent: 50,
  lateCostCents: null,
}
const CONSENT = { ...ACTIVITY, name: 'Test izinli gezi', capacity: 2, requiresConsent: true }

type Participant = {
  id: string
  version: number
  studentId: string
  status: string
  invoiceId: string | null
  waitlistPosition: number | null
  waitlistRank: number | null
  consentStatus: string
  consentChannel: string | null
  consentGrantorName: string | null
  cancelKind: string | null
  paymentStatus: string
  permissionStatus: string | null
  className: string | null
}
type Activity = {
  id: string
  version: number
  participantCount: number
  waitlistCount: number
  awaitingConsentCount: number
}

describe('gezi katılımcı yönetimi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-pw-${String(++serial).padStart(5, '0')}` })
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(FIRST && SECOND && THIRD)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
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

  async function institution() {
    const created = await createInstitution(app)
    await insertTestTariff(db, created.id)
    await insertRefundBankAccount(db, created.id)
    const parentIds = [...new Set(C1.map((item) => item.parentId))]
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'classes',
          id: 'c1',
          data: { ...SEED.classes.find((item) => item.id === 'c1') },
        },
        ...C1.map((student) => ({
          collection: 'students' as const,
          id: student.id,
          data: { ...student },
        })),
        ...parentIds.map((id) => ({
          collection: 'parents' as const,
          id,
          data: {
            id,
            name: `Test Veli ${id}`,
            phone: PHONE,
            studentIds: C1.filter((item) => item.parentId === id).map((item) => item.id),
          },
        })),
      ],
      FIXED_NOW,
    )
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role, []))

  const create = async (cookie: string, body: unknown = ACTIVITY) => {
    const response = await send('POST', BASE, cookie, body)
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as Activity
  }
  const activityOf = async (cookie: string, id: string) =>
    (await send('GET', `${BASE}/${id}`, cookie)).json().data as Activity
  const join = (cookie: string | null, activityId: string, studentId: string) =>
    send('POST', `${BASE}/${activityId}/participants`, cookie, { studentId }, key())
  const joined = async (cookie: string, activityId: string, studentId: string) => {
    const response = await join(cookie, activityId, studentId)
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as Participant
  }
  const list = async (cookie: string, activityId: string, query = '') => {
    const response = await send('GET', `${BASE}/${activityId}/participants${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json().data as Participant[]
  }
  const find = async (cookie: string, activityId: string, studentId: string) => {
    const found = (await list(cookie, activityId)).find(
      (item) => item.studentId === studentId && item.status !== 'cancelled',
    )
    assert.ok(found, `katılım yok: ${studentId}`)
    return found
  }
  const cancel = (cookie: string | null, participant: { id: string; version: number }) =>
    send('POST', `${PARTICIPANTS}/${participant.id}/cancel`, cookie, undefined, {
      ...version(participant.version),
      ...key(),
    })
  const grant = (
    cookie: string | null,
    participant: { id: string; version: number },
    body: unknown = { channel: 'paper', grantorName: 'Test İzin Velisi' },
  ) =>
    send('POST', `${PARTICIPANTS}/${participant.id}/consent`, cookie, body, {
      ...version(participant.version),
      ...key(),
    })
  const withdraw = (
    cookie: string | null,
    participant: { id: string; version: number },
    body: unknown = { channel: 'phone' },
  ) =>
    send('POST', `${PARTICIPANTS}/${participant.id}/consent-withdraw`, cookie, body, {
      ...version(participant.version),
      ...key(),
    })
  const bulk = (cookie: string | null, activityId: string, classIds: unknown) =>
    send('POST', `${BASE}/${activityId}/participants/bulk`, cookie, { classIds }, key())
  const sync = (cookie: string | null, activityId: string) =>
    send('POST', `${BASE}/${activityId}/consents/sync`, cookie, undefined, key())
  const roster = (
    cookie: string | null,
    activityId: string,
    headers: Record<string, string> = {},
  ) => send('GET', `${BASE}/${activityId}/roster`, cookie, undefined, headers)
  const activityInvoices = (institutionId: string) =>
    db
      .select({ id: invoices.id, studentId: invoices.studentId, archivedAt: invoices.archivedAt })
      .from(invoices)
      .where(and(eq(invoices.institutionId, institutionId), eq(invoices.feeKind, 'activity')))
  const rowsOf = async (institutionId: string) => ({
    activities: await db
      .select()
      .from(paidActivities)
      .where(eq(paidActivities.institutionId, institutionId)),
    participants: await db
      .select()
      .from(paidActivityParticipants)
      .where(eq(paidActivityParticipants.institutionId, institutionId)),
    invoices: await activityInvoices(institutionId),
  })
  const audits = (institutionId: string, action: string) =>
    db
      .select({ changes: auditLog.changes, entityId: auditLog.entityId })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('DOM-FIN-112, K-369: dolu kontenjanda yedek sıra numarasıyla yazılır; iptalde ve kontenjan artışında sıradaki yedek asile geçer', async () => {
    const t = await institution()
    const activity = await create(t.cookie)
    const first = await joined(t.cookie, activity.id, FIRST_ID)
    assert.equal(first.status, 'active')
    assert.ok(first.invoiceId)
    assert.equal(first.className, '7-A')
    const second = await joined(t.cookie, activity.id, SECOND_ID)
    assert.deepEqual(
      [
        second.status,
        second.invoiceId,
        second.waitlistPosition,
        second.waitlistRank,
        second.paymentStatus,
      ],
      ['waitlisted', null, 1, 1, 'not_billed'],
    )
    const third = await joined(t.cookie, activity.id, THIRD_ID)
    assert.deepEqual([third.waitlistPosition, third.waitlistRank], [2, 2])
    assertError(
      await join(t.cookie, activity.id, SECOND_ID),
      409,
      'paid_activity_participant_exists',
    )
    assert.equal((await activityInvoices(t.id)).length, 1)
    const counts = await activityOf(t.cookie, activity.id)
    assert.deepEqual([counts.participantCount, counts.waitlistCount], [1, 2])
    // Sıra: asil, sonra yedekler; süzgeç yalnız yedekleri verir.
    assert.deepEqual(
      (await list(t.cookie, activity.id)).map((item) => item.studentId),
      [FIRST_ID, SECOND_ID, THIRD_ID],
    )
    assert.deepEqual(
      (await list(t.cookie, activity.id, '?status=waitlisted')).map((item) => item.studentId),
      [SECOND_ID, THIRD_ID],
    )
    assertError(
      await send('GET', `${BASE}/${activity.id}/participants?status=yedek`, t.cookie),
      400,
    )

    // Asil iptal edilince 1 numaralı yedek aynı işlemde asile geçer, taksiti açılır.
    const cancelled = await cancel(t.cookie, first)
    assert.equal(cancelled.statusCode, 200, cancelled.body)
    const promoted = await find(t.cookie, activity.id, SECOND_ID)
    assert.equal(promoted.status, 'active')
    assert.ok(promoted.invoiceId)
    assert.equal(promoted.paymentStatus, 'unpaid')
    const waiting = await find(t.cookie, activity.id, THIRD_ID)
    assert.deepEqual([waiting.waitlistPosition, waiting.waitlistRank], [2, 1])
    const [promotion] = await audits(t.id, 'paid_activity.promote')
    assert.equal(promotion?.entityId, second.id)
    assert.deepEqual(promotion?.changes, { fields: ['status', 'promotedAt', 'invoiceId'] })

    // Yedeğin iptali parasızdır ve geçiş yapmaz; kontenjan artışı kalan yedeği geçirir.
    const fourth = await joined(t.cookie, activity.id, FIRST_ID)
    assert.equal(fourth.waitlistPosition, 3)
    const dropped = await cancel(t.cookie, fourth)
    assert.equal(dropped.statusCode, 200, dropped.body)
    assert.equal(dropped.json().data.refundCents, 0)
    assert.equal(dropped.json().data.closedInvoiceId, null)
    const current = await activityOf(t.cookie, activity.id)
    const grown = await send(
      'PATCH',
      `${BASE}/${activity.id}`,
      t.cookie,
      { capacity: 3 },
      version(current.version),
    )
    assert.equal(grown.statusCode, 200, grown.body)
    assert.deepEqual([grown.json().data.participantCount, grown.json().data.waitlistCount], [2, 0])
    assert.equal((await find(t.cookie, activity.id, THIRD_ID)).status, 'active')
    // Kontenjan yer tutan sayının altına inmez.
    assertError(
      await send(
        'PATCH',
        `${BASE}/${activity.id}`,
        t.cookie,
        { capacity: 1 },
        version(grown.json().data.version),
      ),
      422,
      'paid_activity_capacity_below_participants',
    )
    const live = (await activityInvoices(t.id)).filter((item) => item.archivedAt === null)
    assert.deepEqual(live.map((item) => item.studentId).sort(), [SECOND_ID, THIRD_ID].sort())
  })

  test('DOM-FIN-112, K-370: izin isteyen etkinlikte katılım izin bekler; elle izin taksiti açar, geri çekilen izin iptal eder ve yedeği geçirir', async () => {
    const t = await institution()
    const activity = await create(t.cookie, { ...CONSENT, capacity: 1 })
    const first = await joined(t.cookie, activity.id, FIRST_ID)
    assert.deepEqual(
      [first.status, first.consentStatus, first.invoiceId, first.paymentStatus],
      ['awaiting_consent', 'pending', null, 'not_billed'],
    )
    const second = await joined(t.cookie, activity.id, SECOND_ID)
    assert.equal(second.status, 'waitlisted')
    assert.equal((await activityOf(t.cookie, activity.id)).awaitingConsentCount, 1)
    assert.equal((await activityInvoices(t.id)).length, 0)
    assert.deepEqual(
      (await list(t.cookie, activity.id, '?consentStatus=pending')).map((item) => item.studentId),
      [FIRST_ID, SECOND_ID],
    )

    // Geçersiz gövde 400, eksik başlıklar 400/428; kayıt değişmez.
    const before = await rowsOf(t.id)
    assertError(
      await grant(t.cookie, first, { channel: 'permission_form', grantorName: 'Test Veli' }),
      400,
    )
    assertError(await grant(t.cookie, first, { channel: 'paper', grantorName: 'A' }), 400)
    assertError(
      await send(
        'POST',
        `${PARTICIPANTS}/${first.id}/consent`,
        t.cookie,
        { channel: 'paper', grantorName: 'Test Veli' },
        version(first.version),
      ),
      400,
      'idempotency_key_required',
    )
    assertError(await grant(t.cookie, { ...first, version: 99 }), 409)
    assert.deepEqual(await rowsOf(t.id), before)

    const headers = { ...version(first.version), ...key() }
    const body = { channel: 'paper', grantorName: 'Test İzin Velisi' }
    const granted = await send(
      'POST',
      `${PARTICIPANTS}/${first.id}/consent`,
      t.cookie,
      body,
      headers,
    )
    assert.equal(granted.statusCode, 200, granted.body)
    const active = granted.json().data as Participant
    assert.deepEqual(
      [
        active.status,
        active.consentStatus,
        active.consentChannel,
        active.consentGrantorName,
        active.paymentStatus,
      ],
      ['active', 'granted', 'paper', 'Test İzin Velisi', 'unpaid'],
    )
    assert.ok(active.invoiceId)
    const replay = await send(
      'POST',
      `${PARTICIPANTS}/${first.id}/consent`,
      t.cookie,
      body,
      headers,
    )
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await activityInvoices(t.id)).length, 1)
    assertError(await grant(t.cookie, active), 409, 'paid_activity_consent_recorded')
    const grantAudits = await audits(t.id, 'paid_activity.consent_grant')
    assert.ok(grantAudits.some((row) => row.entityId === first.id))
    assert.deepEqual(
      grantAudits.find(
        (row) => row.entityId === first.id && JSON.stringify(row.changes).includes('consentAt'),
      )?.changes,
      {
        fields: [
          'consentStatus',
          'consentChannel',
          'consentAt',
          'consentGrantorName',
          'status',
          'invoiceId',
        ],
      },
    )
    // İzni veren adı denetime değer olarak yazılmaz.
    assert.ok(!JSON.stringify(grantAudits).includes('Test İzin Velisi'))

    // Yedeğin izni kaydedilir; asile geçince taksiti açılır.
    const waiting = await grant(t.cookie, second, {
      channel: 'in_person',
      grantorName: 'Test Veli İki',
    })
    assert.equal(waiting.statusCode, 200, waiting.body)
    assert.deepEqual(
      [waiting.json().data.status, waiting.json().data.invoiceId],
      ['waitlisted', null],
    )

    // Geri çekilen izin katılımı süresinde (tam iade) iptal eder; yedek izinli olduğu için asil olur.
    const withdrawn = await withdraw(t.cookie, active)
    assert.equal(withdrawn.statusCode, 200, withdrawn.body)
    const gone = withdrawn.json().data as Participant & { consentWithdrawalChannel: string }
    assert.deepEqual(
      [gone.status, gone.cancelKind, gone.consentStatus, gone.consentWithdrawalChannel],
      ['cancelled', 'consent', 'withdrawn', 'phone'],
    )
    const promoted = await find(t.cookie, activity.id, SECOND_ID)
    assert.equal(promoted.status, 'active')
    assert.ok(promoted.invoiceId)
    assertError(await withdraw(t.cookie, gone), 409)

    // İzin istemeyen etkinlikte izin uçları 422.
    const plain = await create(t.cookie, { ...ACTIVITY, name: 'Test izinsiz gezi' })
    const plainJoin = await joined(t.cookie, plain.id, THIRD_ID)
    assertError(await grant(t.cookie, plainJoin), 422, 'paid_activity_consent_not_required')
    assertError(await withdraw(t.cookie, plainJoin), 422, 'paid_activity_consent_not_required')
    assertError(
      await send('POST', BASE, t.cookie, { ...ACTIVITY, permissionFormId: 'pf-yok' }),
      400,
    )
    assertError(
      await send('POST', BASE, t.cookie, { ...CONSENT, permissionFormId: 'pf-yok' }),
      422,
      'paid_activity_permission_form_not_found',
    )
    assertError(await sync(t.cookie, activity.id), 422, 'paid_activity_permission_form_missing')
  })

  test('DOM-FIN-112, K-370, IST-067: bağlı izin formundan eşitleme onayın iznini alır, reddi iptal eder', async () => {
    const t = await institution()
    const veli = async (studentId: string) => {
      const user = await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: studentId }])
      return signInAs(app, user)
    }
    const form = await send(
      'POST',
      '/api/v1/permission-forms',
      t.cookie,
      {
        topic: 'trip',
        title: 'Test Efes gezisi izni',
        description: 'Efes antik kenti gezisi.',
        deadline: '2026-10-09',
        studentIds: [FIRST_ID, SECOND_ID],
      },
      key(),
    )
    assert.equal(form.statusCode, 201, form.body)
    const formId = form.json().data.id as string
    const activity = await create(t.cookie, { ...CONSENT, permissionFormId: formId })
    const first = await joined(t.cookie, activity.id, FIRST_ID)
    await joined(t.cookie, activity.id, SECOND_ID)
    const third = await joined(t.cookie, activity.id, THIRD_ID)
    assert.equal(third.status, 'waitlisted')
    assert.equal(first.permissionStatus, 'pending')
    assert.equal(third.permissionStatus, 'not_targeted')

    const decide = async (studentId: string, decision: string) => {
      const response = await send(
        'POST',
        `/api/v1/permission-forms/${formId}/decisions`,
        await veli(studentId),
        { studentId, decision },
        key(),
      )
      assert.equal(response.statusCode, 201, response.body)
    }
    await decide(FIRST_ID, 'approved')
    await decide(SECOND_ID, 'rejected')
    assert.equal((await find(t.cookie, activity.id, FIRST_ID)).permissionStatus, 'approved')

    const front = await member(t.id, 'onburo')
    const synced = await sync(front, activity.id)
    assert.equal(synced.statusCode, 200, synced.body)
    const result = synced.json().data
    assert.deepEqual([result.grantedCount, result.withdrawnCount, result.promotedCount], [1, 1, 1])
    const firstNow = await find(t.cookie, activity.id, FIRST_ID)
    assert.deepEqual(
      [firstNow.status, firstNow.consentChannel, firstNow.consentGrantorName],
      ['active', 'permission_form', null],
    )
    assert.ok(firstNow.invoiceId)
    const rejected = (await list(t.cookie, activity.id, '?status=cancelled'))[0]
    assert.deepEqual([rejected?.studentId, rejected?.cancelKind], [SECOND_ID, 'consent'])
    // Yedek izin bekleyen asil olur (formun hedefinde değil).
    assert.equal((await find(t.cookie, activity.id, THIRD_ID)).status, 'awaiting_consent')
    // İkinci eşitleme bir şey değiştirmez.
    const again = await sync(t.cookie, activity.id)
    assert.deepEqual([again.json().data.grantedCount, again.json().data.withdrawnCount], [0, 0])
    // Öğretmen eşitleyemez.
    assertError(await sync(await member(t.id, 'ogretmen'), activity.id), 403)
  })

  test('DOM-FIN-112, K-371: sınıf seçerek toplu katılım; aşan kısım yedeğe, zaten yazılı olan atlanır', async () => {
    const t = await institution()
    const activity = await create(t.cookie, { ...ACTIVITY, capacity: 3 })
    await joined(t.cookie, activity.id, FIRST_ID)
    const before = await rowsOf(t.id)
    assertError(await bulk(t.cookie, activity.id, []), 400)
    assertError(await bulk(t.cookie, activity.id, ['c1', 'c1']), 400)
    assertError(await bulk(t.cookie, activity.id, ['c-yok']), 422, 'paid_activity_class_not_found')
    assertError(
      await send('POST', `${BASE}/${activity.id}/participants/bulk`, t.cookie, {
        classIds: ['c1'],
      }),
      400,
      'idempotency_key_required',
    )
    assertError(await bulk(await member(t.id, 'ogretmen'), activity.id, ['c1']), 403)
    assert.deepEqual(await rowsOf(t.id), before)

    const headers = key()
    const response = await send(
      'POST',
      `${BASE}/${activity.id}/participants/bulk`,
      await member(t.id, 'onburo'),
      { classIds: ['c1'] },
      headers,
    )
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data
    assert.deepEqual(data.skippedStudentIds, [FIRST_ID])
    assert.equal(data.activeCount, 2)
    assert.equal(data.waitlistedCount, C1.length - 3)
    assert.deepEqual(
      [data.activity.participantCount, data.activity.waitlistCount],
      [3, C1.length - 3],
    )
    assert.equal((await activityInvoices(t.id)).length, 3)
    const waitlisted = await list(t.cookie, activity.id, '?status=waitlisted&pageSize=100')
    assert.deepEqual(
      waitlisted.map((item) => item.waitlistPosition),
      waitlisted.map((_, index) => index + 1),
    )
    assert.ok(
      (await audits(t.id, 'paid_activity.bulk_join')).some(
        (row) => JSON.stringify(row.changes) === JSON.stringify({ fields: ['classIds'] }),
      ),
    )
    const joins = (await audits(t.id, 'paid_activity.join')).filter((row) =>
      JSON.stringify(row.changes).includes('consentStatus'),
    )
    assert.equal(joins.length, C1.length)
  })

  test('DOM-FIN-112, K-371: katılım listesi maskeli veli telefonuyla JSON ve CSV; okuma denetime düşer', async () => {
    const t = await institution()
    const activity = await create(t.cookie)
    await joined(t.cookie, activity.id, FIRST_ID)
    await joined(t.cookie, activity.id, SECOND_ID)
    assertError(await roster(null, activity.id), 401)
    assertError(await roster(await member(t.id, 'ogretmen'), activity.id), 403)
    const response = await roster(await member(t.id, 'onburo'), activity.id)
    assert.equal(response.statusCode, 200, response.body)
    const { activity: head, items } = response.json().data as {
      activity: Activity
      items: {
        studentId: string
        guardianPhoneMasked: string
        status: string
        waitlistRank: number | null
        className: string
      }[]
    }
    assert.equal(head.id, activity.id)
    assert.deepEqual(
      items.map((item) => [item.studentId, item.status, item.waitlistRank, item.className]),
      [
        [FIRST_ID, 'active', null, '7-A'],
        [SECOND_ID, 'waitlisted', 1, '7-A'],
      ],
    )
    assert.equal(items[0]?.guardianPhoneMasked, '0532 *** ** 34')
    assert.ok(!response.body.includes('111 22'))
    const csv = await roster(t.cookie, activity.id, { accept: 'text/csv' })
    assert.equal(csv.statusCode, 200, csv.body)
    assert.match(String(csv.headers['content-type']), /text\/csv/)
    const lines = csv.body.replace('﻿', '').trimEnd().split('\r\n')
    assert.equal(lines.length, 3)
    assert.ok(lines[1]?.includes('"0532 *** ** 34"') && lines[1].includes('"Asil"'))
    assert.ok(lines[2]?.includes('"Yedek 1"') && lines[2].includes('"Taksit yok"'))
    assert.ok(!csv.body.includes('111 22'))
    assert.equal((await audits(t.id, 'finance.paid_activity_roster_export')).length, 2)
  })

  test('DOM-FIN-112: başka kurumun etkinliği ve katılımı yeni uçlarda 404, B değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const bActivity = await create(b.cookie, { ...CONSENT, capacity: 1 })
    const bParticipant = await joined(b.cookie, bActivity.id, FIRST_ID)
    const bRows = await rowsOf(b.id)
    assertError(await bulk(a.cookie, bActivity.id, ['c1']), 404)
    assertError(await sync(a.cookie, bActivity.id), 404)
    assertError(await roster(a.cookie, bActivity.id), 404)
    assertError(await grant(a.cookie, bParticipant), 404)
    assertError(await withdraw(a.cookie, bParticipant), 404)
    assert.deepEqual(await rowsOf(b.id), bRows)
  })
})
