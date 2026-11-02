import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { useRevertProspectStage } from '@kampus/react-shared/use-prospect-commands.ts'
import {
  PROSPECT_REVERT_REASON_MAX,
  prospectStageLabel,
  revertableProspectStages,
  type ProspectFields,
} from '@kampus/school-core/lib/prospects.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { FormField } from '@/components/FormField.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  fieldErrors,
  revertBody,
  revertDefaults,
  revertFormSchema,
  type RevertFormValues,
} from './prospect-forms.ts'

type Output = z.output<typeof revertFormSchema>
const FIELDS = ['stage', 'reason'] as const

/**
 * Aşamayı geri alma (DOM-KAY-030, yalnız yönetici): yanlışlıkla ileri alınan açık aşama, gerekçe
 * yazılarak bir önceki açık aşamaya döner. Yalnız geçerli hedefler sunulur (`revertableProspectStages`);
 * görüşme öncesi aşamaya dönülürken ileri tarihli görüşme ve deneme dersi kalkar. Hedef yoksa form
 * görünmez. `If-Match` kartın okunan sürümüdür.
 */
export function ProspectStageRevertForm({
  prospectId,
  version,
  prospect,
  type,
}: {
  prospectId: string
  version: number
  prospect: Pick<ProspectFields, 'trialLesson'> & { stage?: string; trialAt?: string | null }
  type: InstitutionType
}) {
  const revert = useRevertProspectStage()
  const targets = revertableProspectStages(prospect)
  const form = useForm<RevertFormValues, unknown, Output>({
    resolver: zodResolver(revertFormSchema),
    defaultValues: revertDefaults(),
  })
  const busy = revert.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  if (targets.length === 0) return null

  const onSubmit = form.handleSubmit(async (values) => {
    const result = revertBody(values)
    if (!result.ok) {
      form.setError('stage', { type: 'manual', message: result.message }, { shouldFocus: true })
      return
    }
    const outcome = await revert.submit(
      { prospectId, version, body: result.body },
      { setError: fieldErrors(FIELDS, form.setError) },
    )
    if (outcome.status === 'success') {
      notify.success('Aday aşaması geri alındı.')
      form.reset(revertDefaults())
    }
  })

  return (
    <form
      noValidate
      aria-label="Aşamayı geri al"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-4 border-t pt-4"
    >
      <p className="text-sm text-muted-foreground">
        Yanlışlıkla ileri alınan aşamayı gerekçeyle geri alabilirsiniz.
        {prospect.stage ? ` Şu anki aşama: ${prospectStageLabel(prospect.stage, type)}.` : ''}
      </p>
      <FormField id="aday-geri-asama" label="Geri alınacak aşama" error={errors.stage}>
        {(control) => (
          <NativeSelect {...control} {...form.register('stage')} className="w-full" disabled={busy}>
            <NativeSelectOption value="">Aşamayı seçin</NativeSelectOption>
            {targets.map((target) => (
              <NativeSelectOption key={target} value={target}>
                {prospectStageLabel(target, type)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="aday-geri-gerekce" label="Gerekçe" error={errors.reason}>
        {(control) => (
          <Textarea
            {...control}
            {...form.register('reason')}
            rows={2}
            maxLength={PROSPECT_REVERT_REASON_MAX}
            placeholder="Aşamanın neden geri alındığını yazın…"
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy || undefined}>
          Aşamayı geri al
        </Button>
      </div>
    </form>
  )
}
