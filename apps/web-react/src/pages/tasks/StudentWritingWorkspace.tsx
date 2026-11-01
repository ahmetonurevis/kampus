import { useMemo } from 'react'
import { useResourceDetail } from '@kampus/react-shared/use-resources.ts'
import { learnerSubmissionsQuery } from '@kampus/react-shared/use-learner-task-progress.ts'
import { useTaskAssignment } from '@kampus/react-shared/use-task-assignments.ts'
import {
  useTaskDraft,
  useTaskSubmission,
  useTaskSubmissions,
} from '@kampus/react-shared/use-task-submissions.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useNow } from '@/hooks/use-now.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { Facts } from '../learning/LearningParts.tsx'
import { SubmissionVersions } from './SubmissionVersions.tsx'
import {
  isLearnerAssignment,
  isNotFoundError,
  resubmissionPending,
  taskKindLabel,
  taskTypeLabel,
  writingProgress,
} from './student-task-model.ts'
import { WritingEditor } from './WritingEditor.tsx'

export const WRITING_PARAM = 'yaz'

const stamp = (iso: string) => `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`

/**
 * Yazma görevi çalışma alanı (`?yaz=<atama>`): yönerge, metin editörü (taslak + teslim) ve
 * gönderilen sürümler. Gönderebilirlik sunucunun `allowance`'ındandır; engel nedeni puanlamadan
 * bağımsız anlatılır (`locked` dahil). Puan ve geri bildirim açılmadıysa hiçbir iz yoktur
 * (DOM-BEC-045). Dosyalı ve sesli teslim F4b4'tedir; bu ekran metin teslimini açar.
 */
export function StudentWritingWorkspace({
  page,
  assignmentId,
}: {
  page: NavPage
  assignmentId: string
}) {
  useDocumentTitle(page.title)
  const workspace = useDetailPanel(WRITING_PARAM)
  const assignmentQuery = useTaskAssignment(assignmentId)
  const listQuery = useTaskSubmissions(learnerSubmissionsQuery(assignmentId))
  const summary = listQuery.data?.data[0]
  const detailQuery = useTaskSubmission(summary?.id ?? '')
  const draftQuery = useTaskDraft(assignmentId)
  const nowMs = useNow(true, 30_000)

  const assignment =
    assignmentQuery.data && isLearnerAssignment(assignmentQuery.data.data)
      ? assignmentQuery.data.data
      : undefined
  const resourceQuery = useResourceDetail(assignment?.resourceId ?? '')
  const instructions = useMemo(() => {
    const data = resourceQuery.data?.data
    if (!assignment || !data || data.view !== 'learner') return null
    if (data.version.id !== assignment.resourceVersionId) return null
    const content = data.version.content
    return content.type === 'homework_template' && typeof content.instructions === 'string'
      ? content.instructions
      : null
  }, [resourceQuery.data, assignment])

  const back = (
    <Button type="button" variant="secondary" onClick={workspace.close}>
      <Icon name="ArrowLeft" size={16} aria-hidden="true" />
      Listeye dön
    </Button>
  )
  const missing = isNotFoundError(assignmentQuery.error)
  const error = assignmentQuery.error ?? listQuery.error
  if (error && !missing)
    return (
      <>
        <PageHeading title={page.title} actions={back} />
        <QueryError
          error={error}
          onRetry={() => {
            void assignmentQuery.refetch()
            void listQuery.refetch()
          }}
        />
      </>
    )
  if (missing || (assignmentQuery.data && (!assignment || assignment.scoringMode !== 'teacher')))
    return (
      <>
        <PageHeading title={page.title} actions={back} />
        <EmptyState
          title="Görev bulunamadı."
          description="Bu görev size atanmamış ya da teslim beklemiyor."
        />
      </>
    )
  const detail = detailQuery.data?.data
  const waitingDetail = summary !== undefined && !detail && !detailQuery.error
  if (!assignment || !listQuery.data || waitingDetail || draftQuery.isPending)
    return (
      <>
        <PageHeading title={page.title} actions={back} />
        {detailQuery.error ? (
          <QueryError error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Görev yükleniyor…
          </p>
        )}
      </>
    )

  const progress = writingProgress(assignment, detail ?? summary ?? null, new Date(nowMs))
  const settings = assignment.submission
  const textKind = settings?.submissionKind === 'text'
  const draft = draftQuery.data?.data ?? null
  const latestBody = detail?.versions.at(-1)?.body ?? ''
  // Yeniden teslimde editör son sürümle açılır; taslak varsa o önceliklidir.
  const initialBody = draft?.body ?? (resubmissionPending(detail) ? latestBody : '')
  const request = detail?.resubmission

  return (
    <>
      <PageHeading
        title={assignment.title}
        description={`${taskTypeLabel(assignment)} · ${taskKindLabel(assignment)}`}
        actions={back}
      />
      <div className="grid gap-5">
        <section
          aria-labelledby="gorev-bilgisi"
          className="panel rounded-card border bg-surface p-6 max-[650px]:p-4"
        >
          <h2 id="gorev-bilgisi" className="mb-3 text-lg font-semibold">
            Görev bilgileri
          </h2>
          {instructions ? (
            <p lang="en" className="mb-4 text-sm whitespace-pre-line [overflow-wrap:anywhere]">
              {instructions}
            </p>
          ) : null}
          <Facts
            items={[
              ['Durum', <StatusBadge key="d" text={progress.status} tone={progress.tone} />],
              ['Sürüm hakkı', progress.rights],
              [
                'Son teslim',
                assignment.deadline.dueAt ? stamp(assignment.deadline.dueAt) : 'Belirtilmemiş',
              ],
              ...(request && resubmissionPending(detail)
                ? ([['Yeniden teslim son tarihi', stamp(request.dueAt)]] as const)
                : []),
              ['Puan', progress.score],
            ]}
          />
          {request && resubmissionPending(detail) ? (
            <p role="status" className="text-sm">
              Öğretmeniniz yeniden teslim istedi; yeni bir sürüm gönderebilirsiniz.
            </p>
          ) : null}
        </section>

        <section
          aria-labelledby="teslim-alani"
          className="panel rounded-card border bg-surface p-6 max-[650px]:p-4"
        >
          <h2 id="teslim-alani" className="mb-3 text-lg font-semibold">
            Teslim
          </h2>
          {!textKind ? (
            <p role="status" className="text-sm text-muted-foreground">
              Bu görev metin yerine dosya veya ses kaydıyla teslim edilir; bu teslim türü henüz açık
              değil.
            </p>
          ) : (
            <>
              {!progress.canAct && progress.blockedReason ? (
                <p role="status" className="mb-3 text-sm text-muted-foreground">
                  {progress.blockedReason}
                </p>
              ) : null}
              <WritingEditor
                key={`${summary?.id ?? 'yeni'}-${detail?.versionCount ?? 0}`}
                assignmentId={assignmentId}
                initialBody={initialBody}
                draft={draft}
                minWords={settings?.submissionKind === 'text' ? settings.minWords : null}
                maxWords={settings?.submissionKind === 'text' ? settings.maxWords : null}
                canSubmit={progress.canAct}
                onSubmitted={() => undefined}
              />
            </>
          )}
        </section>

        {detail && detail.versions.length > 0 ? (
          <section
            aria-labelledby="surumler"
            className="panel rounded-card border bg-surface p-6 max-[650px]:p-4"
          >
            <h2 id="surumler" className="mb-3 text-lg font-semibold">
              Gönderdikleriniz
            </h2>
            <SubmissionVersions versions={detail.versions} />
          </section>
        ) : null}
      </div>
    </>
  )
}
