import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  EmergencyCard,
  EmergencyClassCards,
} from '@kampus/react-shared/use-finance-emergency-summaries.ts'

import {
  alertText,
  contactText,
  contactsText,
  medicationTodayText,
} from '../src/lib/finance-emergency-summary-text.ts'
import {
  emergencySummariesDocument,
  emergencySummariesFilename,
  emergencySummariesReference,
} from '../src/lib/pdf/templates/finance-emergency-summaries.ts'
import {
  actionFormSchema,
  summaryFormField,
  summaryFormSchema,
  summaryStateBadge,
} from '../src/pages/finance/finance-emergency-summary-forms.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Acil durum özetleri sekmesi ve sınıf PDF'i (DOM-FIN-155; ON-165; K-520…K-522).

const NOW = new Date('2026-10-06T09:00:00.000Z')
const ACTION = 'Arı sokmasında adrenalin kalem çantada; 112 ara.'

const card = (overrides: Partial<EmergencyCard> = {}): EmergencyCard => ({
  summaryId: 'es-1',
  studentId: 's1',
  studentName: 'Deniz Yılmaz',
  classId: '7-A',
  className: '7-A',
  actionText: ACTION,
  alerts: { allergy: true, chronic: false, medication: true },
  medicationToday: true,
  contacts: [
    {
      position: 1,
      name: 'Ayşe Yılmaz',
      relationship: 'mother',
      phoneMasked: '0532 *** ** 12',
      hasPhone: true,
    },
  ],
  needsReview: false,
  approvedAt: NOW.toISOString(),
  ...overrides,
})

const list = (cards: EmergencyCard[]): EmergencyClassCards => ({
  classId: '7-A',
  className: '7-A',
  listDate: '2026-10-06',
  purpose: 'print',
  cards,
})

test('K-520: durum rozeti; gözden geçirilmeli öne geçer', () => {
  assert.deepEqual(summaryStateBadge({ state: 'draft', needsReview: false }), {
    text: 'Onay bekliyor',
    tone: 'amber',
  })
  assert.deepEqual(summaryStateBadge({ state: 'published', needsReview: false }), {
    text: 'Yayında',
    tone: 'green',
  })
  assert.deepEqual(summaryStateBadge({ state: 'published', needsReview: true }), {
    text: 'Gözden geçirilmeli',
    tone: 'red',
  })
})

test('K-520: form şeması metni 10–500 karakterde tutar; alan eşlemesi', () => {
  assert.equal(summaryFormSchema.safeParse({ studentId: '', actionText: ACTION }).success, false)
  assert.equal(actionFormSchema.safeParse({ actionText: 'kısa' }).success, false)
  assert.equal(actionFormSchema.safeParse({ actionText: ACTION }).success, true)
  assert.equal(summaryFormField('actionText'), 'actionText')
  assert.equal(summaryFormField('institutionId'), null)
})

test('K-522: kart metinleri tür ve maskeli telefon taşır; tanı yok', () => {
  assert.equal(alertText(card()), 'Alerji · Düzenli ilaç')
  assert.equal(
    alertText(card({ alerts: { allergy: false, chronic: false, medication: false } })),
    'Uyarı yok',
  )
  assert.equal(medicationTodayText(card()), 'Bugün okulda verilecek onaylı ilaç var')
  assert.equal(medicationTodayText(card({ medicationToday: false })), 'Bugün okulda ilaç yok')
  const [contact] = card().contacts
  assert.ok(contact)
  assert.equal(contactText(contact), 'Ayşe Yılmaz (Anne) 0532 *** ** 12')
  assert.equal(contactText(contact, '0532 111 22 12'), 'Ayşe Yılmaz (Anne) 0532 111 22 12')
  assert.equal(contactsText(card({ contacts: [] })), '—')
})

test('K-521: sınıf PDF’i özet başına acil eylem, uyarı, ilaç ve maskeli iletişim; tam telefon yok', () => {
  assert.equal(emergencySummariesReference(list([])), 'ACL-20261006-7A')
  assert.equal(emergencySummariesFilename(list([])), 'acil-durum-ozetleri-ACL-20261006-7A.pdf')
  const texts = allTexts(
    emergencySummariesDocument(
      measurer,
      list([card(), card({ studentId: 's2', studentName: 'Ece Yılmaz', needsReview: true })]),
      {
        institution: 'Akademi Özel Okulları',
        generatedAt: NOW,
      },
    ),
  ).join('\n')
  for (const expected of [
    'ACİL DURUM ÖZETİ',
    'Deniz Yılmaz',
    'Ece Yılmaz',
    'Alerji · Düzenli ilaç',
    '0532 *** ** 12',
    'gözden geçiriliyor',
  ])
    assert.ok(texts.includes(expected), expected)
  assert.ok(!texts.includes('0532 111'))
  const empty = allTexts(
    emergencySummariesDocument(measurer, list([]), { institution: 'Akademi', generatedAt: NOW }),
  ).join('\n')
  assert.ok(empty.includes('onaylanmış acil durum özeti yok'))
})
