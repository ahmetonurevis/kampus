import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCloseTransportTrip,
  useCorrectTransportTrip,
  useMarkTransportTrip,
  useStartTransportTrip,
  useTransportTrip,
  useTransportTrips,
  type TransportTripDayRow,
  type TransportTripDetail,
  type TransportTripRosterRow,
} from '@kampus/react-shared/use-finance-transport-trips.ts'
import {
  TRANSPORT_DIRECTIONS,
  type TransportDirection,
} from '@kampus/school-core/lib/finance-transport.ts'
import type { TransportMarkStatus } from '@kampus/school-core/lib/finance-transport-trips.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  canStartTrip,
  correctionBody,
  correctionDefaults,
  correctionFormField,
  correctionFormSchema,
  onBoardAlerts,
  rosterGroups,
  rosterStatusLine,
  tripCountsText,
  tripStatusText,
  type CorrectionFormValues,
} from './finance-transport-trip-forms.ts'
import { directionText, plateText } from './finance-transport-forms.ts'

const DAY_QUERY = { page: 1, pageSize: 100 } as const
const MARK_ACTIONS = [
  { status: 'boarded', label: 'Bindi' },
  { status: 'alighted', label: 'İndi' },
  { status: 'absent', label: 'Gelmedi' },
] as const satisfies readonly { status: TransportMarkStatus; label: string }[]

/**
 * Servis "Seferler" görünümü (DOM-FIN-149; ON-145; IST-144): günün seferleri güzergâh başına
 * (başlamadı, sürüyor, kapandı) ve binen, inen, gelmeyen sayıları; araçta öğrenci kalmış olabilecek
 * seferler üstte uyarıdır (K-504). Sefer sağ panelde durak sırasıyla işaretleme listesi açar: dar
 * ekranda öğrenci başına büyük "Bindi", "İndi", "Gelmedi" düğmeleri. Seferi rehber personel ya da
 * yönetici yürütür (K-502); kapanmış seferi yönetici gerekçeyle düzeltir (K-503). Konum alınmaz.
 */
export function TransportTripsView() {
  const today = dayKey()
  const [date, setDate] = useState(today)
  const [direction, setDirection] = useState<TransportDirection | ''>('')
  const trips = useTransportTrips({
    ...DAY_QUERY,
    date,
    ...(direction === '' ? {} : { direction }),
  })
  const panel = useDetailPanel('sefer')
  const start = useStartTransportTrip()
  const rows = trips.data?.data ?? []
  const alerts = onBoardAlerts(rows)
  const startTrip = async (row: TransportTripDayRow) => {
    const outcome = await start.submit({ routeId: row.routeId })
    if (outcome.status !== 'success') return
    notify.success(`${row.routeName} seferi başladı.`)
    panel.open(outcome.data.data.id)
  }
  return (
    <div className="grid gap-4 px-6 pt-4 pb-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="sefer-gun" label="Gün">
          {(control) => (
            <Input
              {...control}
              type="date"
              className="min-h-11"
              value={date}
              max={today}
              onChange={(event) => setDate(event.target.value === '' ? today : event.target.value)}
            />
          )}
        </FormField>
        <FormField id="sefer-yon" label="Yön">
          {(control) => (
            <NativeSelect
              {...control}
              className="min-h-11 w-full"
              value={direction}
              onChange={(event) => setDirection(event.target.value as TransportDirection | '')}
            >
              <NativeSelectOption value="">Tümü</NativeSelectOption>
              {TRANSPORT_DIRECTIONS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {directionText(value)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      {alerts.length > 0 ? (
        <section
          aria-labelledby="sefer-uyarilari"
          className="grid gap-1 rounded-card border border-danger bg-danger-soft p-3 text-sm text-danger"
        >
          <h3 id="sefer-uyarilari" className="font-semibold">
            Açık uyarılar
          </h3>
          <ul className="grid gap-1">
            {alerts.map((alert) => (
              <li key={alert.routeId}>
                {`${alert.routeName}: ${String(alert.count)} öğrencinin inişi işaretlenmedi, araçta kalmış olabilir.`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {trips.error ? (
        <QueryError error={trips.error} onRetry={() => void trips.refetch()} />
      ) : trips.isPending ? (
        <SummaryLoading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Görebileceğiniz servis güzergâhı yok. Seferi güzergâhın aracına rehber olarak atanan
          personel ya da yönetici yürütür.
        </p>
      ) : (
        <ul aria-label="Günün seferleri" className="grid divide-y rounded-card border">
          {rows.map((row) => (
            <li key={row.routeId} className="grid gap-2 p-3 sm:flex sm:items-center sm:gap-4">
              <div className="grid min-w-0 flex-1 gap-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <span>{row.routeName}</span>
                  <StatusBadge
                    text={tripStatusText(row.trip?.status ?? null)}
                    tone={
                      row.trip === null ? 'gray' : row.trip.status === 'open' ? 'amber' : 'green'
                    }
                  />
                </p>
                <p className="text-sm text-muted-foreground">
                  {`${directionText(row.direction)} · ${plateText(row.vehiclePlate)} · Rehber: ${row.guideName ?? '—'}`}
                </p>
                <p className="text-sm">
                  {row.trip === null
                    ? `${String(row.assigned)} öğrenci atanmış`
                    : tripCountsText(row.trip.counts)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canStartTrip(row, date, today) ? (
                  <Button
                    className="min-h-11"
                    disabled={start.isPending}
                    aria-busy={start.isPending || undefined}
                    aria-label={`${row.routeName} seferini başlat`}
                    onClick={() => void startTrip(row)}
                  >
                    Seferi başlat
                  </Button>
                ) : null}
                {row.trip !== null ? (
                  <Button
                    variant="secondary"
                    className="min-h-11"
                    aria-label={`${row.routeName} seferini aç`}
                    onClick={() => panel.open(row.trip?.id ?? '')}
                  >
                    Aç
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Sefer"
      >
        {panel.selectedId ? <TripPanel tripId={panel.selectedId} /> : null}
      </SidePanel>
    </div>
  )
}

function TripPanel({ tripId }: { tripId: string }) {
  const trip = useTransportTrip(tripId)
  if (trip.error) return <QueryError error={trip.error} onRetry={() => void trip.refetch()} />
  const detail = trip.data?.data
  if (!detail) return <SummaryLoading />
  return <TripDetails detail={detail} />
}

function TripDetails({ detail }: { detail: TransportTripDetail }) {
  const mark = useMarkTransportTrip()
  const closeTrip = useCloseTransportTrip()
  const [correcting, setCorrecting] = useState<TransportTripRosterRow | null>(null)
  const groups = rosterGroups(detail.roster)
  const submitMark = (row: TransportTripRosterRow, status: TransportMarkStatus) =>
    // Saat gönderilmez: sunucu işaret anını yazar; belirsiz hatadan sonra aynı gövde aynı
    // anahtarla yeniden gider (çift işaret yazılmaz).
    void mark.submit({ tripId: detail.id, body: { studentId: row.studentId, status } })
  const close = async () => {
    const outcome = await closeTrip.submit({ tripId: detail.id, version: detail.version })
    if (outcome.status === 'success') notify.success(`${detail.routeName} seferi kapandı.`)
  }
  return (
    <div className="grid gap-5">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">Güzergâh</dt>
        <dd>{detail.routeName}</dd>
        <dt className="text-muted-foreground">Gün ve yön</dt>
        <dd>{`${detail.tripDate} · ${directionText(detail.direction)}`}</dd>
        <dt className="text-muted-foreground">Araç</dt>
        <dd>{plateText(detail.vehiclePlate)}</dd>
        <dt className="text-muted-foreground">Rehber</dt>
        <dd>{detail.guideName ?? '—'}</dd>
        <dt className="text-muted-foreground">Durum</dt>
        <dd>{tripStatusText(detail.status)}</dd>
      </dl>
      <p className="text-sm font-medium" aria-live="polite">
        {tripCountsText(detail.counts)}
      </p>
      {detail.counts.onBoard > 0 ? (
        <p
          role="alert"
          className="rounded-card border border-danger bg-danger-soft p-3 text-sm text-danger"
        >
          {`${String(detail.counts.onBoard)} öğrencinin inişi işaretlenmedi; araçta öğrenci kalmadığını kontrol edin.`}
        </p>
      ) : null}
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu güzergâha atanmış öğrenci yok.</p>
      ) : (
        <ol aria-label="İşaretleme listesi" className="grid gap-4">
          {groups.map((group) => (
            <li key={group.stopId} className="grid gap-2">
              <h3 className="text-sm font-semibold">
                {`${String(group.position)}. ${group.stopName}${group.stopTime === null ? '' : ` · ${group.stopTime}`}`}
              </h3>
              <ul className="grid divide-y rounded-card border">
                {group.rows.map((row) => (
                  <li key={row.studentId} aria-label={row.studentName} className="grid gap-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{row.studentName}</span>
                      <span className="text-sm text-muted-foreground">{rosterStatusLine(row)}</span>
                    </div>
                    {row.correctedAt !== null ? (
                      <p className="text-xs text-muted-foreground">
                        {row.correctionReason === null
                          ? 'Yönetici düzeltti.'
                          : `Yönetici düzeltti: ${row.correctionReason}`}
                      </p>
                    ) : null}
                    {detail.canOperate ? (
                      <div className="grid grid-cols-3 gap-2">
                        {MARK_ACTIONS.map((action) => {
                          const pressed = row.status === action.status
                          return (
                            <Button
                              key={action.status}
                              variant={pressed ? 'default' : 'secondary'}
                              className="min-h-12 text-base"
                              aria-pressed={pressed}
                              aria-label={`${row.studentName}: ${action.label}`}
                              disabled={
                                mark.isPending ||
                                (action.status === 'alighted' &&
                                  row.status !== 'boarded' &&
                                  row.status !== 'alighted')
                              }
                              onClick={() => submitMark(row, action.status)}
                            >
                              {action.label}
                            </Button>
                          )
                        })}
                      </div>
                    ) : null}
                    {detail.canCorrect ? (
                      <Button
                        variant="ghost"
                        className="min-h-11 justify-self-start"
                        aria-label={`${row.studentName} işaretini düzelt`}
                        onClick={() => setCorrecting(row)}
                      >
                        Düzelt
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {detail.canOperate ? (
        <Button
          className="min-h-12"
          disabled={closeTrip.isPending}
          aria-busy={closeTrip.isPending || undefined}
          onClick={() => void close()}
        >
          Seferi kapat
        </Button>
      ) : null}
      <Modal
        open={correcting !== null}
        onOpenChange={(open) => (open ? undefined : setCorrecting(null))}
        title="İşareti düzelt"
      >
        {correcting !== null ? (
          <CorrectionForm detail={detail} row={correcting} onDone={() => setCorrecting(null)} />
        ) : null}
      </Modal>
    </div>
  )
}

function CorrectionForm({
  detail,
  row,
  onDone,
}: {
  detail: TransportTripDetail
  row: TransportTripRosterRow
  onDone: () => void
}) {
  const correct = useCorrectTransportTrip()
  const form = useForm<CorrectionFormValues>({
    resolver: zodResolver(correctionFormSchema),
    defaultValues: correctionDefaults(row),
  })
  const errors = form.formState.errors
  const status = useWatch({ control: form.control, name: 'status' })
  const busy = correct.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const parsed = correctionFormSchema.parse(values)
    const outcome = await correct.submit(
      { tripId: detail.id, body: correctionBody(parsed, detail.tripDate, row.studentId) },
      {
        setError: (name, error) => {
          const field = correctionFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(`${row.studentName} işareti düzeltildi.`)
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="İşareti düzelt"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm">{`${row.studentName} · ${rosterStatusLine(row)}`}</p>
      <RootError message={errors.root?.server?.message} />
      <FormField id="duzeltme-durum" label="Durum" error={errors.status}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('status')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="alighted">İndi</NativeSelectOption>
            <NativeSelectOption value="absent">Gelmedi</NativeSelectOption>
          </NativeSelect>
        )}
      </FormField>
      {status === 'alighted' ? (
        <div className="grid grid-cols-2 gap-3">
          <FormField id="duzeltme-binis" label="Biniş saati" error={errors.boardedTime}>
            {(control) => (
              <Input {...control} {...form.register('boardedTime')} type="time" disabled={busy} />
            )}
          </FormField>
          <FormField id="duzeltme-inis" label="İniş saati" error={errors.alightedTime}>
            {(control) => (
              <Input {...control} {...form.register('alightedTime')} type="time" disabled={busy} />
            )}
          </FormField>
        </div>
      ) : null}
      <FormField id="duzeltme-gerekce" label="Gerekçe" error={errors.reason}>
        {(control) => <Textarea {...control} {...form.register('reason')} disabled={busy} />}
      </FormField>
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        Düzeltmeyi kaydet
      </Button>
    </form>
  )
}
