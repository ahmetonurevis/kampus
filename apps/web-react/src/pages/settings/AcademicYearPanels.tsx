import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch, type UseFormRegisterReturn } from 'react-hook-form'
import {
  useAddAcademicTerm,
  useCreateAcademicYear,
  useUpdateAcademicTerm,
  useUpdateAcademicYear,
} from '@kampus/react-shared/use-academic-years.ts'
import {
  ACADEMIC_YEAR_MAX,
  ACADEMIC_YEAR_MIN,
  defaultAcademicYearDates,
} from '@kampus/school-core/lib/academic-years.ts'
import { FormField } from '@/components/FormField.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify.ts'
import {
  ConflictNotice,
  errorRoutes,
  FormActions,
  isVersionConflict,
  type Reloaded,
  RootError,
  useEditConflict,
  useFocusAfterSubmit,
} from '../management/FormParts.tsx'
import {
  createDefaults,
  dayHint,
  rangeLabel,
  termDefaults,
  termSchema,
  TERM_ERROR_FIELDS,
  TERM_LIMIT_NOTICE,
  todayKey,
  updateDefaults,
  yearCreateSchema,
  YEAR_ERROR_FIELDS,
  yearUpdateSchema,
  type PanelTarget,
  type TermFormOutput,
  type TermFormValues,
  type TermRow,
  type YearCreateOutput,
  type YearCreateValues,
  type YearRow,
  type YearUpdateOutput,
  type YearUpdateValues,
} from './academic-year-rows.ts'

const YEAR_ROUTES = errorRoutes(YEAR_ERROR_FIELDS)
const TERM_ROUTES = errorRoutes(TERM_ERROR_FIELDS)

type PanelProps = {
  target: PanelTarget | null
  rows: readonly YearRow[] | undefined
  /** Listeyi yeniden okur; çakışmadan sonra "Güncel kaydı yükle" bunu kullanır. */
  reload: () => Promise<readonly YearRow[] | undefined>
  onClose: () => void
}

const TITLES = {
  'year-new': 'Eğitim yılı oluştur',
  'year-edit': 'Eğitim yılını düzenle',
  'term-new': 'Dönem ekle',
  'term-edit': 'Dönemi düzenle',
} as const

/**
 * Eğitim yılı ve dönem formları (kısa formlar sağ panelde; opak yüzey). Her form `If-Match` olarak
 * açıldığı andaki yıl sürümünü gönderir; başka yönetici değiştirdiyse güncel kayıt yüklenmeden
 * gönderim yapılmaz. Gün alanları `YYYY-MM-DD` gönderir; altlarında Europe/Istanbul gösterimi
 * ("1 Eylül 2027 Çarşamba") görünür.
 */
export function AcademicYearPanel({ target, rows, reload, onClose }: PanelProps) {
  return (
    <SidePanel
      open={target !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={target ? TITLES[target.kind] : ''}
    >
      {target?.kind === 'year-new' ? (
        // Varsayılan başlangıç yılı mevcut yıllara bağlıdır: liste gelmeden form açılmaz.
        rows ? (
          <YearCreateForm rows={rows} onClose={onClose} />
        ) : (
          <Status>Yükleniyor…</Status>
        )
      ) : target ? (
        <ExistingTarget target={target} rows={rows} reload={reload} onClose={onClose} />
      ) : null}
    </SidePanel>
  )
}

function Status({ children }: { children: string }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {children}
    </p>
  )
}

function ExistingTarget({
  target,
  rows,
  reload,
  onClose,
}: {
  target: Exclude<PanelTarget, { kind: 'year-new' }>
  rows: readonly YearRow[] | undefined
  reload: PanelProps['reload']
  onClose: () => void
}) {
  if (!rows) return <Status>Yükleniyor…</Status>
  const year = rows.find((row) => row.startYear === target.startYear)
  if (!year) return <Status>Eğitim yılı bulunamadı. Kapatıp listeyi yenileyin.</Status>
  if (!year.canEdit) return <Status>Kapanmış eğitim yılı değiştirilemez.</Status>
  if (year.version === null) return <Status>Eğitim yılı yüklenemedi. Sayfayı yenileyin.</Status>
  const fresh = async () => (await reload())?.find((row) => row.startYear === target.startYear)
  if (target.kind === 'year-edit')
    return <YearEditForm year={year} version={year.version} fresh={fresh} onClose={onClose} />
  const term = target.kind === 'term-edit' ? year.terms.find((t) => t.id === target.termId) : null
  if (target.kind === 'term-edit' && !term) return <Status>Dönem bulunamadı.</Status>
  return (
    <TermForm
      year={year}
      term={term ?? undefined}
      version={year.version}
      fresh={fresh}
      onClose={onClose}
    />
  )
}

/** Gün alanı: tarih seçici ve altında Europe/Istanbul gösterimi. */
function DayField({
  id,
  label,
  value,
  error,
  input,
  disabled,
}: {
  id: string
  label: string
  value: string | undefined
  error: { message?: string } | undefined
  input: UseFormRegisterReturn
  disabled: boolean
}) {
  const hint = dayHint(value)
  return (
    <FormField id={id} label={label} error={error} {...(hint ? { description: hint } : {})}>
      {(control) => <Input {...control} {...input} type="date" disabled={disabled} />}
    </FormField>
  )
}

function YearCreateForm({ rows, onClose }: { rows: readonly YearRow[]; onClose: () => void }) {
  const create = useCreateAcademicYear()
  const form = useForm<YearCreateValues, unknown, YearCreateOutput>({
    resolver: zodResolver(yearCreateSchema),
    defaultValues: createDefaults(rows, todayKey()),
  })
  const busy = create.isPending || form.formState.isSubmitting
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)
  const errors = form.formState.errors
  const startDate = useWatch({ control: form.control, name: 'startDate' })
  const endDate = useWatch({ control: form.control, name: 'endDate' })

  // Başlangıç yılı değişince, günlere elle dokunulmadıysa varsayılan aralık (1 Eylül – 31 Ağustos).
  const startYear = form.register('startYear', {
    valueAsNumber: true,
    onChange: (event: { target: { valueAsNumber: number } }) => {
      const year = event.target.valueAsNumber
      if (!Number.isInteger(year) || year < ACADEMIC_YEAR_MIN || year > ACADEMIC_YEAR_MAX) return
      const dates = defaultAcademicYearDates(year)
      const dirty = form.formState.dirtyFields
      if (!dirty.startDate) form.setValue('startDate', dates.startDate)
      if (!dirty.endDate) form.setValue('endDate', dates.endDate)
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    const body = {
      startYear: values.startYear,
      ...(values.startDate ? { startDate: values.startDate } : {}),
      ...(values.endDate ? { endDate: values.endDate } : {}),
    }
    const outcome = await create.submit(body, {
      setError: form.setError,
      ...YEAR_ROUTES,
    })
    if (outcome.status === 'success') {
      notify.success(
        `${outcome.data.data.name} eğitim yılı oluşturuldu. Dönemleri ekleyebilirsiniz.`,
      )
      onClose()
    } else if (outcome.status === 'failed') {
      focusAfterSubmit(YEAR_ROUTES.fieldFor(outcome.error))
    }
  })

  return (
    <form
      noValidate
      aria-label="Eğitim yılı oluştur"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <p className="text-sm text-muted-foreground">
        Yıl &quot;Planlandı&quot; durumunda açılır; dönemleri ekledikten sonra etkinleştirirsiniz.
      </p>
      <FormField
        id="yil-baslangic-yili"
        label="Başlangıç yılı"
        error={errors.startYear}
        description="Ör. 2027 → 2027–2028 eğitim yılı."
      >
        {(control) => (
          <Input
            {...control}
            {...startYear}
            type="number"
            inputMode="numeric"
            min={ACADEMIC_YEAR_MIN}
            max={ACADEMIC_YEAR_MAX}
            disabled={busy}
          />
        )}
      </FormField>
      <DayField
        id="yil-baslangic-gunu"
        label="Başlangıç günü"
        value={startDate}
        error={errors.startDate}
        input={form.register('startDate')}
        disabled={busy}
      />
      <DayField
        id="yil-bitis-gunu"
        label="Bitiş günü"
        value={endDate}
        error={errors.endDate}
        input={form.register('endDate')}
        disabled={busy}
      />
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onClose} submitLabel="Yılı oluştur" />
    </form>
  )
}

type EditProps<TRow> = {
  version: number
  fresh: () => Promise<TRow | undefined>
  onClose: () => void
}

function YearEditForm({ year, version, fresh, onClose }: EditProps<YearRow> & { year: YearRow }) {
  const update = useUpdateAcademicYear()
  const form = useForm<YearUpdateValues, unknown, YearUpdateOutput>({
    resolver: zodResolver(yearUpdateSchema),
    defaultValues: updateDefaults(year),
  })
  const conflict = useEditConflict<YearUpdateValues>({
    initialVersion: version,
    reload: async (): Promise<Reloaded<YearUpdateValues>> => {
      const row = await fresh()
      return row && row.version !== null
        ? { version: row.version, values: updateDefaults(row) }
        : null
    },
    apply: (values) => form.reset(values),
  })
  const busy = update.isPending || form.formState.isSubmitting
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)
  const errors = form.formState.errors
  const startDate = useWatch({ control: form.control, name: 'startDate' })
  const endDate = useWatch({ control: form.control, name: 'endDate' })

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await update.submit(
      { startYear: year.startYear, version: conflict.version, body: values },
      { setError: form.setError, ...YEAR_ROUTES },
    )
    if (outcome.status === 'success') {
      notify.success(`${year.name} eğitim yılı güncellendi.`)
      onClose()
    } else if (outcome.status === 'failed') {
      if (isVersionConflict(outcome.error)) conflict.markConflict()
      focusAfterSubmit(YEAR_ROUTES.fieldFor(outcome.error))
    }
  })

  return (
    <form
      noValidate
      aria-label="Eğitim yılını düzenle"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      {conflict.conflicted ? (
        <ConflictNotice
          onReload={() => void conflict.reloadRecord()}
          reloading={conflict.reloading}
        />
      ) : null}
      <p className="text-sm text-muted-foreground">
        {year.name} eğitim yılının tarihleri. Var olan dönemler yeni aralığın içinde kalmalıdır.
      </p>
      <DayField
        id="yil-baslangic-gunu"
        label="Başlangıç günü"
        value={startDate}
        error={errors.startDate}
        input={form.register('startDate')}
        disabled={busy}
      />
      <DayField
        id="yil-bitis-gunu"
        label="Bitiş günü"
        value={endDate}
        error={errors.endDate}
        input={form.register('endDate')}
        disabled={busy}
      />
      <RootError message={errors.root?.server?.message ?? errors.root?.message} />
      <FormActions busy={busy} disabled={conflict.conflicted} onCancel={onClose} />
    </form>
  )
}

function TermForm({
  year,
  term,
  version,
  fresh,
  onClose,
}: EditProps<YearRow> & { year: YearRow; term: TermRow | undefined }) {
  const add = useAddAcademicTerm()
  const edit = useUpdateAcademicTerm()
  const form = useForm<TermFormValues, unknown, TermFormOutput>({
    resolver: zodResolver(termSchema),
    defaultValues: termDefaults(year, term),
  })
  const conflict = useEditConflict<TermFormValues>({
    initialVersion: version,
    reload: async (): Promise<Reloaded<TermFormValues>> => {
      const row = await fresh()
      if (!row || row.version === null) return null
      const current = term ? row.terms.find((item) => item.id === term.id) : undefined
      if (term && !current) return null
      return { version: row.version, values: termDefaults(row, current) }
    },
    apply: (values) => form.reset(values),
  })
  const busy = add.isPending || edit.isPending || form.formState.isSubmitting
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)
  const errors = form.formState.errors
  const startDate = useWatch({ control: form.control, name: 'startDate' })
  const endDate = useWatch({ control: form.control, name: 'endDate' })

  const onSubmit = form.handleSubmit(async (values) => {
    const options = { setError: form.setError, ...TERM_ROUTES }
    const outcome = term
      ? await edit.submit(
          { startYear: year.startYear, termId: term.id, version: conflict.version, body: values },
          options,
        )
      : await add.submit(
          { startYear: year.startYear, version: conflict.version, body: values },
          options,
        )
    if (outcome.status === 'success') {
      notify.success(term ? `Dönem güncellendi: ${values.name}.` : `Dönem eklendi: ${values.name}.`)
      onClose()
    } else if (outcome.status === 'failed') {
      if (isVersionConflict(outcome.error)) conflict.markConflict()
      focusAfterSubmit(TERM_ROUTES.fieldFor(outcome.error))
    }
  })

  return (
    <form
      noValidate
      aria-label={term ? 'Dönemi düzenle' : 'Dönem ekle'}
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      {conflict.conflicted ? (
        <ConflictNotice
          onReload={() => void conflict.reloadRecord()}
          reloading={conflict.reloading}
        />
      ) : null}
      <p className="text-sm text-muted-foreground">
        {`${year.name} eğitim yılı (${rangeLabel(year.startDate, year.endDate)}). Dönem yılın içinde kalır, diğer dönemlerle çakışmaz ve adı yılda tekildir. ${TERM_LIMIT_NOTICE}`}
      </p>
      <FormField id="donem-ad" label="Dönem adı" error={errors.name}>
        {(control) => (
          <Input
            {...control}
            {...form.register('name')}
            maxLength={100}
            placeholder="Örn. 1. Dönem"
            disabled={busy}
          />
        )}
      </FormField>
      <DayField
        id="donem-baslangic-gunu"
        label="Başlangıç günü"
        value={startDate}
        error={errors.startDate}
        input={form.register('startDate')}
        disabled={busy}
      />
      <DayField
        id="donem-bitis-gunu"
        label="Bitiş günü"
        value={endDate}
        error={errors.endDate}
        input={form.register('endDate')}
        disabled={busy}
      />
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} disabled={conflict.conflicted} onCancel={onClose} />
    </form>
  )
}
