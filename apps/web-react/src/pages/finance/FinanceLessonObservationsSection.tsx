import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import {
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type UseFormRegister,
} from 'react-hook-form'
import { usePerformancePeriods } from '@kampus/react-shared/use-finance-performance.ts'
import { useCertificateStaff } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  useArchiveLessonObservation,
  useArchiveLessonObservationTemplate,
  useCompleteLessonObservation,
  useCreateLessonObservation,
  useCreateLessonObservationTemplate,
  useCreateLessonObservationTemplateVersion,
  useLessonObservation,
  useLessonObservations,
  useLessonObservationTemplates,
  useUpdateLessonObservation,
  useUpdateLessonObservationTemplate,
  type LessonObservation,
  type LessonObservationDetail,
  type LessonObservationTemplate,
} from '@kampus/react-shared/use-finance-lesson-observations.ts'
import {
  LESSON_OBSERVATION_STATUS_LABELS,
  LESSON_OBSERVATION_STATUSES,
  OBSERVATION_CRITERIA_MAX,
  OBSERVATION_LEVEL_LABELS,
  OBSERVATION_LEVELS,
  type LessonObservationStatus,
} from '@kampus/school-core/lib/finance-lesson-observations.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import type { z } from 'zod'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { ObservationDebriefPanel } from './FinanceObservationDebriefPanel.tsx'
import { FinanceObservationPlansPanel } from './FinanceObservationPlansPanel.tsx'
import {
  defaultTemplateFormValues,
  emptyCriterion,
  emptyObservationCreate,
  levelLabel,
  needsNote,
  observationCreateBody,
  observationCreateFormSchema,
  observationEditFormSchema,
  observationEditValues,
  observationUpdateBody,
  previewScore,
  scoreText,
  templateFormSchema,
  templateFormValues,
  type ObservationCreateValues,
  type ObservationEditValues,
} from './finance-lesson-observation-forms.ts'

const NO_SORT: readonly string[] = []
const TEMPLATE_MOBILE = ['name', 'usage']
const OBSERVATION_MOBILE = ['teacherName', 'score']
const OPTIONS_PAGE = { page: 1, pageSize: 100 } as const
const FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: LESSON_OBSERVATION_STATUSES.map((value) => ({
      value,
      label: LESSON_OBSERVATION_STATUS_LABELS[value],
    })),
  },
]
const isStatus = (value: unknown): value is LessonObservationStatus =>
  (LESSON_OBSERVATION_STATUSES as readonly unknown[]).includes(value)
const day = (value: string) => dateLabel(`${value}T09:00:00.000Z`, { year: 'numeric' })

type TemplateRow = {
  id: string
  name: string
  versionText: string
  usage: string
  template: LessonObservationTemplate
}
type ObservationRow = {
  id: string
  teacherName: string
  observedDate: string
  lesson: string
  observerName: string
  score: string
  observation: LessonObservation
}
type TemplateMode =
  { kind: 'create' } | { kind: 'edit' | 'version'; template: LessonObservationTemplate }
type SectionView = 'observations' | 'plan'
const SECTION_VIEWS = [
  { value: 'observations', label: 'Gözlemler' },
  { value: 'plan', label: 'Plan' },
] as const satisfies readonly { value: SectionView; label: string }[]

/**
 * Ders gözlemleri (DOM-FIN-130; ON-206): Finans "Ders gözlemleri" sekmesi, yalnız yönetici
 * (K-447). Üstte gözlem formları (sürüm, kullanım; kullanılmamış sürüm düzeltilir, kullanılmışa
 * yeni sürüm açılır; K-445), altta gözlemler (öğretmen, gün, sınıf/ders, gözlemci, durum, puan).
 * Gözlem penceresi taslakta ölçüt seviyesi ve notunu yazar, tamamlar (K-446); tamamlanan gözlem
 * salt okunur. Puanı sunucu rubrik kuralıyla hesaplar; formdaki puan önizlemedir. "Plan"
 * görünümü gözlem planıdır (DOM-FIN-139; ON-207): plandan başlatılan gözlem aynı pencerede açılır.
 */
export function FinanceLessonObservationsSection() {
  const [opened, setOpened] = useState<string | null>(null)
  const [view, setView] = useState<SectionView>('observations')
  return (
    <div className="grid gap-6">
      <LineTabs
        label="Ders gözlemleri görünümü"
        value={view}
        options={SECTION_VIEWS}
        onChange={setView}
      />
      {view === 'plan' ? (
        <FinanceObservationPlansPanel onOpenObservation={setOpened} />
      ) : (
        <>
          <TemplatesPanel />
          <ObservationsPanel onOpen={setOpened} />
        </>
      )}
      <Modal
        open={opened !== null}
        onOpenChange={(open) => (open ? undefined : setOpened(null))}
        title="Ders gözlemi"
        size="wide"
      >
        {opened === null ? null : (
          <ObservationEditor observationId={opened} onDone={() => setOpened(null)} />
        )}
      </Modal>
    </div>
  )
}

function ObservationsPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('ders-gozlem', { urlPrefix: 'dg_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = list.state.filters.status
  const observations = useLessonObservations({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
  })
  const [creating, setCreating] = useState(false)
  const [archiving, setArchiving] = useState<LessonObservation | null>(null)
  const rows = useMemo(
    () =>
      observations.data?.data.map((observation): ObservationRow => ({
        id: observation.id,
        teacherName: observation.teacherName,
        observedDate: day(observation.observedDate),
        lesson:
          [observation.className, observation.subjectName]
            .filter((part) => part !== null)
            .join(' · ') || '—',
        observerName: observation.observerName,
        score: scoreText(observation.score, observation.ratedCount, observation.criterionCount),
        observation,
      })),
    [observations.data],
  )
  const columns = useMemo<DataColumn<ObservationRow>[]>(
    () => [
      { key: 'teacherName', label: 'Öğretmen' },
      { key: 'observedDate', label: 'Gün' },
      { key: 'lesson', label: 'Sınıf / ders' },
      { key: 'observerName', label: 'Gözlemci' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={LESSON_OBSERVATION_STATUS_LABELS[row.observation.status]}
            tone={row.observation.status === 'completed' ? 'green' : 'gray'}
          />
        ),
      },
      { key: 'score', label: 'Puan' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => {
          const draft = row.observation.status === 'draft'
          return (
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                aria-label={`${row.teacherName} ${row.observedDate} gözlemini ${draft ? 'düzenle' : 'görüntüle'}`}
                onClick={() => onOpen(row.id)}
              >
                {draft ? 'Düzenle' : 'Görüntüle'}
              </Button>
              {draft ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`${row.teacherName} ${row.observedDate} taslağını arşivle`}
                  onClick={() => setArchiving(row.observation)}
                >
                  Arşivle
                </Button>
              ) : null}
            </span>
          )
        },
      },
    ],
    [onOpen],
  )
  return (
    <section
      aria-labelledby="ders-gozlemleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="ders-gozlemleri" className="text-lg font-semibold">
            Ders gözlemleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Gözlem taslak açılır, ölçüt seviyeleri yazılır ve tamamlanır; tamamlanan gözlem
            değiştirilemez. Puanı sunucu rubrik kuralıyla hesaplar. Gözlemlerin açılışı denetim
            kaydına yazılır.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Yeni gözlem</Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={observations.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={OBSERVATION_MOBILE}
        caption="Ders gözlemleri"
        empty="Henüz ders gözlemi yok."
        emptyFiltered="Bu seçimle eşleşen gözlem yok."
        loading={observations.isPending}
        fetching={observations.isFetching && !observations.isPending}
        error={
          observations.error ? (
            <QueryError error={observations.error} onRetry={() => void observations.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Yeni ders gözlemi"
        description="Gözlem taslak açılır; ölçüt seviyelerini açılan pencerede yazarsınız."
      >
        {creating ? (
          <ObservationCreateForm
            onDone={(id) => {
              setCreating(false)
              if (id !== null) onOpen(id)
            }}
          />
        ) : null}
      </Modal>
      <Modal
        open={archiving !== null}
        onOpenChange={(open) => (open ? undefined : setArchiving(null))}
        title="Gözlem taslağını arşivle"
      >
        {archiving ? (
          <ArchiveObservation observation={archiving} onDone={() => setArchiving(null)} />
        ) : null}
      </Modal>
    </section>
  )
}

function TemplatesPanel() {
  const list = useListState('gozlem-formu', { urlPrefix: 'gf_' })
  const search = useDebouncedValue(list.state.query).trim()
  const templates = useLessonObservationTemplates({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const [mode, setMode] = useState<TemplateMode | null>(null)
  const [archiving, setArchiving] = useState<LessonObservationTemplate | null>(null)
  const rows = useMemo(
    () =>
      templates.data?.data.map((template): TemplateRow => ({
        id: template.id,
        name: template.name,
        versionText: `Sürüm ${String(template.versionNumber)} · ${String(template.criteria.length)} ölçüt`,
        usage: template.used ? `${String(template.observationCount)} gözlemde` : 'Kullanılmadı',
        template,
      })),
    [templates.data],
  )
  const columns = useMemo<DataColumn<TemplateRow>[]>(
    () => [
      { key: 'name', label: 'Form' },
      { key: 'versionText', label: 'Sürüm' },
      { key: 'usage', label: 'Kullanım' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            {row.template.used ? (
              <Button
                size="sm"
                variant="outline"
                aria-label={`${row.name} için yeni sürüm aç`}
                onClick={() => setMode({ kind: 'version', template: row.template })}
              >
                Yeni sürüm
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                aria-label={`${row.name} formunu düzenle`}
                onClick={() => setMode({ kind: 'edit', template: row.template })}
              >
                Düzenle
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              aria-label={`${row.name} formunu arşivle`}
              onClick={() => setArchiving(row.template)}
            >
              Arşivle
            </Button>
          </span>
        ),
      },
    ],
    [],
  )
  const title =
    mode === null || mode.kind === 'create'
      ? 'Yeni gözlem formu'
      : mode.kind === 'edit'
        ? `${mode.template.name} · düzenle`
        : `${mode.template.name} · yeni sürüm`
  return (
    <section
      aria-labelledby="gozlem-formlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="gozlem-formlari" className="text-lg font-semibold">
            Gözlem formları
          </h2>
          <p className="text-sm text-muted-foreground">
            Ölçütler, 0–5 seviye tanımları ve ağırlıklar. Gözlemde kullanılmış form değiştirilemez;
            yeni sürüm açılır, eski gözlemler kendi sürümüyle kalır.
          </p>
        </div>
        <Button onClick={() => setMode({ kind: 'create' })}>Yeni form</Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={templates.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={TEMPLATE_MOBILE}
        caption="Gözlem formları"
        empty="Henüz gözlem formu yok. Önce bir form oluşturun."
        emptyFiltered="Aramayla eşleşen form yok."
        loading={templates.isPending}
        fetching={templates.isFetching && !templates.isPending}
        error={
          templates.error ? (
            <QueryError error={templates.error} onRetry={() => void templates.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={mode !== null}
        onOpenChange={(open) => (open ? undefined : setMode(null))}
        title={title}
        description="Her ölçüt için 0–5 seviyelerinin tanımını yazın; 3 hedef seviyedir."
        size="wide"
      >
        {mode ? <TemplateForm mode={mode} onDone={() => setMode(null)} /> : null}
      </Modal>
      <Modal
        open={archiving !== null}
        onOpenChange={(open) => (open ? undefined : setArchiving(null))}
        title="Gözlem formunu arşivle"
      >
        {archiving ? (
          <ArchiveTemplate template={archiving} onDone={() => setArchiving(null)} />
        ) : null}
      </Modal>
    </section>
  )
}

type TemplateInput = z.input<typeof templateFormSchema>
type TemplateOutput = z.output<typeof templateFormSchema>

function TemplateForm({ mode, onDone }: { mode: TemplateMode; onDone: () => void }) {
  const create = useCreateLessonObservationTemplate()
  const update = useUpdateLessonObservationTemplate()
  const version = useCreateLessonObservationTemplateVersion()
  const form = useForm<TemplateInput, unknown, TemplateOutput>({
    resolver: zodResolver(templateFormSchema),
    defaultValues:
      mode.kind === 'create' ? defaultTemplateFormValues() : templateFormValues(mode.template),
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'criteria' })
  const errors = form.formState.errors
  const busy =
    create.isPending || update.isPending || version.isPending || form.formState.isSubmitting
  const criteriaError = errors.criteria?.root?.message ?? errors.criteria?.message
  const onSubmit = form.handleSubmit(async (values) => {
    const routes = { setError: form.setError }
    const outcome =
      mode.kind === 'create'
        ? await create.submit(values, routes)
        : mode.kind === 'edit'
          ? await update.submit(
              { templateId: mode.template.id, version: mode.template.version, body: values },
              routes,
            )
          : await version.submit(
              { templateId: mode.template.id, version: mode.template.version, body: values },
              routes,
            )
    if (outcome.status === 'success') {
      notify.success(
        mode.kind === 'version'
          ? `${outcome.data.data.name}: sürüm ${String(outcome.data.data.versionNumber)} açıldı.`
          : `${outcome.data.data.name} kaydedildi.`,
      )
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Gözlem formu"
      className="grid gap-4"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="gf-ad" label="Form adı" error={errors.name}>
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('name')} disabled={busy} />
        )}
      </FormField>
      {fields.map((field, index) => (
        <fieldset key={field.id} className="grid gap-3 border-t pt-4">
          <legend className="text-sm font-medium">{`${String(index + 1)}. ölçüt`}</legend>
          <div className="grid gap-3 sm:grid-cols-[3fr_1fr_auto]">
            <FormField
              id={`gf-olcut-${String(index)}`}
              label={`${String(index + 1)}. ölçüt adı`}
              error={errors.criteria?.[index]?.title}
            >
              {(control) => (
                <Input
                  {...control}
                  autoComplete="off"
                  {...form.register(`criteria.${index}.title`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField
              id={`gf-agirlik-${String(index)}`}
              label={`${String(index + 1)}. ölçüt ağırlığı`}
              error={errors.criteria?.[index]?.weight}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10}
                  {...form.register(`criteria.${index}.weight`, { valueAsNumber: true })}
                  disabled={busy}
                />
              )}
            </FormField>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                aria-label={`${String(index + 1)}. ölçütü kaldır`}
                disabled={busy || fields.length === 1}
                onClick={() => remove(index)}
              >
                Kaldır
              </Button>
            </div>
          </div>
          <FormField
            id={`gf-aciklama-${String(index)}`}
            label={`${String(index + 1)}. ölçüt açıklaması`}
            error={errors.criteria?.[index]?.description}
          >
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                {...form.register(`criteria.${index}.description`)}
                disabled={busy}
              />
            )}
          </FormField>
          <div className="grid gap-2 sm:grid-cols-2">
            {OBSERVATION_LEVELS.map((level, levelIndex) => (
              <FormField
                key={level}
                id={`gf-seviye-${String(index)}-${String(level)}`}
                label={`${String(index + 1)}. ölçüt · ${levelLabel(level)}`}
                error={errors.criteria?.[index]?.levels?.[levelIndex]?.description}
              >
                {(control) => (
                  <Input
                    {...control}
                    autoComplete="off"
                    {...form.register(`criteria.${index}.levels.${levelIndex}.description`)}
                    disabled={busy}
                  />
                )}
              </FormField>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy || fields.length >= OBSERVATION_CRITERIA_MAX}
          onClick={() => append(emptyCriterion())}
        >
          Ölçüt ekle
        </Button>
      </div>
      {criteriaError ? (
        <p role="alert" className="text-sm text-destructive">
          {criteriaError}
        </p>
      ) : null}
      <div>
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {mode.kind === 'version' ? 'Yeni sürümü aç' : 'Formu kaydet'}
        </Button>
      </div>
    </form>
  )
}

function ArchiveTemplate({
  template,
  onDone,
}: {
  template: LessonObservationTemplate
  onDone: () => void
}) {
  const archive = useArchiveLessonObservationTemplate()
  const [error, setError] = useState<string | undefined>()
  const confirm = async () => {
    const outcome = await archive.submit(
      { templateId: template.id, version: template.version },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success(`${template.name} arşivlendi.`)
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        {template.name} yeni gözlemde seçilmez; yapılmış gözlemler kendi sürümüyle kalır.
      </p>
      <RootError message={error} />
      <div>
        <Button
          onClick={() => void confirm()}
          disabled={archive.isPending}
          aria-busy={archive.isPending || undefined}
        >
          Formu arşivle
        </Button>
      </div>
    </div>
  )
}

function ArchiveObservation({
  observation,
  onDone,
}: {
  observation: LessonObservation
  onDone: () => void
}) {
  const archive = useArchiveLessonObservation()
  const [error, setError] = useState<string | undefined>()
  const confirm = async () => {
    const outcome = await archive.submit(
      { observationId: observation.id, version: observation.version },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success('Gözlem taslağı arşivlendi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        {observation.teacherName} · {day(observation.observedDate)} taslağı listeden kalkar ve
        düzeltilemez.
      </p>
      <RootError message={error} />
      <div>
        <Button
          onClick={() => void confirm()}
          disabled={archive.isPending}
          aria-busy={archive.isPending || undefined}
        >
          Taslağı arşivle
        </Button>
      </div>
    </div>
  )
}

function ObservationCreateForm({ onDone }: { onDone: (id: string | null) => void }) {
  const create = useCreateLessonObservation()
  const templates = useLessonObservationTemplates(OPTIONS_PAGE)
  const staff = useCertificateStaff(OPTIONS_PAGE)
  const periods = usePerformancePeriods(OPTIONS_PAGE)
  const classes = useCoreAll('classes')
  const subjects = useCoreAll('subjects')
  const form = useForm<ObservationCreateValues>({
    resolver: zodResolver(observationCreateFormSchema),
    defaultValues: emptyObservationCreate(dayKey()),
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const active = (staff.data?.data ?? []).filter((row) => row.active)
  const teachers = active.filter((row) => row.role === 'ogretmen')
  const observers = active.filter((row) => row.role === 'yonetici' || row.role === 'ogretmen')
  const openPeriods = (periods.data?.data ?? []).filter((period) => period.status !== 'closed')
  const classOptions = (classes.data ?? [])
    .map((row) => row.record)
    .filter((record) => record.isActive !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }))
  const subjectOptions = (subjects.data ?? [])
    .map((row) => row.record)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(observationCreateBody(values), {
      setError: form.setError,
    })
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.teacherName} için gözlem taslağı açıldı.`)
    onDone(outcome.data.data.id)
  })
  const select = (
    name: keyof ObservationCreateValues,
    label: string,
    empty: string,
    options: readonly { value: string; label: string }[],
  ) => (
    <FormField id={`dg-${name}`} label={label} error={errors[name]}>
      {(control) => (
        <NativeSelect {...control} {...form.register(name)} className="w-full" disabled={busy}>
          <NativeSelectOption value="">{empty}</NativeSelectOption>
          {options.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
  return (
    <form
      noValidate
      aria-label="Yeni ders gözlemi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      {select(
        'templateId',
        'Gözlem formu',
        templates.isPending ? 'Formlar yükleniyor…' : 'Form seçin',
        (templates.data?.data ?? []).map((t) => ({
          value: t.id,
          label: `${t.name} (sürüm ${String(t.versionNumber)})`,
        })),
      )}
      {select(
        'teacherMembershipId',
        'Öğretmen',
        staff.isPending ? 'Personel yükleniyor…' : 'Öğretmen seçin',
        teachers.map((row) => ({ value: row.membershipId, label: row.name })),
      )}
      {select(
        'observerMembershipId',
        'Gözlemci',
        'Ben',
        observers.map((row) => ({ value: row.membershipId, label: row.name })),
      )}
      <FormField id="dg-gun" label="Gözlem günü" error={errors.observedDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('observedDate')} disabled={busy} />
        )}
      </FormField>
      {select(
        'classId',
        'Sınıf (isteğe bağlı)',
        'Sınıf yok',
        classOptions.map((record) => ({ value: record.id, label: record.name })),
      )}
      {select(
        'subjectId',
        'Ders (isteğe bağlı)',
        'Ders yok',
        subjectOptions.map((record) => ({ value: record.id, label: record.name })),
      )}
      {select(
        'performancePeriodId',
        'Performans dönemi (isteğe bağlı)',
        'Döneme bağlama',
        openPeriods.map((period) => ({ value: period.id, label: period.name })),
      )}
      {staff.error || templates.error ? (
        <div className="sm:col-span-2">
          <QueryError
            error={staff.error ?? templates.error}
            onRetry={() => void Promise.all([staff.refetch(), templates.refetch()])}
          />
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Gözlemi aç
        </Button>
      </div>
    </form>
  )
}

function ObservationEditor({
  observationId,
  onDone,
}: {
  observationId: string
  onDone: () => void
}) {
  const detail = useLessonObservation(observationId)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  if (detail.data === undefined) return <p className="text-sm">Gözlem yükleniyor…</p>
  const observation = detail.data.data
  return observation.status === 'completed' ? (
    <ObservationView observation={observation} />
  ) : (
    <ObservationForm key={observation.id} observation={observation} onDone={onDone} />
  )
}

function ObservationHeader({ observation }: { observation: LessonObservationDetail }) {
  const lesson = [observation.className, observation.subjectName]
    .filter((part) => part !== null)
    .join(' · ')
  return (
    <p className="text-sm">
      {observation.teacherName} · gözlemci {observation.observerName}
      {lesson === '' ? '' : ` · ${lesson}`} · {observation.templateName} (sürüm{' '}
      {String(observation.templateVersionNumber)})
    </p>
  )
}

/** Tamamlanmış gözlem: salt okunur seviyeler, notlar, sunucunun puanı ve görüşme (ON-209). */
function ObservationView({ observation }: { observation: LessonObservationDetail }) {
  const byId = new Map(observation.ratings.map((rating) => [rating.criterionId, rating]))
  return (
    <div className="grid gap-3">
      <ObservationHeader observation={observation} />
      <p className="text-sm font-medium">
        {day(observation.observedDate)} · Puan:{' '}
        {scoreText(observation.score, observation.ratedCount, observation.criterionCount)}
      </p>
      <dl className="grid gap-2">
        {observation.criteria.map((criterion) => {
          const rating = byId.get(criterion.id)
          return (
            <div key={criterion.id} className="grid gap-1 border-b pb-2">
              <dt className="text-sm font-medium">
                {criterion.title} (ağırlık {String(criterion.weight)})
              </dt>
              <dd className="text-sm">
                {rating?.level === null || rating === undefined ? '—' : levelLabel(rating.level)}
                {rating?.note ? ` · ${rating.note}` : ''}
              </dd>
            </div>
          )
        })}
      </dl>
      <p className="text-sm">Genel değerlendirme: {observation.generalNote ?? '—'}</p>
      <p className="text-sm text-muted-foreground">Gözlem tamamlandı; değiştirilemez.</p>
      <ObservationDebriefPanel observation={observation} />
    </div>
  )
}

function ObservationForm({
  observation,
  onDone,
}: {
  observation: LessonObservationDetail
  onDone: () => void
}) {
  const update = useUpdateLessonObservation()
  const complete = useCompleteLessonObservation()
  // Kaydedilen sürüm: "Kaydet ve tamamla" kaydettikten sonra tamamlama reddedilirse form açık
  // kalır ve sonraki gönderim yeni sürümle yapılır (yeniden çizim alanı sıfırlamaz).
  const [version, setVersion] = useState(observation.version)
  const form = useForm<ObservationEditValues>({
    resolver: zodResolver(observationEditFormSchema),
    defaultValues: observationEditValues(observation),
  })
  const errors = form.formState.errors
  const busy = update.isPending || complete.isPending || form.formState.isSubmitting
  const ratings = useWatch({ control: form.control, name: 'ratings' })
  const preview = previewScore(observation.criteria, ratings)
  const save = (finish: boolean) =>
    form.handleSubmit(async (values) => {
      const saved = await update.submit(
        {
          observationId: observation.id,
          version,
          body: observationUpdateBody(values),
        },
        { setError: form.setError },
      )
      if (saved.status !== 'success') {
        if (saved.status === 'failed' && saved.error.code === 'version_conflict') onDone()
        return
      }
      setVersion(saved.data.data.version)
      if (!finish) {
        notify.success('Gözlem kaydedildi.')
        return
      }
      const done = await complete.submit(
        { observationId: observation.id, version: saved.data.data.version },
        { setError: form.setError },
      )
      if (done.status === 'success') {
        notify.success('Gözlem tamamlandı.')
        onDone()
      }
    })
  return (
    <form
      noValidate
      aria-label="Gözlem kaydı"
      className="grid gap-4"
      onSubmit={(event) => void save(false)(event)}
    >
      <ObservationHeader observation={observation} />
      <FormField id="dg-duzenle-gun" label="Gözlem günü" error={errors.observedDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('observedDate')} disabled={busy} />
        )}
      </FormField>
      {observation.criteria.map((criterion, index) => (
        <RatingFields
          key={criterion.id}
          index={index}
          criterion={criterion}
          control={form.control}
          register={form.register}
          levelError={errors.ratings?.[index]?.level?.message}
          noteError={errors.ratings?.[index]?.note?.message}
          busy={busy}
        />
      ))}
      <FormField
        id="dg-genel"
        label="Genel değerlendirme"
        description="Tamamlamak için zorunlu."
        error={errors.generalNote}
      >
        {(control) => (
          <Textarea {...control} rows={3} {...form.register('generalNote')} disabled={busy} />
        )}
      </FormField>
      <p className="text-sm" aria-live="polite">
        Puan önizlemesi:{' '}
        {scoreText(
          preview,
          ratings.filter((rating) => rating.level !== '').length,
          observation.criteria.length,
        )}
      </p>
      <div className="flex flex-wrap gap-3">
        <RootError message={errors.root?.server?.message ?? errors.ratings?.message} />
        <Button type="submit" variant="outline" disabled={busy} aria-busy={busy || undefined}>
          Taslağı kaydet
        </Button>
        <Button
          type="button"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={(event) => void save(true)(event)}
        >
          Kaydet ve tamamla
        </Button>
      </div>
    </form>
  )
}

function RatingFields({
  index,
  criterion,
  control,
  register,
  levelError,
  noteError,
  busy,
}: {
  index: number
  criterion: LessonObservationDetail['criteria'][number]
  control: Control<ObservationEditValues>
  register: UseFormRegister<ObservationEditValues>
  levelError: string | undefined
  noteError: string | undefined
  busy: boolean
}) {
  const level = useWatch({ control, name: `ratings.${index}.level` })
  const description = criterion.levels.find((entry) => String(entry.level) === level)?.description
  return (
    <fieldset className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_2fr]">
      <legend className="text-sm font-medium">
        {criterion.title} (ağırlık {String(criterion.weight)})
      </legend>
      <FormField
        id={`dg-seviye-${criterion.id}`}
        label={`${criterion.title} seviyesi`}
        description={description}
        error={levelError === undefined ? undefined : { message: levelError }}
      >
        {(props) => (
          <NativeSelect
            {...props}
            {...register(`ratings.${index}.level`)}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Verilmedi</NativeSelectOption>
            {criterion.levels.map((entry) => (
              <NativeSelectOption key={entry.level} value={String(entry.level)}>
                {`${String(entry.level)} · ${OBSERVATION_LEVEL_LABELS[entry.level] ?? ''}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id={`dg-not-${criterion.id}`}
        label={`${criterion.title} notu`}
        description={needsNote(level) ? 'Hedefin altındaki seviyede not zorunlu.' : undefined}
        error={noteError === undefined ? undefined : { message: noteError }}
      >
        {(props) => (
          <Textarea {...props} rows={2} {...register(`ratings.${index}.note`)} disabled={busy} />
        )}
      </FormField>
    </fieldset>
  )
}
