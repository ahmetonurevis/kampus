import { zodResolver } from '@hookform/resolvers/zod'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import {
  useAllocateEventTickets,
  useCreateTicketedEvent,
  useUpdateTicketedEvent,
  type TicketedEventRow,
} from '@kampus/react-shared/use-finance-event-tickets.ts'
import {
  EVENT_SEATING_MODE_LABELS,
  EVENT_SEATING_MODES,
  EVENT_TICKET_KIND_LABELS,
  EVENT_TICKET_KINDS,
  EVENT_TICKETS_PER_REQUEST_MAX,
} from '@kampus/school-core/lib/finance-event-tickets.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  eventBody,
  eventDefaults,
  eventFormField,
  eventFormSchema,
  type EventFormValues,
} from './finance-event-ticket-forms.ts'

// Etkinlik bileti formları (DOM-FIN-103; ON-159): etkinlik açma/düzeltme (yönetici) ve bilet ayırma
// (yönetici, ön büro). Sunucu alan hataları forma, tanınmayanlar form üstüne yazılır.

const EVENT_FORM_ID = 'etkinlik-formu'
const ALLOCATE_FORM_ID = 'bilet-ayirma-formu'

function Footer({
  busy,
  form,
  submit,
  onClose,
}: {
  busy: boolean
  form: string
  submit: string
  onClose: () => void
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Vazgeç
      </Button>
      <Button type="submit" form={form} disabled={busy} aria-busy={busy || undefined}>
        {submit}
      </Button>
    </>
  )
}

/** Etkinlik formu (K-325): açılışta ve düzeltmede aynı alanlar; düzeltme bütün alanları gönderir. */
export function EventFormModal({
  event,
  onClose,
  onSaved,
}: {
  event?: TicketedEventRow
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const create = useCreateTicketedEvent()
  const update = useUpdateTicketedEvent()
  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: eventDefaults(event),
  })
  const types = useFieldArray({ control: form.control, name: 'ticketTypes' })
  const seatingMode = useWatch({ control: form.control, name: 'seatingMode' })
  const kinds = useWatch({ control: form.control, name: 'ticketTypes' })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const setError = (name: string, error: { message: string }) => {
    const field = eventFormField(name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const body = eventBody(values)
    if (event) {
      const outcome = await update.submit(
        { eventId: event.id, version: event.version, body },
        { setError },
      )
      if (outcome.status === 'success') {
        notify.success('Etkinlik güncellendi.')
        onSaved(event.id)
      }
      return
    }
    const outcome = await create.submit(body, { setError })
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.name} etkinliği açıldı.`)
      onSaved(outcome.data.data.id)
    }
  })
  const title = event ? 'Etkinliği düzenle' : 'Etkinlik ekle'
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Saat Türkiye saatidir. Bilet ayrılmış koltuk kapatılamaz, bileti olan tür kaldırılamaz."
      footer={<Footer busy={busy} form={EVENT_FORM_ID} submit="Kaydet" onClose={onClose} />}
    >
      <form
        id={EVENT_FORM_ID}
        noValidate
        aria-label={title}
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(submitEvent) => void onSubmit(submitEvent)}
      >
        <FormField id="etkinlik-ad" label="Etkinlik adı" error={errors.name}>
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
        <FormField id="etkinlik-baslangic" label="Gün ve saat" error={errors.startsAt}>
          {(control) => (
            <Input
              {...control}
              type="datetime-local"
              {...form.register('startsAt')}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="etkinlik-salon" label="Salon" error={errors.venue}>
          {(control) => <Input {...control} {...form.register('venue')} disabled={busy} />}
        </FormField>
        <FormField id="etkinlik-oturma" label="Oturma düzeni" error={errors.seatingMode}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('seatingMode')}
              disabled={busy}
              className="w-full"
            >
              {EVENT_SEATING_MODES.map((mode) => (
                <NativeSelectOption key={mode} value={mode}>
                  {EVENT_SEATING_MODE_LABELS[mode]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {seatingMode === 'seated' ? (
          <>
            <FormField
              id="etkinlik-sira"
              label="Sıra sayısı"
              error={errors.rowCount}
              description="Sıralar A'dan başlar (en çok 26)."
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  {...form.register('rowCount')}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField id="etkinlik-koltuk" label="Sıra başına koltuk" error={errors.seatsPerRow}>
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  {...form.register('seatsPerRow')}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField
              id="etkinlik-kapali"
              label="Kapalı koltuklar"
              error={errors.blockedSeats}
              description="Virgülle ayırın, ör. A1, A2 (teknik masa, protokol)."
            >
              {(control) => (
                <Input {...control} {...form.register('blockedSeats')} disabled={busy} />
              )}
            </FormField>
          </>
        ) : (
          <FormField id="etkinlik-kontenjan" label="Kontenjan" error={errors.capacity}>
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                {...form.register('capacity')}
                disabled={busy}
              />
            )}
          </FormField>
        )}
        <FormField
          id="etkinlik-sinir"
          label="Öğrenci başına bilet sınırı"
          error={errors.perStudentLimit}
          description="Boş bırakılırsa sınır yoktur."
        >
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              {...form.register('perStudentLimit')}
              disabled={busy}
            />
          )}
        </FormField>
        <fieldset className="grid gap-3 sm:col-span-2">
          <legend className="text-sm font-medium">Bilet türleri</legend>
          {types.fields.map((field, index) => (
            <div
              key={field.id}
              className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
            >
              <FormField
                id={`etkinlik-tur-${String(index)}-ad`}
                label={`${String(index + 1)}. tür adı`}
                error={errors.ticketTypes?.[index]?.name}
              >
                {(control) => (
                  <Input
                    {...control}
                    {...form.register(`ticketTypes.${index}.name`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField
                id={`etkinlik-tur-${String(index)}-cesit`}
                label={`${String(index + 1)}. tür`}
              >
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register(`ticketTypes.${index}.kind`)}
                    disabled={busy}
                    className="w-full"
                  >
                    {EVENT_TICKET_KINDS.map((kind) => (
                      <NativeSelectOption key={kind} value={kind}>
                        {EVENT_TICKET_KIND_LABELS[kind]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField
                id={`etkinlik-tur-${String(index)}-fiyat`}
                label={`${String(index + 1)}. tür fiyatı (TL)`}
                error={errors.ticketTypes?.[index]?.price}
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    {...form.register(`ticketTypes.${index}.price`)}
                    disabled={busy || kinds[index]?.kind === 'invitation'}
                  />
                )}
              </FormField>
              <Button
                type="button"
                variant="ghost"
                className="self-end"
                aria-label={`${String(index + 1)}. bilet türünü kaldır`}
                onClick={() => types.remove(index)}
                disabled={busy || types.fields.length === 1}
              >
                Kaldır
              </Button>
            </div>
          ))}
          <RootError message={errors.ticketTypes?.message ?? errors.ticketTypes?.root?.message} />
          <Button
            type="button"
            variant="secondary"
            className="justify-self-start"
            onClick={() => types.append({ key: '', name: '', kind: 'paid', price: '' })}
            disabled={busy || types.fields.length >= 5}
          >
            Bilet türü ekle
          </Button>
        </fieldset>
        <div className="sm:col-span-2">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

type AllocateValues = {
  studentId: string
  items: { ticketTypeKey: string; seat: string; holderName: string }[]
}

/**
 * Bilet ayırma (K-325): öğrenci (aile) ve bilet başına tür ile bilet sahibinin adı. Numaralı salonda
 * satırlar seçilen koltuklardır; numarasızda bilet sayısı 1–10 arasında eklenir.
 */
export function AllocateTicketsModal({
  event,
  seats,
  onClose,
  onSaved,
}: {
  event: TicketedEventRow
  seats: readonly string[]
  onClose: () => void
  onSaved: () => void
}) {
  const students = useCoreAll('students')
  const allocate = useAllocateEventTickets()
  const firstType = event.ticketTypes[0]?.key ?? ''
  const form = useForm<AllocateValues>({
    defaultValues: {
      studentId: '',
      items: (seats.length > 0 ? seats : ['']).map((seat) => ({
        ticketTypeKey: firstType,
        seat,
        holderName: '',
      })),
    },
  })
  const items = useFieldArray({ control: form.control, name: 'items' })
  const chosen = useWatch({ control: form.control, name: 'items' })
  const errors = form.formState.errors
  const busy = allocate.isPending || form.formState.isSubmitting
  const general = event.seatingMode === 'general'
  const options = (students.data ?? [])
    .filter((item) => item.record.isActive)
    .sort((a, b) => a.record.name.localeCompare(b.record.name, 'tr'))
  const total = chosen.reduce(
    (sum, item) =>
      sum + (event.ticketTypes.find((type) => type.key === item.ticketTypeKey)?.priceCents ?? 0),
    0,
  )
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await allocate.submit(
      {
        eventId: event.id,
        body: {
          studentId: values.studentId,
          items: values.items.map((item) => ({
            ticketTypeKey: item.ticketTypeKey,
            seat: general ? null : item.seat,
            holderName: item.holderName,
          })),
        },
      },
      {
        setError: (name, error) => {
          const match = /^items\.(\d+)\.(holderName|ticketTypeKey|seat)$/.exec(name)
          if (name === 'studentId') form.setError('studentId', error, { shouldFocus: true })
          else if (match && match[2] !== 'seat')
            form.setError(
              `items.${Number(match[1])}.${match[2] as 'holderName' | 'ticketTypeKey'}`,
              error,
              { shouldFocus: true },
            )
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${String(outcome.data.data.length)} bilet ayrıldı.`)
      onSaved()
    }
  })
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Bilet ayır"
      description={
        event.perStudentLimit === null
          ? 'Bilet öğrencinin ailesine ayrılır; bilet sahibi veli ya da misafirdir.'
          : `Öğrenci başına en çok ${String(event.perStudentLimit)} bilet ayrılabilir.`
      }
      footer={<Footer busy={busy} form={ALLOCATE_FORM_ID} submit="Bileti ayır" onClose={onClose} />}
    >
      {students.error ? (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      ) : (
        <form
          id={ALLOCATE_FORM_ID}
          noValidate
          aria-label="Bilet ayır"
          className="grid gap-4"
          onSubmit={(submitEvent) => void onSubmit(submitEvent)}
        >
          <FormField id="bilet-ogrenci" label="Öğrenci" error={errors.studentId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('studentId', { required: 'Öğrenciyi seçin.' })}
                disabled={busy}
                className="w-full"
              >
                <NativeSelectOption value="">Öğrenci seçin</NativeSelectOption>
                {options.map((item) => (
                  <NativeSelectOption key={item.record.id} value={item.record.id}>
                    {item.record.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {items.fields.map((field, index) => {
            const label = general ? `${String(index + 1)}. bilet` : `${field.seat} koltuğu`
            return (
              <fieldset
                key={field.id}
                className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_auto]"
              >
                <legend className="px-1 text-sm font-medium">{label}</legend>
                <FormField
                  id={`bilet-${String(index)}-tur`}
                  label={`${label} bilet türü`}
                  error={errors.items?.[index]?.ticketTypeKey}
                >
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`items.${index}.ticketTypeKey`)}
                      disabled={busy}
                      className="w-full"
                    >
                      {event.ticketTypes.map((type) => (
                        <NativeSelectOption key={type.key} value={type.key}>
                          {type.kind === 'invitation'
                            ? `${type.name} (davetiye)`
                            : `${type.name} (${money(type.priceCents)})`}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <FormField
                  id={`bilet-${String(index)}-sahip`}
                  label={`${label} bilet sahibi`}
                  error={errors.items?.[index]?.holderName}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`items.${index}.holderName`, {
                        validate: (value) =>
                          value.trim().length >= 2 || 'Bilet sahibinin adını yazın.',
                      })}
                      disabled={busy}
                    />
                  )}
                </FormField>
                {general ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="self-end"
                    aria-label={`${label} satırını kaldır`}
                    onClick={() => items.remove(index)}
                    disabled={busy || items.fields.length === 1}
                  >
                    Kaldır
                  </Button>
                ) : null}
              </fieldset>
            )
          })}
          {general ? (
            <Button
              type="button"
              variant="secondary"
              className="justify-self-start"
              onClick={() => items.append({ ticketTypeKey: firstType, seat: '', holderName: '' })}
              disabled={
                busy ||
                items.fields.length >= Math.min(EVENT_TICKETS_PER_REQUEST_MAX, event.availableCount)
              }
            >
              Bilet ekle
            </Button>
          ) : null}
          <p className="text-sm" role="status">
            Toplam: {money(total)}
            {total > 0 ? ' · ödeme ayrıca işaretlenir' : ''}
          </p>
          <RootError message={errors.root?.server?.message} />
        </form>
      )}
    </Modal>
  )
}
