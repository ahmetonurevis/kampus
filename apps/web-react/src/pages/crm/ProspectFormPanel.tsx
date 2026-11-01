import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { PROSPECT_SOURCES } from '@kampus/school-core/lib/prospects.ts'
import {
  emptyProspectForm,
  prospectFormSchema,
  prospectFormToBody,
  REFERRAL_SOURCE,
  type ProspectFormValues,
} from '@kampus/school-core/lib/prospect-form.ts'
import { useCreateProspect } from '@kampus/react-shared/use-prospect-commands.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'

const SHARED_CONTACT = 'prospect_contact_shared'
const FIELDS: readonly (keyof ProspectFormValues)[] = [
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
  'privacyShown',
]

/**
 * Yeni aday (DOM-KAY-002, -003, -004, -007, -009, -031): kısa form sağ panelde. Kimlik no, doğum
 * tarihi ve adres aday aşamasında alınmaz. Telefonu başka adayla paylaşan farklı addaki kişi için
 * sunucu kardeş seçimi ister; seçim alanı o zaman açılır.
 */
export function ProspectFormPanel({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Yeni aday öğrenci"
    >
      {open ? <ProspectForm onCreated={onCreated} /> : null}
    </SidePanel>
  )
}

function ProspectForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { session } = useAuth()
  const institutionType = session?.institution.type ?? 'school'
  const branches = useCoreAll('branches')
  const create = useCreateProspect()
  const [sharedContact, setSharedContact] = useState(false)
  const form = useForm<ProspectFormValues>({
    resolver: zodResolver(prospectFormSchema),
    defaultValues: emptyProspectForm(),
  })
  const source = useWatch({ control: form.control, name: 'source' })
  const minor = useWatch({ control: form.control, name: 'minor' })
  const phone = useWatch({ control: form.control, name: 'phone' })
  const isReferral = source === REFERRAL_SOURCE
  const students = useCoreAll('students', {}, { enabled: isReferral })
  const prospects = useCoreAll('prospects', {}, { enabled: sharedContact })
  const busy = create.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(prospectFormToBody(values, institutionType), {
      setError: (name, error) => {
        const field = FIELDS.find((item) => item === name)
        if (field) form.setError(field, error)
        else form.setError('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success('Yeni aday kaydı oluşturuldu.')
      const created = outcome.data.data.entity
      if (created) onCreated(created.id)
    } else if (outcome.status === 'failed' && outcome.error.code === SHARED_CONTACT)
      setSharedContact(true)
  })

  if (branches.error)
    return <QueryError error={branches.error} onRetry={() => void branches.refetch()} />
  if (!branches.data) return <SummaryLoading />
  const campuses = branches.data.filter((row) => row.record.isActive !== false)
  const siblings = (prospects.data ?? []).filter((row) => row.record.phone === phone)

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
      <FormField id="aday-ad" label="Ad soyad" error={errors.name}>
        {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
      </FormField>
      <FormField id="aday-telefon" label="Telefon" error={errors.phone}>
        {(control) => (
          <Input
            {...control}
            {...form.register('phone')}
            inputMode="tel"
            placeholder="05XXXXXXXXX"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="aday-eposta" label="E-posta (isteğe bağlı)" error={errors.email}>
        {(control) => (
          <Input {...control} {...form.register('email')} type="email" disabled={busy} />
        )}
      </FormField>
      <FormField id="aday-kampus" label="Kampüs" error={errors.branchId}>
        {(control) => (
          <NativeSelect {...control} {...form.register('branchId')} disabled={busy}>
            <NativeSelectOption value="">Kampüs seçin</NativeSelectOption>
            {campuses.map((row) => (
              <NativeSelectOption key={row.id} value={row.id}>
                {row.record.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="aday-program" label="İlgilendiği program" error={errors.interest}>
        {(control) => <Input {...control} {...form.register('interest')} disabled={busy} />}
      </FormField>
      <FormField id="aday-kaynak" label="Başvuru kaynağı" error={errors.source}>
        {(control) => (
          <NativeSelect {...control} {...form.register('source')} disabled={busy}>
            {PROSPECT_SOURCES.map((item) => (
              <NativeSelectOption key={item} value={item}>
                {item}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {isReferral ? (
        <FormField
          id="aday-referans"
          label="Referans veren öğrenci"
          error={errors.referrerStudentId}
        >
          {(control) => (
            <NativeSelect {...control} {...form.register('referrerStudentId')} disabled={busy}>
              <NativeSelectOption value="">Öğrenci seçin</NativeSelectOption>
              {(students.data ?? []).map((row) => (
                <NativeSelectOption key={row.id} value={row.id}>
                  {row.record.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {institutionType === 'language_school' ? (
        <FormField id="aday-yas" label="Yaş grubu" error={errors.minor}>
          {(control) => (
            <NativeSelect {...control} {...form.register('minor')} disabled={busy}>
              <NativeSelectOption value="yes">18 yaşından küçük</NativeSelectOption>
              <NativeSelectOption value="no">18 yaş ve üstü</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {minor === 'yes' ? (
        <FormField id="aday-veli" label="Veli adı soyadı" error={errors.guardianName}>
          {(control) => <Input {...control} {...form.register('guardianName')} disabled={busy} />}
        </FormField>
      ) : null}
      {sharedContact ? (
        <FormField
          id="aday-kardes"
          label="Kardeş aday"
          error={errors.siblingOfId}
          description="Bu telefon başka bir adayda kayıtlı. Kardeşse seçin."
        >
          {(control) => (
            <NativeSelect {...control} {...form.register('siblingOfId')} disabled={busy}>
              <NativeSelectOption value="">Aday seçin</NativeSelectOption>
              {siblings.map((row) => (
                <NativeSelectOption key={row.id} value={row.id}>
                  {row.record.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      <fieldset className="grid gap-2 text-sm" disabled={busy}>
        <legend className="mb-1 font-medium">Ticari ileti onayı (isteğe bağlı)</legend>
        <label className="flex min-h-6 items-center gap-2">
          <input type="checkbox" className="size-4" {...form.register('consentSms')} />
          SMS
        </label>
        <label className="flex min-h-6 items-center gap-2">
          <input type="checkbox" className="size-4" {...form.register('consentEmail')} />
          E-posta
        </label>
        <label className="flex min-h-6 items-center gap-2">
          <input type="checkbox" className="size-4" {...form.register('consentCall')} />
          Telefon araması
        </label>
      </fieldset>
      <div className="grid gap-1 text-sm">
        <label className="flex min-h-6 items-center gap-2 font-medium">
          <input
            type="checkbox"
            className="size-4"
            aria-invalid={Boolean(errors.privacyShown)}
            disabled={busy}
            {...form.register('privacyShown')}
          />
          Aydınlatma metni adaya gösterildi
        </label>
        {errors.privacyShown?.message ? (
          <p role="alert" className="text-danger">
            {errors.privacyShown.message}
          </p>
        ) : null}
      </div>
      {errors.root?.server?.message ? (
        <p role="alert" className="text-sm text-danger">
          {errors.root.server.message}
        </p>
      ) : null}
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        Adayı kaydet
      </Button>
    </form>
  )
}
