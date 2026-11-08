import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertCustomerArchivable,
  assertTaxNumberFree,
  billableLines,
  corporateAttendanceCsv,
  corporateAttendanceRow,
  corporateCustomerSchema,
  corporateInvoiceCsv,
  corporateInvoiceNumber,
  corporateLineStatus,
  corporateReportTotals,
  isValidTaxNumber,
  linkCorporateEmployeeSchema,
  permilleLabel,
  planCorporateInvoice,
  planCorporateInvoiceCancel,
  planEmployeeEnd,
  planEmployeeLink,
  updateCorporateCustomerSchema,
  type CorporateEnrollmentSource,
  type CorporateInvoiceCandidate,
  type CorporateLink,
} from '../packages/school-core/src/lib/finance-corporate.ts'

import { isDomainError } from './support/domain-error.ts'

const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

// Kurumsal müşteri, çalışan bağı, toplu fatura ve katılım özeti (DOM-FIN-060, DOM-DIL-093, IST-089).

const PERIOD = { from: '2026-10-01', to: '2026-10-31' }
const link = (overrides: Partial<CorporateLink> = {}): CorporateLink => ({
  id: 'test-link-1',
  customerId: 'test-co-1',
  studentId: 'test-s1',
  startsOn: '2026-09-01',
  endsOn: null,
  ...overrides,
})
const invoice = (
  overrides: Partial<CorporateInvoiceCandidate> = {},
): CorporateInvoiceCandidate => ({
  id: 'test-inv-1',
  studentId: 'test-s1',
  rootContractId: 'test-contract-1',
  installment: 1,
  feeKind: 'tuition',
  dueDate: '2026-10-15',
  amountCents: 500_000,
  ...overrides,
})
const CUSTOMER = {
  name: 'Örnek Lojistik A.Ş.',
  taxNumber: '1234567890',
  taxOffice: 'Kadıköy',
  billingAddress: 'Moda Cad. No: 1 Kadıköy İstanbul',
}

test('DOM-FIN-060: VKN ve TCKN kontrol hanesi denetlenir', () => {
  assert.equal(isValidTaxNumber('1234567890'), true)
  assert.equal(isValidTaxNumber('0000000001'), true)
  assert.equal(isValidTaxNumber('1234567891'), false)
  assert.equal(isValidTaxNumber('10000000146'), true)
  assert.equal(isValidTaxNumber('10000000147'), false)
  assert.equal(isValidTaxNumber('00000000146'), false)
  assert.equal(isValidTaxNumber('123'), false)
})

test('DOM-FIN-060: müşteri şeması iletişim alanlarını boşsa null yapar, geçersiz VKN reddedilir', () => {
  const parsed = corporateCustomerSchema.parse(CUSTOMER)
  assert.deepEqual(
    [parsed.contactName, parsed.contactEmail, parsed.contactPhone],
    [null, null, null],
  )
  const bad = corporateCustomerSchema.safeParse({ ...CUSTOMER, taxNumber: '1234567891' })
  assert.equal(bad.success, false)
  assert.equal(bad.error?.issues[0]?.path[0], 'taxNumber')
  assert.equal(
    corporateCustomerSchema.safeParse({ ...CUSTOMER, contactPhone: '5321234567' }).success,
    false,
  )
  assert.equal(
    corporateCustomerSchema.safeParse({ ...CUSTOMER, institutionId: 'x' }).success,
    false,
  )
  assert.equal(updateCorporateCustomerSchema.safeParse({}).success, false)
  assert.equal(updateCorporateCustomerSchema.safeParse({ contactName: null }).success, true)
})

test('DOM-FIN-060: vergi numarası tekil, etkin çalışanı olan şirket arşivlenmez', () => {
  assert.doesNotThrow(() => assertTaxNumberFree(false))
  assert.throws(
    () => assertTaxNumberFree(true),
    isDomainError('corporate_tax_number_exists', 'conflict'),
  )
  assert.doesNotThrow(() => assertCustomerArchivable(0))
  assert.throws(
    () => assertCustomerArchivable(2),
    isDomainError('corporate_customer_has_employees'),
  )
})

test('DOM-DIL-093: bağ aydınlatma onayı ister', () => {
  const missing = linkCorporateEmployeeSchema.safeParse({
    studentId: 'test-s1',
    startsOn: '2026-10-01',
  })
  assert.equal(missing.success, false)
  assert.throws(
    () =>
      planEmployeeLink(
        { studentId: 'test-s1', startsOn: '2026-10-01', noticeConfirmed: false },
        { studentExists: true, links: [] },
      ),
    ZodError,
  )
})

test('DOM-FIN-060: kursiyerin tek etkin bağı olur, yeni bağ önceki bitişten sonra başlar', () => {
  const input = { studentId: 'test-s1', startsOn: '2026-10-01', noticeConfirmed: true }
  assert.deepEqual(planEmployeeLink(input, { studentExists: true, links: [] }), {
    studentId: 'test-s1',
    startsOn: '2026-10-01',
  })
  assert.throws(
    () => planEmployeeLink(input, { studentExists: false, links: [] }),
    isDomainError('student_not_found', 'not_found'),
  )
  assert.throws(
    () => planEmployeeLink(input, { studentExists: true, links: [link()] }),
    isDomainError('corporate_employee_linked', 'conflict'),
  )
  const ended = [link({ endsOn: '2026-10-01' }), link({ id: 'test-link-0', endsOn: '2026-06-30' })]
  assert.throws(
    () => planEmployeeLink(input, { studentExists: true, links: ended }),
    isDomainError('corporate_link_overlaps'),
  )
  assert.deepEqual(
    planEmployeeLink({ ...input, startsOn: '2026-10-02' }, { studentExists: true, links: ended }),
    { studentId: 'test-s1', startsOn: '2026-10-02' },
  )
})

test('DOM-FIN-060: bağ bitişi başlangıçtan önce olamaz, bitmiş bağ yeniden bitirilmez', () => {
  assert.deepEqual(planEmployeeEnd(link(), { endsOn: '2026-09-01' }), { endsOn: '2026-09-01' })
  assert.throws(
    () => planEmployeeEnd(link(), { endsOn: '2026-08-31' }),
    isDomainError('corporate_link_end_before_start'),
  )
  assert.throws(
    () => planEmployeeEnd(link({ endsOn: '2026-10-01' }), { endsOn: '2026-10-02' }),
    isDomainError('corporate_link_ended', 'conflict'),
  )
})

test('DOM-FIN-060: toplu fatura dönemde ve bağ içinde vadesi gelen taksitleri alır', () => {
  const invoices = [
    invoice(),
    invoice({ id: 'test-inv-2', installment: 2, dueDate: '2026-11-15' }),
    invoice({ id: 'test-inv-3', studentId: 'test-s2', dueDate: '2026-10-05' }),
    invoice({ id: 'test-inv-4', studentId: 'test-s3', dueDate: '2026-10-20' }),
    invoice({ id: 'test-inv-5', feeKind: 'stationery', installment: 3, dueDate: '2026-10-01' }),
  ]
  const links = [
    link(),
    // Bağ 10 Ekim'de başlar: 5 Ekim vadeli taksit şirketin değildir.
    link({ id: 'test-link-2', studentId: 'test-s2', startsOn: '2026-10-10' }),
    link({ id: 'test-link-3', studentId: 'test-s3', startsOn: '2026-09-01', endsOn: '2026-10-20' }),
  ]
  const lines = billableLines({ links, invoices, billed: [], period: PERIOD })
  assert.deepEqual(
    lines.map((line) => line.id),
    ['test-inv-5', 'test-inv-1', 'test-inv-4'],
  )
  assert.deepEqual(planCorporateInvoice({ period: PERIOD, lines }), {
    totalCents: 1_500_000,
    lineCount: 3,
  })
})

test('DOM-FIN-060: faturalanmış taksit ve ek protokolle yerine geleni yeniden girmez (K-52)', () => {
  const replacement = invoice({ id: 'test-inv-1b', amountCents: 450_000 })
  const other = invoice({ id: 'test-inv-6', rootContractId: null, installment: 1 })
  const lines = billableLines({
    links: [link()],
    invoices: [invoice(), replacement, other],
    billed: [{ invoiceId: 'test-inv-1', rootContractId: 'test-contract-1', installment: 1 }],
    period: PERIOD,
  })
  assert.deepEqual(
    lines.map((line) => line.id),
    ['test-inv-6'],
  )
  // Sözleşmesiz taksit yalnız kimliğiyle eşlenir.
  assert.deepEqual(
    billableLines({
      links: [link()],
      invoices: [other],
      billed: [{ invoiceId: 'test-inv-6', rootContractId: null, installment: 1 }],
      period: PERIOD,
    }),
    [],
  )
})

test('DOM-FIN-060: satırsız ya da geçersiz dönemli fatura kesilmez', () => {
  assert.throws(
    () => planCorporateInvoice({ period: PERIOD, lines: [] }),
    isDomainError('corporate_invoice_empty'),
  )
  assert.throws(
    () =>
      planCorporateInvoice({
        period: { from: '2026-11-01', to: '2026-10-01' },
        lines: [invoice()],
      }),
    isDomainError('export_period_invalid'),
  )
  assert.throws(
    () =>
      planCorporateInvoice({
        period: { from: '2025-01-01', to: '2026-10-01' },
        lines: [invoice()],
      }),
    isDomainError('export_period_too_long'),
  )
})

test('DOM-FIN-060: numara yıl içinde ardışık, iptal gerekçe ister ve bir kez olur', () => {
  assert.equal(corporateInvoiceNumber(2026, 7), 'KF-2026-0007')
  assert.equal(corporateInvoiceNumber(2026, 12_345), 'KF-2026-12345')
  assert.deepEqual(planCorporateInvoiceCancel({ cancelledAt: null }, { reason: 'Yanlış dönem' }), {
    reason: 'Yanlış dönem',
  })
  assert.throws(() => planCorporateInvoiceCancel({ cancelledAt: null }, { reason: 'x' }), ZodError)
  assert.throws(
    () =>
      planCorporateInvoiceCancel(
        { cancelledAt: '2026-10-06T09:00:00.000Z' },
        { reason: 'Yanlış dönem' },
      ),
    isDomainError('corporate_invoice_cancelled', 'conflict'),
  )
})

test('DOM-FIN-060: satır durumu taksitten hesaplanır', () => {
  assert.equal(corporateLineStatus({ archived: true, paid: true, allocatedCents: 10 }), 'cancelled')
  assert.equal(corporateLineStatus({ archived: false, paid: true, allocatedCents: 0 }), 'paid')
  assert.equal(corporateLineStatus({ archived: false, paid: false, allocatedCents: 1 }), 'partial')
  assert.equal(corporateLineStatus({ archived: false, paid: false, allocatedCents: 0 }), 'open')
})

test('DOM-FIN-060: döküm CSV satırları ve toplamı taşır, formül kaçışlıdır', () => {
  const csv = corporateInvoiceCsv({ number: 'KF-2026-0001', totalCents: 1_000_050 }, [
    {
      studentName: '=HYPERLINK("x")',
      installment: 1,
      feeKind: null,
      dueDate: '2026-10-15',
      amountCents: 1_000_050,
      status: 'partial',
    },
  ])
  const lines = csv.split('\r\n')
  assert.equal(lines.length, 3)
  assert.match(lines[1] ?? '', /"'=HYPERLINK\(""x""\)"/)
  assert.match(lines[1] ?? '', /10000,50;"Kısmi ödendi"$/)
  assert.match(lines[2] ?? '', /"Toplam".*10000,50/)
})

const enrollment = (
  overrides: Partial<CorporateEnrollmentSource> = {},
): CorporateEnrollmentSource => ({
  enrollmentId: 'test-enr-1',
  courseName: 'Genel İngilizce B1.1',
  level: 'B1',
  groupName: 'B1 Akşam',
  memberStatus: 'active',
  totalHours: 10,
  attendance: [
    ...Array.from({ length: 7 }, (_, index) => ({
      lessonHourId: `h${String(index)}`,
      status: 'present' as const,
    })),
    { lessonHourId: 'h7', status: 'absent' as const, excused: true },
  ],
  decisions: [],
  ...overrides,
})

test('DOM-DIL-093: katılım satırı yalnız saat, oran, devam şartı ve onaylı kur sonucunu verir', () => {
  const row = corporateAttendanceRow(
    enrollment({
      decisions: [
        { outcome: 'repeat', status: 'approved', decidedAt: '2026-10-01T09:00:00.000Z' },
        { outcome: 'passed', status: 'approved', decidedAt: '2026-10-02T09:00:00.000Z' },
        {
          outcome: 'incomplete_attendance',
          status: 'pending',
          decidedAt: '2026-10-03T09:00:00.000Z',
        },
      ],
    }),
  )
  assert.deepEqual(
    [row.recordedHours, row.attendedHours, row.absentHours, row.attendanceRatePermille],
    [8, 7, 1, 875],
  )
  assert.equal(row.outcome, 'passed')
  assert.equal(row.attendanceUnavailable, false)
  assert.ok(row.eligibility !== null)
  assert.equal('excused' in row, false)
  assert.equal(permilleLabel(row.attendanceRatePermille), '87,5')
  assert.equal(permilleLabel(null), '')
})

test('DOM-DIL-093: yoklamasız kayıtta oran yok, bozuk veride satır hesaplanamadı olur', () => {
  const empty = corporateAttendanceRow(enrollment({ attendance: [] }))
  assert.equal(empty.attendanceRatePermille, null)
  assert.equal(empty.outcome, null)
  const broken = corporateAttendanceRow(enrollment({ totalHours: 0 }))
  assert.equal(broken.attendanceUnavailable, true)
  assert.equal(broken.eligibility, null)
  const totals = corporateReportTotals([
    {
      studentId: 'test-s1',
      studentName: 'A',
      startsOn: '2026-09-01',
      enrollments: [empty, broken],
    },
    {
      studentId: 'test-s2',
      studentName: 'B',
      startsOn: '2026-09-01',
      enrollments: [corporateAttendanceRow(enrollment())],
    },
  ])
  assert.deepEqual(totals, {
    employeeCount: 2,
    enrollmentCount: 3,
    recordedHours: 8,
    attendedHours: 7,
    attendanceRatePermille: 875,
  })
  assert.equal(corporateReportTotals([]).attendanceRatePermille, null)
})

test('DOM-DIL-093: katılım CSV kur kaydı başına satır, kaydı olmayan çalışan boş satır', () => {
  const csv = corporateAttendanceCsv([
    { studentId: 'test-s1', studentName: 'Ada', startsOn: '2026-09-01', enrollments: [] },
    {
      studentId: 'test-s2',
      studentName: 'Can',
      startsOn: '2026-09-02',
      enrollments: [corporateAttendanceRow(enrollment({ totalHours: 0 }))],
    },
  ])
  const lines = csv.split('\r\n')
  assert.equal(lines.length, 3)
  assert.equal(lines[0]?.split(';').length, 13)
  assert.equal(lines[1]?.split(';').length, 13)
  assert.match(lines[2] ?? '', /"Hesaplanamadı";"Karar yok"$/)
})
