import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import {
  bankAccounts,
  paymentAllocations,
  payments,
  paymentSettings,
} from '../src/db/schema/payments.ts'
import { records } from '../src/db/schema/records.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
} from './support/app.ts'
import {
  crossInject,
  nextIp,
  runCrossCase,
  tableRows,
  type CrossCase,
  type CrossContext,
  type CrossRequest,
} from './support/cross-institution.ts'

/**
 * Kayıt ve finans uçlarında çapraz kurum (IST-002; DOM-YTK-001, DOM-YTK-011): tahsilatın MEBBİS
 * işareti, banka hesabı, tahsilat ayarı, muhasebe toplamları, aday veli eşleşmesi, öğrenci kimlik
 * özeti ve deneme dersi (DOM-FIN-030, 032; DOM-KAY-012, 013, 034; DOM-DIL-030). Uçların kaynağı
 * ve kendi testleri Onur'un alanındadır; bu dosya yalnız kurum sınırını sınar, kaynağa dokunmaz.
 * Kayıt kimliği alan uçlar tablo koşucusuyla (`support/cross-institution.ts`), kimliksiz uçlar
 * ayrı testlerle: B'nin satırı A'nın yanıtına girmez, A'nın yazması B'yi değiştirmez.
 */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const LESSON = SEED.schedule.find(
  (item) => item.classId === 'c1' && Date.parse(item.date) > +FIXED_NOW,
)
const PROSPECT = SEED.prospects[0]
const NET = 10_000_000

type Sample = Partial<Record<CollectionName, readonly Record<string, unknown>[]>>
const SAMPLE: Sample = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => item.id === 'c1'),
  students: SEED.students.filter((item) => item.classId === 'c1'),
  schedule: SEED.schedule.filter((item) => item.classId === 'c1'),
  prospects: SEED.prospects.slice(0, 5),
  invoices: [1, 2].map((installment) => ({
    id: `test-inv-${String(installment)}`,
    studentId: STUDENT?.id,
    installment,
    amount: NET / 2,
    dueDate: `2026-1${String(installment - 1)}-15T09:00:00.000Z`,
    paidAt: null,
    method: null,
    reminderAt: null,
  })),
}

const ACCOUNT = {
  bankName: 'Örnek Bankası',
  iban: 'TR33 0006 1005 1978 6457 8413 26',
  accountHolder: 'Akademi Özel Okulları',
}

let db: Database
let app: App

async function tenant(type: 'school' | 'language_school' = 'school') {
  const institution = await createInstitution(app, { type })
  await insertMissingRecords(
    db,
    institution.id,
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
  return {
    id: institution.id,
    cookies: {
      admin: await signInAs(app, institution.admin),
      frontDesk: await signInAs(app, await createMember(app, institution.id, 'onburo')),
      teacher: await signInAs(
        app,
        await createMember(app, institution.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }]),
      ),
    },
  }
}
type Tenant = Awaited<ReturnType<typeof tenant>>

const call = (cookie: string, request: CrossRequest) => crossInject(app, nextIp(), cookie, request)
async function made(cookie: string, url: string, body: Record<string, unknown>) {
  const response = await call(cookie, { method: 'POST', url, body })
  assert.ok(response.statusCode < 300, response.body)
  return response.json<{ data: { id: string; version: number } }>().data
}
async function read<T>(cookie: string, url: string) {
  const response = await call(cookie, { method: 'GET', url })
  assert.equal(response.statusCode, 200, response.body)
  return response.json<{ data: T }>().data
}

const pay = (t: Tenant, amountCents = 1_250) =>
  made(t.cookies.admin, '/api/v1/payments', {
    studentId: STUDENT?.id,
    amountCents,
    method: 'Banka havalesi',
    reference: `TR-${randomUUID().slice(0, 8)}`,
  })

/** Yalnız kurumda bulunan önekli kimlikle seed adayının kopyası. */
async function prospectCopy(t: Tenant) {
  assert.ok(PROSPECT)
  const id = `test-capraz-aday-${randomUUID().slice(0, 8)}`
  await insertMissingRecords(
    db,
    t.id,
    [{ collection: 'prospects', id, data: { ...PROSPECT, id } }],
    FIXED_NOW,
  )
  return { prospectId: id }
}

/** `prospectCopy` gibi, ama `Teklif verildi` aşamasında: geri alınabilir bir aday. */
async function prospectAtOffer(t: Tenant) {
  assert.ok(PROSPECT)
  const id = `test-capraz-teklif-${randomUUID().slice(0, 8)}`
  await insertMissingRecords(
    db,
    t.id,
    [{ collection: 'prospects', id, data: { ...PROSPECT, id, stage: 'Teklif verildi' } }],
    FIXED_NOW,
  )
  return { prospectId: id }
}

/** `prospectCopy` gibi, ama dersi yapılmış (geçmiş) bir deneme dersiyle: sonuç yazılabilir. */
async function prospectWithHeldTrial(t: Tenant) {
  assert.ok(PROSPECT)
  const lesson = SEED.schedule.find(
    (item) => item.classId === 'c1' && Date.parse(item.date) < +FIXED_NOW,
  )
  assert.ok(lesson, 'örnek veride 7-A’nın geçmiş dersi yok')
  const id = `test-capraz-deneme-${randomUUID().slice(0, 8)}`
  const trialLesson = {
    lessonId: lesson.id,
    classId: lesson.classId,
    date: lesson.date,
    duration: lesson.duration,
    guardianConsentAt: null,
    scheduledAt: FIXED_NOW.toISOString(),
    by: { role: 'onburo', userId: 'u-test' },
  }
  await insertMissingRecords(
    db,
    t.id,
    [{ collection: 'prospects', id, data: { ...PROSPECT, id, minor: false, trialLesson } }],
    FIXED_NOW,
  )
  return { prospectId: id }
}

/** Yalnız kurumda bulunan öğrenci ve kimlik satırı (kesin kayıttaki gibi; DOM-KAY-012). */
async function studentWithIdentity(t: Tenant) {
  assert.ok(STUDENT)
  const id = `test-capraz-ogrenci-${randomUUID().slice(0, 8)}`
  await insertMissingRecords(
    db,
    t.id,
    [{ collection: 'students', id, data: { ...STUDENT, id, studentNo: `T${id.slice(-6)}` } }],
    FIXED_NOW,
  )
  await db.insert(studentIdentities).values({
    institutionId: t.id,
    studentId: id,
    academicYear: 2026,
    identityKind: 'tc',
    identityNumber: '10000000146',
    birthDate: '2013-03-01',
  })
  return { studentId: id }
}

const FINANCE = [
  payments,
  paymentAllocations,
  bankAccounts,
  paymentSettings,
  studentIdentities,
  records,
]

const CASES: readonly (CrossCase<Tenant> & { type?: 'language_school' })[] = [
  {
    key: 'POST /api/v1/payments/:paymentId/mebbis-record',
    kind: 'kayıt',
    actor: (a) => a.cookies.frontDesk,
    make: async (t) => ({ paymentId: (await pay(t)).id }),
    request: ({ paymentId }) => ({
      method: 'POST',
      url: `/api/v1/payments/${paymentId}/mebbis-record`,
      body: { recorded: true },
      ifMatch: 1,
    }),
  },
  {
    // Aynı IBAN iki kurumda ayrı hesaptır: A'nın denetim hesabı B'ninkiyle çakışmaz.
    key: 'DELETE /api/v1/bank-accounts/:bankAccountId',
    kind: 'kayıt',
    actor: (a) => a.cookies.admin,
    make: async (t) => ({
      bankAccountId: (await made(t.cookies.admin, '/api/v1/bank-accounts', ACCOUNT)).id,
    }),
    request: ({ bankAccountId }) => ({
      method: 'DELETE',
      url: `/api/v1/bank-accounts/${bankAccountId}`,
      ifMatch: 1,
    }),
  },
  {
    key: 'GET /api/v1/prospects/:prospectId/guardian-matches',
    kind: 'kayıt',
    actor: (a) => a.cookies.frontDesk,
    make: prospectCopy,
    request: ({ prospectId }) => ({
      method: 'GET',
      url: `/api/v1/prospects/${prospectId}/guardian-matches`,
    }),
  },
  {
    key: 'GET /api/v1/students/:studentId/identity',
    kind: 'kayıt',
    actor: (a) => a.cookies.frontDesk,
    make: studentWithIdentity,
    request: ({ studentId }) => ({ method: 'GET', url: `/api/v1/students/${studentId}/identity` }),
  },
  {
    // Deneme dersi yalnız dil okulundadır (okulda uç her rol için 404).
    key: 'POST /api/v1/prospects/:prospectId/trial-lessons',
    kind: 'kayıt',
    type: 'language_school',
    actor: (a) => a.cookies.frontDesk,
    make: prospectCopy,
    request: ({ prospectId }) => ({
      method: 'POST',
      url: `/api/v1/prospects/${prospectId}/trial-lessons`,
      body: { lessonId: LESSON?.id, guardianConsent: true },
      ifMatch: 1,
    }),
  },
  {
    // Aday bilgisi düzeltme ön büro ve yöneticidedir (DOM-KAY-003); aday yalnız B'de.
    key: 'PATCH /api/v1/prospects/:prospectId/details',
    kind: 'kayıt',
    actor: (a) => a.cookies.frontDesk,
    make: prospectCopy,
    request: ({ prospectId }) => ({
      method: 'PATCH',
      url: `/api/v1/prospects/${prospectId}/details`,
      body: { interest: 'Düzeltilmiş ilgi' },
      ifMatch: 1,
    }),
  },
  {
    // Ticari ileti onayı ön büro ve yöneticidedir (DOM-KAY-004); aday yalnız B'de.
    key: 'POST /api/v1/prospects/:prospectId/marketing-consent',
    kind: 'kayıt',
    actor: (a) => a.cookies.frontDesk,
    make: prospectCopy,
    request: ({ prospectId }) => ({
      method: 'POST',
      url: `/api/v1/prospects/${prospectId}/marketing-consent`,
      body: { channel: 'sms', granted: true },
      ifMatch: 1,
    }),
  },
  {
    // Aşama geri alma yalnız yöneticidedir (DOM-KAY-030); açık aşamadaki aday B'de.
    key: 'POST /api/v1/prospects/:prospectId/stage-revert',
    kind: 'kayıt',
    actor: (a) => a.cookies.admin,
    make: prospectAtOffer,
    request: ({ prospectId }) => ({
      method: 'POST',
      url: `/api/v1/prospects/${prospectId}/stage-revert`,
      body: { stage: 'Yeni aday', reason: 'Gerekçe.' },
      ifMatch: 1,
    }),
  },
  {
    // Deneme sonucunu dersin öğretmeni yazar; yalnız dil okulundadır (DOM-DIL-031).
    key: 'POST /api/v1/prospects/:prospectId/trial-result',
    kind: 'kayıt',
    type: 'language_school',
    actor: (a) => a.cookies.teacher,
    make: prospectWithHeldTrial,
    request: ({ prospectId }) => ({
      method: 'POST',
      url: `/api/v1/prospects/${prospectId}/trial-result`,
      body: { fit: 'suitable' },
      ifMatch: 1,
    }),
  },
]

describe('IST-002: kayıt ve finans uçlarında başka kurum (DOM-YTK-001, DOM-YTK-011)', () => {
  let close: () => Promise<void>

  before(async () => {
    assert.ok(
      STUDENT && LESSON && PROSPECT,
      'örnek veride 7-A öğrencisi, gelecek dersi ve aday yok',
    )
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const snapshot = (institutionId: string) => tableRows(db, institutionId, FINANCE)

  for (const spec of CASES) {
    const title = 'başka kurumun kaydı olmayan kayıtla aynı 404; iki kurum değişmez'
    test(`IST-002: ${spec.key}: ${title}`, () => {
      const context: CrossContext<Tenant> = {
        app,
        tenant: () => tenant(spec.type ?? 'school'),
        snapshot,
      }
      return runCrossCase(context, spec)
    })
  }

  test('IST-002: GET /api/v1/finance/totals, /finance/summary ve /finance-summary: başka kurumun tahsilatı toplama girmez', async () => {
    const a = await tenant()
    const b = await tenant()
    const views = async (t: Tenant) => [
      await read<unknown>(t.cookies.admin, '/api/v1/finance/totals'),
      await read<unknown>(t.cookies.admin, '/api/v1/finance/summary?from=2026-10-01&to=2026-10-31'),
      await read<unknown>(t.cookies.admin, '/api/v1/finance-summary?from=2026-10-01&to=2026-10-31'),
    ]
    const before = await views(a)
    await pay(b, 2_500)
    assert.deepEqual(await views(a), before)
    const [totals] = await views(b)
    assert.equal((totals as { paidCents: number }).paidCents, 2_500)
    assert.equal((before[0] as { paidCents: number }).paidCents, 0)
  })

  test('IST-002: GET /api/v1/bank-accounts ve POST /bank-accounts: başka kurumun hesabı listede yok; gövdedeki institutionId reddedilir, aynı IBAN A’da ayrı hesaptır', async () => {
    const a = await tenant()
    const b = await tenant()
    const foreign = await made(b.cookies.admin, '/api/v1/bank-accounts', ACCOUNT)
    assert.deepEqual(await read<unknown[]>(a.cookies.admin, '/api/v1/bank-accounts'), [])
    const before = await snapshot(b.id)

    const forged = await call(a.cookies.admin, {
      method: 'POST',
      url: '/api/v1/bank-accounts',
      body: { ...ACCOUNT, institutionId: b.id },
    })
    assert.equal(forged.statusCode, 400, forged.body)
    assert.match(forged.body, /institutionId/)
    const own = await made(a.cookies.admin, '/api/v1/bank-accounts', ACCOUNT)
    assert.notEqual(own.id, foreign.id)
    assert.deepEqual(
      (await read<{ id: string }[]>(a.cookies.admin, '/api/v1/bank-accounts')).map(
        (item) => item.id,
      ),
      [own.id],
    )
    assert.deepEqual(await snapshot(b.id), before)
  })

  test('IST-002: GET ve PATCH /api/v1/payment-settings: başka kurumun ayarı görünmez ve değişmez; gövdedeki institutionId reddedilir', async () => {
    const a = await tenant()
    const b = await tenant()
    const settings = (t: Tenant) =>
      read<{ cashPaymentsEnabled: boolean; version: number }>(
        t.cookies.admin,
        '/api/v1/payment-settings',
      )
    const change = (t: Tenant, body: Record<string, unknown>, version: number) =>
      call(t.cookies.admin, {
        method: 'PATCH',
        url: '/api/v1/payment-settings',
        body,
        ifMatch: version,
      })
    const opened = await change(b, { cashPaymentsEnabled: true }, (await settings(b)).version)
    assert.equal(opened.statusCode, 200, opened.body)
    assert.equal((await settings(a)).cashPaymentsEnabled, false)
    const before = await snapshot(b.id)

    const current = await settings(a)
    const forged = await change(
      a,
      { cashPaymentsEnabled: false, institutionId: b.id },
      current.version,
    )
    assert.equal(forged.statusCode, 400, forged.body)
    assert.match(forged.body, /institutionId/)
    const own = await change(a, { cashPaymentsEnabled: true }, current.version)
    assert.equal(own.statusCode, 200, own.body)
    const closed = await change(a, { cashPaymentsEnabled: false }, (await settings(a)).version)
    assert.equal(closed.statusCode, 200, closed.body)
    assert.equal((await settings(b)).cashPaymentsEnabled, true)
    assert.deepEqual(await snapshot(b.id), before)
  })
})
