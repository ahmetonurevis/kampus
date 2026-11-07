import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { State } from '../packages/school-core/src/data/seed.ts'
import {
  CONTRACT_SELF_SERVICE_ROLES,
  contractPlanSummary,
  learnerReadsOwnContracts,
} from '../packages/school-core/src/lib/contract-self-service.ts'

// Yetişkin kursiyerin sözleşmelerim görünümü (IST-082; docs/domain/finans.md DOM-FIN-059).

type Contract = State['contracts'][number]
type Invoice = State['invoices'][number]

// 2026-10-06 21:30Z İstanbul'da 7 Ekim'dir: 2008-10-07 doğumlu bu anda 18 yaşını doldurmuştur.
const NOW = '2026-10-06T21:30:00.000Z'
const COURSE = { institutionType: 'language_school', now: NOW } as const
const SCHOOL = { institutionType: 'school', now: NOW } as const

test('DOM-FIN-059: yalnız öğrenci rolü kendi sözleşmesini okur', () => {
  assert.deepEqual(CONTRACT_SELF_SERVICE_ROLES, ['ogrenci'])
})

test('DOM-FIN-059, DOM-KAY-012: dil okulunda 18 yaşını dolduran kursiyer görür, okulda görmez', () => {
  assert.equal(learnerReadsOwnContracts({ birthDate: '1995-04-20' }, COURSE), true)
  // Okulda her yaşta velilidir; 18 yaşını doldurmuş lise öğrencisi de görmez.
  assert.equal(learnerReadsOwnContracts({ birthDate: '1995-04-20' }, SCHOOL), false)
  assert.equal(learnerReadsOwnContracts({ prospectMinor: false }, SCHOOL), false)
})

test('DOM-FIN-059, DOM-KAY-012: yaş Europe/Istanbul gününe göre; 18 yaş altı görmez', () => {
  assert.equal(learnerReadsOwnContracts({ birthDate: '2008-10-07' }, COURSE), true)
  assert.equal(learnerReadsOwnContracts({ birthDate: '2008-10-08' }, COURSE), false)
  assert.equal(
    learnerReadsOwnContracts(
      { birthDate: '2008-10-07' },
      { ...COURSE, now: '2026-10-06T20:59:00.000Z' },
    ),
    false,
  )
  assert.equal(learnerReadsOwnContracts({ birthDate: '2012-01-01' }, COURSE), false)
})

test('DOM-FIN-059: doğum tarihi yoksa adayın yaş grubu, o da yoksa reşit olmayan sayılır', () => {
  assert.equal(learnerReadsOwnContracts({ prospectMinor: false }, COURSE), true)
  assert.equal(learnerReadsOwnContracts({ prospectMinor: true }, COURSE), false)
  assert.equal(learnerReadsOwnContracts({}, COURSE), false)
  // Doğum tarihi adayın seçiminden önce gelir.
  assert.equal(
    learnerReadsOwnContracts({ birthDate: '2012-01-01', prospectMinor: false }, COURSE),
    false,
  )
})

const invoice = (id: string, installment: number, overrides: Partial<Invoice> = {}): Invoice => ({
  id,
  studentId: 'k1',
  installment,
  amount: 400_000,
  dueDate: `2026-${String(9 + installment).padStart(2, '0')}-15T09:00:00.000Z`,
  paidAt: null,
  method: null,
  reminderAt: null,
  ...overrides,
})
const paid = { paidAt: '2026-10-01T09:00:00.000Z', method: 'Nakit' }
const contract = (overrides: Partial<Contract> = {}): Contract => ({
  id: 'k1-c1',
  studentId: 'k1',
  date: '2026-09-01T09:00:00.000Z',
  amount: 1_200_000,
  title: 'Dil kursu eğitim sözleşmesi',
  invoiceIds: ['k1-i1', 'k1-i2', 'k1-i3'],
  ...overrides,
})
const INVOICES = [
  invoice('k1-i1', 1, paid),
  invoice('k1-i2', 2),
  invoice('k1-i3', 3),
  invoice('k2-i1', 1, { studentId: 'k2' }),
]

test('DOM-FIN-059: onaysız sözleşmede özet bağlı taksitlerden; sıradaki vade en yakın ödenmemiş', () => {
  const only = contract()
  assert.deepEqual(contractPlanSummary(only, [only], INVOICES), {
    installmentCount: 3,
    totalCents: 1_200_000,
    paidCount: 1,
    nextDue: { date: '2026-11-15', amountCents: 400_000 },
  })
  // Taksit listesi olmayan eski kayıt öğrencinin bütün taksitlerini okur.
  const legacy = contract({ invoiceIds: undefined })
  assert.equal(contractPlanSummary(legacy, [legacy], INVOICES).installmentCount, 3)
  const all = INVOICES.map((item) => ({ ...item, ...paid }))
  assert.equal(contractPlanSummary(only, [only], all).nextDue, null)
})

test('DOM-FIN-059, DOM-FIN-051: onaylı sürüm onay anının planını, ek protokol taslağı öneriyi özetler', () => {
  const approval = {
    method: 'electronic' as const,
    approvedAt: '2026-09-02T09:00:00.000Z',
    approvedByUserId: 'u1',
    payerName: 'Kursiyer',
    plan: [
      { invoiceId: 'k1-i1', installment: 1, amount: 600_000, dueDate: '2026-10-15T09:00:00.000Z' },
      { invoiceId: 'k1-i2', installment: 2, amount: 600_000, dueDate: '2026-11-15T09:00:00.000Z' },
    ],
  }
  const original = contract({ approval })
  const draft = contract({
    id: 'k1-c2',
    revision: 2,
    amendsContractId: 'k1-c1',
    proposedPlan: {
      kept: [approval.plan[0]!],
      replacedInvoiceIds: ['k1-i2'],
      added: [
        { invoiceId: null, installment: 2, amount: 300_000, dueDate: '2026-12-15T09:00:00.000Z' },
        { invoiceId: null, installment: 3, amount: 300_000, dueDate: '2027-01-15T09:00:00.000Z' },
      ],
    },
  })
  const contracts = [original, draft]
  assert.deepEqual(contractPlanSummary(original, contracts, INVOICES), {
    installmentCount: 2,
    totalCents: 1_200_000,
    paidCount: 1,
    nextDue: { date: '2026-11-15', amountCents: 600_000 },
  })
  // Onaylanmamış ek protokol borç doğurmaz: önerinin sıradaki vadesi yoktur.
  assert.deepEqual(contractPlanSummary(draft, contracts, INVOICES), {
    installmentCount: 3,
    totalCents: 1_200_000,
    paidCount: 1,
    nextDue: null,
  })
})

test('DOM-FIN-059: yerini ek protokole bırakan ve iptal edilen sürümün sıradaki vadesi yoktur', () => {
  const approval = {
    method: 'wet_signature' as const,
    approvedAt: '2026-09-02T09:00:00.000Z',
    approvedByUserId: 'u1',
    payerName: 'Kursiyer',
    plan: [
      { invoiceId: 'k1-i2', installment: 2, amount: 400_000, dueDate: '2026-11-15T09:00:00.000Z' },
    ],
  }
  const original = contract({ approval })
  const amendment = contract({
    id: 'k1-c2',
    revision: 2,
    amendsContractId: 'k1-c1',
    approval: { ...approval, approvedAt: '2026-09-20T09:00:00.000Z' },
  })
  assert.equal(contractPlanSummary(original, [original, amendment], INVOICES).nextDue, null)
  assert.deepEqual(contractPlanSummary(amendment, [original, amendment], INVOICES).nextDue, {
    date: '2026-11-15',
    amountCents: 400_000,
  })
  const cancelled = contract({
    id: 'k1-c3',
    revision: 2,
    amendsContractId: 'k1-c1',
    cancelledAt: '2026-09-10T09:00:00.000Z',
    cancelledByUserId: 'u1',
    cancelReason: 'Vazgeçildi.',
  })
  assert.equal(contractPlanSummary(cancelled, [original, cancelled], INVOICES).nextDue, null)
})
