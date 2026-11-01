import { useMemo } from 'react'
import {
  useLearnerAssignments,
  useLearnerTaskProgress,
} from '@kampus/react-shared/use-learner-task-progress.ts'
import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useNow } from '@/hooks/use-now.ts'
import { Facts, TableGate } from '../learning/LearningParts.tsx'
import { QUIZ_PARAM } from './StudentQuizWorkspace.tsx'
import { WRITING_PARAM } from './StudentWritingWorkspace.tsx'
import {
  FAILED,
  autoProgress,
  isLearnerAssignment,
  studentTaskRow,
  taskKindLabel,
  taskTypeLabel,
  writingProgress,
  type StudentTaskMode,
  type StudentTaskRow,
} from './student-task-model.ts'

const PANEL_PARAM = 'gorev'
const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['status', 'dueAt']

const COPY = {
  auto: {
    heading: 'Atanan quizler',
    caption: 'Atanan quizler',
    empty: 'Henüz size atanmış quiz yok.',
    listKey: 'gorevler-quiz',
    workspace: QUIZ_PARAM,
  },
  teacher: {
    heading: 'Atanan yazma ödevleri',
    caption: 'Atanan yazma ödevleri',
    empty: 'Henüz size atanmış yazma ödevi yok.',
    listKey: 'gorevler-yazma',
    workspace: WRITING_PARAM,
  },
} as const satisfies Record<StudentTaskMode, object>

const dueLabel = (iso: string | null) =>
  iso ? `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}` : '—'

/** Durum metnine göre panel düğmesi: ana işlem görünür, sonuç/ayrıntı sakin kalır. */
function actionLabel(status: string): { text: string; primary: boolean } {
  switch (status) {
    case 'Sürüyor':
      return { text: 'Denemeye devam et', primary: true }
    case 'Başlanmadı':
      return { text: 'Göreve başla', primary: true }
    case 'Bekliyor':
      return { text: 'Yazmaya başla', primary: true }
    case 'Yeniden teslim istendi':
      return { text: 'Yeni sürüm yaz', primary: true }
    default:
      return { text: 'Ayrıntıyı aç', primary: false }
  }
}

/**
 * Öğrencinin atanmış görevleri (IST-051; ADR 0004 karar 10): `mode` otomatik puanlı (quiz) ya da
 * öğretmen puanlı (yazma ödevi) görevleri ayırır. Kapsamı sunucu uygular; öğrenci yalnız kendisine
 * hedeflenenleri görür. Durum, hak ve açılmış puan satır başına deneme/teslim okumasından gelir;
 * satır sağ panelde özetlenir, çalışma alanı ayrı görünümde açılır.
 */
export function StudentTaskSection({ mode }: { mode: StudentTaskMode }) {
  const copy = COPY[mode]
  const assignments = useLearnerAssignments()
  const learners = useMemo(
    () => assignments.items.filter(isLearnerAssignment).filter((item) => item.scoringMode === mode),
    [assignments.items, mode],
  )
  const progress = useLearnerTaskProgress(learners)
  const nowMs = useNow(true, 30_000)
  const now = new Date(nowMs)

  const progressOf = (assignment: (typeof learners)[number]) => {
    if (assignment.scoringMode === 'auto') {
      const attempts = progress.attempts.get(assignment.id)
      return attempts ? autoProgress(assignment, attempts, now) : null
    }
    if (!progress.submissions.has(assignment.id)) return null
    return writingProgress(assignment, progress.submissions.get(assignment.id) ?? null, now)
  }
  const rows = assignments.isReady
    ? learners.map((assignment) =>
        studentTaskRow(assignment, progressOf(assignment), progress.errors.has(assignment.id)),
      )
    : undefined
  const failedCount = progress.errors.size

  const panel = useDetailPanel(PANEL_PARAM)
  const workspace = useDetailPanel(copy.workspace)
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

  const selected = learners.find((item) => item.id === panel.selectedId)
  const selectedProgress = selected
    ? (progressOf(selected) ?? (progress.errors.has(selected.id) ? FAILED : null))
    : null
  const action = selectedProgress ? actionLabel(selectedProgress.status) : null

  return (
    <>
      <section
        aria-labelledby={`${copy.listKey}-baslik`}
        className="panel mb-6 overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id={`${copy.listKey}-baslik`} className="text-lg font-semibold">
            {copy.heading}
          </h2>
          {rows && rows.length > 0 ? (
            <p className="text-sm text-muted-foreground">{rows.length} görev</p>
          ) : null}
        </header>
        {rows && rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">{copy.empty}</p>
        ) : (
          <TableGate
            error={assignments.isReady ? null : assignments.error}
            onRetry={() => void assignments.refetch()}
            loading={rows === undefined}
          >
            {assignments.truncated ? (
              <p role="status" className="px-6 pb-3 text-sm text-muted-foreground">
                Görev sayınız çok fazla; yalnız en yeni kayıtlar gösteriliyor.
              </p>
            ) : null}
            {failedCount > 0 ? (
              <div role="status" className="flex flex-wrap items-center gap-3 px-6 pb-3 text-sm">
                <span>{failedCount} görevin durumu okunamadı.</span>
                <Button type="button" variant="secondary" size="sm" onClick={progress.refetch}>
                  Yeniden dene
                </Button>
              </div>
            ) : null}
            <DataTable
              listKey={copy.listKey}
              rows={rows ?? NONE}
              columns={columns}
              mobileColumns={MOBILE_COLUMNS}
              caption={copy.caption}
              searchKeys={['title', 'type']}
              onRowClick={(row) => openPanel(row.id)}
            />
          </TableGate>
        )}
      </section>

      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Görev ayrıntısı"
      >
        {selected && selectedProgress ? (
          <div className="grid gap-5">
            <div>
              <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{selected.title}</h3>
              <p className="text-sm text-muted-foreground">
                {taskTypeLabel(selected)} · {taskKindLabel(selected)}
              </p>
            </div>
            <Facts
              items={[
                [
                  'Durum',
                  <StatusBadge
                    key="d"
                    text={selectedProgress.status}
                    tone={selectedProgress.tone}
                  />,
                ],
                ['Son teslim', dueLabel(selected.deadline.dueAt)],
                [mode === 'auto' ? 'Deneme hakkı' : 'Sürüm hakkı', selectedProgress.rights],
                ...(selected.timeLimitMinutes
                  ? ([['Süre sınırı', `${selected.timeLimitMinutes} dk`]] as const)
                  : []),
                ['Puan', selectedProgress.score],
              ]}
            />
            {selectedProgress.blockedReason ? (
              <p role="status" className="text-sm text-muted-foreground">
                {selectedProgress.blockedReason}
              </p>
            ) : null}
            {action ? (
              <Button
                type="button"
                variant={action.primary ? 'default' : 'secondary'}
                className="justify-self-start"
                onClick={() => workspace.open(selected.id)}
              >
                <Icon name={mode === 'auto' ? 'Play' : 'Pencil'} size={16} aria-hidden="true" />
                {action.text}
              </Button>
            ) : null}
          </div>
        ) : !selected && assignments.isReady && !assignments.isLoadingMore ? (
          <p role="status" className="text-sm text-muted-foreground">
            Görev bulunamadı. Size atanmamış ya da kaldırılmış olabilir.
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
