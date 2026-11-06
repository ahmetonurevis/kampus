import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useFieldArray, useForm, useWatch, type Control, type FieldErrors } from 'react-hook-form'
import {
  defaultFinanceExportProfile,
  EXPORT_COLUMN_OPTIONS,
  financeExportProfileSchema,
  FIXED_COLUMN_SOURCE,
  type FinanceExportProfile,
} from '@kampus/school-core/lib/finance-export-profile.ts'
import {
  FINANCE_EXPORT_KINDS,
  type FinanceExportKind,
} from '@kampus/school-core/lib/finance-export.ts'
import {
  FINANCE_EXPORT_TEMPLATES,
  financeExportTemplate,
} from '@kampus/school-core/lib/finance-export-templates.ts'
import {
  useFinanceExportProfile,
  useSetFinanceExportProfile,
} from '@kampus/react-shared/use-finance-exports.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'

const FORM_ID = 'aktarim-profili-formu'
const KINDS: readonly { kind: FinanceExportKind; label: string }[] = [
  { kind: 'payments', label: 'Tahsilat dosyası' },
  { kind: 'refunds', label: 'İade dosyası' },
  { kind: 'invoices', label: 'Taksit dosyası' },
]

/**
 * Muhasebe aktarım profili (ON-024, IST-111): kurum hangi programı kullanıyorsa dosyanın sütun
 * adını, sırasını ve biçimini ona göre eşler. Profil tutarları değiştirmez; yalnız yönetici düzenler.
 */
export function FinanceExportProfileButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Icon name="Settings" size={17} aria-hidden="true" />
        Dosya sütunları
      </Button>
      {open ? <ProfileModal onClose={() => setOpen(false)} /> : null}
    </>
  )
}

const TITLE = 'Dosya sütunları'
const DESCRIPTION =
  'Muhasebe programınızın beklediği başlık ve biçimi girin. Tutarlar ve satırlar değişmez.'

function ProfileModal({ onClose }: { onClose: () => void }) {
  const query = useFinanceExportProfile()
  const data = query.data?.data
  if (data)
    return (
      <ProfileForm
        profile={data.profile as FinanceExportProfile | null}
        version={data.version}
        onClose={onClose}
      />
    )
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={TITLE}
      description={DESCRIPTION}
    >
      {query.error ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Profil yükleniyor…
        </p>
      )}
    </Modal>
  )
}

function ProfileForm({
  profile,
  version,
  onClose,
}: {
  profile: FinanceExportProfile | null
  version: number
  onClose: () => void
}) {
  const save = useSetFinanceExportProfile()
  const [templateId, setTemplateId] = useState(FINANCE_EXPORT_TEMPLATES[0]?.id ?? '')
  const form = useForm<FinanceExportProfile>({
    resolver: zodResolver(financeExportProfileSchema),
    defaultValues: profile ?? defaultFinanceExportProfile(),
  })
  const busy = save.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const rootError = errors.root?.server?.message

  async function submit(next: FinanceExportProfile | null, message: string) {
    const outcome = await save.submit(
      { profile: next, version },
      { setError: (_name, error) => form.setError('root.server', error) },
    )
    if (outcome.status === 'success') {
      notify.success(message)
      onClose()
    }
  }
  const onSubmit = form.handleSubmit((values) => submit(values, 'Dosya sütunları kaydedildi.'))

  /** Yalnız sütunları değiştirir; biçim seçimleri kalır, kaydedilmeden dosya değişmez. */
  function applyTemplate() {
    const template = financeExportTemplate(templateId)
    if (!template) return
    for (const kind of FINANCE_EXPORT_KINDS)
      form.setValue(`columns.${kind}`, [...template.columns[kind]], { shouldDirty: true })
    form.clearErrors('columns')
    notify.success(`${template.label} şablonu forma uygulandı. Geçerli olması için kaydedin.`)
  }

  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={TITLE}
      description={DESCRIPTION}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            disabled={busy || profile === null}
            onClick={() => void submit(null, 'Standart dosyaya dönüldü.')}
          >
            Standart dosyaya dön
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={FORM_ID} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-5"
      >
        <div className="grid grid-cols-[1fr_auto] items-start gap-3 max-[650px]:grid-cols-1">
          <FormField
            id="profil-sablon"
            label="Hazır sütun şablonu"
            description={`${financeExportTemplate(templateId)?.description ?? ''} Şablonlar geneldir; belirli bir muhasebe programının biçimi değildir.`}
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={templateId}
                disabled={busy}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                {FINANCE_EXPORT_TEMPLATES.map((template) => (
                  <NativeSelectOption key={template.id} value={template.id}>
                    {template.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <div className="pt-7 max-[650px]:pt-0">
            <Button type="button" variant="secondary" disabled={busy} onClick={applyTemplate}>
              Şablonu uygula
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 max-[650px]:grid-cols-1">
          <FormField id="profil-ayirici" label="Sütun ayırıcı" error={errors.separator}>
            {(control) => (
              <NativeSelect {...control} {...form.register('separator')} disabled={busy}>
                <NativeSelectOption value=";">Noktalı virgül (;)</NativeSelectOption>
                <NativeSelectOption value=",">Virgül (,)</NativeSelectOption>
                <NativeSelectOption value={'\t'}>Sekme</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
          <FormField id="profil-tarih" label="Tarih biçimi" error={errors.dateFormat}>
            {(control) => (
              <NativeSelect {...control} {...form.register('dateFormat')} disabled={busy}>
                <NativeSelectOption value="iso">2026-10-05</NativeSelectOption>
                <NativeSelectOption value="tr">05.10.2026</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
          <FormField id="profil-ondalik" label="Ondalık işareti" error={errors.decimal}>
            {(control) => (
              <NativeSelect {...control} {...form.register('decimal')} disabled={busy}>
                <NativeSelectOption value=",">Virgül (1234,56)</NativeSelectOption>
                <NativeSelectOption value=".">Nokta (1234.56)</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
        </div>
        {KINDS.map(({ kind, label }) => (
          <ColumnList
            key={kind}
            kind={kind}
            label={label}
            control={form.control}
            register={form.register}
            errors={errors}
            busy={busy}
          />
        ))}
        {rootError ? (
          <p role="alert" className="text-sm text-danger">
            {rootError}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}

function ColumnList({
  kind,
  label,
  control,
  register,
  errors,
  busy,
}: {
  kind: FinanceExportKind
  label: string
  control: Control<FinanceExportProfile>
  register: ReturnType<typeof useForm<FinanceExportProfile>>['register']
  errors: FieldErrors<FinanceExportProfile>
  busy: boolean
}) {
  const name = `columns.${kind}` as const
  const columns = useFieldArray({ control, name })
  const values = useWatch({ control, name })
  const listError = errors.columns?.[kind]
  return (
    <fieldset className="grid gap-3 rounded-card border p-4">
      <legend className="px-1 font-semibold">{label}</legend>
      {columns.fields.map((field, index) => {
        const rowErrors = listError?.[index]
        const isFixed = values[index]?.source === FIXED_COLUMN_SOURCE
        const position = `${label} ${String(index + 1)}. sütun`
        return (
          <div
            key={field.id}
            className="grid grid-cols-[1fr_1fr_1fr_auto] items-start gap-2 max-[650px]:grid-cols-1"
          >
            <FormField
              id={`${kind}-${String(index)}-kaynak`}
              label="Veri"
              error={rowErrors?.source}
            >
              {(props) => (
                <NativeSelect
                  {...props}
                  {...register(`${name}.${index}.source`)}
                  aria-label={`${position} verisi`}
                  disabled={busy}
                >
                  {EXPORT_COLUMN_OPTIONS[kind].map((option) => (
                    <NativeSelectOption key={option.source} value={option.source}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                  <NativeSelectOption value={FIXED_COLUMN_SOURCE}>Sabit değer</NativeSelectOption>
                </NativeSelect>
              )}
            </FormField>
            <FormField
              id={`${kind}-${String(index)}-baslik`}
              label="Sütun başlığı"
              error={rowErrors?.header}
            >
              {(props) => (
                <Input
                  {...props}
                  {...register(`${name}.${index}.header`)}
                  aria-label={`${position} başlığı`}
                  disabled={busy}
                />
              )}
            </FormField>
            {isFixed ? (
              <FormField
                id={`${kind}-${String(index)}-deger`}
                label="Sabit değer (ör. hesap kodu)"
                error={rowErrors?.value}
              >
                {(props) => (
                  <Input
                    {...props}
                    {...register(`${name}.${index}.value`)}
                    aria-label={`${position} sabit değeri`}
                    disabled={busy}
                  />
                )}
              </FormField>
            ) : (
              <div className="max-[650px]:hidden" />
            )}
            <div className="flex gap-1 pt-7 max-[650px]:pt-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${position} yukarı taşı`}
                disabled={busy || index === 0}
                onClick={() => columns.move(index, index - 1)}
              >
                <Icon name="ArrowUp" size={16} aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${position} aşağı taşı`}
                disabled={busy || index === columns.fields.length - 1}
                onClick={() => columns.move(index, index + 1)}
              >
                <Icon name="ArrowDown" size={16} aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${position} kaldır`}
                disabled={busy || columns.fields.length === 1}
                onClick={() => columns.remove(index)}
              >
                <Icon name="Trash2" size={16} aria-hidden="true" />
              </Button>
            </div>
          </div>
        )
      })}
      {listError?.root?.message || listError?.message ? (
        <p role="alert" className="text-sm text-danger">
          {listError.root?.message ?? listError.message}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || columns.fields.length >= 30}
          onClick={() => columns.append({ source: FIXED_COLUMN_SOURCE, header: '', value: '' })}
        >
          <Icon name="Plus" size={17} aria-hidden="true" />
          Sütun ekle
        </Button>
      </div>
    </fieldset>
  )
}
