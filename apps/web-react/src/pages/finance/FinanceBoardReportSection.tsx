import { useRef, useState, type RefObject } from 'react'
import {
  useFinanceBoardReport,
  type FinanceBoardReportQuery,
} from '@kampus/react-shared/use-finance-board-report.ts'
import { money, number } from '@kampus/school-core/lib/format.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { useFinanceBoardReportPdf } from '@/hooks/use-finance-board-report-pdf.ts'
import {
  BOARD_REPORT_TITLE,
  boardReportPeriodLabel,
  rateLabel,
} from '@/lib/pdf/templates/finance-board-report.ts'
import {
  ALL_BOARD_REPORT_SECTIONS,
  BOARD_REPORT_SECTIONS,
  budgetPeriodLabel,
  NO_BUDGET_PERIOD,
  type BoardReportSections,
} from '@/lib/pdf/templates/finance-board-report-sections.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { FinancePdfDialog } from './FinancePdfDialog.tsx'
import {
  boardReportQuery,
  boardYearOptions,
  budgetPeriodOptions,
  CUSTOM_RANGE,
  MATCHED_BUDGET_PERIOD,
  periodOptions,
  WHOLE_YEAR,
} from './finance-board-report.ts'

/**
 * Yönetim kurulu raporu (DOM-FIN-064, ON-251): yönetici dönemi seçer, özet rakamları görür ve tek
 * PDF alır. Hesap sunucudadır; rapor kişi adı taşımaz, küçük kırılım hücreleri gizli gelir (K-77).
 * Bütçe dönemi seçilebilir (K-113); bütçe, maliyet ve tahmin bölümleri PDF'e isteğe bağlı girer
 * (ON-329).
 */
export function FinanceBoardReportSection({ academicYear }: { academicYear: number }) {
  const learner = useEnrollmentLearner()
  const [year, setYear] = useState(academicYear)
  const [selection, setSelection] = useState(WHOLE_YEAR)
  const [range, setRange] = useState({ from: '', to: '' })
  const [budgetPeriodId, setBudgetPeriodId] = useState(MATCHED_BUDGET_PERIOD)
  const [sections, setSections] = useState<BoardReportSections>(ALL_BOARD_REPORT_SECTIONS)
  const query = boardReportQuery(year, selection, range, budgetPeriodId)
  // Dönem listesi yılın raporuyla gelir; elle aralık seçilmişken de yıl özeti okunur.
  const yearReport = useFinanceBoardReport({ year })
  const report = useFinanceBoardReport(query ?? { year })
  const data = query === null ? undefined : report.data?.data
  const terms = yearReport.data?.data.terms ?? []
  const budgetPeriods = yearReport.data?.data.budgetPeriods ?? []

  return (
    <section
      aria-labelledby="yonetim-kurulu-raporu"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-2 px-6 pt-6 pb-2 max-[650px]:px-4">
        <h2 id="yonetim-kurulu-raporu" className="text-lg font-semibold">
          {BOARD_REPORT_TITLE}
        </h2>
        <p className="text-sm text-muted-foreground">
          Seçilen dönemin finans ve kayıt özeti tek PDF’tedir. Kişi adı yazılmaz; 5 kişiden az olan
          kırılımlar gizlenir.
        </p>
        <div className="mt-2 grid max-w-3xl grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
          <label className="grid gap-1 text-sm font-medium">
            Eğitim yılı
            <NativeSelect
              value={String(year)}
              onChange={(event) => {
                setYear(Number(event.target.value))
                setSelection(WHOLE_YEAR)
              }}
            >
              {boardYearOptions(academicYear).map((option) => (
                <NativeSelectOption key={option.value} value={String(option.value)}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Rapor dönemi
            <NativeSelect value={selection} onChange={(event) => setSelection(event.target.value)}>
              {periodOptions(terms).map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {selection === CUSTOM_RANGE ? (
            <>
              <label className="grid gap-1 text-sm font-medium">
                Başlangıç günü
                <Input
                  type="date"
                  value={range.from}
                  onChange={(event) => setRange({ ...range, from: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Bitiş günü
                <Input
                  type="date"
                  value={range.to}
                  onChange={(event) => setRange({ ...range, to: event.target.value })}
                />
              </label>
            </>
          ) : null}
          <label className="grid gap-1 text-sm font-medium">
            Bütçe dönemi
            <NativeSelect
              value={budgetPeriodId}
              onChange={(event) => setBudgetPeriodId(event.target.value)}
            >
              {budgetPeriodOptions(budgetPeriods).map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        </div>
      </header>
      <div className="grid gap-4 px-6 pt-4 pb-6 max-[650px]:px-4">
        {query === null ? (
          <p className="text-sm text-muted-foreground">Başlangıç ve bitiş gününü seçin.</p>
        ) : report.error ? (
          <QueryError error={report.error} onRetry={() => void report.refetch()} />
        ) : !data ? (
          <p role="status" className="text-sm text-muted-foreground">
            Rapor hazırlanıyor…
          </p>
        ) : (
          <>
            <p className="text-sm">
              {boardReportPeriodLabel(data.period)}
              {data.period.complete ? '' : ' · dönem sürüyor, rakamlar bugüne kadardır'}
            </p>
            <StatGrid
              label="Yönetim kurulu raporu özeti"
              items={[
                {
                  label: 'Tahakkuk',
                  value: money(data.finance.totals.accruedCents),
                  note: 'Vadesi dönemde olan taksitler',
                },
                {
                  label: 'Net tahsilat',
                  value: money(data.finance.methods.netCents),
                  note: `İptal ${money(data.finance.methods.reversedCents)}`,
                },
                {
                  label: 'Gecikmiş alacak',
                  value: money(data.finance.aging.overdueCents),
                  note: 'Bugün itibarıyla',
                },
                {
                  label: `Dönem sonu ${learner.noun}`,
                  value: number(data.enrollment.endCount),
                  note: `Yeni ${number(data.enrollment.newCount)} · ayrılış ${number(data.enrollment.withdrawnCount)}`,
                },
                ...(data.enrollment.renewal
                  ? [
                      {
                        label: 'Yenileme oranı',
                        value: rateLabel(data.enrollment.renewal.rate),
                        note: `${number(data.enrollment.renewal.renewedCount)} / ${number(data.enrollment.renewal.eligibleCount)}`,
                      },
                    ]
                  : []),
              ]}
            />
            <p className="text-sm">
              {data.budgetPeriod === null
                ? NO_BUDGET_PERIOD
                : `Bütçe dönemi: ${budgetPeriodLabel(data.budgetPeriod)}`}
            </p>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">PDF’e eklenecek bölümler</legend>
              {BOARD_REPORT_SECTIONS.map((section) => (
                <div key={section.key} className="flex min-h-11 items-center gap-2">
                  <Checkbox
                    id={`kurul-bolum-${section.key}`}
                    checked={sections[section.key]}
                    onCheckedChange={(checked) =>
                      setSections({ ...sections, [section.key]: checked === true })
                    }
                  />
                  <Label htmlFor={`kurul-bolum-${section.key}`}>{section.label}</Label>
                </div>
              ))}
            </fieldset>
            <BoardReportPdfButton query={query} sections={sections} />
          </>
        )}
      </div>
    </section>
  )
}

function BoardReportPdfButton({
  query,
  sections,
}: {
  query: FinanceBoardReportQuery
  sections: BoardReportSections
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <div>
      <Button ref={button} type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="FileText" size={16} />
        Rapor PDF’i
      </Button>
      {open ? (
        <BoardReportPdfPreview
          query={query}
          sections={sections}
          onClose={() => setOpen(false)}
          button={button}
        />
      ) : null}
    </div>
  )
}

function BoardReportPdfPreview({
  query,
  sections,
  onClose,
  button,
}: {
  query: FinanceBoardReportQuery
  sections: BoardReportSections
  onClose: () => void
  button: RefObject<HTMLButtonElement | null>
}) {
  const pdf = useFinanceBoardReportPdf(query, sections, true)
  return (
    <FinancePdfDialog
      title={BOARD_REPORT_TITLE}
      pdf={pdf}
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        button.current?.focus()
      }}
    />
  )
}
