import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertScholarshipAward } from '../src/db/finance-scholarships.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { insertWithdrawal } from '../src/db/withdrawals.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { paidActivityParticipants } from '../src/db/schema/finance-paid-activities.ts'
import { invoices } from '../src/db/schema/invoices.ts'
import { studentWithdrawals } from '../src/db/schema/withdrawals.ts'
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
  insertTestScholarshipProgram,
  insertTestTariff,
  TEST_REFUND_BANK_ACCOUNT_ID,
  TEST_SCHOLARSHIP_PROGRAM_ID,
} from './support/finance-terms.ts'

/**
 * ON-342: ayrılış hesabında kesilen ya da geri istenen burs (K-350, K-351) ve gezi/etkinlik
 * katılımları (K-348, K-349). Her test kendi kurumunu kurar: öğrenci, veli, 100.000 ₺ ilanlı ve
 * 30.000 ₺ burslu sözleşme, dört eşit öğrenim taksiti (17.500 ₺; burs payı 7.500 ₺). Saat ve
 * İstanbul günü 2026-10-06.
 */

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const SID = STUDENT?.id ?? ''
const CONTRACT_ID = 'test-on342-contract'
const SHARE = 750_000
const TUITION = 1_750_000
const NET = 4 * TUITION
const DUES = ['2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15']
const AWARDS = '/api/v1/finance/scholarship-awards'
const ACTIVITIES = '/api/v1/finance/paid-activities'
const TODAY = '2026-10-06'
const QUOTE = {
  withdrawalDate: TODAY,
  termStartDate: '2026-09-07',
  attendedUnits: 20,
  totalUnits: 180,
}
const WITHDRAW = { ...QUOTE, reason: 'relocation', targetSchool: 'Test Okulu' }
/** Etkinlik ayrılıştan sonra, son iptal günü içinde: alınan tutar tam iade (K-348). */
const UPCOMING = {
  name: 'Test müze gezisi',
  kind: 'trip',
  activityDate: '2026-10-20',
  feeCents: 300_000,
  joinDeadline: '2026-10-15',
  cancelDeadline: '2026-10-10',
  capacity: 5,
  lateRefundRule: 'percent',
  lateRefundPercent: 50,
  lateCostCents: null,
}
/** Etkinlik ayrılış günü: gerçekleşmiş sayılır, ödenmemiş kısım borç kalır (K-348). */
const SAME_DAY = {
  ...UPCOMING,
  name: 'Test tiyatro',
  kind: 'event',
  activityDate: TODAY,
  joinDeadline: TODAY,
  cancelDeadline: TODAY,
  feeCents: 150_000,
}

describe('ON-342: ayrılışta kesilen burs ve etkinlik katılımları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(STUDENT)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution() {
    const created = await createInstitution(app)
    assert.ok(STUDENT)
    await insertTestTariff(db, created.id)
    await insertTestScholarshipProgram(db, created.id)
    await insertRefundBankAccount(db, created.id)
    const awardId = randomUUID()
    await insertScholarshipAward(db, created.id, {
      id: awardId,
      programId: TEST_SCHOLARSHIP_PROGRAM_ID,
      studentId: SID,
      academicYear: 2026,
      amountCents: 4 * SHARE,
      awardedByUserId: 'u-test',
      now: FIXED_NOW,
    })
    const invoiceIds = DUES.map((_, index) => `test-on342-inv-${String(index + 1)}`)
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
            invoiceIds,
            academicYear: 2026,
            ...contractTerms({ grossCents: 10_000_000, netCents: NET }),
            scholarship: { programId: TEST_SCHOLARSHIP_PROGRAM_ID, amountCents: 4 * SHARE },
          },
        },
        ...DUES.map((due, index) => ({
          collection: 'invoices' as const,
          id: invoiceIds[index] ?? '',
          data: {
            id: invoiceIds[index],
            studentId: SID,
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
    return { ...created, awardId, cookie: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const call = (
    method: 'GET' | 'POST',
    target: string,
    cookie: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url: target,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
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

  async function endScholarship(t: Tenant, kind: 'terminate' | 'revoke', body: Json) {
    const preview = await ok(
      await call(
        'POST',
        `${AWARDS}/${t.awardId}/end-quote`,
        t.cookie,
        kind === 'terminate' ? { kind, effectiveDate: body.effectiveDate } : { kind },
      ),
    )
    await ok(
      await call(
        'POST',
        `${AWARDS}/${t.awardId}/${kind}`,
        t.cookie,
        { ...body, confirmedCents: preview.totalCents },
        { 'if-match': '"1"', ...key() },
      ),
      201,
    )
    return preview
  }

  async function join(t: Tenant, activity: Json) {
    const created = await ok(await call('POST', ACTIVITIES, t.cookie, activity), 201)
    return ok(
      await call(
        'POST',
        `${ACTIVITIES}/${String(created.id)}/participants`,
        t.cookie,
        { studentId: SID },
        key(),
      ),
      201,
    )
  }

  async function pay(t: Tenant, invoiceId: string, amountCents: number) {
    await ok(
      await call(
        'POST',
        '/api/v1/payments',
        t.cookie,
        {
          studentId: SID,
          invoiceId,
          amountCents,
          method: 'Banka havalesi',
          reference: `TR-ON342-${randomUUID().slice(0, 8)}`,
          bankAccountId: TEST_REFUND_BANK_ACCOUNT_ID,
        },
        key(),
      ),
      201,
    )
  }

  const participantRows = (institutionId: string) =>
    db
      .select()
      .from(paidActivityParticipants)
      .where(eq(paidActivityParticipants.institutionId, institutionId))
  const invoiceRows = (institutionId: string) =>
    db
      .select({ id: invoices.id, archivedAt: invoices.archivedAt, feeKind: invoices.feeKind })
      .from(invoices)
      .where(and(eq(invoices.institutionId, institutionId), eq(invoices.studentId, SID)))

  test('K-348…K-351: geri istenen burs ve etkinlik dökümde ayrı; ayrılış katılımı iptal eder, alacağı bırakır', async () => {
    const t = await institution()
    const revoke = await endScholarship(t, 'revoke', { note: 'Gelir belgesi gerçeğe aykırı.' })
    const upcoming = await join(t, UPCOMING)
    await pay(t, String(upcoming.invoiceId), 100_000)
    const sameDay = await join(t, SAME_DAY)
    const invoicesBefore = await invoiceRows(t.id)
    const participantsBefore = await participantRows(t.id)

    const quote = await ok(
      await call('POST', `/api/v1/students/${SID}/withdrawal-quote`, t.cookie, QUOTE),
    )
    const breakdown = quote.breakdown as Json & {
      contracts: Json[]
      scholarshipClawbacks: Json[]
      activities: Json[]
    }
    // Önizleme hiçbir kayıt yazmaz.
    assert.deepEqual(await invoiceRows(t.id), invoicesBefore)
    assert.deepEqual(await participantRows(t.id), participantsBefore)

    // K-350: iptalde istisna kalkar; kalkan üç pay (2.250.000) tabana eklenir.
    assert.equal(breakdown.scholarshipExempt, false)
    assert.deepEqual(breakdown.contracts[0]?.scholarshipEnd, {
      kind: 'revoke',
      effectiveDate: TODAY,
      reinstatedCents: 3 * SHARE,
    })
    const base = NET + 3 * SHARE
    assert.equal(breakdown.baseCents, base)
    const entitled = base / 10 + Math.floor((base * 20) / 180)
    assert.equal(breakdown.entitledCents, entitled)
    assert.equal(breakdown.paidCents, 0)
    // K-351: geri isteme ayrı satırdır; bakiyeye girmez (çift sayım yok).
    assert.deepEqual(breakdown.scholarshipClawbacks, [
      {
        awardId: t.awardId,
        contractId: CONTRACT_ID,
        effectiveDate: TODAY,
        principalCents: revoke.principalCents,
        interestCents: revoke.interestCents,
        openCents: Number(revoke.principalCents) + Number(revoke.interestCents),
      },
    ])
    assert.equal(breakdown.debtCents, entitled)
    assert.equal(breakdown.refundCents, 0)
    // K-348: ayrılış günündeki etkinlik gerçekleşmiştir; sonraki tam iadeyle iptal edilir.
    assert.deepEqual(
      breakdown.activities.map((line) => [
        line.participantId,
        line.outcome,
        line.paidCents,
        line.refundCents,
        line.openCents,
      ]),
      [
        [sameDay.id, 'held', 0, 0, 150_000],
        [upcoming.id, 'cancelled', 100_000, 100_000, 0],
      ],
    )

    const response = await call(
      'POST',
      `/api/v1/students/${SID}/withdraw`,
      t.cookie,
      WITHDRAW,
      key(),
    )
    const withdrawal = await ok(response, 201)
    const stored = withdrawal.breakdown as Json
    assert.deepEqual(
      { ...stored, debtInvoiceId: undefined },
      { ...breakdown, debtInvoiceId: undefined },
    )
    assert.equal(withdrawal.debtCents, entitled)

    const participants = await participantRows(t.id)
    const cancelled = participants.find((row) => row.id === upcoming.id)
    assert.equal(cancelled?.status, 'cancelled')
    assert.equal(cancelled?.cancelKind, 'participant')
    assert.equal(cancelled?.cancelledDate, TODAY)
    assert.equal(cancelled?.paidCents, 100_000)
    assert.equal(cancelled?.retainedCents, 0)
    assert.equal(cancelled?.refundCents, 100_000)
    assert.equal(cancelled?.closedInvoiceId, upcoming.invoiceId)
    assert.equal(participants.find((row) => row.id === sameDay.id)?.status, 'active')

    const after = new Map((await invoiceRows(t.id)).map((row) => [row.id, row]))
    assert.ok(
      after.get(String(upcoming.invoiceId))?.archivedAt,
      'iptal edilen katılımın taksiti kapanır',
    )
    assert.equal(after.get(String(sameDay.invoiceId))?.archivedAt, null)
    const clawbackIds = invoicesBefore
      .filter((row) => row.feeKind === 'tuition' && !row.id.startsWith('test-on342-inv-'))
      .map((row) => row.id)
    assert.ok(clawbackIds.length >= 2)
    // Geri isteme alacağı ayrılışta iptal edilmez (K-266); kalkan payın taksitleri iptal edilir.
    const left = clawbackIds.filter((id) => after.get(id)?.archivedAt === null)
    assert.equal(left.length, Number(revoke.interestCents) > 0 ? 2 : 1)

    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, String(upcoming.id))))
    assert.ok(audits.some((row) => row.action === 'paid_activity.participant_cancel'))
    const [withdrawAudit] = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'student.withdraw')))
    assert.deepEqual((withdrawAudit?.changes as { fields: string[] }).fields.slice(-2), [
      'scholarshipClawbacks',
      'activities',
    ])

    // Katılım iadesi katılım kaydından ödenir (K-303, K-349).
    const refund = await ok(
      await call(
        'POST',
        `/api/v1/finance/paid-activity-participants/${String(upcoming.id)}/pay-refund`,
        t.cookie,
        {
          paidDate: TODAY,
          iban: 'TR330006100519786457841326',
          accountHolder: 'Test Ödeyici Veli',
          bankAccountId: TEST_REFUND_BANK_ACCOUNT_ID,
        },
        { 'if-match': `"${String(cancelled?.version)}"`, ...key() },
      ),
    )
    assert.equal(refund.refundStatus, 'paid')
  })

  test('K-350: kesme günü ayrılış günüyse öğrenci burslu sayılır; istisna sürer, taban net', async () => {
    const t = await institution()
    await endScholarship(t, 'terminate', {
      reason: 'discipline',
      note: 'Disiplin kurulu kararı.',
      effectiveDate: TODAY,
    })
    const quote = await ok(
      await call('POST', `/api/v1/students/${SID}/withdrawal-quote`, t.cookie, QUOTE),
    )
    const breakdown = quote.breakdown as Json & { contracts: Json[] }
    assert.equal(breakdown.scholarshipExempt, true)
    assert.equal(breakdown.contracts[0]?.scholarshipEnd, undefined)
    assert.equal(breakdown.baseCents, NET)
    // Ödeme yok: burslu istisnasıyla hak edilen sıfır, borç yok.
    assert.equal(breakdown.entitledCents, 0)
    assert.equal(breakdown.debtCents, 0)
    assert.equal(breakdown.scholarshipClawbacks, undefined)
    assert.equal(breakdown.activities, undefined)
  })

  test('DOM-FIN-041: tamamlanmış ayrılış kaydı değişmez; eski döküm yeni alanlar olmadan okunur', async () => {
    const t = await institution()
    const sameDay = await join(t, SAME_DAY)
    const withdrawal = await ok(
      await call('POST', `/api/v1/students/${SID}/withdraw`, t.cookie, WITHDRAW, key()),
      201,
    )
    const [before] = await db
      .select()
      .from(studentWithdrawals)
      .where(eq(studentWithdrawals.institutionId, t.id))
    // Sonradan gerçekleşmiş etkinliğin borcu ödenir; kayıtlı döküm yeniden hesaplanmaz.
    await pay(t, String(sameDay.invoiceId), 150_000)
    const read = await ok(
      await call('GET', `/api/v1/withdrawals/${String(withdrawal.id)}`, t.cookie),
    )
    assert.deepEqual(read.breakdown, withdrawal.breakdown)
    const [afterRow] = await db
      .select()
      .from(studentWithdrawals)
      .where(eq(studentWithdrawals.institutionId, t.id))
    assert.deepEqual(afterRow, before)

    // ON-342 öncesi kayıt: döküm yeni alanları taşımaz, okuma onları uydurmaz.
    const legacyId = randomUUID()
    const legacy = {
      institutionType: 'school' as const,
      withdrawalDate: '2026-09-01',
      termStartDate: '2026-09-07',
      started: false,
      attendedUnits: 0,
      totalUnits: 180,
      publicSchoolExemption: false,
      deductionBasisPoints: 1_000,
      baseCents: NET,
      deductionCents: NET / 10,
      usageCents: 0,
      entitledCents: NET / 10,
      paidCents: 0,
      creditCents: 0,
      extras: [],
      refundCents: 0,
      debtCents: NET / 10,
    }
    await insertWithdrawal(db, t.id, {
      id: legacyId,
      studentId: SID,
      contractId: 'test-on342-old-contract',
      withdrawalDate: '2026-09-01',
      reason: 'relocation',
      targetSchool: null,
      breakdown: legacy,
      refundDueDate: '2026-10-01',
      approvedByUserId: 'u-test',
      now: FIXED_NOW,
    })
    const old = await ok(await call('GET', `/api/v1/withdrawals/${legacyId}`, t.cookie))
    assert.deepEqual(old.breakdown, legacy)
  })
})
