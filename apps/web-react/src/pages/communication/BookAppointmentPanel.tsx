import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'
import type { z } from 'zod'
import { useBookAppointment } from '@kampus/react-shared/use-appointment-commands.ts'
import { useBookableSlots } from '@kampus/react-shared/use-bookable-slots.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Field, FieldDescription, FieldError, FieldLegend, FieldSet } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { focusFirstError } from '../requests/request-forms.ts'
import { useLearningStudent } from '../learning/use-learning-student.ts'
import {
  APPOINTMENT_NOTE_MAX_LENGTH,
  appointmentTypes,
  bookBody,
  bookDefaults,
  bookFormSchema,
  groupSlots,
  selectableSlot,
  type BookFormValues,
} from './appointment-forms.ts'
import type { AppointmentAudience } from './appointment-rows.ts'
import { SlotPicker } from './SlotPicker.tsx'

type Output = z.output<typeof bookFormSchema>
type Requester = Exclude<AppointmentAudience, 'teacher'>

/** `?randevu-form=` değeri: yeni talep. */
export const NEW_APPOINTMENT = 'yeni'

/**
 * Randevu talebi (öğrenci kendisi, veli seçili çocuğu için; DOM-ILT-100): kısa form sağ panelde
 * açılır. Saatler `GET /appointments/slots` ile gelir ve her açılışta tazelenir; dolu saat seçilemez
 * (DOM-ILT-105). Mükerrer gönderim `Idempotency-Key` ile önlenir. Çakışma (409
 * `appointment_conflict`, ileti genel olabilir) saat alanının altında görünür, toast çıkmaz; saat
 * listesi tazelenir ve seçili saat Dolu olduysa seçim kalkar, yazılan konu korunur.
 */
export function BookAppointmentPanel({
  open,
  onClose,
  audience,
}: {
  open: boolean
  onClose: () => void
  audience: Requester
}) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Randevu talep et"
    >
      {open ? <BookLoader onClose={onClose} audience={audience} /> : null}
    </SidePanel>
  )
}

function BookLoader({ onClose, audience }: { onClose: () => void; audience: Requester }) {
  const { student, noChild, isPending, error, retry } = useLearningStudent()
  if (error) return <QueryError error={error} onRetry={retry} />
  if (noChild)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Hesabınıza bağlı öğrenci bulunamadı.
      </p>
    )
  if (isPending || !student) return <SummaryLoading />
  if (student.isActive === false)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Kaydı pasif olan öğrenci için randevu talep edilemez.
      </p>
    )
  // Çocuk değişince form sıfırlanır: bir çocuğun saati ve konusu ötekine taşınmaz.
  return (
    <BookForm
      key={student.id}
      studentId={student.id}
      studentName={student.name}
      audience={audience}
      onClose={onClose}
    />
  )
}

function BookForm({
  studentId,
  studentName,
  audience,
  onClose,
}: {
  studentId: string
  studentName: string
  audience: Requester
  onClose: () => void
}) {
  const slots = useBookableSlots(studentId)
  const book = useBookAppointment()
  const form = useForm<BookFormValues, unknown, Output>({
    resolver: zodResolver(bookFormSchema),
    defaultValues: bookDefaults(audience),
  })
  const busy = book.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const groups = useMemo(() => groupSlots(slots.data ?? []), [slots.data])

  const onSubmit = form.handleSubmit(async (values) => {
    const result = bookBody(values, studentId, slots.data ?? [], audience)
    if (!result.ok) {
      form.setError(
        result.field,
        { type: 'manual', message: result.message },
        { shouldFocus: true },
      )
      return
    }
    const focus = focusFirstError(form.setError)
    const outcome = await book.submit(result.body, {
      // Öğrenci kimliği formda alan değildir (panel seçili çocuktan kurar); hatası form düzeyindedir.
      setError: (name: string, error) => {
        if (name === 'studentId') focus('root.server', error)
        else if (name === 'slotId' || name === 'type' || name === 'note') focus(name, error)
        else focus('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success('Randevu talebiniz öğretmene iletildi.')
      onClose()
    }
  })

  const hasSlots = groups.length > 0
  const slotErrorId = errors.slotId?.message ? 'randevu-saat-hata' : undefined
  return (
    <form
      noValidate
      aria-label="Randevu talebi"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      {audience === 'parent' ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Öğrenci: </span>
          <strong className="font-medium">{studentName}</strong>
          <span className="block text-xs text-muted-foreground">
            Başka bir çocuk için talep açmak için üstteki çocuk seçicisini kullanın.
          </span>
        </p>
      ) : null}
      <FormField id="randevu-tur" label="Görüşme türü" error={errors.type}>
        {(control) => (
          <NativeSelect {...control} {...form.register('type')} className="w-full" disabled={busy}>
            {appointmentTypes(audience).map((type) => (
              <NativeSelectOption key={type} value={type}>
                {type}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FieldSet className="gap-2">
        <FieldLegend variant="label" className="mb-0">
          Görüşme saati
        </FieldLegend>
        <FieldDescription>
          Yalnızca sınıfınıza ders veren öğretmenlerin önümüzdeki iki haftadaki saatleri listelenir.
        </FieldDescription>
        {slots.error ? (
          <QueryError error={slots.error} onRetry={() => void slots.refetch()} />
        ) : slots.isPending ? (
          <SummaryLoading />
        ) : hasSlots ? (
          <Controller
            name="slotId"
            control={form.control}
            render={({ field }) => (
              <SlotPicker
                groups={groups}
                // Dolu olan ya da listeden düşen saat seçili sayılmaz.
                value={selectableSlot(slots.data ?? [], field.value)?.slotId ?? ''}
                onChange={field.onChange}
                disabled={busy}
                describedBy={slotErrorId}
                invalid={Boolean(slotErrorId)}
              />
            )}
          />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Şu anda alınabilir bir görüşme saati yok. Öğretmenler yeni saat eklediğinde burada
            görünür.
          </p>
        )}
        <Field data-invalid={Boolean(slotErrorId)}>
          <FieldError id={slotErrorId} errors={errors.slotId ? [errors.slotId] : undefined} />
        </Field>
      </FieldSet>
      <FormField
        id="randevu-konu"
        label="Görüşme konusu"
        description={`En çok ${APPOINTMENT_NOTE_MAX_LENGTH} karakter.`}
        error={errors.note}
      >
        {(control) => (
          <Textarea
            {...control}
            {...form.register('note')}
            rows={4}
            placeholder="Hangi konuyu konuşmak istiyorsunuz?"
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onClose} submitLabel="Talebi gönder" icon="ArrowRight" />
    </form>
  )
}
