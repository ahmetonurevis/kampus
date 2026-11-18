import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FINANCE_STAFF_SEPARATION_ROLES,
  isManualSeparationStep,
  markFieldOf,
  missingSeparationSteps,
  planStaffSeparation,
  planStaffSeparationCancel,
  planStaffSeparationComplete,
  planStaffSeparationStep,
  planStaffSeparationUpdate,
  SGK_EXIT_CODE_SUGGESTIONS,
  sgkExitCodeLabel,
  staffRoleText,
  staffSeparationInputSchema,
  staffSeparationNotice,
  staffSeparationParagraphs,
  staffSeparationSteps,
  staffSeparationUpdateSchema,
  STAFF_SEPARATION_REASONS,
  type StaffSeparationDetails,
  type StaffSeparationFacts,
  type StaffSeparationInput,
  type StaffSeparationMarks,
} from '../packages/school-core/src/lib/finance-staff-separations.ts'

import { isDomainError } from './support/domain-error.ts'

// İşten ayrılış süreci (DOM-FIN-118; ON-180). Kararlar K-403…K-405; sorular H-85, H-86, M-81.

const TODAY = '2026-10-06'
const INPUT: StaffSeparationInput = {
  membershipId: 'm-selin',
  separationDate: '2026-09-30',
  reason: 'resignation',
}
const CHECKS = { staff: { role: 'ogretmen' }, hasOpen: false, today: TODAY }
const NO_MARKS: StaffSeparationMarks = {
  deductionsCheckedAt: null,
  leaveCheckedAt: null,
  severanceCheckedAt: null,
}
const CLEAN: StaffSeparationFacts = {
  openAssetCount: 0,
  openAdvanceCents: 0,
  activeGarnishmentCount: 0,
  accountClosed: true,
  serviceCertificate: true,
}
const MARKED: StaffSeparationMarks = {
  deductionsCheckedAt: '2026-10-01T09:00:00.000Z',
  leaveCheckedAt: '2026-10-01T09:00:00.000Z',
  severanceCheckedAt: null,
}
const DETAILS: StaffSeparationDetails & { status: 'open' } = {
  separationDate: '2026-09-30',
  reason: 'resignation',
  sgkExitCode: '03',
  hireDate: '2021-09-01',
  noticeGivenDate: null,
  note: null,
  status: 'open',
}

const plan = (input: Partial<StaffSeparationInput> = {}, checks: Partial<typeof CHECKS> = {}) =>
  planStaffSeparation(staffSeparationInputSchema.parse({ ...INPUT, ...input }), {
    ...CHECKS,
    ...checks,
  })

test('DOM-FIN-118: dosyayı yalnız yönetici yürütür', () => {
  assert.deepEqual([...FINANCE_STAFF_SEPARATION_ROLES], ['yonetici'])
})

test('DOM-FIN-118 K-403: SGK kodu verilmezse nedenden önerilir, verilirse korunur', () => {
  for (const reason of STAFF_SEPARATION_REASONS)
    assert.equal(plan({ reason }).sgkExitCode, SGK_EXIT_CODE_SUGGESTIONS[reason])
  assert.equal(plan({ reason: 'termination', sgkExitCode: '29' }).sgkExitCode, '29')
  assert.equal(
    sgkExitCodeLabel('03'),
    '03 · Belirsiz süreli iş sözleşmesinin işçi tarafından feshi (istifa)',
  )
  const planned = plan({ note: '  ', hireDate: '2021-09-01' })
  assert.equal(planned.note, null)
  assert.equal(planned.hireDate, '2021-09-01')
})

test('DOM-FIN-118: şema gün ilişkilerini ve bilinmeyen alanı reddeder', () => {
  const issues = (value: unknown) =>
    staffSeparationInputSchema.safeParse(value).error?.issues.map((issue) => issue.path.join('.'))
  assert.deepEqual(issues({ ...INPUT, hireDate: '2026-10-01' }), ['hireDate'])
  assert.deepEqual(issues({ ...INPUT, noticeGivenDate: '2026-10-01' }), ['noticeGivenDate'])
  assert.deepEqual(issues({ ...INPUT, hireDate: '2026-09-10', noticeGivenDate: '2026-09-01' }), [
    'noticeGivenDate',
  ])
  assert.deepEqual(issues({ ...INPUT, separationDate: '1999-12-31' }), ['separationDate'])
  assert.deepEqual(issues({ ...INPUT, reason: 'fired' }), ['reason'])
  assert.deepEqual(issues({ ...INPUT, sgkExitCode: '99' }), ['sgkExitCode'])
  assert.deepEqual(issues({ ...INPUT, institutionId: 'x' }), [''])
  assert.deepEqual(issues({ ...INPUT, note: 'a'.repeat(501) }), ['note'])
})

test('DOM-FIN-118: personel, açık dosya ve gün sınırları denetlenir', () => {
  assert.throws(() => plan({}, { staff: null }), isDomainError('staff_separation_staff_not_found'))
  assert.throws(
    () => plan({}, { staff: { role: 'veli' } }),
    isDomainError('staff_separation_not_staff'),
  )
  assert.throws(
    () => plan({}, { hasOpen: true }),
    isDomainError('staff_separation_open_exists', 'conflict'),
  )
  assert.throws(
    () => plan({ separationDate: '2027-10-07' }),
    isDomainError('staff_separation_date_too_far'),
  )
  assert.equal(plan({ separationDate: '2027-10-06' }).separationDate, '2027-10-06')
  assert.throws(
    () => plan({ separationDate: '2027-01-01', hireDate: '2026-10-07' }),
    isDomainError('staff_separation_hire_date_future'),
  )
  assert.throws(
    () => plan({ separationDate: '2027-01-01', noticeGivenDate: '2026-10-07' }),
    isDomainError('staff_separation_notice_date_future'),
  )
})

test('DOM-FIN-118 K-405: bildirim süresi hizmet süresinden, eksik gün bildirim gününden', () => {
  assert.equal(staffSeparationNotice({ ...DETAILS, hireDate: null }), null)
  assert.deepEqual(staffSeparationNotice({ ...DETAILS, noticeGivenDate: '2026-09-01' }), {
    applies: true,
    weeks: 8,
    noticeEndDate: '2026-10-27',
    shortDays: 27,
  })
  assert.deepEqual(
    staffSeparationNotice({ ...DETAILS, hireDate: '2025-12-01', noticeGivenDate: '2026-09-01' }),
    { applies: true, weeks: 4, noticeEndDate: '2026-09-29', shortDays: 0 },
  )
  assert.deepEqual(staffSeparationNotice({ ...DETAILS, reason: 'contract_end' }), {
    applies: false,
    weeks: 8,
    noticeEndDate: null,
    shortDays: 0,
  })
  assert.equal(
    staffSeparationNotice({ ...DETAILS, reason: 'retirement', noticeGivenDate: '2026-09-25' })
      ?.shortDays,
    0,
  )
})

test('DOM-FIN-118 K-404: adımlar kayıtlardan ve işaretlerden; kıdem zorunlu değil', () => {
  const open: StaffSeparationFacts = {
    openAssetCount: 2,
    openAdvanceCents: 150_000,
    activeGarnishmentCount: 1,
    accountClosed: false,
    serviceCertificate: false,
  }
  const steps = staffSeparationSteps(NO_MARKS, open)
  assert.deepEqual(
    steps.map((item) => [item.step, item.required, item.automatic, item.done]),
    [
      ['asset_return', true, true, false],
      ['deductions', true, false, false],
      ['leave', true, false, false],
      ['severance', false, false, false],
      ['account_closure', true, true, false],
      ['service_certificate', true, true, false],
    ],
  )
  assert.deepEqual(missingSeparationSteps(steps), [
    'asset_return',
    'deductions',
    'leave',
    'account_closure',
    'service_certificate',
  ])
  // Açık avans ve icra yoksa avans adımı işaretsiz biter; izin yine işaret ister.
  const clean = staffSeparationSteps(NO_MARKS, CLEAN)
  assert.deepEqual(missingSeparationSteps(clean), ['leave'])
  const marked = staffSeparationSteps(MARKED, { ...CLEAN, openAdvanceCents: 1 })
  assert.deepEqual(missingSeparationSteps(marked), [])
  assert.equal(marked.find((item) => item.step === 'leave')?.checkedAt, MARKED.leaveCheckedAt)
  assert.equal(marked.find((item) => item.step === 'asset_return')?.checkedAt, null)
  assert.equal(isManualSeparationStep('asset_return'), false)
  assert.equal(markFieldOf('severance'), 'severanceCheckedAt')
})

test('DOM-FIN-118 K-404: elle adım yalnız açık dosyada; aynı durum değişiklik sayılmaz', () => {
  const current = { ...NO_MARKS, status: 'open' as const }
  assert.deepEqual(planStaffSeparationStep(current, { step: 'leave', done: true }), {
    step: 'leave',
    done: true,
    changed: true,
  })
  assert.equal(planStaffSeparationStep(current, { step: 'leave', done: false }).changed, false)
  assert.throws(() => planStaffSeparationStep(current, { step: 'asset_return', done: true }))
  assert.throws(
    () =>
      planStaffSeparationStep({ ...current, status: 'completed' }, { step: 'leave', done: true }),
    isDomainError('staff_separation_closed', 'conflict'),
  )
})

test('DOM-FIN-118 K-403: tamamlama gün gelmeden ve eksik adımla reddedilir', () => {
  const done = staffSeparationSteps(MARKED, CLEAN)
  assert.doesNotThrow(() => planStaffSeparationComplete(DETAILS, done, TODAY))
  assert.throws(
    () => planStaffSeparationComplete({ ...DETAILS, separationDate: '2026-10-07' }, done, TODAY),
    isDomainError('staff_separation_not_due'),
  )
  assert.throws(
    () =>
      planStaffSeparationComplete(
        DETAILS,
        staffSeparationSteps(NO_MARKS, { ...CLEAN, openAssetCount: 1 }),
        TODAY,
      ),
    (error: unknown) =>
      isDomainError('staff_separation_steps_incomplete')(error) &&
      error instanceof Error &&
      error.message.includes('Zimmet iadesi, Kullanılmayan yıllık izin'),
  )
  assert.throws(
    () => planStaffSeparationComplete({ ...DETAILS, status: 'cancelled' }, done, TODAY),
    isDomainError('staff_separation_closed', 'conflict'),
  )
})

test('DOM-FIN-118 K-403: düzeltme birleşik değerle denetlenir, neden kodu önerir', () => {
  const update = (input: unknown, current = DETAILS) =>
    planStaffSeparationUpdate(current, staffSeparationUpdateSchema.parse(input), TODAY)
  assert.deepEqual(update({ reason: 'retirement' }).changed, ['reason', 'sgkExitCode'])
  assert.equal(update({ reason: 'retirement' }).next.sgkExitCode, '08')
  assert.equal(update({ reason: 'termination', sgkExitCode: '29' }).next.sgkExitCode, '29')
  assert.equal(update({ sgkExitCode: '22' }).next.reason, 'resignation')
  assert.deepEqual(update({ note: 'Teslim alındı', hireDate: null }).changed, ['hireDate', 'note'])
  assert.throws(
    () => update({ reason: 'resignation' }),
    isDomainError('staff_separation_unchanged'),
  )
  assert.throws(
    () => update({ separationDate: '2021-08-01' }),
    isDomainError('staff_separation_hire_after_exit'),
  )
  assert.throws(
    () => update({ noticeGivenDate: '2021-08-01' }),
    isDomainError('staff_separation_notice_before_hire'),
  )
  assert.throws(
    () => update({ separationDate: '2026-09-01' }, { ...DETAILS, noticeGivenDate: '2026-09-15' }),
    isDomainError('staff_separation_notice_after_exit'),
  )
  assert.throws(
    () => update({ separationDate: '2028-01-01' }),
    isDomainError('staff_separation_date_too_far'),
  )
  assert.throws(
    () => update({ note: 'x' }, { ...DETAILS, status: 'completed' as never }),
    isDomainError('staff_separation_closed', 'conflict'),
  )
  assert.equal(staffSeparationUpdateSchema.safeParse({}).success, false)
})

test('DOM-FIN-118 K-403: iptal gerekçe ister ve yalnız açık dosyada', () => {
  assert.deepEqual(
    planStaffSeparationCancel({ status: 'open' }, { reason: '  Yanlış personel ' }),
    {
      reason: 'Yanlış personel',
    },
  )
  assert.throws(() => planStaffSeparationCancel({ status: 'open' }, { reason: 'kısa' }))
  assert.throws(
    () => planStaffSeparationCancel({ status: 'completed' }, { reason: 'Yanlış personel' }),
    isDomainError('staff_separation_closed', 'conflict'),
  )
})

test('DOM-FIN-118: ilişik kesme belgesi metni taslakta ilişik kesildi demez', () => {
  const base = {
    staffName: 'Selin Kaya',
    staffRole: 'ogretmen',
    hireDate: '2021-09-01',
    separationDate: '2026-09-30',
    reason: 'resignation' as const,
  }
  const [first, done] = staffSeparationParagraphs({ ...base, status: 'completed' })
  assert.match(first ?? '', /Selin Kaya, kurumumuzda .*2021.* öğretmen olarak çalışmış/)
  assert.match(first ?? '', /"İstifa" nedeniyle/)
  assert.match(done ?? '', /ilişiği kesilmiştir/)
  const [noHire, draft] = staffSeparationParagraphs({ ...base, hireDate: null, status: 'open' })
  assert.doesNotMatch(noHire ?? '', /tarihinden itibaren/)
  assert.match(draft ?? '', /ilişiğin kesildiğini göstermez/)
  assert.equal(staffRoleText('muhasebe'), 'muhasebe')
})
