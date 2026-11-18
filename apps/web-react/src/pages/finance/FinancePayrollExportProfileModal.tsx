import { zodResolver } from '@hookform/resolvers/zod'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import {
  usePayrollExportProfile,
  useSetPayrollExportProfile,
} from '@kampus/react-shared/use-finance-payroll-exports.ts'
import { FIXED_COLUMN_SOURCE } from '@kampus/school-core/lib/finance-export-profile.ts'
import {
  defaultPayrollExportProfile,
  PAYROLL_EXPORT_COLUMN_OPTIONS,
  payrollExportProfileSchema,
  type PayrollExportProfile,
} from '@kampus/school-core/lib/finance-payroll-exports.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'

const FORM_ID = 'bordro-sablon-formu'
const TITLE = 'Bordro dosyası sütunları'
const DESCRIPTION =
  'Bordro programınızın beklediği sütun adını, sırasını ve biçimini girin. Hazır program şablonu yoktur; satırlar ve tutarlar değişmez.'

/**
 * Sütun eşleme şablonu (DOM-FIN-105, K-339): ayırıcı, ondalık, tarih biçimi, sütun adı ve sırası,
 * sabit sütun. "Genel dosyaya dön" şablonu siler.
 */
export function FinancePayrollExportProfileModal({ onClose }: { onClose: () => void }) {
  const query = usePayrollExportProfile()
  const data = query.data?.data
  if (data)
    return (
      <ProfileForm
        profile={data.profile as PayrollExportProfile | null}
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
          Şablon yükleniyor…
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
  profile: PayrollExportProfile | null
  version: number
  onClose: () => void
}) {
  const save = useSetPayrollExportProfile()
  const form = useForm<PayrollExportProfile>({
    resolver: zodResolver(payrollExportProfileSchema),
    defaultValues: profile ?? defaultPayrollExportProfile(),
  })
  const columns = useFieldArray({ control: form.control, name: 'columns' })
  const values = useWatch({ control: form.control, name: 'columns' })
  const busy = save.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const listError = errors.columns

  async function submit(next: PayrollExportProfile | null, message: string) {
    const outcome = await save.submit(
      { profile: next, version },
      { setError: (_name, error) => form.setError('root.server', error) },
    )
    if (outcome.status === 'success') {
      notify.success(message)
      onClose()
    }
  }
  const onSubmit = form.handleSubmit((next) => submit(next, 'Bordro dosyası sütunları kaydedildi.'))

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
            onClick={() => void submit(null, 'Genel dosyaya dönüldü.')}
          >
            Genel dosyaya dön
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
        <div className="grid grid-cols-3 gap-3 max-[650px]:grid-cols-1">
          <FormField id="bordro-ayirici" label="Sütun ayırıcı" error={errors.separator}>
            {(control) => (
              <NativeSelect {...control} {...form.register('separator')} disabled={busy}>
                <NativeSelectOption value=";">Noktalı virgül (;)</NativeSelectOption>
                <NativeSelectOption value=",">Virgül (,)</NativeSelectOption>
                <NativeSelectOption value={'\t'}>Sekme</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
          <FormField id="bordro-tarih" label="Tarih biçimi" error={errors.dateFormat}>
            {(control) => (
              <NativeSelect {...control} {...form.register('dateFormat')} disabled={busy}>
                <NativeSelectOption value="iso">2026-10-05</NativeSelectOption>
                <NativeSelectOption value="tr">05.10.2026</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
          <FormField id="bordro-ondalik" label="Ondalık işareti" error={errors.decimal}>
            {(control) => (
              <NativeSelect {...control} {...form.register('decimal')} disabled={busy}>
                <NativeSelectOption value=",">Virgül (1234,56)</NativeSelectOption>
                <NativeSelectOption value=".">Nokta (1234.56)</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
        </div>
        <fieldset className="grid gap-3 rounded-card border p-4">
          <legend className="px-1 font-semibold">Sütunlar</legend>
          {columns.fields.map((field, index) => {
            const rowErrors = listError?.[index]
            const isFixed = values[index]?.source === FIXED_COLUMN_SOURCE
            const position = `${String(index + 1)}. sütun`
            return (
              <div
                key={field.id}
                className="grid grid-cols-[1fr_1fr_1fr_auto] items-start gap-2 max-[650px]:grid-cols-1"
              >
                <FormField
                  id={`bordro-${String(index)}-kaynak`}
                  label="Veri"
                  error={rowErrors?.source}
                >
                  {(props) => (
                    <NativeSelect
                      {...props}
                      {...form.register(`columns.${index}.source`)}
                      aria-label={`${position} verisi`}
                      disabled={busy}
                    >
                      {PAYROLL_EXPORT_COLUMN_OPTIONS.map((option) => (
                        <NativeSelectOption key={option.source} value={option.source}>
                          {option.label}
                        </NativeSelectOption>
                      ))}
                      <NativeSelectOption value={FIXED_COLUMN_SOURCE}>
                        Sabit değer
                      </NativeSelectOption>
                    </NativeSelect>
                  )}
                </FormField>
                <FormField
                  id={`bordro-${String(index)}-baslik`}
                  label="Sütun başlığı"
                  error={rowErrors?.header}
                >
                  {(props) => (
                    <Input
                      {...props}
                      {...form.register(`columns.${index}.header`)}
                      aria-label={`${position} başlığı`}
                      disabled={busy}
                    />
                  )}
                </FormField>
                {isFixed ? (
                  <FormField
                    id={`bordro-${String(index)}-deger`}
                    label="Sabit değer (ör. şube kodu)"
                    error={rowErrors?.value}
                  >
                    {(props) => (
                      <Input
                        {...props}
                        {...form.register(`columns.${index}.value`)}
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
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
