import { useMemo } from 'react'
import { useLearnerAssignments } from '@kampus/react-shared/use-learner-task-progress.ts'
import type { TaskAssignmentLearner } from '@kampus/react-shared/use-task-assignments.ts'
import { useTaskAttempt } from '@kampus/react-shared/use-task-attempts.ts'
import { useTaskSubmission } from '@kampus/react-shared/use-task-submissions.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useNow } from '@/hooks/use-now.ts'
import { Facts, TableGate } from '../learning/LearningParts.tsx'
import { AttemptResult } from './AttemptResult.tsx'
import {
  childAssignments,
  childProgress,
  parentResultOf,
  parentTaskRows,
} from './parent-task-model.ts'
import {
  FAILED,
  isSpeakingTask,
  summaryProgress,
  taskKindLabel,
  taskTypeLabel,
  type StudentTaskRow,
} from './student-task-model.ts'
import { SubmissionVersions } from './SubmissionVersions.tsx'

/** Sağ panel parametresi; çocuk değişince kapanır (`CHILD_SCOPED_PANEL_PARAMS`). */
export const PARENT_TASK_PARAM = 'gorev'
const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['status', 'dueAt']
const CAPTION = 'Beceri görevleri'

const dueLabel = (iso: string | null) =>
  iso ? `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}` : '—'

/**
 * Velinin beceri görevleri (OG-992; IST-051, DOM-YTK-028, DOM-BEC-045): seçili çocuğa atanmış
 * okuma, dinleme, yazma ve konuşma görevleri, öğrencinin görev listesiyle aynı kalıpta. Kapsamı
 * sunucu uygular; liste atamaların `learnerIds` alanıyla çocuğa daraltılır, durum, hak ve açılmış
 * puan çocuğun özetinden gelir. Veli salt okurdur: başlatma, çözme, teslim ve itiraz düğmesi yoktur.
 * Panel tamamlanan denemenin ya da teslimin yalnız sunucunun açtığı sonucunu gösterir.
 */
export function ParentTaskSection({ childId }: { childId: string }) {
  const assignments = useLearnerAssignments()
  const items = useMemo(
    () => childAssignments(assignments.items, childId),
    [assignments.items, childId],
  )
  const nowMs = useNow(true, 30_000)
  const now = new Date(nowMs)
  const rows = assignments.isReady ? parentTaskRows(items, childId, now) : undefined

  const panel = useDetailPanel(PARENT_TASK_PARAM)
  const openPanel = panel.open
  const columns = useMemo<DataColumn<StudentTaskRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Görev',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openPanel(row.id)}
            aria-label={`${row.title} ayrıntısını aç`}
            className="record-link max-w-[340px] truncate text-left font-medium text-primary hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      { key: 'type', label: 'Tür' },
      { key: 'kind', label: 'Amaç' },
      { key: 'dueAt', label: 'Son teslim', cell: (row) => dueLabel(row.dueAt) },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={row.tone} />,
      },
      { key: 'rights', label: 'Hak' },
      { key: 'score', label: 'Puan' },
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.title} ayrıntısı`}
            onClick={() => openPanel(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openPanel],
  )

  const selected = items.find((item) => item.id === panel.selectedId)

  return (
    <>
      {rows && rows.length === 0 ? (
        <EmptyState icon="BookOpen" title="Bu çocuğa atanmış görev yok." />
      ) : (
        <section
          aria-labelledby="veli-gorevler-baslik"
          className="panel mb-6 overflow-hidden rounded-card border bg-surface"
        >
          <header className="panel-heading px-6 pt-6 pb-2">
            <h2 id="veli-gorevler-baslik" className="text-lg font-semibold">
              Beceri görevleri
            </h2>
            {rows ? <p className="text-sm text-muted-foreground">{rows.length} görev</p> : null}
          </header>
          <TableGate
            error={assignments.isReady ? null : assignments.error}
            onRetry={() => void assignments.refetch()}
            loading={rows === undefined}
          >
            {assignments.truncated ? (
              <p role="status" className="px-6 pb-3 text-sm text-muted-foreground">
                Görev sayısı çok fazla; yalnız en yeni kayıtlar gösteriliyor.
              </p>
            ) : null}
            <DataTable
              listKey="veli-gorevler"
              rows={rows ?? NONE}
              columns={columns}
              mobileColumns={MOBILE_COLUMNS}
              caption={CAPTION}
              searchKeys={['title', 'type']}
              onRowClick={(row) => openPanel(row.id)}
            />
          </TableGate>
        </section>
      )}

      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Görev ayrıntısı"
      >
        {selected ? (
          <ParentTaskDetail assignment={selected} childId={childId} now={now} />
        ) : assignments.isReady && !assignments.isLoadingMore ? (
          <p role="status" className="text-sm text-muted-foreground">
            Görev bulunamadı. Bu çocuğa atanmamış ya da kaldırılmış olabilir.
          </p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Görev yükleniyor…
          </p>
        )}
      </SidePanel>
    </>
  )
}

function ParentTaskDetail({
  assignment,
  childId,
  now,
}: {
  assignment: TaskAssignmentLearner
  childId: string
  now: Date
}) {
  const progress = summaryProgress(assignment, now, childId) ?? FAILED
  const result = parentResultOf(assignment, childProgress(assignment, childId))
  const speaking = isSpeakingTask(assignment)
  return (
    <div className="grid gap-5">
      <div>
        <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{assignment.title}</h3>
        <p className="text-sm text-muted-foreground">
          {taskTypeLabel(assignment)} · {taskKindLabel(assignment)}
        </p>
      </div>
      <Facts
        items={[
          ['Durum', <StatusBadge key="d" text={progress.status} tone={progress.tone} />],
          ['Son teslim', dueLabel(assignment.deadline.dueAt)],
          [
            assignment.scoringMode === 'auto' || speaking ? 'Deneme hakkı' : 'Sürüm hakkı',
            progress.rights,
          ],
          ...(assignment.timeLimitMinutes
            ? ([['Süre sınırı', `${assignment.timeLimitMinutes} dk`]] as const)
            : []),
          ['Puan', progress.score],
        ]}
      />
      {result.kind === 'attempt' ? (
        <AttemptSummary attemptId={result.attemptId} title={assignment.title} />
      ) : result.kind === 'submission' ? (
        <SubmissionSummary submissionId={result.submissionId} />
      ) : result.kind === 'running' ? (
        <p role="status" className="text-sm text-muted-foreground">
          Deneme sürüyor; tamamlandığında sonuç burada görünür.
        </p>
      ) : null}
    </div>
  )
}

/** Tamamlanan deneme: yalnız sunucunun açtığı sonuç (DOM-BEC-045), velinin diliyle. */
function AttemptSummary({ attemptId, title }: { attemptId: string; title: string }) {
  const detail = useTaskAttempt(attemptId)
  const attempt = detail.data?.data
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  if (!attempt)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Sonuç yükleniyor…
      </p>
    )
  return <AttemptResult attempt={attempt} title={title} audience="parent" />
}

/** Teslim sürümleri: puan ve geri bildirim yalnız sunucu açtıysa (DOM-BEC-045). */
function SubmissionSummary({ submissionId }: { submissionId: string }) {
  const detail = useTaskSubmission(submissionId)
  const submission = detail.data?.data
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  if (!submission)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Teslim yükleniyor…
      </p>
    )
  return (
    <section aria-labelledby="veli-teslim-baslik" className="grid gap-3">
      <h3 id="veli-teslim-baslik" className="font-semibold">
        Gönderilen sürümler
      </h3>
      <SubmissionVersions versions={submission.versions} audience="parent" />
    </section>
  )
}
