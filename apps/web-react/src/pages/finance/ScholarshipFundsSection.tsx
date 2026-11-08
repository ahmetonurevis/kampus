import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCreateScholarshipFund,
  useScholarshipFunds,
} from '@kampus/react-shared/use-finance-scholarship-funds.ts'
import {
  SCHOLARSHIP_FUND_DONOR_KIND_LABELS,
  SCHOLARSHIP_FUND_DONOR_KINDS,
  SCHOLARSHIP_FUND_STATUS_LABELS,
} from '@kampus/school-core/lib/finance-scholarship-funds.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { ScholarshipFundPanel } from './ScholarshipFundPanel.tsx'
import {
  formField,
  fundBody,
  fundDefaults,
  fundFormSchema,
  type FundFormValues,
} from './scholarship-fund-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'balance']
const STATUS_OPTIONS = [
  { value: 'active', label: SCHOLARSHIP_FUND_STATUS_LABELS.active },
  { value: 'closed', label: SCHOLARSHIP_FUND_STATUS_LABELS.closed },
]
const isStatus = (value: unknown): value is 'active' | 'closed' =>
  value === 'active' || value === 'closed'

type FundRow = {
  id: string
  name: string
  donor: string
  donated: number
  allocated: number
  balance: number
  closed: boolean
}

/**
 * Burs fonları (`?gorunum=burs-fonu`; DOM-FIN-068, ON-259): bağış kaynaklı fonlar, bakiyeleriyle.
 * Fon adı ya da bağışçıyla aranır, açık/kapalı süzülür. Ayrıntı `?burs-fonu=` sağ panelindedir
 * (bağış, fondan burs ataması, iptal, kapanış, PDF ve CSV). Yazma yalnız yöneticide.
 */
export function ScholarshipFundsSection({ canManage }: { canManage: boolean }) {
  const list = useListState('burs-fonlari', { urlPrefix: 'fon_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = list.state.filters.status
  const funds = useScholarshipFunds({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
  })
  const panel = useDetailPanel('burs-fonu')
  const openFund = panel.open
  const [creating, setCreating] = useState(false)

  const rows = useMemo(
    () =>
      funds.data?.data.map((fund): FundRow => ({
        id: fund.id,
        name: fund.name,
        donor: fund.donorName ?? SCHOLARSHIP_FUND_DONOR_KIND_LABELS[fund.donorKind],
        donated: fund.donatedCents,
        allocated: fund.allocatedCents,
        balance: fund.balanceCents,
        closed: fund.status === 'closed',
      })),
    [funds.data],
  )
  const columns = useMemo<DataColumn<FundRow>[]>(
    () => [
      { key: 'name', label: 'Fon' },
      { key: 'donor', label: 'Bağışçı' },
      { key: 'donated', label: 'Bağış', cell: (row) => money(row.donated) },
      { key: 'allocated', label: 'Atanan', cell: (row) => money(row.allocated) },
      { key: 'balance', label: 'Bakiye', cell: (row) => money(row.balance) },
      {
        key: 'closed',
        label: 'Durum',
        cell: (row) =>
          row.closed ? (
            <StatusBadge text={SCHOLARSHIP_FUND_STATUS_LABELS.closed} tone="gray" />
          ) : (
            <StatusBadge text={SCHOLARSHIP_FUND_STATUS_LABELS.active} tone="green" />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} fonunu aç`}
            onClick={() => openFund(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openFund],
  )
  const filters = useMemo(
    () => [{ key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS }],
    [],
  )

  return (
    <section
      aria-labelledby="burs-fonlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="burs-fonlari" className="text-lg font-semibold">
            Burs fonları
          </h2>
          <p className="text-sm text-muted-foreground">
            Bağışlarla oluşan fonlar; bursun hangi fondan karşılandığı ve fonda kalan bakiye.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setCreating(true)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni fon
          </Button>
        ) : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={funds.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={MOBILE}
        caption="Burs fonları"
        empty="Henüz burs fonu yok."
        emptyFiltered="Bu aramayla eşleşen fon yok."
        loading={funds.isPending}
        fetching={funds.isFetching && !funds.isPending}
        error={
          funds.error ? (
            <QueryError error={funds.error} onRetry={() => void funds.refetch()} />
          ) : undefined
        }
      />
      {creating ? (
        <FundFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            openFund(id)
          }}
        />
      ) : null}
      <ScholarshipFundPanel fundId={panel.selectedId} canManage={canManage} onClose={panel.close} />
    </section>
  )
}

const FUND_FORM = 'burs-fonu-formu'
const FUND_FIELDS = ['name', 'description', 'donorKind', 'donorName'] as const

function FundFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const create = useCreateScholarshipFund()
  const form = useForm<FundFormValues>({
    resolver: zodResolver(fundFormSchema),
    defaultValues: fundDefaults(),
  })
  const donorKind = useWatch({ control: form.control, name: 'donorKind' })
  const busy = create.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(fundBody(values), {
      setError: (name, error) => {
        const field = formField(FUND_FIELDS, name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.fund.name} açıldı.`)
      onSaved(outcome.data.data.fund.id)
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Yeni burs fonu"
      description="Bağışçının yalnız adı ya da kurum adı tutulur; anonim bağışta ad yazılmaz."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={FUND_FORM} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={FUND_FORM}
        noValidate
        aria-label="Yeni burs fonu"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="burs-fonu-ad" label="Fon adı" error={errors.name}>
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
        <FormField
          id="burs-fonu-aciklama"
          label="Açıklama (isteğe bağlı)"
          error={errors.description}
        >
          {(control) => (
            <Textarea {...control} {...form.register('description')} rows={2} disabled={busy} />
          )}
        </FormField>
        <FormField id="burs-fonu-bagisci-turu" label="Bağışçı türü" error={errors.donorKind}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('donorKind')}
              className="w-full"
              disabled={busy}
            >
              {SCHOLARSHIP_FUND_DONOR_KINDS.map((kind) => (
                <NativeSelectOption key={kind} value={kind}>
                  {SCHOLARSHIP_FUND_DONOR_KIND_LABELS[kind]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {donorKind === 'anonymous' ? null : (
          <FormField
            id="burs-fonu-bagisci"
            label={donorKind === 'person' ? 'Bağışçının adı' : 'Kurum adı'}
            error={errors.donorName}
          >
            {(control) => <Input {...control} {...form.register('donorName')} disabled={busy} />}
          </FormField>
        )}
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}
