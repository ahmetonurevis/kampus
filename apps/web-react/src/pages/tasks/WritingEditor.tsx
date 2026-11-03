import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { useSubmitTaskDraft, type TaskDraft } from '@kampus/react-shared/use-task-submissions.ts'
import { submissionVersionInputSchema } from '@kampus/school-core/skills/submission.ts'
import { timeLabel } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { useDraftAutosave } from './use-draft-autosave.ts'
import { liveWordCount, SAME_AS_LAST_VERSION_MESSAGE, sameAsLastVersion } from './writing-model.ts'

/** Metin teslimi alanı çekirdeğin teslim şemasındandır (boş metin ve 50.000 karakter sınırı). */
const textBody = submissionVersionInputSchema.options[0].shape.body
const formSchema = z.object({ body: textBody })
type FormInput = z.input<typeof formSchema>

const FIELD_ID = 'yazma-metni'
const COUNTER_ID = `${FIELD_ID}-sayac`

/** Taslağa ait teslim hataları metin alanının altında görünür (toast yerine). */
const FIELD_CODES = new Set(['draft_empty', 'draft_already_submitted'])

type Props = {
  assignmentId: string
  /** Taslağın ya da (taslak yoksa) yeniden teslim için son sürümün metni. */
  initialBody: string
  draft: TaskDraft | null
  /** Son gönderilen sürümün metni; aynı metin yeni sürüm olarak gönderilmez. */
  lastSubmittedBody: string | null
  minWords: number | null
  maxWords: number | null
  /** Sunucunun karar verdiği gönderebilirlik; `false` ise alan salt okunur. */
  canSubmit: boolean
  onSubmitted: () => void
}

/**
 * Yazma teslimi (DOM-BEC-040, 044, 046; IST-047): metin taslak olarak kısa süre sonra otomatik
 * kaydedilir. "Teslim et" önce bekleyen kaydı tamamlar, sonra kaydedilen taslağı revizyonuyla
 * (`If-Match`) teslim eder; böylece teslim edilen metin kaydedilen revizyondur. Sözcük sayısı
 * yazarken çekirdeğin sayacıyla canlı gösterilir; sınır dışındaki metin uyarıyla kabul edilir.
 */
export function WritingEditor({
  assignmentId,
  initialBody,
  draft,
  lastSubmittedBody,
  minWords,
  maxWords,
  canSubmit,
  onSubmitted,
}: Props) {
  const submitDraft = useSubmitTaskDraft()
  const [flushing, setFlushing] = useState(false)
  const busy = flushing || submitDraft.isPending
  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: { body: initialBody },
  })
  const body = useWatch({ control: form.control, name: 'body' })
  const autosave = useDraftAutosave({
    assignmentId,
    draft,
    initialBody,
    body,
    enabled: canSubmit && !busy,
  })
  const words = liveWordCount(body, { minWords, maxWords })

  const onSubmit = form.handleSubmit(async (values) => {
    if (sameAsLastVersion(values.body, lastSubmittedBody)) {
      form.setError(
        'body',
        { type: 'same', message: SAME_AS_LAST_VERSION_MESSAGE },
        { shouldFocus: true },
      )
      return
    }
    setFlushing(true)
    let revision: number | null
    try {
      revision = await autosave.flush(values.body)
    } finally {
      setFlushing(false)
    }
    // Kayıt hatası komutun toast'ıyla ve taslak durumunda bildirildi; metin ekranda kalır.
    if (revision === null) {
      form.setFocus('body')
      return
    }
    const outcome = await submitDraft.submit(
      { assignmentId, revision },
      {
        setError: (name, error) =>
          form.setError(name as keyof FormInput, error, { shouldFocus: true }),
        fieldFor: (error) => (FIELD_CODES.has(error.code) ? 'body' : undefined),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Teslim edildi.')
      onSubmitted()
    }
  })

  const draftText =
    autosave.state === 'saving'
      ? 'Taslak kaydediliyor…'
      : autosave.state === 'error'
        ? 'Taslak kaydedilemedi; yazmaya devam edebilirsiniz.'
        : autosave.state === 'saved' && autosave.savedAt
          ? `Taslak kaydedildi (${timeLabel(autosave.savedAt)}).`
          : 'Taslak otomatik kaydedilir.'

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-3">
      <FormField id={FIELD_ID} label="Metniniz" error={form.formState.errors.body}>
        {(control) => (
          <Textarea
            {...control}
            aria-describedby={[COUNTER_ID, control['aria-describedby']].filter(Boolean).join(' ')}
            {...form.register('body')}
            lang="en"
            rows={14}
            // Teslim sürerken alan devre dışı bırakılmaz: odak metinde kalır, yalnız düzenleme durur.
            readOnly={!canSubmit || busy}
            aria-busy={busy}
            className="min-h-64 [overflow-wrap:anywhere]"
          />
        )}
      </FormField>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span id={COUNTER_ID} data-testid="sozcuk-sayaci">
          {words.label}
        </span>
        <span role="status">{canSubmit ? draftText : 'Teslim şu an açık değil.'}</span>
      </div>
      {/* Bölge hep yerinde: uyarı belirince ekran okuyucu bir kez okur, her tuşta değil. */}
      <div aria-live="polite">
        {words.warning ? (
          <p className="flex items-start gap-2 text-sm text-warning">
            <Icon name="Info" size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {words.warning}
          </p>
        ) : null}
      </div>
      <div>
        <Button type="submit" disabled={!canSubmit || busy} aria-busy={busy}>
          <Icon name="Send" size={16} aria-hidden="true" />
          Teslim et
        </Button>
      </div>
    </form>
  )
}
