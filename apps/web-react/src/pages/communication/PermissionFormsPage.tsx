import { useMemo } from 'react'
import {
  PERMISSION_TOPIC_LABELS,
  type PermissionFormStatusFilter,
  type PermissionFormTopic,
} from '@kampus/react-shared/permission-forms.ts'
import { usePermissionFormList } from '@kampus/react-shared/use-permission-forms.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { filterValue } from '../learning/LearningFilters.tsx'
import { NEW_PERMISSION_FORM } from './PermissionFormEditor.tsx'
import { PermissionFormPanel } from './PermissionFormPanel.tsx'
import {
  permissionActions,
  permissionFormRow,
  permissionFormTone,
  PERMISSION_FORM_TOPIC_KEYS,
  type PermissionActor,
  type PermissionFormRow,
} from './permission-forms.ts'

// Panel parametreleri (`izin`, `izin-form`) süzgeç adlarıyla çakışmamalı.
const URL_FILTERS = { status: 'durum', topic: 'konu' }
const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['deadlineLabel', 'status']

const STATUS_OPTIONS = [
  { value: '', label: 'Tüm durumlar' },
  { value: 'open', label: 'Karar alan' },
  { value: 'closed', label: 'Kapalı ya da süresi dolmuş' },
] as const
const isStatus = (value: string): value is Exclude<PermissionFormStatusFilter, 'all'> =>
  value === 'open' || value === 'closed'
const isTopic = (value: string): value is PermissionFormTopic =>
  (PERMISSION_FORM_TOPIC_KEYS as readonly string[]).includes(value)

/**
 * İzin Formları (yönetici ve rehber öğretmen; IST-067, DOM-ILT-030, -036…039): kapsamdaki formlar
 * `/permission-forms` ucundan sunucu sayfalı; başlık araması, durum ve konu süzgeci. Form aç/düzenle ve öğrenci
 * bazlı durum aynı sağ panelde açılır. Sayılar okuyanın gördüğü öğrencilerdendir.
 */
export function PermissionFormsPage({
  page,
  heading = true,
}: {
  page: NavPage
  /** Başlık dış sayfada çiziliyorsa `false`. */
  heading?: boolean
}) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const actor: PermissionActor = useMemo(
    () => ({
      role: session?.role ?? '',
      teacherId: session?.links.find((link) => link.kind === 'teacher')?.recordId ?? null,
    }),
    [session],
  )
  const canCreate = permissionActions(actor).create

  const list = useListState('izin-formlari', { urlFilters: URL_FILTERS })
  const statusValue = filterValue(list.state.filters.status)
  const topicValue = filterValue(list.state.filters.topic)
  const status = isStatus(statusValue) ? statusValue : undefined
  const topic = isTopic(topicValue) ? topicValue : undefined
  // Sunucu başlık araması: her tuşta istek atılmaz; sayfa arama değişince `useListState`'te sıfırlanır.
  const search = useDebouncedValue(list.state.query)
  const forms = usePermissionFormList({
    page: list.state.page,
    pageSize: list.state.pageSize,
    q: search,
    ...(status ? { status } : {}),
    ...(topic ? { topic } : {}),
  })
  const rows = useMemo(() => forms.data?.rows.map(permissionFormRow), [forms.data])

  const detail = useDetailPanel('izin')
  const form = useDetailPanel('izin-form')
  const openForm = detail.open

  const columns: DataColumn<PermissionFormRow>[] = [
    {
      key: 'title',
      label: 'Form',
      cell: (row) => (
        <button
          type="button"
          onClick={() => openForm(row.id)}
          aria-label={`${row.title} ayrıntısını aç`}
          className="record-link max-w-[340px] truncate text-left font-medium text-primary hover:underline"
        >
          {row.title}
        </button>
      ),
    },
    { key: 'topic', label: 'Konu' },
    { key: 'deadlineLabel', label: 'Son gün' },
    {
      key: 'status',
      label: 'Durum',
      cell: (row) => <StatusBadge text={row.status} tone={permissionFormTone(row.status)} />,
    },
    { key: 'summary', label: 'Karar durumu' },
    {
      key: 'actions',
      label: 'İşlemler',
      cell: (row) => (
        <Button
          variant="secondary"
          size="sm"
          aria-label={`${row.title} öğrenci durumu`}
          onClick={() => openForm(row.id)}
        >
          <Icon name="Eye" size={15} aria-hidden="true" />
          Durum
        </Button>
      ),
    },
  ]

  return (
    <>
      {heading ? <PageHeading title={page.title} description={page.description} /> : null}
      <section
        aria-labelledby="izin-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
          <div>
            <h2 id="izin-tablosu" className="text-lg font-semibold">
              İzin formu listesi
            </h2>
            <p className="text-sm text-muted-foreground">
              {forms.data?.total ?? 0} form · Velilerin onayı öğrenci başına istenir
            </p>
          </div>
          {canCreate ? (
            <Button type="button" onClick={() => form.open(NEW_PERMISSION_FORM)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              İzin formu aç
            </Button>
          ) : null}
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={forms.data?.total ?? 0}
          sortable={NO_SORT}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="İzin formu listesi"
          empty="Henüz izin formu yok."
          emptyFiltered="Bu süzgeçlere uyan izin formu yok."
          loading={forms.isPending}
          fetching={forms.isFetching && !forms.isPending}
          error={
            forms.error ? (
              <QueryError error={forms.error} onRetry={() => void forms.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openForm(row.id)}
          externalActive={status !== undefined || topic !== undefined}
          externalLabel={[
            topic ? `Konu: ${PERMISSION_TOPIC_LABELS[topic]}` : '',
            status ? `Durum: ${status === 'open' ? 'Karar alan' : 'Kapalı'}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          onReset={() => {
            for (const key of ['status', 'topic'] as const)
              list.dispatch({ type: 'filter', key, value: '' })
          }}
          toolbar={
            <>
              <NativeSelect
                aria-label="Konu"
                value={topic ?? ''}
                onChange={(event) =>
                  list.dispatch({ type: 'filter', key: 'topic', value: event.target.value })
                }
                className="min-h-9 text-sm"
              >
                <NativeSelectOption value="">Tüm konular</NativeSelectOption>
                {PERMISSION_FORM_TOPIC_KEYS.map((key) => (
                  <NativeSelectOption key={key} value={key}>
                    {PERMISSION_TOPIC_LABELS[key]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Durum"
                value={status ?? ''}
                onChange={(event) =>
                  list.dispatch({ type: 'filter', key: 'status', value: event.target.value })
                }
                className="min-h-9 text-sm"
              >
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
      <PermissionFormPanel detail={detail} form={form} actor={actor} />
    </>
  )
}
