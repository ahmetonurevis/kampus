import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import {
  useArchiveTransportRoute,
  useArchiveTransportVehicle,
  useAssignTransportStudent,
  useCreateTransportRoute,
  useCreateTransportVehicle,
  useRemoveTransportAssignment,
  useTransportRoute,
  useTransportRoutes,
  useTransportVehicles,
  useUpdateTransportRoute,
  useUpdateTransportVehicle,
  type TransportRouteDetail,
  type TransportRouteRow,
  type TransportVehicle,
} from '@kampus/react-shared/use-finance-transport.ts'
import { useVisitorHosts } from '@kampus/react-shared/use-finance-visitors.ts'
import { TRANSPORT_DIRECTIONS } from '@kampus/school-core/lib/finance-transport.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { FormField } from '@/components/FormField.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { FinanceStudentSearch } from './FinanceStudentSearch.tsx'
import { TransportTripsView } from './FinanceTransportTripsSection.tsx'
import {
  directionText,
  emptyStop,
  loadText,
  plateText,
  routeCreateBody,
  routeDefaults,
  routeFormField,
  routeFormSchema,
  routeUpdateBody,
  timeRangeText,
  vehicleCreateBody,
  vehicleDefaults,
  vehicleFormField,
  vehicleFormSchema,
  vehicleUpdateBody,
  type RouteFormValues,
  type VehicleFormValues,
} from './finance-transport-forms.ts'

const NO_SORT: readonly string[] = []
const TAB_PARAM = 'servis_sekme'
const TABS = [
  { value: 'guzergahlar', label: 'Güzergâhlar' },
  { value: 'araclar', label: 'Araçlar' },
  { value: 'seferler', label: 'Seferler' },
] as const
type Tab = (typeof TABS)[number]['value']
const STAFF_QUERY = { page: 1, pageSize: 100 } as const
const VEHICLE_OPTIONS_QUERY = { page: 1, pageSize: 100 } as const

/**
 * Servis (DOM-FIN-142; ON-098; IST-099): Finans "Servis" sekmesi, yönetici ve ön büro (K-482).
 * "Güzergâhlar" yön, araç ve doluluğu listeler; satır sağ panelde durakları ve atanan öğrencileri
 * açar, öğrenci bir durağa atanır. "Araçlar" plaka, kapasite, sürücü ve rehber personeli tutar.
 * Sürücü telefonu yalnız maskeli görünür; durakta açık adres yazılmaz (K-481). `transport`
 * modülü kapalıysa sekme yalnız bilgi verir.
 */
export function FinanceTransportSection() {
  const { session } = useAuth()
  const [params, setParams] = useSearchParams()
  const requested = params.get(TAB_PARAM)
  const tab: Tab = TABS.find((item) => item.value === requested)?.value ?? 'guzergahlar'
  const setTab = (next: Tab) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (next === 'guzergahlar') copy.delete(TAB_PARAM)
        else copy.set(TAB_PARAM, next)
        return copy
      },
      { replace: true },
    )
  if (session?.modules.transport !== true)
    return (
      <EmptyState
        icon="Bus"
        title="Servis modülü kapalı"
        description="Servis güzergâhlarını yönetmek için kurum ayarlarından Servis modülünü açın."
      />
    )
  return (
    <section
      aria-labelledby="servis"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-1 px-6 pt-6 pb-2">
        <h2 id="servis" className="text-lg font-semibold">
          Servis
        </h2>
        <p className="text-sm text-muted-foreground">
          Güzergâh, durak ve öğrenci ataması. Durak adı ya da semt yazılır, ev adresi yazılmaz;
          sürücü telefonu maskeli görünür.
        </p>
      </header>
      <div className="px-6">
        <LineTabs label="Servis görünümü" value={tab} options={TABS} onChange={setTab} />
      </div>
      {tab === 'guzergahlar' ? <RouteList /> : null}
      {tab === 'araclar' ? <VehicleList /> : null}
      {tab === 'seferler' ? <TransportTripsView /> : null}
    </section>
  )
}

// --- Güzergâhlar ---------------------------------------------------------------------------------

type RouteTableRow = {
  id: string
  row: TransportRouteRow
  name: string
  direction: string
  vehicle: string
  times: string
  load: string
}

function RouteList() {
  const list = useListState('servis-guzergah', { urlPrefix: 'guzergah_' })
  const search = useDebouncedValue(list.state.query).trim()
  const routes = useTransportRoutes({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const panel = useDetailPanel('guzergah')
  const [creating, setCreating] = useState(false)
  const rows = useMemo(
    () =>
      routes.data?.data.map((row): RouteTableRow => ({
        id: row.id,
        row,
        name: row.name,
        direction: directionText(row.direction),
        vehicle: plateText(row.vehiclePlate),
        times: timeRangeText(row.firstStopTime, row.lastStopTime),
        load: loadText(row.load, row.capacity),
      })),
    [routes.data],
  )
  const columns = useMemo<DataColumn<RouteTableRow>[]>(
    () => [
      { key: 'name', label: 'Güzergâh' },
      { key: 'direction', label: 'Yön' },
      { key: 'vehicle', label: 'Araç' },
      { key: 'times', label: 'Saat' },
      { key: 'load', label: 'Doluluk' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            className="min-h-11"
            variant="ghost"
            aria-label={`${row.name} güzergâhını aç`}
            onClick={() => panel.open(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [panel],
  )
  return (
    <>
      <div className="flex justify-end px-6 pt-4">
        <Button className="min-h-11" onClick={() => setCreating(true)}>
          Güzergâh ekle
        </Button>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={routes.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={['name', ACTIONS_KEY]}
        caption="Servis güzergâhları"
        empty="Henüz güzergâh yok. Önce araç ekleyin, sonra güzergâh açın."
        emptyFiltered="Bu aramayla eşleşen güzergâh yok."
        loading={routes.isPending}
        fetching={routes.isFetching && !routes.isPending}
        error={
          routes.error ? (
            <QueryError error={routes.error} onRetry={() => void routes.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Servis güzergâhı"
      >
        {panel.selectedId ? <RoutePanel routeId={panel.selectedId} onClose={panel.close} /> : null}
      </SidePanel>
      <Modal open={creating} onOpenChange={setCreating} title="Güzergâh ekle" size="wide">
        {creating ? <RouteForm onDone={() => setCreating(false)} /> : null}
      </Modal>
    </>
  )
}

function RoutePanel({ routeId, onClose }: { routeId: string; onClose: () => void }) {
  const route = useTransportRoute(routeId)
  if (route.error) return <QueryError error={route.error} onRetry={() => void route.refetch()} />
  const detail = route.data?.data
  if (!detail) return <SummaryLoading />
  return <RouteDetails detail={detail} onClose={onClose} />
}

function RouteDetails({ detail, onClose }: { detail: TransportRouteDetail; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const archive = useArchiveTransportRoute()
  const remove = useRemoveTransportAssignment()
  const archiveRoute = async () => {
    const outcome = await archive.submit({ routeId: detail.id, version: detail.version })
    if (outcome.status !== 'success') return
    notify.success(`${detail.name} arşivlendi.`)
    onClose()
  }
  return (
    <div className="grid gap-5">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">Güzergâh</dt>
        <dd>{detail.name}</dd>
        <dt className="text-muted-foreground">Yön</dt>
        <dd>{directionText(detail.direction)}</dd>
        <dt className="text-muted-foreground">Araç</dt>
        <dd>{plateText(detail.vehiclePlate)}</dd>
        <dt className="text-muted-foreground">Doluluk</dt>
        <dd>{loadText(detail.load, detail.capacity)}</dd>
        <dt className="text-muted-foreground">Sürücü</dt>
        <dd>{detail.driverName ?? '—'}</dd>
        <dt className="text-muted-foreground">Sürücü telefonu</dt>
        <dd>{detail.driverPhoneMasked ?? '—'}</dd>
        <dt className="text-muted-foreground">Rehber</dt>
        <dd>{detail.guideName ?? '—'}</dd>
      </dl>
      <section aria-labelledby="duraklar" className="grid gap-2">
        <h3 id="duraklar" className="font-semibold">
          Duraklar
        </h3>
        <ol className="grid gap-1 text-sm">
          {detail.stops.map((stop) => (
            <li key={stop.id} className="flex justify-between gap-2 border-b py-1">
              <span>{`${String(stop.position)}. ${stop.name}`}</span>
              <span className="text-muted-foreground">{`${stop.time} · ${String(stop.assigned)} öğrenci`}</span>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="atananlar" className="grid gap-2">
        <h3 id="atananlar" className="font-semibold">
          Atanan öğrenciler
        </h3>
        {detail.assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu güzergâha atanmış öğrenci yok.</p>
        ) : (
          <ul aria-label="Atanan öğrenciler" className="grid gap-1 text-sm">
            {detail.assignments.map((assignment) => (
              <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{`${assignment.studentName} · ${assignment.stopName} ${assignment.stopTime ?? ''}`}</span>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  aria-label={`${assignment.studentName} atamasını kaldır`}
                  disabled={remove.isPending}
                  onClick={() =>
                    void remove
                      .submit({ assignmentId: assignment.id, version: assignment.version })
                      .then((outcome) => {
                        if (outcome.status === 'success')
                          notify.success(`${assignment.studentName} servisten çıkarıldı.`)
                      })
                  }
                >
                  Kaldır
                </Button>
              </li>
            ))}
          </ul>
        )}
        <AssignForm key={detail.version} detail={detail} />
      </section>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="min-h-11" onClick={() => setEditing(true)}>
          Güzergâhı düzenle
        </Button>
        <Button
          variant="ghost"
          className="min-h-11"
          disabled={archive.isPending}
          onClick={() => void archiveRoute()}
        >
          Güzergâhı arşivle
        </Button>
      </div>
      <Modal open={editing} onOpenChange={setEditing} title="Güzergâhı düzenle" size="wide">
        {editing ? <RouteForm route={detail} onDone={() => setEditing(false)} /> : null}
      </Modal>
    </div>
  )
}

function AssignForm({ detail }: { detail: TransportRouteDetail }) {
  const assign = useAssignTransportStudent()
  const [studentId, setStudentId] = useState('')
  const [stopId, setStopId] = useState(detail.stops[0]?.id ?? '')
  const [error, setError] = useState<string | undefined>()
  const busy = assign.isPending
  const full = detail.load >= detail.capacity
  const submit = async () => {
    if (studentId === '') {
      setError('Öğrenciyi seçin.')
      return
    }
    const outcome = await assign.submit(
      { routeId: detail.id, body: { studentId, stopId } },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status !== 'success') return
    notify.success(
      `${outcome.data.data.studentName} ${outcome.data.data.stopName} durağına atandı.`,
    )
    setStudentId('')
    setError(undefined)
  }
  return (
    <form
      noValidate
      aria-label="Öğrenciyi durağa ata"
      className="grid gap-3 rounded-card border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {full ? <p className="text-sm text-danger">Araç kapasitesi dolu.</p> : null}
      <FinanceStudentSearch
        label="Atanacak öğrenci"
        value={studentId}
        onChange={(next) => {
          setStudentId(next)
          setError(undefined)
        }}
        error={error}
        disabled={busy}
      />
      <FormField id="servis-durak" label="Durak">
        {(control) => (
          <NativeSelect
            {...control}
            className="w-full"
            value={stopId}
            disabled={busy}
            onChange={(event) => setStopId(event.target.value)}
          >
            {detail.stops.map((stop) => (
              <NativeSelectOption key={stop.id} value={stop.id}>
                {`${stop.name} · ${stop.time}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        Ata
      </Button>
    </form>
  )
}

function RouteForm({ route, onDone }: { route?: TransportRouteDetail; onDone: () => void }) {
  const vehicles = useTransportVehicles(VEHICLE_OPTIONS_QUERY)
  const create = useCreateTransportRoute()
  const update = useUpdateTransportRoute()
  const form = useForm<RouteFormValues>({
    resolver: zodResolver(routeFormSchema),
    defaultValues: routeDefaults(route),
  })
  const stops = useFieldArray({ control: form.control, name: 'stops' })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const setServerError = (name: string, error: { type: string; message: string }) => {
    const field = routeFormField(name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (route === undefined) {
      const outcome = await create.submit(routeCreateBody(values), { setError: setServerError })
      if (outcome.status !== 'success') return
      notify.success(`${outcome.data.data.name} açıldı.`)
      onDone()
      return
    }
    const body = routeUpdateBody(values, route)
    if (body === null) {
      onDone()
      return
    }
    const outcome = await update.submit(
      { routeId: route.id, version: route.version, body },
      { setError: setServerError },
    )
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.name} güncellendi.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label={route === undefined ? 'Güzergâh ekle' : 'Güzergâhı düzenle'}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="guzergah-ad" label="Güzergâh adı" error={errors.name}>
        {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
      </FormField>
      <FormField id="guzergah-yon" label="Yön" error={errors.direction}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('direction')}
            className="w-full"
            disabled={busy || route !== undefined}
          >
            {TRANSPORT_DIRECTIONS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {directionText(value)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="guzergah-arac" label="Araç" error={errors.vehicleId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('vehicleId')}
              className="w-full"
              disabled={busy || vehicles.isPending}
            >
              <NativeSelectOption value="">Araç seçin</NativeSelectOption>
              {(vehicles.data?.data ?? []).map((vehicle) => (
                <NativeSelectOption key={vehicle.id} value={vehicle.id}>
                  {`${plateText(vehicle.plate)} · ${String(vehicle.capacity)} kişilik`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="text-sm font-medium">Duraklar (sırayla)</legend>
        {stops.fields.map((field, index) => (
          <div key={field.id} className="grid grid-cols-[1fr_8rem_auto] items-start gap-2">
            <FormField
              id={`durak-${String(index)}-ad`}
              label={`${String(index + 1)}. durak adı ya da semt`}
              error={errors.stops?.[index]?.name}
            >
              {(control) => (
                <Input {...control} {...form.register(`stops.${index}.name`)} disabled={busy} />
              )}
            </FormField>
            <FormField
              id={`durak-${String(index)}-saat`}
              label="Saat"
              error={errors.stops?.[index]?.time}
            >
              {(control) => (
                <Input
                  {...control}
                  type="time"
                  {...form.register(`stops.${index}.time`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <Button
              type="button"
              variant="ghost"
              className="mt-7 min-h-11"
              aria-label={`${String(index + 1)}. durağı kaldır`}
              disabled={busy || stops.fields.length === 1}
              onClick={() => stops.remove(index)}
            >
              Kaldır
            </Button>
          </div>
        ))}
        {errors.stops?.message ? (
          <p className="text-sm text-danger">{errors.stops.message}</p>
        ) : null}
        <div>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={busy}
            onClick={() => stops.append(emptyStop())}
          >
            Durak ekle
          </Button>
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          {route === undefined ? 'Güzergâhı kaydet' : 'Değişiklikleri kaydet'}
        </Button>
      </div>
    </form>
  )
}

// --- Araçlar -------------------------------------------------------------------------------------

type VehicleTableRow = {
  id: string
  row: TransportVehicle
  plate: string
  capacity: string
  driver: string
  guide: string
  routes: string
}

function VehicleList() {
  const list = useListState('servis-arac', { urlPrefix: 'arac_' })
  const search = useDebouncedValue(list.state.query).trim()
  const vehicles = useTransportVehicles({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search.replace(/\s+/g, '') } : {}),
  })
  const [editing, setEditing] = useState<TransportVehicle | 'new' | null>(null)
  const archive = useArchiveTransportVehicle()
  const rows = useMemo(
    () =>
      vehicles.data?.data.map((row): VehicleTableRow => ({
        id: row.id,
        row,
        plate: plateText(row.plate),
        capacity: String(row.capacity),
        driver: `${row.driverName} · ${row.driverPhoneMasked}`,
        guide: row.guideName ?? '—',
        routes: String(row.routeCount),
      })),
    [vehicles.data],
  )
  const columns = useMemo<DataColumn<VehicleTableRow>[]>(
    () => [
      { key: 'plate', label: 'Plaka' },
      { key: 'capacity', label: 'Kapasite' },
      { key: 'driver', label: 'Sürücü' },
      { key: 'guide', label: 'Rehber' },
      { key: 'routes', label: 'Güzergâh' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              variant="secondary"
              aria-label={`${row.plate} aracını düzenle`}
              onClick={() => setEditing(row.row)}
            >
              Düzenle
            </Button>
            <Button
              className="min-h-11"
              variant="ghost"
              aria-label={`${row.plate} aracını arşivle`}
              disabled={archive.isPending}
              onClick={() =>
                void archive
                  .submit({ vehicleId: row.id, version: row.row.version })
                  .then((outcome) => {
                    if (outcome.status === 'success') notify.success(`${row.plate} arşivlendi.`)
                  })
              }
            >
              Arşivle
            </Button>
          </span>
        ),
      },
    ],
    [archive],
  )
  return (
    <>
      <div className="flex justify-end px-6 pt-4">
        <Button className="min-h-11" onClick={() => setEditing('new')}>
          Araç ekle
        </Button>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={vehicles.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={['plate', ACTIONS_KEY]}
        caption="Servis araçları"
        empty="Henüz araç yok."
        emptyFiltered="Bu plakayla eşleşen araç yok."
        loading={vehicles.isPending}
        fetching={vehicles.isFetching && !vehicles.isPending}
        error={
          vehicles.error ? (
            <QueryError error={vehicles.error} onRetry={() => void vehicles.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        title={editing === 'new' ? 'Araç ekle' : 'Aracı düzenle'}
        description="Sürücü telefonu kaydedildikten sonra yalnız maskeli görünür."
      >
        {editing === null ? null : (
          <VehicleForm
            vehicle={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  )
}

function VehicleForm({ vehicle, onDone }: { vehicle?: TransportVehicle; onDone: () => void }) {
  const staff = useVisitorHosts(STAFF_QUERY)
  const create = useCreateTransportVehicle()
  const update = useUpdateTransportVehicle()
  const form = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema(vehicle !== undefined)),
    defaultValues: vehicleDefaults(vehicle),
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const setServerError = (name: string, error: { type: string; message: string }) => {
    const field = vehicleFormField(name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (vehicle === undefined) {
      const outcome = await create.submit(vehicleCreateBody(values), { setError: setServerError })
      if (outcome.status !== 'success') return
      notify.success(`${plateText(outcome.data.data.plate)} eklendi.`)
      onDone()
      return
    }
    const body = vehicleUpdateBody(values, vehicle)
    if (body === null) {
      onDone()
      return
    }
    const outcome = await update.submit(
      { vehicleId: vehicle.id, version: vehicle.version, body },
      { setError: setServerError },
    )
    if (outcome.status !== 'success') return
    notify.success(`${plateText(outcome.data.data.plate)} güncellendi.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label={vehicle === undefined ? 'Araç ekle' : 'Aracı düzenle'}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="arac-plaka" label="Plaka" error={errors.plate}>
        {(control) => <Input {...control} {...form.register('plate')} disabled={busy} />}
      </FormField>
      <FormField id="arac-kapasite" label="Kapasite" error={errors.capacity}>
        {(control) => (
          <Input {...control} inputMode="numeric" {...form.register('capacity')} disabled={busy} />
        )}
      </FormField>
      <FormField id="arac-surucu" label="Sürücü adı soyadı" error={errors.driverName}>
        {(control) => <Input {...control} {...form.register('driverName')} disabled={busy} />}
      </FormField>
      <FormField
        id="arac-telefon"
        label="Sürücü telefonu"
        error={errors.driverPhone}
        description={
          vehicle === undefined
            ? undefined
            : `Kayıtlı: ${vehicle.driverPhoneMasked}. Değiştirmek için yeni numarayı yazın.`
        }
      >
        {(control) => (
          <Input {...control} type="tel" {...form.register('driverPhone')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField
          id="arac-rehber"
          label="Rehber personel (isteğe bağlı)"
          error={errors.guideMembershipId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('guideMembershipId')}
              className="w-full"
              disabled={busy || staff.isPending}
            >
              <NativeSelectOption value="">Rehber yok</NativeSelectOption>
              {(staff.data?.data ?? []).map((person) => (
                <NativeSelectOption key={person.membershipId} value={person.membershipId}>
                  {person.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          {vehicle === undefined ? 'Aracı kaydet' : 'Değişiklikleri kaydet'}
        </Button>
      </div>
    </form>
  )
}
