import { useMemo } from 'react'
import { Link } from 'react-router'
import {
  useInstitutionMembers,
  useInstitutionMembersFetchAll,
} from '@kampus/react-shared/use-institution-lists.ts'
import type { MemberQuery } from '@kampus/react-shared/institution-lists.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCsvExport } from '@/hooks/use-csv-export.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { SummaryHeader, SummaryMetrics, SummarySection } from '../management/SummaryParts.tsx'
import {
  isMemberRole,
  isMemberStatus,
  memberCsvRow,
  memberRow,
  memberSort,
  ROLE_OPTIONS,
  STATUS_OPTIONS,
  type MemberRow,
} from './settings-rows.ts'

const URL_FILTERS = { role: 'rol', status: 'durum' }
/** Tablo sütun anahtarı → API sıralama alanı. */
const SORT_FIELDS: Readonly<Record<string, string>> = {
  name: 'name',
  roleLabel: 'role',
  createdLabel: 'createdAt',
}
const SORTABLE = Object.keys(SORT_FIELDS)
const MOBILE_COLUMNS = ['roleLabel', 'status']
const ALL = 'all'

const filterValue = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * "Kullanıcı & Yetkiler" (yalnız yönetici): kurumun üyeleri; rol ve durum süzgeci, ad/rol/tarih
 * sıralaması, arama (en az 2 karakter) ve CSV. Satırdan açılan sağ panel yalnız bulunduğu
 * sayfadaki kaydı gösterir (tek kayıt ucu yok). "Pasif" hesap kapatma değil, bağlı kişi
 * kaydının arşivde olmasıdır.
 */
export function UsersSection() {
  const list = useListState('kullanicilar', {
    pageSize: 25,
    urlPrefix: 'kul-',
    urlFilters: URL_FILTERS,
  })
  const search = useDebouncedValue(list.state.query)
  const roleValue = filterValue(list.state.filters.role)
  const statusValue = filterValue(list.state.filters.status)
  const role = isMemberRole(roleValue) ? roleValue : undefined
  const status = isMemberStatus(statusValue) ? statusValue : undefined
  const sort = memberSort(SORT_FIELDS[list.state.sortKey] ?? '', list.state.sortDirection)
  const filters = {
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(sort ? { sort } : {}),
  }
  const query: MemberQuery = {
    page: list.state.page,
    pageSize: list.state.pageSize,
    q: search,
    ...filters,
  }
  const members = useInstitutionMembers(query)
  const rows = useMemo(() => members.data?.rows.map(memberRow), [members.data])
  const panel = useDetailPanel('kullanici')
  const openMember = panel.open
  const fetchAll = useInstitutionMembersFetchAll()
  const csv = useCsvExport()

  const setFilter = (key: 'role' | 'status', value: string) =>
    list.dispatch({ type: 'filter', key, value: value === ALL ? '' : value })

  const columns = useMemo<DataColumn<MemberRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Kullanıcı',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.name} size="small" />
            <span className="grid">
              <button
                type="button"
                onClick={() => openMember(row.id)}
                className="record-link text-left font-medium text-primary hover:underline"
              >
                <strong className="font-medium">{row.name}</strong>
              </button>
              <small className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {row.email}
              </small>
            </span>
          </span>
        ),
      },
      { key: 'roleLabel', label: 'Rol' },
      {
        key: 'links',
        label: 'Bağlı kişi',
        cell: (row) => (
          <span className="block max-w-[260px] truncate" title={row.links}>
            {row.links}
          </span>
        ),
      },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge text={row.status} tone={row.status === 'Etkin' ? 'green' : 'gray'} />
        ),
      },
      { key: 'createdLabel', label: 'Oluşturulma' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.name} ayrıntısı`}
            onClick={() => openMember(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openMember],
  )

  function download() {
    void csv.download(
      'Kullanıcı ve yetkiler',
      columns.filter((column) => column.key !== ACTIONS_KEY),
      async () => {
        const all = await fetchAll({ q: search, ...filters })
        return all.map((member) => memberCsvRow(memberRow(member)))
      },
    )
  }

  const total = members.data?.total ?? 0
  const selected = panel.selectedId ? rows?.find((row) => row.id === panel.selectedId) : undefined
  return (
    <>
      <section
        aria-labelledby="kullanici-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
          <div>
            <h2 id="kullanici-tablosu" className="text-lg font-semibold">
              Kurum kullanıcıları
            </h2>
            <p className="text-sm text-muted-foreground">
              {total} kullanıcı · Rol ve bağlı kişi bilgileri
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={download}
            disabled={csv.busy}
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
          sortable={SORTABLE}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Kurum kullanıcıları"
          loading={members.isPending}
          fetching={members.isFetching && !members.isPending}
          error={
            members.error ? (
              <QueryError error={members.error} onRetry={() => void members.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openMember(row.id)}
          externalActive={Boolean(role ?? status)}
          externalLabel={[
            ROLE_OPTIONS.find((option) => option.value === role)?.label,
            STATUS_OPTIONS.find((option) => option.value === status)?.label,
          ]
            .filter(Boolean)
            .join(' · ')}
          onReset={() => {
            setFilter('role', ALL)
            setFilter('status', ALL)
          }}
          toolbar={
            <>
              <NativeSelect
                aria-label="Rol filtresi"
                value={role ?? ALL}
                onChange={(event) => setFilter('role', event.target.value)}
                className="min-h-9 text-sm"
              >
                <NativeSelectOption value={ALL}>Tüm roller</NativeSelectOption>
                {ROLE_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Durum filtresi"
                value={status ?? ALL}
                onChange={(event) => setFilter('status', event.target.value)}
                className="min-h-9 text-sm"
              >
                <NativeSelectOption value={ALL}>Tüm durumlar</NativeSelectOption>
                {STATUS_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </>
          }
        />
      </section>
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Kullanıcı ayrıntısı"
      >
        {selected ? (
          <MemberDetail row={selected} />
        ) : (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              {members.isPending ? 'Kayıt yükleniyor…' : 'Kayıt bulunamadı.'}
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

function MemberDetail({ row }: { row: MemberRow }) {
  return (
    <>
      <SummaryHeader
        icon={<Avatar name={row.name} />}
        title={row.name}
        subtitle={row.roleLabel}
        status={row.status}
        tone={row.status === 'Etkin' ? 'green' : 'gray'}
      />
      <SummaryMetrics
        items={[
          { label: 'E-posta', value: row.email },
          { label: 'Rol', value: row.roleLabel },
          { label: 'Oluşturulma', value: row.createdLabel },
          { label: 'Bağlı kişi', value: row.links },
        ]}
      />
      <SummarySection title="İşlem geçmişi">
        <p className="mb-3 text-sm text-muted-foreground">
          Bu kullanıcının kurumda yaptığı işlemleri görün.
        </p>
        <Button asChild variant="secondary">
          <Link to={`?sekme=gecmis&gecmis-yapan=${encodeURIComponent(row.userId)}`}>
            İşlem geçmişini gör
          </Link>
        </Button>
      </SummarySection>
    </>
  )
}
