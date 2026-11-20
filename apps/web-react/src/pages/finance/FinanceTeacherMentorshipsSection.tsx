import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useOnboardingStaff } from '@kampus/react-shared/use-finance-staff-onboarding.ts'
import {
  useAddMentorshipMeeting,
  useArchiveMentorshipMeeting,
  useCloseTeacherMentorship,
  useCreateTeacherMentorship,
  useMentorshipOnboardingOptions,
  useSetMentorshipChecklistItem,
  useTeacherMentorship,
  useTeacherMentorshipSettings,
  useTeacherMentorships,
  useTeacherMentorshipSummary,
  useUpdateTeacherMentorshipSettings,
  type MentorshipDetail,
  type MentorshipSettings,
} from '@kampus/react-shared/use-finance-teacher-mentorships.ts'
import {
  MENTOR_ROLES,
  MENTEE_ROLE,
  MENTORSHIP_CONTACT_GAP_DAYS,
  MENTORSHIP_STATUS_LABELS,
  MENTORSHIP_STATUSES,
  type MentorshipStatus,
} from '@kampus/school-core/lib/finance-teacher-mentorships.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  closeReasonError,
  contactText,
  dayText,
  meetingBody,
  meetingDefaults,
  meetingFormField,
  meetingFormSchema,
  mentorshipBody,
  mentorshipDefaults,
  mentorshipFormField,
  mentorshipFormSchema,
  momentText,
  onboardingOptions,
  overdueText,
  progressText,
  settingsBody,
  STATUS_TONES,
  type MeetingFormValues,
  type MentorshipFormValues,
} from './finance-teacher-mentorship-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['mentee', 'status']
const FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: MENTORSHIP_STATUSES.map((value) => ({
      value,
      label: MENTORSHIP_STATUS_LABELS[value],
    })),
  },
  {
    key: 'takip',
    label: 'Görüşme takibi',
    type: 'select' as const,
    options: [{ value: 'gecikti', label: `${String(MENTORSHIP_CONTACT_GAP_DAYS)} günü aşanlar` }],
  },
]
const STATUS_VALUES = new Set<string>(MENTORSHIP_STATUSES)

type Row = {
  id: string
  mentee: string
  mentor: string
  period: string
  status: MentorshipStatus
  contact: string
  overdue: string | null
  progress: string
}

/**
 * Yeni öğretmen mentorluğu (DOM-FIN-136; ON-219): Finans "Mentorluk" sekmesi, yalnız yönetici
 * (K-465). Eşleşmeler takip alanlarıyla listelenir; panelde kontrol listesi, görüşmeler,
 * tamamlama ve erken sonlandırma bulunur. Mentor ve yeni öğretmenin kendi ekranı ayrı iştir.
 */
export function FinanceTeacherMentorshipsSection() {
  const list = useListState('mentorluk', { urlPrefix: 'mentor_' })
  const search = useDebouncedValue(list.state.query).trim()
  const statusFilter = list.state.filters.status
  const status =
    typeof statusFilter === 'string' && STATUS_VALUES.has(statusFilter)
      ? (statusFilter as MentorshipStatus)
      : undefined
  const overdueOnly = list.state.filters.takip === 'gecikti'
  const mentorships = useTeacherMentorships({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === undefined ? {} : { status }),
    ...(overdueOnly ? { overdue: 'true' as const } : {}),
  })
  const panel = useDetailPanel('eslesme')
  const openMentorship = panel.open
  const [dialog, setDialog] = useState<'create' | 'settings' | null>(null)
  const rows = useMemo(
    () =>
      mentorships.data?.data.map((item): Row => ({
        id: item.id,
        mentee: item.menteeName,
        mentor: item.mentorName,
        period: `${dayText(item.startDate)} – ${dayText(item.endDate)}`,
        status: item.status,
        contact: contactText(item),
        overdue: overdueText(item),
        progress: progressText(item.checklist),
      })),
    [mentorships.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'mentee', label: 'Yeni öğretmen' },
      { key: 'mentor', label: 'Mentor' },
      { key: 'period', label: 'Dönem' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={MENTORSHIP_STATUS_LABELS[row.status]}
            tone={STATUS_TONES[row.status]}
          />
        ),
      },
      {
        key: 'contact',
        label: 'Görüşme takibi',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            {row.contact}
            {row.overdue === null ? null : <StatusBadge text={row.overdue} tone="red" />}
          </span>
        ),
      },
      { key: 'progress', label: 'Kontrol listesi' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.mentee} eşleşmesini aç`}
            onClick={() => openMentorship(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [openMentorship],
  )
  return (
    <section
      aria-labelledby="mentorluk"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-2 px-6 pt-6 pb-2">
        <h2 id="mentorluk" className="text-lg font-semibold">
          Mentorluk
        </h2>
        <p className="text-sm text-muted-foreground">
          Yeni öğretmen ile mentor eşleşmeleri, görüşme kayıtları ve kontrol listesi. Görüşmesi{' '}
          {MENTORSHIP_CONTACT_GAP_DAYS} günü aşan eşleşmeler işaretlenir.
        </p>
        <SummaryLine />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog('create')}>Yeni eşleşme</Button>
          <Button variant="secondary" onClick={() => setDialog('settings')}>
            Kontrol listesi ve sınır
          </Button>
        </div>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={mentorships.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Mentorluk eşleşmeleri"
        empty="Henüz mentorluk eşleşmesi yok."
        emptyFiltered="Bu seçimle eşleşen kayıt yok."
        loading={mentorships.isPending}
        fetching={mentorships.isFetching && !mentorships.isPending}
        error={
          mentorships.error ? (
            <QueryError error={mentorships.error} onRetry={() => void mentorships.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Mentorluk eşleşmesi"
      >
        {panel.selectedId ? <MentorshipPanel mentorshipId={panel.selectedId} /> : null}
      </SidePanel>
      <Modal
        open={dialog !== null}
        onOpenChange={(value) => (value ? undefined : setDialog(null))}
        title={dialog === 'settings' ? 'Kontrol listesi ve sınır' : 'Yeni mentorluk eşleşmesi'}
      >
        {dialog === 'create' ? (
          <MentorshipForm
            onDone={(id) => {
              setDialog(null)
              openMentorship(id)
            }}
          />
        ) : null}
        {dialog === 'settings' ? <SettingsDialog onDone={() => setDialog(null)} /> : null}
      </Modal>
    </section>
  )
}

/** Kurum özeti (K-465): sayılar ve oran sunucudan. */
function SummaryLine() {
  const summary = useTeacherMentorshipSummary()
  const data = summary.data?.data
  if (summary.error)
    return <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
  if (!data) return null
  return (
    <dl
      aria-label="Mentorluk özeti"
      className="flex flex-wrap gap-x-6 gap-y-1 text-sm [&_dt]:text-muted-foreground"
    >
      <div className="flex gap-1">
        <dt>Süren</dt>
        <dd className="font-medium">{data.active}</dd>
      </div>
      <div className="flex gap-1">
        <dt>Görüşmesi geciken</dt>
        <dd className="font-medium">{data.overdue}</dd>
      </div>
      <div className="flex gap-1">
        <dt>Tamamlanan</dt>
        <dd className="font-medium">{data.completed}</dd>
      </div>
      <div className="flex gap-1">
        <dt>Erken sonlanan</dt>
        <dd className="font-medium">{data.endedEarly}</dd>
      </div>
      <div className="flex gap-1">
        <dt>Süren listelerde tamamlanma</dt>
        <dd className="font-medium">
          {data.activeChecklistPercent === null ? '—' : `%${String(data.activeChecklistPercent)}`}
        </dd>
      </div>
    </dl>
  )
}

type PanelDialog = 'meeting' | 'complete' | 'end' | null

function MentorshipPanel({ mentorshipId }: { mentorshipId: string }) {
  const detail = useTeacherMentorship(mentorshipId)
  const [dialog, setDialog] = useState<PanelDialog>(null)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const mentorship = detail.data?.data
  if (!mentorship) return <SummaryLoading />
  const active = mentorship.status === 'active'
  const close = () => setDialog(null)
  const overdue = overdueText(mentorship)
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
          {mentorship.menteeName}
          <StatusBadge
            text={MENTORSHIP_STATUS_LABELS[mentorship.status]}
            tone={STATUS_TONES[mentorship.status]}
          />
        </h3>
        <p className="text-sm text-muted-foreground">
          Mentor {mentorship.mentorName} · {dayText(mentorship.startDate)} –{' '}
          {dayText(mentorship.endDate)}
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Görüşme takibi</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {contactText(mentorship)}
          {overdue === null ? null : <StatusBadge text={overdue} tone="red" />}
        </dd>
        {mentorship.onboardingPosition ? (
          <>
            <dt className="text-muted-foreground">İşe başlama listesi</dt>
            <dd>{mentorship.onboardingPosition}</dd>
          </>
        ) : null}
        {mentorship.closedOn ? (
          <>
            <dt className="text-muted-foreground">
              {mentorship.status === 'completed' ? 'Tamamlanma' : 'Sonlanma'}
            </dt>
            <dd className="[overflow-wrap:anywhere]">
              {dayText(mentorship.closedOn)}
              {mentorship.endReason ? ` · ${mentorship.endReason}` : ''}
            </dd>
          </>
        ) : null}
      </dl>
      {active ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setDialog('meeting')}>
            Görüşme ekle
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog('complete')}>
            Tamamla
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog('end')}>
            Erken sonlandır
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Eşleşme sona erdi; görüşme ve madde işareti alınmaz.
        </p>
      )}
      <Checklist mentorship={mentorship} />
      <Meetings mentorship={mentorship} />
      <Modal
        open={dialog !== null}
        onOpenChange={(value) => (value ? undefined : close())}
        title={
          dialog === 'meeting'
            ? 'Görüşme kaydı'
            : dialog === 'complete'
              ? 'Mentorluğu tamamla'
              : 'Mentorluğu erken sonlandır'
        }
      >
        {dialog === 'meeting' ? <MeetingForm mentorship={mentorship} onDone={close} /> : null}
        {dialog === 'complete' || dialog === 'end' ? (
          <CloseForm mentorship={mentorship} kind={dialog} onDone={close} />
        ) : null}
      </Modal>
    </div>
  )
}

/** Kontrol listesi (K-465): madde, zorunluluk, kim ve ne zaman; tamamla ya da geri al. */
function Checklist({ mentorship }: { mentorship: MentorshipDetail }) {
  const setItem = useSetMentorshipChecklistItem()
  const active = mentorship.status === 'active'
  const toggle = async (itemId: string, verb: 'complete' | 'reopen') => {
    const outcome = await setItem.submit({
      mentorshipId: mentorship.id,
      itemId,
      verb,
      version: mentorship.version,
    })
    if (outcome.status === 'success')
      notify.success(verb === 'complete' ? 'Madde tamamlandı.' : 'İşaret geri alındı.')
  }
  const { checklist } = mentorship
  return (
    <section aria-labelledby="mentorluk-liste" className="grid gap-3">
      <h4 id="mentorluk-liste" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        Kontrol listesi
        <span className="font-normal text-muted-foreground">
          {progressText(checklist)} · zorunlu {checklist.requiredDone}/{checklist.requiredTotal}
        </span>
      </h4>
      {mentorship.checklistItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu eşleşmede madde yok.</p>
      ) : (
        <ul aria-label="Kontrol listesi maddeleri" className="grid gap-2 text-sm">
          {mentorship.checklistItems.map((item) => (
            <li
              key={item.id}
              aria-label={item.label}
              className="grid gap-1 rounded-sm border px-3 py-2"
            >
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {item.label}
                {item.required ? null : (
                  <span className="text-xs font-normal text-muted-foreground">isteğe bağlı</span>
                )}
                {item.completedAt === null ? null : <StatusBadge text="Tamamlandı" tone="green" />}
              </span>
              {item.completedAt === null ? null : (
                <span className="text-muted-foreground">
                  {item.completedByName ?? 'Bilinmeyen kullanıcı'} · {momentText(item.completedAt)}
                </span>
              )}
              {active ? (
                <span>
                  {item.completedAt === null ? (
                    <Button
                      size="sm"
                      disabled={setItem.isPending}
                      aria-label={`${item.label}: tamamlandı`}
                      onClick={() => void toggle(item.id, 'complete')}
                    >
                      Tamamlandı
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={setItem.isPending}
                      aria-label={`${item.label}: işareti geri al`}
                      onClick={() => void toggle(item.id, 'reopen')}
                    >
                      Geri al
                    </Button>
                  )}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Görüşmeler (K-464), yeni gün önce; süren eşleşmede yanlış kayıt arşivlenir. */
function Meetings({ mentorship }: { mentorship: MentorshipDetail }) {
  const archive = useArchiveMentorshipMeeting()
  const active = mentorship.status === 'active'
  const remove = async (meetingId: string) => {
    const outcome = await archive.submit({
      mentorshipId: mentorship.id,
      meetingId,
      version: mentorship.version,
    })
    if (outcome.status === 'success') notify.success('Görüşme kaydı kaldırıldı.')
  }
  return (
    <section aria-labelledby="mentorluk-gorusmeler" className="grid gap-3">
      <h4 id="mentorluk-gorusmeler" className="text-sm font-semibold">
        Görüşmeler ({mentorship.meetingCount})
      </h4>
      {mentorship.meetings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz görüşme kaydı yok.</p>
      ) : (
        <ul aria-label="Görüşme kayıtları" className="grid gap-2 text-sm">
          {mentorship.meetings.map((meeting) => (
            <li
              key={meeting.id}
              aria-label={`${dayText(meeting.meetingDate)} görüşmesi`}
              className="grid gap-1 rounded-sm border px-3 py-2"
            >
              <span className="font-medium">
                {dayText(meeting.meetingDate)} · {meeting.durationMinutes} dk · {meeting.topic}
              </span>
              {meeting.note ? (
                <span className="whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">
                  {meeting.note}
                </span>
              ) : null}
              {meeting.nextStep ? (
                <span className="[overflow-wrap:anywhere]">Sonraki adım: {meeting.nextStep}</span>
              ) : null}
              {active ? (
                <span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={archive.isPending}
                    aria-label={`${dayText(meeting.meetingDate)} görüşmesini kaldır`}
                    onClick={() => void remove(meeting.id)}
                  >
                    Kaldır
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Yeni eşleşme (K-463): mentor, yeni öğretmen, günler ve isteğe bağlı işe başlama listesi. */
function MentorshipForm({ onDone }: { onDone: (mentorshipId: string) => void }) {
  const create = useCreateTeacherMentorship()
  const staff = useOnboardingStaff()
  const offers = useMentorshipOnboardingOptions()
  const form = useForm<MentorshipFormValues>({
    resolver: zodResolver(mentorshipFormSchema),
    defaultValues: mentorshipDefaults(dayKey()),
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const menteeId = useWatch({ control: form.control, name: 'menteeMembershipId' })
  const people = staff.data?.data ?? []
  const mentors = people.filter((item) => (MENTOR_ROLES as readonly string[]).includes(item.role))
  const mentees = people.filter((item) => item.role === MENTEE_ROLE)
  const linkable = onboardingOptions(offers.data?.data ?? [], menteeId)
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(mentorshipBody(values), {
      setError: (name, error) => {
        const field = mentorshipFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success('Mentorluk eşleşmesi açıldı.')
    onDone(outcome.data.data.id)
  })
  return (
    <form
      noValidate
      aria-label="Mentorluk eşleşmesi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="mentorluk-yeni" label="Yeni öğretmen" error={errors.menteeMembershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('menteeMembershipId', {
              onChange: () => form.setValue('onboardingOfferId', ''),
            })}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            {mentees.map((item) => (
              <NativeSelectOption key={item.membershipId} value={item.membershipId}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="mentorluk-mentor" label="Mentor" error={errors.mentorMembershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('mentorMembershipId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            {mentors.map((item) => (
              <NativeSelectOption key={item.membershipId} value={item.membershipId}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="mentorluk-baslangic" label="Başlangıç" error={errors.startDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('startDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="mentorluk-bitis" label="Planlanan bitiş" error={errors.endDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('endDate')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField
          id="mentorluk-ise-baslama"
          label="İşe başlama listesi (isteğe bağlı)"
          description="Yalnız bu öğretmenin hesabına bağlı, kabul edilmiş teklifler listelenir."
          error={errors.onboardingOfferId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('onboardingOfferId')}
              className="w-full"
              disabled={busy || linkable.length === 0}
            >
              <NativeSelectOption value="">Bağlama</NativeSelectOption>
              {linkable.map((offer) => (
                <NativeSelectOption key={offer.offerId} value={offer.offerId}>
                  {offer.position} · {dayText(offer.startDate)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Eşleşmeyi aç
        </Button>
      </div>
    </form>
  )
}

/** Görüşme kaydı (K-464). */
function MeetingForm({ mentorship, onDone }: { mentorship: MentorshipDetail; onDone: () => void }) {
  const add = useAddMentorshipMeeting()
  const form = useForm<MeetingFormValues>({
    resolver: zodResolver(meetingFormSchema),
    defaultValues: meetingDefaults(dayKey()),
  })
  const errors = form.formState.errors
  const busy = add.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await add.submit(
      { mentorshipId: mentorship.id, version: mentorship.version, body: meetingBody(values) },
      {
        setError: (name, error) => {
          const field = meetingFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Görüşme kaydedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Görüşme kaydı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm sm:col-span-2">
        {mentorship.menteeName} · mentor {mentorship.mentorName}
      </p>
      <FormField id="gorusme-gun" label="Görüşme günü" error={errors.meetingDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('meetingDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="gorusme-sure" label="Süre (dakika)" error={errors.duration}>
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            {...form.register('duration')}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="gorusme-konu" label="Konu" error={errors.topic}>
          {(control) => (
            <Input {...control} autoComplete="off" {...form.register('topic')} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <FormField id="gorusme-not" label="Not (isteğe bağlı)" error={errors.note}>
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={3} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <FormField id="gorusme-sonraki" label="Sonraki adım (isteğe bağlı)" error={errors.nextStep}>
          {(control) => (
            <Input {...control} autoComplete="off" {...form.register('nextStep')} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Görüşmeyi kaydet
        </Button>
      </div>
    </form>
  )
}

/** Tamamlama ya da gerekçeli erken sonlandırma (K-463). */
function CloseForm({
  mentorship,
  kind,
  onDone,
}: {
  mentorship: MentorshipDetail
  kind: 'complete' | 'end'
  onDone: () => void
}) {
  const closeMentorship = useCloseTeacherMentorship()
  const [day, setDay] = useState(() => dayKey())
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<{ day?: string; reason?: string; root?: string }>({})
  const submit = async () => {
    const reasonError = closeReasonError(kind, reason)
    if (reasonError !== null) {
      setErrors({ reason: reasonError })
      return
    }
    setErrors({})
    const outcome = await closeMentorship.submit(
      {
        mentorshipId: mentorship.id,
        version: mentorship.version,
        closedOn: day,
        reason: kind === 'end' ? reason.trim() : null,
      },
      {
        setError: (name, issue) =>
          setErrors(
            name === 'reason'
              ? { reason: issue.message }
              : name === 'closedOn'
                ? { day: issue.message }
                : { root: issue.message },
          ),
      },
    )
    if (outcome.status !== 'success') return
    notify.success(kind === 'complete' ? 'Mentorluk tamamlandı.' : 'Mentorluk sonlandırıldı.')
    onDone()
  }
  const busy = closeMentorship.isPending
  const label = kind === 'complete' ? 'Mentorluğu tamamla' : 'Mentorluğu erken sonlandır'
  return (
    <form
      noValidate
      aria-label={label}
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm">
        {mentorship.menteeName} · mentor {mentorship.mentorName}.{' '}
        {kind === 'complete'
          ? 'Zorunlu maddeler ve en az bir görüşme gerekir; tamamlanan eşleşme değişmez.'
          : 'Sonlanan eşleşme değişmez.'}
      </p>
      <FormField
        id="mentorluk-kapanis-gunu"
        label={kind === 'complete' ? 'Tamamlanma günü' : 'Sonlanma günü'}
        error={errors.day === undefined ? undefined : { message: errors.day }}
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            disabled={busy}
          />
        )}
      </FormField>
      {kind === 'end' ? (
        <FormField
          id="mentorluk-gerekce"
          label="Gerekçe"
          error={errors.reason === undefined ? undefined : { message: errors.reason }}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
            />
          )}
        </FormField>
      ) : null}
      <div>
        <RootError message={errors.root} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {kind === 'complete' ? 'Tamamla' : 'Sonlandır'}
        </Button>
      </div>
    </form>
  )
}

function SettingsDialog({ onDone }: { onDone: () => void }) {
  const settings = useTeacherMentorshipSettings()
  if (settings.error)
    return <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
  const data = settings.data?.data
  if (!data) return <SummaryLoading />
  return <SettingsForm settings={data} onDone={onDone} />
}

/** Kurum ayarı (K-463, K-465): mentor sınırı ve kontrol listesi şablonu. */
function SettingsForm({ settings, onDone }: { settings: MentorshipSettings; onDone: () => void }) {
  const update = useUpdateTeacherMentorshipSettings()
  const [load, setLoad] = useState(String(settings.maxActivePerMentor))
  // Satır anahtarı yalnız listede kalır (silme ve eklemede odak doğru satırda kalsın diye).
  const [items, setItems] = useState(() =>
    settings.checklistItems.map((item) => ({ ...item, key: crypto.randomUUID() })),
  )
  const [error, setError] = useState<string | undefined>(undefined)
  const patch = (index: number, change: Partial<(typeof items)[number]>) =>
    setItems((current) =>
      current.map((item, position) => (position === index ? { ...item, ...change } : item)),
    )
  const submit = async () => {
    setError(undefined)
    const built = settingsBody({
      maxActivePerMentor: load,
      items: items.map(({ label, required }) => ({ label, required })),
    })
    if ('error' in built) {
      setError(built.error)
      return
    }
    const outcome = await update.submit(
      { version: settings.version, body: built.body },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status !== 'success') return
    notify.success('Mentorluk ayarı kaydedildi.')
    onDone()
  }
  const busy = update.isPending
  return (
    <form
      noValidate
      aria-label="Kontrol listesi ve sınır"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm text-muted-foreground">
        Maddeler yeni eşleşmelere kopyalanır; açılmış eşleşmeler değişmez. Boş bırakılan satır
        kaydedilmez.
      </p>
      <FormField
        id="mentorluk-sinir"
        label="Mentor başına süren en çok eşleşme"
        description="1–10 arası."
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            className="max-w-24"
            value={load}
            onChange={(event) => setLoad(event.target.value)}
            disabled={busy}
          />
        )}
      </FormField>
      <ul className="grid gap-2">
        {items.map((item, index) => (
          <li key={item.key} className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <FormField
                id={`mentorluk-madde-${String(index)}`}
                label={`Madde ${String(index + 1)}`}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={item.label}
                    onChange={(event) => patch(index, { label: event.target.value })}
                    disabled={busy}
                  />
                )}
              </FormField>
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Checkbox
                id={`mentorluk-madde-${String(index)}-zorunlu`}
                checked={item.required}
                disabled={busy}
                onCheckedChange={(checked) => patch(index, { required: checked === true })}
              />
              <Label htmlFor={`mentorluk-madde-${String(index)}-zorunlu`}>Zorunlu</Label>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`Madde ${String(index + 1)} sil`}
              disabled={busy}
              onClick={() => setItems((current) => current.filter((_, at) => at !== index))}
            >
              Sil
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            setItems((current) => [
              ...current,
              { label: '', required: true, key: crypto.randomUUID() },
            ])
          }
        >
          Madde ekle
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}
