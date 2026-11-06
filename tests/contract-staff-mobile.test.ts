import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../packages/api-client/src/errors.ts'
import type { CollectionRow } from '../packages/react-shared/src/collections.ts'
import type { ContractRecord } from '../packages/react-shared/src/contract-model.ts'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { documentData } from '../packages/school-core/src/lib/document-data.ts'
import { contractDocumentHtml } from '../apps/mobile/src/api/contract-document.ts'
import {
  checkAmendment,
  checkCancelAmendment,
  checkSignatory,
  contractFailure,
  contractStudentIds,
  contractVersionLinks,
  contractVersions,
  staffContractActions,
  staffContractFacts,
  staffContractItems,
  staffContractNotice,
  staffContractQuery,
} from '../apps/mobile/src/api/contract-staff.ts'
import { EMPTY_LIST_STATE } from '../apps/mobile/src/api/list-state.ts'

const seed = createSeed(new Date('2026-09-01T09:00:00Z'))
const base = seed.contracts.find((item) => item.studentId === 's1')!
const signatory = {
  name: 'Mehmet Kurucu',
  role: 'founder' as const,
  recordedAt: '2025-09-03T10:00:00.000Z',
  recordedByUserId: 'u-admin',
}
const approval = {
  method: 'wet_signature' as const,
  approvedAt: '2025-09-04T08:30:00.000Z',
  approvedByUserId: 'u-front',
  payerName: 'Ayşe Yılmaz',
  plan: [
    { invoiceId: 'inv-s1-0', installment: 1, amount: 2450000, dueDate: '2026-06-10T09:00:00.000Z' },
  ],
}
const awaitingSignatory: ContractRecord = { ...base, id: 'k-imza' }
const awaitingApproval: ContractRecord = { ...base, id: 'k-onay', signatory }
const approved: ContractRecord = { ...base, id: 'k-onayli', signatory, approval }
const amendment: ContractRecord = {
  ...base,
  id: 'k-ek',
  revision: 2,
  amendsContractId: approved.id,
  amendmentReason: 'Taksit yeniden planı',
}
const row = (record: ContractRecord, name = 'Deniz Yılmaz'): CollectionRow<ContractRecord> => ({
  id: record.id,
  version: 5,
  createdAt: '2025-09-03T09:00:00.000Z',
  updatedAt: '2025-09-03T09:00:00.000Z',
  archivedAt: null,
  record,
  joined: { studentName: name },
})
const apiError = (status: number, code: string) =>
  new ApiError({ status, code, message: 'Sunucu iletisi' })

describe('ON-079 IST-092 mobil görevli sözleşme listesi ve belgeleri', () => {
  test('IST-092 liste en yeni sürümü öne alır, aramayı iki harften sunucuya gönderir', () => {
    assert.deepEqual(staffContractQuery({ ...EMPTY_LIST_STATE, index: 1 }, 'D'), {
      page: 2,
      pageSize: 10,
      sort: ['-date', 'id'],
    })
    assert.equal(staffContractQuery(EMPTY_LIST_STATE, ' De ').q, 'De')
  })

  test('IST-092 ikinci sorgu sayfadaki öğrencileri tekil ve sıralı ister', () => {
    const other = { ...base, id: 'k-2', studentId: 'a1' }
    assert.deepEqual(contractStudentIds([row(approved), row(other), row(amendment)]), ['a1', 's1'])
  })

  test('IST-092 durum öğrencinin bütün sürümlerinden türer; sürümler gelmeden rozet çizilmez', () => {
    const superseding: ContractRecord = { ...amendment, signatory, approval }
    const [loading] = staffContractItems([row(approved)], undefined)
    assert.equal(loading?.statusLabel, null)
    const [item] = staffContractItems([row(approved)], [row(approved), row(superseding)])
    assert.equal(item?.title, 'Deniz Yılmaz')
    assert.match(item?.statusLabel ?? '', /ek protokol/i)
    assert.match(item?.label ?? '', /sözleşme ayrıntısını aç$/)
  })

  test('IST-092 görevli iptal edilen ek protokolü de listede görür (veliden farklı)', () => {
    const cancelled: ContractRecord = {
      ...amendment,
      cancelledAt: '2025-10-01T09:00:00.000Z',
      cancelReason: 'Vazgeçildi',
    }
    const items = staffContractItems([row(cancelled)], [row(approved), row(cancelled)])
    assert.equal(items.length, 1)
  })

  test('DOM-FIN-051 yönetici imza yetkilisini işler, ön büro işleyemez', () => {
    const all = [awaitingSignatory]
    assert.equal(staffContractActions(awaitingSignatory, all, 'yonetici').sign, true)
    assert.equal(staffContractActions(awaitingSignatory, all, 'onburo').sign, false)
  })

  test('DOM-FIN-051 ıslak imzalı onay telefonda işlenmez, bilgi kutusu web’e yönlendirir', () => {
    const actions = staffContractActions(awaitingApproval, [awaitingApproval], 'onburo')
    assert.equal(actions.approveOnWeb, true)
    assert.equal('approve' in actions, false)
    const notice = staffContractNotice(awaitingApproval, 'awaiting_approval', false)
    assert.match(notice?.text ?? '', /web uygulamasından/)
  })

  test('DOM-FIN-010 ek protokol yalnız onaylı sürümde ve açık taslak yokken sunulur', () => {
    assert.equal(staffContractActions(approved, [approved], 'onburo').amend, true)
    assert.equal(staffContractActions(approved, [approved, amendment], 'onburo').amend, false)
    assert.equal(staffContractActions(awaitingApproval, [awaitingApproval], 'onburo').amend, false)
    const open = staffContractActions(amendment, [approved, amendment], 'onburo')
    assert.equal(open.cancelAmendment, true)
  })

  test('IST-092 durum notu imza yetkisine göre değişir, onaylıda değişmezlik yazar', () => {
    assert.match(
      staffContractNotice(awaitingSignatory, 'awaiting_signatory', true)?.text ?? '',
      /kurucu temsilcisini işleyin/,
    )
    assert.match(
      staffContractNotice(awaitingSignatory, 'awaiting_signatory', false)?.text ?? '',
      /yöneticinin/,
    )
    assert.match(staffContractNotice(approved, 'approved', false)?.text ?? '', /ek protokolle/)
  })

  test('IST-092 künye öğrenciyi başta yazar; ad yoksa tire', () => {
    const facts = staffContractFacts(approved, 'approved', 'Deniz Yılmaz')
    assert.deepEqual(facts[0], ['Öğrenci', 'Deniz Yılmaz'])
    assert.deepEqual(staffContractFacts(approved, 'approved', undefined)[0], ['Öğrenci', '—'])
    assert.ok(new Map(facts).has('Ödeyici onayı'))
  })

  test('IST-092 sürüm bağlantıları önceki sürümü ve iptal edilmemiş ek protokolü açar', () => {
    const cancelled: ContractRecord = {
      ...amendment,
      id: 'k-ek-iptal',
      cancelledAt: '2025-10-01T09:00:00.000Z',
    }
    assert.deepEqual(contractVersionLinks(approved, [approved, amendment, cancelled]), [
      { id: 'k-ek', label: 'Sürüm 2 · Ek protokol aç' },
    ])
    assert.deepEqual(contractVersionLinks(amendment, [approved, amendment]), [
      { id: 'k-onayli', label: 'Önceki sürümü aç' },
    ])
  })

  test('IST-092 panelin kaydı listedekinin yerine geçer, sürüm iki kez sayılmaz', () => {
    const fresh = { ...approved, title: 'Tazelenmiş' }
    const all = contractVersions(fresh, [row(approved), row(amendment)])
    assert.equal(all.length, 2)
    assert.equal(all[0]?.title, 'Tazelenmiş')
  })

  test('DOM-FIN-051 imza yetkilisi formu core şemasıyla denetlenir', () => {
    const empty = checkSignatory({ name: '', role: 'founder' })
    assert.equal(empty.ok, false)
    if (!empty.ok) assert.ok(empty.errors.name)
    const valid = checkSignatory({ name: 'Mehmet Kurucu', role: 'founder_representative' })
    assert.equal(valid.ok, true)
  })

  test('DOM-FIN-010 ek protokol formu web ile aynı gövdeyi kurar, indirim isteğe bağlıdır', () => {
    const values = {
      reason: 'Taksit yeniden planı',
      installmentCount: '4',
      firstDueDate: '2026-10-01',
      changeDiscounts: false,
      discounts: ['sibling' as const],
    }
    const plain = checkAmendment(values)
    assert.equal(plain.ok, true)
    if (plain.ok)
      assert.deepEqual(plain.body, {
        reason: 'Taksit yeniden planı',
        installmentCount: 4,
        firstDueDate: '2026-10-01',
      })
    const repriced = checkAmendment({ ...values, changeDiscounts: true })
    assert.equal(repriced.ok, true)
    if (repriced.ok) assert.deepEqual(repriced.body.discounts, ['sibling'])
  })

  test('DOM-FIN-010 geçersiz taksit sayısı ve boş gerekçe istek atmadan reddedilir', () => {
    const invalid = checkAmendment({
      reason: '',
      installmentCount: '13',
      firstDueDate: '2026-10-01',
      changeDiscounts: false,
      discounts: [],
    })
    assert.equal(invalid.ok, false)
    if (!invalid.ok) {
      assert.ok(invalid.errors.reason)
      assert.match(invalid.errors.installmentCount ?? '', /1 ile 12/)
    }
    assert.equal(checkCancelAmendment({ reason: '' }).ok, false)
    assert.equal(checkCancelAmendment({ reason: 'Vazgeçildi' }).ok, true)
  })

  test('DOM-FIN-051 çakışma formu kapatır, belirsiz sonuç ve alan hatası kapatmaz', () => {
    const conflict = contractFailure(apiError(409, 'version_conflict'), {}, ['reason'])
    assert.equal(conflict.conflict, true)
    assert.match(conflict.message ?? '', /başka biri/)
    const network = contractFailure(apiError(503, 'server_error'), {}, ['reason'])
    assert.equal(network.conflict, false)
    assert.equal(network.uncertain, true)
    const field = contractFailure(
      apiError(422, 'validation_error'),
      { reason: 'Gerekçe girin.', other: 'Başka alan.' },
      ['reason'],
    )
    assert.equal(field.errors.reason, 'Gerekçe girin.')
    // Formda karşılığı olmayan alan kaybolmaz.
    assert.equal(field.message, 'Başka alan.')
  })

  test('DOM-FIN-051 görevli de aynı belge yolunu kullanır: durum ve plan belgeye yazılır', () => {
    const state = { ...seed, contracts: [approved] }
    const data = documentData(state, 'contract', approved.id)
    const html = contractDocumentHtml(data, {
      institution: 'Akademi Özel Okulları',
      generatedAt: new Date('2026-09-01T09:00:00Z'),
    })
    assert.match(html, /Akademi Özel Okulları/)
    assert.match(html, /Islak imza/i)
    assert.match(html, /Mehmet Kurucu/)
    assert.match(html, /Ek 1 \/ Ödeme planı/)
  })
})
