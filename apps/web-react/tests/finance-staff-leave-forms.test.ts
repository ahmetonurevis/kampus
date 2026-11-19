import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  LeaveRecordView,
  LeaveTypeView,
} from '@kampus/react-shared/use-finance-staff-leave.ts'

import {
  accrualText,
  leaveProfileBody,
  leaveProfileDefaults,
  leaveProfileFormField,
  leaveProfileFormSchema,
  leaveProfileUpdateBody,
  leaveRecordBody,
  leaveRecordDefaults,
  leaveRecordFormSchema,
  leaveTypeDefaults,
  leaveTypeFormSchema,
  leaveTypeUpdateBody,
  NEW_LEAVE_TYPE_DEFAULTS,
  newLeaveTypeBody,
  newLeaveTypeFormSchema,
  rangeText,
  recordFlags,
  recordTitle,
  selectableLeaveTypes,
  typeFacts,
} from '../src/pages/finance/finance-staff-leave-forms.ts'

// Personel izin formları ve gösterimi (DOM-FIN-109; ON-181).

const PATERNITY: LeaveTypeView = {
  code: 'paternity',
  kind: 'excuse',
  label: 'Babalık izni (eşin doğumu)',
  paid: true,
  deductsFromAnnual: false,
  defaultDays: 5,
  statutoryMinDays: 5,
  isActive: true,
  isCustom: false,
  locked: ['paid', 'deductsFromAnnual'],
  version: 1,
}
const RECORD: LeaveRecordView = {
  id: 'l1',
  membershipId: 'm1',
  typeCode: 'annual',
  kind: 'annual',
  typeLabel: 'Yıllık ücretli izin',
  paid: true,
  deductsFromAnnual: true,
  startDate: '2026-07-06',
  endDate: '2026-07-10',
  days: 5,
  note: null,
  requestId: null,
  createdAt: '2026-07-01T09:00:00.000Z',
  version: 1,
}
const messagesOf = (result: {
  success: boolean
  error?: { issues: { path: PropertyKey[]; message: string }[] }
}) => result.error?.issues.map((issue) => [issue.path.join('.'), issue.message]) ?? []

test('DOM-FIN-109: profil formu gövdesi; açılış devri iki alanla birlikte, düzeltmede yalnız değişen', () => {
  const values = {
    seniorityStartDate: '2020-03-15',
    birthDate: '',
    openingDate: '2025-12-31',
    openingDays: ' -3 ',
  }
  assert.deepEqual(leaveProfileBody('m1', values), {
    membershipId: 'm1',
    seniorityStartDate: '2020-03-15',
    birthDate: null,
    openingBalance: { asOf: '2025-12-31', days: -3 },
  })
  assert.equal(leaveProfileFormSchema.safeParse(values).success, true)
  assert.deepEqual(messagesOf(leaveProfileFormSchema.safeParse({ ...values, openingDays: '' })), [
    ['openingDays', 'Açılış devrinin gününü ve gün sayısını birlikte girin.'],
  ])
  assert.deepEqual(
    messagesOf(leaveProfileFormSchema.safeParse({ ...values, openingDays: '2,5' })),
    [['openingDays', 'Devreden gün tam sayı olmalıdır.']],
  )
  assert.deepEqual(
    messagesOf(leaveProfileFormSchema.safeParse({ ...values, seniorityStartDate: '' })),
    [['seniorityStartDate', 'Geçerli bir tarih seçin.']],
  )
  assert.equal(leaveProfileFormField('openingBalance.days'), 'openingDays')
  const current = {
    seniorityStartDate: '2020-03-15',
    birthDate: '1980-01-01',
    openingBalance: { asOf: '2025-12-31', days: -3 },
    version: 2,
  }
  assert.deepEqual(leaveProfileDefaults(current), {
    seniorityStartDate: '2020-03-15',
    birthDate: '1980-01-01',
    openingDate: '2025-12-31',
    openingDays: '-3',
  })
  assert.deepEqual(leaveProfileDefaults(null).openingDays, '')
  assert.deepEqual(leaveProfileUpdateBody(current, leaveProfileDefaults(current)), {})
  assert.deepEqual(leaveProfileUpdateBody(current, values), { birthDate: null })
  assert.deepEqual(
    leaveProfileUpdateBody(current, {
      ...values,
      birthDate: '1980-01-01',
      openingDate: '',
      openingDays: '',
    }),
    { openingBalance: null },
  )
})

test('DOM-FIN-109: izin kaydı formu iş gününü tam sayı ister; gün aralığı core şemasından', () => {
  const values = { ...leaveRecordDefaults('2026-10-06'), days: '3', endDate: '2026-10-08' }
  assert.deepEqual(leaveRecordBody('m1', { ...values, note: ' Tatil ' }), {
    membershipId: 'm1',
    typeCode: 'annual',
    startDate: '2026-10-06',
    endDate: '2026-10-08',
    days: 3,
    note: 'Tatil',
  })
  assert.equal(leaveRecordFormSchema.safeParse(values).success, true)
  assert.deepEqual(messagesOf(leaveRecordFormSchema.safeParse({ ...values, days: 'üç' })), [
    ['days', 'Gün sayısı tam sayı olmalıdır.'],
  ])
  assert.deepEqual(
    messagesOf(leaveRecordFormSchema.safeParse({ ...values, endDate: '2026-10-05' })),
    [['endDate', 'Bitiş günü başlangıç gününden önce olamaz.']],
  )
  assert.deepEqual(messagesOf(leaveRecordFormSchema.safeParse({ ...values, days: '0' })), [
    ['days', 'Gün sayısı en az 1 olmalıdır.'],
  ])
  const sick = { ...PATERNITY, code: 'sick', kind: 'sick' as const }
  const closed = { ...PATERNITY, code: 'marriage', isActive: false }
  assert.deepEqual(
    selectableLeaveTypes([PATERNITY, sick, closed]).map((type) => type.code),
    ['paternity'],
  )
})

test('DOM-FIN-109: tür ayarı formu yalnız değişen alanları gönderir; yasal gün ve değişiklik yok', () => {
  const defaults = leaveTypeDefaults(PATERNITY)
  assert.deepEqual(defaults, {
    label: 'Babalık izni (eşin doğumu)',
    paid: 'true',
    deductsFromAnnual: 'false',
    defaultDays: '5',
    isActive: 'true',
  })
  const schema = leaveTypeFormSchema(PATERNITY)
  assert.deepEqual(messagesOf(schema.safeParse(defaults)), [
    ['label', 'İzin türünde değişiklik yok.'],
  ])
  assert.deepEqual(leaveTypeUpdateBody(PATERNITY, { ...defaults, defaultDays: '10' }), {
    defaultDays: 10,
  })
  assert.deepEqual(
    leaveTypeUpdateBody(PATERNITY, { ...defaults, isActive: 'false', label: ' X izni ' }),
    {
      label: 'X izni',
      isActive: false,
    },
  )
  assert.deepEqual(messagesOf(schema.safeParse({ ...defaults, label: 'X' })), [
    ['label', 'Tür adını en az 2 karakterle yazın.'],
  ])
  assert.deepEqual(messagesOf(schema.safeParse({ ...defaults, defaultDays: '0' })), [
    ['defaultDays', 'Gün sayısı en az 1 olmalıdır.'],
  ])
  assert.deepEqual(leaveTypeUpdateBody(PATERNITY, { ...defaults, defaultDays: '' }), {
    defaultDays: null,
  })
})

test('DOM-FIN-109: yeni tür formu: ücretsiz biçim ücretli gönderilmez', () => {
  assert.deepEqual(newLeaveTypeBody({ ...NEW_LEAVE_TYPE_DEFAULTS, label: ' Sınav izni ' }), {
    kind: 'excuse',
    label: 'Sınav izni',
    paid: true,
    deductsFromAnnual: false,
    defaultDays: null,
  })
  assert.equal(
    newLeaveTypeBody({ ...NEW_LEAVE_TYPE_DEFAULTS, kind: 'unpaid', label: 'Askerlik' }).paid,
    false,
  )
  assert.deepEqual(messagesOf(newLeaveTypeFormSchema.safeParse(NEW_LEAVE_TYPE_DEFAULTS)), [
    ['label', 'Tür adını en az 2 karakterle yazın.'],
  ])
})

test('DOM-FIN-109: gösterim metinleri', () => {
  assert.equal(rangeText(RECORD), '6 Tem 2026 – 10 Tem 2026')
  assert.equal(rangeText({ startDate: '2026-07-06', endDate: '2026-07-06' }), '6 Tem 2026')
  assert.equal(recordTitle(RECORD), 'Yıllık ücretli izin, 6 Tem 2026 – 10 Tem 2026, 5 gün')
  assert.equal(recordFlags(RECORD), 'Ücretli · yıllık izinden düşer')
  assert.equal(
    recordFlags({ paid: false, deductsFromAnnual: false }),
    'Ücretsiz · yıllık izinden düşmez',
  )
  assert.equal(typeFacts(PATERNITY), 'Ücretli · yıllık izinden düşmez · 5 gün (yasal en az 5)')
  assert.equal(
    typeFacts({ ...PATERNITY, statutoryMinDays: null, defaultDays: 2, isActive: false }),
    'Ücretli · yıllık izinden düşmez · 2 gün · kapalı',
  )
  assert.equal(
    accrualText({ serviceYear: 6, date: '2026-03-15', days: 20, ageRule: true }),
    '6. yıl · 15 Mar 2026 · 20 gün (yaş kuralı, en az 20)',
  )
})
