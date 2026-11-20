import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCreateObservationDebrief,
  useDevelopmentGoals,
  useFinalizeObservationDebrief,
  useObservationDebrief,
  useUpdateObservationDebrief,
  type ObservationDebrief,
} from '@kampus/react-shared/use-finance-development-goals.ts'
import { useCertificateStaff } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import { OBSERVATION_DEBRIEF_STATUS_LABELS } from '@kampus/school-core/lib/finance-observation-debriefs.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { GoalCreateForm } from './FinanceDevelopmentGoalForms.tsx'
import {
  debriefBody,
  debriefFormSchema,
  debriefValues,
  emptyDebrief,
  goalStatusLabel,
  goalTone,
  toggleParticipant,
  type DebriefFormValues,
} from './finance-development-goal-forms.ts'

const OPTIONS_PAGE = { page: 1, pageSize: 100 } as const
const day = (value: string) => dateLabel(`${value}T09:00:00.000Z`, { year: 'numeric' })

type ObservationRef = {
  id: string
  teacherMembershipId: string
  teacherName: string
  observerMembershipId: string
}

/**
 * Gözlem sonrası görüşme bölümü (DOM-FIN-133; ON-209): tamamlanmış gözlemin penceresinde görüşme
 * yoksa açılır, taslak düzeltilir ve kesinleşir (K-454; kesinleşen görüşme salt okunur). Altında
 * görüşmeden doğan gelişim hedefleri ve "Hedef ekle" (K-455). Okumalar denetime düşer (K-456).
 */
export function ObservationDebriefPanel({ observation }: { observation: ObservationRef }) {
  const debrief = useObservationDebrief(observation.id)
  let content
  if (debrief.error)
    content = <QueryError error={debrief.error} onRetry={() => void debrief.refetch()} />
  else if (debrief.data === undefined) content = <p className="text-sm">Görüşme yükleniyor…</p>
  else {
    const row = debrief.data.data
    content =
      row === null ? (
        <DebriefForm observation={observation} debrief={null} />
      ) : row.status === 'finalized' ? (
        <DebriefView debrief={row} />
      ) : (
        <DebriefForm key={row.version} observation={observation} debrief={row} />
      )
  }
  const row = debrief.data?.data ?? null
  return (
    <section aria-labelledby="gozlem-gorusmesi" className="grid gap-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="gozlem-gorusmesi" className="text-base font-semibold">
          Gözlem sonrası görüşme
        </h3>
        {row === null ? null : (
          <StatusBadge
            text={OBSERVATION_DEBRIEF_STATUS_LABELS[row.status]}
            tone={row.status === 'finalized' ? 'green' : 'gray'}
          />
        )}
      </div>
      {content}
      {row === null ? null : <DebriefGoals debrief={row} />}
    </section>
  )
}

function DebriefView({ debrief }: { debrief: ObservationDebrief }) {
  return (
    <dl className="grid gap-2 text-sm">
      <div>
        <dt className="font-medium">Görüşme günü</dt>
        <dd>{day(debrief.debriefDate)}</dd>
      </div>
      <div>
        <dt className="font-medium">Katılanlar</dt>
        <dd>{debrief.participants.map((row) => row.name).join(', ')}</dd>
      </div>
      <div>
        <dt className="font-medium">Güçlü yönler</dt>
        <dd className="whitespace-pre-line">{debrief.strengths ?? '—'}</dd>
      </div>
      <div>
        <dt className="font-medium">Gelişim alanları</dt>
        <dd className="whitespace-pre-line">{debrief.developmentAreas ?? '—'}</dd>
      </div>
      <div>
        <dt className="font-medium">Öğretmenin görüşü</dt>
        <dd className="whitespace-pre-line">{debrief.teacherComment ?? '—'}</dd>
      </div>
      <p className="text-muted-foreground">Görüşme kesinleşti; değiştirilemez.</p>
    </dl>
  )
}

function DebriefForm({
  observation,
  debrief,
}: {
  observation: ObservationRef
  debrief: ObservationDebrief | null
}) {
  const create = useCreateObservationDebrief()
  const update = useUpdateObservationDebrief()
  const finalize = useFinalizeObservationDebrief()
  const staff = useCertificateStaff(OPTIONS_PAGE)
  const form = useForm<DebriefFormValues>({
    resolver: zodResolver(debriefFormSchema),
    defaultValues: debrief === null ? emptyDebrief(dayKey(), observation) : debriefValues(debrief),
  })
  const errors = form.formState.errors
  const busy =
    create.isPending || update.isPending || finalize.isPending || form.formState.isSubmitting
  const selected = useWatch({ control: form.control, name: 'participantMembershipIds' })
  const known = new Map((debrief?.participants ?? []).map((row) => [row.membershipId, row.name]))
  const candidates = [
    ...(staff.data?.data ?? [])
      .filter(
        (row) =>
          (row.role === 'yonetici' || row.role === 'ogretmen') &&
          (row.active || selected.includes(row.membershipId)),
      )
      .map((row) => ({ membershipId: row.membershipId, name: row.name })),
  ]
  for (const [membershipId, name] of known)
    if (!candidates.some((row) => row.membershipId === membershipId))
      candidates.push({ membershipId, name })
  if (!candidates.some((row) => row.membershipId === observation.teacherMembershipId))
    candidates.unshift({
      membershipId: observation.teacherMembershipId,
      name: observation.teacherName,
    })
  const save = form.handleSubmit(async (values) => {
    const body = debriefBody(values)
    if (debrief === null) {
      const outcome = await create.submit(
        { observationId: observation.id, body },
        { setError: form.setError },
      )
      if (outcome.status === 'success') notify.success('Görüşme taslağı açıldı.')
      return
    }
    const outcome = await update.submit(
      { debriefId: debrief.id, version: debrief.version, body },
      { setError: form.setError },
    )
    if (outcome.status === 'success') notify.success('Görüşme kaydedildi.')
  })
  const confirmFinalize = async () => {
    if (debrief === null) return
    if (form.formState.isDirty) {
      form.setError('root.server', {
        message: 'Önce değişiklikleri kaydedin, sonra kesinleştirin.',
      })
      return
    }
    const outcome = await finalize.submit(
      { debriefId: debrief.id, version: debrief.version },
      { setError: form.setError },
    )
    if (outcome.status === 'success') notify.success('Görüşme kesinleşti.')
  }
  return (
    <form
      noValidate
      aria-label="Gözlem sonrası görüşme"
      className="grid gap-3"
      onSubmit={(event) => void save(event)}
    >
      {debrief === null ? (
        <p className="text-sm text-muted-foreground">
          Görüşme henüz yapılmadı. Görüşme gözlem başına bir kez açılır; kesinleşince
          değiştirilemez.
        </p>
      ) : null}
      <FormField id="gg-gun" label="Görüşme günü" error={errors.debriefDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('debriefDate')} disabled={busy} />
        )}
      </FormField>
      <fieldset className="grid gap-2" aria-describedby="gg-katilan-aciklama">
        <legend className="text-sm font-medium">Katılanlar</legend>
        <p id="gg-katilan-aciklama" className="text-sm text-muted-foreground">
          Gözlenen öğretmen her görüşmede bulunur.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {candidates.map((row) => {
            const id = `gg-katilan-${row.membershipId}`
            const locked = row.membershipId === observation.teacherMembershipId
            return (
              <span key={row.membershipId} className="flex min-h-11 items-center gap-2">
                <Checkbox
                  id={id}
                  checked={selected.includes(row.membershipId)}
                  disabled={busy || locked}
                  onCheckedChange={() =>
                    form.setValue(
                      'participantMembershipIds',
                      toggleParticipant(
                        selected,
                        row.membershipId,
                        observation.teacherMembershipId,
                      ),
                      { shouldDirty: true, shouldValidate: true },
                    )
                  }
                />
                <label htmlFor={id} className="text-sm">
                  {row.name}
                </label>
              </span>
            )
          })}
        </div>
        {errors.participantMembershipIds?.message ? (
          <p className="text-sm text-destructive">{errors.participantMembershipIds.message}</p>
        ) : null}
      </fieldset>
      <FormField id="gg-guclu" label="Güçlü yönler" error={errors.strengths}>
        {(control) => (
          <Textarea {...control} rows={3} {...form.register('strengths')} disabled={busy} />
        )}
      </FormField>
      <FormField id="gg-gelisim" label="Gelişim alanları" error={errors.developmentAreas}>
        {(control) => (
          <Textarea {...control} rows={3} {...form.register('developmentAreas')} disabled={busy} />
        )}
      </FormField>
      <FormField id="gg-gorus" label="Öğretmenin görüşü" error={errors.teacherComment}>
        {(control) => (
          <Textarea {...control} rows={2} {...form.register('teacherComment')} disabled={busy} />
        )}
      </FormField>
      {staff.error ? <QueryError error={staff.error} onRetry={() => void staff.refetch()} /> : null}
      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {debrief === null ? 'Görüşmeyi aç' : 'Görüşmeyi kaydet'}
        </Button>
        {debrief === null ? null : (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void confirmFinalize()}
          >
            Görüşmeyi kesinleştir
          </Button>
        )}
      </div>
    </form>
  )
}

function DebriefGoals({ debrief }: { debrief: ObservationDebrief }) {
  const goals = useDevelopmentGoals({ ...OPTIONS_PAGE, debriefId: debrief.id })
  const [adding, setAdding] = useState(false)
  const rows = goals.data?.data ?? []
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Gelişim hedefleri</h4>
        {adding ? null : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            Hedef ekle
          </Button>
        )}
      </div>
      {goals.error ? (
        <QueryError error={goals.error} onRetry={() => void goals.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {goals.isPending ? 'Hedefler yükleniyor…' : 'Bu görüşmeden henüz hedef açılmadı.'}
        </p>
      ) : (
        <ul className="grid gap-1" aria-label="Görüşmenin gelişim hedefleri">
          {rows.map((goal) => (
            <li key={goal.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span>{goal.title}</span>
              <span className="text-muted-foreground">takip {day(goal.followUpDate)}</span>
              <StatusBadge
                text={goal.overdue ? 'Gecikti' : goalStatusLabel(goal.status)}
                tone={goalTone(goal)}
              />
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <GoalCreateForm
          debriefId={debrief.id}
          teacherName={debrief.teacherName}
          onDone={() => setAdding(false)}
        />
      ) : null}
    </div>
  )
}
