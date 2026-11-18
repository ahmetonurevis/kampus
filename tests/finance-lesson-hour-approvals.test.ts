import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertLessonHoursWritable,
  isLessonSheetApproved,
  LESSON_CONFIRMATION_CHANNEL_LABELS,
  LESSON_CONFIRMATION_CHANNELS,
  LESSON_SHEET_APPROVER_ROLES,
  LESSON_SHEET_ROLES,
  LESSON_SHEET_STATUS_LABELS,
  LESSON_SHEET_STATUSES,
  lessonConfirmationInputSchema,
  lessonEntriesFingerprint,
  lessonHoursForPayroll,
  lessonSheetApproveSchema,
  lessonSheetReopenSchema,
  lessonSheetStatus,
  lessonSheetSubmitSchema,
  lessonTeacherStates,
  planLessonConfirmation,
  planLessonSheetApproval,
  planLessonSheetReopen,
  planLessonSheetSubmit,
  staffFingerprints,
  type LessonConfirmationRecord,
  type LessonTeacherState,
} from '../packages/school-core/src/lib/finance-lesson-hour-approvals.ts'
import {
  payrollExportCsv,
  payrollExportLines,
  type PayrollLessonHours,
  type PayrollRate,
  type PayrollStaff,
} from '../packages/school-core/src/lib/finance-payroll-exports.ts'

import { isDomainError } from './support/domain-error.ts'

// Ek ders çizelgesi onayı (DOM-FIN-120; ON-196). Kararlar K-409…K-411.

const HASH = 'a'.repeat(64)
const DRAFT = { status: 'draft' as const }
const REVIEW = { status: 'teacher_review' as const }
const APPROVED = { status: 'approved' as const }

test('DOM-FIN-120: durumlar, roller ve kanallar (K-409)', () => {
  assert.deepEqual(LESSON_SHEET_STATUSES, ['draft', 'teacher_review', 'approved'])
  assert.equal(LESSON_SHEET_STATUS_LABELS.approved, 'Müdür onaylı (kilitli)')
  assert.deepEqual(LESSON_SHEET_ROLES, ['yonetici', 'onburo'])
  assert.deepEqual(LESSON_SHEET_APPROVER_ROLES, ['yonetici'])
  for (const channel of LESSON_CONFIRMATION_CHANNELS)
    assert.ok(LESSON_CONFIRMATION_CHANNEL_LABELS[channel].length > 0)
  assert.equal(lessonSheetStatus(null), 'draft')
  assert.equal(lessonSheetStatus(REVIEW), 'teacher_review')
  assert.equal(isLessonSheetApproved(null), false)
  assert.equal(isLessonSheetApproved(APPROVED), true)
})

test('DOM-FIN-120: öğretmen yanıtı şeması; itirazda gerekçe zorunlu, teyitte yazılmaz', () => {
  const confirmed = lessonConfirmationInputSchema.parse({
    membershipId: ' m-selin ',
    outcome: 'confirmed',
    channel: 'phone',
  })
  assert.deepEqual(confirmed, {
    membershipId: 'm-selin',
    outcome: 'confirmed',
    channel: 'phone',
    reason: null,
  })
  const disputed = lessonConfirmationInputSchema.parse({
    membershipId: 'm-selin',
    outcome: 'disputed',
    channel: 'signed_sheet',
    reason: '  Nöbet 2 saat eksik  ',
  })
  assert.equal(disputed.reason, 'Nöbet 2 saat eksik')
  for (const bad of [
    { membershipId: 'm', outcome: 'disputed', channel: 'phone' },
    { membershipId: 'm', outcome: 'disputed', channel: 'phone', reason: 'kısa' },
    { membershipId: 'm', outcome: 'confirmed', channel: 'phone', reason: 'Gerekçe yazıldı' },
    { membershipId: 'm', outcome: 'confirmed', channel: 'fax' },
    { membershipId: '', outcome: 'confirmed', channel: 'phone' },
    { membershipId: 'm', outcome: 'confirmed', channel: 'phone', institutionId: 'x' },
    { membershipId: 'm', outcome: 'disputed', channel: 'phone', reason: 'x'.repeat(501) },
  ])
    assert.equal(lessonConfirmationInputSchema.safeParse(bad).success, false, JSON.stringify(bad))
  assert.equal(lessonSheetSubmitSchema.safeParse({}).success, true)
  assert.equal(lessonSheetSubmitSchema.safeParse({ month: '2026-10' }).success, false)
  assert.equal(lessonSheetApproveSchema.safeParse({ entriesHash: HASH }).success, true)
  assert.equal(lessonSheetApproveSchema.safeParse({ entriesHash: 'abc' }).success, false)
  assert.equal(lessonSheetReopenSchema.safeParse({ reason: 'Saat yanlış' }).success, true)
  assert.equal(lessonSheetReopenSchema.safeParse({ reason: ' abc ' }).success, false)
})

test('DOM-FIN-120: parmak izi kimlik ve sürüme bağlıdır, sıradan bağımsızdır', () => {
  const a = { id: 'h-1', membershipId: 'm-selin', version: 1 }
  const b = { id: 'h-2', membershipId: 'm-selin', version: 2 }
  const c = { id: 'h-3', membershipId: 'm-can', version: 1 }
  assert.equal(lessonEntriesFingerprint([b, a]), 'h-1:1|h-2:2')
  assert.equal(lessonEntriesFingerprint([]), '')
  assert.notEqual(
    lessonEntriesFingerprint([a, b]),
    lessonEntriesFingerprint([a, { ...b, version: 3 }]),
  )
  assert.deepEqual(
    staffFingerprints([a, c, b]),
    new Map([
      ['m-selin', 'h-1:1|h-2:2'],
      ['m-can', 'h-3:1'],
    ]),
  )
})

test('DOM-FIN-120: teyit durumu son yanıttan; kayıt değişince teyit bekleniyor olur', () => {
  const current = new Map([
    ['m-selin', 's2'],
    ['m-can', 'c1'],
    ['m-ece', 'e1'],
  ])
  const responses: LessonConfirmationRecord[] = [
    { membershipId: 'm-selin', outcome: 'disputed', entriesHash: 's1', sequence: 1 },
    { membershipId: 'm-selin', outcome: 'confirmed', entriesHash: 's2', sequence: 3 },
    { membershipId: 'm-can', outcome: 'confirmed', entriesHash: 'c0', sequence: 2 },
    { membershipId: 'm-ece', outcome: 'confirmed', entriesHash: 'e1', sequence: 4 },
    { membershipId: 'm-ece', outcome: 'disputed', entriesHash: 'e1', sequence: 5 },
    // Saati olmayan personelin yanıtı durum listesine girmez.
    { membershipId: 'm-yok', outcome: 'confirmed', entriesHash: 'x', sequence: 6 },
  ]
  const states = lessonTeacherStates(current, responses)
  assert.deepEqual(
    [...states].map(([id, value]) => [id, value.state, value.last?.sequence ?? null]),
    [
      ['m-selin', 'confirmed', 3],
      ['m-can', 'pending', 2],
      ['m-ece', 'disputed', 5],
    ],
  )
  assert.equal(lessonTeacherStates(new Map([['m-x', 'x']]), []).get('m-x')?.last, null)
})

test('DOM-FIN-120: gönderme yalnız taslakta ve saat kaydıyla (K-409)', () => {
  planLessonSheetSubmit(null, 2)
  planLessonSheetSubmit(DRAFT, 1)
  assert.throws(() => planLessonSheetSubmit(null, 0), isDomainError('lesson_sheet_empty'))
  for (const stored of [REVIEW, APPROVED])
    assert.throws(
      () => planLessonSheetSubmit(stored, 3),
      isDomainError('lesson_sheet_not_draft', 'conflict'),
    )
})

test('DOM-FIN-120: öğretmen yanıtı yalnız kontrolde; itiraz taslağa döndürür (K-409)', () => {
  assert.deepEqual(planLessonConfirmation(REVIEW, { outcome: 'confirmed' }, true), {
    nextStatus: 'teacher_review',
  })
  assert.deepEqual(planLessonConfirmation(REVIEW, { outcome: 'disputed' }, true), {
    nextStatus: 'draft',
  })
  for (const stored of [null, DRAFT, APPROVED])
    assert.throws(
      () => planLessonConfirmation(stored, { outcome: 'confirmed' }, true),
      isDomainError('lesson_sheet_not_in_review', 'conflict'),
    )
  assert.throws(
    () => planLessonConfirmation(REVIEW, { outcome: 'confirmed' }, false),
    isDomainError('lesson_confirmation_no_hours'),
  )
})

test('DOM-FIN-120: müdür onayı her personelin güncel teyidini ve damgayı ister (K-409)', () => {
  type States = Map<string, { state: LessonTeacherState }>
  const all: States = new Map([
    ['m-selin', { state: 'confirmed' }],
    ['m-can', { state: 'confirmed' }],
  ])
  const same = { expected: HASH, current: HASH }
  planLessonSheetApproval(REVIEW, all, same)
  for (const stored of [null, DRAFT, APPROVED])
    assert.throws(
      () => planLessonSheetApproval(stored, all, same),
      isDomainError('lesson_sheet_not_in_review', 'conflict'),
    )
  assert.throws(
    () => planLessonSheetApproval(REVIEW, all, { expected: HASH, current: 'b'.repeat(64) }),
    isDomainError('lesson_hours_changed', 'conflict'),
  )
  const missing: States = new Map([...all, ['m-ece', { state: 'pending' }]])
  assert.throws(
    () => planLessonSheetApproval(REVIEW, missing, same),
    (error: unknown) =>
      isDomainError('lesson_sheet_unconfirmed')(error) &&
      (error as Error).message.startsWith('1 personelin'),
  )
  const disputed: States = new Map([...all, ['m-ece', { state: 'disputed' }]])
  assert.throws(
    () => planLessonSheetApproval(REVIEW, disputed, same),
    isDomainError('lesson_sheet_unconfirmed'),
  )
})

test('DOM-FIN-120: kilit ve yeniden açma; bordroya yalnız onaylı saat girer (K-410, K-411)', () => {
  assertLessonHoursWritable(null)
  assertLessonHoursWritable(DRAFT)
  assertLessonHoursWritable(REVIEW)
  assert.throws(
    () => assertLessonHoursWritable(APPROVED),
    isDomainError('lesson_hours_locked', 'conflict'),
  )
  planLessonSheetReopen(APPROVED)
  for (const stored of [null, DRAFT, REVIEW])
    assert.throws(
      () => planLessonSheetReopen(stored),
      isDomainError('lesson_sheet_not_approved', 'conflict'),
    )
  const entries = [{ id: 'h-1' }, { id: 'h-2' }]
  assert.deepEqual(lessonHoursForPayroll(APPROVED, entries), entries)
  assert.notEqual(lessonHoursForPayroll(APPROVED, entries), entries)
  for (const stored of [null, DRAFT, REVIEW])
    assert.deepEqual(lessonHoursForPayroll(stored, entries), [])
})

test('DOM-FIN-120: onaysız ayın ek ders satırı "onay bekliyor", tutarsız ve toplama girmez (K-411)', () => {
  const staff: PayrollStaff[] = [
    { membershipId: 'm-selin', name: 'Selin Kaya', role: 'ogretmen', active: true },
  ]
  const rates: PayrollRate[] = [
    {
      id: 'r-lesson',
      membershipId: 'm-selin',
      component: 'lesson',
      rateType: 'extra',
      amountCents: 35_000,
      benefitForm: null,
      taxable: null,
      startDate: '2026-01-01',
      endDate: null,
    },
  ]
  const lessonHours: PayrollLessonHours[] = [
    { id: 'h-1', membershipId: 'm-selin', lessonType: 'extra', hours: 12, note: null, version: 1 },
  ]
  const pending = payrollExportLines({
    month: '2026-10',
    staff,
    rates,
    lessonHours,
    lessonHoursApproved: false,
  })
  const [line] = pending.lines
  assert.equal(line?.rateCents, 35_000)
  assert.equal(line?.quantity, 12)
  assert.equal(line?.totalCents, null)
  assert.deepEqual(line?.warnings, ['lesson_hours_pending'])
  assert.deepEqual(pending.totals, {
    lineCount: 1,
    staffCount: 1,
    earningCents: 0,
    deductionCents: 0,
    missingTotalCount: 1,
  })
  assert.ok(
    payrollExportCsv(pending.lines, null).includes(
      'Ek ders çizelgesi müdür onayı bekliyor; onaylanmadan ödenmez',
    ),
  )
  const approved = payrollExportLines({
    month: '2026-10',
    staff,
    rates,
    lessonHours,
    lessonHoursApproved: true,
  })
  assert.equal(approved.lines[0]?.totalCents, 420_000)
  assert.deepEqual(approved.lines[0]?.warnings, [])
  assert.equal(approved.totals.earningCents, 420_000)
})
