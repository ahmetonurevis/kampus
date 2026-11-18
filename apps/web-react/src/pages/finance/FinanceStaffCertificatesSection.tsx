import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCancelStaffCertificate,
  useCertificateStaff,
  useCreateStaffCertificate,
  useStaffCertificates,
  type StaffCertificate,
} from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  STAFF_CERTIFICATE_DEFAULT_ADDRESSEE,
  STAFF_CERTIFICATE_KIND_LABELS,
  STAFF_CERTIFICATE_KINDS,
  staffCertificateCancelSchema,
  staffCertificateLabel,
} from '@kampus/school-core/lib/finance-staff-certificates.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useStaffCertificatePdf } from '@/hooks/use-finance-staff-certificate-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { STAFF_CERTIFICATE_TITLE } from '@/lib/pdf/templates/finance-staff-certificate.ts'
import { RootError } from '../management/FormParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import {
  emptyStaffCertificateForm,
  staffCertificateBody,
  staffCertificateDefaults,
  staffCertificateFormField,
  staffCertificateFormSchema,
  staffOptionText,
  type StaffCertificateFormValues,
} from './finance-staff-certificate-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['number', 'staffName']
const FILTERS = [
  {
    key: 'kind',
    label: 'Belge türü',
    type: 'select' as const,
    options: STAFF_CERTIFICATE_KINDS.map((value) => ({
      value,
      label: STAFF_CERTIFICATE_KIND_LABELS[value],
    })),
  },
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: [
      { value: 'valid', label: 'Geçerli' },
      { value: 'cancelled', label: 'İptal edildi' },
    ],
  },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const STAFF_PAGE = { page: 1, pageSize: 100 } as const

type Row = {
  id: string
  number: string
  staffName: string
  kind: string
  addressee: string
  issued: string
  certificate: StaffCertificate
}

/**
 * Personel belgeleri (DOM-FIN-106; ON-175): Finans "Personel belgeleri" sekmesi, yalnız yönetici
 * (K-342). Liste numara, personel, tür, muhatap ve durumla; satırda PDF önizleme/indirme (aynı Blob)
 * ve gerekçeli iptal. "Yeni belge" personeli seçtirir, türü ve önerileri personelin durumundan ve
 * son belgesinden doldurur (K-340). Liste T.C. kimlik no ve ücret göstermez (K-343).
 */
export function FinanceStaffCertificatesSection() {
  const list = useListState('personel-belgesi', { urlPrefix: 'pbelge_' })
  const search = useDebouncedValue(list.state.query).trim()
  const kind = text(list.state.filters.kind)
  const status = text(list.state.filters.status)
  const certificates = useStaffCertificates({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(kind === 'employment' || kind === 'service' ? { kind } : {}),
    ...(status === 'valid' || status === 'cancelled' ? { status } : {}),
  })
  const [creating, setCreating] = useState(false)
  const [cancelling, setCancelling] = useState<StaffCertificate | null>(null)
  const rows = useMemo(
    () =>
      certificates.data?.data.map((item): Row => ({
        id: item.id,
        number: staffCertificateLabel(item),
        staffName: item.staffName,
        kind: STAFF_CERTIFICATE_KIND_LABELS[item.kind],
        addressee: item.addressee,
        issued: dateLabel(item.createdAt, { year: 'numeric' }),
        certificate: item,
      })),
    [certificates.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'number', label: 'Belge no' },
      { key: 'staffName', label: 'Personel' },
      { key: 'kind', label: 'Tür' },
      { key: 'addressee', label: 'Muhatap' },
      { key: 'issued', label: 'Düzenleme' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) =>
          row.certificate.cancelledAt === null ? (
            <StatusBadge text="Geçerli" tone="green" />
          ) : (
            <StatusBadge text="İptal edildi" tone="gray" />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <PdfDialogButton
              label="PDF"
              title={`${row.kind} ${row.number}`}
              id={row.id}
              usePdf={useStaffCertificatePdf}
              accessibleName={`${row.number} PDF`}
            />
            {row.certificate.cancelledAt === null ? (
              <Button
                size="sm"
                variant="outline"
                aria-label={`${row.number} belgesini iptal et`}
                onClick={() => setCancelling(row.certificate)}
              >
                İptal et
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [],
  )
  return (
    <section
      aria-labelledby="personel-belgeleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="personel-belgeleri" className="text-lg font-semibold">
            Personel belgeleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Çalışma ve hizmet belgesi. İçerik düzenlendiği anda sabitlenir; belge silinmez,
            gerekçeyle iptal edilir. Belge açılışı denetim kaydına yazılır.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Yeni belge</Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={certificates.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption={STAFF_CERTIFICATE_TITLE}
        empty="Henüz personel belgesi düzenlenmedi."
        emptyFiltered="Bu seçimle eşleşen belge yok."
        loading={certificates.isPending}
        fetching={certificates.isFetching && !certificates.isPending}
        error={
          certificates.error ? (
            <QueryError error={certificates.error} onRetry={() => void certificates.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Yeni personel belgesi"
        description="Çalışan personele çalışma belgesi, ayrılan personele hizmet belgesi düzenlenir. Görev ve günler personel kaydında olmadığı için elle girilir."
      >
        {creating ? <CreateForm onDone={() => setCreating(false)} /> : null}
      </Modal>
      <Modal
        open={cancelling !== null}
        onOpenChange={(open) => (open ? undefined : setCancelling(null))}
        title="Personel belgesini iptal et"
      >
        {cancelling ? (
          <CancelForm certificate={cancelling} onDone={() => setCancelling(null)} />
        ) : null}
      </Modal>
    </section>
  )
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const create = useCreateStaffCertificate()
  const [staffSearch, setStaffSearch] = useState('')
  const staffQuery = useDebouncedValue(staffSearch).trim()
  const staff = useCertificateStaff({
    ...STAFF_PAGE,
    ...(staffQuery.length >= 2 ? { q: staffQuery } : {}),
  })
  const form = useForm<StaffCertificateFormValues>({
    resolver: zodResolver(staffCertificateFormSchema),
    defaultValues: emptyStaffCertificateForm(),
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const kind = useWatch({ control: form.control, name: 'kind' })
  const includeWage = useWatch({ control: form.control, name: 'includeWage' })
  const membershipField = form.register('membershipId')
  const options = staff.data?.data ?? []
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(staffCertificateBody(values), {
      setError: (name, error) => {
        const field = staffCertificateFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success(`${staffCertificateLabel(outcome.data.data)} numaralı belge düzenlendi.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Personel belgesi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="pbelge-ara" label="Personel ara" description="En az 2 harf.">
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
      <FormField id="pbelge-personel" label="Personel" error={errors.membershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...membershipField}
            onChange={(event) => {
              void membershipField.onChange(event)
              const chosen = options.find((row) => row.membershipId === event.target.value)
              if (chosen) form.reset(staffCertificateDefaults(chosen, form.getValues()))
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
      <FormField id="pbelge-tur" label="Belge türü" error={errors.kind}>
        {(control) => (
          <NativeSelect {...control} {...form.register('kind')} className="w-full" disabled={busy}>
            {STAFF_CERTIFICATE_KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {STAFF_CERTIFICATE_KIND_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="pbelge-gorev" label="Görev" error={errors.position}>
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('position')} disabled={busy} />
        )}
      </FormField>
      <FormField id="pbelge-giris" label="İşe giriş günü" error={errors.hireDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('hireDate')} disabled={busy} />
        )}
      </FormField>
      {kind === 'service' ? (
        <FormField id="pbelge-cikis" label="İşten ayrılış günü" error={errors.exitDate}>
          {(control) => (
            <Input {...control} type="date" {...form.register('exitDate')} disabled={busy} />
          )}
        </FormField>
      ) : null}
      <FormField
        id="pbelge-tckn"
        label="T.C. kimlik no (isteğe bağlı)"
        description="Yalnız belgede yazar; listede görünmez."
        error={errors.identityNumber}
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            maxLength={11}
            {...form.register('identityNumber')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="pbelge-muhatap"
        label="Muhatap (isteğe bağlı)"
        description={`Boş bırakılırsa "${STAFF_CERTIFICATE_DEFAULT_ADDRESSEE}".`}
        error={errors.addressee}
      >
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('addressee')} disabled={busy} />
        )}
      </FormField>
      {kind === 'employment' ? (
        <div className="grid gap-1 sm:col-span-2">
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox
              id="pbelge-ucret"
              checked={includeWage}
              disabled={busy}
              aria-describedby="pbelge-ucret-aciklama"
              onCheckedChange={(checked) =>
                form.setValue('includeWage', checked === true, { shouldDirty: true })
              }
            />
            <Label htmlFor="pbelge-ucret">Ücret bilgisini belgeye yaz</Label>
          </div>
          <p id="pbelge-ucret-aciklama" className="text-sm text-muted-foreground">
            Bugün yürürlükteki ana ücret tanımı (Ücret tanımları) belgeye kopyalanır.
          </p>
          {errors.includeWage?.message ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.includeWage.message}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Belgeyi düzenle
        </Button>
      </div>
    </form>
  )
}

/** Gerekçeli iptal (K-341): belge silinmez, numara yeniden kullanılmaz. */
function CancelForm({
  certificate,
  onDone,
}: {
  certificate: StaffCertificate
  onDone: () => void
}) {
  const cancel = useCancelStaffCertificate()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(staffCertificateCancelSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = cancel.isPending || form.formState.isSubmitting
  const number = staffCertificateLabel(certificate)
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { certificateId: certificate.id, version: certificate.version, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${number} numaralı belge iptal edildi.`)
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="İptal gerekçesi"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm">
        {number} · {STAFF_CERTIFICATE_KIND_LABELS[certificate.kind]} · {certificate.staffName}
      </p>
      <FormField id="pbelge-iptal" label="Gerekçe" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
          İptal et
        </Button>
      </div>
    </form>
  )
}
