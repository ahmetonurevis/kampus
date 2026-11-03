import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import {
  extraTimeAvailability,
  extraTimeMinutesLabel,
  extraTimeReasonLabel,
  learnerExtraTimeName,
  learnersWithoutExtraTime,
  type TaskExtraTimeLearner,
  type TaskExtraTimeList,
} from '@kampus/react-shared/task-extra-times.ts'
import {
  useChangeTaskExtraTime,
  useGrantTaskExtraTime,
  useRemoveTaskExtraTime,
  useTaskExtraTimes,
} from '@kampus/react-shared/use-task-extra-times.ts'
import type { TaskAssignmentStaff } from '@kampus/react-shared/use-task-assignments.ts'
import { EXTRA_TIME_LIMITS } from '@kampus/school-core/skills/extra-time.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useNow } from '@/hooks/use-now.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummarySection } from '../management/SummaryParts.tsx'
import {
  defaultExtraTimeForm,
  EXTRA_TIME_REASON_OPTIONS,
  extraTimeFieldFor,
  extraTimeFormFor,
  extraTimeFormSchema,
  type ExtraTimeFormOutput,
  type ExtraTimeFormValues,
} from './extra-time-model.ts'
import { dateTimeLabel } from './task-model.ts'

type Props = { item: Pick<TaskAssignmentStaff, 'id' | 'timeLimitMinutes' | 'deadline'> }

/** `new` yeni verme, kimlik ise o kursiyerin değiştirme formu, `null` kapalı. */
type Editing = 'new' | string | null

/**
 * Bireysel ek süre (DOM-BEC-043, OG-248): öğretmen ve yönetici süreli görevde özel gereksinimi olan
 * kursiyere ek süre tanımlar, değiştirir, kaldırır. Yalnız süreli görevde ve teslim penceresi açıkken
 * görünür (kural core `isClosed`); süresiz ya da kapanmış görevde bölüm yoktur. Atayan olmayan
 * öğretmen listeyi okur, yazamaz (`canManage` sunucudan). Ekran yalnız sunucu yanıtıyla değişir;
 * gerekçe kategorisi yalnız personele gösterilir.
 */
export function ExtraTimeSection({ item }: Props) {
  const now = useNow(false)
  const availability = extraTimeAvailability(item, now)
  const list = useTaskExtraTimes(item.id, { enabled: availability === 'open' })
  if (availability !== 'open') return null
  return (
    <SummarySection title="Bireysel ek süre">
      {list.error ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Ek süreler yükleniyor…
        </p>
      ) : (
        <ExtraTimeBody assignmentId={item.id} list={list.data.data} />
      )}
    </SummarySection>
  )
}

function ExtraTimeBody({ assignmentId, list }: { assignmentId: string; list: TaskExtraTimeList }) {
  const [editing, setEditing] = useState<Editing>(null)
  const remove = useRemoveTaskExtraTime()
  const given = list.learners.filter((learner) => learner.current !== null)
  const free = learnersWithoutExtraTime(list)

  async function removeFor(learner: TaskExtraTimeLearner) {
    const outcome = await remove.submit({
      assignmentId,
      learnerId: learner.learnerId,
      version: learner.version,
    })
    if (outcome.status === 'success') notify.success('Ek süre kaldırıldı.')
  }

  return (
    <div className="grid gap-3">
      {given.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu görevde ek süre tanımlı kursiyer yok.</p>
      ) : (
        <ul aria-label="Ek süresi olan kursiyerler" className="grid gap-2">
          {given.map((learner) => {
            const name = learnerExtraTimeName(learner)
            const current = learner.current!
            return (
              <li key={learner.learnerId} className="rounded-xl border px-3.5 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {extraTimeMinutesLabel(current.minutes)} ·{' '}
                      {extraTimeReasonLabel(current.reason)}
                    </span>
                  </span>
                  {list.canManage ? (
                    <span className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`${name} ek süresini değiştir`}
                        disabled={remove.isPending}
                        onClick={() => setEditing(learner.learnerId)}
                      >
                        Değiştir
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`${name} ek süresini kaldır`}
                        disabled={remove.isPending}
                        aria-busy={remove.isPending || undefined}
                        onClick={() => void removeFor(learner)}
                      >
                        Kaldır
                      </Button>
                    </span>
                  ) : null}
                </div>
                {editing === learner.learnerId ? (
                  <ExtraTimeForm
                    key={`${learner.learnerId}-${learner.version}`}
                    assignmentId={assignmentId}
                    timeLimitMinutes={list.timeLimitMinutes}
                    mode={{ kind: 'change', learner }}
                    onDone={() => setEditing(null)}
                  />
                ) : null}
                <History learner={learner} />
              </li>
            )
          })}
        </ul>
      )}
      {list.canManage ? (
        editing === 'new' ? (
          <ExtraTimeForm
            assignmentId={assignmentId}
            timeLimitMinutes={list.timeLimitMinutes}
            mode={{ kind: 'grant', learners: free }}
            onDone={() => setEditing(null)}
          />
        ) : (
          <div>
            <Button
              variant="secondary"
              size="sm"
              disabled={free.length === 0}
              onClick={() => setEditing('new')}
            >
              <Icon name="Plus" size={16} aria-hidden="true" />
              Ek süre ver
            </Button>
            {free.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Ek süre verilebilecek başka kursiyer yok.
              </p>
            ) : null}
          </div>
        )
      ) : (
        <p className="text-xs text-muted-foreground">
          Ek süreyi yalnız görevi atayan ya da yönetici değiştirebilir.
        </p>
      )}
    </div>
  )
}

/** Gerekçeli kayıt geçmişi (DOM-BEC-043): yeniden eskiye; yalnız personel görür. */
function History({ learner }: { learner: TaskExtraTimeLearner }) {
  if (learner.history.length < 2) return null
  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer">Geçmiş ({learner.history.length})</summary>
      <ul className="mt-1 grid gap-0.5">
        {learner.history.map((entry) => (
          <li key={entry.sequence}>
            {dateTimeLabel(entry.grantedAt)} ·{' '}
            {entry.minutes === 0 ? 'Kaldırıldı' : extraTimeMinutesLabel(entry.minutes)}
            {entry.reason ? ` · ${extraTimeReasonLabel(entry.reason)}` : ''}
          </li>
        ))}
      </ul>
    </details>
  )
}

type FormMode =
  | { kind: 'grant'; learners: TaskExtraTimeLearner[] }
  | { kind: 'change'; learner: TaskExtraTimeLearner }

function ExtraTimeForm({
  assignmentId,
  timeLimitMinutes,
  mode,
  onDone,
}: {
  assignmentId: string
  timeLimitMinutes: number | null
  mode: FormMode
  onDone: () => void
}) {
  const grant = useGrantTaskExtraTime()
  const change = useChangeTaskExtraTime()
  const changing = mode.kind === 'change'
  const form = useForm<ExtraTimeFormValues, unknown, ExtraTimeFormOutput>({
    resolver: zodResolver(extraTimeFormSchema) as unknown as Resolver<
      ExtraTimeFormValues,
      unknown,
      ExtraTimeFormOutput
    >,
    defaultValues:
      mode.kind === 'change' && mode.learner.current
        ? extraTimeFormFor(mode.learner.learnerId, mode.learner.current)
        : defaultExtraTimeForm(),
  })
  const busy = grant.isPending || change.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const setError = (name: string, error: { type: string; message: string }) =>
    form.setError(extraTimeFieldFor(name), error)

  const submit = form.handleSubmit(async (values) => {
    const outcome =
      mode.kind === 'change'
        ? await change.submit(
            {
              assignmentId,
              learnerId: mode.learner.learnerId,
              version: mode.learner.version,
              body: { minutes: values.minutes, reason: values.reason },
            },
            { setError },
          )
        : await grant.submit({ assignmentId, body: values }, { setError })
    if (outcome.status !== 'success') return
    notify.success(changing ? 'Ek süre güncellendi.' : 'Ek süre tanımlandı.')
    onDone()
  })
  const label = changing ? 'Ek süreyi değiştir' : 'Ek süre ver'
  const idPrefix = changing ? `ek-sure-${mode.learner.learnerId}` : 'ek-sure-yeni'
  return (
    <form
      noValidate
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault()
        void submit(event)
      }}
      className="mt-3 grid gap-4 rounded-xl border bg-surface-soft p-3.5"
    >
      {mode.kind === 'grant' ? (
        <FormField id={`${idPrefix}-kursiyer`} label="Kursiyer" error={errors.learnerId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('learnerId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Kursiyer seçin</NativeSelectOption>
              {mode.learners.map((learner) => (
                <NativeSelectOption key={learner.learnerId} value={learner.learnerId}>
                  {learnerExtraTimeName(learner)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      <FormField
        id={`${idPrefix}-dakika`}
        label="Ek süre (dakika)"
        description={`${EXTRA_TIME_LIMITS.min}–${EXTRA_TIME_LIMITS.max} dakika${
          timeLimitMinutes === null ? '' : `; görevin süresini (${timeLimitMinutes} dk) aşamaz`
        }.`}
        error={errors.minutes}
      >
        {(control) => (
          <Input
            {...control}
            type="number"
            inputMode="numeric"
            min={EXTRA_TIME_LIMITS.min}
            max={EXTRA_TIME_LIMITS.max}
            {...form.register('minutes', { valueAsNumber: true })}
            disabled={busy}
            className="max-w-[140px]"
          />
        )}
      </FormField>
      <FormField id={`${idPrefix}-gerekce`} label="Gerekçe" error={errors.reason}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('reason')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Gerekçe seçin</NativeSelectOption>
            {EXTRA_TIME_REASON_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          <Icon name="Check" size={16} aria-hidden="true" />
          Kaydet
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onDone}>
          Vazgeç
        </Button>
      </div>
    </form>
  )
}
