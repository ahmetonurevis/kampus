import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useBudgetDraftOptions,
  useBudgetDrafts,
  useCreateBudgetDraft,
  useSetBudgetOwner,
  type BudgetDraftOptions,
} from '@kampus/react-shared/use-finance-budget-drafts.ts'
import { useFixedAssetAssignees } from '@kampus/react-shared/use-finance-fixed-asset-assignments.ts'
import {
  BUDGET_DRAFT_STATUS_LABELS,
  BUDGET_DRAFT_STATUSES,
  type BudgetDraftStatus,
} from '@kampus/school-core/lib/finance-budget-drafts.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { BudgetDraftDetailView } from './FinanceBudgetDraftDetail.tsx'
import {
  BUDGET_DRAFT_PANEL,
  BUDGET_DRAFT_STATUS_VIEW,
  createDraftBody,
  createDraftFormField,
  createDraftFormSchema,
  ownerText,
  type CreateDraftFormValues,
} from './finance-budget-draft-forms.ts'
import { assigneeOptionLabel } from './finance-fixed-asset-assignment-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['center', 'status', 'expense']
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is BudgetDraftStatus =>
  BUDGET_DRAFT_STATUSES.some((status) => status === value)

type Row = {
  id: string
  period: string
  center: string
  owner: string
  status: BudgetDraftStatus
  revision: string
  income: string
  expense: string
  updatedAt: string
}

/**
 * Bütçe taslakları (`?gorunum=butce-taslak`; DOM-FIN-093, ON-243). Yönetici bütün birimlerin,
 * ön büro yalnız bütçe sorumlusu olduğu birimlerin taslaklarını görür (K-257). Liste dönem, birim
 * ve durumla süzülür, sunucu sayfalıdır; taslak sağ panelde (`?taslak=`) düzenlenir, gönderilir ve
 * onaylanır. Yönetici birimlerin bütçe sorumlularını aynı görünümde atar.
 */
export function FinanceBudgetDraftsSection({ isManager }: { isManager: boolean }) {
  const list = useListState('butce-taslaklari', { urlPrefix: 'taslak_' })
  const period = text(list.state.filters.period)
  const center = text(list.state.filters.center)
  const status = text(list.state.filters.status)
  const drafts = useBudgetDrafts({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(period ? { periodId: period } : {}),
    ...(center ? { costCenterId: center } : {}),
    ...(isStatus(status) ? { status } : {}),
  })
  const options = useBudgetDraftOptions()
  const panel = useDetailPanel(BUDGET_DRAFT_PANEL)
  const openDraft = panel.open
  const [creating, setCreating] = useState(false)
  const choices = options.data?.data
  const preparable = choices?.centers.filter((item) => item.canPrepare) ?? []

  const filters = useMemo(
    () => [
      {
        key: 'period',
        label: 'Dönem',
        type: 'select' as const,
        options: (choices?.periods ?? []).map((item) => ({ value: item.id, label: item.name })),
      },
      {
        key: 'center',
        label: 'Birim',
        type: 'select' as const,
        options: (choices?.centers ?? []).map((item) => ({
          value: item.id,
          label: `${item.path} · ${item.name}`,
        })),
      },
      {
        key: 'status',
        label: 'Durum',
        type: 'select' as const,
        options: BUDGET_DRAFT_STATUSES.map((value) => ({
          value,
          label: BUDGET_DRAFT_STATUS_LABELS[value],
        })),
      },
    ],
    [choices],
  )
  const rows = useMemo(
    () =>
      drafts.data?.data.map((item): Row => ({
        id: item.id,
        period: item.period.name,
        center: `${item.costCenter.path} · ${item.costCenter.name}`,
        owner: ownerText(item.owner),
        status: item.status,
        revision: item.revision === 0 ? '—' : String(item.revision),
        income: money(item.incomeCents),
        expense: money(item.expenseCents),
        updatedAt: dateLabel(item.updatedAt, { year: 'numeric' }),
      })),
    [drafts.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'period', label: 'Dönem' },
      { key: 'center', label: 'Birim' },
      { key: 'owner', label: 'Sorumlu' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={BUDGET_DRAFT_STATUS_VIEW[row.status].label}
            tone={BUDGET_DRAFT_STATUS_VIEW[row.status].tone}
          />
        ),
      },
      { key: 'revision', label: 'Sürüm' },
      { key: 'income', label: 'Gelir' },
      { key: 'expense', label: 'Gider' },
      { key: 'updatedAt', label: 'Güncelleme' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.center} taslağını aç`}
            onClick={() => openDraft(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [openDraft],
  )

  return (
    <>
      <section
        aria-labelledby="butce-taslaklari"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
          <div>
            <h2 id="butce-taslaklari" className="text-lg font-semibold">
              Bütçe taslakları
            </h2>
            <p className="text-sm text-muted-foreground">
              {isManager
                ? 'Birimlerin bütçe teklifleri; onay bekleyenleri onaylayın ya da revizyon isteyin.'
                : 'Sorumlusu olduğunuz birimlerin bütçe taslakları; hazırlayıp onaya gönderin.'}
            </p>
          </div>
          <Button onClick={() => setCreating(true)} disabled={preparable.length === 0}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni taslak
          </Button>
        </header>
        {options.error ? (
          <div className="px-6">
            <QueryError error={options.error} onRetry={() => void options.refetch()} />
          </div>
        ) : null}
        {choices && preparable.length === 0 ? (
          <p className="px-6 pb-2 text-sm text-muted-foreground">
            {isManager
              ? 'Taslak açmak için etkin bir maliyet merkezi gerekir.'
              : 'Size atanmış bir bütçe birimi yok; yönetici sizi birim sorumlusu yapınca burada taslak hazırlarsınız.'}
          </p>
        ) : null}
        <ServerDataTable
          list={list}
          rows={rows}
          total={drafts.data?.meta.total ?? 0}
          sortable={NO_SORT}
          columns={columns}
          filters={filters}
          mobileColumns={MOBILE}
          caption="Bütçe taslakları"
          empty="Henüz bütçe taslağı yok."
          emptyFiltered="Bu seçimle eşleşen taslak yok."
          loading={drafts.isPending}
          fetching={drafts.isFetching && !drafts.isPending}
          error={
            drafts.error ? (
              <QueryError error={drafts.error} onRetry={() => void drafts.refetch()} />
            ) : undefined
          }
        />
        {creating && choices ? (
          <CreateDraftModal
            options={choices}
            onClose={() => setCreating(false)}
            onSaved={(id) => {
              setCreating(false)
              openDraft(id)
            }}
          />
        ) : null}
        <SidePanel
          open={panel.selectedId !== ''}
          onOpenChange={(open) => (open ? undefined : panel.close())}
          title="Bütçe taslağı"
        >
          {panel.selectedId ? <BudgetDraftDetailView draftId={panel.selectedId} /> : null}
        </SidePanel>
      </section>
      {isManager && choices ? <BudgetOwnersPanel centers={choices.centers} /> : null}
    </>
  )
}

const CREATE_FORM = 'butce-taslak-ac'

/** Yeni taslak: kapalı olmayan dönem ve hazırlanabilen birim (K-257). */
function CreateDraftModal({
  options,
  onClose,
  onSaved,
}: {
  options: BudgetDraftOptions
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const create = useCreateBudgetDraft()
  const centers = options.centers.filter((item) => item.canPrepare)
  const form = useForm<CreateDraftFormValues>({
    resolver: zodResolver(createDraftFormSchema),
    defaultValues: {
      periodId: options.periods.length === 1 ? (options.periods[0]?.id ?? '') : '',
      costCenterId: centers.length === 1 ? (centers[0]?.id ?? '') : '',
    },
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(createDraftBody(values), {
      setError: (name, error) => {
        const field = createDraftFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success('Bütçe taslağı açıldı.')
      onSaved(outcome.data.data.id)
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Yeni bütçe taslağı"
      description="Taslak birimin bu dönemdeki onaylı bütçesiyle dolar; kalemleri düzenleyip onaya gönderirsiniz."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={CREATE_FORM} disabled={busy} aria-busy={busy || undefined}>
            Taslak aç
          </Button>
        </>
      }
    >
      <form
        id={CREATE_FORM}
        noValidate
        aria-label="Yeni bütçe taslağı"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="taslak-donem" label="Bütçe dönemi" error={errors.periodId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('periodId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Dönem seçin</NativeSelectOption>
              {options.periods.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="taslak-birim" label="Birim" error={errors.costCenterId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('costCenterId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Birim seçin</NativeSelectOption>
              {centers.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.path} · {item.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

const STAFF_PAGE = { page: 1, pageSize: 100, status: 'active' } as const

/**
 * Bütçe sorumluları (K-257): yönetici her birime etkin bir personel atar ya da sorumluyu kaldırır.
 * Sorumlusu olmayan birimin taslağını yalnız yönetici hazırlar.
 */
function BudgetOwnersPanel({ centers }: { centers: BudgetDraftOptions['centers'] }) {
  const staff = useFixedAssetAssignees(STAFF_PAGE)
  const setOwner = useSetBudgetOwner()
  const [selected, setSelected] = useState<Record<string, string>>({})
  const people = staff.data?.data ?? []
  return (
    <section
      aria-labelledby="butce-sorumlulari"
      className="panel mt-4 grid gap-3 rounded-card border bg-surface px-6 py-6"
    >
      <div>
        <h2 id="butce-sorumlulari" className="text-lg font-semibold">
          Bütçe sorumluları
        </h2>
        <p className="text-sm text-muted-foreground">
          Sorumlu kendi biriminin taslağını hazırlar ve onaya gönderir; sorumlusu olmayan birimi
          yönetici hazırlar.
        </p>
      </div>
      {staff.error ? <QueryError error={staff.error} onRetry={() => void staff.refetch()} /> : null}
      {centers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Etkin maliyet merkezi yok.</p>
      ) : (
        <ul aria-label="Bütçe sorumluları" className="grid gap-2">
          {centers.map((item) => {
            const current = item.owner?.membershipId ?? ''
            const value = selected[item.id] ?? current
            const label = `${item.path} · ${item.name}`
            return (
              <li
                key={item.id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto] items-center gap-3 rounded-sm border px-3 py-2 max-[650px]:grid-cols-1"
              >
                <div className="grid min-w-0">
                  <span className="font-medium [overflow-wrap:anywhere]">{label}</span>
                  <span className="text-sm text-muted-foreground">{ownerText(item.owner)}</span>
                </div>
                <NativeSelect
                  aria-label={`${label} sorumlusu`}
                  className="w-full"
                  value={value}
                  disabled={setOwner.isPending}
                  onChange={(event) =>
                    setSelected((previous) => ({ ...previous, [item.id]: event.target.value }))
                  }
                >
                  <NativeSelectOption value="">Sorumlu yok</NativeSelectOption>
                  {people.map((person) => (
                    <NativeSelectOption key={person.membershipId} value={person.membershipId}>
                      {assigneeOptionLabel(person)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`${label} sorumlusunu kaydet`}
                  disabled={setOwner.isPending || value === current}
                  onClick={() =>
                    void setOwner
                      .submit({
                        costCenterId: item.id,
                        body: { membershipId: value === '' ? null : value },
                      })
                      .then((outcome) => {
                        if (outcome.status !== 'success') return
                        notify.success(`${item.name} bütçe sorumlusu kaydedildi.`)
                        setSelected((previous) => {
                          const next = { ...previous }
                          delete next[item.id]
                          return next
                        })
                      })
                  }
                >
                  Kaydet
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
