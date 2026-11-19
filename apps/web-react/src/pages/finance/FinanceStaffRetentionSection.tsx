import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import {
  useDestroyStaffData,
  useStaffDataDestructions,
  useStaffRetentionCandidates,
  useStaffRetentionPolicies,
  useUpdateStaffRetentionPolicies,
  type StaffRetentionCandidateRow,
  type StaffRetentionPolicyRow,
} from '@kampus/react-shared/use-finance-staff-retention.ts'
import {
  STAFF_RETENTION_CATEGORIES,
  STAFF_RETENTION_CATEGORY_SPECS,
  STAFF_RETENTION_METHOD_LABELS,
  STAFF_RETENTION_START_EVENT_LABELS,
  type StaffRetentionCategory,
} from '@kampus/school-core/lib/finance-staff-retention.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { DataTable, ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  categoryLabel,
  destroyNotice,
  dueText,
  periodText,
  RETENTION_UNIT_LABELS,
  RETENTION_UNITS,
  retentionFormDefaults,
  retentionFormSchema,
  retentionMonthsOf,
  retentionPolicyBody,
  type RetentionFormValues,
} from './finance-staff-retention-forms.ts'

const NO_SORT: readonly string[] = []
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isCategory = (value: string | null): value is StaffRetentionCategory =>
  value !== null && (STAFF_RETENTION_CATEGORIES as readonly string[]).includes(value)
const CATEGORY_OPTIONS = STAFF_RETENTION_CATEGORIES.map((value) => ({
  value,
  label: categoryLabel(value),
}))
const CANDIDATE_FILTERS = [
  { key: 'category', label: 'Veri kategorisi', type: 'select' as const, options: CATEGORY_OPTIONS },
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: [
      { value: 'due', label: 'Süresi doldu' },
      { value: 'waiting', label: 'Süre sürüyor' },
    ],
  },
]
const DESTRUCTION_FILTERS = [
  { key: 'category', label: 'Veri kategorisi', type: 'select' as const, options: CATEGORY_OPTIONS },
]

type PolicyRow = {
  id: string
  category: string
  period: string
  minimum: string
  start: string
  method: string
  policy: StaffRetentionPolicyRow
}
type CandidateRow = {
  id: string
  name: string
  category: string
  separation: string
  records: number
  candidate: StaffRetentionCandidateRow
}
type DestructionRow = {
  id: string
  destroyedAt: string
  category: string
  method: string
  records: string
  period: string
  destroyedBy: string
}

/**
 * Özlük saklama ve imha (DOM-FIN-122; ON-176; IST-021): Finans "Özlük saklama ve imha" sekmesi,
 * yalnız yönetici (K-417). Üç bölüm: kategori başına saklama politikası (süre yalnız yasal en az
 * sürenin üstüne uzatılır, K-415), ayrılmış personelin imha adayları (süresi dolanda "İmha et";
 * onay penceresi taze oturum ister) ve kişisel veri içermeyen imha kayıtları. Arka plan otomatik
 * imhası yoktur.
 */
export function FinanceStaffRetentionSection() {
  return (
    <section
      aria-labelledby="ozluk-imha"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-1 px-6 pt-6 pb-2">
        <h2 id="ozluk-imha" className="text-lg font-semibold">
          Özlük saklama ve imha
        </h2>
        <p className="text-sm text-muted-foreground">
          Ayrılan personelin verisi kategori başına saklama süresi dolunca yönetici onayıyla imha
          edilir; kendiliğinden silinmez. Süreler mevzuattaki saklama ve zamanaşımı sürelerinin
          temkinli okumasıdır ve hukukçu onayı beklemektedir.
        </p>
      </header>
      <PolicyPanel />
      <CandidatesPanel />
      <DestructionsPanel />
    </section>
  )
}

function PolicyPanel() {
  const policies = useStaffRetentionPolicies()
  const [editing, setEditing] = useState<StaffRetentionPolicyRow | null>(null)
  const rows = useMemo(
    () =>
      policies.data?.data.map((policy): PolicyRow => ({
        id: policy.category,
        category: categoryLabel(policy.category),
        period: periodText(policy.retentionMonths),
        minimum: periodText(policy.legalMinimumMonths),
        start: STAFF_RETENTION_START_EVENT_LABELS[policy.startEvent],
        method: STAFF_RETENTION_METHOD_LABELS[policy.method],
        policy,
      })) ?? [],
    [policies.data],
  )
  const columns = useMemo<DataColumn<PolicyRow>[]>(
    () => [
      {
        key: 'category',
        label: 'Veri kategorisi',
        cell: (row) => (
          <span className="grid gap-0.5">
            <span className="font-medium">{row.category}</span>
            <span className="text-xs text-muted-foreground">
              {STAFF_RETENTION_CATEGORY_SPECS[row.policy.category].contents}
            </span>
          </span>
        ),
      },
      {
        key: 'period',
        label: 'Saklama süresi',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            {row.period}
            {row.policy.customized ? <StatusBadge text="Kurum ayarı" tone="purple" /> : null}
          </span>
        ),
      },
      { key: 'minimum', label: 'Yasal en az' },
      { key: 'start', label: 'Başlangıç' },
      {
        key: 'method',
        label: 'Yöntem',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            {row.method}
            {row.policy.special ? <StatusBadge text="Özel nitelikli" tone="amber" /> : null}
          </span>
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="outline"
            aria-label={`${row.category} süresini değiştir`}
            onClick={() => setEditing(row.policy)}
          >
            Süreyi değiştir
          </Button>
        ),
      },
    ],
    [],
  )
  return (
    <div className="grid gap-2 border-t px-6 py-4">
      <h3 className="text-base font-semibold">Saklama politikası</h3>
      <p className="text-sm text-muted-foreground">
        Süre personelin ayrılış gününden (pasifleştirildiği gün) ya da mali kayıtlarda ayrılış
        yılını izleyen yıl başından sayılır. Kurum süreyi uzatabilir, yasal en az sürenin altına
        inemez.
      </p>
      {policies.error ? (
        <QueryError error={policies.error} onRetry={() => void policies.refetch()} />
      ) : (
        <DataTable
          listKey="ozluk-saklama-politika"
          rows={rows}
          columns={columns}
          search={false}
          pageSize={10}
          mobileColumns={['category', 'period']}
          caption="Saklama politikası"
          empty={policies.isPending ? 'Politika yükleniyor…' : 'Kategori yok.'}
        />
      )}
      <Modal
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        title="Saklama süresini değiştir"
        description={
          editing === null
            ? undefined
            : `${categoryLabel(editing.category)}: yasal en az süre ${periodText(editing.legalMinimumMonths)}. ${STAFF_RETENTION_CATEGORY_SPECS[editing.category].legalBasis}.`
        }
      >
        {editing ? <PolicyForm policy={editing} onDone={() => setEditing(null)} /> : null}
      </Modal>
    </div>
  )
}

function PolicyForm({ policy, onDone }: { policy: StaffRetentionPolicyRow; onDone: () => void }) {
  const update = useUpdateStaffRetentionPolicies()
  const form = useForm<RetentionFormValues>({
    resolver: zodResolver(retentionFormSchema(policy)),
    defaultValues: retentionFormDefaults(policy),
  })
  const errors = form.formState.errors
  const busy = update.isPending || form.formState.isSubmitting
  const setError = (name: string, error: { type: string; message: string }) => {
    if (name.endsWith('retentionMonths')) form.setError('amount', error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const save = async (months: number | null) => {
    const outcome = await update.submit(retentionPolicyBody(policy.category, months), {
      setError,
    })
    if (outcome.status !== 'success') return
    notify.success(`${categoryLabel(policy.category)} saklama süresi kaydedildi.`)
    onDone()
  }
  const onSubmit = form.handleSubmit((values) => save(retentionMonthsOf(values)))
  return (
    <form
      noValidate
      aria-label="Saklama süresi ayarı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="ozluk-sure" label="Süre" error={errors.amount}>
        {(control) => (
          <Input
            {...control}
            type="number"
            inputMode="numeric"
            min={1}
            {...form.register('amount', { valueAsNumber: true })}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="ozluk-birim" label="Birim" error={errors.unit}>
        {(control) => (
          <NativeSelect {...control} {...form.register('unit')} className="w-full" disabled={busy}>
            {RETENTION_UNITS.map((unit) => (
              <NativeSelectOption key={unit} value={unit}>
                {RETENTION_UNIT_LABELS[unit]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
        {policy.customized ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void save(null)}>
            Yasal en az süreye dön
          </Button>
        ) : null}
      </div>
    </form>
  )
}

function CandidatesPanel() {
  const list = useListState('ozluk-imha-aday', { urlPrefix: 'oimha_' })
  const search = useDebouncedValue(list.state.query).trim()
  const category = text(list.state.filters.category)
  const status = text(list.state.filters.status)
  const candidates = useStaffRetentionCandidates({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isCategory(category) ? { category } : {}),
    ...(status === 'due' || status === 'waiting' ? { status } : {}),
  })
  const [destroying, setDestroying] = useState<StaffRetentionCandidateRow | null>(null)
  const rows = useMemo(
    () =>
      candidates.data?.data.map((candidate): CandidateRow => ({
        id: `${candidate.membershipId}:${candidate.category}`,
        name: candidate.name,
        category: categoryLabel(candidate.category),
        separation: dateLabel(candidate.separationDate, { year: 'numeric' }),
        records: candidate.recordCount,
        candidate,
      })),
    [candidates.data],
  )
  const columns = useMemo<DataColumn<CandidateRow>[]>(
    () => [
      { key: 'name', label: 'Personel' },
      { key: 'category', label: 'Veri kategorisi' },
      { key: 'separation', label: 'Ayrılış' },
      { key: 'records', label: 'Kayıt' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={dueText(row.candidate)}
            tone={row.candidate.status === 'due' ? 'red' : 'gray'}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) =>
          row.candidate.status === 'due' ? (
            <Button
              size="sm"
              variant="destructive"
              aria-label={`${row.name} ${row.category} imha et`}
              onClick={() => setDestroying(row.candidate)}
            >
              İmha et
            </Button>
          ) : null,
      },
    ],
    [],
  )
  return (
    <div className="grid gap-2 border-t px-6 py-4">
      <h3 className="text-base font-semibold">İmha adayları</h3>
      <p className="text-sm text-muted-foreground">
        Ayrılmış personelin kaydı bulunan kategorileri. Süresi dolan kategori onayla imha edilir;
        yeniden etkinleştirilen personel listede yer almaz.
      </p>
      <ServerDataTable
        list={list}
        rows={rows}
        total={candidates.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={CANDIDATE_FILTERS}
        mobileColumns={['name', 'category', 'status']}
        caption="İmha adayları"
        empty="İmha adayı yok: ayrılmış personelin kaydı bulunmuyor."
        emptyFiltered="Bu seçimle eşleşen aday yok."
        loading={candidates.isPending}
        fetching={candidates.isFetching && !candidates.isPending}
        error={
          candidates.error ? (
            <QueryError error={candidates.error} onRetry={() => void candidates.refetch()} />
          ) : undefined
        }
      />
      {destroying ? (
        <DestroyDialog candidate={destroying} onClose={() => setDestroying(null)} />
      ) : null}
    </div>
  )
}

/** İmha onayı (K-417): uyarı, taze oturum (parola penceresi) ve tek seferlik istek anahtarı. */
function DestroyDialog({
  candidate,
  onClose,
}: {
  candidate: StaffRetentionCandidateRow
  onClose: () => void
}) {
  const destroy = useDestroyStaffData()
  const { run, reauthModal } = useReauthRetry()
  const [error, setError] = useState<string | undefined>(undefined)
  const busy = destroy.isPending
  const onConfirm = async () => {
    setError(undefined)
    const outcome = await run(() =>
      destroy.submit(
        { membershipId: candidate.membershipId, category: candidate.category },
        {
          silent: isReauthenticationRequired,
          setError: (_name, problem) => setError(problem.message),
        },
      ),
    )
    if (outcome.status !== 'done') return
    const result = outcome.result
    if (result.status === 'success') {
      notify.success(
        `${categoryLabel(candidate.category)} imha edildi: ${String(result.data.data.recordCount)} kayıt.`,
      )
      onClose()
    } else if (result.status === 'failed' && result.error.status === 422) onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Özlük verisini imha et"
    >
      <div className="grid gap-3">
        <p className="text-sm">{destroyNotice(candidate)}</p>
        <p className="text-sm text-muted-foreground">
          İmha kaydına kategori, kayıt sayısı, imha eden ve an yazılır; personelin adı yazılmaz.
          Onay için parolanız istenebilir.
        </p>
        <RootError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void onConfirm()}
          >
            Kalıcı olarak imha et
          </Button>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
        </div>
      </div>
      {reauthModal}
    </Modal>
  )
}

function DestructionsPanel() {
  const list = useListState('ozluk-imha-kayit', { urlPrefix: 'okayit_' })
  const category = text(list.state.filters.category)
  const destructions = useStaffDataDestructions({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(isCategory(category) ? { category } : {}),
  })
  const rows = useMemo(
    () =>
      destructions.data?.data.map((item): DestructionRow => ({
        id: item.id,
        destroyedAt: dateLabel(item.destroyedAt, {
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        category: categoryLabel(item.category),
        method: STAFF_RETENTION_METHOD_LABELS[item.method],
        records:
          item.fileCount > 0
            ? `${String(item.recordCount)} kayıt, ${String(item.fileCount)} dosya`
            : `${String(item.recordCount)} kayıt`,
        period: periodText(item.retentionMonths),
        destroyedBy: item.destroyedByName ?? '—',
      })),
    [destructions.data],
  )
  const columns = useMemo<DataColumn<DestructionRow>[]>(
    () => [
      { key: 'destroyedAt', label: 'İmha anı' },
      { key: 'category', label: 'Veri kategorisi' },
      { key: 'method', label: 'Yöntem' },
      { key: 'records', label: 'İmha edilen' },
      { key: 'period', label: 'Uygulanan süre' },
      { key: 'destroyedBy', label: 'İmha eden' },
    ],
    [],
  )
  return (
    <div className="grid gap-2 border-t px-6 py-4">
      <h3 className="text-base font-semibold">İmha kayıtları</h3>
      <p className="text-sm text-muted-foreground">
        Kayıt silinmez ve değiştirilmez; imha edilen personelin kimliğini içermez.
      </p>
      <ServerDataTable
        list={list}
        rows={rows}
        total={destructions.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={DESTRUCTION_FILTERS}
        search={false}
        mobileColumns={['destroyedAt', 'category', 'records']}
        caption="İmha kayıtları"
        empty="Henüz imha yapılmadı."
        emptyFiltered="Bu kategoride imha kaydı yok."
        loading={destructions.isPending}
        fetching={destructions.isFetching && !destructions.isPending}
        error={
          destructions.error ? (
            <QueryError error={destructions.error} onRetry={() => void destructions.refetch()} />
          ) : undefined
        }
      />
    </div>
  )
}
