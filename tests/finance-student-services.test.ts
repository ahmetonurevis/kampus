import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { requireAuthorized } from '../packages/school-core/src/lib/authorize.ts'
import type { FeeItem } from '../packages/school-core/src/lib/fee-tariffs.ts'
import {
  assertExtrasFreeOfServices,
  closeStudentServicesOnWithdrawal,
  planStudentServiceEnd,
  planStudentServiceSubscribe,
  STUDENT_SERVICE_KINDS,
  studentServiceBalance,
  studentServiceFormSchema,
  studentServiceFormToBody,
  type StudentServiceRow,
} from '../packages/school-core/src/lib/finance-student-services.ts'
import { isDomainError } from './support/domain-error.ts'

const NOW = '2026-10-06T09:00:00.000Z'
const TODAY = NOW.slice(0, 10)

function item(overrides: Partial<FeeItem> = {}): FeeItem {
  return {
    kind: 'transport',
    level: null,
    amountCents: 4_000_000,
    unit: 'year',
    vatBasisPoints: 1000,
    vatEffectiveDate: '2026-01-01',
    announcedAmountCents: null,
    ...overrides,
  }
}

const TARIFF = {
  id: 'tariff-1',
  versionNumber: 3,
  items: [
    item(),
    item({ kind: 'meal', amountCents: 500_000, unit: 'month' }),
    item({ kind: 'club', amountCents: 200_000, level: '99' }),
  ],
}

function fixture() {
  const state = createSeed(new Date(NOW))
  const student = state.students[0]!
  state.invoices = []
  state.contracts = []
  let next = 0
  return {
    state,
    studentId: student.id,
    context: {
      institutionType: 'school' as const,
      tariff: TARIFF,
      openKinds: [] as string[],
      makeId: (prefix: string) => `${prefix}-${String((next += 1))}`,
      now: NOW,
    },
  }
}

const input = (studentId: string, overrides: Record<string, unknown> = {}) => ({
  studentId,
  kind: 'transport',
  academicYear: 2026,
  startDate: '2026-10-01',
  ...overrides,
})

function rejectedWithout(
  state: ReturnType<typeof createSeed>,
  run: () => unknown,
  code: string,
  kind = 'rule',
) {
  const before = structuredClone(state.invoices)
  assert.throws(run, isDomainError(code, kind))
  assert.deepEqual(state.invoices, before)
}

test('DOM-FIN-003: ek hizmet öğrenimden ayrı, sözleşmesiz taksit olarak yayımlı tarifeden yazılır', () => {
  const { state, studentId, context } = fixture()
  const plan = planStudentServiceSubscribe(state, input(studentId), context)
  assert.deepEqual(
    {
      tariffId: plan.tariffId,
      tariffVersion: plan.tariffVersion,
      unit: plan.unit,
      amountCents: plan.amountCents,
      contractId: plan.contractId,
    },
    {
      tariffId: 'tariff-1',
      tariffVersion: 3,
      unit: 'year',
      amountCents: 4_000_000,
      contractId: null,
    },
  )
  assert.equal(state.invoices.length, 1)
  const invoice = state.invoices[0]!
  assert.equal(invoice.feeKind, 'transport')
  assert.equal(invoice.amount, 4_000_000)
  assert.equal(invoice.dueDate, '2026-10-01T09:00:00.000Z')
  assert.equal(invoice.academicYear, 2026)
  assert.equal(invoice.contractId, undefined)
  assert.deepEqual(plan.invoiceIds, [invoice.id])
})

test('DOM-FIN-003: aylık kalem bitişe kadar her ay taksit açar, bitişsiz reddedilir', () => {
  const { state, studentId, context } = fixture()
  rejectedWithout(
    state,
    () => planStudentServiceSubscribe(state, input(studentId, { kind: 'meal' }), context),
    'student_service_end_required',
  )
  const plan = planStudentServiceSubscribe(
    state,
    input(studentId, { kind: 'meal', startDate: '2026-10-31', endDate: '2027-01-15' }),
    context,
  )
  assert.equal(plan.unit, 'month')
  assert.deepEqual(
    state.invoices.map((invoice) => [invoice.installment, invoice.dueDate.slice(0, 10)]),
    [
      [1, '2026-10-31'],
      [2, '2026-11-30'],
      [3, '2026-12-31'],
    ],
  )
})

test('DOM-FIN-002: yayımlı tarife yoksa ya da kalem ilan edilmemişse taksit açılmaz', () => {
  const { state, studentId, context } = fixture()
  rejectedWithout(
    state,
    () => planStudentServiceSubscribe(state, input(studentId), { ...context, tariff: null }),
    'tariff_not_published',
    'rule',
  )
  rejectedWithout(
    state,
    () => planStudentServiceSubscribe(state, input(studentId, { kind: 'breakfast' }), context),
    'extra_not_in_tariff',
    'rule',
  )
  // Yalnız başka düzeye ilan edilmiş kalem bu öğrenciye uygulanmaz.
  rejectedWithout(
    state,
    () => planStudentServiceSubscribe(state, input(studentId, { kind: 'club' }), context),
    'extra_not_in_tariff',
    'rule',
  )
})

test('ON-087: tarih ve öğrenci denetimleri kayıt değiştirmeden reddeder', () => {
  const { state, studentId, context } = fixture()
  rejectedWithout(
    state,
    () =>
      planStudentServiceSubscribe(state, input(studentId, { startDate: '2020-01-01' }), context),
    'student_service_date_outside_year',
  )
  rejectedWithout(
    state,
    () => planStudentServiceSubscribe(state, input(studentId, { endDate: '2020-01-01' }), context),
    'student_service_date_outside_year',
  )
  rejectedWithout(
    state,
    () => planStudentServiceSubscribe(state, input(studentId, { endDate: '2026-09-01' }), context),
    'student_service_end_before_start',
  )
  rejectedWithout(
    state,
    () => planStudentServiceSubscribe(state, input('yok'), context),
    'student_not_found',
    'not_found',
  )
  state.students[0]!.isActive = false
  rejectedWithout(
    state,
    () => planStudentServiceSubscribe(state, input(studentId), context),
    'student_service_student_inactive',
    'conflict',
  )
  // Şemada olmayan tür (kitap tek seferliktir, abonelik açmaz).
  assert.ok(!STUDENT_SERVICE_KINDS.some((kind) => kind === ('stationery' as string)))
  assert.throws(() =>
    planStudentServiceSubscribe(state, input(studentId, { kind: 'stationery' }), context),
  )
})

test('DOM-FIN-003: aynı öğrenci ve türde tek açık abonelik', () => {
  const { state, studentId, context } = fixture()
  rejectedWithout(
    state,
    () =>
      planStudentServiceSubscribe(state, input(studentId), {
        ...context,
        openKinds: ['transport'],
      }),
    'student_service_open',
    'conflict',
  )
})

test('DOM-FIN-003: aynı yılın sözleşmesindeki ek hizmet ikinci borç açtırmaz', () => {
  const { state, studentId, context } = fixture()
  state.contracts = [
    {
      id: 'c-1',
      studentId,
      academicYear: 2026,
      date: NOW,
      amount: 100,
      title: 'Sözleşme',
      invoiceIds: [],
      extras: [{ kind: 'transport', amountCents: 100 }],
    },
  ]
  rejectedWithout(
    state,
    () => planStudentServiceSubscribe(state, input(studentId), context),
    'student_service_on_contract',
    'conflict',
  )
  // Başka yılın sözleşmesi ve iptal edilen sürüm çakışma sayılmaz.
  state.contracts[0]!.academicYear = 2025
  assert.equal(planStudentServiceSubscribe(state, input(studentId), context).contractId, null)
  state.invoices = []
  state.contracts[0]!.academicYear = 2026
  state.contracts[0]!.cancelledAt = NOW
  assert.equal(planStudentServiceSubscribe(state, input(studentId), context).contractId, null)
})

test('DOM-FIN-010: yürürlükteki sözleşme kaynak olarak gösterilir, onaylı sözleşme değişmez', () => {
  const { state, studentId, context } = fixture()
  const approved = {
    id: 'c-1',
    studentId,
    academicYear: 2026,
    date: '2026-01-01T09:00:00.000Z',
    amount: 100,
    title: 'Sözleşme',
    invoiceIds: ['i-1'],
    approval: {
      method: 'wet_signature' as const,
      approvedAt: NOW,
      approvedByUserId: 'u',
      payerName: 'Veli',
      plan: [],
    },
  }
  state.contracts = [approved]
  const before = structuredClone(approved)
  const plan = planStudentServiceSubscribe(state, input(studentId), context)
  assert.equal(plan.contractId, 'c-1')
  assert.deepEqual(state.contracts[0], before)
  assert.equal(state.invoices[0]!.contractId, undefined)
  // Onaysız ek protokol yürürlükte değildir; önceki sürüm kaynak kalır.
  state.invoices = []
  state.contracts.push({
    ...before,
    id: 'c-2',
    date: NOW,
    amendsContractId: 'c-1',
    approval: undefined,
  })
  assert.equal(planStudentServiceSubscribe(state, input(studentId), context).contractId, 'c-1')
})

function subscribed(kind: 'transport' | 'meal', endDate: string | null = null) {
  const fixed = fixture()
  const plan = planStudentServiceSubscribe(
    fixed.state,
    input(fixed.studentId, {
      kind,
      startDate: '2026-09-01',
      endDate,
    }),
    fixed.context,
  )
  const service: StudentServiceRow = {
    id: 'svc-1',
    studentId: fixed.studentId,
    kind,
    academicYear: 2026,
    startDate: plan.startDate,
    endDate: plan.endDate,
    status: 'active',
    invoiceIds: plan.invoiceIds,
  }
  return { ...fixed, plan, service }
}

test('DOM-FIN-040: çıkışta ileri vadeli ödenmemiş taksit iptal edilir, ödenen ve geçmiş kalır', () => {
  const { state, service, plan } = subscribed('meal', '2026-12-31')
  const [september, october, november, december] = plan.invoiceIds
  state.invoices.find((invoice) => invoice.id === december)!.paidAt = NOW
  state.invoices.find((invoice) => invoice.id === december)!.method = 'Nakit'
  const closure = planStudentServiceEnd(
    state,
    service,
    { endedDate: '2026-10-05' },
    {
      // Kasım taksitine kısmi tahsilat var: taksit kalır (iade otomatik değildir).
      allocated: new Map([[november!, 100]]),
      today: TODAY,
    },
  )
  assert.equal(closure.endedDate, '2026-10-05')
  assert.deepEqual(closure.cancelledInvoiceIds, [])
  assert.deepEqual(
    state.invoices.map((invoice) => invoice.id),
    [september, october, november, december],
  )
  const fresh = subscribed('meal', '2026-12-31')
  const done = planStudentServiceEnd(
    fresh.state,
    fresh.service,
    { endedDate: '2026-10-05' },
    { allocated: new Map(), today: TODAY },
  )
  assert.deepEqual(done.cancelledInvoiceIds, fresh.plan.invoiceIds.slice(2))
  assert.equal(fresh.state.invoices.length, 2)
})

test('ON-087: çıkış denetimleri kayıt değiştirmeden reddeder', () => {
  const { state, service } = subscribed('transport')
  const context = { allocated: new Map<string, number>(), today: TODAY }
  rejectedWithout(
    state,
    () => planStudentServiceEnd(state, service, { endedDate: '2026-12-01' }, context),
    'student_service_end_in_future',
  )
  rejectedWithout(
    state,
    () => planStudentServiceEnd(state, service, { endedDate: '2026-08-01' }, context),
    'student_service_end_before_start',
  )
  rejectedWithout(
    state,
    () =>
      planStudentServiceEnd(state, { ...service, status: 'ended' }, { endedDate: TODAY }, context),
    'student_service_ended',
    'conflict',
  )
})

test('DOM-KAY-024: ayrılışta açık abonelikler kapanır; başlamamış aboneliğin taksiti kalmaz', () => {
  const { state, service, plan, studentId, context } = subscribed('meal', '2026-12-31')
  const later = planStudentServiceSubscribe(
    state,
    input(studentId, { startDate: '2026-11-15' }),
    context,
  )
  const ended = { ...service, id: 'svc-ended', status: 'ended' as const, invoiceIds: [] }
  const closures = closeStudentServicesOnWithdrawal(
    state,
    [
      service,
      ended,
      {
        ...service,
        id: 'svc-later',
        kind: 'transport',
        startDate: later.startDate,
        endDate: null,
        invoiceIds: later.invoiceIds,
      },
    ],
    '2026-10-05',
    new Map(),
  )
  assert.deepEqual(
    closures.map((closure) => [closure.serviceId, closure.endedDate]),
    [
      ['svc-1', '2026-10-05'],
      // Kayıt bitişi başlangıçtan önce olamaz; taksit yine iptal edilir.
      ['svc-later', '2026-11-15'],
    ],
  )
  assert.deepEqual(closures[1]!.cancelledInvoiceIds, later.invoiceIds)
  assert.deepEqual(
    state.invoices.map((invoice) => invoice.id),
    plan.invoiceIds.slice(0, 2),
  )
})

test('DOM-FIN-003: yenilemedeki ek hizmet açık abonelikle çakışırsa reddedilir', () => {
  assert.doesNotThrow(() => assertExtrasFreeOfServices([{ kind: 'meal' }], ['transport']))
  assert.throws(
    () => assertExtrasFreeOfServices([{ kind: 'meal' }], ['meal']),
    isDomainError('renewal_extra_has_service', 'conflict'),
  )
})

test('DOM-FIN-040: özet tutarı hesaplar, kullanılmamış dönemde karar ister ve iade yazmaz', () => {
  const line = (id: string, dueDate: string, overrides = {}) => ({
    id,
    amount: 1000,
    dueDate: `${dueDate}T09:00:00.000Z`,
    paidAt: null,
    cancelled: false,
    ...overrides,
  })
  const monthly = {
    status: 'ended' as const,
    unit: 'month' as const,
    endDate: '2026-12-31',
    endedDate: '2026-10-05',
  }
  // Çıkıştan önceki taksit kullanılan dönemdir; iptal edilen taksit toplama girmez.
  assert.deepEqual(
    studentServiceBalance(
      monthly,
      [line('a', '2026-10-01', { paidAt: NOW }), line('b', '2026-11-01', { cancelled: true })],
      new Map(),
    ),
    { billedCents: 1000, paidCents: 1000, openCents: 0, refundDecisionRequired: false },
  )
  // Çıkıştan sonrasına ait ödenmiş taksit kaldıysa karar gerekir.
  assert.deepEqual(
    studentServiceBalance(monthly, [line('c', '2026-11-01')], new Map([['c', 300]])),
    { billedCents: 1000, paidCents: 300, openCents: 700, refundDecisionRequired: true },
  )
  const single = { ...monthly, unit: 'year' as const, endDate: null }
  assert.equal(
    studentServiceBalance(single, [line('d', '2026-09-01')], new Map()).refundDecisionRequired,
    true,
  )
  // Süresinde biten ya da açık abonelikte karar yoktur.
  assert.equal(
    studentServiceBalance(
      { ...single, endDate: '2026-10-05' },
      [line('e', '2026-09-01')],
      new Map(),
    ).refundDecisionRequired,
    false,
  )
  assert.equal(
    studentServiceBalance(
      { status: 'active', unit: 'year', endDate: null, endedDate: null },
      [line('f', '2026-09-01')],
      new Map(),
    ).refundDecisionRequired,
    false,
  )
})

test('ON-087: yalnız yönetici ve ön büro yazar; veli, öğrenci ve öğretmen reddedilir', () => {
  const state = createSeed(new Date(NOW))
  const denied = ['veli', 'ogrenci', 'ogretmen'] as const
  for (const role of ['yonetici', 'onburo'] as const)
    assert.doesNotThrow(() =>
      requireAuthorized({ role, links: [] }, 'studentService.manage', {}, state, {
        now: NOW,
        institutionType: 'school',
      }),
    )
  for (const role of denied)
    assert.throws(() =>
      requireAuthorized({ role, links: [] }, 'studentService.manage', {}, state, {
        now: NOW,
        institutionType: 'school',
      }),
    )
})

test('ON-087: form değeri uç gövdesine çevrilir, boş bitiş `null` olur', () => {
  const values = studentServiceFormSchema.parse({
    kind: 'club',
    academicYear: 2026,
    startDate: '2026-10-01',
    endDate: '',
  })
  assert.deepEqual(studentServiceFormToBody('s1', values), {
    studentId: 's1',
    kind: 'club',
    academicYear: 2026,
    startDate: '2026-10-01',
    endDate: null,
  })
  assert.equal(
    studentServiceFormToBody('s1', { ...values, endDate: '2026-12-01' }).endDate,
    '2026-12-01',
  )
})
