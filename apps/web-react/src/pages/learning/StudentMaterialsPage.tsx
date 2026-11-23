import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs, type LineTabOption } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { TableGate } from './LearningParts.tsx'
import { materialRow, type MaterialRow } from './learning-rows.ts'
import { MaterialPanel } from './MaterialPanel.tsx'
import { SharedMaterialsView } from './SharedMaterialsView.tsx'

const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['subject', 'level']

type Tab = 'ders' | 'paylasilan'
const TABS: readonly LineTabOption<Tab>[] = [
  { value: 'ders', label: 'Ders materyalleri' },
  { value: 'paylasilan', label: 'Paylaşılan dosyalar' },
]
const isTab = (value: string | null): value is Tab => TABS.some((tab) => tab.value === value)

/**
 * Materyaller (öğrenci, Vue `Learning.vue` `/materyaller`): öğrencinin düzeyindeki materyaller;
 * kapsamı sunucu uygular. Ders filtresi, başlık araması, satırdan içerik özeti. Yalnız okuma.
 * "Paylaşılan dosyalar" sekmesi (`?sekme=paylasilan`) öğretmenin içerik havuzundan paylaştığı
 * materyal dosyalarını gösterir (OG-250; DOM-KYN-006).
 */
export function StudentMaterialsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const [params, setParams] = useSearchParams()
  const requested = params.get('sekme')
  const tab: Tab = isTab(requested) ? requested : 'ders'
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <div className="mb-6">
        <LineTabs
          label="Materyal türü"
          value={tab}
          options={TABS}
          onChange={(next) =>
            setParams(next === 'ders' ? {} : { sekme: next }, { preventScrollReset: true })
          }
        />
      </div>
      {tab === 'ders' ? <CourseMaterials /> : <SharedMaterialsView />}
    </>
  )
}

/** Ders materyalleri (seed koleksiyonu `materials`). */
function CourseMaterials() {
  const materials = useCoreAll('materials')
  const rows = useMemo(() => materials.data?.map(materialRow), [materials.data])
  const panel = useDetailPanel('materyal')
  const openMaterial = panel.open

  const columns = useMemo<DataColumn<MaterialRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Materyal',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openMaterial(row.id)}
            aria-label={`${row.title} özetini aç`}
            className="record-link max-w-[340px] truncate text-left font-medium text-primary hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      { key: 'subject', label: 'Ders', cell: (row) => <StatusBadge text={row.subject} /> },
      { key: 'level', label: 'Düzey' },
      { key: 'type', label: 'Tür' },
      { key: 'fileName', label: 'Dosya' },
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-label={`${row.title} özeti`}
              onClick={() => openMaterial(row.id)}
            >
              <Icon name="Eye" size={15} aria-hidden="true" />
              Özet
            </Button>
            <PdfButton
              type="material"
              recordId={row.id}
              label="PDF"
              ariaLabel={`${row.title} PDF olarak görüntüle`}
            />
          </span>
        ),
      },
    ],
    [openMaterial],
  )

  return (
    <>
      <section
        aria-labelledby="materyal-listesi"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="materyal-listesi" className="text-lg font-semibold">
            Ders materyalleri
          </h2>
          <p className="text-sm text-muted-foreground">{rows?.length ?? 0} materyal</p>
        </header>
        <TableGate
          error={materials.error}
          onRetry={() => void materials.refetch()}
          loading={rows === undefined}
        >
          <DataTable
            listKey="materyaller"
            rows={rows ?? NONE}
            columns={columns}
            mobileColumns={MOBILE_COLUMNS}
            caption="Ders materyalleri"
            searchKeys={['title', 'subject', 'level']}
            onRowClick={(row) => openMaterial(row.id)}
          />
        </TableGate>
      </section>
      <MaterialPanel materialId={panel.selectedId} onClose={panel.close} />
    </>
  )
}
