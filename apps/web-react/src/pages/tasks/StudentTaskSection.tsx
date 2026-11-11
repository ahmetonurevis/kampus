import { useMemo } from 'react'
import { useLearnerAssignments } from '@kampus/react-shared/use-learner-task-progress.ts'
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
  isLearnerAssignment,
  isSpeakingTask,
  studentTaskRow,
  summaryProgress,
  taskKindLabel,
  taskTypeLabel,
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
    heading: 'Atanan yazma ve konuşma görevleri',
    caption: 'Atanan yazma ve konuşma görevleri',
    empty: 'Henüz size atanmış yazma ya da konuşma görevi yok.',
    listKey: 'gorevler-yazma',
    workspace: WRITING_PARAM,
  },
} as const satisfies Record<StudentTaskMode, object>

const dueLabel = (iso: string | null) =>
  iso ? `${dateLabel(iso, { year: 'numeric' })} ${timeLabel(iso)}` : '—'

/**
 * Durum metnine göre panel düğmesi: ana işlem görünür, sonuç/ayrıntı sakin kalır. İşlem şu an
 * yapılamıyorsa (hak, süre, lisans) düğme yalnız ayrıntıyı açar.
 */
function actionLabel(
  status: string,
  canAct: boolean,
  speaking: boolean,
): { text: string; primary: boolean } {
  if (!canAct) return { text: 'Ayrıntıyı aç', primary: false }
  switch (status) {
    case 'Sürüyor':
      return { text: 'Denemeye devam et', primary: true }
    case 'Başlanmadı':
      return { text: 'Göreve başla', primary: true }
    case 'Bekliyor':
      return { text: speaking ? 'Kayda başla' : 'Yazmaya başla', primary: true }
    case 'Yeniden teslim istendi':
      return { text: speaking ? 'Yeni kayıt yap' : 'Yeni sürüm yaz', primary: true }
    case 'Teslim edildi':
    case 'Geç teslim edildi':
      // Konuşmada hak kaldıysa yeni deneme gönderilebilir (DOM-BEC-040).
      return speaking
        ? { text: 'Yeni kayıt yap', primary: false }
        : { text: 'Ayrıntıyı aç', primary: false }
    default:
      return { text: 'Ayrıntıyı aç', primary: false }
  }
}

/**
 * Öğrencinin atanmış görevleri (IST-051; ADR 0004 karar 10): `mode` otomatik puanlı (quiz) ya da
 * öğretmen puanlı (yazma ödevi) görevleri ayırır. Kapsamı sunucu uygular; öğrenci yalnız kendisine
 * hedeflenenleri görür. Durum, hak ve açılmış puan atama listesinin kursiyer özetinden (`progress`)
 * gelir; satır başına istek atılmaz. Satır sağ panelde özetlenir, çalışma alanı ayrı görünümde açılır.
 */
export function StudentTaskSection({ mode }: { mode: StudentTaskMode }) {
  const copy = COPY[mode]
  const assignments = useLearnerAssignments()
  const learners = useMemo(
    () => assignments.items.filter(isLearnerAssignment).filter((item) => item.scoringMode === mode),
    [assignments.items, mode],
  )
  const nowMs = useNow(true, 30_000)
  const now = new Date(nowMs)
  const rows = assignments.isReady
    ? learners.map((assignment) => studentTaskRow(assignment, summaryProgress(assignment, now)))
    : undefined

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
  const selectedProgress = selected ? (summaryProgress(selected, now) ?? FAILED) : null
  const speaking = selected ? isSpeakingTask(selected) : false
  const action = selectedProgress
    ? actionLabel(selectedProgress.status, selectedProgress.canAct, speaking)
    : null

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
                [
                  mode === 'auto' || speaking ? 'Deneme hakkı' : 'Sürüm hakkı',
                  selectedProgress.rights,
                ],
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
                <Icon
                  name={mode === 'auto' ? 'Play' : speaking ? 'Mic' : 'Pencil'}
                  size={16}
                  aria-hidden="true"
                />
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
