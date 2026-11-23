import {
  useDrawSecondRatingSample,
  useRequestSecondRating,
} from '@kampus/react-shared/use-task-grading.ts'
import type { TaskAssignmentStaff } from '@kampus/react-shared/use-task-assignments.ts'
import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify.ts'
import { SummarySection } from '../management/SummaryParts.tsx'
import {
  REQUEST_SUCCESS_TEXT,
  requestState,
  sampleDrawnText,
  sampleState,
} from './second-rating-model.ts'

/** Örneklemi ve elle istemi yapabilen roller; yetki ve kapsam sunucudadır (403/404). */
const SAMPLE_ROLES = ['yonetici', 'ogretmen']

/**
 * Atama düzeyinde ikinci puanlama örneklemi (atama paneli; DOM-BEC-024): sunucunun atama
 * alanlarından durum yazılır, "Örneklemi çek" atamanın okunan `rowVersion`'ı ile gider. Süre
 * bitmeden, ikinci kez ya da örneklemsiz görevde sunucu reddeder; metin toast'ta görünür.
 */
export function SecondRatingSampleSection({ item }: { item: TaskAssignmentStaff }) {
  const { session } = useAuth()
  const draw = useDrawSecondRatingSample()
  const state = sampleState(item)
  if (state.kind === 'none') return null
  const allowed = session !== null && SAMPLE_ROLES.includes(session.role)
  const busy = draw.isPending
  const submit = async () => {
    const outcome = await draw.submit({ assignmentId: item.id, version: item.rowVersion })
    if (outcome.status === 'success') notify.success(sampleDrawnText(outcome.data.data))
  }
  return (
    <SummarySection title="İkinci puanlama örneklemi">
      <div className="grid gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge
            text={state.kind === 'drawn' ? 'Örneklem seçildi' : 'Örneklem bekliyor'}
            tone={state.kind === 'drawn' ? 'green' : 'amber'}
          />
          <span className="text-muted-foreground">{state.text}</span>
        </p>
        {state.kind === 'drawable' && allowed ? (
          <div>
            <Button
              variant="secondary"
              onClick={() => void submit()}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              <Icon name="ClipboardCheck" size={16} aria-hidden="true" />
              İkinci puanlama örneklemi çek
            </Button>
          </div>
        ) : null}
      </div>
    </SummarySection>
  )
}

type RequestProps = {
  submission: TaskSubmissionDetail
  /** Puanlanan (son) sürümün numarası. */
  versionNumber: number
  grading: TaskSubmissionDetail['versions'][number]['grading']
}

/**
 * Teslim düzeyinde elle ikinci değerlendirici istemi (puanlama penceresi; DOM-BEC-024): teslimin
 * okunan `rowVersion`'ı ile gider. Pencere kapanmadan sunucu 409 `second_rating_window_open`
 * der; kullanıcı metni kancadadır.
 */
export function SecondRatingRequestSection({ submission, versionNumber, grading }: RequestProps) {
  const request = useRequestSecondRating()
  const state = requestState(grading)
  if (state.kind === 'closed') return null
  const version = submission.rowVersion
  const busy = request.isPending
  const submit = async () => {
    if (version === null) return
    const outcome = await request.submit({
      submissionId: submission.id,
      version,
      request: { versionNumber },
    })
    if (outcome.status === 'success') notify.success(REQUEST_SUCCESS_TEXT)
  }
  return (
    <section aria-labelledby="ikinci-degerlendirici" className="grid gap-3 border-t pt-5">
      <h3 id="ikinci-degerlendirici" className="text-md font-semibold">
        İkinci değerlendirici
      </h3>
      <p className="text-sm text-muted-foreground">{state.text}</p>
      {state.kind === 'available' ? (
        <div>
          <Button
            variant="secondary"
            onClick={() => void submit()}
            disabled={busy || version === null}
            aria-busy={busy || undefined}
          >
            <Icon name="UsersRound" size={16} aria-hidden="true" />
            İkinci değerlendirici iste
          </Button>
        </div>
      ) : null}
    </section>
  )
}
