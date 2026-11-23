import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useApproveStaffChangeRequest,
  useRejectStaffChangeRequest,
  useStaffChangeRequestFileUrlFetcher,
  useStaffChangeRequests,
  type StaffChangeRequest,
} from '@kampus/react-shared/use-finance-staff-self-service.ts'
import type { StaffChangeStatus } from '@kampus/school-core/lib/finance-staff-self-service.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { roleLabel } from './finance-fixed-asset-assignment-forms.ts'
import {
  CHANGE_STATUS_OPTIONS,
  changeStatusLabel,
  changeStatusTone,
  kindLabel,
  proposalText,
  rejectFormSchema,
  requestDayText,
  type RejectFormValues,
} from './finance-staff-self-service-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'status']
const FILTERS = [
  { key: 'status', label: 'Talep durumu', type: 'select' as const, options: CHANGE_STATUS_OPTIONS },
]
const STATUSES = new Set<string>(CHANGE_STATUS_OPTIONS.map((option) => option.value))
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const FILE_POPUP_BLOCKED =
  'Açılır pencere engellendi. Tarayıcıda bu site için açılır pencerelere izin verip yeniden deneyin.'

type Row = {
  id: string
  name: string
  kind: string
  proposal: string
  created: string
  status: StaffChangeStatus
  item: StaffChangeRequest
}

/**
 * Değişiklik talepleri (DOM-FIN-166; ON-189; K-553): Finans "Değişiklik talepleri" sekmesi,
 * yalnız yönetici. Personelin adres/telefon, acil durum, banka ve belge talepleri; bekleyenler
 * önce. Onay kartı ya da belgeyi aynı işlemde yazar; ret gerekçesi personele görünür. IBAN maskeli,
 * belge dosyası her açılışı denetime yazılarak yeni sekmede açılır.
 */
export function FinanceStaffChangeRequestsSection() {
  const list = useListState('degisiklik-talepleri', { urlPrefix: 'dt_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const requests = useStaffChangeRequests({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status !== null && STATUSES.has(status) ? { status: status as StaffChangeStatus } : {}),
  })
  const approve = useApproveStaffChangeRequest()
  const fetchUrl = useStaffChangeRequestFileUrlFetcher()
  const [rejecting, setRejecting] = useState<StaffChangeRequest | null>(null)
  const [opening, setOpening] = useState('')

  const rows = useMemo(
    () =>
      requests.data?.data.map((item): Row => ({
        id: item.id,
        name: `${item.name} · ${roleLabel(item.role)}`,
        kind: kindLabel(item.kind),
        proposal: proposalText(item.proposal),
        created: requestDayText(item.createdAt),
        status: item.status,
        item,
      })),
    [requests.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(() => {
    async function confirm(item: StaffChangeRequest) {
      const outcome = await approve.submit({ requestId: item.id, version: item.version })
      if (outcome.status === 'success') notify.success('Talep onaylandı ve kayda yazıldı.')
    }
    async function openFile(item: StaffChangeRequest) {
      const tab = window.open('about:blank', '_blank')
      if (!tab) {
        // Bağlantı üretmek denetim kaydıdır; pencere açılamıyorsa üretilmez.
        notify.error(FILE_POPUP_BLOCKED)
        return
      }
      setOpening(item.id)
      try {
        const { url } = await fetchUrl(item.id)
        tab.opener = null
        tab.location.href = url
      } catch (error) {
        tab.close()
        notify.error('Dosya açılamadı. Biraz sonra yeniden deneyin.', error)
      } finally {
        setOpening('')
      }
    }
    return [
      { key: 'name', label: 'Personel' },
      { key: 'kind', label: 'Tür' },
      {
        key: 'proposal',
        label: 'İstenen',
        cell: (row) => (
          <span className="[overflow-wrap:anywhere]">
            {row.proposal}
            {row.item.rejectionReason === null ? null : (
              <span className="block text-muted-foreground">
                Ret gerekçesi: {row.item.rejectionReason}
              </span>
            )}
          </span>
        ),
      },
      { key: 'created', label: 'Talep günü' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge text={changeStatusLabel(row.status)} tone={changeStatusTone(row.status)} />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => {
          const item = row.item
          const hasFile = item.proposal.kind === 'document' && item.proposal.hasFile
          if (item.status !== 'pending') return null
          return (
            <div className="flex flex-wrap gap-2">
              {hasFile ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${row.name} belge dosyasını aç`}
                  disabled={opening === item.id}
                  onClick={() => void openFile(item)}
                >
                  Dosyayı aç
                </Button>
              ) : null}
              <Button
                size="sm"
                aria-label={`${row.name} ${row.kind} talebini onayla`}
                disabled={approve.isPending}
                onClick={() => void confirm(item)}
              >
                Onayla
              </Button>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.name} ${row.kind} talebini reddet`}
                onClick={() => setRejecting(item)}
              >
                Reddet
              </Button>
            </div>
          )
        },
      },
    ]
  }, [approve, fetchUrl, opening])

  return (
    <section
      aria-labelledby="degisiklik-talepleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-1 px-6 pt-6 pb-2">
        <h2 id="degisiklik-talepleri" className="text-lg font-semibold">
          Değişiklik talepleri
        </h2>
        <p className="text-sm text-muted-foreground">
          Personelin kendi bilgileri için gönderdiği talepler. Onaylanan talep özlük kartına ya da
          özlük belgelerine yazılır; reddederken gerekçe yazın, personel görür.
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={requests.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Değişiklik talepleri"
        empty="Henüz değişiklik talebi yok."
        emptyFiltered="Bu seçimle eşleşen talep yok."
        loading={requests.isPending}
        fetching={requests.isFetching && !requests.isPending}
        error={
          requests.error ? (
            <QueryError error={requests.error} onRetry={() => void requests.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={rejecting !== null}
        onOpenChange={(open) => (open ? undefined : setRejecting(null))}
        title="Talebi reddet"
        description="Gerekçe personele gösterilir."
      >
        {rejecting === null ? null : (
          <RejectForm item={rejecting} onDone={() => setRejecting(null)} />
        )}
      </Modal>
    </section>
  )
}

function RejectForm({ item, onDone }: { item: StaffChangeRequest; onDone: () => void }) {
  const reject = useRejectStaffChangeRequest()
  const form = useForm<RejectFormValues>({
    resolver: zodResolver(rejectFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = reject.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await reject.submit(
      { requestId: item.id, version: item.version, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Talep reddedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Ret gerekçesi"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="degisiklik-ret" label="Gerekçe" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Reddet
        </Button>
      </div>
    </form>
  )
}
