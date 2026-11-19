import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { paidActivityParticipants } from '../src/db/schema/finance-paid-activities.ts'
import { invoices } from '../src/db/schema/invoices.ts'
import {
  buildTestApp,
  createInstitution,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { checkFinanceMirrorAfterEach } from './support/finance-mirror.ts'
import {
  contractTerms,
  insertRefundBankAccount,
  insertTestTariff,
} from './support/finance-terms.ts'

/**
 * ON-346: ayrılan öğrencinin yedek ve izin bekleyen etkinlik katılımları (DOM-FIN-112, DOM-FIN-040;
 * K-395, K-396). Her test kendi kurumunu kurar: 7-A sınıfı (c1), öğrencileri ve velileri; ilk
 * öğrencinin dört taksitli sözleşmesi. Saat ve İstanbul günü 2026-10-06.
 */

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
const SEED = createSeed(FIXED_NOW)
const C1 = SEED.students.filter((item) => item.classId === 'c1')
const [FIRST, SECOND, THIRD] = C1
const FIRST_ID = FIRST?.id ?? ''
const SECOND_ID = SECOND?.id ?? ''
const THIRD_ID = THIRD?.id ?? ''
const CONTRACT_ID = 'test-on346-contract'
const TUITION = 1_750_000
const DUES = ['2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15']
const ACTIVITIES = '/api/v1/finance/paid-activities'
const PARTICIPANTS = '/api/v1/finance/paid-activity-participants'
const TODAY = '2026-10-06'
const WITHDRAW = {
  withdrawalDate: TODAY,
  termStartDate: '2026-09-07',
  attendedUnits: 20,
  totalUnits: 180,
  reason: 'relocation',
  targetSchool: 'Test Okulu',
}
const TRIP = {
  name: 'Test müze gezisi',
  kind: 'trip',
  activityDate: '2026-10-20',
  feeCents: 300_000,
  joinDeadline: '2026-10-15',
  cancelDeadline: '2026-10-10',
  capacity: 1,
  lateRefundRule: 'percent',
  lateRefundPercent: 50,
  lateCostCents: null,
}
/** Etkinlik ayrılış günü: ayrılıştan sonraki etkinlik sayılmaz, yedek katılım kalır (K-395). */
const SAME_DAY = {
  ...TRIP,
  name: 'Test tiyatro',
  kind: 'event',
  activityDate: TODAY,
  joinDeadline: TODAY,
  cancelDeadline: TODAY,
}

describe('ON-346: ayrılışta yedek ve izin bekleyen etkinlik katılımları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
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

  async function institution() {
    const created = await createInstitution(app)
    await insertTestTariff(db, created.id)
    await insertRefundBankAccount(db, created.id)
    const parentIds = [...new Set(C1.map((item) => item.parentId))]
    const invoiceIds = DUES.map((_, index) => `test-on346-inv-${String(index + 1)}`)
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'classes' as const,
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
            studentIds: C1.filter((item) => item.parentId === id).map((item) => item.id),
          },
        })),
        {
          collection: 'contracts' as const,
          id: CONTRACT_ID,
          data: {
            id: CONTRACT_ID,
            studentId: FIRST_ID,
            date: '2026-09-01T09:00:00.000Z',
            amount: 4 * TUITION,
            title: 'Özel okul eğitim sözleşmesi',
            invoiceIds,
            academicYear: 2026,
            ...contractTerms({ grossCents: 4 * TUITION, netCents: 4 * TUITION }),
          },
        },
        ...DUES.map((due, index) => ({
          collection: 'invoices' as const,
          id: invoiceIds[index] ?? '',
          data: {
            id: invoiceIds[index],
            studentId: FIRST_ID,
            installment: index + 1,
            amount: TUITION,
            dueDate: `${due}T09:00:00.000Z`,
            paidAt: null,
            method: null,
            reminderAt: null,
            feeKind: 'tuition',
            academicYear: 2026,
          },
        })),
      ],
      FIXED_NOW,
    )
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const call = (
    method: 'GET' | 'POST',
    target: string,
    cookie: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url: target,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  const key = () => ({ 'idempotency-key': randomUUID() })
  async function ok(response: Response, status = 200): Promise<Json> {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  const create = async (t: Tenant, body: Json) =>
    String((await ok(await call('POST', ACTIVITIES, t.cookie, body), 201)).id)
  const join = async (t: Tenant, activityId: string, studentId: string) =>
    ok(
      await call(
        'POST',
        `${ACTIVITIES}/${activityId}/participants`,
        t.cookie,
        { studentId },
        key(),
      ),
      201,
    )
  const withdraw = async (t: Tenant) =>
    ok(await call('POST', `/api/v1/students/${FIRST_ID}/withdraw`, t.cookie, WITHDRAW, key()), 201)
  const rows = async (t: Tenant, activityId: string) =>
    db
      .select()
      .from(paidActivityParticipants)
      .where(
        and(
          eq(paidActivityParticipants.institutionId, t.id),
          eq(paidActivityParticipants.activityId, activityId),
        ),
      )
  const rowOf = async (t: Tenant, activityId: string, studentId: string) => {
    const found = (await rows(t, activityId)).filter((row) => row.studentId === studentId)
    assert.equal(found.length, 1, `tek katılım beklenir: ${studentId}`)
    return found[0]!
  }
  const activityInvoices = (t: Tenant, studentId: string) =>
    db
      .select({ id: invoices.id, archivedAt: invoices.archivedAt })
      .from(invoices)
      .where(
        and(
          eq(invoices.institutionId, t.id),
          eq(invoices.studentId, studentId),
          eq(invoices.feeKind, 'activity'),
        ),
      )
  const auditsOf = (t: Tenant, entityId: string) =>
    db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, entityId)))
  const cancel = async (t: Tenant, participant: { id: string; version: number }) =>
    ok(
      await call('POST', `${PARTICIPANTS}/${participant.id}/cancel`, t.cookie, undefined, {
        'if-match': `"${String(participant.version)}"`,
        ...key(),
      }),
    )

  test('K-395, K-369: ayrılış yedek ve izin bekleyen katılımı parasız iptal eder; boşalan yere yedek geçer', async () => {
    const t = await institution()
    // Ayrılanın asil katılımı; yerine ikinci öğrenci yedekte bekler.
    const seat = await create(t, TRIP)
    const firstSeat = await join(t, seat, FIRST_ID)
    await join(t, seat, SECOND_ID)
    // Ayrılan yedekte; asil ikinci öğrenci.
    const waiting = await create(t, {
      ...TRIP,
      name: 'Test planetaryum',
      activityDate: '2026-10-21',
    })
    await join(t, waiting, SECOND_ID)
    const firstWaiting = await join(t, waiting, FIRST_ID)
    // Ayrılan izin bekleyen asil; üçüncü öğrenci yedek.
    const consent = await create(t, {
      ...TRIP,
      name: 'Test izinli gezi',
      activityDate: '2026-10-22',
      requiresConsent: true,
    })
    const firstConsent = await join(t, consent, FIRST_ID)
    await join(t, consent, THIRD_ID)
    assert.equal(firstWaiting.status, 'waitlisted')
    assert.equal(firstConsent.status, 'awaiting_consent')

    const withdrawal = await withdraw(t)
    // Para etkisi yok: dökümde yalnız taksitli katılımın satırı (K-348).
    const breakdown = withdrawal.breakdown as { activities: Json[] }
    assert.deepEqual(
      breakdown.activities.map((line) => [line.participantId, line.outcome]),
      [[firstSeat.id, 'cancelled']],
    )

    for (const [activityId, participant] of [
      [waiting, firstWaiting],
      [consent, firstConsent],
    ] as const) {
      const row = await rowOf(t, activityId, FIRST_ID)
      assert.equal(row.id, participant.id)
      assert.equal(row.status, 'cancelled')
      assert.equal(row.cancelKind, 'participant')
      assert.equal(row.cancelledDate, TODAY)
      assert.equal(row.paidCents, 0)
      assert.equal(row.retainedCents, 0)
      assert.equal(row.refundCents, 0)
      assert.equal(row.invoiceId, null)
      assert.equal(row.closedInvoiceId, null)
      assert.equal(row.debtInvoiceId, null)
      // Denetim: katılımcı iptali, gerekçe kodu ayrılış (K-395).
      const audits = await auditsOf(t, String(participant.id))
      const cancelAudit = audits.find((item) => item.action === 'paid_activity.participant_cancel')
      assert.equal(cancelAudit?.changes?.reason, 'student_withdrawal')
      assert.ok(cancelAudit?.changes?.fields?.includes('cancelKind'))
    }
    const seatAudit = (await auditsOf(t, String(firstSeat.id))).find(
      (item) => item.action === 'paid_activity.participant_cancel',
    )
    assert.equal(seatAudit?.changes?.reason, 'student_withdrawal')

    // Asilin boşalttığı yere yedek aynı işlemde geçer, taksiti açılır (K-369).
    const promoted = await rowOf(t, seat, SECOND_ID)
    assert.equal(promoted.status, 'active')
    assert.ok(promoted.promotedAt)
    assert.ok(promoted.invoiceId)
    const secondInvoices = await activityInvoices(t, SECOND_ID)
    assert.ok(secondInvoices.some((row) => row.id === promoted.invoiceId && !row.archivedAt))
    assert.ok(
      (await auditsOf(t, promoted.id)).some((item) => item.action === 'paid_activity.promote'),
    )
    // İzin bekleyenin yeri: izin isteyen etkinlikte yedek izin bekleyen olur, taksit yok.
    const consentPromoted = await rowOf(t, consent, THIRD_ID)
    assert.equal(consentPromoted.status, 'awaiting_consent')
    assert.equal(consentPromoted.invoiceId, null)
    // Yedeğin iptali yer boşaltmaz: asil yerinde kalır.
    assert.equal((await rowOf(t, waiting, SECOND_ID)).status, 'active')

    // Ayrılıştan sonra yer açılınca ayrılan öğrenci geri gelmez, taksiti açılmaz.
    const second = await rowOf(t, waiting, SECOND_ID)
    await cancel(t, second)
    assert.equal((await rowOf(t, waiting, FIRST_ID)).status, 'cancelled')
    const firstOpen = (await activityInvoices(t, FIRST_ID)).filter((row) => !row.archivedAt)
    assert.deepEqual(firstOpen, [], 'ayrılan öğrencide açık etkinlik taksiti yok')
  })

  test('K-396: ayrılış günündeki etkinlikte kalan yedek asile geçmez; toplu ekleme ayrılanı atlar', async () => {
    const t = await institution()
    const sameDay = await create(t, SAME_DAY)
    await join(t, sameDay, SECOND_ID)
    const firstWaiting = await join(t, sameDay, FIRST_ID)
    await join(t, sameDay, THIRD_ID)

    await withdraw(t)
    // Etkinlik ayrılış günü: ayrılıştan sonra değildir, yedek katılım kalır (K-395 sınırı).
    const kept = await rowOf(t, sameDay, FIRST_ID)
    assert.equal(kept.id, firstWaiting.id)
    assert.equal(kept.status, 'waitlisted')

    // Yer açılınca etkin olmayan öğrencinin yedeği atlanır, sıradaki geçer (K-396).
    await cancel(t, await rowOf(t, sameDay, SECOND_ID))
    assert.equal((await rowOf(t, sameDay, FIRST_ID)).status, 'waitlisted')
    const third = await rowOf(t, sameDay, THIRD_ID)
    assert.equal(third.status, 'active')
    assert.ok(third.invoiceId)
    assert.deepEqual(await activityInvoices(t, FIRST_ID), [])

    // Toplu katılım yalnız etkin öğrencileri yazar (K-371, K-396).
    const bulkActivity = await create(t, {
      ...TRIP,
      name: 'Test sınıf gezisi',
      capacity: C1.length + 1,
    })
    const bulk = await ok(
      await call(
        'POST',
        `${ACTIVITIES}/${bulkActivity}/participants/bulk`,
        t.cookie,
        { classIds: ['c1'] },
        key(),
      ),
      201,
    )
    assert.equal(bulk.activeCount, C1.length - 1)
    assert.ok(!(bulk.skippedStudentIds as string[]).includes(FIRST_ID))
    assert.ok(!(await rows(t, bulkActivity)).some((row) => row.studentId === FIRST_ID))
    assert.deepEqual(await activityInvoices(t, FIRST_ID), [])
  })
})
