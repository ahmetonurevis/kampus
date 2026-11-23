import { useId, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import {
  useFinalScoreTaskSubmission,
  useScoreTaskSubmission,
  useSecondScoreTaskSubmission,
} from '@kampus/react-shared/use-task-grading.ts'
import type { RubricVersion } from '@kampus/react-shared/use-rubrics.ts'
import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { RubricCriteriaFields } from './RubricCriteriaFields.tsx'
import { FeedbackAudioField } from './FeedbackAudioRecorder.tsx'
import {
  NO_FEEDBACK_AUDIO,
  PENDING_FEEDBACK_AUDIO,
  feedbackAudioBody,
  type FeedbackAudioValue,
} from './feedback-audio-model.ts'
import { SCORE_FORM_COPY } from './second-rating-model.ts'
import { showsStaleNotice, scoreBody, scoreFormSchema, type ScoreFormValues } from './task-model.ts'

type Props = {
  submission: TaskSubmissionDetail
  rubric: RubricVersion
  /** Puanlanan sürüm (son sürüm) numarası. */
  versionNumber: number
  onScored?: () => void
  /** Teslim eskidi: uyarıyı pencere gösterir (hata tek yerde). */
  onStaleChange: (stale: boolean) => void
  /**
   * `first` öğretmenin puanı (`scores`), `second` ilk puanı görmeyen ikinci değerlendiricinin
   * puanı (`second-scores`), `final` uyuşmazlıkta koordinatörün son puanı (`final-scores`;
   * DOM-BEC-024, DOM-YTK-027). Gövde üçünde aynıdır.
   */
  kind?: 'first' | 'second' | 'final'
  /** Pencereye taşınan eskime hataları; verilmezse ilk puanınkiler. */
  staleOn?: (error: { code: string }) => boolean
}

const SCORE_FIELD = /^(criteria\.\d+\.(band|comment)|overallComment)$/

/**
 * Rubrik puanı formu (DOM-BEC-020…023): her kritere bir bant (0–5) ve gerekirse yorum, genel
 * geri bildirim. Toplam ve yüzde sunucuda hesaplanır; istemci toplam göndermez. Hedefin altındaki
 * bantta (0–2) kriter yorumu zorunludur. 409'da (başka puan, yeni sürüm, sürüm çakışması) ekran
 * güncel teslimi yükler; uyarıyı pencere gösterir ve yazılan yorumlar korunur. İsteğe bağlı
 * sesli geri bildirim (DOM-BEC-056) hazır olunca gövdeye `feedbackAudioFileId` olarak eklenir;
 * hazırlanırken puan kaydedilmez.
 */
export function RubricScoreForm({
  submission,
  rubric,
  versionNumber,
  onScored,
  onStaleChange,
  kind = 'first',
  staleOn = showsStaleNotice,
}: Props) {
  const firstScore = useScoreTaskSubmission()
  const secondScore = useSecondScoreTaskSubmission()
  const finalScore = useFinalScoreTaskSubmission()
  const score = { first: firstScore, second: secondScore, final: finalScore }[kind]
  const copy = SCORE_FORM_COPY[kind]
  const form = useForm<ScoreFormValues>({
    resolver: zodResolver(scoreFormSchema) as unknown as Resolver<ScoreFormValues>,
    defaultValues: {
      criteria: rubric.criteria.map((criterion) => ({
        criterionId: criterion.id,
        band: null,
        comment: '',
      })),
      overallComment: '',
    },
  })
  const [audio, setAudio] = useState<FeedbackAudioValue>(NO_FEEDBACK_AUDIO)
  const busy = score.isPending || form.formState.isSubmitting
  const audioPending = audio.kind === 'pending'
  const version = submission.rowVersion
  const errors = form.formState.errors
  // Aynı sayfada birden çok form (ilk ve son puan) açılabilir; kimlik formun örneğine özgüdür.
  const audioPendingId = useId()

  const submit = form.handleSubmit(async (values) => {
    if (version === null || audioPending) return
    onStaleChange(false)
    const outcome = await score.submit(
      {
        submissionId: submission.id,
        version,
        score: { ...scoreBody(values, versionNumber), ...feedbackAudioBody(audio) },
      },
      {
        silent: staleOn,
        setError: (name, error) =>
          form.setError((SCORE_FIELD.test(name) ? name : 'root.server') as 'overallComment', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success(copy.success)
      onScored?.()
    } else if (outcome.status === 'failed' && staleOn(outcome.error)) {
      onStaleChange(true)
    }
  })

  return (
    <form
      noValidate
      aria-label={copy.ariaLabel}
      onSubmit={(event) => {
        event.preventDefault()
        void submit(event)
      }}
      className="grid gap-5"
    >
      <RubricCriteriaFields
        control={form.control}
        register={form.register}
        errors={errors}
        rubric={rubric}
        busy={busy}
      />
      <FeedbackAudioField disabled={busy} onChange={setAudio} />
      <p className="text-sm text-muted-foreground">{copy.note}</p>
      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        {audioPending ? (
          <p id={audioPendingId} className="text-sm text-muted-foreground">
            {PENDING_FEEDBACK_AUDIO}
          </p>
        ) : null}
        <Button
          type="submit"
          disabled={busy || version === null || audioPending}
          aria-busy={busy || undefined}
          aria-describedby={audioPending ? audioPendingId : undefined}
        >
          <Icon name="Check" size={17} aria-hidden="true" />
          {copy.submit}
        </Button>
      </div>
    </form>
  )
}
