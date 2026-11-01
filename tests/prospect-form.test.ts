import assert from 'node:assert/strict'
import test from 'node:test'

import {
  emptyProspectForm,
  meetingInstant,
  meetingSummary,
  PROSPECT_PRIVACY_NOTICE_VERSION,
  prospectFormSchema,
  prospectFormToBody,
  trialLessonOptions,
  trialLessonUsed,
  upcomingMeetings,
  type ProspectFormValues,
} from '../packages/school-core/src/lib/prospect-form.ts'
import { createProspectSchema } from '../packages/school-core/src/lib/prospects.ts'

const VALID: ProspectFormValues = {
  ...emptyProspectForm(),
  name: 'Test Aday',
  phone: '05551112233',
  branchId: 'b1',
  interest: '7. Sınıf',
  guardianName: 'Test Veli',
  privacyShown: true,
}
const issues = (values: ProspectFormValues) => {
  const parsed = prospectFormSchema.safeParse(values)
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'))
}

test('DOM-KAY-003, -009: form aydınlatma, veli ve referans ister', () => {
  assert.deepEqual(issues(VALID), [])
  assert.deepEqual(issues({ ...VALID, privacyShown: false }), ['privacyShown'])
  assert.deepEqual(issues({ ...VALID, guardianName: '' }), ['guardianName'])
  assert.deepEqual(issues({ ...VALID, minor: 'no', guardianName: '' }), [])
  assert.deepEqual(issues({ ...VALID, source: 'Veli referansı' }), ['referrerStudentId'])
  assert.deepEqual(issues({ ...VALID, phone: '555' }), ['phone'])
  assert.deepEqual(issues({ ...VALID, email: 'x' }), ['email'])
})

test('DOM-KAY-009: gövde API şemasından geçer; boş alan ve okulda yaş gönderilmez', () => {
  const body = prospectFormToBody(VALID, 'school')
  assert.equal(createProspectSchema.safeParse(body).success, true)
  assert.equal('email' in body, false)
  assert.equal('minor' in body, false)
  assert.equal('referrerStudentId' in body, false)
  assert.equal('siblingOfId' in body, false)
  assert.equal(body.privacyNoticeVersion, PROSPECT_PRIVACY_NOTICE_VERSION)
  assert.deepEqual(body.marketingConsent, { sms: false, email: false, call: false })

  const adult = prospectFormToBody(
    {
      ...VALID,
      minor: 'no',
      guardianName: '',
      email: 'a@b.co',
      consentSms: true,
      source: 'Veli referansı',
      referrerStudentId: 's1',
      siblingOfId: 'pr1',
    },
    'language_school',
  )
  assert.equal(createProspectSchema.safeParse(adult).success, true)
  assert.equal(adult.minor, false)
  assert.equal('guardianName' in adult, false)
  assert.equal(adult.referrerStudentId, 's1')
  assert.equal(adult.siblingOfId, 'pr1')
  assert.equal(adult.marketingConsent?.sms, true)
})

test('DOM-KAY-033: görüşme anı İstanbul saatinden UTC olur; geçersiz girdi reddedilir', () => {
  assert.equal(meetingInstant('2026-10-10', '14:00'), '2026-10-10T11:00:00.000Z')
  assert.equal(meetingInstant('', '14:00'), null)
  assert.equal(meetingInstant('2026-10-10', ''), null)
  assert.equal(meetingInstant('2026-13-40', '14:00'), null)
})

test('DOM-KAY-033: yaklaşan görüşmeler sıralı; geçmiş, kapalı ve görüşmesiz aday çıkar', () => {
  const meeting = (date: string) => ({ date, duration: 30, room: 'A' }) as never
  const list = upcomingMeetings(
    [
      { id: 'b', name: 'B', meeting: meeting('2026-10-12T09:00:00.000Z') },
      { id: 'a', name: 'A', meeting: meeting('2026-10-10T09:00:00.000Z') },
      { id: 'past', name: 'P', meeting: meeting('2026-10-01T09:00:00.000Z') },
      { id: 'lost', name: 'L', stage: 'Vazgeçti', meeting: meeting('2026-10-11T09:00:00.000Z') },
      { id: 'done', name: 'D', stage: 'Kayıt oldu', meeting: meeting('2026-10-11T09:00:00.000Z') },
      { id: 'none', name: 'N' },
    ],
    '2026-10-06',
  )
  assert.deepEqual(
    list.map((item) => item.id),
    ['a', 'b'],
  )
})

test('DOM-KAY-033: eski kayıtta görüşme anı trialAt alanındadır; süre ve oda boş kalır', () => {
  const list = upcomingMeetings(
    [
      { id: 'old', name: 'Eski', trialAt: '2026-10-11T09:00:00.000Z' },
      { id: 'past', name: 'Geçmiş', trialAt: '2026-10-01T09:00:00.000Z' },
      { id: 'empty', name: 'Yok', trialAt: null },
    ],
    '2026-10-06',
  )
  assert.deepEqual(list, [
    {
      key: 'old-meeting',
      kind: 'meeting',
      id: 'old',
      name: 'Eski',
      date: '2026-10-11T09:00:00.000Z',
      duration: null,
      room: null,
    },
  ])
  assert.equal(meetingSummary(list[0]!), null)
  assert.equal(meetingSummary({ duration: 45, room: 'Oda 1' }), '45 dk · Oda 1')
})

test('DOM-DIL-030: deneme dersi takvimde ayrı satırdır; iptal edilen ders listelenmez', () => {
  const trial = { lessonId: 'l1', date: '2026-10-12T09:00:00.000Z', duration: 40 }
  const list = upcomingMeetings([{ id: 'a', name: 'A', trialLesson: trial }], '2026-10-10')
  assert.deepEqual(
    list.map((row) => [row.key, row.kind, row.duration]),
    [['a-trial', 'trial', 40]],
  )
  assert.deepEqual(
    upcomingMeetings([{ id: 'a', name: 'A', trialLesson: trial }], '2026-10-10', new Set(['l1'])),
    [],
  )
})

test('DOM-DIL-030: seçenekler adayın kampüsündeki açık grupların gelecek dersleridir', () => {
  const now = '2026-10-06T09:00:00.000Z'
  const classes = [
    { id: 'c1', name: 'A2 Akşam', branchId: 'b1', isActive: true },
    { id: 'c2', name: 'Başka kampüs', branchId: 'b2', isActive: true },
    { id: 'c3', name: 'Kapalı', branchId: 'b1', isActive: false },
  ]
  const lessons = [
    { id: 'later', classId: 'c1', date: '2026-10-09T09:00:00.000Z' },
    { id: 'soon', classId: 'c1', date: '2026-10-07T09:00:00.000Z' },
    { id: 'past', classId: 'c1', date: '2026-10-05T09:00:00.000Z' },
    { id: 'cancelled', classId: 'c1', date: '2026-10-08T09:00:00.000Z', cancelledAt: now },
    { id: 'other', classId: 'c2', date: '2026-10-08T09:00:00.000Z' },
    { id: 'closed', classId: 'c3', date: '2026-10-08T09:00:00.000Z' },
  ]
  assert.deepEqual(
    trialLessonOptions(lessons, classes, 'b1', now).map((row) => row.id),
    ['soon', 'later'],
  )
  assert.equal(trialLessonUsed({ lessonId: 'past' }, lessons, now), true)
  assert.equal(trialLessonUsed({ lessonId: 'soon' }, lessons, now), false)
  assert.equal(trialLessonUsed({ lessonId: 'gone' }, lessons, now), false)
  assert.equal(trialLessonUsed(undefined, lessons, now), false)
})
