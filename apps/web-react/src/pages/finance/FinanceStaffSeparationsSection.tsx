import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { Link } from 'react-router'
import { useCertificateStaff } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  useCancelStaffSeparation,
  useCompleteStaffSeparation,
  useCreateStaffSeparation,
  useMarkStaffSeparationStep,
  useStaffSeparation,
  useStaffSeparations,
  useUpdateStaffSeparation,
  type StaffSeparationDetail,
  type StaffSeparationRow,
} from '@kampus/react-shared/use-finance-staff-separations.ts'
import { FIXED_ASSET_RETURN_CONDITION_LABELS } from '@kampus/school-core/lib/finance-fixed-asset-assignments.ts'
import {
  isManualSeparationStep,
  SGK_EXIT_CODES,
  sgkExitCodeLabel,
  STAFF_SEPARATION_REASON_LABELS,
  STAFF_SEPARATION_REASONS,
  STAFF_SEPARATION_STATUS_LABELS,
  STAFF_SEPARATION_STATUSES,
  STAFF_SEPARATION_STEP_LABELS,
  staffRoleText,
  type StaffSeparationStep,
} from '@kampus/school-core/lib/finance-staff-separations.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useStaffSeparationPdf } from '@/hooks/use-finance-staff-separation-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { STAFF_SEPARATION_TITLE } from '@/lib/pdf/templates/finance-staff-separation.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import { ReturnForm } from './FinanceFixedAssetAssignments.tsx'
import { staffOptionText } from './finance-staff-certificate-forms.ts'
import {
  emptyStaffSeparationForm,
  noticeText,
  staffSeparationBody,
  staffSeparationCancelFormSchema,
  staffSeparationEditValues,
  staffSeparationFormField,
  staffSeparationFormSchema,
  staffSeparationUpdateBody,
  stepDetailText,
  suggestedCodeText,
  withHireSuggestion,
  type StaffSeparationFormValues,
} from './finance-staff-separation-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['staffName', 'separationDate']
const FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: STAFF_SEPARATION_STATUSES.map((value) => ({
      value,
      label: STAFF_SEPARATION_STATUS_LABELS[value],
    })),
  },
]
const STAFF_PAGE = { page: 1, pageSize: 100 } as const
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const isStatus = (value: unknown): value is (typeof STAFF_SEPARATION_STATUSES)[number] =>
  typeof value === 'string' && (STAFF_SEPARATION_STATUSES as readonly string[]).includes(value)
/** Yalnız yöneticiye açık sekme; bağlantılar yönetici rotasındadır. */
const SEVERANCE_HREF = '/yonetici/finans?gorunum=kidem-ihbar'
const CERTIFICATES_HREF = '/yonetici/finans?gorunum=personel-belgesi'
const ACCOUNTS_HREF = '/yonetici/ayarlar?sekme=kullanicilar'

const statusTone = (status: StaffSeparationRow['status']) =>
  status === 'completed' ? 'green' : status === 'cancelled' ? 'gray' : 'amber'

type Row = {
  id: string
  staffName: string
  role: string
  separationDate: string
  reason: string
  separation: StaffSeparationRow
}

/**
 * İşten ayrılış (DOM-FIN-118; ON-180): Finans "İşten ayrılış" sekmesi, yalnız yönetici (K-403).
 * Liste personel, ayrılış günü, neden ve durumla; "Dosyayı aç" kontrol listesini gösterir: zimmet
 * iadesi (iade burada alınır), avans/icra ve izin işaretleri, kıdem hesaplayıcısı, hesap kapatma ve
 * hizmet belgesi bağlantıları (K-404, K-405). Zorunlu adımlar bitince ilişik kesilir; ilişik kesme
 * belgesi PDF olarak açılır.
 */
export function FinanceStaffSeparationsSection() {
  const list = useListState('isten-ayrilis', { urlPrefix: 'ayr_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = list.state.filters.status
  const separations = useStaffSeparations({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
  })
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = useMemo(
    () =>
      separations.data?.data.map((item): Row => ({
        id: item.id,
        staffName: item.staffName,
        role: staffRoleText(item.staffRole),
        separationDate: dayText(item.separationDate),
        reason: STAFF_SEPARATION_REASON_LABELS[item.reason],
        separation: item,
      })),
    [separations.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'staffName', label: 'Personel' },
      { key: 'role', label: 'Görev' },
      { key: 'separationDate', label: 'Ayrılış günü' },
      { key: 'reason', label: 'Neden' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={STAFF_SEPARATION_STATUS_LABELS[row.separation.status]}
            tone={statusTone(row.separation.status)}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label={`${row.staffName} ayrılış dosyasını aç`}
              onClick={() => setOpenId(row.id)}
            >
              Dosyayı aç
            </Button>
            <PdfDialogButton
              label="PDF"
              title={`${STAFF_SEPARATION_TITLE} · ${row.staffName}`}
              id={row.id}
              usePdf={useStaffSeparationPdf}
              accessibleName={`${row.staffName} ilişik kesme belgesi PDF`}
            />
          </span>
        ),
      },
    ],
    [],
  )
  return (
    <section
      aria-labelledby="isten-ayrilis"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="isten-ayrilis" className="text-lg font-semibold">
            İşten ayrılış
          </h2>
          <p className="text-sm text-muted-foreground">
            Ayrılan personelin zimmet iadesi, avans ve icra, izin, kıdem, hesap kapatma ve hizmet
            belgesi adımları tek dosyada izlenir; zorunlu adımlar bitince ilişik kesilir.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Yeni ayrılış dosyası</Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={separations.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="İşten ayrılış dosyaları"
        empty="Henüz ayrılış dosyası açılmadı."
        emptyFiltered="Bu seçimle eşleşen dosya yok."
        loading={separations.isPending}
        fetching={separations.isFetching && !separations.isPending}
        error={
          separations.error ? (
            <QueryError error={separations.error} onRetry={() => void separations.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Yeni ayrılış dosyası"
        description="Ayrılış günü, nedeni ve SGK çıkış kodu; işe giriş ve bildirim günü bildirim süresini hesaplamak içindir."
      >
        {creating ? (
          <CreateForm
            onDone={(id) => {
              setCreating(false)
              setOpenId(id)
            }}
          />
        ) : null}
      </Modal>
      <Modal
        open={openId !== null}
        onOpenChange={(open) => (open ? undefined : setOpenId(null))}
        title="Ayrılış dosyası"
        size="wide"
      >
        {openId ? <SeparationDetail separationId={openId} /> : null}
      </Modal>
    </section>
  )
}

/** Ayrılış bilgileri alanları (açılış ve düzeltme formu ortak). */
function DetailFields({
  form,
  busy,
  prefix,
}: {
  form: UseFormReturn<StaffSeparationFormValues>
  busy: boolean
  prefix: string
}) {
  const errors = form.formState.errors
  const reason = useWatch({ control: form.control, name: 'reason' })
  return (
    <>
      <FormField id={`${prefix}-gun`} label="Ayrılış günü" error={errors.separationDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('separationDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id={`${prefix}-neden`} label="Ayrılış nedeni" error={errors.reason}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('reason')}
            className="w-full"
            disabled={busy}
          >
            {STAFF_SEPARATION_REASONS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {STAFF_SEPARATION_REASON_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id={`${prefix}-sgk`}
        label="SGK çıkış kodu"
        description="Boş bırakılırsa nedenden önerilir."
        error={errors.sgkExitCode}
      >
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('sgkExitCode')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">{suggestedCodeText(reason)}</NativeSelectOption>
            {SGK_EXIT_CODES.map((code) => (
              <NativeSelectOption key={code} value={code}>
                {sgkExitCodeLabel(code)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id={`${prefix}-giris`}
        label="İşe giriş günü (isteğe bağlı)"
        error={errors.hireDate}
      >
        {(control) => (
          <Input {...control} type="date" {...form.register('hireDate')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id={`${prefix}-bildirim`}
        label="Bildirim günü (isteğe bağlı)"
        error={errors.noticeGivenDate}
      >
        {(control) => (
          <Input {...control} type="date" {...form.register('noticeGivenDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id={`${prefix}-not`} label="Not (isteğe bağlı)" error={errors.note}>
        {(control) => <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />}
      </FormField>
    </>
  )
}

function serverErrors(form: UseFormReturn<StaffSeparationFormValues>) {
  return {
    setError: (name: string, error: { type?: string; message?: string }) => {
      const field = staffSeparationFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
}

function CreateForm({ onDone }: { onDone: (id: string) => void }) {
  const create = useCreateStaffSeparation()
  const [staffSearch, setStaffSearch] = useState('')
  const staffQuery = useDebouncedValue(staffSearch).trim()
  const staff = useCertificateStaff({
    ...STAFF_PAGE,
    ...(staffQuery.length >= 2 ? { q: staffQuery } : {}),
  })
  const form = useForm<StaffSeparationFormValues>({
    resolver: zodResolver(staffSeparationFormSchema),
    defaultValues: emptyStaffSeparationForm(dayKey()),
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const membershipField = form.register('membershipId')
  const options = staff.data?.data ?? []
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(staffSeparationBody(values), serverErrors(form))
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.staffName} için ayrılış dosyası açıldı.`)
    onDone(outcome.data.data.id)
  })
  return (
    <form
      noValidate
      aria-label="Ayrılış dosyası"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="ayr-ara" label="Personel ara" description="En az 2 harf.">
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
      <FormField id="ayr-personel" label="Personel" error={errors.membershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...membershipField}
            onChange={(event) => {
              void membershipField.onChange(event)
              const chosen = options.find((row) => row.membershipId === event.target.value)
              if (chosen)
                form.reset(withHireSuggestion(form.getValues(), chosen.lastHireDate), {
                  keepErrors: true,
                })
            }}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">
              {staff.isPending ? 'Personel yükleniyor…' : 'Personel seçin'}
            </NativeSelectOption>
            {options.map((row) => (
              <NativeSelectOption key={row.membershipId} value={row.membershipId}>
                {staffOptionText(row)}
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
      <DetailFields form={form} busy={busy} prefix="ayr" />
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Dosyayı aç
        </Button>
      </div>
    </form>
  )
}

/** Dosya ayrıntısı ve kontrol listesi. */
function SeparationDetail({ separationId }: { separationId: string }) {
  const detail = useStaffSeparation(separationId)
  const [mode, setMode] = useState<'view' | 'edit' | 'cancel'>('view')
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const separation = detail.data?.data
  if (!separation) return <SummaryLoading />
  const open = separation.status === 'open'
  const notice = noticeText(separation.notice)
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{separation.staffName}</h3>
        <StatusBadge
          text={STAFF_SEPARATION_STATUS_LABELS[separation.status]}
          tone={statusTone(separation.status)}
        />
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">Görev</dt>
        <dd>{staffRoleText(separation.staffRole)}</dd>
        <dt className="text-muted-foreground">Ayrılış günü</dt>
        <dd>{dayText(separation.separationDate)}</dd>
        <dt className="text-muted-foreground">Neden</dt>
        <dd>{STAFF_SEPARATION_REASON_LABELS[separation.reason]}</dd>
        <dt className="text-muted-foreground">SGK çıkış kodu</dt>
        <dd>{sgkExitCodeLabel(separation.sgkExitCode)}</dd>
        {separation.hireDate ? (
          <>
            <dt className="text-muted-foreground">İşe giriş</dt>
            <dd>{dayText(separation.hireDate)}</dd>
          </>
        ) : null}
        {separation.note ? (
          <>
            <dt className="text-muted-foreground">Not</dt>
            <dd className="[overflow-wrap:anywhere]">{separation.note}</dd>
          </>
        ) : null}
        {separation.cancelReason ? (
          <>
            <dt className="text-muted-foreground">İptal gerekçesi</dt>
            <dd className="[overflow-wrap:anywhere]">{separation.cancelReason}</dd>
          </>
        ) : null}
      </dl>
      {notice ? <p className="text-sm">{notice}</p> : null}
      {separation.payrollMonthLocked ? (
        <p role="status" className="text-sm">
          Ayrılış ayının ({separation.payrollMonth}) bordrosu onaylı; son bordro düzeltme kaydıyla
          yapılır.
        </p>
      ) : null}
      {mode === 'edit' && open ? (
        <EditForm separation={separation} onDone={() => setMode('view')} />
      ) : null}
      {mode === 'cancel' && open ? (
        <CancelForm separation={separation} onDone={() => setMode('view')} />
      ) : null}
      <Checklist separation={separation} />
      <div className="flex flex-wrap gap-2 border-t pt-4">
        {open ? <CompleteButton separation={separation} /> : null}
        <PdfDialogButton
          label="İlişik kesme belgesi"
          title={`${STAFF_SEPARATION_TITLE} · ${separation.staffName}`}
          id={separation.id}
          usePdf={useStaffSeparationPdf}
        />
        {open && mode === 'view' ? (
          <>
            <Button variant="outline" onClick={() => setMode('edit')}>
              Dosyayı düzelt
            </Button>
            <Button variant="outline" onClick={() => setMode('cancel')}>
              Dosyayı iptal et
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}

const stepBadge = (item: StaffSeparationDetail['steps'][number]) =>
  item.done ? (
    <StatusBadge text="Tamamlandı" tone="green" />
  ) : item.required ? (
    <StatusBadge text="Bekliyor" tone="amber" />
  ) : (
    <StatusBadge text="İsteğe bağlı" tone="gray" />
  )

function Checklist({ separation }: { separation: StaffSeparationDetail }) {
  const open = separation.status === 'open'
  return (
    <section aria-labelledby="ayrilis-kontrol" className="grid gap-3">
      <h4 id="ayrilis-kontrol" className="text-sm font-semibold">
        Kontrol listesi
      </h4>
      <ol aria-label="Kontrol listesi" className="grid gap-2">
        {separation.steps.map((item) => (
          <li
            key={item.step}
            aria-label={STAFF_SEPARATION_STEP_LABELS[item.step]}
            className="grid gap-2 rounded-sm border px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{STAFF_SEPARATION_STEP_LABELS[item.step]}</span>
              {stepBadge(item)}
            </div>
            <p className="text-sm text-muted-foreground">{stepDetailText(item.step, separation)}</p>
            {item.checkedAt ? (
              <p className="text-sm text-muted-foreground">
                Kontrol: {dateLabel(item.checkedAt, { year: 'numeric' })}
                {item.checkedByName ? ` · ${item.checkedByName}` : ''}
              </p>
            ) : null}
            <StepActions
              separation={separation}
              step={item.step}
              open={open}
              done={item.done}
              checked={item.checkedAt !== null}
            />
          </li>
        ))}
      </ol>
    </section>
  )
}

function StepActions({
  separation,
  step,
  open,
  done,
  checked,
}: {
  separation: StaffSeparationDetail
  step: StaffSeparationStep
  open: boolean
  done: boolean
  checked: boolean
}) {
  const links = {
    severance: { to: SEVERANCE_HREF, label: 'Kıdem/ihbar hesaplayıcısını aç' },
    account_closure: { to: ACCOUNTS_HREF, label: 'Kullanıcı hesaplarına git' },
    service_certificate: { to: CERTIFICATES_HREF, label: 'Personel belgelerine git' },
  } as const
  const link = step in links ? links[step as keyof typeof links] : null
  return (
    <>
      {step === 'asset_return' ? <AssetList separation={separation} open={open} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        {open && isManualSeparationStep(step) ? (
          <MarkButton separation={separation} step={step} checked={checked} />
        ) : null}
        {open && link !== null && !(done && step !== 'severance') ? (
          <Link className="text-sm font-medium underline underline-offset-4" to={link.to}>
            {link.label}
          </Link>
        ) : null}
      </div>
    </>
  )
}

function AssetList({ separation, open }: { separation: StaffSeparationDetail; open: boolean }) {
  if (separation.assets.length === 0) return null
  return (
    <ul aria-label="Personelin zimmetleri" className="grid gap-2 text-sm">
      {separation.assets.map((asset) => (
        <li key={asset.assignmentId} className="grid gap-2 rounded-sm border px-3 py-2">
          <span>
            <span className="font-medium">{asset.assetTagNumber}</span> · {asset.assetName} ·{' '}
            {dayText(asset.assignedDate)}
            {asset.returnDate === null
              ? ' · iade edilmedi'
              : ` · iade ${dayText(asset.returnDate)}${asset.returnCondition ? ` (${FIXED_ASSET_RETURN_CONDITION_LABELS[asset.returnCondition]})` : ''}`}
          </span>
          {open && asset.returnDate === null ? (
            <ReturnForm
              assignment={{
                id: asset.assignmentId,
                version: asset.version,
                assetTagNumber: asset.assetTagNumber,
              }}
              idPrefix={`ayr-iade-${asset.assignmentId}`}
              label={`${asset.assetTagNumber} zimmet iadesi`}
            />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function MarkButton({
  separation,
  step,
  checked,
}: {
  separation: StaffSeparationDetail
  step: 'deductions' | 'leave' | 'severance'
  checked: boolean
}) {
  const markStep = useMarkStaffSeparationStep()
  const label = STAFF_SEPARATION_STEP_LABELS[step]
  return (
    <Button
      size="sm"
      variant={checked ? 'outline' : 'secondary'}
      disabled={markStep.isPending}
      aria-busy={markStep.isPending || undefined}
      aria-label={checked ? `${label}: işareti kaldır` : `${label}: kontrol edildi`}
      onClick={() =>
        void markStep
          .submit({
            separationId: separation.id,
            version: separation.version,
            body: { step, done: !checked },
          })
          .then((outcome) => {
            if (outcome.status === 'success')
              notify.success(checked ? `${label} işareti kaldırıldı.` : `${label} kontrol edildi.`)
          })
      }
    >
      {checked ? 'İşareti kaldır' : 'Kontrol edildi'}
    </Button>
  )
}

function CompleteButton({ separation }: { separation: StaffSeparationDetail }) {
  const complete = useCompleteStaffSeparation()
  const missing = separation.missingSteps
  const notDue = separation.separationDate > dayKey()
  const blocked = missing.length > 0 || notDue
  return (
    <div className="grid gap-1">
      <Button
        disabled={blocked || complete.isPending}
        aria-busy={complete.isPending || undefined}
        aria-describedby={blocked ? 'ayrilis-eksik' : undefined}
        onClick={() =>
          void complete
            .submit({ separationId: separation.id, version: separation.version })
            .then((outcome) => {
              if (outcome.status === 'success')
                notify.success(`${separation.staffName} ile ilişik kesildi.`)
            })
        }
      >
        İlişiği kes
      </Button>
      {blocked ? (
        <p id="ayrilis-eksik" className="text-sm text-muted-foreground">
          {notDue
            ? `Ayrılış günü (${dayText(separation.separationDate)}) gelmeden ilişik kesilmez.`
            : `Önce şu adımları bitirin: ${missing.map((step) => STAFF_SEPARATION_STEP_LABELS[step]).join(', ')}.`}
        </p>
      ) : null}
    </div>
  )
}

function EditForm({
  separation,
  onDone,
}: {
  separation: StaffSeparationDetail
  onDone: () => void
}) {
  const update = useUpdateStaffSeparation()
  const initial = staffSeparationEditValues(separation)
  const form = useForm<StaffSeparationFormValues>({
    resolver: zodResolver(staffSeparationFormSchema),
    defaultValues: initial,
  })
  const busy = update.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await update.submit(
      {
        separationId: separation.id,
        version: separation.version,
        body: staffSeparationUpdateBody(initial, values),
      },
      serverErrors(form),
    )
    if (outcome.status === 'success') {
      notify.success('Ayrılış dosyası düzeltildi.')
      onDone()
    }
  })
  return (
    <form
      noValidate
      aria-label="Ayrılış dosyasını düzelt"
      className="grid gap-3 rounded-sm border p-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <DetailFields form={form} busy={busy} prefix="ayr-duzelt" />
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <RootError message={form.formState.errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
          Vazgeç
        </Button>
      </div>
    </form>
  )
}

/** Gerekçeli iptal (K-403): dosya silinmez. */
function CancelForm({
  separation,
  onDone,
}: {
  separation: StaffSeparationDetail
  onDone: () => void
}) {
  const cancel = useCancelStaffSeparation()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(staffSeparationCancelFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { separationId: separation.id, version: separation.version, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Ayrılış dosyası iptal edildi.')
      onDone()
    }
  })
  return (
    <form
      noValidate
      aria-label="İptal gerekçesi"
      className="grid gap-3 rounded-sm border p-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="ayr-iptal" label="Gerekçe" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
          İptal et
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
          Vazgeç
        </Button>
      </div>
    </form>
  )
}
