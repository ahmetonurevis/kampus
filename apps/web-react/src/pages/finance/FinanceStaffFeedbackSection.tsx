import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import type { PerformancePeriod } from '@kampus/react-shared/use-finance-performance.ts'
import {
  useCreateStaffFeedbackAssignment,
  useCreateStaffFeedbackTemplate,
  useRecordStaffFeedbackResponse,
  useRemoveStaffFeedbackAssignment,
  useSetStaffFeedbackSettings,
  useStaffFeedbackAssignments,
  useStaffFeedbackOverview,
  useStaffFeedbackResult,
  useStaffFeedbackSettings,
  useStaffFeedbackSubjects,
  useUpdateStaffFeedbackTemplate,
  useWithdrawStaffFeedbackResponse,
  type StaffFeedbackAssignmentRow,
  type StaffFeedbackOverview,
  type StaffFeedbackSubjectRow,
} from '@kampus/react-shared/use-finance-staff-feedback.ts'
import { useCertificateStaff } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  SELF_EVALUATION_QUESTION_KIND_LABELS,
  SELF_EVALUATION_QUESTION_KINDS,
} from '@kampus/school-core/lib/finance-self-evaluations.ts'
import {
  STAFF_FEEDBACK_CHANNEL_LABELS,
  STAFF_FEEDBACK_CHANNELS,
  STAFF_FEEDBACK_QUESTIONS_MAX,
  STAFF_FEEDBACK_RELATION_LABELS,
  STAFF_FEEDBACK_RELATIONS,
  STAFF_FEEDBACK_STATUS_LABELS,
  staffFeedbackTemplateInputSchema,
  type StaffFeedbackQuestion,
  type StaffFeedbackStatus,
} from '@kampus/school-core/lib/finance-staff-feedback.ts'
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
  type SelfEvaluationAnswerFormValues,
} from './finance-self-evaluation-forms.ts'
import { staffOptionText, staffRoleText } from './finance-staff-certificate-forms.ts'
import {
  STAFF_FEEDBACK_THRESHOLD_OPTIONS,
  staffFeedbackAssignmentFormSchema,
  staffFeedbackAverageText,
  staffFeedbackEditable,
  staffFeedbackPeerHiddenText,
  staffFeedbackProgressText,
  staffFeedbackSummaryText,
  staffFeedbackTemplateDefaults,
  staffFeedbackThresholdText,
  staffFeedbackWithdrawFormSchema,
  type StaffFeedbackAssignmentFormValues,
} from './finance-staff-feedback-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['staffName', 'manager', 'peer']
const STAFF_PAGE = { page: 1, pageSize: 100 } as const
const REVIEWERS_PAGE = { page: 1, pageSize: 100 } as const
const TONES = {
  pending: 'amber',
  submitted: 'green',
} as const satisfies Record<StaffFeedbackStatus, BadgeTone>
const moment = (value: string | null) =>
  value === null ? '—' : dateLabel(value, { year: 'numeric' })

type Editable = ReturnType<typeof staffFeedbackEditable>
type Row = {
  id: string
  staffName: string
  manager: string
  peer: string
  row: StaffFeedbackSubjectRow
}

/**
 * Çok kaynaklı geri bildirim bölümü (DOM-FIN-134; ON-212): Finans "Performans" sekmesinde seçili
 * dönemin altında, yalnız yönetici. Şablon (K-457), değerlendiren ataması, değerlendiren adına
 * yanıt girişi ve geri alma, atanan/yanıtlanan oranı (K-458); toplu sonuç ve anonimlik eşiği
 * (K-459). Tek meslektaş yanıtı hiçbir yerde gösterilmez; sonuç açılışı denetime yazılır.
 */
export function StaffFeedbackPanel({ period }: { period: PerformancePeriod }) {
  const overview = useStaffFeedbackOverview(period.id)
  const list = useListState('geri-bildirim', { urlPrefix: 'gb_' })
  const search = useDebouncedValue(list.state.query).trim()
  const subjects = useStaffFeedbackSubjects(period.id, {
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const [editingTemplate, setEditingTemplate] = useState(false)
  const [editingThreshold, setEditingThreshold] = useState(false)
  const [reviewersOf, setReviewersOf] = useState<StaffFeedbackSubjectRow | null>(null)
  const [resultOf, setResultOf] = useState<StaffFeedbackSubjectRow | null>(null)
  const data = overview.data?.data
  const template = data?.template ?? null
  const editable = staffFeedbackEditable(period.status, template)
  const rows = useMemo(
    () =>
      subjects.data?.data.map((row): Row => ({
        id: row.membershipId,
        staffName: `${row.staffName} · ${staffRoleText(row.staffRole)}`,
        manager: staffFeedbackProgressText(row.manager),
        peer: staffFeedbackProgressText(row.peer),
        row,
      })),
    [subjects.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'staffName', label: 'Değerlendirilen' },
      { key: 'manager', label: 'Yönetici yanıtı' },
      { key: 'peer', label: 'Meslektaş yanıtı' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label={`${row.row.staffName} değerlendirenleri`}
              onClick={() => setReviewersOf(row.row)}
            >
              Değerlendirenler
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label={`${row.row.staffName} geri bildirim sonucu`}
              onClick={() => setResultOf(row.row)}
            >
              Sonuç
            </Button>
          </span>
        ),
      },
    ],
    [],
  )
  return (
    <section
      aria-labelledby="coklu-geri-bildirim"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="coklu-geri-bildirim" className="text-lg font-semibold">
            {period.name} · çok kaynaklı geri bildirim
          </h2>
          <p className="text-sm text-muted-foreground">
            Değerlendirilen personele yönetici ve meslektaş değerlendiren atayın; kâğıt form ya da
            e-postayla gelen yanıtı değerlendiren adına girin. Yönetici yanıtı adıyla, meslektaş
            yanıtı yalnız toplu görünür; sonucun açılışı denetim kaydına yazılır.
          </p>
          {overview.error ? (
            <QueryError error={overview.error} onRetry={() => void overview.refetch()} />
          ) : data ? (
            <>
              <p className="text-sm">{templateText(data.template)}</p>
              <p className="text-sm" aria-live="polite">
                {staffFeedbackSummaryText(data.summary)}
              </p>
              <p className="text-sm text-muted-foreground">
                {staffFeedbackThresholdText(data.threshold)}
              </p>
            </>
          ) : null}
        </div>
        <span className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditingThreshold(true)}>
            Anonimlik eşiği
          </Button>
          {data && editable.template ? (
            <Button variant="outline" onClick={() => setEditingTemplate(true)}>
              {template === null
                ? 'Geri bildirim şablonunu hazırla'
                : 'Geri bildirim şablonunu düzenle'}
            </Button>
          ) : null}
        </span>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={subjects.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE}
        caption={`${period.name} geri bildirim takibi`}
        empty="Bu döneme henüz personel eklenmedi."
        emptyFiltered="Bu aramayla eşleşen personel yok."
        loading={subjects.isPending}
        fetching={subjects.isFetching && !subjects.isPending}
        error={
          subjects.error ? (
            <QueryError error={subjects.error} onRetry={() => void subjects.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={editingTemplate}
        onOpenChange={setEditingTemplate}
        title="Geri bildirim şablonu"
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
        open={editingThreshold}
        onOpenChange={setEditingThreshold}
        title="Meslektaş anonimlik eşiği"
        description="Meslektaş sonucu ve her sorunun sonucu en az bu kadar yanıtla gösterilir. Kurumun bütün dönemlerine uygulanır."
      >
        {editingThreshold ? <ThresholdForm onDone={() => setEditingThreshold(false)} /> : null}
      </Modal>
      <Modal
        open={reviewersOf !== null}
        onOpenChange={(open) => (open ? undefined : setReviewersOf(null))}
        title={reviewersOf ? `${reviewersOf.staffName} · değerlendirenler` : 'Değerlendirenler'}
      >
        {reviewersOf ? (
          <ReviewersView
            period={period}
            subject={reviewersOf}
            editable={editable}
            questions={template?.questions ?? null}
          />
        ) : null}
      </Modal>
      <Modal
        open={resultOf !== null}
        onOpenChange={(open) => (open ? undefined : setResultOf(null))}
        title={resultOf ? `${resultOf.staffName} · geri bildirim sonucu` : 'Geri bildirim sonucu'}
      >
        {resultOf ? <ResultView periodId={period.id} membershipId={resultOf.membershipId} /> : null}
      </Modal>
    </section>
  )
}

function templateText(template: StaffFeedbackOverview['template']): string {
  if (template === null) return 'Geri bildirim şablonu hazırlanmadı.'
  const required = template.questions.filter((question) => question.required).length
  const base = `Geri bildirim şablonu: ${String(template.questions.length)} soru, ${String(required)} zorunlu.`
  return template.locked ? `${base} Yanıt girildiği için sorular değiştirilemez.` : base
}

function TemplateForm({
  periodId,
  template,
  onDone,
}: {
  periodId: string
  template: StaffFeedbackOverview['template']
  onDone: () => void
}) {
  const create = useCreateStaffFeedbackTemplate()
  const update = useUpdateStaffFeedbackTemplate()
  const form = useForm<{ questions: StaffFeedbackQuestion[] }>({
    resolver: zodResolver(staffFeedbackTemplateInputSchema),
    defaultValues: staffFeedbackTemplateDefaults(template),
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
      notify.success('Geri bildirim şablonu kaydedildi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Geri bildirim şablonu"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      {fields.map((field, index) => {
        const number = String(index + 1)
        return (
          <fieldset key={field.id} className="grid gap-2 border-b pb-3 sm:grid-cols-[3fr_1fr]">
            <legend className="sr-only">{number}. soru</legend>
            <FormField
              id={`gb-soru-${number}`}
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
            <FormField id={`gb-soru-turu-${number}`} label={`${number}. soru türü`}>
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
                      id={`gb-zorunlu-${number}`}
                      checked={control.value}
                      disabled={busy}
                      onCheckedChange={(checked) => control.onChange(checked === true)}
                    />
                  )}
                />
                <Label htmlFor={`gb-zorunlu-${number}`}>{number}. soru zorunlu</Label>
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
          disabled={busy || fields.length >= STAFF_FEEDBACK_QUESTIONS_MAX}
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

function ThresholdForm({ onDone }: { onDone: () => void }) {
  const current = useStaffFeedbackSettings()
  const save = useSetStaffFeedbackSettings()
  const settings = current.data?.data
  const form = useForm<{ threshold: string }>({
    values: { threshold: String(settings?.peerAnonymityThreshold ?? '') },
  })
  const busy = save.isPending || form.formState.isSubmitting
  if (current.error)
    return <QueryError error={current.error} onRetry={() => void current.refetch()} />
  if (!settings) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await save.submit(
      { version: settings.version, peerAnonymityThreshold: Number(values.threshold) },
      { setError: (_name, error) => form.setError('root.server', error) },
    )
    if (outcome.status === 'success') {
      notify.success('Anonimlik eşiği kaydedildi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Meslektaş anonimlik eşiği"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="gb-esik"
        label="En az meslektaş yanıtı"
        description="3 ile 10 arası. 3'ün altı tek yanıtın çıkarılmasına izin verir."
      >
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('threshold')}
            className="w-full"
            disabled={busy}
          >
            {STAFF_FEEDBACK_THRESHOLD_OPTIONS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div>
        <RootError message={form.formState.errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Eşiği kaydet
        </Button>
      </div>
    </form>
  )
}

type Step =
  | { kind: 'list' }
  | { kind: 'respond'; assignment: StaffFeedbackAssignmentRow }
  | { kind: 'withdraw'; assignment: StaffFeedbackAssignmentRow }

/** Değerlendirilenin değerlendirenleri: atama, kaldırma, yanıt girişi ve geri alma (K-458). */
function ReviewersView({
  period,
  subject,
  editable,
  questions,
}: {
  period: PerformancePeriod
  subject: StaffFeedbackSubjectRow
  editable: Editable
  questions: readonly StaffFeedbackQuestion[] | null
}) {
  const assignments = useStaffFeedbackAssignments(period.id, {
    ...REVIEWERS_PAGE,
    subjectMembershipId: subject.membershipId,
  })
  const remove = useRemoveStaffFeedbackAssignment()
  const [step, setStep] = useState<Step>({ kind: 'list' })
  const back = () => setStep({ kind: 'list' })
  if (step.kind === 'respond' && questions !== null)
    return <ResponseForm assignment={step.assignment} questions={questions} onDone={back} />
  if (step.kind === 'withdraw') return <WithdrawForm assignment={step.assignment} onDone={back} />
  const rows = assignments.data?.data ?? []
  const onRemove = async (assignment: StaffFeedbackAssignmentRow) => {
    const outcome = await remove.submit({
      assignmentId: assignment.id,
      version: assignment.version,
    })
    if (outcome.status === 'success') notify.success(`${assignment.reviewerName} kaldırıldı.`)
  }
  return (
    <div className="grid gap-4">
      {assignments.error ? (
        <QueryError error={assignments.error} onRetry={() => void assignments.refetch()} />
      ) : assignments.isPending ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz değerlendiren atanmadı.</p>
      ) : (
        <ul aria-label="Değerlendirenler" className="grid gap-2">
          {rows.map((assignment) => (
            <li
              key={assignment.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm"
            >
              <span className="grid gap-0.5">
                <span className="font-medium">
                  {assignment.reviewerName} · {STAFF_FEEDBACK_RELATION_LABELS[assignment.relation]}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <StatusBadge
                    text={STAFF_FEEDBACK_STATUS_LABELS[assignment.status]}
                    tone={TONES[assignment.status]}
                  />
                  {assignment.channel === null
                    ? null
                    : `${STAFF_FEEDBACK_CHANNEL_LABELS[assignment.channel]} · ${moment(assignment.submittedAt)}`}
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                {assignment.status === 'pending' && editable.respond ? (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`${assignment.reviewerName} yanıtını gir`}
                    onClick={() => setStep({ kind: 'respond', assignment })}
                  >
                    Yanıt gir
                  </Button>
                ) : null}
                {assignment.status === 'pending' && editable.assign ? (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`${assignment.reviewerName} atamasını kaldır`}
                    disabled={remove.isPending}
                    onClick={() => void onRemove(assignment)}
                  >
                    Kaldır
                  </Button>
                ) : null}
                {assignment.status === 'submitted' && editable.respond ? (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`${assignment.reviewerName} yanıtını geri al`}
                    onClick={() => setStep({ kind: 'withdraw', assignment })}
                  >
                    Geri al
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editable.respond ? null : (
        <p className="text-sm text-muted-foreground">
          {questions === null
            ? 'Yanıt girmek için önce geri bildirim şablonunu hazırlayın.'
            : 'Yanıt yürürlük ve ara görüşme aşamasında girilir.'}
        </p>
      )}
      {editable.assign ? <AssignForm periodId={period.id} subject={subject} /> : null}
    </div>
  )
}

function AssignForm({ periodId, subject }: { periodId: string; subject: StaffFeedbackSubjectRow }) {
  const create = useCreateStaffFeedbackAssignment()
  const [staffSearch, setStaffSearch] = useState('')
  const staffQuery = useDebouncedValue(staffSearch).trim()
  const staff = useCertificateStaff({
    ...STAFF_PAGE,
    ...(staffQuery.length >= 2 ? { q: staffQuery } : {}),
  })
  const form = useForm<StaffFeedbackAssignmentFormValues>({
    resolver: zodResolver(staffFeedbackAssignmentFormSchema),
    defaultValues: { reviewerMembershipId: '', relation: 'peer' },
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  // Kişi kendini değerlendirmez (K-458): değerlendirilen listede yok.
  const options = (staff.data?.data ?? []).filter(
    (row) => row.active && row.membershipId !== subject.membershipId,
  )
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(
      { periodId, body: { subjectMembershipId: subject.membershipId, ...values } },
      {
        setError: (name, error) => {
          if (name === 'reviewerMembershipId' || name === 'relation')
            form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.reviewerName} değerlendiren olarak atandı.`)
    form.reset({ reviewerMembershipId: '', relation: values.relation })
  })
  return (
    <form
      noValidate
      aria-label="Değerlendiren ata"
      className="grid gap-3 border-t pt-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="gb-personel-ara" label="Personel ara" description="En az 2 harf.">
        {(control) => (
          <Input
            {...control}
            type="search"
            autoComplete="off"
            value={staffSearch}
            onChange={(event) => setStaffSearch(event.target.value)}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="gb-degerlendiren" label="Değerlendiren" error={errors.reviewerMembershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('reviewerMembershipId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">
              {staff.isPending ? 'Personel yükleniyor…' : 'Değerlendiren seçin'}
            </NativeSelectOption>
            {options.map((row) => (
              <NativeSelectOption key={row.membershipId} value={row.membershipId}>
                {staffOptionText(row)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="gb-iliski"
        label="İlişki"
        description="Meslektaş yanıtı anonimdir; yönetici yanıtı adıyla görünür."
        error={errors.relation}
      >
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('relation')}
            className="w-full"
            disabled={busy}
          >
            {STAFF_FEEDBACK_RELATIONS.map((relation) => (
              <NativeSelectOption key={relation} value={relation}>
                {STAFF_FEEDBACK_RELATION_LABELS[relation]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {staff.error ? (
        <div className="sm:col-span-2">
          <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Değerlendiren ata
        </Button>
      </div>
    </form>
  )
}

/** Değerlendiren adına yanıt girişi: kanal ve cevaplar; giriş yanıtı gönderir (K-458). */
function ResponseForm({
  assignment,
  questions,
  onDone,
}: {
  assignment: StaffFeedbackAssignmentRow
  questions: readonly StaffFeedbackQuestion[]
  onDone: () => void
}) {
  const record = useRecordStaffFeedbackResponse()
  const form = useForm<SelfEvaluationAnswerFormValues>({
    resolver: zodResolver(selfEvaluationAnswerFormSchema),
    defaultValues: selfEvaluationAnswerDefaults(questions),
  })
  const errors = form.formState.errors
  const busy = record.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const missing = missingRequiredCount(questions, values)
    if (missing > 0) {
      form.setError('root.server', { message: `Zorunlu ${String(missing)} soru cevaplanmadı.` })
      return
    }
    const outcome = await record.submit(
      {
        assignmentId: assignment.id,
        version: assignment.version,
        body: { channel: values.channel, answers: selfEvaluationAnswersBody(questions, values) },
      },
      {
        setError: (name, error) => {
          if (name === 'channel') form.setError('channel', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${assignment.reviewerName} yanıtı kaydedildi.`)
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label={`${assignment.reviewerName} yanıtı`}
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm text-muted-foreground">
        {assignment.reviewerName} · {STAFF_FEEDBACK_RELATION_LABELS[assignment.relation]}
        {assignment.relation === 'peer'
          ? '. Kaydedilen meslektaş yanıtı tek başına bir daha gösterilmez.'
          : ''}
      </p>
      <FormField id="gb-kanal" label="Yanıtın geldiği kanal" error={errors.channel}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('channel')}
            className="w-full"
            disabled={busy}
          >
            {STAFF_FEEDBACK_CHANNELS.map((channel) => (
              <NativeSelectOption key={channel} value={channel}>
                {STAFF_FEEDBACK_CHANNEL_LABELS[channel]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {questions.map((question, index) => {
        const id = `gb-cevap-${String(index + 1)}`
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
        <span className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            Yanıtı kaydet
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
            Vazgeç
          </Button>
        </span>
      </div>
    </form>
  )
}

function WithdrawForm({
  assignment,
  onDone,
}: {
  assignment: StaffFeedbackAssignmentRow
  onDone: () => void
}) {
  const withdraw = useWithdrawStaffFeedbackResponse()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(staffFeedbackWithdrawFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = withdraw.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await withdraw.submit(
      { assignmentId: assignment.id, version: assignment.version, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${assignment.reviewerName} yanıtı geri alındı.`)
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="Yanıtı geri al"
      className="grid gap-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="gb-geri-al"
        label="Geri alma gerekçesi"
        description="Cevaplar silinir, atama yeniden yanıt bekler; gerekçe ve geri alan saklanır."
        error={errors.reason}
      >
        {(control) => <Input {...control} {...form.register('reason')} disabled={busy} />}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <span className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Yanıtı geri al
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
          Vazgeç
        </Button>
      </span>
    </form>
  )
}

/** Toplu sonuç (K-459): yönetici yanıtları adıyla, meslektaşlar yalnız toplu ve eşik üstünde. */
function ResultView({ periodId, membershipId }: { periodId: string; membershipId: string }) {
  const query = useStaffFeedbackResult(periodId, membershipId)
  if (query.error) return <QueryError error={query.error} onRetry={() => void query.refetch()} />
  const result = query.data?.data
  if (!result) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>
  const hidden = staffFeedbackPeerHiddenText(result.peer, result.threshold)
  return (
    <div className="grid gap-4">
      <section aria-labelledby="gb-yonetici" className="grid gap-2">
        <h3 id="gb-yonetici" className="font-semibold">
          Yönetici geri bildirimi ({staffFeedbackProgressText(result.manager)})
        </h3>
        {result.manager.responses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Yönetici yanıtı girilmedi.</p>
        ) : (
          result.manager.responses.map((response, responseIndex) => (
            <dl
              key={`${response.reviewerName}-${String(responseIndex)}`}
              aria-label={`${response.reviewerName} yanıtı`}
              className="grid gap-2 border-b pb-2 text-sm"
            >
              <p className="text-muted-foreground">
                {response.reviewerName} · {moment(response.submittedAt)}
              </p>
              {result.questions.map((question, index) => {
                const answer = response.answers[index]
                const value =
                  question.kind === 'scale'
                    ? answer?.score === null || answer?.score === undefined
                      ? '—'
                      : `${String(answer.score)} / 5`
                    : (answer?.text ?? '—')
                return (
                  <div key={`${question.text}-${String(index)}`} className="grid gap-0.5">
                    <dt className="font-medium">{question.text}</dt>
                    <dd className="whitespace-pre-wrap">{value}</dd>
                  </div>
                )
              })}
            </dl>
          ))
        )}
      </section>
      <section aria-labelledby="gb-meslektas" className="grid gap-2">
        <h3 id="gb-meslektas" className="font-semibold">
          Meslektaş geri bildirimi ({staffFeedbackProgressText(result.peer)})
        </h3>
        {hidden !== null ? (
          <p className="text-sm">{hidden}</p>
        ) : (
          <dl aria-label="Meslektaş toplu sonucu" className="grid gap-2 text-sm">
            {result.peer.questions.map((question, index) => (
              <div key={`${question.text}-${String(index)}`} className="grid gap-0.5 border-b pb-2">
                <dt className="font-medium">{question.text}</dt>
                <dd>
                  {question.hidden ? (
                    `Gizli: ${String(question.answered)} cevap, en az ${String(result.threshold)} gerekir.`
                  ) : question.kind === 'scale' ? (
                    `Ortalama ${staffFeedbackAverageText(question.average)} (${String(question.answered)} cevap)`
                  ) : (
                    <ul className="list-disc ps-5">
                      {question.texts.map((text, textIndex) => (
                        <li key={`${String(textIndex)}-${text}`} className="whitespace-pre-wrap">
                          {text}
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  )
}
