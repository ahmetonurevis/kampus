import { useMemo, useRef, useState } from 'react'
import { useAllCoordinatorDuties } from '@kampus/react-shared/use-coordinator-duties.ts'
import { useInstitutionMembersAll } from '@kampus/react-shared/use-institution-lists.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { DataTable, type DataColumn, type DataTableHandle } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { exportCsv } from '@/lib/download.ts'
import type { FilterField } from '@/lib/list-query.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { CoordinatorDutyFormPanel } from './CoordinatorDutyFormPanel.tsx'
import { CoordinatorDutyRemoveDialog } from './CoordinatorDutyRemoveDialog.tsx'
import { NEW_DUTY } from './coordinator-duty-forms.ts'
import {
  canManageDuties,
  DUTY_CSV_COLUMNS,
  dutyCsvRows,
  dutyDate,
  dutyRows,
  dutyTexts,
  scopeOptions,
  sortedDutyRows,
  teacherBranchOf,
  teacherOptions,
  type DutyRow,
} from './coordinator-duty-rows.ts'

const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['scope', 'kind']
// Öğretmen ve kapsam süzgeci açıkça tanımlıdır; otomatik türeyen öğretmen adı ve tarih süzgeci yok.
const EXCLUDED_FILTERS = ['teacher', 'createdAt']
const SEARCH_KEYS = ['teacher', 'scope', 'email']

/**
 * Zümre başkanı / akademik koordinatör görevleri (yönetici, IST-005, DOM-YTK-027; yalnız React):
 * kurumun etkin görevleri öğretmen ve ders (okul) ya da CEFR seviyesi (dil okulu) süzgeciyle,
 * arama ve sayfalama istemcide (görev sayısı öğretmen sayısıyla sınırlıdır; tablo durumu liste
 * bazında korunur, süzgeç değişince sayfa başa döner). Görev türü kurum türünden gelir, bu yüzden
 * ayrı bir tür süzgeci yoktur. Yönetici sağ panelde görev verir (`?gorev-form=yeni`) ve onayla
 * kaldırır; görev öğrenci bazında not yazma yetkisi vermez. Yetki ve kural sunucudadır; yönetici
 * olmayan rolde form çizilmez.
 */
export function CoordinatorDutiesPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const type = session?.institution.type ?? 'school'
  const canManage = canManageDuties(session?.role)
  const texts = dutyTexts(type)

  const members = useInstitutionMembersAll({ role: 'ogretmen' }, { enabled: canManage })
  const duties = useAllCoordinatorDuties({ enabled: canManage })
  // Kadro branşı yalnız formda dersi önceden seçmek içindir (okul); dil okulunda gerekmez.
  const records = useCoreAll('teachers', {}, { enabled: canManage && type === 'school' })

  const table = useRef<DataTableHandle<DutyRow>>(null)
  const formPanel = useDetailPanel('gorev-form')
  const openForm = formPanel.open
  const [removeTarget, setRemoveTarget] = useState<DutyRow | null>(null)

  const error = members.error ?? duties.error ?? null
  const pending = members.isPending || duties.isPending
  const retry = () => {
    if (members.error) void members.refetch()
    if (duties.error) void duties.refetch()
  }

  const rows = useMemo(
    () =>
      pending || error || !members.data || !duties.data
        ? undefined
        : sortedDutyRows(dutyRows(type, duties.data, members.data)),
    [pending, error, type, members.data, duties.data],
  )
  const teachers = useMemo(() => teacherOptions(members.data ?? NONE), [members.data])
  const branchOf = useMemo(() => {
    const byId = new Map((members.data ?? []).map((member) => [member.id, member]))
    const teacherRecords = (records.data ?? []).map((row) => row.record)
    return (membershipId: string) => teacherBranchOf(byId.get(membershipId), teacherRecords)
  }, [members.data, records.data])

  const filters = useMemo<FilterField[]>(() => {
    const seen = new Map<string, string>()
    for (const row of rows ?? NONE) seen.set(row.membershipId, row.teacher)
    return [
      {
        key: 'membershipId',
        label: 'Öğretmen',
        options: [...seen]
          .map(([value, label]) => ({ value, label }))
          .sort((a, b) => a.label.localeCompare(b.label, 'tr')),
      },
      { key: 'scopeId', label: texts.scopeLabel, options: scopeOptions(type) },
    ]
  }, [rows, texts.scopeLabel, type])

  const columns = useMemo<DataColumn<DutyRow>[]>(
    () => [
      {
        key: 'teacher',
        label: 'Öğretmen',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.teacher} size="small" />
            <span className="grid">
              <strong className="font-medium">{row.teacher}</strong>
              {row.email ? (
                <small className="text-xs text-muted-foreground">{row.email}</small>
              ) : null}
            </span>
            {row.passive ? <StatusBadge text="Pasif" tone="gray" /> : null}
          </span>
        ),
      },
      { key: 'kind', label: 'Görev', cell: (row) => <StatusBadge text={row.kind} tone="purple" /> },
      { key: 'scope', label: texts.scopeLabel },
      {
        key: 'createdAt',
        label: 'Verildiği tarih',
        cell: (row) => dutyDate(row.createdAt),
      },
      ...(canManage
        ? [
            {
              key: ACTIONS_KEY,
              label: 'İşlemler',
              cell: (row: DutyRow) => (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`${row.teacher} ${row.scope} görevini kaldır`}
                  onClick={() => setRemoveTarget(row)}
                >
                  <Icon name="Trash2" size={15} aria-hidden="true" />
                  Kaldır
                </Button>
              ),
            },
          ]
        : []),
    ],
    [texts.scopeLabel, canManage],
  )

  // CSV filtrelenmiş ve sıralanmış bütün sonucu içerir.
  function download() {
    const all = table.current?.filteredRows() ?? rows ?? NONE
    exportCsv(page.title, DUTY_CSV_COLUMNS(texts.scopeLabel), dutyCsvRows(all))
  }

  if (!canManage)
    return (
      <>
        <PageHeading title={page.title} description={page.description} />
        <p role="status" className="text-sm text-muted-foreground">
          Görev atamayı yalnız yönetici yapar.
        </p>
      </>
    )

  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <>
            <Button variant="secondary" onClick={download} disabled={rows === undefined}>
              <Icon name="Download" size={17} aria-hidden="true" />
              Listeyi indir
            </Button>
            <Button onClick={() => openForm(NEW_DUTY)} disabled={rows === undefined}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              {texts.addLabel}
            </Button>
          </>
        }
      />
      <section
        aria-labelledby="gorev-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="gorev-tablosu" className="text-lg font-semibold">
            {texts.tableTitle}
          </h2>
          <p className="text-sm text-muted-foreground">
            {rows?.length ?? 0} görev · Görev öğrenci bazında not yazma yetkisi vermez
          </p>
        </header>
        {error ? (
          <div role="alert" className="p-[45px] text-center">
            <QueryError error={error} onRetry={retry} />
          </div>
        ) : rows === undefined ? (
          <p role="status" className="p-[45px] text-center text-base text-muted-foreground">
            Kayıtlar yükleniyor…
          </p>
        ) : (
          <DataTable
            ref={table}
            listKey="koordinator-gorevleri"
            rows={rows}
            columns={columns}
            filters={filters}
            excludeFilters={EXCLUDED_FILTERS}
            searchKeys={SEARCH_KEYS}
            mobileColumns={MOBILE_COLUMNS}
            caption={texts.tableTitle}
            empty={texts.empty}
          />
        )}
      </section>
      {rows !== undefined ? (
        <CoordinatorDutyFormPanel
          open={formPanel.selectedId === NEW_DUTY}
          type={type}
          teachers={teachers}
          branchOf={branchOf}
          onClose={formPanel.close}
        />
      ) : null}
      <CoordinatorDutyRemoveDialog
        target={removeTarget}
        texts={texts}
        onClose={() => setRemoveTarget(null)}
      />
    </>
  )
}
