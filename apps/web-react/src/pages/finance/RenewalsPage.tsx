import { zodResolver } from '@hookform/resolvers/zod'
import { use, useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import type { z } from 'zod'
import { useFeeTariffs } from '@kampus/react-shared/use-fee-tariffs.ts'
import {
  useActivateRenewal,
  useCreatePriceIndex,
  useFetchAllRenewals,
  usePlanRenewal,
  usePriceIndexes,
  useQuoteRenewal,
  useRenewal,
  useRenewals,
  useUpdatePriceIndex,
  type RenewalListQuery,
} from '@kampus/react-shared/use-finance-renewals.ts'
import { useScholarshipPrograms } from '@kampus/react-shared/use-finance-scholarships.ts'
import {
  FEE_DISCOUNT_KIND_LABELS,
  FEE_ITEM_KIND_LABELS,
  type FeeDiscountKind,
  type FeeItemKind,
} from '@kampus/school-core/lib/fee-tariffs.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useCsvExport } from '@/hooks/use-csv-export.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import type { FilterField } from '@/lib/list-query.ts'
import type { UrlFilters } from '@/lib/list-url.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { notify } from '@/lib/notify.ts'
import {
  bulletinText,
  ceilingLines,
  priceIndexBody,
  priceIndexDefaults,
  priceIndexFormSchema,
  quoteLines,
  rateText,
  RENEWAL_MODE_LABELS,
  RENEWAL_MODES,
  RENEWAL_STATUSES,
  renewalDefaults,
  renewalFieldFor,
  renewalFormSchema,
  renewalPlanBody,
  renewalQuoteBody,
  studentOptions,
  targetClassOptions,
  type PriceIndexFormValues,
  type RenewalFormValues,
  type RenewalQuoteView,
} from './renewal-forms.ts'
import { awardablePrograms } from './scholarship-forms.ts'

type RenewalRow = {
  id: string
  version: number
  studentName: string
  period: string
  transition: string
  netCents: number
  netLabel: string
  status: string
}
type PriceIndexRow = {
  academicYear: number
  ppiBasisPoints: number
  cpiBasisPoints: number
  source: string
  bulletinDate: string
  version: number
}

const URL_FILTERS: UrlFilters = { status: 'durum' }
const SORTABLE = ['studentName', 'status', 'netCents'] as const
const MOBILE_COLUMNS = ['period', 'status'] as const
const STATUS_FIELD: FilterField = {
  key: 'status',
  label: 'Durum',
  options: RENEWAL_STATUSES.map((status) => ({ value: status, label: status })),
}
const SORT_KEYS = new Set<string>(SORTABLE)
const PLAN_FORM = 'yenileme-formu'
const INDEX_FORM = 'oran-formu'

const periodOf = (year: number) => `${String(year)}–${String(year + 1)}`
type RenewalItem = {
  id: string
  version: number
  studentName: string | null
  fromClassName: string | null
  targetClassName: string | null
  mode: 'renew' | 'graduate'
  academicYear: number
  netCents: number
  status: string
}
function toRow(item: RenewalItem): RenewalRow {
  return {
    id: item.id,
    version: item.version,
    studentName: item.studentName ?? '—',
    period: periodOf(item.academicYear),
    transition: `${item.fromClassName ?? '—'} → ${
      item.mode === 'graduate' ? 'Mezuniyet' : (item.targetClassName ?? '—')
    }`,
    netCents: item.netCents,
    netLabel: money(item.netCents),
    status: item.status,
  }
}

/**
 * Kayıt Yenileme (yönetici, ön büro, veli; IST-100). Liste ve ayrıntı `/finance/renewals`'tan,
 * ücret önizlemesi sunucudan: tutar yayımlı tarifeden ve artış tavanından çıkar (DOM-FIN-002,
 * -005), indirim tarifedeki türden, burs bildirilmiş programdan (DOM-FIN-020, -025). Yenileme
 * planlamak sınıfı değiştirmez; dönem geçişi ayrı işlemdir (DOM-KAY-020). Veli yalnız seçili
 * çocuğunun kaydını görür, işlem yapmaz.
 */
export function RenewalsPage({ page }: { page: NavPage }) {
  const { session } = useAuth()
  useDocumentTitle(page.title)
  const childId = use(ViewScopeContext)
  const role = session?.role
  const staff = role === 'yonetici' || role === 'onburo'
  const academicYear = (session?.institution?.academicYear ?? Number(dayKey().slice(0, 4))) + 1
  const list = useListState('yenilemeler', { urlFilters: URL_FILTERS })
  const search = useDebouncedValue(list.state.query.trim())
  const panel = useDetailPanel('kayit')
  const csv = useCsvExport()
  const fetchAll = useFetchAllRenewals()
  const [planning, setPlanning] = useState(false)

  const status = list.state.filters.status
  const sort = SORT_KEYS.has(list.state.sortKey)
    ? (list.state.sortKey as (typeof SORTABLE)[number])
    : undefined
  const order: 'asc' | 'desc' = list.state.sortDirection === -1 ? 'desc' : 'asc'
  const query: Omit<RenewalListQuery, 'page' | 'pageSize'> = {
    ...(search.length >= 2 ? { q: search } : {}),
    ...(typeof status === 'string' && status !== '' ? { status } : {}),
    ...(role === 'veli' && childId ? { studentId: childId } : {}),
    ...(sort ? { sort, order } : {}),
  }
  const renewals = useRenewals({ ...query, page: list.state.page, pageSize: list.state.pageSize })
  const rows = useMemo(() => renewals.data?.data.map(toRow), [renewals.data])
  const openRecord = panel.open

  const columns = useMemo<DataColumn<RenewalRow>[]>(
    () => [
      {
        key: 'studentName',
        label: 'Öğrenci',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openRecord(row.id)}
            className="record-link text-left font-medium text-primary hover:underline"
          >
            {row.studentName}
          </button>
        ),
      },
      { key: 'period', label: 'Dönem' },
      { key: 'transition', label: 'Sınıf geçişi' },
      { key: 'netCents', label: 'Net eğitim bedeli', cell: (row) => row.netLabel },
      { key: 'status', label: 'Durum', cell: (row) => <StatusBadge text={row.status} /> },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button variant="secondary" size="sm" onClick={() => openRecord(row.id)}>
            Ayrıntılar
          </Button>
        ),
      },
    ],
    [openRecord],
  )

  function download() {
    void csv.download(
      'kayit-yenileme',
      columns
        .filter((column) => column.key !== ACTIONS_KEY)
        .map((column) => ({
          key: column.key === 'netCents' ? 'netLabel' : column.key,
          label: column.label,
        })),
      async () => (await fetchAll(query)).map(toRow),
    )
  }

  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          staff ? (
            <Button onClick={() => setPlanning(true)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Kayıt yenile
            </Button>
          ) : null
        }
      />
      <section
        aria-labelledby="kayit-yenileme-listesi"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-end justify-between gap-3 px-6 pt-6 pb-2 max-[650px]:px-4">
          <div className="min-w-0">
            <h2 id="kayit-yenileme-listesi" className="text-lg font-semibold">
              {page.title}
            </h2>
            <p className="text-sm text-muted-foreground">
              {renewals.data?.meta.total ?? 0} kayıt ·{' '}
              {role === 'veli' ? 'Seçili çocuğunuzun kayıtları' : 'Kurumun yenileme planları'}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={download}
            disabled={csv.busy || renewals.isPending}
            aria-busy={csv.busy || undefined}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            CSV indir
          </Button>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={renewals.data?.meta.total ?? 0}
          sortable={SORTABLE}
          filters={[STATUS_FIELD]}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption={page.title}
          empty="Henüz yenileme planı yok."
          loading={renewals.isPending}
          fetching={renewals.isFetching && !renewals.isPending}
          error={
            renewals.error ? (
              <QueryError error={renewals.error} onRetry={() => void renewals.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openRecord(row.id)}
        />
      </section>
      {staff ? (
        <PriceIndexSection canManage={role === 'yonetici'} academicYear={academicYear} />
      ) : null}
      <RenewalDetail renewalId={panel.selectedId} canAct={staff} onClose={panel.close} />
      {planning ? (
        <PlanModal
          academicYear={academicYear}
          canAward={role === 'yonetici'}
          onClose={() => setPlanning(false)}
        />
      ) : null}
    </>
  )
}

function RenewalDetail({
  renewalId,
  canAct,
  onClose,
}: {
  renewalId: string
  canAct: boolean
  onClose: () => void
}) {
  const renewal = useRenewal(renewalId)
  const [activating, setActivating] = useState(false)
  const data = renewal.data?.data
  const title = data
    ? (data.studentName ?? 'Kayıt')
    : renewal.isPending
      ? 'Kayıt yükleniyor'
      : 'Kayıt bulunamadı'
  return (
    <SidePanel
      open={renewalId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
    >
      {data ? (
        <div className="grid gap-5">
          <div>
            <StatusBadge text={data.status} />
          </div>
          <DetailSection
            title="Dönem geçişi"
            lines={[
              periodOf(data.academicYear),
              `${data.fromClassName ?? '—'} → ${
                data.mode === 'graduate' ? 'Mezuniyet' : (data.targetClassName ?? '—')
              }`,
              data.status === 'Planlandı'
                ? 'Dönem geçişi uygulanınca sınıf değişir; geçmiş not, yoklama ve tahsilatlar korunur.'
                : 'Dönem geçişi uygulanmış.',
            ]}
          />
          {data.mode === 'renew' ? (
            <DetailSection
              title="Ücret"
              lines={[
                ...(data.pricing
                  ? [`İlan edilen ücret: ${money(data.pricing.announcedCents)}`]
                  : []),
                ...(data.pricing ? ceilingLines(data.pricing.ceiling) : []),
                ...(data.tuitionCents === null
                  ? []
                  : [`Öğrenim ücreti: ${money(data.tuitionCents)}`]),
                ...(data.discountCents ? [`İndirim: −${money(data.discountCents)}`] : []),
                ...(data.scholarshipCents ? [`Burs: −${money(data.scholarshipCents)}`] : []),
                `Net eğitim bedeli: ${money(data.netCents)}`,
              ]}
            />
          ) : null}
          {data.invoices.length ? (
            <DetailSection
              title="Yeni dönem taksitleri"
              lines={data.invoices.map(
                (invoice) =>
                  `${String(invoice.installment)}. taksit · ${dateLabel(invoice.dueDate, { year: 'numeric' })} · ${money(invoice.amountCents)} · ${invoice.paidAt ? 'Ödendi' : 'Bekliyor'}${
                    invoice.feeKind && invoice.feeKind !== 'tuition'
                      ? ` · ${FEE_ITEM_KIND_LABELS[invoice.feeKind as FeeItemKind] ?? 'Ek hizmet'}`
                      : ''
                  }`,
              )}
            />
          ) : null}
          {data.contractId ? (
            <section aria-label="Belgeler" className="flex flex-wrap gap-2 border-t pt-4">
              <PdfButton
                type="contract"
                recordId={data.contractId}
                studentId={data.studentId}
                label="Yeni dönem sözleşmesi"
              />
            </section>
          ) : null}
          {canAct && data.status === 'Planlandı' ? (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button onClick={() => setActivating(true)}>Dönem geçişini uygula</Button>
            </div>
          ) : null}
          {activating ? (
            <ActivateModal
              renewalId={data.id}
              version={data.version}
              mode={data.mode}
              onClose={() => setActivating(false)}
            />
          ) : null}
        </div>
      ) : renewal.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Kayıt yükleniyor…
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Kayıt mevcut rol veya çocuk kapsamında bulunamadı. Listeye dönüp yeniden seçin.
        </p>
      )}
    </SidePanel>
  )
}

function DetailSection({ title, lines }: { title: string; lines: readonly string[] }) {
  return (
    <section className="grid gap-1.5 border-t pt-4 first:border-t-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {lines.map((line) => (
        <p key={line} className="text-sm whitespace-pre-line text-muted-foreground">
          {line}
        </p>
      ))}
    </section>
  )
}

function ActivateModal({
  renewalId,
  version,
  mode,
  onClose,
}: {
  renewalId: string
  version: number
  mode: 'renew' | 'graduate'
  onClose: () => void
}) {
  const activate = useActivateRenewal()
  const busy = activate.isPending
  async function confirm() {
    const outcome = await activate.submit({ renewalId, version })
    if (outcome.status === 'success') {
      notify.success(mode === 'graduate' ? 'Mezuniyet uygulandı.' : 'Dönem geçişi uygulandı.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Dönem geçişini uygula"
      description={
        mode === 'graduate'
          ? 'Öğrenci mezun olur ve pasifleşir; geçmiş kayıtları korunur.'
          : 'Öğrencinin sınıfı yeni sınıf olur; açık çalışma görevleri ve rehberlik dosyaları yeni sınıfın öğretmenine devredilir. Geçmiş not, yoklama ve tahsilatlar korunur.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void confirm()} disabled={busy} aria-busy={busy || undefined}>
            Onayla ve kaydet
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        İleri tarihli etüdü olan öğrencide geçiş reddedilir; önce etütleri iptal edin.
      </p>
    </Modal>
  )
}

function PlanModal({
  academicYear,
  canAward,
  onClose,
}: {
  academicYear: number
  canAward: boolean
  onClose: () => void
}) {
  const students = useCoreAll('students')
  const classes = useCoreAll('classes')
  const branches = useCoreAll('branches')
  const tariffs = useFeeTariffs({ page: 1, pageSize: 20, academicYear })
  const programs = useScholarshipPrograms({ academicYear }, { enabled: canAward })
  const quote = useQuoteRenewal()
  const plan = usePlanRenewal()
  const [preview, setPreview] = useState<
    (RenewalQuoteView & { tariffId: string }) | 'graduate' | null
  >(null)
  const form = useForm<RenewalFormValues, unknown, z.output<typeof renewalFormSchema>>({
    resolver: zodResolver(renewalFormSchema),
    defaultValues: renewalDefaults(),
  })
  const [studentId, mode] = useWatch({ control: form.control, name: ['studentId', 'mode'] })
  const busy = quote.isPending || plan.isPending || form.formState.isSubmitting
  const locked = busy || preview !== null
  const errors = form.formState.errors

  const classNames = new Map(classes.data?.map((row) => [row.id, row.record.name]))
  const branchNames = new Map(branches.data?.map((row) => [row.id, row.record.name]))
  const studentRecords = (students.data ?? []).map((row) => ({ ...row.record, id: row.id }))
  const student = studentRecords.find((item) => item.id === studentId)
  const targets = targetClassOptions(
    (classes.data ?? []).map((row) => ({ ...row.record, id: row.id })),
    branchNames,
    student?.classId,
  )
  const tariff = tariffs.data?.data.find((item) => item.status === 'published')
  const discountKinds = tariff?.discounts.map((item) => item.kind) ?? []
  const extraKinds = [
    ...new Set(tariff?.items.filter((item) => item.kind !== 'tuition').map((item) => item.kind)),
  ]
  const scholarshipOptions = awardablePrograms(programs.data?.data ?? [])

  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = renewalFieldFor(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }

  const onCheck = form.handleSubmit(async (values) => {
    if (values.mode === 'graduate') {
      setPreview('graduate')
      return
    }
    const outcome = await quote.submit(renewalQuoteBody(values, academicYear), fields)
    if (outcome.status === 'success') setPreview(outcome.data.data)
  })

  async function confirm() {
    const tariffId = preview !== null && preview !== 'graduate' ? preview.tariffId : null
    const outcome = await plan.submit(
      renewalPlanBody(form.getValues(), academicYear, tariffId),
      fields,
    )
    if (outcome.status === 'success') {
      notify.success('Yenileme planlandı. Sınıf değişimi dönem geçişiyle uygulanır.')
      onClose()
    } else if (outcome.status === 'failed') setPreview(null)
  }

  const loadError = students.error ?? classes.error ?? branches.error
  if (loadError)
    return (
      <Modal open onOpenChange={(open) => (open ? undefined : onClose())} title="Kayıt yenile">
        <QueryError
          error={loadError}
          onRetry={() => {
            void students.refetch()
            void classes.refetch()
            void branches.refetch()
          }}
        />
      </Modal>
    )

  const lines = preview !== null && preview !== 'graduate' ? quoteLines(preview) : null
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Kayıt yenile"
      description={`${periodOf(academicYear)} eğitim yılı. Ücret yayımlı tarifeden ve artış tavanından hesaplanır; onaydan önce hiçbir kayıt yazılmaz. Sınıf değişimi ayrı dönem geçişi işlemiyle uygulanır.`}
      footer={
        preview ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setPreview(null)}>
              Bilgileri düzenle
            </Button>
            <Button disabled={busy} aria-busy={busy || undefined} onClick={() => void confirm()}>
              Onayla ve kaydet
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Vazgeç
            </Button>
            <Button type="submit" form={PLAN_FORM} disabled={busy} aria-busy={busy || undefined}>
              Kontrol et
            </Button>
          </>
        )
      }
    >
      <form
        id={PLAN_FORM}
        noValidate
        onSubmit={(event) => void onCheck(event)}
        className="grid gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="yenileme-ogrenci" label="Öğrenci" error={errors.studentId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('studentId', {
                  onChange: () => form.setValue('targetClassId', ''),
                })}
                className="w-full"
                disabled={locked}
              >
                <NativeSelectOption value="">Öğrenci seçin</NativeSelectOption>
                {studentOptions(studentRecords, classNames).map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="yenileme-islem" label="İşlem" error={errors.mode}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('mode')}
                className="w-full"
                disabled={locked}
              >
                {RENEWAL_MODES.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {RENEWAL_MODE_LABELS[item]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
        {mode === 'renew' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="yenileme-sinif" label="Yeni sınıf" error={errors.targetClassId}>
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register('targetClassId')}
                    className="w-full"
                    disabled={locked || !student}
                  >
                    <NativeSelectOption value="">
                      {student ? 'Yeni sınıfı seçin' : 'Önce öğrenciyi seçin'}
                    </NativeSelectOption>
                    {targets.map((option) => (
                      <NativeSelectOption key={option.value} value={option.value}>
                        {option.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField
                id="yenileme-ucret"
                label="Öğrenim ücreti (₺)"
                description="Boş bırakılırsa ilan edilen ücret ile artış tavanının küçüğü uygulanır."
                error={errors.tuition}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register('tuition')}
                    inputMode="decimal"
                    disabled={locked}
                  />
                )}
              </FormField>
              <FormField id="yenileme-taksit" label="Taksit sayısı" error={errors.installmentCount}>
                {(control) => (
                  <Input
                    {...control}
                    {...form.register('installmentCount')}
                    inputMode="numeric"
                    disabled={locked}
                  />
                )}
              </FormField>
              <FormField id="yenileme-vade" label="İlk taksit tarihi" error={errors.firstDueDate}>
                {(control) => (
                  <Input
                    {...control}
                    {...form.register('firstDueDate')}
                    type="date"
                    disabled={locked}
                  />
                )}
              </FormField>
            </div>
            {tariffs.error ? (
              <QueryError error={tariffs.error} onRetry={() => void tariffs.refetch()} />
            ) : !tariffs.isPending && !tariff ? (
              <p role="alert" className="text-sm text-danger">
                {periodOf(academicYear)} için yayımlanmış ücret tarifesi yok; önce tarifeyi
                yayımlayın.
              </p>
            ) : null}
            <ChoiceGroup
              legend="İndirimler"
              hint="Yalnız tarifede ilan edilen türler; toplam ilan ücretinin %50'sini aşamaz."
              name="discounts"
              options={discountKinds.map((kind) => ({
                value: kind,
                label: FEE_DISCOUNT_KIND_LABELS[kind as FeeDiscountKind] ?? kind,
              }))}
              control={form.control}
              disabled={locked}
            />
            <ChoiceGroup
              legend="Ek hizmetler"
              hint="Velinin talep ettiği hizmetler ayrı taksit olarak açılır."
              name="extras"
              options={extraKinds.map((kind) => ({
                value: kind,
                label: FEE_ITEM_KIND_LABELS[kind as FeeItemKind] ?? kind,
              }))}
              control={form.control}
              disabled={locked}
            />
            {canAward ? (
              <FormField
                id="yenileme-burs"
                label="Burs programı"
                error={errors.scholarshipProgramId}
              >
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register('scholarshipProgramId')}
                    className="w-full"
                    disabled={locked}
                  >
                    <NativeSelectOption value="">Burs yok</NativeSelectOption>
                    {scholarshipOptions.map((program) => (
                      <NativeSelectOption key={program.id} value={program.id}>
                        {program.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Mezuniyet yalnız 12. sınıf öğrencisinde planlanır; sözleşme ve borç açmaz.
          </p>
        )}
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
      </form>
      {lines ? (
        <section
          aria-labelledby="yenileme-ozeti"
          className="mt-4 grid gap-1.5 rounded-md border p-3"
        >
          <h3 id="yenileme-ozeti" className="text-sm font-semibold">
            Yeni dönem ödeme özeti
          </h3>
          {lines.pricing.map((line) => (
            <p key={line} className="text-sm text-muted-foreground">
              {line}
            </p>
          ))}
          <p className="text-sm font-semibold">{lines.net}</p>
          <p className="text-sm text-muted-foreground">{lines.installments}</p>
          {lines.extras.map((line) => (
            <p key={line} className="text-sm text-muted-foreground">
              {line}
            </p>
          ))}
        </section>
      ) : preview === 'graduate' ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Mezuniyet planlanacak; onaydan sonra dönem geçişiyle uygulanır.
        </p>
      ) : null}
    </Modal>
  )
}

function ChoiceGroup({
  legend,
  hint,
  name,
  options,
  control,
  disabled,
}: {
  legend: string
  hint: string
  name: 'discounts' | 'extras'
  options: readonly { value: string; label: string }[]
  control: ReturnType<
    typeof useForm<RenewalFormValues, unknown, z.output<typeof renewalFormSchema>>
  >['control']
  disabled: boolean
}) {
  if (options.length === 0) return null
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-sm text-muted-foreground">{hint}</p>
      <Controller
        name={name}
        control={control}
        render={({ field }) => {
          const selected = field.value as readonly string[]
          return (
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {options.map((option) => {
                const id = `yenileme-${name}-${option.value}`
                return (
                  <div key={option.value} className="flex items-center gap-2.5">
                    <Checkbox
                      id={id}
                      checked={selected.includes(option.value)}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked === true
                            ? [...selected, option.value]
                            : selected.filter((value) => value !== option.value),
                        )
                      }
                    />
                    <Label htmlFor={id} className="font-normal">
                      {option.label}
                    </Label>
                  </div>
                )
              })}
            </div>
          )
        }}
      />
    </fieldset>
  )
}

const NO_SORT: readonly string[] = []
const INDEX_MOBILE = ['year', 'ppi', 'cpi']

/** ÜFE ve TÜFE profili (DOM-FIN-005): yönetici girer ve düzeltir, ön büro görür. */
function PriceIndexSection({
  canManage,
  academicYear,
}: {
  canManage: boolean
  academicYear: number
}) {
  const list = useListState('ufe-tufe')
  const indexes = usePriceIndexes({ page: list.state.page, pageSize: list.state.pageSize })
  const [editing, setEditing] = useState<PriceIndexRow | 'new' | null>(null)
  const columns = useMemo<DataColumn<PriceIndexRow & { id: number; year: string }>[]>(
    () => [
      { key: 'year', label: 'Ücret yılı' },
      { key: 'ppi', label: 'ÜFE ortalaması', cell: (row) => `%${rateText(row.ppiBasisPoints)}` },
      { key: 'cpi', label: 'TÜFE ortalaması', cell: (row) => `%${rateText(row.cpiBasisPoints)}` },
      { key: 'source', label: 'Kaynak' },
      { key: 'bulletin', label: 'Bülten tarihi', cell: (row) => bulletinText(row.bulletinDate) },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) =>
          canManage ? (
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.year} oranlarını düzelt`}
              onClick={() => setEditing(row)}
            >
              Düzelt
            </Button>
          ) : null,
      },
    ],
    [canManage],
  )
  const rows = indexes.data?.data.map((row) => ({
    ...row,
    id: row.academicYear,
    year: periodOf(row.academicYear),
  }))
  return (
    <section
      aria-labelledby="ufe-tufe-oranlari"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2 max-[650px]:px-4">
        <div>
          <h2 id="ufe-tufe-oranlari" className="text-lg font-semibold">
            Artış tavanı oranları
          </h2>
          <p className="text-sm text-muted-foreground">
            Devam eden öğrencinin yeni yıl ücreti baz × (1 + ((ÜFE + TÜFE) / 2 + 5) / 100) tutarını
            aşamaz. Oranlar bir önceki yılın ortalamalarıdır, TÜİK bülteniyle girilir.
          </p>
        </div>
        {canManage ? (
          <Button variant="secondary" onClick={() => setEditing('new')}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Oran ekle
          </Button>
        ) : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={indexes.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={INDEX_MOBILE}
        caption="Artış tavanı oranları"
        search={false}
        empty="Henüz oran girilmedi. Oranı girilmemiş yıl için devam eden öğrencinin yenilemesi planlanamaz."
        loading={indexes.isPending}
        fetching={indexes.isFetching && !indexes.isPending}
        error={
          indexes.error ? (
            <QueryError error={indexes.error} onRetry={() => void indexes.refetch()} />
          ) : undefined
        }
      />
      {editing ? (
        <PriceIndexModal
          existing={editing === 'new' ? null : editing}
          academicYear={academicYear}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  )
}

function PriceIndexModal({
  existing,
  academicYear,
  onClose,
}: {
  existing: PriceIndexRow | null
  academicYear: number
  onClose: () => void
}) {
  const create = useCreatePriceIndex()
  const update = useUpdatePriceIndex()
  const [today] = useState(() => dayKey(Date.now()))
  const form = useForm<PriceIndexFormValues, unknown, z.output<typeof priceIndexFormSchema>>({
    resolver: zodResolver(priceIndexFormSchema),
    defaultValues: priceIndexDefaults(
      existing?.academicYear ?? academicYear,
      existing ?? undefined,
    ),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field =
        name === 'ppiBasisPoints'
          ? 'ppi'
          : name === 'cpiBasisPoints'
            ? 'cpi'
            : name === 'academicYear' || name === 'source' || name === 'bulletinDate'
              ? name
              : null
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const body = priceIndexBody(values)
    const outcome = existing
      ? await update.submit(
          {
            academicYear: existing.academicYear,
            version: existing.version,
            body: {
              ppiBasisPoints: body.ppiBasisPoints,
              cpiBasisPoints: body.cpiBasisPoints,
              source: body.source,
              bulletinDate: body.bulletinDate,
            },
          },
          fields,
        )
      : await create.submit(body, fields)
    if (outcome.status === 'success') {
      notify.success(existing ? 'Oranlar düzeltildi.' : 'Oranlar kaydedildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={existing ? 'Oranları düzelt' : 'Artış tavanı oranı ekle'}
      description="Önceden açılmış yenileme planları değişmez; ücret kararı plan kaydında kalır."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={INDEX_FORM} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={INDEX_FORM}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="oran-yil"
            label="Ücret yılı (başlangıç)"
            description="Oranların sınırladığı ücretin eğitim yılı."
            error={errors.academicYear}
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('academicYear')}
                inputMode="numeric"
                disabled={busy || existing !== null}
              />
            )}
          </FormField>
          <FormField id="oran-bulten" label="Bülten tarihi" error={errors.bulletinDate}>
            {(control) => (
              <Input
                {...control}
                {...form.register('bulletinDate')}
                type="date"
                max={today}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField id="oran-ufe" label="ÜFE ortalaması (%)" error={errors.ppi}>
            {(control) => (
              <Input {...control} {...form.register('ppi')} inputMode="decimal" disabled={busy} />
            )}
          </FormField>
          <FormField id="oran-tufe" label="TÜFE ortalaması (%)" error={errors.cpi}>
            {(control) => (
              <Input {...control} {...form.register('cpi')} inputMode="decimal" disabled={busy} />
            )}
          </FormField>
        </div>
        <FormField id="oran-kaynak" label="Kaynak (TÜİK bülteni)" error={errors.source}>
          {(control) => <Input {...control} {...form.register('source')} disabled={busy} />}
        </FormField>
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
