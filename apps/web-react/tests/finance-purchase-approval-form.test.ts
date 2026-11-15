import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  ANY_MANAGER,
  approvalFormDefaults,
  approvalFormField,
  approvalFormSchema,
  approvalSettingsBody,
  newTierRow,
} from '../src/pages/settings/finance-purchase-approval-form.ts'

// ON-223, K-260: satın alma onay kademeleri formu ve ayar sekmesi (DOM-FIN-071).

const issuesOf = (values: unknown) => {
  const parsed = approvalFormSchema.safeParse(values)
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'))
}

test('ON-223, K-260: kayıtlı ayar forma, form gövdeye çevrilir', () => {
  const defaults = approvalFormDefaults({
    version: 3,
    approvers: [],
    tiers: [
      {
        position: 1,
        minTotalCents: 0,
        approverRole: 'yonetici',
        approverUserId: null,
        approverName: null,
        approverEligible: true,
      },
      {
        position: 2,
        minTotalCents: 2_000_000,
        approverRole: null,
        approverUserId: 'test-founder',
        approverName: 'Kurucu',
        approverEligible: true,
      },
    ],
  })
  assert.deepEqual(defaults.tiers[1], { minTotal: '20000,00', approver: 'user:test-founder' })
  assert.equal(defaults.tiers[0]?.approver, ANY_MANAGER)
  assert.deepEqual(approvalFormDefaults(undefined), { tiers: [] })
  const values = { tiers: [newTierRow(0), { minTotal: '5.000,00', approver: 'user:test-founder' }] }
  assert.deepEqual(issuesOf(values), [])
  assert.deepEqual(approvalSettingsBody(values), {
    tiers: [
      { minTotalCents: 0, approverRole: 'yonetici', approverUserId: null },
      { minTotalCents: 500_000, approverRole: null, approverUserId: 'test-founder' },
    ],
  })
  assert.deepEqual(newTierRow(2), { minTotal: '', approver: ANY_MANAGER })
  assert.deepEqual(issuesOf({ tiers: [] }), [])
})

test('ON-223, K-260: okunamayan tutar, artmayan sınır ve aynı kişi satır alanına düşer', () => {
  assert.deepEqual(
    issuesOf({ tiers: [newTierRow(0), { minTotal: 'beş', approver: ANY_MANAGER }] }),
    ['tiers.1.minTotal'],
  )
  assert.deepEqual(issuesOf({ tiers: [newTierRow(0), { minTotal: '0', approver: ANY_MANAGER }] }), [
    'tiers.1.minTotal',
  ])
  assert.deepEqual(
    issuesOf({
      tiers: [
        { minTotal: '0', approver: 'user:test-a' },
        { minTotal: '100', approver: 'user:test-a' },
      ],
    }),
    ['tiers.1.approver'],
  )
  assert.deepEqual(issuesOf({ tiers: [{ minTotal: '10', approver: ANY_MANAGER }] }), [
    'tiers.0.minTotal',
  ])
})

test('ON-223: sunucu alan yolu form alanına çevrilir', () => {
  assert.equal(approvalFormField('tiers.2.approverUserId'), 'tiers.2.approver')
  assert.equal(approvalFormField('tiers.0.minTotalCents'), 'tiers.0.minTotal')
  assert.equal(approvalFormField('tiers'), null)
})

test('ON-223: satın alma onayı Onur bloğunda yönetici sekmesidir, finans modülüne bağlıdır', () => {
  const registry = readFileSync(
    new URL('../src/pages/settings/settings-sections.tsx', import.meta.url),
    'utf8',
  )
  const block = registry.slice(
    registry.indexOf('// Onur: kayıt ve finans\n'),
    registry.indexOf('// Onur: kayıt ve finans sonu'),
  )
  assert.match(block, /id: 'purchase-approval'/)
  assert.match(block, /param: 'satin-alma-onayi'/)
  assert.match(block, /label: 'Satın alma onayı'/)
  assert.match(
    block,
    /module: 'finance',\n\s+order: 29,\n\s+component: FinancePurchaseApprovalSettings/,
  )
})
