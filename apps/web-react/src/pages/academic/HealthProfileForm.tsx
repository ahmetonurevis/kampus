import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import {
  Controller,
  useFieldArray,
  useForm,
  type Control,
  type FieldErrors,
  type Path,
  type Resolver,
  type UseFormRegister,
} from 'react-hook-form'
import {
  LEGAL_BASIS_OPTIONS,
  SEVERITY_OPTIONS,
  healthFormValues,
  healthProfileFormSchema,
  normalizeHealthForm,
  toHealthPatch,
  type HealthFullData,
  type HealthProfileForm,
  type HealthProfilePatchBody,
} from '@kampus/react-shared/health-profile-model.ts'
import { HEALTH_LIST_MAX, HEALTH_NAME_MAX } from '@kampus/school-core/lib/health-profile.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'

type FormApi = {
  control: Control<HealthProfileForm>
  register: UseFormRegister<HealthProfileForm>
  errors: FieldErrors<HealthProfileForm>
}

type SetFieldError = (name: string, error: { type: string; message: string }) => void

/**
 * Sağlık ve acil bilgi düzenleme formu (OG-090; DOM-ILT-035): liste alanları ekle/çıkar, hukuki
 * dayanak Türkçe etiketli seçim. Doğrulama çekirdeğin kısmi şemasıdır (`healthProfilePatchSchema`);
 * kayıtta yalnız değişen alanlar ve `version` gider. Sürüm çakışmasında kanca profili yeniden
 * yükler ve form güncel kayda döner. Taslak hiçbir yerde saklanmaz (kvkk: Ö).
 */
export function HealthProfileForm({
  data,
  pending,
  onSave,
  onCancel,
}: {
  data: HealthFullData
  pending: boolean
  onSave: (patch: HealthProfilePatchBody, setError: SetFieldError) => Promise<unknown>
  onCancel: () => void
}) {
  const hasRecord = data.profile.legalBasis !== null
  const resolver = useMemo<Resolver<HealthProfileForm>>(() => {
    const base = zodResolver(healthProfileFormSchema(hasRecord)) as Resolver<HealthProfileForm>
    return (values, context, options) => base(normalizeHealthForm(values), context, options)
  }, [hasRecord])
  const values = useMemo(() => healthFormValues(data), [data])
  const form = useForm<HealthProfileForm>({ resolver, defaultValues: values, values })
  const errors = form.formState.errors

  const submit = form.handleSubmit(async (parsed) => {
    const patch = toHealthPatch(parsed, data)
    if (!patch) {
      notify.info(
        hasRecord
          ? 'Değişiklik yok; kaydedilecek bir şey bulunamadı.'
          : 'Kaydetmek için en az bir sağlık bilgisi girin.',
      )
      return
    }
    await onSave(patch, (name, error) => form.setError(name as Path<HealthProfileForm>, error))
  })

  const api: FormApi = { control: form.control, register: form.register, errors }
  return (
    <form onSubmit={submit} noValidate className="grid gap-6" aria-busy={pending}>
      <AllergyFields {...api} />
      <NamedFields
        {...api}
        name="chronicConditions"
        legend="Kronik durumlar"
        itemLabel="Kronik durum"
        addLabel="Kronik durum ekle"
      />
      <MedicationFields {...api} />
      <NamedFields
        {...api}
        name="supportNeeds"
        legend="Destek ihtiyaçları"
        itemLabel="Destek ihtiyacı"
        addLabel="Destek ihtiyacı ekle"
      />
      <FormField
        id="saglik-acil"
        label="Acil müdahale talimatı"
        description="Örn. adrenalin oto-enjektörü çantada. En çok 500 karakter."
        error={errors.emergencyInstructions}
      >
        {(control) => (
          <Textarea {...control} rows={3} {...form.register('emergencyInstructions')} />
        )}
      </FormField>
      <FormField
        id="saglik-dayanak"
        label="Hukuki dayanak"
        description="Bu bilginin hangi dayanakla işlendiği (KVKK m.6)."
        error={errors.legalBasis}
      >
        {(control) => (
          <NativeSelect {...control} className="w-full max-w-sm" {...form.register('legalBasis')}>
            {hasRecord ? null : <option value="">Seçin</option>}
            {LEGAL_BASIS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" aria-disabled={pending || undefined} disabled={pending}>
          Kaydet
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
    </form>
  )
}

function AddButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      <Icon name="Plus" size={16} aria-hidden="true" />
      {label}
    </Button>
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onClick}>
      <Icon name="Trash2" size={16} aria-hidden="true" />
    </Button>
  )
}

function AllergyFields({ control, register, errors }: FormApi) {
  const { fields, append, remove } = useFieldArray({ control, name: 'allergies' })
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-base font-semibold">Alerjiler</legend>
      {fields.map((field, index) => (
        <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_14rem_auto] sm:items-start">
          <FormField
            id={`saglik-alerji-${index}`}
            label={`Alerji ${index + 1} adı`}
            error={errors.allergies?.[index]?.name}
          >
            {(props) => (
              <Input
                {...props}
                maxLength={HEALTH_NAME_MAX}
                {...register(`allergies.${index}.name`)}
              />
            )}
          </FormField>
          <FormField
            id={`saglik-alerji-siddet-${index}`}
            label={`Alerji ${index + 1} şiddeti`}
            error={errors.allergies?.[index]?.severity}
          >
            {(props) => (
              <NativeSelect {...props} {...register(`allergies.${index}.severity`)}>
                {SEVERITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <div className="sm:pt-7">
            <RemoveButton label={`Alerji ${index + 1} sil`} onClick={() => remove(index)} />
          </div>
        </div>
      ))}
      <ListError message={listMessage(errors.allergies)} />
      <div>
        <AddButton
          label="Alerji ekle"
          disabled={fields.length >= HEALTH_LIST_MAX}
          onClick={() => append({ name: '', severity: 'mild' })}
        />
      </div>
    </fieldset>
  )
}

function NamedFields({
  control,
  register,
  errors,
  name,
  legend,
  itemLabel,
  addLabel,
}: FormApi & {
  name: 'chronicConditions' | 'supportNeeds'
  legend: string
  itemLabel: string
  addLabel: string
}) {
  const { fields, append, remove } = useFieldArray({ control, name })
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-base font-semibold">{legend}</legend>
      {fields.map((field, index) => (
        <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
          <FormField
            id={`saglik-${name}-${index}`}
            label={`${itemLabel} ${index + 1}`}
            error={errors[name]?.[index]?.name}
          >
            {(props) => (
              <Input
                {...props}
                maxLength={HEALTH_NAME_MAX}
                {...register(`${name}.${index}.name`)}
              />
            )}
          </FormField>
          <div className="sm:pt-7">
            <RemoveButton label={`${itemLabel} ${index + 1} sil`} onClick={() => remove(index)} />
          </div>
        </div>
      ))}
      <ListError message={listMessage(errors[name])} />
      <div>
        <AddButton
          label={addLabel}
          disabled={fields.length >= HEALTH_LIST_MAX}
          onClick={() => append({ name: '' })}
        />
      </div>
    </fieldset>
  )
}

function MedicationFields({ control, register, errors }: FormApi) {
  const { fields, append, remove } = useFieldArray({ control, name: 'medications' })
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-base font-semibold">Düzenli ilaçlar</legend>
      {fields.map((field, index) => (
        <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-start">
          <FormField
            id={`saglik-ilac-${index}`}
            label={`İlaç ${index + 1} adı`}
            error={errors.medications?.[index]?.name}
          >
            {(props) => (
              <Input
                {...props}
                maxLength={HEALTH_NAME_MAX}
                {...register(`medications.${index}.name`)}
              />
            )}
          </FormField>
          <FormField
            id={`saglik-ilac-duzen-${index}`}
            label={`İlaç ${index + 1} kullanım düzeni`}
            error={errors.medications?.[index]?.schedule}
          >
            {(props) => (
              <Input
                {...props}
                maxLength={HEALTH_NAME_MAX}
                placeholder="Örn. sabah 1 tablet"
                {...register(`medications.${index}.schedule`)}
              />
            )}
          </FormField>
          <div className="flex items-center gap-2 sm:pt-8">
            <Controller
              control={control}
              name={`medications.${index}.atSchool`}
              render={({ field: atSchool }) => (
                <Checkbox
                  id={`saglik-ilac-okul-${index}`}
                  checked={atSchool.value === true}
                  onCheckedChange={(next) => atSchool.onChange(next === true)}
                />
              )}
            />
            <label htmlFor={`saglik-ilac-okul-${index}`} className="text-sm">
              Okulda verilir
            </label>
          </div>
          <div className="sm:pt-7">
            <RemoveButton label={`İlaç ${index + 1} sil`} onClick={() => remove(index)} />
          </div>
        </div>
      ))}
      <ListError message={listMessage(errors.medications)} />
      <div>
        <AddButton
          label="İlaç ekle"
          disabled={fields.length >= HEALTH_LIST_MAX}
          onClick={() => append({ name: '', schedule: '', atSchool: false })}
        />
      </div>
    </fieldset>
  )
}

/** Listenin kendisine bağlı hata (ör. "En çok 20 kalem", "Aynı kalem iki kez yazılamaz."). */
function listMessage(errors: unknown): string | undefined {
  const root = (errors as { root?: { message?: string }; message?: string } | undefined) ?? {}
  return root.root?.message ?? root.message
}

function ListError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null
}
