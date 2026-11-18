import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { usePayRateStaff } from '@kampus/react-shared/use-finance-pay-rates.ts'
import {
  useArchivePayrollLessonHours,
  useCreatePayrollLessonHours,
  usePayrollExportFile,
  usePayrollExportHistory,
  usePayrollPreview,
  useUpdatePayrollLessonHours,
  type PayrollLine,
} from '@kampus/react-shared/use-finance-payroll-exports.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import {
  LESSON_PAY_TYPE_LABELS,
  LESSON_PAY_TYPES,
} from '@kampus/school-core/lib/finance-pay-rates.ts'
import { payrollItemLabel } from '@kampus/school-core/lib/finance-payroll-exports.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { saveBlob } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { FinancePayrollExportProfileModal } from './FinancePayrollExportProfileModal.tsx'
import {
  isPayrollMonth,
  lessonHoursBody,
  lessonHoursDefaults,
  lessonHoursEditSchema,
  lessonHoursFormField,
  lessonHoursFormSchema,
  payrollFileName,
  payrollRow,
  type LessonHoursEditValues,
  type LessonHoursFormValues,
  type PayrollRow,
} from './finance-payroll-export-forms.ts'

const BOM = '\uFEFF'
const MOBILE = ['staff', 'item', 'total']

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; line: PayrollLine }
  | { kind: 'delete'; line: PayrollLine }
  | { kind: 'profile' }
  | null

/**
 * Bordro aktarımı (DOM-FIN-105; ON-202, ON-343): Finans "Bordro aktarımı" sekmesi, yalnız yönetici
 * (K-338). Kampüs bordro hesaplamaz: ay seçilir, o ayın girdi satırları (ücret tanımları, elle
 * girilen ek ders saatleri, avans/icra/BES kesintileri ve aya aktarılan düzeltmeler) önizlenir, CSV
 * indirilir. Önizleme tutar içerir ve her açılışı denetime düşer; dosya taze oturum ister ve her
 * üretim özet satırı yazar. Dosya üretimi dönem kilidine bağlı değildir.
 */
export function FinancePayrollExportSection() {
  const today = dayKey()
  const [month, setMonth] = useState(today.slice(0, 7))
  const valid = isPayrollMonth(month)
  const preview = usePayrollPreview(month, valid)
  const exporter = usePayrollExportFile()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [reauth, setReauth] = useState(false)
  const data = valid ? preview.data?.data : undefined
  const lines = useMemo(() => new Map(data?.lines.map((line) => [line.key, line])), [data])
  const rows = useMemo(() => data?.lines.map(payrollRow) ?? [], [data])
  const close = () => setDialog(null)

  const columns = useMemo<DataColumn<PayrollRow>[]>(
    () => [
      { key: 'staff', label: 'Personel' },
      { key: 'item', label: 'Kalem' },
      { key: 'direction', label: 'Yön' },
      { key: 'period', label: 'Ay içindeki dönem' },
      { key: 'rate', label: 'Birim ücret ya da oran' },
      { key: 'quantity', label: 'Saat' },
      { key: 'total', label: 'Tutar' },
      { key: 'warnings', label: 'Uyarı' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: PayrollRow) => {
          const line = lines.get(row.id)
          if (line === undefined || row.lessonHoursId === null) return null
          return (
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.staff} ${row.item} saatini düzelt`}
                onClick={() => setDialog({ kind: 'edit', line })}
              >
                Düzelt
              </Button>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.staff} ${row.item} saatini sil`}
                onClick={() => setDialog({ kind: 'delete', line })}
              >
                Sil
              </Button>
            </span>
          )
        },
      },
    ],
    [lines],
  )

  async function download() {
    const outcome = await exporter.submit({ month })
    if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }), payrollFileName(month))
    notify.success('Bordro girdi dosyası indirildi.')
  }

  const busy = exporter.isPending
  return (
    <section
      aria-labelledby="bordro-aktarimi"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-1 px-6 pt-6 pb-2">
        <h2 id="bordro-aktarimi" className="text-lg font-semibold">
          Bordro aktarımı
        </h2>
        <p className="text-sm text-muted-foreground">
          Kampüs bordro hesaplamaz; seçilen ayın ücret, ek ders, kesinti ve düzeltme girdilerini
          bordro programınıza aktarılacak dosya olarak verir. Ay içinde başlayan ya da biten ücretin
          tutarı bordroda gün oranıyla, icra ve BES kesintisi net ücret ya da matrah üzerinden
          oranla hesaplanır. Önizleme ücret içerdiği için her görüntüleme denetim kaydına yazılır.
        </p>
      </header>
      <div className="grid gap-5 px-6 pb-6 max-[650px]:px-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <FormField
              id="bordro-ay"
              label="Bordro ayı"
              error={valid ? undefined : { message: 'Ayı seçin.' }}
            >
              {(control) => (
                <Input
                  {...control}
                  type="month"
                  value={month}
                  max={today.slice(0, 7)}
                  onChange={(event) => setMonth(event.target.value)}
                />
              )}
            </FormField>
          </div>
          <Button
            disabled={!valid || busy || !data}
            aria-busy={busy || undefined}
            onClick={() => void download()}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            CSV indir
          </Button>
          <Button
            variant="secondary"
            disabled={!valid}
            onClick={() => setDialog({ kind: 'create' })}
          >
            <Icon name="Plus" size={17} aria-hidden="true" />
            Ek ders saati ekle
          </Button>
          <Button variant="outline" onClick={() => setDialog({ kind: 'profile' })}>
            <Icon name="Settings" size={17} aria-hidden="true" />
            Dosya sütunları
          </Button>
        </div>
        {preview.error ? (
          <QueryError error={preview.error} onRetry={() => void preview.refetch()} />
        ) : null}
        {valid && !data && !preview.error ? <SummaryLoading /> : null}
        {data ? (
          <>
            <StatGrid
              label="Ayın bordro girdi toplamları"
              items={[
                {
                  label: 'Personel',
                  value: String(data.totals.staffCount),
                  note: `${String(data.totals.lineCount)} kalem satırı`,
                },
                {
                  label: 'Tutarı belli kazanç',
                  value: money(data.totals.earningCents),
                  note: 'Tam ay ücret, yan hak, ek ders ve ek ödeme farkı',
                },
                {
                  label: 'Tutarı belli kesinti',
                  value: money(data.totals.deductionCents),
                  note: 'Avans taksiti ve geri alınacak fark',
                },
                {
                  label: 'Bordroda hesaplanacak',
                  value: String(data.totals.missingTotalCount),
                  note: 'Kısmi ay, saat ücreti, tanımsız ek ders, icra ve BES',
                },
              ]}
            />
            <DataTable
              listKey="bordro-aktarim"
              rows={rows}
              columns={columns}
              mobileColumns={MOBILE}
              pageSize={20}
              caption="Bordro girdi satırları"
              empty="Bu ay ücret tanımı, ek ders saati, kesinti ya da düzeltme yok."
              emptyFiltered="Bu aramayla eşleşen satır yok."
            />
          </>
        ) : null}
        <ExportHistory month={valid ? month : undefined} />
      </div>
      <Modal
        open={dialog?.kind === 'create'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="Ek ders saati ekle"
        description={`${month} ayının toplam saati. Tutar ek ders ücreti tanımından hesaplanır.`}
      >
        {dialog?.kind === 'create' ? <CreateHoursForm month={month} onDone={close} /> : null}
      </Modal>
      <Modal
        open={dialog?.kind === 'edit'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="Ek ders saatini düzelt"
      >
        {dialog?.kind === 'edit' ? <EditHoursForm line={dialog.line} onDone={close} /> : null}
      </Modal>
      <Modal
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="Ek ders saatini sil"
      >
        {dialog?.kind === 'delete' ? <DeleteHours line={dialog.line} onDone={close} /> : null}
      </Modal>
      {dialog?.kind === 'profile' ? <FinancePayrollExportProfileModal onClose={close} /> : null}
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

/** Üretim geçmişi (K-338): her dosyanın özeti; ücret satırı yok. */
function ExportHistory({ month }: { month: string | undefined }) {
  const history = usePayrollExportHistory({
    page: 1,
    pageSize: 10,
    ...(month === undefined ? {} : { month }),
  })
  const items = history.data?.data ?? []
  return (
    <section aria-labelledby="bordro-gecmis" className="grid gap-2">
      <h3 id="bordro-gecmis" className="text-base font-semibold">
        Bu ayın üretilen dosyaları
      </h3>
      {history.error ? (
        <QueryError error={history.error} onRetry={() => void history.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu ay için henüz dosya üretilmedi.</p>
      ) : (
        <ul aria-label="Üretilen dosyalar" className="grid gap-2 text-sm">
          {items.map((item) => (
            <li key={item.id} className="grid gap-1 rounded-sm border px-3 py-2">
              <span className="font-medium">
                {dateLabel(item.createdAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {item.createdByName ? ` · ${item.createdByName}` : ''}
              </span>
              <span>
                {String(item.lineCount)} satır · {String(item.staffCount)} personel ·{' '}
                {money(item.earningCents)} ·{' '}
                {item.deductionCents > 0 ? `kesinti ${money(item.deductionCents)} · ` : ''}
                {item.format === 'profile' ? 'kurum şablonu' : 'genel dosya'}
              </span>
              <span className="text-muted-foreground [overflow-wrap:anywhere]">
                SHA-256: <code>{item.contentSha256}</code>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Yeni ek ders saati (K-337): personel, tür, saat, not. */
function CreateHoursForm({ month, onDone }: { month: string; onDone: () => void }) {
  const create = useCreatePayrollLessonHours()
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search).trim()
  const staff = usePayRateStaff({ page: 1, pageSize: 100, ...(q.length >= 2 ? { q } : {}) })
  const form = useForm<LessonHoursFormValues>({
    resolver: zodResolver(lessonHoursFormSchema),
    defaultValues: lessonHoursDefaults(),
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(lessonHoursBody(month, values), {
      setError: (name, error) => {
        const field = lessonHoursFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success('Ek ders saati kaydedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Ek ders saati"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="bordro-personel-ara" label="Personel ara">
        {(control) => (
          <Input
            {...control}
            value={search}
            autoComplete="off"
            onChange={(event) => setSearch(event.target.value)}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="bordro-personel" label="Personel" error={errors.membershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('membershipId')}
            className="w-full"
            disabled={busy || staff.isPending}
          >
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            {staff.data?.data.map((person) => (
              <NativeSelectOption key={person.membershipId} value={person.membershipId}>
                {person.active ? person.name : `${person.name} (pasif)`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="bordro-tur" label="Tür" error={errors.lessonType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('lessonType')}
            className="w-full"
            disabled={busy}
          >
            {LESSON_PAY_TYPES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {LESSON_PAY_TYPE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="bordro-saat" label="Ayın toplam saati" error={errors.hours}>
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            {...form.register('hours')}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="bordro-not" label="Not (isteğe bağlı)" error={errors.note}>
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

function EditHoursForm({ line, onDone }: { line: PayrollLine; onDone: () => void }) {
  const update = useUpdatePayrollLessonHours()
  const form = useForm<LessonHoursEditValues>({
    resolver: zodResolver(lessonHoursEditSchema),
    defaultValues: { hours: String(line.quantity ?? ''), note: line.note ?? '' },
  })
  const errors = form.formState.errors
  const busy = update.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    if (line.lessonHoursId === null || line.lessonHoursVersion === null) return
    const note = values.note.trim()
    const outcome = await update.submit(
      {
        entryId: line.lessonHoursId,
        version: line.lessonHoursVersion,
        hours: Number(values.hours.trim()),
        note: note === '' ? null : note,
      },
      {
        setError: (name, error) => {
          if (name === 'hours' || name === 'note') form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Ek ders saati düzeltildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Ek ders saati düzeltmesi"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm">
        {line.staffName} · {payrollItemLabel(line)}
      </p>
      <FormField id="bordro-saat-duzelt" label="Ayın toplam saati" error={errors.hours}>
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            {...form.register('hours')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="bordro-not-duzelt" label="Not (isteğe bağlı)" error={errors.note}>
        {(control) => <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

function DeleteHours({ line, onDone }: { line: PayrollLine; onDone: () => void }) {
  const archive = useArchivePayrollLessonHours()
  const busy = archive.isPending
  async function remove() {
    if (line.lessonHoursId === null || line.lessonHoursVersion === null) return
    const outcome = await archive.submit({
      entryId: line.lessonHoursId,
      version: line.lessonHoursVersion,
    })
    if (outcome.status !== 'success') return
    notify.success('Ek ders saati silindi.')
    onDone()
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        {line.staffName} için {String(line.quantity ?? 0)} saatlik kayıt silinecek; dosyaya girmez.
      </p>
      <div>
        <Button
          variant="destructive"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void remove()}
        >
          Sil
        </Button>
      </div>
    </div>
  )
}
