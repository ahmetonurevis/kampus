// Personel performans raporu (DOM-FIN-137; ON-220, K-466…K-468): personel ve dönem; bölümler
// sunucunun bildirdiği sırayla — dönem sonu değerlendirmesi (hedef, ağırlık, puan, genel puan, ara
// görüşme, personel görüşü), öz değerlendirme (gönderildiyse soru ve cevaplar), ders gözlemleri
// (gün, form, gözlemci, puan, ortalama), çok kaynaklı geri bildirim (yönetici yanıtları adıyla,
// meslektaş sonucu yalnız eşik üstünde toplu; ON-350), döneme bağlı gelişim hedefleri (hedef, ölçüt,
// takip tarihi, durum; kesinleşmiş raporda anlık görüntü) ve yönetici görüşü; kesinleştirme,
// "okudum" kaydı ve imza
// alanları. Veri rapor ucundan gelir (okuması denetime düşer); belge web'de üretilir, sunucuda
// saklanmaz. Kesinleşmemiş rapor "TASLAK" ibaresiyle basılır.
import type { PerformanceReport } from '@kampus/react-shared/use-finance-performance-reports.ts'
import {
  PERFORMANCE_REPORT_ACK_CHANNEL_LABELS,
  PERFORMANCE_REPORT_FEEDBACK_STATE_LABELS,
  PERFORMANCE_REPORT_SECTION_LABELS,
  PERFORMANCE_REPORT_SELF_STATUS_LABELS,
  PERFORMANCE_REPORT_STATUS_LABELS,
  type PerformanceReportSection,
} from '@kampus/school-core/lib/finance-performance-reports.ts'
import { PERFORMANCE_PERIOD_STATUS_LABELS } from '@kampus/school-core/lib/finance-performance.ts'
import { DEVELOPMENT_GOAL_STATUS_LABELS } from '@kampus/school-core/lib/finance-observation-debriefs.ts'
import { SELF_EVALUATION_CHANNEL_LABELS } from '@kampus/school-core/lib/finance-self-evaluations.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { STAFF_ROLE_LABELS, isStaffRole } from '@kampus/school-core/lib/staff-accounts.ts'
import { DocumentLayout, type PdfDocument, type TextMeasurer } from '../layout.ts'
import type { TemplateOptions } from './shared.ts'

export const PERFORMANCE_REPORT_TITLE = 'Performans raporu'

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const momentText = (value: string | null) =>
  value === null ? '—' : dateLabel(value, { year: 'numeric' })
const decimal = (value: number, digits: number) =>
  value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const scoreText = (value: number | null) => (value === null ? '—' : `${decimal(value, 2)} / 5`)
const percentText = (value: number | null) => (value === null ? '—' : `%${decimal(value, 1)}`)
const roleText = (role: string) => (isStaffRole(role) ? STAFF_ROLE_LABELS[role] : role)

/** ASCII dosya adı: `performans-raporu-2026-guz-donemi-selin-kaya.pdf`. */
export function performanceReportFilename(
  report: Pick<PerformanceReport, 'periodName' | 'staffName'>,
) {
  const slug = (value: string) =>
    value
      .toLocaleLowerCase('tr-TR')
      .replaceAll('ı', 'i')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
  const parts = [slug(report.periodName), slug(report.staffName)].filter((part) => part !== '')
  return `performans-raporu${parts.map((part) => `-${part}`).join('')}.pdf`
}

/** Hedef tablosu satırları: başlık, ölçüt, ağırlık, puan. */
export function performanceGoalRows(report: PerformanceReport): string[][] {
  return report.evaluation.goals.map((goal, index) => [
    `${String(index + 1)}. ${goal.title}`,
    goal.criterion,
    `%${String(goal.weight)}`,
    goal.score === null ? '—' : `${String(goal.score)} / 5`,
  ])
}

/** Gözlem tablosu satırları: gün, form, gözlemci, puan. */
export function performanceObservationRows(report: PerformanceReport): string[][] {
  return report.observations.items.map((item) => [
    dayText(item.observedDate),
    item.templateName,
    item.observerName,
    `${String(item.total)} / ${String(item.max)} · %${String(item.percent)}`,
  ])
}

/** Gelişim hedefi tablosu satırları: hedef, ölçüt, takip tarihi, durum. */
export function performanceDevelopmentGoalRows(report: PerformanceReport): string[][] {
  return report.developmentGoals.items.map((goal, index) => [
    `${String(index + 1)}. ${goal.title}`,
    goal.successCriterion,
    dayText(goal.followUpDate),
    DEVELOPMENT_GOAL_STATUS_LABELS[goal.status],
  ])
}

type FeedbackSection = PerformanceReport['staffFeedback']
type FeedbackAnswer = FeedbackSection['manager']['responses'][number]['items'][number]

/** Geri bildirim yanıt durumu: "Yönetici 1/1 · meslektaş 2/3 yanıt · anonimlik eşiği 3". */
export function performanceFeedbackProgressText(section: FeedbackSection): string {
  const { manager, peer } = section
  return `Yönetici ${String(manager.responded)}/${String(manager.assigned)} · meslektaş ${String(peer.responded)}/${String(peer.assigned)} yanıt · anonimlik eşiği ${String(section.threshold)}`
}

/** Yönetici cevabı: puanlıda "4 / 5", açık uçluda metin; boşsa "—". */
export const performanceFeedbackAnswerText = (item: FeedbackAnswer) =>
  item.kind === 'scale'
    ? item.score === null
      ? '—'
      : `${String(item.score)} / 5`
    : (item.text ?? '—')

/**
 * Meslektaş toplu sonucu satırları: soru, cevaplayan sayısı, sonuç (puanlıda ortalama, açık uçluda
 * alfabetik metinler). Eşik altında cevaplanan soruda sonuç yerine "Yeterli yanıt yok" yazılır.
 */
export function performanceFeedbackPeerRows(section: FeedbackSection): string[][] {
  return section.peer.questions.map((question) => [
    question.question,
    String(question.answered),
    question.hidden
      ? 'Yeterli yanıt yok'
      : question.kind === 'scale'
        ? scoreText(question.average)
        : question.texts.length === 0
          ? '—'
          : question.texts.join(' · '),
  ])
}

function evaluationSection(doc: DocumentLayout, report: PerformanceReport) {
  const { evaluation } = report
  doc.metrics([
    ['Genel puan', scoreText(evaluation.overallScore)],
    ['Gözlem ortalaması', percentText(report.observations.averagePercent)],
    ['Öz değerlendirme', PERFORMANCE_REPORT_SELF_STATUS_LABELS[report.selfEvaluation.status]],
  ])
  doc.table(
    [
      { header: 'Hedef', width: 58 },
      { header: 'Ölçüt', width: 76 },
      { header: 'Ağırlık', width: 20 },
      { header: 'Puan', width: 20 },
    ],
    performanceGoalRows(report),
  )
  doc.fields([
    ['Ara görüşme günü', evaluation.interimDate === null ? '—' : dayText(evaluation.interimDate)],
    ['Değerlendiren', evaluation.evaluatorName ?? '—'],
  ])
  if (evaluation.interimNote !== null) doc.paragraph(`Ara görüşme notu: ${evaluation.interimNote}`)
  doc.paragraph(`Personelin görüşü: ${evaluation.staffComment ?? '—'}`)
}

function selfEvaluationSection(doc: DocumentLayout, report: PerformanceReport) {
  const self = report.selfEvaluation
  if (self.status !== 'submitted') {
    doc.paragraph(
      `${PERFORMANCE_REPORT_SELF_STATUS_LABELS[self.status]}. Rapora yalnız gönderilmiş öz değerlendirme girer.`,
    )
    return
  }
  doc.fields([
    ['Gönderim', momentText(self.submittedAt)],
    ['Kanal', self.channel === null ? '—' : SELF_EVALUATION_CHANNEL_LABELS[self.channel]],
    ['Puanlı soru ortalaması', scoreText(self.scaleAverage)],
    ['Cevaplanan', `${String(self.answeredCount)} / ${String(self.questionCount)}`],
  ])
  self.items.forEach((item, index) => {
    doc.paragraph(`${String(index + 1)}. ${item.question}`)
    doc.paragraph(
      item.kind === 'scale'
        ? item.score === null
          ? '—'
          : `${String(item.score)} / 5`
        : (item.text ?? '—'),
      9,
    )
  })
  if (self.managerComment !== null)
    doc.paragraph(`Yöneticinin öz değerlendirmeye görüşü: ${self.managerComment}`)
}

function observationsSection(doc: DocumentLayout, report: PerformanceReport) {
  if (report.observations.count === 0) {
    doc.paragraph('Bu dönemde tamamlanmış ders gözlemi yok.')
    return
  }
  doc.table(
    [
      { header: 'Gün', width: 30 },
      { header: 'Gözlem formu', width: 58 },
      { header: 'Gözlemci', width: 46 },
      { header: 'Puan', width: 40 },
    ],
    performanceObservationRows(report),
    true,
  )
  doc.paragraph(
    `${String(report.observations.count)} gözlem · ortalama ${percentText(report.observations.averagePercent)}`,
  )
}

function staffFeedbackSection(doc: DocumentLayout, report: PerformanceReport) {
  const feedback = report.staffFeedback
  if (feedback.state === 'not_collected') {
    doc.paragraph(PERFORMANCE_REPORT_FEEDBACK_STATE_LABELS.not_collected)
    return
  }
  doc.paragraph(performanceFeedbackProgressText(feedback))
  for (const response of feedback.manager.responses) {
    doc.paragraph(`Yönetici değerlendirmesi: ${response.reviewerName}`)
    response.items.forEach((item, index) => {
      doc.paragraph(`${String(index + 1)}. ${item.question}`)
      doc.paragraph(performanceFeedbackAnswerText(item), 9)
    })
  }
  doc.paragraph(PERFORMANCE_REPORT_FEEDBACK_STATE_LABELS[feedback.state])
  if (feedback.state !== 'visible') return
  doc.table(
    [
      { header: 'Soru', width: 70 },
      { header: 'Yanıt', width: 18 },
      { header: 'Toplu sonuç', width: 86 },
    ],
    performanceFeedbackPeerRows(feedback),
    true,
  )
}

function developmentGoalsSection(doc: DocumentLayout, report: PerformanceReport) {
  const goals = report.developmentGoals
  if (goals.count === 0) {
    doc.paragraph('Bu döneme bağlı açık ya da ulaşılan gelişim hedefi yok.')
    return
  }
  doc.table(
    [
      { header: 'Hedef', width: 58 },
      { header: 'Başarı ölçütü', width: 66 },
      { header: 'Takip', width: 26 },
      { header: 'Durum', width: 24 },
    ],
    performanceDevelopmentGoalRows(report),
    true,
  )
  doc.paragraph(`${String(goals.count)} hedef · ${String(goals.achievedCount)} ulaşıldı`)
}

function managerOpinionSection(doc: DocumentLayout, report: PerformanceReport) {
  doc.paragraph(report.managerOpinion ?? 'Rapor kesinleşince yönetici görüşü yazılır.')
}

const SECTION_WRITERS = {
  evaluation: evaluationSection,
  selfEvaluation: selfEvaluationSection,
  observations: observationsSection,
  staffFeedback: staffFeedbackSection,
  developmentGoals: developmentGoalsSection,
  managerOpinion: managerOpinionSection,
} satisfies Record<
  PerformanceReportSection,
  (doc: DocumentLayout, report: PerformanceReport) => void
>

export function performanceReportDocument(
  measurer: TextMeasurer,
  report: PerformanceReport,
  options: TemplateOptions,
): PdfDocument {
  const draft = report.status === 'draft'
  const doc = new DocumentLayout(measurer, {
    label: 'PERFORMANS RAPORU',
    badge: draft ? 'TASLAK' : 'KESİNLEŞTİ',
    institution: options.institution,
    generatedAt: options.generatedAt ?? new Date(),
    reference: `perf-${report.periodStartDate}-${report.reviewId.slice(0, 8)}`,
    footerNote: draft
      ? 'Taslaktır; kesinleşmemiştir. Kişisel veridir, yalnız ilgilisiyle paylaşılır.'
      : 'Kişisel veridir; yalnız yönetici ve personelin kendisiyle paylaşılır.',
  })
  doc.heading(
    `${report.staffName} ${PERFORMANCE_REPORT_TITLE.toLocaleLowerCase('tr-TR')}`,
    `${report.periodName} · ${dayText(report.periodStartDate)} – ${dayText(report.periodEndDate)}`,
  )
  doc.fields([
    ['Personel', report.staffName],
    ['Görev', roleText(report.staffRole)],
    ['Dönem', report.periodName],
    ['Dönem aşaması', PERFORMANCE_PERIOD_STATUS_LABELS[report.periodStatus]],
    ['Rapor durumu', PERFORMANCE_REPORT_STATUS_LABELS[report.status]],
    [
      'Kesinleştirme',
      report.finalizedAt === null
        ? 'Kesinleşmedi'
        : `${momentText(report.finalizedAt)} · ${report.finalizedByName ?? '—'}`,
    ],
  ])
  for (const section of report.sections) {
    doc.section(PERFORMANCE_REPORT_SECTION_LABELS[section])
    SECTION_WRITERS[section](doc, report)
  }
  doc.section('Okuma ve imza')
  doc.paragraph(
    report.acknowledgedDate === null
      ? 'Personelin "okudum" kaydı henüz girilmedi.'
      : `Personel raporu ${dayText(report.acknowledgedDate)} günü okudu (${
          report.acknowledgementChannel === null
            ? '—'
            : PERFORMANCE_REPORT_ACK_CHANNEL_LABELS[report.acknowledgementChannel]
        }; kaydeden ${report.acknowledgementRecordedByName ?? '—'}).`,
  )
  doc.signatures(
    `${report.finalizedByName ?? 'Yönetici'} — Değerlendiren`,
    `${report.staffName} — Okudum`,
  )
  return doc.finish()
}
