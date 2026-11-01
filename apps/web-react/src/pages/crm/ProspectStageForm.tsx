import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import type { z } from 'zod'
import { useChangeProspectStage } from '@kampus/react-shared/use-prospect-commands.ts'
import {
  OPEN_PROSPECT_STAGES,
  PROSPECT_LOST_REASON_LABELS,
  PROSPECT_LOST_REASONS,
  prospectStageLabel,
} from '@kampus/school-core/lib/prospects.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { FormField } from '@/components/FormField.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  fieldErrors,
  stageBody,
  stageDefaults,
  stageFormSchema,
  type StageFormValues,
} from './prospect-forms.ts'
import { stageTargets } from './prospect-rows.ts'

type Output = z.output<typeof stageFormSchema>
const FIELDS = ['stage', 'lostReason', 'siblingOfId'] as const

/**
 * Aşama değiştirme (DOM-KAY-005, DOM-KAY-030): yalnız geçerli hedefler sunulur; ileri gidilir,
 * geri dönüş yoktur. `Vazgeçti` nedenle girilir; vazgeçen aday yalnız `İletişime geçildi` ile
 * yeniden açılır ve iletişimi paylaşan aday varsa (ret görülünce) kardeşini seçer. Kayıtlı adayın
 * aşaması değişmez. `If-Match` kartın okunan sürümüdür.
 */
export function ProspectStageForm({
  prospectId,
  version,
  stage,
  type,
}: {
  prospectId: string
  version: number
  stage: string
  type: InstitutionType
}) {
  const change = useChangeProspectStage()
  const targets = stageTargets(stage)
  const form = useForm<StageFormValues, unknown, Output>({
    resolver: zodResolver(stageFormSchema),
    defaultValues: stageDefaults(),
  })
  const [askSibling, setAskSibling] = useState(false)
  const selected = useWatch({ control: form.control, name: 'stage' })
  const reopening = stage === 'Vazgeçti'
  const siblings = useCoreAll(
    'prospects',
    { filters: { stage: [...OPEN_PROSPECT_STAGES, 'Kayıt oldu'] } },
    { enabled: askSibling },
  )
  const busy = change.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  if (stage === 'Kayıt oldu')
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Kesin kaydı tamamlanan adayın aşaması değişmez.
      </p>
    )

  const onSubmit = form.handleSubmit(async (values) => {
    const result = stageBody(values, { reopening })
    if (!result.ok) {
      form.setError(
        result.field,
        { type: 'manual', message: result.message },
        { shouldFocus: true },
      )
      return
    }
    const outcome = await change.submit(
      { prospectId, version, body: result.body },
      { setError: fieldErrors(FIELDS, form.setError) },
    )
    if (outcome.status === 'success') {
      notify.success('Aday aşaması güncellendi.')
      form.reset(stageDefaults())
      setAskSibling(false)
    } else if (outcome.status === 'failed' && outcome.error.code === 'prospect_contact_shared') {
      setAskSibling(true)
    }
  })

  return (
    <form
      noValidate
      aria-label="Aşamayı değiştir"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-4"
    >
      <FormField id="aday-asama" label="Kayıt aşaması" error={errors.stage}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('stage')}
            className="w-full"
            disabled={busy || targets.length === 0}
          >
            <NativeSelectOption value="">
              {targets.length === 0 ? 'Geçerli aşama yok' : 'Yeni aşamayı seçin'}
            </NativeSelectOption>
            {targets.map((target) => (
              <NativeSelectOption key={target} value={target}>
                {prospectStageLabel(target, type)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {selected === 'Vazgeçti' ? (
        <FormField id="aday-vazgecme" label="Vazgeçme nedeni" error={errors.lostReason}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('lostReason')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Neden seçin</NativeSelectOption>
              {PROSPECT_LOST_REASONS.map((reason) => (
                <NativeSelectOption key={reason} value={reason}>
                  {PROSPECT_LOST_REASON_LABELS[reason]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {askSibling ? (
        <FormField
          id="aday-yeniden-kardes"
          label="Kardeş aday"
          description="Bu iletişim bilgisi başka bir adayda kayıtlı. Kardeşse, kardeşini listeden kendiniz seçin."
          error={errors.siblingOfId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('siblingOfId')}
              className="w-full"
              disabled={busy || !siblings.data}
            >
              <NativeSelectOption value="">
                {siblings.data ? 'Kardeş adayı seçin' : 'Adaylar yükleniyor…'}
              </NativeSelectOption>
              {siblings.data
                ?.filter((item) => item.record.id !== prospectId)
                .map((item) => (
                  <NativeSelectOption key={item.record.id} value={item.record.id}>
                    {item.record.name} · {item.record.stage}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button
          type="submit"
          variant="secondary"
          disabled={busy || targets.length === 0}
          aria-busy={busy || undefined}
        >
          Aşamayı güncelle
        </Button>
      </div>
    </form>
  )
}
