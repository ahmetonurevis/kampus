import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { authorize } from '../packages/school-core/src/lib/authorize.ts'
import {
  amendContract,
  amendContractSchema,
  approveContract,
  cancelContractAmendment,
  setContractSignatory,
  type AmendContractContext,
  type ApproveContractContext,
} from '../packages/school-core/src/lib/contract-approval.ts'
import {
  contractPlanLines,
  contractStatus,
  isContractInForce,
} from '../packages/school-core/src/lib/contract-status.ts'
import {
  CONTRACT_NOTIFICATION_TYPES,
  contractPayerIsGuardian,
} from '../packages/school-core/src/lib/finance-notifications.ts'
import {
  isPayerNotificationKind,
  type GuardianLink,
} from '../packages/school-core/src/lib/guardianship.ts'
import { quoteWithdrawal, withdrawStudent } from '../packages/school-core/src/lib/withdrawals.ts'
import {
  notificationAudiences,
  notificationSubject,
  notificationTitle,
} from '../packages/school-core/src/lib/notifications.ts'
import { NOTIFICATION_TYPES } from '../packages/school-core/src/modules/notification-types.ts'
import { isDomainError } from './support/domain-error.ts'

const NOW = '2026-10-06T09:00:00.000Z'
const SIGNATORY = { name: 'Murat Kurucu', role: 'founder' } as const
const ACCEPT = { accepted: true }
const AMEND = {
  reason: 'Ödeme planı yeniden düzenlendi.',
  installmentCount: 3,
  firstDueDate: '2026-11-15',
}
const TARIFF = {
  id: 'tariff-1',
  versionNumber: 2,
  items: [],
  discounts: [
    { kind: 'sibling', percentBasisPoints: 1_000, amountCents: null },
    { kind: 'early_registration', percentBasisPoints: null, amountCents: 500_000 },
    { kind: 'staff_child', percentBasisPoints: 6_000, amountCents: null },
  ],
} as unknown as AmendContractContext['tariff']

function fixture() {
  const state = createSeed(new Date(NOW))
  const student = state.students[0]!
  const invoice = (id: string, installment: number, amount: number, feeKind = 'tuition') => ({
    id,
    studentId: student.id,
    installment,
    amount,
    dueDate: `2026-${String(9 + installment).padStart(2, '0')}-15T09:00:00.000Z`,
    paidAt: null as string | null,
    method: null as string | null,
    reminderAt: null,
    feeKind,
  })
  state.invoices = [
    invoice('t-1', 1, 4_000_000),
    invoice('t-2', 2, 3_000_000),
    invoice('t-3', 3, 3_000_000),
    invoice('t-meal', 4, 1_000_000, 'meal'),
  ]
  state.contracts = [
    {
      id: 'contract-1',
      studentId: student.id,
      date: '2026-09-01T09:00:00.000Z',
      amount: 11_000_000,
      title: 'Özel okul eğitim sözleşmesi',
      invoiceIds: ['t-1', 't-2', 't-3', 't-meal'],
      academicYear: 2026,
      tariffId: 'tariff-1',
      tariffVersion: 2,
      grossCents: 10_000_000,
      netCents: 10_000_000,
      discounts: [],
      extras: [{ kind: 'meal', amountCents: 1_000_000 }],
      approvedByUserId: 'u-admin',
      payer: 'guardian',
    },
  ]
  state.renewals = []
  return { state, student }
}

const payerBond = (studentId: string, membershipId: string): GuardianLink => ({
  id: 'bond-1',
  studentId,
  parentId: 'p1',
  membershipId,
  relationship: 'mother',
  custody: 'full',
  contactRestricted: false,
  isPayer: true,
  canPickUp: true,
})

let counter = 0
const makeId = (prefix: string) => {
  counter += 1
  return `${prefix}-new-${String(counter)}`
}

const approver = (overrides: Partial<ApproveContractContext> = {}): ApproveContractContext => ({
  role: 'onburo',
  userId: 'u-desk',
  membershipId: 'm-desk',
  guardians: [],
  allocated: new Map(),
  now: NOW,
  makeId,
  ...overrides,
})
const amender = (overrides: Partial<AmendContractContext> = {}): AmendContractContext => ({
  tariff: null,
  canApproveCapException: false,
  allocated: new Map(),
  userId: 'u-desk',
  now: NOW,
  makeId,
  ...overrides,
})

function approved() {
  const { state, student } = fixture()
  setContractSignatory(state, 'contract-1', SIGNATORY, { userId: 'u-admin', now: NOW })
  approveContract(state, 'contract-1', ACCEPT, approver())
  return { state, student, contract: state.contracts[0]! }
}

test('IST-092, DOM-FIN-010: onay imza yetkilisi ister, zamanı ve planı saklar', () => {
  const { state } = fixture()
  const before = structuredClone(state)
  assert.throws(
    () => approveContract(state, 'contract-1', ACCEPT, approver()),
    isDomainError('contract_signatory_required', 'rule'),
  )
  assert.deepEqual(state, before)

  const signed = setContractSignatory(state, 'contract-1', SIGNATORY, {
    userId: 'u-admin',
    now: NOW,
  })
  assert.equal(signed.signatory?.role, 'founder')
  assert.equal(contractStatus(signed, state.contracts), 'awaiting_approval')

  const contract = approveContract(state, 'contract-1', ACCEPT, approver())
  assert.equal(contract.approval?.method, 'wet_signature')
  assert.equal(contract.approval?.approvedAt, NOW)
  assert.equal(contract.approval?.approvedByUserId, 'u-desk')
  assert.equal(contract.approval?.payerName, 'Ayşe Yılmaz')
  assert.deepEqual(
    contract.approval?.plan.map((line) => [line.invoiceId, line.amount]),
    [
      ['t-1', 4_000_000],
      ['t-2', 3_000_000],
      ['t-3', 3_000_000],
      ['t-meal', 1_000_000],
    ],
  )
  assert.equal(contractStatus(contract, state.contracts), 'approved')
})

test('IST-092: kabul işareti olmadan onay verilmez, kayıt değişmez', () => {
  const { state } = fixture()
  setContractSignatory(state, 'contract-1', SIGNATORY, { userId: 'u-admin', now: NOW })
  const before = structuredClone(state)
  assert.throws(() => approveContract(state, 'contract-1', { accepted: false }, approver()))
  assert.throws(() => approveContract(state, 'contract-1', {}, approver()))
  assert.deepEqual(state, before)
})

test('IST-092, DOM-FIN-010: onaylı sözleşmede imza yetkilisi ve ikinci onay reddedilir', () => {
  const { state } = approved()
  const before = structuredClone(state)
  assert.throws(
    () => approveContract(state, 'contract-1', ACCEPT, approver()),
    isDomainError('contract_already_approved', 'conflict'),
  )
  assert.throws(
    () => setContractSignatory(state, 'contract-1', SIGNATORY, { userId: 'u-admin', now: NOW }),
    isDomainError('contract_already_approved', 'conflict'),
  )
  assert.deepEqual(state, before)
})

test('IST-092: imza yetkilisi onaya kadar düzeltilir; olmayan sözleşme bulunamaz', () => {
  const { state } = fixture()
  setContractSignatory(state, 'contract-1', SIGNATORY, { userId: 'u-admin', now: NOW })
  const fixed = setContractSignatory(
    state,
    'contract-1',
    { name: 'Selim Temsilci', role: 'founder_representative' },
    { userId: 'u-admin', now: NOW },
  )
  assert.equal(fixed.signatory?.role, 'founder_representative')
  assert.throws(
    () => setContractSignatory(state, 'yok', SIGNATORY, { userId: 'u-admin', now: NOW }),
    isDomainError('contract_not_found', 'not_found'),
  )
  assert.throws(() =>
    setContractSignatory(
      state,
      'contract-1',
      { ...SIGNATORY, role: 'manager' },
      {
        userId: 'u-admin',
        now: NOW,
      },
    ),
  )
})

test('IST-092, DOM-FIN-052: veli yalnız ödeyiciyse elektronik onay verir', () => {
  const { state, student } = fixture()
  setContractSignatory(state, 'contract-1', SIGNATORY, { userId: 'u-admin', now: NOW })
  const asParent = (guardians: readonly GuardianLink[]) =>
    approver({ role: 'veli', userId: 'u-parent', membershipId: 'm-parent', guardians })

  assert.throws(
    () => approveContract(state, 'contract-1', ACCEPT, asParent([])),
    isDomainError('contract_payer_only', 'forbidden'),
  )
  assert.throws(
    () =>
      approveContract(
        state,
        'contract-1',
        ACCEPT,
        asParent([payerBond(student.id, 'm-other-parent')]),
      ),
    isDomainError('contract_payer_only', 'forbidden'),
  )
  const contract = approveContract(
    state,
    'contract-1',
    ACCEPT,
    asParent([payerBond(student.id, 'm-parent')]),
  )
  assert.equal(contract.approval?.method, 'electronic')
  assert.equal(contract.approval?.approvedByUserId, 'u-parent')
})

test('DOM-KAY-012, IST-092: yetişkin kursiyer sözleşmesini veli onaylayamaz, görevli işler', () => {
  const { state, student } = fixture()
  state.contracts[0]!.payer = 'student'
  setContractSignatory(state, 'contract-1', SIGNATORY, { userId: 'u-admin', now: NOW })
  assert.throws(
    () =>
      approveContract(
        state,
        'contract-1',
        ACCEPT,
        approver({
          role: 'veli',
          membershipId: 'm-parent',
          guardians: [payerBond(student.id, 'm-parent')],
        }),
      ),
    isDomainError('contract_payer_only', 'forbidden'),
  )
  const contract = approveContract(state, 'contract-1', ACCEPT, approver())
  assert.equal(contract.approval?.payerName, student.name)
})

test('IST-092: pasif öğrencinin ve ödeyicisi bulunamayan sözleşmenin onayı reddedilir', () => {
  const { state, student } = fixture()
  setContractSignatory(state, 'contract-1', SIGNATORY, { userId: 'u-admin', now: NOW })
  state.parents = state.parents.filter((parent) => parent.id !== student.parentId)
  assert.throws(
    () => approveContract(state, 'contract-1', ACCEPT, approver()),
    isDomainError('contract_payer_missing', 'rule'),
  )
  student.isActive = false
  assert.throws(
    () => approveContract(state, 'contract-1', ACCEPT, approver()),
    isDomainError('contract_student_inactive', 'conflict'),
  )
})

test('DOM-YTK-025: veli rolü kapsam dışı öğrencinin sözleşmesinde 404, öteki roller yetkisiz', () => {
  const { state, student } = fixture()
  const source = { ...state, modules: { ...state.modules, finance: true } }
  const target = { studentId: student.id }
  const stranger = { role: 'veli', links: [{ kind: 'child', recordId: 'baska-ogrenci' }] } as const
  const decision = authorize(stranger, 'contract.approve', target, source)
  assert.equal(decision.allowed, false)
  assert.equal(decision.allowed ? null : decision.kind, 'not_found')

  const parent = { role: 'veli', links: [{ kind: 'child', recordId: student.id }] } as const
  assert.equal(authorize(parent, 'contract.approve', target, source).allowed, true)
  assert.equal(
    authorize({ role: 'onburo', links: [] }, 'contract.approve', target, source).allowed,
    true,
  )
  assert.equal(authorize({ role: 'onburo', links: [] }, 'contract.sign', {}, source).allowed, false)
  assert.equal(
    authorize({ role: 'yonetici', links: [] }, 'contract.sign', {}, source).allowed,
    true,
  )
  const closed = { ...source, modules: { ...source.modules, finance: false } }
  const off = authorize({ role: 'yonetici', links: [] }, 'contract.amend', {}, closed)
  assert.equal(off.allowed ? null : off.code, 'module_disabled')
})

test('IST-092, DOM-FIN-010: ek protokol onaysız sözleşmeye yapılmaz', () => {
  const { state } = fixture()
  const before = structuredClone(state)
  assert.throws(
    () => amendContract(state, 'contract-1', AMEND, amender()),
    isDomainError('contract_not_approved', 'rule'),
  )
  assert.deepEqual(state, before)
})

test('DOM-FIN-010: ek protokol taslağı önceki sürümü ve taksitleri değiştirmez', () => {
  const { state, contract } = approved()
  const previous = structuredClone(contract)
  const invoices = structuredClone(state.invoices)
  state.invoices[0]!.paidAt = NOW
  const paidInvoices = structuredClone(state.invoices)

  const amendment = amendContract(state, 'contract-1', AMEND, amender())

  assert.deepEqual(state.contracts[0], previous, 'önceki sürüm değişmedi')
  assert.deepEqual(state.invoices, paidInvoices, 'taksitler onaya kadar değişmedi')
  assert.notDeepEqual(invoices, paidInvoices)
  assert.equal(amendment.title, 'Özel okul eğitim sözleşmesi · Ek protokol 1')
  assert.equal(amendment.revision, 2)
  assert.equal(amendment.amendsContractId, 'contract-1')
  assert.equal(amendment.signatory, undefined)
  assert.equal(amendment.approval, undefined)
  assert.deepEqual(amendment.invoiceIds, [])
  // Ödenen 40.000 ₺ ve yemek korunur; kalan 60.000 ₺ üç taksite dağılır (DOM-FIN-011).
  assert.deepEqual(
    amendment.proposedPlan?.kept.map((line) => line.invoiceId),
    ['t-1', 't-meal'],
  )
  assert.deepEqual(amendment.proposedPlan?.replacedInvoiceIds, ['t-2', 't-3'])
  assert.deepEqual(
    amendment.proposedPlan?.added.map((line) => line.amount),
    [2_000_000, 2_000_000, 2_000_000],
  )
  assert.equal(amendment.amount, 11_000_000)
  assert.equal(contractStatus(amendment, state.contracts), 'awaiting_signatory')
  assert.equal(isContractInForce(amendment, state.contracts), false)
  assert.equal(isContractInForce(state.contracts[0]!, state.contracts), true)
  assert.equal(contractPlanLines(amendment)?.length, 5)
})

test('DOM-FIN-010, DOM-FIN-051: onaylanan ek protokol planı taksitlere geçirir, eski belge değişmez', () => {
  const { state, contract } = approved()
  const previous = structuredClone(contract)
  state.invoices[0]!.paidAt = NOW
  const amendment = amendContract(state, 'contract-1', AMEND, amender())
  setContractSignatory(state, amendment.id, SIGNATORY, { userId: 'u-admin', now: NOW })

  const done = approveContract(state, amendment.id, ACCEPT, approver())

  assert.deepEqual(state.contracts[0], previous, 'eski sürüm hiç değişmedi')
  assert.equal(contractStatus(state.contracts[0]!, state.contracts), 'superseded')
  assert.equal(isContractInForce(state.contracts[0]!, state.contracts), false)
  assert.equal(contractStatus(done, state.contracts), 'approved')
  assert.equal(done.proposedPlan, undefined)
  // Eski sürümün belgesi onaylanan dört satırı göstermeye devam eder (DOM-FIN-051).
  assert.deepEqual(
    contractPlanLines(state.contracts[0]!)?.map((line) => line.amount),
    [4_000_000, 3_000_000, 3_000_000, 1_000_000],
  )
  const ids = state.invoices.map((invoice) => invoice.id)
  assert.equal(ids.includes('t-2'), false)
  assert.equal(ids.includes('t-3'), false)
  assert.ok(ids.includes('t-1') && ids.includes('t-meal'))
  // Yeni sözleşme yalnız kendi taksitlerini çözümler; toplam tutara eşittir (DOM-FIN-011, -012).
  const own = state.invoices.filter((invoice) => done.invoiceIds?.includes(invoice.id))
  assert.equal(own.length, 5)
  assert.equal(
    own.reduce((sum, invoice) => sum + invoice.amount, 0),
    done.amount,
  )
  assert.deepEqual(
    own.filter((invoice) => invoice.contractId === done.id).map((invoice) => invoice.installment),
    [5, 6, 7],
  )
  assert.equal(done.approval?.plan.length, 5)
})

test('DOM-FIN-011: ek protokolün vadesi ayın son gününe kırpılır', () => {
  const { state } = approved()
  const amendment = amendContract(
    state,
    'contract-1',
    { ...AMEND, firstDueDate: '2026-12-31', installmentCount: 2 },
    amender(),
  )
  assert.deepEqual(
    amendment.proposedPlan?.added.map((line) => line.dueDate),
    ['2026-12-31T09:00:00.000Z', '2027-01-31T09:00:00.000Z'],
  )
})

test('DOM-FIN-010: taslaktan sonra tahsilat görmüş ek protokol onaylanamaz', () => {
  const { state } = approved()
  const amendment = amendContract(state, 'contract-1', AMEND, amender())
  setContractSignatory(state, amendment.id, SIGNATORY, { userId: 'u-admin', now: NOW })
  const before = structuredClone(state)
  assert.throws(
    () =>
      approveContract(
        state,
        amendment.id,
        ACCEPT,
        approver({ allocated: new Map([['t-2', 100]]) }),
      ),
    isDomainError('contract_amendment_stale', 'conflict'),
  )
  assert.deepEqual(state, before)
  state.invoices[1]!.paidAt = NOW
  assert.throws(
    () => approveContract(state, amendment.id, ACCEPT, approver()),
    isDomainError('contract_amendment_stale', 'conflict'),
  )
})

test('IST-092: açık ek protokol varken ikincisi açılmaz; iptalden sonra açılır', () => {
  const { state } = approved()
  const first = amendContract(state, 'contract-1', AMEND, amender())
  assert.throws(
    () => amendContract(state, 'contract-1', AMEND, amender()),
    isDomainError('contract_amendment_open', 'conflict'),
  )
  const cancelled = cancelContractAmendment(
    state,
    first.id,
    { reason: 'Veli vazgeçti.' },
    {
      userId: 'u-desk',
      now: NOW,
    },
  )
  assert.equal(contractStatus(cancelled, state.contracts), 'cancelled')
  assert.equal(isContractInForce(cancelled, state.contracts), false)
  assert.throws(
    () =>
      cancelContractAmendment(
        state,
        first.id,
        { reason: 'Tekrar.' },
        {
          userId: 'u-desk',
          now: NOW,
        },
      ),
    isDomainError('contract_cancelled', 'conflict'),
  )
  assert.throws(
    () => approveContract(state, first.id, ACCEPT, approver()),
    isDomainError('contract_cancelled', 'conflict'),
  )
  assert.throws(
    () => amendContract(state, first.id, AMEND, amender()),
    isDomainError('contract_cancelled', 'conflict'),
  )
  const second = amendContract(state, 'contract-1', AMEND, amender())
  assert.equal(second.revision, 2)
})

test('IST-092: kayıt sözleşmesi ve onaylı ek protokol iptal edilemez', () => {
  const { state } = fixture()
  assert.throws(
    () =>
      cancelContractAmendment(
        state,
        'contract-1',
        { reason: 'Vazgeçildi.' },
        {
          userId: 'u-desk',
          now: NOW,
        },
      ),
    isDomainError('contract_not_amendment', 'rule'),
  )
  const { state: other } = approved()
  assert.throws(
    () =>
      cancelContractAmendment(
        other,
        'contract-1',
        { reason: 'Vazgeçildi.' },
        {
          userId: 'u-desk',
          now: NOW,
        },
      ),
    isDomainError('contract_already_approved', 'conflict'),
  )
})

test('DOM-FIN-010: yerini ek protokole bırakan sürüm yeniden değiştirilemez; sonraki ek protokol sıra alır', () => {
  const { state } = approved()
  const first = amendContract(state, 'contract-1', AMEND, amender())
  setContractSignatory(state, first.id, SIGNATORY, { userId: 'u-admin', now: NOW })
  approveContract(state, first.id, ACCEPT, approver())
  assert.throws(
    () => amendContract(state, 'contract-1', AMEND, amender()),
    isDomainError('contract_superseded', 'conflict'),
  )
  const second = amendContract(state, first.id, { ...AMEND, installmentCount: 2 }, amender())
  assert.equal(second.revision, 3)
  assert.equal(second.title, 'Özel okul eğitim sözleşmesi · Ek protokol 2')
})

test('IST-092: planı değiştirmeyen, geçmiş vadeli ek protokol ve pasif öğrenci reddedilir', () => {
  const { state, student } = approved()
  const before = structuredClone(state)
  assert.throws(
    () => amendContract(state, 'contract-1', { ...AMEND, firstDueDate: '2026-09-01' }, amender()),
    isDomainError('contract_amendment_date_past', 'rule'),
  )
  // Açık taksitler 7.000.000 kuruşu tek vadede tutuyorsa aynı plan değişiklik değildir.
  state.invoices = state.invoices.filter((invoice) => invoice.id !== 't-2' && invoice.id !== 't-3')
  state.invoices[0]!.dueDate = '2026-12-15T09:00:00.000Z'
  state.invoices[0]!.amount = 10_000_000
  assert.throws(
    () =>
      amendContract(
        state,
        'contract-1',
        { ...AMEND, installmentCount: 1, firstDueDate: '2026-12-15' },
        amender(),
      ),
    isDomainError('contract_amendment_no_change', 'rule'),
  )
  Object.assign(state, structuredClone(before))
  state.students.find((item) => item.id === student.id)!.isActive = false
  assert.throws(
    () => amendContract(state, 'contract-1', AMEND, amender()),
    isDomainError('contract_student_inactive', 'conflict'),
  )
})

test('DOM-KAY-020, IST-092: planlanmış yenilemenin sözleşmesine ek protokol yapılmaz', () => {
  const { state } = approved()
  state.renewals = [
    { contractId: 'contract-1', status: 'Planlandı' },
  ] as unknown as typeof state.renewals
  assert.throws(
    () => amendContract(state, 'contract-1', AMEND, amender()),
    isDomainError('contract_renewal_planned', 'rule'),
  )
})

test('DOM-FIN-020, DOM-FIN-021: ek protokolde indirim tarifeden yeniden hesaplanır, serbest tutar yok', () => {
  const { state, contract } = approved()
  assert.throws(
    () => amendContract(state, 'contract-1', { ...AMEND, discounts: ['sibling'] }, amender()),
    isDomainError('contract_amendment_no_tariff', 'rule'),
  )
  assert.throws(
    () =>
      amendContract(
        state,
        'contract-1',
        { ...AMEND, discounts: ['referral'] },
        amender({ tariff: TARIFF }),
      ),
    isDomainError('discount_not_in_tariff', 'rule'),
  )
  assert.throws(
    () =>
      amendContract(
        state,
        'contract-1',
        { ...AMEND, discounts: ['staff_child'] },
        amender({ tariff: TARIFF }),
      ),
    isDomainError('discount_approval_required', 'rule'),
  )
  const amendment = amendContract(
    state,
    'contract-1',
    { ...AMEND, discounts: ['early_registration'] },
    amender({ tariff: TARIFF, userId: 'u-admin' }),
  )
  assert.deepEqual(amendment.discounts, [{ kind: 'early_registration', amountCents: 500_000 }])
  assert.equal(amendment.netCents, 9_500_000)
  assert.equal(amendment.approvedByUserId, 'u-admin')
  // Net indirimden sonra 95.000 ₺; yemek ayrı kalem olarak korunur (DOM-FIN-003).
  assert.equal(amendment.amount, 10_500_000)
  assert.equal(contract.netCents, 10_000_000, 'önceki sürüm değişmedi')
})

test('DOM-FIN-024: referans kalemi ek protokolle yeni eklenmez; sözleşmede zaten olan kalır', () => {
  const { state, contract } = approved()
  const tariff = {
    ...TARIFF,
    discounts: [{ kind: 'referral', percentBasisPoints: 1_000, amountCents: null }],
  } as unknown as AmendContractContext['tariff']
  const before = structuredClone(state)
  assert.throws(
    () =>
      amendContract(
        state,
        'contract-1',
        { ...AMEND, discounts: ['referral'] },
        amender({ tariff, userId: 'u-admin' }),
      ),
    isDomainError('referral_reward_required', 'rule'),
  )
  assert.deepEqual(state, before)
  contract.discounts = [{ kind: 'referral', amountCents: 1_000_000 }]
  const amendment = amendContract(
    state,
    'contract-1',
    { ...AMEND, discounts: ['referral'] },
    amender({ tariff, userId: 'u-admin' }),
  )
  assert.deepEqual(amendment.discounts, [{ kind: 'referral', amountCents: 1_000_000 }])
})

test('DOM-FIN-022: kardeş indirimi aynı veliye bağlı aktif öğrenci ister', () => {
  const { state, student } = approved()
  const others = state.students.filter((item) => item.id !== student.id)
  for (const other of others) other.parentId = 'baska-veli'
  assert.throws(
    () =>
      amendContract(
        state,
        'contract-1',
        { ...AMEND, discounts: ['sibling'] },
        amender({ tariff: TARIFF }),
      ),
    isDomainError('sibling_discount_ineligible', 'rule'),
  )
  others[0]!.parentId = student.parentId
  others[0]!.isActive = true
  const amendment = amendContract(
    state,
    'contract-1',
    { ...AMEND, discounts: ['sibling'] },
    amender({ tariff: TARIFF }),
  )
  assert.equal(amendment.netCents, 9_000_000)
})

test('DOM-FIN-025, DOM-FIN-010: ek protokol bursu korur; net tahsil edilenin altına inemez', () => {
  const { state, contract } = approved()
  contract.scholarship = { programId: 'program-1', amountCents: 9_800_000 }
  assert.throws(
    () =>
      amendContract(
        state,
        'contract-1',
        { ...AMEND, discounts: ['sibling'] },
        amender({ tariff: TARIFF }),
      ),
    isDomainError('contract_amendment_below_scholarship', 'rule'),
  )
  contract.scholarship = { programId: 'program-1', amountCents: 2_000_000 }
  const amendment = amendContract(
    state,
    'contract-1',
    { ...AMEND, discounts: ['early_registration'] },
    amender({ tariff: TARIFF }),
  )
  assert.deepEqual(amendment.scholarship, { programId: 'program-1', amountCents: 2_000_000 })
  assert.equal(amendment.netCents, 7_500_000)

  const { state: paid } = approved()
  paid.invoices[0]!.paidAt = NOW
  paid.contracts[0]!.scholarship = { programId: 'program-1', amountCents: 8_000_000 }
  assert.throws(
    () =>
      amendContract(
        paid,
        'contract-1',
        { ...AMEND, discounts: ['early_registration'] },
        amender({ tariff: TARIFF }),
      ),
    isDomainError('contract_amendment_below_collected', 'rule'),
  )
})

test('DOM-FIN-010: kısmi tahsilatlı taksit korunur; kalan net sıfırsa yeni taksit açılmaz', () => {
  const { state } = approved()
  const partial = amendContract(
    state,
    'contract-1',
    AMEND,
    amender({ allocated: new Map([['t-1', 100]]) }),
  )
  assert.deepEqual(partial.proposedPlan?.replacedInvoiceIds, ['t-2', 't-3'])

  // 70.000 ₺ tahsil edildi, 30.000 ₺ indirimle net 70.000 ₺ olur: açık taksit kalkar, yenisi açılmaz.
  const { state: settled } = approved()
  settled.invoices[0]!.paidAt = NOW
  settled.invoices[1]!.paidAt = NOW
  const tariff = {
    ...TARIFF,
    discounts: [{ kind: 'corporate', percentBasisPoints: null, amountCents: 3_000_000 }],
  } as AmendContractContext['tariff']
  const amendment = amendContract(
    settled,
    'contract-1',
    { ...AMEND, discounts: ['corporate'] },
    amender({ tariff }),
  )
  assert.deepEqual(amendment.proposedPlan?.added, [])
  assert.deepEqual(amendment.proposedPlan?.replacedInvoiceIds, ['t-3'])
  assert.equal(amendment.amount, 8_000_000)
})

test('DOM-FIN-040, DOM-FIN-012: iade tabanı yürürlükteki sürümdür; onaysız ek protokol sayılmaz', () => {
  const quote = {
    withdrawalDate: '2026-10-01',
    termStartDate: '2026-11-01',
    attendedUnits: 0,
    totalUnits: 180,
    publicSchoolExemption: false,
  }
  const context = {
    institutionType: 'school' as const,
    allocated: new Map<string, number>(),
    creditCents: 0,
    now: NOW,
  }
  const { state, student } = approved()
  const amendment = amendContract(state, 'contract-1', AMEND, amender())
  assert.equal(quoteWithdrawal(state, student.id, quote, context).contractId, 'contract-1')
  setContractSignatory(state, amendment.id, SIGNATORY, { userId: 'u-admin', now: NOW })
  approveContract(state, amendment.id, ACCEPT, approver())
  assert.equal(quoteWithdrawal(state, student.id, quote, context).contractId, amendment.id)
  const cancelledDraft = amendContract(
    state,
    amendment.id,
    { ...AMEND, installmentCount: 2 },
    amender(),
  )
  cancelContractAmendment(
    state,
    cancelledDraft.id,
    { reason: 'Vazgeçildi.' },
    {
      userId: 'u-desk',
      now: NOW,
    },
  )
  assert.equal(quoteWithdrawal(state, student.id, quote, context).contractId, amendment.id)

  // Ayrılış onaylı sürümün taksit bağını daraltır; onay kopyası ve tutar değişmez.
  const copy = structuredClone(state.contracts.find((item) => item.id === amendment.id)?.approval)
  withdrawStudent(state, student.id, { ...quote, reason: 'transfer' }, makeId, context)
  assert.deepEqual(state.contracts.find((item) => item.id === amendment.id)?.approval, copy)
})

test('DOM-FIN-051: belgenin planı onay kopyası, önerilen plan ya da güncel taksitlerdir', () => {
  const { state } = fixture()
  assert.equal(contractPlanLines(state.contracts[0]!), null)
  const { contract } = approved()
  assert.equal(contractPlanLines(contract)?.length, 4)
})

test('IST-092: ek protokol şeması gerekçe ve taksit sayısını sınırlar', () => {
  assert.equal(amendContractSchema.safeParse(AMEND).success, true)
  assert.equal(amendContractSchema.safeParse({ ...AMEND, reason: '' }).success, false)
  assert.equal(amendContractSchema.safeParse({ ...AMEND, installmentCount: 13 }).success, false)
  assert.equal(amendContractSchema.safeParse({ ...AMEND, netCents: 1 }).success, false)
})

test('IST-092, DOM-ILT-023: sözleşme bildirimleri yalnız sözleşme kimliği taşır; başlıkta tutar yok, kitle ödeyiciden seçilir', () => {
  for (const [type, spec] of Object.entries(CONTRACT_NOTIFICATION_TYPES)) {
    assert.equal(NOTIFICATION_TYPES[type as keyof typeof NOTIFICATION_TYPES], spec, type)
    assert.equal(spec.category, 'service', type)
    assert.equal(spec.module, 'finance', type)
    assert.equal(spec.subjectType, 'contracts', type)
    assert.deepEqual(notificationSubject(type, { contractId: 'c-1' }).subject, {
      type: 'contracts',
      id: 'c-1',
    })
    assert.throws(() => notificationSubject(type, { contractId: 'c-1', amountCents: 100 }))
    for (const title of Object.values(spec.titles)) assert.doesNotMatch(title, /\d|₺/, type)
    // Ödeyici veli (velayetli) `parent`, yetişkin kursiyer `student` kitlesini alır.
    assert.deepEqual(notificationAudiences(type as keyof typeof NOTIFICATION_TYPES, true), [
      'parent',
    ])
    assert.deepEqual(notificationAudiences(type as keyof typeof NOTIFICATION_TYPES, false), [
      'student',
    ])
    // Ödeyici bağı (velayetsiz) bugün yalnız taksit, tahsilat ve iadeyi açar (K-04).
    assert.equal(isPayerNotificationKind(type), false, type)
  }
  assert.equal(
    notificationTitle({ kind: 'contract_approval_requested', audience: 'parent' }, 'Deniz Yılmaz'),
    'Deniz için sözleşme onayınızı bekliyor.',
  )
  assert.equal(contractPayerIsGuardian({ payer: 'guardian' }), true)
  assert.equal(contractPayerIsGuardian({}), true)
  assert.equal(contractPayerIsGuardian({ payer: 'student' }), false)
})
