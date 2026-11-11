import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { branchSchema } from '@kampus/school-core/lib/school-management.ts'
import { useSaveBranch } from '@kampus/react-shared/use-management-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useCoreItem, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import {
  ConflictNotice,
  errorRoutes,
  FormActions,
  isVersionConflict,
  RootError,
  useEditConflict,
  useFocusAfterSubmit,
} from './FormParts.tsx'
import { BRANCH_ERROR_FIELDS, branchDefaults, type BranchFormValues } from './management-forms.ts'
import { SummaryLoading } from './SummaryParts.tsx'

const BRANCH_ROUTES = errorRoutes(BRANCH_ERROR_FIELDS)

type Branch = CoreRecord<'branches'>
type BranchOutput = z.output<typeof branchSchema>

/** `?kampus-form=` değeri: yeni kayıt. */
export const NEW_RECORD = 'yeni'

type PanelProps = {
  /** `''` kapalı, `yeni` oluşturma, aksi hâlde düzenlenen kampüsün kimliği. */
  target: string
  onClose: () => void
}

/**
 * Kampüs ekle/düzenle (Vue "Kampüs" formu): kısa form sağ panelde açılır. Düzenlemede `If-Match`
 * kaydın okunan sürümüdür; başka biri değiştirdiyse güncel kayıt yüklenmeden kayıt gönderilmez.
 * Aktif kampüs adı tekildir (`branch_name_taken` ad alanının altında).
 */
export function CampusFormPanel({ target, onClose }: PanelProps) {
  const creating = target === NEW_RECORD
  return (
    <SidePanel
      open={target !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={creating ? 'Kampüs ekle' : 'Kampüsü düzenle'}
    >
      {creating ? <CampusForm onClose={onClose} /> : null}
      {target !== '' && !creating ? <CampusEdit campusId={target} onClose={onClose} /> : null}
    </SidePanel>
  )
}

function CampusEdit({ campusId, onClose }: { campusId: string; onClose: () => void }) {
  const item = useCoreItem('branches', campusId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  if (!item.data.record.isActive)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Arşivdeki kampüs düzenlenemez. Önce arşivden geri alın.
      </p>
    )
  return (
    <CampusForm
      record={item.data.record}
      version={item.data.version}
      reload={async () => {
        const fresh = (await item.refetch()).data
        return fresh ? { version: fresh.version, values: branchDefaults(fresh.record) } : null
      }}
      onClose={onClose}
    />
  )
}

type FormProps = {
  record?: Branch
  version?: number
  reload?: () => Promise<{ version: number; values: BranchFormValues } | null>
  onClose: () => void
}

function CampusForm({ record, version = 0, reload, onClose }: FormProps) {
  const save = useSaveBranch()
  const form = useForm<BranchFormValues, unknown, BranchOutput>({
    resolver: zodResolver(branchSchema),
    defaultValues: branchDefaults(record),
  })
  const conflict = useEditConflict<BranchFormValues>({
    initialVersion: version,
    reload: async () => (reload ? reload() : null),
    apply: (values) => form.reset(values),
  })
  const busy = save.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await save.submit(
      record ? { recordId: record.id, version: conflict.version, body: values } : { body: values },
      { setError: form.setError, ...BRANCH_ROUTES },
    )
    if (outcome.status === 'success') {
      notify.success(record ? 'Kampüs güncellendi.' : 'Kampüs eklendi.')
      onClose()
    } else if (outcome.status === 'failed') {
      if (isVersionConflict(outcome.error)) conflict.markConflict()
      focusAfterSubmit(BRANCH_ROUTES.fieldFor(outcome.error))
    }
  })

  return (
    <form
      noValidate
      aria-label={record ? 'Kampüsü düzenle' : 'Kampüs ekle'}
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-5"
    >
      {conflict.conflicted ? (
        <ConflictNotice
          onReload={() => void conflict.reloadRecord()}
          reloading={conflict.reloading}
        />
      ) : null}
      <p className="text-sm text-muted-foreground">Bu formdaki tüm alanlar zorunludur.</p>
      <FormField id="kampus-ad" label="Kampüs adı" error={errors.name}>
        {(control) => (
          <Input
            {...control}
            {...form.register('name')}
            maxLength={80}
            placeholder="Örn. Çamlıca Kampüsü"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="kampus-adres" label="Adres" error={errors.address}>
        {(control) => (
          <Textarea
            {...control}
            {...form.register('address')}
            rows={3}
            maxLength={240}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} disabled={conflict.conflicted} onCancel={onClose} />
    </form>
  )
}
