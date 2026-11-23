import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { InstitutionType, Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { loadRecords, insertMissingRecords } from '../src/db/records.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
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
import { contractTerms, insertTestTariff } from './support/finance-terms.ts'

/**
 * Yetişkin kursiyerin kendi sözleşmeleri (IST-082; docs/domain/finans.md DOM-FIN-059). Her test
 * kendi kurumunu kurar: kursiyer s1 (yetişkin) ve s2 (18 yaş altı) aynı sınıftadır; s1'in iki
 * taksitli sözleşmesi (100.000 ₺, ilk taksit ödenmiş) vardır. FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const ADULT = 's1'
const MINOR = 's2'
const CONTRACT_ID = 'test-own-contract'
const ADULT_BIRTH = '1995-04-20'
const MINOR_BIRTH = '2010-03-01'
const B_ONLY = 'test-b-kursiyer'
const url = (studentId: string) => `/api/v1/finance/students/${studentId}/contracts`

const invoice = (id: string, installment: number, paid: boolean) => ({
  id,
  studentId: ADULT,
  installment,
  amount: 5_000_000,
  dueDate: `2026-1${String(installment)}-15T09:00:00.000Z`,
  paidAt: paid ? '2026-10-01T09:00:00.000Z' : null,
  method: paid ? 'Nakit' : null,
  reminderAt: null,
  feeKind: 'tuition',
})

const STUDENTS = SEED.students.filter((item) => item.id === ADULT || item.id === MINOR)
const CLASS_IDS = new Set(STUDENTS.map((item) => item.classId))
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.has(item.id)),
  students: STUDENTS,
  parents: SEED.parents,
  invoices: [invoice('test-own-inv-1', 1, true), invoice('test-own-inv-2', 2, false)],
  contracts: [
    {
      id: CONTRACT_ID,
      studentId: ADULT,
      date: '2026-09-01T09:00:00.000Z',
      amount: 10_000_000,
      title: 'Dil kursu eğitim sözleşmesi',
      invoiceIds: ['test-own-inv-1', 'test-own-inv-2'],
      academicYear: 2026,
      ...contractTerms({ grossCents: 10_000_000, netCents: 10_000_000, payer: 'student' }),
    },
  ],
}

describe('IST-082: yetişkin kursiyerin sözleşmelerim ucu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const get = (target: string, cookie: string | null) =>
    app.inject({
      method: 'GET',
      url: target,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  type Response = Awaited<ReturnType<typeof get>>
  function assertError(response: Response, statusCode: number, code: string) {
    assert.equal(response.statusCode, statusCode, response.body)
    assert.equal(response.json().code, code)
  }

  async function tenant(
    type: InstitutionType = 'language_school',
    enabledModules?: Record<string, boolean>,
  ) {
    const institution = await createInstitution(app, {
      type,
      ...(enabledModules ? { enabledModules } : {}),
    })
    await insertTestTariff(db, institution.id)
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
    for (const [studentId, birthDate] of [
      [ADULT, ADULT_BIRTH],
      [MINOR, MINOR_BIRTH],
    ] as const)
      await db.insert(studentIdentities).values({
        institutionId: institution.id,
        studentId,
        academicYear: 2026,
        identityKind: 'foreign',
        identityNumber: `YK-${institution.id}-${studentId}`,
        birthDate,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      })
    const learner = async (studentId: string) =>
      signInAs(
        app,
        await createMember(app, institution.id, 'ogrenci', [
          { kind: 'student', recordId: studentId },
        ]),
      )
    return { id: institution.id, admin: await signInAs(app, institution.admin), learner }
  }

  test('DOM-FIN-059: oturumsuz 401; öğrenci dışındaki roller 403', async () => {
    assertError(await get(url(ADULT), null), 401, 'unauthenticated')
    const a = await tenant()
    assertError(await get(url(ADULT), a.admin), 403, 'forbidden')
    const others: [Role, MembershipLinkInput[]][] = [
      ['onburo', []],
      ['ogretmen', [{ kind: 'teacher', recordId: 't1' }]],
      ['veli', [{ kind: 'child', recordId: ADULT }]],
    ]
    for (const [role, links] of others) {
      const cookie = await signInAs(app, await createMember(app, a.id, role, links))
      assertError(await get(url(ADULT), cookie), 403, 'forbidden')
    }
  })

  test('DOM-FIN-059: yetişkin kursiyer kendi sözleşmesini sürüm, durum ve plan özetiyle okur', async () => {
    const a = await tenant()
    const response = await get(url(ADULT), await a.learner(ADULT))
    assert.equal(response.statusCode, 200, response.body)
    const [item, ...rest] = response.json().data
    assert.equal(rest.length, 0)
    assert.equal(item.contract.id, CONTRACT_ID)
    assert.equal(item.contract.title, 'Dil kursu eğitim sözleşmesi')
    assert.equal(item.contract.payer, 'student')
    assert.equal(item.contract.amount, 10_000_000)
    assert.equal(item.status, 'awaiting_signatory')
    assert.deepEqual(item.plan, {
      installmentCount: 2,
      totalCents: 10_000_000,
      paidCount: 1,
      nextDue: { date: '2026-12-15', amountCents: 5_000_000 },
    })
    // Doğum tarihi yalnız karar içindir, yanıta girmez.
    assert.ok(!response.body.includes(ADULT_BIRTH))
  })

  test('DOM-FIN-059: başka öğrencinin ve olmayan öğrencinin sözleşmesi 404', async () => {
    const a = await tenant()
    const cookie = await a.learner(ADULT)
    assertError(await get(url(MINOR), cookie), 404, 'not_found')
    assertError(await get(url('ogrenci-yok'), cookie), 404, 'not_found')
  })

  test('DOM-FIN-059: başka kurumun kursiyeri 404, B kurumunun sözleşmesi değişmez', async () => {
    const a = await tenant()
    const b = await tenant()
    // Yalnız B'de bulunan kursiyer: A'nın oturumu onu hiçbir yoldan görmez.
    const student = SEED.students.find((item) => item.id === ADULT)
    await insertMissingRecords(
      db,
      b.id,
      [{ collection: 'students', id: B_ONLY, data: { ...student, id: B_ONLY } }],
      FIXED_NOW,
    )
    const before = await loadRecords(db, b.id, ['students', 'contracts', 'invoices'])
    assertError(await get(url(B_ONLY), await a.learner(ADULT)), 404, 'not_found')
    assert.deepEqual(await loadRecords(db, b.id, ['students', 'contracts', 'invoices']), before)
    // B'nin kendi kursiyeri aynı uçla kendi sözleşmesini okur; A'nın kaydı ona karışmaz.
    const own = await get(url(ADULT), await b.learner(ADULT))
    assert.equal(own.statusCode, 200, own.body)
    assert.equal(own.json().data.length, 1)
  })

  test('DOM-FIN-059: okulda uç yoktur; yetişkin öğrenci de 404', async () => {
    const school = await tenant('school')
    assertError(await get(url(ADULT), await school.learner(ADULT)), 404, 'not_found')
  })

  test('DOM-FIN-059, DOM-KAY-012: 18 yaş altı kursiyer 403 adult_learner_only', async () => {
    const a = await tenant()
    const response = await get(url(MINOR), await a.learner(MINOR))
    assertError(response, 403, 'adult_learner_only')
    assert.match(response.json().message, /velinizin hesabında/)
  })

  test('DOM-FIN-059, DOM-YTK-040: finans modülü kapalıyken 403 module_disabled', async () => {
    const a = await tenant('language_school', { finance: false })
    assertError(await get(url(ADULT), await a.learner(ADULT)), 403, 'module_disabled')
  })
})
