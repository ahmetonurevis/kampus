import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertJobApplication,
  assertJobApplicationAnonymization,
  DEFAULT_JOB_APPLICATION_SETTINGS,
  jobApplicationAnonymizationInputSchema,
  jobApplicationInputSchema,
  jobApplicationSettingsSchema,
  jobApplicationUpdateSchema,
  jobPostingInputSchema,
  planJobApplicationSettings,
  planJobApplicationStage,
  planJobApplicationUpdate,
  planJobPostingStatus,
  planJobPostingUpdate,
  retentionDueOn,
  retentionStartOn,
  type AnonymizationTarget,
  type JobApplicationChecks,
  type StoredJobApplicationState,
  type StoredJobPostingState,
} from '../packages/school-core/src/lib/finance-job-postings.ts'

/** İş ilanı ve başvuru havuzu kuralları (DOM-FIN-128; ON-177; K-439…K-441). */

const TODAY = '2026-10-06'
const POSTING = '00000000-0000-4000-8000-000000000001'
const APP_A = '00000000-0000-4000-8000-000000000002'
const APP_B = '00000000-0000-4000-8000-000000000003'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
  return 'none'
}

const postingInput = {
  title: 'İngilizce öğretmeni',
  position: 'İngilizce öğretmeni',
  employmentType: 'full_time',
  description: 'Ortaokul İngilizce dersleri için öğretmen arıyoruz.',
  publishOn: '2026-09-01',
  deadlineOn: '2026-10-31',
} as const

const stored = (overrides: Partial<StoredJobPostingState> = {}): StoredJobPostingState => ({
  ...jobPostingInputSchema.parse(postingInput),
  status: 'draft',
  ...overrides,
})

const applicationInput = {
  jobPostingId: POSTING,
  candidateName: 'Deniz Aday',
  email: 'Deniz@Ornek.com',
  channel: 'email',
  receivedOn: '2026-09-10',
  privacyNoticeVersion: 'v1',
  privacyNoticeShownOn: '2026-09-10',
} as const

const appChecks = (overrides: Partial<JobApplicationChecks> = {}): JobApplicationChecks => ({
  posting: { status: 'published', publishOn: '2026-09-01', deadlineOn: '2026-10-31' },
  duplicate: null,
  today: TODAY,
  ...overrides,
})

const application = (
  overrides: Partial<StoredJobApplicationState> = {},
): StoredJobApplicationState => ({
  candidateName: 'Deniz Aday',
  email: 'deniz@ornek.com',
  phone: null,
  note: null,
  stage: 'new',
  stageChangedOn: '2026-09-10',
  anonymizedAt: null,
  ...overrides,
})

describe('DOM-FIN-128: iş ilanı kuralı', () => {
  test('ilan şeması: son başvuru yayından önce olamaz, nitelik boşsa null (K-439)', () => {
    const parsed = jobPostingInputSchema.parse({ ...postingInput, requirements: '  ' })
    assert.equal(parsed.requirements, null)
    const bad = jobPostingInputSchema.safeParse({ ...postingInput, deadlineOn: '2026-08-31' })
    assert.equal(bad.success, false)
    assert.deepEqual(bad.error?.issues[0]?.path, ['deadlineOn'])
    assert.equal(
      jobPostingInputSchema.safeParse({ ...postingInput, employmentType: 'intern' }).success,
      false,
    )
    assert.equal(
      jobPostingInputSchema.safeParse({ ...postingInput, institutionId: 'x' }).success,
      false,
    )
  })

  test('ilan düzeltmesi: kapanan değişmez, yayın günü kilitli, son gün başvurulardan önceye çekilmez (K-439)', () => {
    const input = jobPostingInputSchema.parse({ ...postingInput, title: 'Yeni başlık' })
    assert.deepEqual(planJobPostingUpdate(stored(), input, { latestReceivedOn: null }), ['title'])
    assert.equal(
      code(() =>
        planJobPostingUpdate(stored({ status: 'closed' }), input, { latestReceivedOn: null }),
      ),
      'job_posting_closed',
    )
    assert.equal(
      code(() =>
        planJobPostingUpdate(stored(), jobPostingInputSchema.parse(postingInput), {
          latestReceivedOn: null,
        }),
      ),
      'job_posting_unchanged',
    )
    const moved = jobPostingInputSchema.parse({ ...postingInput, publishOn: '2026-09-02' })
    assert.equal(
      code(() =>
        planJobPostingUpdate(stored({ status: 'published' }), moved, { latestReceivedOn: null }),
      ),
      'job_posting_publish_locked',
    )
    assert.deepEqual(planJobPostingUpdate(stored(), moved, { latestReceivedOn: null }), [
      'publishOn',
    ])
    const shorter = jobPostingInputSchema.parse({ ...postingInput, deadlineOn: '2026-09-15' })
    assert.equal(
      code(() =>
        planJobPostingUpdate(stored({ status: 'published' }), shorter, {
          latestReceivedOn: '2026-09-20',
        }),
      ),
      'job_posting_deadline_before_applications',
    )
  })

  test('ilan durumu: taslak → yayında → kapandı, kapanan yeniden açılmaz (K-439)', () => {
    assert.deepEqual(planJobPostingStatus(stored(), 'published', TODAY), {
      status: 'published',
      closedOn: null,
    })
    assert.deepEqual(planJobPostingStatus(stored(), 'closed', TODAY), {
      status: 'closed',
      closedOn: TODAY,
    })
    assert.deepEqual(planJobPostingStatus(stored({ status: 'published' }), 'closed', TODAY), {
      status: 'closed',
      closedOn: TODAY,
    })
    assert.equal(
      code(() => planJobPostingStatus(stored({ status: 'closed' }), 'published', TODAY)),
      'job_posting_transition',
    )
    assert.equal(
      code(() => planJobPostingStatus(stored({ status: 'published' }), 'published', TODAY)),
      'job_posting_transition',
    )
    assert.equal(
      code(() => planJobPostingStatus(stored({ deadlineOn: '2026-10-05' }), 'published', TODAY)),
      'job_posting_deadline_passed',
    )
  })
})

describe('DOM-FIN-128: başvuru kuralı', () => {
  test('başvuru şeması: iletişimden biri ve aydınlatma sürümü zorunlu, e-posta küçük harf (K-440)', () => {
    const parsed = jobApplicationInputSchema.parse(applicationInput)
    assert.equal(parsed.email, 'deniz@ornek.com')
    assert.equal(parsed.phone, null)
    assert.equal(parsed.cvFileId, null)
    const phoneOnly = jobApplicationInputSchema.parse({
      ...applicationInput,
      email: '',
      phone: '0532 123 45 67',
    })
    assert.equal(phoneOnly.phone, '05321234567')
    const none = jobApplicationInputSchema.safeParse({ ...applicationInput, email: null })
    assert.equal(none.success, false)
    assert.deepEqual(none.error?.issues[0]?.path, ['email'])
    const noNotice = jobApplicationInputSchema.safeParse({
      ...applicationInput,
      privacyNoticeVersion: ' ',
    })
    assert.equal(noNotice.success, false)
    assert.equal(
      jobApplicationInputSchema.safeParse({ ...applicationInput, privacyNoticeShownOn: undefined })
        .success,
      false,
    )
    assert.equal(
      jobApplicationInputSchema.safeParse({ ...applicationInput, phone: '123' }).success,
      false,
    )
    assert.equal(
      jobApplicationInputSchema.safeParse({ ...applicationInput, channel: 'fax' }).success,
      false,
    )
  })

  test('başvuru kaydı: ilan, gün aralığı, aydınlatma günü ve mükerrer (K-440)', () => {
    const input = jobApplicationInputSchema.parse(applicationInput)
    assert.equal(
      code(() => assertJobApplication(input, appChecks())),
      'none',
    )
    // Kapanan ilana süresinde gelmiş başvuru sonradan girilebilir.
    assert.equal(
      code(() =>
        assertJobApplication(
          input,
          appChecks({
            posting: { status: 'closed', publishOn: '2026-09-01', deadlineOn: '2026-10-31' },
          }),
        ),
      ),
      'none',
    )
    assert.equal(
      code(() => assertJobApplication(input, appChecks({ posting: null }))),
      'job_application_posting_not_found',
    )
    assert.equal(
      code(() =>
        assertJobApplication(
          input,
          appChecks({
            posting: { status: 'draft', publishOn: '2026-09-01', deadlineOn: '2026-10-31' },
          }),
        ),
      ),
      'job_application_posting_draft',
    )
    const cases: [Partial<typeof input>, string][] = [
      [{ receivedOn: '2026-10-07' }, 'job_application_received_in_future'],
      [{ receivedOn: '2026-08-31' }, 'job_application_before_publish'],
      [{ privacyNoticeShownOn: '2026-10-07' }, 'job_application_notice_in_future'],
    ]
    for (const [patch, expected] of cases)
      assert.equal(
        code(() => assertJobApplication({ ...input, ...patch }, appChecks())),
        expected,
      )
    assert.equal(
      code(() =>
        assertJobApplication(
          { ...input, receivedOn: '2026-10-01' },
          appChecks({
            posting: { status: 'closed', publishOn: '2026-09-01', deadlineOn: '2026-09-30' },
          }),
        ),
      ),
      'job_application_after_deadline',
    )
    assert.equal(
      code(() => assertJobApplication(input, appChecks({ duplicate: 'phone' }))),
      'job_application_duplicate',
    )
  })

  test('başvuru düzeltmesi: değişen alanlar, iletişim kalmalı, anonim değişmez', () => {
    const plan = planJobApplicationUpdate(
      application(),
      jobApplicationUpdateSchema.parse({ phone: '05321234567', note: 'Referansı var' }),
    )
    assert.deepEqual(plan.changed, ['phone', 'note'])
    assert.equal(plan.next.email, 'deniz@ornek.com')
    assert.equal(
      code(() =>
        planJobApplicationUpdate(application(), jobApplicationUpdateSchema.parse({ email: '' })),
      ),
      'job_application_contact_required',
    )
    assert.equal(
      code(() =>
        planJobApplicationUpdate(
          application(),
          jobApplicationUpdateSchema.parse({ candidateName: 'Deniz Aday' }),
        ),
      ),
      'job_application_unchanged',
    )
    assert.equal(
      code(() =>
        planJobApplicationUpdate(
          application({ anonymizedAt: '2026-10-01T00:00:00.000Z' }),
          jobApplicationUpdateSchema.parse({ note: 'x' }),
        ),
      ),
      'job_application_anonymized',
    )
    assert.equal(jobApplicationUpdateSchema.safeParse({}).success, false)
  })

  test('aşama: ileri atlanır, geri dönülmez, ret her açık aşamadan, son aşamalar kilitli (K-440)', () => {
    const at = (stage: StoredJobApplicationState['stage']) => application({ stage })
    assert.deepEqual(
      planJobApplicationStage(at('new'), { stage: 'interview', changedOn: TODAY }, TODAY),
      { stage: 'interview', changedOn: TODAY },
    )
    assert.equal(
      planJobApplicationStage(at('offer'), { stage: 'rejected', changedOn: TODAY }, TODAY).stage,
      'rejected',
    )
    assert.equal(
      planJobApplicationStage(at('offer'), { stage: 'hired', changedOn: TODAY }, TODAY).stage,
      'hired',
    )
    assert.equal(
      code(() =>
        planJobApplicationStage(at('interview'), { stage: 'screening', changedOn: TODAY }, TODAY),
      ),
      'job_application_stage_transition',
    )
    assert.equal(
      code(() =>
        planJobApplicationStage(at('screening'), { stage: 'screening', changedOn: TODAY }, TODAY),
      ),
      'job_application_stage_unchanged',
    )
    for (const closed of ['hired', 'rejected'] as const)
      assert.equal(
        code(() =>
          planJobApplicationStage(at(closed), { stage: 'rejected', changedOn: TODAY }, TODAY),
        ),
        'job_application_closed',
      )
    assert.equal(
      code(() =>
        planJobApplicationStage(at('new'), { stage: 'screening', changedOn: '2026-10-07' }, TODAY),
      ),
      'job_application_stage_in_future',
    )
    assert.equal(
      code(() =>
        planJobApplicationStage(at('new'), { stage: 'screening', changedOn: '2026-09-09' }, TODAY),
      ),
      'job_application_stage_before_previous',
    )
    assert.equal(
      code(() =>
        planJobApplicationStage(
          application({ anonymizedAt: '2026-10-01T00:00:00.000Z' }),
          { stage: 'screening', changedOn: TODAY },
          TODAY,
        ),
      ),
      'job_application_anonymized',
    )
  })
})

describe('DOM-FIN-128: saklama ve anonimleştirme', () => {
  test('saklama başlangıcı: ret günü, ilanın kapanışı; işe alınan ve süren başvuruda yok (K-441)', () => {
    const base = { stageChangedOn: '2026-01-31', postingClosedOn: null, anonymizedAt: null }
    assert.equal(retentionStartOn({ ...base, stage: 'rejected' }), '2026-01-31')
    assert.equal(retentionStartOn({ ...base, stage: 'interview' }), null)
    assert.equal(
      retentionStartOn({ ...base, stage: 'interview', postingClosedOn: '2026-03-01' }),
      '2026-03-01',
    )
    assert.equal(
      retentionStartOn({ ...base, stage: 'rejected', postingClosedOn: '2026-03-01' }),
      '2026-01-31',
    )
    assert.equal(retentionStartOn({ ...base, stage: 'hired', postingClosedOn: '2026-03-01' }), null)
    assert.equal(
      retentionStartOn({ ...base, stage: 'rejected', anonymizedAt: '2026-05-01T00:00:00.000Z' }),
      null,
    )
    // Hedef ayda gün yoksa ayın son günü.
    assert.equal(retentionDueOn({ ...base, stage: 'rejected' }, 1), '2026-02-28')
    assert.equal(retentionDueOn({ ...base, stage: 'interview' }, 12), null)
  })

  test('anonimleştirme: süre dolmalı, talepte süre beklenmez, işe alınan ve anonim reddedilir (K-441)', () => {
    const target = (overrides: Partial<AnonymizationTarget>): AnonymizationTarget => ({
      id: APP_A,
      stage: 'rejected',
      stageChangedOn: '2025-09-01',
      postingClosedOn: null,
      anonymizedAt: null,
      ...overrides,
    })
    const run = (
      found: AnonymizationTarget[],
      reason: 'retention_expired' | 'data_subject_request',
      ids = found.map((row) => row.id),
    ) =>
      code(() =>
        assertJobApplicationAnonymization(
          jobApplicationAnonymizationInputSchema.parse({ applicationIds: ids, reason }),
          new Map(found.map((row) => [row.id, row])),
          { retentionMonths: 12, today: TODAY },
        ),
      )
    assert.equal(run([target({})], 'retention_expired'), 'none')
    assert.equal(
      run([target({ stageChangedOn: '2025-10-07' })], 'retention_expired'),
      'job_application_retention_not_due',
    )
    assert.equal(run([target({ stageChangedOn: '2025-10-06' })], 'retention_expired'), 'none')
    assert.equal(
      run([target({ stage: 'interview' })], 'retention_expired'),
      'job_application_retention_not_due',
    )
    assert.equal(run([target({ stage: 'interview' })], 'data_subject_request'), 'none')
    assert.equal(run([target({ stage: 'hired' })], 'data_subject_request'), 'job_application_hired')
    assert.equal(
      run([target({ anonymizedAt: '2026-01-01T00:00:00.000Z' })], 'data_subject_request'),
      'job_application_already_anonymized',
    )
    assert.equal(
      run([target({})], 'retention_expired', [APP_A, APP_B]),
      'job_application_not_found',
    )
    assert.equal(
      jobApplicationAnonymizationInputSchema.safeParse({
        applicationIds: [APP_A, APP_A],
        reason: 'retention_expired',
      }).success,
      false,
    )
    assert.equal(
      jobApplicationAnonymizationInputSchema.safeParse({
        applicationIds: [],
        reason: 'retention_expired',
      }).success,
      false,
    )
  })

  test('saklama ayarı: 1–60 ay, gönderilmeyen alan korunur, değişiklik yoksa 422 (K-441)', () => {
    const plan = planJobApplicationSettings(
      DEFAULT_JOB_APPLICATION_SETTINGS,
      jobApplicationSettingsSchema.parse({ retentionMonths: 6 }),
    )
    assert.deepEqual(plan, {
      next: { retentionMonths: 6, privacyNoticeVersion: null },
      changed: ['retentionMonths'],
    })
    assert.equal(
      planJobApplicationSettings(
        plan.next,
        jobApplicationSettingsSchema.parse({ privacyNoticeVersion: ' 2026/1 ' }),
      ).next.privacyNoticeVersion,
      '2026/1',
    )
    assert.equal(
      code(() =>
        planJobApplicationSettings(
          DEFAULT_JOB_APPLICATION_SETTINGS,
          jobApplicationSettingsSchema.parse({ retentionMonths: 12 }),
        ),
      ),
      'job_application_settings_unchanged',
    )
    for (const retentionMonths of [0, 61, 1.5])
      assert.equal(jobApplicationSettingsSchema.safeParse({ retentionMonths }).success, false)
    assert.equal(jobApplicationSettingsSchema.safeParse({}).success, false)
  })
})
