import assert from 'node:assert/strict'
import test from 'node:test'

import {
  balanceText,
  candidateWarnings,
  changedSubstitutes,
  chosenSubstitutes,
  currentChoices,
  leaveRequestBody,
  leaveRequestDefaults,
  leaveRequestFormField,
  leaveRequestFormSchema,
  lessonSummary,
  lessonText,
  previewQuery,
  rangeText,
  STATUS_OPTIONS,
  statusLabel,
  statusTone,
  substituteOptionLabel,
  warningText,
  weekdayHint,
  type LeaveRequestFormValues,
} from '../src/pages/finance/finance-leave-request-forms.ts'

// İzin talebi formu ve gösterimi (DOM-FIN-116; ON-182; K-397…K-399).

const VALUES: LeaveRequestFormValues = {
  membershipId: 'm1',
  typeCode: 'annual',
  startDate: '2026-11-02',
  endDate: '2026-11-06',
  days: '5',
  description: ' ',
}
const LESSON = {
  lessonId: 'l1',
  startsAt: '2026-11-02T06:00:00.000Z',
  className: '9-A',
  classId: 'c1',
  title: 'Matematik',
  substituteTeacherId: null,
  candidateWarnings: [{ teacherId: 't2', warnings: ['busy' as const] }],
}
const messagesOf = (values: LeaveRequestFormValues) => {
  const result = leaveRequestFormSchema.safeParse(values)
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
}

test('DOM-FIN-116: talep gövdesi core şemasıyla denetlenir; yarım gün yok', () => {
  assert.deepEqual(leaveRequestBody(VALUES, { l1: 't2', l2: '' }), {
    membershipId: 'm1',
    typeCode: 'annual',
    startDate: '2026-11-02',
    endDate: '2026-11-06',
    days: 5,
    description: null,
    substitutes: [{ lessonId: 'l1', substituteTeacherId: 't2' }],
  })
  assert.deepEqual(messagesOf(VALUES), {})
  assert.match(messagesOf({ ...VALUES, days: '2,5' }).days ?? '', /yarım gün/)
  assert.match(messagesOf({ ...VALUES, endDate: '2026-11-01' }).endDate ?? '', /önce olamaz/)
  assert.equal(messagesOf({ ...VALUES, membershipId: '' }).membershipId, 'Personel seçin.')
  assert.ok(messagesOf({ ...VALUES, description: 'x'.repeat(501) }).description)
  assert.equal(leaveRequestFormField('days'), 'days')
  assert.equal(leaveRequestFormField('substitutes.0.lessonId'), undefined)
  assert.equal(leaveRequestDefaults('2026-11-07').days, '1')
  assert.equal(leaveRequestDefaults('2026-11-02').days, '1')
})

test('DOM-FIN-116: önizleme sorgusu personel ve geçerli aralık ister', () => {
  assert.deepEqual(previewQuery(VALUES), {
    membershipId: 'm1',
    startDate: '2026-11-02',
    endDate: '2026-11-06',
    typeCode: 'annual',
    days: 5,
  })
  assert.equal(previewQuery({ ...VALUES, membershipId: '' }), null)
  assert.equal(previewQuery({ ...VALUES, startDate: '' }), null)
  assert.equal(previewQuery({ ...VALUES, endDate: 'x' }), null)
  assert.equal(previewQuery({ ...VALUES, endDate: '2026-11-01' }), null)
  assert.deepEqual(previewQuery({ ...VALUES, typeCode: '', days: '' }), {
    membershipId: 'm1',
    startDate: '2026-11-02',
    endDate: '2026-11-06',
  })
  assert.match(weekdayHint('2026-11-02', '2026-11-08') ?? '', /5 hafta içi gün/)
  assert.equal(weekdayHint('', '2026-11-08'), undefined)
  assert.equal(weekdayHint('2026-11-08', '2026-11-02'), undefined)
})

test('DOM-FIN-116: yedek seçimi yalnız değişenleri gönderir; uyarılar etikette', () => {
  const lessons = [LESSON, { ...LESSON, lessonId: 'l2', substituteTeacherId: 't3' }]
  assert.deepEqual(currentChoices(lessons), { l1: '', l2: 't3' })
  assert.deepEqual(changedSubstitutes(lessons, { l1: '', l2: 't3' }), [])
  assert.deepEqual(changedSubstitutes(lessons, { l1: 't2', l2: '' }), [
    { lessonId: 'l1', substituteTeacherId: 't2' },
    { lessonId: 'l2', substituteTeacherId: null },
  ])
  assert.deepEqual(chosenSubstitutes({ l1: '', l2: 't3' }), [
    { lessonId: 'l2', substituteTeacherId: 't3' },
  ])
  assert.deepEqual(candidateWarnings(LESSON, 't2'), ['busy'])
  assert.deepEqual(candidateWarnings(LESSON, 't3'), [])
  assert.equal(
    substituteOptionLabel({ id: 't2', name: 'Murat Demir', subjectId: 'mat' }, LESSON),
    'Murat Demir (bu saatte başka dersi var)',
  )
  assert.equal(
    substituteOptionLabel({ id: 't3', name: 'Ayla Şen', subjectId: 'fen' }, LESSON),
    'Ayla Şen',
  )
  assert.equal(warningText(['on_leave', 'other_subject']), 'Bu gün izinli, Başka branştan')
  assert.match(lessonText(LESSON), /09:00 · 9-A · Matematik$|09\.00 · 9-A · Matematik$/)
  assert.match(lessonText({ ...LESSON, className: null }), /· c1 ·/)
})

test('DOM-FIN-116: durum, bakiye ve ders özeti metinleri', () => {
  assert.equal(statusLabel('pending'), 'Onay bekliyor')
  assert.deepEqual((['pending', 'approved', 'rejected', 'cancelled'] as const).map(statusTone), [
    'amber',
    'green',
    'red',
    'gray',
  ])
  assert.equal(STATUS_OPTIONS.length, 4)
  assert.equal(balanceText(null), null)
  assert.equal(balanceText(4), 'Onaylanırsa kalan yıllık izin 4 gün.')
  assert.equal(balanceText(-1), 'Onaylanırsa yıllık izin -1 gün olur (avans izin).')
  assert.equal(lessonSummary({ lessonCount: 0, substitutedCount: 0 }), 'Ders yok')
  assert.equal(lessonSummary({ lessonCount: 2, substitutedCount: 1 }), '2 ders · 1 yedek')
  assert.match(rangeText({ startDate: '2026-11-02', endDate: '2026-11-02' }), /2026/)
  assert.match(rangeText({ startDate: '2026-11-02', endDate: '2026-11-06' }), / – /)
})
