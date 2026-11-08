import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import type { WithdrawalBreakdown } from '@kampus/school-core/lib/withdrawals.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
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
import { checkFinanceMirrorAfterEach } from './support/finance-mirror.ts'
import { contractTerms, insertTestTariff } from './support/finance-terms.ts'

/**
 * Açılış nöbeti (`GET /api/v1/finance/opening-watch`; DOM-FIN-061, ON-095). Her test kendi
 * kurumunu kurar. FIXED_NOW 2026-10-06; kurum yılı 2026, yıl kaydı yok → başlangıç 1 Eylül,
 * varsayılan pencere 2026-08-02 … 2026-10-12.
 */

const SEED = createSeed(FIXED_NOW)
const [STUDENT, LEAVER] = SEED.students.filter((item) => item.classId === 'c1')
const NET = 10_000_000
const URL_BASE = '/api/v1/finance/opening-watch'

const invoice = (id: string, studentId: string, installment: number, dueDate: string) => ({
  id,
  studentId,
  installment,
  amount: NET / 2,
  dueDate,
  paidAt: null,
  method: null,
  reminderAt: null,
  feeKind: 'tuition',
  academicYear: 2026,
})

describe('açılış nöbeti', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-ow-${String(++serial).padStart(5, '0')}` })
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(STUDENT && LEAVER)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  /**
   * Kurum: öğrenci (onaysız sözleşme, 1. taksit 2026-09-15 gecikmiş, 2. taksit ileride), yeni
   * sınıfa geçmiş (dönem geçişi 2026-09-07) ve ayrılan öğrenci (2026-09-20; iade ödenmedi).
   */
  async function institution(overrides: Partial<InstitutionOverrides> = {}, prefix = 'test') {
    const created = await createInstitution(app, overrides)
    assert.ok(STUDENT && LEAVER)
    await insertTestTariff(db, created.id)
    const contractId = `${prefix}-contract`
    await insertMissingRecords(
      db,
      created.id,
      [
        { collection: 'classes', id: 'c1', data: { ...SEED.classes.find((c) => c.id === 'c1') } },
        { collection: 'classes', id: 'c2', data: { ...SEED.classes.find((c) => c.id === 'c2') } },
        {
          collection: 'students',
          id: STUDENT.id,
          data: { ...STUDENT, classId: 'c2', name: `${prefix} Öğrenci` },
        },
        {
          collection: 'students',
          id: LEAVER.id,
          data: { ...LEAVER, isActive: false, name: `${prefix} Ayrılan` },
        },
        {
          collection: 'contracts',
          id: contractId,
          data: {
            id: contractId,
            studentId: STUDENT.id,
            date: '2026-08-20T09:00:00.000Z',
            amount: NET,
            title: 'Sözleşme',
            academicYear: 2026,
            invoiceIds: [`${prefix}-inv-1`, `${prefix}-inv-2`],
            ...contractTerms({ grossCents: NET, netCents: NET }),
          },
        },
        {
          collection: 'invoices',
          id: `${prefix}-inv-1`,
          data: invoice(`${prefix}-inv-1`, STUDENT.id, 1, '2026-09-15T09:00:00.000Z'),
        },
        {
          collection: 'invoices',
          id: `${prefix}-inv-2`,
          data: invoice(`${prefix}-inv-2`, STUDENT.id, 2, '2026-11-15T09:00:00.000Z'),
        },
        {
          collection: 'renewals',
          id: `${prefix}-renewal`,
          data: {
            id: `${prefix}-renewal`,
            studentId: STUDENT.id,
            mode: 'renew',
            status: 'Tamamlandı',
            year: 2026,
            fromClassId: 'c1',
            targetClassId: 'c2',
            amount: NET,
            createdAt: '2026-05-01T09:00:00.000Z',
            updatedAt: '2026-09-07T09:00:00.000Z',
            activatedAt: '2026-09-07T09:00:00.000Z',
          },
        },
      ],
      FIXED_NOW,
    )
    await db.insert(studentWithdrawals).values({
      institutionId: created.id,
      id: randomUUID(),
      studentId: LEAVER.id,
      contractId: `${prefix}-leaver-contract`,
      withdrawalDate: '2026-09-20',
      reason: 'relocation',
      targetSchool: null,
      breakdown: { refundCents: 400_000, debtCents: 0 } as unknown as WithdrawalBreakdown,
      refundCents: 400_000,
      debtCents: 0,
      refundDueDate: '2026-10-20',
      approvedByUserId: created.admin.id,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  const member = async (id: string, role: Role) =>
    signInAs(app, await createMember(app, id, role, []))
  const get = (cookie: string | null, query = '') =>
    app.inject({
      method: 'GET',
      url: `${URL_BASE}${query === '' ? '' : `?${query}`}`,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  const pay = (cookie: string, amountCents: number) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', cookie, ...key() },
      payload: JSON.stringify({
        studentId: STUDENT?.id,
        amountCents,
        method: 'Banka havalesi',
        reference: `TR-OW-${String(serial)}`,
      }),
    })
  function assertError(response: Awaited<ReturnType<typeof get>>, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  test('DOM-FIN-061: oturumsuz 401; yönetici ve ön büro okur, diğer roller 403; modül kapalı 403', async () => {
    assertError(await get(null), 401)
    const a = await institution()
    assert.equal((await get(await member(a.id, 'onburo'))).statusCode, 200)
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const)
      assertError(await get(await member(a.id, role)), 403, 'forbidden')
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(closed.cookie), 403, 'module_disabled')
  })

  test('DOM-FIN-061: ilk taksit, onaysız sözleşme, kayıt olayları ve bekleyen iade tek yanıtta', async () => {
    const a = await institution()
    // Kısmi ödeme en eski vadeye düşer; ilk taksitte yalnız kalan görünür (DOM-FIN-030).
    assert.equal((await pay(a.cookie, 1_000_000)).statusCode, 201)
    const response = await get(a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    const data = response.json().data
    assert.equal(data.academicYear, 2026)
    assert.equal(data.today, '2026-10-06')
    assert.deepEqual(
      [data.from, data.to, data.anchorDate],
      ['2026-08-02', '2026-10-12', '2026-09-01'],
    )
    assert.equal(data.renewalModule, true)
    assert.deepEqual(data.terms, [])

    assert.equal(data.firstInstallments.overdueCount, 1)
    assert.equal(data.firstInstallments.overdueCents, NET / 2 - 1_000_000)
    assert.deepEqual(data.firstInstallments.rows, [
      {
        invoiceId: 'test-inv-1',
        studentId: STUDENT?.id,
        studentName: 'test Öğrenci',
        className: SEED.classes.find((c) => c.id === 'c2')?.name,
        contractId: 'test-contract',
        installment: 1,
        dueDate: '2026-09-15',
        amountCents: NET / 2,
        remainingCents: NET / 2 - 1_000_000,
        status: 'overdue',
        overdueDays: 21,
      },
    ])

    assert.equal(data.unapprovedContracts.awaitingSignatoryCount, 1)
    assert.deepEqual(
      data.unapprovedContracts.rows.map((row: { contractId: string; status: string }) => [
        row.contractId,
        row.status,
      ]),
      [['test-contract', 'awaiting_signatory']],
    )

    assert.equal(data.enrollmentChanges.counts.promoted, 1)
    assert.equal(data.enrollmentChanges.counts.withdrawn, 1)
    assert.equal(data.enrollmentChanges.withdrawnWithoutRenewal, 1)
    assert.deepEqual(
      data.enrollmentChanges.rows.map((row: { kind: string; date: string }) => [
        row.kind,
        row.date,
      ]),
      [
        ['withdrawn', '2026-09-20'],
        ['promoted', '2026-09-07'],
      ],
    )

    assert.equal(data.refunds.pendingCount, 1)
    assert.equal(data.refunds.pendingCents, 400_000)
    assert.equal(data.refunds.overdueCount, 0)
    assert.equal(data.refunds.rows[0].studentName, 'test Ayrılan')
    // Yanıtta IBAN, gerekçe ya da döküm yok (DOM-FIN-057 kişisel veri asgarisi).
    assert.equal(response.body.includes('relocation'), false)
  })

  test('DOM-FIN-061: pencere ve yıl sorguyla değişir; geçersiz sorgu 400 ve 422', async () => {
    const a = await institution()
    const narrow = (await get(a.cookie, 'from=2026-09-10&to=2026-09-30')).json().data
    assert.deepEqual(
      narrow.enrollmentChanges.rows.map((row: { kind: string }) => row.kind),
      ['withdrawn'],
    )
    // Başka yılın ilk taksiti ve sözleşmesi yok; bekleyen iade pencereden ve yıldan bağımsız.
    const other = (await get(a.cookie, 'academicYear=2027')).json().data
    assert.equal(other.academicYear, 2027)
    assert.equal(other.firstInstallments.rows.length, 0)
    assert.equal(other.unapprovedContracts.rows.length, 0)
    assert.equal(other.refunds.pendingCount, 1)
    assertError(await get(a.cookie, 'from=2026-09-10'), 400)
    assertError(await get(a.cookie, 'page=1'), 400)
    assertError(await get(a.cookie, 'from=2026-09-30&to=2026-09-01'), 422, 'opening_window_invalid')
    assertError(
      await get(a.cookie, 'from=2026-01-01&to=2026-12-31'),
      422,
      'opening_window_too_long',
    )
    assertError(await get(a.cookie, 'termId=yok'), 422, 'opening_term_not_found')
  })

  test('DOM-FIN-061: yenileme modülü kapalıysa geçiş olayı yok; okuma hiçbir kaydı değiştirmez', async () => {
    const a = await institution({ enabledModules: { renewal: false } })
    const before = await loadRecords(db, a.id, ['contracts', 'invoices', 'students', 'renewals'])
    const data = (await get(a.cookie)).json().data
    assert.equal(data.renewalModule, false)
    assert.equal(data.enrollmentChanges.counts.promoted, 0)
    assert.equal(data.enrollmentChanges.counts.withdrawn, 1)
    assert.deepEqual(
      await loadRecords(db, a.id, ['contracts', 'invoices', 'students', 'renewals']),
      before,
    )
  })

  test('DOM-FIN-061: dil okulunda kursiyerin ilk taksiti ve iadesi aynı kuralla görünür', async () => {
    const a = await institution({ type: 'language_school' })
    const data = (await get(a.cookie)).json().data
    assert.equal(data.firstInstallments.overdueCount, 1)
    assert.equal(data.refunds.pendingCount, 1)
  })

  test('DOM-YTK-001: başka kurumun taksiti, sözleşmesi ve iadesi açılış nöbetinde yok; institutionId sorgusu 400', async () => {
    const a = await institution({}, 'a')
    const b = await institution({}, 'b')
    const own = (await get(a.cookie)).json().data
    const text = JSON.stringify(own)
    assert.equal(text.includes('b-inv-1'), false)
    assert.equal(text.includes('b-contract'), false)
    assert.equal(text.includes('b Ayrılan'), false)
    assert.equal(own.refunds.pendingCount, 1)
    assertError(await get(a.cookie, `institutionId=${b.id}`), 400)
  })
})
