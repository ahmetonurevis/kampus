import assert from 'node:assert/strict'
import test from 'node:test'

import {
  destroyNotice,
  dueText,
  periodText,
  retentionFormDefaults,
  retentionFormSchema,
  retentionMonthsOf,
  retentionPolicyBody,
} from '../src/pages/finance/finance-staff-retention-forms.ts'

// Özlük saklama ve imha sekmesi (DOM-FIN-122; ON-176). Kararlar K-415…K-417.

const POLICY = { legalMinimumMonths: 120, maximumMonths: 360 }

test('DOM-FIN-122: süre formu yıl/ay çevirir; yasal en az süre ve en çok süre alan hatasıdır (K-415)', () => {
  const schema = retentionFormSchema(POLICY)
  assert.equal(schema.safeParse({ amount: 10, unit: 'year' }).success, true)
  assert.equal(schema.safeParse({ amount: 125, unit: 'month' }).success, true)
  const below = schema.safeParse({ amount: 9, unit: 'year' })
  assert.equal(below.success, false)
  assert.deepEqual(below.error?.issues[0]?.path, ['amount'])
  assert.match(below.error?.issues[0]?.message ?? '', /Yasal en az süre 10 yıl/)
  assert.match(
    schema.safeParse({ amount: 31, unit: 'year' }).error?.issues[0]?.message ?? '',
    /en çok 30 yıl/,
  )
  assert.equal(schema.safeParse({ amount: 1.5, unit: 'year' }).success, false)
  assert.equal(schema.safeParse({ amount: Number.NaN, unit: 'year' }).success, false)
  assert.equal(retentionMonthsOf({ amount: 15, unit: 'year' }), 180)
  assert.equal(retentionMonthsOf({ amount: 130, unit: 'month' }), 130)
  assert.deepEqual(retentionFormDefaults({ retentionMonths: 180 }), { amount: 15, unit: 'year' })
  assert.deepEqual(retentionFormDefaults({ retentionMonths: 130 }), { amount: 130, unit: 'month' })
  assert.deepEqual(retentionPolicyBody('payroll_records', 240), {
    payroll_records: { retentionMonths: 240 },
  })
  assert.deepEqual(retentionPolicyBody('payroll_records', null), {
    payroll_records: { retentionMonths: null },
  })
  assert.equal(periodText(120), '10 yıl')
})

test('DOM-FIN-122: aday durum metni ve imha onay uyarısı yönteme göre (K-416)', () => {
  assert.equal(
    dueText({ status: 'waiting', daysLeft: 12, dueDate: '2026-10-18' }),
    '12 gün kaldı (18 Eki 2026)',
  )
  assert.equal(dueText({ status: 'due', daysLeft: 0, dueDate: '2026-10-06' }), 'Süre bugün doldu')
  assert.equal(
    dueText({ status: 'due', daysLeft: -400, dueDate: '2025-09-01' }),
    'Süre doldu (1 Eyl 2025)',
  )
  const deleted = destroyNotice({
    name: 'Selin Kaya',
    category: 'criminal_records',
    method: 'delete',
    recordCount: 2,
  })
  assert.match(deleted, /Selin Kaya adlı personelin adli sicil kayıtları kategorisindeki 2 kaydı/)
  assert.match(deleted, /kalıcı olarak silinecek/)
  assert.match(deleted, /geri alınamaz/)
  const anonymized = destroyNotice({
    name: 'Selin Kaya',
    category: 'payroll_records',
    method: 'anonymize',
    recordCount: 7,
  })
  assert.match(anonymized, /anonimleştirilecek/)
  assert.match(anonymized, /kişisiz toplamları/)
})
