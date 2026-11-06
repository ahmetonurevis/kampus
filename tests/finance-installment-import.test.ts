import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  applyInstallmentImport,
  INSTALLMENT_IMPORT_SAMPLE,
  parseInstallmentImport,
  planInstallmentImport,
  type InstallmentImportContext,
  type InstallmentImportRow,
  type InstallmentImportState,
} from '../packages/school-core/src/lib/finance-installment-import.ts'

// Pilot verisi aktarımı: taksitler (ON-061, IST-007; DOM-FIN-001, -010, -011, -012; ADR 0010).

const TC = '10000000146'

const state = (overrides: Partial<InstallmentImportState> = {}) =>
  ({
    students: [{ id: 's-1', name: 'Ece Demir', classId: 'c-1', parentId: 'p', isActive: true }],
    invoices: [],
    contracts: [],
    ...overrides,
  }) as InstallmentImportState

const context = (overrides: Partial<InstallmentImportContext> = {}): InstallmentImportContext => ({
  today: '2026-10-06',
  academicYear: 2026,
  identityHolders: new Map([[TC, 's-1']]),
  ...overrides,
})

let lineNo = 1
const row = (overrides: Partial<InstallmentImportRow> = {}): InstallmentImportRow => ({
  line: ++lineNo,
  identityNumber: TC,
  studentName: '',
  installment: '1',
  amountCents: '1250000',
  dueDate: '15.11.2026',
  paidDate: '',
  method: '',
  academicYear: '',
  extraCells: false,
  ...overrides,
})

const contract = (extra: object = {}) =>
  ({
    id: 'contract-1',
    studentId: 's-1',
    date: '2026-09-01T09:00:00.000Z',
    amount: 3_000_000,
    title: 'Sözleşme',
    invoiceIds: [],
    academicYear: 2026,
    ...extra,
  }) as InstallmentImportState['contracts'][number]

const invoice = (extra: object = {}) =>
  ({
    id: 'inv-1',
    studentId: 's-1',
    installment: 1,
    amount: 1_250_000,
    dueDate: '2026-11-15T09:00:00.000Z',
    paidAt: null,
    method: null,
    reminderAt: null,
    academicYear: 2026,
    ...extra,
  }) as InstallmentImportState['invoices'][number]

const codes = (plan: ReturnType<typeof planInstallmentImport>) =>
  plan.issues.map((issue) => issue.code)

describe('parseInstallmentImport (ON-061)', () => {
  test('örnek dosya ayrıştırılır, başlık zorunludur, satır sınırı 5.000', () => {
    const rows = parseInstallmentImport(INSTALLMENT_IMPORT_SAMPLE)
    assert.equal(rows.length, 2)
    assert.equal(rows[0]?.amountCents, '1250000')
    assert.throws(
      () => parseInstallmentImport('kimlik no;taksit no;tutar;vade\n1;1;1;2026-01-01'),
      (error: DomainError) => error.code === 'csv_unknown_column',
    )
    const header = 'kimlik no;taksit no;tutar kuruş;vade'
    assert.throws(
      () =>
        parseInstallmentImport(
          [header, ...Array.from({ length: 5001 }, () => '1;1;1;2026-01-01')].join('\n'),
        ),
      (error: DomainError) => error.code === 'csv_too_many_rows',
    )
  })
})

describe('planInstallmentImport (ON-061, DOM-FIN-001)', () => {
  test('core biçimi: vade 09:00Z, paidAt ve yöntem birlikte, yıl boşsa kurumun yılı', () => {
    const plan = planInstallmentImport(
      state(),
      [row({ paidDate: '01.10.2026', method: 'banka havalesi' })],
      context(),
    )
    assert.deepEqual(plan.issues, [])
    assert.deepEqual(plan.installments[0], {
      line: plan.rows[0]?.line,
      studentId: 's-1',
      installment: 1,
      amount: 1_250_000,
      dueDate: '2026-11-15T09:00:00.000Z',
      paidAt: '2026-10-01T09:00:00.000Z',
      method: 'Banka havalesi',
      academicYear: 2026,
      contractId: null,
    })
    assert.equal(plan.paidCents, 1_250_000)
    assert.equal(plan.totalCents, 1_250_000)
    assert.equal(plan.rows[0]?.identityMasked, '*******0146')
    assert.equal(plan.rows[0]?.notices[0]?.code, 'no_contract')
  })

  test('tutar yalnız pozitif tam kuruş; ondalık, sıfır, sınır üstü reddedilir', () => {
    for (const amountCents of ['12500,50', '12.500', '0', '-5', 'abc', '10000000001'])
      assert.deepEqual(
        codes(planInstallmentImport(state(), [row({ amountCents })], context())),
        ['amount_invalid'],
        amountCents,
      )
  })

  test('hücre sorunları ayrı madde ve ileti değer taşımaz', () => {
    const plan = planInstallmentImport(
      state(),
      [
        row({
          installment: '0',
          dueDate: 'dün',
          academicYear: 'geçen yıl',
          paidDate: 'x',
          method: 'Çek',
          extraCells: true,
        }),
      ],
      context(),
    )
    assert.deepEqual(codes(plan).sort(), [
      'academic_year_invalid',
      'due_date_invalid',
      'extra_cells',
      'installment_invalid',
      'paid_date_invalid',
      'payment_method_invalid',
    ])
    assert.equal(JSON.stringify(plan.issues).includes('geçen yıl'), false)
    assert.deepEqual(plan.installments, [])
    assert.equal(plan.totalCents, 0)
  })

  test('ödeme tarihi ve yöntemi birlikte; gelecek ödeme reddedilir', () => {
    assert.deepEqual(
      codes(planInstallmentImport(state(), [row({ paidDate: '01.10.2026' })], context())),
      ['payment_fields_incomplete'],
    )
    assert.deepEqual(codes(planInstallmentImport(state(), [row({ method: 'Nakit' })], context())), [
      'payment_fields_incomplete',
    ])
    assert.deepEqual(
      codes(
        planInstallmentImport(
          state(),
          [row({ paidDate: '07.10.2026', method: 'Nakit' })],
          context(),
        ),
      ),
      ['paid_date_future'],
    )
  })

  test('öğrenci kimlikten bulunur; bilinmeyen, ayrılmış ve ad uyuşmazlığı hatadır', () => {
    assert.deepEqual(
      codes(planInstallmentImport(state(), [row({ identityNumber: '999' })], context())),
      ['student_not_found'],
    )
    const passive = state({
      students: [
        { id: 's-1', name: 'Ece Demir', isActive: false },
      ] as InstallmentImportState['students'],
    })
    assert.deepEqual(codes(planInstallmentImport(passive, [row()], context())), [
      'student_inactive',
    ])
    assert.deepEqual(
      codes(planInstallmentImport(state(), [row({ studentName: 'Can Demir' })], context())),
      ['student_name_mismatch'],
    )
    assert.deepEqual(
      codes(planInstallmentImport(state(), [row({ studentName: 'ECE DEMİR' })], context())),
      [],
    )
  })

  test('dosyada aynı öğrenci, yıl ve taksit yinelenemez; başka yıl serbest', () => {
    const plan = planInstallmentImport(
      state(),
      [row(), row(), row({ academicYear: '2025-2026' })],
      context(),
    )
    assert.deepEqual(codes(plan), ['duplicate_installment'])
    assert.equal(plan.rows[2]?.academicYear, 2025)
    assert.equal(plan.rows[2]?.status, 'ready')
  })

  test('kayıtlı taksit: aynı koşul atlanır, farklı tutar, vade ya da ödeme hatadır (IST-007)', () => {
    const existing = state({ invoices: [invoice()] })
    const same = planInstallmentImport(existing, [row()], context())
    assert.equal(same.rows[0]?.status, 'skipped')
    assert.equal(same.rows[0]?.notices[0]?.code, 'already_imported')
    assert.deepEqual(same.installments, [])
    assert.deepEqual(
      codes(planInstallmentImport(existing, [row({ amountCents: '1' })], context())),
      ['installment_conflict'],
    )
    assert.deepEqual(
      codes(planInstallmentImport(existing, [row({ dueDate: '16.11.2026' })], context())),
      ['installment_conflict'],
    )
    assert.deepEqual(
      codes(
        planInstallmentImport(
          existing,
          [row({ paidDate: '01.10.2026', method: 'Nakit' })],
          context(),
        ),
      ),
      ['installment_paid_mismatch'],
    )
    const paid = state({
      invoices: [invoice({ paidAt: '2026-10-01T09:00:00.000Z', method: 'Nakit' })],
    })
    assert.deepEqual(codes(planInstallmentImport(paid, [row()], context())), [
      'installment_paid_mismatch',
    ])
  })

  test('yılsız eski taksit aynı numarada kayıtlı sayılır; başka yıldaki taksit sayılmaz', () => {
    const { academicYear: _year, ...legacy } = invoice()
    void _year
    const old = state({ invoices: [legacy] as InstallmentImportState['invoices'] })
    assert.equal(planInstallmentImport(old, [row()], context()).rows[0]?.status, 'skipped')
    const other = state({ invoices: [invoice({ academicYear: 2025 })] })
    assert.equal(planInstallmentImport(other, [row()], context()).rows[0]?.status, 'ready')
  })

  test('ADR 0010 cevap 3: tek sözleşmeye bağlanır; çok sözleşme, iptal ve yıl farkı', () => {
    const one = planInstallmentImport(state({ contracts: [contract()] }), [row()], context())
    assert.equal(one.installments[0]?.contractId, 'contract-1')
    assert.equal(one.rows[0]?.contractLinked, true)

    const legacy = planInstallmentImport(
      state({ contracts: [contract({ academicYear: undefined })] }),
      [row()],
      context(),
    )
    assert.equal(legacy.installments[0]?.contractId, 'contract-1')

    const two = planInstallmentImport(
      state({ contracts: [contract(), contract({ id: 'contract-2' })] }),
      [row()],
      context(),
    )
    assert.equal(two.installments[0]?.contractId, null)
    assert.equal(two.rows[0]?.notices[0]?.code, 'no_contract')

    const cancelled = planInstallmentImport(
      state({
        contracts: [
          contract(),
          contract({ id: 'contract-2', cancelledAt: '2026-09-02T09:00:00.000Z' }),
        ],
      }),
      [row()],
      context(),
    )
    assert.equal(cancelled.installments[0]?.contractId, 'contract-1')

    const year = planInstallmentImport(
      state({ contracts: [contract({ academicYear: 2025 })] }),
      [row()],
      context(),
    )
    assert.equal(year.installments[0]?.contractId, null)
  })

  test('DOM-FIN-010, -011: onaylı plana eklenmez, toplam aşılamaz, plandaki numara tekildir', () => {
    assert.deepEqual(
      codes(
        planInstallmentImport(
          state({ contracts: [contract({ approval: { plan: [] } })] }),
          [row()],
          context(),
        ),
      ),
      ['contract_approved'],
    )
    const withInvoice = state({
      contracts: [contract({ invoiceIds: ['inv-9'] })],
      invoices: [invoice({ id: 'inv-9', installment: 9, amount: 2_000_000, academicYear: 2025 })],
    })
    assert.deepEqual(
      codes(planInstallmentImport(withInvoice, [row({ amountCents: '1000001' })], context())),
      ['contract_total_exceeded'],
    )
    assert.deepEqual(
      codes(planInstallmentImport(withInvoice, [row({ amountCents: '1000000' })], context())),
      [],
    )
    assert.deepEqual(
      codes(
        planInstallmentImport(
          withInvoice,
          [row({ installment: '9', amountCents: '1000' })],
          context(),
        ),
      ),
      ['installment_conflict'],
    )
    const running = planInstallmentImport(
      state({ contracts: [contract()] }),
      [row({ amountCents: '2000000' }), row({ installment: '2', amountCents: '1000001' })],
      context(),
    )
    assert.deepEqual(codes(running), ['contract_total_exceeded'])
  })

  test('planlama durumu değiştirmez', () => {
    const before = state({ contracts: [contract()], invoices: [invoice({ installment: 5 })] })
    const copy = structuredClone(before)
    planInstallmentImport(before, [row(), row({ amountCents: 'x' })], context())
    assert.deepEqual(before, copy)
  })
})

describe('applyInstallmentImport (ON-061)', () => {
  let counter = 0
  const makeId = (prefix: string) => `${prefix}-${++counter}`

  test('taksit eklenir, bağlı sözleşmenin invoiceIds listesine girer', () => {
    const target = state({ contracts: [contract()] })
    const plan = planInstallmentImport(
      target,
      [row(), row({ installment: '2', paidDate: '01.10.2026', method: 'Nakit' })],
      context(),
    )
    const result = applyInstallmentImport(target, plan.installments, makeId)
    assert.deepEqual(result, { created: 2, linked: 2 })
    assert.equal(target.invoices.length, 2)
    assert.equal(target.invoices[0]?.contractId, 'contract-1')
    assert.equal(target.invoices[0]?.feeKind, 'tuition')
    assert.equal(target.invoices[0]?.reminderAt, null)
    assert.equal(target.invoices[1]?.method, 'Nakit')
    assert.deepEqual(
      target.contracts[0]?.invoiceIds,
      target.invoices.map((item) => item.id),
    )
  })

  test('listesi olmayan eski sözleşmede liste açılmaz; bağsız taksitte contractId yoktur', () => {
    const { invoiceIds: _ids, ...legacy } = contract()
    void _ids
    const target = state({ contracts: [legacy as InstallmentImportState['contracts'][number]] })
    const plan = planInstallmentImport(target, [row()], context())
    applyInstallmentImport(target, plan.installments, makeId)
    assert.equal(target.contracts[0]?.invoiceIds, undefined)
    assert.equal(target.invoices[0]?.contractId, 'contract-1')

    const bare = state()
    const planBare = planInstallmentImport(bare, [row()], context())
    assert.deepEqual(applyInstallmentImport(bare, planBare.installments, makeId), {
      created: 1,
      linked: 0,
    })
    assert.equal('contractId' in (bare.invoices[0] ?? {}), false)
  })
})
