import { useMemo, useState } from 'react'
import { useCertificateStaff } from '@kampus/react-shared/use-finance-staff-certificates.ts'
import {
  useArchiveOrgPosition,
  useCreateOrgAssignment,
  useCreateOrgPosition,
  useCreateOrgUnit,
  useEndOrgAssignment,
  useOrgChart,
  useUpdateOrgPosition,
  useUpdateOrgUnit,
  type OrgPosition,
  type OrgUnit,
} from '@kampus/react-shared/use-finance-org-chart.ts'
import {
  buildOrgTree,
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
import {
  parentOptions,
  parseHeadcount,
  positionFormField,
  positionUpdateBody,
  reportsToOptions,
  unitUpdateBody,
  type PositionFormValues,
  type SelectOption,
} from './finance-org-chart-view.ts'
import { staffOptionText } from './finance-staff-certificate-forms.ts'

const STAFF_PAGE = { page: 1, pageSize: 100 } as const
const day = (value: string) => dateLabel(value, { year: 'numeric' })

type Node = OrgTreeNode<OrgUnit, OrgPosition>
type Dialog =
  | { kind: 'unit'; unit: OrgUnit | null; parentId: string | null }
  | { kind: 'position'; position: OrgPosition | null; unitId: string }
  | { kind: 'assign'; position: OrgPosition }
  | { kind: 'archive'; position: OrgPosition }
  | null

function dialogTitle(dialog: Exclude<Dialog, null>): string {
  switch (dialog.kind) {
    case 'unit':
      return dialog.unit === null ? 'Yeni birim' : 'Birimi düzelt'
    case 'position':
      return dialog.position === null ? 'Yeni pozisyon' : 'Pozisyonu düzelt'
    case 'assign':
      return 'Personel ata'
    case 'archive':
      return 'Pozisyonu kaldır'
    default:
      return dialog satisfies never
  }
}

/**
 * Organizasyon şeması (DOM-FIN-129; ON-187): Finans "Organizasyon" sekmesi, yalnız yönetici
 * (K-444). Birimler iç içe liste olarak ağaç biçiminde gösterilir (grafik kütüphanesi yok; dar
 * ekranda satırlar alt alta akar). Birimde pozisyonlar, kadro ve bugünkü görevliler; boş
 * pozisyonlar ayrı listede. Birim ve pozisyon düzeltilir ve taşınır; seçim listeleri döngüye yol
 * açan seçenekleri göstermez (sunucu yine denetler).
 */
export function FinanceOrgChartSection() {
  const chart = useOrgChart()
  const updateUnit = useUpdateOrgUnit()
  const endAssignment = useEndOrgAssignment()
  const [dialog, setDialog] = useState<Dialog>(null)
  const data = chart.data?.data
  const units = useMemo(() => data?.units ?? [], [data])
  const positions = useMemo(() => data?.positions ?? [], [data])
  const tree = useMemo(() => buildOrgTree(units, positions), [units, positions])
  const titles = useMemo(
    () => new Map(positions.map((position) => [position.id, position.title])),
    [positions],
  )
  const activeUnits = useMemo(
    () => new Set(units.filter((unit) => unit.isActive).map((unit) => unit.id)),
    [units],
  )
  const vacancies = positions.filter(
    (position) => position.vacant > 0 && activeUnits.has(position.unitId),
  )
  const close = () => setDialog(null)

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
    const outcome = await endAssignment.submit({ assignmentId, version, endDate: dayKey() })
    if (outcome.status === 'success') notify.success(`${name} görevi bugün itibarıyla bitirildi.`)
  }

  const renderPosition = (node: Node, position: OrgPosition) => (
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
        <span className="flex flex-wrap gap-2">
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
          <Button
            size="sm"
            variant="outline"
            aria-label={`${position.title} pozisyonunu düzelt`}
            onClick={() => setDialog({ kind: 'position', position, unitId: position.unitId })}
          >
            Düzelt
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${position.title} pozisyonunu kaldır`}
            onClick={() => setDialog({ kind: 'archive', position })}
          >
            Kaldır
          </Button>
        </span>
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
                onClick={() => void end(holder.assignmentId, holder.version, holder.staffName)}
              >
                Görevi bitir
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )

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
                onClick={() => setDialog({ kind: 'unit', unit: null, parentId: node.unit.id })}
              >
                Alt birim
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label={`${node.unit.name} birimine pozisyon aç`}
                onClick={() =>
                  setDialog({ kind: 'position', position: null, unitId: node.unit.id })
                }
              >
                Pozisyon
              </Button>
            </>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            aria-label={`${node.unit.name} birimini düzelt`}
            onClick={() =>
              setDialog({ kind: 'unit', unit: node.unit, parentId: node.unit.parentId })
            }
          >
            Düzelt
          </Button>
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
          {node.positions.map((position) => renderPosition(node, position))}
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
        <Button onClick={() => setDialog({ kind: 'unit', unit: null, parentId: null })}>
          Yeni birim
        </Button>
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
                  {position.title} · {unitPath(units, position.unitId)} · {position.vacant} boş
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <Modal
        open={dialog !== null}
        onOpenChange={(open) => (open ? undefined : close())}
        title={dialog === null ? 'Organizasyon' : dialogTitle(dialog)}
      >
        {dialog?.kind === 'unit' ? (
          <UnitForm unit={dialog.unit} parentId={dialog.parentId} units={units} onDone={close} />
        ) : null}
        {dialog?.kind === 'position' ? (
          <PositionForm
            position={dialog.position}
            unitId={dialog.unitId}
            units={units}
            positions={positions}
            onDone={close}
          />
        ) : null}
        {dialog?.kind === 'assign' ? (
          <AssignForm position={dialog.position} onDone={close} />
        ) : null}
        {dialog?.kind === 'archive' ? (
          <ArchivePosition position={dialog.position} onDone={close} />
        ) : null}
      </Modal>
    </section>
  )
}

function Options({ options }: { options: readonly SelectOption[] }) {
  return options.map((option) => (
    <NativeSelectOption key={option.value} value={option.value}>
      {option.label}
    </NativeSelectOption>
  ))
}

/** Yeni birim ya da düzeltme; düzeltmede üst birim seçilerek taşınır (K-442). */
function UnitForm({
  unit,
  parentId,
  units,
  onDone,
}: {
  unit: OrgUnit | null
  parentId: string | null
  units: readonly OrgUnit[]
  onDone: () => void
}) {
  const create = useCreateOrgUnit()
  const update = useUpdateOrgUnit()
  const [name, setName] = useState(unit?.name ?? '')
  const [kind, setKind] = useState<OrgUnitKind>(unit?.kind ?? 'management')
  const [parent, setParent] = useState(parentId ?? '')
  const [errors, setErrors] = useState<Partial<Record<'name' | 'parentId' | 'kind', string>>>({})
  const busy = create.isPending || update.isPending
  const setError = (field: string, issue: { message: string }) =>
    setErrors((current) => ({
      ...current,
      [field === 'parentId' || field === 'kind' ? field : 'name']: issue.message,
    }))
  const submit = async () => {
    setErrors({})
    if (unit === null) {
      const outcome = await create.submit({ name, kind, parentId }, { setError })
      if (outcome.status === 'success') {
        notify.success(`${outcome.data.data.name} eklendi.`)
        onDone()
      }
      return
    }
    const body = unitUpdateBody(unit, { name, kind, parentId: parent })
    if (Object.keys(body).length === 0) {
      onDone()
      return
    }
    const outcome = await update.submit(
      { unitId: unit.id, version: unit.version, body },
      { setError },
    )
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.name} güncellendi.`)
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  }
  const message = (text: string | undefined) => (text === undefined ? undefined : { message: text })
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
      {unit === null && parentId !== null ? (
        <p className="text-sm text-muted-foreground">Üst birim: {unitPath(units, parentId)}</p>
      ) : null}
      <FormField id="org-birim-ad" label="Birim adı" error={message(errors.name)}>
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="org-birim-tur" label="Tür" error={message(errors.kind)}>
        {(control) => (
          <NativeSelect
            {...control}
            value={kind}
            onChange={(event) => {
              const next = ORG_UNIT_KINDS.find((value) => value === event.target.value)
              if (next) setKind(next)
            }}
            className="w-full"
            disabled={busy}
          >
            <Options
              options={ORG_UNIT_KINDS.map((value) => ({
                value,
                label: ORG_UNIT_KIND_LABELS[value],
              }))}
            />
          </NativeSelect>
        )}
      </FormField>
      {unit === null ? null : (
        <FormField id="org-birim-ust" label="Üst birim" error={message(errors.parentId)}>
          {(control) => (
            <NativeSelect
              {...control}
              value={parent}
              onChange={(event) => setParent(event.target.value)}
              className="w-full"
              disabled={busy}
            >
              <Options options={parentOptions(units, unit.id)} />
            </NativeSelect>
          )}
        </FormField>
      )}
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        {unit === null ? 'Birimi ekle' : 'Kaydet'}
      </Button>
    </form>
  )
}

/** Yeni pozisyon ya da düzeltme; düzeltmede birim seçilerek taşınır (K-443). */
function PositionForm({
  position,
  unitId,
  units,
  positions,
  onDone,
}: {
  position: OrgPosition | null
  unitId: string
  units: readonly OrgUnit[]
  positions: readonly OrgPosition[]
  onDone: () => void
}) {
  const create = useCreateOrgPosition()
  const update = useUpdateOrgPosition()
  const [values, setValues] = useState<PositionFormValues>({
    unitId,
    title: position?.title ?? '',
    headcount: String(position?.headcount ?? 1),
    reportsTo: position?.reportsToPositionId ?? '',
  })
  const [errors, setErrors] = useState<Partial<Record<keyof PositionFormValues, string>>>({})
  const busy = create.isPending || update.isPending
  const change = (field: keyof PositionFormValues) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }))
  const setError = (field: string, issue: { message: string }) =>
    setErrors((current) => ({ ...current, [positionFormField(field) ?? 'title']: issue.message }))
  const unitOptions = parentOptions(units, null).filter((option) => option.value !== '')
  const submit = async () => {
    setErrors({})
    if (position === null) {
      const outcome = await create.submit(
        {
          unitId,
          title: values.title,
          headcount: parseHeadcount(values.headcount),
          reportsToPositionId: values.reportsTo === '' ? null : values.reportsTo,
        },
        { setError },
      )
      if (outcome.status === 'success') {
        notify.success(`${outcome.data.data.title} pozisyonu açıldı.`)
        onDone()
      }
      return
    }
    const body = positionUpdateBody(position, values)
    if (Object.keys(body).length === 0) {
      onDone()
      return
    }
    const outcome = await update.submit(
      { positionId: position.id, version: position.version, body },
      { setError },
    )
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.title} güncellendi.`)
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  }
  const message = (text: string | undefined) => (text === undefined ? undefined : { message: text })
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
      {position === null ? (
        <p className="text-sm text-muted-foreground">{unitPath(units, unitId)}</p>
      ) : (
        <FormField id="org-pozisyon-birim" label="Birim" error={message(errors.unitId)}>
          {(control) => (
            <NativeSelect
              {...control}
              value={values.unitId}
              onChange={(event) => change('unitId')(event.target.value)}
              className="w-full"
              disabled={busy}
            >
              <Options options={unitOptions} />
            </NativeSelect>
          )}
        </FormField>
      )}
      <FormField id="org-unvan" label="Unvan" error={message(errors.title)}>
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            value={values.title}
            onChange={(event) => change('title')(event.target.value)}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="org-kadro" label="Kadro sayısı" error={message(errors.headcount)}>
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            value={values.headcount}
            onChange={(event) => change('headcount')(event.target.value)}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="org-raporladigi"
        label="Raporladığı pozisyon (isteğe bağlı)"
        error={message(errors.reportsTo)}
      >
        {(control) => (
          <NativeSelect
            {...control}
            value={values.reportsTo}
            onChange={(event) => change('reportsTo')(event.target.value)}
            className="w-full"
            disabled={busy}
          >
            <Options options={reportsToOptions(units, positions, position?.id ?? null)} />
          </NativeSelect>
        )}
      </FormField>
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        {position === null ? 'Pozisyonu aç' : 'Kaydet'}
      </Button>
    </form>
  )
}

/** Pozisyonu kaldırma onayı (arşiv; K-443). */
function ArchivePosition({ position, onDone }: { position: OrgPosition; onDone: () => void }) {
  const archive = useArchiveOrgPosition()
  const submit = async () => {
    const outcome = await archive.submit({ positionId: position.id, version: position.version })
    if (outcome.status === 'success') {
      notify.success(`${position.title} pozisyonu kaldırıldı.`)
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        {position.title} pozisyonu şemadan kaldırılır; geçmiş atamaları kalır. Kendisine raporlayan
        pozisyon ya da süren atama varken kaldırılamaz.
      </p>
      <Button
        variant="destructive"
        disabled={archive.isPending}
        aria-busy={archive.isPending || undefined}
        onClick={() => void submit()}
      >
        Kaldır
      </Button>
    </div>
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
