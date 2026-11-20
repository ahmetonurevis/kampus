import assert from 'node:assert/strict'
import test from 'node:test'

import {
  performanceDevelopmentGoalRows,
  performanceGoalRows,
  performanceObservationRows,
  performanceReportDocument,
  performanceReportFilename,
} from '../src/lib/pdf/templates/finance-performance-report.ts'
import {
  distributionRows,
  performanceReportAcknowledgeDefaults,
  performanceReportAcknowledgeFormSchema,
  performanceReportFinalizeFormSchema,
  reportActions,
  reportPercentText,
  reportScoreText,
  reportSummaryText,
} from '../src/pages/finance/finance-performance-report-forms.ts'
import { reportFixture, summaryFixture } from './finance-performance-report-fixture.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Performans raporu bölümü ve PDF'i (DOM-FIN-137; ON-220; K-466…K-468).

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T09:00:00.000Z'),
}

test('DOM-FIN-137 K-466: puan, yüzde ve dönem özeti metinleri', () => {
  assert.equal(reportScoreText(4.6), '4,60 / 5')
  assert.equal(reportScoreText(null), '—')
  assert.equal(reportPercentText(86.5), '%86,5')
  assert.equal(reportPercentText(null), '—')
  assert.equal(
    reportSummaryText(summaryFixture()),
    '2 personel · ortalama 3,80 / 5 · en düşük 3,00, en yüksek 4,60 · 2 gözlem, ortalama %86,5 · 1 öz değerlendirme gönderildi · 1 rapor kesinleşti, 1 okundu.',
  )
  assert.ok(reportSummaryText(summaryFixture({ unscoredCount: 1 })).includes('1 kayıt puansız'))
  assert.equal(
    reportSummaryText(summaryFixture({ staffCount: 0 })),
    'Bu dönemde personel kaydı yok.',
  )
  assert.ok(
    reportSummaryText(
      summaryFixture({ averageScore: null, minScore: null, maxScore: null }),
    ).includes('ortalama —'),
  )
})

test('DOM-FIN-137 K-466: dağılım çubukları en büyük banda göre oranlanır', () => {
  assert.deepEqual(
    distributionRows(summaryFixture()).map((row) => [row.label, row.count, row.ratio]),
    [
      ['1,00–1,99', 0, 0],
      ['2,00–2,99', 0, 0],
      ['3,00–3,99', 1, 50],
      ['4,00–4,99', 2, 100],
      ['5,00', 0, 0],
    ],
  )
})

test('DOM-FIN-137 K-467: kesinleştirme kapanan dönemde, okudum kaydı kesinleşmiş raporda', () => {
  assert.deepEqual(reportActions('closed', 'draft'), { finalize: true, acknowledge: false })
  assert.deepEqual(reportActions('evaluation', 'draft'), { finalize: false, acknowledge: false })
  assert.deepEqual(reportActions('closed', 'finalized'), { finalize: false, acknowledge: true })
  assert.deepEqual(reportActions('closed', 'acknowledged'), {
    finalize: false,
    acknowledge: false,
  })
})

test('DOM-FIN-137 K-467: form şemaları görüş uzunluğunu ve okuma gününü denetler', () => {
  assert.equal(
    performanceReportFinalizeFormSchema.safeParse({ managerOpinion: 'Kısa' }).success,
    false,
  )
  assert.equal(
    performanceReportFinalizeFormSchema.safeParse({ managerOpinion: 'Dönem hedeflerine ulaştı.' })
      .success,
    true,
  )
  const defaults = performanceReportAcknowledgeDefaults('2026-10-06')
  assert.deepEqual(defaults, {
    channel: 'paper',
    acknowledgedDate: '2026-10-06',
    today: '2026-10-06',
  })
  assert.equal(performanceReportAcknowledgeFormSchema.safeParse(defaults).success, true)
  const future = performanceReportAcknowledgeFormSchema.safeParse({
    ...defaults,
    acknowledgedDate: '2026-10-07',
  })
  assert.equal(future.success, false)
  assert.equal(future.error?.issues[0]?.message, 'Okuma günü bugünden sonra olamaz.')
  assert.equal(
    performanceReportAcknowledgeFormSchema.safeParse({ ...defaults, channel: 'sms' }).success,
    false,
  )
})

test('DOM-FIN-137 K-466: rapor PDF bölümleri, gözlemleri, görüşü ve okuma kaydını yazar', () => {
  const all = allTexts(performanceReportDocument(measurer, reportFixture(), OPTIONS))
  for (const text of [
    'PERFORMANS RAPORU',
    'KESİNLEŞTİ',
    'Selin Kaya performans raporu',
    'Dönem sonu değerlendirmesi',
    '4,60 / 5',
    'Öz değerlendirme',
    'Veli iletişimi güçlü',
    'Ders gözlemleri',
    '%86,5',
    'Gelişim hedefleri',
    'Ölçme araçlarını çeşitlendir',
    '2 hedef · 1 ulaşıldı',
    'Yönetici görüşü',
    'Dönem hedeflerine ulaştı.',
    'Yüz yüze görüşme',
    'Selin Kaya — Okudum',
    'Test Yönetici — Değerlendiren',
  ])
    assert.ok(
      all.some((item) => item.includes(text)),
      text,
    )
  assert.deepEqual(performanceGoalRows(reportFixture())[0], [
    '1. Okuma becerisi',
    'Sınıf ortalaması B1',
    '%60',
    '5 / 5',
  ])
  assert.equal(performanceObservationRows(reportFixture())[1]?.[3], '11 / 15 · %73')
  assert.deepEqual(performanceDevelopmentGoalRows(reportFixture())[1], [
    '2. Sınıf içi soru tekniği',
    'Derste en az beş açık uçlu soru',
    '15 Kas 2026',
    'Açık',
  ])
  assert.equal(
    performanceReportFilename(reportFixture()),
    'performans-raporu-2026-guz-donemi-selin-kaya.pdf',
  )
})

test('DOM-FIN-137 K-467: taslak rapor "TASLAK", gönderilmemiş öz değerlendirme ve gözlemsiz dönem', () => {
  const draft = reportFixture({
    status: 'draft',
    reportId: null,
    finalizedAt: null,
    finalizedByName: null,
    acknowledgedDate: null,
    acknowledgementChannel: null,
    acknowledgementRecordedAt: null,
    acknowledgementRecordedByName: null,
    managerOpinion: null,
    selfEvaluation: {
      ...reportFixture().selfEvaluation,
      status: 'draft',
      items: [],
      submittedAt: null,
      channel: null,
      scaleAverage: null,
    },
    observations: { count: 0, averagePercent: null, items: [] },
    developmentGoals: { count: 0, achievedCount: 0, items: [] },
  })
  const all = allTexts(performanceReportDocument(measurer, draft, OPTIONS))
  for (const text of [
    'TASLAK',
    'Kesinleşmedi',
    'Rapora yalnız gönderilmiş öz değerlendirme girer.',
    'Bu dönemde tamamlanmış ders gözlemi yok.',
    'Bu döneme bağlı açık ya da ulaşılan gelişim hedefi yok.',
    'Rapor kesinleşince yönetici görüşü yazılır.',
    'henüz girilmedi',
  ])
    assert.ok(
      all.some((item) => item.includes(text)),
      text,
    )
  assert.ok(!all.some((item) => item.includes('Veli iletişimi güçlü')))
})
