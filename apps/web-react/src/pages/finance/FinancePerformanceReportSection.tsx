import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { PerformancePeriod } from '@kampus/react-shared/use-finance-performance.ts'
import {
  useAcknowledgePerformanceReport,
  useFinalizePerformanceReport,
  usePerformanceReport,
  usePerformanceReportRows,
  usePerformanceReportSummary,
  type PerformanceReport,
  type PerformanceReportRow,
} from '@kampus/react-shared/use-finance-performance-reports.ts'
import {
  PERFORMANCE_REPORT_ACK_CHANNEL_LABELS,
  PERFORMANCE_REPORT_ACK_CHANNELS,
  PERFORMANCE_REPORT_SECTION_LABELS,
  PERFORMANCE_REPORT_SELF_STATUS_LABELS,
  PERFORMANCE_REPORT_STATUS_LABELS,
  type PerformanceReportSection,
  type PerformanceReportStatus,
} from '@kampus/school-core/lib/finance-performance-reports.ts'
import { SELF_EVALUATION_CHANNEL_LABELS } from '@kampus/school-core/lib/finance-self-evaluations.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { usePerformanceReportPdf } from '@/hooks/use-finance-performance-report-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { PERFORMANCE_REPORT_TITLE } from '@/lib/pdf/templates/finance-performance-report.ts'
import { RootError } from '../management/FormParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import {
  distributionRows,
  performanceReportAcknowledgeDefaults,
  performanceReportAcknowledgeFormSchema,
  performanceReportFinalizeFormSchema,
  reportActions,
  reportPercentText,
  reportScoreText,
  reportSummaryText,
  type PerformanceReportAcknowledgeFormValues,
  type PerformanceReportFinalizeFormValues,
} from './finance-performance-report-forms.ts'
import { staffRoleText } from './finance-staff-certificate-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['staffName', 'status']
const TONES = {
  draft: 'gray',
  finalized: 'amber',
  acknowledged: 'green',
} as const satisfies Record<PerformanceReportStatus, BadgeTone>
const day = (value: string) => dateLabel(`${value}T09:00:00.000Z`, { year: 'numeric' })
const moment = (value: string | null) =>
  value === null ? '—' : dateLabel(value, { year: 'numeric' })

type Row = {
  id: string
  staffName: string
  overall: string
  self: string
  observations: string
  row: PerformanceReportRow
}

/**
 * Performans raporu bölümü (DOM-FIN-137; ON-220): Finans "Performans" sekmesinde seçili dönemin
 * altında, yalnız yönetici (K-468). Dönem özeti (ortalama, dağılım, gözlem ortalaması, rapor
 * sayıları), personel başına satırlar ve personel × dönem raporu: dönem sonu değerlendirmesi, öz
 * değerlendirme, ders gözlemleri ve yönetici görüşü (K-466). Kapanan dönemde rapor görüşle
 * kesinleşir, personelin "okudum" kaydı kanalıyla girilir (K-467). Satır ve rapor açılışı ile PDF
 * denetim kaydına yazılır. Gelişim hedefleri (ON-209) ve çok kaynaklı geri bildirim (ON-212)
 * bölümleri birleşince sunucunun `sections` listesiyle eklenir.
 */
export function PerformanceReportPanel({ period }: { period: PerformancePeriod }) {
  const summary = usePerformanceReportSummary(period.id)
  const list = useListState('performans-raporu', { urlPrefix: 'prap_' })
  const search = useDebouncedValue(list.state.query).trim()
  const reports = usePerformanceReportRows(period.id, {
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const [opened, setOpened] = useState<PerformanceReportRow | null>(null)
  const data = summary.data?.data
  const rows = useMemo(
    () =>
      reports.data?.data.map((row): Row => ({
        id: row.reviewId,
        staffName: `${row.staffName} · ${staffRoleText(row.staffRole)}`,
        overall: reportScoreText(row.overallScore),
        self: PERFORMANCE_REPORT_SELF_STATUS_LABELS[row.selfEvaluationStatus],
        observations:
          row.observationCount === 0
            ? 'Yok'
            : `${String(row.observationCount)} · ${reportPercentText(row.observationAverage)}`,
        row,
      })),
    [reports.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'staffName', label: 'Personel' },
      { key: 'overall', label: 'Genel puan' },
      { key: 'self', label: 'Öz değerlendirme' },
      { key: 'observations', label: 'Gözlem' },
      {
        key: 'status',
        label: 'Rapor',
        cell: (row) => (
          <StatusBadge
            text={PERFORMANCE_REPORT_STATUS_LABELS[row.row.status]}
            tone={TONES[row.row.status]}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label={`${row.row.staffName} raporunu aç`}
              onClick={() => setOpened(row.row)}
            >
              Raporu aç
            </Button>
            <PdfDialogButton
              label="PDF"
              title={PERFORMANCE_REPORT_TITLE}
              id={row.row.reviewId}
              usePdf={usePerformanceReportPdf}
              accessibleName={`${row.row.staffName} performans raporu PDF`}
            />
          </span>
        ),
      },
    ],
    [],
  )
  return (
    <section
      aria-labelledby="performans-raporu"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-2 px-6 pt-6 pb-2">
        <h2 id="performans-raporu" className="text-lg font-semibold">
          {period.name} · rapor
        </h2>
        <p className="text-sm text-muted-foreground">
          Dönem sonu değerlendirmesi, öz değerlendirme ve ders gözlemleri personel başına bir
          raporda. Dönem kapanınca rapor yönetici görüşüyle kesinleşir; personelin okuduğu kanalıyla
          kaydedilir. Satırların, raporların ve PDF&apos;lerin açılışı denetim kaydına yazılır.
        </p>
        {summary.error ? (
          <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
        ) : data ? (
          <>
            <p className="text-sm" aria-live="polite">
              {reportSummaryText(data)}
            </p>
            <Distribution summary={data} />
          </>
        ) : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={reports.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE}
        caption={`${period.name} performans raporları`}
        empty="Bu döneme henüz personel eklenmedi."
        emptyFiltered="Bu aramayla eşleşen personel yok."
        loading={reports.isPending}
        fetching={reports.isFetching && !reports.isPending}
        error={
          reports.error ? (
            <QueryError error={reports.error} onRetry={() => void reports.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={opened !== null}
        onOpenChange={(open) => (open ? undefined : setOpened(null))}
        title={opened ? `${opened.staffName} · performans raporu` : 'Performans raporu'}
        description={`${period.name} · ${day(period.startDate)} – ${day(period.endDate)}`}
      >
        {opened ? <ReportView reviewId={opened.reviewId} onDone={() => setOpened(null)} /> : null}
      </Modal>
    </section>
  )
}

function Distribution({ summary }: { summary: Parameters<typeof distributionRows>[0] }) {
  if (summary.scoredCount === 0) return null
  return (
    <dl aria-label="Genel puan dağılımı" className="grid max-w-md gap-1 text-sm">
      {distributionRows(summary).map((item) => (
        <div key={item.band} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span className="block h-full bg-primary" style={{ width: `${String(item.ratio)}%` }} />
          </dd>
          <dd className="text-right tabular-nums">{item.count}</dd>
        </div>
      ))}
    </dl>
  )
}

function ReportView({ reviewId, onDone }: { reviewId: string; onDone: () => void }) {
  const detail = usePerformanceReport(reviewId)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const report = detail.data?.data
  if (!report) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>
  const actions = reportActions(report.periodStatus, report.status)
  return (
    <div className="grid gap-4">
      <p className="text-sm">
        <StatusBadge
          text={PERFORMANCE_REPORT_STATUS_LABELS[report.status]}
          tone={TONES[report.status]}
        />{' '}
        {report.finalizedAt === null
          ? report.periodStatus === 'closed'
            ? 'Rapor yönetici görüşüyle kesinleştirilebilir.'
            : 'Dönem kapanınca kesinleştirilir.'
          : `Kesinleştirme: ${moment(report.finalizedAt)} · ${report.finalizedByName ?? '—'}`}
      </p>
      {report.sections.map((section) => (
        <section
          key={section}
          aria-labelledby={`rapor-${section}`}
          className="grid gap-2 border-b pb-3"
        >
          <h3 id={`rapor-${section}`} className="font-semibold">
            {PERFORMANCE_REPORT_SECTION_LABELS[section]}
          </h3>
          <SectionBody section={section} report={report} />
        </section>
      ))}
      <AcknowledgementText report={report} />
      {actions.finalize ? <FinalizeForm report={report} onDone={onDone} /> : null}
      {actions.acknowledge ? <AcknowledgeForm report={report} onDone={onDone} /> : null}
    </div>
  )
}

function SectionBody({
  section,
  report,
}: {
  section: PerformanceReportSection
  report: PerformanceReport
}) {
  switch (section) {
    case 'evaluation': {
      const { evaluation } = report
      return (
        <>
          <p className="text-sm">Genel puan: {reportScoreText(evaluation.overallScore)}</p>
          <ul aria-label="Hedefler" className="grid gap-1 text-sm">
            {evaluation.goals.map((goal, index) => (
              <li key={`${goal.title}-${String(index)}`}>
                {goal.title} (%{goal.weight}):{' '}
                {goal.score === null ? 'puanlanmadı' : `${String(goal.score)} / 5`}
              </li>
            ))}
          </ul>
          {evaluation.interimNote === null ? null : (
            <p className="text-sm whitespace-pre-wrap">
              Ara görüşme
              {evaluation.interimDate === null ? '' : ` (${day(evaluation.interimDate)})`}:{' '}
              {evaluation.interimNote}
            </p>
          )}
          <p className="text-sm whitespace-pre-wrap">
            Personelin görüşü: {evaluation.staffComment ?? '—'}
          </p>
        </>
      )
    }
    case 'selfEvaluation': {
      const self = report.selfEvaluation
      if (self.status !== 'submitted')
        return (
          <p className="text-sm text-muted-foreground">
            {PERFORMANCE_REPORT_SELF_STATUS_LABELS[self.status]}; rapora yalnız gönderilmiş öz
            değerlendirme girer.
          </p>
        )
      return (
        <>
          <p className="text-sm">
            Gönderildi: {moment(self.submittedAt)} · Kanal:{' '}
            {self.channel === null ? '—' : SELF_EVALUATION_CHANNEL_LABELS[self.channel]} · Puanlı
            soru ortalaması: {reportScoreText(self.scaleAverage)}
          </p>
          <dl aria-label="Öz değerlendirme cevapları" className="grid gap-2 text-sm">
            {self.items.map((item, index) => (
              <div key={`${item.question}-${String(index)}`} className="grid gap-0.5">
                <dt className="font-medium">{item.question}</dt>
                <dd className="whitespace-pre-wrap">
                  {item.kind === 'scale'
                    ? item.score === null
                      ? '—'
                      : `${String(item.score)} / 5`
                    : (item.text ?? '—')}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )
    }
    case 'observations': {
      const { observations } = report
      if (observations.count === 0)
        return <p className="text-sm text-muted-foreground">Dönemde tamamlanmış gözlem yok.</p>
      return (
        <>
          <p className="text-sm">
            {observations.count} gözlem · ortalama {reportPercentText(observations.averagePercent)}
          </p>
          <ul aria-label="Ders gözlemleri" className="grid gap-1 text-sm">
            {observations.items.map((item) => (
              <li key={item.id}>
                {day(item.observedDate)} · {item.templateName} · {item.observerName}: %
                {item.percent}
              </li>
            ))}
          </ul>
        </>
      )
    }
    case 'managerOpinion':
      return (
        <p className="text-sm whitespace-pre-wrap">
          {report.managerOpinion ?? 'Rapor kesinleşince yönetici görüşü yazılır.'}
        </p>
      )
    default:
      return section satisfies never
  }
}

function AcknowledgementText({ report }: { report: PerformanceReport }) {
  if (report.status !== 'acknowledged' || report.acknowledgedDate === null) return null
  return (
    <p className="text-sm">
      Okundu: {day(report.acknowledgedDate)} ·{' '}
      {report.acknowledgementChannel === null
        ? '—'
        : PERFORMANCE_REPORT_ACK_CHANNEL_LABELS[report.acknowledgementChannel]}{' '}
      · Kaydeden: {report.acknowledgementRecordedByName ?? '—'}
    </p>
  )
}

function FinalizeForm({ report, onDone }: { report: PerformanceReport; onDone: () => void }) {
  const finalize = useFinalizePerformanceReport()
  const form = useForm<PerformanceReportFinalizeFormValues>({
    resolver: zodResolver(performanceReportFinalizeFormSchema),
    defaultValues: { managerOpinion: '' },
  })
  const errors = form.formState.errors
  const busy = finalize.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await finalize.submit(
      { reviewId: report.reviewId, body: values },
      {
        setError: (name, error) => {
          if (name === 'managerOpinion') form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Rapor kesinleşti.')
      onDone()
    }
  })
  return (
    <form
      noValidate
      aria-label="Raporu kesinleştir"
      className="grid gap-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="prap-gorus"
        label="Yönetici görüşü"
        description="Kesinleşen raporun görüşü sonradan değiştirilemez."
        error={errors.managerOpinion}
      >
        {(control) => (
          <Textarea {...control} rows={4} {...form.register('managerOpinion')} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Raporu kesinleştir
        </Button>
      </div>
    </form>
  )
}

function AcknowledgeForm({ report, onDone }: { report: PerformanceReport; onDone: () => void }) {
  const acknowledge = useAcknowledgePerformanceReport()
  const [today] = useState(() => dayKey())
  const form = useForm<PerformanceReportAcknowledgeFormValues>({
    resolver: zodResolver(performanceReportAcknowledgeFormSchema),
    defaultValues: performanceReportAcknowledgeDefaults(today),
  })
  const errors = form.formState.errors
  const busy = acknowledge.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await acknowledge.submit(
      {
        reviewId: report.reviewId,
        body: { channel: values.channel, acknowledgedDate: values.acknowledgedDate },
      },
      {
        setError: (name, error) => {
          if (name === 'channel' || name === 'acknowledgedDate')
            form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('"Okudum" kaydı girildi.')
      onDone()
    }
  })
  return (
    <form
      noValidate
      aria-label="Okudum kaydı"
      className="grid gap-2 border-t pt-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm text-muted-foreground sm:col-span-2">
        Personelin raporu okuduğunu onun adına kaydedin.
      </p>
      <FormField id="prap-kanal" label="Kanal" error={errors.channel}>
        {(control) => (
          <NativeSelect {...control} {...form.register('channel')} disabled={busy}>
            {PERFORMANCE_REPORT_ACK_CHANNELS.map((channel) => (
              <NativeSelectOption key={channel} value={channel}>
                {PERFORMANCE_REPORT_ACK_CHANNEL_LABELS[channel]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="prap-gun" label="Okuma günü" error={errors.acknowledgedDate}>
        {(control) => (
          <Input
            {...control}
            type="date"
            max={today}
            {...form.register('acknowledgedDate')}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div className="sm:col-span-2">
        <Button type="submit" variant="outline" disabled={busy} aria-busy={busy || undefined}>
          Okudum kaydını gir
        </Button>
      </div>
    </form>
  )
}
