import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import {
  useTaskAssignment,
  useUpdateTaskAssignment,
} from '@kampus/react-shared/use-task-assignments.ts'
import type { TaskAssignmentStaff } from '@kampus/react-shared/use-task-assignments.ts'
import { useTaskSubmissions } from '@kampus/react-shared/use-task-submissions.ts'
import { istanbulLocalToUtc, LATE_ACCEPTANCE_MAX_DAYS } from '@kampus/school-core/skills/scoring.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading, SummaryMetrics, SummarySection } from '../management/SummaryParts.tsx'
import { RootError } from '../management/FormParts.tsx'
import {
  canChangeAssignment,
  dateTimeLabel,
  deadlineFormSchema,
  instantToLocal,
  isStaffAssignment,
  scoreState,
  submissionStatus,
  targetsLabel,
  type DeadlineFormOutput,
  type DeadlineFormValues,
} from './task-model.ts'
import { useTaskLookups } from './use-task-lookups.ts'
import { TASK_KINDS } from '@kampus/school-core/skills/scoring.ts'

type Props = {
  assignmentId: string
  onClose: () => void
  onGrade: (submissionId: string) => void
}

/**
 * Atama özeti (sağ panel, `?gorev=`): sabitlenen ayarlar, hedefler ve öğretmen puanlı görevde
 * teslim listesi (puanlamaya geçiş). Atamayı atayan ve yönetici değiştirir; atayan olmayan ama
 * kapsamındaki sınıf yüzünden gören öğretmen salt okur görür (DOM-YTK-028) ve puanlayabilir.
 */
export function TaskAssignmentPanel({ assignmentId, onClose, onGrade }: Props) {
  return (
    <SidePanel
      open={assignmentId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Görev ayrıntısı"
    >
      {assignmentId ? <AssignmentDetail assignmentId={assignmentId} onGrade={onGrade} /> : null}
    </SidePanel>
  )
}

function AssignmentDetail({ assignmentId, onGrade }: Omit<Props, 'onClose'>) {
  const { session } = useAuth()
  const detail = useTaskAssignment(assignmentId)
  const { names } = useTaskLookups()
  const item = detail.data?.data
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  if (!item || !isStaffAssignment(item)) return <SummaryLoading />
  const userId = session?.user.id ?? ''
  const canChange = canChangeAssignment(item, userId, session?.role ?? '')
  const teacher = item.scoringMode === 'teacher'
  return (
    <>
      <h3 className="mb-1 text-lg font-semibold [overflow-wrap:anywhere]">{item.title}</h3>
      <p className="mb-5 text-sm text-muted-foreground">
        {TASK_KINDS[item.kind].label} · {teacher ? 'Rubrikle puanlanır' : 'Otomatik puanlanır'}
      </p>
      <SummaryMetrics
        items={[
          { label: 'Son teslim', value: dateTimeLabel(item.deadline.dueAt) },
          { label: 'Geç kabul', value: `${item.deadline.lateAcceptanceDays} gün` },
          { label: 'Hedef', value: targetsLabel(item.targets, names, 10) },
          { label: 'Atayan', value: item.assignedByUserId === userId ? 'Siz' : 'Başka kullanıcı' },
        ]}
      />
      {canChange ? (
        <SummarySection title="Son teslimi uzat">
          <DeadlineForm key={item.rowVersion} item={item} />
        </SummarySection>
      ) : (
        <SummarySection title="Son teslim">
          <p className="text-sm text-muted-foreground">
            Bu görevi başka bir kullanıcı atadı; ayarlarını yalnız atayan değiştirebilir.
            Sınıfınızın teslimlerini puanlayabilirsiniz.
          </p>
        </SummarySection>
      )}
      {teacher ? <SubmissionList assignmentId={item.id} onGrade={onGrade} /> : null}
    </>
  )
}

function DeadlineForm({ item }: { item: TaskAssignmentStaff }) {
  const update = useUpdateTaskAssignment()
  const form = useForm<DeadlineFormValues, unknown, DeadlineFormOutput>({
    resolver: zodResolver(deadlineFormSchema) as unknown as Resolver<
      DeadlineFormValues,
      unknown,
      DeadlineFormOutput
    >,
    defaultValues: {
      dueAt: instantToLocal(item.deadline.dueAt),
      lateAcceptanceDays: String(item.deadline.lateAcceptanceDays),
    },
  })
  const busy = update.isPending || form.formState.isSubmitting
  const submit = form.handleSubmit(async (values) => {
    const dueAt = istanbulLocalToUtc(values.dueAt)
    if (dueAt === null) return
    const outcome = await update.submit(
      {
        assignmentId: item.id,
        version: item.rowVersion,
        patch: { deadline: { dueAt, lateAcceptanceDays: values.lateAcceptanceDays } },
      },
      {
        setError: (name, error) =>
          form.setError(
            name.endsWith('dueAt')
              ? 'dueAt'
              : name.endsWith('lateAcceptanceDays')
                ? 'lateAcceptanceDays'
                : 'root.server',
            error,
          ),
      },
    )
    if (outcome.status === 'success') notify.success('Son teslim güncellendi.')
  })
  return (
    <form
      noValidate
      aria-label="Son teslimi uzat"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(event)
      }}
      className="grid gap-4"
    >
      <FormField id="son-teslim" label="Son teslim" error={form.formState.errors.dueAt}>
        {(control) => (
          <Input {...control} type="datetime-local" {...form.register('dueAt')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="gec-kabul"
        label="Geç kabul (gün)"
        description={`En fazla ${LATE_ACCEPTANCE_MAX_DAYS} gün; son teslim yalnız ileri alınabilir.`}
        error={form.formState.errors.lateAcceptanceDays}
      >
        {(control) => (
          <Input
            {...control}
            type="number"
            inputMode="numeric"
            min={0}
            max={LATE_ACCEPTANCE_MAX_DAYS}
            {...form.register('lateAcceptanceDays')}
            disabled={busy}
            className="max-w-[120px]"
          />
        )}
      </FormField>
      <RootError message={form.formState.errors.root?.server?.message} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          <Icon name="Check" size={16} aria-hidden="true" />
          Son teslimi kaydet
        </Button>
      </div>
    </form>
  )
}

function SubmissionList({
  assignmentId,
  onGrade,
}: {
  assignmentId: string
  onGrade: (submissionId: string) => void
}) {
  const submissions = useTaskSubmissions({ assignmentId, page: 1, pageSize: 100 })
  const { names } = useTaskLookups()
  return (
    <SummarySection title="Teslimler">
      {submissions.error ? (
        <QueryError error={submissions.error} onRetry={() => void submissions.refetch()} />
      ) : !submissions.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Teslimler yükleniyor…
        </p>
      ) : submissions.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz teslim kaydı yok.</p>
      ) : (
        <ul className="grid gap-2">
          {submissions.data.data.map((submission) => {
            const status = submissionStatus(submission.status)
            const score = scoreState(submission)
            const learner = names.studentName(submission.learnerId)
            return (
              <li
                key={submission.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-sm"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-medium">{learner}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <StatusBadge text={status.label} tone={status.tone} />
                    {submission.latestVersion ? (
                      <StatusBadge text={score.label} tone={score.tone} />
                    ) : null}
                  </span>
                </span>
                {submission.latestVersion ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`${learner} teslimini aç`}
                    onClick={() => onGrade(submission.id)}
                  >
                    {submission.latestVersion.score ? 'Görüntüle' : 'Puanla'}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </SummarySection>
  )
}
