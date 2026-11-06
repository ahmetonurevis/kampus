import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import type { z } from 'zod'
import { useEffectiveFeeTariff } from '@kampus/react-shared/use-fee-tariffs.ts'
import {
  useBulkPlanRenewals,
  usePreviewRenewalBulk,
  useRenewalCandidates,
} from '@kampus/react-shared/use-finance-renewals.ts'
import { useScholarshipPrograms } from '@kampus/react-shared/use-finance-scholarships.ts'
import {
  carriedOverTariffNote,
  FEE_DISCOUNT_KIND_LABELS,
  FEE_ITEM_KIND_LABELS,
  type FeeDiscountKind,
  type FeeItemKind,
} from '@kampus/school-core/lib/fee-tariffs.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { announcedPaymentTermLabel } from '@kampus/school-core/lib/payment-terms.ts'
import {
  RENEWAL_BULK_LIMIT,
  RENEWAL_PLAN_STATUS_LABELS,
  RENEWAL_PLAN_STATUSES,
  type RenewalPlanStatus,
} from '@kampus/school-core/lib/renewal-bulk.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { DataTable, ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SearchField } from '@/components/SearchField.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { notify } from '@/lib/notify.ts'
import {
  ceilingCell,
  renewalBulkBody,
  renewalBulkDefaults,
  renewalBulkFormSchema,
  targetClassOptions,
  type RenewalBulkFormValues,
} from './renewal-forms.ts'
import { ChoiceFieldset } from './RenewalChoices.tsx'
import { awardablePrograms } from './scholarship-forms.ts'

const ALL_STATUSES = 'all'
const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['studentName', 'suggested', 'planStatus'] as const
const BULK_FORM = 'toplu-yenileme-formu'

const periodOf = (year: number) => `${String(year)}–${String(year + 1)}`

type CandidateRow = {
  id: string
  studentName: string
  classId: string
  className: string
  targetClassId: string | null
  targetClassName: string
  previous: string
  suggested: string
  ceiling: string
  debtCents: number
  planStatus: RenewalPlanStatus
  problem: string | null
}

/**
 * Yeni yılın planları (IST-105, ON-086): yenilenecek öğrencilerin sayfalı görünümü ve toplu plan.
 * Ücret ve satır kararı sunucudadır; ekran seçim, ortak ödeme planı ve sonucu gösterir. Liste
 * varsayılan olarak planı yapılmamış öğrencileri getirir. Onay yalnız yöneticidedir.
 */
export function RenewalYearSection({
  academicYear,
  institutionType,
  canApprove,
}: {
  academicYear: number
  institutionType: InstitutionType
  canApprove: boolean
}) {
  const list = useListState('yeni-yil-planlari', { urlPrefix: 'yil-' })
  const search = useDebouncedValue(list.state.query.trim())
  const classes = useCoreAll('classes')
  const [selected, setSelected] = useState<ReadonlyMap<string, CandidateRow>>(() => new Map())
  const [planning, setPlanning] = useState(false)

  const status =
    typeof list.state.filters.planStatus === 'string'
      ? list.state.filters.planStatus
      : 'not_planned'
  const classId = list.state.filters.classId
  const candidates = useRenewalCandidates({
    academicYear,
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(status === ALL_STATUSES ? {} : { planStatus: status as RenewalPlanStatus }),
    ...(typeof classId === 'string' && classId !== '' ? { classId } : {}),
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const rows = useMemo(
    () =>
      candidates.data?.data.map((item): CandidateRow => ({
        id: item.studentId,
        studentName: item.studentName ?? '—',
        classId: item.classId,
        className: item.className ?? '—',
        targetClassId: item.targetClassId,
        targetClassName: item.targetClassName ?? 'Seçilecek',
        previous: item.previousContract
          ? `${money(item.previousContract.tuitionCents)} (${periodOf(item.previousContract.academicYear)})`
          : '—',
        suggested: item.suggestedTuitionCents === null ? '—' : money(item.suggestedTuitionCents),
        ceiling: ceilingCell(item.ceiling),
        debtCents: item.outstandingTuitionCents,
        planStatus: item.planStatus,
        problem: item.problem?.message ?? null,
      })),
    [candidates.data],
  )

  const limitMessage = `Bir seferde en fazla ${String(RENEWAL_BULK_LIMIT)} öğrenci seçilebilir.`

  function selectPage() {
    const next = new Map(selected)
    const open = (rows ?? []).filter((row) => row.planStatus === 'not_planned')
    for (const row of open) if (next.size < RENEWAL_BULK_LIMIT) next.set(row.id, row)
    if (open.some((row) => !next.has(row.id))) notify.error(limitMessage)
    setSelected(next)
  }

  const columns = useMemo<DataColumn<CandidateRow>[]>(
    () => [
      {
        key: 'select',
        label: 'Seç',
        cell: (row) =>
          row.planStatus === 'not_planned' ? (
            <Checkbox
              aria-label={`${row.studentName} seç`}
              checked={selected.has(row.id)}
              onCheckedChange={(checked) => {
                const next = new Map(selected)
                if (checked !== true) next.delete(row.id)
                else if (next.size < RENEWAL_BULK_LIMIT) next.set(row.id, row)
                else notify.error(limitMessage)
                setSelected(next)
              }}
            />
          ) : null,
      },
      { key: 'studentName', label: 'Öğrenci' },
      { key: 'className', label: 'Sınıf' },
      { key: 'targetClassName', label: 'Hedef sınıf' },
      { key: 'previous', label: 'Önceki sözleşme' },
      { key: 'suggested', label: 'Önerilen ücret' },
      { key: 'ceiling', label: 'Artış tavanı' },
      {
        key: 'debtCents',
        label: 'Borç',
        cell: (row) =>
          row.debtCents > 0 ? (
            <span className="grid gap-0.5">
              <span>{money(row.debtCents)}</span>
              <span className="text-xs text-muted-foreground">Yönetici onayı gerekir</span>
            </span>
          ) : (
            '—'
          ),
      },
      {
        key: 'planStatus',
        label: 'Durum',
        cell: (row) => (
          <span className="grid justify-items-start gap-1">
            <StatusBadge text={RENEWAL_PLAN_STATUS_LABELS[row.planStatus]} />
            {row.problem ? (
              <span className="text-xs text-muted-foreground">{row.problem}</span>
            ) : null}
          </span>
        ),
      },
    ],
    [selected, limitMessage],
  )

  // Tablo araması sayfanın ana listesinde; iki alan aynı "Tabloda ara" adını taşımasın.
  const toolbar = (
    <>
      <SearchField
        className="w-56 max-[650px]:w-full"
        label="Yeni yıl listesinde öğrenci ara"
        placeholder="Öğrenci ara..."
        value={list.state.query}
        onChange={(query) => list.dispatch({ type: 'query', query })}
      />
      <NativeSelect
        className="w-44 max-[650px]:w-full"
        aria-label="Plan durumu"
        value={status}
        onChange={(event) =>
          list.dispatch({ type: 'filter', key: 'planStatus', value: event.target.value })
        }
      >
        {RENEWAL_PLAN_STATUSES.map((value) => (
          <NativeSelectOption key={value} value={value}>
            {RENEWAL_PLAN_STATUS_LABELS[value]}
          </NativeSelectOption>
        ))}
        <NativeSelectOption value={ALL_STATUSES}>Tüm durumlar</NativeSelectOption>
      </NativeSelect>
      <NativeSelect
        className="w-44 max-[650px]:w-full"
        aria-label="Şimdiki sınıf"
        value={typeof classId === 'string' ? classId : ''}
        onChange={(event) =>
          list.dispatch({ type: 'filter', key: 'classId', value: event.target.value })
        }
      >
        <NativeSelectOption value="">Tüm sınıflar</NativeSelectOption>
        {(classes.data ?? []).map((row) => (
          <NativeSelectOption key={row.id} value={row.id}>
            {row.record.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </>
  )

  return (
    <section
      aria-labelledby="yeni-yil-planlari"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-end justify-between gap-3 px-6 pt-6 pb-2 max-[650px]:px-4">
        <div className="min-w-0">
          <h2 id="yeni-yil-planlari" className="text-lg font-semibold">
            Yeni yılın planları
          </h2>
          <p className="text-sm text-muted-foreground">
            {periodOf(academicYear)} · {candidates.data?.meta.total ?? 0} öğrenci. Seçili
            öğrencilere ortak ödeme planı uygulanır; ücret artış tavanından, taksit ilanlı
            koşullardan çıkar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={selectPage} disabled={!rows?.length}>
            Sayfadakileri seç
          </Button>
          <Button
            variant="secondary"
            onClick={() => setSelected(new Map())}
            disabled={selected.size === 0}
          >
            Seçimi temizle
          </Button>
          <Button onClick={() => setPlanning(true)} disabled={selected.size === 0}>
            Seçilenleri planla ({selected.size})
          </Button>
        </div>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={candidates.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Yeni yılın planları"
        search={false}
        toolbar={toolbar}
        empty="Bu durumda öğrenci yok."
        loading={candidates.isPending}
        fetching={candidates.isFetching && !candidates.isPending}
        error={
          candidates.error ? (
            <QueryError error={candidates.error} onRetry={() => void candidates.refetch()} />
          ) : undefined
        }
      />
      {planning ? (
        <BulkPlanModal
          academicYear={academicYear}
          institutionType={institutionType}
          canApprove={canApprove}
          students={[...selected.values()]}
          onClose={() => setPlanning(false)}
          onDone={() => setSelected(new Map())}
        />
      ) : null}
    </section>
  )
}

const OUTCOME_LABELS = {
  ready: 'Hazır',
  planned: 'Planlandı',
  skipped: 'Atlandı',
  failed: 'Yapılamadı',
} as const

type ResultRow = {
  id: string
  studentName: string
  target?: string
  net: string
  installments: string
  outcome: keyof typeof OUTCOME_LABELS
  reason: string
}

const installmentText = (amounts: readonly number[], net: number | null) => {
  if (net === null) return '—'
  if (amounts.length === 0) return 'Taksit yok'
  const [first] = amounts
  return `${String(amounts.length)} taksit · ${money(first ?? 0)}`
}

const RESULT_COLUMNS: DataColumn<ResultRow>[] = [
  { key: 'studentName', label: 'Öğrenci' },
  { key: 'target', label: 'Hedef sınıf' },
  { key: 'net', label: 'Net eğitim bedeli' },
  { key: 'installments', label: 'Taksitler' },
  {
    key: 'outcome',
    label: 'Sonuç',
    cell: (row) => <StatusBadge text={OUTCOME_LABELS[row.outcome]} />,
  },
  { key: 'reason', label: 'Neden' },
]
const REPORT_COLUMNS = RESULT_COLUMNS.filter((column) => column.key !== 'target')
const RESULT_MOBILE = ['studentName', 'net', 'outcome'] as const

type TargetRow = CandidateRow & { targets: readonly { value: string; label: string }[] }

function BulkPlanModal({
  academicYear,
  institutionType,
  canApprove,
  students,
  onClose,
  onDone,
}: {
  academicYear: number
  institutionType: InstitutionType
  canApprove: boolean
  students: readonly CandidateRow[]
  onClose: () => void
  onDone: () => void
}) {
  const classes = useCoreAll('classes')
  const branches = useCoreAll('branches')
  const tariffs = useEffectiveFeeTariff({ academicYear, institutionType, pageSize: 20 })
  const programs = useScholarshipPrograms({ academicYear }, { enabled: canApprove })
  const previewing = usePreviewRenewalBulk()
  const planning = useBulkPlanRenewals()
  const form = useForm<RenewalBulkFormValues, unknown, z.output<typeof renewalBulkFormSchema>>({
    resolver: zodResolver(renewalBulkFormSchema),
    defaultValues: renewalBulkDefaults(),
  })
  const [targets, setTargets] = useState<Readonly<Record<string, string>>>({})
  const [preview, setPreview] = useState<{
    tariffId: string | null
    summary: { ready: number; skipped: number; failed: number }
    rows: ResultRow[]
    body: ReturnType<typeof renewalBulkBody>
  } | null>(null)
  const [report, setReport] = useState<{
    summary: { planned: number; skipped: number; failed: number }
    rows: ResultRow[]
  } | null>(null)
  const [missingTarget, setMissingTarget] = useState(false)

  const busy = previewing.isPending || planning.isPending || form.formState.isSubmitting
  const locked = busy || preview !== null
  const errors = form.formState.errors
  const tariff = tariffs.tariff
  const branchNames = new Map(branches.data?.map((row) => [row.id, row.record.name]))
  const classRecords = (classes.data ?? []).map((row) => ({ ...row.record, id: row.id }))
  const targetOf = (row: CandidateRow) => targets[row.id] ?? row.targetClassId ?? ''
  const targetRows: TargetRow[] = students.map((row) => ({
    ...row,
    targets: targetClassOptions(classRecords, branchNames, row.classId),
  }))
  const targetColumns: DataColumn<TargetRow>[] = [
    { key: 'studentName', label: 'Öğrenci' },
    { key: 'className', label: 'Sınıf' },
    {
      key: 'targetClassName',
      label: 'Hedef sınıf',
      cell: (row) => (
        <NativeSelect
          aria-label={`${row.studentName} hedef sınıfı`}
          value={targetOf(row)}
          disabled={locked}
          onChange={(event) => {
            setMissingTarget(false)
            setTargets((current) => ({ ...current, [row.id]: event.target.value }))
          }}
        >
          <NativeSelectOption value="">Seçin</NativeSelectOption>
          {row.targets.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ),
    },
    { key: 'suggested', label: 'Önerilen ücret' },
  ]

  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      if (name === 'installmentCount' || name === 'firstDueDate')
        form.setError(name, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }

  const onCheck = form.handleSubmit(async (values) => {
    const rows = students.map((row) => ({ studentId: row.id, targetClassId: targetOf(row) }))
    if (rows.some((row) => row.targetClassId === '')) {
      setMissingTarget(true)
      return
    }
    const body = renewalBulkBody(values, academicYear, rows)
    const outcome = await previewing.submit(body, fields)
    if (outcome.status !== 'success') return
    const { data } = outcome.data
    setPreview({
      tariffId: data.tariff?.id ?? null,
      summary: data.summary,
      body,
      rows: data.rows.map((row) => ({
        id: row.studentId,
        studentName: row.studentName ?? '—',
        target: row.targetClassName ?? '—',
        net: row.price ? money(row.price.netCents) : '—',
        installments: installmentText(row.price?.installments ?? [], row.price?.netCents ?? null),
        outcome: row.outcome,
        reason: row.problem?.message ?? '',
      })),
    })
  })

  async function confirm() {
    if (preview === null || preview.tariffId === null) return
    const outcome = await planning.submit({ ...preview.body, tariffId: preview.tariffId }, fields)
    if (outcome.status !== 'success') return
    const { data } = outcome.data
    setReport({
      summary: data.summary,
      rows: data.rows.map((row) => ({
        id: row.studentId,
        studentName: row.studentName ?? '—',
        net: money(row.netCents),
        installments: installmentText(row.installments, row.netCents),
        outcome: row.outcome,
        reason: row.problem?.message ?? '',
      })),
    })
    onDone()
    if (data.summary.planned > 0)
      notify.success(`${String(data.summary.planned)} öğrencinin planı yazıldı.`)
  }

  const loadError = classes.error ?? branches.error
  const close = (open: boolean) => (open ? undefined : onClose())
  if (loadError)
    return (
      <Modal open onOpenChange={close} title="Toplu yenileme planı">
        <QueryError
          error={loadError}
          onRetry={() => {
            void classes.refetch()
            void branches.refetch()
          }}
        />
      </Modal>
    )

  if (report)
    return (
      <Modal
        open
        size="wide"
        onOpenChange={close}
        title="Toplu plan sonucu"
        description="Her öğrenci ayrı işlenir; yapılamayan satır ötekileri geri almaz."
        footer={<Button onClick={onClose}>Kapat</Button>}
      >
        <p role="status" className="mb-3 text-sm font-medium">
          {report.summary.planned} planlandı · {report.summary.skipped} atlandı ·{' '}
          {report.summary.failed} yapılamadı
        </p>
        <DataTable
          listKey="yeni-yil-sonuc"
          urlPrefix="yil-sonuc-"
          rows={report.rows}
          columns={REPORT_COLUMNS}
          mobileColumns={RESULT_MOBILE}
          caption="Toplu plan sonucu"
          search={false}
        />
      </Modal>
    )

  const discountKinds = tariff?.discounts.map((item) => item.kind) ?? []
  const extraKinds = [
    ...new Set(tariff?.items.filter((item) => item.kind !== 'tuition').map((item) => item.kind)),
  ]
  return (
    <Modal
      open
      size="wide"
      onOpenChange={close}
      title="Toplu yenileme planı"
      description={`${periodOf(academicYear)} eğitim yılı, ${String(students.length)} öğrenci. Önizleme hiçbir kayıt yazmaz; borçlu öğrenci atlanır, kararı tek öğrenci yenilemesinden verilir.`}
      footer={
        preview ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setPreview(null)}>
              Bilgileri düzenle
            </Button>
            {canApprove ? (
              <Button
                disabled={busy || preview.summary.ready === 0 || preview.tariffId === null}
                aria-busy={busy || undefined}
                onClick={() => void confirm()}
              >
                Planları onayla
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Vazgeç
            </Button>
            <Button type="submit" form={BULK_FORM} disabled={busy} aria-busy={busy || undefined}>
              Önizle
            </Button>
          </>
        )
      }
    >
      <form
        id={BULK_FORM}
        noValidate
        onSubmit={(event) => void onCheck(event)}
        className="grid gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="toplu-taksit"
            label="Taksit sayısı"
            error={errors.installmentCount}
            {...(tariff?.paymentTerms.length
              ? {
                  description: `İlan edilen koşullar: ${tariff.paymentTerms
                    .map(announcedPaymentTermLabel)
                    .join('; ')}`,
                }
              : {})}
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('installmentCount')}
                inputMode="numeric"
                disabled={locked}
              />
            )}
          </FormField>
          <FormField id="toplu-vade" label="İlk taksit tarihi" error={errors.firstDueDate}>
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
          <QueryError error={tariffs.error} onRetry={tariffs.refetch} />
        ) : !tariffs.isPending && !tariff ? (
          <p role="alert" className="text-sm text-danger">
            {periodOf(academicYear)} için yayımlanmış ücret tarifesi yok; önce tarifeyi yayımlayın.
          </p>
        ) : tariffs.carriedOverFromYear !== null ? (
          <p role="note" className="rounded-md border bg-warning-soft p-3 text-sm">
            {carriedOverTariffNote(tariffs.carriedOverFromYear)}
          </p>
        ) : null}
        <Controller
          name="discounts"
          control={form.control}
          render={({ field }) => (
            <ChoiceFieldset
              legend="İndirimler"
              hint="Seçili bütün öğrencilere uygulanır; koşulu tutmayan öğrenci önizlemede nedeniyle görünür."
              idPrefix="toplu-indirim"
              options={discountKinds.map((kind) => ({
                value: kind,
                label: FEE_DISCOUNT_KIND_LABELS[kind as FeeDiscountKind] ?? kind,
              }))}
              selected={field.value}
              onChange={field.onChange}
              disabled={locked}
            />
          )}
        />
        <Controller
          name="extras"
          control={form.control}
          render={({ field }) => (
            <ChoiceFieldset
              legend="Ek hizmetler"
              hint="Velinin talep ettiği hizmetler ayrı taksit olarak açılır."
              idPrefix="toplu-hizmet"
              options={extraKinds.map((kind) => ({
                value: kind,
                label: FEE_ITEM_KIND_LABELS[kind as FeeItemKind] ?? kind,
              }))}
              selected={field.value}
              onChange={field.onChange}
              disabled={locked}
            />
          )}
        />
        {canApprove ? (
          <FormField id="toplu-burs" label="Burs programı" error={errors.scholarshipProgramId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('scholarshipProgramId')}
                className="w-full"
                disabled={locked}
              >
                <NativeSelectOption value="">Burs yok</NativeSelectOption>
                {awardablePrograms(programs.data?.data ?? []).map((program) => (
                  <NativeSelectOption key={program.id} value={program.id}>
                    {program.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
        {missingTarget ? (
          <p role="alert" className="text-sm text-danger">
            Her öğrencinin hedef sınıfını seçin.
          </p>
        ) : null}
      </form>
      {preview ? (
        <section aria-labelledby="toplu-onizleme" className="mt-4 grid gap-2">
          <h3 id="toplu-onizleme" className="text-sm font-semibold">
            Önizleme
          </h3>
          <p role="status" className="text-sm font-medium">
            {preview.summary.ready} hazır · {preview.summary.skipped} atlanacak ·{' '}
            {preview.summary.failed} yapılamaz
          </p>
          {canApprove ? null : (
            <p className="text-sm text-muted-foreground">Toplu onayı yönetici verir.</p>
          )}
          <DataTable
            listKey="yeni-yil-onizleme"
            urlPrefix="yil-onizleme-"
            rows={preview.rows}
            columns={RESULT_COLUMNS}
            mobileColumns={RESULT_MOBILE}
            caption="Toplu yenileme önizlemesi"
            search={false}
          />
        </section>
      ) : (
        <section aria-labelledby="toplu-hedef" className="mt-4 grid gap-2">
          <h3 id="toplu-hedef" className="text-sm font-semibold">
            Seçili öğrenciler
          </h3>
          <DataTable
            listKey="yeni-yil-secim"
            urlPrefix="yil-secim-"
            rows={targetRows}
            columns={targetColumns}
            mobileColumns={['studentName', 'targetClassName']}
            caption="Seçili öğrencilerin hedef sınıfı"
            search={false}
          />
        </section>
      )}
    </Modal>
  )
}
