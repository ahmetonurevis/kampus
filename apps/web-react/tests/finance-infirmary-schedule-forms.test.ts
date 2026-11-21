import assert from 'node:assert/strict'
import test from 'node:test'

import type { MedicationDoseRecord } from '@kampus/react-shared/use-finance-infirmary-schedule.ts'

import {
  activeRecord,
  administrationCorrectionBody,
  chartSummaryText,
  correctionDefaults,
  correctionFormField,
  correctionFormSchema,
  doseRecordText,
  doseStateBadge,
  skipBody,
  skipCorrectionBody,
  skipDefaults,
  skipFormSchema,
  toleranceFormSchema,
} from '../src/pages/finance/finance-infirmary-schedule-forms.ts'

// "Bugünkü ilaçlar" görünümünün saf mantığı (DOM-FIN-152; ON-161; K-511…K-513).

const administration: MedicationDoseRecord = {
  kind: 'administration',
  id: 'a-1',
  consentId: 'c-1',
  studentId: 's-1',
  doseDay: '2026-10-06',
  scheduledTime: '09:00',
  voided: false,
  corrected: false,
  administeredAt: '2026-10-06T06:05:00.000Z',
  administeredByMembershipId: 'm-1',
  administeredByName: 'Selin Kaya',
  dose: '5 ml',
  skipReason: null,
  note: null,
  recordedByName: 'Selin Kaya',
  createdAt: '2026-10-06T06:05:00.000Z',
  corrections: [],
}
const skip: MedicationDoseRecord = {
  ...administration,
  kind: 'skip',
  id: 's-1',
  administeredAt: null,
  administeredByMembershipId: null,
  administeredByName: null,
  dose: null,
  skipReason: 'refused',
}

test('DOM-FIN-152: durum rozeti, sonuç metni ve gün özeti (K-511)', () => {
  assert.deepEqual(doseStateBadge('overdue'), { text: 'Gecikti', tone: 'red' })
  assert.deepEqual(doseStateBadge('administered'), { text: 'Verildi', tone: 'green' })
  assert.equal(doseRecordText(administration), 'Verildi 09:05 · Selin Kaya')
  assert.equal(doseRecordText(skip), 'Atlandı · Öğrenci reddetti')
  assert.equal(
    chartSummaryText([
      { state: 'overdue' },
      { state: 'overdue' },
      { state: 'administered' },
      { state: 'skipped' },
    ]),
    '2 gecikti · 1 verildi · 1 atlandı',
  )
  assert.equal(chartSummaryText([]), '')
})

test('DOM-FIN-152: etkin kayıt iptal edilmemiş son kayıttır (K-513)', () => {
  assert.equal(activeRecord({ records: [] }), null)
  assert.equal(activeRecord({ records: [{ ...administration, voided: true }] }), null)
  assert.equal(activeRecord({ records: [{ ...administration, voided: true }, skip] })?.id, 's-1')
})

test('DOM-FIN-152: atlama formu; "diğer" açıklama ister, gövde günü ve boş notu taşır (K-512)', () => {
  assert.equal(skipFormSchema.safeParse(skipDefaults()).success, true)
  const other = skipFormSchema.safeParse({ reason: 'other', note: 'ab' })
  assert.equal(other.success, false)
  assert.deepEqual(other.error?.issues[0]?.path, ['note'])
  assert.deepEqual(skipBody({ scheduledTime: '11:00' }, '2026-10-06', skipDefaults()), {
    scheduledTime: '11:00',
    doseDay: '2026-10-06',
    reason: 'student_absent',
    note: null,
  })
})

test('DOM-FIN-152: düzeltme formu; iptalde yalnız gerekçe, düzeltmede değişen alanlar (K-513)', () => {
  const values = correctionDefaults(administration)
  assert.equal(values.time, '09:05')
  assert.equal(correctionFormSchema.safeParse(values).success, false, 'gerekçe zorunlu')
  assert.deepEqual(
    administrationCorrectionBody(administration, {
      ...values,
      kind: 'void',
      reason: ' Yanlış öğrenci ',
    }),
    { kind: 'void', reason: 'Yanlış öğrenci' },
  )
  assert.deepEqual(
    administrationCorrectionBody(administration, {
      ...values,
      reason: 'Saat yanlış',
      time: '09:20',
      note: 'Tok karnına',
    }),
    {
      kind: 'amend',
      reason: 'Saat yanlış',
      administeredAt: '2026-10-06T09:20:00+03:00',
      note: 'Tok karnına',
    },
  )
  assert.deepEqual(
    administrationCorrectionBody(administration, { ...values, reason: 'Değişiklik yok' }),
    { kind: 'amend', reason: 'Değişiklik yok' },
  )
  const skipValues = correctionDefaults(skip)
  assert.equal(skipValues.skipReason, 'refused')
  assert.deepEqual(
    skipCorrectionBody(skip, {
      ...skipValues,
      reason: 'Gerekçe yanlış',
      skipReason: 'student_absent',
    }),
    { kind: 'amend', reason: 'Gerekçe yanlış', skipReason: 'student_absent' },
  )
  assert.equal(
    correctionFormSchema.safeParse({ ...skipValues, reason: 'Gerekçe', skipReason: 'other' })
      .success,
    false,
  )
  assert.equal(correctionFormField('administeredAt'), 'time')
  assert.equal(correctionFormField('note'), 'note')
  assert.equal(correctionFormField('administeredByMembershipId'), null)
})

test('DOM-FIN-152: gecikme payı formu 5–180 dk (K-511)', () => {
  assert.equal(toleranceFormSchema.safeParse({ lateToleranceMinutes: 30 }).success, true)
  assert.equal(toleranceFormSchema.safeParse({ lateToleranceMinutes: 4 }).success, false)
  assert.equal(toleranceFormSchema.safeParse({ lateToleranceMinutes: Number.NaN }).success, false)
})
