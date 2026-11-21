import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  LessonHourSheet,
  LessonHourSheetStaff,
} from '@kampus/react-shared/use-finance-lesson-hour-sheets.ts'

import {
  confirmationBody,
  confirmationDefaults,
  confirmationFormSchema,
  disputeFormSchema,
  reopenFormSchema,
  responseText,
  sheetActions,
  sheetTimeline,
} from '../src/pages/finance/finance-lesson-sheet-forms.ts'
import { payrollTotalText } from '../src/pages/finance/finance-payroll-export-forms.ts'

// Ek ders çizelgesi onayı ekranı (DOM-FIN-120; ON-196; K-409…K-411).

const staff = (overrides: Partial<LessonHourSheetStaff> = {}): LessonHourSheetStaff => ({
  membershipId: 'm-selin',
  staffName: 'Selin Kaya',
  role: 'ogretmen',
  staffActive: true,
  state: 'pending',
  totalHours: 12,
  entryCount: 1,
  lastResponse: null,
  ...overrides,
})

const sheet = (overrides: Partial<LessonHourSheet> = {}): LessonHourSheet => ({
  month: '2026-10',
  status: 'draft',
  version: null,
  payrollLocked: false,
  entriesHash: 'a'.repeat(64),
  submittedAt: null,
  submittedByName: null,
  approvedAt: null,
  approvedByName: null,
  approvalCount: 0,
  reopenedAt: null,
  reopenedByName: null,
  reopenReason: null,
  entries: [
    {
      id: 'h-1',
      membershipId: 'm-selin',
      staffName: 'Selin Kaya',
      role: 'ogretmen',
      staffActive: true,
      lessonType: 'extra',
      hours: 12,
      note: null,
      version: 1,
    },
  ],
  staff: [staff()],
  ...overrides,
})

test('DOM-FIN-120: eylemler durum ve kilide göre (K-409, K-410)', () => {
  assert.deepEqual(sheetActions(sheet()), {
    hoursLocked: false,
    canSubmit: true,
    canRespond: false,
    canApprove: false,
    canReopen: false,
    unconfirmed: 1,
  })
  assert.equal(sheetActions(sheet({ entries: [], staff: [] })).canSubmit, false)
  const review = sheet({ status: 'teacher_review' })
  assert.equal(sheetActions(review).canRespond, true)
  assert.equal(sheetActions(review).canApprove, false)
  const ready = sheet({ status: 'teacher_review', staff: [staff({ state: 'confirmed' })] })
  assert.equal(sheetActions(ready).canApprove, true)
  assert.equal(sheetActions({ ...ready, payrollLocked: true }).canApprove, false)
  const approved = sheet({ status: 'approved', staff: [staff({ state: 'confirmed' })] })
  assert.equal(sheetActions(approved).hoursLocked, true)
  assert.equal(sheetActions(approved).canReopen, true)
  assert.equal(sheetActions({ ...approved, payrollLocked: true }).canReopen, false)
  assert.equal(sheetActions(sheet({ payrollLocked: true })).hoursLocked, true)
  assert.equal(sheetActions(sheet({ payrollLocked: true })).canSubmit, false)
})

test('DOM-FIN-120: yanıt metni kanal, işleyen ve eskimiş teyidi gösterir', () => {
  assert.equal(responseText(staff()), 'Yanıt yok')
  const last = {
    outcome: 'disputed' as const,
    channel: 'phone' as const,
    reason: 'Nöbet eksik',
    recordedAt: '2026-10-06T07:00:00.000Z',
    recordedByName: 'Test Yönetici',
    current: true,
  }
  const text = responseText(staff({ lastResponse: last }))
  assert.match(text, /^İtiraz etti · Telefon · .+2026.+ · Test Yönetici$/)
  assert.match(
    responseText(staff({ lastResponse: { ...last, current: false, recordedByName: null } })),
    /\(saat sonradan değişti\)$/,
  )
})

test('DOM-FIN-120: çizelge geçmişi gönderme, onay sırası ve yeniden açma gerekçesi', () => {
  assert.deepEqual(sheetTimeline(sheet()), [])
  const rows = sheetTimeline(
    sheet({
      submittedAt: '2026-10-06T07:00:00.000Z',
      submittedByName: 'Ayşe',
      approvedAt: '2026-10-06T08:00:00.000Z',
      approvedByName: 'Müdür',
      approvalCount: 2,
      reopenedAt: '2026-10-06T09:00:00.000Z',
      reopenedByName: null,
      reopenReason: 'Saat yanlış',
    }),
  )
  assert.deepEqual(
    rows.map(([term]) => term),
    ['Öğretmen kontrolüne gönderildi', 'Müdür onayı (2.)', 'Yeniden açıldı'],
  )
  assert.match(rows[0]?.[1] ?? '', / · Ayşe$/)
  assert.match(rows[2]?.[1] ?? '', / · Saat yanlış$/)
  assert.equal(
    sheetTimeline(sheet({ approvedAt: '2026-10-06T08:00:00.000Z', approvalCount: 1 }))[0]?.[0],
    'Müdür onayı',
  )
})

test('DOM-FIN-120: yanıt ve yeniden açma formu; itirazda gerekçe zorunlu', () => {
  const values = confirmationDefaults()
  assert.equal(confirmationFormSchema.safeParse(values).success, true)
  assert.equal(disputeFormSchema.safeParse(values).success, false)
  assert.equal(disputeFormSchema.safeParse({ ...values, reason: ' Nöbet eksik ' }).success, true)
  assert.equal(confirmationFormSchema.safeParse({ channel: 'fax', reason: '' }).success, false)
  assert.deepEqual(confirmationBody('2026-10', 'm-1', 'confirmed', { ...values, reason: 'x' }), {
    month: '2026-10',
    membershipId: 'm-1',
    outcome: 'confirmed',
    channel: 'in_person',
    reason: null,
  })
  assert.equal(
    confirmationBody('2026-10', 'm-1', 'disputed', { channel: 'email', reason: ' Eksik saat ' })
      .reason,
    'Eksik saat',
  )
  assert.equal(reopenFormSchema.safeParse({ reason: 'abc' }).success, false)
  assert.equal(reopenFormSchema.safeParse({ reason: 'Saat yanlış' }).success, true)
})

test('DOM-FIN-120: onaysız ek ders tutarı "Onay bekliyor" (K-411)', () => {
  assert.equal(
    payrollTotalText({
      direction: 'earning',
      totalCents: null,
      warnings: ['lesson_hours_pending'],
    }),
    'Onay bekliyor',
  )
  assert.equal(
    payrollTotalText({ direction: 'earning', totalCents: null, warnings: ['partial_month'] }),
    'Bordroda hesaplanır',
  )
})
