import { useMemo, useState } from 'react'
import {
  useArchiveTicketedEvent,
  useCancelEventTicket,
  useCheckInEventTicket,
  useEventTickets,
  useEventTicketsExport,
  usePayEventTicket,
  useTicketedEvent,
  useTicketedEvents,
  useUpdateTicketedEvent,
  type EventTicketRow,
  type TicketedEventRow,
} from '@kampus/react-shared/use-finance-event-tickets.ts'
import {
  canManageEvents,
  EVENT_SEATING_MODE_LABELS,
  EVENT_TICKET_PAYMENT_METHOD_LABELS,
  EVENT_TICKET_PAYMENT_METHODS,
  EVENT_TICKET_STATE_LABELS,
  EVENT_TICKET_STATES,
  seatLabel,
  type EventTicketPaymentMethod,
  type EventTicketState,
} from '@kampus/school-core/lib/finance-event-tickets.ts'
import { dateLabel, money, timeLabel } from '@kampus/school-core/lib/format.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useEventTicketPdf } from '@/hooks/use-finance-event-ticket-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { saveBlob } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { EVENT_TICKET_TITLE } from '@/lib/pdf/templates/finance-event-ticket.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import { AllocateTicketsModal, EventFormModal } from './FinanceEventTicketForms.tsx'

/** Etkinlik seçimi adres parametresi (`?etkinlik=`). */
export const EVENT_PANEL = 'etkinlik'

const NO_SORT: readonly string[] = []
const BOM = '﻿'
const STATE_TONES = {
  valid: 'green',
  unpaid: 'amber',
  used: 'purple',
  cancelled: 'gray',
} as const satisfies Record<EventTicketState, string>

const momentText = (iso: string) => `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isState = (value: string | null): value is EventTicketState =>
  EVENT_TICKET_STATES.some((state) => state === value)

type EventRow = {
  id: string
  name: string
  startsAt: string
  venue: string
  seating: string
  occupancy: string
  unpaid: string
  collected: string
}

/**
 * Etkinlik biletleri (`?gorunum=etkinlik-bileti`; DOM-FIN-103, ON-159). Yönetici ve ön büro gösteri
 * ve tören etkinliklerini, doluluğu ve tahsil edilen tutarı görür; yönetici etkinlik açar ve düzeltir
 * (K-324). Seçilen etkinlikte koltuk haritası, bilet ayırma, girişte kod okutma ve satış listesi
 * (ödeme, iptal, PDF bilet, CSV) vardır. Ödeme elle (nakit/havale) işaretlenir.
 */
export function FinanceEventTicketsSection({ role }: { role: string }) {
  const canManage = canManageEvents(role)
  const list = useListState('etkinlik-biletleri', { urlPrefix: 'etkinlik_' })
  const search = useDebouncedValue(list.state.query).trim()
  const when = text(list.state.filters.when)
  const events = useTicketedEvents({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(when === 'upcoming' || when === 'past' ? { when } : {}),
  })
  const panel = useDetailPanel(EVENT_PANEL)
  const openEvent = panel.open
  const [creating, setCreating] = useState(false)
  const filters = useMemo(
    () => [
      {
        key: 'when',
        label: 'Zaman',
        type: 'select' as const,
        options: [
          { value: 'upcoming', label: 'Yaklaşan' },
          { value: 'past', label: 'Geçmiş' },
        ],
      },
    ],
    [],
  )
  const rows = useMemo(
    () =>
      events.data?.data.map((item): EventRow => ({
        id: item.id,
        name: item.name,
        startsAt: momentText(item.startsAt),
        venue: item.venue,
        seating: EVENT_SEATING_MODE_LABELS[item.seatingMode],
        occupancy: `${String(item.activeCount)} / ${String(item.totalCapacity)}`,
        unpaid: String(item.unpaidCount),
        collected: money(item.collectedCents),
      })),
    [events.data],
  )
  const columns = useMemo<DataColumn<EventRow>[]>(
    () => [
      { key: 'name', label: 'Etkinlik' },
      { key: 'startsAt', label: 'Gün ve saat' },
      { key: 'venue', label: 'Salon' },
      { key: 'seating', label: 'Oturma' },
      { key: 'occupancy', label: 'Bilet / kontenjan' },
      { key: 'unpaid', label: 'Ödeme bekleyen' },
      { key: 'collected', label: 'Tahsil edilen' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: EventRow) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} biletlerini aç`}
            onClick={() => openEvent(row.id)}
          >
            Biletler
          </Button>
        ),
      },
    ],
    [openEvent],
  )

  return (
    <section
      aria-labelledby="etkinlik-biletleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="etkinlik-biletleri" className="text-lg font-semibold">
            Etkinlik biletleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Gösteri ve törenler için kontenjan, koltuk ve bilet; ücretli bilette ödeme elle
            işaretlenir.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setCreating(true)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Etkinlik ekle
          </Button>
        ) : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={events.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={['name', 'startsAt', 'occupancy']}
        caption="Biletli etkinlikler"
        empty="Henüz biletli etkinlik yok."
        emptyFiltered="Bu seçimle eşleşen etkinlik yok."
        loading={events.isPending}
        fetching={events.isFetching && !events.isPending}
        error={
          events.error ? (
            <QueryError error={events.error} onRetry={() => void events.refetch()} />
          ) : undefined
        }
      />
      {creating ? (
        <EventFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            openEvent(id)
          }}
        />
      ) : null}
      {panel.selectedId ? (
        <EventDetail
          key={panel.selectedId}
          eventId={panel.selectedId}
          canManage={canManage}
          onClose={panel.close}
        />
      ) : null}
    </section>
  )
}

/** Seçilen etkinlik: özet, yönetici işlemleri, giriş, koltuk haritası ve satış listesi. */
function EventDetail({
  eventId,
  canManage,
  onClose,
}: {
  eventId: string
  canManage: boolean
  onClose: () => void
}) {
  const event = useTicketedEvent(eventId)
  const [editing, setEditing] = useState(false)
  const [allocating, setAllocating] = useState<readonly string[] | null>(null)
  const [selected, setSelected] = useState<readonly string[]>([])
  const update = useUpdateTicketedEvent()
  const archive = useArchiveTicketedEvent()
  if (event.isPending) return <SummaryLoading />
  if (event.error) return <QueryError error={event.error} onRetry={() => void event.refetch()} />
  const data = event.data.data
  const toggleSales = async () => {
    const outcome = await update.submit({
      eventId,
      version: data.version,
      body: { salesOpen: !data.salesOpen },
    })
    if (outcome.status === 'success')
      notify.success(data.salesOpen ? 'Bilet satışı kapatıldı.' : 'Bilet satışı açıldı.')
  }
  const remove = async () => {
    const outcome = await archive.submit({ eventId, version: data.version })
    if (outcome.status === 'success') {
      notify.success('Etkinlik silindi.')
      onClose()
    }
  }
  return (
    <div className="grid gap-5 border-t px-6 py-5" aria-labelledby="etkinlik-ayrinti">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="etkinlik-ayrinti" className="text-lg font-semibold">
            {data.name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {momentText(data.startsAt)} · {data.venue}
            {data.schoolEventTitle ? ` · Takvim: ${data.schoolEventTitle}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Düzenle
              </Button>
              <Button
                variant="secondary"
                onClick={() => void toggleSales()}
                disabled={update.isPending}
              >
                {data.salesOpen ? 'Satışı kapat' : 'Satışı aç'}
              </Button>
              <Button variant="ghost" onClick={() => void remove()} disabled={archive.isPending}>
                Etkinliği sil
              </Button>
            </>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Kapat
          </Button>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Bilet', `${String(data.activeCount)} / ${String(data.totalCapacity)}`],
          ['Boş yer', String(data.availableCount)],
          ['Girişte kullanılan', String(data.usedCount)],
          ['Ödeme bekleyen', String(data.unpaidCount)],
          ['Tahsil edilen', money(data.collectedCents)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {data.salesOpen ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          Bilet satışı kapalı; ödeme, iptal ve giriş sürer.
        </p>
      )}
      <CheckInForm eventId={eventId} />
      {data.seatingMode === 'seated' ? (
        <SeatMap
          event={data}
          selected={selected}
          onToggle={(seat) =>
            setSelected((current) =>
              current.includes(seat) ? current.filter((item) => item !== seat) : [...current, seat],
            )
          }
          onAllocate={() => setAllocating(selected)}
          onClear={() => setSelected([])}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">Numarasız kontenjan: {String(data.availableCount)} boş yer.</p>
          <Button
            onClick={() => setAllocating([])}
            disabled={!data.salesOpen || data.availableCount === 0}
          >
            Bilet ayır
          </Button>
        </div>
      )}
      <TicketList event={data} />
      {editing ? (
        <EventFormModal
          event={data}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
      {allocating ? (
        <AllocateTicketsModal
          event={data}
          seats={allocating}
          onClose={() => setAllocating(null)}
          onSaved={() => {
            setAllocating(null)
            setSelected([])
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Koltuk haritası: sıra başına düğme satırı. Boş koltuk seçilir (`aria-pressed`), kapalı ve dolu
 * koltuk devre dışıdır; her düğmenin adı koltuk ve durumudur ("B3 koltuğu, dolu").
 */
function SeatMap({
  event,
  selected,
  onToggle,
  onAllocate,
  onClear,
}: {
  event: TicketedEventRow
  selected: readonly string[]
  onToggle: (seat: string) => void
  onAllocate: () => void
  onClear: () => void
}) {
  const taken = new Set(event.takenSeats)
  const blocked = new Set(event.blockedSeats)
  const rows = Array.from({ length: event.rowCount ?? 0 }, (_, row) =>
    Array.from({ length: event.seatsPerRow ?? 0 }, (_, index) => seatLabel(row, index + 1)),
  )
  return (
    <section aria-labelledby="koltuk-haritasi" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 id="koltuk-haritasi" className="font-semibold">
          Koltuk haritası
        </h4>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onAllocate} disabled={selected.length === 0 || !event.salesOpen}>
            Seçili koltuklara bilet ayır ({String(selected.length)})
          </Button>
          {selected.length > 0 ? (
            <Button variant="ghost" onClick={onClear}>
              Seçimi temizle
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Sahne üstte. Boş koltuğa basarak seçin; dolu ve kapalı koltuklar seçilemez.
      </p>
      <div className="overflow-x-auto">
        <div role="group" aria-label="Salon koltukları" className="grid w-max gap-1">
          {rows.map((seats, row) => (
            <div key={seatLabel(row, 1)} className="flex items-center gap-1">
              <span className="w-6 text-center text-sm text-muted-foreground" aria-hidden="true">
                {seatLabel(row, 1).slice(0, 1)}
              </span>
              {seats.map((seat) => {
                const state = blocked.has(seat) ? 'kapalı' : taken.has(seat) ? 'dolu' : 'boş'
                const isSelected = selected.includes(seat)
                return (
                  <Button
                    key={seat}
                    type="button"
                    size="sm"
                    variant={isSelected ? 'default' : state === 'boş' ? 'outline' : 'secondary'}
                    className="size-9 min-w-9 px-0 text-xs"
                    aria-label={`${seat} koltuğu, ${isSelected ? 'seçili' : state}`}
                    aria-pressed={state === 'boş' ? isSelected : undefined}
                    disabled={state !== 'boş'}
                    onClick={() => onToggle(seat)}
                  >
                    {state === 'kapalı' ? '×' : seat.slice(1)}
                  </Button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Girişte kod okutma: okuyucu klavye gibi yazar, Enter ile gönderilir. */
function CheckInForm({ eventId }: { eventId: string }) {
  const checkIn = useCheckInEventTicket()
  const [code, setCode] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const submit = async () => {
    if (code.trim() === '') return
    const outcome = await checkIn.submit({ eventId, code })
    if (outcome.status === 'success') {
      const ticket = outcome.data.data
      setResult(
        `Giriş işaretlendi: ${ticket.holderName}${ticket.seat ? `, koltuk ${ticket.seat}` : ''}.`,
      )
      setCode('')
    } else setResult(null)
  }
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-label="Girişte bilet okut"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="grid gap-2">
        <label htmlFor="bilet-giris-kodu" className="text-sm font-medium">
          Bilet kodu
        </label>
        <Input
          id="bilet-giris-kodu"
          value={code}
          autoComplete="off"
          placeholder="XXXX-XXXX-XXXX"
          onChange={(event) => setCode(event.target.value)}
          className="w-56"
        />
      </div>
      <Button type="submit" disabled={checkIn.isPending || code.trim() === ''}>
        Girişi işaretle
      </Button>
      {result ? (
        <p role="status" className="text-sm">
          {result}
        </p>
      ) : null}
    </form>
  )
}

type TicketRow = {
  id: string
  seat: string
  type: string
  holder: string
  student: string
  price: string
  state: EventTicketState
  ticket: EventTicketRow
}

/** Satış listesi: süzgeç, arama, ödeme, iptal, PDF ve CSV. */
function TicketList({ event }: { event: TicketedEventRow }) {
  const list = useListState(`etkinlik-satis-${event.id}`, { urlPrefix: 'bilet_' })
  const search = useDebouncedValue(list.state.query).trim()
  const state = text(list.state.filters.state)
  const filter = {
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isState(state) ? { state } : {}),
  }
  const tickets = useEventTickets(event.id, {
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...filter,
  })
  const exporter = useEventTicketsExport()
  const { run, reauthModal } = useReauthRetry()
  const [paying, setPaying] = useState<EventTicketRow | null>(null)
  const [cancelling, setCancelling] = useState<EventTicketRow | null>(null)

  async function download() {
    const outcome = await run(() => exporter.submit({ eventId: event.id, query: filter }))
    if (outcome.status !== 'done' || outcome.result.status !== 'success') return
    const csv = String(outcome.result.data).replace(BOM, '')
    saveBlob(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }), 'etkinlik-biletleri.csv')
    notify.success('Dosya indirildi.')
  }
  const filters = useMemo(
    () => [
      {
        key: 'state',
        label: 'Durum',
        type: 'select' as const,
        options: EVENT_TICKET_STATES.map((value) => ({
          value,
          label: EVENT_TICKET_STATE_LABELS[value],
        })),
      },
    ],
    [],
  )
  const rows = useMemo(
    () =>
      tickets.data?.data.map((ticket): TicketRow => ({
        id: ticket.id,
        seat: ticket.seat ?? 'Numarasız',
        type: ticket.ticketTypeName,
        holder: ticket.holderName,
        student: ticket.studentName ?? '—',
        price: ticket.ticketKind === 'invitation' ? 'Davetiye' : money(ticket.priceCents),
        state: ticket.state,
        ticket,
      })),
    [tickets.data],
  )
  const columns = useMemo<DataColumn<TicketRow>[]>(
    () => [
      { key: 'seat', label: 'Koltuk' },
      { key: 'type', label: 'Bilet türü' },
      { key: 'holder', label: 'Bilet sahibi' },
      { key: 'student', label: 'Öğrenci' },
      { key: 'price', label: 'Ücret' },
      {
        key: 'state',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge text={EVENT_TICKET_STATE_LABELS[row.state]} tone={STATE_TONES[row.state]} />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: TicketRow) => (
          <span className="flex flex-wrap gap-2">
            {row.state === 'unpaid' ? (
              <Button
                size="sm"
                aria-label={`${row.holder} biletinin ödemesini al`}
                onClick={() => setPaying(row.ticket)}
              >
                Ödeme al
              </Button>
            ) : null}
            {row.state !== 'cancelled' ? (
              <PdfDialogButton
                label="PDF"
                accessibleName={`${row.holder} biletinin PDF'i`}
                title={EVENT_TICKET_TITLE}
                id={{ event, tickets: [row.ticket] }}
                usePdf={useEventTicketPdf}
              />
            ) : null}
            {row.state === 'valid' || row.state === 'unpaid' ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${row.holder} biletini iptal et`}
                onClick={() => setCancelling(row.ticket)}
              >
                İptal
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [event],
  )

  return (
    <section aria-labelledby="satis-listesi" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 id="satis-listesi" className="font-semibold">
          Satış listesi
        </h4>
        <Button
          variant="secondary"
          onClick={() => void download()}
          disabled={exporter.isPending}
          aria-busy={exporter.isPending || undefined}
        >
          <Icon name="Download" size={17} aria-hidden="true" />
          CSV indir
        </Button>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={tickets.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={['seat', 'holder', 'state']}
        caption="Etkinlik biletleri"
        empty="Bu etkinliğe henüz bilet ayrılmadı."
        emptyFiltered="Bu seçimle eşleşen bilet yok."
        loading={tickets.isPending}
        fetching={tickets.isFetching && !tickets.isPending}
        error={
          tickets.error ? (
            <QueryError error={tickets.error} onRetry={() => void tickets.refetch()} />
          ) : undefined
        }
      />
      {paying ? <PayModal ticket={paying} onClose={() => setPaying(null)} /> : null}
      {cancelling ? (
        <CancelModal ticket={cancelling} run={run} onClose={() => setCancelling(null)} />
      ) : null}
      {reauthModal}
    </section>
  )
}

/** Ödeme işareti: yöntem nakit ya da havale; tutar bilet fiyatıdır (K-326). */
function PayModal({ ticket, onClose }: { ticket: EventTicketRow; onClose: () => void }) {
  const pay = usePayEventTicket()
  const [method, setMethod] = useState<EventTicketPaymentMethod>('cash')
  const submit = async () => {
    const outcome = await pay.submit({ ticketId: ticket.id, body: { method } })
    if (outcome.status === 'success') {
      notify.success('Ödeme işaretlendi.')
      onClose()
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Bilet ödemesi"
      description={`${ticket.holderName} · ${ticket.ticketTypeName} · ${money(ticket.priceCents)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pay.isPending}>
            Vazgeç
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={pay.isPending}
            aria-busy={pay.isPending || undefined}
          >
            Ödemeyi işaretle
          </Button>
        </>
      }
    >
      <FormField
        id="bilet-odeme-yontemi"
        label="Ödeme yöntemi"
        description="Çevrim içi ödeme yoktur; alınan nakit ya da havale işaretlenir."
      >
        {(control) => (
          <NativeSelect
            {...control}
            value={method}
            onChange={(event) => setMethod(event.target.value as EventTicketPaymentMethod)}
            className="w-full"
          >
            {EVENT_TICKET_PAYMENT_METHODS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {EVENT_TICKET_PAYMENT_METHOD_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
    </Modal>
  )
}

/**
 * İptal onayı (K-326): koltuk boşa çıkar; ödenmiş biletin bedeli elle iade edilmiş sayılır. İptal
 * taze oturum ister; parola penceresi `run` ile açılır.
 */
function CancelModal({
  ticket,
  run,
  onClose,
}: {
  ticket: EventTicketRow
  run: ReturnType<typeof useReauthRetry>['run']
  onClose: () => void
}) {
  const cancel = useCancelEventTicket()
  const [reason, setReason] = useState('')
  const paid = ticket.paymentStatus === 'paid'
  const submit = async () => {
    const outcome = await run(() =>
      cancel.submit({
        ticketId: ticket.id,
        body: { reason: reason.trim() === '' ? null : reason.trim() },
      }),
    )
    if (outcome.status === 'done' && outcome.result.status === 'success') {
      notify.success(paid ? 'Bilet iptal edildi; bedel iade edildi.' : 'Bilet iptal edildi.')
      onClose()
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Bileti iptal et"
      description={
        paid
          ? `${ticket.holderName} biletinin ${money(ticket.priceCents)} bedelini iade ettiğinizi onaylıyorsunuz; koltuk boşa çıkar.`
          : `${ticket.holderName} bileti iptal edilir; koltuk boşa çıkar.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={cancel.isPending}>
            Vazgeç
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={cancel.isPending}
            aria-busy={cancel.isPending || undefined}
          >
            İptal et
          </Button>
        </>
      }
    >
      <FormField id="bilet-iptal-notu" label="Not (isteğe bağlı)">
        {(control) => (
          <Input
            {...control}
            value={reason}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </FormField>
    </Modal>
  )
}
