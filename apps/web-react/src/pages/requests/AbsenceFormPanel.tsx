import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { notifyAbsenceSchema } from '@kampus/school-core/lib/requests.ts'
import { useNotifyAbsence } from '@kampus/react-shared/use-request-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError } from '../management/FormParts.tsx'
import { ChildrenGate, ChildSelectField, type ChildOption } from './ChildSelectField.tsx'
import { ABSENCE_REASON_OPTIONS, focusFirstError } from './request-forms.ts'

type Values = z.input<typeof notifyAbsenceSchema>
type Output = z.output<typeof notifyAbsenceSchema>

/** `?bildirim-form=` değeri: yeni bildirim. */
export const NEW_NOTICE = 'yeni'

/**
 * İzin/mazeret bildirimi (veli): çocuk, tarih aralığı ve gerekçe kategorisi. Serbest açıklama
 * alanı yoktur; gerekçe yalnız kategoridir (DOM-ILT-053, KVKK md. 6). Geç mazeret ve örtüşen
 * bildirim hatası ilgili tarih alanının altında görünür (toast çıkmaz).
 */
export function AbsenceFormPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="İzin veya mazeret bildir"
    >
      {open ? (
        <ChildrenGate>
          {(options, defaultId) => (
            <AbsenceForm options={options} defaultId={defaultId} onClose={onClose} />
          )}
        </ChildrenGate>
      ) : null}
    </SidePanel>
  )
}

function AbsenceForm({
  options,
  defaultId,
  onClose,
}: {
  options: readonly ChildOption[]
  defaultId: string
  onClose: () => void
}) {
  const notice = useNotifyAbsence()
  const form = useForm<Values, unknown, Output>({
    resolver: zodResolver(notifyAbsenceSchema),
    // Gerekçe boş başlar: kullanıcı bilerek seçer, seçmezse şema mesajı alanın altında çıkar.
    defaultValues: { studentId: defaultId, startDate: '', endDate: '' },
  })
  const busy = notice.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await notice.submit(values, { setError: focusFirstError(form.setError) })
    if (outcome.status === 'success') {
      notify.success('Bildiriminiz kuruma iletildi.')
      onClose()
    }
  })

  return (
    <form
      noValidate
      aria-label="İzin veya mazeret bildir"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <p className="text-sm text-muted-foreground">
        Gerekçe yalnız kategori olarak alınır; sağlık veya özel bilgi yazmanıza gerek yoktur.
        Belgeyi okula ayrıca iletin.
      </p>
      <ChildSelectField
        id="bildirim-ogrenci"
        options={options}
        error={errors.studentId}
        selectProps={{ ...form.register('studentId'), disabled: busy }}
      />
      <FormField id="bildirim-baslangic" label="Başlangıç tarihi" error={errors.startDate}>
        {(control) => (
          <Input
            {...control}
            {...form.register('startDate')}
            type="date"
            className="w-full"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="bildirim-bitis" label="Bitiş tarihi" error={errors.endDate}>
        {(control) => (
          <Input
            {...control}
            {...form.register('endDate')}
            type="date"
            className="w-full"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="bildirim-gerekce" label="Gerekçe" error={errors.reasonCategory}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('reasonCategory')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            {ABSENCE_REASON_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onClose} submitLabel="Bildir" icon="ArrowRight" />
    </form>
  )
}
