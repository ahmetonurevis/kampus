import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { feeTariffs, priceIndexRates } from '../src/db/schema/fee-tariffs.ts'
import { referralRewards } from '../src/db/schema/finance-referrals.ts'
import { loadFinanceRecords } from '../src/db/finance-mirror-store.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
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

/**
 * Referans indirimi hakkı (DOM-FIN-024; ON-139). Her test kendi kurumunu kurar: s3 (veli p3) adayı
 * `pr-ref`i getirir; aday kesin kayda alınır, ilk taksit ödenince hak doğar, s3'ün yenilemesinde ya
 * da p3'ün yeni çocuğunun kesin kaydında bir kez kullanılır.
 */

const SEED = createSeed(FIXED_NOW)
const YEAR = 2026
const NEXT_YEAR = 2027
const LIST = '/api/v1/finance/referral-rewards'
const RENEWALS = '/api/v1/finance/renewals'
const ANNOUNCED_CENTS = 3_000_000
const CLASSES = ['c1', 'c3']
const BASE_PROSPECT = SEED.prospects[0]
const REFERRER = 's3'
const REFERRER_PARENT = 'p3'
const OTHER_FAMILY = 's1'

const prospectRow = (id: string, referrerStudentId: string | null, phone: string) => ({
  ...BASE_PROSPECT,
  id,
  phone,
  notes: [],
  ...(referrerStudentId === null ? {} : { source: 'Veli referansı', referrerStudentId }),
})

const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASSES.includes(item.id)),
  students: SEED.students.filter((item) => CLASSES.includes(item.classId)),
  parents: SEED.parents,
  prospects: [
    prospectRow('pr-ref', REFERRER, '05559990001'),
    prospectRow('pr-ref2', OTHER_FAMILY, '05559990002'),
    prospectRow('pr-new', null, '05559990003'),
  ],
  contracts: [
    {
      id: 'test-contract-s3',
      studentId: REFERRER,
      date: FIXED_NOW.toISOString(),
      amount: 2_000_000,
      title: 'Özel okul eğitim sözleşmesi',
      academicYear: YEAR,
    },
  ],
}

const tuition = {
  kind: 'tuition',
  level: null,
  amountCents: ANNOUNCED_CENTS,
  unit: 'year',
  vatBasisPoints: 1000,
  vatEffectiveDate: '2026-01-01',
  announcedAmountCents: ANNOUNCED_CENTS,
}
const REFERRAL_10 = { kind: 'referral', percentBasisPoints: 1_000, amountCents: null }
const ENROLLMENT = {
  classId: 'c1',
  installmentCount: 3,
  firstDueDate: '2026-11-15',
  identity: { kind: 'tc', number: '10000000146', birthDate: '2013-03-01' },
  guardian: { name: 'Test Yeni Veli', phone: '05559990009', relationship: 'mother' },
}
const SECOND_IDENTITY = { kind: 'tc', number: '10000000078', birthDate: '2013-04-01' }
const BANK = { method: 'Banka havalesi' }
const WITHDRAW_BEFORE_START = {
  withdrawalDate: '2026-10-01',
  termStartDate: '2026-11-01',
  attendedUnits: 0,
  totalUnits: 180,
  reason: 'relocation',
  targetSchool: 'Test Okulu',
}
const WITHDRAW_AFTER_START = {
  ...WITHDRAW_BEFORE_START,
  termStartDate: '2026-09-07',
  attendedUnits: 18,
}

describe('DOM-FIN-024: referans indirimi hakkı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  type Headers = Record<string, string>
  const key = () => ({ 'idempotency-key': randomUUID() })
  const post = (url: string, cookie: string | null, body: unknown, headers: Headers = key()) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      payload: JSON.stringify(body),
    })
  const get = (url: string, cookie: string | null) =>
    app.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  function assertError(
    response: Awaited<ReturnType<typeof get>>,
    status: number,
    code?: string,
  ): void {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const member = async (id: string, role: Role, links: readonly MembershipLinkInput[] = []) =>
    signInAs(app, await createMember(app, id, role, links))

  async function publish(
    institutionId: string,
    academicYear: number,
    discounts: readonly unknown[],
  ) {
    const id = randomUUID()
    await db.insert(feeTariffs).values({
      institutionId,
      id,
      academicYear,
      versionNumber: 1,
      status: 'published',
      items: [tuition] as never,
      discounts: discounts as never,
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
    return id
  }

  async function institution(discounts: readonly unknown[] = [REFERRAL_10]) {
    const created = await createInstitution(app)
    await insertMissingRecords(
      db,
      created.id,
      Object.entries(SAMPLE).flatMap(([collection, items]) =>
        (items ?? []).map((data) => {
          const name = collection as CollectionName
          const id = recordKey(name, data)
          if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
          return { collection: name, id, data }
        }),
      ),
      FIXED_NOW,
    )
    const tariffId = await publish(created.id, YEAR, discounts)
    const nextTariffId = await publish(created.id, NEXT_YEAR, discounts)
    await db.insert(priceIndexRates).values({
      institutionId: created.id,
      academicYear: NEXT_YEAR,
      ppiBasisPoints: 4_000,
      cpiBasisPoints: 3_000,
      source: 'TÜİK bülteni 53607',
      bulletinDate: '2026-02-03',
    })
    return { id: created.id, admin: await signInAs(app, created.admin), tariffId, nextTariffId }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  async function versionOf(institutionId: string, id: string) {
    const row = await findRecord(db, institutionId, 'prospects', id)
    assert.ok(row)
    return row.version
  }

  async function enrollRaw(
    t: Tenant,
    prospectId: string,
    body: Record<string, unknown> = {},
    headers: Headers = key(),
  ) {
    return post(
      `/api/v1/prospects/${prospectId}/enroll`,
      t.admin,
      { ...ENROLLMENT, tariffId: t.tariffId, ...body },
      { 'if-match': `"${String(await versionOf(t.id, prospectId))}"`, ...headers },
    )
  }
  async function enroll(t: Tenant, prospectId = 'pr-ref', body: Record<string, unknown> = {}) {
    const response = await enrollRaw(t, prospectId, body)
    assert.equal(response.statusCode, 201, response.body)
    return String(response.json().data.entity.id)
  }
  const rewards = (institutionId: string) =>
    db.select().from(referralRewards).where(eq(referralRewards.institutionId, institutionId))

  async function invoicesOf(institutionId: string, studentId: string) {
    const rows = await loadFinanceRecords(db, institutionId, 'invoices', {
      match: [{ kind: 'equals', field: 'studentId', values: [studentId] }],
    })
    return rows
      .map((row) => ({ id: row.id, amount: Number(row.data.amount), n: row.data.installment }))
      .sort((a, b) => Number(a.n) - Number(b.n))
  }
  async function pay(t: Tenant, studentId: string, amountCents: number) {
    const response = await post('/api/v1/payments', t.admin, {
      studentId,
      amountCents,
      ...BANK,
      reference: `TR-${String(++serial).padStart(5, '0')}`,
    })
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as { id: string; version: number }
  }
  async function payFirstInstallment(t: Tenant, studentId: string) {
    const [first] = await invoicesOf(t.id, studentId)
    assert.ok(first)
    return pay(t, studentId, first.amount)
  }
  /** Hak doğmuş kurum: `pr-ref` kayıtlı, ilk taksiti ödenmiş. */
  async function earned(t: Tenant) {
    const referredId = await enroll(t)
    const payment = await payFirstInstallment(t, referredId)
    const [row] = await rewards(t.id)
    assert.equal(row?.status, 'available')
    return { rewardId: String(row?.id), referredId, payment }
  }
  const renewalBody = (t: Tenant, rewardId?: string) => ({
    mode: 'renew',
    studentId: REFERRER,
    targetClassId: 'c1',
    academicYear: NEXT_YEAR,
    installmentCount: 4,
    tariffId: t.nextTariffId,
    firstDueDate: '2027-09-15',
    discounts: ['referral'],
    ...(rewardId === undefined ? {} : { referralRewardId: rewardId }),
  })
  async function notifications(institutionId: string) {
    return loadRecords(db, institutionId, ['notifications'])
  }

  // --- Yetki ve doğrulama --------------------------------------------------------------------

  test('DOM-FIN-024: liste oturumsuz 401, öğretmen 403, geçersiz süzgeç 400', async () => {
    const t = await institution()
    assertError(await get(LIST, null), 401)
    const teacher = await member(t.id, 'ogretmen', [])
    assertError(await get(LIST, teacher), 403)
    assertError(await get(`${LIST}?status=hediye`, t.admin), 400)
    assertError(await get(`${LIST}?institutionId=${t.id}`, t.admin), 400)
  })

  test('DOM-FIN-024: başka kurumun hakkı listede yok; A kaydında B hakkı 404, B değişmez; gövdedeki institutionId reddedilir', async () => {
    const a = await institution()
    const b = await institution()
    const { rewardId } = await earned(b)
    const before = await rewards(b.id)
    const list = await get(LIST, a.admin)
    assert.equal(list.statusCode, 200, list.body)
    assert.deepEqual(list.json().data, [])
    assert.equal(list.json().meta.total, 0)

    const renewals = await loadRecords(db, a.id, ['renewals'])
    const foreign = await post(RENEWALS, a.admin, renewalBody(a, rewardId))
    assertError(foreign, 404, 'not_found')
    assert.deepEqual(await loadRecords(db, a.id, ['renewals']), renewals)
    assert.deepEqual(await rewards(b.id), before)

    assertError(
      await post(RENEWALS, a.admin, { ...renewalBody(a, rewardId), institutionId: b.id }),
      400,
    )
  })

  // --- Hak ediş ------------------------------------------------------------------------------

  test('DOM-FIN-024: kesin kayıt hakkı bekler, kısmi ödeme doğurmaz, ilk taksit ödenince doğar', async () => {
    const t = await institution()
    const referredId = await enroll(t)
    const [opened] = await rewards(t.id)
    assert.equal(opened?.status, 'pending')
    assert.equal(opened?.prospectId, 'pr-ref')
    assert.equal(opened?.referrerStudentId, REFERRER)
    assert.equal(opened?.referrerParentId, REFERRER_PARENT)
    assert.equal(opened?.referredStudentId, referredId)
    assert.equal(opened?.academicYear, YEAR)
    assert.equal(opened?.percentBasisPoints, 1_000)
    assert.equal(opened?.amountCents, null)
    assert.equal(opened?.tariffId, t.tariffId)
    assert.equal((await notifications(t.id)).some(isRewardNotice), false)

    const [first] = await invoicesOf(t.id, referredId)
    assert.ok(first)
    await pay(t, referredId, first.amount - 100)
    assert.equal((await rewards(t.id))[0]?.status, 'pending')
    await pay(t, referredId, 100)
    const [row] = await rewards(t.id)
    assert.equal(row?.status, 'available')
    assert.equal(row?.earnedAt?.toISOString(), FIXED_NOW.toISOString())

    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, String(row?.id))))
    assert.deepEqual(audits.map((item) => item.action).sort(), [
      'notification.create',
      'referral.create',
      'referral.earn',
    ])
    assert.equal(JSON.stringify(audits).includes(referredId), false)
  })

  test('DOM-FIN-024: bildirim referans veren aileye yalnız hak kimliğiyle gider; tutar ve aday yok', async () => {
    const t = await institution()
    const { rewardId, referredId } = await earned(t)
    const notices = (await notifications(t.id)).filter(isRewardNotice)
    assert.equal(notices.length, 1)
    const notice = notices[0]?.data
    assert.equal(notice?.audience, 'parent')
    assert.equal(notice?.studentId, REFERRER)
    assert.deepEqual(notice?.subject, { type: 'referral_rewards', id: rewardId })
    const stored = JSON.stringify(notice)
    assert.equal(stored.includes(referredId), false)
    assert.equal(stored.includes('pr-ref'), false)
    assert.equal(stored.includes(String(BASE_PROSPECT?.name)), false)
    assert.equal(stored.includes('300000'), false)

    const parent = await member(t.id, 'veli', [{ kind: 'child', recordId: REFERRER }])
    const read = await get('/api/v1/notifications', parent)
    assert.equal(read.statusCode, 200, read.body)
    const seen = (read.json().data as { kind: string; title: string }[]).find(
      (item) => item.kind === 'referral_reward_earned',
    )
    assert.ok(seen)
    assert.equal(seen.title.includes(String(BASE_PROSPECT?.name)), false)
    assert.doesNotMatch(seen.title, /₺|\d/)
    // Referans verilen aile bu bildirimi görmez.
    const other = await member(t.id, 'veli', [{ kind: 'child', recordId: OTHER_FAMILY }])
    const unseen = await get('/api/v1/notifications', other)
    assert.equal(
      (unseen.json().data as { kind: string }[]).some(
        (item) => item.kind === 'referral_reward_earned',
      ),
      false,
    )
  })

  test('DOM-FIN-024: tarifede ilan yoksa, referans kendi ailesiyse ya da kaynak referans değilse hak açılmaz', async () => {
    const none = await institution([])
    await enroll(none)
    assert.deepEqual(await rewards(none.id), [])

    const family = await institution()
    await enroll(family, 'pr-ref', { guardian: { existingParentId: REFERRER_PARENT } })
    assert.deepEqual(await rewards(family.id), [])

    const plain = await institution()
    await enroll(plain, 'pr-new')
    assert.deepEqual(await rewards(plain.id), [])
  })

  test('DOM-FIN-024: tahsilat iptali kullanılmamış hakkı bekletir; yeniden ödemede ikinci bildirim yok', async () => {
    const t = await institution()
    const { payment, referredId } = await earned(t)
    const reversed = await post(
      `/api/v1/payments/${payment.id}/reverse`,
      t.admin,
      { reason: 'Mükerrer giriş düzeltmesi' },
      { ...key(), 'if-match': `"${String(payment.version)}"` },
    )
    assert.equal(reversed.statusCode, 200, reversed.body)
    const [row] = await rewards(t.id)
    assert.equal(row?.status, 'pending')
    assert.equal(row?.earnedAt, null)
    await payFirstInstallment(t, referredId)
    assert.equal((await rewards(t.id))[0]?.status, 'available')
    assert.equal((await notifications(t.id)).filter(isRewardNotice).length, 1)
  })

  // --- Kullanım ------------------------------------------------------------------------------

  test('DOM-FIN-024: yenilemede kalem tarifeden hesaplanır, hak aynı işlemde tek sefer kullanılır', async () => {
    const t = await institution()
    const { rewardId } = await earned(t)
    const created = await post(RENEWALS, t.admin, renewalBody(t, rewardId))
    assert.equal(created.statusCode, 201, created.body)
    const contractId = String(created.json().data.contractId)
    const [row] = await rewards(t.id)
    assert.equal(row?.status, 'used')
    assert.equal(row?.usedContractId, contractId)
    assert.equal(row?.usedStudentId, REFERRER)
    assert.equal(row?.usedAmountCents, ANNOUNCED_CENTS / 10)
    const [contract] = await loadFinanceRecords(db, t.id, 'contracts', { ids: [contractId] })
    assert.deepEqual(contract?.data.discounts, [
      { kind: 'referral', amountCents: ANNOUNCED_CENTS / 10 },
    ])

    // İkinci kullanım: 409 ve yeni yenileme, sözleşme yazılmaz.
    const renewals = await loadRecords(db, t.id, ['renewals'])
    const contracts = await loadFinanceRecords(db, t.id, 'contracts')
    const again = await post(RENEWALS, t.admin, {
      ...renewalBody(t, rewardId),
      firstDueDate: '2027-10-15',
    })
    assert.equal(again.statusCode, 409, again.body)
    assert.deepEqual(await loadRecords(db, t.id, ['renewals']), renewals)
    assert.deepEqual(await loadFinanceRecords(db, t.id, 'contracts'), contracts)
    assert.deepEqual(await rewards(t.id), [row])
  })

  test('DOM-FIN-024: mükerrer istek aynı yanıtı döner, hak tek kez işaretlenir', async () => {
    const t = await institution()
    const { rewardId } = await earned(t)
    const headers = key()
    const first = await post(RENEWALS, t.admin, renewalBody(t, rewardId), headers)
    assert.equal(first.statusCode, 201, first.body)
    const [row] = await rewards(t.id)
    const replay = await post(RENEWALS, t.admin, renewalBody(t, rewardId), headers)
    assert.equal(replay.statusCode, 201, replay.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(await rewards(t.id), [row])
    assert.equal((await loadRecords(db, t.id, ['renewals'])).length, 1)
  })

  test('DOM-FIN-024: kullanım önizlemesi hakkı işaretlemez', async () => {
    const t = await institution()
    const { rewardId } = await earned(t)
    const response = await post(`${RENEWALS}/quote`, t.admin, {
      studentId: REFERRER,
      targetClassId: 'c1',
      academicYear: NEXT_YEAR,
      installmentCount: 4,
      discounts: ['referral'],
      referralRewardId: rewardId,
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json().data.discounts, [
      { kind: 'referral', amountCents: ANNOUNCED_CENTS / 10 },
    ])
    assert.equal((await rewards(t.id))[0]?.status, 'available')
  })

  test('DOM-FIN-024: kesin kayıtta mevcut veli hakkını yeni çocuğunda kullanır, yeni veli kullanamaz', async () => {
    const t = await institution()
    const { rewardId } = await earned(t)
    const before = await rewards(t.id)
    const stranger = await enrollRaw(t, 'pr-new', {
      identity: SECOND_IDENTITY,
      discounts: ['referral'],
      referralRewardId: rewardId,
    })
    assertError(stranger, 422, 'referral_reward_not_owned')
    assert.deepEqual(await rewards(t.id), before)

    const studentId = await enroll(t, 'pr-new', {
      identity: SECOND_IDENTITY,
      guardian: { existingParentId: REFERRER_PARENT },
      discounts: ['referral'],
      referralRewardId: rewardId,
    })
    const [row] = await rewards(t.id)
    assert.equal(row?.status, 'used')
    assert.equal(row?.usedStudentId, studentId)
    assert.equal(row?.usedAmountCents, ANNOUNCED_CENTS / 10)
  })

  test('DOM-FIN-024: hak olmadan kalem seçilemez; doğmamış, başkasının ya da geçersiz hak reddedilir ve kayıt değişmez', async () => {
    const t = await institution()
    const referredId = await enroll(t)
    const [pending] = await rewards(t.id)
    assert.ok(pending)
    const before = {
      rewards: await rewards(t.id),
      renewals: await loadRecords(db, t.id, ['renewals']),
      contracts: await loadFinanceRecords(db, t.id, 'contracts'),
    }
    const expectUnchanged = async () =>
      assert.deepEqual(
        {
          rewards: await rewards(t.id),
          renewals: await loadRecords(db, t.id, ['renewals']),
          contracts: await loadFinanceRecords(db, t.id, 'contracts'),
        },
        before,
      )

    assertError(await post(RENEWALS, t.admin, renewalBody(t)), 422, 'referral_reward_required')
    await expectUnchanged()
    assertError(
      await post(RENEWALS, t.admin, renewalBody(t, pending.id)),
      422,
      'referral_reward_not_earned',
    )
    await expectUnchanged()
    assertError(await post(RENEWALS, t.admin, renewalBody(t, randomUUID())), 404, 'not_found')
    await expectUnchanged()
    assertError(
      await post(RENEWALS, t.admin, { ...renewalBody(t, pending.id), discounts: [] }),
      422,
      'referral_discount_required',
    )
    await expectUnchanged()
    assertError(await post(RENEWALS, t.admin, renewalBody(t, 'kimlik-degil')), 400)
    await expectUnchanged()

    await payFirstInstallment(t, referredId)
    const otherFamily = await post(RENEWALS, t.admin, {
      ...renewalBody(t, pending.id),
      studentId: 's27',
    })
    assertError(otherFamily, 422, 'referral_reward_not_owned')
  })

  test('DOM-FIN-024: DOM-FIN-021 tavanını aşan kısım düşer ve devretmez', async () => {
    const t = await institution([
      { kind: 'referral', percentBasisPoints: 6_000, amountCents: null },
    ])
    const { rewardId } = await earned(t)
    const created = await post(RENEWALS, t.admin, renewalBody(t, rewardId))
    assert.equal(created.statusCode, 201, created.body)
    const [row] = await rewards(t.id)
    assert.equal(row?.usedAmountCents, ANNOUNCED_CENTS / 2)
    assert.equal(row?.status, 'used')
  })

  // --- İptal ---------------------------------------------------------------------------------

  const withdraw = (t: Tenant, studentId: string, body: unknown) =>
    post(`/api/v1/students/${studentId}/withdraw`, t.admin, body)

  test('DOM-FIN-024: öğretim başlamadan iade alan kaydın kullanılmamış hakkı iptal olur', async () => {
    const t = await institution()
    const { referredId } = await earned(t)
    const left = await withdraw(t, referredId, WITHDRAW_BEFORE_START)
    assert.equal(left.statusCode, 201, left.body)
    assert.ok(left.json().data.refundCents > 0, left.body)
    const [row] = await rewards(t.id)
    assert.equal(row?.status, 'cancelled')
    assert.equal(row?.cancelReason, 'refunded_before_start')
    assert.equal(row?.cancelledAt?.toISOString(), FIXED_NOW.toISOString())
  })

  test('DOM-FIN-024: kullanılmış hak iade alınsa da geri istenmez', async () => {
    const t = await institution()
    const { rewardId, referredId } = await earned(t)
    const used = await post(RENEWALS, t.admin, renewalBody(t, rewardId))
    assert.equal(used.statusCode, 201, used.body)
    const before = await rewards(t.id)
    const left = await withdraw(t, referredId, WITHDRAW_BEFORE_START)
    assert.equal(left.statusCode, 201, left.body)
    assert.deepEqual(await rewards(t.id), before)
    assert.equal(before[0]?.status, 'used')
  })

  test('DOM-FIN-024: öğretim başladıktan sonra ayrılış doğmuş hakkı bozmaz, doğmamış hakkı kapatır', async () => {
    const started = await institution()
    const { referredId } = await earned(started)
    const left = await withdraw(started, referredId, WITHDRAW_AFTER_START)
    assert.equal(left.statusCode, 201, left.body)
    assert.equal((await rewards(started.id))[0]?.status, 'available')

    const unpaid = await institution()
    const unpaidId = await enroll(unpaid)
    const gone = await withdraw(unpaid, unpaidId, WITHDRAW_AFTER_START)
    assert.equal(gone.statusCode, 201, gone.body)
    const [row] = await rewards(unpaid.id)
    assert.equal(row?.status, 'cancelled')
    assert.equal(row?.cancelReason, 'withdrawn_before_earned')
  })

  test('DOM-FIN-024: ayrılışla iptal edilen planlanmış yenilemedeki hak sahibine döner', async () => {
    const t = await institution()
    const { rewardId } = await earned(t)
    const used = await post(RENEWALS, t.admin, renewalBody(t, rewardId))
    assert.equal(used.statusCode, 201, used.body)
    const left = await withdraw(t, REFERRER, WITHDRAW_AFTER_START)
    assert.equal(left.statusCode, 201, left.body)
    const [row] = await rewards(t.id)
    assert.equal(row?.status, 'available')
    assert.equal(row?.usedContractId, null)
    assert.equal(row?.usedAmountCents, null)
  })

  // --- Okuma ---------------------------------------------------------------------------------

  test('DOM-FIN-024: personel hakkı adayla görür, süzgeçler çalışır', async () => {
    const t = await institution()
    const { rewardId, referredId } = await earned(t)
    const frontDesk = await member(t.id, 'onburo')
    const list = await get(LIST, frontDesk)
    assert.equal(list.statusCode, 200, list.body)
    assert.equal(list.json().meta.total, 1)
    const [item] = list.json().data
    assert.equal(item.id, rewardId)
    assert.equal(item.prospectId, 'pr-ref')
    assert.equal(item.referredStudentId, referredId)
    assert.equal(item.referredStudentName, BASE_PROSPECT?.name)
    assert.equal(item.referrerParentId, REFERRER_PARENT)
    assert.equal(item.percentBasisPoints, 1_000)

    const filtered = async (query: string) =>
      (await get(`${LIST}?${query}`, frontDesk)).json().meta.total
    assert.equal(await filtered('status=available'), 1)
    assert.equal(await filtered('status=used'), 0)
    assert.equal(await filtered(`parentId=${REFERRER_PARENT}`), 1)
    assert.equal(await filtered('parentId=p1'), 0)
    assert.equal(await filtered(`familyOfStudentId=${REFERRER}`), 1)
    assert.equal(await filtered(`familyOfStudentId=${OTHER_FAMILY}`), 0)
    assert.equal(await filtered('familyOfStudentId=olmayan'), 0)
  })

  test('DOM-FIN-024: veli yalnız kendi hakkını görür; aday, referansla gelen öğrenci ve bekleyen hak yok', async () => {
    const t = await institution()
    const referredId = await enroll(t)
    const parent = await member(t.id, 'veli', [{ kind: 'child', recordId: REFERRER }])
    assert.equal((await get(LIST, parent)).json().meta.total, 0, 'bekleyen hak aileye görünmez')

    await payFirstInstallment(t, referredId)
    const list = await get(LIST, parent)
    assert.equal(list.statusCode, 200, list.body)
    assert.equal(list.json().meta.total, 1)
    const [item] = list.json().data
    assert.equal(item.status, 'available')
    assert.equal(item.referrerStudentId, REFERRER)
    assert.equal(item.prospectId, null)
    assert.equal(item.referredStudentId, null)
    assert.equal(item.referredStudentName, null)
    assert.equal(item.referrerParentId, null)
    assert.equal(list.body.includes(referredId), false)
    assert.equal(list.body.includes(String(BASE_PROSPECT?.name)), false)

    const stranger = await member(t.id, 'veli', [{ kind: 'child', recordId: OTHER_FAMILY }])
    assert.equal((await get(LIST, stranger)).json().meta.total, 0)
    const student = await member(t.id, 'ogrenci', [{ kind: 'student', recordId: OTHER_FAMILY }])
    assert.equal((await get(LIST, student)).json().meta.total, 0)
    // İptal gerekçesi de aileye gitmez: başka ailenin ayrılışını açar.
    assert.equal((await withdraw(t, referredId, WITHDRAW_BEFORE_START)).statusCode, 201)
    const [cancelled] = (await get(LIST, parent)).json().data
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.cancelReason, null)
  })
})

function isRewardNotice(row: { data: Record<string, unknown> }): boolean {
  return row.data.kind === 'referral_reward_earned'
}
