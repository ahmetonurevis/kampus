import assert from 'node:assert/strict'
import test from 'node:test'

import {
  actionsText,
  consentPeriodText,
  consentStatusBadge,
  dischargeBody,
  dischargeDefaults,
  dischargeFormSchema,
  rejectFormSchema,
  scheduleSlotText,
  visitCreateBody,
  visitDefaults,
  visitFormField,
  visitFormSchema,
  visitStatusBadge,
  visitTimeText,
} from '../src/pages/finance/finance-infirmary-forms.ts'

// Revir sekmesinin saf mantığı (DOM-FIN-151; ON-101; K-508…K-510).

const NOW = new Date('2026-10-06T09:00:00.000Z')

test('DOM-FIN-151: ziyaret formu varsayılanı İstanbul gün ve saati; gövde +03:00 ve boş not null', () => {
  const values = visitDefaults(NOW)
  assert.equal(values.arrivedDate, '2026-10-06')
  assert.equal(values.arrivedTime, '12:00')
  assert.equal(visitFormSchema.safeParse(values).success, false)
  const filled = {
    ...values,
    studentId: 's-1',
    complaint: ' Baş ağrısı ',
    actions: ['rest' as const],
    note: '  ',
  }
  assert.equal(visitFormSchema.safeParse(filled).success, true)
  assert.deepEqual(visitCreateBody(filled), {
    studentId: 's-1',
    arrivedAt: '2026-10-06T12:00:00+03:00',
    referredByMembershipId: null,
    complaint: 'Baş ağrısı',
    actions: ['rest'],
    note: null,
  })
  assert.equal(
    visitCreateBody({ ...filled, referredByMembershipId: 'm-1' }).referredByMembershipId,
    'm-1',
  )
  assert.equal(visitFormSchema.safeParse({ ...filled, actions: ['rest', 'rest'] }).success, false)
  assert.equal(visitFormField('arrivedAt'), 'arrivedTime')
  assert.equal(visitFormField('actions.0'), 'actions')
  assert.equal(visitFormField('incidentReportId'), null)
})

test('DOM-FIN-151: kapatma formu en az bir yapılan ister; mevcut yapılanlarla açılır', () => {
  const defaults = dischargeDefaults({ actions: ['rest'], note: null })
  assert.deepEqual(defaults, { outcome: 'returned_to_class', actions: ['rest'], note: '' })
  assert.equal(dischargeFormSchema.safeParse({ ...defaults, actions: [] }).success, false)
  assert.deepEqual(dischargeBody({ ...defaults, outcome: 'went_home', note: ' Ateş ' }), {
    outcome: 'went_home',
    actions: ['rest'],
    note: 'Ateş',
  })
  assert.equal(rejectFormSchema.safeParse({ reason: 'kısa' }).success, false)
  assert.equal(rejectFormSchema.safeParse({ reason: 'Doktor raporu gerekli.' }).success, true)
})

test('DOM-FIN-151: rozet ve tablo metinleri', () => {
  assert.deepEqual(visitStatusBadge({ status: 'open', outcome: null }), {
    text: 'Revirde',
    tone: 'amber',
  })
  assert.equal(visitStatusBadge({ status: 'closed', outcome: 'referred' }).text, 'Sevk edildi')
  assert.equal(visitStatusBadge({ status: 'closed', outcome: 'went_home' }).text, 'Eve gitti')
  assert.equal(visitStatusBadge({ status: 'closed', outcome: 'returned_to_class' }).tone, 'green')
  assert.match(
    visitTimeText({ arrivedAt: '2026-10-06T08:30:00Z', returnedAt: null }),
    /11:30 – revirde$/,
  )
  assert.match(
    visitTimeText({ arrivedAt: '2026-10-06T08:30:00Z', returnedAt: '2026-10-06T09:00:00Z' }),
    /11:30 – 12:00$/,
  )
  assert.equal(actionsText([]), 'Henüz yok')
  assert.equal(actionsText(['rest', 'guardian_called']), 'Dinlenme, Veli çağrıldı')
  assert.deepEqual(consentStatusBadge({ status: 'withdrawn' }), {
    text: 'Geri çekildi',
    tone: 'gray',
  })
  assert.match(
    consentPeriodText({
      startDate: '2026-10-06',
      endDate: '2026-10-08',
      times: ['09:00', '12:30'],
    }),
    /09:00, 12:30$/,
  )
  assert.equal(scheduleSlotText({ administration: null }), 'Verilmedi')
  assert.equal(
    scheduleSlotText({
      administration: {
        id: 'a',
        administeredAt: '2026-10-06T09:31:00Z',
        administeredByName: 'Büşra',
      },
    }),
    'Verildi 12:31 · Büşra',
  )
})
