import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  useMaterialSet,
  useMaterialSets,
  useMaterialStudents,
  useMaterialStudentsExport,
  useSignMaterialDelivery,
  useUpdateMaterialSet,
  type MaterialSetDetail,
  type MaterialStudentQuery,
  type MaterialStudentRow,
} from '@kampus/react-shared/use-finance-material-sets.ts'
import { academicYearName } from '@kampus/school-core/lib/academic-years.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { STOCK_UNIT_LABELS } from '@kampus/school-core/lib/finance-inventory.ts'
import {
  MATERIAL_RECIPIENT_KIND_LABELS,
  materialSetActions,
  materialSetTargetLabel,
} from '@kampus/school-core/lib/finance-material-sets.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import {
  useMaterialDeliveryListPdf,
  useMaterialDeliveryPdf,
} from '@/hooks/use-finance-material-set-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import {
  MATERIAL_DELIVERY_LIST_TITLE,
  MATERIAL_DELIVERY_TITLE,
} from '@/lib/pdf/templates/finance-material-set-delivery.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { CsvButton, PdfDialogButton } from './CorporateParts.tsx'
import {
  CancelMaterialDeliveryModal,
  MaterialDeliveryModal,
  MaterialSetFormModal,
} from './FinanceMaterialSetForms.tsx'

const NO_SORT: readonly string[] = []
const SET_PARAM = 'materyal_seti'
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const STATUS_OPTIONS = [
  { value: 'active', label: 'Etkin' },
  { value: 'inactive', label: 'Pasif' },
]

type Dialog =
  | { kind: 'set'; set?: MaterialSetDetail }
  | { kind: 'deliver'; student: MaterialStudentRow }
  | { kind: 'cancel'; student: MaterialStudentRow; delivery: { id: string; version: number } }
  | null

/**
 * Materyal setleri (`?gorunum=materyal-seti`; DOM-FIN-080; ON-232): setler, seçilen setin teslim
 * edilen ve edilmeyen öğrencileri, teslim, imza ve iptal. Yönetici set tanımlar ve teslimi iptal
 * eder; ön büro teslim eder ve imzayı işler (K-205). Teslim stoktan çıkış yazar.
 */
export function FinanceMaterialSetsSection({
  role,
  institutionType,
  academicYear,
}: {
  role: string
  institutionType: string
  academicYear: number
}) {
  const actions = materialSetActions(role)
  const [params, setParams] = useSearchParams()
  const setId = params.get(SET_PARAM) ?? ''
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = () => setDialog(null)
  const openSet = (id: string) => {
    const next = new URLSearchParams(params)
    if (id === '') next.delete(SET_PARAM)
    else next.set(SET_PARAM, id)
    setParams(next)
  }
  return (
    <section
      aria-labelledby="materyal-setleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="materyal-setleri" className="text-lg font-semibold">
            Materyal setleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Kitap ve materyal setlerinin öğrencilere teslimi; teslim depodan stok çıkışı yazar,
            kâğıt imza işaretlenir.
          </p>
        </div>
        {actions.manage && setId === '' ? (
          <Button onClick={() => setDialog({ kind: 'set' })}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni set
          </Button>
        ) : null}
      </header>
      {setId === '' ? (
        <SetsPanel institutionType={institutionType} onOpen={openSet} />
      ) : (
        <SetDetail
          setId={setId}
          role={role}
          onBack={() => openSet('')}
          onEdit={(set) => setDialog({ kind: 'set', set })}
          onDeliver={(student) => setDialog({ kind: 'deliver', student })}
          onCancel={(student, delivery) => setDialog({ kind: 'cancel', student, delivery })}
        />
      )}
      {dialog?.kind === 'set' ? (
        <MaterialSetFormModal
          {...(dialog.set === undefined ? {} : { set: dialog.set })}
          academicYear={academicYear}
          institutionType={institutionType}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'deliver' ? (
        <MaterialDeliverySetModal setId={setId} student={dialog.student} onClose={close} />
      ) : null}
      {dialog?.kind === 'cancel' ? (
        <CancelMaterialDeliveryModal
          delivery={dialog.delivery}
          studentName={dialog.student.studentName}
          onClose={close}
        />
      ) : null}
    </section>
  )
}

function MaterialDeliverySetModal({
  setId,
  student,
  onClose,
}: {
  setId: string
  student: MaterialStudentRow
  onClose: () => void
}) {
  const set = useMaterialSet(setId)
  return (
    <MaterialDeliveryModal
      setId={setId}
      setName={set.data?.data.name ?? 'Set'}
      student={student}
      onClose={onClose}
    />
  )
}

// --- Setler --------------------------------------------------------------------------------------

type SetRow = {
  id: string
  name: string
  year: string
  target: string
  items: number
  delivered: string
  status: boolean
}

function SetsPanel({
  institutionType,
  onOpen,
}: {
  institutionType: string
  onOpen: (id: string) => void
}) {
  const list = useListState('materyal-setleri', { urlPrefix: 'set_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const sets = useMaterialSets({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === 'active' || status === 'inactive' ? { status } : {}),
  })
  const rows = useMemo(
    () =>
      sets.data?.data.map((set): SetRow => ({
        id: set.id,
        name: set.name,
        year: academicYearName(set.academicYear),
        target: materialSetTargetLabel(set),
        items: set.itemCount,
        delivered: `${String(set.deliveredCount)} / ${String(set.studentCount)}`,
        status: set.isActive,
      })),
    [sets.data],
  )
  const columns = useMemo<DataColumn<SetRow>[]>(
    () => [
      { key: 'name', label: 'Set' },
      { key: 'year', label: 'Eğitim yılı' },
      { key: 'target', label: institutionType === 'language_school' ? 'Kur' : 'Sınıf düzeyi' },
      { key: 'items', label: 'Kalem' },
      { key: 'delivered', label: 'Teslim / öğrenci' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) =>
          row.status ? (
            <StatusBadge text="Etkin" tone="green" />
          ) : (
            <StatusBadge text="Pasif" tone="gray" />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} öğrencilerini aç`}
            onClick={() => onOpen(row.id)}
          >
            Öğrenciler
          </Button>
        ),
      },
    ],
    [institutionType, onOpen],
  )
  return (
    <div className="grid gap-3 pt-3">
      <ServerDataTable
        list={list}
        rows={rows}
        total={sets.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={[{ key: 'status', label: 'Durum', type: 'select', options: STATUS_OPTIONS }]}
        mobileColumns={['name', 'delivered']}
        caption="Materyal setleri"
        empty="Henüz materyal seti yok."
        emptyFiltered="Bu seçimle eşleşen set yok."
        loading={sets.isPending}
        fetching={sets.isFetching && !sets.isPending}
        error={
          sets.error ? (
            <QueryError error={sets.error} onRetry={() => void sets.refetch()} />
          ) : undefined
        }
      />
    </div>
  )
}

// --- Setin öğrencileri ---------------------------------------------------------------------------

type StudentTableRow = {
  id: string
  name: string
  number: string
  className: string
  fee: boolean
  status: string
  recipient: string
  signature: string
  student: MaterialStudentRow
}
const STUDENT_FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: [
      { value: 'delivered', label: 'Teslim edildi' },
      { value: 'pending', label: 'Teslim edilmedi' },
    ],
  },
  {
    key: 'fee',
    label: 'Materyal ücreti',
    type: 'select' as const,
    options: [
      { value: 'charged', label: 'Ücretli' },
      { value: 'none', label: 'Ücret kalemi yok' },
    ],
  },
  {
    key: 'signature',
    label: 'İmza',
    type: 'select' as const,
    options: [
      { value: 'received', label: 'Alındı' },
      { value: 'missing', label: 'Bekliyor' },
    ],
  },
]

/** Ekrandaki süzgecin belgeye yazılan kısa açıklaması (toplu liste "Liste" alanı). */
function filterText(filters: MaterialStudentQuery): string {
  const parts = STUDENT_FILTERS.flatMap((filter) => {
    const value = filters[filter.key as 'status' | 'fee' | 'signature']
    const option = filter.options.find((item) => item.value === value)
    return option ? [`${filter.label}: ${option.label}`] : []
  })
  if (filters.q !== undefined) parts.push(`Arama: “${filters.q}”`)
  return parts.length === 0 ? 'Bütün öğrenciler' : parts.join(' · ')
}

function recipientText(delivery: NonNullable<MaterialStudentRow['delivery']>) {
  return delivery.recipientKind === 'student'
    ? MATERIAL_RECIPIENT_KIND_LABELS.student
    : `${delivery.recipientName ?? ''} (${MATERIAL_RECIPIENT_KIND_LABELS[delivery.recipientKind]})`
}

function SetDetail({
  setId,
  role,
  onBack,
  onEdit,
  onDeliver,
  onCancel,
}: {
  setId: string
  role: string
  onBack: () => void
  onEdit: (set: MaterialSetDetail) => void
  onDeliver: (student: MaterialStudentRow) => void
  onCancel: (student: MaterialStudentRow, delivery: { id: string; version: number }) => void
}) {
  const actions = materialSetActions(role)
  const query = useMaterialSet(setId)
  const update = useUpdateMaterialSet()
  const sign = useSignMaterialDelivery()
  const exporter = useMaterialStudentsExport()
  const list = useListState(`materyal-seti-ogrencileri:${setId}`, { urlPrefix: 'ogrenci_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const fee = text(list.state.filters.fee)
  const signature = text(list.state.filters.signature)
  const filters: MaterialStudentQuery = {
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === 'delivered' || status === 'pending' ? { status } : {}),
    ...(fee === 'charged' || fee === 'none' ? { fee } : {}),
    ...(signature === 'received' || signature === 'missing' ? { signature } : {}),
  }
  // Toplu liste ekrandaki süzgeci izler (K-219); sorgu anahtarı içerikten kurulur.
  const listRef = { setId, query: filters, filter: filterText(filters) }
  const students = useMaterialStudents(setId, {
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...filters,
  })
  const rows = useMemo(
    () =>
      students.data?.data.map((row): StudentTableRow => ({
        id: row.studentId,
        name: row.studentName,
        number: row.studentNumber ?? '—',
        className: row.className ?? '—',
        fee: row.hasMaterialFee,
        status: row.delivery === null ? 'Teslim edilmedi' : dayText(row.delivery.deliveryDate),
        recipient: row.delivery === null ? '—' : recipientText(row.delivery),
        signature:
          row.delivery === null ? '—' : row.delivery.signatureReceived ? 'Alındı' : 'Bekliyor',
        student: row,
      })),
    [students.data],
  )
  const columns = useMemo<DataColumn<StudentTableRow>[]>(
    () => [
      { key: 'name', label: 'Öğrenci' },
      { key: 'number', label: 'No' },
      { key: 'className', label: 'Sınıf / grup' },
      {
        key: 'fee',
        label: 'Materyal ücreti',
        cell: (row) =>
          row.fee ? <StatusBadge text="Ücretli" tone="purple" /> : <span>Ücret kalemi yok</span>,
      },
      {
        key: 'status',
        label: 'Teslim',
        cell: (row) =>
          row.student.delivery === null ? (
            <StatusBadge text="Teslim edilmedi" tone="gray" />
          ) : (
            <span>{`Teslim edildi · ${row.status}`}</span>
          ),
      },
      { key: 'recipient', label: 'Teslim alan' },
      {
        key: 'signature',
        label: 'İmza',
        cell: (row) =>
          row.student.delivery === null ? (
            '—'
          ) : row.student.delivery.signatureReceived ? (
            <StatusBadge text="Alındı" tone="green" />
          ) : (
            <StatusBadge text="Bekliyor" tone="amber" />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => {
          const delivery = row.student.delivery
          const cancelled = row.student.cancelledDelivery
          return (
            <div className="flex flex-wrap gap-2">
              {delivery !== null ? (
                <PdfDialogButton
                  label="Tutanak PDF"
                  title={MATERIAL_DELIVERY_TITLE}
                  id={delivery.id}
                  usePdf={useMaterialDeliveryPdf}
                  accessibleName={`Tutanak PDF · ${row.name}`}
                />
              ) : cancelled !== null ? (
                <PdfDialogButton
                  label="İptal tutanağı"
                  title={MATERIAL_DELIVERY_TITLE}
                  id={cancelled.id}
                  usePdf={useMaterialDeliveryPdf}
                  accessibleName={`İptal tutanağı · ${row.name}`}
                />
              ) : null}
              {row.student.actions.deliver ? (
                <Button
                  size="sm"
                  aria-label={`${row.name} için teslim et`}
                  onClick={() => onDeliver(row.student)}
                >
                  Teslim et
                </Button>
              ) : null}
              {row.student.actions.sign && delivery !== null ? (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`${row.name} teslim imzası alındı`}
                  disabled={sign.isPending}
                  onClick={() =>
                    void sign
                      .submit({ deliveryId: delivery.id, version: delivery.version })
                      .then((outcome) => {
                        if (outcome.status === 'success') notify.success('İmza işlendi.')
                      })
                  }
                >
                  İmza alındı
                </Button>
              ) : null}
              {row.student.actions.cancel && delivery !== null ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`${row.name} teslimini iptal et`}
                  onClick={() => onCancel(row.student, delivery)}
                >
                  İptal
                </Button>
              ) : null}
            </div>
          )
        },
      },
    ],
    [onCancel, onDeliver, sign],
  )
  if (query.error) return <QueryError error={query.error} onRetry={() => void query.refetch()} />
  const set = query.data?.data
  if (!set) return <SummaryLoading />
  const toggle = async () => {
    const outcome = await update.submit({
      setId: set.id,
      version: set.version,
      body: { isActive: !set.isActive },
    })
    if (outcome.status === 'success')
      notify.success(set.isActive ? `${set.name} pasifleştirildi.` : `${set.name} etkinleştirildi.`)
  }
  return (
    <div className="grid gap-4 pt-3">
      <div className="grid gap-3 px-6">
        <div>
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            <Icon name="ArrowLeft" size={16} aria-hidden="true" />
            Setlere dön
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{set.name}</h3>
          {set.isActive ? null : <StatusBadge text="Pasif" tone="gray" />}
        </div>
        <p className="text-sm text-muted-foreground">
          {`${academicYearName(set.academicYear)} · ${materialSetTargetLabel(set)} · ${String(set.deliveredCount)} / ${String(set.studentCount)} öğrenciye teslim edildi`}
        </p>
        <ul className="flex flex-wrap gap-2" aria-label="Set kalemleri">
          {set.items.map((item) => (
            <li key={item.stockItemId} className="rounded-lg border px-3 py-1.5 text-sm">
              {`${item.code} · ${item.name} × ${String(item.quantity)} ${STOCK_UNIT_LABELS[item.unit]}`}
              {item.isActive ? '' : ' (pasif kart)'}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <PdfDialogButton
            label="Teslim listesi PDF"
            title={MATERIAL_DELIVERY_LIST_TITLE}
            id={listRef}
            usePdf={useMaterialDeliveryListPdf}
          />
          <CsvButton
            label="Öğrenci listesi CSV"
            filename={`materyal-seti-${String(set.academicYear)}-${dayKey()}.csv`}
            busy={exporter.isPending}
            download={() => exporter.submit({ setId: set.id, query: filters })}
          />
          {actions.manage ? (
            <>
              <Button type="button" variant="secondary" onClick={() => onEdit(set)}>
                Düzenle
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={update.isPending}
                aria-busy={update.isPending || undefined}
                onClick={() => void toggle()}
              >
                {set.isActive ? 'Pasifleştir' : 'Etkinleştir'}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={students.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={STUDENT_FILTERS}
        mobileColumns={['name', 'status', 'signature']}
        caption="Setin öğrencileri"
        empty="Bu setin hedefinde etkin öğrenci yok."
        emptyFiltered="Bu seçimle eşleşen öğrenci yok."
        loading={students.isPending}
        fetching={students.isFetching && !students.isPending}
        error={
          students.error ? (
            <QueryError error={students.error} onRetry={() => void students.refetch()} />
          ) : undefined
        }
      />
    </div>
  )
}
