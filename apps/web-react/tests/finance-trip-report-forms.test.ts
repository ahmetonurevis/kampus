import assert from 'node:assert/strict'
import test from 'node:test'

import type { TripReport, TripReportPhoto } from '@kampus/react-shared/use-finance-trip-reports.ts'

import {
  attendanceText,
  distributionRows,
  evaluationText,
  incidentLabel,
  photoBody,
  photoChanges,
  photoDefaults,
  photoFormSchema,
  reportChanges,
  reportDefaults,
  reportMeta,
} from '../src/pages/finance/finance-trip-report-forms.ts'

// Gezi raporu görünümünün saf mantığı (DOM-FIN-158; ON-158; K-529…K-531).

const report = {
  id: 'r-1',
  status: 'draft',
  summary: 'Gezi planlandığı gibi gerçekleşti.',
  incidentNote: null,
  outcomeNote: null,
  incidents: [
    {
      id: 'i-1',
      occurredAt: '2026-10-20T06:30:00.000Z',
      kind: 'fall',
      location: 'Müze merdiveni',
      status: 'draft',
    },
  ],
  createdByName: 'Selin Kaya',
  createdAt: '2026-10-21T08:00:00.000Z',
  submittedAt: '2026-10-21T09:00:00.000Z',
  submittedByName: 'Selin Kaya',
  decidedAt: null,
  decidedByName: null,
  returnReason: null,
  canEdit: true,
  canDecide: false,
  version: 2,
  photos: [],
} satisfies TripReport

const photo = {
  id: 'p-1',
  fileId: 'f-1',
  caption: 'Anıtkabir',
  noStudentsVisible: false,
  shareWithFamilies: true,
  position: 0,
  contentType: 'image/png',
  byteSize: 100,
  students: [{ studentId: 's-1', studentName: 'Deniz Yılmaz', consent: true }],
  visibility: 'awaiting_approval',
  url: null,
  expiresAt: null,
  version: 1,
} satisfies TripReportPhoto

test('DOM-FIN-158: rapor formu yalnız değişen alanları gönderir; boş metin null (K-529)', () => {
  const values = reportDefaults(report)
  assert.deepEqual(values, {
    summary: report.summary,
    incidentNote: '',
    incidentIds: ['i-1'],
    outcomeNote: '',
  })
  assert.equal(reportChanges(report, values), null)
  assert.deepEqual(
    reportChanges(report, { ...values, summary: '  ', outcomeNote: ' Kazanım ', incidentIds: [] }),
    { summary: null, outcomeNote: 'Kazanım', incidentIds: [] },
  )
})

test('DOM-FIN-158: fotoğraf formu etiket ya da "öğrenci görünmüyor" ister (K-530)', () => {
  assert.equal(photoFormSchema.safeParse(photoDefaults()).success, false)
  assert.equal(
    photoFormSchema.safeParse({ ...photoDefaults(), noStudentsVisible: true }).success,
    true,
  )
  assert.deepEqual(photoBody({ ...photoDefaults(photo), noStudentsVisible: true }), {
    caption: 'Anıtkabir',
    studentIds: [],
    noStudentsVisible: true,
    shareWithFamilies: true,
  })
  assert.equal(photoChanges(photo, photoDefaults(photo)), null)
  assert.deepEqual(
    photoChanges(photo, { ...photoDefaults(photo), shareWithFamilies: false, caption: '' }),
    { caption: null, shareWithFamilies: false },
  )
})

test('DOM-FIN-158: katılım, değerlendirme ve bilgi metinleri (K-529, K-531)', () => {
  assert.equal(
    attendanceText({
      source: 'none',
      rosterCount: 0,
      attendedCount: 0,
      absentCount: 0,
      frozen: false,
    }),
    'Gezi günü yoklaması yapılmadı; katılım sayısı yok.',
  )
  assert.equal(
    attendanceText({
      source: 'trip_day',
      rosterCount: 3,
      attendedCount: 2,
      absentCount: 1,
      frozen: true,
    }),
    'Katılan 2 · Katılmayan 1 (listede 3) · gönderimde donduruldu',
  )
  assert.equal(
    evaluationText({
      responses: 0,
      hidden: false,
      average: null,
      distribution: null,
      comments: null,
    }),
    'Henüz katılımcı değerlendirmesi yok.',
  )
  assert.match(
    evaluationText({
      responses: 2,
      hidden: true,
      average: null,
      distribution: null,
      comments: null,
    }),
    /en az 5 yanıtta/,
  )
  assert.equal(
    evaluationText({
      responses: 5,
      hidden: false,
      average: 3.6,
      distribution: [0, 1, 1, 2, 1],
      comments: [],
    }),
    '5 yanıt · ortalama 3,6 / 5',
  )
  assert.deepEqual(distributionRows([0, 1, 1, 2, 1]), [
    '5 puan: 1',
    '4 puan: 2',
    '3 puan: 1',
    '2 puan: 1',
    '1 puan: 0',
  ])
  assert.deepEqual(distributionRows(null), [])
  assert.match(incidentLabel(report.incidents[0]!), /^20 Eki 2026 09:30 · .+ · Müze merdiveni$/)
  assert.deepEqual(reportMeta(report).length, 2)
})
