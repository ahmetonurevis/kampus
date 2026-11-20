import type {
  PerformanceReport,
  PerformanceReportSummary,
} from '@kampus/react-shared/use-finance-performance-reports.ts'

// Performans raporu örnek verisi (DOM-FIN-137; ON-220): biçim ve PDF testleri için.

export function reportFixture(patch: Partial<PerformanceReport> = {}): PerformanceReport {
  return {
    reviewId: '6f1c2d3e-0000-4000-8000-000000000001',
    periodId: 'p-1',
    periodName: '2026 Güz Dönemi',
    periodStartDate: '2026-09-01',
    periodEndDate: '2026-10-05',
    periodStatus: 'closed',
    membershipId: 'm-selin',
    staffName: 'Selin Kaya',
    staffRole: 'ogretmen',
    sections: [
      'evaluation',
      'selfEvaluation',
      'observations',
      'developmentGoals',
      'managerOpinion',
    ],
    evaluation: {
      goals: [
        { title: 'Okuma becerisi', criterion: 'Sınıf ortalaması B1', weight: 60, score: 5 },
        { title: 'Veli iletişimi', criterion: 'Her ay görüşme', weight: 40, score: 4 },
      ],
      overallScore: 4.6,
      scored: true,
      interimDate: '2026-09-20',
      interimNote: 'Hedefler yolunda.',
      evaluatorName: 'Test Yönetici',
      evaluatedAt: '2026-10-05T09:00:00.000Z',
      staffComment: 'Değerlendirmeye katılıyorum.',
    },
    selfEvaluation: {
      status: 'submitted',
      submittedAt: '2026-09-30T09:00:00.000Z',
      channel: 'paper',
      scaleAverage: 4,
      answeredCount: 2,
      questionCount: 2,
      items: [
        { question: 'Ders planlarımı zamanında hazırladım', kind: 'scale', score: 4, text: null },
        {
          question: 'Bu dönemin en güçlü yanınız neydi?',
          kind: 'open',
          score: null,
          text: 'Veli iletişimi güçlü',
        },
      ],
      managerComment: null,
    },
    observations: {
      count: 2,
      averagePercent: 86.5,
      items: [
        {
          id: 'o-1',
          observedDate: '2026-09-15',
          templateName: 'Ders gözlem formu',
          observerName: 'Mert Aydın',
          total: 15,
          max: 15,
          percent: 100,
        },
        {
          id: 'o-2',
          observedDate: '2026-10-01',
          templateName: 'Ders gözlem formu',
          observerName: 'Mert Aydın',
          total: 11,
          max: 15,
          percent: 73,
        },
      ],
    },
    developmentGoals: {
      count: 2,
      achievedCount: 1,
      items: [
        {
          id: 'g-1',
          title: 'Ölçme araçlarını çeşitlendir',
          successCriterion: 'Her ünitede iki farklı ölçme aracı',
          source: 'observation_debrief',
          observedDate: '2026-09-15',
          followUpDate: '2026-10-20',
          status: 'achieved',
        },
        {
          id: 'g-2',
          title: 'Sınıf içi soru tekniği',
          successCriterion: 'Derste en az beş açık uçlu soru',
          source: 'direct',
          observedDate: null,
          followUpDate: '2026-11-15',
          status: 'open',
        },
      ],
    },
    managerOpinion: 'Dönem hedeflerine ulaştı.',
    reportId: 'r-1',
    status: 'acknowledged',
    finalizedAt: '2026-10-06T09:00:00.000Z',
    finalizedByName: 'Test Yönetici',
    acknowledgedDate: '2026-10-06',
    acknowledgementChannel: 'in_person',
    acknowledgementRecordedAt: '2026-10-06T10:00:00.000Z',
    acknowledgementRecordedByName: 'Test Yönetici',
    ...patch,
  }
}

export function summaryFixture(
  patch: Partial<PerformanceReportSummary> = {},
): PerformanceReportSummary {
  return {
    periodId: 'p-1',
    periodName: '2026 Güz Dönemi',
    periodStatus: 'closed',
    periodStartDate: '2026-09-01',
    periodEndDate: '2026-10-05',
    staffCount: 2,
    scoredCount: 2,
    unscoredCount: 0,
    averageScore: 3.8,
    minScore: 3,
    maxScore: 4.6,
    distribution: [
      { band: '1', count: 0 },
      { band: '2', count: 0 },
      { band: '3', count: 1 },
      { band: '4', count: 2 },
      { band: '5', count: 0 },
    ],
    observationCount: 2,
    observationAverage: 86.5,
    selfEvaluationSubmitted: 1,
    finalizedCount: 1,
    acknowledgedCount: 1,
    ...patch,
  }
}
