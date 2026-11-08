import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertBankTransactionIgnored,
  assertBankTransactionOpen,
  assertNoPossibleDuplicate,
  bankIgnoreSchema,
  bankMatchDirectory,
  bankMatchSchema,
  bankPaymentReference,
  suggestBankMatches,
  type MatchInvoiceInput,
} from '../packages/school-core/src/lib/finance-bank-matching.ts'

// Banka hareketi eşleştirme önerisi (IST-115, ON-099; DOM-FIN-069, K-108…K-111).

const invoice = (
  studentId: string,
  installment: number,
  openCents: number,
  dueDate = `2026-${String(8 + installment).padStart(2, '0')}-15T09:00:00.000Z`,
): MatchInvoiceInput => ({
  id: `test-inv-${studentId}-${String(installment)}`,
  studentId,
  installment,
  dueDate,
  openCents,
})

// Ayşe Yılmaz'ın iki çocuğu (Deniz, Ece) ve ilgisiz bir Yılmaz (Mert).
const directory = bankMatchDirectory({
  students: [
    { id: 's-deniz', name: 'Deniz Yılmaz', number: '2026001', nationalId: '10000000146' },
    { id: 's-ece', name: 'Ece Yılmaz', number: '2026002', nationalId: '20000000292' },
    { id: 's-mert', name: 'Mert Yılmaz', number: '2026003', nationalId: null },
    { id: 's-kaan', name: 'Kaan Demir', number: '2026004', nationalId: '30000000358' },
    { id: 's-paid', name: 'Selin Ak', number: '2026005', nationalId: '40000000414' },
  ],
  guardians: [
    { name: 'Ayşe Yılmaz', studentIds: ['s-deniz', 's-ece'] },
    { name: 'Tek', studentIds: ['s-kaan'] },
  ],
  contracts: [
    { id: 'test-contract-kaan', studentId: 's-kaan' },
    { id: 'short', studentId: 's-deniz' },
  ],
  invoices: [
    invoice('s-deniz', 1, 2_450_000),
    invoice('s-deniz', 2, 2_450_000),
    invoice('s-ece', 1, 2_000_000),
    invoice('s-mert', 1, 1_000_000),
    invoice('s-kaan', 1, 1_500_000),
    invoice('s-kaan', 2, 1_500_000),
    invoice('s-paid', 1, 0),
  ],
})

const suggest = (description: string, amountCents: number, counterparty?: string) =>
  suggestBankMatches(directory, { description, amountCents, counterparty })

describe('DOM-FIN-069: kimlik sinyalleri', () => {
  test('tam T.C. kimlik no + tutar eşitliği: tek aday, yüksek güven; kimlik çıktıya yazılmaz', () => {
    const [top, ...rest] = suggest('HAVALE TC 10000000146 EKIM', 2_450_000)
    assert.equal(rest.length, 0)
    assert.equal(top?.studentId, 's-deniz')
    assert.equal(top?.invoiceId, 'test-inv-s-deniz-1')
    assert.equal(top?.confidence, 'high')
    assert.deepEqual(top?.reasons, ['national_id', 'amount_exact'])
    assert.equal(top?.score, 90)
    assert.equal(JSON.stringify(top).includes('10000000146'), false)
  })

  test('DOM-FIN-069: boşluk, tire ya da noktayla gruplanmış kimlik no da tanınır; puan bitişik yazımla aynı', () => {
    const contiguous = suggest('HAVALE TC 10000000146 EKIM', 2_450_000)
    for (const written of ['100 000 001 46', '100-000-001-46', '100.000.001.46', '1000 0000 146'])
      assert.deepEqual(suggest(`HAVALE TC ${written} EKIM`, 2_450_000), contiguous, written)
    // Gruplanmış son haneler de son hane sinyalidir (6+ hane güçlü).
    const [suffix] = suggest('ODEME 000 146', 2_450_000)
    assert.deepEqual(suffix?.reasons, ['national_id_suffix', 'amount_exact'])
    assert.equal(suffix?.score, 75)
    // Öğrenci numarasının yanındaki tarih numarayı bozmaz; ayrı gruplar kendi başına okunur.
    const [byNumber] = suggest('OGR NO 2026004 01.10.2026', 1_500_000)
    assert.equal(byNumber?.studentId, 's-kaan')
    assert.ok(byNumber?.reasons.includes('student_number'))
  })

  test('kimlik no son haneleri: 6+ hane güçlü, 4 hane zayıf; yıl gibi görünen dört hane sayılmaz', () => {
    const [long] = suggest('ODEME 000146', 2_450_000)
    assert.deepEqual(long?.reasons, ['national_id_suffix', 'amount_exact'])
    assert.equal(long?.score, 75)
    const [short] = suggest('ODEME 0292', 2_000_000)
    assert.deepEqual(short?.reasons, ['national_id_suffix', 'amount_exact'])
    assert.equal(short?.score, 55)
    assert.equal(short?.confidence, 'medium')
    // 2026 bir yıldır; hiçbir kimliğe son hane sayılmaz, yalnız tutar eşleşmesine düşer.
    assert.ok(suggest('EKIM 2026 TAKSIT', 2_000_000).every((item) => item.confidence === 'low'))
  })

  test('öğrenci numarası, sözleşme kimliği ve ad soyadı (Türkçe harf duyarsız)', () => {
    const [byNumber] = suggest('OGR NO:2026004 TAKSIT', 1_500_000)
    assert.equal(byNumber?.studentId, 's-kaan')
    assert.ok(byNumber?.reasons.includes('student_number'))
    const [byContract] = suggest('SOZLESME TEST-CONTRACT-KAAN', 1_500_000)
    assert.deepEqual(byContract?.reasons, ['contract', 'amount_exact'])
    const [byName] = suggest('EFT DENİZ YILMAZ', 2_450_000)
    assert.deepEqual(byName?.reasons, ['student_name', 'amount_exact'])
    assert.equal(byName?.confidence, 'high')
  })

  test('veli adı iki çocuğu da aday yapar; tutar ya da ad ayrıştırmazsa yüksek güven verilmez', () => {
    const both = suggest('AYSE YILMAZ OKUL', 2_000_000)
    assert.deepEqual(
      both.map((item) => item.studentId),
      ['s-ece', 's-deniz'],
    )
    assert.equal(both[0]?.confidence, 'high')
    assert.deepEqual(both[0]?.reasons, ['guardian_name', 'surname', 'amount_exact'])
    assert.equal(both[1]?.confidence, 'medium')
    const unclear = suggest('AYSE YILMAZ OKUL', 500_000)
    assert.deepEqual(
      unclear.map((item) => [item.amountFit, item.confidence]),
      [
        ['partial', 'medium'],
        ['partial', 'medium'],
      ],
    )
    const named = suggest('AYSE YILMAZ', 2_000_000, 'ECE YILMAZ')
    assert.equal(named[0]?.studentId, 's-ece')
    assert.equal(named[0]?.confidence, 'high')
  })

  test('soyadı tek başına aday açmaz', () => {
    const result = suggest('YILMAZ AILESI', 1_000_000)
    assert.ok(result.every((item) => !item.reasons.includes('surname')))
    assert.ok(result.every((item) => item.confidence === 'low'))
  })
})

describe('DOM-FIN-030: tutar uyumu, kısmi ve fazla ödeme', () => {
  test('kısmi ödeme en eski açık taksite önerilir', () => {
    const [top] = suggest('TC 10000000146', 1_000_000)
    assert.equal(top?.amountFit, 'partial')
    assert.equal(top?.installment, 1)
    assert.equal(top?.creditCents, 0)
  })

  test('iki taksite eşit tutar `multiple`; açık taksitleri aşan kısım iade alacağı', () => {
    const [multiple] = suggest('TC 10000000146', 4_900_000)
    assert.equal(multiple?.amountFit, 'multiple')
    assert.equal(multiple?.studentOpenCents, 4_900_000)
    const [over] = suggest('TC 10000000146', 5_000_000)
    assert.equal(over?.amountFit, 'over')
    assert.equal(over?.creditCents, 100_000)
    const [between] = suggest('TC 10000000146', 3_000_000)
    assert.equal(between?.amountFit, 'over')
    assert.equal(between?.creditCents, 0)
  })

  test('kimlik sinyali yoksa tutarı eşit açık taksitler düşük güvenle önerilir', () => {
    const result = suggest('ACIKLAMASIZ', 1_500_000)
    assert.deepEqual(
      result.map((item) => [item.studentId, item.confidence, item.reasons]),
      [['s-kaan', 'low', ['amount_exact']]],
    )
    assert.deepEqual(suggest('ACIKLAMASIZ', 1), [])
  })

  test('açık taksiti olmayan öğrenci aday olmaz; sınır ve seçilen öğrenci', () => {
    assert.deepEqual(suggest('TC 40000000414', 100), [])
    assert.equal(
      suggestBankMatches(directory, { description: 'AYSE YILMAZ', amountCents: 1 }, { limit: 1 })
        .length,
      1,
    )
    const [chosen] = suggestBankMatches(
      directory,
      { description: 'ACIKLAMASIZ', amountCents: 1_000_000 },
      { onlyStudentId: 's-deniz' },
    )
    assert.equal(chosen?.studentId, 's-deniz')
    assert.equal(chosen?.confidence, 'low')
    assert.deepEqual(
      suggestBankMatches(
        directory,
        { description: 'X', amountCents: 1 },
        { onlyStudentId: 's-paid' },
      ),
      [],
    )
  })
})

describe('K-109, K-111: durum geçişi, referans ve gövdeler', () => {
  test('yalnız eşleşmemiş hareket eşleşir ya da yoksayılır; yalnız yoksayılan geri alınır', () => {
    assertBankTransactionOpen('unmatched')
    assertBankTransactionIgnored('ignored')
    for (const [run, code] of [
      [() => assertBankTransactionOpen('matched'), 'bank_transaction_not_open'],
      [() => assertBankTransactionOpen('ignored'), 'bank_transaction_not_open'],
      [() => assertBankTransactionIgnored('matched'), 'bank_transaction_not_ignored'],
      [() => assertBankTransactionIgnored('unmatched'), 'bank_transaction_not_ignored'],
    ] as const)
      assert.throws(
        run,
        (error: unknown) =>
          error instanceof DomainError && error.code === code && error.kind === 'conflict',
      )
  })

  test('tahsilat referansı banka referansıdır; yoksa parmak izinden kurulur', () => {
    const fingerprint = 'ab'.repeat(32)
    assert.equal(bankPaymentReference({ reference: ' EFT001 ', fingerprint }), 'EFT001')
    assert.equal(bankPaymentReference({ reference: 'R1', fingerprint }), 'EKSTRE-ABABABABABAB')
    assert.equal(bankPaymentReference({ reference: null, fingerprint }), 'EKSTRE-ABABABABABAB')
  })

  test('onay ve yoksayma gövdeleri katıdır', () => {
    assert.equal(bankMatchSchema.safeParse({ studentId: 's1', invoiceId: 'i1' }).success, true)
    assert.equal(
      bankMatchSchema.safeParse({ studentId: 's1', invoiceId: 'i1', amountCents: 1 }).success,
      false,
    )
    assert.equal(bankIgnoreSchema.safeParse({ ignoreReason: 'ab' }).success, false)
    assert.equal(bankIgnoreSchema.safeParse({ ignoreReason: 'Kira geliri' }).success, true)
  })
})

describe('K-121: onayda olası mükerrer', () => {
  test('aynı hesap, gün, tutar ve öğrenciye eşleşmiş başka hareket varsa açık onay ister', () => {
    assertNoPossibleDuplicate(0, false)
    assertNoPossibleDuplicate(1, true)
    assert.throws(
      () => assertNoPossibleDuplicate(1, false),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === 'bank_match_possible_duplicate' &&
        error.kind === 'conflict' &&
        error.message.includes('mükerrer'),
    )
  })

  test('onay gövdesi açık mükerrer onayını isteğe bağlı mantıksal değer olarak alır', () => {
    const body = { studentId: 's1', invoiceId: 'i1' }
    assert.deepEqual(bankMatchSchema.parse(body), body)
    assert.equal(bankMatchSchema.parse({ ...body, confirmDuplicate: true }).confirmDuplicate, true)
    assert.equal(bankMatchSchema.safeParse({ ...body, confirmDuplicate: 'evet' }).success, false)
  })
})
