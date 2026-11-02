import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { GROUP_REASON_MAX } from '@kampus/school-core/lib/language-groups.ts'
import type { LanguageGroup } from '@kampus/react-shared/language-groups.ts'
import {
  useAllLanguageGroups,
  useCancelLanguageGroup,
  useMergeLanguageGroup,
} from '@kampus/react-shared/use-language-groups.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { FormActions, isVersionConflict, RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  cancelFormSchema,
  mergeFormErrorField,
  mergeFormSchema,
  type CancelFormValues,
  type MergeFormValues,
} from './group-forms.ts'
import { mergeCandidates, mergeNeedsConsent, occupancyText, scheduleText } from './group-rows.ts'
import { useDiscardGuard, useReportDirty } from './use-discard-guard.tsx'

type DialogProps = { group: LanguageGroup | null; onClose: () => void }

/** Grubu gerekçeyle iptal et (kısa form). Kursiyerler grupta kalmaz; geri alınmaz. */
export function CancelGroupModal({ group, onClose }: DialogProps) {
  const guard = useDiscardGuard(onClose)
  return (
    <>
      <Modal
        open={group !== null}
        onOpenChange={(open) => (open ? undefined : guard.requestClose())}
        title="Grubu iptal et"
        description="İptal geri alınmaz; gerekçe kayda geçer."
      >
        {group ? (
          <CancelForm
            key={group.id}
            group={group}
            onCancel={guard.requestClose}
            onDone={guard.closeClean}
            setDirty={guard.setDirty}
          />
        ) : null}
      </Modal>
      {guard.dialog}
    </>
  )
}

type FormProps = {
  group: LanguageGroup
  onCancel: () => void
  onDone: () => void
  setDirty: (dirty: boolean) => void
}

function CancelForm({ group, onCancel, onDone, setDirty }: FormProps) {
  const cancel = useCancelLanguageGroup()
  const form = useForm<CancelFormValues>({
    resolver: zodResolver(cancelFormSchema),
    defaultValues: { reason: '' },
  })
  useReportDirty(form.formState.isDirty, setDirty)
  const busy = cancel.isPending || form.formState.isSubmitting
  const submit = form.handleSubmit(async (body) => {
    const outcome = await cancel.submit(
      { groupId: group.id, version: group.rowVersion ?? 0, body },
      { setError: form.setError, silent: isVersionConflict },
    )
    if (outcome.status === 'success') {
      notify.success(`${group.name} iptal edildi.`)
      onDone()
    }
  })
  return (
    <form
      noValidate
      aria-label="Grubu iptal et"
      onSubmit={(event) => void submit(event)}
      className="grid gap-5"
    >
      <p className="text-sm">
        <strong className="font-semibold">{group.name}</strong> ({group.courseName}) iptal edilecek.
      </p>
      <FormField id="grup-iptal-gerekce" label="Gerekçe" error={form.formState.errors.reason}>
        {(control) => (
          <Textarea
            {...control}
            {...form.register('reason')}
            maxLength={GROUP_REASON_MAX}
            rows={4}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={form.formState.errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onCancel} submitLabel="Grubu iptal et" />
    </form>
  )
}

/**
 * Grup birleştir (DOM-DIL-042): seçilen kaynak grubun kursiyerleri ve bekleme sırası bu gruba
 * taşınır, kaynak iptal olur. Gün ya da saat farklıysa kursiyer onayı işaretlenir
 * (`learnersConsented`); kaynağın okunan sürümü `sourceVersion` olarak gider.
 */
export function MergeGroupModal({ group, onClose }: DialogProps) {
  const guard = useDiscardGuard(onClose)
  return (
    <>
      <Modal
        open={group !== null}
        onOpenChange={(open) => (open ? undefined : guard.requestClose())}
        title="Grup birleştir"
        description="Seçilen grubun kursiyerleri bu gruba taşınır; o grup iptal olur."
      >
        {group ? (
          <MergeLoader
            key={group.id}
            group={group}
            onCancel={guard.requestClose}
            onDone={guard.closeClean}
            setDirty={guard.setDirty}
          />
        ) : null}
      </Modal>
      {guard.dialog}
    </>
  )
}

function MergeLoader(props: FormProps) {
  const groups = useAllLanguageGroups({ courseId: props.group.courseId })
  if (groups.error) return <QueryError error={groups.error} onRetry={() => void groups.refetch()} />
  if (!groups.data) return <SummaryLoading />
  const candidates = mergeCandidates(props.group, groups.data)
  if (!candidates.length)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Aynı kur ve yaş bandında birleştirilebilecek başka grup yok.
      </p>
    )
  return <MergeForm {...props} candidates={candidates} />
}

function MergeForm({
  group,
  candidates,
  onCancel,
  onDone,
  setDirty,
}: FormProps & { candidates: readonly LanguageGroup[] }) {
  const merge = useMergeLanguageGroup()
  const form = useForm<MergeFormValues>({
    resolver: zodResolver(mergeFormSchema),
    defaultValues: { sourceGroupId: '', learnersConsented: false },
  })
  useReportDirty(form.formState.isDirty, setDirty)
  const sourceId = useWatch({ control: form.control, name: 'sourceGroupId' })
  const source = candidates.find((candidate) => candidate.id === sourceId)
  const needsConsent = source !== undefined && mergeNeedsConsent(group, source)
  const busy = merge.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const submit = form.handleSubmit(async (values) => {
    const chosen = candidates.find((candidate) => candidate.id === values.sourceGroupId)
    if (!chosen) return
    const outcome = await merge.submit(
      {
        groupId: group.id,
        version: group.rowVersion ?? 0,
        body: {
          sourceGroupId: chosen.id,
          sourceVersion: chosen.rowVersion ?? 0,
          ...(mergeNeedsConsent(group, chosen)
            ? { learnersConsented: values.learnersConsented }
            : {}),
        },
      },
      { setError: form.setError, fieldFor: mergeFormErrorField, silent: isVersionConflict },
    )
    if (outcome.status === 'success') {
      notify.success(`${chosen.name}, ${group.name} grubuna birleştirildi.`)
      onDone()
    }
  })

  return (
    <form
      noValidate
      aria-label="Grup birleştir"
      onSubmit={(event) => void submit(event)}
      className="grid gap-5"
    >
      <p className="text-sm">
        Hedef: <strong className="font-semibold">{group.name}</strong> ·{' '}
        {scheduleText(group.schedule, group.sessionMinutes)} · {occupancyText(group)}
      </p>
      <FormField
        id="grup-birlestir-kaynak"
        label="Birleştirilecek grup"
        error={errors.sourceGroupId}
      >
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('sourceGroupId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Grup seçin</NativeSelectOption>
            {candidates.map((candidate) => (
              <NativeSelectOption key={candidate.id} value={candidate.id}>
                {candidate.name} · {scheduleText(candidate.schedule, candidate.sessionMinutes)} ·{' '}
                {occupancyText(candidate)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {needsConsent ? (
        <div className="grid gap-2">
          <p className="text-sm text-warning">
            Gün ya da saat farklı: taşınan kursiyerlerin programı değişir.
          </p>
          <Controller
            control={form.control}
            name="learnersConsented"
            render={({ field }) => (
              <div className="flex items-start gap-2">
                <Checkbox
                  id="grup-birlestir-onay"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  aria-invalid={Boolean(errors.learnersConsented)}
                  aria-describedby={
                    errors.learnersConsented ? 'grup-birlestir-onay-hata' : undefined
                  }
                  disabled={busy}
                />
                <Label htmlFor="grup-birlestir-onay" className="text-sm leading-snug">
                  Kursiyerlerin yeni gün ve saat için onayını aldım
                </Label>
              </div>
            )}
          />
          {errors.learnersConsented?.message ? (
            <p id="grup-birlestir-onay-hata" role="alert" className="text-sm text-danger">
              {errors.learnersConsented.message}
            </p>
          ) : null}
        </div>
      ) : null}
      <RootError message={errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onCancel} submitLabel="Birleştir" />
    </form>
  )
}
