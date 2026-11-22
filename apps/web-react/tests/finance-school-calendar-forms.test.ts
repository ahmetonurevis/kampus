import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  SchoolCalendarLink,
  SchoolEvent,
} from '@kampus/react-shared/use-finance-school-calendar.ts'

import {
  audienceText,
  busyDays,
  createBody,
  eventDateText,
  eventDefaults,
  eventEnded,
  eventFormSchema,
  eventsOn,
  eventTimeText,
  eventValues,
  formField,
  linkDays,
  linksOn,
  linkTimeText,
  statusTone,
  updateBody,
} from '../src/pages/finance/finance-school-calendar-forms.ts'

// Okul takvimi sekmesinin saf mantığı (DOM-FIN-163; ON-090; K-544…K-546).

const event: SchoolEvent = {
  id: 'test-e1',
  title: 'Cumhuriyet Bayramı töreni',
  kind: 'ceremony',
  allDay: false,
  startDate: '2026-10-29',
  endDate: '2026-10-29',
  startTime: '09:30',
  endTime: '11:00',
  startsAt: '2026-10-29T06:30:00.000Z',
  endsAt: '2026-10-29T08:00:00.000Z',
  location: 'Okul bahçesi',
  description: null,
  audienceKind: 'class',
  audienceIds: ['c1', 'c9'],
  audienceLabels: ['7-A', '7-B'],
  cancelReason: null,
  status: 'draft',
  publishedAt: null,
  cancelledAt: null,
  updatedAt: '2026-10-06T09:00:00.000Z',
  version: 1,
}

const trip: SchoolCalendarLink = {
  source: 'trip_plan',
  sourceId: 'test-p1',
  reference: 'GZ-1',
  title: 'Anıtkabir gezisi',
  startsAt: '2026-10-20T05:00:00.000Z',
  endsAt: '2026-10-21T17:00:00.000Z',
  location: null,
}

const issuesOf = (values: unknown) => {
  const result = eventFormSchema.safeParse(values)
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
}

test('DOM-FIN-163: form varsayılanı geçerli; tüm günde saat gövdeye gitmez (K-544)', () => {
  const values = { ...eventDefaults('2026-10-15'), title: 'Veli toplantısı' }
  assert.deepEqual(issuesOf(values), [])
  const body = createBody({ ...values, allDay: true, kind: 'holiday', location: '  ' })
  assert.equal(body.startTime, null)
  assert.equal(body.endTime, null)
  assert.equal(body.location, null)
  assert.deepEqual(body.audienceIds, [])
})

test('DOM-FIN-163: form bütün hâl kurallarını çalıştırır', () => {
  const values = { ...eventDefaults('2026-10-15'), title: 'Tören' }
  assert.deepEqual(issuesOf({ ...values, kind: 'holiday' }), ['allDay'])
  assert.deepEqual(issuesOf({ ...values, endTime: '08:00' }), ['endTime'])
  assert.deepEqual(issuesOf({ ...values, startTime: '' }), ['startTime'])
  assert.deepEqual(issuesOf({ ...values, audienceKind: 'class' }), ['audienceIds'])
  assert.deepEqual(issuesOf({ ...values, endDate: '2026-10-14' }), ['endDate'])
  assert.deepEqual(issuesOf({ ...values, title: 'A' }), ['title'])
})

test('DOM-FIN-163: düzenleme gövdesi yalnız değişen alanları taşır', () => {
  const values = eventValues(event)
  assert.equal(updateBody(event, values), null)
  assert.deepEqual(updateBody(event, { ...values, title: 'Tören (salon)', location: '' }), {
    title: 'Tören (salon)',
    location: null,
  })
  assert.deepEqual(updateBody(event, { ...values, audienceIds: ['c9', 'c1'] }), null)
  assert.deepEqual(updateBody(event, { ...values, allDay: true }), {
    allDay: true,
    startTime: null,
    endTime: null,
  })
  assert.equal(formField('audienceIds'), 'audienceIds')
  assert.equal(formField('institutionId'), null)
})

test('DOM-FIN-163: gün hücresi etkinlikleri ve bağlantıları (K-546)', () => {
  const holiday = { ...event, id: 'test-e2', startDate: '2026-11-09', endDate: '2026-11-13' }
  assert.deepEqual(
    eventsOn([event, holiday], '2026-11-10').map((item) => item.id),
    ['test-e2'],
  )
  assert.deepEqual(linkDays(trip), { startDate: '2026-10-20', endDate: '2026-10-21' })
  assert.equal(linksOn([trip], '2026-10-21').length, 1)
  assert.equal(linksOn([trip], '2026-10-22').length, 0)
  const ticket = { ...trip, source: 'ticketed_event' as const, endsAt: null }
  assert.deepEqual(linkDays(ticket), { startDate: '2026-10-20', endDate: '2026-10-20' })
  assert.deepEqual(
    busyDays(['2026-10-19', '2026-10-20', '2026-10-29'], { events: [event], links: [trip] }),
    ['2026-10-20', '2026-10-29'],
  )
})

test('DOM-FIN-163: metinler', () => {
  assert.equal(eventDateText(event), '29 Ekim 2026')
  assert.equal(
    eventDateText({ startDate: '2026-11-09', endDate: '2026-11-13' }),
    '9 Kasım – 13 Kasım 2026',
  )
  assert.equal(eventTimeText(event), '09:30–11:00')
  assert.equal(eventTimeText({ ...event, allDay: true }), 'Tüm gün')
  assert.equal(audienceText(event), 'Sınıf: 7-A, 7-B')
  assert.equal(audienceText({ audienceKind: 'institution', audienceLabels: [] }), 'Tüm kurum')
  assert.equal(linkTimeText(trip), '20 Eki 08:00 – 21 Eki 20:00')
  assert.equal(
    linkTimeText({ ...trip, endsAt: '2026-10-20T17:00:00.000Z' }),
    '20 Eki 08:00 – 20:00',
  )
  assert.equal(linkTimeText({ ...trip, endsAt: null }), '20 Eki 08:00')
  assert.equal(statusTone('published'), 'green')
  assert.equal(statusTone('cancelled'), 'red')
  assert.equal(statusTone('draft'), 'amber')
  assert.equal(eventEnded(event, '2026-10-30'), true)
  assert.equal(eventEnded(event, '2026-10-29'), false)
})
