import { useMemo, useState } from 'react'
import type { GroupListQuery, LanguageGroup } from '@kampus/react-shared/language-groups.ts'
import { useAllCourses } from '@kampus/react-shared/use-courses.ts'
import { useInstitutionMembersAll } from '@kampus/react-shared/use-institution-lists.ts'
import {
  useLanguageGroups,
  useLanguageGroupsFetchAll,
} from '@kampus/react-shared/use-language-groups.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCsvExport } from '@/hooks/use-csv-export.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import type { FilterField } from '@/lib/list-query.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { CancelGroupModal, MergeGroupModal } from './GroupDialogs.tsx'
import { GroupFormModal, NEW_GROUP, type TeacherOption } from './GroupFormModal.tsx'
import { GroupSummaryPanel } from './GroupSummaryPanel.tsx'
import {
  canCreateGroup,
  GROUP_STATUS_FILTER,
  groupActions,
  groupRow,
  groupStatusTone,
  type GroupRow,
  type TeacherNames,
} from './group-rows.ts'
import { useLanguageAccess } from './use-language-access.ts'

const URL_FILTERS = { courseId: 'kur', status: 'durum' }
const MOBILE_COLUMNS = ['course', 'schedule', 'status']
const NO_SORT: readonly string[] = []

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)

/** Liste durumundan sunucu sorgusu (sayfa, kur ve durum süzgeci). */
/** Sunucu süzgeçleri (sayfasız): CSV tüm süzülmüş sonuçları bununla çeker. */
function groupFilters(
  filters: Readonly<Record<string, unknown>>,
): Omit<GroupListQuery, 'page' | 'pageSize'> {
  const courseId = text(filters.courseId)
  const status = text(filters.status) as GroupListQuery['status']
  return {
    ...(courseId ? { courseId } : {}),
    ...(status ? { status } : {}),
  }
}

function groupQuery(state: {
  page: number
  pageSize: number
  filters: Readonly<Record<string, unknown>>
}): GroupListQuery {
  return { page: state.page, pageSize: state.pageSize, ...groupFilters(state.filters) }
}

/**
 * Gruplar (dil okulu; IST-077, DOM-DIL-008, -040…043): kurların tarihli açılışları, sunucu sayfalı
 * ve kur/durum süzgeçli (durum verilmezse iptaller dışlanır). Satır sağ panelde takvim, öğretmen,
 * derslik, doluluk ve kursiyerleri gösterir (`?grup=`). Yönetici ve seviyenin koordinatörü öğretmen
 * grup planlar, düzenler, açar, iptal eder ve birleştirir; ön büro okur. Öğretmen adı yalnız
 * yöneticide okunur (kurum kullanıcı listesi); diğer rollerde nötr metin gösterilir.
 */
export function GroupsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const access = useLanguageAccess()
  const { role, levels, membershipId } = access
  const isAdmin = role === 'yonetici'
  const list = useListState('gruplar', { urlFilters: URL_FILTERS })
  const query = groupQuery(list.state)
  const groups = useLanguageGroups(query)
  const courses = useAllCourses()
  const teachers = useInstitutionMembersAll(
    { role: 'ogretmen', status: 'active' },
    { enabled: isAdmin },
  )
  const names = useMemo<TeacherNames | null>(
    () => (teachers.data ? new Map(teachers.data.map((member) => [member.id, member.name])) : null),
    [teachers.data],
  )
  const rows = useMemo(
    () => groups.data?.rows.map((group) => groupRow(group, names, membershipId)),
    [groups.data, names, membershipId],
  )
  const panel = useDetailPanel('grup')
  const formPanel = useDetailPanel('grup-form')
  const openGroup = panel.open
  const openForm = formPanel.open
  const [cancelTarget, setCancelTarget] = useState<LanguageGroup | null>(null)
  const [mergeTarget, setMergeTarget] = useState<LanguageGroup | null>(null)
  const fetchAll = useLanguageGroupsFetchAll()
  const csv = useCsvExport()

  const filters = useMemo<FilterField[]>(
    () => [
      {
        key: 'courseId',
        label: 'Kur',
        options: (courses.data ?? []).map((course) => ({
          value: course.id,
          label: `${course.name} · ${course.level}`,
        })),
      },
      GROUP_STATUS_FILTER,
    ],
    [courses.data],
  )

  const teacherOptions = useMemo<TeacherOption[]>(() => {
    const unassigned = { value: '', label: 'Atanmamış' }
    if (isAdmin)
      return [
        unassigned,
        ...(teachers.data ?? [])
          .map((member) => ({ value: member.id, label: member.name }))
          .sort((a, b) => a.label.localeCompare(b.label, 'tr')),
      ]
    // TODO(ogretmen-adi-okuma): koordinatör öğretmen başka öğretmenin adını okuyamıyor; ad okuma
    // ucu gelince seçenekler kurumun öğretmenleri olur.
    return membershipId ? [unassigned, { value: membershipId, label: 'Ben' }] : [unassigned]
  }, [isAdmin, teachers.data, membershipId])

  const columns = useMemo<DataColumn<GroupRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Grup',
        cell: (row) => (
          <span className="grid">
            <button
              type="button"
              onClick={() => openGroup(row.id)}
              className="record-link text-left font-medium text-primary hover:underline"
            >
              {row.name}
            </button>
            <small className="text-xs text-muted-foreground">{row.ageBand}</small>
          </span>
        ),
      },
      {
        key: 'course',
        label: 'Kur',
        cell: (row) => `${row.course} · ${row.level}`,
      },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={groupStatusTone(row.statusKey)} />,
      },
      { key: 'schedule', label: 'Haftalık program' },
      { key: 'period', label: 'Tarih aralığı' },
      { key: 'teacher', label: 'Öğretmen' },
      { key: 'room', label: 'Derslik' },
      { key: 'occupancy', label: 'Doluluk' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              aria-label={`${row.name} özeti`}
              onClick={() => openGroup(row.id)}
            >
              <Icon name="Eye" size={15} aria-hidden="true" />
              Özet
            </Button>
            {groupActions(row.group, role, levels).edit ? (
              <Button
                variant="secondary"
                size="sm"
                aria-label={`${row.name} düzenle`}
                onClick={() => openForm(row.id)}
              >
                <Icon name="Pencil" size={15} aria-hidden="true" />
                Düzenle
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [openGroup, openForm, role, levels],
  )

  function download() {
    const filtersOnly = groupFilters(list.state.filters)
    void csv.download(
      page.title,
      columns.filter((column) => column.key !== ACTIONS_KEY),
      async () =>
        (await fetchAll(filtersOnly)).map((group) => {
          const row = groupRow(group, names, membershipId)
          return { ...row, course: `${row.course} · ${row.level}` }
        }),
    )
  }

  const total = groups.data?.total ?? 0
  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={download}
              disabled={csv.busy}
              aria-busy={csv.busy || undefined}
            >
              <Icon name="Download" size={17} aria-hidden="true" />
              Listeyi indir
            </Button>
            {canCreateGroup(role, levels) ? (
              <Button onClick={() => openForm(NEW_GROUP)}>
                <Icon name="Plus" size={17} aria-hidden="true" />
                Grup planla
              </Button>
            ) : null}
          </>
        }
      />
      <section
        aria-labelledby="grup-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="grup-tablosu" className="text-lg font-semibold">
            Kur grupları
          </h2>
          <p className="text-sm text-muted-foreground">{total} grup · başlangıç tarihine göre</p>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={NO_SORT}
          search={false}
          filters={filters}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Kur grupları"
          empty="Henüz grup planlanmadı."
          loading={groups.isPending}
          fetching={groups.isFetching && !groups.isPending}
          error={
            groups.error ? (
              <QueryError error={groups.error} onRetry={() => void groups.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openGroup(row.id)}
        />
      </section>
      <GroupSummaryPanel
        groupId={panel.selectedId}
        names={names}
        onClose={panel.close}
        onEdit={openForm}
        onCancel={setCancelTarget}
        onMerge={setMergeTarget}
      />
      <GroupFormModal
        target={formPanel.selectedId}
        teacherOptions={teacherOptions}
        levels={isAdmin ? null : levels}
        onClose={formPanel.close}
      />
      <CancelGroupModal group={cancelTarget} onClose={() => setCancelTarget(null)} />
      <MergeGroupModal group={mergeTarget} onClose={() => setMergeTarget(null)} />
    </>
  )
}
