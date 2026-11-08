import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { payments } from '../src/db/schema/payments.ts'
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

/**
 * Öğrenci başı maliyet (ON-249) ve çok kampüslü konsolide rapor (ON-250); DOM-FIN-065. Her test
 * kendi kurumunu kurar: seed kampüsleri, Kadıköy'de 7-A (6 öğrenci) ve Ataşehir'de 7-B (3 öğrenci),
 * mezun olmuş bir öğrenci; merkezler GEN (birim), KAD (kampüs) ⊃ KAD-7 (program), ATA (kampüs);
 * 2026–2027 bütçe dönemi. FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const [KADIKOY, ATASEHIR] = SEED.branches
const CLASS_KAD = SEED.classes.find((item) => item.branchId === KADIKOY?.id && item.grade === 7)
const CLASS_ATA = SEED.classes.find((item) => item.branchId === ATASEHIR?.id && item.grade === 7)
const BASE_STUDENT = SEED.students[0]
const COST = '/api/v1/finance/cost-per-student'
const CONSOLIDATION = '/api/v1/finance/campus-consolidation'

type Json = Record<string, unknown>
type Rows = Json[]

const student = (id: string, classId: string, extra: Json = {}) => ({
  collection: 'students' as const,
  id,
  data: {
    ...BASE_STUDENT,
    id,
    name: `Öğrenci ${id}`,
    number: id,
    email: `${id}@kampus.example`,
    classId,
    joinedAt: '2025-09-01T09:00:00.000Z',
    ...extra,
  },
})
const invoice = (id: string, studentId: string, amount: number, dueDay: string) => ({
  collection: 'invoices' as const,
  id,
  data: {
    id,
    studentId,
    installment: 1,
    amount,
    dueDate: `${dueDay}T09:00:00.000Z`,
    paidAt: null,
    method: null,
    reminderAt: null,
    feeKind: 'tuition',
    academicYear: 2026,
  },
})

describe('DOM-FIN-065: öğrenci başı maliyet ve kampüs konsolidasyonu uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenants = 0
  let receiptSerial = 0
  let clientIp = '10.65.0.1'
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(KADIKOY && ATASEHIR && CLASS_KAD && CLASS_ATA && BASE_STUDENT)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(method: 'GET' | 'POST', url: string, cookie: string | null, payload?: unknown) {
    return app.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  async function ok(response: Awaited<ReturnType<App['inject']>>, status = 200): Promise<Json> {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  /** Kurum, öğrenciler, taksit ve tahsilatlar, merkezler, kalemler ve dönem. */
  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    assert.ok(KADIKOY && ATASEHIR && CLASS_KAD && CLASS_ATA)
    clientIp = `10.65.${String((tenants += 1))}.1`
    const created = await createInstitution(app, overrides)
    const admin = await signInAs(app, created.admin)
    await insertMissingRecords(
      db,
      created.id,
      [
        ...SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
        { collection: 'classes' as const, id: CLASS_KAD.id, data: { ...CLASS_KAD } },
        { collection: 'classes' as const, id: CLASS_ATA.id, data: { ...CLASS_ATA } },
        ...Array.from({ length: 6 }, (_, i) => student(`cr-k${String(i + 1)}`, CLASS_KAD.id)),
        ...Array.from({ length: 3 }, (_, i) => student(`cr-a${String(i + 1)}`, CLASS_ATA.id)),
        // Dönemde mezun olan öğrenci sayılır; dönemden önce ayrılmış (çıkış günü yok) sayılmaz.
        student('cr-m1', CLASS_KAD.id, { isActive: false }),
        student('cr-old', CLASS_KAD.id, { isActive: false }),
        {
          collection: 'renewals' as const,
          id: 'cr-grad',
          data: {
            id: 'cr-grad',
            studentId: 'cr-m1',
            year: 2026,
            status: 'Mezun',
            mode: 'graduate',
            fromClassId: CLASS_KAD.id,
            targetClassId: CLASS_KAD.id,
            createdAt: '2026-09-20T09:00:00.000Z',
            activatedAt: '2026-09-30T09:00:00.000Z',
          },
        },
        invoice('cr-i1', 'cr-k1', 1_000_000, '2026-09-15'),
        invoice('cr-i2', 'cr-a1', 400_000, '2026-10-15'),
        invoice('cr-i3', 'cr-k2', 999_999, '2027-09-15'),
      ],
      FIXED_NOW,
    )
    for (const [studentId, amountCents, reversedAt] of [
      ['cr-k1', 600_000, null],
      ['cr-a1', 100_000, new Date('2026-10-02T09:00:00.000Z')],
    ] as const)
      await db.insert(payments).values({
        institutionId: created.id,
        id: randomUUID(),
        studentId,
        amountCents,
        method: 'bank_transfer',
        reference: `CR-${String((receiptSerial += 1))}`,
        paidAt: new Date('2026-10-01T09:00:00.000Z'),
        ...(reversedAt === null
          ? {}
          : {
              reversedAt,
              reversedByUserId: created.admin.id,
              reversalReason: 'Yanlış tutar girildi',
            }),
        receiptYear: 2026,
        receiptNumber: receiptSerial,
        recordedByUserId: created.admin.id,
      })
    const post = async (url: string, body: Json) => ok(await call('POST', url, admin, body), 201)
    const gen = await post('/api/v1/finance/cost-centers', {
      code: 'GEN',
      name: 'Genel müdürlük',
      type: 'unit',
    })
    const kad = await post('/api/v1/finance/cost-centers', {
      code: 'KAD',
      name: 'Kadıköy',
      type: 'campus',
      campusId: KADIKOY.id,
    })
    const kad7 = await post('/api/v1/finance/cost-centers', {
      code: 'KAD-7',
      name: 'Kadıköy 7. sınıf',
      type: 'program',
      parentId: kad.id,
      gradeLevel: 7,
    })
    const ata = await post('/api/v1/finance/cost-centers', {
      code: 'ATA',
      name: 'Ataşehir',
      type: 'campus',
      campusId: ATASEHIR.id,
    })
    const expense = await post('/api/v1/finance/budget-items', {
      code: 'P-100',
      name: 'Personel',
      kind: 'expense',
    })
    const income = await post('/api/v1/finance/budget-items', {
      code: 'G-100',
      name: 'Öğrenim geliri',
      kind: 'income',
      feeKind: 'tuition',
    })
    const period = await post('/api/v1/finance/budget-periods', {
      name: '2026–2027',
      academicYear: 2026,
    })
    const lines = `/api/v1/finance/budget-periods/${String(period.id)}/lines`
    for (const [center, item, amountCents] of [
      [gen, expense, 1_000_000],
      [kad, expense, 700_000],
      [kad7, expense, 210_000],
      [ata, expense, 300_000],
      [kad, income, 9_000_000],
    ] as const)
      await post(lines, { costCenterId: center.id, itemId: item.id, amountCents })
    return { id: created.id, admin, period }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const query = (t: Tenant, extra = '') => `?periodId=${String(t.period.id)}${extra}`
  const byCode = (data: Json, code: string) => {
    const row = (data.centers as Rows).find((item) => item.code === code)
    assert.ok(row, code)
    return row
  }

  test('DOM-FIN-065: oturumsuz 401; yönetici dışı roller 403; finance kapalıyken 403', async () => {
    const a = await institution()
    for (const url of [COST, CONSOLIDATION]) {
      assert.equal((await get(`${url}${query(a)}`, null)).statusCode, 401)
      for (const role of ['onburo', 'ogretmen', 'veli'] as const) {
        const response = await get(`${url}${query(a)}`, await member(a.id, role))
        assert.equal(response.statusCode, 403, `${role} ${url}: ${response.body}`)
        assert.equal(response.json().data, undefined)
      }
    }
    const disabled = await createInstitution(app, { enabledModules: { finance: false } })
    const cookie = await signInAs(app, disabled.admin)
    for (const url of [COST, CONSOLIDATION]) {
      const response = await get(`${url}?periodId=${randomUUID()}`, cookie)
      assert.equal(response.statusCode, 403, response.body)
      assert.equal(response.json().code, 'module_disabled')
    }
  })

  test('DOM-FIN-065: ortak gider öğrenci sayısıyla paylaştırılır, gelir satırı girmez, küçük grup gizlenir', async () => {
    const a = await institution()
    const data = await ok(await get(`${COST}${query(a)}`, a.admin))
    assert.equal(data.key, 'students')
    assert.equal((data.period as Json).id, a.period.id)
    // Kök: GEN 1.000.000 → KAD (6 + mezun = 7) : ATA (3) = 700.000 / 300.000.
    const kad = byCode(data, 'KAD')
    assert.equal(kad.studentCount, 7)
    assert.equal(kad.sharedInCents, 700_000)
    assert.equal(kad.totalCents, 1_610_000)
    assert.equal(kad.perStudentCents, 230_000)
    const kad7 = byCode(data, 'KAD-7')
    assert.equal(kad7.totalCents, 1_610_000, 'tek öğrencili alt merkez kampüsün bütün payını alır')
    assert.equal(kad7.campusId, KADIKOY?.id)
    const ata = byCode(data, 'ATA')
    assert.equal(ata.studentCount, 3)
    assert.equal(ata.totalCents, 600_000)
    assert.equal(ata.perStudentCents, null)
    assert.equal(ata.suppressed, true)
    assert.equal(byCode(data, 'GEN').shared, true)
    assert.deepEqual(data.totals, {
      expenseCents: 2_210_000,
      studentCount: 10,
      perStudentCents: 221_000,
      suppressed: false,
      unallocatedCents: 0,
      studentsWithoutCampus: 0,
    })
    const equal = await ok(await get(`${COST}${query(a, '&key=equal')}`, a.admin))
    assert.equal(byCode(equal, 'KAD').sharedInCents, 500_000)
    assert.equal(byCode(equal, 'ATA').sharedInCents, 500_000)
  })

  test('DOM-FIN-065: konsolide rapor kampüs satırlarını verir, toplam muhasebe özetine eşittir', async () => {
    const a = await institution()
    const data = await ok(await get(`${CONSOLIDATION}${query(a)}`, a.admin))
    assert.equal(data.from, (a.period as Json).startDate)
    assert.equal(data.to, (a.period as Json).endDate)
    const rows = data.campuses as Rows
    const kad = rows.find((row) => row.campusId === KADIKOY?.id)
    const ata = rows.find((row) => row.campusId === ATASEHIR?.id)
    assert.ok(kad && ata)
    assert.equal(kad.accruedCents, 1_000_000)
    assert.equal(kad.collectedCents, 600_000)
    assert.equal(kad.budgetExpenseCents, 1_610_000)
    assert.equal(kad.studentCount, 7)
    assert.equal(kad.hasCostCenter, true)
    assert.equal(kad.accruedPerStudentCents, 142_857)
    assert.equal(ata.accruedCents, 400_000)
    assert.equal(ata.collectedCents, 100_000)
    assert.equal(ata.reversedCents, 100_000)
    assert.equal(ata.netCollectedCents, 0)
    assert.equal(ata.suppressed, true)
    const third = rows.find((row) => row.campusId === SEED.branches[2]?.id)
    assert.equal(third?.hasCostCenter, false, 'merkezi olmayan etkin kampüs de listelenir')
    assert.equal(
      rows.some((row) => row.campusId === null),
      false,
      'kampüssüz hareket yoksa satır yok',
    )
    const totals = data.totals as Json
    const summary = await ok(
      await get(`/api/v1/finance/summary?from=${String(data.from)}&to=${String(data.to)}`, a.admin),
    )
    assert.equal(totals.accruedCents, (summary.invoices as Json).totalCents)
    assert.equal(
      Number(totals.collectedCents) - Number(totals.reversedCents),
      (summary.payments as Json).totalCents,
    )
    assert.equal(totals.refundedCents, (summary.refunds as Json).totalCents)
    assert.equal(totals.budgetExpenseCents, 2_210_000)
    assert.equal(totals.studentCount, 10)
  })

  test('DOM-FIN-065: başka kurumun dönemi 404; başka kurumun satırı ve öğrencisi raporda yok', async () => {
    const a = await institution()
    const b = await institution()
    for (const url of [COST, CONSOLIDATION]) {
      const response = await get(`${url}${query(b)}`, a.admin)
      assert.equal(response.statusCode, 404, response.body)
      assert.equal(response.json().data, undefined)
      assert.equal((await get(`${url}?periodId=${randomUUID()}`, a.admin)).statusCode, 404)
    }
    const cost = await ok(await get(`${COST}${query(a)}`, a.admin))
    const own = await ok(await get('/api/v1/finance/cost-centers', a.admin))
    assert.deepEqual(
      (cost.centers as Rows).map((row) => row.id).sort(),
      (own as unknown as Rows).map((row) => row.id).sort(),
    )
    assert.equal((cost.totals as Json).expenseCents, 2_210_000, 'B satırları A toplamına girmez')
    const consolidation = await ok(await get(`${CONSOLIDATION}${query(a)}`, a.admin))
    assert.equal((consolidation.totals as Json).accruedCents, 1_400_000)
    assert.equal((consolidation.totals as Json).studentCount, 10)
  })

  test('DOM-FIN-065: eksik dönem, bilinmeyen anahtar ve parametre 400', async () => {
    const a = await institution()
    for (const url of [COST, CONSOLIDATION]) {
      assert.equal((await get(url, a.admin)).statusCode, 400)
      assert.equal((await get(`${url}${query(a, '&key=agirlik')}`, a.admin)).statusCode, 400)
      assert.equal((await get(`${url}${query(a, '&institutionId=x')}`, a.admin)).statusCode, 400)
      assert.equal((await get(`${url}?periodId=gecersiz`, a.admin)).statusCode, 400)
    }
  })
})
