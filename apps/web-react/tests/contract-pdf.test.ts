import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  amendContract,
  approveContract,
  setContractSignatory,
} from '@kampus/school-core/lib/contract-approval.ts'
import { documentData } from '@kampus/school-core/lib/document-data.ts'
import { INSTITUTION_TYPES } from '@kampus/school-core/modules/collection-modules.ts'
import { contractDocument } from '../src/lib/pdf/templates/contract.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

const NOW = '2026-10-06T09:00:00.000Z'
const OPTIONS = { institution: 'Akademi Özel Okulları', generatedAt: new Date(NOW) }

let counter = 0
const makeId = (prefix: string) => {
  counter += 1
  return `${prefix}-pdf-${String(counter)}`
}

/** Seed sözleşmesi: kendi iki taksitiyle, tarifeli kayıt alanlarıyla. */
function fixture() {
  const state = createSeed(new Date(NOW))
  const contract = state.contracts[0]!
  const invoices = state.invoices.filter((item) => item.studentId === contract.studentId)
  for (const item of invoices) item.paidAt = null
  Object.assign(contract, {
    invoiceIds: invoices.map((item) => item.id),
    grossCents: contract.amount,
    netCents: contract.amount,
    discounts: [],
    extras: [],
    payer: 'guardian',
  })
  state.renewals = []
  return { state, contract }
}

const approve = (state: ReturnType<typeof fixture>['state'], id: string) => {
  setContractSignatory(
    state,
    id,
    { name: 'Murat Kurucu', role: 'founder_representative' },
    { userId: 'u-admin', now: NOW },
  )
  approveContract(
    state,
    id,
    { accepted: true },
    {
      role: 'onburo',
      userId: 'u-desk',
      membershipId: 'm-desk',
      guardians: [],
      allocated: new Map(),
      now: NOW,
      makeId,
    },
  )
}

const render = (state: ReturnType<typeof fixture>['state'], id: string) =>
  allTexts(contractDocument(measurer, documentData(state, 'contract', id), OPTIONS))

test('IST-092: onaysız sözleşme imza yetkilisi ve ödeyici onayı bekler', () => {
  const { state, contract } = fixture()
  const all = render(state, contract.id)
  assert.ok(all.some((text) => text.includes('Sürüm 1 · Kurum imzası bekleniyor')))
  assert.ok(all.some((text) => text.includes('İmza yetkilisi: Bekleniyor')))
  assert.ok(all.some((text) => text.includes('onaylanana kadar imza veya ödeme yükümlülüğü')))
})

test('IST-092, DOM-FIN-010: onaylı sözleşme imza yetkilisini, onay biçimini ve zamanını gösterir', () => {
  const { state, contract } = fixture()
  approve(state, contract.id)
  const all = render(state, contract.id)
  assert.ok(all.some((text) => text.includes('Sürüm 1 · Onaylandı')))
  assert.ok(all.some((text) => text.includes('Kurucu temsilcisi · Murat Kurucu')))
  assert.ok(all.some((text) => text.includes('Ödeyici onayı: Islak imza · ')))
  assert.ok(all.some((text) => text.includes('değişiklik yalnız ek protokolle yapılır')))
  assert.equal(
    all.some((text) => text.includes('onaylanana kadar imza veya ödeme yükümlülüğü')),
    false,
  )
})

test('DOM-FIN-051: onaylı sürümün belgesi onay anındaki planı gösterir, ek protokol öneriyi', () => {
  const { state, contract } = fixture()
  approve(state, contract.id)
  const amendment = amendContract(
    state,
    contract.id,
    { reason: 'Taksitler üçe bölündü.', installmentCount: 3, firstDueDate: '2026-11-15' },
    {
      tariff: null,
      canApproveCapException: false,
      allocated: new Map(),
      userId: 'u-desk',
      now: NOW,
      makeId,
    },
  )
  const draft = render(state, amendment.id)
  assert.ok(draft.includes('EK PROTOKOL'))
  assert.ok(draft.some((text) => text.includes('Sürüm 2 · Kurum imzası bekleniyor')))
  assert.ok(draft.includes('Taksitler üçe bölündü.'))
  assert.ok(draft.includes('Öneri'))
  assert.equal(draft.includes('Kalan bakiye'), false)

  approve(state, amendment.id)
  // Eski sürümün taksitleri artık güncel planda değil; tutarlar onaylanan kopyadan gelir.
  const old = render(state, contract.id)
  assert.ok(old.includes('Güncel planda yok'))
  assert.ok(old.some((text) => text.includes('Sürüm 1 · Onaylandı')))
  const current = render(state, amendment.id)
  assert.ok(current.some((text) => text.includes('Sürüm 2 · Onaylandı')))
  assert.equal(current.includes('Öneri'), false)
})

test('DOM-FIN-025, DOM-KAY-012: burs ayrı kalemdir, tam bursta taksit yok; kursiyer taraftır', () => {
  const { state, contract } = fixture()
  Object.assign(contract, {
    netCents: 0,
    amount: 0,
    invoiceIds: [],
    scholarship: { programId: 'program-1', amountCents: contract.grossCents },
    payer: 'student',
  })
  const all = render(state, contract.id)
  assert.ok(all.includes('Burs'))
  assert.ok(all.some((text) => text.includes('tam bursta öğrenim taksiti açılmaz')))
  assert.ok(all.includes('Bu sözleşmede ödeme planı satırı bulunmuyor.'))
  assert.ok(all.some((text) => text.includes('senet veya taahhüt düzenlenmez')))
  const student = state.students.find((item) => item.id === contract.studentId)!
  assert.ok(all.some((text) => text.includes(`Kursiyer · ${student.name}`)))
})

test('DOM-KAY-012 ON-124: yetişkin kursiyerin ayrı ödeyicisi taraf ve imza satırında "Ödeyici" yazılır (2026-11-04)', () => {
  const { state, contract } = fixture()
  Object.assign(contract, { payer: 'guardian' })
  const student = state.students.find((item) => item.id === contract.studentId)!
  const parent = state.parents.find((item) => item.id === student.parentId)!
  const adult = allTexts(
    contractDocument(measurer, documentData(state, 'contract', contract.id), {
      ...OPTIONS,
      institutionType: 'language_school',
      learnerMinor: false,
    }),
  )
  assert.ok(adult.some((text) => text.includes(`Ödeyici · ${parent.name}`)))
  assert.equal(
    adult.some((text) => text.includes(`Veli · ${parent.name}`)),
    false,
  )
  // Yaş bilinmiyorsa ya da 18 yaş altındaysa taraf velidir (eski davranış).
  const minor = render(state, contract.id)
  assert.ok(minor.some((text) => text.includes(`Veli · ${parent.name}`)))
})

test('ADR 0008, DOM-KAY-012: okul dışındaki türde sözleşme metni "kursiyer" der; okulda "öğrenci" kalır', () => {
  const { state, contract } = fixture()
  Object.assign(contract, { payer: 'student' })
  const student = state.students.find((item) => item.id === contract.studentId)!
  const school = render(state, contract.id)
  assert.ok(school.includes('01 / Taraflar ve öğrenci bilgileri'))
  assert.ok(school.includes('Öğrenci'))
  assert.ok(school.includes('Okul numarası / Sınıf'))
  for (const institutionType of INSTITUTION_TYPES.filter((type) => type !== 'school')) {
    const all = allTexts(
      contractDocument(measurer, documentData(state, 'contract', contract.id), {
        ...OPTIONS,
        institutionType,
      }),
    )
    assert.ok(all.includes('01 / Taraflar ve kursiyer bilgileri'), institutionType)
    assert.ok(all.includes('Kursiyer numarası / Sınıf'), institutionType)
    assert.equal(all.includes('Okul numarası / Sınıf'), false, institutionType)
    assert.ok(
      all.some((text) => text.includes('kursiyerin kayıtlı olduğu sınıftaki')),
      institutionType,
    )
    assert.ok(all.includes('Kursiyer'), institutionType)
    assert.ok(
      all.some((text) => text.includes(`Kursiyer · ${student.name}`)),
      institutionType,
    )
  }
})
