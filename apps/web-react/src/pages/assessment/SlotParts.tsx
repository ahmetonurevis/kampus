import { useId } from 'react'
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import {
  useAddAvailabilitySlot,
  useRemoveAvailabilitySlot,
} from '@kampus/react-shared/use-assessment-commands.ts'
import { automationSchemas } from '@kampus/school-core/lib/assessment-automation.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { FormActions, useFocusAfterSubmit } from '../management/FormParts.tsx'
import { slotRequest, type AvailabilityRow, type SlotFormValues } from './tutoring-model.ts'

const FIELDS = ['teacherId', 'date', 'duration'] as const satisfies (keyof SlotFormValues)[]
/** Sunucunun çakışma ve gelecek-saat kuralları tarih alanına yazılır. */
const DATE_CODES = new Set([
  'availability_must_be_future',
  'availability_overlap',
  'tutor_schedule_conflict',
])

/** Formu core `automationSchemas.slot` şemasıyla doğrular (sunucuyla aynı şema). */
const resolver: Resolver<SlotFormValues> = (values) => {
  const parsed = automationSchemas.slot.safeParse(slotRequest(values))
  if (parsed.success) return { values, errors: {} }
  const errors: FieldErrors<SlotFormValues> = {}
  for (const issue of parsed.error.issues) {
    const key = FIELDS.find((name) => name === issue.path[0])
    if (key && !errors[key]) errors[key] = { type: issue.code, message: issue.message }
  }
  return { values: {}, errors }
}

/**
 * Uygunluk saati formu (etüt bölümü satır içi, öğretmenin Randevular sayfası sağ panelde).
 * `onClose` verilirse panel düzenidir: tek sütun, "Vazgeç" düğmesi ve başarıda kapanır. Sunucu
 * hatası (geçmiş saat, çakışma) tarih alanına yazılır ve odak oraya gider.
 */
export function SlotForm({
  teachers,
  admin,
  onClose,
}: {
  teachers: readonly { id: string; name: string }[]
  admin: boolean
  onClose?: (() => void) | undefined
}) {
  const prefix = useId()
  const add = useAddAvailabilitySlot()
  const form = useForm<SlotFormValues>({
    resolver,
    defaultValues: { teacherId: teachers[0]?.id ?? '', date: '', duration: '30' },
  })
  const errors = form.formState.errors
  const busy = add.isPending || form.formState.isSubmitting
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)

  const onSubmit = form.handleSubmit(
    async (values) => {
      const outcome = await add.submit(slotRequest(values), {
        setError: (name, issue) => {
          const field = FIELDS.find((item) => item === name)
          if (field) form.setError(field, issue)
        },
      })
      if (outcome.status === 'success') {
        notify.success('Uygunluk saati eklendi.')
        form.reset({ ...values, date: '' })
        onClose?.()
        return
      }
      if (outcome.status === 'failed' && DATE_CODES.has(outcome.error.code)) {
        form.setError('date', { type: outcome.error.code, message: outcome.error.message })
        focusAfterSubmit('date')
      }
    },
    (invalid) => focusAfterSubmit(FIELDS.find((name) => invalid[name])),
  )

  return (
    <form
      noValidate
      aria-label="Uygunluk saati ekle"
      onSubmit={(event) => void onSubmit(event)}
      className={onClose ? 'grid gap-5' : 'grid max-w-3xl gap-4'}
    >
      <div className={onClose ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-3'}>
        {admin ? (
          <FormField id={`${prefix}-ogretmen`} label="Öğretmen" error={errors.teacherId}>
            {(control) => (
              <NativeSelect {...control} className="w-full" {...form.register('teacherId')}>
                {teachers.map((teacher) => (
                  <NativeSelectOption key={teacher.id} value={teacher.id}>
                    {teacher.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        <FormField
          id={`${prefix}-tarih`}
          label="Başlangıç (tarih ve saat)"
          error={errors.date}
          description="Gelecekte bir saat seçin; saat Türkiye saatidir."
        >
          {(control) => <Input {...control} type="datetime-local" {...form.register('date')} />}
        </FormField>
        <FormField
          id={`${prefix}-sure`}
          label="Süre (dakika)"
          error={errors.duration}
          description="15 ile 120 dakika arası."
        >
          {(control) => (
            <Input {...control} type="number" inputMode="numeric" {...form.register('duration')} />
          )}
        </FormField>
      </div>
      {onClose ? (
        <FormActions busy={busy} onCancel={onClose} submitLabel="Müsaitlik ekle" />
      ) : (
        <div>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            Uygunluk saati ekle
          </Button>
        </div>
      )}
    </form>
  )
}

export function RemoveDialog({
  row,
  version,
  onClose,
}: {
  row: AvailabilityRow
  version: number | undefined
  onClose: () => void
}) {
  const remove = useRemoveAvailabilitySlot()

  async function confirm() {
    const outcome = await remove.submit({ slotId: row.id, version })
    if (outcome.status === 'success') {
      notify.success('Uygunluk saati kaldırıldı. Mevcut etütler iptal edilmez.')
      onClose()
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Uygunluk saatini kaldır"
      description="Bu işlem geri alınamaz; saat gerekirse yeniden eklenebilir."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            type="button"
            disabled={remove.isPending}
            aria-busy={remove.isPending || undefined}
            onClick={() => void confirm()}
          >
            Saati kaldır
          </Button>
        </>
      }
    >
      <p className="text-sm">
        {row.teacher} için {row.when} ({row.duration} dk) uygunluk saati kaldırılacak. Bu saate daha
        önce yerleştirilmiş etütler iptal edilmez.
      </p>
    </Modal>
  )
}
