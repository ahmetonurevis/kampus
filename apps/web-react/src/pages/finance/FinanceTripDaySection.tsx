import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useArchiveTripDayGroup,
  useAssignTripDay,
  useCompleteTripDayCheck,
  useCreateTripDayGroup,
  useMarkTripDayCheck,
  useProceedTripDayCheck,
  useStartTripDayCheck,
  useTripDay,
  useTripDayCard,
  useUpdateTripDayGroup,
  type TripDay,
  type TripDayCheck,
  type TripDayGroup,
} from '@kampus/react-shared/use-finance-trip-day.ts'
import {
  TRIP_DAY_CARD_PURPOSE_LABELS,
  TRIP_DAY_CHECKPOINT_SUGGESTIONS,
  tripDayCountsLabel,
  type TripDayCardPurpose,
  type TripDayMarkStatus,
} from '@kampus/school-core/lib/finance-trip-day.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  assignBody,
  assignFormSchema,
  assignOptions,
  CHECK_STATUS_VIEW,
  checkFormSchema,
  checkSummary,
  checkTimeText,
  dayNotice,
  groupChanges,
  groupDefaults,
  groupFormSchema,
  groupLine,
  missingNames,
  nextCheckpoint,
  pendingPresentBody,
  proceedFormSchema,
  rosterStatusText,
  UNASSIGN,
  type AssignFormValues,
  type CheckFormValues,
  type GroupFormValues,
  type ProceedFormValues,
} from './finance-trip-day-forms.ts'

const MARK_ACTIONS = [
  { status: 'present', label: 'Var' },
  { status: 'absent', label: 'Yok' },
] as const satisfies readonly { status: TripDayMarkStatus; label: string }[]

const CARD_HINTS = {
  office: 'Okulda kalan kart. Veli telefonları maskeli yazılır.',
  emergency:
    'Gezide grup sorumlusunun çantasında taşınır. Veli telefonları tam yazılır; açılış denetim kaydına düşer.',
} as const satisfies Record<TripDayCardPurpose, string>

/**
 * Gezi planının "Gezi günü" görünümü (DOM-FIN-154; ON-157; K-517…K-519). Yönetici ve ön büro
 * katılımcıları araç/gruplara dağıtır ve grup sorumlusunu (planın görevlisi) seçer. Gezi günü
 * yönetici ve grup sorumlusu adlandırılmış kontrol noktasında yoklama açar; dar ekranda öğrenci
 * başına büyük "Var" ve "Yok" düğmeleri. Eksik varken tur "Tamam" yapılamaz; herkes işaretliyken
 * gerekçeyle "Eksikle devam" seçilir. Acil kart PDF'i grup başına indirilir (taze oturum).
 */
export function FinanceTripDayView({ planId }: { planId: string }) {
  const day = useTripDay(planId)
  if (day.error) return <QueryError error={day.error} onRetry={() => void day.refetch()} />
  const data = day.data?.data
  if (!data) return <SummaryLoading />
  return <TripDayDetails day={data} />
}

function TripDayDetails({ day }: { day: TripDay }) {
  const [creating, setCreating] = useState(false)
  const notice = dayNotice(day)
  const editable = day.canManage && day.planStatus !== 'cancelled' && day.planStatus !== 'completed'
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">
        {day.participantSource === 'activity' && day.paidActivity !== null
          ? `Katılımcılar: ${day.paidActivity.name} etkinliğinin asil katılımcıları (${String(day.participantCount)}).`
          : `Katılımcılar: kayıtlı öğrenciler (${String(day.participantCount)}).`}
      </p>
      {notice === null ? null : (
        <p role="status" className="rounded-card border bg-secondary p-3 text-sm">
          {notice}
        </p>
      )}
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" onClick={() => setCreating(true)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Grup ekle
          </Button>
        </div>
      ) : null}
      {day.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {day.canManage
            ? 'Henüz grup yok. Araç ya da grup ekleyip katılımcıları dağıtın.'
            : 'Sorumlusu olduğunuz grup yok.'}
        </p>
      ) : (
        <ol aria-label="Gezi grupları" className="grid gap-6">
          {day.groups.map((group) => (
            <li key={group.id}>
              <GroupView day={day} group={group} editable={editable} />
            </li>
          ))}
        </ol>
      )}
      {editable && (day.groups.length > 0 || day.unassigned.length > 0) ? (
        <AssignForm day={day} />
      ) : null}
      <Modal open={creating} onOpenChange={setCreating} title="Grup ekle">
        {creating ? <GroupForm day={day} onDone={() => setCreating(false)} /> : null}
      </Modal>
    </div>
  )
}

function GroupView({
  day,
  group,
  editable,
}: {
  day: TripDay
  group: TripDayGroup
  editable: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [card, setCard] = useState(false)
  const archive = useArchiveTripDayGroup()
  const open = group.checks.find((check) => check.id === group.openCheckId) ?? null
  const closed = group.checks.filter((check) => check.status !== 'open')
  const remove = async () => {
    const outcome = await archive.submit({
      planId: day.planId,
      groupId: group.id,
      version: group.version,
    })
    if (outcome.status === 'success') notify.success(`${group.name} kaldırıldı.`)
  }
  return (
    <section aria-labelledby={`grup-${group.id}`} className="grid gap-3 border-t pt-4">
      <div className="grid gap-1">
        <h3 id={`grup-${group.id}`} className="text-base font-semibold [overflow-wrap:anywhere]">
          {group.name}
        </h3>
        <p className="text-sm text-muted-foreground">{groupLine(group)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {group.canStartCheck ? (
          <Button className="min-h-11" onClick={() => setStarting(true)}>
            <Icon name="ClipboardCheck" size={17} aria-hidden="true" />
            Yoklama başlat
          </Button>
        ) : null}
        {group.canReadCard ? (
          <Button
            variant="secondary"
            className="min-h-11"
            aria-label={`${group.name} acil kartını indir`}
            onClick={() => setCard(true)}
          >
            <Icon name="Printer" size={17} aria-hidden="true" />
            Acil kart PDF
          </Button>
        ) : null}
        {editable ? (
          <Button
            variant="ghost"
            className="min-h-11"
            aria-label={`${group.name} grubunu düzenle`}
            onClick={() => setEditing(true)}
          >
            <Icon name="Pencil" size={16} aria-hidden="true" />
            Düzenle
          </Button>
        ) : null}
        {editable && group.checks.length === 0 ? (
          <Button
            variant="ghost"
            className="min-h-11"
            aria-label={`${group.name} grubunu kaldır`}
            disabled={archive.isPending}
            onClick={() => void remove()}
          >
            <Icon name="Trash2" size={16} aria-hidden="true" />
            Kaldır
          </Button>
        ) : null}
      </div>
      {group.students.length === 0 ? (
        <p className="text-sm text-muted-foreground">Grupta öğrenci yok.</p>
      ) : open === null ? (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
            {`Öğrenciler (${String(group.students.length)})`}
          </summary>
          <ul className="grid gap-1 text-sm">
            {group.students.map((student) => (
              <li key={student.studentId}>
                {student.className === null
                  ? student.studentName
                  : `${student.studentName} · ${student.className}`}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {open !== null ? <OpenCheck day={day} group={group} check={open} /> : null}
      {closed.length > 0 ? (
        <ol aria-label={`${group.name} yoklama geçmişi`} className="grid gap-2">
          {closed.map((check) => (
            <li key={check.id} className="grid gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{checkSummary(check)}</span>
                <StatusBadge
                  text={CHECK_STATUS_VIEW[check.status].label}
                  tone={CHECK_STATUS_VIEW[check.status].tone}
                />
              </div>
              <span className="text-muted-foreground">{checkTimeText(check)}</span>
              {check.missingReason === null ? null : (
                <span className="text-muted-foreground">{`Gerekçe: ${check.missingReason}`}</span>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      <Modal open={editing} onOpenChange={setEditing} title="Grubu düzenle">
        {editing ? <GroupForm day={day} group={group} onDone={() => setEditing(false)} /> : null}
      </Modal>
      <Modal open={starting} onOpenChange={setStarting} title="Yoklama başlat">
        {starting ? (
          <StartCheckForm day={day} group={group} onDone={() => setStarting(false)} />
        ) : null}
      </Modal>
      <Modal open={card} onOpenChange={setCard} title="Acil kartı indir">
        {card ? <CardForm day={day} group={group} onDone={() => setCard(false)} /> : null}
      </Modal>
    </section>
  )
}

function OpenCheck({
  day,
  group,
  check,
}: {
  day: TripDay
  group: TripDayGroup
  check: TripDayCheck
}) {
  const mark = useMarkTripDayCheck()
  const complete = useCompleteTripDayCheck()
  const [proceeding, setProceeding] = useState(false)
  const busy = mark.isPending || complete.isPending
  // Saat gönderilmez: sunucu işaret anını yazar; belirsiz hatadan sonra aynı gövde aynı anahtarla
  // yeniden gider (çift işaret yazılmaz).
  const submitMark = (studentId: string, status: TripDayMarkStatus) =>
    void mark.submit({
      planId: day.planId,
      checkId: check.id,
      body: { marks: [{ studentId, status }] },
    })
  const allPresent = pendingPresentBody(check)
  const finish = async () => {
    const outcome = await complete.submit({
      planId: day.planId,
      checkId: check.id,
      version: check.version,
    })
    if (outcome.status === 'success') notify.success(`${check.checkpoint} yoklaması tamam.`)
  }
  const missing = check.counts.absent + check.counts.pending
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">{`${String(check.sequence)}. ${check.checkpoint}`}</h4>
        <StatusBadge text={CHECK_STATUS_VIEW.open.label} tone={CHECK_STATUS_VIEW.open.tone} />
      </div>
      <p className="text-sm font-medium" aria-live="polite">
        {tripDayCountsLabel(check.counts)}
      </p>
      <ul
        aria-label={`${check.checkpoint} yoklaması`}
        className="grid divide-y rounded-card border"
      >
        {check.roster.map((row) => (
          <li key={row.studentId} aria-label={row.studentName} className="grid gap-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{row.studentName}</span>
              <span className="text-sm text-muted-foreground">{rosterStatusText(row.status)}</span>
            </div>
            {check.canOperate ? (
              <div className="grid grid-cols-2 gap-2">
                {MARK_ACTIONS.map((action) => {
                  const pressed = row.status === action.status
                  return (
                    <Button
                      key={action.status}
                      variant={pressed ? 'default' : 'secondary'}
                      className="min-h-12 text-base"
                      aria-pressed={pressed}
                      aria-label={`${row.studentName}: ${action.label}`}
                      disabled={busy}
                      onClick={() => submitMark(row.studentId, action.status)}
                    >
                      {action.label}
                    </Button>
                  )
                })}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {check.canOperate ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            variant="secondary"
            className="min-h-12"
            disabled={busy || allPresent === null}
            onClick={() =>
              allPresent === null
                ? undefined
                : void mark.submit({ planId: day.planId, checkId: check.id, body: allPresent })
            }
          >
            Kalanlar var
          </Button>
          <Button
            className="min-h-12"
            disabled={busy || missing > 0}
            aria-busy={complete.isPending || undefined}
            onClick={() => void finish()}
          >
            Tamam
          </Button>
          <Button
            variant="secondary"
            className="min-h-12"
            disabled={busy || check.counts.pending > 0 || check.counts.absent === 0}
            onClick={() => setProceeding(true)}
          >
            Eksikle devam
          </Button>
        </div>
      ) : null}
      {check.canOperate && missing > 0 ? (
        <p className="text-sm text-muted-foreground">
          {check.counts.pending > 0
            ? 'Tur, herkes "Var" işaretlenince tamamlanır. Gelmeyen öğrenciyi "Yok" işaretleyin.'
            : 'Eksik öğrenci var: tur tamamlanamaz. Durumu gerekçeyle yazıp "Eksikle devam" seçin.'}
        </p>
      ) : null}
      <Modal open={proceeding} onOpenChange={setProceeding} title="Eksikle devam">
        {proceeding ? (
          <ProceedForm day={day} group={group} check={check} onDone={() => setProceeding(false)} />
        ) : null}
      </Modal>
    </div>
  )
}

function ProceedForm({
  day,
  group,
  check,
  onDone,
}: {
  day: TripDay
  group: TripDayGroup
  check: TripDayCheck
  onDone: () => void
}) {
  const proceed = useProceedTripDayCheck()
  const form = useForm<ProceedFormValues>({
    resolver: zodResolver(proceedFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = proceed.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await proceed.submit(
      { planId: day.planId, checkId: check.id, version: check.version, reason: values.reason },
      {
        setError: (name, error) =>
          name === 'reason'
            ? form.setError('reason', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status !== 'success') return
    notify.success(`${group.name}: ${check.checkpoint} eksikle kapandı.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Eksikle devam"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm">{`Eksik: ${missingNames(check).join(', ')}`}</p>
      <RootError message={errors.root?.server?.message} />
      <FormField id="eksik-gerekce" label="Gerekçe" error={errors.reason}>
        {(control) => (
          <Textarea
            {...control}
            {...form.register('reason')}
            placeholder="Öğrencinin durumu ve alınan önlem"
            disabled={busy}
          />
        )}
      </FormField>
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        Eksikle devam et
      </Button>
    </form>
  )
}

function StartCheckForm({
  day,
  group,
  onDone,
}: {
  day: TripDay
  group: TripDayGroup
  onDone: () => void
}) {
  const start = useStartTripDayCheck()
  const form = useForm<CheckFormValues>({
    resolver: zodResolver(checkFormSchema),
    defaultValues: { checkpoint: nextCheckpoint(group) },
  })
  const errors = form.formState.errors
  const busy = start.isPending || form.formState.isSubmitting
  const listId = `kontrol-noktalari-${group.id}`
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await start.submit(
      { planId: day.planId, groupId: group.id, checkpoint: values.checkpoint },
      {
        setError: (name, error) =>
          name === 'checkpoint'
            ? form.setError('checkpoint', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status !== 'success') return
    notify.success(`${values.checkpoint} yoklaması başladı.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Yoklama başlat"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <RootError message={errors.root?.server?.message} />
      <FormField id="kontrol-noktasi" label="Kontrol noktası" error={errors.checkpoint}>
        {(control) => (
          <Input {...control} {...form.register('checkpoint')} list={listId} disabled={busy} />
        )}
      </FormField>
      <datalist id={listId}>
        {TRIP_DAY_CHECKPOINT_SUGGESTIONS.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        Yoklamayı başlat
      </Button>
    </form>
  )
}

function GroupForm({
  day,
  group,
  onDone,
}: {
  day: TripDay
  group?: TripDayGroup
  onDone: () => void
}) {
  const create = useCreateTripDayGroup()
  const update = useUpdateTripDayGroup()
  const form = useForm<GroupFormValues>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: groupDefaults(day, group),
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const fields = {
    setError: (name: string, error: { type: string; message: string }) =>
      name === 'name' || name === 'vehiclePlate' || name === 'leaderMembershipId'
        ? form.setError(name, error, { shouldFocus: true })
        : form.setError('root.server', error),
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const parsed = groupFormSchema.parse(values)
    if (group === undefined) {
      const outcome = await create.submit({ planId: day.planId, body: parsed }, fields)
      if (outcome.status !== 'success') return
      notify.success(`${parsed.name} eklendi.`)
    } else {
      const changes = groupChanges(group, parsed)
      if (changes !== null) {
        const outcome = await update.submit(
          { planId: day.planId, groupId: group.id, version: group.version, body: changes },
          fields,
        )
        if (outcome.status !== 'success') return
        notify.success(`${parsed.name} güncellendi.`)
      }
    }
    onDone()
  })
  return (
    <form
      noValidate
      aria-label={group === undefined ? 'Grup ekle' : 'Grubu düzenle'}
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <RootError message={errors.root?.server?.message} />
      <FormField id="grup-adi" label="Grup ya da araç adı" error={errors.name}>
        {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
      </FormField>
      <FormField id="grup-plaka" label="Araç plakası (isteğe bağlı)" error={errors.vehiclePlate}>
        {(control) => (
          <Input
            {...control}
            {...form.register('vehiclePlate')}
            placeholder="34 ABC 123"
            autoCapitalize="characters"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="grup-sorumlu" label="Grup sorumlusu" error={errors.leaderMembershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('leaderMembershipId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Görevli seçin</NativeSelectOption>
            {day.staff.map((member) => (
              <NativeSelectOption key={member.membershipId} value={member.membershipId}>
                {member.name ?? 'Adsız görevli'}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <p className="text-sm text-muted-foreground">
        Grup sorumlusu gezi planının görevlilerinden seçilir; yoklamayı o yürütür.
      </p>
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        Kaydet
      </Button>
    </form>
  )
}

function AssignForm({ day }: { day: TripDay }) {
  const assign = useAssignTripDay()
  const options = assignOptions(day)
  const form = useForm<AssignFormValues>({
    resolver: zodResolver(assignFormSchema),
    defaultValues: { target: day.groups[0]?.id ?? UNASSIGN, studentIds: [] },
  })
  const errors = form.formState.errors
  const selected = useWatch({ control: form.control, name: 'studentIds' })
  const busy = assign.isPending || form.formState.isSubmitting
  const toggle = (studentId: string, checked: boolean) =>
    form.setValue(
      'studentIds',
      checked ? [...selected, studentId] : selected.filter((id) => id !== studentId),
      { shouldValidate: form.formState.isSubmitted },
    )
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await assign.submit(
      { planId: day.planId, body: assignBody(values) },
      { setError: (_name, error) => form.setError('root.server', error) },
    )
    if (outcome.status !== 'success') return
    notify.success(`${String(values.studentIds.length)} öğrencinin grubu güncellendi.`)
    form.reset({ target: values.target, studentIds: [] })
  })
  return (
    <section aria-labelledby="gezi-dagitim" className="grid gap-3 border-t pt-4">
      <h3 id="gezi-dagitim" className="text-base font-semibold">
        Dağıtım
      </h3>
      <p className="text-sm text-muted-foreground">
        {day.unassignedTotal > 0
          ? `${String(day.unassignedTotal)} katılımcının grubu yok.`
          : 'Bütün katılımcıların grubu var.'}
      </p>
      <form
        noValidate
        aria-label="Öğrencileri gruba taşı"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <RootError message={errors.root?.server?.message ?? errors.studentIds?.message} />
        <FieldSet className="gap-1">
          <FieldLegend variant="label" className="text-sm font-medium">
            Öğrenciler
          </FieldLegend>
          <ul className="grid max-h-72 gap-0 overflow-y-auto rounded-card border">
            {options.map((option) => {
              const id = `dagitim-${option.studentId}`
              return (
                <li key={option.studentId}>
                  <label
                    htmlFor={id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      id={id}
                      checked={selected.includes(option.studentId)}
                      onCheckedChange={(value) => toggle(option.studentId, value === true)}
                      disabled={busy}
                    />
                    <span className="grid">
                      <span>{option.studentName}</span>
                      <span className="text-muted-foreground">
                        {[option.className, option.groupName ?? 'Grubu yok']
                          .filter((part) => part !== null)
                          .join(' · ')}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </FieldSet>
        <FormField id="dagitim-hedef" label="Hedef grup" error={errors.target}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('target')}
              className="w-full"
              disabled={busy}
            >
              {day.groups.map((group) => (
                <NativeSelectOption key={group.id} value={group.id}>
                  {group.name}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value={UNASSIGN}>Gruptan çıkar</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          {`Seçilenleri taşı (${String(selected.length)})`}
        </Button>
      </form>
    </section>
  )
}

function CardForm({
  day,
  group,
  onDone,
}: {
  day: TripDay
  group: TripDayGroup
  onDone: () => void
}) {
  const { session } = useAuth()
  const learner = useEnrollmentLearner()
  const card = useTripDayCard()
  const { run, reauthModal } = useReauthRetry()
  const purposes: TripDayCardPurpose[] = group.canReadFullCard
    ? ['office', 'emergency']
    : ['office']
  const [purpose, setPurpose] = useState<TripDayCardPurpose>('office')
  const [printing, setPrinting] = useState(false)
  const busy = printing || card.isPending

  async function download() {
    setPrinting(true)
    try {
      const outcome = await run(() =>
        card.submit({ planId: day.planId, groupId: group.id, purpose }),
      )
      if (outcome.status !== 'done' || outcome.result.status !== 'success') return
      const data = outcome.result.data.data
      const [{ renderPdf }, template] = await Promise.all([
        import('@/lib/pdf/render.ts'),
        import('@/lib/pdf/templates/finance-trip-day-card.ts'),
      ])
      const { blob } = await renderPdf((measurer) =>
        template.tripDayCardDocument(measurer, data, {
          institution: session?.institution.name ?? 'Kampüs',
          generatedAt: new Date(),
          learnerTitle: learner.title,
        }),
      )
      saveBlob(blob, template.tripDayCardFilename(data))
      notify.success('Acil kart PDF olarak indirildi.')
      onDone()
    } catch (error) {
      console.error('[kampus]', 'pdf', error)
      notify.error('Acil kart PDF’i hazırlanamadı. Lütfen tekrar deneyin.')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void download()
        }}
      >
        <p className="text-sm text-muted-foreground">
          {`${group.name} grubunun öğrencileri, acil iletişimi ve sağlık uyarısı. Kartta yalnız "alerji / kronik durum / ilaç var" işareti ve kısa acil talimat bulunur.`}
        </p>
        <FieldSet className="gap-2">
          <FieldLegend variant="label" className="text-sm font-medium">
            Kart amacı
          </FieldLegend>
          <RadioGroup
            name="acil-kart-amac"
            value={purpose}
            onValueChange={(value) =>
              setPurpose(
                value === 'emergency' && purposes.includes('emergency') ? 'emergency' : 'office',
              )
            }
            disabled={busy}
            className="gap-1"
          >
            {purposes.map((item) => (
              <label
                key={item}
                htmlFor={`acil-kart-${item}`}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-field px-1 py-2 text-sm"
              >
                <RadioGroupItem id={`acil-kart-${item}`} value={item} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="font-medium">{TRIP_DAY_CARD_PURPOSE_LABELS[item]}</span>
                  <span className="text-muted-foreground">{CARD_HINTS[item]}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </FieldSet>
        {purposes.includes('emergency') ? null : (
          <p className="text-sm text-muted-foreground">
            Tam telefonlu kartı grup sorumlusu gezi günü, yönetici her zaman indirebilir.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" className="min-h-11" onClick={onDone}>
            Vazgeç
          </Button>
          <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
            <Icon name="Printer" size={17} aria-hidden="true" />
            PDF indir
          </Button>
        </div>
      </form>
      {reauthModal}
    </>
  )
}
