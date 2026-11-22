import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  SocialActivityRow,
  SocialCertificate,
} from '@kampus/react-shared/use-finance-social-activities.ts'

import {
  socialActivityCertificateDocument,
  socialCertificateFilename,
  socialCertificateReference,
} from '../src/lib/pdf/templates/finance-social-activity-certificate.ts'
import {
  activityCreateBody,
  activityDefaults,
  activityFormField,
  activityFormSchema,
  activityUpdateBody,
  canReverse,
  entryBody,
  entryFormField,
  entryFormSchema,
  hourStatusText,
  organizationText,
  parseHours,
  periodText,
  progressText,
  targetsBody,
  targetsFormSchema,
  yearOptions,
} from '../src/pages/finance/finance-social-activity-forms.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Sosyal etkinlik saatleri sekmesi ve belge PDF'i (DOM-FIN-160; ON-170; K-535…K-537).

const NOW = new Date('2026-10-06T09:00:00.000Z')

const row = (overrides: Partial<SocialActivityRow> = {}): SocialActivityRow => ({
  id: 'a-1',
  name: 'Huzurevi ziyareti',
  kind: 'volunteering',
  startDate: '2026-09-15',
  endDate: null,
  location: 'Kadıköy',
  responsibleMembershipId: 'm-1',
  responsibleName: 'Emre Demir',
  organizationScope: 'external',
  organizationName: 'Kadıköy Huzurevi',
  clubId: null,
  clubName: null,
  approvedMinutes: 150,
  pendingCount: 1,
  version: 2,
  ...overrides,
})

test('DOM-FIN-160: etkinlik formu gövdesi, yalnız değişen alanlar ve kulüp bağı türe göre (K-535)', () => {
  const values = activityDefaults(row())
  assert.equal(values.endDate, '')
  assert.deepEqual(activityCreateBody(values), {
    name: 'Huzurevi ziyareti',
    kind: 'volunteering',
    startDate: '2026-09-15',
    endDate: null,
    location: 'Kadıköy',
    responsibleMembershipId: 'm-1',
    organizationScope: 'external',
    organizationName: 'Kadıköy Huzurevi',
    clubId: null,
  })
  assert.equal(activityUpdateBody(values, row()), null)
  assert.deepEqual(activityUpdateBody({ ...values, endDate: '2026-10-31' }, row()), {
    endDate: '2026-10-31',
  })
  assert.equal(activityCreateBody({ ...values, clubId: 'c-1' }).clubId, null)
  assert.equal(activityCreateBody({ ...values, kind: 'club', clubId: 'c-1' }).clubId, 'c-1')
  const issues = (extra: Partial<typeof values>) =>
    activityFormSchema
      .safeParse({ ...values, ...extra })
      .error?.issues.map((issue) => issue.path.join('.'))
  assert.deepEqual(issues({ organizationName: '' }), ['organizationName'])
  assert.deepEqual(issues({ endDate: '2026-09-01' }), ['endDate'])
  assert.equal(issues({ organizationScope: 'internal', organizationName: '' }), undefined)
  assert.equal(activityDefaults(undefined, '2026-10-06').startDate, '2026-10-06')
  assert.equal(activityFormField('organizationName'), 'organizationName')
  assert.equal(activityFormField('institutionId'), null)
})

test('DOM-FIN-160: saat virgüllü ve yarım saat adımlı; öğrenci hatası listeye eşlenir (K-536)', () => {
  assert.equal(parseHours('2,5'), 2.5)
  assert.equal(parseHours('3'), 3)
  for (const bad of ['0', '0,25', '1,2', '10,5', 'iki', ''])
    assert.equal(parseHours(bad), null, bad)
  const values = { activityDate: '2026-10-05', hours: '1,5', studentIds: ['s5', 's5'], note: ' ' }
  assert.equal(entryFormSchema.safeParse(values).success, true)
  assert.equal(entryFormSchema.safeParse({ ...values, studentIds: [] }).success, false)
  assert.deepEqual(entryBody(values), {
    activityDate: '2026-10-05',
    hours: 1.5,
    studentIds: ['s5'],
    note: null,
  })
  assert.equal(entryFormField('studentIds.1'), 'studentIds')
  assert.equal(entryFormField('hours'), 'hours')
  assert.equal(entryFormField('activityId'), null)
})

test('DOM-FIN-160: tablo metinleri, ters kayıt ve hedef formu (K-536, K-537)', () => {
  assert.equal(periodText(row()), '15 Eyl 2026 – süren')
  assert.equal(periodText(row({ endDate: '2026-09-15' })), '15 Eyl 2026')
  assert.equal(organizationText(row()), 'Kurum dışı · Kadıköy Huzurevi')
  assert.equal(
    organizationText(row({ organizationScope: 'internal', organizationName: null })),
    'Kurum içi',
  )
  const entry = { kind: 'entry' as const, status: 'approved' as const, reversedByEntryId: null }
  assert.equal(hourStatusText(entry), 'Onaylandı')
  assert.equal(canReverse(entry), true)
  assert.equal(hourStatusText({ ...entry, reversedByEntryId: 'r' }), 'Düzeltildi')
  assert.equal(canReverse({ ...entry, reversedByEntryId: 'r' }), false)
  assert.equal(hourStatusText({ ...entry, kind: 'reversal' }), 'Ters kayıt (düzeltme)')
  assert.equal(canReverse({ ...entry, status: 'pending' }), false)
  assert.equal(progressText(750, 40), '12,5 / 40 saat')
  assert.equal(progressText(60, null), '1 saat')
  assert.deepEqual(
    yearOptions(2026).map((option) => option.label),
    ['2026–2027', '2025–2026', '2024–2025', '2023–2024'],
  )
  assert.equal(
    targetsFormSchema.safeParse({ totalTargetHours: '0', yearlyTargetHours: '' }).success,
    false,
  )
  assert.deepEqual(targetsBody({ totalTargetHours: '40', yearlyTargetHours: '' }), {
    totalTargetHours: 40,
    yearlyTargetHours: null,
  })
})

test('DOM-FIN-160: belge PDF yalnız gelen onaylı satırları, yıl toplamını ve hedefi yazar (K-537)', () => {
  const certificate: SocialCertificate = {
    studentId: 's5',
    studentName: 'Elif Şahin',
    className: '9-A',
    grade: 9,
    issuedOn: '2026-10-06',
    totalMinutes: 150,
    totalTargetHours: 40,
    status: 'behind',
    years: [{ academicYear: 2026, minutes: 150 }],
    rows: [
      {
        entryId: 'h-1',
        activityDate: '2026-10-05',
        academicYear: 2026,
        activityName: 'Huzurevi ziyareti',
        activityKind: 'volunteering',
        organizationScope: 'external',
        organizationName: 'Kadıköy Huzurevi',
        location: 'Kadıköy',
        responsibleName: 'Emre Demir',
        minutes: 150,
      },
    ],
  }
  assert.equal(socialCertificateReference(certificate), 'SEG-20261006-S5')
  assert.equal(
    socialCertificateFilename(certificate),
    'sosyal-etkinlik-belgesi-SEG-20261006-S5.pdf',
  )
  const texts = allTexts(
    socialActivityCertificateDocument(measurer, certificate, {
      institution: 'Akademi Özel Okulları',
      generatedAt: NOW,
    }),
  ).join('\n')
  for (const expected of [
    'Sosyal etkinlik ve gönüllülük belgesi',
    'Elif Şahin',
    'Huzurevi ziyareti',
    'Kadıköy Huzurevi',
    '2,5 saat',
    '40 saat',
    '2026–2027',
  ])
    assert.ok(texts.includes(expected), expected)
  const empty = allTexts(
    socialActivityCertificateDocument(
      measurer,
      { ...certificate, rows: [], years: [], totalMinutes: 0 },
      { institution: 'Akademi', generatedAt: NOW },
    ),
  ).join('\n')
  assert.ok(empty.includes('Onaylanmış sosyal etkinlik'))
})
