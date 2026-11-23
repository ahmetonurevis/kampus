import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useLessonHourSuggestionDetail,
  useLessonHourSuggestions,
  useTransferLessonHourSuggestions,
  type LessonHourSuggestions,
  type LessonHourSuggestionTeacher,
} from '@kampus/react-shared/use-finance-lesson-hour-suggestions.ts'
import type { LessonSuggestionParams } from '@kampus/school-core/lib/finance-lesson-hour-suggestions.ts'
import { payrollMonthLabel } from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  bulkTransferBody,
  canCorrect,
  canTransfer,
  dayHeading,
  lessonItemText,
  SUGGESTION_PARAM_DEFAULTS,
  suggestionParams,
  suggestionRow,
  transferBody,
  transferDefaults,
  transferFormSchema,
  transferNotice,
  weekText,
  type SuggestionParamValues,
  type SuggestionRow,
  type TransferFormValues,
} from './finance-lesson-suggestion-forms.ts'

const MOBILE = ['staff', 'suggested', 'current']

type Dialog =
  | { kind: 'detail'; teacher: LessonHourSuggestionTeacher }
  | { kind: 'correct'; teacher: LessonHourSuggestionTeacher }
  | { kind: 'bulk' }
  | null

/**
 * Programdan hesapla (DOM-FIN-165; ON-195): "Bordro aktarımı" sekmesindeki ek ders bölümünün
 * önerisi. Ders programı, okul takvimi tatilleri, izinler ve yoklamadan öğretmen başına önerilen
 * ek ders saati, elle girişle farkı ve gün dökümü; öneri tek tıkla (tek ya da toplu) elle girişe
 * aktarılır ya da gerekçeyle düzeltilerek aktarılır (K-552). Müdür onaylı ya da kilitli ayda
 * aktarım kapalıdır (K-410). Yalnız okul türünde kurumda gösterilir.
 */
export function FinanceLessonHourSuggestionPanel({ month }: { month: string }) {
  const [values, setValues] = useState<SuggestionParamValues>(SUGGESTION_PARAM_DEFAULTS)
  const settled = useDebouncedValue(values, 400)
  const checked = suggestionParams(values)
  const { params } = suggestionParams(settled)
  const query = useLessonHourSuggestions(month, params ?? defaultParams, params !== null)
  const data = params === null ? undefined : query.data?.data
  const transfer = useTransferLessonHourSuggestions()
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = () => setDialog(null)
  const teachers = useMemo(
    () => new Map(data?.teachers.map((teacher) => [teacher.membershipId, teacher])),
    [data],
  )
  const rows = useMemo(() => data?.teachers.map(suggestionRow) ?? [], [data])
  const bulk = data === undefined ? null : bulkTransferBody(data)
  const label = payrollMonthLabel(month)

  const columns = useMemo<DataColumn<SuggestionRow>[]>(() => {
    async function quickTransfer(teacher: LessonHourSuggestionTeacher) {
      if (data === undefined) return
      const outcome = await transfer.submit({ month, body: transferBody(data, teacher) })
      if (outcome.status === 'success')
        notify.success(`${teacher.staffName} için öneri ek ders saatine aktarıldı.`)
    }
    return [
      { key: 'staff', label: 'Öğretmen' },
      { key: 'payBasis', label: 'Ücret türü' },
      { key: 'counted', label: 'Sayılan ders' },
      { key: 'load', label: 'Maaş karşılığı' },
      { key: 'suggested', label: 'Önerilen ek ders' },
      { key: 'current', label: 'Elle giriş' },
      { key: 'difference', label: 'Fark' },
      { key: 'warnings', label: 'Uyarı' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: SuggestionRow) => {
          const teacher = teachers.get(row.id)
          if (teacher === undefined || data === undefined) return null
          return (
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${teacher.staffName} dökümünü aç`}
                onClick={() => setDialog({ kind: 'detail', teacher })}
              >
                Döküm
              </Button>
              {canTransfer(data, teacher) ? (
                <Button
                  size="sm"
                  disabled={transfer.isPending}
                  aria-busy={transfer.isPending || undefined}
                  aria-label={`${teacher.staffName} önerisini aktar`}
                  onClick={() => void quickTransfer(teacher)}
                >
                  Aktar
                </Button>
              ) : null}
              {canCorrect(data, teacher) ? (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`${teacher.staffName} saatini düzeltip aktar`}
                  onClick={() => setDialog({ kind: 'correct', teacher })}
                >
                  Düzelt ve aktar
                </Button>
              ) : null}
            </span>
          )
        },
      },
    ]
  }, [teachers, data, transfer, month])

  return (
    <section aria-labelledby="programdan-hesapla" className="grid gap-3 rounded-sm border p-4">
      <div className="grid gap-1">
        <h3 id="programdan-hesapla" className="text-base font-semibold">
          Programdan hesapla
        </h3>
        <p className="text-sm text-muted-foreground">
          {label} için ders programı, okul takvimi tatilleri, izinler ve yoklamadan önerilen ek ders
          saati. Haftada maaş karşılığını aşan ders ek derstir; öneri saklanmaz, aktarınca elle
          girilen ek ders saatine yazılır ve çizelge onayına girer.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <FormField
            id="ek-ders-maas-karsiligi"
            label="Maaş karşılığı haftalık ders saati"
            error={
              checked.errors.weeklyLoad === undefined
                ? undefined
                : { message: checked.errors.weeklyLoad }
            }
          >
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                value={values.weeklyLoad}
                onChange={(event) =>
                  setValues((current) => ({ ...current, weeklyLoad: event.target.value }))
                }
              />
            )}
          </FormField>
        </div>
        <div className="w-56">
          <FormField
            id="ek-ders-ust-sinir"
            label="Haftalık ders üst sınırı"
            error={
              checked.errors.weeklyCap === undefined
                ? undefined
                : { message: checked.errors.weeklyCap }
            }
          >
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                value={values.weeklyCap}
                onChange={(event) =>
                  setValues((current) => ({ ...current, weeklyCap: event.target.value }))
                }
              />
            )}
          </FormField>
        </div>
        <Button
          disabled={bulk === null || bulk.items.length === 0 || transfer.isPending}
          onClick={() => setDialog({ kind: 'bulk' })}
        >
          Tüm önerileri aktar
        </Button>
      </div>
      {query.error ? <QueryError error={query.error} onRetry={() => void query.refetch()} /> : null}
      {params !== null && !data && !query.error ? <SummaryLoading /> : null}
      {data ? (
        <>
          <SuggestionNotes data={data} />
          <DataTable
            listKey="ek-ders-onerisi"
            rows={rows}
            columns={columns}
            mobileColumns={MOBILE}
            pageSize={20}
            caption="Programdan önerilen ek ders saatleri"
            empty="Bu ay ders programında öğretmene bağlı ders yok."
            emptyFiltered="Bu aramayla eşleşen öğretmen yok."
          />
          {data.unlinked.length > 0 ? (
            <p role="note" className="text-sm text-muted-foreground">
              Personel hesabına bağlı olmayan öğretmen kayıtlarının dersi önerilmedi:{' '}
              {data.unlinked
                .map(
                  (item) =>
                    `${item.teacherName ?? item.teacherId} (${String(item.countedHours)} saat)`,
                )
                .join(', ')}
              . Öğretmen kaydını personel hesabına bağlayın.
            </p>
          ) : null}
        </>
      ) : null}
      {dialog?.kind === 'detail' && params !== null ? (
        <DetailModal month={month} teacher={dialog.teacher} params={params} onClose={close} />
      ) : null}
      {dialog?.kind === 'correct' && data ? (
        <CorrectModal month={month} data={data} teacher={dialog.teacher} onClose={close} />
      ) : null}
      {dialog?.kind === 'bulk' && data ? (
        <BulkModal month={month} data={data} onClose={close} />
      ) : null}
    </section>
  )
}

const defaultParams: LessonSuggestionParams = {
  weeklyLoad: Number(SUGGESTION_PARAM_DEFAULTS.weeklyLoad),
  weeklyCap: Number(SUGGESTION_PARAM_DEFAULTS.weeklyCap),
}

/** Ay bitmedi, yoklama okunamadı ve aktarım kapalı notları. */
function SuggestionNotes({ data }: { data: LessonHourSuggestions }) {
  const notice = transferNotice(data)
  return (
    <div className="grid gap-1 text-sm">
      {notice === null ? null : (
        <p role="note" className="text-warning">
          {notice}
        </p>
      )}
      {data.monthComplete ? null : (
        <p role="note" className="text-muted-foreground">
          Ay bitmedi; henüz yapılmamış dersler sayılmadı.
        </p>
      )}
      {data.attendanceKnown ? null : (
        <p role="note" className="text-muted-foreground">
          Akademik modül kapalı; yoklama denetlenmedi.
        </p>
      )}
      <p className="text-muted-foreground">
        {String(data.totals.teacherCount)} öğretmen · önerilen {String(data.totals.suggestedHours)}{' '}
        saat · elle girilen {String(data.totals.currentHours)} saat
      </p>
    </div>
  )
}

/** Gün gün döküm (K-550): ders, sınıf, sayıldı mı ve neden; haftalar ve aktarımlar. */
function DetailModal({
  month,
  teacher,
  params,
  onClose,
}: {
  month: string
  teacher: LessonHourSuggestionTeacher
  params: LessonSuggestionParams
  onClose: () => void
}) {
  const detail = useLessonHourSuggestionDetail(month, teacher.membershipId, params)
  const data = detail.data?.data
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`${teacher.staffName} · ${payrollMonthLabel(month)} dökümü`}
      description={
        teacher.suggestedHours === null
          ? 'Saat ya da ders saati ücretli; ek ders önerisi verilmez.'
          : `Önerilen ek ders ${String(teacher.suggestedHours)} saat.`
      }
    >
      {detail.error ? (
        <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
      ) : null}
      {!data && !detail.error ? <SummaryLoading /> : null}
      {data ? (
        <div className="grid gap-4 text-sm">
          {data.weeks.length > 0 ? (
            <section aria-label="Haftalar" className="grid gap-1">
              <h4 className="font-semibold">Haftalar</h4>
              <ul className="grid gap-1">
                {data.weeks.map((week) => (
                  <li key={week.startDate}>{weekText(week)}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <section aria-label="Günler" className="grid gap-3">
            {data.days.map((day) => (
              <div key={day.day} className="grid gap-1">
                <h4 className="font-semibold">{dayHeading(day.day)}</h4>
                <ul className="grid gap-1">
                  {day.items.map((item) => {
                    const text = lessonItemText(item)
                    return (
                      <li
                        key={item.lessonId}
                        className="grid gap-0.5 rounded-sm border px-3 py-2 [overflow-wrap:anywhere]"
                      >
                        <span>{text.main}</span>
                        <span className="text-muted-foreground">{text.status}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </section>
          {data.transfers.length > 0 ? (
            <section aria-label="Aktarımlar" className="grid gap-1">
              <h4 className="font-semibold">Aktarımlar</h4>
              <ul className="grid gap-1">
                {data.transfers.map((item) => (
                  <li key={item.id} className="[overflow-wrap:anywhere]">
                    Öneri {String(item.suggestedHours)} saat →{' '}
                    {item.previousHours === null
                      ? `${String(item.hours)} saat yazıldı`
                      : `${String(item.previousHours)} saatten ${String(item.hours)} saate`}
                    {item.reason === null ? '' : ` · ${item.reason}`}
                    {item.createdByName === null ? '' : ` · ${item.createdByName}`}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}

/** Düzeltilerek aktarım (K-552): öneriden farklı saat gerekçe ister. */
function CorrectModal({
  month,
  data,
  teacher,
  onClose,
}: {
  month: string
  data: LessonHourSuggestions
  teacher: LessonHourSuggestionTeacher
  onClose: () => void
}) {
  const transfer = useTransferLessonHourSuggestions()
  const form = useForm<TransferFormValues>({
    resolver: zodResolver(transferFormSchema(teacher.suggestedHours ?? 0)),
    defaultValues: transferDefaults(teacher),
  })
  const errors = form.formState.errors
  const busy = transfer.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await transfer.submit(
      { month, body: transferBody(data, teacher, values) },
      {
        setError: (name, error) => {
          if (name.endsWith('hours')) form.setError('hours', error, { shouldFocus: true })
          else if (name.endsWith('reason')) form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(`${teacher.staffName} için ek ders saati aktarıldı.`)
    onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Saati düzeltip aktar"
      description={`${teacher.staffName} · önerilen ${String(teacher.suggestedHours ?? 0)} saat · elle giriş ${teacher.currentHours === null ? 'yok' : `${String(teacher.currentHours)} saat`}. Öneriden farklı saat gerekçe ister.`}
    >
      <form
        noValidate
        aria-label="Ek ders saatini düzeltip aktar"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="ek-ders-aktar-saat" label="Aktarılacak saat" error={errors.hours}>
          {(control) => (
            <Input {...control} {...form.register('hours')} inputMode="numeric" disabled={busy} />
          )}
        </FormField>
        <FormField id="ek-ders-aktar-gerekce" label="Gerekçe" error={errors.reason}>
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            Aktar
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Toplu aktarım: aktarılabilen bütün öneriler tek işlemde. */
function BulkModal({
  month,
  data,
  onClose,
}: {
  month: string
  data: LessonHourSuggestions
  onClose: () => void
}) {
  const transfer = useTransferLessonHourSuggestions()
  const [error, setError] = useState<string | undefined>(undefined)
  const body = bulkTransferBody(data)
  const total = body.items.reduce((sum, item) => sum + item.hours, 0)
  async function confirm() {
    setError(undefined)
    const outcome = await transfer.submit(
      { month, body },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success(`${String(body.items.length)} öğretmenin önerisi aktarıldı.`)
      onClose()
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Tüm önerileri aktar"
      description="Önerisi elle girişten farklı öğretmenlerin ek ders saati öneriyle değiştirilir; teyit alınmışsa yeniden istenir."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={transfer.isPending}>
            Vazgeç
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={transfer.isPending || body.items.length === 0}
            aria-busy={transfer.isPending || undefined}
          >
            Aktar
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-sm">
        <p>
          {String(body.items.length)} öğretmen · toplam {String(total)} saat.
        </p>
        <RootError message={error} />
      </div>
    </Modal>
  )
}
