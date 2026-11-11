import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import type { z } from 'zod'
import { useCreateProspect } from '@kampus/react-shared/use-prospect-commands.ts'
import {
  OPEN_PROSPECT_STAGES,
  PROSPECT_SOURCES,
  prospectAgeGroupRequired,
  prospectStageLabel,
} from '@kampus/school-core/lib/prospects.ts'
import { learnerWords } from '@kampus/school-core/lib/enrollment-learner.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError, useFocusAfterSubmit } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  createBody,
  createDefaults,
  createFormSchema,
  fieldErrors,
  isDuplicateCode,
  isMinor,
  PRIVACY_NOTICE_TEXT,
  REFERRAL_SOURCE,
  type CreateFormValues,
} from './prospect-forms.ts'
import { CONTACT_LABELS } from './prospect-rows.ts'

type Output = z.output<ReturnType<typeof createFormSchema>>
const FIELDS = [
  'name',
  'phone',
  'email',
  'branchId',
  'interest',
  'source',
  'referrerStudentId',
  'minor',
  'guardianName',
  'siblingOfId',
  'emailConsent',
  'noticeShown',
] as const

/** `?aday-form=` değeri: yeni aday. */
export const NEW_PROSPECT = 'yeni'

/**
 * Aday ekleme (Vue "Yeni aday ekle", DOM-KAY-009): kısa form sağ panelde açılır. Aday `Yeni aday`
 * aşamasında başlar; mükerrer ret (`prospect_duplicate`, `prospect_contact_shared`) alanın altında
 * görünür ve eşleşen adayı göstermez (DOM-KAY-002, DOM-KAY-031). İletişimi paylaşan farklı adlı aday
 * için kardeş seçimi ancak bu ret görülünce açılır ve ön büro kardeşi kendisi seçer.
 */
export function ProspectFormPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Yeni aday ekle"
    >
      {open ? <FormLoader onClose={onClose} /> : null}
    </SidePanel>
  )
}

function FormLoader({ onClose }: { onClose: () => void }) {
  const { session } = useAuth()
  const branches = useCoreAll('branches')
  if (branches.error)
    return <QueryError error={branches.error} onRetry={() => void branches.refetch()} />
  if (!branches.data || !session) return <SummaryLoading />
  const active = branches.data.filter((item) => item.record.isActive)
  if (active.length === 0)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Aday eklemek için önce bir kampüs tanımlanmalı.
      </p>
    )
  return (
    <ProspectForm
      type={session.institution.type}
      branches={active.map((item) => ({ id: item.record.id, name: item.record.name }))}
      onClose={onClose}
    />
  )
}

function CheckRow({
  id,
  label,
  checked,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled: boolean
  invalid?: boolean
  describedBy?: string | undefined
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  )
}

function ProspectForm({
  type,
  branches,
  onClose,
}: {
  type: InstitutionType
  branches: readonly { id: string; name: string }[]
  onClose: () => void
}) {
  const create = useCreateProspect()
  const learner = learnerWords(type)
  const schema = useMemo(() => createFormSchema(type), [type])
  const form = useForm<CreateFormValues, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: createDefaults(branches[0]?.id ?? ''),
  })
  // Kardeş seçimi yalnız iletişimi paylaşan aday reddi görülünce sorulur (DOM-KAY-031).
  const [askSibling, setAskSibling] = useState(false)
  const source = useWatch({ control: form.control, name: 'source' })
  const minorValue = useWatch({ control: form.control, name: 'minor' })
  const minor = isMinor(minorValue, type)
  const students = useCoreAll('students', {}, { enabled: source === REFERRAL_SOURCE })
  const open = useCoreAll(
    'prospects',
    { filters: { stage: [...OPEN_PROSPECT_STAGES] } },
    { enabled: askSibling },
  )
  const busy = create.isPending || form.formState.isSubmitting
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(createBody(values, type), {
      setError: fieldErrors(FIELDS, form.setError, focusAfterSubmit),
    })
    if (outcome.status === 'success') {
      notify.success('Aday eklendi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'prospect_contact_shared') {
      setAskSibling(true)
    } else if (outcome.status === 'failed' && isDuplicateCode(outcome.error.code)) {
      focusAfterSubmit('phone')
    }
  })

  return (
    <form
      noValidate
      aria-label="Yeni aday ekle"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      <p className="text-sm text-muted-foreground">
        Aday en az veriyle açılır; T.C. kimlik no, doğum tarihi ve adres kesin kayıtta istenir.
      </p>
      <FormField id="aday-ad" label="Aday adı soyadı" error={errors.name}>
        {(control) => (
          <Input {...control} {...form.register('name')} maxLength={80} disabled={busy} />
        )}
      </FormField>
      {prospectAgeGroupRequired(type) ? (
        <FormField id="aday-yas" label="Yaş grubu" error={errors.minor}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('minor')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Seçin</NativeSelectOption>
              <NativeSelectOption value="no">18 yaş ve üzeri</NativeSelectOption>
              <NativeSelectOption value="yes">18 yaş altı</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {minor ? (
        <FormField
          id="aday-veli"
          label="Veli adı soyadı"
          description="18 yaş altı adayda telefon ve e-posta velinindir."
          error={errors.guardianName}
        >
          {(control) => (
            <Input {...control} {...form.register('guardianName')} maxLength={80} disabled={busy} />
          )}
        </FormField>
      ) : null}
      <FormField
        id="aday-telefon"
        label={minor ? CONTACT_LABELS.guardian.phone : CONTACT_LABELS.self.phone}
        description="05XXXXXXXXX biçiminde."
        error={errors.phone}
      >
        {(control) => (
          <Input
            {...control}
            {...form.register('phone')}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="aday-eposta"
        label={`${minor ? CONTACT_LABELS.guardian.email : CONTACT_LABELS.self.email} (isteğe bağlı)`}
        error={errors.email}
      >
        {(control) => (
          <Input
            {...control}
            {...form.register('email')}
            type="email"
            autoComplete="off"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="aday-kampus" label="Kampüs" error={errors.branchId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('branchId')}
            className="w-full"
            disabled={busy}
          >
            {branches.map((branch) => (
              <NativeSelectOption key={branch.id} value={branch.id}>
                {branch.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="aday-ilgi"
        label={type === 'language_school' ? 'Hedef seviye ve program' : 'İlgilendiği program'}
        error={errors.interest}
      >
        {(control) => (
          <Input
            {...control}
            {...form.register('interest')}
            maxLength={200}
            placeholder={type === 'language_school' ? 'Örn. B1 · Genel İngilizce' : 'Örn. 7. Sınıf'}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="aday-kaynak" label="Kaynak" error={errors.source}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('source')}
            className="w-full"
            disabled={busy}
          >
            {PROSPECT_SOURCES.map((item) => (
              <NativeSelectOption key={item} value={item}>
                {item}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {source === REFERRAL_SOURCE ? (
        <FormField
          id="aday-referans"
          label={`Referans veren ${learner.noun}`}
          error={errors.referrerStudentId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('referrerStudentId')}
              className="w-full"
              disabled={busy || !students.data}
            >
              <NativeSelectOption value="">
                {students.data ? `${learner.title} seçin` : `${learner.title}ler yükleniyor…`}
              </NativeSelectOption>
              {students.data
                ?.filter((item) => item.record.isActive)
                .map((item) => (
                  <NativeSelectOption key={item.record.id} value={item.record.id}>
                    {item.record.name}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {askSibling ? (
        <FormField
          id="aday-kardes"
          label="Kardeş aday"
          description="Bu iletişim bilgisi başka bir adayda kayıtlı. Kardeşse, kardeşini listeden kendiniz seçin."
          error={errors.siblingOfId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('siblingOfId')}
              className="w-full"
              disabled={busy || !open.data}
            >
              <NativeSelectOption value="">
                {open.data ? 'Kardeş adayı seçin' : 'Adaylar yükleniyor…'}
              </NativeSelectOption>
              {open.data?.map((item) => (
                <NativeSelectOption key={item.record.id} value={item.record.id}>
                  {item.record.name} · {prospectStageLabel(item.record.stage, type)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      <FieldSet className="gap-2">
        <FieldLegend variant="label" className="mb-0">
          Ticari ileti onayı (isteğe bağlı)
        </FieldLegend>
        <p className="text-xs text-muted-foreground">
          Onay verilmezse yalnız randevu ve kayıt bilgilendirmesi gönderilir.
        </p>
        {(
          [
            ['sms', 'aday-onay-sms', 'SMS'],
            ['emailConsent', 'aday-onay-eposta', 'E-posta'],
            ['call', 'aday-onay-arama', 'Arama'],
          ] as const
        ).map(([name, id, label]) => (
          <Controller
            key={name}
            name={name}
            control={form.control}
            render={({ field }) => (
              <CheckRow
                id={id}
                label={label}
                checked={field.value}
                onChange={field.onChange}
                disabled={busy}
                invalid={name === 'emailConsent' && Boolean(errors.emailConsent)}
                describedBy={
                  name === 'emailConsent' && errors.emailConsent
                    ? 'aday-onay-eposta-hata'
                    : undefined
                }
              />
            )}
          />
        ))}
        <Field data-invalid={Boolean(errors.emailConsent)}>
          <FieldError
            id="aday-onay-eposta-hata"
            errors={errors.emailConsent ? [errors.emailConsent] : undefined}
          />
        </Field>
      </FieldSet>
      <FieldSet className="gap-2">
        <FieldLegend variant="label" className="mb-0">
          Aydınlatma metni
        </FieldLegend>
        <p className="text-sm text-muted-foreground">{PRIVACY_NOTICE_TEXT}</p>
        <Controller
          name="noticeShown"
          control={form.control}
          render={({ field }) => (
            <CheckRow
              id="aday-aydinlatma"
              label="Aydınlatma metni adaya gösterildi"
              checked={field.value}
              onChange={field.onChange}
              disabled={busy}
              invalid={Boolean(errors.noticeShown)}
              describedBy={errors.noticeShown ? 'aday-aydinlatma-hata' : undefined}
            />
          )}
        />
        <Field data-invalid={Boolean(errors.noticeShown)}>
          <FieldError
            id="aday-aydinlatma-hata"
            errors={errors.noticeShown ? [errors.noticeShown] : undefined}
          />
        </Field>
      </FieldSet>
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onClose} submitLabel="Adayı ekle" />
    </form>
  )
}
