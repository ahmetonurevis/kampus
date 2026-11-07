// Yalnız geliştirme: liste bileşenlerini örnek veriyle göstermek ve ekran kontrolü için.
// Üretim derlemesine girmez (RoleShell `import.meta.env.DEV` ile açar).
import { use, useMemo, useRef, useState } from 'react'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { dateLabel, invoiceStatus, money } from '@kampus/school-core/lib/format.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { CollectionList, type ListPreset } from '@/components/CollectionList.tsx'
import { DataTable, type DataColumn, type DataTableHandle } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import { exportCsv } from '@/lib/download.ts'
import type { SortOption } from '@/lib/list-view.ts'

const seed = createSeed()
const classes = new Map(seed.classes.map((item) => [item.id, item.name]))
const branches = new Map(seed.branches.map((item) => [item.id, item.name]))

type PaymentRow = {
  id: string
  studentId: string
  name: string
  number: string
  class: string
  branch: string
  installment: number
  dueDate: string
  amount: number
  status: string
  actions?: never
}

const payments: PaymentRow[] = seed.invoices.flatMap((invoice) => {
  const student = seed.students.find((item) => item.id === invoice.studentId)
  const classItem = seed.classes.find((item) => item.id === student?.classId)
  if (!student || !classItem) return []
  return [
    {
      id: invoice.id,
      studentId: student.id,
      name: student.name,
      number: student.number ?? '',
      class: classes.get(classItem.id) ?? '',
      branch: branches.get(classItem.branchId) ?? '',
      installment: invoice.installment,
      dueDate: invoice.dueDate,
      amount: invoice.amount,
      status: invoiceStatus(invoice),
    },
  ]
})

type AnnouncementRow = { id: string; title: string; text: string; date: string; category: string }
const announcements: AnnouncementRow[] = seed.announcements.map(
  ({ id, title, text, date, category }) => ({
    id,
    title: title ?? '',
    text: text ?? '',
    date,
    category: category ?? '',
  }),
)
const announcementFilters = [{ key: 'category', label: 'Kategori' }]
const announcementPresets: ListPreset[] = [
  { label: 'Tümü', values: {} },
  ...[...new Set(announcements.map((item) => item.category))].map((category) => ({
    label: category,
    values: { category },
  })),
]
const announcementSort: SortOption[] = [
  { value: 'yeni', label: 'En yeni', key: 'date', direction: -1 },
  { value: 'baslik', label: 'Başlığa göre', key: 'title' },
]

const STATUSES = ['Tümü', 'Ödendi', 'Gecikmiş', 'Yaklaşan'] as const
const EXCLUDED = ['status']
const SEARCH_KEYS = ['number', 'class']
const MOBILE_COLUMNS = ['installment', 'dueDate', 'amount', 'status']
const BRANCH_FILTER = [{ key: 'branch', label: 'Kampüs' }]

export function ListDemoPage() {
  useDocumentTitle('Liste bileşenleri')
  const childId = use(ViewScopeContext)
  const table = useRef<DataTableHandle<PaymentRow>>(null)
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('Tümü')
  const [selected, setSelected] = useState<PaymentRow | null>(null)

  const rows = useMemo(
    () =>
      payments.filter(
        (row) =>
          (!childId || row.studentId === childId) && (status === 'Tümü' || row.status === status),
      ),
    [childId, status],
  )

  const columns = useMemo<DataColumn<PaymentRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Öğrenci',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.name} size="small" />
            <span className="grid">
              <strong className="font-medium">{row.name}</strong>
              <small className="text-xs text-muted-foreground">{row.number}</small>
            </span>
          </span>
        ),
      },
      { key: 'class', label: 'Sınıf' },
      { key: 'branch', label: 'Kampüs' },
      { key: 'installment', label: 'Taksit', cell: (row) => `${row.installment}. taksit` },
      {
        key: 'dueDate',
        label: 'Vade',
        cell: (row) => dateLabel(row.dueDate, { year: 'numeric' }),
      },
      { key: 'amount', label: 'Tutar', cell: (row) => money(row.amount) },
      { key: 'status', label: 'Durum', cell: (row) => <StatusBadge text={row.status} /> },
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) => (
          <Button variant="secondary" size="sm" onClick={() => setSelected(row)}>
            Ayrıntı
          </Button>
        ),
      },
    ],
    [],
  )

  function download() {
    const all = table.current?.filteredRows() ?? rows
    exportCsv(
      'odeme-raporu',
      columns.filter((column) => column.key !== 'actions'),
      all.map((row) => ({
        ...row,
        amount: money(row.amount),
        dueDate: dateLabel(row.dueDate, { year: 'numeric' }),
      })),
    )
  }

  return (
    <>
      <PageHeading
        title="Liste bileşenleri"
        description="Yalnız geliştirmede açılır: DataTable, ListFilters ve CollectionList örnek veriyle."
        actions={
          <Button variant="secondary" onClick={download}>
            <Icon name="Download" size={17} aria-hidden="true" />
            Raporu indir
          </Button>
        }
      />
      <section className="panel mb-6 overflow-hidden rounded-card border bg-surface">
        <header className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-semibold">Ödemeler</h2>
          <p className="text-sm text-muted-foreground">{rows.length} taksit</p>
        </header>
        <DataTable
          ref={table}
          listKey="ornek-odemeler"
          rows={rows}
          columns={columns}
          searchKeys={SEARCH_KEYS}
          mobileColumns={MOBILE_COLUMNS}
          excludeFilters={EXCLUDED}
          filters={BRANCH_FILTER}
          filterKey={status}
          externalActive={status !== 'Tümü'}
          externalLabel={`Ödeme durumu: ${status}`}
          onReset={() => setStatus('Tümü')}
          caption="Ödemeler"
          toolbar={
            <NativeSelect
              aria-label="Ödeme durumu"
              value={status}
              onChange={(event) =>
                setStatus(STATUSES.find((item) => item === event.target.value) ?? STATUSES[0])
              }
              className="min-h-9 text-sm"
            >
              {STATUSES.map((item) => (
                <NativeSelectOption key={item} value={item}>
                  {item === 'Tümü' ? 'Tüm durumlar' : item}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          }
        />
      </section>
      <section aria-labelledby="ornek-duyurular">
        <h2 id="ornek-duyurular" className="mb-4 text-lg font-semibold">
          Duyurular
        </h2>
        <CollectionList
          listKey="ornek-duyurular"
          urlPrefix="duyuru-"
          rows={announcements}
          filters={announcementFilters}
          presets={announcementPresets}
          sortOptions={announcementSort}
          searchLabel="Duyurularda ara"
        >
          {(items) =>
            items.map((item) => (
              <article key={item.id} className="rounded-card border bg-surface p-5">
                <small className="text-xs text-muted-foreground">
                  {dateLabel(item.date)} · {item.category}
                </small>
                <h3 className="mt-1 text-md font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
              </article>
            ))
          }
        </CollectionList>
      </section>
      <SidePanel
        open={selected !== null}
        onOpenChange={(open) => (open ? undefined : setSelected(null))}
        title={selected ? `${selected.name} · ${selected.installment}. taksit` : 'Ödeme'}
      >
        {selected ? (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <dt className="text-muted-foreground">Vade</dt>
            <dd>{dateLabel(selected.dueDate, { year: 'numeric' })}</dd>
            <dt className="text-muted-foreground">Tutar</dt>
            <dd>{money(selected.amount)}</dd>
            <dt className="text-muted-foreground">Durum</dt>
            <dd>
              <StatusBadge text={selected.status} />
            </dd>
          </dl>
        ) : null}
      </SidePanel>
    </>
  )
}
