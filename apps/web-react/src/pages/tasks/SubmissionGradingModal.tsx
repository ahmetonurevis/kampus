import { useState } from 'react'
import { useTaskAssignment } from '@kampus/react-shared/use-task-assignments.ts'
import {
  useTaskSubmission,
  type TaskSubmissionDetail,
} from '@kampus/react-shared/use-task-submissions.ts'
import { useRubricVersion, type RubricVersion } from '@kampus/react-shared/use-rubrics.ts'
import type { TaskScore } from '@kampus/react-shared/use-task-grading.ts'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { ResubmissionForm } from './ResubmissionForm.tsx'
import { RubricScoreForm } from './RubricScoreForm.tsx'
import {
  aspectLabel,
  bandMeaningLabel,
  dateTimeLabel,
  isStaffAssignment,
  learnerLabel,
  staleNoticeText,
  submissionStatus,
} from './task-model.ts'
import { VersionComparison } from './VersionComparison.tsx'
import { resubmissionRoundText } from './writing-model.ts'

type Props = {
  /** `''` kapalı; aksi hâlde puanlanan teslimin kimliği. */
  submissionId: string
  onClose: () => void
}

/**
 * Teslim puanlama penceresi (`?puanla=`): iki ya da daha çok sürümde iki sürümün yan yana
 * karşılaştırması (varsayılan son ikisi; IST-047), değişmez sürümler (metin, geç bayrağı, sözcük
 * sayısı, sürüm için istenen yeniden teslim turu),
 * verilmiş rubrik puanı, puanlanmamış son sürüm için rubrik formu ve puanı kesinleşen son sürüm
 * için yeniden teslim isteği. Kapsam, yetki ve sürüm sunucudadır; başka kurumun ya da kapsam
 * dışı teslim 404 verir ve "bulunamadı" görünür.
 */
export function SubmissionGradingModal({ submissionId, onClose }: Props) {
  return (
    <Modal
      open={submissionId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Teslimi puanla"
      size="wide"
    >
      {submissionId ? <GradingBody submissionId={submissionId} /> : null}
    </Modal>
  )
}

function GradingBody({ submissionId }: { submissionId: string }) {
  const detail = useTaskSubmission(submissionId)
  const submission = detail.data?.data
  const assignmentQuery = useTaskAssignment(submission?.assignmentId ?? '')
  const assignment = assignmentQuery.data?.data
  const staff = assignment && isStaffAssignment(assignment) ? assignment : null
  // Atamanın sabitlediği rubrik sürümü kimlikle tek çağrıda okunur (DOM-BEC-022); otomatik puanlı
  // görevde ya da atama yüklenmeden istek atılmaz.
  const rubricQuery = useRubricVersion(staff?.rubricVersionId ?? null)
  const rubric: RubricState = {
    version: rubricQuery.data?.data ?? null,
    loading: rubricQuery.isLoading,
    error: rubricQuery.error,
  }
  const [stale, setStale] = useState(false)

  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  if (!submission) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Teslim yükleniyor…
      </p>
    )
  }
  const status = submissionStatus(submission.status)
  const latest = submission.versions[submission.versions.length - 1] ?? null
  const latestScore = latest?.score ?? null
  const resubmission =
    submission.resubmission && latest && submission.resubmission.versionNumber === latest.number
      ? submission.resubmission
      : null
  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">
            {learnerLabel(submission)}
          </h3>
          <p className="text-sm text-muted-foreground">
            {staff?.title ?? 'Görev'}
            {staff?.deadline.dueAt ? ` · Son teslim ${dateTimeLabel(staff.deadline.dueAt)}` : ''}
          </p>
        </div>
        <StatusBadge text={status.label} tone={status.tone} />
      </header>

      {stale ? (
        <p role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
          {staleNoticeText({
            scored: latestScore !== null,
            resubmissionRequested: resubmission !== null,
          })}
        </p>
      ) : null}

      <VersionComparison key={submission.id} versions={submission.versions} />

      <section aria-labelledby="teslim-surumleri" className="grid gap-3">
        <h3 id="teslim-surumleri" className="text-md font-semibold">
          Teslim sürümleri
        </h3>
        {submission.versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz gönderilmiş sürüm yok.</p>
        ) : (
          [...submission.versions].reverse().map((version) => (
            <article
              key={version.id}
              aria-label={`Sürüm ${version.number}`}
              className="grid gap-3 rounded-card border p-4"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <strong>Sürüm {version.number}</strong>
                <span className="text-muted-foreground">{dateTimeLabel(version.submittedAt)}</span>
                {version.late ? <StatusBadge text="Geç teslim" tone="red" /> : null}
                {version.wordCount ? (
                  <span className="text-muted-foreground">{version.wordCount.count} sözcük</span>
                ) : null}
              </div>
              {version.resubmissionRequest ? (
                <p className="text-sm text-muted-foreground">
                  {resubmissionRoundText(version.resubmissionRequest)}
                </p>
              ) : null}
              {version.wordCount?.warning ? (
                <p className="text-sm text-warning">{version.wordCount.warning}</p>
              ) : null}
              <p className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {version.body ?? ''}
              </p>
              {version.score ? <ScoreCard score={version.score} rubric={rubric.version} /> : null}
            </article>
          ))
        )}
      </section>

      {latest && latestScore === null ? (
        <section aria-labelledby="puan-formu" className="grid gap-3 border-t pt-5">
          <h3 id="puan-formu" className="text-md font-semibold">
            Rubrikle puanla · Sürüm {latest.number}
          </h3>
          <ScoringArea
            submission={submission}
            rubric={rubric}
            noRubric={staff !== null && staff.rubricVersionId === null}
            assignmentError={assignmentQuery.error}
            assignmentPending={!assignment}
            versionNumber={latest.number}
            onStaleChange={setStale}
          />
        </section>
      ) : null}

      {latest && latestScore !== null ? (
        <section aria-labelledby="yeniden-teslim" className="grid gap-3 border-t pt-5">
          <h3 id="yeniden-teslim" className="text-md font-semibold">
            Yeniden teslim
          </h3>
          {resubmission ? (
            <p className="text-sm">
              Sürüm {resubmission.versionNumber} için yeniden teslim istendi. Yeni son teslim:{' '}
              <strong>{dateTimeLabel(resubmission.dueAt)}</strong>
            </p>
          ) : latestScore.settled ? (
            <ResubmissionForm
              submission={submission}
              versionNumber={latest.number}
              onStaleChange={setStale}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Yeniden teslim, puanı kesinleşen sürüm için istenir.
            </p>
          )}
        </section>
      ) : null}
    </div>
  )
}

type RubricState = { version: RubricVersion | null; loading: boolean; error: unknown }

type ScoringAreaProps = {
  submission: TaskSubmissionDetail
  rubric: RubricState
  noRubric: boolean
  assignmentError: unknown
  assignmentPending: boolean
  versionNumber: number
  onStaleChange: (stale: boolean) => void
}

function ScoringArea({
  submission,
  rubric,
  noRubric,
  assignmentError,
  assignmentPending,
  versionNumber,
  onStaleChange,
}: ScoringAreaProps) {
  if (assignmentError) return <QueryError error={assignmentError} />
  if (noRubric) {
    return (
      <p className="text-sm text-muted-foreground">
        Bu görev rubrikle puanlanmaz; bu ekrandan puan verilemez.
      </p>
    )
  }
  if (rubric.error) return <QueryError error={rubric.error} />
  if (assignmentPending || rubric.loading) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Rubrik yükleniyor…
      </p>
    )
  }
  if (!rubric.version) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Görevin rubrik sürümü bulunamadı; puanlama yapılamıyor.
      </p>
    )
  }
  // Anahtar son sürüm numarasıdır: yeni sürüm gelince form sıfırlanır ve eski bantlar taşınmaz.
  return (
    <RubricScoreForm
      key={`${submission.id}-${versionNumber}`}
      submission={submission}
      rubric={rubric.version}
      versionNumber={versionNumber}
      onStaleChange={onStaleChange}
    />
  )
}

export function ScoreCard({ score, rubric }: { score: TaskScore; rubric: RubricVersion | null }) {
  const aspects = new Map((rubric?.criteria ?? []).map((item) => [item.id, item.aspect]))
  return (
    <div
      className="grid gap-3 rounded-card border bg-surface-soft p-4"
      role="group"
      aria-label="Verilen puan"
    >
      <div className="flex flex-wrap items-center gap-3">
        <strong className="text-md">
          {score.total} / {score.max} · %{score.percent}
        </strong>
        <StatusBadge
          text={score.settled ? 'Kesinleşti' : 'Kesinleşmedi'}
          tone={score.settled ? 'green' : 'amber'}
        />
        <span className="text-xs text-muted-foreground">{dateTimeLabel(score.scoredAt)}</span>
      </div>
      <ul className="grid gap-2 text-sm">
        {score.criteria.map((criterion) => (
          <li key={criterion.criterionId} className="grid gap-0.5">
            <span className="font-medium">
              {aspects.has(criterion.criterionId)
                ? aspectLabel(aspects.get(criterion.criterionId) ?? '')
                : criterion.criterionId}{' '}
              · Bant {criterion.band} ({bandMeaningLabel(criterion.meaning)})
            </span>
            {criterion.comment ? (
              <span className="text-muted-foreground [overflow-wrap:anywhere]">
                {criterion.comment}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-sm [overflow-wrap:anywhere]">
        <span className="font-medium">Genel geri bildirim: </span>
        {score.overallComment}
      </p>
    </div>
  )
}
