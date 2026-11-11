import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import { useFileTaskAppeal } from '@kampus/react-shared/use-task-grading.ts'
import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  appealBody,
  appealFieldFor,
  appealFormSchema,
  learnerAppealState,
  type AppealFormValues,
} from './appeal-model.ts'

type Version = TaskSubmissionDetail['versions'][number]

type Props = {
  submissionId: string
  version: Version
  /** İtiraz yalnız son sürümün sonucuna yapılır (DOM-BEC-025). */
  isLatest: boolean
  /** Şimdiki zaman (ms); yalnız süre metni içindir, kesin karar sunucunundur. */
  now: number
}

/**
 * Sürüm kartının itiraz bölümü (öğrenci ve veli; DOM-BEC-025). Süre, kapsam ve sürüm başına tek
 * itiraz kuralı sunucudadır; ekran yalnız sunucunun döndürdüğü `appealDeadline` ve `appeal`
 * alanlarını okur. Süre açıksa "İtiraz et" düğmesi gerekçe formunu açar; süre dolmuş, itiraz
 * verilmiş ya da karara bağlanmışsa düğme yerine durum metni görünür. Gerekçe loglanmaz.
 */
export function AppealSection({ submissionId, version, isLatest, now }: Props) {
  const state = learnerAppealState(version, isLatest, new Date(now))
  if (state.kind === 'none') return null
  return (
    <div className="mt-3 grid gap-2 border-t pt-3 text-sm">
      {state.kind === 'open' ? (
        <OpenAppeal
          key={version.id}
          submissionId={submissionId}
          versionNumber={version.number}
          text={state.text}
        />
      ) : state.kind === 'expired' ? (
        <p className="text-muted-foreground">{state.text}</p>
      ) : state.kind === 'filed' ? (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge text="İtiraz alındı" tone="amber" />
            <span>{state.text}</span>
          </p>
          <p className="[overflow-wrap:anywhere]">
            <span className="font-medium">Gerekçeniz: </span>
            {state.reason}
          </p>
        </>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge text={state.label} tone={state.tone} />
            <span>{state.text}</span>
          </p>
          {state.reason ? (
            <p className="[overflow-wrap:anywhere]">
              <span className="font-medium">Öğretmenin gerekçesi: </span>
              {state.reason}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

function OpenAppeal({
  submissionId,
  versionNumber,
  text,
}: {
  submissionId: string
  versionNumber: number
  text: string
}) {
  const [open, setOpen] = useState(false)
  const appeal = useFileTaskAppeal()
  const form = useForm<AppealFormValues>({
    resolver: zodResolver(appealFormSchema) as unknown as Resolver<AppealFormValues>,
    defaultValues: { reason: '' },
  })
  const busy = appeal.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const submit = form.handleSubmit(async (values) => {
    const outcome = await appeal.submit(
      { submissionId, appeal: appealBody(values, versionNumber) },
      { setError: (name, error) => form.setError(appealFieldFor(name), error) },
    )
    if (outcome.status === 'success') notify.success('İtirazınız alındı.')
  })

  return (
    <>
      <p className="text-muted-foreground">{text}</p>
      {open ? (
        <form
          noValidate
          aria-label={`Sürüm ${versionNumber} için itiraz`}
          onSubmit={(event) => {
            event.preventDefault()
            void submit(event)
          }}
          className="grid gap-3"
        >
          <FormField
            id={`itiraz-gerekce-${versionNumber}`}
            label="İtiraz gerekçesi"
            description="Sonucun neden yeniden değerlendirilmesini istediğinizi yazın (en az 10 karakter)."
            error={errors.reason}
          >
            {(field) => (
              <Textarea
                {...field}
                {...form.register('reason')}
                maxLength={2000}
                rows={4}
                disabled={busy}
              />
            )}
          </FormField>
          <RootError message={errors.root?.server?.message} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
              <Icon name="Send" size={16} aria-hidden="true" />
              İtirazı gönder
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            <Icon name="Flag" size={16} aria-hidden="true" />
            İtiraz et
          </Button>
        </div>
      )}
    </>
  )
}
