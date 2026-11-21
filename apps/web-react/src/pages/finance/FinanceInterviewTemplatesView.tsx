import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import type { z } from 'zod'
import {
  useArchiveInterviewTemplate,
  useCreateInterviewTemplate,
  useCreateInterviewTemplateVersion,
  useInterviewTemplates,
  useUpdateInterviewTemplate,
  type InterviewTemplate,
} from '@kampus/react-shared/use-finance-candidate-interviews.ts'
import {
  INTERVIEW_CRITERIA_MAX,
  INTERVIEW_SCALE_MAX,
  INTERVIEW_SCALE_MIN,
} from '@kampus/school-core/lib/finance-candidate-interviews.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  defaultInterviewTemplateValues,
  emptyInterviewCriterion,
  interviewTemplateBody,
  interviewTemplateFormSchema,
  interviewTemplateValues,
} from './finance-candidate-interview-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'usage']

type TemplateMode = { kind: 'create' } | { kind: 'edit' | 'version'; template: InterviewTemplate }
type TemplateRow = {
  id: string
  name: string
  versionText: string
  usage: string
  template: InterviewTemplate
}

/**
 * Mülakat formları (DOM-FIN-138; ON-178, K-470): İş ilanları sekmesinde yönetici kurumun sürümlü
 * mülakat formlarını yazar (ad, 1–N ölçek, ölçüt ve ağırlık). Mülakatta kullanılmış form
 * değiştirilmez, yeni sürüm açılır. Örnek ders ders gözlem formunu kullanır (Ders gözlemleri).
 */
export function InterviewTemplatesView() {
  const list = useListState('mulakat-formu', { urlPrefix: 'mf_' })
  const search = useDebouncedValue(list.state.query).trim()
  const templates = useInterviewTemplates({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const [mode, setMode] = useState<TemplateMode | null>(null)
  const [archiving, setArchiving] = useState<InterviewTemplate | null>(null)
  const rows = useMemo(
    () =>
      templates.data?.data.map((template): TemplateRow => ({
        id: template.id,
        name: template.name,
        versionText: `Sürüm ${String(template.versionNumber)} · ${String(template.criteria.length)} ölçüt · 1–${String(template.scaleMax)} ölçek`,
        usage: template.used ? `${String(template.interviewCount)} mülakatta` : 'Kullanılmadı',
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
      ? 'Yeni mülakat formu'
      : mode.kind === 'edit'
        ? `${mode.template.name} · düzenle`
        : `${mode.template.name} · yeni sürüm`
  return (
    <div className="grid gap-3 pt-3">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6">
        <p className="max-w-prose text-sm text-muted-foreground">
          Ölçütler, ölçek ve ağırlıklar. Mülakatta kullanılmış form değiştirilemez; yeni sürüm
          açılır. Örnek ders, Ders gözlemleri sekmesindeki gözlem formuyla puanlanır.
        </p>
        <Button onClick={() => setMode({ kind: 'create' })}>Yeni mülakat formu</Button>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={templates.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE}
        caption="Mülakat formları"
        empty="Henüz mülakat formu yok. Önce bir form oluşturun."
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
        description="Her ölçüte 1 ile ölçeğin üst ucu arasında puan verilir; ağırlık ölçütün toplamdaki payıdır."
        size="wide"
      >
        {mode ? <TemplateForm mode={mode} onDone={() => setMode(null)} /> : null}
      </Modal>
      <Modal
        open={archiving !== null}
        onOpenChange={(open) => (open ? undefined : setArchiving(null))}
        title="Mülakat formunu arşivle"
      >
        {archiving ? (
          <ArchiveTemplate template={archiving} onDone={() => setArchiving(null)} />
        ) : null}
      </Modal>
    </div>
  )
}

type TemplateInput = z.input<typeof interviewTemplateFormSchema>
type TemplateOutput = z.output<typeof interviewTemplateFormSchema>

function TemplateForm({ mode, onDone }: { mode: TemplateMode; onDone: () => void }) {
  const create = useCreateInterviewTemplate()
  const update = useUpdateInterviewTemplate()
  const version = useCreateInterviewTemplateVersion()
  const form = useForm<TemplateInput, unknown, TemplateOutput>({
    resolver: zodResolver(interviewTemplateFormSchema),
    defaultValues:
      mode.kind === 'create'
        ? defaultInterviewTemplateValues()
        : interviewTemplateValues(mode.template),
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'criteria' })
  const errors = form.formState.errors
  const busy =
    create.isPending || update.isPending || version.isPending || form.formState.isSubmitting
  const criteriaError = errors.criteria?.root?.message ?? errors.criteria?.message
  const onSubmit = form.handleSubmit(async (values) => {
    const body = interviewTemplateBody({
      name: values.name,
      scaleMax: values.scaleMax,
      criteria: values.criteria.map((criterion) => ({
        title: criterion.title,
        description: criterion.description ?? '',
        weight: criterion.weight,
      })),
    })
    const routes = { setError: form.setError }
    const outcome =
      mode.kind === 'create'
        ? await create.submit(body, routes)
        : mode.kind === 'edit'
          ? await update.submit(
              { templateId: mode.template.id, version: mode.template.version, body },
              routes,
            )
          : await version.submit(
              { templateId: mode.template.id, version: mode.template.version, body },
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
      aria-label="Mülakat formu"
      className="grid gap-4"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="grid gap-3 sm:grid-cols-[3fr_1fr]">
        <FormField id="mf-ad" label="Form adı" error={errors.name}>
          {(control) => (
            <Input {...control} autoComplete="off" {...form.register('name')} disabled={busy} />
          )}
        </FormField>
        <FormField
          id="mf-olcek"
          label="Ölçek üst ucu"
          error={errors.scaleMax}
          description={`${String(INTERVIEW_SCALE_MIN)}–${String(INTERVIEW_SCALE_MAX)}`}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="numeric"
              min={INTERVIEW_SCALE_MIN}
              max={INTERVIEW_SCALE_MAX}
              {...form.register('scaleMax', { valueAsNumber: true })}
              disabled={busy}
            />
          )}
        </FormField>
      </div>
      {fields.map((field, index) => (
        <fieldset key={field.id} className="grid gap-3 border-t pt-4">
          <legend className="text-sm font-medium">{`${String(index + 1)}. ölçüt`}</legend>
          <div className="grid gap-3 sm:grid-cols-[3fr_1fr_auto]">
            <FormField
              id={`mf-olcut-${String(index)}`}
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
              id={`mf-agirlik-${String(index)}`}
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
            id={`mf-aciklama-${String(index)}`}
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
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy || fields.length >= INTERVIEW_CRITERIA_MAX}
          onClick={() => append(emptyInterviewCriterion())}
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
  template: InterviewTemplate
  onDone: () => void
}) {
  const archive = useArchiveInterviewTemplate()
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
        {template.name} yeni mülakatta seçilmez; yapılmış mülakatlar kendi sürümüyle kalır.
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
