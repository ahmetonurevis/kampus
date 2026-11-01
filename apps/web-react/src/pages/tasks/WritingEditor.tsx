import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import {
  useSaveTaskDraft,
  useSubmitTaskSubmission,
  type TaskDraft,
} from '@kampus/react-shared/use-task-submissions.ts'
import { submissionVersionInputSchema } from '@kampus/school-core/skills/submission.ts'
import { timeLabel } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'

const DRAFT_DELAY_MS = 1500

/** Metin teslimi alanı çekirdeğin teslim şemasındandır (boş metin ve 50.000 karakter sınırı). */
const textBody = submissionVersionInputSchema.options[0].shape.body
const formSchema = z.object({ body: textBody })
type FormInput = z.input<typeof formSchema>

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

type Props = {
  assignmentId: string
  /** Taslağın ya da (taslak yoksa) yeniden teslim için son sürümün metni. */
  initialBody: string
  draft: TaskDraft | null
  minWords: number | null
  maxWords: number | null
  /** Sunucunun karar verdiği gönderebilirlik; `false` ise alan salt okunur. */
  canSubmit: boolean
  onSubmitted: () => void
}

/**
 * Yazma teslimi (DOM-BEC-040, 044, 046; IST-047): metin taslak olarak kısa süre sonra otomatik
 * kaydedilir, "Teslim et" yeni değişmez sürüm ekler. Sözcük sınırı dışındaki metin uyarıyla
 * kabul edilir, engellenmez. Taslağın `revision`'ı `If-Match` olur; ilk kayıt başlıksızdır.
 */
export function WritingEditor({
  assignmentId,
  initialBody,
  draft,
  minWords,
  maxWords,
  canSubmit,
  onSubmitted,
}: Props) {
  const saveDraft = useSaveTaskDraft()
  const saveRef = useRef(saveDraft)
  const submit = useSubmitTaskSubmission()
  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: { body: initialBody },
  })
  const body = useWatch({ control: form.control, name: 'body' })
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    draft ? 'saved' : 'idle',
  )
  const [savedAt, setSavedAt] = useState<string | null>(draft?.savedAt ?? null)
  const revision = useRef<number | null>(draft?.revision ?? null)
  const savedBody = useRef(draft?.body ?? initialBody)
  const timer = useRef<number | undefined>(undefined)
  const latestRevision = draft?.revision

  // Başka pencerede kaydedilen taslak (409/400 sonrası tazeleme) sonraki kaydın başlığını günceller.
  useEffect(() => {
    if (latestRevision !== undefined) revision.current = latestRevision
  }, [latestRevision])

  useEffect(() => {
    saveRef.current = saveDraft
  })

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (!canSubmit || submit.isPending || body === savedBody.current || body.trim() === '') return
    timer.current = window.setTimeout(() => {
      void (async () => {
        setDraftState('saving')
        const outcome = await saveRef.current.submit({
          assignmentId,
          revision: revision.current,
          body,
        })
        if (outcome.status === 'success') {
          revision.current = outcome.data.data?.revision ?? revision.current
          savedBody.current = body
          setSavedAt(outcome.data.data?.savedAt ?? null)
          setDraftState('saved')
        } else setDraftState('error')
      })()
    }, DRAFT_DELAY_MS)
    return () => window.clearTimeout(timer.current)
  }, [body, canSubmit, assignmentId, submit.isPending])

  const words = countWords(body)
  const outside =
    body.trim() !== '' &&
    ((minWords !== null && words < minWords) || (maxWords !== null && words > maxWords))
  const limitText =
    minWords !== null && maxWords !== null
      ? `${minWords}–${maxWords} sözcük`
      : minWords !== null
        ? `en az ${minWords} sözcük`
        : maxWords !== null
          ? `en çok ${maxWords} sözcük`
          : null

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await submit.submit(
      { assignmentId, submission: { submissionKind: 'text', body: values.body } },
      { setError: form.setError },
    )
    if (outcome.status === 'success') {
      notify.success('Teslim edildi.')
      onSubmitted()
    }
  })

  const draftText =
    draftState === 'saving'
      ? 'Taslak kaydediliyor…'
      : draftState === 'error'
        ? 'Taslak kaydedilemedi; yazmaya devam edebilirsiniz.'
        : draftState === 'saved' && savedAt
          ? `Taslak kaydedildi (${timeLabel(savedAt)}).`
          : 'Taslak otomatik kaydedilir.'

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-3">
      <FormField id="yazma-metni" label="Metniniz" error={form.formState.errors.body}>
        {(control) => (
          <Textarea
            {...control}
            {...form.register('body')}
            lang="en"
            rows={14}
            readOnly={!canSubmit}
            disabled={submit.isPending}
            className="min-h-64 [overflow-wrap:anywhere]"
          />
        )}
      </FormField>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {words} sözcük{limitText ? ` · beklenen: ${limitText}` : ''}
        </span>
        <span role="status">{canSubmit ? draftText : 'Teslim şu an açık değil.'}</span>
      </div>
      {outside ? (
        <p role="note" className="flex items-start gap-2 text-sm text-warning">
          <Icon name="Info" size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          Sözcük sayınız beklenen aralığın dışında. Yine de gönderebilirsiniz; öğretmeniniz görür.
        </p>
      ) : null}
      <div>
        <Button
          type="submit"
          disabled={!canSubmit || submit.isPending}
          aria-busy={submit.isPending}
        >
          <Icon name="Send" size={16} aria-hidden="true" />
          Teslim et
        </Button>
      </div>
    </form>
  )
}
