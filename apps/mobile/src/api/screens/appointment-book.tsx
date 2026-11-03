import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import {
  appointmentTypes,
  bookDefaults,
  type BookFormValues,
  type SlotView,
} from '@kampus/react-shared/appointment-form-model.ts'
import { useBookAppointment } from '@kampus/react-shared/use-appointment-commands.ts'
import { useBookableSlots } from '@kampus/react-shared/use-bookable-slots.ts'
import { APPOINTMENT_NOTE_MAX_LENGTH } from '@kampus/school-core/lib/appointments.ts'
import { Badge, Button, Field, Select, Sheet, T, useColors } from '../../ui/components.tsx'
import { Notice } from '../../ui/SchoolLayout.tsx'
import { createFieldCollector } from '../command-failure.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import {
  ALL_TEACHERS,
  bookFailure,
  checkBook,
  filterSlotGroups,
  groupSlots,
  slotTeachers,
  stillSelectable,
  type BookErrors,
} from '../student-appointment.ts'
import { useNotify } from '../toast.tsx'

const BOOKED_TEXT = 'Randevu talebin öğretmene iletildi.'

/**
 * Randevu talebi (alt pencere): görüşme türü, öğretmen süzgeci, gün gün alınabilir saatler ve konu.
 * Saatler `GET /appointments/slots` ile gelir ve her açılışta tazelenir; dolu saat seçilemez, nedeni
 * gösterilmez (DOM-ILT-105). Gün ve saat Europe/Istanbul gösterilir. Çakışmada (başkası aynı saati
 * aldı) liste kendiliğinden tazelenir, dolan saatin seçimi kalkar ve yazılan konu korunur. Düğme
 * gönderimde kilitlenir; ağ hatasında "Yeniden dene" aynı gövdeyi aynı `Idempotency-Key` ile
 * gönderir. Konu yalnız bellekte durur, cihaza yazılmaz.
 */
export function AppointmentBookSheet({
  studentId,
  onClose,
}: {
  studentId: string
  onClose: () => void
}) {
  const notify = useNotify()
  const slots = useBookableSlots(studentId)
  const book = useBookAppointment()
  const [values, setValues] = useState<BookFormValues>(() => bookDefaults('student'))
  const [teacher, setTeacher] = useState(ALL_TEACHERS)
  const [errors, setErrors] = useState<BookErrors>({})
  const [failure, setFailure] = useState<ReturnType<typeof bookFailure> | null>(null)
  const groups = useMemo(() => groupSlots(slots.data ?? []), [slots.data])
  const visibleGroups = useMemo(() => filterSlotGroups(groups, teacher), [groups, teacher])
  const teachers = useMemo(() => slotTeachers(groups), [groups])
  // Dolan ya da listeden düşen saat seçili sayılmaz.
  const slotId = stillSelectable(slots.data ?? [], values.slotId)

  function change(patch: Partial<BookFormValues>, field: keyof BookErrors) {
    setValues({ ...values, ...patch })
    setErrors({ ...errors, [field]: undefined })
    setFailure(null)
  }

  async function submit() {
    if (book.isPending) return
    const check = checkBook({ ...values, slotId }, studentId, slots.data ?? [])
    if (!check.ok) {
      setErrors(check.errors)
      setFailure(null)
      return
    }
    setErrors({})
    setFailure(null)
    const collector = createFieldCollector()
    const outcome = await book.submit(check.body, {
      setError: collector.setError,
      // Hata formun içinde gösterilir; toast aynı hatayı ikinci kez söylemesin.
      silent: () => true,
    })
    if (outcome.status === 'busy') return
    if (outcome.status === 'failed') {
      const next = bookFailure(outcome.error, collector.fields)
      setErrors(next.errors)
      setFailure(next)
      return
    }
    notify(BOOKED_TEXT)
    onClose()
  }

  const retry = failure?.retryable === true
  const footer = (
    <View style={{ gap: 12 }}>
      {failure?.message && (
        <Notice tone="red" title="Talep gönderilemedi" text={failure.message}>
          {retry && (
            <T size={13}>Talep iletilmiş olabilir; yeniden denemek mükerrer kayıt açmaz.</T>
          )}
        </Notice>
      )}
      <Button
        primary
        icon="Send"
        disabled={book.isPending || !slots.data}
        label={book.isPending ? 'Talep gönderiliyor' : retry ? 'Yeniden dene' : 'Talebi gönder'}
        onPress={() => void submit()}
      >
        {book.isPending ? 'Gönderiliyor…' : retry ? 'Yeniden dene' : 'Talebi gönder'}
      </Button>
    </View>
  )

  return (
    <Sheet visible title="Randevu talep et" onClose={onClose} footer={footer} pinFooter>
      <Select
        label="Görüşme türü"
        value={values.type}
        options={appointmentTypes('student').map((type) => ({ value: type, label: type }))}
        required
        onChange={(type) => change({ type: type as BookFormValues['type'] }, 'type')}
      />
      {errors.type && <Notice tone="red" title={errors.type} />}
      <View style={{ gap: 12 }}>
        <T bold size={14}>
          Görüşme saati
        </T>
        <T muted size={12}>
          Yalnızca sınıfına ders veren öğretmenlerin önümüzdeki iki haftadaki saatleri listelenir.
        </T>
        {teachers.length > 1 && (
          <Select
            label="Öğretmen"
            value={teacher}
            options={teachers.map((name) => ({ value: name, label: name }))}
            onChange={setTeacher}
          />
        )}
        {slots.error ? (
          <QueryError error={slots.error} onRetry={() => void slots.refetch()} />
        ) : !slots.data ? (
          <ListLoading label="Saatler yükleniyor…" />
        ) : visibleGroups.length === 0 ? (
          <T muted size={14} accessibilityRole="text">
            Şu anda alınabilir bir görüşme saati yok. Öğretmenler yeni saat eklediğinde burada
            görünür.
          </T>
        ) : (
          visibleGroups.map((group) => (
            <View key={group.day} style={{ gap: 8 }} accessibilityRole="radiogroup">
              <T bold size={14}>
                {group.label}
              </T>
              {group.slots.map((slot) => (
                <SlotOption
                  key={slot.id}
                  slot={slot}
                  day={group.label}
                  selected={slot.available && slotId === slot.id}
                  disabled={book.isPending}
                  onPress={() => change({ slotId: slot.id }, 'slotId')}
                />
              ))}
            </View>
          ))
        )}
        {errors.slotId && <Notice tone="red" title={errors.slotId} />}
      </View>
      <Field
        label="Görüşme konusu"
        value={values.note}
        onChange={(note) => change({ note }, 'note')}
        placeholder="Hangi konuyu konuşmak istiyorsun?"
        hint={`En çok ${APPOINTMENT_NOTE_MAX_LENGTH} karakter.`}
        multiline
        maxLength={APPOINTMENT_NOTE_MAX_LENGTH}
        editable={!book.isPending}
        {...(errors.note ? { error: errors.note } : {})}
      />
    </Sheet>
  )
}

/** Tek saat: seçilebilir kart (radyo); dolu saat soluk ve seçilemez, nedeni söylenmez. */
function SlotOption({
  slot,
  day,
  selected,
  disabled,
  onPress,
}: {
  slot: SlotView
  day: string
  selected: boolean
  disabled: boolean
  onPress: () => void
}) {
  const c = useColors()
  const detail = [slot.teacher, slot.subjects, slot.campus].filter(Boolean).join(' · ')
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${day}, ${slot.time}, ${detail}${slot.available ? '' : ', dolu'}`}
      accessibilityState={{ selected, disabled: disabled || !slot.available }}
      disabled={disabled || !slot.available}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        gap: 4,
        padding: 12,
        borderRadius: 10,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? c.primary : c.border,
        backgroundColor: selected ? c.primarySoft : slot.available ? c.surface : c.soft,
        opacity: pressed ? 0.7 : slot.available ? 1 : 0.6,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <T bold>{slot.time}</T>
        {!slot.available && <Badge text="Dolu" />}
      </View>
      <T muted size={13}>
        {detail}
      </T>
    </Pressable>
  )
}
