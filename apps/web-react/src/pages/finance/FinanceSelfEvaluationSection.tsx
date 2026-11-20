import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import type { PerformancePeriod } from '@kampus/react-shared/use-finance-performance.ts'
import {
  useCreateSelfEvaluation,
  useCreateSelfEvaluationTemplate,
  useReopenSelfEvaluation,
  useSelfEvaluation,
  useSelfEvaluationOverview,
  useSelfEvaluationTracking,
  useSubmitSelfEvaluation,
  useUpdateSelfEvaluation,
  useUpdateSelfEvaluationTemplate,
  type SelfEvaluationDetail,
  type SelfEvaluationOverview,
  type SelfEvaluationTrackingRow,
} from '@kampus/react-shared/use-finance-self-evaluations.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  SELF_EVALUATION_CHANNEL_LABELS,
  SELF_EVALUATION_CHANNELS,
  SELF_EVALUATION_QUESTION_KIND_LABELS,
  SELF_EVALUATION_QUESTION_KINDS,
  SELF_EVALUATION_QUESTIONS_MAX,
  SELF_EVALUATION_TRACKING_LABELS,
  SELF_EVALUATION_TRACKING_STATUSES,
  type SelfEvaluationQuestion,
  type SelfEvaluationTrackingStatus,
} from '@kampus/school-core/lib/finance-self-evaluations.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  emptySelfEvaluationQuestion,
  missingRequiredCount,
  SELF_EVALUATION_SCORE_OPTIONS,
  selfEvaluationAnswerDefaults,
  selfEvaluationAnswerFormSchema,
  selfEvaluationAnswersBody,
  selfEvaluationCommentFormSchema,
  selfEvaluationEditable,
  selfEvaluationReopenFormSchema,
  selfEvaluationSummaryText,
  selfEvaluationTemplateDefaults,
  selfEvaluationTemplateFormSchema,
  type SelfEvaluationAnswerFormValues,
  type SelfEvaluationTemplateFormValues,
} from './finance-self-evaluation-forms.ts'
import { staffRoleText } from './finance-staff-certificate-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['staffName', 'status']
const FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: SELF_EVALUATION_TRACKING_STATUSES.map((value) => ({
      value,
      label: SELF_EVALUATION_TRACKING_LABELS[value],
    })),
  },
]
const TONES = {
  missing: 'gray',
  draft: 'amber',
  submitted: 'green',
} as const satisfies Record<SelfEvaluationTrackingStatus, BadgeTone>
const isStatus = (value: unknown): value is SelfEvaluationTrackingStatus =>
  (SELF_EVALUATION_TRACKING_STATUSES as readonly unknown[]).includes(value)
const moment = (value: string | null) =>
  value === null ? '—' : dateLabel(value, { year: 'numeric' })

type Row = {
  id: string
  staffName: string
  channel: string
  submitted: string
  row: SelfEvaluationTrackingRow
}

/**
 * Öz değerlendirme bölümü (DOM-FIN-131; ON-210): Finans "Performans" sekmesinde seçili dönemin
 * altında, yalnız yönetici (K-450). Şablon (K-448), gönderen oranı ve personel takibi; yanıtı
 * yönetici personel adına girer (kâğıt form, e-posta), gönderir, görüş yazar ya da gerekçeyle geri
 * açar (K-449). Yanıt açılışı denetim kaydına yazılır.
 */
export function SelfEvaluationPanel({ period }: { period: PerformancePeriod }) {
  const overview = useSelfEvaluationOverview(period.id)
  const list = useListState('oz-degerlendirme', { urlPrefix: 'ozd_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = list.state.filters.status
  const tracking = useSelfEvaluationTracking(period.id, {
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
  })
  const [editingTemplate, setEditingTemplate] = useState(false)
  const [entry, setEntry] = useState<SelfEvaluationTrackingRow | null>(null)
  const data = overview.data?.data
  const template = data?.template ?? null
  const editable = selfEvaluationEditable(period.status, template)
  const rows = useMemo(
    () =>
      tracking.data?.data.map((row): Row => ({
        id: row.membershipId,
        staffName: `${row.staffName} · ${staffRoleText(row.staffRole)}`,
        channel: row.channel === null ? '—' : SELF_EVALUATION_CHANNEL_LABELS[row.channel],
        submitted: moment(row.submittedAt),
        row,
      })),
    [tracking.data],
  )
  const canRespond = editable.respond
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'staffName', label: 'Personel' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={SELF_EVALUATION_TRACKING_LABELS[row.row.status]}
            tone={TONES[row.row.status]}
          />
        ),
      },
      { key: 'channel', label: 'Kanal' },
      { key: 'submitted', label: 'Gönderim' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) =>
          row.row.responseId === null ? (
            canRespond ? (
              <Button
                size="sm"
                variant="outline"
                aria-label={`${row.row.staffName} öz değerlendirmesini gir`}
                onClick={() => setEntry(row.row)}
              >
                Yanıt gir
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )
          ) : (
            <Button
              size="sm"
              variant="outline"
              aria-label={`${row.row.staffName} öz değerlendirmesini aç`}
              onClick={() => setEntry(row.row)}
            >
              Aç
            </Button>
          ),
      },
    ],
    [canRespond],
  )
  return (
    <section
      aria-labelledby="oz-degerlendirme"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="oz-degerlendirme" className="text-lg font-semibold">
            {period.name} · öz değerlendirme
          </h2>
          <p className="text-sm text-muted-foreground">
            Personelin kâğıt form ya da e-postayla verdiği öz değerlendirmeyi onun adına girin.
            Gönderilen yanıt değiştirilemez; gerekçeyle geri açılır. Yanıtların açılışı denetim
            kaydına yazılır.
          </p>
          {overview.error ? (
            <QueryError error={overview.error} onRetry={() => void overview.refetch()} />
          ) : data ? (
            <>
              <p className="text-sm">{templateText(data.template)}</p>
              <p className="text-sm" aria-live="polite">
                {selfEvaluationSummaryText(data.summary)}
              </p>
            </>
          ) : null}
        </div>
        {data && editable.template ? (
          <Button variant="outline" onClick={() => setEditingTemplate(true)}>
            {template === null ? 'Şablonu hazırla' : 'Şablonu düzenle'}
          </Button>
        ) : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={tracking.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption={`${period.name} öz değerlendirme takibi`}
        empty="Bu döneme henüz personel eklenmedi."
        emptyFiltered="Bu seçimle eşleşen personel yok."
        loading={tracking.isPending}
        fetching={tracking.isFetching && !tracking.isPending}
        error={
          tracking.error ? (
            <QueryError error={tracking.error} onRetry={() => void tracking.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={editingTemplate}
        onOpenChange={setEditingTemplate}
        title="Öz değerlendirme şablonu"
        description="Puanlı sorular 1–5 arası puanlanır. İlk yanıt girildikten sonra sorular değiştirilemez."
      >
        {editingTemplate && data ? (
          <TemplateForm
            periodId={period.id}
            template={data.template}
            onDone={() => setEditingTemplate(false)}
          />
        ) : null}
      </Modal>
      <Modal
        open={entry !== null}
        onOpenChange={(open) => (open ? undefined : setEntry(null))}
        title={entry ? `${entry.staffName} · öz değerlendirme` : 'Öz değerlendirme'}
      >
        {entry && template ? (
          entry.responseId === null ? (
            <AnswerForm
              periodId={period.id}
              membershipId={entry.membershipId}
              questions={template.questions}
              onDone={() => setEntry(null)}
            />
          ) : (
            <ResponseView
              responseId={entry.responseId}
              canRespond={editable.respond}
              canComment={editable.comment}
              periodId={period.id}
              onDone={() => setEntry(null)}
            />
          )
        ) : null}
      </Modal>
    </section>
  )
}

function templateText(template: SelfEvaluationOverview['template']): string {
  if (template === null) return 'Şablon hazırlanmadı.'
  const required = template.questions.filter((question) => question.required).length
  const base = `Şablon: ${String(template.questions.length)} soru, ${String(required)} zorunlu.`
  return template.locked ? `${base} Yanıt girildiği için sorular değiştirilemez.` : base
}

function TemplateForm({
  periodId,
  template,
  onDone,
}: {
  periodId: string
  template: SelfEvaluationOverview['template']
  onDone: () => void
}) {
  const create = useCreateSelfEvaluationTemplate()
  const update = useUpdateSelfEvaluationTemplate()
  const form = useForm<SelfEvaluationTemplateFormValues>({
    resolver: zodResolver(selfEvaluationTemplateFormSchema),
    defaultValues: selfEvaluationTemplateDefaults(template),
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'questions' })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const listError = errors.questions?.root?.message ?? errors.questions?.message
  const onSubmit = form.handleSubmit(async (values) => {
    const setError = (_name: string, error: { message: string }) =>
      form.setError('root.server', error)
    const outcome =
      template === null
        ? await create.submit({ periodId, body: values }, { setError })
        : await update.submit(
            { templateId: template.id, version: template.version, body: values },
            { setError },
          )
    if (outcome.status === 'success') {
      notify.success('Öz değerlendirme şablonu kaydedildi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Öz değerlendirme şablonu"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      {fields.map((field, index) => {
        const number = String(index + 1)
        return (
          <fieldset key={field.id} className="grid gap-2 border-b pb-3 sm:grid-cols-[3fr_1fr]">
            <legend className="sr-only">{number}. soru</legend>
            <FormField
              id={`ozd-soru-${number}`}
              label={`${number}. soru`}
              error={errors.questions?.[index]?.text}
            >
              {(props) => (
                <Input
                  {...props}
                  autoComplete="off"
                  {...form.register(`questions.${index}.text`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField id={`ozd-soru-turu-${number}`} label={`${number}. soru türü`}>
              {(props) => (
                <NativeSelect
                  {...props}
                  {...form.register(`questions.${index}.kind`)}
                  className="w-full"
                  disabled={busy}
                >
                  {SELF_EVALUATION_QUESTION_KINDS.map((kind) => (
                    <NativeSelectOption key={kind} value={kind}>
                      {SELF_EVALUATION_QUESTION_KIND_LABELS[kind]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
              <div className="flex min-h-11 items-center gap-2">
                <Controller
                  control={form.control}
                  name={`questions.${index}.required`}
                  render={({ field: control }) => (
                    <Checkbox
                      id={`ozd-zorunlu-${number}`}
                      checked={control.value}
                      disabled={busy}
                      onCheckedChange={(checked) => control.onChange(checked === true)}
                    />
                  )}
                />
                <Label htmlFor={`ozd-zorunlu-${number}`}>{number}. soru zorunlu</Label>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                aria-label={`${number}. soruyu kaldır`}
                disabled={busy || fields.length === 1}
                onClick={() => remove(index)}
              >
                Kaldır
              </Button>
            </div>
          </fieldset>
        )
      })}
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={busy || fields.length >= SELF_EVALUATION_QUESTIONS_MAX}
          onClick={() => append(emptySelfEvaluationQuestion())}
        >
          Soru ekle
        </Button>
      </div>
      {listError ? (
        <p role="alert" className="text-sm text-destructive">
          {listError}
        </p>
      ) : null}
      <div>
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Şablonu kaydet
        </Button>
      </div>
    </form>
  )
}

/** Cevap formu: yeni yanıt ya da taslak düzeltmesi; "Kaydet ve gönder" kaydeder, sonra gönderir. */
function AnswerForm({
  periodId,
  membershipId,
  questions,
  existing,
  onDone,
}: {
  periodId: string
  membershipId: string
  questions: readonly SelfEvaluationQuestion[]
  existing?: SelfEvaluationDetail
  onDone: () => void
}) {
  const create = useCreateSelfEvaluation()
  const update = useUpdateSelfEvaluation()
  const submit = useSubmitSelfEvaluation()
  const form = useForm<SelfEvaluationAnswerFormValues>({
    resolver: zodResolver(selfEvaluationAnswerFormSchema),
    defaultValues: selfEvaluationAnswerDefaults(questions, existing),
  })
  const errors = form.formState.errors
  const busy =
    create.isPending || update.isPending || submit.isPending || form.formState.isSubmitting
  const setError = (name: string, error: { message: string }) => {
    if (name === 'channel') form.setError('channel', error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const save = (send: boolean) =>
    form.handleSubmit(async (values) => {
      const missing = send ? missingRequiredCount(questions, values) : 0
      if (missing > 0) {
        form.setError('root.server', {
          message: `Zorunlu ${String(missing)} soru cevaplanmadı; taslak olarak kaydedebilirsiniz.`,
        })
        return
      }
      const body = {
        channel: values.channel,
        answers: selfEvaluationAnswersBody(questions, values),
      }
      const outcome =
        existing === undefined
          ? await create.submit({ periodId, body: { membershipId, ...body } }, { setError })
          : await update.submit(
              { responseId: existing.id, version: existing.version, body },
              { setError },
            )
      if (outcome.status !== 'success') {
        if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
        return
      }
      if (!send) {
        notify.success('Öz değerlendirme taslak olarak kaydedildi.')
        onDone()
        return
      }
      const saved = outcome.data.data
      const sent = await submit.submit(
        { responseId: saved.id, version: saved.version },
        { setError },
      )
      // Gönderim kaydedilemezse taslak kalır; liste tazelenir, yönetici yeniden açar.
      if (sent.status === 'success') notify.success('Öz değerlendirme gönderildi.')
      if (sent.status !== 'busy') onDone()
    })
  return (
    <form
      noValidate
      aria-label="Öz değerlendirme yanıtı"
      className="grid gap-3"
      onSubmit={(event) => void save(false)(event)}
    >
      <FormField id="ozd-kanal" label="Yanıtın geldiği kanal" error={errors.channel}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('channel')}
            className="w-full"
            disabled={busy}
          >
            {SELF_EVALUATION_CHANNELS.map((channel) => (
              <NativeSelectOption key={channel} value={channel}>
                {SELF_EVALUATION_CHANNEL_LABELS[channel]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {questions.map((question, index) => {
        const id = `ozd-cevap-${String(index + 1)}`
        const description = question.required ? 'Zorunlu' : 'İsteğe bağlı'
        return question.kind === 'scale' ? (
          <FormField key={id} id={id} label={question.text} description={description}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register(`answers.${index}.score`)}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Cevaplanmadı</NativeSelectOption>
                {SELF_EVALUATION_SCORE_OPTIONS.map((score) => (
                  <NativeSelectOption key={score} value={score}>
                    {score}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : (
          <FormField
            key={id}
            id={id}
            label={question.text}
            description={description}
            error={errors.answers?.[index]?.text}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                {...form.register(`answers.${index}.text`)}
                disabled={busy}
              />
            )}
          </FormField>
        )
      })}
      <div className="grid gap-2">
        <RootError message={errors.root?.server?.message} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" disabled={busy} aria-busy={busy || undefined}>
            Taslak kaydet
          </Button>
          <Button
            type="button"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={(event) => void save(true)(event)}
          >
            Kaydet ve gönder
          </Button>
        </div>
      </div>
    </form>
  )
}

/** Yanıt ayrıntısı: taslak açık dönemde düzenlenir; gönderilmişte görüş ve geri açma. */
function ResponseView({
  responseId,
  periodId,
  canRespond,
  canComment,
  onDone,
}: {
  responseId: string
  periodId: string
  canRespond: boolean
  canComment: boolean
  onDone: () => void
}) {
  const detail = useSelfEvaluation(responseId)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const response = detail.data?.data
  if (!response) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>
  if (response.status === 'draft' && canRespond)
    return (
      <div className="grid gap-3">
        <ReopenNote response={response} />
        <AnswerForm
          periodId={periodId}
          membershipId={response.membershipId}
          questions={response.questions}
          existing={response}
          onDone={onDone}
        />
      </div>
    )
  return (
    <div className="grid gap-4">
      <p className="text-sm">
        {response.status === 'submitted'
          ? `Gönderildi: ${moment(response.submittedAt)}`
          : 'Taslak (gönderilmedi)'}{' '}
        · Kanal: {SELF_EVALUATION_CHANNEL_LABELS[response.channel]}
      </p>
      <ReopenNote response={response} />
      <dl aria-label="Cevaplar" className="grid gap-2 text-sm">
        {response.questions.map((question, index) => {
          const answer = response.answers[index]
          const value =
            question.kind === 'scale'
              ? answer?.score === null || answer?.score === undefined
                ? '—'
                : `${String(answer.score)} / 5`
              : (answer?.text ?? '—')
          return (
            <div key={`${question.text}-${String(index)}`} className="grid gap-0.5 border-b pb-2">
              <dt className="font-medium">{question.text}</dt>
              <dd className="whitespace-pre-wrap">{value}</dd>
            </div>
          )
        })}
      </dl>
      {response.status === 'submitted' && canComment ? (
        <>
          <CommentForm response={response} onDone={onDone} />
          <ReopenForm response={response} onDone={onDone} />
        </>
      ) : (
        <>
          {response.managerComment === null ? null : (
            <p className="text-sm">
              Yönetici görüşü: {response.managerComment}
              {response.managerCommentByName === null ? '' : ` (${response.managerCommentByName})`}
            </p>
          )}
          {canComment ? null : (
            <p className="text-sm text-muted-foreground">
              Dönem kapandı; öz değerlendirme değiştirilemez.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function ReopenNote({ response }: { response: SelfEvaluationDetail }) {
  if (response.reopenCount === 0) return null
  return (
    <p className="text-sm text-muted-foreground">
      {`Geri açıldı (${String(response.reopenCount)} kez); son gerekçe: ${response.reopenReason ?? '—'}`}
    </p>
  )
}

function CommentForm({ response, onDone }: { response: SelfEvaluationDetail; onDone: () => void }) {
  const update = useUpdateSelfEvaluation()
  const form = useForm<{ managerComment: string }>({
    resolver: zodResolver(selfEvaluationCommentFormSchema),
    defaultValues: { managerComment: response.managerComment ?? '' },
  })
  const errors = form.formState.errors
  const busy = update.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await update.submit(
      {
        responseId: response.id,
        version: response.version,
        body: { managerComment: values.managerComment },
      },
      {
        setError: (name, error) => {
          if (name === 'managerComment') form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Yönetici görüşü kaydedildi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Yönetici görüşü"
      className="grid gap-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="ozd-gorus"
        label="Yönetici görüşü"
        description={
          response.managerCommentByName === null
            ? 'Performans puanını etkilemez.'
            : `Son yazan: ${response.managerCommentByName}`
        }
        error={errors.managerComment}
      >
        {(control) => (
          <Textarea {...control} rows={3} {...form.register('managerComment')} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" variant="outline" disabled={busy} aria-busy={busy || undefined}>
          Görüşü kaydet
        </Button>
      </div>
    </form>
  )
}

function ReopenForm({ response, onDone }: { response: SelfEvaluationDetail; onDone: () => void }) {
  const reopen = useReopenSelfEvaluation()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(selfEvaluationReopenFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = reopen.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await reopen.submit(
      { responseId: response.id, version: response.version, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Öz değerlendirme taslağa geri açıldı.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Geri açma"
      className="grid gap-2 border-t pt-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="ozd-geri-ac"
        label="Geri açma gerekçesi"
        description="Yanıt taslağa döner; gerekçe ve geri açan denetim için saklanır."
        error={errors.reason}
      >
        {(control) => <Input {...control} {...form.register('reason')} disabled={busy} />}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" variant="outline" disabled={busy} aria-busy={busy || undefined}>
          Geri aç
        </Button>
      </div>
    </form>
  )
}
