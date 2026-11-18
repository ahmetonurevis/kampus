import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  useCancelPaidActivity,
  useCreatePaidActivity,
  usePaidActivities,
  type PaidActivityRow,
} from '@kampus/react-shared/use-finance-paid-activities.ts'
import { useAllPermissionForms } from '@kampus/react-shared/use-permission-forms.ts'
import {
  LATE_REFUND_RULE_LABELS,
  LATE_REFUND_RULES,
  PAID_ACTIVITY_KIND_LABELS,
  PAID_ACTIVITY_KINDS,
  PAID_ACTIVITY_STATUS_LABELS,
  type LateRefundRule,
  type PaidActivityKind,
} from '@kampus/school-core/lib/finance-paid-activities.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { ParticipantsPanel } from './FinancePaidActivityParticipants.tsx'

/**
 * Gezi ve etkinlik ücretleri (DOM-FIN-098; ON-142; K-300…K-303). Yönetici ücretli gezi ya da
 * etkinliği tanımlar ve iptal eder; yönetici ve ön büro öğrenciyi yazar (öğrenciye taksit açılır,
 * veli ekranında borç görünür), katılımcıların ödeme durumunu izler ve katılımı iptal eder. İade
 * kuralı etkinlikte tanımlıdır; iadeyi yönetici öder ve gün sonuna girer. Bilet ve oturma düzeni
 * bu ekranın işi değildir.
 */

const NO_SORT: readonly string[] = []
const ACTIVITY_MOBILE = ['name', 'activityDate', 'status']
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

type ActivityRow = PaidActivityRow & Record<string, unknown>

export function FinancePaidActivitiesSection({ isManager }: { isManager: boolean }) {
  const list = useListState('gezi-etkinlik')
  const activities = usePaidActivities({ page: list.state.page, pageSize: list.state.pageSize })
  const [selectedId, setSelectedId] = useState('')
  const [creating, setCreating] = useState(false)
  const [cancelling, setCancelling] = useState<PaidActivityRow | null>(null)
  const rows = useMemo(
    () => activities.data?.data.map((item): ActivityRow => ({ ...item })),
    [activities.data],
  )
  const selected = activities.data?.data.find((item) => item.id === selectedId)
  const columns = useMemo<DataColumn<ActivityRow>[]>(
    () => [
      { key: 'name', label: 'Etkinlik', cell: (row) => row.name },
      { key: 'kind', label: 'Tür', cell: (row) => PAID_ACTIVITY_KIND_LABELS[row.kind] },
      { key: 'activityDate', label: 'Gün', cell: (row) => dayText(row.activityDate) },
      { key: 'feeCents', label: 'Kişi başı', cell: (row) => money(row.feeCents) },
      {
        key: 'participantCount',
        label: 'Katılımcı',
        cell: (row) =>
          `${String(row.participantCount)} / ${String(row.capacity)}${row.waitlistCount > 0 ? ` · ${String(row.waitlistCount)} yedek` : ''}`,
      },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={
              row.pendingRefundCount > 0 && row.status === 'cancelled'
                ? `${PAID_ACTIVITY_STATUS_LABELS[row.status]} · ${String(row.pendingRefundCount)} iade`
                : PAID_ACTIVITY_STATUS_LABELS[row.status]
            }
            tone={row.status === 'open' ? 'green' : 'gray'}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.name} katılımcıları`}
              aria-pressed={row.id === selectedId}
              onClick={() => setSelectedId(row.id)}
            >
              Katılımcılar
            </Button>
            {isManager && row.status === 'open' ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.name} etkinliğini iptal et`}
                onClick={() => setCancelling(row)}
              >
                İptal et
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [isManager, selectedId],
  )
  return (
    <div className="grid gap-6">
      <section
        aria-labelledby="gezi-etkinlik-baslik"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
          <div>
            <h2 id="gezi-etkinlik-baslik" className="text-lg font-semibold">
              Gezi ve etkinlik ücretleri
            </h2>
            <p className="text-sm text-muted-foreground">
              Katılım öğrenciye ayrı bir taksit açar ve veli ekranında borç olarak görünür. İptalde
              iade, etkinlikte tanımlı kurala göre hesaplanır.
            </p>
          </div>
          {isManager ? (
            <Button onClick={() => setCreating(true)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Etkinlik tanımla
            </Button>
          ) : null}
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={activities.data?.meta.total ?? 0}
          sortable={NO_SORT}
          columns={columns}
          mobileColumns={ACTIVITY_MOBILE}
          caption="Gezi ve etkinlikler"
          search={false}
          empty="Henüz ücretli gezi ya da etkinlik yok."
          loading={activities.isPending}
          fetching={activities.isFetching && !activities.isPending}
          error={
            activities.error ? (
              <QueryError error={activities.error} onRetry={() => void activities.refetch()} />
            ) : undefined
          }
        />
      </section>
      {selected ? <ParticipantsPanel activity={selected} isManager={isManager} /> : null}
      {creating ? <CreateActivityModal onClose={() => setCreating(false)} /> : null}
      {cancelling ? (
        <CancelActivityModal activity={cancelling} onClose={() => setCancelling(null)} />
      ) : null}
    </div>
  )
}

function ModalFooter({
  busy,
  form,
  submit,
  onClose,
}: {
  busy: boolean
  form: string
  submit: string
  onClose: () => void
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Vazgeç
      </Button>
      <Button type="submit" form={form} disabled={busy} aria-busy={busy || undefined}>
        {submit}
      </Button>
    </>
  )
}

function RootError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  ) : null
}

interface ActivityForm {
  name: string
  kind: PaidActivityKind
  activityDate: string
  fee: string
  joinDeadline: string
  cancelDeadline: string
  capacity: string
  lateRefundRule: LateRefundRule
  lateRefundPercent: string
  lateCost: string
  externalRef: string
  requiresConsent: boolean
  permissionFormId: string
}
type ActivityField = keyof ActivityForm
const SERVER_FIELDS: Readonly<Record<string, ActivityField>> = {
  name: 'name',
  kind: 'kind',
  activityDate: 'activityDate',
  feeCents: 'fee',
  joinDeadline: 'joinDeadline',
  cancelDeadline: 'cancelDeadline',
  capacity: 'capacity',
  lateRefundRule: 'lateRefundRule',
  lateRefundPercent: 'lateRefundPercent',
  lateCostCents: 'lateCost',
  externalRef: 'externalRef',
  requiresConsent: 'requiresConsent',
  permissionFormId: 'permissionFormId',
}

function CreateActivityModal({ onClose }: { onClose: () => void }) {
  const create = useCreatePaidActivity()
  const [today] = useState(() => dayKey(Date.now()))
  const form = useForm<ActivityForm>({
    defaultValues: {
      name: '',
      kind: 'trip',
      activityDate: today,
      fee: '',
      joinDeadline: today,
      cancelDeadline: today,
      capacity: '30',
      lateRefundRule: 'percent',
      lateRefundPercent: '0',
      lateCost: '',
      externalRef: '',
      requiresConsent: false,
      permissionFormId: '',
    },
  })
  const rule = useWatch({ control: form.control, name: 'lateRefundRule' })
  const requiresConsent = useWatch({ control: form.control, name: 'requiresConsent' })
  const forms = useAllPermissionForms({ status: 'open' }, { enabled: requiresConsent })
  const busy = create.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const feeCents = parseAmountInput(values.fee)
    if (feeCents === null) {
      form.setError('fee', { message: 'Geçerli bir tutar girin (ör. 1.500,00).' })
      return
    }
    const lateCostCents =
      values.lateRefundRule === 'cost'
        ? parseAmountInput(values.lateCost, { allowZero: true })
        : null
    if (values.lateRefundRule === 'cost' && lateCostCents === null) {
      form.setError('lateCost', { message: 'Geçerli bir tutar girin.' })
      return
    }
    const outcome = await create.submit(
      {
        name: values.name,
        kind: values.kind,
        activityDate: values.activityDate,
        feeCents,
        joinDeadline: values.joinDeadline,
        cancelDeadline: values.cancelDeadline,
        capacity: Number(values.capacity),
        lateRefundRule: values.lateRefundRule,
        lateRefundPercent:
          values.lateRefundRule === 'percent' ? Number(values.lateRefundPercent) : null,
        lateCostCents,
        externalRef: values.externalRef.trim() === '' ? null : values.externalRef.trim(),
        requiresConsent: values.requiresConsent,
        permissionFormId:
          values.requiresConsent && values.permissionFormId !== '' ? values.permissionFormId : null,
      },
      {
        setError: (name, error) => {
          const target = SERVER_FIELDS[name]
          if (target) form.setError(target, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Etkinlik tanımlandı.')
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ücretli gezi ya da etkinlik"
      description="Ücret, gün ve iade kuralı katılımcıları bağladığı için kaydedildikten sonra değişmez."
      footer={
        <ModalFooter busy={busy} form="gezi-etkinlik-formu" submit="Kaydet" onClose={onClose} />
      }
    >
      <form
        id="gezi-etkinlik-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4 sm:grid-cols-2"
      >
        <FormField id="gezi-ad" label="Ad" error={errors.name}>
          {(control) => (
            <Input
              {...control}
              {...form.register('name', { required: 'Etkinlik adını yazın.' })}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="gezi-tur" label="Tür" error={errors.kind}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('kind')}
              className="w-full"
              disabled={busy}
            >
              {PAID_ACTIVITY_KINDS.map((kind) => (
                <NativeSelectOption key={kind} value={kind}>
                  {PAID_ACTIVITY_KIND_LABELS[kind]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="gezi-gun" label="Etkinlik günü" error={errors.activityDate}>
          {(control) => (
            <Input
              {...control}
              {...form.register('activityDate')}
              type="date"
              min={today}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="gezi-ucret"
          label="Kişi başı ücret (₺)"
          error={errors.fee}
          description="Ör. 1.500,00"
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('fee', { required: 'Kişi başı ücreti girin.' })}
              inputMode="decimal"
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="gezi-son-katilim"
          label="Son katılım günü"
          error={errors.joinDeadline}
          description="Katılım taksitinin vadesidir."
        >
          {(control) => (
            <Input {...control} {...form.register('joinDeadline')} type="date" disabled={busy} />
          )}
        </FormField>
        <FormField
          id="gezi-son-iptal"
          label="Son iptal günü"
          error={errors.cancelDeadline}
          description="Bu güne kadar iptalde tam iade."
        >
          {(control) => (
            <Input {...control} {...form.register('cancelDeadline')} type="date" disabled={busy} />
          )}
        </FormField>
        <FormField id="gezi-kontenjan" label="Kontenjan" error={errors.capacity}>
          {(control) => (
            <Input
              {...control}
              {...form.register('capacity')}
              type="number"
              min={1}
              inputMode="numeric"
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="gezi-gec-iptal"
          label="Son iptal gününden sonra"
          error={errors.lateRefundRule}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('lateRefundRule')}
              className="w-full"
              disabled={busy}
            >
              {LATE_REFUND_RULES.map((item) => (
                <NativeSelectOption key={item} value={item}>
                  {LATE_REFUND_RULE_LABELS[item]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {rule === 'percent' ? (
          <FormField id="gezi-oran" label="İade oranı (%)" error={errors.lateRefundPercent}>
            {(control) => (
              <Input
                {...control}
                {...form.register('lateRefundPercent')}
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                disabled={busy}
              />
            )}
          </FormField>
        ) : (
          <FormField
            id="gezi-masraf"
            label="Kişi başı masraf (₺)"
            error={errors.lateCost}
            description="Geç iptalde iadeden düşülür."
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('lateCost')}
                inputMode="decimal"
                disabled={busy}
              />
            )}
          </FormField>
        )}
        <FormField
          id="gezi-referans"
          label="Gezi planı referansı (isteğe bağlı)"
          error={errors.externalRef}
        >
          {(control) => <Input {...control} {...form.register('externalRef')} disabled={busy} />}
        </FormField>
        <Controller
          control={form.control}
          name="requiresConsent"
          render={({ field }) => (
            <div className="flex items-start gap-2 sm:col-span-2">
              <Checkbox
                id="gezi-veli-izni"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                disabled={busy}
              />
              <Label htmlFor="gezi-veli-izni" className="text-sm leading-snug">
                Veli izni zorunlu (izin gelene kadar katılım “izin bekliyor” kalır, taksit izinle
                açılır)
              </Label>
            </div>
          )}
        />
        {requiresConsent ? (
          <FormField
            id="gezi-izin-formu"
            label="Dijital izin formu (isteğe bağlı)"
            error={errors.permissionFormId}
            description="Bağlanırsa formdaki onay ve retler “İzinleri formdan eşitle” ile katılıma yansır."
          >
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('permissionFormId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Form bağlama</NativeSelectOption>
                {(forms.data ?? []).map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        <div className="sm:col-span-2">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

function CancelActivityModal({
  activity,
  onClose,
}: {
  activity: PaidActivityRow
  onClose: () => void
}) {
  const cancel = useCancelPaidActivity()
  const form = useForm<{ reason: string }>({ defaultValues: { reason: '' } })
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async ({ reason }) => {
    const outcome = await cancel.submit(
      { activityId: activity.id, version: activity.version, body: { reason } },
      {
        setError: (name, error) =>
          name === 'reason'
            ? form.setError('reason', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Etkinlik iptal edildi; katılımcılara tam iade yazıldı.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Etkinliği iptal et"
      description={`${activity.name}: ${String(activity.participantCount)} katılımın hepsi tam iadeyle kapanır. Ödenmemiş taksitler kapanır; alınan tutarlar iade kaydı olur.`}
      footer={
        <ModalFooter busy={busy} form="gezi-iptal-formu" submit="İptal et" onClose={onClose} />
      }
    >
      <form
        id="gezi-iptal-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="gezi-iptal-gerekce" label="Gerekçe" error={form.formState.errors.reason}>
          {(control) => (
            <Input
              {...control}
              {...form.register('reason', { required: 'İptal gerekçesini yazın.' })}
              disabled={busy}
            />
          )}
        </FormField>
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}
