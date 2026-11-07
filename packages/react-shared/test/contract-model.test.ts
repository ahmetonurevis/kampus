import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  amendContract,
  approveContract,
  approveContractSchema,
  cancelContractAmendment,
  setContractSignatory,
} from '@kampus/school-core/lib/contract-approval.ts'

import {
  amendmentBody,
  APPROVAL_REQUIRED_MESSAGE,
  approvalFormSchema,
  amendmentDefaults,
  amendmentFormSchema,
  canRepriceContract,
  contractActions,
  contractPlanRows,
  contractRevision,
  isAmendment,
} from '../src/contract-model.ts'

const NOW = '2026-10-06T09:00:00.000Z'
const TODAY = '2026-10-06'
const SIGNATORY = { name: 'Test Kurucu', role: 'founder' } as const
const AMEND = {
  reason: 'Ödeme planı yeniden düzenlendi.',
  installmentCount: 3,
  firstDueDate: '2026-11-15',
}

function fixture() {
  const state = createSeed(new Date(NOW))
  const studentId = 'st-test-1'
  state.students.push({ ...state.students[0]!, id: studentId, isActive: true })
  const invoice = (
    id: string,
    installment: number,
    paidAt: string | null,
    feeKind = 'tuition',
  ) => ({
    id,
    studentId,
    installment,
    amount: 3_000_000,
    dueDate: `2026-${String(9 + installment).padStart(2, '0')}-15T09:00:00.000Z`,
    paidAt,
    method: paidAt ? 'Nakit' : null,
    reminderAt: null,
    feeKind,
  })
  state.invoices.push(
    invoice('t-test-1', 1, '2026-10-01T09:00:00.000Z'),
    invoice('t-test-2', 2, null),
    invoice('t-test-3', 3, null),
    invoice('t-test-meal', 4, null, 'meal'),
  )
  state.contracts.push({
    id: 'contract-test-1',
    studentId,
    date: '2026-09-01T09:00:00.000Z',
    amount: 12_000_000,
    title: 'Özel okul eğitim sözleşmesi',
    invoiceIds: ['t-test-1', 't-test-2', 't-test-3', 't-test-meal'],
  })
  const contract = () => state.contracts.find((item) => item.id === 'contract-test-1')!
  const mine = () => state.contracts.filter((item) => item.studentId === studentId)
  let counter = 0
  const approveAs = (id: string, role: 'yonetici' | 'veli' = 'yonetici') =>
    approveContract(
      state,
      id,
      { accepted: true },
      {
        role,
        userId: 'u-test',
        membershipId: 'm-test',
        guardians: [],
        allocated: new Map(),
        now: NOW,
        makeId: (prefix) => `${prefix}-yeni-${String(++counter)}`,
      },
    )
  const amend = () =>
    amendContract(state, 'contract-test-1', AMEND, {
      tariff: null,
      canApproveCapException: false,
      allocated: new Map(),
      userId: 'u-test',
      now: NOW,
      makeId: (prefix) => `${prefix}-yeni-${String(++counter)}`,
    })
  return { state, contract, mine, approveAs, amend }
}

describe('sözleşme ekran modeli', () => {
  test('IST-092: imza yetkilisini yalnız yönetici, onayı imzadan sonra yönetici/ön büro/veli görür', () => {
    const { contract, mine, state } = fixture()
    const before = contractActions(contract(), mine(), 'yonetici')
    assert.deepEqual(before, { sign: true, approve: false, amend: false, cancelAmendment: false })
    assert.equal(contractActions(contract(), mine(), 'onburo').sign, false)
    assert.equal(contractActions(contract(), mine(), 'veli').approve, false)

    setContractSignatory(state, 'contract-test-1', SIGNATORY, { userId: 'u-test', now: NOW })
    for (const role of ['yonetici', 'onburo', 'veli'] as const)
      assert.equal(contractActions(contract(), mine(), role).approve, true, role)
    assert.equal(contractActions(contract(), mine(), 'ogretmen').approve, false)
    assert.equal(contractActions(contract(), mine(), 'ogrenci').approve, false)
  })

  test('DOM-FIN-010: onaylı sözleşmede imza ve onay yok; ek protokol yönetici ve ön büroda', () => {
    const { contract, mine, state, approveAs } = fixture()
    setContractSignatory(state, 'contract-test-1', SIGNATORY, { userId: 'u-test', now: NOW })
    approveAs('contract-test-1')
    const admin = contractActions(contract(), mine(), 'yonetici')
    assert.deepEqual(admin, { sign: false, approve: false, amend: true, cancelAmendment: false })
    assert.equal(contractActions(contract(), mine(), 'onburo').amend, true)
    assert.equal(contractActions(contract(), mine(), 'veli').amend, false)
  })

  test('DOM-FIN-010: açık ek protokol varken ikinci ek protokol sunulmaz; taslak iptal edilebilir', () => {
    const { contract, mine, state, approveAs, amend } = fixture()
    setContractSignatory(state, 'contract-test-1', SIGNATORY, { userId: 'u-test', now: NOW })
    approveAs('contract-test-1')
    const draft = amend()
    assert.equal(contractActions(contract(), mine(), 'yonetici').amend, false)
    const draftActions = contractActions(draft, mine(), 'onburo')
    assert.deepEqual(draftActions, {
      sign: false,
      approve: false,
      amend: false,
      cancelAmendment: true,
    })
    assert.equal(contractActions(draft, mine(), 'yonetici').sign, true)
    assert.equal(contractActions(draft, mine(), 'veli').cancelAmendment, false)
    assert.equal(isAmendment(draft), true)
    assert.equal(contractRevision(draft), 2)
    assert.equal(contractRevision(contract()), 1)

    cancelContractAmendment(
      state,
      draft.id,
      { reason: 'Veli vazgeçti.' },
      { userId: 'u', now: NOW },
    )
    const cancelled = state.contracts.find((item) => item.id === draft.id)!
    assert.deepEqual(contractActions(cancelled, mine(), 'yonetici'), {
      sign: false,
      approve: false,
      amend: false,
      cancelAmendment: false,
    })
    // İptal edilen ek protokol yeni ek protokolü engellemez.
    assert.equal(contractActions(contract(), mine(), 'yonetici').amend, true)
  })

  test('DOM-FIN-010: ek protokol onaylanınca önceki sürüm salt okunur, yeni sürüm ek protokole açık', () => {
    const { contract, mine, state, approveAs, amend } = fixture()
    setContractSignatory(state, 'contract-test-1', SIGNATORY, { userId: 'u-test', now: NOW })
    approveAs('contract-test-1')
    const draft = amend()
    setContractSignatory(state, draft.id, SIGNATORY, { userId: 'u-test', now: NOW })
    approveAs(draft.id)
    const old = contractActions(contract(), mine(), 'yonetici')
    assert.deepEqual(old, { sign: false, approve: false, amend: false, cancelAmendment: false })
    assert.equal(contractActions(draft, mine(), 'yonetici').amend, true)
  })

  test('DOM-FIN-012, DOM-FIN-051: plan satırları onaysızda kendi taksitleri, taslakta korunan + önerilen, onayda kopya', () => {
    const { contract, state, approveAs, amend } = fixture()
    const current = contractPlanRows(contract(), state.invoices)
    assert.deepEqual(
      current.map((row) => [row.installment, row.kind, row.feeKind]),
      [
        [1, 'current', 'tuition'],
        [2, 'current', 'tuition'],
        [3, 'current', 'tuition'],
        [4, 'current', 'meal'],
      ],
    )
    setContractSignatory(state, 'contract-test-1', SIGNATORY, { userId: 'u-test', now: NOW })
    approveAs('contract-test-1')
    assert.deepEqual(
      contractPlanRows(contract(), state.invoices).map((row) => row.kind),
      ['approved', 'approved', 'approved', 'approved'],
    )
    const draft = amend()
    const proposal = contractPlanRows(draft, state.invoices)
    // Tahsil edilmiş taksit ve ek hizmet korunur; kalan iki açık taksit üç yeni taksite bölünür.
    assert.deepEqual(
      proposal.map((row) => [row.kind, row.installment]),
      [
        ['kept', 1],
        ['kept', 4],
        ['proposed', 5],
        ['proposed', 6],
        ['proposed', 7],
      ],
    )
    assert.equal(new Set(proposal.map((row) => row.key)).size, proposal.length)
    assert.equal(
      proposal.filter((row) => row.kind === 'proposed').reduce((sum, row) => sum + row.amount, 0),
      6_000_000,
    )
  })

  test('DOM-FIN-012: invoiceIds taşımayan eski sözleşme öğrencinin taksitlerine düşer', () => {
    const { state } = fixture()
    const legacy = state.contracts.find((item) => item.id === 'contract-s1')!
    const rows = contractPlanRows(legacy, state.invoices)
    const own = state.invoices.filter((invoice) => invoice.studentId === 's1')
    assert.equal(rows.length, own.length)
    assert.ok(rows.length > 0)
  })

  test('IST-092: ek protokol varsayılanları açık öğrenim taksitlerinden, gövde indirimi yalnız istenirse taşır', () => {
    const { contract, state } = fixture()
    const defaults = amendmentDefaults(contract(), state.invoices, TODAY)
    assert.deepEqual(defaults, {
      reason: '',
      installmentCount: '2',
      firstDueDate: '2026-11-15',
      changeDiscounts: false,
      discounts: [],
    })
    // Bütün açık vadeler geçmişse ilk vade bugündür.
    assert.equal(
      amendmentDefaults(contract(), state.invoices, '2027-06-01').firstDueDate,
      '2027-06-01',
    )

    const parsed = amendmentFormSchema.parse({ ...defaults, reason: 'Plan değişti.' })
    assert.deepEqual(amendmentBody(parsed), {
      reason: 'Plan değişti.',
      installmentCount: 2,
      firstDueDate: '2026-11-15',
    })
    const repriced = amendmentFormSchema.parse({
      ...defaults,
      reason: 'Kardeş indirimi eklendi.',
      changeDiscounts: true,
      discounts: ['sibling'],
    })
    assert.deepEqual(amendmentBody(repriced).discounts, ['sibling'])
  })

  test('IST-092: ek protokol formu Türkçe alan hatası verir', () => {
    const { contract, state } = fixture()
    const defaults = amendmentDefaults(contract(), state.invoices, TODAY)
    const result = amendmentFormSchema.safeParse({
      ...defaults,
      installmentCount: '13',
      reason: '',
    })
    assert.equal(result.success, false)
    const messages = Object.fromEntries(
      (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]),
    )
    assert.equal(messages.installmentCount, 'Taksit sayısını 1 ile 12 arasında girin.')
    assert.match(String(messages.reason), /karakter/)
  })

  test('DOM-FIN-020: indirim yalnız tarifeli sözleşmede yeniden hesaplanır; mevcut kalemler önceden seçilir', () => {
    const { contract, state } = fixture()
    assert.equal(canRepriceContract(contract()), false)
    const priced = {
      ...contract(),
      tariffId: 'tariff-1',
      grossCents: 12_000_000,
      discounts: [
        { kind: 'sibling', amountCents: 100 },
        { kind: 'bilinmeyen', amountCents: 1 },
      ],
    }
    assert.equal(canRepriceContract(priced), true)
    assert.deepEqual(amendmentDefaults(priced, state.invoices, TODAY).discounts, ['sibling'])
  })
})

describe('sözleşme onay formu', () => {
  test('IST-092: kutu işaretlenmeden onay gönderilmez; mesaj core ile aynıdır', () => {
    const empty = approvalFormSchema.safeParse({ accepted: false })
    assert.equal(empty.success, false)
    assert.equal(empty.error?.issues[0]?.message, APPROVAL_REQUIRED_MESSAGE)
    const core = approveContractSchema.safeParse({ accepted: false })
    assert.equal(core.error?.issues[0]?.message, APPROVAL_REQUIRED_MESSAGE)
    assert.deepEqual(approvalFormSchema.parse({ accepted: true }), { accepted: true })
  })
})
