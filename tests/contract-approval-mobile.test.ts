import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import type { CollectionRow } from '../packages/react-shared/src/collections.ts'
import type { ContractRecord } from '../packages/react-shared/src/contract-model.ts'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import { documentData } from '../packages/school-core/src/lib/document-data.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  APPROVAL_ON_WEB_NOTICE,
  awaitingApprovalCount,
  canOpenParentContracts,
  contractFacts,
  contractListItems,
  contractNotice,
  contractPlanView,
  contractVersionLabel,
} from '../apps/mobile/src/api/contract-approval.ts'
import {
  contractDocumentErrorMessage,
  contractDocumentHtml,
  contractDocumentName,
  escapeHtml,
} from '../apps/mobile/src/api/contract-document.ts'
import { CONTRACT_APPROVAL_SCREEN } from '../apps/mobile/src/api/contract-screen.ts'
import { apiPages, screenRegistryIssues } from '../apps/mobile/src/api/pages.ts'
import { SCREEN_REGISTRY, type ScreenEntry } from '../apps/mobile/src/api/screen-registry.ts'

const seed = createSeed(new Date('2026-09-01T09:00:00Z'))
const base = seed.contracts.find((item) => item.studentId === 's1')!
const studentInvoices = seed.invoices.filter((item) => item.studentId === 's1')

const signatory = {
  name: 'Mehmet Kurucu',
  role: 'founder' as const,
  recordedAt: '2025-09-03T10:00:00.000Z',
  recordedByUserId: 'u-admin',
}
const approval = {
  method: 'electronic' as const,
  approvedAt: '2025-09-04T08:30:00.000Z',
  approvedByUserId: 'u-parent',
  payerName: 'Ayşe Yılmaz',
  plan: [
    { invoiceId: 'inv-s1-0', installment: 1, amount: 2450000, dueDate: '2026-06-10T09:00:00.000Z' },
  ],
}

const row = (record: ContractRecord, version = 1): CollectionRow<ContractRecord> => ({
  id: record.id,
  version,
  createdAt: '2025-09-03T09:00:00.000Z',
  updatedAt: '2025-09-03T09:00:00.000Z',
  archivedAt: null,
  record,
})

const awaitingSignatory: ContractRecord = { ...base, id: 'k-imza' }
const awaitingApproval: ContractRecord = { ...base, id: 'k-onay', signatory }
const approved: ContractRecord = { ...base, id: 'k-onayli', signatory, approval }

describe('ON-041 IST-092 mobil veli sözleşmeleri', () => {
  test('IST-092 ekran yalnız veliye ve finans modülü açıkken açılır', () => {
    assert.equal(canOpenParentContracts({ role: 'veli', modules: {} }), true)
    assert.equal(canOpenParentContracts({ role: 'veli', modules: { finance: true } }), true)
    assert.equal(canOpenParentContracts({ role: 'veli', modules: { finance: false } }), false)
    for (const role of ['yonetici', 'onburo', 'ogretmen', 'ogrenci'] as const)
      assert.equal(canOpenParentContracts({ role, modules: {} }), false, role)
  })

  test('IST-092 liste iptal edilen ek protokolü gizler, onay bekleyen sürümü üste alır', () => {
    const amendmentApproved: ContractRecord = {
      ...base,
      id: 'k-ek-2',
      revision: 2,
      amendsContractId: 'k-onayli',
      signatory,
      approval,
    }
    const cancelled: ContractRecord = {
      ...base,
      id: 'k-ek-iptal',
      revision: 3,
      amendsContractId: 'k-ek-2',
      cancelledAt: '2026-01-02T09:00:00.000Z',
      cancelReason: 'Vazgeçildi',
    }
    const pending: ContractRecord = {
      ...base,
      id: 'k-ek-3',
      revision: 3,
      amendsContractId: 'k-ek-2',
      signatory,
    }
    const items = contractListItems([
      row(approved, 4),
      row(amendmentApproved),
      row(cancelled),
      row(pending, 7),
    ])
    assert.deepEqual(
      items.map((item) => [item.id, item.status]),
      [
        ['k-ek-3', 'awaiting_approval'],
        ['k-onayli', 'superseded'],
        ['k-ek-2', 'approved'],
      ],
    )
    const [first] = items
    assert.equal(first?.version, 7)
    assert.equal(first?.awaitingApproval, true)
    assert.equal(first?.tone, 'amber')
    assert.match(first?.subtitle ?? '', /Sürüm 3 · Ek protokol$/)
    assert.equal(
      first?.label,
      'Özel okul eğitim sözleşmesi, Sürüm 3 · Ek protokol, Ödeyici onayı bekleniyor',
    )
    assert.equal(awaitingApprovalCount(items), 1)
  })

  test('IST-092 ödeyicisi kursiyer olan sözleşme veli onayı beklemiyor sayılır', () => {
    const adult: ContractRecord = { ...awaitingApproval, payer: 'student' }
    const [item] = contractListItems([row(adult)])
    assert.equal(item?.status, 'awaiting_approval')
    assert.equal(item?.awaitingApproval, false)
    assert.equal(contractNotice(adult, 'awaiting_approval')?.title, 'Kursiyer onayı bekleniyor')
  })

  test('IST-092 onay bekleyen sürümde onayın web’den verildiği söylenir', () => {
    assert.equal(contractNotice(awaitingApproval, 'awaiting_approval'), APPROVAL_ON_WEB_NOTICE)
    assert.match(APPROVAL_ON_WEB_NOTICE.text, /web uygulamasında Sözleşmeler sayfasından/)
    assert.equal(
      contractNotice(awaitingSignatory, 'awaiting_signatory')?.title,
      'Kurum imzası bekleniyor',
    )
    assert.equal(contractNotice(approved, 'approved'), null)
    assert.equal(contractNotice(approved, 'superseded')?.title, 'Yerini ek protokole bıraktı')
    assert.equal(contractNotice(approved, 'cancelled')?.title, 'Ek protokol iptal edildi')
  })

  test('IST-092 künye web ile aynı satırları verir', () => {
    assert.deepEqual(
      contractFacts(awaitingSignatory, 'awaiting_signatory').map(([label]) => label),
      ['Sürüm', 'Durum', 'Sözleşme tarihi', 'Eğitim bedeli', 'İmza yetkilisi', 'Ödeyici onayı'],
    )
    const facts = new Map(contractFacts(approved, 'approved'))
    assert.equal(facts.get('İmza yetkilisi'), 'Mehmet Kurucu · Kurucu')
    assert.match(facts.get('Ödeyici onayı') ?? '', /^Elektronik onay · /)
    assert.equal(facts.get('Onaylayan ödeyici'), 'Ayşe Yılmaz')
    assert.match(facts.get('Eğitim bedeli') ?? '', /^196\.000,00\s₺$/)
    const cancelled = new Map(
      contractFacts(
        { ...base, cancelledAt: '2026-01-02T09:00:00.000Z', amendmentReason: 'Taksit değişikliği' },
        'cancelled',
      ),
    )
    assert.equal(cancelled.get('İptal gerekçesi'), '—')
    assert.equal(cancelled.get('Ek protokol gerekçesi'), 'Taksit değişikliği')
    assert.equal(contractVersionLabel({}), 'Sürüm 1')
  })

  test('IST-092 plan onaylı sürümde onay anının kopyasıdır, onaysızda güncel taksitler', () => {
    const snapshot = contractPlanView(approved, studentInvoices)
    assert.equal(snapshot.caption, 'Onaylanan ödeme planı')
    assert.equal(snapshot.rows.length, 1)
    assert.equal(snapshot.rows[0]?.kind, undefined)
    const current = contractPlanView(awaitingApproval, studentInvoices)
    assert.equal(current.caption, 'Güncel ödeme planı')
    assert.equal(current.rows.length, studentInvoices.length)
    assert.match(current.rows[0]?.title ?? '', /^1\. taksit · /)
    const proposed = contractPlanView(
      {
        ...awaitingApproval,
        proposedPlan: {
          kept: approval.plan,
          replacedInvoiceIds: [],
          added: [{ invoiceId: null, installment: 2, amount: 100, dueDate: '2026-10-10' }],
        },
      },
      studentInvoices,
    )
    assert.equal(proposed.caption, 'Ek protokolün önerdiği ödeme planı')
    assert.deepEqual(
      proposed.rows.map((item) => item.kind),
      ['Korunur', 'Yeni plan'],
    )
  })
})

const documentState = (contract: ContractRecord): State => ({
  ...seed,
  contracts: [contract],
})
const options = {
  institution: 'Akademi <Özel> Okulları',
  generatedAt: new Date('2026-09-01T09:00:00Z'),
}

describe('ON-041 IST-092 mobil sözleşme PDF belgesi', () => {
  test('IST-092 onay bekleyen sürümün belgesi plan ve imza yerlerini içerir', () => {
    const html = contractDocumentHtml(
      documentData(documentState(awaitingApproval), 'contract', awaitingApproval.id),
      options,
    )
    assert.match(html, /<html lang="tr">/)
    assert.match(html, /EĞİTİM SÖZLEŞMESİ/)
    assert.match(html, /Sürüm 1 · Ödeyici onayı bekleniyor/)
    assert.match(html, /Deniz Yılmaz/)
    assert.match(html, /Ek 1 \/ Ödeme planı/)
    assert.match(html, /<thead><tr><th>Taksit<\/th>/)
    assert.match(html, /Ödeyici onayı: Bekleniyor/)
    assert.match(html, /Kurucu · Mehmet Kurucu/)
    assert.match(html, /counter\(page\)/)
    assert.match(html, /Belge no: k-onay/)
    // Kurum adı kaçışlıdır; HTML'e ham `<` yazılmaz.
    assert.match(html, /Akademi &lt;Özel&gt; Okulları/)
    assert.doesNotMatch(html, /<Özel>/)
  })

  test('IST-092 onaylı ek protokolün belgesi onay bilgisini ve gerekçeyi yazar', () => {
    const amendment: ContractRecord = {
      ...approved,
      id: 'k-ek-2',
      revision: 2,
      amendsContractId: 'k-onayli',
      amendmentReason: '<script>alert(1)</script>',
    }
    const html = contractDocumentHtml(
      documentData(documentState(amendment), 'contract', amendment.id),
      options,
    )
    assert.match(html, /EK PROTOKOL/)
    assert.match(html, /Değiştirdiği sürüm/)
    assert.match(html, /Ödeyici onayı: Elektronik onay · /)
    assert.match(html, /Veli · Ayşe Yılmaz/)
    assert.match(html, /onaylanmıştır; değişiklik yalnız ek protokolle yapılır/)
    assert.doesNotMatch(html, /<script>/)
    assert.match(html, /&lt;script&gt;/)
  })

  test('IST-092 belge verisi sözleşmesizse kullanıcıya Türkçe hata gider', () => {
    const data = documentData(documentState(approved), 'contract', approved.id)
    assert.throws(
      () => contractDocumentHtml({ ...data, contract: null }, options),
      (error: unknown) => error instanceof DomainError && error.code === 'contract_not_found',
    )
    assert.equal(
      contractDocumentErrorMessage(new DomainError('x', 'Sözleşme kaydı bulunamadı.')),
      'Sözleşme kaydı bulunamadı.',
    )
    assert.equal(
      contractDocumentErrorMessage(new Error('ağ')),
      'Sözleşme belgesi hazırlanamadı. Lütfen yeniden deneyin.',
    )
    assert.equal(escapeHtml(null), '—')
    assert.equal(contractDocumentName('k/../1 a'), 'kampus-sozlesme-k1a.pdf')
  })
})

describe('ON-041 IST-124 mobil ekran kaydı satırı', () => {
  const entry: ScreenEntry = CONTRACT_APPROVAL_SCREEN

  test('IST-124 sözleşme ekranı kayda eklenince kurallara uyar', () => {
    const registered = SCREEN_REGISTRY.some((item) => item.screen === entry.screen)
    const registry: readonly ScreenEntry[] = registered
      ? SCREEN_REGISTRY
      : [...SCREEN_REGISTRY, entry]
    assert.deepEqual(screenRegistryIssues(registry), [])
    assert.deepEqual(
      entry.pages.map((page) => `${page.role}/${page.path}`),
      ['veli/sozlesmeler'],
    )
  })

  test('IST-124 ekran dosyası var ve varsayılan bileşen verir', () => {
    const path = /require\('(\.\/screens\/[\w-]+\.tsx)'\)\.default/.exec(
      entry.getComponent.toString(),
    )?.[1]
    assert.equal(path, './screens/contract-approval.tsx')
    const url = new URL(`../apps/mobile/src/api/${path}`, import.meta.url)
    assert.ok(existsSync(url))
    assert.match(readFileSync(url, 'utf8'), /^export default function ParentContracts\(/m)
  })

  test('IST-124 kayıtlıysa veli finans menüsünde görünür, finans kapalıyken gizlenir', (t) => {
    if (!SCREEN_REGISTRY.some((item) => item.screen === entry.screen)) {
      t.skip('Kayıt satırı henüz screen-registry.ts ONUR_SCREENS dizisinde değil (Oğuzhan)')
      return
    }
    const titles = (modules: Record<string, boolean>) =>
      apiPages({ role: 'veli', modules }).map((page) => page.path)
    assert.ok(titles({}).includes('sozlesmeler'))
    assert.ok(!titles({ finance: false }).includes('sozlesmeler'))
  })
})
