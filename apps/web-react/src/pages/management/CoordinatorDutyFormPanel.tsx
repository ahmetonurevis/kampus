import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { useAssignCoordinatorDuty } from '@kampus/react-shared/use-coordinator-duties.ts'
import { FormField } from '@/components/FormField.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import {
  DUTY_ERROR_FIELDS,
  DUTY_FORM_DEFAULTS,
  dutyFormSchema,
  type DutyFormOutput,
  type DutyFormValues,
} from './coordinator-duty-forms.ts'
import { dutyTexts, scopeOptions, type TeacherOption } from './coordinator-duty-rows.ts'
import { errorRoutes, FormActions, RootError } from './FormParts.tsx'

type Props = {
  open: boolean
  type: InstitutionType
  teachers: readonly TeacherOption[]
  /** Öğretmenin kadro branşı (üyelik kimliği → ders kimliği); bilinmiyorsa yok. */
  branchOf: (membershipId: string) => string | null
  onClose: () => void
}

/**
 * Görev ata (IST-005, DOM-YTK-027): kısa form sağ panelde. Okulda öğretmenin kendi branşındaki ders,
 * dil okulunda CEFR seviyesi seçilir; görev türü kurum türünden sunucuda belirlenir. Öğretmen
 * seçilince bilinen branşı dersi önceden seçer (değiştirilebilir); kural reddi (başka branş,
 * kadro kaydı yok, yinelenen görev) alanın altında görünür. Gönderim sürerken düğme kilitli,
 * ikinci gönderim istek atmaz.
 */
export function CoordinatorDutyFormPanel({ open, type, teachers, branchOf, onClose }: Props) {
  const texts = dutyTexts(type)
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={texts.formTitle}
      description={texts.formNote}
    >
      {open ? (
        <DutyForm type={type} teachers={teachers} branchOf={branchOf} onClose={onClose} />
      ) : null}
    </SidePanel>
  )
}

function DutyForm({ type, teachers, branchOf, onClose }: Omit<Props, 'open'>) {
  const texts = dutyTexts(type)
  const options = scopeOptions(type)
  const assign = useAssignCoordinatorDuty()
  const form = useForm<DutyFormValues, unknown, DutyFormOutput>({
    resolver: zodResolver(dutyFormSchema),
    defaultValues: DUTY_FORM_DEFAULTS,
  })
  const busy = assign.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await assign.submit(values, {
      setError: form.setError,
      ...errorRoutes(DUTY_ERROR_FIELDS),
    })
    if (outcome.status === 'success') {
      notify.success(`${texts.kindLabel} görevi verildi.`)
      onClose()
    } else if (outcome.status === 'failed') {
      const field = DUTY_ERROR_FIELDS[outcome.error.code as keyof typeof DUTY_ERROR_FIELDS]
      if (field) form.setFocus(field)
    }
  })

  return (
    <form
      noValidate
      aria-label={texts.formTitle}
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <p className="text-sm text-muted-foreground">
        Görev öğrenci bazında not yazma yetkisi vermez. Bu formdaki tüm alanlar zorunludur.
      </p>
      <FormField id="gorev-ogretmen" label="Öğretmen" error={errors.membershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('membershipId', {
              onChange: (event: { target: { value: string } }) => {
                // Okulda öğretmenin branşı biliniyorsa ders önceden seçilir; kullanıcı değiştirebilir.
                const branch = type === 'school' ? branchOf(event.target.value) : null
                if (branch) form.setValue('scopeId', branch, { shouldDirty: true })
              },
            })}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Öğretmen seçin</NativeSelectOption>
            {teachers.map((teacher) => (
              <NativeSelectOption key={teacher.value} value={teacher.value}>
                {teacher.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="gorev-kapsam" label={texts.scopeLabel} error={errors.scopeId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('scopeId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">{texts.scopePlaceholder}</NativeSelectOption>
            {options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onClose} submitLabel="Görevi ver" />
    </form>
  )
}
