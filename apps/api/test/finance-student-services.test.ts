import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import type { FeeItem } from '@kampus/school-core/lib/fee-tariffs.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { loadInvoices } from '../src/db/invoice-store.ts'
import { findRecord, insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { contracts } from '../src/db/schema/contracts.ts'
import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
import {
  studentServiceInvoices,
  studentServices,
} from '../src/db/schema/finance-student-services.ts'
import { invoices } from '../src/db/schema/invoices.ts'
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
 * Ek hizmet aboneliği uçları (DOM-FIN-002, -003, -040, -052; ON-087). Her test kendi kurumunu kurar:
 * bir öğrenci, bir öğrenim taksidi ve 2026 yayımlı tarifesi. FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const OTHER = SEED.students.find((item) => item.classId === 'c1' && item.id !== STUDENT?.id)
const BASE = '/api/v1/finance/student-services'
const YEAR = 2026
const PARENT_NAME = 'Test Ödeyici Veli'

const feeItem = (kind: FeeItem['kind'], unit: FeeItem['unit'], amountCents: number): FeeItem => ({
  kind,
  level: null,
  amountCents,
  unit,
  vatBasisPoints: 1000,
  vatEffectiveDate: '2026-01-01',
  announcedAmountCents: null,
})
const ITEMS = [
  { ...feeItem('tuition', 'year', 10_000_000), announcedAmountCents: 10_000_000 },
  feeItem('transport', 'year', 4_000_000),
  feeItem('meal', 'month', 500_000),
  feeItem('club', 'year', 200_000),
]
const SUBSCRIBE = {
  studentId: STUDENT?.id,
  kind: 'transport',
  academicYear: YEAR,
  startDate: '2026-09-15',
}
const MEAL = { ...SUBSCRIBE, kind: 'meal', startDate: '2026-09-15', endDate: '2026-12-31' }

type Fixture = { id: string; cookie: string; tariffId: string }

describe('ON-087: ek hizmet aboneliği uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  // Ayrılış ve tahsilat sırası kayıt anından okunur; o testler saati ilerletir, sonraki test geri alır.
  let clockNow = FIXED_NOW
  const key = () => ({ 'idempotency-key': `test-svc-${String(++serial).padStart(5, '0')}` })
  checkFinanceMirrorAfterEach(() => db)
  afterEach(() => {
    clockNow = FIXED_NOW
  })

  before(async () => {
    assert.ok(STUDENT)
    assert.ok(OTHER)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => clockNow })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function publishTariff(institutionId: string, items: FeeItem[] = ITEMS, year = YEAR) {
    const id = randomUUID()
    await db.insert(feeTariffs).values({
      institutionId,
      id,
      academicYear: year,
      versionNumber: 2,
      status: 'published',
      items,
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
    return id
  }

  /** Kurum, öğrenci ve öğrenim taksidi; `contract` verilirse 2026 sözleşmesi de açılır. */
  async function institution(
    options: {
      items?: FeeItem[]
      contract?: Record<string, unknown>
      tariff?: boolean
      enabledModules?: InstitutionOverrides['enabledModules']
    } = {},
  ): Promise<Fixture> {
    const created = await createInstitution(
      app,
      options.enabledModules === undefined ? {} : { enabledModules: options.enabledModules },
    )
    const tariffId =
      options.tariff === false ? '' : await publishTariff(created.id, options.items ?? ITEMS)
    assert.ok(STUDENT)
    assert.ok(OTHER)
    if (options.contract) await insertTestTariff(db, created.id, { academicYear: 2025 })
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'classes',
          id: 'c1',
          data: { ...SEED.classes.find((item) => item.id === 'c1') },
        },
        { collection: 'students', id: STUDENT.id, data: { ...STUDENT } },
        { collection: 'students', id: OTHER.id, data: { ...OTHER } },
        {
          collection: 'parents',
          id: STUDENT.parentId,
          data: { id: STUDENT.parentId, name: PARENT_NAME, studentIds: [STUDENT.id] },
        },
        ...(options.contract
          ? [
              {
                collection: 'contracts' as const,
                id: 'test-contract',
                data: {
                  id: 'test-contract',
                  studentId: STUDENT.id,
                  date: '2026-01-01T09:00:00.000Z',
                  amount: 10_000_000,
                  title: 'Sözleşme',
                  academicYear: YEAR,
                  invoiceIds: ['test-inv-1'],
                  ...contractTerms({ grossCents: 10_000_000, netCents: 10_000_000 }),
                  ...options.contract,
                },
              },
            ]
          : []),
        {
          collection: 'invoices',
          id: 'test-inv-1',
          data: {
            id: 'test-inv-1',
            studentId: STUDENT.id,
            installment: 1,
            amount: 10_000_000,
            dueDate: '2026-09-15T09:00:00.000Z',
            paidAt: null,
            method: null,
            reminderAt: null,
            feeKind: 'tuition',
          },
        },
      ],
      FIXED_NOW,
    )
    return { id: created.id, cookie: await signInAs(app, created.admin), tariffId }
  }
  const member = async (id: string, role: Role) =>
    signInAs(app, await createMember(app, id, role, []))
  function send(
    method: 'GET' | 'POST',
    url: string,
    cookie: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
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
  const subscribe = (cookie: string | null, body: unknown = SUBSCRIBE, headers = key()) =>
    send('POST', BASE, cookie, body, headers)
  const end = (
    cookie: string | null,
    id: string,
    version: number,
    endedDate = '2026-10-05',
    headers: Record<string, string> = key(),
  ) =>
    send(
      'POST',
      `${BASE}/${id}/end`,
      cookie,
      { endedDate },
      { 'if-match': `"${String(version)}"`, ...headers },
    )
  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const serviceRows = (institutionId: string) =>
    db.select().from(studentServices).where(eq(studentServices.institutionId, institutionId))
  const invoiceRows = (institutionId: string) => loadInvoices(db, institutionId, {})
  async function assertUntouched(institutionId: string) {
    assert.equal((await serviceRows(institutionId)).length, 0)
    assert.equal((await invoiceRows(institutionId)).length, 1)
  }

  test('DOM-FIN-052: oturumsuz 401; yazma yönetici ve ön büro, okuma veli ve öğrenci de; modül kapalı 403', async () => {
    const a = await institution()
    assertError(await send('GET', BASE, null), 401)
    assertError(await send('GET', `${BASE}/${randomUUID()}`, null), 401)
    assertError(await subscribe(null), 401)
    assertError(await end(null, randomUUID(), 1), 401)
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
      const cookie = await member(a.id, role)
      assertError(await subscribe(cookie), 403, 'forbidden')
      assertError(await end(cookie, randomUUID(), 1), 403, 'forbidden')
    }
    assertError(await send('GET', BASE, await member(a.id, 'ogretmen')), 403, 'forbidden')
    await assertUntouched(a.id)
    const made = await subscribe(await member(a.id, 'onburo'))
    assert.equal(made.statusCode, 201, made.body)

    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await send('GET', BASE, closed.cookie), 403, 'module_disabled')
    assertError(await subscribe(closed.cookie), 403, 'module_disabled')
    assertError(await end(closed.cookie, randomUUID(), 1), 403, 'module_disabled')
    await assertUntouched(closed.id)
  })

  test('DOM-YTK-001: başka kurumun öğrencisi ve aboneliği 404, listede yok, gövdedeki institutionId etkisiz, B değişmez', async () => {
    const b = await institution()
    const made = await subscribe(b.cookie)
    assert.equal(made.statusCode, 201, made.body)
    const { id, version } = made.json().data

    const created = await createInstitution(app, {})
    await publishTariff(created.id)
    const aCookie = await signInAs(app, created.admin)
    assertError(await send('GET', `${BASE}/${String(id)}`, aCookie), 404)
    assertError(await end(aCookie, id, version), 404)
    assertError(await subscribe(aCookie), 404)
    assert.equal(
      (await send('GET', `${BASE}?studentId=${String(STUDENT?.id)}`, aCookie)).json().meta.total,
      0,
    )
    assert.equal((await send('GET', BASE, aCookie)).json().meta.total, 0)
    // Kurum yalnız oturumdan gelir; gövdede tanınmayan alan 400'dür, kayıt yazılmaz.
    assertError(await subscribe(aCookie, { ...SUBSCRIBE, institutionId: b.id }), 400)
    assert.equal((await serviceRows(created.id)).length, 0)
    const row = (await serviceRows(b.id))[0]
    assert.equal(row?.status, 'active')
    assert.equal(row?.version, 1)
  })

  test('ON-087: geçersiz gövde 400 ve kayıt değişmez; Idempotency-Key ve If-Match zorunlu', async () => {
    const a = await institution()
    for (const body of [
      { ...SUBSCRIBE, kind: 'tuition' },
      { ...SUBSCRIBE, kind: 'stationery' },
      { ...SUBSCRIBE, startDate: 'dün' },
      { ...SUBSCRIBE, academicYear: 1 },
      { ...SUBSCRIBE, extra: true },
      {},
    ])
      assertError(await subscribe(a.cookie, body), 400)
    assertError(await send('POST', BASE, a.cookie, SUBSCRIBE), 400, 'idempotency_key_required')
    assertError(
      await send('POST', BASE, a.cookie, SUBSCRIBE, { ...key(), 'if-match': '"1"' }),
      400,
      'if_match_not_supported',
    )
    assertError(await send('GET', `${BASE}?bilinmeyen=1`, a.cookie), 400)
    assertError(await send('GET', `${BASE}/kimlik-degil`, a.cookie), 400)
    await assertUntouched(a.id)
    const made = await subscribe(a.cookie)
    const { id, version } = made.json().data
    assertError(
      await send('POST', `${BASE}/${String(id)}/end`, a.cookie, { endedDate: '2026-10-05' }, key()),
      400,
      'if_match_required',
    )
    assertError(
      await send(
        'POST',
        `${BASE}/${String(id)}/end`,
        a.cookie,
        { endedDate: 'dün' },
        { 'if-match': `"${String(version)}"`, ...key() },
      ),
      400,
    )
    assert.equal((await serviceRows(a.id))[0]?.status, 'active')
  })

  test('DOM-FIN-003: yazılınca ücret yayımlı tarifeden hesaplanır, ayrı taksit aynı işlemde yazılır; kalıcıdır', async () => {
    const a = await institution()
    const made = await subscribe(a.cookie)
    assert.equal(made.statusCode, 201, made.body)
    const { data } = made.json()
    assert.equal(made.headers.location, `${BASE}/${String(data.id)}`)
    assert.equal(data.tariffId, a.tariffId)
    assert.equal(data.tariffVersion, 2)
    assert.equal(data.unit, 'year')
    assert.equal(data.amountCents, 4_000_000)
    assert.equal(data.billedCents, 4_000_000)
    assert.equal(data.openCents, 4_000_000)
    assert.equal(data.status, 'active')
    assert.equal(data.contractId, null)
    assert.equal(data.refundDecisionRequired, false)
    assert.equal(data.tariffCarriedOverFromYear, null)
    assert.equal(data.invoices.length, 1)
    const invoiceId = data.invoices[0].id as string

    const stored = await findRecord(db, a.id, 'invoices', invoiceId)
    assert.equal(stored?.data.feeKind, 'transport')
    assert.equal(stored?.data.amount, 4_000_000)
    assert.equal(stored?.data.academicYear, YEAR)
    assert.equal(stored?.data.contractId, undefined)
    const [row] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.institutionId, a.id), eq(invoices.id, invoiceId)))
    assert.equal(row?.contractId, null)
    assert.equal(row?.rootContractId, null)
    // Öğrenim taksidi yanındadır, üstüne gömülmez.
    const tuition = await findRecord(db, a.id, 'invoices', 'test-inv-1')
    assert.equal(tuition?.data.amount, 10_000_000)

    const read = await send('GET', `${BASE}/${String(data.id)}`, a.cookie)
    assert.equal(read.statusCode, 200, read.body)
    assert.equal(read.json().data.invoices[0].id, invoiceId)
    const listed = await send(
      'GET',
      `${BASE}?status=active&kind=transport&academicYear=2026`,
      a.cookie,
    )
    assert.equal(listed.json().meta.total, 1)
    assert.equal((await send('GET', `${BASE}?status=ended`, a.cookie)).json().meta.total, 0)
    const audit = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.entityId, data.id)))
    assert.ok(audit.some((item) => item.action === 'studentService.subscribe'))
  })

  test('DOM-FIN-003: aylık kalem her ay taksit açar; birim ücret kopyadır, tarife değişse de kalır', async () => {
    const a = await institution()
    const made = await subscribe(a.cookie, MEAL)
    assert.equal(made.statusCode, 201, made.body)
    assert.equal(made.json().data.billedCents, 2_000_000)
    assert.deepEqual(
      made.json().data.invoices.map((line: { dueDate: string }) => line.dueDate),
      ['2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15'],
    )
    await db
      .update(feeTariffs)
      .set({ items: [feeItem('meal', 'month', 999_000)] })
      .where(eq(feeTariffs.institutionId, a.id))
    const read = await send('GET', `${BASE}/${String(made.json().data.id)}`, a.cookie)
    assert.equal(read.json().data.amountCents, 500_000)
  })

  test('DOM-FIN-002: tarife yoksa ya da kalem ilan edilmemişse 422 ve kayıt değişmez', async () => {
    const none = await institution({ tariff: false })
    assertError(await subscribe(none.cookie), 422, 'tariff_not_published')
    await assertUntouched(none.id)
    const noItem = await institution({ items: [ITEMS[0] as FeeItem] })
    assertError(await subscribe(noItem.cookie), 422, 'extra_not_in_tariff')
    await assertUntouched(noItem.id)
    const a = await institution()
    assertError(
      await subscribe(a.cookie, { ...SUBSCRIBE, kind: 'meal' }),
      422,
      'student_service_end_required',
    )
    assertError(
      await subscribe(a.cookie, { ...SUBSCRIBE, endDate: '2026-01-01' }),
      422,
      'student_service_end_before_start',
    )
    await assertUntouched(a.id)
  })

  test('DOM-FIN-003: tekrarlanan anahtar ilk yanıtı döner; ikinci açık abonelik 409, kısmi indeks son güvencedir', async () => {
    const a = await institution()
    const headers = key()
    const first = await subscribe(a.cookie, SUBSCRIBE, headers)
    assert.equal(first.statusCode, 201, first.body)
    const replay = await subscribe(a.cookie, SUBSCRIBE, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())
    assert.equal((await serviceRows(a.id)).length, 1)
    assert.equal((await invoiceRows(a.id)).length, 2)
    assertError(await subscribe(a.cookie), 409, 'student_service_open')
    assert.equal((await invoiceRows(a.id)).length, 2)
    // Başka yıla da ikinci açık abonelik yoktur.
    assertError(
      await subscribe(a.cookie, { ...SUBSCRIBE, academicYear: 2025 }),
      409,
      'student_service_open',
    )
    const [row] = await serviceRows(a.id)
    assert.ok(row)
    await assert.rejects(
      db.insert(studentServices).values({ ...row, id: randomUUID() }),
      (error: { cause?: { constraint?: string } }) =>
        error.cause?.constraint === 'student_services_student_kind_open_key',
    )
    // Başka tür ve başka öğrenci serbesttir.
    assert.equal((await subscribe(a.cookie, { ...SUBSCRIBE, kind: 'club' })).statusCode, 201)
    assert.equal(
      (await subscribe(a.cookie, { ...SUBSCRIBE, studentId: OTHER?.id })).statusCode,
      201,
    )
    // Kapanınca yeniden yazılır.
    const { id, version } = first.json().data
    assert.equal((await end(a.cookie, id, version)).statusCode, 200)
    assert.equal((await subscribe(a.cookie)).statusCode, 201)
  })

  test('DOM-FIN-003: aynı yılın sözleşmesindeki ek hizmet ikinci borç açtırmaz', async () => {
    const a = await institution({
      contract: { extras: [{ kind: 'transport', amountCents: 4_000_000 }] },
    })
    assertError(await subscribe(a.cookie), 409, 'student_service_on_contract')
    await assertUntouched(a.id)
    // Başka kalem serbesttir; sözleşme kaynak olarak gösterilir.
    const club = await subscribe(a.cookie, { ...SUBSCRIBE, kind: 'club' })
    assert.equal(club.statusCode, 201, club.body)
    assert.equal(club.json().data.contractId, 'test-contract')
  })

  test('DOM-FIN-010: onaylı sözleşme değişmez, ek hizmet taksiti sözleşmesiz yazılır', async () => {
    const a = await institution({
      contract: {
        signatory: {
          name: 'Test Kurucu',
          role: 'founder',
          recordedAt: FIXED_NOW.toISOString(),
          recordedByUserId: 'u-yonetici',
        },
        approval: {
          method: 'wet_signature',
          approvedAt: FIXED_NOW.toISOString(),
          approvedByUserId: 'u-yonetici',
          payerName: PARENT_NAME,
          plan: [
            {
              invoiceId: 'test-inv-1',
              installment: 1,
              amount: 10_000_000,
              dueDate: '2026-09-15T09:00:00.000Z',
              feeKind: 'tuition',
            },
          ],
        },
      },
    })
    const contractRow = () =>
      db
        .select()
        .from(contracts)
        .where(and(eq(contracts.institutionId, a.id), eq(contracts.id, 'test-contract')))
    const before = await contractRow()
    const recordBefore = await findRecord(db, a.id, 'contracts', 'test-contract')
    const made = await subscribe(a.cookie)
    assert.equal(made.statusCode, 201, made.body)
    assert.equal(made.json().data.contractId, 'test-contract')
    assert.deepEqual(await contractRow(), before)
    assert.deepEqual(await findRecord(db, a.id, 'contracts', 'test-contract'), recordBefore)
    const [line] = made.json().data.invoices
    const [row] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.institutionId, a.id), eq(invoices.id, line.id)))
    assert.equal(row?.contractId, null)
  })

  test('DOM-FIN-040: çıkışta ileri vadeli ödenmemiş taksit iptal edilir; ödenen kalır, iade yazılmaz, karar gerekir', async () => {
    const a = await institution()
    const made = await subscribe(a.cookie, MEAL)
    const service = made.json().data
    const [, october, november, december] = service.invoices as { id: string }[]
    assert.ok(october)
    assert.ok(november)
    assert.ok(december)
    // Aralık taksiti peşin ödendi, Kasım'a kısmi tahsilat var.
    const pay = (invoiceId: string, amountCents: number, reference: string) =>
      send(
        'POST',
        '/api/v1/payments',
        a.cookie,
        {
          studentId: STUDENT?.id,
          amountCents,
          method: 'Banka havalesi',
          reference,
          invoiceId,
        },
        key(),
      )
    assert.equal((await pay(december.id, 500_000, 'TR-SVC-1')).statusCode, 201)
    assert.equal((await pay(november.id, 100_000, 'TR-SVC-2')).statusCode, 201)

    // Sürüm tutmazsa 409, ileri tarih ve başlangıç öncesi 422; kayıt değişmez.
    assertError(await end(a.cookie, service.id, service.version + 1), 409)
    assertError(
      await end(a.cookie, service.id, service.version, '2026-10-07'),
      422,
      'student_service_end_in_future',
    )
    assertError(
      await end(a.cookie, service.id, service.version, '2026-09-01'),
      422,
      'student_service_end_before_start',
    )
    assert.equal((await serviceRows(a.id))[0]?.status, 'active')

    const headers = key()
    const ended = await end(a.cookie, service.id, service.version, '2026-10-05', headers)
    assert.equal(ended.statusCode, 200, ended.body)
    const { data } = ended.json()
    assert.equal(data.status, 'ended')
    assert.equal(data.endedDate, '2026-10-05')
    assert.equal(data.endReason, 'request')
    assert.equal(data.endDate, '2026-12-31')
    assert.equal(data.refundDecisionRequired, true)
    // Hiç tahsilat görmemiş ve vadesi çıkıştan sonra olan taksit yoktur (Ekim 15 de ileri vade).
    assert.deepEqual(
      data.invoices.map((line: { cancelled: boolean; paidCents: number }) => [
        line.cancelled,
        line.paidCents,
      ]),
      [
        [false, 0],
        [true, 0],
        [false, 100_000],
        [false, 500_000],
      ],
    )
    assert.equal(data.billedCents, 1_500_000)
    assert.equal(data.paidCents, 600_000)
    assert.equal(await findRecord(db, a.id, 'invoices', october.id), null)
    const replay = await end(a.cookie, service.id, service.version, '2026-10-05', headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), ended.json())
    assertError(await end(a.cookie, service.id, data.version), 409, 'student_service_ended')
  })

  test('DOM-FIN-052: veli ve öğrenci yalnız kendi kapsamını okur; kapsam dışı 404 ve boş liste', async () => {
    const a = await institution()
    const own = await subscribe(a.cookie)
    const other = await subscribe(a.cookie, { ...SUBSCRIBE, studentId: OTHER?.id })
    const parent = await signInAs(
      app,
      await createMember(app, a.id, 'veli', [{ kind: 'child', recordId: STUDENT?.id ?? '' }]),
    )
    const student = await signInAs(
      app,
      await createMember(app, a.id, 'ogrenci', [{ kind: 'student', recordId: STUDENT?.id ?? '' }]),
    )
    for (const cookie of [parent, student]) {
      const list = await send('GET', BASE, cookie)
      assert.equal(list.statusCode, 200, list.body)
      assert.equal(list.json().meta.total, 1)
      assert.equal(list.json().data[0].studentId, STUDENT?.id)
      assert.equal(
        (await send('GET', `${BASE}?studentId=${String(OTHER?.id)}`, cookie)).json().meta.total,
        0,
      )
      assert.equal(
        (await send('GET', `${BASE}/${String(own.json().data.id)}`, cookie)).statusCode,
        200,
      )
      assertError(await send('GET', `${BASE}/${String(other.json().data.id)}`, cookie), 404)
    }
    const unlinked = await member(a.id, 'veli')
    assert.equal((await send('GET', BASE, unlinked)).json().meta.total, 0)
  })

  test('DOM-KAY-024: ayrılışta açık abonelik kapanır, ileri vadeli taksit iptal edilir, tek işlemdedir', async () => {
    const a = await institution({ contract: {} })
    const meal = (await subscribe(a.cookie, MEAL)).json().data
    const club = await subscribe(a.cookie, { ...SUBSCRIBE, kind: 'club' })
    assert.equal(club.statusCode, 201, club.body)
    const [firstMeal] = meal.invoices as { id: string }[]
    assert.ok(firstMeal)
    const withdrawal = {
      withdrawalDate: '2026-10-01',
      termStartDate: '2026-09-07',
      attendedUnits: 18,
      totalUnits: 180,
      reason: 'relocation',
      targetSchool: null,
    }
    const done = await send(
      'POST',
      `/api/v1/students/${String(STUDENT?.id)}/withdraw`,
      a.cookie,
      withdrawal,
      key(),
    )
    assert.equal(done.statusCode, 201, done.body)
    const rows = await serviceRows(a.id)
    assert.deepEqual(rows.map((row) => row.status).sort(), ['ended', 'ended'])
    assert.ok(rows.every((row) => row.endReason === 'withdrawal' && row.endedDate === '2026-10-01'))
    const read = (await send('GET', `${BASE}/${String(meal.id)}`, a.cookie)).json().data
    assert.deepEqual(
      read.invoices.map((line: { cancelled: boolean }) => line.cancelled),
      [false, true, true, true],
    )
    // Kalan ödenmemiş geçmiş taksit: iade yok; kulüp tek taksitli olduğu için karar gerekir.
    const clubRead = (await send('GET', `${BASE}/${String(club.json().data.id)}`, a.cookie)).json()
      .data
    assert.equal(clubRead.refundDecisionRequired, true)
    assert.notEqual(await findRecord(db, a.id, 'invoices', firstMeal.id), null)
    const links = await db
      .select()
      .from(studentServiceInvoices)
      .where(eq(studentServiceInvoices.institutionId, a.id))
    assert.equal(links.length, 5)
    assertError(await subscribe(a.cookie), 409, 'student_service_student_inactive')
  })

  const auditFields = (institutionId: string, action: string) =>
    db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('DOM-FIN-003, K-17: personel tutarı düşürür; aylık tutar her ay ayrı taksittir, düzeltme denetime alan adıyla yazılır', async () => {
    const a = await institution()
    const made = await subscribe(a.cookie, { ...MEAL, amountCents: 300_000 })
    assert.equal(made.statusCode, 201, made.body)
    const { data } = made.json()
    assert.equal(data.amountCents, 300_000)
    assert.equal(data.tariffAmountCents, 500_000)
    assert.equal(data.billedCents, 1_200_000)
    assert.deepEqual(
      data.invoices.map((line: { amountCents: number }) => line.amountCents),
      [300_000, 300_000, 300_000, 300_000],
    )
    const [row] = await serviceRows(a.id)
    assert.equal(row?.amountCents, 300_000)
    assert.equal(row?.tariffAmountCents, 500_000)
    assert.deepEqual(await auditFields(a.id, 'studentService.amountAdjust'), [
      { changes: { fields: ['amountCents'] } },
    ])
    // Denetim tutarın kendisini tutmaz.
    assert.equal(
      JSON.stringify(await auditFields(a.id, 'studentService.amountAdjust')).includes('300000'),
      false,
    )
  })

  test('K-17: yıllık kalemde düzeltilen tutar tek taksittir; tarifedeki tutar düzeltme sayılmaz', async () => {
    const a = await institution()
    const lowered = await subscribe(a.cookie, { ...SUBSCRIBE, amountCents: 1_000_000 })
    assert.equal(lowered.statusCode, 201, lowered.body)
    assert.deepEqual(
      lowered.json().data.invoices.map((line: { amountCents: number }) => line.amountCents),
      [1_000_000],
    )
    const same = await subscribe(a.cookie, {
      ...SUBSCRIBE,
      kind: 'club',
      amountCents: 200_000,
    })
    assert.equal(same.statusCode, 201, same.body)
    assert.equal(same.json().data.tariffAmountCents, 200_000)
    assert.equal((await auditFields(a.id, 'studentService.amountAdjust')).length, 1)
  })

  test('K-17: tarifenin üstü 422, sıfır ve negatif 400; kayıt değişmez', async () => {
    const a = await institution()
    const over = await subscribe(a.cookie, { ...MEAL, amountCents: 500_001 })
    assertError(over, 422, 'student_service_amount_exceeds_tariff')
    assert.deepEqual(over.json().issues?.[0]?.path, ['amountCents'])
    for (const amountCents of [0, -1])
      assertError(await subscribe(a.cookie, { ...SUBSCRIBE, amountCents }), 400)
    await assertUntouched(a.id)
    assert.equal((await auditFields(a.id, 'studentService.amountAdjust')).length, 0)
  })

  test('K-17: veritabanı tarifenin üstündeki tutarı son güvence olarak reddeder', async () => {
    const a = await institution()
    await subscribe(a.cookie, SUBSCRIBE)
    const [row] = await serviceRows(a.id)
    assert.ok(row)
    await assert.rejects(() =>
      db
        .update(studentServices)
        .set({ amountCents: row.tariffAmountCents + 1 })
        .where(eq(studentServices.institutionId, a.id)),
    )
  })

  const quoteUrl = (query: Record<string, string | undefined>) =>
    `${BASE}/quote?${new URLSearchParams(
      Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ).toString()}`
  const QUOTE = {
    studentId: String(STUDENT?.id),
    kind: 'meal',
    academicYear: String(YEAR),
    startDate: '2026-10-15',
    endDate: '2026-12-31',
  }

  test('DOM-FIN-003, K-17: önizleme tarife tutarını ve ay sayısını döner, kayıt yazmaz', async () => {
    const a = await institution()
    const monthly = await send('GET', quoteUrl(QUOTE), a.cookie)
    assert.equal(monthly.statusCode, 200, monthly.body)
    assert.deepEqual(monthly.json().data, {
      tariffAmountCents: 500_000,
      unit: 'month',
      dueDates: [
        '2026-10-15T09:00:00.000Z',
        '2026-11-15T09:00:00.000Z',
        '2026-12-15T09:00:00.000Z',
      ],
      tariffCarriedOverFromYear: null,
    })
    const withoutEnd = { ...QUOTE, endDate: undefined }
    const open = await send('GET', quoteUrl(withoutEnd), a.cookie)
    assert.deepEqual(open.json().data.dueDates, [])
    const yearly = await send('GET', quoteUrl({ ...withoutEnd, kind: 'transport' }), a.cookie)
    assert.equal(yearly.json().data.dueDates.length, 1)
    await assertUntouched(a.id)
  })

  test('DOM-FIN-052, DOM-YTK-001: önizleme oturumsuz 401; veli ve öğrenci 403; modül kapalı 403; başka kurum 404; bilinmeyen parametre 400', async () => {
    const a = await institution()
    const b = await createInstitution(app)
    const bCookie = await signInAs(app, b.admin)
    assert.equal((await send('GET', quoteUrl(QUOTE), null)).statusCode, 401)
    for (const role of ['veli', 'ogrenci', 'ogretmen'] as const)
      assert.equal((await send('GET', quoteUrl(QUOTE), await member(a.id, role))).statusCode, 403)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await send('GET', quoteUrl(QUOTE), closed.cookie), 403, 'module_disabled')
    assert.equal((await send('GET', quoteUrl(QUOTE), await member(a.id, 'onburo'))).statusCode, 200)
    await publishTariff(b.id)
    assert.equal((await send('GET', quoteUrl(QUOTE), bCookie)).statusCode, 404)
    assert.equal(
      (await send('GET', quoteUrl({ ...QUOTE, institutionId: b.id }), a.cookie)).statusCode,
      400,
    )
  })

  test('DOM-FIN-002: önizleme yazılmayla aynı denetimleri uygular', async () => {
    const a = await institution({ tariff: false })
    assertError(await send('GET', quoteUrl(QUOTE), a.cookie), 422, 'tariff_not_published')
    const c = await institution()
    assertError(
      await send('GET', quoteUrl({ ...QUOTE, kind: 'dormitory' }), c.cookie),
      422,
      'extra_not_in_tariff',
    )
    assertError(
      await send('GET', quoteUrl({ ...QUOTE, endDate: '2026-10-01' }), c.cookie),
      422,
      'student_service_end_before_start',
    )
    assert.equal((await subscribe(c.cookie, MEAL)).statusCode, 201)
    assertError(await send('GET', quoteUrl(QUOTE), c.cookie), 409, 'student_service_open')
  })

  const WITHDRAWAL = {
    withdrawalDate: '2026-10-01',
    termStartDate: '2026-09-07',
    attendedUnits: 18,
    totalUnits: 180,
    reason: 'relocation',
    targetSchool: null,
  }
  const withdrawStudent = (cookie: string) =>
    send('POST', `/api/v1/students/${String(STUDENT?.id)}/withdraw`, cookie, WITHDRAWAL, key())
  const payInvoice = (cookie: string, invoiceId: string, amountCents: number, reference: string) =>
    send(
      'POST',
      '/api/v1/payments',
      cookie,
      { studentId: STUDENT?.id, amountCents, method: 'Banka havalesi', reference, invoiceId },
      key(),
    )
  const reversePayment = (cookie: string, payment: { id: string; version: number }) =>
    send(
      'POST',
      `/api/v1/payments/${payment.id}/reverse`,
      cookie,
      { reason: 'Yanlış öğrenciye girildi' },
      { 'if-match': `"${String(payment.version)}"`, ...key() },
    )

  test('DOM-FIN-041, DOM-FIN-033: ayrılıştan sonra kalan abonelik taksitine alınan tahsilat iptal edilir, taksit yeniden açılır', async () => {
    const a = await institution({ contract: {} })
    const meal = (await subscribe(a.cookie, MEAL)).json().data
    const [september] = meal.invoices as { id: string }[]
    assert.ok(september)
    const withdrawn = await withdrawStudent(a.cookie)
    assert.equal(withdrawn.statusCode, 201, withdrawn.body)

    clockNow = new Date(FIXED_NOW.getTime() + 60_000)
    const late = await payInvoice(a.cookie, september.id, 500_000, 'TR-SVC-LATE')
    assert.equal(late.statusCode, 201, late.body)
    const paid = await findRecord(db, a.id, 'invoices', september.id)
    assert.notEqual(paid?.data.paidAt, null)

    const reversed = await reversePayment(a.cookie, late.json().data)
    assert.equal(reversed.statusCode, 200, reversed.body)
    const reopened = await findRecord(db, a.id, 'invoices', september.id)
    assert.equal(reopened?.data.paidAt, null)
    const read = (await send('GET', `${BASE}/${String(meal.id)}`, a.cookie)).json().data
    assert.equal(read.paidCents, 0)
    assert.equal(read.openCents, read.billedCents)
    // Ayrılış kaydı değişmez: döküm bu tahsilata dayanmaz.
    const row = await send(
      'GET',
      `/api/v1/withdrawals/${String(withdrawn.json().data.id)}`,
      a.cookie,
    )
    assert.equal(row.json().data.refundCents, withdrawn.json().data.refundCents)
    assert.equal(row.json().data.debtCents, withdrawn.json().data.debtCents)
  })

  test('DOM-FIN-040, K-17: açık abonelik ayrılış dökümünde görünür, iade hesabına girmez (ON-298)', async () => {
    const a = await institution({ contract: {} })
    const quoteUrl = `/api/v1/students/${String(STUDENT?.id)}/withdrawal-quote`
    const quoteBody = {
      withdrawalDate: WITHDRAWAL.withdrawalDate,
      termStartDate: WITHDRAWAL.termStartDate,
      attendedUnits: WITHDRAWAL.attendedUnits,
      totalUnits: WITHDRAWAL.totalUnits,
    }
    const plain = await send('POST', quoteUrl, a.cookie, quoteBody)
    assert.equal(plain.statusCode, 200, plain.body)
    assert.equal(plain.json().data.breakdown.services, undefined)

    const meal = (await subscribe(a.cookie, MEAL)).json().data
    const club = (await subscribe(a.cookie, { ...SUBSCRIBE, kind: 'club' })).json().data
    const [september] = meal.invoices as { id: string }[]
    assert.ok(september)
    assert.equal((await payInvoice(a.cookie, september.id, 500_000, 'TR-SVC-Q')).statusCode, 201)

    const quoted = await send('POST', quoteUrl, a.cookie, quoteBody)
    assert.equal(quoted.statusCode, 200, quoted.body)
    const { services, ...rest } = quoted.json().data.breakdown
    assert.deepEqual(rest, plain.json().data.breakdown)
    // Aynı gün başlayan aboneliklerin sırası kimliğe bağlıdır; türe göre karşılaştırılır.
    const byKind = (lines: { kind: string }[]) =>
      [...lines].sort((x, y) => x.kind.localeCompare(y.kind))
    const expected = [
      {
        serviceId: club.id,
        kind: 'club',
        academicYear: YEAR,
        startDate: '2026-09-15',
        endDate: null,
        unit: 'year',
        amountCents: 200_000,
        usedCents: 200_000,
        paidCents: 0,
        endedDate: '2026-10-01',
      },
      {
        serviceId: meal.id,
        kind: 'meal',
        academicYear: YEAR,
        startDate: '2026-09-15',
        endDate: '2026-12-31',
        unit: 'month',
        amountCents: 500_000,
        usedCents: 500_000,
        paidCents: 500_000,
        endedDate: '2026-10-01',
      },
    ]
    assert.deepEqual(byKind(services), expected)

    const done = await withdrawStudent(a.cookie)
    assert.equal(done.statusCode, 201, done.body)
    assert.deepEqual(byKind(done.json().data.breakdown.services), expected)
    assert.equal(done.json().data.refundCents, plain.json().data.breakdown.refundCents)
    assert.equal(done.json().data.debtCents, plain.json().data.breakdown.debtCents)
    const row = await send('GET', `/api/v1/withdrawals/${String(done.json().data.id)}`, a.cookie)
    assert.deepEqual(byKind(row.json().data.breakdown.services), expected)
    const rows = await serviceRows(a.id)
    assert.ok(rows.every((item) => item.status === 'ended' && item.endedDate === '2026-10-01'))
  })

  test('DOM-FIN-041: ayrılıştan önce abonelik taksitine alınan tahsilat iptal edilemez, kayıt değişmez', async () => {
    const a = await institution({ contract: {} })
    const meal = (await subscribe(a.cookie, MEAL)).json().data
    const [september] = meal.invoices as { id: string }[]
    assert.ok(september)
    const early = await payInvoice(a.cookie, september.id, 500_000, 'TR-SVC-EARLY')
    assert.equal(early.statusCode, 201, early.body)
    clockNow = new Date(FIXED_NOW.getTime() + 60_000)
    assert.equal((await withdrawStudent(a.cookie)).statusCode, 201)

    const before = await findRecord(db, a.id, 'invoices', september.id)
    clockNow = new Date(FIXED_NOW.getTime() + 120_000)
    assertError(await reversePayment(a.cookie, early.json().data), 409, 'payment_student_withdrawn')
    const after = await findRecord(db, a.id, 'invoices', september.id)
    assert.deepEqual(after?.data, before?.data)
  })
})
