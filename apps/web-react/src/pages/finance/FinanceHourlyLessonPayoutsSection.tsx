import { useMemo, useState } from 'react'
import {
  useHourlyLessonPayoutDetail,
  useHourlyLessonPayoutExport,
  useHourlyLessonPayouts,
  useOwnHourlyLessonPayout,
  type HourlyLessonPayoutDetail,
  type HourlyLessonPayouts,
  type HourlyPayoutCsvScope,
} from '@kampus/react-shared/use-finance-hourly-lesson-payouts.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import {
  HOURLY_PAYOUT_NOTE,
  hourlyPayoutFilename,
  payoutMonthLabel,
} from '@kampus/school-core/lib/finance-hourly-lesson-payouts.ts'
import { dayKey, money } from '@kampus/school-core/lib/format.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useHourlyLessonPayoutPdf,
  type PayoutPdfTarget,
} from '@/hooks/use-finance-hourly-lesson-payout-pdf.ts'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import {
  defaultPayoutMonth,
  payoutAmountText,
  payoutBasisText,
  payoutDayText,
  payoutKindText,
  payoutLineRateText,
  payoutLineTimeText,
  payoutPlaceText,
  payoutRatePeriodText,
  payoutStatusText,
  payoutStatusTone,
  payoutTotalsText,
  payoutWarningText,
  payoutWarningTone,
  validPayoutMonth,
} from './finance-hourly-payout-forms.ts'

const BOM = '\uFEFF'
const TITLE = 'Ders saati hakediş dökümü'

/**
 * Ders saati hakediş dökümü (DOM-FIN-167; ON-075; IST-087): Finans "Ders saati hakedişi" sekmesi,
 * yalnız yönetici. Ay seçilir; saat ücretli öğretmenlerin verilen ders saati, iptal ve telafi
 * sayıları ve tutarı listelenir, satırdan gün gün döküm açılır. Her görüntüleme denetime düşer;
 * CSV ve PDF taze oturum ister. Döküm bordroya aktarılmaz (K-558).
 */
export function FinanceHourlyLessonPayoutsSection() {
  const [monthInput, setMonthInput] = useState(() => defaultPayoutMonth(dayKey()))
  const month = validPayoutMonth(monthInput)
  const list = useHourlyLessonPayouts(month)
  const [selected, setSelected] = useState<string | null>(null)
  const data = month === null ? undefined : list.data?.data
  const selectedRow = data?.teachers.find((row) => row.membershipId === selected) ?? null

  return (
    <section
      aria-labelledby="ders-saati-hakedis"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-3 px-6 pt-6 pb-4 max-[650px]:px-4">
        <div className="grid gap-1">
          <h2 id="ders-saati-hakedis" className="text-lg font-semibold">
            {TITLE}
          </h2>
          <p className="text-sm text-muted-foreground">{HOURLY_PAYOUT_NOTE}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <MonthField id="hakedis-ay" value={monthInput} onChange={setMonthInput} valid={month} />
          {month === null ? null : (
            <>
              <CsvButton scope={{ month }} accessibleName="Ders saati hakediş dökümü CSV" />
              <PdfDialogButton
                label="PDF"
                accessibleName="Ders saati hakediş özeti PDF"
                title={TITLE}
                id={{ kind: 'summary', month } satisfies PayoutPdfTarget}
                usePdf={useHourlyLessonPayoutPdf}
              />
            </>
          )}
        </div>
      </header>
      <div className="grid gap-4 px-6 pb-6 max-[650px]:px-4">
        {month !== null && list.error ? (
          <QueryError error={list.error} onRetry={() => void list.refetch()} />
        ) : null}
        {month !== null && list.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Döküm hazırlanıyor…
          </p>
        ) : null}
        {data ? <ListBody data={data} onOpen={setSelected} /> : null}
      </div>
      <SidePanel
        open={selectedRow !== null}
        onOpenChange={(open) => (open ? undefined : setSelected(null))}
        title={selectedRow === null ? TITLE : `${selectedRow.staffName} · ders saati dökümü`}
      >
        {selectedRow !== null && month !== null ? (
          <TeacherPanel month={month} membershipId={selectedRow.membershipId} />
        ) : null}
      </SidePanel>
    </section>
  )
}

function MonthField({
  id,
  value,
  onChange,
  valid,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  valid: string | null
}) {
  return (
    <FormField
      id={id}
      label="Ay"
      error={valid === null ? { message: 'Geçerli bir ay seçin.' } : undefined}
    >
      {(control) => (
        <Input
          {...control}
          type="month"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-48"
        />
      )}
    </FormField>
  )
}

/** CSV indirme düğmesi: taze oturum gerekirse parola sorulur ve indirme yeniden denenir. */
function CsvButton({
  scope,
  accessibleName,
}: {
  scope: HourlyPayoutCsvScope
  accessibleName: string
}) {
  const exporter = useHourlyLessonPayoutExport()
  const [reauth, setReauth] = useState(false)
  async function download() {
    const outcome = await exporter.submit(scope)
    if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(
      new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
      hourlyPayoutFilename(scope.month, 'csv'),
    )
    notify.success('Dosya indirildi.')
  }
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={exporter.isPending}
        aria-busy={exporter.isPending || undefined}
        aria-label={accessibleName}
        onClick={() => void download()}
      >
        <Icon name="Download" size={16} aria-hidden="true" />
        CSV indir
      </Button>
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void download()
          }}
        />
      ) : null}
    </>
  )
}

function ListBody({ data, onOpen }: { data: HourlyLessonPayouts; onOpen: (id: string) => void }) {
  const { totals } = data
  const stats = useMemo(
    () => [
      { label: 'Öğretmen', value: String(totals.teacherCount) },
      { label: 'Verilen ders saati', value: String(totals.givenHours) },
      { label: 'İptal edilen ders', value: String(totals.cancelledLessons) },
      { label: 'Telafi dersi', value: String(totals.makeupLessons) },
      {
        label: 'Toplam tutar',
        value: money(totals.amountCents),
        ...(totals.unpricedTeacherCount > 0
          ? { note: `${String(totals.unpricedTeacherCount)} öğretmenin tutarı eksik` }
          : {}),
      },
    ],
    [totals],
  )
  return (
    <>
      {data.monthComplete ? null : (
        <p role="note" className="text-sm text-muted-foreground">
          Ay sürüyor; henüz yapılmamış dersler sayılmadı.
        </p>
      )}
      <StatGrid label={`${payoutMonthLabel(data.month)} özeti`} items={stats} />
      {data.teachers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Bu ay saat ücretli ya da ücret tanımı olmayan öğretmenin dersi yok. Ücretler &quot;Ücret
          tanımları&quot; sekmesinde girilir.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption>{`${payoutMonthLabel(data.month)} ders saati hakediş dökümü`}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Öğretmen</TableHead>
                <TableHead scope="col">Ücret türü</TableHead>
                <TableHead scope="col" className="text-right">
                  Verilen ders saati
                </TableHead>
                <TableHead scope="col" className="text-right">
                  İptal
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Telafi
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Tutar
                </TableHead>
                <TableHead scope="col">Uyarılar</TableHead>
                <TableHead scope="col">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.teachers.map((row) => (
                <TableRow key={row.membershipId}>
                  <TableCell>
                    <span className="font-medium">{row.staffName}</span>
                    {row.staffActive ? null : (
                      <span className="block text-xs text-muted-foreground">pasif</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{payoutBasisText(row)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.totals.givenHours}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.totals.cancelledLessons}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.totals.makeupLessons}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(row.totals.amountCents)}
                  </TableCell>
                  <TableCell>
                    <Warnings name={row.staffName} codes={row.warnings} />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`${row.staffName} dökümünü aç`}
                      onClick={() => onOpen(row.membershipId)}
                    >
                      Dökümü aç
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}

function Warnings({
  name,
  codes,
}: {
  name: string
  codes: HourlyLessonPayouts['teachers'][number]['warnings']
}) {
  if (codes.length === 0) return <span className="text-sm text-muted-foreground">Yok</span>
  return (
    <ul aria-label={`${name} uyarıları`} className="flex flex-wrap gap-1">
      {codes.map((code) => (
        <li key={code}>
          <StatusBadge text={payoutWarningText(code)} tone={payoutWarningTone(code)} />
        </li>
      ))}
    </ul>
  )
}

function TeacherPanel({ month, membershipId }: { month: string; membershipId: string }) {
  const detail = useHourlyLessonPayoutDetail(month, membershipId)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const data = detail.data?.data
  if (data === undefined)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Döküm hazırlanıyor…
      </p>
    )
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <CsvButton
          scope={{ month, membershipId }}
          accessibleName={`${data.staffName} dökümü CSV`}
        />
        <PdfDialogButton
          label="PDF"
          accessibleName={`${data.staffName} dökümü PDF`}
          title={TITLE}
          id={{ kind: 'teacher', month, membershipId } satisfies PayoutPdfTarget}
          usePdf={useHourlyLessonPayoutPdf}
        />
      </div>
      <HourlyPayoutDetailView detail={data} />
    </div>
  )
}

/** Öğretmenin ay dökümü: özet, ücret dilimleri, uyarılar ve gün gün dersler (yönetici ve kendisi). */
export function HourlyPayoutDetailView({ detail }: { detail: HourlyLessonPayoutDetail }) {
  const lines = detail.days.flatMap((day) => day.lines)
  return (
    <div className="grid gap-4">
      <p className="text-sm">
        {payoutMonthLabel(detail.month)} · {payoutBasisText(detail)} ·{' '}
        {payoutTotalsText(detail.totals)} ·{' '}
        <strong className="tabular-nums">{money(detail.totals.amountCents)}</strong>
      </p>
      {detail.rates.length > 0 ? (
        <ul aria-label="Ücret dilimleri" className="grid gap-1 text-sm">
          {detail.rates.map((rate) => (
            <li key={`${rate.startDate}-${rate.rateType}`}>
              {payoutLineRateText(rate)} ({payoutRatePeriodText(rate)}): {rate.lessons} ders,{' '}
              {rate.hours} ders saati · {money(rate.amountCents)}
            </li>
          ))}
        </ul>
      ) : null}
      <Warnings name={detail.staffName} codes={detail.warnings} />
      <div className="overflow-x-auto">
        <Table>
          <TableCaption>{`${detail.staffName} ${payoutMonthLabel(detail.month)} dersleri`}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Gün</TableHead>
              <TableHead scope="col">Ders</TableHead>
              <TableHead scope="col">Durum</TableHead>
              <TableHead scope="col" className="text-right">
                Tutar
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.lessonId}>
                <TableCell className="align-top text-sm">
                  <span className="block font-medium">{payoutDayText(line.day)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {payoutLineTimeText(line)}
                  </span>
                </TableCell>
                <TableCell className="align-top text-sm">
                  <span className="block">{line.title ?? '—'}</span>
                  <span className="block text-xs text-muted-foreground">
                    {payoutPlaceText(line)} · {payoutKindText(line)}
                  </span>
                </TableCell>
                <TableCell className="align-top">
                  <StatusBadge text={payoutStatusText(line)} tone={payoutStatusTone(line)} />
                  {line.holidayTitle ? (
                    <span className="block text-xs text-muted-foreground">{line.holidayTitle}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right align-top text-sm tabular-nums">
                  <span className="block">{payoutAmountText(line)}</span>
                  {line.rateCents === null ? null : (
                    <span className="block text-xs text-muted-foreground">
                      {payoutLineRateText(line)}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/**
 * "Bilgilerim" içindeki kendi dökümü (DOM-FIN-166 self-servisi): personel yalnız kendi ders saati
 * dökümünü görür; aylık ücretliyse ya da ayda dersi yoksa döküm yoktur.
 */
export function OwnHourlyPayoutPanel({ className }: { className: string }) {
  const [monthInput, setMonthInput] = useState(() => defaultPayoutMonth(dayKey()))
  const month = validPayoutMonth(monthInput)
  const own = useOwnHourlyLessonPayout(month)
  const payout = month === null ? undefined : own.data?.data.payout
  return (
    <section aria-labelledby="ders-saati-dokumum" className={className}>
      <header className="mb-3 grid gap-3">
        <div className="grid gap-1">
          <h2 id="ders-saati-dokumum" className="text-lg font-semibold">
            Ders saati dökümüm
          </h2>
          <p className="text-sm text-muted-foreground">
            Saat ya da ders saati ücretiyle çalışıyorsanız ayın verdiğiniz, iptal edilen ve telafi
            dersleri ile tutarı. CSV ve PDF açılırken parolanız yeniden sorulabilir.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <MonthField id="dokumum-ay" value={monthInput} onChange={setMonthInput} valid={month} />
          {month !== null && payout ? (
            <>
              <CsvButton scope={{ month, own: true }} accessibleName="Ders saati dökümüm CSV" />
              <PdfDialogButton
                label="PDF"
                accessibleName="Ders saati dökümüm PDF"
                title={TITLE}
                id={{ kind: 'own', month } satisfies PayoutPdfTarget}
                usePdf={useHourlyLessonPayoutPdf}
              />
            </>
          ) : null}
        </div>
      </header>
      {month !== null && own.error ? (
        <QueryError error={own.error} onRetry={() => void own.refetch()} />
      ) : month !== null && own.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Döküm hazırlanıyor…
        </p>
      ) : payout === null ? (
        <p className="text-sm text-muted-foreground">
          Bu ay için ders saati dökümünüz yok (aylık ücretli ya da dersiniz yok).
        </p>
      ) : payout ? (
        <HourlyPayoutDetailView detail={payout} />
      ) : null}
    </section>
  )
}
