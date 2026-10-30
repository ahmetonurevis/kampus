import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ReactNode } from 'react'
import {
  Controller,
  useForm,
  useWatch,
  type FieldError,
  type FieldErrors,
  type FieldValues,
  type Resolver,
} from 'react-hook-form'
import type { z } from 'zod'
import { useWorkflowCommand } from '@kampus/react-shared/use-workflow-command.ts'
import { requireWorkflowCommand } from '@kampus/react-shared/workflow-commands.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import type { Session as CoreSession } from '@kampus/school-core/lib/domain.ts'
import { workflowSchemas } from '@kampus/school-core/lib/school-workflows.ts'
import {
  normalizeWorkflowInput,
  workflowForm,
  type FormValues,
  type WorkflowAction,
  type WorkflowField,
} from '@kampus/school-core/lib/workflow-presentation.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldError as FieldErrorText, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { dependentResets, formDefaults, formPreview } from './workflow-state.ts'

/** Kısa form sağ panelde, uzun form geniş pencerede (Vue: 6 alandan fazlası geniş). */
const SHORT_FORM_FIELDS = 6
const FORM_ID = 'is-akisi-formu'

type Props = {
  action: WorkflowAction | null
  state: State
  session: CoreSession
  /** Konu kaydın okunan sürümü (If-Match); oluşturmada yok. */
  version: number | undefined
  onClose: () => void
}

/**
 * İş akışı formu (Vue `SchoolWorkflows.vue`): alanlar core `workflowForm(...).fields(values)`'tan,
 * doğrulama core Zod şemasıyla (`zodResolver`, normalize edilmiş girdi). İki adım: "Kontrol et"
 * önizlemeyi açar, "Onayla ve kaydet" `useWorkflowCommand` ile gönderir. Sunucu alan hatası
 * gelirse düzenleme adımına dönülür ve hata alanın altına yazılır.
 */
export function WorkflowFormPanel({ action, state, session, version, onClose }: Props) {
  if (!action) return null
  const definition = workflowForm(state, session, action.command, action.recordId, action.initial)
  const count = definition.fields(definition.initial).length
  const body = (
    <WorkflowForm
      key={`${action.command}:${action.recordId ?? ''}`}
      action={action}
      state={state}
      session={session}
      version={version}
      onClose={onClose}
    />
  )
  const onOpenChange = (open: boolean) => (open ? undefined : onClose())
  return count > SHORT_FORM_FIELDS ? (
    <Modal open onOpenChange={onOpenChange} title={definition.title} size="wide">
      {body}
    </Modal>
  ) : (
    <SidePanel open onOpenChange={onOpenChange} title={definition.title}>
      {body}
    </SidePanel>
  )
}

type FormProps = Omit<Props, 'action'> & { action: WorkflowAction }

function WorkflowForm({ action, state, session, version, onClose }: FormProps) {
  const command = requireWorkflowCommand(action.command)
  const definition = workflowForm(state, session, command, action.recordId, action.initial)
  const [reviewing, setReviewing] = useState(false)
  const run = useWorkflowCommand(command)
  const schemas: Readonly<Record<string, z.ZodType<FieldValues, FieldValues>>> = workflowSchemas
  // Şeması olmayan komut (onay/arşiv gibi alansız işlemler) girdiyi olduğu gibi gönderir.
  const schema = Object.hasOwn(schemas, command) ? schemas[command] : undefined
  // Çözücü core'un normalize ettiği girdiyi (tarih-saat → ISO) doğrular; `raw` ile sunucuya
  // dönüştürülmemiş değer gider, şemayı sunucu yeniden uygular (`list` iki kez dönüşmez).
  const resolver: Resolver<FormValues> = async (values, context, options) => {
    const input = normalizeWorkflowInput(definition, values)
    if (!schema) return { values: input, errors: {} }
    return zodResolver(schema, undefined, { raw: true })(input, context, options)
  }
  const form = useForm<FormValues>({
    resolver,
    defaultValues: formDefaults(definition.fields, definition.initial),
  })
  const values = useWatch({ control: form.control }) as FormValues
  const fields = definition.fields(values)
  const busy = run.isPending || form.formState.isSubmitting

  const onSubmit = form.handleSubmit(async (input) => {
    if (!reviewing) {
      setReviewing(true)
      return
    }
    const outcome = await run.submit(
      {
        recordId: action.recordId,
        version,
        childId: session.role === 'veli' ? session.childId : undefined,
        body: input,
      },
      { setError: form.setError },
    )
    if (outcome.status === 'success') {
      notify.success(`${definition.title}: işlem kaydedildi.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.issues?.length) setReviewing(false)
  })

  function change(field: WorkflowField, value: unknown) {
    for (const [key, next] of dependentResets(form.getValues(), field.key, value))
      form.setValue(key, next)
    setReviewing(false)
  }

  const rootError = form.formState.errors.root?.server
  return (
    <form id={FORM_ID} noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-5">
      {definition.hint ? <p className="text-sm text-muted-foreground">{definition.hint}</p> : null}
      {reviewing ? (
        <section aria-labelledby="is-akisi-onizleme" className="grid gap-3">
          <h3 id="is-akisi-onizleme" className="text-base font-semibold">
            Kaydetmeden önce kontrol edin
          </h3>
          <dl className="grid gap-2 text-sm">
            {formPreview(fields, values).map((line) => (
              <div key={line.key} className="grid gap-0.5">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="font-medium whitespace-pre-line">{line.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div
              key={field.key}
              className={field.type === 'textarea' || field.type === 'multi' ? 'sm:col-span-2' : ''}
            >
              <FieldControl
                field={field}
                form={form}
                disabled={busy}
                error={fieldError(form.formState.errors, field.key)}
                onChange={(value) => change(field, value)}
              />
            </div>
          ))}
        </div>
      )}
      {rootError?.message ? (
        <p role="alert" className="text-sm text-danger">
          {rootError.message}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Vazgeç
        </Button>
        {reviewing ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setReviewing(false)}
            disabled={busy}
          >
            Düzenlemeye dön
          </Button>
        ) : null}
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          <Icon name={reviewing ? 'CircleCheck' : 'Eye'} size={17} aria-hidden="true" />
          {reviewing ? (busy ? 'Kaydediliyor…' : 'Onayla ve kaydet') : 'Kontrol et'}
        </Button>
      </div>
    </form>
  )
}

/** `marks.s1` gibi noktalı alan adının hatası (react-hook-form iç içe tutar). */
function fieldError(errors: FieldErrors<FormValues>, key: string): FieldError | undefined {
  let current: unknown = errors
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'object' && current !== null && 'message' in current
    ? (current as FieldError)
    : undefined
}

type ControlProps = {
  field: WorkflowField
  form: ReturnType<typeof useForm<FormValues>>
  disabled: boolean
  error: FieldError | undefined
  onChange: (value: unknown) => void
}

function FieldControl({ field, form, disabled, error, onChange }: ControlProps): ReactNode {
  const id = `is-akisi-${field.key.replace('.', '-')}`
  const options = field.options ?? []
  if (field.type === 'multi')
    return (
      <Controller
        control={form.control}
        name={field.key}
        render={({ field: control }) => {
          const selected: unknown[] = Array.isArray(control.value) ? control.value : []
          return (
            <FieldSet>
              <FieldLegend variant="label">{field.label}</FieldLegend>
              <div className="grid gap-2 sm:grid-cols-2">
                {options.map((option) => (
                  <label key={option.value} className="flex min-h-6 items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.includes(option.value)}
                      disabled={disabled}
                      onCheckedChange={(checked) => {
                        const next = checked
                          ? [...selected, option.value]
                          : selected.filter((value) => value !== option.value)
                        control.onChange(next)
                        onChange(next)
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <FieldErrorText errors={error ? [error] : undefined} />
            </FieldSet>
          )
        }}
      />
    )
  if (field.type === 'checkbox')
    return (
      <Controller
        control={form.control}
        name={field.key}
        render={({ field: control }) => (
          <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <Checkbox
              id={id}
              checked={control.value === true}
              disabled={disabled}
              onCheckedChange={(checked) => {
                control.onChange(checked === true)
                onChange(checked === true)
              }}
            />
            {field.label}
          </label>
        )}
      />
    )
  const registered = form.register(field.key, {
    onChange: (event: { target: { value: unknown } }) => onChange(event.target.value),
  })
  return (
    <FormField
      id={id}
      label={field.label}
      error={error}
      {...(field.hint ? { description: field.hint } : {})}
    >
      {(control) =>
        field.type === 'select' ? (
          <NativeSelect {...control} {...registered} disabled={disabled}>
            {options.some((option) => option.value === '') ? null : (
              <NativeSelectOption value="">Seçin</NativeSelectOption>
            )}
            {options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : field.type === 'textarea' ? (
          <Textarea
            {...control}
            {...registered}
            rows={4}
            maxLength={field.maxLength ?? 2000}
            disabled={disabled}
          />
        ) : (
          <Input
            {...control}
            {...registered}
            type={field.type === 'datetime' ? 'datetime-local' : field.type}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            disabled={disabled}
          />
        )
      }
    </FormField>
  )
}
