import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCreateStakeholder,
  useCreateStakeholderAgreement,
  useTerminateStakeholderAgreement,
  useUpdateStakeholder,
  useUpdateStakeholderAgreement,
  type AgreementDetail,
  type StakeholderDetail,
} from '@kampus/react-shared/use-finance-stakeholders.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  AGREEMENT_BENEFIT_LABELS,
  AGREEMENT_BENEFITS,
  CONTRIBUTION_TYPE_LABELS,
  CONTRIBUTION_TYPES,
  STAKEHOLDER_TYPE_LABELS,
  STAKEHOLDER_TYPES,
} from '@kampus/school-core/lib/finance-stakeholders.ts'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  agreementBody,
  agreementChanges,
  agreementDefaults,
  agreementFormField,
  agreementFormSchema,
  stakeholderBody,
  stakeholderChanges,
  stakeholderDefaults,
  stakeholderFormField,
  stakeholderFormSchema,
  terminateFormSchema,
  type AgreementFormValues,
  type StakeholderFormValues,
  type TerminateFormValues,
} from './finance-stakeholder-forms.ts'

const STAKEHOLDER_FORM = 'paydas-formu'
const AGREEMENT_FORM = 'anlasma-formu'

/**
 * Paydaş kaydı ve düzeltmesi (DOM-FIN-102, K-316). VKN isteğe bağlıdır, verilmişse kontrol hanesi
 * tarayıcıda da denetlenir; tekillik sunucudadır. İletişim kişisi listede maskeli görünür (K-317).
 */
export function StakeholderFormModal({
  stakeholder,
  onClose,
  onSaved,
}: {
  stakeholder?: StakeholderDetail
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const create = useCreateStakeholder()
  const update = useUpdateStakeholder()
  const form = useForm<StakeholderFormValues>({
    resolver: zodResolver(stakeholderFormSchema),
    defaultValues: stakeholderDefaults(stakeholder),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = stakeholderFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (stakeholder) {
      const body = stakeholderChanges(values, stakeholder)
      if (Object.keys(body).length === 0) {
        onClose()
        return
      }
      const outcome = await update.submit(
        { stakeholderId: stakeholder.id, version: stakeholder.version, body },
        fields,
      )
      if (outcome.status === 'success') {
        notify.success('Paydaş bilgileri güncellendi.')
        onClose()
      } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
      return
    }
    const outcome = await create.submit(stakeholderBody(values), fields)
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.name} eklendi.`)
      if (onSaved) onSaved(outcome.data.data.id)
      else onClose()
    }
  })
  const title = stakeholder ? 'Paydaşı düzenle' : 'Yeni paydaş'
  const text = (
    id: string,
    label: string,
    name: 'name' | 'taxNumber' | 'contactName' | 'contactEmail' | 'contactPhone' | 'tags',
    extra: { inputMode?: 'numeric' | 'email' | 'tel'; description?: string } = {},
  ) => (
    <FormField id={id} label={label} error={errors[name]} description={extra.description}>
      {(control) => (
        <Input
          {...control}
          {...form.register(name)}
          {...(extra.inputMode ? { inputMode: extra.inputMode } : {})}
          disabled={busy}
        />
      )}
    </FormField>
  )
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="İletişim kişisinin e-postası ve telefonu listede maskeli gösterilir."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form={STAKEHOLDER_FORM}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={STAKEHOLDER_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        {text('paydas-ad', 'Kurum adı', 'name')}
        <FormField id="paydas-tur" label="Tür" error={errors.type}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('type')}
              className="w-full"
              disabled={busy}
            >
              {STAKEHOLDER_TYPES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {STAKEHOLDER_TYPE_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {text('paydas-vkn', 'VKN (isteğe bağlı)', 'taxNumber', {
          inputMode: 'numeric',
          description: '10 haneli vergi kimlik numarası.',
        })}
        {text('paydas-etiketler', 'Etiketler (isteğe bağlı)', 'tags', {
          description: 'Virgülle ayırın; en çok 10 etiket (ör. bahar şenliği, bilim).',
        })}
        {text('paydas-iletisim-ad', 'İletişim kişisi (isteğe bağlı)', 'contactName')}
        {text('paydas-iletisim-telefon', 'Telefon (isteğe bağlı)', 'contactPhone', {
          inputMode: 'tel',
          description: '0 ile başlayan 11 hane.',
        })}
        {text('paydas-iletisim-eposta', 'E-posta (isteğe bağlı)', 'contactEmail', {
          inputMode: 'email',
        })}
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

/**
 * Anlaşma açma ve düzeltme (DOM-FIN-102, K-318). Katkı nakdi ise tutar, ayni ya da hizmet ise
 * açıklama zorunludur; sözleşme dosyası PDF olarak yüklenir ve kayıtla bağlanır. Yeni anlaşma
 * taslak açılır; yürürlüğe alma panelden yapılır.
 */
export function AgreementFormModal({
  stakeholderId,
  agreement,
  onClose,
  onSaved,
}: {
  stakeholderId: string
  agreement?: AgreementDetail
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const today = dayKey()
  const create = useCreateStakeholderAgreement()
  const update = useUpdateStakeholderAgreement()
  const form = useForm<AgreementFormValues>({
    resolver: zodResolver(agreementFormSchema),
    defaultValues: agreementDefaults(today, agreement),
  })
  const [files, setFiles] = useState<readonly FileUploadItem[]>(
    agreement?.contractFile
      ? [{ id: agreement.contractFile.id, name: agreement.contractFile.name }]
      : [],
  )
  const [uploading, setUploading] = useState(false)
  const [scanBlocked, setScanBlocked] = useState(false)
  const contributionType = useWatch({ control: form.control, name: 'contributionType' })
  const saving = create.isPending || update.isPending || form.formState.isSubmitting
  const busy = saving || uploading
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = agreementFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const fileId = files[0]?.id ?? null
  const onSubmit = form.handleSubmit(async (values) => {
    if (agreement) {
      const body = agreementChanges(values, fileId, agreement, today)
      if (Object.keys(body).length === 0) {
        onClose()
        return
      }
      const outcome = await update.submit(
        { agreementId: agreement.id, version: agreement.version, body },
        fields,
      )
      if (outcome.status === 'success') {
        notify.success('Anlaşma güncellendi.')
        onClose()
      } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
      return
    }
    const outcome = await create.submit(
      { stakeholderId, body: agreementBody(values, fileId) },
      fields,
    )
    if (outcome.status === 'success') {
      notify.success('Anlaşma taslak olarak açıldı.')
      if (onSaved) onSaved(outcome.data.data.id)
      else onClose()
    }
  })
  const title = agreement ? 'Anlaşmayı düzenle' : 'Yeni anlaşma'
  const input = (
    id: string,
    label: string,
    name: 'subject' | 'startDate' | 'endDate' | 'renewalNoticeDays' | 'amount' | 'benefitNote',
    extra: { type?: 'date'; inputMode?: 'numeric' | 'decimal'; description?: string } = {},
  ) => (
    <FormField id={id} label={label} error={errors[name]} description={extra.description}>
      {(control) => (
        <Input
          {...control}
          {...form.register(name)}
          {...(extra.type ? { type: extra.type } : {})}
          {...(extra.inputMode ? { inputMode: extra.inputMode } : {})}
          disabled={saving}
        />
      )}
    </FormField>
  )
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Sponsor katkısı bağış ya da tahsilat kaydı açmaz; anlaşmada tutar olarak durur."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form={AGREEMENT_FORM}
            disabled={busy || scanBlocked}
            aria-busy={saving || undefined}
          >
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={AGREEMENT_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <div className="col-span-full">{input('anlasma-konu', 'Konu', 'subject')}</div>
        {input('anlasma-baslangic', 'Başlangıç', 'startDate', { type: 'date' })}
        {input('anlasma-bitis', 'Bitiş', 'endDate', { type: 'date' })}
        {input('anlasma-bildirim', 'Yenileme bildirimi (gün)', 'renewalNoticeDays', {
          inputMode: 'numeric',
          description: 'Bitişten kaç gün önce uyarı verilsin (0–365).',
        })}
        <FormField id="anlasma-katki-turu" label="Katkı türü" error={errors.contributionType}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('contributionType')}
              className="w-full"
              disabled={saving}
            >
              {CONTRIBUTION_TYPES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {CONTRIBUTION_TYPE_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {input(
          'anlasma-tutar',
          contributionType === 'cash' ? 'Tutar (TL)' : 'Tahmini değer (TL, isteğe bağlı)',
          'amount',
          { inputMode: 'decimal', description: '1.234,56 biçiminde.' },
        )}
        <div className="col-span-full">
          <FormField
            id="anlasma-katki-aciklama"
            label={
              contributionType === 'cash' ? 'Katkı açıklaması (isteğe bağlı)' : 'Katkı açıklaması'
            }
            error={errors.contributionDescription}
          >
            {(control) => (
              <Textarea
                {...control}
                {...form.register('contributionDescription')}
                rows={2}
                disabled={saving}
              />
            )}
          </FormField>
        </div>
        <fieldset className="col-span-full grid gap-2">
          <legend className="mb-2 text-sm font-medium">Karşılık</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {AGREEMENT_BENEFITS.map((value) => (
              <label key={value} className="inline-flex min-h-6 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  value={value}
                  className="size-4 accent-primary"
                  disabled={saving}
                  {...form.register('benefits')}
                />
                {AGREEMENT_BENEFIT_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="col-span-full">
          {input('anlasma-karsilik-not', 'Karşılık ayrıntısı (isteğe bağlı)', 'benefitNote', {
            description: 'Ör. etkinlik adı, logonun yer alacağı yerler.',
          })}
        </div>
        <div className="col-span-full">
          <FileUploadField
            id="anlasma-dosya"
            label="Sözleşme dosyası (isteğe bağlı)"
            purpose="document"
            description="İmzalı sözleşmenin PDF taraması; en çok 20 MB."
            listLabel="Sözleşme dosyası"
            items={files}
            disabled={saving}
            onUploaded={(item) => setFiles([item])}
            onRemoved={() => setFiles([])}
            onBusyChange={setUploading}
            onBlockedChange={setScanBlocked}
          />
        </div>
        <div className="col-span-full empty:hidden">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

/** Fesih formu (K-318): gün ve gerekçe; gerekçe denetim kaydına yazılmaz. */
export function TerminateAgreementForm({
  agreement,
  onDone,
}: {
  agreement: AgreementDetail
  onDone: () => void
}) {
  const terminate = useTerminateStakeholderAgreement()
  const form = useForm<TerminateFormValues>({
    resolver: zodResolver(terminateFormSchema),
    defaultValues: { terminationDate: dayKey(), reason: '' },
  })
  const errors = form.formState.errors
  const busy = terminate.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await terminate.submit(
      {
        agreementId: agreement.id,
        version: agreement.version,
        body: { terminationDate: values.terminationDate, reason: values.reason.trim() },
      },
      {
        setError: (name, error) => {
          if (name === 'terminationDate' || name === 'reason')
            form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Anlaşma feshedildi.')
      onDone()
    }
  })
  return (
    <form
      noValidate
      aria-label="Anlaşmayı feshet"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-3 rounded-lg border p-4"
    >
      <FormField id="fesih-gunu" label="Fesih günü" error={errors.terminationDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('terminationDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="fesih-gerekce" label="Fesih gerekçesi" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
          Feshi kaydet
        </Button>
      </div>
    </form>
  )
}
