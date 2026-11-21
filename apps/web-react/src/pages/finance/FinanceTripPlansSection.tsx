import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation, useSearchParams } from 'react-router'
import {
  useTripPlan,
  useTripPlanNotice,
  useTripPlanNoteStep,
  useTripPlanReasonStep,
  useTripPlans,
  type TripPlanDetail,
  type TripPlanNoteStep,
  type TripPlanReasonStep,
} from '@kampus/react-shared/use-finance-trip-plans.ts'
import { PAID_ACTIVITY_KIND_LABELS } from '@kampus/school-core/lib/finance-paid-activities.ts'
import { dateLabel, dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  TRIP_PLAN_EVENT_LABELS,
  TRIP_PLAN_STATES,
  TRIP_PLAN_STATUS_LABELS,
  TRIP_PLAN_STATUSES,
  TRIP_STAFF_ROLE_LABELS,
  TRIP_TRANSPORT_TYPE_LABELS,
  tripPlateLabel,
  tripStaffRatioMessage,
  type TripPlanState,
  type TripPlanStatus,
} from '@kampus/school-core/lib/finance-trip-plans.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useTripPlanPdf } from '@/hooks/use-finance-trip-plan-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { TRIP_PLAN_TITLE } from '@/lib/pdf/templates/finance-trip-plan.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import { FinanceTripDayView } from './FinanceTripDaySection.tsx'
import { TripPlanFormModal } from './FinanceTripPlanForm.tsx'
import {
  noticeBody,
  noticeFormSchema,
  reasonFormSchema,
  TRIP_PLAN_STATUS_VIEW,
  type NoticeFormValues,
  type ReasonFormValues,
} from './finance-trip-plan-forms.ts'

/** Ayrıntı paneli adres parametresi (`?gezi=`). */
export const TRIP_PLAN_PANEL = 'gezi'
/** Panel sekmesi (`?gezi_sekme=gun`; DOM-FIN-154): plan bilgisi ya da "Gezi günü". */
const PANEL_TAB = 'gezi_sekme'
const PANEL_CLEARS = [PANEL_TAB] as const
type PanelTab = 'plan' | 'gun'
const PANEL_TABS = [
  { value: 'plan', label: 'Plan' },
  { value: 'gun', label: 'Gezi günü' },
] as const satisfies readonly { value: PanelTab; label: string }[]

const NO_SORT: readonly string[] = []
const MOBILE = ['number', 'name', 'status']
const STATE_LABELS: Record<TripPlanState, string> = {
  active: 'Sürenler',
  done: 'Tamamlanan ve iptal edilen',
}
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is TripPlanStatus =>
  TRIP_PLAN_STATUSES.some((status) => status === value)
const isState = (value: string | null): value is TripPlanState =>
  TRIP_PLAN_STATES.some((state) => state === value)
const moment = (iso: string) => `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

type Row = {
  id: string
  number: string
  name: string
  departure: string
  leads: string
  students: string
  status: TripPlanStatus
  notice: string
}

/**
 * Gezi planları (`?gorunum=gezi-plani`; DOM-FIN-111, ON-155). Yönetici ve ön büro planı taslak
 * yazar, düzeltir ve onaya gönderir; onay, ret ve tamamlama yöneticidedir (K-367). Ayrıntı paneli
 * (`?gezi=`) planın bütün bilgisini, geçmişini, rolün geçişlerini, millî eğitim bildirimi işaretini
 * (K-368) ve onay dosyası PDF'ini verir. Liste ad ve numarada aranır, durum ve dönem süzgeçlidir.
 */
export function FinanceTripPlansSection() {
  const list = useListState('gezi-planlari', { urlPrefix: 'gezi_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const state = text(list.state.filters.state)
  const plans = useTripPlans({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(isState(state) ? { state } : {}),
  })
  const panel = useDetailPanel(TRIP_PLAN_PANEL, PANEL_CLEARS)
  const openPlan = panel.open
  const [creating, setCreating] = useState(false)

  const filters = useMemo(
    () => [
      {
        key: 'state',
        label: 'Dönem',
        type: 'select' as const,
        options: TRIP_PLAN_STATES.map((value) => ({ value, label: STATE_LABELS[value] })),
      },
      {
        key: 'status',
        label: 'Durum',
        type: 'select' as const,
        options: TRIP_PLAN_STATUSES.map((value) => ({
          value,
          label: TRIP_PLAN_STATUS_LABELS[value],
        })),
      },
    ],
    [],
  )
  const rows = useMemo(
    () =>
      plans.data?.data.map((item): Row => ({
        id: item.id,
        number: item.number,
        name: item.name,
        departure: moment(item.departureAt),
        leads: item.leadNames.join(', ') || '—',
        students: `${String(item.expectedStudentCount)} öğrenci · ${String(item.staffCount)} görevli${item.ratioWarning ? ' (görevli az)' : ''}`,
        status: item.status,
        notice: item.authorityNotifiedOn ? dayText(item.authorityNotifiedOn) : '—',
      })),
    [plans.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'number', label: 'No' },
      { key: 'name', label: 'Gezi' },
      { key: 'departure', label: 'Çıkış' },
      { key: 'leads', label: 'Sorumlu' },
      { key: 'students', label: 'Katılım' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={TRIP_PLAN_STATUS_VIEW[row.status].label}
            tone={TRIP_PLAN_STATUS_VIEW[row.status].tone}
          />
        ),
      },
      { key: 'notice', label: 'MEB bildirimi' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.number} ayrıntısını aç`}
            onClick={() => openPlan(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openPlan],
  )

  return (
    <section
      aria-labelledby="gezi-planlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="gezi-planlari" className="text-lg font-semibold">
            Gezi planları
          </h2>
          <p className="text-sm text-muted-foreground">
            Gezi planı, risk değerlendirmesi ve müdürlük onayı; il/ilçe millî eğitim bildirimi elle
            işaretlenir.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Yeni gezi planı
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={plans.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={MOBILE}
        caption="Gezi planları"
        empty="Henüz gezi planı yok."
        emptyFiltered="Bu seçimle eşleşen plan yok."
        loading={plans.isPending}
        fetching={plans.isFetching && !plans.isPending}
        error={
          plans.error ? (
            <QueryError error={plans.error} onRetry={() => void plans.refetch()} />
          ) : undefined
        }
      />
      {creating ? (
        <TripPlanFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            openPlan(id)
          }}
        />
      ) : null}
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Gezi planı"
      >
        {panel.selectedId ? <TripPlanPanel planId={panel.selectedId} /> : null}
      </SidePanel>
    </section>
  )
}

/**
 * Plan paneli iki sekmedir: plan ayrıntısı ve "Gezi günü" (grup, dağıtım, yoklama ve acil kart;
 * DOM-FIN-154, ON-157). Sekme adreste tutulur; geri/ileri ve yenileme sekmeyi korur.
 */
function TripPlanPanel({ planId }: { planId: string }) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const tab: PanelTab = params.get(PANEL_TAB) === 'gun' ? 'gun' : 'plan'
  const select = (next: PanelTab) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next === 'plan') updated.delete(PANEL_TAB)
        else updated.set(PANEL_TAB, next)
        return updated
      },
      // Panel işareti korunur: kapatma yine bir adım geri gider.
      { replace: true, preventScrollReset: true, state: location.state },
    )
  return (
    <div className="grid gap-5">
      <LineTabs label="Plan görünümü" value={tab} options={PANEL_TABS} onChange={select} />
      {tab === 'plan' ? (
        <TripPlanDetailView planId={planId} />
      ) : (
        <FinanceTripDayView planId={planId} />
      )}
    </div>
  )
}

/** Planın ayrıntısı: bilgiler, onay dosyası PDF'i, rolün geçişleri ve plan geçmişi. */
function TripPlanDetailView({ planId }: { planId: string }) {
  const item = useTripPlan(planId)
  const [editing, setEditing] = useState(false)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const plan = item.data?.data
  if (!plan) return <SummaryLoading />
  const { actions } = plan
  return (
    <div className="grid gap-6">
      <section aria-labelledby="gezi-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="gezi-bilgileri" className="text-base font-semibold [overflow-wrap:anywhere]">
            {plan.number} · {plan.name}
          </h3>
          <StatusBadge
            text={TRIP_PLAN_STATUS_VIEW[plan.status].label}
            tone={TRIP_PLAN_STATUS_VIEW[plan.status].tone}
          />
        </div>
        <TripPlanFacts plan={plan} />
        <div className="flex flex-wrap gap-2">
          <PdfDialogButton
            label="Onay dosyası PDF"
            title={TRIP_PLAN_TITLE}
            id={plan.id}
            usePdf={useTripPlanPdf}
          />
          {actions.edit ? (
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              <Icon name="Pencil" size={16} aria-hidden="true" />
              Düzenle
            </Button>
          ) : null}
        </div>
      </section>
      {actions.submit ? (
        <NoteStep
          plan={plan}
          step="submit"
          title="Onaya gönder"
          button="Onaya gönder"
          done="Plan onaya gönderildi."
        />
      ) : null}
      {actions.approve ? (
        <NoteStep
          plan={plan}
          step="approve"
          title="Onayla"
          button="Planı onayla"
          done="Plan onaylandı."
        />
      ) : null}
      {actions.reject ? (
        <ReasonStep
          plan={plan}
          step="reject"
          title="Reddet"
          button="Planı reddet"
          done="Plan reddedildi."
        />
      ) : null}
      {actions.notify ? <NoticeForm plan={plan} /> : null}
      {actions.complete ? (
        <NoteStep
          plan={plan}
          step="complete"
          title="Tamamla"
          button="Geziyi tamamla"
          done="Gezi tamamlandı."
        />
      ) : null}
      {actions.cancel ? (
        <ReasonStep
          plan={plan}
          step="cancel"
          title="İptal et"
          button="Planı iptal et"
          done="Plan iptal edildi."
        />
      ) : null}
      <TripPlanHistory plan={plan} />
      {editing ? (
        <TripPlanFormModal
          plan={plan}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
    </div>
  )
}

function FactList({
  pairs,
  label,
}: {
  pairs: readonly (readonly [string, string])[]
  label?: string
}) {
  return (
    <dl aria-label={label} className="grid gap-2 text-sm">
      {pairs.map(([name, value]) => (
        <div
          key={name}
          className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2 max-[480px]:grid-cols-1"
        >
          <dt className="text-muted-foreground">{name}</dt>
          <dd className="[overflow-wrap:anywhere] whitespace-pre-line">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function TripPlanFacts({ plan }: { plan: TripPlanDetail }) {
  const transport = plan.transport
  const ratio = tripStaffRatioMessage(plan.expectedStudentCount, plan.staff.length)
  return (
    <div className="grid gap-4">
      <FactList
        pairs={[
          ['Çıkış', moment(plan.departureAt)],
          ['Dönüş', moment(plan.returnAt)],
          ['Öğrenci', String(plan.expectedStudentCount)],
          [
            'Ücretli etkinlik',
            plan.paidActivity
              ? `${plan.paidActivity.name} · ${PAID_ACTIVITY_KIND_LABELS[plan.paidActivity.kind]} · ${dayText(plan.paidActivity.activityDate)}`
              : 'Ücretsiz gezi',
          ],
          ['Amaç ve kazanım', plan.purpose],
          [
            'Güzergâh',
            plan.stops
              .map(
                (stop, index) =>
                  `${String(index + 1)}. ${stop.place}${stop.note ? ` (${stop.note})` : ''}`,
              )
              .join('\n'),
          ],
          [
            'Görevliler',
            plan.staff
              .map(
                (member) => `${member.name ?? 'Görevli'} · ${TRIP_STAFF_ROLE_LABELS[member.role]}`,
              )
              .join('\n'),
          ],
          [
            'Ulaşım',
            [
              TRIP_TRANSPORT_TYPE_LABELS[transport.type],
              transport.company,
              transport.plate === null ? null : tripPlateLabel(transport.plate),
              transport.driverName === null
                ? null
                : `Sürücü: ${transport.driverName}${transport.driverPhone ? ` (${transport.driverPhone})` : ''}`,
              transport.documentFile ? `Belge: ${transport.documentFile.name}` : null,
            ]
              .filter((part): part is string => part !== null)
              .join(' · '),
          ],
          [
            'Riskler',
            plan.risks.length === 0
              ? 'Eklenmedi'
              : plan.risks
                  .map((risk, index) => `${String(index + 1)}. ${risk.risk} → ${risk.measure}`)
                  .join('\n'),
          ],
          [
            'Acil iletişim',
            plan.emergencyContacts.length === 0
              ? 'Eklenmedi'
              : plan.emergencyContacts
                  .map(
                    (contact) =>
                      `${contact.name}${contact.relation ? ` (${contact.relation})` : ''} · ${contact.phone}`,
                  )
                  .join('\n'),
          ],
          ...(plan.approvedAt
            ? ([
                [
                  'Onay',
                  `${moment(plan.approvedAt)}${plan.approvedByName ? ` · ${plan.approvedByName}` : ''}`,
                ],
              ] as const)
            : []),
          ...(plan.rejectionReason ? ([['Ret gerekçesi', plan.rejectionReason]] as const) : []),
          ...(plan.authorityNotifiedOn
            ? ([
                [
                  'MEB bildirimi',
                  `${dayText(plan.authorityNotifiedOn)}${plan.authorityReference ? ` · ${plan.authorityReference}` : ''}`,
                ],
              ] as const)
            : []),
          ...(plan.cancelReason ? ([['İptal gerekçesi', plan.cancelReason]] as const) : []),
        ]}
      />
      {ratio ? (
        <p role="status" className="rounded-sm border px-3 py-2 text-sm">
          {ratio}
        </p>
      ) : null}
    </div>
  )
}

function TripPlanHistory({ plan }: { plan: TripPlanDetail }) {
  return (
    <section aria-labelledby="gezi-gecmis" className="grid gap-2 border-t pt-4">
      <h3 id="gezi-gecmis" className="text-base font-semibold">
        Plan geçmişi
      </h3>
      <ol aria-label="Plan geçmişi" className="grid gap-2 text-sm">
        {plan.events.map((event) => (
          <li key={event.id} className="grid gap-1 rounded-sm border px-3 py-2">
            <span className="font-medium">{TRIP_PLAN_EVENT_LABELS[event.event]}</span>
            <span className="text-muted-foreground">
              {moment(event.occurredAt)}
              {event.actorName ? ` · ${event.actorName}` : ''}
            </span>
            {event.note ? <span className="[overflow-wrap:anywhere]">{event.note}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Onaya gönderme, onay ve tamamlama: isteğe bağlı not. */
function NoteStep({
  plan,
  step,
  title,
  button,
  done,
}: {
  plan: TripPlanDetail
  step: TripPlanNoteStep
  title: string
  button: string
  done: string
}) {
  const command = useTripPlanNoteStep(step)
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const id = `gezi-${step}`
  const onSubmit = async () => {
    setProblem(null)
    const trimmed = note.trim()
    const outcome = await command.submit(
      { planId: plan.id, version: plan.version, body: { note: trimmed === '' ? null : trimmed } },
      { setError: (_name, error) => setProblem(error.message) },
    )
    if (outcome.status === 'success') {
      setNote('')
      notify.success(done)
    }
  }
  return (
    <section aria-labelledby={id} className="grid gap-3 border-t pt-4">
      <h3 id={id} className="text-base font-semibold">
        {title}
      </h3>
      <form
        noValidate
        aria-label={title}
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void onSubmit()
        }}
      >
        <FormField id={`${id}-not`} label="Not (isteğe bağlı)">
          {(control) => (
            <Textarea
              {...control}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={500}
              disabled={command.isPending}
            />
          )}
        </FormField>
        <RootError message={problem ?? undefined} />
        <div>
          <Button
            type="submit"
            disabled={command.isPending}
            aria-busy={command.isPending || undefined}
          >
            {button}
          </Button>
        </div>
      </form>
    </section>
  )
}

/** Ret ve iptal: gerekçe zorunlu. */
function ReasonStep({
  plan,
  step,
  title,
  button,
  done,
}: {
  plan: TripPlanDetail
  step: TripPlanReasonStep
  title: string
  button: string
  done: string
}) {
  const command = useTripPlanReasonStep(step)
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = command.isPending || form.formState.isSubmitting
  const id = `gezi-${step}`
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await command.submit(
      { planId: plan.id, version: plan.version, body: { reason: values.reason.trim() } },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      form.reset()
      notify.success(done)
    }
  })
  return (
    <section aria-labelledby={id} className="grid gap-3 border-t pt-4">
      <h3 id={id} className="text-base font-semibold">
        {title}
      </h3>
      <form
        noValidate
        aria-label={title}
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField
          id={`${id}-gerekce`}
          label={step === 'reject' ? 'Ret gerekçesi' : 'İptal gerekçesi'}
          error={errors.reason}
        >
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div>
          <Button
            type="submit"
            variant={step === 'cancel' ? 'destructive' : 'secondary'}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {button}
          </Button>
        </div>
      </form>
    </section>
  )
}

/** Millî eğitim bildirimi işareti (K-368): gün ve isteğe bağlı evrak sayısı. */
function NoticeForm({ plan }: { plan: TripPlanDetail }) {
  const notice = useTripPlanNotice()
  const form = useForm<NoticeFormValues>({
    resolver: zodResolver(noticeFormSchema),
    defaultValues: {
      notifiedOn: plan.authorityNotifiedOn ?? dayKey(),
      reference: plan.authorityReference ?? '',
    },
  })
  const errors = form.formState.errors
  const busy = notice.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await notice.submit(
      { planId: plan.id, version: plan.version, body: noticeBody(values) },
      {
        setError: (name, error) => {
          if (name === 'notifiedOn' || name === 'reference')
            form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success('Millî eğitim bildirimi işaretlendi.')
  })
  return (
    <section aria-labelledby="gezi-bildirim" className="grid gap-3 border-t pt-4">
      <h3 id="gezi-bildirim" className="text-base font-semibold">
        Millî eğitim bildirimi
      </h3>
      <p className="text-sm text-muted-foreground">
        İl/ilçe millî eğitim müdürlüğüne bildirim sistemden gönderilmez; yapıldıktan sonra burada
        işaretleyin.
      </p>
      <form
        noValidate
        aria-label="Bildirimi işaretle"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="gezi-bildirim-gun" label="Bildirim günü" error={errors.notifiedOn}>
          {(control) => (
            <Input {...control} type="date" {...form.register('notifiedOn')} disabled={busy} />
          )}
        </FormField>
        <FormField
          id="gezi-bildirim-sayi"
          label="Evrak sayısı (isteğe bağlı)"
          error={errors.reference}
        >
          {(control) => <Input {...control} {...form.register('reference')} disabled={busy} />}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div>
          <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy || undefined}>
            Bildirimi işaretle
          </Button>
        </div>
      </form>
    </section>
  )
}
