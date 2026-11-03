import { useEffect, useRef, useState } from 'react'
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
import { SpeakingTask } from './SpeakingRecorder.tsx'
import { SubmissionVersions } from './SubmissionVersions.tsx'
import {
  isLearnerAssignment,
  isNotFoundError,
  isSpeakingTask,
  resubmissionPending,
  taskKindLabel,
  taskTypeLabel,
  writingBrief,
  writingInitialBody,
  writingProgress,
  versionLimit,
} from './student-task-model.ts'
import { WritingEditor } from './WritingEditor.tsx'

export const WRITING_PARAM = 'yaz'

const stamp = (iso: string) => `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}`

/**
 * Yazma görevi çalışma alanı (`?yaz=<atama>`): atamada sabitlenen sürümün yönergesi ve kaynak
 * gösterimi (DOM-KYN-024, atama ayrıntısından), metin editörü (taslak + teslim) ve
 * gönderilen sürümler. Gönderebilirlik sunucunun `allowance`'ındandır; engel nedeni puanlamadan
 * bağımsız anlatılır (`locked` dahil). Puan ve geri bildirim açılmadıysa hiçbir iz yoktur
 * (DOM-BEC-045). Konuşma görevinde (`submissionKind: 'audio'`) editör yerine ses kaydı açılır
 * (`SpeakingRecorder.tsx`; IST-051): sınırlar ve kalan deneme atamadan ve `allowance`'tan gelir.
 * El yazısı (dosyalı) teslim ekranı henüz yok.
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
  // Konuşma görevinde ilk tesliminden sonra sürüm ayrıntısı yeniden yüklenirken sayfa yükleniyor
  // ekranına dönmez: dönerse ses kaydı durumu (atılan kayıt sayısı, teslim iletisi) kaybolurdu.
  // Yazma görevinde dönülür: editör eski taslakla ve açık düğmeyle görünüp yazılan metni
  // kaybettirmesin ya da aynı metni yeniden gönderttirmesin.
  const [shown, setShown] = useState(false)
  // Teslimden sonra editör yeniden kurulur; odak kaybolmasın diye yeni sürümün listesine taşınır.
  const focusVersions = useRef(false)
  const versionsHeading = useRef<HTMLHeadingElement>(null)
  const versionCount = detailQuery.data?.data.versionCount ?? 0
  useEffect(() => {
    if (!focusVersions.current || !versionsHeading.current) return
    focusVersions.current = false
    versionsHeading.current.focus()
  }, [versionCount])

  const assignment =
    assignmentQuery.data && isLearnerAssignment(assignmentQuery.data.data)
      ? assignmentQuery.data.data
      : undefined

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
  const loaded = !!assignment && !!listQuery.data && !draftQuery.isPending
  const keepShown = shown && assignment !== undefined && isSpeakingTask(assignment)
  if (loaded && !waitingDetail && !shown) setShown(true)
  if (!loaded || (waitingDetail && !keepShown))
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
  const speaking = isSpeakingTask(assignment)
  const remaining =
    detail?.allowance?.remaining ??
    Math.max(0, (versionLimit(assignment) ?? 0) - (summary?.versionCount ?? 0))
  const draft = draftQuery.data?.data ?? null
  // Yeniden teslimde editör son sürümle açılır; taslak yalnız son sürümden yeniyse önceliklidir.
  const initialBody = writingInitialBody(draft, detail, resubmissionPending(detail))
  const request = detail?.resubmission
  const brief = writingBrief(assignment)

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
          {brief.instructions ? (
            <div className="mb-4">
              <h3 className="mb-1 text-sm font-semibold">Yönerge</h3>
              <p lang="en" className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">
                {brief.instructions}
              </p>
            </div>
          ) : null}
          {brief.notice ? (
            <p role="note" className="mb-4 text-sm text-muted-foreground">
              {brief.notice}
            </p>
          ) : null}
          {brief.attributions.length > 0 ? (
            <section aria-label="Kaynak gösterimi" className="mb-4">
              <h3 className="mb-1 text-sm font-semibold">Kaynak gösterimi</h3>
              <ul className="grid gap-1 text-sm text-muted-foreground">
                {brief.attributions.map((item) => (
                  <li key={`${item.work}:${item.author}:${item.source}`}>
                    <span lang="en" className="font-medium text-foreground">
                      {item.work}
                    </span>{' '}
                    — {item.author}, {item.source}
                    {item.year ? ` (${item.year})` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <Facts
            items={[
              ['Durum', <StatusBadge key="d" text={progress.status} tone={progress.tone} />],
              [speaking ? 'Deneme hakkı' : 'Sürüm hakkı', progress.rights],
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
            {speaking ? 'Konuşma kaydı' : 'Teslim'}
          </h2>
          {settings?.submissionKind === 'audio' ? (
            // Anahtar yok: teslimden sonra da kayıt durumu (atılan kayıt sayısı) korunur.
            <SpeakingTask
              assignmentId={assignmentId}
              limits={settings}
              remaining={remaining}
              canSubmit={progress.canAct}
              blockedReason={progress.blockedReason}
            />
          ) : !textKind ? (
            <p role="status" className="text-sm text-muted-foreground">
              Bu görev el yazısı dosyasıyla teslim edilir; dosya yükleme ekranı henüz açık değil.
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
                onSubmitted={() => {
                  focusVersions.current = true
                }}
              />
            </>
          )}
        </section>

        {detail && detail.versions.length > 0 ? (
          <section
            aria-labelledby="surumler"
            className="panel rounded-card border bg-surface p-6 max-[650px]:p-4"
          >
            <h2
              id="surumler"
              ref={versionsHeading}
              tabIndex={-1}
              className="mb-3 text-lg font-semibold outline-none"
            >
              Gönderdikleriniz
            </h2>
            <SubmissionVersions versions={detail.versions} />
          </section>
        ) : null}
      </div>
    </>
  )
}
