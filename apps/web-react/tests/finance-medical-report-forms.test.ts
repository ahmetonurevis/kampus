import assert from 'node:assert/strict'
import test from 'node:test'

import {
  byTypeText,
  flagsText,
  issuerText,
  medicalReportBody,
  medicalReportDefaults,
  medicalReportFormField,
  medicalReportFormSchema,
  monthToPeriod,
  reportPeriodText,
  reportTitle,
} from '../src/pages/finance/finance-medical-report-forms.ts'

// Sağlık raporu formu ve gösterimi (DOM-FIN-110; ON-185).

const FILE = '0b7c1d4e-2f3a-4b5c-8d6e-7f8091a2b3c4'

test('DOM-FIN-110: form gövdesi; boş veren kurum türü null, dosya ayrı gelir', () => {
  const values = { ...medicalReportDefaults('2026-10-06'), endDate: '2026-10-08' }
  assert.deepEqual(medicalReportBody('m1', values, null), {
    membershipId: 'm1',
    reportType: 'sickness',
    startDate: '2026-10-06',
    endDate: '2026-10-08',
    issuerType: null,
    fileId: null,
  })
  assert.equal(
    medicalReportBody('m1', { ...values, issuerType: 'private' }, FILE).issuerType,
    'private',
  )
  assert.equal(medicalReportBody('m1', values, FILE).fileId, FILE)
})

test('DOM-FIN-110: form şeması core kuralını alana taşır', () => {
  const schema = medicalReportFormSchema('m1')
  const ok = schema.safeParse(medicalReportDefaults('2026-10-06'))
  assert.equal(ok.success, true)
  const backwards = schema.safeParse({
    ...medicalReportDefaults('2026-10-06'),
    endDate: '2026-10-05',
  })
  assert.equal(backwards.success, false)
  assert.deepEqual(backwards.error?.issues[0]?.path, ['endDate'])
  assert.equal(backwards.error?.issues[0]?.message, 'Bitiş günü başlangıç gününden önce olamaz.')
  const empty = schema.safeParse({ ...medicalReportDefaults('2026-10-06'), startDate: '' })
  assert.deepEqual(empty.error?.issues[0]?.path, ['startDate'])
  assert.equal(medicalReportFormField('startDate'), 'startDate')
  assert.equal(medicalReportFormField('membershipId'), undefined)
})

test('DOM-FIN-110: gösterim metinleri', () => {
  const report = {
    reportType: 'work_accident' as const,
    startDate: '2026-10-05',
    endDate: '2026-10-07',
    dayCount: 3,
    issuerType: null,
    employerNotifiedAt: null,
    sgkApprovedAt: null,
  }
  assert.equal(reportTitle(report), 'İş kazası')
  assert.equal(reportPeriodText(report), '5 Eki 2026 – 7 Eki 2026 · 3 gün')
  assert.equal(
    reportPeriodText({ ...report, endDate: '2026-10-05', dayCount: 1 }),
    '5 Eki 2026 · 1 gün',
  )
  assert.equal(issuerText(report), null)
  assert.equal(issuerText({ issuerType: 'family_physician' }), 'Aile hekimi')
  assert.equal(flagsText(report), 'İşverene bildirilmedi')
  const notified = { ...report, employerNotifiedAt: '2026-10-06T09:00:00.000Z' }
  assert.equal(flagsText(notified), 'İşverene bildirildi · SGK onayı bekliyor')
  assert.equal(
    flagsText({ ...notified, sgkApprovedAt: '2026-10-06T09:00:00.000Z' }),
    'İşverene bildirildi · SGK sisteminde onaylandı',
  )
  assert.equal(
    byTypeText({ sickness: 2, work_accident: 0, occupational_disease: 0, maternity: 3 }),
    'İstirahat (hastalık) 2 · Analık (doğum) 3',
  )
  assert.equal(
    byTypeText({ sickness: 0, work_accident: 0, occupational_disease: 0, maternity: 0 }),
    '—',
  )
})

test('DOM-FIN-110: ay seçicisi dönemi verir; geçersizde bugünün ayı', () => {
  assert.deepEqual(monthToPeriod('2026-02', '2026-10-06'), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(monthToPeriod('', '2026-10-06'), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(monthToPeriod('2026-13', '2026-10-06'), { from: '2026-10-01', to: '2026-10-31' })
})
