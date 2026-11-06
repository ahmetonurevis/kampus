import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type {
  InstallmentImportRowResult,
  StudentImportRowResult,
} from '@kampus/react-shared/enrollment-imports.ts'
import {
  bytesToBase64,
  importFileProblem,
  installmentImportRow,
  installmentImportSummary,
  INSTALLMENT_SAMPLE_CSV,
  statusTone,
  STUDENT_SAMPLE_CSV,
  studentImportRow,
  studentImportSummary,
  withRowIssues,
} from '../src/pages/crm/enrollment-import-rows.ts'

// Pilot aktarımı penceresinin saf modeli (ON-060, ON-061, IST-007).

const studentRow = (extra: Partial<StudentImportRowResult> = {}): StudentImportRowResult => ({
  line: 2,
  status: 'ready',
  name: 'Ece Demir',
  className: '7-A',
  campus: 'Moda',
  identityMasked: '*******0146',
  guardianName: 'Ayla Demir',
  guardianPhoneMasked: '0532 *** ** 01',
  relationship: 'mother',
  guardianMatch: 'new',
  issues: [],
  notices: [],
  ...extra,
})

const installmentRow = (
  extra: Partial<InstallmentImportRowResult> = {},
): InstallmentImportRowResult => ({
  line: 2,
  status: 'ready',
  studentName: 'Ece Demir',
  identityMasked: '*******0146',
  installment: 1,
  amountCents: 1_250_000,
  dueDate: '2026-11-15',
  paidDate: null,
  method: null,
  academicYear: 2026,
  contractLinked: false,
  issues: [],
  notices: [],
  ...extra,
})

const counts = { rowCount: 3, readyCount: 2, skippedCount: 1, invalidCount: 0 }

describe('aktarım dosyası (IST-007)', () => {
  test('dosya türü ve boyutu denetlenir', () => {
    assert.equal(importFileProblem({ name: 'liste.XLSX', size: 10 }), null)
    assert.equal(importFileProblem({ name: 'liste.csv', size: 10 }), null)
    assert.match(importFileProblem({ name: 'liste.xls', size: 10 }) ?? '', /5 MB/)
    assert.match(importFileProblem({ name: 'liste.csv', size: 0 }) ?? '', /5 MB/)
    assert.match(importFileProblem({ name: 'liste.csv', size: 6 * 1024 * 1024 }) ?? '', /5 MB/)
  })

  test('base64 büyük dosyada da doğru (yığın taşmaz)', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 251)
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'))
  })

  test('örnek dosyalar BOM ile başlar, Excel Türkçe harfleri doğru açar', () => {
    assert.ok(STUDENT_SAMPLE_CSV.startsWith('\uFEFFöğrenci adı;'))
    assert.ok(INSTALLMENT_SAMPLE_CSV.startsWith('\uFEFFkimlik no;'))
  })
})

describe('önizleme satırları (ON-060, ON-061)', () => {
  test('öğrenci satırı: sınıf kampüsle, yakınlık etikete, yetişkin kursiyer ayrı', () => {
    const row = studentImportRow(studentRow())
    assert.equal(row.classLabel, '7-A · Moda')
    assert.equal(row.relationshipLabel, 'Anne')
    assert.equal(row.status, 'Hazır')
    const adult = studentImportRow(
      studentRow({ guardianMatch: 'self', relationship: null, guardianName: '', campus: '' }),
    )
    assert.equal(adult.guardian, 'Kursiyerin kendisi')
    assert.equal(adult.relationshipLabel, '')
    assert.equal(adult.classLabel, '7-A')
  })

  test('taksit satırı: tutar TL, ödeme durumu, sözleşme bağı', () => {
    const open = installmentImportRow(installmentRow())
    assert.match(open.amount, /^12\.500,00\s₺$/)
    assert.equal(open.paid, 'Açık')
    assert.equal(open.contract, 'Sözleşmesiz')
    const paid = installmentImportRow(
      installmentRow({ paidDate: '2026-10-01', method: 'Açılış aktarımı', contractLinked: true }),
    )
    assert.match(paid.paid, /2026 · Açılış aktarımı$/)
    assert.match(paid.due, /2026$/)
    assert.equal(paid.contract, 'Bağlanacak')
    const bad = installmentImportRow(
      installmentRow({
        status: 'invalid',
        amountCents: null,
        dueDate: null,
        installment: null,
        studentName: null,
        issues: [
          { line: 2, field: 'amountCents', code: 'amount_invalid', message: 'Tutar hatalı' },
        ],
      }),
    )
    assert.equal(bad.amount, '')
    assert.equal(bad.status, 'Hatalı')
    assert.equal(bad.contract, '')
    assert.deepEqual(bad.problems, ['Tutar hatalı'])
  })

  test('onayın satır hataları ilgili satıra yazılır', () => {
    const rows = [studentImportRow(studentRow()), studentImportRow(studentRow({ line: 3 }))]
    const after = withRowIssues(rows, [
      { line: 3, field: 'className', code: 'class_capacity_full', message: 'Kontenjan dolu' },
    ])
    assert.equal(after[0]?.status, 'Hazır')
    assert.equal(after[1]?.status, 'Hatalı')
    assert.deepEqual(after[1]?.problems, ['Kontenjan dolu'])
    assert.match(after[1]?.noteText ?? '', /Kontenjan dolu/)
  })

  test('durum tonu ve özet sayıları', () => {
    assert.equal(statusTone('Hazır'), 'green')
    assert.equal(statusTone('Hatalı'), 'red')
    assert.equal(statusTone('Atlanacak'), 'gray')
    assert.equal(
      studentImportSummary({
        ...counts,
        dryRun: true,
        newGuardianCount: 1,
        existingGuardianCount: 1,
        rows: [],
      }),
      '3 satır · 2 öğrenci yazılacak · 1 zaten kayıtlı, atlanacak · 1 yeni veli, 1 mevcut veli',
    )
    const summary = installmentImportSummary({
      ...counts,
      dryRun: true,
      linkedCount: 1,
      totalCents: 250_000,
      paidCents: 0,
      rows: [],
    })
    assert.match(summary, /toplam 2\.500,00/)
    assert.match(summary, /1 taksit sözleşmeye bağlanacak/)
    assert.equal(
      installmentImportSummary({
        ...counts,
        invalidCount: 1,
        dryRun: true,
        linkedCount: 0,
        totalCents: 0,
        paidCents: 0,
        rows: [],
      }).includes('toplam'),
      false,
    )
  })
})
