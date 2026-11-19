import { useMemo, useState } from 'react'
import { useCertificateStaff } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  useCreateOrgAssignment,
  useCreateOrgPosition,
  useCreateOrgUnit,
  useEndOrgAssignment,
  useOrgChart,
  useUpdateOrgUnit,
  type OrgPosition,
  type OrgUnit,
} from '@kampus/react-shared/use-finance-org-chart.ts'
import {
  buildOrgTree,
  flattenOrgTree,
  ORG_UNIT_KIND_LABELS,
  ORG_UNIT_KINDS,
  unitPath,
  type OrgTreeNode,
  type OrgUnitKind,
} from '@kampus/school-core/lib/finance-org-chart.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { staffOptionText } from './finance-staff-certificate-forms.ts'

const STAFF_PAGE = { page: 1, pageSize: 100 } as const
const day = (value: string) => dateLabel(value, { year: 'numeric' })
const indent = (depth: number) => '  '.repeat(Math.max(0, depth - 1))

type Node = OrgTreeNode<OrgUnit, OrgPosition>
type Dialog =
  | { kind: 'unit'; parentId: string | null }
  | { kind: 'position'; unitId: string }
  | { kind: 'assign'; position: OrgPosition }
  | null

/**
 * Organizasyon şeması (DOM-FIN-129; ON-187): Finans "Organizasyon" sekmesi, yalnız yönetici
 * (K-444). Birimler iç içe liste olarak ağaç biçiminde gösterilir (grafik kütüphanesi yok; dar
 * ekranda satırlar alt alta akar). Birimde pozisyonlar, kadro ve bugünkü görevliler; boş
 * pozisyonlar ayrı listede.
 */
export function FinanceOrgChartSection() {
  const chart = useOrgChart()
  const updateUnit = useUpdateOrgUnit()
  const endAssignment = useEndOrgAssignment()
  const [dialog, setDialog] = useState<Dialog>(null)
  const data = chart.data?.data
  const tree = useMemo(() => (data ? buildOrgTree(data.units, data.positions) : []), [data])
  const titles = useMemo(
    () => new Map((data?.positions ?? []).map((position) => [position.id, position.title])),
    [data],
  )
  const vacancies = (data?.positions ?? []).filter((position) => {
    const unit = data?.units.find((item) => item.id === position.unitId)
    return position.vacant > 0 && unit?.isActive === true
  })

  const toggleUnit = async (unit: OrgUnit) => {
    const outcome = await updateUnit.submit({
      unitId: unit.id,
      version: unit.version,
      body: { isActive: !unit.isActive },
    })
    if (outcome.status === 'success')
      notify.success(unit.isActive ? `${unit.name} pasife alındı.` : `${unit.name} etkinleşti.`)
  }
  const end = async (assignmentId: string, version: number, name: string) => {
    const outcome = await endAssignment.submit({
      assignmentId,
      version,
      endDate: dayKey(),
    })
    if (outcome.status === 'success') notify.success(`${name} görevi bugün itibarıyla bitirildi.`)
  }

  const renderNode = (node: Node) => (
    <li key={node.unit.id} className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{node.unit.name}</span>
          <span className="text-sm text-muted-foreground">
            {ORG_UNIT_KIND_LABELS[node.unit.kind]}
          </span>
          {node.unit.isActive ? null : <StatusBadge text="Pasif" tone="gray" />}
        </span>
        <span className="flex flex-wrap gap-2">
          {node.unit.isActive ? (
            <>
              <Button
                size="sm"
                variant="outline"
                aria-label={`${node.unit.name} altına birim ekle`}
                onClick={() => setDialog({ kind: 'unit', parentId: node.unit.id })}
              >
                Alt birim
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label={`${node.unit.name} birimine pozisyon aç`}
                onClick={() => setDialog({ kind: 'position', unitId: node.unit.id })}
              >
                Pozisyon
              </Button>
            </>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-label={
              node.unit.isActive
                ? `${node.unit.name} birimini pasife al`
                : `${node.unit.name} birimini etkinleştir`
            }
            disabled={updateUnit.isPending}
            onClick={() => void toggleUnit(node.unit)}
          >
            {node.unit.isActive ? 'Pasife al' : 'Etkinleştir'}
          </Button>
        </span>
      </div>
      {node.positions.length > 0 ? (
        <ul aria-label={`${node.unit.name} pozisyonları`} className="grid gap-2 pl-4">
          {node.positions.map((position) => (
            <li key={position.id} className="grid gap-1 rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{position.title}</span>{' '}
                  <span className="text-sm text-muted-foreground">
                    · {position.filled} / {position.headcount} kadro
                    {position.reportsToPositionId === null
                      ? ''
                      : ` · Raporladığı: ${titles.get(position.reportsToPositionId) ?? '—'}`}
                  </span>
                </span>
                {node.unit.isActive && position.vacant > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`${position.title} pozisyonuna personel ata`}
                    onClick={() => setDialog({ kind: 'assign', position })}
                  >
                    Ata
                  </Button>
                ) : null}
              </div>
              {position.holders.length > 0 ? (
                <ul aria-label={`${position.title} görevlileri`} className="grid gap-1">
                  {position.holders.map((holder) => (
                    <li
                      key={holder.assignmentId}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span>
                        {holder.staffName} · {day(holder.startDate)}
                        {holder.endDate === null ? '' : ` – ${day(holder.endDate)}`}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${holder.staffName} görevini bitir`}
                        disabled={endAssignment.isPending}
                        onClick={() =>
                          void end(holder.assignmentId, holder.version, holder.staffName)
                        }
                      >
                        Görevi bitir
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {node.children.length > 0 ? (
        <ul aria-label={`${node.unit.name} alt birimleri`} className="grid gap-2 border-l pl-4">
          {node.children.map(renderNode)}
        </ul>
      ) : null}
    </li>
  )

  return (
    <section
      aria-labelledby="organizasyon"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="organizasyon" className="text-lg font-semibold">
            Organizasyon
          </h2>
          <p className="text-sm text-muted-foreground">
            Birimler, pozisyonlar, raporlama hattı ve bugünkü görevliler.
            {data
              ? ` ${String(data.totals.positions)} pozisyon, ${String(data.totals.filled)} / ${String(data.totals.headcount)} kadro dolu.`
              : ''}
          </p>
        </div>
        <Button onClick={() => setDialog({ kind: 'unit', parentId: null })}>Yeni birim</Button>
      </header>
      <div className="grid gap-6 px-6 pb-6">
        {chart.error ? (
          <QueryError error={chart.error} onRetry={() => void chart.refetch()} />
        ) : null}
        {chart.isPending ? (
          <p className="text-sm text-muted-foreground">Şema yükleniyor…</p>
        ) : tree.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz birim yok.</p>
        ) : (
          <ul aria-label="Organizasyon şeması" className="grid gap-3 break-words">
            {tree.map(renderNode)}
          </ul>
        )}
        <section aria-labelledby="bos-pozisyonlar" className="grid gap-2">
          <h3 id="bos-pozisyonlar" className="font-semibold">
            Boş pozisyonlar
          </h3>
          {vacancies.length === 0 ? (
            <p className="text-sm text-muted-foreground">Boş pozisyon yok.</p>
          ) : (
            <ul aria-label="Boş pozisyonlar" className="grid gap-1">
              {vacancies.map((position) => (
                <li key={position.id} className="text-sm">
                  {position.title} · {unitPath(data?.units ?? [], position.unitId)} ·{' '}
                  {position.vacant} boş
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <Modal
        open={dialog !== null}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        title={
          dialog?.kind === 'unit'
            ? 'Yeni birim'
            : dialog?.kind === 'position'
              ? 'Yeni pozisyon'
              : 'Personel ata'
        }
      >
        {dialog?.kind === 'unit' ? (
          <UnitForm parentId={dialog.parentId} onDone={() => setDialog(null)} />
        ) : null}
        {dialog?.kind === 'position' && data ? (
          <PositionForm
            unitId={dialog.unitId}
            positions={data.positions}
            units={data.units}
            onDone={() => setDialog(null)}
          />
        ) : null}
        {dialog?.kind === 'assign' ? (
          <AssignForm position={dialog.position} onDone={() => setDialog(null)} />
        ) : null}
      </Modal>
    </section>
  )
}

function UnitForm({ parentId, onDone }: { parentId: string | null; onDone: () => void }) {
  const create = useCreateOrgUnit()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<OrgUnitKind>('management')
  const [error, setError] = useState<string | undefined>(undefined)
  const submit = async () => {
    setError(undefined)
    const outcome = await create.submit(
      { name, kind, parentId },
      { setError: (_field, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.name} eklendi.`)
      onDone()
    }
  }
  return (
    <form
      noValidate
      aria-label="Birim"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <FormField id="org-birim-ad" label="Birim adı" error={error ? { message: error } : undefined}>
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={create.isPending}
          />
        )}
      </FormField>
      <FormField id="org-birim-tur" label="Tür">
        {(control) => (
          <NativeSelect
            {...control}
            value={kind}
            onChange={(event) => {
              const next = ORG_UNIT_KINDS.find((value) => value === event.target.value)
              if (next) setKind(next)
            }}
            className="w-full"
            disabled={create.isPending}
          >
            {ORG_UNIT_KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {ORG_UNIT_KIND_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <Button type="submit" disabled={create.isPending} aria-busy={create.isPending || undefined}>
        Birimi ekle
      </Button>
    </form>
  )
}

function PositionForm({
  unitId,
  units,
  positions,
  onDone,
}: {
  unitId: string
  units: readonly OrgUnit[]
  positions: readonly OrgPosition[]
  onDone: () => void
}) {
  const create = useCreateOrgPosition()
  const [title, setTitle] = useState('')
  const [headcount, setHeadcount] = useState('1')
  const [reportsTo, setReportsTo] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const options = flattenOrgTree(buildOrgTree(units, positions)).flatMap(({ unit, depth }) =>
    positions
      .filter((position) => position.unitId === unit.id)
      .map((position) => ({
        id: position.id,
        label: `${indent(depth)}${position.title} (${unit.name})`,
      })),
  )
  const submit = async () => {
    setError(undefined)
    const outcome = await create.submit(
      {
        unitId,
        title,
        headcount: Number(headcount),
        reportsToPositionId: reportsTo === '' ? null : reportsTo,
      },
      { setError: (_field, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.title} pozisyonu açıldı.`)
      onDone()
    }
  }
  return (
    <form
      noValidate
      aria-label="Pozisyon"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm text-muted-foreground">{unitPath(units, unitId)}</p>
      <FormField id="org-unvan" label="Unvan" error={error ? { message: error } : undefined}>
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={create.isPending}
          />
        )}
      </FormField>
      <FormField id="org-kadro" label="Kadro sayısı">
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            value={headcount}
            onChange={(event) => setHeadcount(event.target.value)}
            disabled={create.isPending}
          />
        )}
      </FormField>
      <FormField id="org-raporladigi" label="Raporladığı pozisyon (isteğe bağlı)">
        {(control) => (
          <NativeSelect
            {...control}
            value={reportsTo}
            onChange={(event) => setReportsTo(event.target.value)}
            className="w-full"
            disabled={create.isPending}
          >
            <NativeSelectOption value="">En üst (raporlamaz)</NativeSelectOption>
            {options.map((option) => (
              <NativeSelectOption key={option.id} value={option.id}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <Button type="submit" disabled={create.isPending} aria-busy={create.isPending || undefined}>
        Pozisyonu aç
      </Button>
    </form>
  )
}

function AssignForm({ position, onDone }: { position: OrgPosition; onDone: () => void }) {
  const assign = useCreateOrgAssignment()
  const staff = useCertificateStaff(STAFF_PAGE)
  const [membershipId, setMembershipId] = useState('')
  const [startDate, setStartDate] = useState(() => dayKey())
  const [error, setError] = useState<string | undefined>(undefined)
  const options = (staff.data?.data ?? []).filter((row) => row.active)
  const submit = async () => {
    setError(undefined)
    if (membershipId === '') {
      setError('Personel seçin.')
      return
    }
    const outcome = await assign.submit(
      { positionId: position.id, membershipId, startDate, endDate: null },
      { setError: (_field, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.staffName} ${position.title} pozisyonuna atandı.`)
      onDone()
    }
  }
  return (
    <form
      noValidate
      aria-label="Personel ata"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm text-muted-foreground">
        {position.title} · {position.vacant} boş kadro
      </p>
      <FormField id="org-personel" label="Personel" error={error ? { message: error } : undefined}>
        {(control) => (
          <NativeSelect
            {...control}
            value={membershipId}
            onChange={(event) => setMembershipId(event.target.value)}
            className="w-full"
            disabled={assign.isPending}
          >
            <NativeSelectOption value="">
              {staff.isPending ? 'Personel yükleniyor…' : 'Personel seçin'}
            </NativeSelectOption>
            {options.map((row) => (
              <NativeSelectOption key={row.membershipId} value={row.membershipId}>
                {staffOptionText(row)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="org-baslangic" label="Başlangıç günü">
        {(control) => (
          <Input
            {...control}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            disabled={assign.isPending}
          />
        )}
      </FormField>
      {staff.error ? <QueryError error={staff.error} onRetry={() => void staff.refetch()} /> : null}
      <Button type="submit" disabled={assign.isPending} aria-busy={assign.isPending || undefined}>
        Ata
      </Button>
    </form>
  )
}
