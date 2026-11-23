import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PaidActivityRoster } from '@kampus/react-shared/use-finance-paid-activities.ts'
import {
  paidActivityRosterDocument,
  paidActivityRosterFilename,
} from '../src/lib/pdf/templates/finance-paid-activity-roster.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Katılım listesi PDF'i (DOM-FIN-112, K-371): asiller ada göre, sonra yedekler sırasıyla; veli
// telefonu yalnız maskeli, izni verenin adı yazılmaz.

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T15:00:00.000Z'),
}

const activity: PaidActivityRoster['activity'] = {
  id: '0f9b6c1e-1111-4111-8111-111111111111',
  kind: 'trip',
  name: 'Efes gezisi',
  activityDate: '2026-10-20',
  feeCents: 90_000,
  joinDeadline: '2026-10-15',
  cancelDeadline: '2026-10-10',
  capacity: 2,
  lateRefundRule: 'percent',
  lateRefundPercent: 50,
  lateCostCents: null,
  externalRef: null,
  requiresConsent: true,
  permissionFormId: null,
  status: 'open',
  cancelledAt: null,
  cancelReason: null,
  participantCount: 2,
  awaitingConsentCount: 1,
  waitlistCount: 1,
  pendingRefundCount: 0,
  version: 1,
}

const item = (
  overrides: Partial<PaidActivityRoster['items'][number]>,
): PaidActivityRoster['items'][number] => ({
  id: 'p1',
  studentId: 's1',
  studentName: 'Deniz Yılmaz',
  className: '7-A',
  guardianPhoneMasked: '0532 *** ** 34',
  status: 'active',
  waitlistRank: null,
  consentStatus: 'granted',
  consentChannel: 'paper',
  paymentStatus: 'partial',
  amountCents: 90_000,
  collectedCents: 30_000,
  ...overrides,
})

test('DOM-FIN-112, K-371: liste asilleri, izin bekleyeni ve yedeği sırayla, maskeli telefonla yazar', () => {
  const roster: PaidActivityRoster = {
    activity,
    items: [
      item({
        id: 'p3',
        studentId: 's3',
        studentName: 'Ali Kaya',
        status: 'waitlisted',
        waitlistRank: 1,
        consentStatus: 'pending',
        consentChannel: null,
        paymentStatus: 'not_billed',
        amountCents: 0,
        collectedCents: 0,
      }),
      item({}),
      item({
        id: 'p2',
        studentId: 's2',
        studentName: 'Ece Yılmaz',
        status: 'awaiting_consent',
        consentStatus: 'pending',
        consentChannel: null,
        paymentStatus: 'not_billed',
      }),
    ],
  }
  const all = allTexts(paidActivityRosterDocument(measurer, roster, OPTIONS))
  // Dar sütunda hücre satırlara bölünür; metin birleştirilerek aranır.
  const joined = all.join(' ')
  for (const text of [
    'KATILIM LİSTESİ',
    'Efes gezisi',
    '0532 *** ** 34',
    'Asil',
    'İzin bekliyor',
    'Yedek 1',
    'İzin alındı · Kâğıt izin dilekçesi',
    'Taksit yok',
    '2 / 2',
  ])
    assert.ok(joined.includes(text), text)
  const order = ['Deniz Yılmaz', 'Ece Yılmaz', 'Ali Kaya'].map((name) => all.indexOf(name))
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  )
  assert.ok(order.every((index) => index >= 0))
  assert.equal(paidActivityRosterFilename(activity), 'katilim-listesi-GEZ-20261020-0F9B6C1E.pdf')
})

test('DOM-FIN-112: katılımcı yoksa liste boş olduğunu yazar', () => {
  const all = allTexts(paidActivityRosterDocument(measurer, { activity, items: [] }, OPTIONS))
  assert.ok(all.includes('Henüz katılımcı yok.'))
})
