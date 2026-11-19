import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FINANCE_PERFORMANCE_ROLES,
  isPerformanceScored,
  nextPerformanceStatus,
  performanceGoalsSchema,
  performanceOverallScore,
  performancePeriodInputSchema,
  performanceReviewCreateSchema,
  performanceReviewUpdateSchema,
  planPerformancePeriodStatus,
  planPerformanceReview,
  planPerformanceReviewUpdate,
  type PerformanceGoal,
  type PerformancePeriodStatus,
  type PerformanceReviewChecks,
} from '../packages/school-core/src/lib/finance-performance.ts'

import { isDomainError } from './support/domain-error.ts'

// Personel performans dönemi (DOM-FIN-124; ON-211). Kararlar K-427…K-429.

const TODAY = '2026-11-19'
const GOALS = [
  { title: 'Okuma becerisi', criterion: 'Sınıf ortalaması B1', weight: 60 },
  { title: 'Veli görüşmesi', criterion: 'Her veliyle iki görüşme', weight: 40 },
]
const STORED: PerformanceGoal[] = GOALS.map((goal) => ({ ...goal, score: null }))
const PERIOD = { startDate: '2026-09-01', endDate: '2027-01-31' }
const at = (status: PerformancePeriodStatus) => ({ ...PERIOD, status })
const update = (input: unknown) => performanceReviewUpdateSchema.parse(input)

const checks = (patch: Partial<PerformanceReviewChecks> = {}): PerformanceReviewChecks => ({
  period: { status: 'planning' },
  staff: { userId: 'u-selin', role: 'ogretmen', active: true },
  duplicate: false,
  actorUserId: 'u-yonetici',
  ...patch,
})
const create = (input: unknown = { membershipId: 'm-selin', goals: GOALS }) =>
  performanceReviewCreateSchema.parse(input)

test('DOM-FIN-124 K-429: performans verisi yalnız yöneticidedir', () => {
  assert.deepEqual([...FINANCE_PERFORMANCE_ROLES], ['yonetici'])
})

test('DOM-FIN-124 K-428: genel puan ağırlıklı ortalamadır, iki ondalık', () => {
  assert.equal(
    performanceOverallScore([
      { weight: 60, score: 4 },
      { weight: 40, score: 3 },
    ]),
    3.6,
  )
  assert.equal(
    performanceOverallScore([
      { weight: 33, score: 5 },
      { weight: 33, score: 4 },
      { weight: 34, score: 2 },
    ]),
    3.65,
  )
  assert.equal(performanceOverallScore([{ weight: 100, score: 5 }]), 5)
  assert.equal(
    performanceOverallScore([
      { weight: 60, score: 4 },
      { weight: 40, score: null },
    ]),
    null,
  )
  assert.equal(performanceOverallScore([]), null)
  assert.equal(performanceOverallScore([{ weight: 0, score: 3 }]), null)
  assert.equal(isPerformanceScored(STORED), false)
  assert.equal(isPerformanceScored([]), false)
  assert.equal(isPerformanceScored([{ score: 2 }]), true)
})

test('DOM-FIN-124: hedef ağırlıklarının toplamı tam 100, 1–10 hedef', () => {
  assert.equal(performanceGoalsSchema.safeParse(GOALS).success, true)
  const short = performanceGoalsSchema.safeParse([{ ...GOALS[0], weight: 50 }])
  assert.equal(short.success, false)
  assert.match(short.error?.issues[0]?.message ?? '', /%100.*%50/)
  assert.equal(performanceGoalsSchema.safeParse([]).success, false)
  const eleven = Array.from({ length: 11 }, (_, i) => ({
    title: `Hedef ${String(i)}`,
    criterion: 'Ölçüt',
    weight: i === 0 ? 0 : 10,
  }))
  assert.equal(performanceGoalsSchema.safeParse(eleven).success, false)
  assert.equal(performanceGoalsSchema.safeParse([{ ...GOALS[0], weight: 100.5 }]).success, false)
})

test('DOM-FIN-124: dönem bitişi başlangıçtan önce olamaz', () => {
  assert.equal(performancePeriodInputSchema.safeParse({ name: 'Güz', ...PERIOD }).success, true)
  const wrong = performancePeriodInputSchema.safeParse({
    name: 'Güz',
    startDate: '2026-09-01',
    endDate: '2026-08-31',
  })
  assert.equal(wrong.success, false)
  assert.deepEqual(wrong.error?.issues[0]?.path, ['endDate'])
})

test('DOM-FIN-124 K-427: aşamalar sırayla ilerler, geri dönmez, kapanış puan ister', () => {
  assert.equal(nextPerformanceStatus('planning'), 'active')
  assert.equal(nextPerformanceStatus('closed'), null)
  assert.equal(
    planPerformancePeriodStatus({ status: 'planning' }, { status: 'active' }, { unscoredCount: 0 }),
    'active',
  )
  assert.throws(
    () =>
      planPerformancePeriodStatus(
        { status: 'planning' },
        { status: 'evaluation' },
        { unscoredCount: 0 },
      ),
    isDomainError('performance_status_invalid', 'conflict'),
  )
  assert.throws(
    () =>
      planPerformancePeriodStatus(
        { status: 'interim' },
        { status: 'active' },
        { unscoredCount: 0 },
      ),
    isDomainError('performance_status_invalid', 'conflict'),
  )
  assert.throws(
    () =>
      planPerformancePeriodStatus(
        { status: 'evaluation' },
        { status: 'closed' },
        { unscoredCount: 2 },
      ),
    isDomainError('performance_period_unscored'),
  )
  assert.equal(
    planPerformancePeriodStatus(
      { status: 'evaluation' },
      { status: 'closed' },
      { unscoredCount: 0 },
    ),
    'closed',
  )
  assert.throws(
    () =>
      planPerformancePeriodStatus({ status: 'closed' }, { status: 'closed' }, { unscoredCount: 0 }),
    isDomainError('performance_period_closed', 'conflict'),
  )
  assert.throws(() =>
    planPerformancePeriodStatus({ status: 'planning' }, { status: 'bitti' }, { unscoredCount: 0 }),
  )
})

test('DOM-FIN-124 K-428: personel kaydı etkin personele, planlama ya da yürürlükte açılır', () => {
  assert.deepEqual(planPerformanceReview(create(), checks()), STORED)
  assert.deepEqual(
    planPerformanceReview(create(), checks({ period: { status: 'active' } })),
    STORED,
  )
  const cases: [Partial<PerformanceReviewChecks>, string, string?][] = [
    [{ period: { status: 'interim' } }, 'performance_enroll_closed', 'conflict'],
    [{ period: { status: 'closed' } }, 'performance_period_closed', 'conflict'],
    [{ staff: null }, 'performance_staff_not_found'],
    [{ staff: { userId: 'u-x', role: 'ogrenci', active: true } }, 'performance_not_staff'],
    [{ staff: { userId: 'u-x', role: 'ogretmen', active: false } }, 'performance_staff_inactive'],
    [{ actorUserId: 'u-selin' }, 'performance_self_review'],
    [{ duplicate: true }, 'performance_review_exists', 'conflict'],
  ]
  for (const [patch, code, kind] of cases)
    assert.throws(() => planPerformanceReview(create(), checks(patch)), isDomainError(code, kind))
})

test('DOM-FIN-124 K-428: hedefler değerlendirmeden önce yazılır ve puanı sıfırlar', () => {
  const goals = [{ title: 'Tek hedef', criterion: 'Ölçüt', weight: 100 }]
  for (const status of ['planning', 'active', 'interim'] as const)
    assert.deepEqual(
      planPerformanceReviewUpdate({ goals: STORED }, at(status), update({ goals }), TODAY),
      { goals: [{ ...goals[0], score: null }] },
    )
  assert.throws(
    () =>
      planPerformanceReviewUpdate({ goals: STORED }, at('evaluation'), update({ goals }), TODAY),
    isDomainError('performance_goals_locked'),
  )
})

test('DOM-FIN-124 K-428: ara görüşme notu ve günü dönem içinde, bugünden sonra değil', () => {
  assert.deepEqual(
    planPerformanceReviewUpdate(
      { goals: STORED },
      at('interim'),
      update({ interimNote: '  İyi gidiyor  ', interimDate: '2026-11-10' }),
      TODAY,
    ),
    { interimNote: 'İyi gidiyor', interimDate: '2026-11-10' },
  )
  assert.deepEqual(
    planPerformanceReviewUpdate(
      { goals: STORED },
      at('evaluation'),
      update({ interimNote: '', interimDate: null }),
      TODAY,
    ),
    { interimNote: null, interimDate: null },
  )
  assert.throws(
    () =>
      planPerformanceReviewUpdate(
        { goals: STORED },
        at('active'),
        update({ interimNote: 'x' }),
        TODAY,
      ),
    isDomainError('performance_interim_not_open'),
  )
  assert.throws(
    () =>
      planPerformanceReviewUpdate(
        { goals: STORED },
        at('interim'),
        update({ interimDate: '2026-08-01' }),
        TODAY,
      ),
    isDomainError('performance_interim_date_outside'),
  )
  assert.throws(
    () =>
      planPerformanceReviewUpdate(
        { goals: STORED },
        at('interim'),
        update({ interimDate: '2026-12-01' }),
        TODAY,
      ),
    isDomainError('performance_interim_date_future'),
  )
})

test('DOM-FIN-124 K-428: puan ve personel görüşü yalnız değerlendirmede', () => {
  assert.deepEqual(
    planPerformanceReviewUpdate(
      { goals: STORED },
      at('evaluation'),
      update({ scores: [4, null], staffComment: 'Katılıyorum' }),
      TODAY,
    ),
    {
      goals: [
        { ...STORED[0], score: 4 },
        { ...STORED[1], score: null },
      ],
      evaluated: true,
      staffComment: 'Katılıyorum',
    },
  )
  assert.throws(
    () =>
      planPerformanceReviewUpdate(
        { goals: STORED },
        at('evaluation'),
        update({ scores: [4] }),
        TODAY,
      ),
    isDomainError('performance_scores_mismatch'),
  )
  assert.throws(
    () =>
      planPerformanceReviewUpdate(
        { goals: STORED },
        at('interim'),
        update({ scores: [4, 3] }),
        TODAY,
      ),
    isDomainError('performance_evaluation_not_open'),
  )
  assert.throws(
    () =>
      planPerformanceReviewUpdate(
        { goals: STORED },
        at('interim'),
        update({ staffComment: 'Görüş' }),
        TODAY,
      ),
    isDomainError('performance_evaluation_not_open'),
  )
  assert.equal(performanceReviewUpdateSchema.safeParse({ scores: [6, 1] }).success, false)
  assert.equal(performanceReviewUpdateSchema.safeParse({ scores: [0, 1] }).success, false)
})

test('DOM-FIN-124 K-428: kapanmış dönem kilitlidir, boş düzeltme reddedilir', () => {
  assert.throws(
    () =>
      planPerformanceReviewUpdate(
        { goals: STORED },
        at('closed'),
        update({ staffComment: 'Geç görüş' }),
        TODAY,
      ),
    isDomainError('performance_period_closed', 'conflict'),
  )
  assert.equal(performanceReviewUpdateSchema.safeParse({}).success, false)
  assert.equal(performanceReviewUpdateSchema.safeParse({ extra: 1 }).success, false)
})
