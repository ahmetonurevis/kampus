import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { useFixedAssetAssignees } from '@kampus/react-shared/use-finance-fixed-asset-assignments.ts'
import {
  useAssignMaintenance,
  useCancelMaintenance,
  useCloseMaintenance,
  useMaintenanceRequest,
  useResolveMaintenance,
  useStartMaintenance,
  type MaintenanceRequestDetail,
} from '@kampus/react-shared/use-finance-maintenance-requests.ts'
import { useSuppliers } from '@kampus/react-shared/use-finance-procurement.ts'
import {
  MAINTENANCE_ASSIGNEE_TYPE_LABELS,
  MAINTENANCE_ASSIGNEE_TYPES,
  MAINTENANCE_EVENT_LABELS,
  MAINTENANCE_PRIORITY_LABELS,
} from '@kampus/school-core/lib/finance-maintenance-requests.ts'
import { dateLabel, dayKey, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useMaintenanceWorkOrderPdf } from '@/hooks/use-finance-maintenance-work-order-pdf.ts'
import { MAINTENANCE_WORK_ORDER_TITLE } from '@/lib/pdf/templates/finance-maintenance-work-order.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import { assigneeOptionLabel } from './finance-fixed-asset-assignment-forms.ts'
import {
  assignBody,
  assignDefaults,
  assigneeText,
  assignFormField,
  assignFormSchema,
  cancelFormSchema,
  MAINTENANCE_STATUS_VIEW,
  noteBody,
  noteFormSchema,
  resolveBody,
  resolveDefaults,
  resolveFormField,
  resolveFormSchema,
  type AssignFormValues,
  type CancelFormValues,
  type NoteFormValues,
  type ResolveFormValues,
} from './finance-maintenance-forms.ts'

const OPTION_PAGE = { page: 1, pageSize: 100 } as const
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const moment = (iso: string) => `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`

type Request = MaintenanceRequestDetail

/**
 * Arıza talebinin ayrıntısı (DOM-FIN-089): bilgiler, iş emri PDF'i, rolün yapabileceği geçişler
 * (`actions`; sunucu aynı kuralları yeniden denetler) ve silinmeyen iş emri geçmişi (K-237).
 */
export function MaintenanceDetailView({ requestId }: { requestId: string }) {
  const item = useMaintenanceRequest(requestId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const request = item.data?.data
  if (!request) return <SummaryLoading />
  const { actions } = request
  return (
    <div className="grid gap-6">
      <section aria-labelledby="ariza-bilgileri" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="ariza-bilgileri" className="text-base font-semibold [overflow-wrap:anywhere]">
            {request.number} · {request.title}
          </h3>
          <StatusBadge
            text={MAINTENANCE_STATUS_VIEW[request.status].label}
            tone={MAINTENANCE_STATUS_VIEW[request.status].tone}
          />
        </div>
        <MaintenanceFacts request={request} />
        <div>
          <PdfDialogButton
            label="İş emri PDF"
            title={MAINTENANCE_WORK_ORDER_TITLE}
            id={request.id}
            usePdf={useMaintenanceWorkOrderPdf}
          />
        </div>
      </section>
      {actions.assign ? <AssignForm request={request} /> : null}
      {actions.start ? (
        <NoteStep
          request={request}
          kind="start"
          title="İşe başla"
          button="İşe başla"
          done="İşe başlandı."
        />
      ) : null}
      {actions.resolve ? <ResolveForm request={request} /> : null}
      {actions.close ? (
        <NoteStep
          request={request}
          kind="close"
          title="Kapat"
          button="Talebi kapat"
          done="Talep kapatıldı."
        />
      ) : null}
      {actions.cancel ? <CancelForm request={request} /> : null}
      <MaintenanceHistory request={request} />
    </div>
  )
}

function MaintenanceFacts({ request }: { request: Request }) {
  const pairs: [string, string][] = [
    ['Öncelik', MAINTENANCE_PRIORITY_LABELS[request.priority]],
    ['Bildiren', request.reportedByName ?? '—'],
    ['Bildirim', moment(request.reportedAt)],
    ['Kampüs', request.campusName ?? '—'],
    ['Yer', request.location],
    ['Demirbaş', request.asset ? `${request.asset.tagNumber} · ${request.asset.name}` : '—'],
    ['Sorumlu', assigneeText(request.assignee)],
    ['Açıklama', request.description],
    ...(request.resolvedDate !== null
      ? ([
          ['Çözüm günü', dayText(request.resolvedDate)],
          ['Yapılan iş', request.resolution ?? '—'],
          ['Tedarikçi', request.resolutionSupplier?.name ?? '—'],
        ] as [string, string][])
      : []),
    // Maliyet anahtarı yalnız yönetici yanıtında bulunur (K-238).
    ...(request.resolvedDate !== null && 'resolutionCostCents' in request
      ? ([
          [
            'Maliyet',
            request.resolutionCostCents == null ? '—' : money(request.resolutionCostCents),
          ],
        ] as [string, string][])
      : []),
    ...(request.cancelReason !== null
      ? ([['İptal gerekçesi', request.cancelReason]] as [string, string][])
      : []),
  ]
  return (
    <dl className="grid gap-2 text-sm">
      {pairs.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2 max-[480px]:grid-cols-1"
        >
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="[overflow-wrap:anywhere] whitespace-pre-line">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function MaintenanceHistory({ request }: { request: Request }) {
  return (
    <section aria-labelledby="ariza-gecmis" className="grid gap-2 border-t pt-4">
      <h3 id="ariza-gecmis" className="text-base font-semibold">
        İş emri geçmişi
      </h3>
      <ol aria-label="İş emri geçmişi" className="grid gap-2 text-sm">
        {request.events.map((event) => (
          <li key={event.id} className="grid gap-1 rounded-sm border px-3 py-2">
            <span className="font-medium">
              {MAINTENANCE_EVENT_LABELS[event.event]}
              {event.assignee ? ` · ${assigneeText(event.assignee)}` : ''}
            </span>
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

/** Atama (K-237): kurumun etkin personeli ya da etkin tedarikçisi; yeniden atama da buradadır. */
function AssignForm({ request }: { request: Request }) {
  const assign = useAssignMaintenance()
  const staff = useFixedAssetAssignees({ ...OPTION_PAGE, status: 'active' })
  const suppliers = useSuppliers({ ...OPTION_PAGE, status: 'active' })
  const form = useForm<AssignFormValues>({
    resolver: zodResolver(assignFormSchema),
    defaultValues: assignDefaults(request.assignee),
  })
  const errors = form.formState.errors
  const busy = assign.isPending || form.formState.isSubmitting
  const type = useWatch({ control: form.control, name: 'assigneeType' })
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await assign.submit(
      { requestId: request.id, version: request.version, body: assignBody(values) },
      {
        setError: (name, error) => {
          const field = assignFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success')
      notify.success(`${request.number} ${assigneeText(outcome.data.data.assignee)} adına atandı.`)
  })
  const title = request.assignee ? 'Sorumluyu değiştir' : 'Ata'
  return (
    <section aria-labelledby="ariza-ata" className="grid gap-3 border-t pt-4">
      <h3 id="ariza-ata" className="text-base font-semibold">
        {title}
      </h3>
      <form
        noValidate
        aria-label="İş emrini ata"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="ariza-sorumlu-tur" label="Sorumlu türü" error={errors.assigneeType}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('assigneeType')}
              className="w-full"
              disabled={busy}
            >
              {MAINTENANCE_ASSIGNEE_TYPES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {MAINTENANCE_ASSIGNEE_TYPE_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {type === 'staff' ? (
          <FormField id="ariza-personel" label="Personel" error={errors.membershipId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('membershipId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">
                  {staff.isPending ? 'Personel yükleniyor…' : 'Personel seçin'}
                </NativeSelectOption>
                {(staff.data?.data ?? []).map((item) => (
                  <NativeSelectOption key={item.membershipId} value={item.membershipId}>
                    {assigneeOptionLabel(item)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : (
          <FormField id="ariza-tedarikci" label="Tedarikçi" error={errors.supplierId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('supplierId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">
                  {suppliers.isPending ? 'Tedarikçiler yükleniyor…' : 'Tedarikçi seçin'}
                </NativeSelectOption>
                {(suppliers.data?.data ?? []).map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        )}
        <FormField id="ariza-ata-not" label="Not (isteğe bağlı)" error={errors.note}>
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            {request.assignee ? 'Yeniden ata' : 'Ata'}
          </Button>
        </div>
      </form>
    </section>
  )
}

/** Başlatma ve kapatma: isteğe bağlı notla tek adım. */
function NoteStep({
  request,
  kind,
  title,
  button,
  done,
}: {
  request: Request
  kind: 'start' | 'close'
  title: string
  button: string
  done: string
}) {
  const start = useStartMaintenance()
  const closeRequest = useCloseMaintenance()
  const command = kind === 'start' ? start : closeRequest
  const form = useForm<NoteFormValues>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: { note: '' },
  })
  const errors = form.formState.errors
  const busy = command.isPending || form.formState.isSubmitting
  const id = `ariza-${kind}`
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await command.submit(
      { requestId: request.id, version: request.version, body: noteBody(values) },
      {
        setError: (name, error) => {
          if (name === 'note') form.setError('note', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success(`${request.number}: ${done}`)
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
        <FormField id={`${id}-not`} label="Not (isteğe bağlı)" error={errors.note}>
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            {button}
          </Button>
        </div>
      </form>
    </section>
  )
}

/** Çözüm (K-237): gün, yapılan iş, isteğe bağlı maliyet ve tedarikçi; maliyeti yalnız yönetici görür. */
function ResolveForm({ request }: { request: Request }) {
  const resolve = useResolveMaintenance()
  const suppliers = useSuppliers(OPTION_PAGE)
  const form = useForm<ResolveFormValues>({
    resolver: zodResolver(resolveFormSchema),
    defaultValues: resolveDefaults(request.assignee, dayKey()),
  })
  const errors = form.formState.errors
  const busy = resolve.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await resolve.submit(
      { requestId: request.id, version: request.version, body: resolveBody(values) },
      {
        setError: (name, error) => {
          const field = resolveFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success(`${request.number} çözüldü.`)
  })
  return (
    <section aria-labelledby="ariza-coz" className="grid gap-3 border-t pt-4">
      <h3 id="ariza-coz" className="text-base font-semibold">
        Çöz
      </h3>
      <form
        noValidate
        aria-label="İş emrini çöz"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="ariza-coz-gun" label="Çözüm günü" error={errors.resolvedDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('resolvedDate')} disabled={busy} />
          )}
        </FormField>
        <FormField id="ariza-coz-is" label="Yapılan iş" error={errors.resolution}>
          {(control) => (
            <Textarea {...control} {...form.register('resolution')} rows={3} disabled={busy} />
          )}
        </FormField>
        <FormField
          id="ariza-coz-maliyet"
          label="Maliyet (₺, isteğe bağlı)"
          error={errors.cost}
          description="KDV dahil; yalnız yönetici görür."
        >
          {(control) => (
            <Input {...control} inputMode="decimal" {...form.register('cost')} disabled={busy} />
          )}
        </FormField>
        <FormField
          id="ariza-coz-tedarikci"
          label="İşi yapan tedarikçi (isteğe bağlı)"
          error={errors.supplierId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('supplierId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Tedarikçi yok (kurum içi)</NativeSelectOption>
              {(suppliers.data?.data ?? []).map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            Çözüldü olarak işaretle
          </Button>
        </div>
      </form>
    </section>
  )
}

/** İptal (K-237): gerekçe zorunlu; bildiren yalnız kendi atanmamış talebini iptal eder. */
function CancelForm({ request }: { request: Request }) {
  const cancel = useCancelMaintenance()
  const form = useForm<CancelFormValues>({
    resolver: zodResolver(cancelFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { requestId: request.id, version: request.version, body: { reason: values.reason.trim() } },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success(`${request.number} iptal edildi.`)
  })
  return (
    <section aria-labelledby="ariza-iptal" className="grid gap-3 border-t pt-4">
      <h3 id="ariza-iptal" className="text-base font-semibold">
        İptal et
      </h3>
      <form
        noValidate
        aria-label="Talebi iptal et"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="ariza-iptal-gerekce" label="İptal gerekçesi" error={errors.reason}>
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div>
          <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
            Talebi iptal et
          </Button>
        </div>
      </form>
    </section>
  )
}
