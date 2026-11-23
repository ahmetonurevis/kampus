import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOnboardingSteps,
  DEFAULT_ORIENTATION_STEPS,
  isEvidenceStep,
  jobOfferAcceptSchema,
  jobOfferInputSchema,
  jobOfferLetterParagraphs,
  jobOfferUpdateSchema,
  jobOfferWageText,
  onboardingProgress,
  onboardingSettingsSchema,
  onboardingState,
  onboardingStepCompleteSchema,
  onboardingStepEvidence,
  onboardingStepUpdateSchema,
  planJobOffer,
  planJobOfferDecision,
  planJobOfferSend,
  planJobOfferUpdate,
  planJobOfferWithdraw,
  planOnboardingLink,
  planOnboardingStepComplete,
  planOnboardingStepReopen,
  planOnboardingStepUpdate,
  type JobOfferCurrent,
  type OnboardingFacts,
} from '../packages/school-core/src/lib/finance-staff-onboarding.ts'

import { isDomainError } from './support/domain-error.ts'

// İş teklifi ve işe başlama listesi (DOM-FIN-121; ON-179). Kararlar K-412…K-414.

const TODAY = '2026-10-06'
const BODY = {
  candidateName: ' Ayşe Aday ',
  position: 'İngilizce öğretmeni',
  staffRole: 'ogretmen',
  startDate: '2026-11-02',
  wageType: 'monthly_gross',
  offeredAmountCents: 4_500_000,
}
const offer = (overrides: Partial<JobOfferCurrent> = {}): JobOfferCurrent => ({
  status: 'draft',
  membershipId: null,
  candidateName: 'Ayşe Aday',
  candidateEmail: null,
  candidatePhone: null,
  position: 'İngilizce öğretmeni',
  staffRole: 'ogretmen',
  startDate: '2026-11-02',
  wageType: 'monthly_gross',
  offeredAmountCents: 4_500_000,
  respondBy: null,
  note: null,
  sentOn: null,
  acceptedOn: null,
  ...overrides,
})
const facts = (overrides: Partial<OnboardingFacts> = {}): OnboardingFacts => ({
  startDate: '2026-11-02',
  wageType: 'monthly_gross',
  offeredAmountCents: 4_500_000,
  member: { role: 'ogretmen', active: true },
  documentTypes: new Set(),
  workPermit: null,
  wage: null,
  seniorityStartDate: null,
  openAssetCount: 0,
  ...overrides,
})

test('DOM-FIN-121: K-412 teklif şeması aday adı ve iletişimini normalleştirir', () => {
  const parsed = jobOfferInputSchema.parse({
    ...BODY,
    candidateEmail: ' Ayse@Ornek.COM ',
    candidatePhone: '0 (532) 111-22-33',
    note: '   ',
  })
  assert.equal(parsed.candidateName, 'Ayşe Aday')
  assert.equal(parsed.candidateEmail, 'ayse@ornek.com')
  assert.equal(parsed.candidatePhone, '05321112233')
  assert.equal(parsed.note, null)
  assert.equal(parsed.membershipId, null)
  assert.equal(parsed.respondBy, null)
  const empty = jobOfferInputSchema.parse({ ...BODY, candidateEmail: '', candidatePhone: '' })
  assert.equal(empty.candidateEmail, null)
  assert.equal(empty.candidatePhone, null)
})

test('DOM-FIN-121: K-412 aday adı ya da personel zorunlu; personelde aday verisi yazılmaz', () => {
  const missing = jobOfferInputSchema.safeParse({ ...BODY, candidateName: null })
  assert.equal(missing.success, false)
  assert.deepEqual(missing.error?.issues[0]?.path, ['candidateName'])
  const both = jobOfferInputSchema.safeParse({
    ...BODY,
    membershipId: 'm-1',
    candidatePhone: '05321112233',
  })
  assert.equal(both.success, false)
  assert.deepEqual(
    both.error?.issues.map((issue) => issue.path[0]),
    ['candidateName', 'candidatePhone'],
  )
  const staff = jobOfferInputSchema.parse({ ...BODY, candidateName: null, membershipId: 'm-1' })
  assert.equal(staff.membershipId, 'm-1')
  for (const bad of [
    { candidatePhone: '532 111 22 33' },
    { candidateEmail: 'yanlis' },
    { offeredAmountCents: 0 },
    { offeredAmountCents: 12.5 },
    { position: 'X' },
    { staffRole: 'veli' },
    { wageType: 'weekly' },
  ])
    assert.equal(jobOfferInputSchema.safeParse({ ...BODY, ...bad }).success, false, String(bad))
  assert.equal(jobOfferInputSchema.safeParse({ ...BODY, institutionId: 'x' }).success, false)
})

test('DOM-FIN-121: K-412 iç adayda üyelik kurumun etkin personeli olmalı', () => {
  const input = jobOfferInputSchema.parse({ ...BODY, candidateName: null, membershipId: 'm-1' })
  planJobOffer(input, { role: 'onburo', active: true })
  planJobOffer(jobOfferInputSchema.parse(BODY), null)
  assert.throws(() => planJobOffer(input, null), isDomainError('job_offer_not_found'))
  assert.throws(
    () => planJobOffer(input, { role: 'veli', active: true }),
    isDomainError('job_offer_not_staff'),
  )
  assert.throws(
    () => planJobOffer(input, { role: 'ogretmen', active: false }),
    isDomainError('job_offer_inactive'),
  )
})

test('DOM-FIN-121: K-412 yalnız taslak düzeltilir; değişen alanlar döner', () => {
  const changes = jobOfferUpdateSchema.parse({ position: 'Müdür yardımcısı', note: '' })
  assert.deepEqual(planJobOfferUpdate(offer(), changes), ['position'])
  assert.deepEqual(planJobOfferUpdate(offer({ note: 'Eski' }), changes), ['position', 'note'])
  assert.throws(
    () => planJobOfferUpdate(offer({ status: 'sent' }), changes),
    isDomainError('job_offer_not_draft'),
  )
  assert.throws(
    () =>
      planJobOfferUpdate(offer(), jobOfferUpdateSchema.parse({ position: 'İngilizce öğretmeni' })),
    isDomainError('job_offer_unchanged'),
  )
  assert.throws(
    () =>
      planJobOfferUpdate(
        offer({ membershipId: 'm-1', candidateName: null }),
        jobOfferUpdateSchema.parse({ candidateName: 'Yeni Ad' }),
      ),
    isDomainError('job_offer_candidate_is_staff'),
  )
  assert.equal(jobOfferUpdateSchema.safeParse({}).success, false)
})

test('DOM-FIN-121: K-412 durum geçişleri: gönder, kabul, ret, geri çek', () => {
  planJobOfferSend(offer(), { sentOn: TODAY }, TODAY)
  assert.throws(
    () => planJobOfferSend(offer({ status: 'sent' }), { sentOn: TODAY }, TODAY),
    isDomainError('job_offer_not_draft'),
  )
  assert.throws(
    () => planJobOfferSend(offer(), { sentOn: '2026-10-07' }, TODAY),
    isDomainError('job_offer_date_in_future'),
  )
  const sent = offer({ status: 'sent', sentOn: '2026-10-01', respondBy: '2026-10-05' })
  planJobOfferDecision(sent, { decidedOn: '2026-10-05' }, 'accept', TODAY)
  assert.throws(
    () => planJobOfferDecision(sent, { decidedOn: '2026-10-06' }, 'accept', TODAY),
    isDomainError('job_offer_expired'),
  )
  // Süresi geçen teklif reddedilebilir.
  planJobOfferDecision(sent, { decidedOn: '2026-10-06' }, 'reject', TODAY)
  assert.throws(
    () => planJobOfferDecision(sent, { decidedOn: '2026-09-30' }, 'reject', TODAY),
    isDomainError('job_offer_decision_before_sent'),
  )
  assert.throws(
    () => planJobOfferDecision(offer(), { decidedOn: TODAY }, 'accept', TODAY),
    isDomainError('job_offer_not_sent'),
  )
  assert.throws(
    () => planJobOfferDecision(sent, { decidedOn: '2026-10-09' }, 'reject', TODAY),
    isDomainError('job_offer_date_in_future'),
  )
  planJobOfferWithdraw(offer(), { decidedOn: TODAY }, false, TODAY)
  planJobOfferWithdraw(
    offer({ status: 'accepted', sentOn: '2026-10-01', acceptedOn: '2026-10-03' }),
    { decidedOn: '2026-10-03' },
    false,
    TODAY,
  )
  assert.throws(
    () =>
      planJobOfferWithdraw(
        offer({ status: 'accepted', sentOn: '2026-10-01', acceptedOn: '2026-10-03' }),
        { decidedOn: '2026-10-02' },
        false,
        TODAY,
      ),
    isDomainError('job_offer_decision_before_sent'),
  )
  assert.throws(
    () => planJobOfferWithdraw(offer({ status: 'accepted' }), { decidedOn: TODAY }, true, TODAY),
    isDomainError('job_offer_onboarding_completed'),
  )
  for (const status of ['rejected', 'withdrawn'] as const)
    assert.throws(
      () => planJobOfferWithdraw(offer({ status }), { decidedOn: TODAY }, false, TODAY),
      isDomainError('job_offer_closed'),
    )
  assert.equal(jobOfferAcceptSchema.safeParse({ decidedOn: '2026-02-30' }).success, false)
})

test('DOM-FIN-121: K-413 kabulde adımlar: hesap, zorunlu belgeler, öğretmende çalışma onayı, ücret, kıdem, zimmet, oryantasyon', () => {
  const steps = buildOnboardingSteps({
    staffRole: 'ogretmen',
    startDate: '2026-11-02',
    acceptedOn: '2026-10-03',
    membershipLinked: false,
    requiredDocumentTypes: ['diploma', 'criminal_record'],
    orientationSteps: [{ label: 'Bina turu', required: false }],
  })
  assert.deepEqual(
    steps.map((step) => [step.kind, step.documentType, step.label, step.required]),
    [
      ['account', null, 'Personel hesabı açıldı ve bağlandı', true],
      ['document', 'diploma', 'Özlük belgesi: Diploma / mezuniyet belgesi', true],
      ['document', 'criminal_record', 'Özlük belgesi: Adli sicil kaydı', true],
      ['work_permit', null, 'Çalışma onayı alındı', true],
      ['pay_rate', null, 'Ücret tanımı girildi', true],
      ['seniority', null, 'Kıdem başlangıcı girildi', true],
      ['asset_handover', null, 'Zimmet teslim edildi', false],
      ['orientation', null, 'Bina turu', false],
    ],
  )
  assert.ok(steps.every((step) => step.dueDate === '2026-11-02' && step.completedOn === null))
  // İç aday (hesap bağlı) ve öğretmen olmayan rol.
  const desk = buildOnboardingSteps({
    staffRole: 'onburo',
    startDate: '2026-11-02',
    acceptedOn: '2026-10-03',
    membershipLinked: true,
    requiredDocumentTypes: [],
    orientationSteps: DEFAULT_ORIENTATION_STEPS,
  })
  assert.equal(desk[0]?.completedOn, '2026-10-03')
  assert.equal(
    desk.some((step) => step.kind === 'work_permit'),
    false,
  )
  assert.equal(desk.filter((step) => step.kind === 'orientation').length, 3)
  assert.equal(isEvidenceStep('pay_rate'), true)
  assert.equal(isEvidenceStep('asset_handover'), false)
})

test('DOM-FIN-121: K-413 kaynak durumu: hesap, belge, çalışma onayı, ücret, kıdem, zimmet', () => {
  const unlinked = facts({ member: null })
  assert.equal(
    onboardingStepEvidence({ kind: 'account', documentType: null }, unlinked).state,
    'missing',
  )
  for (const kind of ['document', 'work_permit', 'pay_rate', 'seniority'] as const)
    assert.deepEqual(onboardingStepEvidence({ kind, documentType: 'diploma' }, unlinked), {
      state: 'missing',
      detail: 'Önce personel hesabını bağlayın.',
      warning: null,
    })
  assert.equal(
    onboardingStepEvidence({ kind: 'asset_handover', documentType: null }, unlinked).state,
    'manual',
  )
  assert.equal(
    onboardingStepEvidence({ kind: 'account', documentType: null }, facts()).state,
    'met',
  )
  assert.equal(
    onboardingStepEvidence(
      { kind: 'account', documentType: null },
      facts({ member: { role: 'ogretmen', active: false } }),
    ).state,
    'missing',
  )
  const diploma = { kind: 'document' as const, documentType: 'diploma' as const }
  assert.equal(onboardingStepEvidence(diploma, facts()).state, 'missing')
  assert.equal(
    onboardingStepEvidence(diploma, facts({ documentTypes: new Set(['diploma']) })).state,
    'met',
  )
  const permit = { kind: 'work_permit' as const, documentType: null }
  assert.equal(onboardingStepEvidence(permit, facts({ workPermit: 'expiring' })).state, 'met')
  assert.match(onboardingStepEvidence(permit, facts({ workPermit: 'expired' })).detail, /dolmuş/)
  assert.equal(onboardingStepEvidence(permit, facts({ workPermit: 'missing' })).state, 'missing')
  const pay = { kind: 'pay_rate' as const, documentType: null }
  assert.equal(onboardingStepEvidence(pay, facts()).state, 'missing')
  assert.deepEqual(
    onboardingStepEvidence(
      pay,
      facts({
        wage: { rateType: 'monthly_gross', amountCents: 4_500_000, startDate: '2026-11-02' },
      }),
    ).warning,
    null,
  )
  const differs = onboardingStepEvidence(
    pay,
    facts({ wage: { rateType: 'monthly_net', amountCents: 4_000_000, startDate: '2026-11-10' } }),
  )
  assert.equal(differs.state, 'met')
  assert.match(differs.warning ?? '', /tekliften .* farklı\. Tanım işe başlama gününden sonra/)
  const seniority = { kind: 'seniority' as const, documentType: null }
  assert.equal(onboardingStepEvidence(seniority, facts()).state, 'missing')
  assert.equal(
    onboardingStepEvidence(seniority, facts({ seniorityStartDate: '2026-11-02' })).warning,
    null,
  )
  assert.match(
    onboardingStepEvidence(seniority, facts({ seniorityStartDate: '2026-11-01' })).warning ?? '',
    /farklı/,
  )
  assert.match(
    onboardingStepEvidence(
      { kind: 'asset_handover', documentType: null },
      facts({ openAssetCount: 2 }),
    ).detail,
    /2 demirbaş/,
  )
  assert.equal(
    onboardingStepEvidence({ kind: 'orientation', documentType: null }, facts()).state,
    'manual',
  )
})

test('DOM-FIN-121: K-414 tamamlanma zorunlu adımlarla hesaplanır', () => {
  const step = (required: boolean, completedAt: string | null) => ({
    kind: 'orientation' as const,
    required,
    completedOn: completedAt?.slice(0, 10) ?? null,
    completedAt,
  })
  assert.deepEqual(
    onboardingProgress([step(true, null), step(false, '2026-10-02T08:00:00.000Z')]),
    {
      total: 2,
      done: 1,
      requiredTotal: 1,
      requiredDone: 0,
      completed: false,
      completedAt: null,
    },
  )
  const done = onboardingProgress([
    step(true, '2026-10-03T08:00:00.000Z'),
    step(true, '2026-10-05T08:00:00.000Z'),
    step(false, null),
  ])
  assert.equal(done.completed, true)
  assert.equal(done.completedAt, '2026-10-05T08:00:00.000Z')
  assert.equal(onboardingProgress([]).completed, false)
  assert.equal(onboardingState('sent', false, false), 'none')
  assert.equal(onboardingState('accepted', false, true), 'open')
  assert.equal(onboardingState('accepted', true, true), 'completed')
  assert.equal(onboardingState('withdrawn', false, true), 'closed')
})

test('DOM-FIN-121: K-413 kaynağı olmayan adım işaretlenmez; liste kapalıysa değişmez', () => {
  const step = {
    kind: 'pay_rate' as const,
    documentType: null,
    required: true,
    completedOn: null,
    completedAt: null,
  }
  const input = onboardingStepCompleteSchema.parse({ completedOn: TODAY })
  assert.equal(input.note, null)
  const missing = onboardingStepEvidence(step, facts())
  assert.throws(
    () => planOnboardingStepComplete({ status: 'accepted' }, step, missing, input, TODAY),
    (error: unknown) =>
      isDomainError('onboarding_step_evidence_missing')(error) &&
      (error as Error).message.includes('ana ücret'),
  )
  const met = onboardingStepEvidence(
    step,
    facts({ wage: { rateType: 'monthly_gross', amountCents: 1, startDate: '2026-11-02' } }),
  )
  planOnboardingStepComplete({ status: 'accepted' }, step, met, input, TODAY)
  assert.throws(
    () =>
      planOnboardingStepComplete(
        { status: 'accepted' },
        step,
        met,
        { completedOn: '2026-10-07', note: null },
        TODAY,
      ),
    isDomainError('onboarding_date_in_future'),
  )
  assert.throws(
    () =>
      planOnboardingStepComplete(
        { status: 'accepted' },
        { ...step, completedOn: TODAY },
        met,
        input,
        TODAY,
      ),
    isDomainError('onboarding_step_completed'),
  )
  for (const status of ['sent', 'withdrawn'] as const)
    assert.throws(
      () => planOnboardingStepComplete({ status }, step, met, input, TODAY),
      isDomainError('onboarding_not_open'),
    )
  planOnboardingStepReopen({ status: 'accepted' }, { completedOn: TODAY })
  assert.throws(
    () => planOnboardingStepReopen({ status: 'accepted' }, { completedOn: null }),
    isDomainError('onboarding_step_not_completed'),
  )
})

test('DOM-FIN-121: K-414 sorumlu kurumun etkin personeli', () => {
  const input = onboardingStepUpdateSchema.parse({ responsibleMembershipId: 'm-2' })
  planOnboardingStepUpdate({ status: 'accepted' }, input, { role: 'yonetici', active: true })
  planOnboardingStepUpdate(
    { status: 'accepted' },
    onboardingStepUpdateSchema.parse({ responsibleMembershipId: null, dueDate: null }),
    null,
  )
  assert.throws(
    () => planOnboardingStepUpdate({ status: 'accepted' }, input, null),
    isDomainError('onboarding_responsible_not_found'),
  )
  assert.throws(
    () =>
      planOnboardingStepUpdate({ status: 'accepted' }, input, { role: 'ogrenci', active: true }),
    isDomainError('onboarding_responsible_not_staff'),
  )
  assert.equal(onboardingStepUpdateSchema.safeParse({}).success, false)
})

test('DOM-FIN-121: K-413 hesap bağlama: rol, kilit, başka liste (IST-007)', () => {
  const accepted = {
    status: 'accepted' as const,
    membershipId: null,
    staffRole: 'ogretmen' as const,
  }
  const ok = {
    member: { role: 'ogretmen', active: true },
    linkedElsewhere: false,
    dependentStepCompleted: false,
  }
  planOnboardingLink(accepted, 'm-1', ok)
  assert.throws(
    () => planOnboardingLink(accepted, 'm-1', { ...ok, member: { role: 'onburo', active: true } }),
    isDomainError('onboarding_member_role_mismatch'),
  )
  assert.throws(
    () => planOnboardingLink(accepted, 'm-1', { ...ok, member: null }),
    isDomainError('onboarding_member_not_found'),
  )
  assert.throws(
    () => planOnboardingLink({ ...accepted, membershipId: 'm-1' }, 'm-1', ok),
    isDomainError('onboarding_member_unchanged'),
  )
  assert.throws(
    () =>
      planOnboardingLink({ ...accepted, membershipId: 'm-0' }, 'm-1', {
        ...ok,
        dependentStepCompleted: true,
      }),
    isDomainError('onboarding_member_locked'),
  )
  assert.throws(
    () => planOnboardingLink(accepted, 'm-1', { ...ok, linkedElsewhere: true }),
    isDomainError('onboarding_member_linked'),
  )
  assert.throws(
    () => planOnboardingLink({ ...accepted, status: 'sent' }, 'm-1', ok),
    isDomainError('onboarding_not_open'),
  )
})

test('DOM-FIN-121: K-413 oryantasyon ayarı en çok 20 adım, aynı ad yok', () => {
  const parsed = onboardingSettingsSchema.parse({
    orientationSteps: [{ label: ' Bina turu ', required: true }],
  })
  assert.equal(parsed.orientationSteps[0]?.label, 'Bina turu')
  const duplicate = onboardingSettingsSchema.safeParse({
    orientationSteps: [
      { label: 'İSG eğitimi', required: true },
      { label: 'isg eğitimi', required: false },
    ],
  })
  assert.equal(duplicate.success, false)
  assert.deepEqual(duplicate.error?.issues[0]?.path, ['orientationSteps', 1, 'label'])
  const many = Array.from({ length: 21 }, (_, index) => ({
    label: `Adım ${String(index)}`,
    required: false,
  }))
  assert.equal(onboardingSettingsSchema.safeParse({ orientationSteps: many }).success, false)
  assert.equal(onboardingSettingsSchema.safeParse({ orientationSteps: [] }).success, true)
})

test('DOM-FIN-121: K-412 teklif mektubu metni', () => {
  const letter = {
    institutionName: 'Akademi Özel Okulları',
    candidateName: 'Ayşe Aday',
    position: 'İngilizce öğretmeni',
    staffRole: 'ogretmen' as const,
    startDate: '2026-11-02',
    wageType: 'monthly_gross' as const,
    offeredAmountCents: 4_500_050,
    respondBy: '2026-10-20',
    note: null,
  }
  const paragraphs = jobOfferLetterParagraphs(letter)
  assert.equal(paragraphs[0], 'Sayın Ayşe Aday,')
  assert.match(
    paragraphs[1] ?? '',
    /Akademi Özel Okulları bünyesinde İngilizce öğretmeni görevinde 2 Kasım 2026/,
  )
  assert.match(paragraphs[2] ?? '', /en geç 20 Ekim 2026/)
  assert.match(jobOfferLetterParagraphs({ ...letter, respondBy: null })[2] ?? '', /en kısa sürede/)
  assert.equal(jobOfferWageText(letter), '45.000,50 ₺ (Aylık brüt)')
})
