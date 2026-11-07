import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { defaultFinanceExportProfile } from '@kampus/school-core/lib/finance-export-profile.ts'
import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
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
import { readWorkbook, serialToDay } from './support/finance-workbook.ts'

/** Muhasebe dosyasının `.xlsx` biçimi (ON-094, IST-111; DOM-FIN-055). FIXED_NOW 2026-10-06. */

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const AMOUNT_FORMAT = '#,##0.00'
const TEXT_FORMAT = '@'
const PERIOD = 'from=2026-10-01&to=2026-10-31'

describe('muhasebe dosyası .xlsx', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-xl-${String(++serial).padStart(5, '0')}` })
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(STUDENT)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(
    overrides: Partial<InstitutionOverrides> = {},
    studentName = STUDENT?.name,
  ) {
    const created = await createInstitution(app, overrides)
    assert.ok(STUDENT)
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'classes',
          id: 'c1',
          data: { ...SEED.classes.find((item) => item.id === 'c1') },
        },
        { collection: 'students', id: STUDENT.id, data: { ...STUDENT, name: studentName } },
        {
          collection: 'invoices',
          id: 'test-inv-1',
          data: {
            id: 'test-inv-1',
            studentId: STUDENT.id,
            installment: 3,
            amount: 5_000_000,
            dueDate: '2026-10-15T09:00:00.000Z',
            paidAt: null,
            method: null,
            reminderAt: null,
            feeKind: 'tuition',
          },
        },
      ],
      FIXED_NOW,
    )
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  const member = async (id: string, role: Role) =>
    signInAs(app, await createMember(app, id, role, []))
  const get = (cookie: string | null, url: string, target: App = app) =>
    target.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  const workbook = (cookie: string | null, kind: string, query = PERIOD, target: App = app) =>
    get(cookie, `/api/v1/finance/exports?kind=${kind}&${query}&format=xlsx`, target)
  const pay = (cookie: string, amountCents: number, reference: string, target: App = app) =>
    target.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', cookie, ...key() },
      payload: JSON.stringify({
        studentId: STUDENT?.id,
        amountCents,
        method: 'Banka havalesi',
        reference,
      }),
    })
  const setProfile = (cookie: string, profile: unknown, version: number) =>
    app.inject({
      method: 'PATCH',
      url: '/api/v1/finance/export-profile',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        'if-match': `"${String(version)}"`,
        ...key(),
        cookie,
      },
      payload: JSON.stringify({ profile }),
    })
  function assertError(
    response: Awaited<ReturnType<typeof get>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const open = (response: Awaited<ReturnType<typeof get>>) => {
    assert.equal(response.statusCode, 200, response.body)
    return readWorkbook(response.rawPayload)
  }
  const exportsOf = (institutionId: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, 'finance.export')))

  test('guvenlik-kvkk: oturumsuz 401; yalnız yönetici; modül kapalı 403; denetime düşmez', async () => {
    assertError(await workbook(null, 'payments'), 401)
    const a = await institution()
    for (const role of ['onburo', 'ogretmen', 'ogrenci', 'veli'] as const)
      assertError(await workbook(await member(a.id, role), 'payments'), 403, 'forbidden')
    assert.equal((await exportsOf(a.id)).length, 0)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await workbook(closed.cookie, 'payments'), 403, 'module_disabled')
  })

  test('guvenlik-kvkk: eski oturumla 403 reauthentication_required; dosya üretilmez', async () => {
    const a = await institution()
    const later = await buildTestApp(db, {
      clock: () => new Date(Date.now() + 16 * 60 * 1000),
    })
    try {
      assertError(
        await workbook(a.cookie, 'payments', PERIOD, later),
        403,
        'reauthentication_required',
      )
    } finally {
      await later.close()
    }
    assert.equal((await exportsOf(a.id)).length, 0)
  })

  test('IST-111: bilinmeyen biçim ve parametre 400; geçersiz dönem 422 aynı kalır', async () => {
    const a = await institution()
    assertError(
      await get(a.cookie, `/api/v1/finance/exports?kind=payments&${PERIOD}&format=pdf`),
      400,
      'validation_failed',
    )
    assertError(
      await get(a.cookie, `/api/v1/finance/exports?kind=payments&${PERIOD}&format=xlsx&x=1`),
      400,
    )
    assertError(await workbook(a.cookie, 'serbest'), 400, 'validation_failed')
    assertError(
      await workbook(a.cookie, 'payments', 'from=2026-11-01&to=2026-10-01'),
      422,
      'export_period_invalid',
    )
    assert.equal((await exportsOf(a.id)).length, 0)
  })

  test('DOM-YTK-001: başka kurumun satırı dosyada yok', async () => {
    const a = await institution()
    const b = await institution()
    assert.equal((await pay(b.cookie, 5_000, 'TR-X-B1')).statusCode, 201)
    const file = open(await workbook(a.cookie, 'payments'))
    assert.equal(file.rowCount, 1, 'yalnız başlık satırı')
    assert.equal(file.row(1)[0], 'Tarih')
    const own = open(await workbook(b.cookie, 'payments'))
    assert.equal(own.rowCount, 2)
    assert.ok(own.row(2).includes('TR-X-B1'))
  })

  test('IST-111: dosya açılır; metin, tutar ve tarih hücreleri doğru türde; toplam dönemle aynı', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, 123_456, 'TR-X-1')).statusCode, 201)
    const created = await pay(a.cookie, 700_001, 'TR-X-2')
    assert.equal(created.statusCode, 201)

    const response = await workbook(a.cookie, 'payments')
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(
      response.headers['content-type'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    assert.equal(
      response.headers['content-disposition'],
      'attachment; filename="payments-2026-10-01-2026-10-31.xlsx"',
    )
    const file = readWorkbook(response.rawPayload)
    assert.equal(file.sheetName, 'Tahsilat')
    assert.equal(file.hasFormula, false)
    assert.deepEqual(file.row(1), [
      'Tarih',
      'Hareket',
      'Dekont no',
      'Öğrenci',
      'Okul no',
      'Yöntem',
      'İşlem referansı',
      'Tutar (₺)',
    ])
    assert.equal(file.cells.get('A1')?.bold, true)
    assert.equal(file.rowCount, 3)

    const date = file.cells.get('A2')
    assert.equal(date?.type, 'n')
    assert.equal(date?.format, 'yyyy-mm-dd')
    assert.equal(serialToDay(Number(date?.value)), '2026-10-06')
    for (const address of ['B2', 'C2', 'D2', 'E2', 'F2', 'G2']) {
      assert.equal(file.cells.get(address)?.type, 's', address)
      assert.equal(file.cells.get(address)?.format, TEXT_FORMAT, address)
    }
    assert.equal(file.cells.get('D2')?.value, STUDENT?.name)
    assert.equal(file.cells.get('E2')?.value, String(STUDENT?.number), 'okul no metin kalır')

    const amounts = [file.cells.get('H2'), file.cells.get('H3')]
    for (const amount of amounts) {
      assert.equal(amount?.type, 'n')
      assert.equal(amount?.format, AMOUNT_FORMAT)
    }
    assert.deepEqual(amounts.map((amount) => amount?.value).sort(), [1234.56, 7000.01])
    const fileCents = amounts.reduce(
      (sum, amount) => sum + Math.round(Number(amount?.value) * 100),
      0,
    )
    const totals = (await get(a.cookie, `/api/v1/finance/summary?${PERIOD}`)).json().data
    assert.equal(fileCents, totals.payments.totalCents)
  })

  test('DOM-FIN-033: tahsilat iptali eksi sayı hücresidir', async () => {
    const a = await institution()
    const created = await pay(a.cookie, 5_000, 'TR-X-R1')
    const { id, version } = created.json().data
    const reversed = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${String(id)}/reverse`,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        cookie: a.cookie,
        'if-match': `"${String(version)}"`,
        ...key(),
      },
      payload: JSON.stringify({ reason: 'Yanlış öğrenciye girildi' }),
    })
    assert.equal(reversed.statusCode, 200, reversed.body)
    const file = open(await workbook(a.cookie, 'payments'))
    const values = [file.cells.get('H2')?.value, file.cells.get('H3')?.value].sort()
    assert.deepEqual(values, [-50, 50])
  })

  test('IST-111: formül enjeksiyonu: ad ve referans metin hücresidir, dosyada formül yoktur', async () => {
    const name = '=HYPERLINK("http://kotu.example","tikla")'
    const reference = '@SUM(1+1)*cmd|calc'
    const a = await institution({}, name)
    assert.equal((await pay(a.cookie, 1_000, reference)).statusCode, 201)
    const file = open(await workbook(a.cookie, 'payments'))
    assert.equal(file.hasFormula, false)
    for (const [address, value] of [
      ['D2', name],
      ['G2', reference],
    ] as const) {
      const cell = file.cells.get(address)
      assert.equal(cell?.type, 's', address)
      assert.equal(cell?.format, TEXT_FORMAT, address)
      assert.equal(cell?.value, value, 'değer kaçış işareti almadan aynen yazılır')
    }
  })

  test('DOM-FIN-055: kurumun profili aynen uygulanır: başlık, sıra, sabit değer ve tarih biçimi', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, 1_000_000, 'TR-X-P1')).statusCode, 201)
    const profile = defaultFinanceExportProfile()
    profile.dateFormat = 'tr'
    profile.columns.payments = [
      { source: 'amount', header: 'Borç' },
      { source: 'fixed', header: 'Sabit Alan', value: '=120.01' },
      { source: 'date', header: 'Fiş Tarihi' },
      { source: 'studentName', header: 'Cari' },
    ]
    assert.equal((await setProfile(a.cookie, profile, 1)).statusCode, 200)

    const file = open(await workbook(a.cookie, 'payments'))
    assert.deepEqual(file.row(1), ['Borç', 'Sabit Alan', 'Fiş Tarihi', 'Cari'])
    assert.equal(file.cells.get('A2')?.value, 10_000)
    assert.equal(file.cells.get('A2')?.format, AMOUNT_FORMAT)
    assert.equal(file.cells.get('B2')?.type, 's', 'sabit değer de metin hücresidir')
    assert.equal(file.cells.get('B2')?.value, '=120.01')
    assert.equal(file.cells.get('C2')?.format, 'dd.mm.yyyy')
    assert.equal(serialToDay(Number(file.cells.get('C2')?.value)), '2026-10-06')
    assert.equal(file.cells.get('D2')?.value, STUDENT?.name)
    assert.equal(file.cells.get('E1'), undefined, 'profilde olmayan sütun dosyada yok')
    assert.equal(file.hasFormula, false)

    // CSV aynı profilden gelir: iki biçim aynı başlıkları aynı sırada taşır.
    const csv = await get(a.cookie, `/api/v1/finance/exports?kind=payments&${PERIOD}`)
    assert.ok(csv.body.startsWith('﻿"Borç";"Sabit Alan";"Fiş Tarihi";"Cari"'))
  })

  test('IST-111: taksit dosyasında taksit no tam sayı, tutar ve ödenen sayı hücresidir', async () => {
    const a = await institution()
    assert.equal((await pay(a.cookie, 1_250, 'TR-X-I1')).statusCode, 201)
    const file = open(await workbook(a.cookie, 'invoices'))
    assert.equal(file.sheetName, 'Taksit')
    assert.deepEqual(file.row(1), [
      'Vade',
      'Öğrenci',
      'Okul no',
      'Taksit',
      'Kalem',
      'Durum',
      'Tutar (₺)',
      'Ödenen (₺)',
      'Açıklama',
    ])
    assert.equal(serialToDay(Number(file.cells.get('A2')?.value)), '2026-10-15')
    assert.equal(file.cells.get('D2')?.type, 'n')
    assert.equal(file.cells.get('D2')?.value, 3)
    assert.equal(file.cells.get('D2')?.format, '0')
    assert.equal(file.cells.get('G2')?.value, 50_000)
    assert.equal(file.cells.get('H2')?.value, 12.5)
  })

  test('IST-111: iade dosyası satır yoksa yalnız başlıkla açılır', async () => {
    const a = await institution()
    const file = open(await workbook(a.cookie, 'refunds'))
    assert.equal(file.sheetName, 'İade')
    assert.equal(file.rowCount, 1)
    assert.equal(file.row(1).at(-1), 'Tutar (₺)')
  })

  test('IST-111: tarih Europe/Istanbul günüdür: UTC geceyi geçmeden İstanbul ertesi gündür', async () => {
    const a = await institution()
    const midnight = await buildTestApp(db, {
      clock: () => new Date('2026-10-14T22:30:00.000Z'),
    })
    try {
      const cookie = await signInAs(midnight, a.admin)
      assert.equal((await pay(cookie, 1_000, 'TR-X-GECE', midnight)).statusCode, 201)
      const file = open(await workbook(cookie, 'payments', PERIOD, midnight))
      assert.equal(serialToDay(Number(file.cells.get('A2')?.value)), '2026-10-15')
    } finally {
      await midnight.close()
    }
  })

  test('DOM-YTK-053: aktarım denetime düşer; dönem, tür ve biçim taşır, satır taşımaz; CSV kimliği değişmez', async () => {
    const a = await institution()
    await pay(a.cookie, 5_000, 'TR-X-A1')
    assert.equal((await workbook(a.cookie, 'payments')).statusCode, 200)
    assert.equal(
      (await get(a.cookie, `/api/v1/finance/exports?kind=payments&${PERIOD}`)).statusCode,
      200,
    )
    const rows = await exportsOf(a.id)
    assert.deepEqual(rows.map((row) => row.entityId).sort(), [
      'payments:2026-10-01:2026-10-31',
      'payments:2026-10-01:2026-10-31:xlsx',
    ])
    assert.equal(JSON.stringify(rows).includes('TR-X-A1'), false)
  })

  test('guvenlik-kvkk: hız sınırı CSV ile ortaktır', async () => {
    const a = await institution()
    for (let index = 0; index < 10; index += 1)
      assert.equal(
        (await get(a.cookie, `/api/v1/finance/exports?kind=refunds&${PERIOD}`)).statusCode,
        200,
      )
    assertError(await workbook(a.cookie, 'refunds'), 429, 'rate_limited')
  })
})
