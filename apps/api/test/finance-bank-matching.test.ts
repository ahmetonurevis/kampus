import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { findRecord, insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { bankTransactions } from '../src/db/schema/finance-bank-transactions.ts'
import { financeDayClosings } from '../src/db/schema/finance-day-closings.ts'
import { bankAccounts, paymentAllocations, payments } from '../src/db/schema/payments.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
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
 * Banka hareketi eşleştirme uçları (IST-115, ON-099; docs/domain/finans.md DOM-FIN-069). Her test
 * kendi kurumunu kurar: 7-A, Deniz Yılmaz (s1, kimlik 10000000146, velisi Ayşe Yılmaz) üç açık
 * 10.000 ₺'lik taksitle, Nehir Baş (s25) bir 15.000 ₺'lik taksitle ve bildirilmiş bir banka hesabı.
 * FIXED_NOW 2026-10-06 09:00Z.
 */

const SEED = createSeed(FIXED_NOW)
const DENIZ = SEED.students.find((item) => item.id === 's1')
const NEHIR = SEED.students.find((item) => item.id === 's25')
const PARENTS = SEED.parents.filter((item) => item.id === 'p1' || item.id === 'p25')
const TC = '10000000146'
const INVOICES = [
  ...[1, 2, 3].map((installment) => ({
    id: `test-inv-s1-${String(installment)}`,
    studentId: 's1',
    installment,
    amount: 1_000_000,
    dueDate: `2026-1${String(installment - 1)}-15T09:00:00.000Z`,
    paidAt: null,
    method: null,
    reminderAt: null,
  })),
  {
    id: 'test-inv-s25-1',
    studentId: 's25',
    installment: 1,
    amount: 1_500_000,
    dueDate: '2026-10-15T09:00:00.000Z',
    paidAt: null,
    method: null,
    reminderAt: null,
  },
]
const IBAN = 'TR330006100519786457841326'

const STATEMENT = [
  'Hesap Hareketleri;;;;',
  'Tarih;Açıklama;Tutar;Bakiye;Dekont No',
  `01.10.2026;HAVALE TC ${TC} EKIM TAKSIT;10.000,00;110.000,00;EFT-001`,
  '02.10.2026;KIRA ODEMESI;-5.000,00;105.000,00;HVL-002',
  '03.10.2026;NEHIR BAS OKUL;15.000,00;120.000,00;EFT-003',
  '04.10.2026;ACIKLAMASIZ GELEN;77,00;120.077,00;',
  ';Dönem toplamı;25.077,00;',
].join('\n')
const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

describe('banka hareketi eşleştirme uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const logs: string[] = []
  const key = () => ({ 'idempotency-key': `test-bank-${String(++serial).padStart(5, '0')}` })
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    assert.ok(DENIZ && NEHIR)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW, logs })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    const row = (
      collection: 'classes' | 'students' | 'invoices' | 'parents',
      data: { id: string },
    ) => ({
      collection,
      id: data.id,
      data: { ...data },
    })
    await insertMissingRecords(
      db,
      created.id,
      [
        ...SEED.classes.filter((item) => item.id === 'c1').map((item) => row('classes', item)),
        ...[DENIZ, NEHIR].flatMap((item) => (item ? [row('students', item)] : [])),
        ...PARENTS.map((item) => row('parents', item)),
        ...INVOICES.map((item) => row('invoices', item)),
      ],
      FIXED_NOW,
    )
    await db.insert(studentIdentities).values({
      institutionId: created.id,
      studentId: 's1',
      academicYear: 2026,
      identityKind: 'tc',
      identityNumber: TC,
      birthDate: '2013-04-01',
    })
    const accountId = randomUUID()
    await db.insert(bankAccounts).values({
      institutionId: created.id,
      id: accountId,
      bankName: 'Örnek Bankası',
      iban: IBAN,
      accountHolder: 'Akademi Özel Okulları',
    })
    return { ...created, accountId, adminCookie: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  async function member(institutionId: string, role: Role) {
    const links = role === 'ogretmen' ? [{ kind: 'teacher' as const, recordId: 't1' }] : []
    return signInAs(app, await createMember(app, institutionId, role, links))
  }
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
  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const ifMatch = (version: number) => ({ 'if-match': `"${String(version)}"` })
  const IMPORTS = '/api/v1/finance/bank-statement-imports'
  const LIST = '/api/v1/finance/bank-transactions'
  const upload = (
    cookie: string | null,
    t: Pick<Tenant, 'accountId'>,
    options: { text?: string; dryRun?: boolean; extra?: Record<string, unknown> } = {},
    headers: Record<string, string> = key(),
  ) =>
    send(
      'POST',
      IMPORTS,
      cookie,
      {
        fileBase64: base64(options.text ?? STATEMENT),
        bankAccountId: t.accountId,
        dryRun: options.dryRun ?? false,
        ...options.extra,
      },
      headers,
    )
  const transactions = (institutionId: string) =>
    db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.institutionId, institutionId))
      .orderBy(bankTransactions.bookingDate)
  const paymentRows = (institutionId: string) =>
    db.select().from(payments).where(eq(payments.institutionId, institutionId))
  const actions = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  /** Ekstreyi aktarır; hareketler işlem gününe göre. */
  async function imported(t: Tenant) {
    const response = await upload(t.adminCookie, t)
    assert.equal(response.statusCode, 201, response.body)
    return transactions(t.id)
  }
  const match = (
    cookie: string,
    id: string,
    version: number,
    body: unknown = { studentId: 's1', invoiceId: 'test-inv-s1-1' },
    headers: Record<string, string> = key(),
  ) => send('POST', `${LIST}/${id}/match`, cookie, body, { ...ifMatch(version), ...headers })
  const ignore = (cookie: string, id: string, version: number, reason = 'Kira geliri') =>
    send('POST', `${LIST}/${id}/ignore`, cookie, { ignoreReason: reason }, ifMatch(version))
  const restore = (cookie: string, id: string, version: number) =>
    send('POST', `${LIST}/${id}/restore`, cookie, undefined, ifMatch(version))

  // --- Kimlik, rol, modül ----------------------------------------------------------------------

  test('DOM-FIN-069: kimliksiz 401; ön büro, öğretmen ve veli 403; finance kapalıyken 403', async () => {
    const t = await institution()
    const [row] = await imported(t)
    assert.ok(row)
    const id = row.id
    const calls = (cookie: string | null) => [
      send('GET', LIST, cookie),
      upload(cookie, t, { dryRun: true }),
      send('GET', `${LIST}/${id}/suggestions`, cookie),
      match(cookie ?? '', id, row.version),
      ignore(cookie ?? '', id, row.version),
      restore(cookie ?? '', id, row.version),
    ]
    for (const response of await Promise.all(calls(null))) assertError(response, 401)
    for (const role of ['onburo', 'ogretmen', 'veli'] as const) {
      const cookie = await member(t.id, role)
      for (const response of await Promise.all(calls(cookie))) assertError(response, 403)
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await send('GET', LIST, closed.adminCookie), 403, 'module_disabled')
    assertError(await upload(closed.adminCookie, closed), 403, 'module_disabled')
    assert.equal((await transactions(t.id))[0]?.status, 'unmatched')
    assert.equal((await paymentRows(t.id)).length, 0)
  })

  // --- İçe aktarma -----------------------------------------------------------------------------

  test('DOM-FIN-069, K-106, K-107: önizleme yazmaz; onay yalnız gelen hareketi yazar, ikinci yükleme atlar; tahsilat oluşmaz', async () => {
    const t = await institution()
    const preview = await upload(t.adminCookie, t, { dryRun: true })
    assert.equal(preview.statusCode, 200, preview.body)
    const data = preview.json().data
    assert.deepEqual(
      data.rows.map((row: { status: string }) => row.status),
      ['ready', 'outgoing', 'ready', 'ready', 'ignored'],
    )
    assert.deepEqual(data.columns, {
      date: 'Tarih',
      description: 'Açıklama',
      amount: 'Tutar',
      balance: 'Bakiye',
      reference: 'Dekont No',
    })
    assert.equal(data.totalCents, 2_507_700)
    // K-112: kimlik no önizlemede maskeli.
    assert.equal(preview.body.includes(TC), false)
    assert.ok(preview.body.includes('*******0146'))
    assert.equal((await transactions(t.id)).length, 0)

    const headers = key()
    const confirmed = await upload(t.adminCookie, t, {}, headers)
    assert.equal(confirmed.statusCode, 201, confirmed.body)
    assert.deepEqual(confirmed.json().data.rows, [])
    assert.equal(confirmed.json().data.readyCount, 3)
    const rows = await transactions(t.id)
    assert.deepEqual(
      rows.map((row) => [row.bookingDate, row.amountCents, row.bankReference, row.status]),
      [
        ['2026-10-01', 1_000_000, 'EFT-001', 'unmatched'],
        ['2026-10-03', 1_500_000, 'EFT-003', 'unmatched'],
        ['2026-10-04', 7_700, null, 'unmatched'],
      ],
    )
    assert.ok(
      rows.every(
        (row) => row.bankAccountId === t.accountId && /^[0-9a-f]{64}$/.test(row.fingerprint),
      ),
    )
    // Aynı anahtar ilk yanıtı döner, yazmaz.
    const replay = await upload(t.adminCookie, t, {}, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    // Yeni anahtarla aynı dosya: hepsi atlanır.
    const again = await upload(t.adminCookie, t)
    assert.equal(again.statusCode, 201, again.body)
    assert.deepEqual([again.json().data.readyCount, again.json().data.skippedCount], [0, 3])
    assert.equal((await transactions(t.id)).length, 3)
    // IST-115 kabul ölçütü: öneri onaylanmadan tahsilat oluşmaz.
    assert.equal((await paymentRows(t.id)).length, 0)
    const [audit] = await actions(t.id, 'bank_statement.import')
    assert.deepEqual(audit?.changes, {
      fields: ['bankAccountId', 'bookingDate', 'amountCents', 'statementDescription'],
      counts: { rows: 5, imported: 3, skipped: 0, outgoing: 1 },
    })
    // Açıklama ve kimlik no loglanmaz.
    assert.equal(
      logs.some((line) => line.includes(TC) || line.includes('NEHIR BAS')),
      false,
    )
  })

  test('DOM-FIN-069: hatalı satır 422 bank_statement_invalid, başlıksız ve hesap hataları 422; hiçbir hareket yazılmaz', async () => {
    const t = await institution()
    const broken = `${STATEMENT}\n05.10.2026;HAVALE;1.234;;X`
    const invalid = await upload(t.adminCookie, t, { text: broken })
    assertError(invalid, 422, 'bank_statement_invalid')
    assert.deepEqual(invalid.json().issues[0].path, ['rows', 8, 'amount'])
    assert.equal(invalid.json().issues[0].message.startsWith('8. satır:'), true)
    assertError(
      await upload(t.adminCookie, t, { text: 'A;B\n1;2' }),
      422,
      'bank_statement_header_missing',
    )
    const mapped = await upload(t.adminCookie, t, {
      text: 'Gün;Not;Para\n01.10.2026;EFT;100,00',
      dryRun: true,
      extra: { columns: { date: 'Gün', description: 'Not', amount: 'Para' } },
    })
    assert.equal(mapped.statusCode, 200, mapped.body)
    assert.equal(mapped.json().data.readyCount, 1)
    assertError(
      await upload(t.adminCookie, { accountId: randomUUID() }),
      422,
      'bank_account_invalid',
    )
    const mt940 = [
      ':20:X',
      ':25:TR120006200000000000000001',
      ':61:2610011001C100,00NTRFNONREF//R1',
      ':86:EFT',
    ].join('\n')
    assertError(
      await upload(t.adminCookie, t, { text: mt940 }),
      422,
      'bank_statement_account_mismatch',
    )
    assertError(await upload(t.adminCookie, t, { extra: { fileBase64: '' } }), 400)
    assertError(await upload(t.adminCookie, t, {}, {}), 400, 'idempotency_key_required')
    assert.equal((await transactions(t.id)).length, 0)
  })

  test('DOM-FIN-069: MT940 dosyası aktarılır; yalnız C hareketi yazılır', async () => {
    const t = await institution()
    const mt940 = [
      ':20:STMT',
      `:25:${IBAN}`,
      ':61:2610021002C250,00NTRFNONREF//MT-1',
      `:86:EFT DENIZ YILMAZ`,
      ':61:2610021002D20,00NTRFNONREF//MT-2',
      ':86:MASRAF',
    ].join('\n')
    const response = await upload(t.adminCookie, t, { text: mt940 })
    assert.equal(response.statusCode, 201, response.body)
    const rows = await transactions(t.id)
    assert.deepEqual(
      rows.map((row) => [row.sourceFormat, row.amountCents, row.bankReference]),
      [['mt940', 25_000, 'MT-1']],
    )
  })

  // --- Liste ve öneri --------------------------------------------------------------------------

  test('DOM-FIN-069, K-108, K-112: liste süzülür ve sayfalanır, açıklama maskeli, eşleşmemişte en iyi öneri', async () => {
    const t = await institution()
    await imported(t)
    const listed = await send('GET', `${LIST}?pageSize=2`, t.adminCookie)
    assert.equal(listed.statusCode, 200, listed.body)
    const body = listed.json()
    assert.equal(body.meta.total, 3)
    assert.deepEqual(
      body.data.map((item: { bookingDate: string }) => item.bookingDate),
      ['2026-10-04', '2026-10-03'],
    )
    assert.equal(body.data[1].suggestion.studentId, 's25')
    assert.equal(body.data[1].suggestion.confidence, 'high')
    assert.equal(body.data[0].suggestion, null)
    const page2 = (await send('GET', `${LIST}?page=2&pageSize=2`, t.adminCookie)).json()
    assert.equal(page2.data[0].description, 'HAVALE TC *******0146 EKIM TAKSIT')
    assert.equal(listed.body.includes(TC) || JSON.stringify(page2).includes(TC), false)
    const searched = (await send('GET', `${LIST}?q=nehir`, t.adminCookie)).json()
    assert.equal(searched.meta.total, 1)
    const ranged = (
      await send(
        'GET',
        `${LIST}?dateFrom=2026-10-02&dateTo=2026-10-03&status=unmatched`,
        t.adminCookie,
      )
    ).json()
    assert.equal(ranged.meta.total, 1)
    assertError(await send('GET', `${LIST}?sort=x`, t.adminCookie), 400)
    assertError(
      await send('GET', `${LIST}?dateFrom=2026-10-03&dateTo=2026-10-01`, t.adminCookie),
      400,
    )
  })

  test('DOM-FIN-069, K-122: bölünmüş kimlik no ve IBAN açıklamada ve referansta maskeli; önizleme, liste, öneri ve logda ham yok', async () => {
    const t = await institution()
    const spacedId = '123 456 789 01'
    const spacedIban = 'TR12 0006 1005 1978 6457 8413 26'
    const text = [
      'Tarih;Açıklama;Tutar;Referans',
      `01.10.2026;HAVALE TC ${spacedId} GONDEREN ${spacedIban};10.000,00;${spacedIban}`,
      '02.10.2026;EFT TC 123-456-789-02;500,00;REF 1234 5678 901',
    ].join('\n')
    const raw = ['12345678901', '120006100519786457841326', '123 456 789', '0006 1005', '5678 901']
    const leaks = (body: string) => raw.filter((value) => body.includes(value))
    const preview = await upload(t.adminCookie, t, { text, dryRun: true })
    assert.equal(preview.statusCode, 200, preview.body)
    assert.deepEqual(leaks(preview.body), [])
    assert.deepEqual(
      preview.json().data.rows.map((row: { reference: string }) => row.reference),
      ['TR** **** **** **** **** **13 26', 'REF **** ***8 901'],
    )
    assert.equal((await upload(t.adminCookie, t, { text })).statusCode, 201)
    // Saklanan metin hamdır; eşleştirme ham metinle çalışır.
    const [stored] = await transactions(t.id)
    assert.equal(stored?.bankReference, spacedIban)
    assert.ok(stored?.statementDescription.includes(spacedId))
    const listed = await send('GET', LIST, t.adminCookie)
    assert.equal(listed.statusCode, 200, listed.body)
    assert.deepEqual(leaks(listed.body), [])
    const item = listed
      .json()
      .data.find((row: { bookingDate: string }) => row.bookingDate === '2026-10-01')
    assert.equal(
      item.description,
      'HAVALE TC *** *** *89 01 GONDEREN TR** **** **** **** **** **13 26',
    )
    assert.equal(item.reference, 'TR** **** **** **** **** **13 26')
    assert.ok(stored)
    const suggested = await send('GET', `${LIST}/${stored.id}/suggestions`, t.adminCookie)
    assert.equal(suggested.statusCode, 200, suggested.body)
    assert.deepEqual(leaks(suggested.body), [])
    assert.equal(suggested.json().data.transaction.reference, item.reference)
    assert.deepEqual(
      logs.flatMap((line) => leaks(line)),
      [],
    )
  })

  test('DOM-FIN-069, K-108: öneriler kimlik no ile yüksek güvenli, kimlik yanıtta yok; seçilen öğrencinin taksiti', async () => {
    const t = await institution()
    const [first] = await imported(t)
    assert.ok(first)
    const response = await send('GET', `${LIST}/${first.id}/suggestions`, t.adminCookie)
    assert.equal(response.statusCode, 200, response.body)
    const { suggestions, transaction } = response.json().data
    assert.equal(transaction.id, first.id)
    assert.deepEqual(
      suggestions.map((item: { studentId: string; invoiceId: string; confidence: string }) => [
        item.studentId,
        item.invoiceId,
        item.confidence,
      ]),
      [['s1', 'test-inv-s1-1', 'high']],
    )
    assert.deepEqual(suggestions[0].reasons, ['national_id', 'amount_exact'])
    assert.equal(response.body.includes(TC), false)
    const chosen = await send('GET', `${LIST}/${first.id}/suggestions?studentId=s25`, t.adminCookie)
    assert.equal(chosen.json().data.suggestions[0].studentId, 's25')
    assert.equal(chosen.json().data.suggestions[0].amountFit, 'partial')
    assertError(await send('GET', `${LIST}/${randomUUID()}/suggestions`, t.adminCookie), 404)
    assertError(await send('GET', `${LIST}/x/suggestions`, t.adminCookie), 400)
  })

  // --- Onay --------------------------------------------------------------------------------------

  test('DOM-FIN-069, DOM-FIN-031: onay tahsilatı banka havalesiyle hareketin hesabına ve gününe yazar; ikinci onay 409, tek tahsilat', async () => {
    const t = await institution()
    const [first] = await imported(t)
    assert.ok(first)
    assertError(
      await send(
        'POST',
        `${LIST}/${first.id}/match`,
        t.adminCookie,
        { studentId: 's1', invoiceId: 'test-inv-s1-1' },
        key(),
      ),
      400,
      'if_match_required',
    )
    assertError(
      await match(
        t.adminCookie,
        first.id,
        first.version,
        { studentId: 's1', invoiceId: 'test-inv-s1-1' },
        {},
      ),
      400,
      'idempotency_key_required',
    )
    assertError(await match(t.adminCookie, first.id, first.version + 3), 409, 'version_conflict')
    assertError(
      await match(t.adminCookie, first.id, first.version, {
        studentId: 's1',
        invoiceId: 'test-inv-s1-1',
        amountCents: 1,
      }),
      400,
    )
    assert.equal((await paymentRows(t.id)).length, 0)

    const headers = key()
    const done = await match(t.adminCookie, first.id, first.version, undefined, headers)
    assert.equal(done.statusCode, 201, done.body)
    const { transaction, payment } = done.json().data
    assert.equal(transaction.status, 'matched')
    assert.equal(transaction.payment.receiptNumber, payment.receiptNumber)
    assert.deepEqual(
      [payment.method, payment.reference, payment.amountCents, payment.paidAt.slice(0, 10)],
      ['Banka havalesi', 'EFT-001', 1_000_000, '2026-10-01'],
    )
    assert.equal(payment.bankAccountLabel, 'Örnek Bankası · 1326')
    assert.deepEqual(payment.allocations, [{ invoiceId: 'test-inv-s1-1', amountCents: 1_000_000 }])
    const paid = await findRecord(db, t.id, 'invoices', 'test-inv-s1-1')
    assert.ok(paid?.data.paidAt)
    // Aynı anahtar ilk yanıtı döner; yeni anahtarla ikinci onay 409.
    const replay = await match(t.adminCookie, first.id, first.version, undefined, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(
      await match(t.adminCookie, first.id, transaction.version),
      409,
      'bank_transaction_not_open',
    )
    assert.equal((await paymentRows(t.id)).length, 1)
    const [row] = await transactions(t.id)
    assert.equal(row?.paymentId, payment.id)
    assert.equal((await actions(t.id, 'bank_transaction.match')).length, 1)
    assert.equal((await actions(t.id, 'payment.record')).length, 1)
  })

  test('DOM-FIN-030, K-110: fazla ödeme sonraki taksitlere ve iade alacağına; kısmi ödeme taksiti açık bırakır', async () => {
    const t = await institution()
    const text = [
      'Tarih;Açıklama;Tutar;Referans',
      `01.10.2026;TC ${TC};35.000,00;OVER-1`,
      '02.10.2026;NEHIR BAS;5.000,00;PART-1',
    ].join('\n')
    assert.equal((await upload(t.adminCookie, t, { text })).statusCode, 201)
    const [over, part] = await transactions(t.id)
    assert.ok(over && part)
    const suggested = await send('GET', `${LIST}/${over.id}/suggestions`, t.adminCookie)
    assert.equal(suggested.json().data.suggestions[0].creditCents, 500_000)
    const overDone = await match(t.adminCookie, over.id, over.version)
    assert.equal(overDone.statusCode, 201, overDone.body)
    assert.equal(overDone.json().data.payment.creditCents, 500_000)
    assert.equal(overDone.json().data.payment.allocations.length, 3)
    const partDone = await match(t.adminCookie, part.id, part.version, {
      studentId: 's25',
      invoiceId: 'test-inv-s25-1',
    })
    assert.equal(partDone.statusCode, 201, partDone.body)
    assert.equal((await findRecord(db, t.id, 'invoices', 'test-inv-s25-1'))?.data.paidAt, null)
    const allocations = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.institutionId, t.id))
    assert.equal(allocations.length, 4)
  })

  test('DOM-FIN-036: kapalı güne eşleşme 422 finance_day_closed; hareket ve tahsilat değişmez', async () => {
    const t = await institution()
    const [first] = await imported(t)
    assert.ok(first)
    await db.insert(financeDayClosings).values({
      institutionId: t.id,
      id: randomUUID(),
      closingDate: '2026-10-01',
      methodTotals: [],
      collectedCount: 0,
      collectedCents: 0,
      reversedCount: 0,
      reversedCents: 0,
      netCents: 0,
      closedAt: FIXED_NOW,
      closedByUserId: t.admin.id,
    })
    assertError(await match(t.adminCookie, first.id, first.version), 422, 'finance_day_closed')
    assert.equal((await paymentRows(t.id)).length, 0)
    assert.equal((await transactions(t.id))[0]?.status, 'unmatched')
  })

  test('DOM-FIN-069: taksit öğrencinin değilse 404, referans elle kullanılmışsa 409; kayıt değişmez', async () => {
    const t = await institution()
    const [first] = await imported(t)
    assert.ok(first)
    assertError(
      await match(t.adminCookie, first.id, first.version, {
        studentId: 's1',
        invoiceId: 'test-inv-s25-1',
      }),
      404,
    )
    const manual = await send(
      'POST',
      '/api/v1/payments',
      t.adminCookie,
      {
        studentId: 's25',
        amountCents: 100,
        method: 'Banka havalesi',
        reference: 'EFT-001',
        bankAccountId: t.accountId,
      },
      key(),
    )
    assert.equal(manual.statusCode, 201, manual.body)
    const listed = (await send('GET', `${LIST}?q=EFT-001`, t.adminCookie)).json()
    assert.equal(listed.data[0].referenceInUse, true)
    assertError(await match(t.adminCookie, first.id, first.version), 409, 'payment_reference_used')
    assert.equal((await paymentRows(t.id)).length, 1)
    assert.equal((await transactions(t.id))[0]?.status, 'unmatched')
  })

  test('K-111: tahsilat iptali eşleşmeyi geri açar; hareket yeniden eşleşir', async () => {
    const t = await institution()
    const [first] = await imported(t)
    assert.ok(first)
    const done = await match(t.adminCookie, first.id, first.version)
    assert.equal(done.statusCode, 201, done.body)
    const { payment, transaction } = done.json().data
    const reversed = await send(
      'POST',
      `/api/v1/payments/${String(payment.id)}/reverse`,
      t.adminCookie,
      { reason: 'Yanlış öğrenciyle eşleşti' },
      { ...ifMatch(payment.version), ...key() },
    )
    assert.equal(reversed.statusCode, 200, reversed.body)
    const [row] = await transactions(t.id)
    assert.deepEqual(
      [row?.status, row?.paymentId, row?.version],
      ['unmatched', null, transaction.version + 1],
    )
    assert.equal((await actions(t.id, 'bank_transaction.reopen')).length, 1)
    assert.ok(row)
    const again = await match(t.adminCookie, row.id, row.version)
    assert.equal(again.statusCode, 201, again.body)
    assert.equal(again.json().data.payment.reference, 'EFT-001')
  })

  test('K-111: yoksay ve geri al; eşleşmiş hareket yoksayılmaz ve geri alınmaz', async () => {
    const t = await institution()
    const [first, second] = await imported(t)
    assert.ok(first && second)
    assertError(await ignore(t.adminCookie, second.id, second.version, 'ab'), 400)
    const ignored = await ignore(t.adminCookie, second.id, second.version)
    assert.equal(ignored.statusCode, 200, ignored.body)
    assert.equal(ignored.json().data.status, 'ignored')
    assert.equal(ignored.json().data.ignoreReason, 'Kira geliri')
    const version = ignored.json().data.version
    assertError(
      await match(t.adminCookie, second.id, version, {
        studentId: 's25',
        invoiceId: 'test-inv-s25-1',
      }),
      409,
      'bank_transaction_not_open',
    )
    assertError(await ignore(t.adminCookie, second.id, version), 409, 'bank_transaction_not_open')
    const restored = await restore(t.adminCookie, second.id, version)
    assert.equal(restored.statusCode, 200, restored.body)
    assert.equal(restored.json().data.status, 'unmatched')
    assert.equal(restored.json().data.ignoreReason, null)
    assertError(
      await restore(t.adminCookie, second.id, restored.json().data.version),
      409,
      'bank_transaction_not_ignored',
    )

    const done = await match(t.adminCookie, first.id, first.version)
    const matchedVersion = done.json().data.transaction.version
    assertError(
      await restore(t.adminCookie, first.id, matchedVersion),
      409,
      'bank_transaction_not_ignored',
    )
    assertError(
      await ignore(t.adminCookie, first.id, matchedVersion),
      409,
      'bank_transaction_not_open',
    )
    assert.equal((await actions(t.id, 'bank_transaction.ignore')).length, 1)
    assert.equal((await actions(t.id, 'bank_transaction.restore')).length, 1)
  })

  // --- Kurum kapsamı -----------------------------------------------------------------------------

  test('IST-002: başka kurumun hareketi 404 ve B değişmez; listede yok; gövdedeki institutionId ve B hesabı etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const [bRow] = await imported(b)
    assert.ok(bRow)
    const url = `${LIST}/${bRow.id}`
    assertError(await send('GET', `${url}/suggestions`, a.adminCookie), 404)
    assertError(await match(a.adminCookie, bRow.id, bRow.version), 404)
    assertError(await ignore(a.adminCookie, bRow.id, bRow.version), 404)
    assertError(await restore(a.adminCookie, bRow.id, bRow.version), 404)
    const listed = (await send('GET', LIST, a.adminCookie)).json()
    assert.equal(listed.meta.total, 0)
    // B hesabıyla A'da aktarım reddedilir; gövdedeki kurum kimliği şemada yoktur (400).
    assertError(await upload(a.adminCookie, b), 422, 'bank_account_invalid')
    assertError(await upload(a.adminCookie, a, { extra: { institutionId: b.id } }), 400)
    const [after] = await transactions(b.id)
    assert.deepEqual([after?.status, after?.version], ['unmatched', bRow.version])
    assert.equal((await transactions(a.id)).length, 0)
    assert.equal((await paymentRows(b.id)).length, 0)
  })
})
