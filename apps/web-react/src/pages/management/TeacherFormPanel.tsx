import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { subjects } from '@kampus/school-core/data/curriculum.ts'
import { teacherSchema } from '@kampus/school-core/lib/school-management.ts'
import { useSaveTeacher } from '@kampus/react-shared/use-management-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreItem, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { NEW_RECORD } from './CampusFormPanel.tsx'
import {
  ConflictNotice,
  errorRoutes,
  FormActions,
  isVersionConflict,
  RootError,
  useEditConflict,
  useFocusAfterSubmit,
} from './FormParts.tsx'

const TEACHER_ROUTES = errorRoutes(TEACHER_ERROR_FIELDS)
import {
  activeOf,
  TEACHER_ERROR_FIELDS,
  teacherDefaults,
  type TeacherFormValues,
} from './management-forms.ts'
import type { ManagementLookups } from './management-rows.ts'
import { SummaryLoading } from './SummaryParts.tsx'

type Teacher = CoreRecord<'teachers'>
type TeacherOutput = z.output<typeof teacherSchema>

type PanelProps = {
  /** `''` kapalı, `yeni` oluşturma, aksi hâlde düzenlenen öğretmenin kimliği. */
  target: string
  lookups: ManagementLookups
  onClose: () => void
}

/**
 * Öğretmen ekle/düzenle (Vue "Öğretmen" formu): kısa form sağ panelde. Yalnız core öğretmen
 * kaydıdır; giriş hesabı kurum üyeleri ekranındadır. Aktif e-posta tekildir; ders ataması olan
 * öğretmenin branşı değişmez (hata ilgili alanın altında).
 */
export function TeacherFormPanel({ target, lookups, onClose }: PanelProps) {
  const creating = target === NEW_RECORD
  return (
    <SidePanel
      open={target !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={creating ? 'Öğretmen ekle' : 'Öğretmeni düzenle'}
    >
      {creating ? <TeacherForm lookups={lookups} onClose={onClose} /> : null}
      {target !== '' && !creating ? (
        <TeacherEdit teacherId={target} lookups={lookups} onClose={onClose} />
      ) : null}
    </SidePanel>
  )
}

function TeacherEdit({
  teacherId,
  lookups,
  onClose,
}: Omit<PanelProps, 'target'> & { teacherId: string }) {
  const item = useCoreItem('teachers', teacherId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  if (!item.data.record.isActive)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Arşivdeki öğretmen düzenlenemez. Önce arşivden geri alın.
      </p>
    )
  return (
    <TeacherForm
      record={item.data.record}
      version={item.data.version}
      lookups={lookups}
      reload={async () => {
        const fresh = (await item.refetch()).data
        return fresh
          ? {
              version: fresh.version,
              values: teacherDefaults(fresh.record, activeOf(lookups.branches.values())),
            }
          : null
      }}
      onClose={onClose}
    />
  )
}

type FormProps = {
  record?: Teacher
  version?: number
  lookups: ManagementLookups
  reload?: () => Promise<{ version: number; values: TeacherFormValues } | null>
  onClose: () => void
}

function TeacherForm({ record, version = 0, lookups, reload, onClose }: FormProps) {
  const branches = activeOf(lookups.branches.values())
  const save = useSaveTeacher()
  const form = useForm<TeacherFormValues, unknown, TeacherOutput>({
    resolver: zodResolver(teacherSchema),
    defaultValues: teacherDefaults(record, branches),
  })
  const conflict = useEditConflict<TeacherFormValues>({
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
      { setError: form.setError, ...TEACHER_ROUTES },
    )
    if (outcome.status === 'success') {
      notify.success(record ? 'Öğretmen güncellendi.' : 'Öğretmen eklendi.')
      onClose()
    } else if (outcome.status === 'failed') {
      if (isVersionConflict(outcome.error)) conflict.markConflict()
      focusAfterSubmit(TEACHER_ROUTES.fieldFor(outcome.error))
    }
  })

  return (
    <form
      noValidate
      aria-label={record ? 'Öğretmeni düzenle' : 'Öğretmen ekle'}
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
      <FormField id="ogretmen-ad" label="Ad soyad" error={errors.name}>
        {(control) => (
          <Input {...control} {...form.register('name')} maxLength={80} disabled={busy} />
        )}
      </FormField>
      <FormField id="ogretmen-eposta" label="E-posta" error={errors.email}>
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
      <FormField id="ogretmen-telefon" label="Telefon" error={errors.phone}>
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
      <FormField id="ogretmen-brans" label="Branş" error={errors.subjectId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('subjectId')}
            className="w-full"
            disabled={busy}
          >
            {subjects.map((subject) => (
              <NativeSelectOption key={subject.id} value={subject.id}>
                {subject.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="ogretmen-kampus" label="Kampüs" error={errors.branchId}>
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
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} disabled={conflict.conflicted} onCancel={onClose} />
    </form>
  )
}
