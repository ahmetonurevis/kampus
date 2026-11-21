import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import {
  useAnonymizeVisitors,
  useCheckInVisitor,
  useCheckOutVisitor,
  useReleaseVisitorBadge,
  useSetVisitorSettings,
  useVisitor,
  useVisitorHosts,
  useVisitorRetention,
  useVisitors,
  useVisitorSettings,
  useVisitorSummary,
  type VisitorDetail,
  type VisitorRow,
  type VisitorSettingsData,
  type VisitorSummary,
} from '@kampus/react-shared/use-finance-visitors.ts'
import { dayKey, timeLabel } from '@kampus/school-core/lib/format.ts'
import {
  VISITOR_ANONYMIZATION_REASON_LABELS,
  VISITOR_ID_DOCUMENT_TYPE_LABELS,
  VISITOR_ID_DOCUMENT_TYPES,
  VISITOR_PURPOSE_LABELS,
  VISITOR_PURPOSES,
  type VisitorBadgeRelease,
} from '@kampus/school-core/lib/finance-visitors.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreList } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  badgeText,
  checkInBody,
  checkInDefaults,
  checkInFormField,
  checkInFormSchema,
  dayText,
  purposeText,
  settingsBody,
  settingsDefaults,
  settingsFormField,
  settingsFormSchema,
  visitorStatusBadge,
  visitTimeText,
  type CheckInFormValues,
  type SettingsFormValues,
} from './finance-visitor-forms.ts'

const NO_SORT: readonly string[] = []
const TAB_PARAM = 'ziyaretci_sekme'
const STAFF_TABS = [
  { value: 'iceride', label: 'İçeridekiler' },
  { value: 'kayitlar', label: 'Kayıtlar' },
  { value: 'kartlar', label: 'Kartlar' },
] as const
const MANAGER_TABS = [...STAFF_TABS, { value: 'saklama', label: 'Ayar ve saklama' }] as const
type Tab = (typeof MANAGER_TABS)[number]['value']
const PURPOSE_FILTERS = [
  {
    key: 'purpose',
    label: 'Amaç',
    type: 'select' as const,
    options: VISITOR_PURPOSES.map((value) => ({ value, label: VISITOR_PURPOSE_LABELS[value] })),
  },
]
const HOST_QUERY = { page: 1, pageSize: 100 } as const
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

/**
 * Ziyaretçiler (DOM-FIN-141; ON-166): Finans "Ziyaretçiler" sekmesi, yönetici ve ön büro (K-478).
 * "İçeridekiler" gün sonu listesidir (önceki günden kalanlar önce ve uyarılı), satırdan tek dokunuşla
 * çıkış; "Kayıtlar" gün ve amaç süzgeçli geçmiş; "Kartlar" iade bekleyen kartlar (K-479). Yönetici
 * "Ayar ve saklama"da süreyi, aydınlatma sürümünü, kart havuzunu ve süresi dolan kayıtları yönetir
 * (K-480). Ayrıntı sağ panelde; telefon maskelidir, tam numara düğmeyle görünür.
 */
export function FinanceVisitorsSection({ isManager }: { isManager: boolean }) {
  const [params, setParams] = useSearchParams()
  const tabs = isManager ? MANAGER_TABS : STAFF_TABS
  const requested = params.get(TAB_PARAM)
  const tab: Tab = tabs.find((item) => item.value === requested)?.value ?? 'iceride'
  const panel = useDetailPanel('ziyaretci')
  const summary = useVisitorSummary()
  const [checkingIn, setCheckingIn] = useState(false)
  const setTab = (next: Tab) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (next === 'iceride') copy.delete(TAB_PARAM)
        else copy.set(TAB_PARAM, next)
        return copy
      },
      { replace: true },
    )
  return (
    <section
      aria-labelledby="ziyaretciler"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="ziyaretciler" className="text-lg font-semibold">
            Ziyaretçiler
          </h2>
          <p className="text-sm text-muted-foreground">
            Giriş, çıkış ve ziyaretçi kartı. Kimlik numarası alınmaz; yalnız belgenin görüldüğü
            işaretlenir. Aydınlatma metni gösterilmeden kayıt yapılmaz.
          </p>
          <SummaryLine summary={summary.data?.data} />
        </div>
        <Button className="min-h-11" onClick={() => setCheckingIn(true)}>
          Ziyaretçi girişi
        </Button>
      </header>
      {summary.error ? (
        <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
      ) : null}
      <div className="px-6">
        <LineTabs label="Ziyaretçi görünümü" value={tab} options={tabs} onChange={setTab} />
      </div>
      {tab === 'iceride' ? <InsideList onOpen={panel.open} /> : null}
      {tab === 'kayitlar' ? <RecordList onOpen={panel.open} /> : null}
      {tab === 'kartlar' ? <BadgeList onOpen={panel.open} /> : null}
      {tab === 'saklama' && isManager ? <RetentionView onOpen={panel.open} /> : null}
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Ziyaret kaydı"
      >
        {panel.selectedId ? (
          <VisitorPanel visitorId={panel.selectedId} isManager={isManager} />
        ) : null}
      </SidePanel>
      <Modal
        open={checkingIn}
        onOpenChange={setCheckingIn}
        title="Ziyaretçi girişi"
        description="Belgeyi görün, numarasını yazmayın. Aydınlatma metnini gösterip işaretleyin."
        size="wide"
      >
        {checkingIn ? (
          <CheckInForm
            summary={summary.data?.data}
            onDone={() => {
              setCheckingIn(false)
              setTab('iceride')
            }}
          />
        ) : null}
      </Modal>
    </section>
  )
}

function SummaryLine({ summary }: { summary: VisitorSummary | undefined }) {
  if (!summary) return null
  const free = summary.badges.filter((badge) => badge.visitorId === null).length
  return (
    <p className="text-sm" aria-live="polite">
      {`Bugün ${String(summary.visitsToday)} ziyaret · içeride ${String(summary.inside)}`}
      {summary.insideFromEarlier > 0 ? (
        <span className="font-medium text-danger">{` · önceki günden ${String(summary.insideFromEarlier)} çıkış bekliyor`}</span>
      ) : null}
      {summary.badges.length > 0
        ? ` · ${String(free)}/${String(summary.badges.length)} kart boşta`
        : ''}
    </p>
  )
}

// --- Listeler ------------------------------------------------------------------------------------

type TableRow = {
  id: string
  row: VisitorRow
  visitor: string
  purpose: string
  host: string
  time: string
  badge: string
}
const toTableRow = (item: VisitorRow): TableRow => ({
  id: item.id,
  row: item,
  visitor: item.visitorName,
  purpose: purposeText(item.purpose),
  host: item.hostName ?? item.studentName ?? '—',
  time: visitTimeText(item),
  badge: badgeText(item),
})
const statusColumn: DataColumn<TableRow> = {
  key: 'status',
  label: 'Durum',
  cell: (row) => {
    const badge = visitorStatusBadge(row.row)
    return <StatusBadge text={badge.text} tone={badge.tone} />
  },
}

function InsideList({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('ziyaretci-iceride', { urlPrefix: 'iceride_' })
  const search = useDebouncedValue(list.state.query).trim()
  const visitors = useVisitors({
    page: list.state.page,
    pageSize: list.state.pageSize,
    status: 'inside',
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const [leaving, setLeaving] = useState<VisitorRow | null>(null)
  const checkOut = useCheckOutVisitor()
  const rows = useMemo(() => visitors.data?.data.map(toTableRow), [visitors.data])
  const columns = useMemo<DataColumn<TableRow>[]>(() => {
    const leave = async (row: VisitorRow) => {
      if (row.badgeStatus === 'out') {
        setLeaving(row)
        return
      }
      const outcome = await checkOut.submit({
        visitorId: row.id,
        version: row.version,
        body: { badgeReturned: true },
      })
      if (outcome.status === 'success') notify.success(`${row.visitorName} çıkış yaptı.`)
    }
    return [
      { key: 'visitor', label: 'Ziyaretçi' },
      { key: 'purpose', label: 'Amaç' },
      { key: 'host', label: 'Görüşülen' },
      { key: 'time', label: 'Giriş' },
      { key: 'badge', label: 'Kart' },
      statusColumn,
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              variant="secondary"
              aria-label={`${row.visitor} çıkışını kaydet`}
              disabled={checkOut.isPending}
              onClick={() => void leave(row.row)}
            >
              Çıkış
            </Button>
            <Button
              className="min-h-11"
              variant="ghost"
              aria-label={`${row.visitor} kaydını aç`}
              onClick={() => onOpen(row.id)}
            >
              Aç
            </Button>
          </span>
        ),
      },
    ]
  }, [checkOut, onOpen])
  return (
    <>
      <ServerDataTable
        list={list}
        rows={rows}
        total={visitors.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={['visitor', ACTIONS_KEY]}
        caption="İçerideki ziyaretçiler"
        empty="İçeride ziyaretçi yok."
        emptyFiltered="Bu aramayla eşleşen ziyaretçi yok."
        loading={visitors.isPending}
        fetching={visitors.isFetching && !visitors.isPending}
        error={
          visitors.error ? (
            <QueryError error={visitors.error} onRetry={() => void visitors.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={leaving !== null}
        onOpenChange={(open) => (open ? undefined : setLeaving(null))}
        title="Ziyaretçi çıkışı"
        description="Ziyaretçide kart var. Kartı aldıysanız iade edildi olarak kaydedin."
      >
        {leaving ? <CheckOutChoice visitor={leaving} onDone={() => setLeaving(null)} /> : null}
      </Modal>
    </>
  )
}

function CheckOutChoice({ visitor, onDone }: { visitor: VisitorRow; onDone: () => void }) {
  const checkOut = useCheckOutVisitor()
  const busy = checkOut.isPending
  const submit = async (badgeReturned: boolean) => {
    const outcome = await checkOut.submit({
      visitorId: visitor.id,
      version: visitor.version,
      body: { badgeReturned },
    })
    if (outcome.status === 'success')
      notify.success(
        badgeReturned
          ? `${visitor.visitorName} çıkış yaptı, kart alındı.`
          : `${visitor.visitorName} çıkış yaptı; kart iade bekliyor.`,
      )
    if (outcome.status !== 'busy') onDone()
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm">{`${visitor.visitorName} · kart ${visitor.badgeNumber ?? ''}`}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void submit(true)}
        >
          Kart alındı, çıkışı kaydet
        </Button>
        <Button
          className="min-h-11"
          variant="outline"
          disabled={busy}
          onClick={() => void submit(false)}
        >
          Kart alınmadı
        </Button>
      </div>
    </div>
  )
}

function RecordList({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('ziyaretci-kayitlar', { urlPrefix: 'kayit_' })
  const [day, setDay] = useState(() => dayKey())
  const dayId = useId()
  const search = useDebouncedValue(list.state.query).trim()
  const purpose = VISITOR_PURPOSES.find((value) => value === text(list.state.filters.purpose))
  const visitors = useVisitors({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(day === '' ? {} : { date: day }),
    ...(purpose === undefined ? {} : { purpose }),
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const rows = useMemo(() => visitors.data?.data.map(toTableRow), [visitors.data])
  const columns = useMemo<DataColumn<TableRow>[]>(
    () => [
      { key: 'visitor', label: 'Ziyaretçi' },
      { key: 'purpose', label: 'Amaç' },
      { key: 'host', label: 'Görüşülen' },
      { key: 'time', label: 'Giriş – çıkış' },
      { key: 'badge', label: 'Kart' },
      statusColumn,
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.visitor} kaydını aç`}
            onClick={() => onOpen(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [onOpen],
  )
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2 px-6 pt-4">
        <div className="grid gap-1">
          <Label htmlFor={dayId}>Ziyaret günü</Label>
          <Input
            id={dayId}
            type="date"
            value={day}
            className="max-w-48"
            onChange={(event) => setDay(event.target.value)}
          />
        </div>
        <Button variant="ghost" className="min-h-11" onClick={() => setDay('')}>
          Bütün günler
        </Button>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={visitors.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={PURPOSE_FILTERS}
        mobileColumns={['visitor', 'status']}
        caption="Ziyaret kayıtları"
        empty={day === '' ? 'Henüz ziyaret kaydı yok.' : `${dayText(day)} günü ziyaret yok.`}
        emptyFiltered="Bu seçimle eşleşen ziyaret yok."
        loading={visitors.isPending}
        fetching={visitors.isFetching && !visitors.isPending}
        error={
          visitors.error ? (
            <QueryError error={visitors.error} onRetry={() => void visitors.refetch()} />
          ) : undefined
        }
      />
    </div>
  )
}

function BadgeList({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('ziyaretci-kartlar', { urlPrefix: 'kart_' })
  const visitors = useVisitors({
    page: list.state.page,
    pageSize: list.state.pageSize,
    badge: 'outstanding',
  })
  const release = useReleaseVisitorBadge()
  const rows = useMemo(() => visitors.data?.data.map(toTableRow), [visitors.data])
  const columns = useMemo<DataColumn<TableRow>[]>(() => {
    const submit = async (row: VisitorRow, outcome: VisitorBadgeRelease) => {
      const result = await release.submit({
        visitorId: row.id,
        version: row.version,
        body: { outcome },
      })
      if (result.status === 'success')
        notify.success(
          outcome === 'returned'
            ? `${row.badgeNumber ?? ''} numaralı kart iade alındı.`
            : `${row.badgeNumber ?? ''} numaralı kart kayıp işaretlendi.`,
        )
    }
    return [
      { key: 'badge', label: 'Kart' },
      { key: 'visitor', label: 'Ziyaretçi' },
      { key: 'time', label: 'Giriş – çıkış' },
      statusColumn,
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              variant="secondary"
              aria-label={`${row.visitor} kartını iade al`}
              disabled={release.isPending}
              onClick={() => void submit(row.row, 'returned')}
            >
              İade alındı
            </Button>
            <Button
              className="min-h-11"
              variant="ghost"
              aria-label={`${row.visitor} kartını kayıp işaretle`}
              disabled={release.isPending}
              onClick={() => void submit(row.row, 'lost')}
            >
              Kayıp
            </Button>
            <Button
              className="min-h-11"
              variant="ghost"
              aria-label={`${row.visitor} kaydını aç`}
              onClick={() => onOpen(row.id)}
            >
              Aç
            </Button>
          </span>
        ),
      },
    ]
  }, [release, onOpen])
  return (
    <ServerDataTable
      list={list}
      rows={rows}
      total={visitors.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      mobileColumns={['badge', ACTIONS_KEY]}
      caption="İade bekleyen kartlar"
      empty="Ziyaretçide kalan kart yok."
      emptyFiltered="Ziyaretçide kalan kart yok."
      loading={visitors.isPending}
      fetching={visitors.isFetching && !visitors.isPending}
      error={
        visitors.error ? (
          <QueryError error={visitors.error} onRetry={() => void visitors.refetch()} />
        ) : undefined
      }
    />
  )
}

// --- Giriş formu ---------------------------------------------------------------------------------

function CheckInForm({
  summary,
  onDone,
}: {
  summary: VisitorSummary | undefined
  onDone: () => void
}) {
  const hosts = useVisitorHosts(HOST_QUERY)
  const create = useCheckInVisitor()
  const form = useForm<CheckInFormValues>({
    resolver: zodResolver(checkInFormSchema),
    defaultValues: checkInDefaults(summary?.privacyNoticeVersion ?? null),
  })
  const [identityVerified, purpose] = useWatch({
    control: form.control,
    name: ['identityVerified', 'purpose'],
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const freeBadges = (summary?.badges ?? []).filter((badge) => badge.visitorId === null)
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(checkInBody(values), {
      setError: (name, error) => {
        const field = checkInFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.visitorName} içeri alındı.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Ziyaretçi girişi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="ziyaretci-ad" label="Ad soyad" error={errors.visitorName}>
          {(control) => (
            <Input
              {...control}
              autoComplete="off"
              {...form.register('visitorName')}
              disabled={busy}
            />
          )}
        </FormField>
      </div>
      <div className="flex min-h-11 items-center gap-2">
        <Controller
          control={form.control}
          name="identityVerified"
          render={({ field }) => (
            <Checkbox
              id="ziyaretci-kimlik"
              checked={field.value}
              disabled={busy}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          )}
        />
        <Label htmlFor="ziyaretci-kimlik">Kimlik belgesi görüldü</Label>
      </div>
      {identityVerified ? (
        <FormField
          id="ziyaretci-belge"
          label="Görülen belge"
          error={errors.identityDocumentType}
          description="Belge numarası yazılmaz."
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('identityDocumentType')}
              className="w-full"
              disabled={busy}
            >
              {VISITOR_ID_DOCUMENT_TYPES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {VISITOR_ID_DOCUMENT_TYPE_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : (
        <p className="self-center text-sm text-muted-foreground">Belge görülmedi.</p>
      )}
      <FormField id="ziyaretci-amac" label="Ziyaret amacı" error={errors.purpose}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('purpose')}
            className="w-full"
            disabled={busy}
          >
            {VISITOR_PURPOSES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {VISITOR_PURPOSE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="ziyaretci-telefon" label="Telefon (isteğe bağlı)" error={errors.phone}>
        {(control) => <Input {...control} type="tel" {...form.register('phone')} disabled={busy} />}
      </FormField>
      <div className="sm:col-span-2">
        <FormField
          id="ziyaretci-aciklama"
          label={purpose === 'other' ? 'Açıklama' : 'Açıklama (isteğe bağlı)'}
          error={errors.purposeNote}
        >
          {(control) => (
            <Textarea {...control} {...form.register('purposeNote')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <FormField
        id="ziyaretci-kisi"
        label="Görüşülecek kişi (isteğe bağlı)"
        error={errors.hostMembershipId}
      >
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('hostMembershipId')}
            className="w-full"
            disabled={busy || hosts.isPending}
          >
            <NativeSelectOption value="">Seçilmedi</NativeSelectOption>
            {(hosts.data?.data ?? []).map((host) => (
              <NativeSelectOption key={host.membershipId} value={host.membershipId}>
                {host.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="ziyaretci-kart" label="Ziyaretçi kartı" error={errors.badgeNumber}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('badgeNumber')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Kart verilmedi</NativeSelectOption>
            {freeBadges.map((badge) => (
              <NativeSelectOption key={badge.number} value={badge.number}>
                {badge.number}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {purpose === 'parent_meeting' ? (
        <div className="sm:col-span-2">
          <Controller
            control={form.control}
            name="studentId"
            render={({ field }) => (
              <StudentChoice
                value={field.value}
                onChange={field.onChange}
                error={errors.studentId?.message}
                disabled={busy}
              />
            )}
          />
        </div>
      ) : null}
      <FormField
        id="ziyaretci-aydinlatma"
        label="Gösterilen aydınlatma metni sürümü"
        error={errors.privacyNoticeVersion}
      >
        {(control) => (
          <Input {...control} {...form.register('privacyNoticeVersion')} disabled={busy} />
        )}
      </FormField>
      <div className="grid gap-1 self-end">
        <div className="flex min-h-11 items-center gap-2">
          <Controller
            control={form.control}
            name="privacyNoticeShown"
            render={({ field }) => (
              <Checkbox
                id="ziyaretci-aydinlatma-gosterildi"
                checked={field.value}
                disabled={busy}
                aria-invalid={Boolean(errors.privacyNoticeShown)}
                aria-describedby={
                  errors.privacyNoticeShown ? 'ziyaretci-aydinlatma-gosterildi-hata' : undefined
                }
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
            )}
          />
          <Label htmlFor="ziyaretci-aydinlatma-gosterildi">
            Aydınlatma metni ziyaretçiye gösterildi
          </Label>
        </div>
        {errors.privacyNoticeShown?.message ? (
          <p id="ziyaretci-aydinlatma-gosterildi-hata" className="text-sm text-danger">
            {errors.privacyNoticeShown.message}
          </p>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          Girişi kaydet
        </Button>
      </div>
    </form>
  )
}

/** Veli görüşmesinde öğrenci: ad ya da numarayla arama (en az 2 karakter), isteğe bağlı. */
function StudentChoice({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  error: string | undefined
  disabled: boolean
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState('')
  const search = useDebouncedValue(query).trim()
  const students = useCoreList(
    'students',
    { q: search, pageSize: 5 },
    { enabled: search.length >= 2 },
  )
  const id = useId()
  if (value !== '')
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{`Öğrenci: ${picked}`}</span>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={disabled}
          onClick={() => onChange('')}
        >
          Öğrenciyi kaldır
        </Button>
      </div>
    )
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Görüşülen öğrenci (isteğe bağlı)</Label>
      <Input
        id={id}
        value={query}
        placeholder="Ad ya da numara (en az 2 karakter)"
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {search.length >= 2 ? (
        <ul aria-label="Öğrenci arama sonuçları" className="grid gap-1">
          {(students.data?.rows ?? []).map(({ record }) => (
            <li key={record.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPicked(record.name)
                  setQuery('')
                  onChange(record.id)
                }}
              >
                {record.name}
                {record.number ? ` · ${record.number}` : ''}
              </Button>
            </li>
          ))}
          {students.isSuccess && students.data.rows.length === 0 ? (
            <li className="text-sm text-muted-foreground">Sonuç yok.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

// --- Ayrıntı -------------------------------------------------------------------------------------

function VisitorPanel({ visitorId, isManager }: { visitorId: string; isManager: boolean }) {
  const visitor = useVisitor(visitorId)
  if (visitor.error)
    return <QueryError error={visitor.error} onRetry={() => void visitor.refetch()} />
  const detail = visitor.data?.data
  if (!detail) return <SummaryLoading />
  return <VisitorDetails key={detail.version} detail={detail} isManager={isManager} />
}

function VisitorDetails({ detail, isManager }: { detail: VisitorDetail; isManager: boolean }) {
  const [showPhone, setShowPhone] = useState(false)
  const [anonymizing, setAnonymizing] = useState(false)
  const status = visitorStatusBadge(detail)
  const items: [string, string][] = [
    ['Amaç', purposeText(detail.purpose)],
    ...(detail.purposeNote ? ([['Açıklama', detail.purposeNote]] as [string, string][]) : []),
    [
      'Kimlik',
      detail.identityVerified && detail.identityDocumentType
        ? `${VISITOR_ID_DOCUMENT_TYPE_LABELS[detail.identityDocumentType]} görüldü`
        : 'Görülmedi',
    ],
    ['Görüşülen', detail.hostName ?? '—'],
    ...(detail.studentName ? ([['Öğrenci', detail.studentName]] as [string, string][]) : []),
    ['Ziyaret günü', dayText(detail.visitOn)],
    ['Giriş', timeLabel(detail.checkedInAt)],
    ['Çıkış', detail.checkedOutAt === null ? 'İçeride' : timeLabel(detail.checkedOutAt)],
    ['Kart', badgeText(detail)],
    ['Aydınlatma', `Sürüm ${detail.privacyNoticeVersion} gösterildi`],
    ['Saklama sonu', dayText(detail.retentionDueOn)],
    ...(detail.anonymizationReason
      ? ([['Anonimleştirme', VISITOR_ANONYMIZATION_REASON_LABELS[detail.anonymizationReason]]] as [
          string,
          string,
        ][])
      : []),
  ]
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{detail.visitorName}</h3>
        <StatusBadge text={status.text} tone={status.tone} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <dt className="text-muted-foreground">Telefon</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {detail.phone === null ? '—' : showPhone ? detail.phone : detail.maskedPhone}
          {detail.phone !== null && !showPhone ? (
            <Button size="sm" variant="ghost" onClick={() => setShowPhone(true)}>
              Telefonu göster
            </Button>
          ) : null}
        </dd>
      </dl>
      {isManager && !detail.anonymized && !detail.inside ? (
        <div>
          <Button variant="outline" onClick={() => setAnonymizing(true)}>
            Ziyaretçi talebiyle anonimleştir
          </Button>
        </div>
      ) : null}
      {anonymizing ? (
        <AnonymizeDialog
          ids={[detail.id]}
          reason="data_subject_request"
          description={`${detail.visitorName} kaydının adı, telefonu, açıklaması ve öğrenci bağı silinecek. Geri alınamaz.`}
          onClose={() => setAnonymizing(false)}
        />
      ) : null}
    </div>
  )
}

// --- Ayar ve saklama -----------------------------------------------------------------------------

function RetentionView({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('ziyaretci-saklama', { urlPrefix: 'saklama_' })
  const due = useVisitorRetention({ page: list.state.page, pageSize: list.state.pageSize })
  const [target, setTarget] = useState<{ ids: string[]; description: string } | null>(null)
  const rows = useMemo(() => due.data?.data.map(toTableRow), [due.data])
  const columns = useMemo<DataColumn<TableRow>[]>(
    () => [
      { key: 'visitor', label: 'Ziyaretçi' },
      { key: 'purpose', label: 'Amaç' },
      {
        key: 'retention',
        label: 'Saklama sonu',
        cell: (row) => dayText(row.row.retentionDueOn),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${row.visitor} kaydını aç`}
              onClick={() => onOpen(row.id)}
            >
              Aç
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.visitor} kaydını anonimleştir`}
              onClick={() =>
                setTarget({
                  ids: [row.id],
                  description: `${row.visitor} kaydının adı, telefonu, açıklaması ve öğrenci bağı silinecek. Geri alınamaz.`,
                })
              }
            >
              Anonimleştir
            </Button>
          </span>
        ),
      },
    ],
    [onOpen],
  )
  const pageIds = due.data?.data.map((item) => item.id) ?? []
  return (
    <div className="grid gap-4 pb-6">
      <SettingsCard />
      <div className="flex flex-wrap items-center justify-between gap-2 px-6">
        <p className="text-sm text-muted-foreground">
          {due.data
            ? `Saklama süresi ${String(due.data.meta.retentionDays)} gün; süresi dolan ${String(due.data.meta.total)} kayıt.`
            : 'Süresi dolan kayıtlar yükleniyor.'}
        </p>
        {pageIds.length > 1 ? (
          <Button
            variant="secondary"
            onClick={() =>
              setTarget({
                ids: pageIds,
                description: `Bu sayfadaki ${String(pageIds.length)} kaydın adı, telefonu, açıklaması ve öğrenci bağı silinecek. Geri alınamaz.`,
              })
            }
          >
            Bu sayfadakileri anonimleştir
          </Button>
        ) : null}
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={due.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={['visitor', 'retention']}
        caption="Saklama süresi dolan ziyaret kayıtları"
        empty="Saklama süresi dolan kayıt yok."
        emptyFiltered="Saklama süresi dolan kayıt yok."
        loading={due.isPending}
        fetching={due.isFetching && !due.isPending}
        error={
          due.error ? (
            <QueryError error={due.error} onRetry={() => void due.refetch()} />
          ) : undefined
        }
      />
      {target ? (
        <AnonymizeDialog
          ids={target.ids}
          reason="retention_expired"
          description={target.description}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </div>
  )
}

function SettingsCard() {
  const settings = useVisitorSettings()
  if (settings.error)
    return <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
  const current = settings.data?.data
  if (!current) return <SummaryLoading />
  return <SettingsForm key={current.version} current={current} />
}

function SettingsForm({ current }: { current: VisitorSettingsData }) {
  const save = useSetVisitorSettings()
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: settingsDefaults(current),
  })
  const errors = form.formState.errors
  const busy = save.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const body = settingsBody(current, values)
    if (body === null) {
      notify.success('Ayarda değişiklik yok.')
      return
    }
    const outcome = await save.submit(
      { version: current.version, body },
      {
        setError: (name, error) => {
          const field = settingsFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success('Ayar kaydedildi.')
  })
  return (
    <form
      noValidate
      aria-label="Ziyaretçi kaydı ayarı"
      className="grid gap-3 px-6 pt-4 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="ziyaretci-saklama-gun"
        label="Saklama süresi (gün)"
        error={errors.retentionDays}
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            {...form.register('retentionDays')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="ziyaretci-saklama-aydinlatma"
        label="Geçerli aydınlatma metni sürümü"
        error={errors.privacyNoticeVersion}
      >
        {(control) => (
          <Input {...control} {...form.register('privacyNoticeVersion')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField
          id="ziyaretci-kart-havuzu"
          label="Kart havuzu"
          error={errors.badgeNumbers}
          description="Kart numaralarını virgül ya da boşlukla ayırın (ör. Z1, Z2, Z3). Ziyaretçideki kart çıkarılamaz."
        >
          {(control) => (
            <Textarea {...control} {...form.register('badgeNumbers')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Ayarı kaydet
        </Button>
      </div>
    </form>
  )
}

/** Anonimleştirme onayı (K-480): uyarı, taze oturum (parola penceresi), tek seferlik anahtar. */
function AnonymizeDialog({
  ids,
  reason,
  description,
  onClose,
}: {
  ids: readonly string[]
  reason: 'retention_expired' | 'data_subject_request'
  description: string
  onClose: () => void
}) {
  const anonymize = useAnonymizeVisitors()
  const { run, reauthModal } = useReauthRetry()
  const [error, setError] = useState<string | undefined>(undefined)
  const busy = anonymize.isPending
  const onConfirm = async () => {
    setError(undefined)
    const outcome = await run(() =>
      anonymize.submit(
        { visitorIds: [...ids], reason },
        {
          silent: isReauthenticationRequired,
          setError: (_name, problem) => setError(problem.message),
        },
      ),
    )
    if (outcome.status !== 'done') return
    const result = outcome.result
    if (result.status === 'success') {
      notify.success(`${String(result.data.data.anonymizedCount)} kayıt anonimleştirildi.`)
      onClose()
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ziyaret kaydını anonimleştir"
    >
      <div className="grid gap-3">
        <p className="text-sm">{description}</p>
        <p className="text-sm text-muted-foreground">
          Gün, saatler, amaç, görüşülen kişi, kart ve aydınlatma kaydı kalır. Onay için parolanız
          istenebilir.
        </p>
        <RootError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void onConfirm()}
          >
            Anonimleştir
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
