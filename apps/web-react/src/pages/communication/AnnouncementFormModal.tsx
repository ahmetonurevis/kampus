import { useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import type { z } from 'zod'
import { usePublishAnnouncement } from '@kampus/react-shared/use-communication.ts'
import {
  ANNOUNCEMENT_CATEGORIES,
  publishAnnouncementSchema,
} from '@kampus/school-core/lib/communication.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import type { CoreRow } from '@/hooks/use-core-collection.ts'
import type { RoleKey } from '@/lib/navigation.ts'
import { notify } from '@/lib/notify.ts'
import { AUDIENCE_LABELS, publishCapabilities } from '@kampus/react-shared/announcement-model.ts'
import { CheckGroup } from './CheckGroup.tsx'

type FormInput = z.input<typeof publishAnnouncementSchema>
type FormOutput = z.output<typeof publishAnnouncementSchema>

const FORM_ID = 'duyuru-formu'
const NONE: readonly never[] = []

type Props = {
  open: boolean
  role: RoleKey
  institutionType: InstitutionType
  classes: readonly CoreRow<'classes'>[]
  branches: readonly CoreRow<'branches'>[]
  onClose: () => void
}

/**
 * Yeni duyuru: başlık, kategori, metin ve hedef kitle (core `publishAnnouncementSchema`;
 * kampüs, düzey, CEFR seviyesi, sınıf birleşimi × alıcı rolleri, DOM-ILT-001). Seçenekler rolün
 * yayın yetkisine göre daralır (DOM-ILT-002): öğretmen yalnız kendi sınıflarına, ön büro yalnız
 * `İdari` kategoride kurum veya kampüse yayınlar. Sunucu aynı kuralı yeniden uygular; sunucu
 * doğrulama maddeleri alanlara yazılır. Konum seçicisi boşsa duyuru bütün kuruma gider.
 */
export function AnnouncementFormModal({ open, ...props }: Props) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? undefined : props.onClose())}
      title="Yeni duyuru"
      description="Hedef kitle yayın anında alıcı listesine çözülür; sonradan sınıfa katılan öğrenci bu duyuruyu görmez."
      footer={<FormFooter onClose={props.onClose} />}
    >
      {open ? <AnnouncementForm {...props} /> : null}
    </Modal>
  )
}

function FormFooter({ onClose }: { onClose: () => void }) {
  return (
    <>
      <Button type="button" variant="secondary" onClick={onClose}>
        Vazgeç
      </Button>
      <Button type="submit" form={FORM_ID}>
        Yayınla
      </Button>
    </>
  )
}

function AnnouncementForm({
  role,
  institutionType,
  classes,
  branches,
  onClose,
}: Omit<Props, 'open'>) {
  const capabilities = publishCapabilities(role, institutionType)
  const publish = usePublishAnnouncement()
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(publishAnnouncementSchema),
    defaultValues: {
      title: '',
      text: '',
      category: capabilities.onlyCategory === 'İdari' ? 'İdari' : 'Bilgilendirme',
      target: {
        branchIds: [],
        grades: [],
        levels: [],
        classIds: [],
        roles: capabilities.audienceRoles.includes('veli') ? ['veli'] : [],
      },
    },
  })
  const errors = form.formState.errors
  const busy = publish.isPending || form.formState.isSubmitting

  const classOptions = useMemo(
    () =>
      [...classes]
        .sort((a, b) => a.record.name.localeCompare(b.record.name, 'tr', { numeric: true }))
        .map((row) => ({ value: row.record.id, label: row.record.name })),
    [classes],
  )
  const branchOptions = useMemo(
    () => branches.map((row) => ({ value: row.record.id, label: row.record.name })),
    [branches],
  )
  const gradeOptions = useMemo(
    () =>
      [...new Set(classes.map((row) => row.record.grade))]
        .sort((a, b) => a - b)
        .map((grade) => ({ value: grade, label: `${grade}. sınıf` })),
    [classes],
  )
  const levelOptions = useMemo(
    () =>
      [...new Set(classes.map((row) => row.record.level))]
        .sort((a, b) => a.localeCompare(b, 'tr', { numeric: true }))
        .map((level) => ({ value: level, label: level })),
    [classes],
  )
  const audienceOptions = capabilities.audienceRoles.map((value) => ({
    value,
    label: AUDIENCE_LABELS[value],
  }))

  const onSubmit = form.handleSubmit(async (values) => {
    // Öğretmen duyurusu yalnız sınıfa gider; sunucu da reddeder, burada alanda açıklanır.
    if (!capabilities.wholeInstitution && values.target.classIds.length === 0) {
      form.setError('target.classIds', { type: 'required', message: 'En az bir sınıf seçin.' })
      return
    }
    const outcome = await publish.submit(values, { setError: form.setError })
    if (outcome.status === 'success') {
      notify.success('Duyuru yayınlandı.')
      onClose()
    }
  })

  const rolesError = errors.target?.roles
  return (
    <form id={FORM_ID} noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-5">
      <FormField id="duyuru-baslik" label="Başlık" error={errors.title}>
        {(control) => <Input {...control} {...form.register('title')} disabled={busy} />}
      </FormField>
      <FormField id="duyuru-kategori" label="Kategori" error={errors.category}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('category')}
            disabled={busy || capabilities.onlyCategory !== null}
          >
            {ANNOUNCEMENT_CATEGORIES.map((category) => (
              <NativeSelectOption key={category} value={category}>
                {category}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {capabilities.onlyCategory ? (
        <p className="-mt-3 text-xs text-muted-foreground">
          Ön büro yalnızca idari duyuru yayınlar; kurum veya kampüs kapsamı seçilebilir.
        </p>
      ) : null}
      <FormField id="duyuru-metin" label="Duyuru metni" error={errors.text}>
        {(control) => <Textarea {...control} {...form.register('text')} rows={5} disabled={busy} />}
      </FormField>

      <div className="grid gap-5 rounded-card border bg-surface-soft p-4">
        <h3 className="text-base font-semibold">Kime gidecek</h3>
        {capabilities.branches ? (
          <Controller
            control={form.control}
            name="target.branchIds"
            render={({ field }) => (
              <CheckGroup
                legend="Kampüsler"
                hint={
                  capabilities.wholeInstitution
                    ? 'Hiçbir konum seçmezseniz duyuru bütün kuruma gider.'
                    : undefined
                }
                options={branchOptions}
                value={field.value ?? NONE}
                onChange={field.onChange}
                disabled={busy}
                error={errors.target?.branchIds?.message}
              />
            )}
          />
        ) : null}
        {capabilities.grades ? (
          <Controller
            control={form.control}
            name="target.grades"
            render={({ field }) => (
              <CheckGroup
                legend="Sınıf düzeyleri"
                options={gradeOptions}
                value={field.value ?? NONE}
                onChange={field.onChange}
                disabled={busy}
              />
            )}
          />
        ) : null}
        {capabilities.levels ? (
          <Controller
            control={form.control}
            name="target.levels"
            render={({ field }) => (
              <CheckGroup
                legend="CEFR seviyeleri"
                options={levelOptions}
                value={field.value ?? NONE}
                onChange={field.onChange}
                disabled={busy}
              />
            )}
          />
        ) : null}
        {capabilities.classes ? (
          <Controller
            control={form.control}
            name="target.classIds"
            render={({ field }) => (
              <CheckGroup
                legend="Sınıflar"
                hint={
                  capabilities.wholeInstitution
                    ? undefined
                    : 'Yalnızca ders verdiğiniz veya rehberi olduğunuz sınıflara duyuru yayınlayabilirsiniz.'
                }
                options={classOptions}
                value={field.value ?? NONE}
                onChange={field.onChange}
                disabled={busy}
                error={errors.target?.classIds?.message}
              />
            )}
          />
        ) : null}
        <Controller
          control={form.control}
          name="target.roles"
          render={({ field }) => (
            <CheckGroup
              legend="Alıcılar"
              options={audienceOptions}
              value={field.value}
              onChange={field.onChange}
              disabled={busy}
              error={rolesError?.message ?? rolesError?.root?.message}
            />
          )}
        />
      </div>
    </form>
  )
}
