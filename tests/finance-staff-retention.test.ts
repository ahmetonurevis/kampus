import assert from 'node:assert/strict'
import test from 'node:test'

import {
  planStaffDataDestruction,
  resolveStaffRetentionPolicy,
  separationDayOf,
  STAFF_RETENTION_CATEGORIES,
  STAFF_RETENTION_CATEGORY_SPECS,
  staffDataDestructionInputSchema,
  staffRetentionCandidates,
  staffRetentionDueDay,
  staffRetentionPeriodLabel,
  staffRetentionPolicyUpdateSchema,
  staffRetentionStartDay,
  staffRetentionState,
  type StaffDataDestructionChecks,
} from '../packages/school-core/src/lib/finance-staff-retention.ts'

import { isDomainError } from './support/domain-error.ts'

// Özlük verisinin saklanması ve imhası (DOM-FIN-122; ON-176; IST-021). Kararlar K-415…K-417.

const TODAY = '2026-10-06'
const POLICY = resolveStaffRetentionPolicy({})
const checks = (
  overrides: Partial<StaffDataDestructionChecks> = {},
): StaffDataDestructionChecks => ({
  member: { role: 'ogretmen', deactivatedAt: '2010-03-15T09:00:00.000Z' },
  policy: POLICY,
  recordCount: 3,
  today: TODAY,
  ...overrides,
})

test('DOM-FIN-122: varsayılan süre yasal en az süredir; kayıtlı daha kısa süre alt sınıra çekilir (K-415)', () => {
  for (const category of STAFF_RETENTION_CATEGORIES) {
    assert.equal(
      POLICY[category].retentionMonths,
      STAFF_RETENTION_CATEGORY_SPECS[category].legalMinimumMonths,
    )
    assert.equal(POLICY[category].customized, false)
  }
  const stored = resolveStaffRetentionPolicy({
    personnel_file: 150,
    health_reports: 12,
    leave_records: null,
  })
  assert.deepEqual(stored.personnel_file, { retentionMonths: 150, customized: true })
  assert.deepEqual(stored.health_reports, { retentionMonths: 180, customized: true })
  assert.deepEqual(stored.leave_records, { retentionMonths: 120, customized: false })
})

test('DOM-FIN-122: politika güncellemesi yasal en az sürenin altına inemez (K-415)', () => {
  const below = staffRetentionPolicyUpdateSchema.safeParse({
    criminal_records: { retentionMonths: 119 },
  })
  assert.equal(below.success, false)
  assert.deepEqual(below.error?.issues[0]?.path, ['criminal_records', 'retentionMonths'])
  assert.match(below.error?.issues[0]?.message ?? '', /yasal en az süre 10 yıl \(120 ay\)/)
  assert.equal(
    staffRetentionPolicyUpdateSchema.safeParse({ health_reports: { retentionMonths: 179 } })
      .success,
    false,
  )
  assert.equal(staffRetentionPolicyUpdateSchema.safeParse({}).success, false)
  assert.equal(
    staffRetentionPolicyUpdateSchema.safeParse({ payroll_records: { retentionMonths: 361 } })
      .success,
    false,
  )
  assert.equal(
    staffRetentionPolicyUpdateSchema.safeParse({ payroll_records: { retentionMonths: 12.5 } })
      .success,
    false,
  )
  assert.equal(
    staffRetentionPolicyUpdateSchema.safeParse({ unknown: { retentionMonths: 200 } }).success,
    false,
  )
  const ok = staffRetentionPolicyUpdateSchema.parse({
    criminal_records: { retentionMonths: 120 },
    payroll_records: { retentionMonths: null },
  })
  assert.deepEqual(ok, {
    criminal_records: { retentionMonths: 120 },
    payroll_records: { retentionMonths: null },
  })
})

test('DOM-FIN-122: süre hesabı başlangıç olayına göre; ayın son günü korunur (K-415)', () => {
  assert.equal(separationDayOf('2016-03-14T22:30:00.000Z'), '2016-03-15')
  assert.equal(staffRetentionStartDay('2016-03-15', 'separation_day'), '2016-03-15')
  assert.equal(staffRetentionStartDay('2016-03-15', 'year_after_separation'), '2017-01-01')
  assert.equal(staffRetentionDueDay('2016-03-15', 'personnel_file', 120), '2026-03-15')
  assert.equal(staffRetentionDueDay('2016-03-15', 'payroll_records', 120), '2027-01-01')
  assert.equal(staffRetentionDueDay('2016-03-15', 'sick_leave_reports', 120), '2027-01-01')
  assert.equal(staffRetentionDueDay('2010-08-31', 'health_reports', 180), '2025-08-31')
  assert.equal(staffRetentionDueDay('2016-01-31', 'leave_records', 121), '2026-02-28')
  assert.deepEqual(staffRetentionState('2026-10-06', TODAY), { status: 'due', daysLeft: 0 })
  assert.deepEqual(staffRetentionState('2026-10-07', TODAY), { status: 'waiting', daysLeft: 1 })
  assert.deepEqual(staffRetentionState('2026-10-01', TODAY), { status: 'due', daysLeft: -5 })
  assert.equal(staffRetentionPeriodLabel(120), '10 yıl')
  assert.equal(staffRetentionPeriodLabel(130), '130 ay')
})

test('DOM-FIN-122: imha adayı ayrılmış personel × kayıtlı kategori; süresi dolan önce (K-415)', () => {
  const staff = [
    { membershipId: 'm-eski', name: 'Selin Kaya', role: 'ogretmen', separationDay: '2012-05-10' },
    { membershipId: 'm-yeni', name: 'Ali Demir', role: 'onburo', separationDay: '2025-06-30' },
    { membershipId: 'm-bos', name: 'Can Ak', role: 'yonetici', separationDay: '2001-01-01' },
  ]
  const counts = new Map([
    ['m-eski', { personnel_file: 4, payroll_records: 7, health_reports: 1 }],
    ['m-yeni', { criminal_records: 1 }],
    ['m-bos', {}],
  ])
  const rows = staffRetentionCandidates(staff, counts, POLICY, TODAY)
  assert.deepEqual(
    rows.map((row) => [row.membershipId, row.category, row.status, row.dueDay, row.recordCount]),
    [
      ['m-eski', 'personnel_file', 'due', '2022-05-10', 4],
      ['m-eski', 'payroll_records', 'due', '2023-01-01', 7],
      ['m-eski', 'health_reports', 'waiting', '2027-05-10', 1],
      ['m-yeni', 'criminal_records', 'waiting', '2035-06-30', 1],
    ],
  )
  const due = staffRetentionCandidates(staff, counts, POLICY, TODAY, { status: 'due' })
  assert.deepEqual(
    due.map((row) => row.category),
    ['personnel_file', 'payroll_records'],
  )
  const health = staffRetentionCandidates(staff, counts, POLICY, TODAY, {
    category: 'health_reports',
  })
  assert.equal(health.length, 1)
  assert.equal(health[0]?.daysLeft, 216)
  const longer = resolveStaffRetentionPolicy({ personnel_file: 240 })
  assert.equal(staffRetentionCandidates(staff, counts, longer, TODAY, { status: 'due' }).length, 1)
})

test('DOM-FIN-122: imha planı yöntemi kategoriden alır; süresi dolmamış, etkin ve kayıtsız ret (K-416, K-417)', () => {
  const plan = planStaffDataDestruction(
    { membershipId: 'm-1', category: 'payroll_records' },
    checks(),
  )
  assert.deepEqual(plan, {
    category: 'payroll_records',
    method: 'anonymize',
    retentionMonths: 120,
    startEvent: 'year_after_separation',
    dueDay: '2021-01-01',
    recordCount: 3,
  })
  assert.equal(
    planStaffDataDestruction({ membershipId: 'm-1', category: 'criminal_records' }, checks())
      .method,
    'delete',
  )
  assert.throws(
    () =>
      planStaffDataDestruction(
        { membershipId: 'm-1', category: 'health_reports' },
        checks({ member: { role: 'ogretmen', deactivatedAt: '2012-03-15T09:00:00.000Z' } }),
      ),
    (error: unknown) =>
      isDomainError('staff_retention_not_due')(error) &&
      /en erken 15 Mar 2027 günü/.test((error as Error).message),
  )
  assert.throws(
    () =>
      planStaffDataDestruction(
        { membershipId: 'm-1', category: 'personnel_file' },
        checks({ member: { role: 'ogretmen', deactivatedAt: null } }),
      ),
    isDomainError('staff_retention_member_active'),
  )
  assert.throws(
    () =>
      planStaffDataDestruction(
        { membershipId: 'm-1', category: 'personnel_file' },
        checks({ recordCount: 0 }),
      ),
    isDomainError('staff_retention_nothing_to_destroy'),
  )
  for (const member of [null, { role: 'veli', deactivatedAt: '2001-01-01T00:00:00.000Z' }])
    assert.throws(
      () =>
        planStaffDataDestruction(
          { membershipId: 'm-1', category: 'personnel_file' },
          checks({ member }),
        ),
      isDomainError('staff_retention_member_not_found', 'not_found'),
    )
  // Kurum süreyi uzattıysa uzatılmış süre geçerlidir.
  assert.throws(
    () =>
      planStaffDataDestruction(
        { membershipId: 'm-1', category: 'personnel_file' },
        checks({ policy: resolveStaffRetentionPolicy({ personnel_file: 360 }) }),
      ),
    isDomainError('staff_retention_not_due'),
  )
})

test('DOM-FIN-122: imha girdisi yalnız üyelik ve kategori alır', () => {
  assert.equal(
    staffDataDestructionInputSchema.safeParse({ membershipId: 'm-1', category: 'other' }).success,
    false,
  )
  assert.equal(
    staffDataDestructionInputSchema.safeParse({ membershipId: ' ', category: 'leave_records' })
      .success,
    false,
  )
  assert.equal(
    staffDataDestructionInputSchema.safeParse({
      membershipId: 'm-1',
      category: 'leave_records',
      institutionId: 'b',
    }).success,
    false,
  )
})
