import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useApplicationInterviews,
  useChangeCandidateInterviewStatus,
  useCreateCandidateInterview,
  useInterviewTemplates,
  useSubmitCandidateEvaluation,
  type CandidateInterview,
} from '@kampus/react-shared/use-finance-candidate-interviews.ts'
import type { JobApplicationDetail } from '@kampus/react-shared/use-finance-job-postings.ts'
import { useLessonObservationTemplates } from '@kampus/react-shared/use-finance-lesson-observations.ts'
import { useCertificateStaff } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  CANDIDATE_INTERVIEW_TYPE_LABELS,
  CANDIDATE_INTERVIEW_TYPES,
} from '@kampus/school-core/lib/finance-candidate-interviews.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  evaluationBody,
  evaluationDefaults,
  evaluationFormSchema,
  evaluationNeedsNote,
  interviewPlanBody,
  interviewPlanDefaults,
  interviewPlanField,
  interviewPlanSchema,
  interviewStatusText,
  interviewStatusTone,
  interviewSummaryText,
  interviewTypeText,
  percentText,
  scoreOptions,
  usesObservationForm,
  type EvaluationFormValues,
  type InterviewPlanValues,
} from './finance-candidate-interview-forms.ts'

const OPTIONS_PAGE = { page: 1, pageSize: 100 } as const
const momentText = (iso: string) =>
  dateLabel(iso, { year: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * Başvuru panelindeki mülakat bölümü (DOM-FIN-138; ON-178; K-469…K-471): özet (değerlendirici
 * ortalamaları), mülakatlar ve değerlendirmeleri, "mülakat" aşamasında plan, yapıldı/iptal ve
 * isteği yapanın değerlendirme formu. Puan sunucudan gelir.
 */
export function CandidateInterviewsSection({ application }: { application: JobApplicationDetail }) {
  const interviews = useApplicationInterviews(application.id)
  const [planning, setPlanning] = useState(false)
  const [evaluating, setEvaluating] = useState<CandidateInterview | null>(null)
  const canPlan = !application.anonymized && application.stage === 'interview'
  return (
    <section aria-labelledby="mulakatlar" className="grid gap-2 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="mulakatlar" className="text-sm font-semibold">
          Mülakatlar
        </h4>
        {canPlan ? (
          <Button size="sm" variant="secondary" onClick={() => setPlanning(true)}>
            Mülakat planla
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {interviewSummaryText(application.interviewSummary)}
      </p>
      {!canPlan && !application.anonymized && application.stage !== 'interview' ? (
        <p className="text-sm text-muted-foreground">
          Mülakat, başvuru "Mülakat" aşamasındayken planlanır; teklif için en az bir yapılmış
          mülakat gerekir.
        </p>
      ) : null}
      {interviews.error ? (
        <QueryError error={interviews.error} onRetry={() => void interviews.refetch()} />
      ) : interviews.data ? (
        <ul aria-label="Mülakat listesi" className="grid gap-3">
          {interviews.data.data.interviews.map((interview) => (
            <InterviewItem
              key={interview.id}
              interview={interview}
              onEvaluate={() => setEvaluating(interview)}
            />
          ))}
        </ul>
      ) : (
        <SummaryLoading />
      )}
      <Modal
        open={planning}
        onOpenChange={setPlanning}
        title="Mülakat planla"
        description="Örnek ders, ders gözlem formuyla puanlanır. Değerlendiriciler formu mülakat yapıldıktan sonra gönderir."
        size="wide"
      >
        {planning ? (
          <PlanForm applicationId={application.id} onDone={() => setPlanning(false)} />
        ) : null}
      </Modal>
      <Modal
        open={evaluating !== null}
        onOpenChange={(open) => (open ? undefined : setEvaluating(null))}
        title="Değerlendirmem"
        description="Gönderdikten sonra değiştiremezsiniz."
        size="wide"
      >
        {evaluating ? (
          <EvaluationForm interview={evaluating} onDone={() => setEvaluating(null)} />
        ) : null}
      </Modal>
    </section>
  )
}

function InterviewItem({
  interview,
  onEvaluate,
}: {
  interview: CandidateInterview
  onEvaluate: () => void
}) {
  const status = useChangeCandidateInterviewStatus()
  const mine = interview.evaluations.find((evaluation) => evaluation.mine)
  const label = `${interviewTypeText(interview.type)} · ${momentText(interview.scheduledAt)}`
  const change = async (action: 'complete' | 'cancel') => {
    const outcome = await status.submit(
      { interviewId: interview.id, version: interview.version, action },
      { setError: (_name, issue) => notify.error(issue.message) },
    )
    if (outcome.status === 'success')
      notify.success(
        action === 'complete' ? 'Mülakat yapıldı işaretlendi.' : 'Mülakat iptal edildi.',
      )
  }
  return (
    <li aria-label={label} className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <StatusBadge
          text={interviewStatusText(interview.status)}
          tone={interviewStatusTone(interview.status)}
        />
      </div>
      <p className="text-muted-foreground">
        {[
          interview.location,
          interview.meetingUrl,
          `${interview.form.name} (sürüm ${String(interview.form.versionNumber)})`,
          `Ortalama ${percentText(interview.averagePercent)}`,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')}
      </p>
      <ul aria-label="Değerlendiriciler" className="grid gap-1">
        {interview.evaluations.map((evaluation) => (
          <li key={evaluation.id}>
            {`${evaluation.evaluatorName}: ${evaluation.score === null ? 'bekliyor' : percentText(evaluation.score.percent)}`}
            {evaluation.generalNote ? (
              <span className="block whitespace-pre-wrap text-muted-foreground">
                {evaluation.generalNote}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {interview.status === 'planned' ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={status.isPending}
              onClick={() => void change('complete')}
            >
              Yapıldı
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={status.isPending}
              onClick={() => void change('cancel')}
            >
              İptal et
            </Button>
          </>
        ) : null}
        {interview.status === 'completed' && mine && mine.submittedAt === null ? (
          <Button size="sm" onClick={onEvaluate}>
            Değerlendirmemi gir
          </Button>
        ) : null}
      </div>
    </li>
  )
}

function PlanForm({ applicationId, onDone }: { applicationId: string; onDone: () => void }) {
  const create = useCreateCandidateInterview()
  const [defaults] = useState(() => interviewPlanDefaults(new Date()))
  const form = useForm<InterviewPlanValues>({
    resolver: zodResolver(interviewPlanSchema),
    defaultValues: defaults,
  })
  const type = useWatch({ control: form.control, name: 'type' })
  const selected = useWatch({ control: form.control, name: 'evaluatorMembershipIds' })
  const observation = usesObservationForm(type)
  const interviewTemplates = useInterviewTemplates(OPTIONS_PAGE, !observation)
  const observationTemplates = useLessonObservationTemplates(OPTIONS_PAGE, observation)
  const templates = observation ? observationTemplates : interviewTemplates
  const staff = useCertificateStaff(OPTIONS_PAGE)
  const evaluators = (staff.data?.data ?? []).filter(
    (row) => row.active && (row.role === 'yonetici' || row.role === 'ogretmen'),
  )
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const toggle = (membershipId: string, checked: boolean) =>
    form.setValue(
      'evaluatorMembershipIds',
      checked ? [...selected, membershipId] : selected.filter((id) => id !== membershipId),
      { shouldValidate: form.formState.isSubmitted },
    )
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(
      { applicationId, body: interviewPlanBody(values) },
      {
        setError: (name, error) => {
          const field = interviewPlanField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Mülakat planlandı.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Mülakat planı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="mp-tur" label="Mülakat türü" error={errors.type}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('type', { onChange: () => form.setValue('templateId', '') })}
            className="w-full"
            disabled={busy}
          >
            {CANDIDATE_INTERVIEW_TYPES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {CANDIDATE_INTERVIEW_TYPE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="mp-an" label="Gün ve saat" error={errors.scheduledAt}>
        {(control) => (
          <Input
            {...control}
            type="datetime-local"
            {...form.register('scheduledAt')}
            disabled={busy}
          />
        )}
      </FormField>
      {type === 'online' ? (
        <FormField id="mp-baglanti" label="Görüşme bağlantısı" error={errors.meetingUrl}>
          {(control) => (
            <Input
              {...control}
              type="url"
              autoComplete="off"
              {...form.register('meetingUrl')}
              disabled={busy}
            />
          )}
        </FormField>
      ) : (
        <FormField
          id="mp-yer"
          label={type === 'pre_screen' ? 'Yer (isteğe bağlı)' : 'Yer'}
          error={errors.location}
        >
          {(control) => (
            <Input {...control} autoComplete="off" {...form.register('location')} disabled={busy} />
          )}
        </FormField>
      )}
      <FormField
        id="mp-form"
        label={observation ? 'Ders gözlem formu' : 'Mülakat formu'}
        error={errors.templateId}
      >
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('templateId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">
              {templates.isPending ? 'Formlar yükleniyor…' : 'Form seçin'}
            </NativeSelectOption>
            {(templates.data?.data ?? []).map((template) => (
              <NativeSelectOption key={template.id} value={template.id}>
                {`${template.name} (sürüm ${String(template.versionNumber)})`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <fieldset className="grid gap-2 sm:col-span-2" aria-describedby="mp-degerlendirici-hata">
        <legend className="text-sm font-medium">Değerlendiriciler</legend>
        {staff.isPending ? <p className="text-sm">Personel yükleniyor…</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {evaluators.map((row) => (
            <label key={row.membershipId} className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(row.membershipId)}
                onCheckedChange={(checked) => toggle(row.membershipId, checked === true)}
                disabled={busy}
              />
              {row.name}
            </label>
          ))}
        </div>
        {errors.evaluatorMembershipIds ? (
          <p id="mp-degerlendirici-hata" role="alert" className="text-sm text-destructive">
            {errors.evaluatorMembershipIds.message}
          </p>
        ) : null}
      </fieldset>
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
          Mülakatı planla
        </Button>
      </div>
    </form>
  )
}

function EvaluationForm({
  interview,
  onDone,
}: {
  interview: CandidateInterview
  onDone: () => void
}) {
  const submit = useSubmitCandidateEvaluation()
  const { form: interviewForm } = interview
  const form = useForm<EvaluationFormValues>({
    resolver: zodResolver(evaluationFormSchema(interviewForm)),
    defaultValues: evaluationDefaults(interviewForm),
  })
  const scores = useWatch({ control: form.control, name: 'ratings' })
  const errors = form.formState.errors
  const busy = submit.isPending || form.formState.isSubmitting
  const options = scoreOptions(interviewForm)
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await submit.submit(
      { interviewId: interview.id, body: evaluationBody(values) },
      {
        setError: (name, error) => {
          if (name === 'generalNote') form.setError('generalNote', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Değerlendirmeniz gönderildi.')
      onDone()
    } else if (
      outcome.status === 'failed' &&
      outcome.error.code === 'candidate_evaluation_submitted'
    )
      onDone()
  })
  return (
    <form
      noValidate
      aria-label="Mülakat değerlendirmesi"
      className="grid gap-4"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm text-muted-foreground">
        {`${interviewForm.name} · puan ${String(interviewForm.scaleMin)}–${String(interviewForm.scaleMax)}`}
      </p>
      {interviewForm.criteria.map((criterion, index) => (
        <fieldset key={criterion.id} className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_2fr]">
          <legend className="text-sm font-medium">{criterion.title}</legend>
          <FormField
            id={`md-puan-${criterion.id}`}
            label={`${criterion.title} puanı`}
            error={errors.ratings?.[index]?.score}
          >
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register(`ratings.${index}.score`)}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Puan seçin</NativeSelectOption>
                {options.map((option) => {
                  const level = criterion.levels.find((row) => String(row.level) === option.value)
                  return (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {level ? `${option.label} · ${level.description}` : option.label}
                    </NativeSelectOption>
                  )
                })}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id={`md-not-${criterion.id}`}
            label={
              evaluationNeedsNote(interviewForm, scores[index]?.score ?? '')
                ? `${criterion.title} notu (zorunlu)`
                : `${criterion.title} notu`
            }
            error={errors.ratings?.[index]?.note}
          >
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                {...form.register(`ratings.${index}.note`)}
                disabled={busy}
              />
            )}
          </FormField>
        </fieldset>
      ))}
      <FormField id="md-genel" label="Genel değerlendirme" error={errors.generalNote}>
        {(control) => (
          <Textarea {...control} rows={3} {...form.register('generalNote')} disabled={busy} />
        )}
      </FormField>
      <div>
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Değerlendirmeyi gönder
        </Button>
      </div>
    </form>
  )
}
