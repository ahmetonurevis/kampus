import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { mirrorFinanceIds } from '../src/db/finance-mirror-store.ts'
import { allocatedByInvoice } from '../src/db/payments.ts'
import { findRecord, insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
import { records } from '../src/db/schema/records.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
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
import { contractTerms, insertTestTariff, TEST_TARIFF_ID } from './support/finance-terms.ts'

/**
 * Sözleşme onayı ve ek protokol uçları (IST-092; DOM-FIN-010, -012, -051). Her test kendi kurumunu
 * kurar: bir öğrenci, veli, sözleşme (net 100.000 ₺) ve iki taksit. FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const PARENT = SEED.parents.find((item) => item.id === STUDENT?.parentId)
const CONTRACT_ID = 'test-contract'
const SIGNATORY = { name: 'Murat Kurucu', role: 'founder' }
const ACCEPT = { accepted: true }
const AMEND = {
  reason: 'Plan yeniden düzenlendi.',
  installmentCount: 3,
  firstDueDate: '2026-11-15',
}
const url = (id: string, verb: string) => `/api/v1/finance/contracts/${id}/${verb}`

const invoice = (id: string, installment: number) => ({
  id,
  studentId: STUDENT?.id,
  installment,
  amount: 5_000_000,
  dueDate: `2026-1${String(installment)}-15T09:00:00.000Z`,
  paidAt: null,
  method: null,
  reminderAt: null,
  feeKind: 'tuition',
})

const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => item.id === 'c1'),
  students: SEED.students.filter((item) => item.id === STUDENT?.id),
  parents: SEED.parents.filter((item) => item.id === PARENT?.id),
  invoices: [invoice('test-inv-1', 1), invoice('test-inv-2', 2)],
  contracts: [
    {
      id: CONTRACT_ID,
      studentId: STUDENT?.id,
      date: '2026-09-01T09:00:00.000Z',
      amount: 10_000_000,
      title: 'Özel okul eğitim sözleşmesi',
      invoiceIds: ['test-inv-1', 'test-inv-2'],
      academicYear: 2026,
      ...contractTerms({ grossCents: 10_000_000, netCents: 10_000_000 }),
    },
  ],
}

describe('sözleşme onayı ve ek protokol uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  // ON-046e: her testten sonra taksit ve sözleşme aynası kaynakla aynıdır.
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function tenant(overrides: Parameters<typeof createInstitution>[1] = {}) {
    const institution = await createInstitution(app, overrides)
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
    return {
      id: institution.id,
      admin: await signInAs(app, institution.admin),
    }
  }
  const member = async (id: string, role: Role) =>
    signInAs(
      app,
      await createMember(
        app,
        id,
        role,
        role === 'ogretmen' ? [{ kind: 'teacher', recordId: 't1' }] : [],
      ),
    )
  /**
   * Veli hesabı: çocuk bağlantısı velayetli bağı kendisi açar (ödeyici değil); ödeyici velide bağ
   * ödeyici işaretlenir (DOM-ILT-074).
   */
  async function parent(id: string, studentId: string, isPayer: boolean, linked = true) {
    const user = await createMember(
      app,
      id,
      'veli',
      linked ? [{ kind: 'child', recordId: studentId }] : [],
    )
    if (isPayer)
      await db
        .update(studentGuardians)
        .set({ isPayer: true, parentId: String(PARENT?.id) })
        .where(
          and(
            eq(studentGuardians.institutionId, id),
            eq(studentGuardians.membershipId, user.membershipId),
          ),
        )
    return signInAs(app, user)
  }
  const post = (
    target: string,
    cookie: string | null,
    body: unknown,
    version: number | null = 1,
    key: string | null = randomUUID(),
  ) =>
    app.inject({
      method: 'POST',
      url: target,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...(version === null ? {} : { 'if-match': `"${String(version)}"` }),
        ...(key === null ? {} : { 'idempotency-key': key }),
      },
      payload: JSON.stringify(body),
    })
  type Response = Awaited<ReturnType<typeof post>>
  function assertError(response: Response, statusCode: number, code?: string) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const contractOf = async (institutionId: string, id = CONTRACT_ID) => {
    const row = await findRecord(db, institutionId, 'contracts', id)
    assert.ok(row)
    return row
  }
  /** İmza yetkilisi işlenmiş, ödeyicinin onayını bekleyen sözleşme; yeni sürümü döner. */
  async function sign(t: { id: string; admin: string }, id = CONTRACT_ID) {
    const { version } = await contractOf(t.id, id)
    assert.equal((await post(url(id, 'signatory'), t.admin, SIGNATORY, version)).statusCode, 200)
    return (await contractOf(t.id, id)).version
  }
  async function approve(t: { id: string; admin: string }, id = CONTRACT_ID) {
    const version = await sign(t, id)
    const done = await post(url(id, 'approve'), t.admin, ACCEPT, version)
    assert.equal(done.statusCode, 200, done.body)
    return contractOf(t.id, id)
  }
  const invoiceRows = (institutionId: string) =>
    db
      .select({ id: records.id, data: records.data, archivedAt: records.archivedAt })
      .from(records)
      .where(and(eq(records.institutionId, institutionId), eq(records.collection, 'invoices')))

  test('DOM-YTK-001: oturumsuz istek 401', async () => {
    const t = await tenant()
    for (const verb of ['signatory', 'approve', 'amendments', 'cancel-amendment'])
      assertError(await post(url(CONTRACT_ID, verb), null, {}), 401)
    assert.equal((await contractOf(t.id)).version, 1)
  })

  test('DOM-FIN-052, IST-092: yanlış rol 403; imza yetkilisini yalnız yönetici, onayı veli de işler', async () => {
    const t = await tenant()
    const teacher = await member(t.id, 'ogretmen')
    const frontDesk = await member(t.id, 'onburo')
    const student = await member(t.id, 'ogrenci')
    for (const [verb, body] of [
      ['signatory', SIGNATORY],
      ['approve', ACCEPT],
      ['amendments', AMEND],
      ['cancel-amendment', { reason: 'Vazgeçildi.' }],
    ] as const) {
      assertError(await post(url(CONTRACT_ID, verb), teacher, body), 403)
      assertError(await post(url(CONTRACT_ID, verb), student, body), 403)
    }
    assertError(await post(url(CONTRACT_ID, 'signatory'), frontDesk, SIGNATORY), 403)
    const guardian = await parent(t.id, String(STUDENT?.id), true)
    assertError(await post(url(CONTRACT_ID, 'amendments'), guardian, AMEND), 403)
    assertError(await post(url(CONTRACT_ID, 'signatory'), guardian, SIGNATORY), 403)
    assert.equal((await contractOf(t.id)).version, 1)
  })

  test('DOM-YTK-040: finance modülü kapalıyken 403', async () => {
    const t = await tenant({ enabledModules: { finance: false } })
    assertError(
      await post(url(CONTRACT_ID, 'signatory'), t.admin, SIGNATORY),
      403,
      'module_disabled',
    )
  })

  test('DOM-YTK-011: başka kurumun sözleşmesi olmayan kimlikle aynı 404, B değişmez', async () => {
    const a = await tenant()
    const b = await tenant()
    await sign(b)
    const before = await contractOf(b.id)
    // Uç adları envanter testinin aradığı biçimde (`/signatory`) yazılır.
    const bodies = [
      ['/signatory', SIGNATORY],
      ['/approve', ACCEPT],
      ['/amendments', AMEND],
      ['/cancel-amendment', { reason: 'Vazgeçildi.' }],
    ] as const
    // A'nın kendi kaydı aynı kimliği taşımasın diye B'ye özgü bir kopya açılır.
    await insertMissingRecords(
      db,
      b.id,
      [
        {
          collection: 'contracts',
          id: 'test-contract-b',
          data: { ...SAMPLE.contracts?.[0], id: 'test-contract-b' },
        },
      ],
      FIXED_NOW,
    )
    for (const [path, body] of bodies) {
      const verb = path.slice(1)
      const foreign = await post(url('test-contract-b', verb), a.admin, body)
      const missing = await post(url(randomUUID(), verb), a.admin, body)
      assertError(foreign, 404)
      assert.equal(foreign.json().code, missing.json().code)
      assert.equal(foreign.json().message, missing.json().message)
    }
    assert.deepEqual(await contractOf(b.id), before)
    assert.equal((await contractOf(b.id, 'test-contract-b')).version, 1)
  })

  test('IST-092: gövdedeki institutionId ve bilinmeyen alan 400, kayıt değişmez', async () => {
    const t = await tenant()
    assertError(
      await post(url(CONTRACT_ID, 'signatory'), t.admin, { ...SIGNATORY, institutionId: t.id }),
      400,
    )
    assertError(await post(url(CONTRACT_ID, 'signatory'), t.admin, { name: 'A' }), 400)
    assertError(
      await post(url(CONTRACT_ID, 'signatory'), t.admin, { ...SIGNATORY, role: 'manager' }),
      400,
    )
    assertError(await post(url(CONTRACT_ID, 'approve'), t.admin, { accepted: false }), 400)
    assertError(await post(url(CONTRACT_ID, 'amendments'), t.admin, { reason: 'x' }), 400)
    assertError(await post(url(CONTRACT_ID, 'cancel-amendment'), t.admin, {}), 400)
    assert.equal((await contractOf(t.id)).version, 1)
    assert.equal((await contractOf(t.id)).data.signatory, undefined)
  })

  test('IST-092: If-Match ve Idempotency-Key zorunlu; bayat sürüm 409', async () => {
    const t = await tenant()
    assertError(
      await post(url(CONTRACT_ID, 'signatory'), t.admin, SIGNATORY, null),
      400,
      'if_match_required',
    )
    assertError(
      await post(url(CONTRACT_ID, 'signatory'), t.admin, SIGNATORY, 1, null),
      400,
      'idempotency_key_required',
    )
    assertError(
      await post(url(CONTRACT_ID, 'signatory'), t.admin, SIGNATORY, 7),
      409,
      'version_conflict',
    )
    assert.equal((await contractOf(t.id)).version, 1)
  })

  test('IST-092, DOM-FIN-010: imza yetkilisi yoksa onay 422; görevli ıslak imzayı işler, denetime alan adı düşer', async () => {
    const t = await tenant()
    assertError(
      await post(url(CONTRACT_ID, 'approve'), t.admin, ACCEPT),
      422,
      'contract_signatory_required',
    )
    const version = await sign(t)
    const frontDesk = await member(t.id, 'onburo')
    const done = await post(url(CONTRACT_ID, 'approve'), frontDesk, ACCEPT, version)
    assert.equal(done.statusCode, 200, done.body)
    assert.deepEqual(done.json().data.entity, { collection: 'contracts', id: CONTRACT_ID })

    const { data } = await contractOf(t.id)
    const approval = data.approval as Record<string, unknown>
    assert.equal(approval.method, 'wet_signature')
    assert.equal(approval.approvedAt, FIXED_NOW.toISOString())
    assert.equal(approval.payerName, PARENT?.name)
    assert.equal((approval.plan as unknown[]).length, 2)

    const audit = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'contract.approve')))
    assert.equal(audit.length, 1)
    assert.equal(JSON.stringify(audit).includes(String(PARENT?.name)), false)
  })

  test('IST-092: mükerrer onay: aynı anahtar ilk yanıtı tekrarlar, yeni anahtar 409', async () => {
    const t = await tenant()
    const version = await sign(t)
    const key = randomUUID()
    const first = await post(url(CONTRACT_ID, 'approve'), t.admin, ACCEPT, version, key)
    assert.equal(first.statusCode, 200, first.body)
    const replay = await post(url(CONTRACT_ID, 'approve'), t.admin, ACCEPT, version, key)
    assert.equal(replay.statusCode, 200)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())
    const current = (await contractOf(t.id)).version
    assertError(
      await post(url(CONTRACT_ID, 'approve'), t.admin, ACCEPT, current),
      409,
      'contract_already_approved',
    )
    assertError(
      await post(url(CONTRACT_ID, 'signatory'), t.admin, SIGNATORY, current),
      409,
      'contract_already_approved',
    )
  })

  test('IST-092, DOM-FIN-052: ödeyici veli elektronik onay verir; ödeyici olmayan 403, kapsam dışı 404', async () => {
    const t = await tenant()
    const version = await sign(t)
    const studentId = String(STUDENT?.id)
    const stranger = await parent(t.id, studentId, false, false)
    assertError(await post(url(CONTRACT_ID, 'approve'), stranger, ACCEPT, version), 404)
    const second = await parent(t.id, studentId, false)
    assertError(
      await post(url(CONTRACT_ID, 'approve'), second, ACCEPT, version),
      403,
      'contract_payer_only',
    )
    assert.equal((await contractOf(t.id)).data.approval, undefined)

    const payer = await parent(t.id, studentId, true)
    const done = await post(url(CONTRACT_ID, 'approve'), payer, ACCEPT, version)
    assert.equal(done.statusCode, 200, done.body)
    const approval = (await contractOf(t.id)).data.approval as Record<string, unknown>
    assert.equal(approval.method, 'electronic')
  })

  test('DOM-FIN-010, -051: ek protokol onaya kadar taksitleri değiştirmez; onayla plan geçer, eski sürüm değişmez', async () => {
    const t = await tenant()
    const previous = await approve(t)

    assertError(
      await post(
        url(CONTRACT_ID, 'amendments'),
        t.admin,
        { ...AMEND, firstDueDate: '2026-01-01' },
        previous.version,
      ),
      422,
      'contract_amendment_date_past',
    )
    const created = await post(url(CONTRACT_ID, 'amendments'), t.admin, AMEND, previous.version)
    assert.equal(created.statusCode, 201, created.body)
    const amendmentId: string = created.json().data.entity.id
    assert.notEqual(amendmentId, CONTRACT_ID)
    assert.equal((await invoiceRows(t.id)).length, 2)
    assert.deepEqual(await contractOf(t.id), previous)
    assertError(
      await post(url(CONTRACT_ID, 'amendments'), t.admin, AMEND, previous.version),
      409,
      'contract_amendment_open',
    )

    const done = await approve(t, amendmentId)
    assert.deepEqual(await contractOf(t.id), previous, 'eski sürüm satırı değişmedi')
    assert.equal(done.data.revision, 2)
    const rows = await invoiceRows(t.id)
    const active = rows.filter((row) => row.archivedAt === null)
    assert.equal(active.length, 3)
    assert.equal(
      active.reduce((sum, row) => sum + Number(row.data.amount), 0),
      10_000_000,
    )
    assert.deepEqual(
      [...(done.data.invoiceIds as string[])].sort(),
      active.map((row) => row.id).sort(),
    )

    // Eski sürüm okunabilir kalır (DOM-FIN-051).
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/collections/contracts',
      headers: { origin: TEST_ORIGIN, cookie: t.admin },
    })
    assert.equal(read.statusCode, 200, read.body)
    assert.equal(read.json().data.length, 2)
    assertError(
      await post(url(CONTRACT_ID, 'amendments'), t.admin, AMEND, previous.version),
      409,
      'contract_superseded',
    )
  })

  test('DOM-FIN-010: taslaktan sonra tahsilat görmüş ek protokol 409, taksit ve sözleşme değişmez', async () => {
    const t = await tenant()
    const previous = await approve(t)
    const created = await post(url(CONTRACT_ID, 'amendments'), t.admin, AMEND, previous.version)
    const amendmentId: string = created.json().data.entity.id
    const version = await sign(t, amendmentId)
    const paid = await post(
      '/api/v1/payments',
      t.admin,
      {
        studentId: STUDENT?.id,
        amountCents: 100_000,
        method: 'Banka havalesi',
        reference: 'TR-SOZLESME-1',
        invoiceId: 'test-inv-1',
      },
      null,
    )
    assert.equal(paid.statusCode, 201, paid.body)
    assert.equal(
      (await allocatedByInvoice(db, t.id, String(STUDENT?.id))).get('test-inv-1'),
      100_000,
    )
    assertError(
      await post(url(amendmentId, 'approve'), t.admin, ACCEPT, version),
      409,
      'contract_amendment_stale',
    )
    assert.equal((await contractOf(t.id, amendmentId)).data.approval, undefined)
    assert.deepEqual(
      (await invoiceRows(t.id)).map((row) => row.archivedAt),
      [null, null],
    )

    // Çıkış yolu: taslak iptal edilir, kısmi tahsilatlı taksit korunarak yenisi hazırlanır.
    const cancelled = await post(
      url(amendmentId, 'cancel-amendment'),
      t.admin,
      { reason: 'Tahsilat geldi.' },
      version,
    )
    assert.equal(cancelled.statusCode, 200, cancelled.body)
    assert.equal((await contractOf(t.id, amendmentId)).data.cancelReason, 'Tahsilat geldi.')
    const again = await post(url(CONTRACT_ID, 'amendments'), t.admin, AMEND, previous.version)
    assert.equal(again.statusCode, 201, again.body)
    assertError(
      await post(
        url(CONTRACT_ID, 'cancel-amendment'),
        t.admin,
        { reason: 'Olmaz.' },
        previous.version,
      ),
      409,
      'contract_already_approved',
    )
  })

  test('DOM-FIN-020: ek protokolde indirim sözleşmenin tarifesinden hesaplanır', async () => {
    // Fikstür sözleşmesi kurumun tarifesine bağlıdır (`insertTestTariff`: %10 erken kayıt).
    const t = await tenant()
    const previous = await approve(t)
    const created = await post(
      url(CONTRACT_ID, 'amendments'),
      t.admin,
      { ...AMEND, discounts: ['early_registration'] },
      previous.version,
    )
    assert.equal(created.statusCode, 201, created.body)
    const { data } = await contractOf(t.id, created.json().data.entity.id)
    assert.equal(data.netCents, 9_000_000)
    assert.deepEqual(data.discounts, [{ kind: 'early_registration', amountCents: 1_000_000 }])
    assert.equal(data.amount, 9_000_000)
  })

  test('DOM-FIN-022, K-22: ek protokolde kardeş sözleşmenin yılında kayıtlı olmalıdır', async () => {
    const t = await tenant()
    await db
      .update(feeTariffs)
      .set({ discounts: [{ kind: 'sibling', percentBasisPoints: 1_000, amountCents: null }] })
      .where(and(eq(feeTariffs.institutionId, t.id), eq(feeTariffs.id, TEST_TARIFF_ID)))
    const siblingContract = (id: string, academicYear: number) => ({
      collection: 'contracts' as const,
      id,
      data: {
        id,
        studentId: 'test-kardes',
        date: '2026-09-01T09:00:00.000Z',
        amount: 20_000_000,
        title: 'Özel okul eğitim sözleşmesi',
        academicYear,
      },
    })
    await insertMissingRecords(
      db,
      t.id,
      [
        {
          collection: 'students',
          id: 'test-kardes',
          data: { ...STUDENT, id: 'test-kardes', name: 'Test Kardeş', isActive: true },
        },
        siblingContract('test-contract-gecen-yil', 2025),
      ],
      FIXED_NOW,
    )
    const previous = await approve(t)
    const body = { ...AMEND, discounts: ['sibling'] }
    assertError(
      await post(url(CONTRACT_ID, 'amendments'), t.admin, body, previous.version),
      422,
      'sibling_discount_ineligible',
    )
    await insertMissingRecords(db, t.id, [siblingContract('test-contract-bu-yil', 2026)], FIXED_NOW)
    const created = await post(url(CONTRACT_ID, 'amendments'), t.admin, body, previous.version)
    assert.equal(created.statusCode, 201, created.body)
    const { data } = await contractOf(t.id, created.json().data.entity.id)
    assert.deepEqual(data.discounts, [{ kind: 'sibling', amountCents: 1_000_000 }])
  })

  test('DOM-FIN-013: ek protokol tarifenin ödeme koşulunun dışına çıkamaz; indirim değişmese de koşul denetlenir', async () => {
    const t = await tenant()
    const paymentTerm = {
      kind: 'installment' as const,
      minInstallments: 2,
      maxInstallments: 4,
      discountPercentBasisPoints: null,
      discountAmountCents: null,
    }
    await db
      .update(feeTariffs)
      .set({ paymentTerms: [paymentTerm] })
      .where(and(eq(feeTariffs.institutionId, t.id), eq(feeTariffs.id, TEST_TARIFF_ID)))
    const previous = await approve(t)
    assertError(
      await post(
        url(CONTRACT_ID, 'amendments'),
        t.admin,
        { ...AMEND, installmentCount: 5 },
        previous.version,
      ),
      422,
      'payment_term_not_in_tariff',
    )
    const created = await post(
      url(CONTRACT_ID, 'amendments'),
      t.admin,
      { ...AMEND, installmentCount: 3 },
      previous.version,
    )
    assert.equal(created.statusCode, 201, created.body)
    const { data } = await contractOf(t.id, created.json().data.entity.id)
    assert.deepEqual(data.paymentTerm, { ...paymentTerm, installmentCount: 3 })
  })

  test('IST-092, DOM-FIN-010: onaylı sözleşmenin satırı veritabanında da değişmez (55000), canlı bağlar değişir', async () => {
    const t = await tenant()
    const row = await approve(t)
    const target = and(eq(records.institutionId, t.id), eq(records.id, CONTRACT_ID))
    await assert.rejects(
      db
        .update(records)
        .set({ data: { ...row.data, amount: 1 } })
        .where(target),
      (error: { cause?: { code?: string }; code?: string }) =>
        (error.cause?.code ?? error.code) === '55000',
    )
    await assert.rejects(
      db
        .update(records)
        .set({ data: { ...row.data, approval: null } })
        .where(target),
      (error: { cause?: { code?: string }; code?: string }) =>
        (error.cause?.code ?? error.code) === '55000',
    )
    // Ayrılış ve sınıf arşivi yalnız bu iki bağı yazar (`withdrawStudent`, `archiveRecord`). Doğrudan
    // yazılan kaynak tablolara da eşitlenir (ON-046f): tablonun değişmezlik tetikleyicisi de geçirir.
    await db
      .update(records)
      .set({
        data: { ...row.data, invoiceIds: ['test-inv-1'], classId: 'c2' },
        version: row.version + 1,
      })
      .where(target)
    assert.equal(await mirrorFinanceIds(db, t.id, { contracts: [CONTRACT_ID], invoices: [] }), 0)
    const stored = await db.execute(
      sql`select data->>'classId' as class_id from ${records} where ${target}`,
    )
    assert.equal((stored as unknown as { rows: { class_id: string }[] }).rows[0]?.class_id, 'c2')
  })
})
