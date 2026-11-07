import { useMemo, useState } from 'react'
import { useAllCourses } from '@kampus/react-shared/use-courses.ts'
import {
  useArchiveLessonPackage,
  useLessonPackages,
  usePackageSales,
} from '@kampus/react-shared/use-finance-packages.ts'
import {
  PACKAGE_KIND_LABELS,
  PACKAGE_KINDS,
  type PackageKind,
} from '@kampus/school-core/lib/finance-packages.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { PackageFormModal } from './PackageFormModal.tsx'
import { PackageSaleModal } from './PackageSaleModal.tsx'
import { PackageSalePanel } from './PackageSalePanel.tsx'
import { PACKAGE_SALE_STATUS_VIEW, packageRow, type PackageRow } from './package-forms.ts'

const NO_SORT: readonly string[] = []
const SALE_MOBILE = ['studentName', 'packageName', 'hours']
const PACKAGE_MOBILE = ['name', 'kindLabel', 'validityLabel']
const OPTION_PAGE_SIZE = 100
const KIND_OPTIONS = PACKAGE_KINDS.map((kind) => ({
  value: kind,
  label: PACKAGE_KIND_LABELS[kind],
}))
const filterText = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isPackageKind = (value: string | null): value is PackageKind =>
  PACKAGE_KINDS.some((kind) => kind === value)

/**
 * Paket satışı (`?gorunum=paket`; IST-078, DOM-DIL-050, -051): yalnız dil okulunda. Satışı yönetici
 * ve ön büro yapar, veli ve kursiyer satın alamaz (K-07); tanım yöneticidedir. Çevrim içi satış
 * kanalı olmadığından ön bilgilendirme ekranı yoktur (DOM-FIN-042).
 */
export function PackagesSection({
  canManage,
  academicYear,
}: {
  canManage: boolean
  academicYear: number
}) {
  return (
    <div className="grid gap-6">
      <SalesTable canApproveCapException={canManage} academicYear={academicYear} />
      {canManage ? <CatalogTable /> : null}
    </div>
  )
}

type SaleRow = {
  id: string
  studentName: string
  packageName: string
  hours: string
  expiresDate: string | null
  status: keyof typeof PACKAGE_SALE_STATUS_VIEW
}

function SalesTable({
  canApproveCapException,
  academicYear,
}: {
  canApproveCapException: boolean
  academicYear: number
}) {
  const list = useListState('paket-satislari', { urlPrefix: 'satis_' })
  const studentId = filterText(list.state.filters.studentId)
  const packageId = filterText(list.state.filters.packageId)
  const sales = usePackageSales({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(studentId ? { studentId } : {}),
    ...(packageId ? { packageId } : {}),
  })
  const students = useCoreAll('students')
  const packages = useLessonPackages({ page: 1, pageSize: OPTION_PAGE_SIZE })
  const panel = useDetailPanel('paket-satis')
  const openSale = panel.open
  const [selling, setSelling] = useState(false)

  const rows = useMemo(
    () =>
      sales.data?.data.map((sale): SaleRow => ({
        id: sale.id,
        studentName: sale.studentName ?? '—',
        packageName: sale.packageName,
        hours: `${String(sale.remainingHours)} / ${String(sale.purchasedHours)} saat`,
        expiresDate: sale.expiresDate,
        status: sale.status,
      })),
    [sales.data],
  )
  const columns = useMemo<DataColumn<SaleRow>[]>(
    () => [
      { key: 'studentName', label: 'Öğrenci' },
      { key: 'packageName', label: 'Paket' },
      { key: 'hours', label: 'Kalan / satın alınan' },
      {
        key: 'expiresDate',
        label: 'Son kullanma',
        cell: (row) =>
          row.expiresDate ? dateLabel(row.expiresDate, { year: 'numeric' }) : 'Süresiz',
      },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => {
          const view = PACKAGE_SALE_STATUS_VIEW[row.status]
          return <StatusBadge text={view.label} tone={view.tone} />
        },
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.studentName} ${row.packageName} satış ayrıntısını aç`}
            onClick={() => openSale(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openSale],
  )
  const filters = useMemo(
    () => [
      {
        key: 'studentId',
        label: 'Öğrenci',
        type: 'select' as const,
        options: (students.data ?? [])
          .map((item) => ({ value: item.id, label: item.record.name }))
          .sort((a, b) => a.label.localeCompare(b.label, 'tr')),
      },
      {
        key: 'packageId',
        label: 'Paket',
        type: 'select' as const,
        options: (packages.data?.data ?? []).map((item) => ({
          value: item.id,
          label: item.name,
        })),
      },
    ],
    [packages.data, students.data],
  )

  return (
    <section
      aria-labelledby="paket-satislari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="paket-satislari" className="text-lg font-semibold">
            Paket satışları
          </h2>
          <p className="text-sm text-muted-foreground">
            Fiyat yayımdaki tarifeden hesaplanır. Süresi dolan paketin kalan saati silinmez.
          </p>
        </div>
        <Button onClick={() => setSelling(true)}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Paket sat
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={sales.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={SALE_MOBILE}
        caption="Paket satışları"
        search={false}
        empty="Henüz paket satışı yok."
        emptyFiltered="Bu seçimle eşleşen satış yok."
        loading={sales.isPending}
        fetching={sales.isFetching && !sales.isPending}
        error={
          sales.error ? (
            <QueryError error={sales.error} onRetry={() => void sales.refetch()} />
          ) : undefined
        }
      />
      {selling ? (
        <PackageSaleModal
          canApproveCapException={canApproveCapException}
          academicYear={academicYear}
          onClose={() => setSelling(false)}
          onSold={(saleId) => {
            setSelling(false)
            openSale(saleId)
          }}
        />
      ) : null}
      <PackageSalePanel saleId={panel.selectedId} onClose={panel.close} />
    </section>
  )
}

type PackageTarget = { mode: 'new' } | { mode: 'edit'; pkg: PackageRow }

function CatalogTable() {
  const list = useListState('paket-tanimlari', { urlPrefix: 'tanim_' })
  const search = useDebouncedValue(list.state.query).trim()
  const kind = filterText(list.state.filters.kind)
  const packages = useLessonPackages({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isPackageKind(kind) ? { kind } : {}),
  })
  const courses = useAllCourses()
  const [target, setTarget] = useState<PackageTarget | null>(null)
  const [archiving, setArchiving] = useState<PackageRow | null>(null)

  const rows = useMemo(() => {
    const names = new Map(courses.data?.map((course) => [course.id, course.name]))
    return packages.data?.data.map((pkg) => packageRow(pkg, names))
  }, [courses.data, packages.data])
  const columns = useMemo<DataColumn<PackageRow>[]>(
    () => [
      { key: 'name', label: 'Paket' },
      { key: 'kindLabel', label: 'Tür' },
      { key: 'courseName', label: 'Kur' },
      { key: 'hoursLabel', label: 'Ders saati' },
      { key: 'hourlyLabel', label: 'Saat ücreti' },
      { key: 'validityLabel', label: 'Kullanım süresi' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.name} paketini düzenle`}
              onClick={() => setTarget({ mode: 'edit', pkg: row })}
            >
              Düzenle
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label={`${row.name} paketini arşivle`}
              onClick={() => setArchiving(row)}
            >
              Arşivle
            </Button>
          </span>
        ),
      },
    ],
    [],
  )
  const filters = useMemo(
    () => [{ key: 'kind', label: 'Paket türü', type: 'select' as const, options: KIND_OPTIONS }],
    [],
  )

  return (
    <section
      aria-labelledby="paket-tanimlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="paket-tanimlari" className="text-lg font-semibold">
            Paket tanımları
          </h2>
          <p className="text-sm text-muted-foreground">
            Paket tutar taşımaz; düzeltme yalnız sonraki satışları etkiler.
          </p>
        </div>
        <Button onClick={() => setTarget({ mode: 'new' })}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Yeni paket
        </Button>
      </header>
      {courses.error ? (
        <div className="px-6">
          <QueryError error={courses.error} onRetry={() => void courses.refetch()} />
        </div>
      ) : null}
      <ServerDataTable
        list={list}
        rows={rows}
        total={packages.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={PACKAGE_MOBILE}
        caption="Paket tanımları"
        empty="Henüz paket tanımlanmadı."
        emptyFiltered="Bu aramayla eşleşen paket yok."
        loading={packages.isPending}
        fetching={packages.isFetching && !packages.isPending}
        error={
          packages.error ? (
            <QueryError error={packages.error} onRetry={() => void packages.refetch()} />
          ) : undefined
        }
      />
      {target ? (
        <PackageFormModal
          pkg={target.mode === 'edit' ? target.pkg : undefined}
          onClose={() => setTarget(null)}
        />
      ) : null}
      {archiving ? <ArchiveModal pkg={archiving} onClose={() => setArchiving(null)} /> : null}
    </section>
  )
}

function ArchiveModal({ pkg, onClose }: { pkg: PackageRow; onClose: () => void }) {
  const archive = useArchiveLessonPackage()
  async function confirm() {
    const outcome = await archive.submit({ packageId: pkg.id, version: pkg.version })
    if (outcome.status === 'busy') return
    if (outcome.status === 'success') notify.success(`${pkg.name} arşivlendi.`)
    onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Paketi arşivle"
      description={`${pkg.name} yeni satışta seçilemez; geçmiş satışlar ve saatleri kalır.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={archive.isPending}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={archive.isPending}
            aria-busy={archive.isPending || undefined}
            onClick={() => void confirm()}
          >
            Arşivle
          </Button>
        </>
      }
    >
      <p className="text-sm">Bu işlem geri alınmaz.</p>
    </Modal>
  )
}
