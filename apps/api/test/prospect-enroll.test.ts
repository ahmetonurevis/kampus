import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { records } from '../src/db/schema/records.ts'
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

/**
 * Kesin kayıt ucu `POST /prospects/:prospectId/enroll` (docs/domain/kayit-ve-crm.md DOM-KAY-001,
 * DOM-KAY-011, DOM-KAY-035). Her test kendi kurumunu örnek veri kesitiyle kurar: kampüsler,
 * kadro, 7-A (c1, kapasite 24, 10 öğrenci) ve seed adayları pr1…pr5 (pr1 Yeni aday, pr4 Teklif
 * verildi, pr5 Vazgeçti). Eşzamanlı iki kayıt `test:pg` takımındadır (`pg-concurrency.test.ts`).
 */

const SEED = createSeed(FIXED_NOW)
type Sample = Partial<Record<CollectionName, readonly Record<string, unknown>[]>>
const SAMPLE: Sample = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => item.id === 'c1'),
  students: SEED.students.filter((item) => item.classId === 'c1'),
  prospects: SEED.prospects.slice(0, 5),
}
const PR1 = SEED.prospects[0]
const CLASS_SIZE = SAMPLE.students?.length ?? 0
/** Kesin kayıtla yazılan ve değişmemesi beklenen koleksiyonlar. */
const WRITTEN = [
  'prospects',
  'students',
  'parents',
  'invoices',
  'contracts',
] as const satisfies readonly CollectionName[]

/** Geçerli bir T.C. kimlik numarası (denetim haneleri doğru, gerçek kişiye ait değil). */
const NATIONAL_ID = '10000000146'
/** 36.000 ₺ = 3.600.000 kuruş, üç taksit: 3 × 1.200.000 kuruş. */
const REGISTRATION = { classId: 'c1', totalCents: 3_600_000, count: 3, startDate: '2026-11-15' }

function rows(sample: Sample) {
  return Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

describe('kesin kayıt ucu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const newKey = () => `test-enroll-${String(++serial).padStart(5, '0')}`

  before(async () => {
    assert.ok(PR1)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}, sample = SAMPLE) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, rows(sample), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role) {
    const links =
      role === 'ogretmen'
        ? [{ kind: 'teacher' as const, recordId: 't1' }]
        : role === 'ogrenci'
          ? [{ kind: 'student' as const, recordId: 's1' }]
          : role === 'veli'
            ? [{ kind: 'child' as const, recordId: 's1' }]
            : []
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const frontDesk = async (institutionId: string) => (await member(institutionId, 'onburo')).cookie

  interface EnrollRequest {
    cookie: string | null
    prospectId?: string
    body?: unknown
    version?: number | null
    key?: string | null
    target?: App
  }
  function enroll({
    cookie,
    prospectId = 'pr1',
    body = REGISTRATION,
    version = 1,
    key = newKey(),
    target = app,
  }: EnrollRequest) {
    return target.inject({
      method: 'POST',
      url: `/api/v1/prospects/${prospectId}/enroll`,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...(version === null ? {} : { 'if-match': `"${String(version)}"` }),
        ...(key === null ? {} : { 'idempotency-key': key }),
      },
      payload: JSON.stringify(body),
    })
  }
  function assertError(
    response: Awaited<ReturnType<typeof enroll>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  /** Kurumun kesin kayıtla yazılan bütün kayıtları (kimlik, sürüm, veri). */
  async function snapshot(institutionId: string) {
    const loaded = await loadRecords(db, institutionId, WRITTEN)
    return loaded
      .map((row) => ({
        collection: row.collection,
        id: row.id,
        version: row.version,
        data: row.data,
      }))
      .sort((a, b) => `${a.collection}/${a.id}`.localeCompare(`${b.collection}/${b.id}`))
  }
  /** Başarısız isteklerden sonra kesin kayıt koleksiyonları ve denetim kaydı aynı kalır. */
  async function unchanged(institutionId: string, action: () => Promise<void>) {
    const before = await snapshot(institutionId)
    const audits = await enrollAudits(institutionId)
    await action()
    assert.deepEqual(await snapshot(institutionId), before)
    assert.equal((await enrollAudits(institutionId)).length, audits.length)
  }
  const enrollAudits = (institutionId: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, 'prospect.enroll')))
  const versionOf = async (institutionId: string, id: string) => {
    const record = await findRecord(db, institutionId, 'prospects', id)
    assert.ok(record, id)
    return record.version
  }
  const count = async (institutionId: string, collection: CollectionName) =>
    (await loadRecords(db, institutionId, [collection])).length

  // --- Kimlik, rol, modül ----------------------------------------------------------------------

  test('DOM-KAY-035: oturumsuz istek 401; kayıt değişmez', async () => {
    const a = await institution()
    await unchanged(a.id, async () => {
      assertError(await enroll({ cookie: null }), 401)
    })
  })

  test('DOM-KAY-035, DOM-YTK-001: rol ızgarası; yönetici ve ön büro kayda alır, öğretmen, öğrenci ve veli 403', async () => {
    const a = await institution()
    await unchanged(a.id, async () => {
      for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
        const { cookie } = await member(a.id, role)
        assertError(await enroll({ cookie }), 403, 'forbidden')
        // Yetkisiz rol olmayan adayda da 403 alır: kaydın varlığını öğrenmez.
        assertError(await enroll({ cookie, prospectId: 'pr-yok' }), 403, 'forbidden')
      }
    })
    const desk = await enroll({ cookie: await frontDesk(a.id) })
    assert.equal(desk.statusCode, 201, desk.body)
    const admin = await enroll({ cookie: a.adminCookie, prospectId: 'pr4' })
    assert.equal(admin.statusCode, 201, admin.body)
    assert.equal(await count(a.id, 'students'), CLASS_SIZE + 2)
  })

  test('DOM-KAY-035, DOM-YTK-040: crm veya finance modülü kapalıyken 403 module_disabled; hiçbir kayıt ve denetim yazılmaz', async () => {
    // Kesin kayıt taksit ve sözleşme yazdığı için `crm` yanında `finance` modülünü de ister.
    for (const enabledModules of [{ crm: false }, { finance: false }] as Record<
      string,
      boolean
    >[]) {
      const closed = await institution({ enabledModules })
      await unchanged(closed.id, async () => {
        assertError(await enroll({ cookie: closed.adminCookie }), 403, 'module_disabled')
        assertError(await enroll({ cookie: await frontDesk(closed.id) }), 403, 'module_disabled')
        // Modül denetimi rol ve gövdeden önce: geçersiz gövdede de 403.
        const invalid = await enroll({ cookie: closed.adminCookie, body: { classId: 'c1' } })
        assertError(invalid, 403, 'module_disabled')
      })
      assert.equal(await count(closed.id, 'students'), CLASS_SIZE)
      assert.equal(await count(closed.id, 'invoices'), 0)
      assert.equal(await count(closed.id, 'contracts'), 0)
      assert.equal(await count(closed.id, 'parents'), 0)
      assert.equal((await findRecord(db, closed.id, 'prospects', 'pr1'))?.data.stage, PR1?.stage)
    }
  })

  // --- Başarı ------------------------------------------------------------------------------------

  test('DOM-KAY-001, DOM-KAY-035: ön büro adayı kayda alır; 201, öğrenciye Location, tek işlemde öğrenci, veli, taksit, sözleşme ve Kayıt oldu', async () => {
    const a = await institution()
    const b = await institution()
    const bBefore = await snapshot(b.id)
    const response = await enroll({ cookie: await frontDesk(a.id) })
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data
    assert.equal(data.entity.collection, 'students')
    const studentId: string = data.entity.id
    assert.equal(response.headers.location, `/api/v1/collections/students/${studentId}`)
    assert.deepEqual(data.changes, { inserted: 6, updated: 1, archived: 0, restored: 0 })

    const prospect = await findRecord(db, a.id, 'prospects', 'pr1')
    assert.equal(prospect?.data.stage, 'Kayıt oldu')
    assert.equal(prospect?.data.studentId, studentId)
    assert.equal(prospect?.version, 2)
    const prospectRecord = data.records.find(
      (item: { collection: string }) => item.collection === 'prospects',
    )
    assert.deepEqual(prospectRecord, {
      collection: 'prospects',
      id: 'pr1',
      version: 2,
      change: 'update',
    })

    const student = await findRecord(db, a.id, 'students', studentId)
    assert.equal(student?.data.name, PR1?.name)
    assert.equal(student?.data.classId, 'c1')
    assert.equal(student?.data.isActive, true)
    assert.equal(student?.data.joinedAt, FIXED_NOW.toISOString())
    const parent = await findRecord(db, a.id, 'parents', String(student?.data.parentId))
    assert.deepEqual(parent?.data.studentIds, [studentId])

    // Para kuruş cinsinden tamsayıdır: 36.000 ₺ = 3.600.000 kuruş, üç eşit taksit.
    const invoices = (await loadRecords(db, a.id, ['invoices'])).map((row) => row.data)
    assert.deepEqual(
      invoices.map((item) => [item.installment, item.amount, item.dueDate, item.paidAt]),
      [
        [1, 1_200_000, '2026-11-15T09:00:00.000Z', null],
        [2, 1_200_000, '2026-12-15T09:00:00.000Z', null],
        [3, 1_200_000, '2027-01-15T09:00:00.000Z', null],
      ],
    )
    assert.ok(invoices.every((item) => item.studentId === studentId))
    const contracts = (await loadRecords(db, a.id, ['contracts'])).map((row) => row.data)
    assert.equal(contracts.length, 1)
    assert.equal(contracts[0]?.amount, 3_600_000)
    assert.equal(contracts[0]?.studentId, studentId)

    // Denetim kaydı adaya bağlıdır; yalnız alan adları ve kimlikler taşır, kişisel veri yok.
    const audit = await enrollAudits(a.id)
    assert.equal(audit.length, 1)
    assert.deepEqual([audit[0]?.entityType, audit[0]?.entityId], ['prospects', 'pr1'])
    assert.equal(audit[0]?.actorRole, 'onburo')
    const text = JSON.stringify(audit)
    for (const value of [PR1?.name, PR1?.phone, PR1?.email, 'velisi'])
      assert.equal(text.includes(String(value)), false, `denetimde: ${String(value)}`)
    assert.deepEqual(await snapshot(b.id), bBefore)
  })

  // --- Başlıklar ve tekrar -----------------------------------------------------------------------

  test('DOM-KAY-035: If-Match ve Idempotency-Key zorunlu; eksik 400, biçimsiz 400, yanlış sürüm 409; kayıt değişmez', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    await unchanged(a.id, async () => {
      assertError(await enroll({ cookie, version: null }), 400, 'if_match_required')
      assertError(await enroll({ cookie, key: null }), 400, 'idempotency_key_required')
      assertError(await enroll({ cookie, key: 'kisa' }), 400, 'validation_failed')
      assertError(await enroll({ cookie, version: 0 }), 400, 'validation_failed')
      assertError(await enroll({ cookie, version: 2 }), 409, 'version_conflict')
      // Bayat sürümdeki kural hatası da 409 olur: istemcinin gördüğü kayıt bayattır.
      assertError(
        await enroll({ cookie, version: 2, body: { ...REGISTRATION, startDate: '2026-02-30' } }),
        409,
        'version_conflict',
      )
    })
  })

  test('DOM-KAY-011: aynı Idempotency-Key ilk yanıtı tekrarlar, ikinci öğrenci ve taksit yazılmaz; yeni anahtarla 409', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    const key = newKey()
    const first = await enroll({ cookie, key })
    assert.equal(first.statusCode, 201, first.body)
    const after = await snapshot(a.id)
    const again = await enroll({ cookie, key })
    assert.equal(again.statusCode, 201, again.body)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    assert.equal(typeof again.json().data.contractId, 'string')
    assert.equal(again.headers.location, first.headers.location)
    await unchanged(a.id, async () => {
      // Aynı anahtar farklı gövde: 422; yeni anahtar ve güncel sürüm: aday zaten kayıtlı.
      assertError(
        await enroll({ cookie, key, body: { ...REGISTRATION, count: 2 } }),
        422,
        'idempotency_key_reused',
      )
      assertError(await enroll({ cookie, version: 2 }), 409, 'prospect_already_enrolled')
      assertError(await enroll({ cookie, version: 1 }), 409, 'version_conflict')
    })
    assert.deepEqual(await snapshot(a.id), after)
    assert.equal(await count(a.id, 'students'), CLASS_SIZE + 1)
    assert.equal(await count(a.id, 'invoices'), 3)
  })

  // --- Kapalı aday ---------------------------------------------------------------------------------

  test('DOM-KAY-035, DOM-KAY-030: vazgeçmiş ve tanınmayan aşamadaki aday 409 prospect_closed; kayıt değişmez', async () => {
    const legacy = {
      ...PR1,
      id: 'test-pr-legacy',
      phone: '05559990401',
      email: '',
      stage: 'Ön kayıt',
    }
    const a = await institution({}, { ...SAMPLE, prospects: [...(SAMPLE.prospects ?? []), legacy] })
    const cookie = await frontDesk(a.id)
    await unchanged(a.id, async () => {
      assertError(
        await enroll({ cookie, prospectId: 'pr5', version: await versionOf(a.id, 'pr5') }),
        409,
        'prospect_closed',
      )
      assertError(
        await enroll({ cookie, prospectId: legacy.id, version: await versionOf(a.id, legacy.id) }),
        409,
        'prospect_closed',
      )
    })
  })

  // --- Doğrulama ve kural ---------------------------------------------------------------------------

  test('DOM-KAY-035: geçersiz gövde 400, gövdede aday veya kurum kimliği 400; core kural reddi 422; kayıt değişmez', async () => {
    const full = {
      id: 'test-c-full',
      name: 'Test Dolu Sınıf',
      grade: 7,
      section: 'Z',
      level: '7. Sınıf',
      branchId: 'b1',
      teacherId: 't1',
      capacity: 1,
      room: '199',
      isActive: true,
      deletedAt: null,
    }
    const occupant = { ...SEED.students[0], id: 'test-s-full', classId: full.id }
    const a = await institution(
      {},
      {
        ...SAMPLE,
        classes: [...(SAMPLE.classes ?? []), full],
        students: [...(SAMPLE.students ?? []), occupant],
      },
    )
    const b = await institution()
    const cookie = await frontDesk(a.id)
    await unchanged(a.id, async () => {
      for (const body of [
        { ...REGISTRATION, count: 13 },
        { ...REGISTRATION, count: '3' },
        { ...REGISTRATION, startDate: '15.11.2026' },
        { ...REGISTRATION, classId: '' },
        { ...REGISTRATION, prospectId: 'pr4' },
        { ...REGISTRATION, institutionId: b.id },
        { classId: 'c1' },
      ]) {
        const response = await enroll({ cookie, body })
        assertError(response, 400, 'validation_failed')
        assert.ok(Array.isArray(response.json().issues))
      }
      // Eski lira alanı kabul edilmez: `total` bilinmeyen alandır, `totalCents` eksiktir.
      const lira = await enroll({
        cookie,
        body: { ...REGISTRATION, totalCents: undefined, total: 36000 },
      })
      assertError(lira, 400, 'validation_failed')
      assert.ok(
        lira.json().issues.some((item: { path: string[] }) => item.path.join('.') === 'totalCents'),
        lira.body,
      )
      assertError(
        await enroll({ cookie, body: { ...REGISTRATION, classId: full.id } }),
        422,
        'class_capacity_full',
      )
      assertError(
        await enroll({ cookie, body: { ...REGISTRATION, startDate: '2026-02-30' } }),
        422,
        'invalid_payment_date',
      )
    })
  })

  test('DOM-KAY-011: tutar kuruştur; metin, kesirli, sınır dışı tutar 400 totalCents yoluyla; kayıt değişmez', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    const issuePaths = (response: Awaited<ReturnType<typeof enroll>>) =>
      (response.json().issues as { path: string[] }[]).map((item) => item.path.join('.'))
    await unchanged(a.id, async () => {
      for (const totalCents of ['3600000', 36000.5, 0, -10_000, 9_999, 100_000_001, null]) {
        const response = await enroll({ cookie, body: { ...REGISTRATION, totalCents } })
        assertError(response, 400, 'validation_failed')
        assert.deepEqual(issuePaths(response), ['totalCents'], String(totalCents))
      }
    })
  })

  test('core-kurus, DOM-KAY-011: kuruşlu tutar core’a olduğu gibi geçer; taksitler kuruşu kuruşuna, sözleşme aynı tutar', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    const response = await enroll({ cookie, body: { ...REGISTRATION, totalCents: 3_600_050 } })
    assert.equal(response.statusCode, 201, response.body)
    const invoices = (await loadRecords(db, a.id, ['invoices'])).map((row) => row.data.amount)
    assert.deepEqual(invoices, [1_200_017, 1_200_017, 1_200_016])
    const contracts = (await loadRecords(db, a.id, ['contracts'])).map((row) => row.data.amount)
    assert.deepEqual(contracts, [3_600_050])
  })

  test('DOM-KAY-011: sınır tutarlar kabul edilir; 10.000 kuruş tek taksit, 100.000.000 kuruş on iki taksit, toplam kuruşu kuruşuna', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    const low = await enroll({ cookie, body: { ...REGISTRATION, totalCents: 10_000, count: 1 } })
    assert.equal(low.statusCode, 201, low.body)
    const lowStudent: string = low.json().data.entity.id
    const high = await enroll({
      cookie,
      prospectId: 'pr4',
      body: { ...REGISTRATION, totalCents: 100_000_000, count: 12 },
    })
    assert.equal(high.statusCode, 201, high.body)
    const invoices = (await loadRecords(db, a.id, ['invoices'])).map((row) => row.data)
    const sumFor = (studentId: string) =>
      invoices
        .filter((item) => item.studentId === studentId)
        .reduce((sum, item) => sum + Number(item.amount), 0)
    assert.equal(sumFor(lowStudent), 10_000)
    assert.equal(sumFor(high.json().data.entity.id), 100_000_000)
    assert.equal(invoices.length, 13)
    assert.ok(invoices.every((item) => Number.isInteger(item.amount)))
    const contracts = (await loadRecords(db, a.id, ['contracts'])).map((row) => row.data.amount)
    assert.deepEqual(
      contracts.sort((x, y) => Number(x) - Number(y)),
      [10_000, 100_000_000],
    )
  })

  // --- Kampüs, veli ve kimlik alanları (DOM-KAY-003, -012, -013) --------------------------------

  test('class_campus_mismatch: adayın kampüsünden olmayan sınıf 422 classId yoluyla; allowOtherCampus ile kabul', async () => {
    // pr2 Beşiktaş (b2) adayıdır, c1 Kadıköy (b1) sınıfıdır.
    const a = await institution()
    const cookie = await frontDesk(a.id)
    await unchanged(a.id, async () => {
      for (const body of [REGISTRATION, { ...REGISTRATION, allowOtherCampus: false }]) {
        const response = await enroll({ cookie, prospectId: 'pr2', body })
        assertError(response, 422, 'class_campus_mismatch')
        assert.deepEqual(
          (response.json().issues as { path: string[] }[]).map((item) => item.path),
          [['classId']],
        )
      }
      assertError(
        await enroll({
          cookie,
          prospectId: 'pr2',
          body: { ...REGISTRATION, allowOtherCampus: 'evet' },
        }),
        400,
        'validation_failed',
      )
    })
    const accepted = await enroll({
      cookie,
      prospectId: 'pr2',
      body: { ...REGISTRATION, allowOtherCampus: true },
    })
    assert.equal(accepted.statusCode, 201, accepted.body)
    const student = await findRecord(db, a.id, 'students', accepted.json().data.entity.id)
    assert.equal(student?.data.classId, 'c1')
  })

  test('DOM-KAY-003: 18 yaş altında telefon, e-posta ve veli adı veliye yazılır, öğrenciye yazılmaz; yanıt contractId taşır', async () => {
    const guardian = { ...PR1, guardianName: 'Test Veli Güven' }
    const a = await institution({}, { ...SAMPLE, prospects: [guardian] })
    const cookie = await frontDesk(a.id)
    const response = await enroll({ cookie })
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data
    const student = await findRecord(db, a.id, 'students', data.entity.id)
    assert.equal(student?.data.phone, '')
    assert.equal(student?.data.email, '')
    const parent = await findRecord(db, a.id, 'parents', String(student?.data.parentId))
    assert.deepEqual(parent?.data, {
      id: student?.data.parentId,
      name: 'Test Veli Güven',
      studentIds: [data.entity.id],
      phone: PR1?.phone,
      email: PR1?.email,
    })
    // Sözleşme kimliği yanıttadır; ek sorgu gerekmez (TODO(web-enroll-contract) kapandı).
    const contracts = await loadRecords(db, a.id, ['contracts'])
    assert.equal(contracts.length, 1)
    assert.equal(data.contractId, contracts[0]?.id)
    assert.equal(contracts[0]?.data.payer, 'guardian')
    assert.equal(contracts[0]?.data.title, 'Özel okul eğitim sözleşmesi')
    assert.ok(
      data.records.some(
        (item: { collection: string; id: string }) =>
          item.collection === 'contracts' && item.id === data.contractId,
      ),
    )
  })

  test('DOM-KAY-013: kardeş kaydında mevcut veli kullanılır; yeni veli açılmaz, veli güncellenir', async () => {
    const sibling = { ...SEED.prospects[3], siblingOfId: 'pr1' }
    const a = await institution({}, { ...SAMPLE, prospects: [PR1 ?? {}, sibling] })
    const cookie = await frontDesk(a.id)
    const first = await enroll({ cookie })
    assert.equal(first.statusCode, 201, first.body)
    const parents = await count(a.id, 'parents')
    const second = await enroll({ cookie, prospectId: 'pr4' })
    assert.equal(second.statusCode, 201, second.body)
    assert.equal(await count(a.id, 'parents'), parents)
    assert.deepEqual(second.json().data.changes, {
      inserted: 5,
      updated: 2,
      archived: 0,
      restored: 0,
    })
    const [one, two] = await Promise.all(
      [first, second].map((item) => findRecord(db, a.id, 'students', item.json().data.entity.id)),
    )
    assert.equal(two?.data.parentId, one?.data.parentId)
    const parent = await findRecord(db, a.id, 'parents', String(one?.data.parentId))
    assert.deepEqual(parent?.data.studentIds, [one?.data.id, two?.data.id])
    assert.equal(parent?.version, 2)
  })

  test('DOM-KAY-013: parentId ile seçilen veliye bağlanır; olmayan veya başka kurumun velisi 404 not_found', async () => {
    const b = await institution(
      {},
      { ...SAMPLE, parents: [{ id: 'test-p-b', name: 'B Veli', studentIds: [] }] },
    )
    const a = await institution(
      {},
      { ...SAMPLE, parents: [{ id: 'test-p-a', name: 'A Veli', studentIds: [] }] },
    )
    const cookie = await frontDesk(a.id)
    const bBefore = await snapshot(b.id)
    await unchanged(a.id, async () => {
      for (const parentId of ['test-p-yok', 'test-p-b'])
        assertError(await enroll({ cookie, body: { ...REGISTRATION, parentId } }), 404, 'not_found')
    })
    const parents = await count(a.id, 'parents')
    const response = await enroll({ cookie, body: { ...REGISTRATION, parentId: 'test-p-a' } })
    assert.equal(response.statusCode, 201, response.body)
    assert.equal(await count(a.id, 'parents'), parents)
    const parent = await findRecord(db, a.id, 'parents', 'test-p-a')
    assert.deepEqual(parent?.data, {
      id: 'test-p-a',
      name: 'A Veli',
      studentIds: [response.json().data.entity.id],
    })
    assert.deepEqual(await snapshot(b.id), bBefore)
  })

  test('DOM-KAY-012: kimlik no, doğum tarihi ve yakınlık öğrenciye yazılır; geçersiz kimlik no 400; 18 yaş altında ödeyici öğrenci 422', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    await unchanged(a.id, async () => {
      for (const extra of [
        { nationalId: '10000000145' },
        { nationalId: '1234' },
        { birthDate: '2013-02-30' },
        { guardianRelation: 'dede' },
        { payer: 'kurum' },
      ])
        assertError(
          await enroll({ cookie, body: { ...REGISTRATION, ...extra } }),
          400,
          'validation_failed',
        )
      assertError(
        await enroll({ cookie, body: { ...REGISTRATION, payer: 'student' } }),
        422,
        'payer_must_be_guardian',
      )
      assertError(
        await enroll({ cookie, body: { ...REGISTRATION, birthDate: '2027-01-01' } }),
        422,
        'invalid_birth_date',
      )
    })
    const response = await enroll({
      cookie,
      body: {
        ...REGISTRATION,
        nationalId: NATIONAL_ID,
        birthDate: '2013-04-12',
        guardianRelation: 'father',
        payer: 'guardian',
      },
    })
    assert.equal(response.statusCode, 201, response.body)
    const student = await findRecord(db, a.id, 'students', response.json().data.entity.id)
    assert.equal(student?.data.nationalId, NATIONAL_ID)
    assert.equal(student?.data.birthDate, '2013-04-12')
    assert.equal(student?.data.guardianRelation, 'father')
    // Denetim kaydına kimlik no ve doğum tarihi değeri yazılmaz.
    const audit = JSON.stringify(await enrollAudits(a.id))
    for (const value of [NATIONAL_ID, '2013-04-12'])
      assert.equal(audit.includes(value), false, `denetimde: ${value}`)
  })

  test('DOM-KAY-003, DOM-KAY-012: dil okulunda yetişkin kursiyerin iletişimi kendisine yazılır, ödeyici kendisidir, sözleşme dil kursu başlığı taşır', async () => {
    const adult = { ...PR1, minor: false }
    const a = await institution({ type: 'language_school' }, { ...SAMPLE, prospects: [adult] })
    const cookie = await frontDesk(a.id)
    await unchanged(a.id, async () => {
      assertError(
        await enroll({ cookie, body: { ...REGISTRATION, guardianRelation: 'mother' } }),
        422,
        'guardian_not_applicable',
      )
      assertError(
        await enroll({ cookie, body: { ...REGISTRATION, birthDate: '2010-01-01' } }),
        422,
        'birth_date_minor_mismatch',
      )
    })
    const response = await enroll({ cookie })
    assert.equal(response.statusCode, 201, response.body)
    const student = await findRecord(db, a.id, 'students', response.json().data.entity.id)
    assert.equal(student?.data.phone, PR1?.phone)
    const contract = await findRecord(db, a.id, 'contracts', response.json().data.contractId)
    assert.equal(contract?.data.title, 'Dil kursu eğitim sözleşmesi')
    assert.equal(contract?.data.payer, 'student')
  })

  // --- Kurumlar arası ---------------------------------------------------------------------------------

  test('DOM-KAY-035, DOM-YTK-002: yalnız B kurumunda olan aday ve sınıf A’dan kullanılamaz; 404 ve B değişmez', async () => {
    const a = await institution()
    const onlyB = {
      prospects: [{ ...PR1, id: 'test-pr-b-only', phone: '05559990501', email: '' }],
      classes: [{ ...SEED.classes[0], id: 'test-c-b-only', branchId: 'b1' }],
    }
    const b = await institution(
      {},
      {
        ...SAMPLE,
        ...{
          prospects: [...(SAMPLE.prospects ?? []), ...onlyB.prospects],
          classes: [...(SAMPLE.classes ?? []), ...onlyB.classes],
        },
      },
    )
    const bBefore = await snapshot(b.id)
    const outsider = await frontDesk(a.id)
    await unchanged(a.id, async () => {
      for (const version of [1, 5])
        assertError(
          await enroll({ cookie: outsider, prospectId: 'test-pr-b-only', version }),
          404,
          'not_found',
        )
      assertError(
        await enroll({ cookie: outsider, body: { ...REGISTRATION, classId: 'test-c-b-only' } }),
        404,
        'not_found',
      )
      assertError(await enroll({ cookie: outsider, prospectId: 'pr-yok' }), 404, 'not_found')
    })
    assert.deepEqual(await snapshot(b.id), bBefore)
    // B'nin kendi ön bürosu aynı adayı kendi sınıfına kayda alır.
    const own = await enroll({
      cookie: await frontDesk(b.id),
      prospectId: 'test-pr-b-only',
      body: { ...REGISTRATION, classId: 'test-c-b-only' },
    })
    assert.equal(own.statusCode, 201, own.body)
  })

  // --- Atomiklik ---------------------------------------------------------------------------------------

  test('DOM-KAY-001: yazım yarıda başarısız olursa hiçbir kayıt, denetim ve istek anahtarı yazılmaz; aynı anahtarla yeniden denenir', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    const key = newKey()
    // Yazımlar (koleksiyon, kimlik) sırasıyladır: sözleşme, taksitler, veli ve aday yazıldıktan
    // sonra öğrenci eklenirken veritabanı hatası.
    await db.execute(sql`
      CREATE FUNCTION test_enroll_fail() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'test: öğrenci yazılamadı';
      END $$ LANGUAGE plpgsql`)
    await db.execute(
      sql.raw(`CREATE TRIGGER test_enroll_fail BEFORE INSERT ON records
        FOR EACH ROW WHEN (NEW.collection = 'students' AND NEW.institution_id = '${a.id}')
        EXECUTE FUNCTION test_enroll_fail()`),
    )
    try {
      await unchanged(a.id, async () => {
        assertError(await enroll({ cookie, key }), 500, 'internal_error')
      })
    } finally {
      await db.execute(sql`DROP TRIGGER test_enroll_fail ON records`)
      await db.execute(sql`DROP FUNCTION test_enroll_fail()`)
    }
    const left = await db
      .select({ id: records.id })
      .from(records)
      .where(and(eq(records.institutionId, a.id), eq(records.collection, 'contracts')))
    assert.equal(left.length, 0)
    const retried = await enroll({ cookie, key })
    assert.equal(retried.statusCode, 201, retried.body)
    assert.equal(retried.headers['idempotent-replayed'], undefined)
  })

  // --- Log -----------------------------------------------------------------------------------------------

  test('DOM-KAY-003, DOM-KAY-012, DOM-KAY-035: adayın adı, telefonu, e-postası, veli adı, kimlik no ve doğum tarihi loga düşmez', async () => {
    const guardian = 'Test Gizli Veli Adı'
    const minor = {
      ...PR1,
      id: 'test-pr-log',
      name: 'Test Gizli Aday',
      phone: '05559990601',
      email: 'test-gizli-aday@kampus.example',
      guardianName: guardian,
    }
    const a = await institution({}, { ...SAMPLE, prospects: [minor] })
    const cookie = await frontDesk(a.id)
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs, clock: () => FIXED_NOW })
    try {
      const response = await enroll({
        cookie,
        prospectId: minor.id,
        target: logged,
        body: { ...REGISTRATION, nationalId: NATIONAL_ID, birthDate: '2012-03-04' },
      })
      assert.equal(response.statusCode, 201, response.body)
      const rejected = await enroll({ cookie, prospectId: minor.id, version: 2, target: logged })
      assertError(rejected, 409, 'prospect_already_enrolled')
      const lines = logs.flatMap((line) => line.split('\n')).filter(Boolean)
      assert.ok(lines.some((line) => line.includes('"operation.applied"')))
      const text = lines.join('\n')
      for (const value of [
        minor.name,
        minor.phone,
        minor.email,
        guardian,
        'velisi',
        NATIONAL_ID,
        '2012-03-04',
      ])
        assert.equal(text.includes(value), false, `logda: ${value}`)
    } finally {
      await logged.close()
    }
  })
})
