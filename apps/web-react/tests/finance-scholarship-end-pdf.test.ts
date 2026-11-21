import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ScholarshipEndRecord } from '@kampus/react-shared/use-finance-scholarships.ts'
import {
  interestBasis,
  scholarshipEndDocument,
  scholarshipEndFilename,
} from '../src/lib/pdf/templates/finance-scholarship-end.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Burs kesme bildirimi ve geri isteme yazısı (DOM-FIN-025; ON-283, K-264…K-266).

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T15:00:00.000Z'),
}
const CONTEXT = { programName: 'Başarı Bursu', studentName: 'Deniz Yılmaz' }
const segment = (days: number, basisPoints: number, source: string) => ({
  from: '2024-05-15',
  to: '2024-06-01',
  days,
  basisPoints,
  source,
})
const record = (overrides: Partial<ScholarshipEndRecord> = {}): ScholarshipEndRecord => ({
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  awardId: 'award-1',
  contractId: 'contract-1',
  kind: 'revoke',
  reason: 'false_declaration',
  note: 'Gelir belgesi gerçeğe aykırı.',
  invoiceIds: ['inv-1', 'inv-2'],
  createdAt: '2026-10-06T09:00:00.000Z',
  effectiveDate: '2026-10-06',
  keptCents: 0,
  reinstatedCents: 750_000,
  principalCents: 750_000,
  interestCents: 10_356,
  clawbackDueDate: '2026-11-05',
  lines: [
    {
      dueDate: '2026-09-15',
      shareCents: 750_000,
      status: 'clawback',
      interestCents: 10_356,
      interestDays: 21,
      segments: [segment(21, 2_400, 'CBK 8484')],
    },
    {
      dueDate: '2026-11-15',
      shareCents: 750_000,
      status: 'reinstated',
      interestCents: 0,
      interestDays: 0,
      segments: [],
    },
  ],
  ...overrides,
})

test('DOM-FIN-025, K-266: geri isteme yazısı anapara, faiz, oran dönemi ve bilgi metnini taşır; gerekçe açıklaması yoktur', () => {
  const text = allTexts(scholarshipEndDocument(measurer, record(), CONTEXT, OPTIONS)).join(' ')
  for (const part of [
    'Burs iptali ve geri isteme yazısı',
    'Deniz Yılmaz',
    'Gerçek dışı beyan',
    '7.500,00 ₺',
    '103,56 ₺',
    '7.603,56 ₺',
    '21 gün %24',
    'Geri isteniyor',
    'Burs kalktı, yeni taksit',
    'CBK 8484',
  ])
    assert.ok(text.includes(part), part)
  assert.ok(!text.includes('Gelir belgesi gerçeğe aykırı.'))
  assert.equal(scholarshipEndFilename(record()), 'burs-geri-isteme-a1b2c3d4.pdf')
})

test('DOM-FIN-025, K-265: kesme bildirimi faiz satırı taşımaz; bilinmeyen neden "Diğer" yazılır', () => {
  const terminated = record({
    kind: 'terminate',
    reason: 'bilinmeyen',
    keptCents: 750_000,
    principalCents: 0,
    interestCents: 0,
    clawbackDueDate: null,
    lines: [
      { ...record().lines[0]!, status: 'kept', interestCents: 0, interestDays: 0, segments: [] },
      record().lines[1]!,
    ],
  })
  const text = allTexts(scholarshipEndDocument(measurer, terminated, CONTEXT, OPTIONS)).join(' ')
  assert.ok(text.includes('Burs kesme bildirimi'))
  assert.ok(text.includes('Diğer'))
  assert.ok(text.includes('Uygulandı, geri istenmez'))
  assert.ok(!text.includes('KANUNİ FAİZ'))
  assert.equal(scholarshipEndFilename(terminated), 'burs-kesme-a1b2c3d4.pdf')
})

test('K-266: faiz dönemi oran parçalarını sırayla yazar', () => {
  assert.equal(
    interestBasis({
      ...record().lines[0]!,
      segments: [segment(17, 900, 'BKK 2005/9831'), segment(30, 2_400, 'CBK 8484')],
    }),
    '17 gün %9 + 30 gün %24',
  )
  assert.equal(interestBasis(record().lines[1]!), '—')
})
