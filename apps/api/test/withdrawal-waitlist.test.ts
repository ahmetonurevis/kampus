import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertParticipant } from '../src/db/finance-paid-activities.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { paidActivityParticipants } from '../src/db/schema/finance-paid-activities.ts'
import { invoices } from '../src/db/schema/invoices.ts'
import { records } from '../src/db/schema/records.ts'
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
/** Etkinlik ayrılış günü: taksitsiz katılım da ayrılışla kapanır (K-418); asil kalır (K-348). */
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

  /**
   * ON-346 öncesi ayrılıştan kalmış gibi: ayrılışın iptal ettiği taksitsiz katılımı canlı duruma
   * döndürür (eski kayıt; K-419 temizliği ve K-418 denetimi için).
   */
  const reviveLegacy = async (participantId: string, status: 'waitlisted' | 'awaiting_consent') =>
    db
      .update(paidActivityParticipants)
      .set({
        status,
        cancelKind: null,
        cancelledDate: null,
        paidCents: null,
        retainedCents: null,
        cancelledByUserId: null,
      })
      .where(eq(paidActivityParticipants.id, participantId))
  /** Ayrılmış öğrenciye eski kayıt olarak taksitsiz katılım ekler (ON-346 öncesi). */
  const plantLegacy = async (
    t: { id: string; admin: { id: string } },
    activityId: string,
    status: 'waitlisted' | 'awaiting_consent',
    waitlistPosition: number | null = null,
  ) => {
    const id = randomUUID()
    await insertParticipant(db, t.id, {
      id,
      activityId,
      studentId: FIRST_ID,
      invoiceId: null,
      feeCents: TRIP.feeCents,
      joinedDate: '2026-09-30',
      status,
      waitlistPosition,
      consentStatus: 'pending',
      createdByUserId: t.admin.id,
      now: FIXED_NOW,
    })
    return id
  }

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

  test('K-418, K-396: ayrılış günündeki etkinlikte taksitsiz katılım kapanır; kalan yedek asile geçmez; toplu ekleme ayrılanı atlar', async () => {
    const t = await institution()
    const sameDay = await create(t, SAME_DAY)
    await join(t, sameDay, SECOND_ID)
    const firstWaiting = await join(t, sameDay, FIRST_ID)
    await join(t, sameDay, THIRD_ID)

    await withdraw(t)
    // Etkinlik ayrılış günü: yedek katılım da ayrılışla parasız kapanır (K-418, K-395 sınırı).
    const closed = await rowOf(t, sameDay, FIRST_ID)
    assert.equal(closed.id, firstWaiting.id)
    assert.equal(closed.status, 'cancelled')
    assert.equal(closed.cancelledDate, TODAY)
    // Yedeğin iptali yer boşaltmaz.
    assert.equal((await rowOf(t, sameDay, SECOND_ID)).status, 'active')

    // ON-346 öncesi ayrılıştan kalan satır: yer açılınca etkin olmayan öğrencinin yedeği atlanır,
    // sıradaki geçer (K-396).
    await reviveLegacy(firstWaiting.id as string, 'waitlisted')
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

  test('K-418: ayrılış günündeki etkinlikte eski kaydın elle izni 422, taksit açılmaz', async () => {
    const t = await institution()
    const consent = await create(t, { ...SAME_DAY, requiresConsent: true, capacity: 2 })
    const firstConsent = await join(t, consent, FIRST_ID)
    assert.equal(firstConsent.status, 'awaiting_consent')

    await withdraw(t)
    // Ayrılış günündeki izin bekleyen katılım ayrılışla parasız kapanır (K-418).
    assert.equal((await rowOf(t, consent, FIRST_ID)).status, 'cancelled')

    // ON-346 öncesi ayrılıştan kalan satır: aynı gün elle izin kaydedilemez.
    await reviveLegacy(firstConsent.id as string, 'awaiting_consent')
    const legacy = await rowOf(t, consent, FIRST_ID)
    const response = await call(
      'POST',
      `${PARTICIPANTS}/${legacy.id}/consent`,
      t.cookie,
      { channel: 'paper', grantorName: 'Test İzin Velisi' },
      { 'if-match': `"${String(legacy.version)}"`, ...key() },
    )
    assert.equal(response.statusCode, 422, response.body)
    assert.equal(response.json().code, 'paid_activity_student_inactive')
    // Kayıt değişmez, ayrılan öğrenciye etkinlik taksiti açılmaz.
    assert.deepEqual(await rowOf(t, consent, FIRST_ID), legacy)
    assert.deepEqual(await activityInvoices(t, FIRST_ID), [])
    // Etkin öğrencinin aynı gün izni taksit açar.
    const second = await join(t, consent, SECOND_ID)
    const granted = await ok(
      await call(
        'POST',
        `${PARTICIPANTS}/${String(second.id)}/consent`,
        t.cookie,
        { channel: 'phone', grantorName: 'Test İzin Velisi' },
        { 'if-match': `"${String(second.version)}"`, ...key() },
      ),
    )
    assert.equal(granted.status, 'active')
    assert.ok(granted.invoiceId)
  })

  test('K-418, IST-067: form eşitlemesi etkin olmayanın izin bekleyen katılımını sessizce iptal eder, taksit açmaz', async () => {
    const t = await institution()
    const parentCookie = async (studentId: string) =>
      signInAs(app, await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: studentId }]))
    const form = await ok(
      await call(
        'POST',
        '/api/v1/permission-forms',
        t.cookie,
        {
          topic: 'trip',
          title: 'Test tiyatro izni',
          description: 'Tiyatro gösterisi.',
          deadline: TODAY,
          studentIds: [FIRST_ID, SECOND_ID],
        },
        key(),
      ),
      201,
    )
    const activity = await create(t, {
      ...SAME_DAY,
      requiresConsent: true,
      permissionFormId: form.id,
    })
    const first = await join(t, activity, FIRST_ID)
    const second = await join(t, activity, SECOND_ID)
    assert.deepEqual([first.status, second.status], ['awaiting_consent', 'waitlisted'])
    for (const studentId of [FIRST_ID, SECOND_ID])
      await ok(
        await call(
          'POST',
          `/api/v1/permission-forms/${String(form.id)}/decisions`,
          await parentCookie(studentId),
          { studentId, decision: 'approved' },
          key(),
        ),
        201,
      )
    // Öğrenci etkinliğini yitirir (ON-346 öncesi ayrılış ya da mezuniyet; kayıt pasif).
    await db
      .update(records)
      .set({ data: sql`${records.data} || '{"isActive": false}'::jsonb` })
      .where(
        and(
          eq(records.institutionId, t.id),
          eq(records.collection, 'students'),
          eq(records.id, FIRST_ID),
        ),
      )

    const synced = await ok(
      await call('POST', `${ACTIVITIES}/${activity}/consents/sync`, t.cookie, undefined, key()),
    )
    assert.deepEqual(
      [
        synced.grantedCount,
        synced.withdrawnCount,
        synced.inactiveCancelledCount,
        synced.promotedCount,
      ],
      [1, 0, 1, 1],
    )
    const closed = await rowOf(t, activity, FIRST_ID)
    assert.equal(closed.status, 'cancelled')
    assert.equal(closed.cancelKind, 'participant')
    assert.equal(closed.consentStatus, 'pending')
    assert.equal(closed.invoiceId, null)
    const audit = (await auditsOf(t, closed.id)).find(
      (item) => item.action === 'paid_activity.participant_cancel',
    )
    assert.equal(audit?.changes?.reason, 'student_inactive')
    assert.deepEqual(await activityInvoices(t, FIRST_ID), [])
    // Boşalan yere izni formdan gelen yedek geçer, taksiti açılır (K-369).
    const promoted = await rowOf(t, activity, SECOND_ID)
    assert.equal(promoted.status, 'active')
    assert.equal(promoted.consentChannel, 'permission_form')
    assert.ok(promoted.invoiceId)
    // İkinci eşitleme bir şey değiştirmez.
    const again = await ok(
      await call('POST', `${ACTIVITIES}/${activity}/consents/sync`, t.cookie, undefined, key()),
    )
    assert.deepEqual([again.grantedCount, again.inactiveCancelledCount], [0, 0])
  })

  test('K-419: ayrılıştan kalan katılımlar listelenir ve yönetici onayıyla parasız iptal edilir; başka kurum 404', async () => {
    const LEFTOVERS = `${PARTICIPANTS}/withdrawn-leftovers`
    const t = await institution()
    const other = await institution()
    await withdraw(t)
    await withdraw(other)
    // ON-346 öncesi ayrılıştan kalmış satırlar: izin bekleyen (yer tutar), yedek ve ayrılış günü.
    const consent = await create(t, { ...TRIP, requiresConsent: true })
    const legacyConsent = await plantLegacy(t, consent, 'awaiting_consent')
    const secondWaiting = await join(t, consent, SECOND_ID)
    assert.equal(secondWaiting.status, 'waitlisted')
    const waiting = await create(t, {
      ...TRIP,
      name: 'Test planetaryum',
      activityDate: '2026-10-21',
    })
    const secondSeat = await join(t, waiting, SECOND_ID)
    const legacyWaiting = await plantLegacy(t, waiting, 'waitlisted', 90)
    const sameDay = await create(t, { ...SAME_DAY, requiresConsent: true })
    const legacySameDay = await plantLegacy(t, sameDay, 'awaiting_consent')
    // Başka kurumun kalan satırı.
    const otherActivity = await create(other, { ...TRIP, requiresConsent: true })
    const otherLegacy = await plantLegacy(other, otherActivity, 'awaiting_consent')
    const otherBefore = await rows(other, otherActivity)

    const listed = await call('GET', LEFTOVERS, t.cookie)
    assert.equal(listed.statusCode, 200, listed.body)
    const items = listed.json().data as Json[]
    assert.deepEqual(
      items.map((item) => [item.id, item.status, item.activityDate, item.withdrawalDate]),
      [
        [legacySameDay, 'awaiting_consent', TODAY, TODAY],
        [legacyConsent, 'awaiting_consent', '2026-10-20', TODAY],
        [legacyWaiting, 'waitlisted', '2026-10-21', TODAY],
      ],
    )
    assert.equal(listed.json().meta.total, 3)
    assert.ok(!items.some((item) => item.id === otherLegacy))
    // Ön büro kalanları göremez ve kapatamaz.
    const front = await signInAs(app, await createMember(app, t.id, 'onburo', []))
    assert.equal((await call('GET', LEFTOVERS, front)).statusCode, 403)
    const body = { participantIds: [legacyConsent, legacyWaiting, legacySameDay] }
    assert.equal((await call('POST', `${LEFTOVERS}/cancel`, front, body, key())).statusCode, 403)
    // Başka kurumun katılımı 404; hiçbiri iptal edilmez, B değişmez.
    const crossed = await call(
      'POST',
      `${LEFTOVERS}/cancel`,
      t.cookie,
      { participantIds: [legacyConsent, otherLegacy] },
      key(),
    )
    assert.equal(crossed.statusCode, 404, crossed.body)
    assert.equal((await rowOf(t, consent, FIRST_ID)).status, 'awaiting_consent')
    assert.deepEqual(await rows(other, otherActivity), otherBefore)
    // Ölçüt dışı (etkin öğrencinin asil katılımı) 422; gövde hatası 400; anahtarsız 400.
    const ineligible = await call(
      'POST',
      `${LEFTOVERS}/cancel`,
      t.cookie,
      { participantIds: [legacyConsent, String(secondSeat.id)] },
      key(),
    )
    assert.equal(ineligible.statusCode, 422, ineligible.body)
    assert.equal(ineligible.json().code, 'paid_activity_leftover_not_eligible')
    assert.equal(
      (await call('POST', `${LEFTOVERS}/cancel`, t.cookie, { participantIds: [] }, key()))
        .statusCode,
      400,
    )
    assert.equal((await call('POST', `${LEFTOVERS}/cancel`, t.cookie, body)).statusCode, 400)
    assert.equal((await rowOf(t, consent, FIRST_ID)).status, 'awaiting_consent')

    const idempotency = key()
    const done = await ok(await call('POST', `${LEFTOVERS}/cancel`, t.cookie, body, idempotency))
    assert.deepEqual(done.cancelledIds, body.participantIds)
    assert.equal(done.promotedCount, 1)
    for (const [activityId, participantId] of [
      [consent, legacyConsent],
      [waiting, legacyWaiting],
      [sameDay, legacySameDay],
    ] as const) {
      const row = await rowOf(t, activityId, FIRST_ID)
      assert.equal(row.id, participantId)
      assert.equal(row.status, 'cancelled')
      assert.equal(row.cancelKind, 'participant')
      assert.equal(row.cancelledDate, TODAY)
      assert.deepEqual([row.paidCents, row.retainedCents, row.refundCents], [0, 0, 0])
      assert.equal(row.invoiceId, null)
      const audit = (await auditsOf(t, participantId)).find(
        (item) => item.action === 'paid_activity.participant_cancel',
      )
      assert.equal(audit?.changes?.reason, 'student_withdrawal')
    }
    assert.deepEqual(await activityInvoices(t, FIRST_ID), [])
    // İzin bekleyenin boşalttığı yere yedek izin bekleyen olarak geçer, taksit izinle açılır.
    const promoted = await rowOf(t, consent, SECOND_ID)
    assert.equal(promoted.status, 'awaiting_consent')
    assert.equal(promoted.invoiceId, null)
    // Yedeğin iptali yer boşaltmaz; asil yerinde.
    assert.equal((await rowOf(t, waiting, SECOND_ID)).status, 'active')
    // Aynı anahtarla tekrar aynı yanıt; yeni anahtarla 409, liste boş, B değişmez.
    const replay = await call('POST', `${LEFTOVERS}/cancel`, t.cookie, body, idempotency)
    assert.equal(replay.statusCode, 200, replay.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const repeated = await call('POST', `${LEFTOVERS}/cancel`, t.cookie, body, key())
    assert.equal(repeated.statusCode, 409, repeated.body)
    assert.equal(repeated.json().code, 'paid_activity_participation_cancelled')
    assert.equal((await call('GET', LEFTOVERS, t.cookie)).json().meta.total, 0)
    assert.deepEqual(await rows(other, otherActivity), otherBefore)
    assert.equal((await call('GET', LEFTOVERS, other.cookie)).json().meta.total, 1)
  })
})
