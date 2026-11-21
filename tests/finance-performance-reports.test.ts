import assert from 'node:assert/strict'
import test from 'node:test'

import {
  averageOf,
  canViewPerformanceReport,
  developmentGoalStatusAt,
  isGoalInPerformanceReport,
  isObservationInPeriodReport,
  observationAverage,
  PERFORMANCE_REPORT_MANAGE_ROLES,
  PERFORMANCE_REPORT_READ_ROLES,
  PERFORMANCE_REPORT_FEEDBACK_STATE_LABELS,
  PERFORMANCE_REPORT_FEEDBACK_STATES,
  PERFORMANCE_REPORT_SECTION_LABELS,
  PERFORMANCE_REPORT_SECTIONS,
  performanceReportAcknowledgeSchema,
  performanceReportFeedbackSection,
  performanceReportFinalizeSchema,
  performanceReportGoalSection,
  performanceReportGoalSnapshotSchema,
  performanceReportStatus,
  performanceReportSummary,
  performanceScoreBand,
  planPerformanceReportAcknowledge,
  planPerformanceReportFinalize,
  selfEvaluationScaleAverage,
  type PerformanceReportFinalizeChecks,
} from '../packages/school-core/src/lib/finance-performance-reports.ts'
import {
  multiSourceFeedbackResult,
  type StaffFeedbackResultInput,
} from '../packages/school-core/src/lib/finance-staff-feedback.ts'

import { isDomainError } from './support/domain-error.ts'

// Personel performans raporu (DOM-FIN-137; ON-220). Kararlar K-466…K-468.

const OPINION = { managerOpinion: 'Dönem hedeflerine ulaştı, okuma becerisinde güçlü.' }
const finalizeChecks = (
  patch: Partial<PerformanceReportFinalizeChecks> = {},
): PerformanceReportFinalizeChecks => ({
  period: { status: 'closed' },
  finalized: false,
  staffUserId: 'u-selin',
  actorUserId: 'u-mudur',
  ...patch,
})
const PERIOD = { id: 'p1', startDate: '2026-09-01', endDate: '2027-01-31' }
const observation = (patch: Record<string, unknown> = {}) => ({
  status: 'completed',
  performancePeriodId: 'p1',
  observedDate: '2026-10-01',
  completedAt: '2026-10-02T09:00:00.000Z',
  ...patch,
})

test('DOM-FIN-137 K-468: yazma ve özet yalnız yönetici; okuma yönetici ve öğretmen', () => {
  assert.deepEqual([...PERFORMANCE_REPORT_MANAGE_ROLES], ['yonetici'])
  assert.deepEqual([...PERFORMANCE_REPORT_READ_ROLES], ['yonetici', 'ogretmen'])
})

test('DOM-FIN-137 K-466 K-468: rapor bölümlüdür; geri bildirim gözlemlerden sonra gelir', () => {
  assert.deepEqual(
    [...PERFORMANCE_REPORT_SECTIONS],
    [
      'evaluation',
      'selfEvaluation',
      'observations',
      'staffFeedback',
      'developmentGoals',
      'managerOpinion',
    ],
  )
  assert.equal(PERFORMANCE_REPORT_SECTION_LABELS.staffFeedback, 'Çok kaynaklı geri bildirim')
})

test('DOM-FIN-137 K-468: öğretmen yalnız kendi kesinleşmiş raporunu görür', () => {
  const own = { membershipId: 'm-selin', finalized: true }
  assert.equal(canViewPerformanceReport({ role: 'yonetici', membershipId: 'x' }, own), true)
  assert.equal(
    canViewPerformanceReport({ role: 'yonetici', membershipId: 'x' }, { ...own, finalized: false }),
    true,
  )
  assert.equal(canViewPerformanceReport({ role: 'ogretmen', membershipId: 'm-selin' }, own), true)
  assert.equal(
    canViewPerformanceReport(
      { role: 'ogretmen', membershipId: 'm-selin' },
      { ...own, finalized: false },
    ),
    false,
  )
  assert.equal(canViewPerformanceReport({ role: 'ogretmen', membershipId: 'm-baska' }, own), false)
  for (const role of ['on_buro', 'veli', 'ogrenci', 'muhasebe'])
    assert.equal(canViewPerformanceReport({ role, membershipId: 'm-selin' }, own), false)
})

test('DOM-FIN-137 K-467: rapor durumu kesinleştirme ve okuma kaydından türetilir', () => {
  assert.equal(performanceReportStatus(null), 'draft')
  assert.equal(performanceReportStatus({ finalizedAt: null, acknowledgedDate: null }), 'draft')
  assert.equal(
    performanceReportStatus({ finalizedAt: '2026-10-06T09:00:00Z', acknowledgedDate: null }),
    'finalized',
  )
  assert.equal(
    performanceReportStatus({
      finalizedAt: '2026-10-06T09:00:00Z',
      acknowledgedDate: '2026-10-07',
    }),
    'acknowledged',
  )
})

test('DOM-FIN-137 K-467: kesinleştirme görüşü 10–2000 karakter, fazla alan 400', () => {
  assert.equal(
    performanceReportFinalizeSchema.parse({ managerOpinion: `  ${OPINION.managerOpinion}  ` })
      .managerOpinion,
    OPINION.managerOpinion,
  )
  for (const bad of [
    {},
    { managerOpinion: 'Kısa' },
    { managerOpinion: 'x'.repeat(2001) },
    { ...OPINION, institutionId: 'b' },
  ])
    assert.equal(performanceReportFinalizeSchema.safeParse(bad).success, false)
})

test('DOM-FIN-137 K-467: rapor dönem kapanınca bir kez kesinleşir, kendi raporu kesinleşmez', () => {
  assert.deepEqual(planPerformanceReportFinalize(OPINION, finalizeChecks()), OPINION)
  for (const status of ['planning', 'active', 'interim', 'evaluation'] as const)
    assert.throws(
      () => planPerformanceReportFinalize(OPINION, finalizeChecks({ period: { status } })),
      isDomainError('performance_report_period_open'),
    )
  assert.throws(
    () => planPerformanceReportFinalize(OPINION, finalizeChecks({ finalized: true })),
    isDomainError('performance_report_finalized', 'conflict'),
  )
  assert.throws(
    () => planPerformanceReportFinalize(OPINION, finalizeChecks({ staffUserId: 'u-mudur' })),
    isDomainError('performance_report_self'),
  )
  assert.throws(() => planPerformanceReportFinalize({ managerOpinion: 'x' }, finalizeChecks()))
})

test('DOM-FIN-137 K-467: okudum kaydı kesinleşmiş rapora bir kez, gün aralığında', () => {
  const report = { finalizedDate: '2026-10-05', acknowledgedDate: null }
  const input = { channel: 'paper', acknowledgedDate: '2026-10-06' }
  assert.deepEqual(planPerformanceReportAcknowledge(report, input, '2026-10-06'), input)
  assert.equal(
    planPerformanceReportAcknowledge(
      report,
      { channel: 'in_person', acknowledgedDate: '2026-10-05' },
      '2026-10-06',
    ).channel,
    'in_person',
  )
  assert.throws(
    () => planPerformanceReportAcknowledge(null, input, '2026-10-06'),
    isDomainError('performance_report_not_finalized'),
  )
  assert.throws(
    () =>
      planPerformanceReportAcknowledge(
        { ...report, acknowledgedDate: '2026-10-06' },
        input,
        '2026-10-06',
      ),
    isDomainError('performance_report_acknowledged', 'conflict'),
  )
  assert.throws(
    () =>
      planPerformanceReportAcknowledge(
        report,
        { ...input, acknowledgedDate: '2026-10-07' },
        '2026-10-06',
      ),
    isDomainError('performance_report_ack_date_future'),
  )
  assert.throws(
    () =>
      planPerformanceReportAcknowledge(
        report,
        { ...input, acknowledgedDate: '2026-10-04' },
        '2026-10-06',
      ),
    isDomainError('performance_report_ack_before_final'),
  )
  for (const bad of [
    {},
    { channel: 'sms', acknowledgedDate: '2026-10-06' },
    { channel: 'paper', acknowledgedDate: '2026-13-01' },
    { ...input, note: 'x' },
  ])
    assert.equal(performanceReportAcknowledgeSchema.safeParse(bad).success, false)
})

test('DOM-FIN-137 K-466: dönemdeki tamamlanmış gözlemler rapora girer', () => {
  assert.equal(isObservationInPeriodReport(observation(), PERIOD, null), true)
  assert.equal(isObservationInPeriodReport(observation({ status: 'draft' }), PERIOD, null), false)
  assert.equal(isObservationInPeriodReport(observation({ completedAt: null }), PERIOD, null), false)
  assert.equal(
    isObservationInPeriodReport(observation({ performancePeriodId: 'p2' }), PERIOD, null),
    false,
  )
  // Döneme bağlanmamış gözlem günüyle karar verilir.
  assert.equal(
    isObservationInPeriodReport(observation({ performancePeriodId: null }), PERIOD, null),
    true,
  )
  assert.equal(
    isObservationInPeriodReport(
      observation({ performancePeriodId: null, observedDate: '2026-08-31' }),
      PERIOD,
      null,
    ),
    false,
  )
  assert.equal(
    isObservationInPeriodReport(
      observation({ performancePeriodId: null, observedDate: '2027-02-01' }),
      PERIOD,
      null,
    ),
    false,
  )
  // Kesinleşen rapora sonradan tamamlanan gözlem girmez.
  assert.equal(isObservationInPeriodReport(observation(), PERIOD, '2026-10-02T09:00:00.000Z'), true)
  assert.equal(
    isObservationInPeriodReport(observation(), PERIOD, '2026-10-01T09:00:00.000Z'),
    false,
  )
})

test('DOM-FIN-137 K-466: ortalamalar ve puan bantları', () => {
  assert.equal(averageOf([], 2), null)
  assert.equal(averageOf([1, 2], 2), 1.5)
  assert.equal(observationAverage([73, 80, 67]), 73.3)
  assert.equal(observationAverage([]), null)
  assert.equal(
    selfEvaluationScaleAverage(
      [
        { kind: 'scale', text: 'Soru bir', required: true },
        { kind: 'open', text: 'Soru iki', required: true },
        { kind: 'scale', text: 'Soru üç', required: false },
        { kind: 'scale', text: 'Soru dört', required: false },
      ],
      [
        { score: 4, text: null },
        { score: null, text: 'Metin' },
        { score: 5, text: null },
        { score: null, text: null },
      ],
    ),
    4.5,
  )
  assert.equal(
    selfEvaluationScaleAverage([{ kind: 'open', text: 'Soru', required: true }], []),
    null,
  )
  assert.equal(performanceScoreBand(null), null)
  assert.equal(performanceScoreBand(Number.NaN), null)
  assert.equal(performanceScoreBand(1), '1')
  assert.equal(performanceScoreBand(1.99), '1')
  assert.equal(performanceScoreBand(3.5), '3')
  assert.equal(performanceScoreBand(4.99), '4')
  assert.equal(performanceScoreBand(5), '5')
})

test('DOM-FIN-137 K-466: dönem özeti ortalama, dağılım ve rapor sayıları', () => {
  const summary = performanceReportSummary([
    {
      overallScore: 4.2,
      status: 'acknowledged',
      selfEvaluationStatus: 'submitted',
      observationPercents: [80, 70],
    },
    {
      overallScore: 3,
      status: 'finalized',
      selfEvaluationStatus: 'draft',
      observationPercents: [60],
    },
    {
      overallScore: 4.8,
      status: 'draft',
      selfEvaluationStatus: 'missing',
      observationPercents: [],
    },
    {
      overallScore: null,
      status: 'draft',
      selfEvaluationStatus: 'missing',
      observationPercents: [],
    },
  ])
  assert.equal(summary.staffCount, 4)
  assert.equal(summary.scoredCount, 3)
  assert.equal(summary.unscoredCount, 1)
  assert.equal(summary.averageScore, 4)
  assert.equal(summary.minScore, 3)
  assert.equal(summary.maxScore, 4.8)
  assert.deepEqual(summary.distribution, [
    { band: '1', count: 0 },
    { band: '2', count: 0 },
    { band: '3', count: 1 },
    { band: '4', count: 2 },
    { band: '5', count: 0 },
  ])
  assert.equal(summary.observationCount, 3)
  assert.equal(summary.observationAverage, 70)
  assert.equal(summary.selfEvaluationSubmitted, 1)
  assert.equal(summary.finalizedCount, 2)
  assert.equal(summary.acknowledgedCount, 1)

  const empty = performanceReportSummary([])
  assert.equal(empty.averageScore, null)
  assert.equal(empty.minScore, null)
  assert.equal(empty.maxScore, null)
  assert.equal(empty.observationAverage, null)
})

test('DOM-FIN-137 K-468: gelişim hedefi kesinleştirme anındaki durumuyla, bırakılan hariç', () => {
  const goal = { status: 'achieved' as const, createdAt: '2026-09-10T09:00:00.000Z' }
  const changes = [
    { statusTo: 'achieved' as const, createdAt: '2026-10-08T09:00:00.000Z' },
    { statusTo: null, createdAt: '2026-09-20T09:00:00.000Z' },
    { statusTo: 'in_progress' as const, createdAt: '2026-09-15T09:00:00.000Z' },
  ]
  // Kesinleşmemiş rapor bugünkü durumu gösterir.
  assert.equal(developmentGoalStatusAt(goal, changes, null), 'achieved')
  // Kesinleşmiş rapor o anki son durum değişikliğini esas alır.
  assert.equal(developmentGoalStatusAt(goal, changes, '2026-10-06T09:00:00.000Z'), 'in_progress')
  assert.equal(developmentGoalStatusAt(goal, changes, '2026-09-12T09:00:00.000Z'), 'open')
  assert.equal(developmentGoalStatusAt(goal, [], '2026-10-06T09:00:00.000Z'), 'open')
  // Kesinleştirmeden sonra açılan hedef rapora girmez.
  assert.equal(developmentGoalStatusAt(goal, changes, '2026-09-01T09:00:00.000Z'), null)
  for (const status of ['open', 'in_progress', 'achieved'] as const)
    assert.equal(isGoalInPerformanceReport(status), true)
  assert.equal(isGoalInPerformanceReport('dropped'), false)
  assert.equal(isGoalInPerformanceReport(null), false)
})

const goalItem = (patch: Record<string, unknown> = {}) => ({
  id: 'g1',
  title: 'Sınıf içi soru tekniği',
  successCriterion: 'Her derste üç açık uçlu soru',
  source: 'direct',
  observedDate: null,
  followUpDate: '2026-10-20',
  status: 'open',
  ...patch,
})

test('DOM-FIN-137 K-468: hedef anlık görüntüsü şemayla doğrulanır, bölüm sıralı sayılır', () => {
  const items = performanceReportGoalSnapshotSchema.parse([
    goalItem({ id: 'g2', title: 'Ölçme araçları', status: 'achieved' }),
    goalItem({ id: 'g3', title: 'Proje tabanlı ders', followUpDate: '2026-10-10' }),
    goalItem(),
  ])
  const section = performanceReportGoalSection(items)
  assert.equal(section.count, 3)
  assert.equal(section.achievedCount, 1)
  assert.deepEqual(
    section.items.map((item) => item.id),
    ['g3', 'g2', 'g1'],
  )
  // Bırakılan hedef, bilinmeyen alan ve geçersiz gün görüntüye yazılmaz.
  for (const bad of [
    goalItem({ status: 'dropped' }),
    { ...goalItem(), teacherMembershipId: 'm-selin' },
    goalItem({ followUpDate: '20-10-2026' }),
    goalItem({ title: '' }),
  ])
    assert.equal(performanceReportGoalSnapshotSchema.safeParse([bad]).success, false)
  assert.deepEqual(performanceReportGoalSection([]), { count: 0, achievedCount: 0, items: [] })
})

const FEEDBACK_QUESTIONS = [
  { kind: 'scale' as const, text: 'Ekip çalışmasına katkısı', required: true },
  { kind: 'open' as const, text: 'Güçlü yanları', required: false },
]
const peerRow = (score: number, text: string | null): StaffFeedbackResultInput => ({
  relation: 'peer',
  status: 'submitted',
  reviewerName: `Meslektaş ${text ?? String(score)}`,
  submittedAt: '2026-09-20T09:00:00.000Z',
  answers: [
    { score, text: null },
    { score: null, text },
  ],
})
const managerRow: StaffFeedbackResultInput = {
  relation: 'manager',
  status: 'submitted',
  reviewerName: 'Murat Yılmaz',
  submittedAt: '2026-09-18T09:00:00.000Z',
  answers: [
    { score: 5, text: null },
    { score: null, text: 'Planlı ve özenli' },
  ],
}
const feedback = (
  assignments: StaffFeedbackResultInput[],
  patch: { periodStatus?: 'active' | 'closed'; threshold?: number; questions?: null } = {},
) =>
  performanceReportFeedbackSection(
    multiSourceFeedbackResult({
      periodStatus: patch.periodStatus ?? 'closed',
      questions: patch.questions === null ? null : FEEDBACK_QUESTIONS,
      threshold: patch.threshold ?? 3,
      assignments,
    }),
  )

test('DOM-FIN-137 K-468 K-459: geri bildirim bölümü eşik altında "yeterli yanıt yok"; tek meslektaş yanıtı dönmez', () => {
  const pending: StaffFeedbackResultInput = {
    ...peerRow(1, null),
    status: 'pending',
    answers: null,
  }
  const below = feedback([
    managerRow,
    peerRow(2, 'Tek-meslektas-cevabi'),
    peerRow(4, null),
    pending,
  ])
  assert.equal(below.state, 'below_threshold')
  assert.equal(below.peer.assigned, 3)
  assert.equal(below.peer.responded, 2)
  assert.deepEqual(below.peer.questions, [])
  const text = JSON.stringify(below)
  assert.equal(text.includes('Tek-meslektas-cevabi'), false)
  assert.equal(text.includes('Meslektaş'), false)
  // Yönetici yanıtı anonim değildir: adıyla ve soru metniyle döner.
  assert.deepEqual(below.manager.responses, [
    {
      reviewerName: 'Murat Yılmaz',
      submittedAt: '2026-09-18T09:00:00.000Z',
      items: [
        { question: 'Ekip çalışmasına katkısı', kind: 'scale', score: 5, text: null },
        { question: 'Güçlü yanları', kind: 'open', score: null, text: 'Planlı ve özenli' },
      ],
    },
  ])
  assert.equal(
    PERFORMANCE_REPORT_FEEDBACK_STATE_LABELS[below.state],
    'Yeterli meslektaş yanıtı yok; anonimlik için toplu sonuç gösterilmez.',
  )
})

test('DOM-FIN-137 K-468 K-459: eşik geçilince yalnız toplu sonuç; eşik altı soru gizli', () => {
  const visible = feedback([peerRow(4, 'Yardımsever'), peerRow(5, null), peerRow(3, 'Düzenli')])
  assert.equal(visible.state, 'visible')
  assert.deepEqual(visible.peer.questions, [
    {
      question: 'Ekip çalışmasına katkısı',
      kind: 'scale',
      answered: 3,
      hidden: false,
      average: 4,
      texts: [],
    },
    // Açık uçlu soruyu yalnız iki meslektaş cevapladı: soru gizli, metin dönmez.
    {
      question: 'Güçlü yanları',
      kind: 'open',
      answered: 2,
      hidden: true,
      average: null,
      texts: [],
    },
  ])
  assert.equal(JSON.stringify(visible).includes('Yardımsever'), false)
  // Eşik kurum ayarıdır: dört gerekiyorsa aynı üç yanıt gizli kalır.
  assert.equal(
    feedback([peerRow(4, 'a'), peerRow(5, 'b'), peerRow(3, 'c')], { threshold: 4 }).state,
    'below_threshold',
  )
})

test('DOM-FIN-137 K-468: geri bildirim toplanmadıysa ya da dönem açıksa içerik yok', () => {
  const none = feedback([])
  assert.equal(none.state, 'not_collected')
  assert.equal(none.questionCount, 2)
  assert.equal(feedback([managerRow], { questions: null }).state, 'not_collected')
  assert.deepEqual(feedback([managerRow], { questions: null }).manager.responses, [])
  const open = feedback([peerRow(4, 'a'), peerRow(5, 'b'), peerRow(3, 'c')], {
    periodStatus: 'active',
  })
  assert.equal(open.state, 'period_open')
  assert.deepEqual(open.peer.questions, [])
  assert.deepEqual(Object.keys(PERFORMANCE_REPORT_FEEDBACK_STATE_LABELS), [
    ...PERFORMANCE_REPORT_FEEDBACK_STATES,
  ])
})
