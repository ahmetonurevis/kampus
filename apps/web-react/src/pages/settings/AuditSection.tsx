import { useMemo } from 'react'
import {
  useAuditEvents,
  useAuditEventsFetchAll,
} from '@kampus/react-shared/use-institution-lists.ts'
import type { AuditQuery } from '@kampus/react-shared/institution-lists.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCsvExport } from '@/hooks/use-csv-export.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import { entityOptions } from './audit-labels.ts'
import { auditCsvRow, auditRow, isDay, reversedRange, type AuditRow } from './settings-rows.ts'

const URL_FILTERS = { from: 'baslangic', to: 'bitis', actor: 'yapan', type: 'tur' }
const MOBILE_COLUMNS = ['actorName', 'actionLabel']
const NO_SORT: readonly string[] = []
const ALL = 'all'
const ENTITY_OPTIONS = entityOptions()

const filterValue = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * "İşlem Geçmişi" (yalnız yönetici): kurumun denetim kayıtları, en yeniden eskiye (sıralama
 * sabit). Tarih aralığı (Europe/Istanbul günü), varlık türü ve yapan kişi süzgeci; yapan kişi
 * üye panelindeki bağlantıdan gelir. Değer dönmez: yalnız işlem, varlık ve değişen alan adları.
 * Kimlik olayları (giriş/çıkış/parola) sunucuda süzülür.
 */
export function AuditSection() {
  const list = useListState('gecmis', {
    pageSize: 25,
    urlPrefix: 'gecmis-',
    urlFilters: URL_FILTERS,
  })
  const from = filterValue(list.state.filters.from)
  const to = filterValue(list.state.filters.to)
  const actor = filterValue(list.state.filters.actor)
  const type = filterValue(list.state.filters.type)
  const reversed = reversedRange(from, to)
  const query: AuditQuery = {
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(isDay(from) ? { dateFrom: from } : {}),
    ...(isDay(to) ? { dateTo: to } : {}),
    ...(actor ? { actorUserId: actor } : {}),
    ...(type ? { entityType: type } : {}),
  }
  const events = useAuditEvents(query, { enabled: !reversed })
  const rows = useMemo(
    () => (reversed ? [] : events.data?.rows.map(auditRow)),
    [events.data, reversed],
  )
  const panel = useDetailPanel('kayit')
  const openEvent = panel.open
  const fetchAll = useAuditEventsFetchAll()
  const csv = useCsvExport()

  const setFilter = (key: 'from' | 'to' | 'actor' | 'type', value: string) =>
    list.dispatch({ type: 'filter', key, value: value === ALL ? '' : value })
  const actorName = rows?.find((row) => row.actorUserId === actor)?.actorName ?? 'Seçili kullanıcı'

  const columns = useMemo<DataColumn<AuditRow>[]>(
    () => [
      { key: 'createdLabel', label: 'Zaman' },
      {
        key: 'actionLabel',
        label: 'İşlem',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openEvent(row.id)}
            className="record-link text-left font-medium text-primary hover:underline"
          >
            {row.actionLabel}
          </button>
        ),
      },
      { key: 'entityLabel', label: 'Varlık' },
      {
        key: 'actorName',
        label: 'Yapan',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.actorName} size="small" />
            <span className="grid">
              <strong className="font-medium">{row.actorName}</strong>
              {row.actorRoleLabel ? (
                <small className="text-xs text-muted-foreground">{row.actorRoleLabel}</small>
              ) : null}
            </span>
          </span>
        ),
      },
      {
        key: 'fields',
        label: 'Değişen alanlar',
        cell: (row) => (
          <span className="block max-w-[240px] truncate" title={row.fields}>
            {row.fields}
          </span>
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.actionLabel} ayrıntısı`}
            onClick={() => openEvent(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openEvent],
  )

  function download() {
    const filters: Omit<AuditQuery, 'page' | 'pageSize'> = {
      ...(query.dateFrom ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo ? { dateTo: query.dateTo } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
    }
    void csv.download(
      'İşlem geçmişi',
      columns.filter((column) => column.key !== ACTIONS_KEY),
      async () => (await fetchAll(filters)).map((event) => auditCsvRow(auditRow(event))),
    )
  }

  const total = reversed ? 0 : (events.data?.total ?? 0)
  const selected = panel.selectedId ? rows?.find((row) => row.id === panel.selectedId) : undefined
  return (
    <>
      <section
        aria-labelledby="gecmis-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
          <div>
            <h2 id="gecmis-tablosu" className="text-lg font-semibold">
              Kurum işlem geçmişi
            </h2>
            <p className="text-sm text-muted-foreground">
              {total} kayıt · Değerler gösterilmez; yalnız işlem ve değişen alan adları
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={download}
            disabled={csv.busy || reversed}
            aria-busy={csv.busy || undefined}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            Listeyi indir
          </Button>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={NO_SORT}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          search={false}
          caption="Kurum işlem geçmişi"
          empty="Henüz işlem kaydı yok."
          emptyFiltered="Bu süzgeçlere uyan işlem kaydı yok."
          loading={!reversed && events.isPending}
          fetching={events.isFetching && !events.isPending}
          error={
            reversed ? (
              <p className="text-sm text-danger">Başlangıç günü bitiş gününden sonra olamaz.</p>
            ) : events.error ? (
              <QueryError error={events.error} onRetry={() => void events.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openEvent(row.id)}
          externalActive={Boolean(from || to || actor || type)}
          externalLabel="Seçili süzgeçler"
          onReset={() => {
            setFilter('from', ALL)
            setFilter('to', ALL)
            setFilter('actor', ALL)
            setFilter('type', ALL)
          }}
          toolbar={
            <>
              <Input
                type="date"
                aria-label="Başlangıç günü"
                value={from}
                max={to || undefined}
                onChange={(event) => setFilter('from', event.target.value)}
                className="min-h-9 w-auto text-sm"
              />
              <Input
                type="date"
                aria-label="Bitiş günü"
                value={to}
                min={from || undefined}
                onChange={(event) => setFilter('to', event.target.value)}
                className="min-h-9 w-auto text-sm"
              />
              <NativeSelect
                aria-label="Varlık türü filtresi"
                value={type || ALL}
                onChange={(event) => setFilter('type', event.target.value)}
                className="min-h-9 text-sm"
              >
                <NativeSelectOption value={ALL}>Tüm varlıklar</NativeSelectOption>
                {ENTITY_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {actor ? (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Yapan filtresini kaldır: ${actorName}`}
                  onClick={() => setFilter('actor', ALL)}
                >
                  Yapan: {actorName}
                  <Icon name="X" size={15} aria-hidden="true" />
                </Button>
              ) : null}
            </>
          }
        />
      </section>
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="İşlem kaydı"
      >
        {selected ? (
          <EventDetail row={selected} />
        ) : (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              {events.isPending ? 'Kayıt yükleniyor…' : 'Kayıt bulunamadı.'}
            </p>
            <Button variant="secondary" onClick={panel.close}>
              Kapat
            </Button>
          </div>
        )}
      </SidePanel>
    </>
  )
}

function EventDetail({ row }: { row: AuditRow }) {
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="Clock3" />}
        title={row.actionLabel}
        subtitle={row.createdLabel}
        status={row.entityLabel}
        tone="purple"
      />
      <SummaryMetrics
        items={[
          {
            label: 'Yapan',
            value: row.actorRoleLabel ? `${row.actorName} · ${row.actorRoleLabel}` : row.actorName,
          },
          { label: 'Varlık', value: row.entityLabel },
          { label: 'Varlık kimliği', value: row.entityId || '—' },
          { label: 'İşlem adı', value: row.action },
        ]}
      />
      <SummarySection title="Değişen alanlar">
        {row.fieldNames.length ? (
          <ul className="grid gap-2">
            {row.fieldNames.map((name) => (
              <li key={name} className="rounded-xl border px-3.5 py-2.5 text-sm">
                {name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Alan bilgisi yok.</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Eski ve yeni değerler bu kayıtta tutulmaz.
        </p>
      </SummarySection>
      {row.reason ? (
        <SummarySection title="Gerekçe">
          <p className="text-sm [overflow-wrap:anywhere]">{row.reason}</p>
        </SummarySection>
      ) : null}
    </>
  )
}
