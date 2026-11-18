import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useArchiveSgkEmploymentDates,
  useArchiveSgkMissingDay,
  useCreateSgkEmploymentDates,
  useCreateSgkMissingDay,
  useSgkPreparation,
  useSgkPreparationExport,
  type SgkPreparation,
  type SgkPreparationRow,
} from '@kampus/react-shared/use-finance-sgk-preparation.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import {
  SGK_PREPARATION_NOTE,
  SGK_SELECTABLE_REASON_CODES,
  sgkBaseText,
  sgkDateText,
  sgkMonthLabel,
  sgkPreparationFilename,
  sgkReasonLabel,
  sgkReasonText,
  sgkRoleLabel,
  sgkWageText,
} from '@kampus/school-core/lib/finance-sgk-preparation.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useSgkPreparationPdf } from '@/hooks/use-finance-sgk-preparation-pdf.ts'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { SGK_PREPARATION_TITLE } from '@/lib/pdf/templates/finance-sgk-preparation.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { RootError } from '../management/FormParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import {
  defaultSgkMonth,
  SGK_MISSING_DAY_DEFAULTS,
  sgkEmploymentDatesBody,
  sgkEmploymentDatesFormSchema,
  sgkFormField,
  sgkMissingDayBody,
  sgkMissingDayFormSchema,
  sgkMissingEntryText,
  sgkWarningText,
  sgkWarningTone,
  validSgkMonth,
  type SgkEmploymentDatesFormValues,
  type SgkMissingDayFormValues,
} from './finance-sgk-preparation-forms.ts'

const BOM = '\uFEFF'
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/**
 * SGK bildirge hazırlık listesi (DOM-FIN-107; ON-203): Finans "SGK hazırlık listesi" sekmesi, yalnız
 * yönetici (K-355). Ay seçilir; liste ücret tanımlarından, elle eksik gün ve giriş/çıkış
 * satırlarından hesaplanır. Her görüntüleme, CSV ve PDF denetim kaydına yazılır; resmî sisteme
 * gönderim yoktur (IST-143). Personel satırının panelinde elle satırlar girilir ve kaldırılır.
 */
export function FinanceSgkPreparationSection() {
  const [monthInput, setMonthInput] = useState(() => defaultSgkMonth(dayKey()))
  const month = validSgkMonth(monthInput)
  const list = useSgkPreparation(month)
  const exporter = useSgkPreparationExport()
  const [reauth, setReauth] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const data = month === null ? undefined : list.data?.data
  const selectedRow = data?.rows.find((row) => row.membershipId === selected) ?? null

  async function download() {
    if (month === null) return
    const outcome = await exporter.submit(month)
    if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(
      new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
      sgkPreparationFilename(month, 'csv'),
    )
    notify.success('Dosya indirildi.')
  }

  return (
    <section
      aria-labelledby="sgk-hazirlik"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-3 px-6 pt-6 pb-4 max-[650px]:px-4">
        <div className="grid gap-1">
          <h2 id="sgk-hazirlik" className="text-lg font-semibold">
            SGK hazırlık listesi
          </h2>
          <p className="text-sm text-muted-foreground">{SGK_PREPARATION_NOTE}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <FormField
            id="sgk-ay"
            label="Ay"
            error={month === null ? { message: 'Geçerli bir ay seçin.' } : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="month"
                value={monthInput}
                onChange={(event) => setMonthInput(event.target.value)}
                className="w-48"
              />
            )}
          </FormField>
          <Button
            type="button"
            variant="secondary"
            disabled={month === null || exporter.isPending}
            aria-busy={exporter.isPending || undefined}
            onClick={() => void download()}
          >
            <Icon name="Download" size={16} aria-hidden="true" />
            CSV indir
          </Button>
          {month === null ? null : (
            <PdfDialogButton
              label="PDF"
              accessibleName="SGK hazırlık listesi PDF"
              title={SGK_PREPARATION_TITLE}
              id={month}
              usePdf={useSgkPreparationPdf}
            />
          )}
        </div>
      </header>
      <div className="grid gap-4 px-6 pb-6 max-[650px]:px-4">
        {month !== null && list.error ? (
          <QueryError error={list.error} onRetry={() => void list.refetch()} />
        ) : null}
        {month !== null && list.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Liste hazırlanıyor…
          </p>
        ) : null}
        {data ? <ListBody data={data} onOpen={setSelected} /> : null}
      </div>
      <SidePanel
        open={selectedRow !== null}
        onOpenChange={(open) => (open ? undefined : setSelected(null))}
        title="SGK satırı"
      >
        {selectedRow && data ? <RowPanel row={selectedRow} month={data.month} /> : null}
      </SidePanel>
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void download()
          }}
        />
      ) : null}
    </section>
  )
}

function ListBody({ data, onOpen }: { data: SgkPreparation; onOpen: (id: string) => void }) {
  const { parameters, totals } = data
  const stats = useMemo(
    () => [
      { label: 'Personel', value: String(totals.staffCount) },
      { label: 'Toplam prim günü', value: String(totals.primDays) },
      { label: 'Eksik gün', value: String(totals.missingDays) },
      {
        label: 'SGK matrahı tahmini',
        value: money(totals.sgkBaseCents),
        ...(totals.unestimatedCount > 0
          ? { note: `${String(totals.unestimatedCount)} personel tahmin dışı` }
          : {}),
      },
      { label: 'Uyarılı satır', value: String(totals.warningRowCount) },
    ],
    [totals],
  )
  return (
    <>
      <p className="text-sm">
        Taban {money(parameters.floorCents)}, tavan {money(parameters.ceilingCents)} (aylık;{' '}
        {dayText(parameters.effectiveFrom)}{' '}
        {parameters.origin === 'institution' ? 'kurum' : 'platform'} seti).
        {parameters.unverified ? ' Platform değerleri doğrulanmalı.' : ''}
        {parameters.stale ? ' Bu yıl için parametre seti yok; son bilinen set kullanıldı.' : ''}
      </p>
      <StatGrid label={`${sgkMonthLabel(data.month)} özeti`} items={stats} />
      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Bu ay ana ücret tanımı yürürlükte olan personel yok. Ücretler &quot;Ücret tanımları&quot;
          sekmesinde girilir.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableCaption>{`${sgkMonthLabel(data.month)} SGK hazırlık listesi`}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Personel</TableHead>
                <TableHead scope="col">Giriş / çıkış</TableHead>
                <TableHead scope="col" className="text-right">
                  Prim günü
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Eksik gün
                </TableHead>
                <TableHead scope="col">Neden</TableHead>
                <TableHead scope="col">Tanımlı ücret</TableHead>
                <TableHead scope="col" className="text-right">
                  SGK matrahı
                </TableHead>
                <TableHead scope="col">Uyarılar</TableHead>
                <TableHead scope="col">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.membershipId}>
                  <TableCell>
                    <span className="font-medium">{row.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {sgkRoleLabel(row.role)}
                      {row.active ? '' : ' · pasif'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.entryDate === null && row.exitDate === null ? (
                      '—'
                    ) : (
                      <>
                        {row.entryDate ? (
                          <span className="block">
                            Giriş: {sgkDateText(row.entryDate, row.entrySource)}
                          </span>
                        ) : null}
                        {row.exitDate ? (
                          <span className="block">
                            Çıkış: {sgkDateText(row.exitDate, row.exitSource)}
                          </span>
                        ) : null}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.primDays}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.missingDays}</TableCell>
                  <TableCell className="text-sm">{sgkReasonText(row.reasonCode) || '—'}</TableCell>
                  <TableCell className="text-sm">{sgkWageText(row.wage)}</TableCell>
                  <TableCell className="text-right tabular-nums">{sgkBaseText(row)}</TableCell>
                  <TableCell>
                    {row.warnings.length === 0 ? (
                      <span className="text-sm text-muted-foreground">Yok</span>
                    ) : (
                      <ul aria-label={`${row.name} uyarıları`} className="flex flex-wrap gap-1">
                        {row.warnings.map((code) => (
                          <li key={code}>
                            <StatusBadge text={sgkWarningText(code)} tone={sgkWarningTone(code)} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`${row.name} eksik gün ve giriş/çıkış`}
                      onClick={() => onOpen(row.membershipId)}
                    >
                      Düzenle
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

function RowPanel({ row, month }: { row: SgkPreparationRow; month: string }) {
  const removeMissing = useArchiveSgkMissingDay()
  const removeDates = useArchiveSgkEmploymentDates()
  const dates = row.employmentDates
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{row.name}</h3>
        <p className="text-sm text-muted-foreground">
          {sgkMonthLabel(month)} · {row.primDays} prim günü
        </p>
      </div>
      <section aria-labelledby="sgk-eksik" className="grid gap-2">
        <h4 id="sgk-eksik" className="text-sm font-semibold">
          Eksik gün
        </h4>
        {row.missingDayEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu ay eksik gün girilmedi.</p>
        ) : (
          <ul aria-label="Eksik gün satırları" className="grid gap-2 text-sm">
            {row.missingDayEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-sm border px-3 py-2"
              >
                <span className="[overflow-wrap:anywhere]">
                  {sgkMissingEntryText(entry)}
                  {entry.note ? (
                    <span className="block text-muted-foreground">{entry.note}</span>
                  ) : null}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`${sgkMissingEntryText(entry)} satırını kaldır`}
                  disabled={removeMissing.isPending}
                  onClick={() =>
                    void removeMissing
                      .submit({ entryId: entry.id, version: entry.version })
                      .then((outcome) => {
                        if (outcome.status === 'success') notify.success('Eksik gün kaldırıldı.')
                      })
                  }
                >
                  Kaldır
                </Button>
              </li>
            ))}
          </ul>
        )}
        <MissingDayForm membershipId={row.membershipId} month={month} />
      </section>
      <section aria-labelledby="sgk-giris-cikis" className="grid gap-2">
        <h4 id="sgk-giris-cikis" className="text-sm font-semibold">
          Elle giriş/çıkış günü
        </h4>
        {dates === null ? (
          <>
            <p className="text-sm text-muted-foreground">
              Giriş ve çıkış ücret tanımından gelir. Farklıysa günü buradan girin.
            </p>
            <EmploymentDatesForm membershipId={row.membershipId} month={month} />
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border px-3 py-2 text-sm">
            <span>
              {dates.entryDate ? `Giriş ${dayText(dates.entryDate)}` : null}
              {dates.entryDate && dates.exitDate ? ' · ' : null}
              {dates.exitDate ? `Çıkış ${dayText(dates.exitDate)}` : null}
              {dates.note ? (
                <span className="block text-muted-foreground">{dates.note}</span>
              ) : null}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={removeDates.isPending}
              onClick={() =>
                void removeDates
                  .submit({ entryId: dates.id, version: dates.version })
                  .then((outcome) => {
                    if (outcome.status === 'success') notify.success('Giriş/çıkış günü kaldırıldı.')
                  })
              }
            >
              Giriş/çıkışı kaldır
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

const MISSING_FIELDS = ['days', 'reasonCode', 'note'] as const

function MissingDayForm({ membershipId, month }: { membershipId: string; month: string }) {
  const create = useCreateSgkMissingDay()
  const form = useForm<SgkMissingDayFormValues>({
    resolver: zodResolver(sgkMissingDayFormSchema),
    defaultValues: SGK_MISSING_DAY_DEFAULTS,
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(sgkMissingDayBody(membershipId, month, values), {
      setError: (name, error) => {
        const field = sgkFormField(name, MISSING_FIELDS)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success('Eksik gün kaydedildi.')
    form.reset(SGK_MISSING_DAY_DEFAULTS)
  })
  return (
    <form
      noValidate
      aria-label="Eksik gün ekle"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="sgk-eksik-gun" label="Eksik gün" error={errors.days}>
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            {...form.register('days')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="sgk-neden" label="Neden" error={errors.reasonCode}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('reasonCode')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Neden sonra girilecek</NativeSelectOption>
            {SGK_SELECTABLE_REASON_CODES.map((code) => (
              <NativeSelectOption key={code} value={code}>
                {sgkReasonLabel(code)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField
          id="sgk-eksik-not"
          label="Not (isteğe bağlı)"
          description="Tanı ya da sağlık bilgisi yazmayın."
          error={errors.note}
        >
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Eksik gün ekle
        </Button>
      </div>
    </form>
  )
}

const DATE_FIELDS = ['entryDate', 'exitDate', 'note'] as const

function EmploymentDatesForm({ membershipId, month }: { membershipId: string; month: string }) {
  const create = useCreateSgkEmploymentDates()
  const schema = useMemo(() => sgkEmploymentDatesFormSchema(month), [month])
  const form = useForm<SgkEmploymentDatesFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { entryDate: '', exitDate: '', note: '' },
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(sgkEmploymentDatesBody(membershipId, month, values), {
      setError: (name, error) => {
        const field = sgkFormField(name, DATE_FIELDS)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success('Giriş/çıkış günü kaydedildi.')
  })
  return (
    <form
      noValidate
      aria-label="Giriş/çıkış günü"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="sgk-giris" label="İşe giriş günü" error={errors.entryDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('entryDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="sgk-cikis" label="İşten çıkış günü" error={errors.exitDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('exitDate')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="sgk-tarih-not" label="Not (isteğe bağlı)" error={errors.note}>
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Günü kaydet
        </Button>
      </div>
    </form>
  )
}
