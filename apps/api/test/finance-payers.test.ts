import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  archiveGuardianLink,
  attachGuardianAccount,
  loadStudentGuardians,
} from '../src/db/student-guardians.ts'
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
import { SEED, sampleRows } from './support/collections-sample.ts'

/**
 * Yetişkin kursiyerin ayrı ödeyicisi (ON-124; DOM-KAY-012, DOM-ILT-074, ADR 0008 karar 5;
 * kullanıcı kararı 2 Kasım 2026). `POST /api/v1/finance/students/:studentId/payers` kursta 18 yaş
 * ve üstü kursiyere velayetsiz ödeyici bağı kurar. Ödeyici hesabı fatura, sözleşme, tahsilat
 * (dekont kaynağı), bakiye ve ekstreyi okur, finans bildirimini alır; not, devam ve öğrenci
 * kaydını okuyamaz. Okulda ve 18 yaş altında eski kural geçerlidir (ödeyici veli).
 */

type Json = ReturnType<typeof JSON.parse>

const CONTRACTS = SEED.contracts.filter((row) => ['s1', 's2'].includes(row.studentId))
/** Tahsilat için `s1`'e bir açık taksit; örnek kesitteki faturalar ödenmiştir. */
const OPEN_INVOICE = {
  id: 'test-on124-inv-s1',
  studentId: 's1',
  installment: 9,
  amount: 10_000,
  dueDate: '2026-11-15T00:00:00.000Z',
  paidAt: null,
  method: null,
}
const PAYER = { name: 'Test Ödeyici Anne', phone: '05559990124', relationship: 'mother' }

describe('yetişkin kursiyerin ayrı ödeyicisi (ON-124)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function send(method: 'GET' | 'POST', url: string, cookie: string | null, body?: unknown) {
    return app.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(method === 'POST'
          ? { 'idempotency-key': `test-on124-${String(++serial).padStart(5, '0')}` }
          : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }
  const get = (cookie: string, url: string) => send('GET', url, cookie)
  async function data(cookie: string, url: string) {
    const response = await get(cookie, url)
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`)
    return response.json().data as Json
  }
  const studentsIn = async (cookie: string, collection: string) =>
    [
      ...new Set(
        ((await data(cookie, `/api/v1/collections/${collection}?pageSize=100`)) as Json[]).map(
          (row) => row.record.studentId as string,
        ),
      ),
    ].sort()
  const addPayer = (cookie: string | null, studentId: string, body: unknown) =>
    send('POST', `/api/v1/finance/students/${studentId}/payers`, cookie, body)
  const bondsOf = (institutionId: string, studentId: string) =>
    loadStudentGuardians(db, institutionId, studentId)

  /**
   * Kurum: örnek kesit, `s1`/`s2` sözleşmesi ve `s1`'e açık taksit. `adult` verilirse `s1`'in kimlik
   * satırı 18 yaş üstü doğum tarihi taşır (dil okulunda yetişkin kursiyer).
   */
  async function world(overrides: Partial<InstitutionOverrides> = {}, adult = true) {
    const institution = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      institution.id,
      [
        ...sampleRows(),
        ...CONTRACTS.map((row) => ({ collection: 'contracts' as const, id: row.id, data: row })),
        { collection: 'invoices' as const, id: OPEN_INVOICE.id, data: OPEN_INVOICE },
      ],
      FIXED_NOW,
    )
    await insertStudentIdentity(db, institution.id, {
      studentId: 's1',
      academicYear: 2026,
      kind: 'tc',
      number: '10000000146',
      birthDate: adult ? '2000-01-01' : '2013-03-01',
      now: FIXED_NOW,
    })
    const admin = await signInAs(app, institution.admin)
    return { institution, admin }
  }

  /**
   * Ödeyicinin hesabı: veli hesabı daveti (DOM-YTK-071) çocuk bağlantısı açar ve veli kaydının
   * bağını hesaba bağlar. Test aynı durumu kurar: üyelik ve çocuk bağlantısı açılır, hesap
   * açılışının kurduğu velayetli bağ kaldırılır, ödeyici bağı hesaba bağlanır.
   */
  async function payerAccount(institutionId: string, bondId: string) {
    const user = await createMember(app, institutionId, 'veli', [{ kind: 'child', recordId: 's1' }])
    for (const bond of await bondsOf(institutionId, 's1'))
      if (bond.membershipId === user.membershipId)
        assert.ok(await archiveGuardianLink(db, institutionId, bond, FIXED_NOW))
    assert.ok(
      await attachGuardianAccount(db, institutionId, [bondId], user.membershipId, FIXED_NOW),
    )
    return { ...user, cookie: await signInAs(app, user) }
  }

  test('DOM-KAY-012 DOM-ILT-074 ON-124 yönetici yetişkin kursiyere yeni kişiyi ödeyici ekler; ikinci ödeyici ve aynı kişi 409', async () => {
    const { institution, admin } = await world({ type: 'language_school' })
    const parentsBefore = await loadRecords(db, institution.id, ['parents'])
    const created = await addPayer(admin, 's1', PAYER)
    assert.equal(created.statusCode, 201, created.body)
    assert.equal(created.headers.location, '/api/v1/students/s1/guardians')
    const body = created.json().data as Json
    assert.equal(body.custody, 'none')
    assert.equal(body.isPayer, true)
    assert.equal(body.contactRestricted, false)
    assert.equal(body.canPickUp, false)
    assert.equal(body.membershipId, null)
    const parents = await loadRecords(db, institution.id, ['parents'])
    assert.equal(parents.length, parentsBefore.length + 1)
    const payerRow = parents.find((row) => row.id === body.parentId)
    assert.equal(payerRow?.data.name, PAYER.name)
    assert.deepEqual(payerRow?.data.studentIds, [])
    // Denetim kaydı alan adlarını taşır; telefon ve ad yazılmaz.
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institution.id), eq(auditLog.action, 'guardian.link')))
    assert.equal(audit.length, 1)
    assert.ok(!JSON.stringify(audit).includes(PAYER.phone))
    // Tek ödeyici: başka kişi 409, aynı kayıt 409; hiçbir bağ eklenmez.
    const second = await addPayer(admin, 's1', { ...PAYER, name: 'Test Başka Ödeyici' })
    assert.equal(second.statusCode, 409, second.body)
    assert.equal(second.json().code, 'guardian_payer_exists')
    const same = await addPayer(admin, 's1', { existingParentId: body.parentId })
    assert.equal(same.statusCode, 409, same.body)
    assert.equal((await bondsOf(institution.id, 's1')).length, 1)
    assert.equal((await loadRecords(db, institution.id, ['parents'])).length, parents.length)
  })

  test('DOM-ILT-070 DOM-ILT-074 ON-124 ödeyici finansı ve dekont kaynağını okur, not, devam ve öğrenci kaydını okuyamaz', async () => {
    const { institution, admin } = await world({ type: 'language_school' })
    const created = await addPayer(admin, 's1', { existingParentId: 'p1' })
    assert.equal(created.statusCode, 201, created.body)
    const payer = await payerAccount(institution.id, created.json().data.id as string)

    assert.deepEqual(await studentsIn(payer.cookie, 'invoices'), ['s1'])
    assert.deepEqual(await studentsIn(payer.cookie, 'contracts'), ['s1'])
    const balance = await data(payer.cookie, '/api/v1/finance/students/s1/balance')
    assert.equal(balance.studentId, 's1')
    assert.equal((await get(payer.cookie, '/api/v1/finance/students/s1/statement')).statusCode, 200)
    assert.equal((await get(payer.cookie, '/api/v1/finance/students/s2/balance')).statusCode, 404)

    // Tahsilat (dekont kaynağı) ve finans bildirimi ödeyiciye ulaşır; kursiyer de kendi bildirimini alır.
    const paid = await send('POST', '/api/v1/payments', admin, {
      studentId: 's1',
      amountCents: 1_000,
      method: 'Banka havalesi',
      reference: 'TR-ON124-s1',
    })
    assert.equal(paid.statusCode, 201, paid.body)
    const paymentId = String(paid.json().data.id)
    const detail = await data(payer.cookie, `/api/v1/payments/${paymentId}`)
    assert.equal(detail.studentId, 's1')
    const payerKinds = ((await data(payer.cookie, '/api/v1/notifications')) as Json[]).map(
      (item) => `${String(item.kind)}:${String(item.studentId)}`,
    )
    assert.deepEqual(payerKinds, ['payment_received:s1'])
    const learner = await createMember(app, institution.id, 'ogrenci', [
      { kind: 'student', recordId: 's1' },
    ])
    const learnerKinds = (
      (await data(await signInAs(app, learner), '/api/v1/notifications')) as Json[]
    ).map((item) => String(item.kind))
    assert.deepEqual(learnerKinds, ['payment_received'])

    // Akademik ve kayıt okumaları velayettedir: ödeyici görmez.
    assert.deepEqual(await studentsIn(payer.cookie, 'grades'), [])
    assert.deepEqual(await studentsIn(payer.cookie, 'attendance'), [])
    assert.equal((await get(payer.cookie, '/api/v1/collections/students/s1')).statusCode, 404)
  })

  test('DOM-KAY-012 ON-124 okulda ve 18 yaş altında ayrı ödeyici 422; kısıtlı kişi ve kursiyerin kendi satırı 422; bağ yazılmaz', async () => {
    const school = await world({ type: 'school' })
    const refused = await addPayer(school.admin, 's1', PAYER)
    assert.equal(refused.statusCode, 422, refused.body)
    assert.equal(refused.json().code, 'payer_not_applicable')
    assert.deepEqual(refused.json().issues?.[0]?.path, ['payer'])
    const minor = await world({ type: 'language_school' }, false)
    const minorRefused = await addPayer(minor.admin, 's1', PAYER)
    assert.equal(minorRefused.json().code, 'payer_not_applicable')

    const adult = await world({ type: 'language_school' })
    const before = await bondsOf(adult.institution.id, 's1')
    // `s2`'nin velayetli velisi hesap açılışıyla kurulur; `p1` kaydının `s2` bağı iletişim kısıtlıdır.
    await createMember(app, adult.institution.id, 'veli', [{ kind: 'child', recordId: 's2' }])
    const linkedToP1 = await app.inject({
      method: 'POST',
      url: '/api/v1/students/s2/guardians',
      headers: {
        origin: TEST_ORIGIN,
        cookie: adult.admin,
        'content-type': 'application/json',
        'idempotency-key': 'test-on124-restricted-link',
      },
      payload: JSON.stringify({
        parentId: 'p1',
        relationship: 'mother',
        custody: 'none',
        contactRestricted: true,
      }),
    })
    assert.equal(linkedToP1.statusCode, 201, linkedToP1.body)
    // Kısıtlı kişi ödeyici olamaz; kısıtın hangi öğrencide olduğu söylenmez.
    const restrictedPayer = await addPayer(adult.admin, 's1', { existingParentId: 'p1' })
    assert.equal(restrictedPayer.statusCode, 422, restrictedPayer.body)
    assert.equal(restrictedPayer.json().code, 'payer_not_eligible')
    assert.equal((await addPayer(adult.admin, 's1', { existingParentId: 'yok' })).statusCode, 404)
    // Yetişkin kursiyerin kendi satırı başkasının ödeyicisi olamaz (DOM-KAY-013).
    await insertMissingRecords(
      db,
      adult.institution.id,
      [
        {
          collection: 'parents',
          id: 'test-on124-self',
          data: {
            id: 'test-on124-self',
            name: 'Test Kursiyer',
            studentIds: ['s2'],
            relationship: 'self',
          },
        },
      ],
      FIXED_NOW,
    )
    const self = await addPayer(adult.admin, 's1', { existingParentId: 'test-on124-self' })
    assert.equal(self.statusCode, 422, self.body)
    assert.equal(self.json().code, 'payer_not_eligible')
    assert.deepEqual(await bondsOf(adult.institution.id, 's1'), before)
  })

  test('ON-124 uç: oturumsuz 401, yetkisiz rol 403, finans kapalı 403, başka kurumun öğrencisi 404, gövde 400', async () => {
    const a = await world({ type: 'language_school' })
    assert.equal((await addPayer(null, 's1', PAYER)).statusCode, 401)
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
      const user = await createMember(app, a.institution.id, role)
      const response = await addPayer(await signInAs(app, user), 's1', PAYER)
      assert.equal(response.statusCode, 403, role)
    }
    for (const body of [
      { ...PAYER, relationship: 'legal_guardian' },
      { ...PAYER, institutionId: 'x' },
      { name: PAYER.name },
    ])
      assert.equal((await addPayer(a.admin, 's1', body)).statusCode, 400, JSON.stringify(body))
    const b = await world({ type: 'language_school' })
    assert.equal((await addPayer(a.admin, 'yok', PAYER)).statusCode, 404)
    const otherBefore = await bondsOf(b.institution.id, 's1')
    // `s1` iki kurumda da var; a'nın yöneticisi yalnız kendi kurumuna yazar.
    assert.equal((await addPayer(a.admin, 's1', PAYER)).statusCode, 201)
    assert.deepEqual(await bondsOf(b.institution.id, 's1'), otherBefore)
    const closed = await world({ type: 'language_school', enabledModules: { finance: false } })
    const response = await addPayer(closed.admin, 's1', PAYER)
    assert.equal(response.statusCode, 403)
    assert.equal(response.json().code, 'module_disabled')
    assert.deepEqual(await bondsOf(closed.institution.id, 's1'), [])
  })
})
