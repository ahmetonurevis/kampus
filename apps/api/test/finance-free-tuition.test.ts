import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertScholarshipAward } from '../src/db/finance-scholarships.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  freeTuitionApplications,
  freeTuitionAwards,
  freeTuitionBoardMeetings,
  freeTuitionRounds,
} from '../src/db/schema/finance-free-tuition.ts'
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
  contractTerms,
  insertRefundBankAccount,
  insertTestScholarshipProgram,
  insertTestTariff,
  TEST_REFUND_BANK_ACCOUNT_ID,
  TEST_SCHOLARSHIP_PROGRAM_ID,
} from './support/finance-terms.ts'

/**
 * Ücretsiz okutma uçları (DOM-FIN-026; IST-105; K-268…K-271). Her test kendi kurumunu kurar: bir
 * öğrenci, 2026 sözleşmesi (net 100.000 ₺), iki öğrenim taksiti ve bir yemek taksiti. FIXED_NOW
 * 2026-10-06; ilk öğrenim taksiti ödenmiştir.
 */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const STUDENT_ID = STUDENT?.id ?? ''
const PARENT_NAME = 'Test Ödeyici Veli'
const NET = 10_000_000
const BASE = '/api/v1/finance/free-tuition'
const IBAN = 'TR330006100519786457841326'
const MEMBERS = [
  { name: 'Test Müdür', title: 'Müdür (başkan)' },
  { name: 'Test Öğretmen', title: 'Öğretmen' },
  { name: 'Test Rehber', title: 'Rehber öğretmen' },
]
const invoice = (id: string, installment: number, amount: number, feeKind = 'tuition') => ({
  id,
  studentId: STUDENT_ID,
  installment,
  amount,
  dueDate: '2026-09-15T09:00:00.000Z',
  paidAt: null,
  method: null,
  reminderAt: null,
  feeKind,
})

describe('ücretsiz okutma uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const logs: string[] = []
  const key = () => ({ 'idempotency-key': `test-ft-${String(++serial).padStart(5, '0')}` })
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(STUDENT)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW, logs })
  })
  after(async () => {
    await app.close()
    await close()
  })

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
        {
          collection: 'parents',
          id: STUDENT?.parentId ?? '',
          data: { id: STUDENT?.parentId, name: PARENT_NAME, studentIds: [STUDENT_ID] },
        },
        {
          collection: 'contracts',
          id: 'test-contract',
          data: {
            id: 'test-contract',
            studentId: STUDENT_ID,
            date: '2026-06-01T09:00:00.000Z',
            amount: NET + 1_000_000,
            title: 'Sözleşme',
            academicYear: 2026,
            invoiceIds: ['test-inv-1', 'test-inv-2', 'test-inv-meal'],
            ...contractTerms({ grossCents: NET, netCents: NET }),
          },
        },
        { collection: 'invoices', id: 'test-inv-1', data: invoice('test-inv-1', 1, NET / 2) },
        { collection: 'invoices', id: 'test-inv-2', data: invoice('test-inv-2', 2, NET / 2) },
        {
          collection: 'invoices',
          id: 'test-inv-meal',
          data: invoice('test-inv-meal', 3, 1_000_000, 'meal'),
        },
      ],
      FIXED_NOW,
    )
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role, []))
  const pay = async (cookie: string, amountCents: number) => {
    const response = await send(
      'POST',
      '/api/v1/payments',
      cookie,
      {
        studentId: STUDENT_ID,
        amountCents,
        method: 'Banka havalesi',
        reference: `TR-FT-${String(++serial)}`,
        bankAccountId: TEST_REFUND_BANK_ACCOUNT_ID,
      },
      key(),
    )
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as { id: string; version: number }
  }
  const createRound = (cookie: string | null, body: unknown = ROUND) =>
    send('POST', `${BASE}/rounds`, cookie, body)
  const ROUND = { academicYear: 2026, teachingStartDate: '2026-09-08' }
  const confirm = (cookie: string | null, roundId: string, quota: number, at = 1) =>
    send(
      'POST',
      `${BASE}/rounds/${roundId}/confirm-quota`,
      cookie,
      { confirmedQuota: quota },
      version(at),
    )
  const apply = (cookie: string | null, roundId: string, body: unknown = APPLICATION) =>
    send('POST', `${BASE}/rounds/${roundId}/applications`, cookie, body)
  const APPLICATION = {
    studentId: STUDENT_ID,
    reason: 'financial_need',
    documents: ['application_form', 'income_statement'],
  }
  const board = (
    cookie: string | null,
    roundId: string,
    body: unknown,
    headers: Record<string, string> = key(),
  ) => send('POST', `${BASE}/rounds/${roundId}/board-meetings`, cookie, body, headers)
  const decision = (applicationId: string, value = 'accepted') => ({
    meetingDate: '2026-10-01',
    members: MEMBERS,
    decisions: [{ applicationId, decision: value }],
  })

  /** Dönem açık, kontenjan 1, öğrenci aday; ilk öğrenim taksiti ödenmiş. */
  async function ready(overrides: Partial<InstitutionOverrides> = {}) {
    const t = await institution(overrides)
    const payment = await pay(t.cookie, NET / 2)
    const round = (await createRound(t.cookie)).json().data as { id: string }
    assert.equal((await confirm(t.cookie, round.id, 1)).statusCode, 200)
    const created = await apply(t.cookie, round.id)
    assert.equal(created.statusCode, 201, created.body)
    const application = created.json().data as { id: string; version: number }
    return { ...t, payment, roundId: round.id, applicationId: application.id }
  }
  /** Ready + kurul kabulü; hakkı döner. */
  async function awarded() {
    const t = await ready()
    const response = await board(t.cookie, t.roundId, decision(t.applicationId))
    assert.equal(response.statusCode, 201, response.body)
    const awards = await send('GET', `${BASE}/awards`, t.cookie)
    const award = awards.json().data[0] as { id: string; version: number; refundCents: number }
    return { ...t, meetingId: response.json().data.id as string, award }
  }
  const rowsOf = async (institutionId: string) => ({
    rounds: await db
      .select()
      .from(freeTuitionRounds)
      .where(eq(freeTuitionRounds.institutionId, institutionId)),
    applications: await db
      .select()
      .from(freeTuitionApplications)
      .where(eq(freeTuitionApplications.institutionId, institutionId)),
    meetings: await db
      .select()
      .from(freeTuitionBoardMeetings)
      .where(eq(freeTuitionBoardMeetings.institutionId, institutionId)),
    awards: await db
      .select()
      .from(freeTuitionAwards)
      .where(eq(freeTuitionAwards.institutionId, institutionId)),
    invoices: (await loadRecords(db, institutionId, ['invoices'])).map((row) => row.id).sort(),
  })

  test('DOM-FIN-026: oturumsuz 401, ön büro ve öğretmen 403, modül kapalıyken 403; kayıt yazılmaz', async () => {
    const t = await institution()
    assertError(await send('GET', `${BASE}/rounds`, null), 401)
    assertError(await createRound(null), 401)
    for (const role of ['onburo', 'ogretmen'] as const) {
      const cookie = await member(t.id, role)
      assertError(await send('GET', `${BASE}/rounds`, cookie), 403)
      assertError(await send('GET', `${BASE}/awards`, cookie), 403)
      assertError(await createRound(cookie), 403)
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await createRound(closed.cookie), 403, 'module_disabled')
    assertError(await send('GET', `${BASE}/rounds`, closed.cookie), 403, 'module_disabled')
    assert.equal((await rowsOf(t.id)).rounds.length, 0)
    assert.equal((await rowsOf(closed.id)).rounds.length, 0)
  })

  test('K-268: dönem açılır, en az kontenjan canlı hesaplanır, kontenjan kesinleşir; yıl tekrarı 409', async () => {
    const t = await institution()
    const created = await createRound(t.cookie)
    assert.equal(created.statusCode, 201, created.body)
    const round = created.json().data
    assert.equal(round.currentStudentCount, 1)
    assert.equal(round.currentMinimumQuota, 0)
    assert.equal(round.confirmedQuota, null)
    assertError(await createRound(t.cookie), 409, 'free_tuition_round_exists')
    assertError(await createRound(t.cookie, { ...ROUND, teachingStartDate: '2026-13-01' }), 400)
    assertError(await confirm(t.cookie, round.id, 2, 7), 409)
    assertError(
      await send('POST', `${BASE}/rounds/${String(round.id)}/confirm-quota`, t.cookie, {
        confirmedQuota: 2,
      }),
      400,
      'if_match_required',
    )
    const confirmed = await confirm(t.cookie, round.id, 2)
    assert.equal(confirmed.statusCode, 200, confirmed.body)
    assert.deepEqual(
      [confirmed.json().data.confirmedQuota, confirmed.json().data.computedQuota],
      [2, 0],
    )
    const listed = await send('GET', `${BASE}/rounds`, t.cookie)
    assert.equal(listed.json().data.length, 1)
    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityType, 'free_tuition_rounds')))
    assert.deepEqual(audits.map((row) => row.action).sort(), [
      'free_tuition.quota',
      'free_tuition.round_create',
    ])
  })

  test('K-269: aday sabit gerekçe ve belgeyle; mükerrer 409, serbest metin 400, bursu olan 422; kayıt değişmez', async () => {
    const t = await institution()
    const round = (await createRound(t.cookie)).json().data as { id: string }
    assertError(await apply(t.cookie, round.id, { ...APPLICATION, note: 'Aile geliri düşük' }), 400)
    assertError(await apply(t.cookie, round.id, { ...APPLICATION, studentId: 'yok' }), 404)
    assert.equal((await rowsOf(t.id)).applications.length, 0)
    const created = await apply(t.cookie, round.id)
    assert.equal(created.statusCode, 201, created.body)
    assert.deepEqual(created.json().data.documents, ['application_form', 'income_statement'])
    assert.equal(created.json().data.status, 'pending')
    assertError(await apply(t.cookie, round.id), 409, 'free_tuition_application_exists')
    const updated = await send(
      'POST',
      `${BASE}/applications/${String(created.json().data.id)}/documents`,
      t.cookie,
      { documents: ['report_card'] },
      version(1),
    )
    assert.equal(updated.statusCode, 200, updated.body)
    assert.deepEqual(updated.json().data.documents, ['report_card'])
    // Gerekçe ve belge loglanmaz.
    assert.ok(!logs.some((line) => line.includes('financial_need')))

    const other = await institution()
    await insertTestScholarshipProgram(db, other.id)
    await insertScholarshipAward(db, other.id, {
      id: '6e2f8b4d-3c5f-4d9b-8a7e-2b3c4d5e6f70',
      programId: TEST_SCHOLARSHIP_PROGRAM_ID,
      studentId: STUDENT_ID,
      academicYear: 2026,
      amountCents: 100_000,
      awardedByUserId: 'u-yonetici',
      now: FIXED_NOW,
    })
    const otherRound = (await createRound(other.cookie)).json().data as { id: string }
    assertError(await apply(other.cookie, otherRound.id), 422, 'free_tuition_scholarship_conflict')
    assert.equal((await rowsOf(other.id)).applications.length, 0)
  })

  test('DOM-FIN-026, K-270: kurul kabulü açık öğrenim taksitlerini kapatır, alınanı iade kaydına yazar; tekrar aynı yanıt', async () => {
    const t = await ready()
    const headers = key()
    const response = await board(t.cookie, t.roundId, decision(t.applicationId), headers)
    assert.equal(response.statusCode, 201, response.body)
    const meeting = response.json().data
    assert.equal(meeting.decisions[0].decision, 'accepted')
    assert.equal(meeting.decisions[0].studentName, STUDENT?.name)
    const replay = await board(t.cookie, t.roundId, decision(t.applicationId), headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), response.json())

    const rows = await rowsOf(t.id)
    assert.equal(rows.meetings.length, 1)
    assert.equal(rows.awards.length, 1)
    const award = rows.awards[0]
    assert.equal(award?.refundCents, NET / 2)
    assert.equal(award?.waivedCents, NET / 2)
    assert.equal(award?.refundDueDate, '2026-11-08')
    assert.deepEqual(award?.cancelledInvoiceIds, ['test-inv-2'])
    assert.deepEqual(award?.refundedInvoiceIds, ['test-inv-1'])
    // Ödenmemiş öğrenim taksiti kapandı; ödenen taksit ve yemek kaldı.
    assert.deepEqual(rows.invoices, ['test-inv-1', 'test-inv-meal'])
    assert.equal(rows.applications[0]?.status, 'accepted')
    const listed = await send('GET', `${BASE}/awards?refundStatus=pending`, t.cookie)
    assert.equal(listed.json().meta.total, 1)
    assert.equal(listed.json().data[0].maskedIban, null)
    const actions = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.institutionId, t.id))
    for (const action of ['free_tuition.board', 'free_tuition.decision', 'free_tuition.award'])
      assert.ok(
        actions.some((row) => row.action === action),
        action,
      )
  })

  test('K-270: kontenjan aşımı 422, karar verilmiş aday 409, eksik kurul 400; hiçbir kayıt değişmez', async () => {
    const t = await ready()
    await send(
      'POST',
      `${BASE}/rounds/${t.roundId}/confirm-quota`,
      t.cookie,
      { confirmedQuota: 0 },
      version(2),
    )
    assertError(
      await board(t.cookie, t.roundId, decision(t.applicationId)),
      422,
      'free_tuition_quota_exceeded',
    )
    assertError(
      await board(t.cookie, t.roundId, {
        ...decision(t.applicationId),
        members: MEMBERS.slice(0, 2),
      }),
      400,
    )
    const before = await rowsOf(t.id)
    assert.equal(before.meetings.length, 0)
    assert.equal(before.awards.length, 0)
    assert.deepEqual(before.invoices, ['test-inv-1', 'test-inv-2', 'test-inv-meal'])
    // Kurul kararı Idempotency-Key ister.
    assertError(await board(t.cookie, t.roundId, decision(t.applicationId), {}), 400)
    const rejected = await board(t.cookie, t.roundId, decision(t.applicationId, 'rejected'))
    assert.equal(rejected.statusCode, 201, rejected.body)
    assertError(
      await board(t.cookie, t.roundId, decision(t.applicationId, 'reserve')),
      409,
      'free_tuition_application_decided',
    )
    assert.deepEqual((await rowsOf(t.id)).invoices, ['test-inv-1', 'test-inv-2', 'test-inv-meal'])
  })

  test('K-270: iade ödemesi gün sonuna girer; ödeyici dışı 422; tahsilat iptali 409; ek protokol 422', async () => {
    const t = await awarded()
    const refund = (body: unknown, at = t.award.version) =>
      send('POST', `${BASE}/awards/${t.award.id}/pay-refund`, t.cookie, body, {
        ...version(at),
        ...key(),
      })
    const BODY = {
      paidDate: '2026-10-05',
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
      await refund({ ...BODY, paidDate: '2026-09-30' }),
      422,
      'free_tuition_refund_before_award',
    )
    const paid = await refund(BODY)
    assert.equal(paid.statusCode, 200, paid.body)
    assert.equal(paid.json().data.refundStatus, 'paid')
    assert.equal(paid.json().data.maskedIban, 'TR** **** 1326')
    assert.equal(paid.json().data.refundAccountHolder, PARENT_NAME)
    assertError(await refund(BODY, t.award.version + 1), 409, 'refund_already_paid')
    assert.ok(!logs.some((line) => line.includes(IBAN)))

    const day = await send('GET', '/api/v1/finance/day-closings/2026-10-05', t.cookie)
    assert.equal(day.statusCode, 200, day.body)
    const line = day
      .json()
      .data.refunds.find(
        (item: { freeTuitionAwardId: string | null }) => item.freeTuitionAwardId === t.award.id,
      )
    assert.equal(line?.amountCents, NET / 2)
    assert.equal(line?.withdrawalId, null)

    assertError(
      await send(
        'POST',
        `/api/v1/payments/${t.payment.id}/reverse`,
        t.cookie,
        { reason: 'Yanlış kayıt düzeltmesi' },
        { ...version(t.payment.version), ...key() },
      ),
      409,
      'payment_free_tuition_refunded',
    )
    assertError(
      await send(
        'POST',
        '/api/v1/finance/contracts/test-contract/amendments',
        t.cookie,
        { reason: 'Plan değişikliği', installmentCount: 2, firstDueDate: '2026-11-01' },
        // Kabul taksit listesini değiştirdiği için sözleşme ikinci sürümdedir.
        { ...version(2), ...key() },
      ),
      422,
      'contract_free_tuition',
    )
  })

  test('K-270: ücretsiz okutmalı öğrencinin ayrılış hesabı öğrenim ücretini yeniden iade etmez', async () => {
    const t = await awarded()
    const quote = await send('POST', `/api/v1/students/${STUDENT_ID}/withdrawal-quote`, t.cookie, {
      withdrawalDate: '2026-10-05',
      termStartDate: '2026-09-07',
      attendedUnits: 18,
      totalUnits: 180,
    })
    assert.equal(quote.statusCode, 200, quote.body)
    const line = quote.json().data.breakdown.contracts[0]
    assert.equal(line.paidCents, 0)
    assert.equal(line.entitledCents, 0)
  })

  test('K-271: MEBBİS günü bir kez işlenir, işlenmemişler listesi süzülür', async () => {
    const t = await awarded()
    const unrecorded = await send('GET', `${BASE}/awards?mebbis=unrecorded`, t.cookie)
    assert.equal(unrecorded.json().meta.total, 1)
    const url = `${BASE}/awards/${t.award.id}/mebbis-record`
    assertError(
      await send('POST', url, t.cookie, { recordedDate: '2026-10-07' }, version(t.award.version)),
      422,
      'free_tuition_date_future',
    )
    const recorded = await send(
      'POST',
      url,
      t.cookie,
      { recordedDate: '2026-10-06' },
      version(t.award.version),
    )
    assert.equal(recorded.statusCode, 200, recorded.body)
    assert.equal(recorded.json().data.mebbisRecordedDate, '2026-10-06')
    assertError(
      await send(
        'POST',
        url,
        t.cookie,
        { recordedDate: '2026-10-06' },
        version(t.award.version + 1),
      ),
      409,
      'free_tuition_mebbis_recorded',
    )
    assert.equal(
      (await send('GET', `${BASE}/awards?mebbis=unrecorded`, t.cookie)).json().meta.total,
      0,
    )
    const meeting = await send('GET', `${BASE}/board-meetings/${t.meetingId}`, t.cookie)
    assert.equal(meeting.statusCode, 200)
    assert.deepEqual(meeting.json().data.members, MEMBERS)
    const meetings = await send('GET', `${BASE}/rounds/${t.roundId}/board-meetings`, t.cookie)
    assert.equal(meetings.json().data[0].acceptedCount, 1)
  })

  test('DOM-FIN-026: başka kurumun dönemi, adayı, toplantısı ve hakkı 404; listede B yok, gövdedeki institutionId etkisiz', async () => {
    const b = await awarded()
    const a = await institution()
    const bBefore = await rowsOf(b.id)
    // Gövdedeki kurum kimliği okunmaz: katı şema alanı reddeder, B'ye bir şey yazılmaz.
    assertError(await createRound(a.cookie, { ...ROUND, institutionId: b.id }), 400)
    const aRoundId = (await createRound(a.cookie)).json().data.id as string
    const listRounds = await send('GET', `${BASE}/rounds`, a.cookie)
    assert.ok(listRounds.json().data.every((item: { id: string }) => item.id !== b.roundId))
    assertError(await send('GET', `${BASE}/rounds/${b.roundId}/applications`, a.cookie), 404)
    assertError(await send('GET', `${BASE}/rounds/${b.roundId}/board-meetings`, a.cookie), 404)
    assertError(await apply(a.cookie, b.roundId), 404)
    assertError(await confirm(a.cookie, b.roundId, 3), 404)
    assertError(
      await send(
        'POST',
        `${BASE}/applications/${b.applicationId}/documents`,
        a.cookie,
        { documents: [] },
        version(1),
      ),
      404,
    )
    assertError(await board(a.cookie, b.roundId, decision(b.applicationId)), 404)
    assertError(await send('GET', `${BASE}/board-meetings/${b.meetingId}`, a.cookie), 404)
    assertError(
      await send(
        'POST',
        `${BASE}/awards/${b.award.id}/mebbis-record`,
        a.cookie,
        { recordedDate: '2026-10-06' },
        version(b.award.version),
      ),
      404,
    )
    assertError(
      await send(
        'POST',
        `${BASE}/awards/${b.award.id}/pay-refund`,
        a.cookie,
        {
          paidDate: '2026-10-05',
          iban: IBAN,
          accountHolder: PARENT_NAME,
          bankAccountId: TEST_REFUND_BANK_ACCOUNT_ID,
        },
        { ...version(b.award.version), ...key() },
      ),
      404,
    )
    // A'nın kendi dönemindeki kurul kararı B'nin adayını göremez.
    await confirm(a.cookie, aRoundId, 1)
    assertError(await board(a.cookie, aRoundId, decision(b.applicationId)), 404)
    const awards = await send('GET', `${BASE}/awards`, a.cookie)
    assert.equal(awards.json().meta.total, 0)
    assert.deepEqual(await rowsOf(b.id), bBefore)
  })

  test('guvenlik-kvkk: eski oturumla iade ödemesi 403 reauthentication_required', async () => {
    const t = await awarded()
    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(
        await send(
          'POST',
          `${BASE}/awards/${t.award.id}/pay-refund`,
          t.cookie,
          {
            paidDate: '2026-10-05',
            iban: IBAN,
            accountHolder: PARENT_NAME,
            bankAccountId: TEST_REFUND_BANK_ACCOUNT_ID,
          },
          { ...version(t.award.version), ...key() },
          later,
        ),
        403,
        'reauthentication_required',
      )
    } finally {
      await later.close()
    }
  })
})
