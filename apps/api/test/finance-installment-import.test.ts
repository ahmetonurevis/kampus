import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, count, eq, isNull } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { SESSION_FRESH_AGE_SECONDS } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { contractInvoices } from '../src/db/schema/contract-invoices.ts'
import { contracts } from '../src/db/schema/contracts.ts'
import { invoices } from '../src/db/schema/invoices.ts'
import { paymentAllocations, payments } from '../src/db/schema/payments.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type TestInstitution,
} from './support/app.ts'
import { base64, turkishId, xlsxFile } from './support/enrollment-import-files.ts'

/**
 * Pilot verisi aktarımı: taksitler (ON-061, IST-007; DOM-FIN-001, -010, -011, -012; ADR 0010 cevap
 * 3). `POST /finance/installment-imports`: yalnız yönetici, taze oturum, `Idempotency-Key` zorunlu.
 */

const HEADER = 'kimlik no;taksit no;tutar kuruş;vade;ödeme tarihi;ödeme yöntemi;eğitim yılı'
const csv = (...lines: string[]) => base64([HEADER, ...lines].join('\n'))

interface Row {
  line: number
  status: string
  studentName: string | null
  identityMasked: string
  amountCents: number | null
  dueDate: string | null
  contractLinked: boolean
  issues: { field: string | null; code: string; message: string }[]
  notices: { code: string }[]
}

interface Result {
  dryRun: boolean
  rowCount: number
  readyCount: number
  skippedCount: number
  invalidCount: number
  linkedCount: number
  totalCents: number
  paidCents: number
  rows: Row[]
}

describe('pilot aktarımı: taksitler (ON-061, IST-007)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let staleApp: App
  let seed = 7000

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
    staleApp = await buildTestApp(db, {
      clock: () => new Date(Date.now() + (SESSION_FRESH_AGE_SECONDS + 60) * 1000),
    })
  })
  after(async () => {
    await staleApp.close()
    await app.close()
    await close()
  })

  async function upload(
    cookie: string | undefined,
    fileBase64: string,
    options: { dryRun?: boolean; key?: string | null; target?: App; extra?: object } = {},
  ) {
    const key = options.key === undefined ? randomUUID() : options.key
    return (options.target ?? app).inject({
      method: 'POST',
      url: '/api/v1/finance/installment-imports',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(key === null ? {} : { 'idempotency-key': key }),
      },
      payload: { fileBase64, dryRun: options.dryRun ?? false, ...options.extra },
    })
  }

  async function addStudent(institutionId: string, id: string, isActive = true) {
    await insertMissingRecords(
      db,
      institutionId,
      [
        {
          collection: 'students',
          id,
          data: {
            id,
            name: `Öğrenci ${id}`,
            classId: 'c-1',
            parentId: 'p-1',
            email: '',
            phone: '',
            joinedAt: FIXED_NOW.toISOString(),
            isActive,
            progress: 0,
          },
        },
      ],
      FIXED_NOW,
    )
    const number = turkishId(++seed)
    await db.insert(studentIdentities).values({
      institutionId,
      studentId: id,
      academicYear: 2026,
      identityKind: 'tc',
      identityNumber: number,
      birthDate: '2013-03-14',
    })
    return number
  }

  async function kurum(): Promise<{ institution: TestInstitution; cookie: string; tc: string }> {
    const institution = await createInstitution(app)
    const tc = await addStudent(institution.id, 's-1')
    return { institution, cookie: await signInAs(app, institution.admin), tc }
  }

  const contract = (id: string, extra: object = {}) => ({
    collection: 'contracts' as const,
    id,
    data: {
      id,
      studentId: 's-1',
      date: '2026-09-01T09:00:00.000Z',
      amount: 3_000_000,
      title: 'Özel okul eğitim sözleşmesi',
      invoiceIds: [],
      academicYear: 2026,
      ...extra,
    },
  })

  async function invoiceRows(institutionId: string) {
    return db
      .select()
      .from(invoices)
      .where(and(eq(invoices.institutionId, institutionId), isNull(invoices.archivedAt)))
  }

  test('DOM-FIN-011: 401 oturumsuz, 403 yönetici dışındaki rol, taze oturum ve kayıt değişmez', async () => {
    const { institution, cookie, tc } = await kurum()
    const file = csv(`${tc};1;1250000;2026-11-15;;;2026`)
    assert.equal((await upload(undefined, file)).statusCode, 401)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const member = await createMember(app, institution.id, role)
      assert.equal((await upload(await signInAs(app, member), file)).statusCode, 403, role)
    }
    const stale = await upload(cookie, file, { target: staleApp })
    assert.equal(stale.statusCode, 403)
    assert.equal(stale.json().code, 'reauthentication_required')
    assert.deepEqual(await invoiceRows(institution.id), [])
  })

  test('IST-009: finance modülü kapalıysa 403 module_disabled', async () => {
    const closed = await createInstitution(app, { enabledModules: { finance: false } })
    const response = await upload(
      await signInAs(app, closed.admin),
      csv(`${turkishId(1)};1;1250000;2026-11-15;;;2026`),
    )
    assert.equal(response.statusCode, 403)
    assert.equal(response.json().code, 'module_disabled')
  })

  test('IST-007: anahtarsız ve geçersiz gövde 400, kayıt değişmez', async () => {
    const { institution, cookie, tc } = await kurum()
    const file = csv(`${tc};1;1250000;2026-11-15;;;2026`)
    assert.equal((await upload(cookie, file, { key: null })).statusCode, 400)
    assert.equal((await upload(cookie, '%%%')).statusCode, 400)
    assert.equal((await upload(cookie, file, { extra: { institutionId: 'x' } })).statusCode, 400)
    assert.deepEqual(await invoiceRows(institution.id), [])
  })

  test('DOM-FIN-001: önizleme satır bazında hata, toplam ve maskeli kimlik döner, yazmaz', async () => {
    const { institution, cookie, tc } = await kurum()
    const response = await upload(
      cookie,
      csv(
        `${tc};1;1250000;15.11.2026;14.09.2026;Nakit;2026`,
        `${tc};2;1250000;15.12.2026;;;`,
        `${tc};3;12500,50;15.01.2027;;;2026`,
        `${tc};4;100;31.02.2027;;;2026`,
        `${tc};5;100;2027-02-15;2026-01-01;;2026`,
        `${tc};6;100;2027-02-15;2027-01-01;Nakit;2026`,
        `${tc};7;100;2027-02-15;;Çek;2026`,
        `${turkishId(99)};1;100;2027-02-15;;;2026`,
        `${tc};2;100;2027-02-15;;;2026`,
      ),
      { dryRun: true },
    )
    assert.equal(response.statusCode, 200)
    const data = response.json().data as Result
    assert.equal(data.dryRun, true)
    assert.equal(data.rowCount, 9)
    assert.equal(data.invalidCount, 7)
    assert.equal(data.readyCount, 2)
    const codes = (index: number) => data.rows[index]?.issues.map((issue) => issue.code)
    assert.equal(data.rows[0]?.status, 'ready')
    assert.equal(data.rows[0]?.amountCents, 1_250_000)
    assert.equal(data.rows[0]?.studentName, 'Öğrenci s-1')
    assert.equal(data.rows[0]?.identityMasked, `*******${tc.slice(-4)}`)
    assert.ok(!JSON.stringify(data.rows).includes(tc), 'tam kimlik yanıtta olmamalı')
    assert.deepEqual(codes(2), ['amount_invalid'])
    assert.deepEqual(codes(3), ['due_date_invalid'])
    assert.deepEqual(codes(4), ['payment_fields_incomplete'])
    assert.deepEqual(codes(5), ['paid_date_future'])
    assert.deepEqual(codes(6), ['payment_fields_incomplete', 'payment_method_invalid'])
    assert.deepEqual(codes(7), ['student_not_found'])
    assert.deepEqual(codes(8), ['duplicate_installment'])
    assert.deepEqual(await invoiceRows(institution.id), [])
  })

  test('DOM-FIN-001: TL sütunu reddedilir; tutar yalnız kuruş sütunundan okunur', async () => {
    const { cookie, tc } = await kurum()
    const response = await upload(
      cookie,
      base64(`kimlik no;taksit no;tutar;vade\n${tc};1;12500;2026-11-15`),
      { dryRun: true },
    )
    assert.equal(response.statusCode, 422)
    assert.equal(response.json().code, 'csv_unknown_column')
  })

  test('IST-007: tek hatalı satırda onay 422, satır numaralı sorun ve hiçbir kayıt yazılmaz', async () => {
    const { institution, cookie, tc } = await kurum()
    const response = await upload(
      cookie,
      csv(`${tc};1;1250000;2026-11-15;;;2026`, `${tc};2;bozuk;2026-12-15;;;2026`),
    )
    assert.equal(response.statusCode, 422)
    assert.equal(response.json().code, 'installment_import_invalid')
    assert.deepEqual(response.json().issues[0].path, ['rows', 3, 'amountCents'])
    assert.deepEqual(await invoiceRows(institution.id), [])
  })

  test('ADR 0010 cevap 3: sözleşmesiz taksit bağsız yazılır; vade 09:00Z, paidAt ve yöntem birlikte', async () => {
    const { institution, cookie, tc } = await kurum()
    const file = csv(
      `${tc};1;1250000;15.09.2026;14.09.2026;Banka havalesi;2026`,
      `${tc};2;1250000;15.10.2026;;;2026`,
    )
    const preview = (await upload(cookie, file, { dryRun: true })).json().data as Result
    assert.equal(preview.rows[0]?.contractLinked, false)
    assert.equal(preview.rows[0]?.notices[0]?.code, 'no_contract')
    assert.equal(preview.totalCents, 2_500_000)
    assert.equal(preview.paidCents, 1_250_000)

    const response = await upload(cookie, file)
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data as Result
    assert.equal(data.readyCount, 2)
    assert.deepEqual(data.rows, [], 'onay yanıtı satır taşımaz')

    const rows = await invoiceRows(institution.id)
    assert.equal(rows.length, 2)
    const paid = rows.find((row) => row.installment === 1)
    const open = rows.find((row) => row.installment === 2)
    assert.equal(paid?.contractId, null)
    assert.equal(paid?.dueDate, '2026-09-15')
    assert.equal(paid?.paidAt?.toISOString(), '2026-09-14T09:00:00.000Z')
    assert.equal(paid?.paymentMethod, 'bank_transfer')
    assert.equal(paid?.amountCents, 1_250_000)
    assert.equal(paid?.feeKind, 'tuition')
    assert.equal(open?.paidAt, null)
    assert.equal(open?.paymentMethod, null)

    // Koleksiyon okuması core biçimini verir; geçmiş ödeme tahsilat yazmaz (kasa değişmez).
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/collections/invoices',
      headers: { cookie },
    })
    const record = (
      list.json().data as { record: { installment: number; dueDate: string; method: string } }[]
    ).find((item) => item.record.installment === 1)
    assert.equal(record?.record.dueDate, '2026-09-15T09:00:00.000Z')
    assert.equal(record?.record.method, 'Banka havalesi')
    const [paymentCount] = await db
      .select({ total: count() })
      .from(payments)
      .where(eq(payments.institutionId, institution.id))
    const [allocationCount] = await db
      .select({ total: count() })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.institutionId, institution.id))
    assert.equal(paymentCount?.total, 0)
    assert.equal(allocationCount?.total, 0)
  })

  test('ADR 0010 cevap 3: tek sözleşmeye bağlanır, toplam aşılamaz (DOM-FIN-011, DOM-FIN-012)', async () => {
    const { institution, cookie, tc } = await kurum()
    await insertMissingRecords(db, institution.id, [contract('contract-a')], FIXED_NOW)
    const over = await upload(
      cookie,
      csv(`${tc};1;2000000;2026-11-15;;;2026`, `${tc};2;1000001;2026-12-15;;;2026`),
      { dryRun: true },
    )
    const overData = over.json().data as Result
    assert.equal(overData.rows[0]?.contractLinked, true)
    assert.equal(overData.rows[1]?.issues[0]?.code, 'contract_total_exceeded')

    const response = await upload(
      cookie,
      csv(`${tc};1;2000000;2026-11-15;;;2026`, `${tc};2;1000000;2026-12-15;;;2026`),
    )
    assert.equal(response.statusCode, 201, response.body)
    assert.equal((response.json().data as Result).linkedCount, 2)
    const rows = await invoiceRows(institution.id)
    assert.ok(rows.every((row) => row.contractId === 'contract-a'))
    const links = await db
      .select()
      .from(contractInvoices)
      .where(eq(contractInvoices.institutionId, institution.id))
    assert.equal(links.length, 2)
    const [stored] = await db
      .select({ amount: contracts.amountCents })
      .from(contracts)
      .where(eq(contracts.institutionId, institution.id))
    assert.equal(stored?.amount, 3_000_000, 'sözleşme tutarı değişmez')
  })

  test('ADR 0010 cevap 3: birden çok sözleşme ya da farklı yıl bağ kurmaz', async () => {
    const { institution, cookie, tc } = await kurum()
    await insertMissingRecords(db, institution.id, [contract('contract-a')], FIXED_NOW)
    const otherYear = await upload(cookie, csv(`${tc};1;2000000;2025-11-15;;;2025`), {
      dryRun: true,
    })
    assert.equal((otherYear.json().data as Result).rows[0]?.contractLinked, false)

    await insertMissingRecords(
      db,
      institution.id,
      [contract('contract-b', { academicYear: 2025 })],
      FIXED_NOW,
    )
    const response = await upload(cookie, csv(`${tc};1;2000000;2026-11-15;;;2026`))
    assert.equal(response.statusCode, 201, response.body)
    assert.equal((response.json().data as Result).linkedCount, 0)
    const [row] = await invoiceRows(institution.id)
    assert.equal(row?.contractId, null)
  })

  test('DOM-FIN-010: onaylı sözleşmenin planına taksit eklenmez', async () => {
    const { institution, cookie, tc } = await kurum()
    await insertMissingRecords(
      db,
      institution.id,
      [
        contract('contract-a', {
          signatory: {
            name: 'Kurucu',
            role: 'founder',
            recordedAt: '2026-09-01T09:00:00.000Z',
            recordedByUserId: 'u-1',
          },
          approval: {
            method: 'wet_signature',
            approvedAt: '2026-09-01T09:00:00.000Z',
            approvedByUserId: 'u-1',
            payerName: 'Veli',
            plan: [],
          },
        }),
      ],
      FIXED_NOW,
    )
    const response = await upload(cookie, csv(`${tc};1;2000000;2026-11-15;;;2026`))
    assert.equal(response.statusCode, 422)
    assert.equal(response.json().issues[0].code, 'contract_approved')
    assert.deepEqual(await invoiceRows(institution.id), [])
  })

  test('IST-007: mükerrer: aynı anahtar tekrarlar; yeni anahtarla aynı dosya atlanır, farklı değer hata', async () => {
    const { institution, cookie, tc } = await kurum()
    const key = randomUUID()
    const file = csv(`${tc};1;1250000;2026-11-15;;;2026`)
    const first = await upload(cookie, file, { key })
    assert.equal(first.statusCode, 201)
    const replay = await upload(cookie, file, { key })
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())
    assert.equal((await invoiceRows(institution.id)).length, 1)

    const again = await upload(cookie, file)
    assert.equal(again.statusCode, 201)
    assert.equal((again.json().data as Result).skippedCount, 1)
    assert.equal((again.json().data as Result).readyCount, 0)
    assert.equal((await invoiceRows(institution.id)).length, 1)

    const changed = await upload(cookie, csv(`${tc};1;1250001;2026-11-15;;;2026`), { dryRun: true })
    assert.equal((changed.json().data as Result).rows[0]?.issues[0]?.code, 'installment_conflict')
    const paid = await upload(cookie, csv(`${tc};1;1250000;2026-11-15;2026-10-01;Nakit;2026`), {
      dryRun: true,
    })
    assert.equal((paid.json().data as Result).rows[0]?.issues[0]?.code, 'installment_paid_mismatch')
  })

  test('DOM-FIN-012: ad uyuşmazlığı ve ayrılmış öğrenci reddedilir', async () => {
    const { institution, cookie, tc } = await kurum()
    const inactive = await addStudent(institution.id, 's-pasif', false)
    const response = await upload(
      cookie,
      base64(
        [
          'kimlik no;öğrenci adı;taksit no;tutar kuruş;vade',
          `${tc};Başka Ad;1;100;2026-11-15`,
          `${inactive};;1;100;2026-11-15`,
        ].join('\n'),
      ),
      { dryRun: true },
    )
    const rows = (response.json().data as Result).rows
    assert.equal(rows[0]?.issues[0]?.code, 'student_name_mismatch')
    assert.equal(rows[1]?.issues[0]?.code, 'student_inactive')
  })

  test('IST-007: Excel dosyası kuruş sayısı ve tarih hücresiyle okunur', async () => {
    const { institution, cookie, tc } = await kurum()
    const response = await upload(
      cookie,
      base64(
        xlsxFile([
          ['kimlik no', 'taksit no', 'tutar kuruş', 'vade', 'ödeme tarihi', 'ödeme yöntemi'],
          [Number(tc), 1, 1250000, { date: '2026-11-15' }, { date: '2026-10-01' }, 'nakit'],
        ]),
      ),
    )
    assert.equal(response.statusCode, 201, response.body)
    const [row] = await invoiceRows(institution.id)
    assert.equal(row?.amountCents, 1_250_000)
    assert.equal(row?.dueDate, '2026-11-15')
    assert.equal(row?.paymentMethod, 'cash')
    assert.equal(row?.academicYear, 2026)
  })

  test('IST-002: başka kurumun öğrencisi ve sözleşmesi bu kurumu etkilemez, institutionId gövdede 400', async () => {
    const b = await kurum()
    const a = await kurum()
    await insertMissingRecords(db, b.institution.id, [contract('contract-b')], FIXED_NOW)
    // A'nın dosyasında B'nin öğrencisinin kimliği: A'da bulunmaz, B değişmez.
    const response = await upload(a.cookie, csv(`${b.tc};1;100;2026-11-15;;;2026`))
    assert.equal(response.statusCode, 422)
    assert.equal(response.json().issues[0].code, 'student_not_found')
    assert.deepEqual(await invoiceRows(b.institution.id), [])
    assert.deepEqual(await invoiceRows(a.institution.id), [])
    const injected = await upload(a.cookie, csv(`${a.tc};1;100;2026-11-15;;;2026`), {
      extra: { institutionId: b.institution.id },
    })
    assert.equal(injected.statusCode, 400)
  })

  test('KVKK: denetime yalnız sayı ve alan adı, logda içerik ve kişisel veri yok', async () => {
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs })
    try {
      const institution = await createInstitution(logged)
      const tc = await addStudent(institution.id, 's-1')
      const cookie = await signInAs(logged, institution.admin)
      const file = csv(`${tc};1;7654321;2026-11-15;;;2026`)
      const response = await upload(cookie, file, { target: logged })
      assert.equal(response.statusCode, 201, response.body)
      await upload(cookie, csv(`${tc};1;bozuk;2026-11-15;;;2026`), { target: logged })
      const text = logs.join('')
      for (const secret of [tc, '7654321', file])
        assert.ok(!text.includes(secret), `logda ${secret.slice(0, 6)} olmamalı`)
      const audits = await db
        .select({ action: auditLog.action, changes: auditLog.changes })
        .from(auditLog)
        .where(eq(auditLog.institutionId, institution.id))
      const main = audits.find((audit) => audit.action === 'invoice.import')
      assert.deepEqual((main?.changes as { counts: object }).counts, {
        rows: 1,
        invoices: 1,
        linked: 0,
      })
      const dump = JSON.stringify(audits)
      for (const secret of [tc, '7654321'])
        assert.ok(!dump.includes(secret), 'denetimde kişisel veri olmamalı')
    } finally {
      await logged.close()
    }
  })
})
