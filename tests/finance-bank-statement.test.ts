import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  BANK_STATEMENT_SAMPLE,
  bankStatementImportSchema,
  bankTransactionKeys,
  isMt940,
  maskStatementText,
  parseBankStatement,
  parseSignedTlAmount,
  parseStatementDay,
  planBankStatementImport,
} from '../packages/school-core/src/lib/finance-bank-statement.ts'

// Banka ekstresi içe aktarımı (IST-115, ON-099; DOM-FIN-069, K-106, K-107, K-112).

const TODAY = '2026-10-06'
const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const parse = (raw: string, columns?: Record<string, string>) =>
  parseBankStatement(raw, { today: TODAY, ...(columns ? { columns } : {}) })

function rejects(run: () => unknown, code: string) {
  assert.throws(run, (error: unknown) => error instanceof DomainError && error.code === code)
}

describe('DOM-FIN-069: ekstre tutar ve tarih hücreleri', () => {
  test('işaretli TL tutarları kuruşa yuvarlamadan çevrilir', () => {
    assert.deepEqual(parseSignedTlAmount('24.500,00'), { cents: 2_450_000, negative: false })
    assert.deepEqual(parseSignedTlAmount('-1.234,56 TL'), { cents: 123_456, negative: true })
    assert.deepEqual(parseSignedTlAmount('1.234,56-'), { cents: 123_456, negative: true })
    assert.deepEqual(parseSignedTlAmount('(150,00)'), { cents: 15_000, negative: true })
    assert.deepEqual(parseSignedTlAmount('+1250.5'), { cents: 125_050, negative: false })
    assert.deepEqual(parseSignedTlAmount('1.234'), { problem: true })
    assert.deepEqual(parseSignedTlAmount('12,345'), { problem: true })
    assert.deepEqual(parseSignedTlAmount('abc'), { problem: true })
  })

  test('tarih saat ekiyle de okunur, geçersiz gün reddedilir', () => {
    assert.equal(parseStatementDay('05.10.2026 14:32'), '2026-10-05')
    assert.equal(parseStatementDay('5/10/2026-14:32:10'), '2026-10-05')
    assert.equal(parseStatementDay('2026-10-05'), '2026-10-05')
    assert.equal(parseStatementDay('31.02.2026'), null)
    assert.equal(parseStatementDay('dün'), null)
  })

  test('K-112: 11 ve daha uzun rakam dizisi son dört hane dışında maskelenir', () => {
    assert.equal(maskStatementText('TC 10000000146 HAVALE'), 'TC *******0146 HAVALE')
    assert.equal(
      maskStatementText('IBAN TR330006100519786457841326'),
      'IBAN TR********************1326',
    )
    assert.equal(maskStatementText('OGR NO 2026001'), 'OGR NO 2026001')
  })

  test('K-122: boşluk, tire ya da noktayla bölünmüş kimlik no ve IBAN da maskelenir', () => {
    assert.equal(
      maskStatementText('IBAN TR12 0006 1005 1978 6457 8413 26 HAVALE'),
      'IBAN TR** **** **** **** **** **13 26 HAVALE',
    )
    assert.equal(maskStatementText('TC 123 456 789 01 EKIM'), 'TC *** *** *89 01 EKIM')
    assert.equal(maskStatementText('TC 123-456-789-01'), 'TC ***-***-*89-01')
    assert.equal(maskStatementText('TC 123.456.789.01'), 'TC ***.***.*89.01')
    assert.equal(maskStatementText('TEL 0532 123 45 67'), 'TEL **** *** 45 67')
    // Kısa diziler, tarih ve tutar değişmez; virgül ayraç sayılmaz.
    assert.equal(
      maskStatementText('OGR NO 2026001 01.10.2026 TAKSIT 3 24.500,00'),
      'OGR NO 2026001 01.10.2026 TAKSIT 3 24.500,00',
    )
    // Bitişik uzun dizinin ardındaki grup diziyi korumaz.
    assert.equal(maskStatementText('TC 12345678901 22'), 'TC *******8901 22')
    // Harfe bitişik uzun dizi (referans) son dört hane dışında maskelenir.
    assert.equal(maskStatementText('EFT2026100100001'), 'EFT*********0001')
  })

  test('K-122: önizleme satırında açıklama ve referans maskeli; aktarılacak hareket ham kalır', () => {
    const raw = [
      'Tarih;Açıklama;Tutar;Referans',
      '01.10.2026;HAVALE TC 123 456 789 01;100,00;TR12 0006 1005 1978 6457 8413 26',
    ].join('\n')
    const lines = parse(raw).lines
    const plan = planBankStatementImport(lines, bankTransactionKeys(ACCOUNT, lines), () => false)
    assert.equal(plan.rows[0]?.description, 'HAVALE TC *** *** *89 01')
    assert.equal(plan.rows[0]?.reference, 'TR** **** **** **** **** **13 26')
    assert.equal(plan.transactions[0]?.description, 'HAVALE TC 123 456 789 01')
    assert.equal(plan.transactions[0]?.reference, 'TR12 0006 1005 1978 6457 8413 26')
  })
})

describe('DOM-FIN-069: CSV ekstresi', () => {
  test('başlık öncesi satırlar atlanır, yaygın başlıklar eşlenir, giden hareket ayrılır', () => {
    const parsed = parse(BANK_STATEMENT_SAMPLE)
    assert.equal(parsed.format, 'csv')
    assert.deepEqual(parsed.columns, {
      date: 'Tarih',
      description: 'Açıklama',
      amount: 'Tutar',
      balance: 'Bakiye',
      reference: 'Dekont No',
    })
    assert.equal(parsed.lines.length, 3)
    const [first, second] = parsed.lines
    assert.equal(first?.bookingDate, '2026-10-01')
    assert.equal(first?.amountCents, 2_450_000)
    assert.equal(first?.direction, 'credit')
    assert.equal(first?.balanceCents, 12_450_000)
    assert.equal(first?.reference, 'EFT2026100100001')
    assert.equal(second?.direction, 'debit')
  })

  test('alacak ve borç sütunlu döküm: sıfır karşı sütun yok sayılır, ikisi doluysa satır hatalı', () => {
    const raw = [
      'İşlem Tarihi;Valör;İşlem Açıklaması;Borç;Alacak;Gönderen;Ref. No',
      '01.10.2026;02.10.2026;HAVALE;0,00;1.000,00;AYŞE YILMAZ;R1',
      '02.10.2026;02.10.2026;KART;500,00;0,00;;R2',
      '03.10.2026;03.10.2026;KARISIK;10,00;20,00;;R3',
      '04.10.2026;04.10.2026;IADE;;-30,00;;R4',
    ].join('\n')
    const parsed = parse(raw)
    assert.equal(parsed.columns.date, 'İşlem Tarihi')
    const [credit, debit, both, negativeCredit] = parsed.lines
    assert.equal(credit?.direction, 'credit')
    assert.equal(credit?.amountCents, 100_000)
    assert.equal(credit?.counterparty, 'AYŞE YILMAZ')
    assert.equal(debit?.direction, 'debit')
    assert.deepEqual(
      both?.issues.map((item) => item.code),
      ['amount_both'],
    )
    assert.equal(negativeCredit?.direction, 'debit')
  })

  test('tarihi ya da tutarı boş satır hareket değildir; okunamayan hücre satır hatasıdır', () => {
    const raw = [
      'Tarih;Açıklama;Tutar;Bakiye',
      ';Devreden bakiye;;100,00',
      '01.10.2026;Ara toplam;;',
      '02.10.2026;HAVALE;1.234;',
      '40.10.2026;HAVALE;10,00;',
      '07.10.2026;HAVALE;10,00;',
      '03.10.2026;;10,00;',
      '03.10.2026;HAVALE;10,00;bakiye yok',
    ].join('\n')
    const lines = parse(raw).lines
    assert.deepEqual(
      lines.map((line) => [line.movement, line.issues.map((item) => item.code)]),
      [
        [false, []],
        [false, []],
        [true, ['amount_invalid']],
        [true, ['date_invalid']],
        [true, ['date_future']],
        [true, ['description_missing']],
        [true, ['balance_invalid']],
      ],
    )
  })

  test('kullanıcının seçtiği sütun adları otomatik eşlemenin önüne geçer', () => {
    const raw = ['Gün;Not;Para;Tarih', '01.10.2026;EFT;100,00;x'].join('\n')
    rejects(() => parse(raw), 'bank_statement_header_missing')
    const parsed = parse(raw, { date: 'gün', description: 'Not', amount: 'PARA' })
    assert.deepEqual(parsed.columns, { date: 'Gün', description: 'Not', amount: 'Para' })
    assert.equal(parsed.lines[0]?.amountCents, 10_000)
    rejects(() => parse(raw, { date: 'Yok' }), 'bank_statement_column_missing')
  })

  test('boş dosya, yalnız başlık ve satır sınırı dosya hatasıdır', () => {
    rejects(() => parse('   '), 'bank_statement_empty')
    rejects(() => parse('Tarih;Açıklama;Tutar'), 'bank_statement_empty')
    const many = [
      'Tarih;Açıklama;Tutar',
      ...Array.from({ length: 5001 }, () => '01.10.2026;X;1,00'),
    ].join('\n')
    rejects(() => parse(many), 'bank_statement_too_many_rows')
  })

  test('gövde şeması dosya, hesap ve sütun eşlemesini katı doğrular', () => {
    const body = { fileBase64: 'QQ==', bankAccountId: ACCOUNT, columns: { date: 'Tarih' } }
    assert.equal(bankStatementImportSchema.parse(body).dryRun, false)
    assert.equal(bankStatementImportSchema.safeParse({ ...body, extra: 1 }).success, false)
    assert.equal(bankStatementImportSchema.safeParse({ ...body, bankAccountId: '' }).success, false)
    assert.equal(
      bankStatementImportSchema.safeParse({ ...body, columns: { other: 'x' } }).success,
      false,
    )
  })
})

const MT940 = [
  ':20:STMT2026',
  ':25:TR33 0006 1005 1978 6457 8413 26',
  ':28C:00001/001',
  ':60F:C261001TRY1000,00',
  ':61:2610011001C24500,00NTRFNONREF//EFT001',
  ':86:?20EFT AYSE YILMAZ?21DENIZ YILMAZ TAKSIT',
  ':61:261002D150,5NTRF123//K2',
  ':86:KIRA',
  ':61:2610031003RD10,00NTRFNONREF',
  ':86:DUZELTME',
  ':61:bozuk',
  ':62F:C261003TRY25339,50',
  '-',
].join('\r\n')

describe('DOM-FIN-069: MT940 ekstresi', () => {
  test('hareketler, yön, banka referansı ve hesap IBAN’ı okunur', () => {
    assert.equal(isMt940(MT940), true)
    const parsed = parse(MT940)
    assert.equal(parsed.format, 'mt940')
    assert.equal(parsed.accountIban, 'TR330006100519786457841326')
    const [credit, debit, reversal, broken] = parsed.lines
    assert.deepEqual(
      [credit?.bookingDate, credit?.amountCents, credit?.direction, credit?.reference],
      ['2026-10-01', 2_450_000, 'credit', 'EFT001'],
    )
    assert.equal(credit?.description, 'EFT AYSE YILMAZ DENIZ YILMAZ TAKSIT')
    assert.equal(credit?.line, 5)
    assert.deepEqual(
      [debit?.amountCents, debit?.direction, debit?.reference],
      [15_050, 'debit', 'K2'],
    )
    assert.equal(reversal?.direction, 'debit')
    assert.deepEqual(
      broken?.issues.map((item) => item.code),
      ['amount_invalid'],
    )
  })

  test('okunamayan hareket satırı hatalıdır; :61: olmayan dosya CSV sayılır', () => {
    assert.deepEqual(
      parse(':20:X\n:61:').lines.map((line) => line.issues.map((item) => item.code)),
      [['amount_invalid']],
    )
    rejects(() => parse(':20:X\n:62F:C261003TRY1,00'), 'bank_statement_header_missing')
  })
})

describe('K-107: mükerrer anahtarı ve aktarım planı', () => {
  const raw = [
    'Tarih;Açıklama;Tutar;Referans',
    '01.10.2026;EFT  Ayşe Yılmaz;100,00;',
    '01.10.2026;eft ayse yilmaz;100,00;',
    '02.10.2026;KIRA;-50,00;R2',
    ';Toplam;150,00;',
    '03.10.2026;HAVALE;abc;',
    '04.10.2026;HAVALE DENIZ;200,00;R4',
  ].join('\n')

  test('aynı dosyadaki eş hareketler sıra numarasıyla ayrılır; başka hesap başka anahtardır', () => {
    const lines = parse(raw).lines
    const keys = bankTransactionKeys(ACCOUNT, lines)
    assert.equal(keys.size, 3)
    const [first, second] = [keys.get(2), keys.get(3)]
    assert.ok(first !== undefined && second !== undefined)
    assert.ok(first.endsWith('#1') && second.endsWith('#2'))
    assert.equal(first.replace(/#1$/, ''), second.replace(/#2$/, ''))
    assert.notEqual(bankTransactionKeys('other', lines).get(2), first)
    // Aynı dosya ikinci kez: anahtarlar aynıdır.
    assert.deepEqual(bankTransactionKeys(ACCOUNT, parse(raw).lines), keys)
  })

  test('durumlar: hazır, aktarılmış, giden, hareket değil, hatalı; toplam yalnız hazırdan', () => {
    const lines = parse(raw).lines
    const keys = bankTransactionKeys(ACCOUNT, lines)
    const known = new Set([keys.get(7)])
    const plan = planBankStatementImport(lines, keys, (key) => known.has(key))
    assert.deepEqual(
      plan.rows.map((row) => row.status),
      ['ready', 'ready', 'outgoing', 'ignored', 'invalid', 'skipped'],
    )
    assert.deepEqual(plan.counts, { ready: 2, skipped: 1, outgoing: 1, ignored: 1, invalid: 1 })
    assert.equal(plan.totalCents, 20_000)
    assert.deepEqual(
      plan.transactions.map((item) => [item.line, item.reference]),
      [
        [2, null],
        [3, null],
      ],
    )
  })
})
