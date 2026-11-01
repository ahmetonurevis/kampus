import { useState } from 'react'
import { istanbulLocalToUtc } from '@kampus/school-core/skills/scoring.ts'
import {
  submissionStale,
  useRequestTaskResubmission,
} from '@kampus/react-shared/use-task-grading.ts'
import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify.ts'
import {
  defaultResubmissionLocal,
  resubmissionDueError,
  resubmissionMaxLocal,
  resubmissionMinLocal,
} from './task-model.ts'

type Props = {
  submission: TaskSubmissionDetail
  /** Puanı kesinleşen son sürüm. */
  versionNumber: number
}

/**
 * Yeniden teslim isteği (DOM-BEC-040): puanı kesinleşen son sürüm için öğrenciden yeni sürüm
 * istenir; yeni son tarih ileri ve en çok 14 gün sonradır, geç kabul yoktur. İstek teslimin
 * `rowVersion`'ıyla gider; 409'da teslim tazelenir ve kullanıcıya bildirilir.
 */
export function ResubmissionForm({ submission, versionNumber }: Props) {
  const request = useRequestTaskResubmission()
  // Pencere açıldığı andaki zaman: sınırlar çizim boyunca sabit kalır.
  const [now] = useState(() => Date.now())
  const [due, setDue] = useState(() => defaultResubmissionLocal(now))
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const version = submission.rowVersion

  async function submit() {
    const problem = resubmissionDueError(due, Date.now())
    setError(problem)
    if (problem !== null || version === null) return
    const dueAt = istanbulLocalToUtc(due)
    if (dueAt === null) return
    setStale(false)
    const outcome = await request.submit(
      { submissionId: submission.id, version, request: { versionNumber, dueAt } },
      {
        fieldFor: (apiError) =>
          apiError.code === 'resubmission_due_invalid' ? 'dueAt' : undefined,
        setError: (_name, apiError) => setError(apiError.message),
      },
    )
    if (outcome.status === 'success') notify.success('Yeniden teslim istendi.')
    else if (outcome.status === 'failed' && submissionStale(outcome.error)) setStale(true)
  }

  return (
    <form
      noValidate
      aria-label="Yeniden teslim iste"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="grid gap-4"
    >
      {stale ? (
        <p role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
          Teslim bu arada değişti ve güncel hâli yüklendi. Gerekirse yeniden deneyin.
        </p>
      ) : null}
      <FormField
        id="yeniden-teslim-tarihi"
        label="Yeni son teslim"
        description="Önümüzdeki 14 gün içinde bir tarih seçin; geç kabul yoktur."
        error={error ? { message: error } : undefined}
      >
        {(control) => (
          <Input
            {...control}
            type="datetime-local"
            value={due}
            min={resubmissionMinLocal(now)}
            max={resubmissionMaxLocal(now)}
            onChange={(event) => setDue(event.target.value)}
            disabled={request.isPending}
            className="max-w-[260px]"
          />
        )}
      </FormField>
      <div>
        <Button
          type="submit"
          variant="secondary"
          disabled={request.isPending || version === null}
          aria-busy={request.isPending || undefined}
        >
          <Icon name="RotateCcw" size={16} aria-hidden="true" />
          Yeniden teslim iste
        </Button>
      </div>
    </form>
  )
}
